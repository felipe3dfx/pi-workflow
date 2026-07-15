import assert from "node:assert/strict";
import test from "node:test";

import {
	createApprovedTicketGraphStore,
} from "../extensions/approved-ticket-graph-store.ts";
import { recoverApprovedTicketGraph } from "../extensions/ticket-graph-recovery.ts";
import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
} from "../extensions/delivery-ticket-graph.ts";

function graph() {
	return createDeliveryTicketGraph({
		parent: { id: "parent-1", teamId: "team-1", revision: "r1", specDigest: "spec-1" },
		coverage: createSpecCoverageIndex({
			stories: [{ id: "story-1", contextId: "delivery", acceptanceCriteria: ["ac-1"] }],
			decisions: ["decision-1"],
			tests: ["test-1"],
		}),
		language: "es",
		tickets: [{
			stableKey: "T01",
			title: "Crear flujo estable",
			outcome: "El Owner recibe un grafo verificable",
			acceptanceCriteria: ["Cumple uno", "Cumple dos", "Cumple tres", "Cumple cuatro"],
			estimate: { points: 1, rationale: "Alcance pequeño" },
			blockers: [],
			refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }],
			deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "delivery" }],
		}],
	});
}

function store(bytes = new Map()) {
	let revision = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		readCurrent: async (_project, topic) => bytes.get(topic)?.at(-1),
		write: async (_project, topic, content, expectedRevision) => {
			const versions = bytes.get(topic) ?? [];
			if (versions.at(-1)?.revision !== expectedRevision) throw new Error("compare-and-swap conflict");
			revision += 1;
			versions.push({ revision: `r${revision}`, content });
			bytes.set(topic, versions);
			return { revision: `r${revision}` };
		},
		readRevision: async (_project, topic, target) => bytes.get(topic)?.find((entry) => entry.revision === target)?.content,
	};
}

test("approved ticket graphs are immutable, CAS-protected, and recover only after verified read-back", async () => {
	const backend = store();
	const approved = createApprovedTicketGraphStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });
	const first = await approved.save(graph());
	assert.equal(first.schema, "delivery-ticket-graph");
	assert.equal((await recoverApprovedTicketGraph(backend, first)).digest, graph().digest);
	assert.deepEqual(await approved.save(graph()), first);
	await assert.rejects(
		() => createApprovedTicketGraphStore({ store: store(), project: "pi-workflow", topic: "workflow/conflict" }).save(graph(), "r0"),
		/compare-and-swap conflict/i,
	);
	await assert.rejects(() => recoverApprovedTicketGraph(backend, { ...first, digest: "forged" }), /mismatch|invalid/i);
});

test("approved ticket graph persistence and recovery fail closed for corrupt bytes, read-back mismatch, and unavailable CAS", async () => {
	const corrupt = store(new Map([["workflow/corrupt", [{ revision: "r1", content: "not-json" }]]]));
	await assert.rejects(
		() => recoverApprovedTicketGraph(corrupt, { kind: "engram", project: "pi-workflow", topic: "workflow/corrupt", revision: "r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph().digest }),
		/invalid|corrupt/i,
	);
	const mismatch = store();
	mismatch.readRevision = async () => "{}";
	await assert.rejects(
		() => createApprovedTicketGraphStore({ store: mismatch, project: "pi-workflow", topic: "workflow/mismatch" }).save(graph()),
		/read-back mismatch/i,
	);
	const unavailable = store();
	unavailable.capabilities = { atomicCompareAndSwap: false };
	await assert.rejects(
		() => recoverApprovedTicketGraph(unavailable, { kind: "engram", project: "pi-workflow", topic: "workflow/missing", revision: "r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph().digest }),
		/atomic compare-and-swap/i,
	);
	const missingStoreCapabilities = store();
	delete missingStoreCapabilities.capabilities;
	await assert.rejects(
		() => createApprovedTicketGraphStore({ store: missingStoreCapabilities, project: "pi-workflow", topic: "workflow/no-capabilities" }).save(graph()),
		/atomic compare-and-swap/i,
	);
	const missingRecoveryCapabilities = store();
	delete missingRecoveryCapabilities.capabilities;
	await assert.rejects(
		() => recoverApprovedTicketGraph(missingRecoveryCapabilities, { kind: "engram", project: "pi-workflow", topic: "workflow/missing-capabilities", revision: "r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph().digest }),
		/atomic compare-and-swap/i,
	);
});

test("approved ticket graphs use immutable digest-keyed snapshots and recover an identical save", async () => {
	const backend = store();
	const approved = createApprovedTicketGraphStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });
	const original = graph();
	const first = await approved.save(original);
	const repeated = await approved.save(original);
	assert.deepEqual(repeated, first);
	assert.equal(first.topic, `workflow/tickets/${original.digest}`);

	const changed = createDeliveryTicketGraph({
		parent: { ...original.payload.parent, revision: "r2" },
		coverage: createSpecCoverageIndex(original.payload.coverage),
		language: "es",
		tickets: original.payload.tickets,
	});
	const renewed = await approved.save(changed);
	assert.notEqual(renewed.topic, first.topic);
	assert.equal(renewed.topic, `workflow/tickets/${changed.digest}`);
});
