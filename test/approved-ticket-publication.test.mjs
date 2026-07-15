import assert from "node:assert/strict";
import test from "node:test";

import {
	createApprovedTicketPublicationStore,
} from "../extensions/approved-ticket-publication.ts";
import {
	canonicalJson,
	digestCanonicalValue,
} from "../extensions/workflow-contracts.ts";
import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
	createTicketGraphApproval,
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

function reDigestApproval(approval, payload) {
	const unsigned = { schema: approval.schema, schemaVersion: approval.schemaVersion, payload };
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function saveDurablePublication(bytes, input) {
	const unsigned = { schema: "approved-ticket-publication", schemaVersion: 1, payload: input };
	bytes.set("workflow/tickets/definition-1", [{
		revision: "r1",
		content: `${canonicalJson({ ...unsigned, digest: digestCanonicalValue(unsigned) })}\n`,
	}]);
}

test("approved ticket publication persists and reads back the exact graph reference and Owner approval across restart", async () => {
	const backend = store();
	const ticketGraph = graph();
	const approval = createTicketGraphApproval({
		graph: ticketGraph,
		actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" },
	});
	const input = {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "spec-1" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: ticketGraph.digest },
		graphParent: ticketGraph.payload.parent,
		approval,
	};
	const first = createApprovedTicketPublicationStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });
	const ref = await first.save(input);
	const restarted = createApprovedTicketPublicationStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });

	assert.equal(ref.schema, "approved-ticket-publication");
	assert.deepEqual(await restarted.read("definition-1"), input);
	assert.deepEqual(await restarted.save(input), ref);
});

test("approved ticket publication fails closed for altered Owner binding and conflicting create-only snapshots", async () => {
	const backend = store();
	const ticketGraph = graph();
	const approval = createTicketGraphApproval({ graph: ticketGraph, actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" } });
	const publication = createApprovedTicketPublicationStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });
	const input = {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "spec-1" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: ticketGraph.digest },
		graphParent: ticketGraph.payload.parent,
		approval,
	};
	await publication.save(input);
	await assert.rejects(() => publication.save({ ...input, approval: { ...approval, payload: { ...approval.payload, actor: { ...approval.payload.actor, actorId: "owner-2" } } } }), /invalid|conflict/i);
});

test("approved ticket publication rejects canonically re-digested non-Owner approvals", async () => {
	const bytes = new Map();
	const backend = store(bytes);
	const ticketGraph = graph();
	const approval = createTicketGraphApproval({ graph: ticketGraph, actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" } });
	const input = {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "spec-1" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: ticketGraph.digest },
		graphParent: ticketGraph.payload.parent,
		approval: reDigestApproval(approval, { ...approval.payload, actor: { ...approval.payload.actor, role: "Developer" } }),
	};
	const publication = createApprovedTicketPublicationStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });

	await assert.rejects(() => publication.save(input), /invalid or corrupt/i);
	saveDurablePublication(bytes, input);
	await assert.rejects(() => publication.read("definition-1"), /invalid or corrupt/i);
});

test("approved ticket publication rejects canonically re-digested approval with a mismatched graph parent identity and revision", async () => {
	const bytes = new Map();
	const backend = store(bytes);
	const ticketGraph = graph();
	const approval = createTicketGraphApproval({ graph: ticketGraph, actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" } });
	const input = {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "spec-1" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: ticketGraph.digest },
		graphParent: ticketGraph.payload.parent,
		approval: reDigestApproval(approval, { ...approval.payload, parent: { id: "parent-2", teamId: "team-2", revision: "forged-r2", specDigest: "forged-spec-2" } }),
	};
	const publication = createApprovedTicketPublicationStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });

	await assert.rejects(() => publication.save(input), /invalid or corrupt/i);
	saveDurablePublication(bytes, input);
	await assert.rejects(() => publication.read("definition-1"), /invalid or corrupt/i);
});

test("approved ticket publication rejects canonically re-digested approved Spec digest drift", async () => {
	const bytes = new Map();
	const backend = store(bytes);
	const ticketGraph = graph();
	const approval = createTicketGraphApproval({ graph: ticketGraph, actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" } });
	const input = {
		definitionId: "definition-1",
		approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: "forged-spec-2" },
		parentRef: { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" },
		graphRef: { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: ticketGraph.digest },
		graphParent: ticketGraph.payload.parent,
		approval,
	};
	const publication = createApprovedTicketPublicationStore({ store: backend, project: "pi-workflow", topic: "workflow/tickets" });

	await assert.rejects(() => publication.save(input), /invalid or corrupt/i);
	saveDurablePublication(bytes, input);
	await assert.rejects(() => publication.read("definition-1"), /invalid or corrupt/i);
});
