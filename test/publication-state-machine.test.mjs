import assert from "node:assert/strict";
import test from "node:test";

import { createDurablePublicationManifest } from "../extensions/publication-manifest.ts";
import { createPublicationStateMachine } from "../extensions/publication-state-machine.ts";

const identity = {
	definitionId: "definition-1",
	specDigest: "spec-digest",
	specRevision: "spec-r1",
	sourceRevision: "engram-r1",
	publicationKey: "c".repeat(64),
};

function harness() {
	const files = new Map();
	const store = createDurablePublicationManifest({
		directory: "/state/publications",
		persistence: {
			withMutation: async (_id, run) => run(),
			readFile: async (path) => files.get(path),
			writeFileAtomic: async (path, content, expected) => {
				const current = files.get(path);
				const digest = current
					? (await import("node:crypto"))
							.createHash("sha256")
							.update(current)
							.digest("hex")
					: null;
				if (digest !== expected) throw new Error("durable CAS mismatch");
				files.set(path, content);
			},
		},
	});
	let sequence = 0;
	const machine = () =>
		createPublicationStateMachine({
			store,
			createReservationId: () => `reservation-${++sequence}`,
		});
	return { store, machine };
}

test("only one publisher owns the durable create claim", async () => {
	const { machine } = harness();
	const first = await machine().claim(identity);
	const competing = await machine().claim(identity);

	assert.equal(first.status, "claimed");
	assert.deepEqual(competing, {
		status: "recovery-required",
		stage: "creating",
	});
	assert.equal(
		(
			await machine().recordCreated(
				competing.claim ?? {
					definitionId: identity.definitionId,
					reservationId: "other",
				},
				"parent-2",
			)
		).blocker.code,
		"PI_WORKFLOW_PUBLICATION_CONFLICT",
	);
});

test("a proven pre-create failure releases only its own claim for retry", async () => {
	const { machine } = harness();
	const owner = await machine().claim(identity);
	assert.equal(owner.status, "claimed");

	assert.deepEqual(await machine().releasePreCreateClaim(owner.claim), {
		status: "prepared",
	});
	const retry = await machine().claim(identity);
	assert.equal(retry.status, "claimed");
	assert.notEqual(retry.claim.reservationId, owner.claim.reservationId);
	assert.equal(
		(await machine().releasePreCreateClaim(owner.claim)).blocker.code,
		"PI_WORKFLOW_PUBLICATION_CONFLICT",
	);
});

test("partial creation remains recoverable and cannot be released as pre-create", async () => {
	const { machine } = harness();
	const claimed = await machine().claim(identity);
	const created = await machine().recordCreated(claimed.claim, "parent-1");

	assert.deepEqual(created, {
		status: "recovery-required",
		stage: "created",
		parentId: "parent-1",
	});
	assert.deepEqual(await machine().prepare(identity), created);
	assert.equal(
		(await machine().releasePreCreateClaim(claimed.claim)).blocker.code,
		"PI_WORKFLOW_PUBLICATION_CONFLICT",
	);
	assert.deepEqual(await machine().recordVerified("definition-1", "parent-1"), {
		status: "verified",
		parentId: "parent-1",
	});
});

test("a changed approved identity blocks instead of replacing durable recovery state", async () => {
	const { machine, store } = harness();
	const claimed = await machine().claim(identity);
	await machine().recordCreated(claimed.claim, "parent-1");

	const stale = await machine().prepare({
		...identity,
		sourceRevision: "engram-r2",
	});

	assert.equal(stale.status, "blocked");
	assert.equal(stale.blocker.code, "PI_WORKFLOW_PUBLICATION_STALE");
	assert.equal(
		(await store.load(identity.definitionId)).value.parentId,
		"parent-1",
	);
});
