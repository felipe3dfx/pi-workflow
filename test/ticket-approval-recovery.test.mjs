import assert from "node:assert/strict";
import test from "node:test";

import {
	createDurableTicketApprovalRecoveryStore,
	createEngramTicketApprovalRecoveryStore,
} from "../extensions/ticket-approval-recovery.ts";
import { digestCanonicalValue, sha256Hex } from "../extensions/workflow-contracts.ts";

function state() {
	return {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "spec-digest" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/published-parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-ticket-graph/graph-digest", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: "graph-digest" },
		digest: "graph-digest",
		authority: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" },
	};
}

function otherState() {
	return {
		...state(),
		definitionId: "definition-2",
		approvedSpecRef: {
			...state().approvedSpecRef,
			topic: "workflow/define-product/definition-2/approved-spec",
		},
		parentRef: {
			...state().parentRef,
			topic: "workflow/define-product/definition-2/published-parent",
		},
		graphRef: {
			...state().graphRef,
			topic:
				"workflow/define-product/definition-2/approved-ticket-graph/graph-digest",
		},
	};
}

function barrier(parties) {
	const gate = Promise.withResolvers();
	let arrivals = 0;
	return async () => {
		arrivals += 1;
		if (arrivals === parties) gate.resolve();
		await gate.promise;
	};
}

function artifactStore(options = {}) {
	const topics = new Map();
	const revisions = new Map();
	let revision = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		topics,
		revisions,
		async readCurrent(project, topic) {
			await options.beforeReadCurrent?.({ project, topic });
			return topics.get(`${project}:${topic}`);
		},
		async write(project, topic, content, expectedRevision) {
			const key = `${project}:${topic}`;
			const current = topics.get(key);
			if (current?.revision !== expectedRevision) {
				const error = new Error("compare-and-swap conflict");
				error.code = "revision-conflict";
				throw error;
			}
			revision += 1;
			const stored = { revision: `artifact-r${revision}`, content };
			topics.set(key, stored);
			revisions.set(`${key}:${stored.revision}`, content);
			return { revision: stored.revision };
		},
		async readRevision(project, topic, requestedRevision) {
			const content = revisions.get(
				`${project}:${topic}:${requestedRevision}`,
			);
			await options.beforeReadRevision?.({
				project,
				topic,
				revision: requestedRevision,
				content,
			});
			return content;
		},
	};
}

function persistence(options = {}) {
	const { readBack } = options;
	const capabilities = Object.hasOwn(options, "capabilities")
		? options.capabilities
		: { atomicCompareAndSwap: true };
	let content;
	const writes = [];
	return {
		capabilities,
		writes,
		get content() { return content; },
		set content(value) { content = value; },
		async readFile() { return readBack?.(content) ?? content; },
		async withMutation(_operation, run) { return run(); },
		async writeFileAtomic(_path, value, expectedDigest) {
			assert.equal(expectedDigest, content === undefined ? null : sha256Hex(content));
			writes.push(value);
			content = value;
		},
	};
}

test("Engram ticket approval recovery persists across stores and clears with a canonical tombstone", async () => {
	const artifacts = artifactStore();
	const first = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	await first.save(state());
	assert.deepEqual(await first.load(), state());

	const restarted = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	assert.deepEqual(await restarted.load(), state());
	await restarted.clear();
	assert.equal(await restarted.load(), undefined);

	const stored = artifacts.topics.get(
		"pi-workflow:workflow/define-product/ticket-approval-recovery",
	);
	const envelope = JSON.parse(stored.content);
	assert.deepEqual(envelope.payload, null);
	assert.equal(envelope.schema, "ticket-approval-recovery");
	assert.equal(envelope.schemaVersion, 1);
	assert.equal(
		envelope.digest,
		digestCanonicalValue({
			schema: envelope.schema,
			schemaVersion: envelope.schemaVersion,
			payload: null,
		}),
	);
	assert.equal(stored.content, `${JSON.stringify(envelope)}\n`);
});

test("Engram ticket approval recovery fails closed on invalid state, corrupt content, and read-back drift", async () => {
	const artifacts = artifactStore();
	const subject = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	await assert.rejects(
		() =>
			subject.save({
				...state(),
				approvedSpecRef: { ...state().approvedSpecRef, project: "other-project" },
			}),
		/invalid/i,
	);

	await artifacts.write(
		"pi-workflow",
		"workflow/define-product/ticket-approval-recovery",
		'{"schema":"ticket-approval-recovery","schemaVersion":1,"payload":null,"digest":"wrong"}\n',
		undefined,
	);
	await assert.rejects(() => subject.load(), /invalid/i);
	await assert.rejects(() => subject.clear(), /invalid/i);

	const durable = artifactStore();
	const drifting = {
		...durable,
		async readRevision(project, topic, revision) {
			const content = await durable.readRevision(project, topic, revision);
			return content === undefined ? undefined : `${content}drift`;
		},
	};
	await assert.rejects(
		() =>
			createEngramTicketApprovalRecoveryStore({
				store: drifting,
				project: "pi-workflow",
			}).save(state()),
		/read-back mismatch/i,
	);

	const withoutCas = createEngramTicketApprovalRecoveryStore({
		store: { ...artifactStore(), capabilities: undefined },
		project: "pi-workflow",
	});
	await assert.rejects(() => withoutCas.save(state()), /compare-and-swap/i);
	await assert.rejects(() => withoutCas.clear(), /compare-and-swap/i);

	const casBackend = artifactStore();
	const casMismatch = createEngramTicketApprovalRecoveryStore({
		store: {
			...casBackend,
			async write() {
				throw new Error("compare-and-swap conflict");
			},
		},
		project: "pi-workflow",
	});
	await assert.rejects(() => casMismatch.save(state()), /compare-and-swap conflict/i);
	assert.equal(await casMismatch.load(), undefined);
});

test("Engram ticket approval recovery deterministically rejects a second active continuation", async () => {
	const artifacts = artifactStore();
	const subject = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	await subject.save(state());
	await subject.save(structuredClone(state()));

	const second = otherState();
	await assert.rejects(() => subject.save(second), /another active continuation/i);
	assert.deepEqual(await subject.load(), state());

	const staleRuntime = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	assert.deepEqual(await staleRuntime.load(), state());
	await subject.clear();
	await subject.save(second);
	await assert.rejects(
		() => staleRuntime.clear(),
		/bound active continuation/i,
	);
	assert.deepEqual(await subject.load(), second);
});

test("a stale Engram clear cannot remove a byte-identical newer active revision", async () => {
	const artifacts = artifactStore();
	const currentRuntime = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	await currentRuntime.save(state());
	const staleRuntime = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	await staleRuntime.load();

	await currentRuntime.clear();
	await currentRuntime.save(structuredClone(state()));
	await assert.rejects(
		() => staleRuntime.clear(),
		/bound active continuation/i,
	);
	assert.deepEqual(await currentRuntime.load(), state());
});

test("concurrent identical Engram saves adopt the same active continuation after a CAS loss", async () => {
	const synchronizeInitialReads = barrier(2);
	const artifacts = artifactStore({ beforeReadCurrent: synchronizeInitialReads });
	const first = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	const second = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});

	await Promise.all([first.save(state()), second.save(structuredClone(state()))]);
	assert.deepEqual(await first.load(), state());
	assert.deepEqual(await second.load(), state());
});

test("concurrent conflicting Engram saves fail closed with one active continuation", async () => {
	const synchronizeInitialReads = barrier(2);
	const artifacts = artifactStore({ beforeReadCurrent: synchronizeInitialReads });
	const first = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	const second = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});

	const results = await Promise.allSettled([
		first.save(state()),
		second.save(otherState()),
	]);
	assert.equal(
		results.filter((result) => result.status === "fulfilled").length,
		1,
	);
	const rejected = results.find((result) => result.status === "rejected");
	assert.ok(rejected);
	assert.match(rejected.reason.message, /another active continuation/i);
	const active = JSON.parse(artifacts.topics.values().next().value.content).payload;
	assert.deepEqual(
		active,
		active.definitionId === state().definitionId ? state() : otherState(),
	);
});

test("Engram clear verifies its tombstone revision when a new continuation immediately succeeds it", async () => {
	const successorSaved = Promise.withResolvers();
	let saveSuccessor;
	let tombstoneVerificationStarted = false;
	let readsAfterTombstoneWrite = 0;
	const artifacts = artifactStore({
		async beforeReadRevision({ content }) {
			if (
				!tombstoneVerificationStarted &&
				content !== undefined &&
				JSON.parse(content).payload === null
			) {
				tombstoneVerificationStarted = true;
				assert.ok(saveSuccessor);
				await saveSuccessor();
				successorSaved.resolve();
			}
		},
		async beforeReadCurrent() {
			if (!tombstoneVerificationStarted) return;
			readsAfterTombstoneWrite += 1;
			if (readsAfterTombstoneWrite > 1) await successorSaved.promise;
		},
	});
	const clearing = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	const succeeding = createEngramTicketApprovalRecoveryStore({
		store: artifacts,
		project: "pi-workflow",
	});
	saveSuccessor = () => succeeding.save(otherState());
	await clearing.save(state());
	await clearing.clear();

	assert.deepEqual(await succeeding.load(), otherState());
	assert.ok(
		[...artifacts.revisions.values()].some(
			(content) => JSON.parse(content).payload === null,
		),
	);
});

test("durable ticket approval recovery persists, reads back, reloads, and clears verified state", async () => {
	const durable = persistence();
	const first = createDurableTicketApprovalRecoveryStore({ path: "/private/ticket.json", persistence: durable });
	await first.save(state());
	assert.deepEqual(await first.load(), state());
	const restarted = createDurableTicketApprovalRecoveryStore({ path: "/private/ticket.json", persistence: durable });
	assert.deepEqual(await restarted.load(), state());
	await restarted.clear();
	assert.equal(await restarted.load(), undefined);
	assert.equal(durable.content, "null\n");
});

test("durable ticket approval recovery requires explicit atomic compare-and-swap capability", async () => {
	for (const capabilities of [undefined, { atomicCompareAndSwap: false }]) {
		const durable = persistence({ capabilities });
		const store = createDurableTicketApprovalRecoveryStore({ path: "/private/ticket.json", persistence: durable });
		await assert.rejects(() => store.save(state()), /compare-and-swap/i);
		await assert.rejects(() => store.clear(), /compare-and-swap/i);
		assert.equal(durable.writes.length, 0);
	}
});

test("durable ticket approval recovery refuses read-back drift and corrupt, future, or mismatched state", async () => {
	const readBackMismatch = persistence({ readBack: (content) => content && `${content}drift` });
	const mismatchStore = createDurableTicketApprovalRecoveryStore({ path: "/private/ticket.json", persistence: readBackMismatch });
	await assert.rejects(() => mismatchStore.save(state()), /read-back mismatch/i);

	for (const content of [
		"not json",
		JSON.stringify({ schemaVersion: 2, state: state(), digest: "future" }),
		JSON.stringify({ schemaVersion: 1, state: { ...state(), definitionId: "" }, digest: digestCanonicalValue({ schemaVersion: 1, state: { ...state(), definitionId: "" } }) }),
		JSON.stringify({ schemaVersion: 1, state: state(), digest: "mismatched" }),
	]) {
		const durable = persistence();
		durable.content = content;
		const store = createDurableTicketApprovalRecoveryStore({ path: "/private/ticket.json", persistence: durable });
		await assert.rejects(() => store.load(), /invalid/i);
	}
});
