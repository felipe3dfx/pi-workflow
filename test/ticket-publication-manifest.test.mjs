import assert from "node:assert/strict";
import test from "node:test";

import {
	createTicketPublicationManifestStore,
	createTicketPublicationOperationId,
} from "../extensions/ticket-publication-manifest.ts";

const graphDigest = "a".repeat(64);
const identity = {
	definitionId: "definition-1",
	graphDigest,
	parent: { id: "parent-1", revision: "parent-r1" },
};

function memory() {
	let current;
	return {
		read: async () => current,
		create: async (value) => {
			if (current) throw new Error("already exists");
			current = { revision: "r1", value };
			return current;
		},
		compareAndSwap: async (expectedRevision, value) => {
			if (!current || current.revision !== expectedRevision)
				throw new Error("compare-and-swap conflict");
			current = { revision: `r${Number(current.revision.slice(1)) + 1}`, value };
			return current;
		},
	};
}

test("canonical operation IDs are stable for the same approved graph and change with authority", () => {
	const operationId = createTicketPublicationOperationId(identity);
	assert.equal(operationId, createTicketPublicationOperationId({ ...identity }));
	assert.equal(
		operationId,
		createTicketPublicationOperationId({
			...identity,
			parent: { revision: identity.parent.revision, id: identity.parent.id },
		}),
	);
	assert.notEqual(
		operationId,
		createTicketPublicationOperationId({
			...identity,
			parent: { ...identity.parent, revision: "parent-r2" },
		}),
	);
});

test("manifest advances only through the CAS-backed publication stages and reads each write back", async () => {
	const store = createTicketPublicationManifestStore({ persistence: memory() });
	const prepared = await store.prepare(identity);
	assert.deepEqual(prepared, {
		...identity,
		schemaVersion: 1,
		operationId: createTicketPublicationOperationId(identity),
		stage: "prepared",
		children: [],
		relations: [],
		verification: undefined,
	});
	const children = await store.advance(prepared.operationId, "prepared", "children", {
		children: [{ stableKey: "T1", linearId: "child-1" }],
	});
	const relations = await store.advance(children.operationId, "children", "relations", {});
	const verifying = await store.advance(relations.operationId, "relations", "verifying", {});
	const verified = await store.advance(verifying.operationId, "verifying", "verified", {
		verification: { graphDigest, parentId: "parent-1" },
	});
	assert.deepEqual(
		[children.stage, relations.stage, verifying.stage, verified.stage],
		["children", "relations", "verifying", "verified"],
	);
	assert.deepEqual(await store.read(verified.operationId), verified);
});

test("manifest is create-only and rejects illegal transitions or malformed stage shapes", async () => {
	const store = createTicketPublicationManifestStore({ persistence: memory() });
	const prepared = await store.prepare(identity);
	assert.deepEqual(await store.prepare(identity), prepared);
	await assert.rejects(
		() => store.advance(prepared.operationId, "prepared", "relations", {}),
		/illegal manifest transition/,
	);
	await assert.rejects(
		() => store.advance(prepared.operationId, "prepared", "children", {}),
		/children stage requires published children/,
	);
});

test("manifest keeps children and relations immutable after their owning stages", async () => {
	const store = createTicketPublicationManifestStore({ persistence: memory() });
	const prepared = await store.prepare(identity);
	const children = await store.advance(prepared.operationId, "prepared", "children", {
		children: [{ stableKey: "T1", linearId: "child-1" }],
	});
	await assert.rejects(
		() =>
			store.advance(children.operationId, "children", "relations", {
				children: [{ stableKey: "T1", linearId: "replacement-child" }],
			}),
		/manifest stage-owned fields are immutable/,
	);
	assert.deepEqual(await store.read(children.operationId), children);
	const relations = await store.advance(children.operationId, "children", "relations", {
		relations: [{ blockedStableKey: "T2", blockingStableKey: "T1" }],
	});
	await assert.rejects(
		() =>
			store.advance(relations.operationId, "relations", "verifying", {
				relations: [{ blockedStableKey: "T3", blockingStableKey: "T1" }],
			}),
		/manifest stage-owned fields are immutable/,
	);
	assert.deepEqual(await store.read(relations.operationId), relations);
});

test("manifest rejects malformed identities before creating durable state", async () => {
	let creates = 0;
	const store = createTicketPublicationManifestStore({
		persistence: {
			read: async () => undefined,
			create: async () => {
				creates += 1;
				throw new Error("durable create must not run");
			},
			compareAndSwap: async () => {
				throw new Error("durable compare-and-swap must not run");
			},
		},
	});
	await assert.rejects(
		() =>
			store.prepare({
				...identity,
				graphDigest: "not-a-digest",
				parent: { id: "", revision: "" },
			}),
		/manifest identity is invalid/,
	);
	await assert.rejects(
		() =>
			store.prepare({
				...identity,
				parent: { id: 42, revision: identity.parent.revision },
			}),
		/manifest identity is invalid/,
	);
	assert.equal(creates, 0);
});

test("manifest rejects malformed durable identities and shapes without mutation", async () => {
	for (const [malformed, error] of [
		[{ graphDigest: "not-a-digest", parent: identity.parent }, /manifest identity is invalid/],
		[{ graphDigest, parent: { id: 42, revision: identity.parent.revision } }, /manifest identity is invalid/],
		[{ schemaVersion: 2 }, /manifest shape is invalid/],
		[{ stage: "unknown" }, /manifest shape is invalid/],
		[{ stage: "children", children: [{ stableKey: 42, linearId: "child-1" }] }, /manifest shape is invalid/],
		[{ stage: "relations", children: [{ stableKey: "T1", linearId: "child-1" }], relations: [{ blockedStableKey: 42, blockingStableKey: "T1" }] }, /manifest shape is invalid/],
		[{ stage: "verified", children: [], verification: { graphDigest, parentId: identity.parent.id } }, /verified stage requires matching read-back/],
	]) {
		const store = createTicketPublicationManifestStore({
			persistence: {
				read: async () => ({
					revision: "r1",
				value: { ...identity, schemaVersion: 1, operationId: createTicketPublicationOperationId(identity), stage: "prepared", children: [], relations: [], ...malformed },
				}),
				create: async () => { throw new Error("durable create must not run"); },
				compareAndSwap: async () => { throw new Error("durable compare-and-swap must not run"); },
			},
		});
		await assert.rejects(() => store.prepare(identity), error);
	}
});
