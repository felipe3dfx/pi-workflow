import assert from "node:assert/strict";
import test from "node:test";
import { publishApprovedSpec } from "../extensions/delivery-parent-publication.ts";
import {
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
} from "../extensions/product-spec.ts";
import { createPublicationStateMachine } from "../extensions/publication-state-machine.ts";
import { createDurablePublicationManifest } from "../extensions/publication-manifest.ts";

function harness(overrides = {}) {
	const actor = { actorId: "owner-1", role: "Owner", authorityRevision: "a1" };
	const spec = createProductSpecEnvelope({
		definitionId: "definition-1",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Entrega",
		},
		revision: "r1",
		problem: "Problema verificable.",
		solution: "Solución verificable.",
		userStories: ["Como Owner, quiero publicar."],
		decisions: [
			{
				id: "d1",
				status: "resolved",
				pertinent: true,
				text: "Publicar exactamente.",
			},
		],
		tests: ["Leer exactamente."],
		outOfScope: ["Crear subissues."],
		supportArtifacts: [],
	});
	let approved = {
		spec,
		approval: createProductSpecApprovalEnvelope({ spec, actor }),
		sourceRevision: "engram-1",
	};
	const files = new Map();
	const store = createDurablePublicationManifest({
		directory: "/state",
		persistence: {
			withMutation: async (_id, run) => run(),
			readFile: async (path) => files.get(path),
			writeFileAtomic: async (path, content, expected) => {
				const current = files.get(path);
				if (
					expected !==
					(current
						? (await import("node:crypto"))
								.createHash("sha256")
								.update(current)
								.digest("hex")
						: null)
				)
					throw Object.assign(new Error("CAS conflict"), {
						code: "PI_WORKFLOW_PUBLICATION_CONFLICT",
					});
				files.set(path, content);
			},
		},
	});
	let key;
	let creates = 0;
	const issue = () => ({
		id: "parent-1",
		teamId: "team-1",
		title: "Entrega",
		description: spec.payload.body,
		descriptionRevision: "r1",
		state: "Backlog",
		cycleId: null,
		assigneeId: null,
		publicationKey: key,
	});
	const linear = {
		preflight: async () => ({
			teamId: "team-1",
			accessRevision: "a",
			capabilityRevision: "c",
			stateRevision: "s",
			supportsCycles: true,
		}),
		findByPublicationKey: async () => [],
		create: async (input) => {
			creates += 1;
			key = input.publicationKey;
			return issue();
		},
		read: async () => issue(),
		...overrides.linear,
	};
	const dependencies = {
		approvedSpecReader: { read: async () => structuredClone(approved) },
		authenticatedAuthority: { current: async () => structuredClone(actor) },
		parentSnapshots: {
			persist: async () => ({
				kind: "engram",
				project: "pi-workflow",
				topic: "workflow/define-product/definition-1/published-parent",
				revision: "artifact-r1",
				schema: "delivery-parent",
				schemaVersion: 1,
				digest: "parent-digest",
			}),
		},
		state: createPublicationStateMachine({
			store,
			createReservationId: () => crypto.randomUUID(),
		}),
		linear,
		...overrides.dependencies,
	};
	return {
		dependencies,
		issue,
		get creates() {
			return creates;
		},
		setApproved: (value) => {
			approved = value;
		},
	};
}

test("publishes once with exact Backlog identity and verifies read-back", async () => {
	const h = harness();
	const first = await publishApprovedSpec(h.dependencies, "definition-1");
	const retry = await publishApprovedSpec(h.dependencies, "definition-1");
	assert.equal(first.status, "spec-published");
	assert.deepEqual(retry, first);
	assert.equal(h.creates, 1);
});

test("persists and returns the verified immutable Delivery-parent ref after publication", async () => {
	const persisted = [];
	const parentRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/define-product/definition-1/published-parent",
		revision: "artifact-r1",
		schema: "delivery-parent",
		schemaVersion: 1,
		digest: "parent-digest",
	};
	const h = harness({
		dependencies: {
			parentSnapshots: {
				persist: async (input) => {
					persisted.push(input);
					return parentRef;
				},
			},
		},
	});
	const outcome = await publishApprovedSpec(h.dependencies, "definition-1");
	assert.equal(outcome.status, "spec-published");
	assert.deepEqual(outcome.parentRef, parentRef);
	assert.deepEqual(persisted, [{
		definitionId: "definition-1",
		parent: h.issue(),
		specDigest: (await h.dependencies.approvedSpecReader.read("definition-1")).spec.digest,
	}]);
});

test("revalidates approved Spec after awaited preflight and search before create", async () => {
	const h = harness();
	const original = await h.dependencies.approvedSpecReader.read("definition-1");
	h.dependencies.linear.findByPublicationKey = async () => {
		h.setApproved({ ...original, sourceRevision: "engram-2" });
		return [];
	};
	const outcome = await publishApprovedSpec(h.dependencies, "definition-1");
	assert.equal(outcome.blocker.code, "PI_WORKFLOW_PUBLICATION_STALE");
	assert.equal(h.creates, 0);
});

test("fails closed for duplicates, permission/rate limits, and exact read-back mismatch", async (t) => {
	await t.test("duplicate", async () => {
		const h = harness();
		h.dependencies.linear.findByPublicationKey = async (
			_team,
			publicationKey,
		) => [
			{ ...h.issue(), id: "p1", publicationKey },
			{ ...h.issue(), id: "p2", publicationKey },
		];
		assert.equal(
			(await publishApprovedSpec(h.dependencies, "definition-1")).blocker.code,
			"PI_WORKFLOW_PUBLICATION_DUPLICATE",
		);
	});
	for (const expected of [
		"PI_WORKFLOW_LINEAR_PERMISSION_DENIED",
		"PI_WORKFLOW_LINEAR_RATE_LIMITED",
	]) {
		await t.test(expected, async () => {
			const h = harness({
				linear: {
					create: async () => {
						throw Object.assign(new Error(expected), { code: expected });
					},
				},
			});
			assert.equal(
				(await publishApprovedSpec(h.dependencies, "definition-1")).blocker
					.code,
				expected,
			);
		});
	}
	await t.test("read-back", async () => {
		const h = harness({
			linear: {
				read: async () => ({ ...h.issue(), descriptionRevision: "r2" }),
			},
		});
		assert.equal(
			(await publishApprovedSpec(h.dependencies, "definition-1")).blocker.code,
			"PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
		);
	});
});

test("recovers a unique parent after interruption without creating a duplicate", async () => {
	const h = harness();
	let recovered;
	h.dependencies.linear.create = async (input) => {
		recovered = { ...h.issue(), publicationKey: input.publicationKey };
		throw Object.assign(new Error("rate limit after create"), {
			code: "PI_WORKFLOW_LINEAR_RATE_LIMITED",
		});
	};
	assert.equal(
		(await publishApprovedSpec(h.dependencies, "definition-1")).blocker.code,
		"PI_WORKFLOW_LINEAR_RATE_LIMITED",
	);
	h.dependencies.linear.findByPublicationKey = async () => [recovered];
	h.dependencies.linear.read = async () => recovered;
	const retry = await publishApprovedSpec(h.dependencies, "definition-1");
	assert.equal(retry.status, "spec-published");
});
