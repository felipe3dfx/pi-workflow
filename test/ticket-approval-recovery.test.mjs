import assert from "node:assert/strict";
import test from "node:test";

import { createDurableTicketApprovalRecoveryStore } from "../extensions/ticket-approval-recovery.ts";
import { digestCanonicalValue, sha256Hex } from "../extensions/workflow-contracts.ts";

function state() {
	return {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "spec-digest" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/published-parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-ticket-graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: "graph-digest" },
		digest: "graph-digest",
		authority: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" },
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
