import assert from "node:assert/strict";
import test from "node:test";

import { publishApprovedTickets } from "../extensions/delivery-ticket-publication.ts";
import { createTicketPublicationManifestStore } from "../extensions/ticket-publication-manifest.ts";

const parent = { id: "ILA-2296", teamId: "team-ilao", revision: "parent-r1" };
const graph = {
	digest: "a".repeat(64),
	payload: {
		parent: { ...parent, specDigest: "spec-digest" },
		tickets: [{ stableKey: "TICKET-1", title: "Crear tickets", outcome: "El Owner revisa el ticket publicado.", acceptanceCriteria: ["El cuerpo conserva este criterio aprobado."], estimate: { points: 3 }, blockers: [] }],
	},
};

function memory() {
	let current;
	return {
		value: () => current?.value,
		read: async () => current,
		create: async (value) => (current = { revision: "r1", value }),
		compareAndSwap: async (revision, value) => {
			assert.equal(revision, current.revision);
			current = { revision: "r2", value };
			return current;
		},
	};
}

test("publishes one child with its exact approved Spanish body", async () => {
	const created = [];
	const result = await publishApprovedTickets({
		definitionId: "definition-1",
		graph,
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			createChild: async ({ child }) => {
				created.push(child);
				return { stableKey: child.stableKey, linearId: "child-1" };
			},
			createBlocker: async () => {},
			readBack: async () => ({ parent, children: [], blockers: [] }),
		},
	});

	assert.deepEqual(created, [{
		stableKey: "TICKET-1",
		title: "Crear tickets",
		body: "Resultado\n\nEl Owner revisa el ticket publicado.\n\nCriterios de aceptación\n\n- El cuerpo conserva este criterio aprobado.",
		estimate: 3,
		workflow: { state: "Triage", assignee: null, cycle: null, labels: [], project: null },
	}]);
	assert.equal(result.status, "blocked");
});

test("creates dependent children in topological order", async () => {
	const order = [];
	await publishApprovedTickets({
		definitionId: "definition-2",
		graph: {
			digest: "b".repeat(64),
			payload: {
				parent: { ...parent, specDigest: "spec-digest" },
				tickets: [
					{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
					{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
				],
			},
		},
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			createChild: async ({ child }) => {
				order.push(child.stableKey);
				return { stableKey: child.stableKey, linearId: `child-${order.length}` };
			},
			createBlocker: async () => {},
			readBack: async () => ({ parent, children: [], blockers: [] }),
		},
	});

	assert.deepEqual(order, ["TICKET-1", "TICKET-2"]);
});

test("creates each native blocker after its children", async () => {
	const blockers = [];
	await publishApprovedTickets({
		definitionId: "definition-3",
		graph: {
			digest: "c".repeat(64),
			payload: {
				parent: { ...parent, specDigest: "spec-digest" },
				tickets: [
					{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
					{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
				],
			},
		},
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			createChild: async ({ child }) => ({ stableKey: child.stableKey, linearId: `child-${child.stableKey}` }),
			createBlocker: async (relation) => blockers.push(relation),
			readBack: async () => ({ parent, children: [], blockers: [] }),
		},
	});

	assert.deepEqual(blockers.map(({ blockedStableKey, blockingStableKey }) => ({ blockedStableKey, blockingStableKey })), [
		{ blockedStableKey: "TICKET-2", blockingStableKey: "TICKET-1" },
	]);
});

test("verifies the exact published graph before returning success", async () => {
	const persistence = memory();
	const children = [];
	const blockers = [];
	const result = await publishApprovedTickets({
		definitionId: "definition-4",
		graph,
		manifest: createTicketPublicationManifestStore({ persistence }),
		gateway: {
			createChild: async ({ child }) => {
				const created = { ...child, linearId: `child-${children.length + 1}` };
				children.push(created);
				return { stableKey: created.stableKey, linearId: created.linearId };
			},
			createBlocker: async (relation) => blockers.push({ blockedStableKey: relation.blockedStableKey, blockingStableKey: relation.blockingStableKey }),
			readBack: async () => ({ parent, children: children.map((child) => ({ ...child, blockedBy: [], blocks: [] })) }),
		},
	});

	assert.deepEqual(result, { status: "tickets-published" });
	assert.deepEqual(children, [{
		stableKey: "TICKET-1",
		title: "Crear tickets",
		body: "Resultado\n\nEl Owner revisa el ticket publicado.\n\nCriterios de aceptación\n\n- El cuerpo conserva este criterio aprobado.",
		estimate: 3,
		workflow: { state: "Triage", assignee: null, cycle: null, labels: [], project: null },
		linearId: "child-1",
	}]);
	assert.equal("ready-for-agent" in children[0], false);
	assert.deepEqual(blockers, []);
	assert.deepEqual(persistence.value(), {
		definitionId: "definition-4",
		graphDigest: "a".repeat(64),
		parent: { id: "ILA-2296", revision: "parent-r1" },
		schemaVersion: 1,
		operationId: persistence.value().operationId,
		stage: "verified",
		children: [{ stableKey: "TICKET-1", linearId: "child-1" }],
		relations: [],
		verification: { graphDigest: "a".repeat(64), parentId: "ILA-2296" },
	});
});

test("verifies both native blocker directions in the published graph", async () => {
	const children = [];
	const blockers = [];
	const dependencyGraph = {
		digest: "d".repeat(64),
		payload: {
			parent: { ...parent, specDigest: "spec-digest" },
			tickets: [
				{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
				{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
			],
		},
	};
	const result = await publishApprovedTickets({
		definitionId: "definition-5",
		graph: dependencyGraph,
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			createChild: async ({ child }) => {
				const created = { ...child, linearId: `child-${children.length + 1}` };
				children.push(created);
				return { stableKey: created.stableKey, linearId: created.linearId };
			},
			createBlocker: async ({ blockedStableKey, blockingStableKey }) => blockers.push({ blockedStableKey, blockingStableKey }),
			readBack: async () => ({ parent, children: children.map((child) => ({ ...child, blockedBy: blockers.filter((blocker) => blocker.blockedStableKey === child.stableKey).map((blocker) => blocker.blockingStableKey), blocks: blockers.filter((blocker) => blocker.blockingStableKey === child.stableKey).map((blocker) => blocker.blockedStableKey) })) }),
		},
	});

	assert.deepEqual(result, { status: "tickets-published" });
	assert.deepEqual(blockers, [{ blockedStableKey: "TICKET-2", blockingStableKey: "TICKET-1" }]);
	assert.deepEqual(children.map((child) => ({ stableKey: child.stableKey, blockedBy: child.stableKey === "TICKET-2" ? ["TICKET-1"] : [], blocks: child.stableKey === "TICKET-1" ? ["TICKET-2"] : [] })), [
		{ stableKey: "TICKET-1", blockedBy: [], blocks: ["TICKET-2"] },
		{ stableKey: "TICKET-2", blockedBy: ["TICKET-1"], blocks: [] },
	]);
});

test("blocks when the blocked child has blockedBy but the blocking child lacks reciprocal blocks", async () => {
	const persistence = memory();
	const children = [];
	const blockers = [];
	const result = await publishApprovedTickets({
		definitionId: "definition-7",
		graph: {
			digest: "e".repeat(64),
			payload: {
				parent: { ...parent, specDigest: "spec-digest" },
				tickets: [
					{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
					{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
				],
			},
		},
		manifest: createTicketPublicationManifestStore({ persistence }),
		gateway: {
			createChild: async ({ child }) => {
				const created = { ...child, linearId: `child-${children.length + 1}` };
				children.push(created);
				return { stableKey: created.stableKey, linearId: created.linearId };
			},
			createBlocker: async ({ blockedStableKey, blockingStableKey }) => blockers.push({ blockedStableKey, blockingStableKey }),
			readBack: async () => ({
				parent,
				children: children.map((child) => ({
					...child,
					blockedBy: blockers.filter((blocker) => blocker.blockedStableKey === child.stableKey).map((blocker) => blocker.blockingStableKey),
					...(child.stableKey === "TICKET-1" ? {} : { blocks: blockers.filter((blocker) => blocker.blockingStableKey === child.stableKey).map((blocker) => blocker.blockedStableKey) }),
				})),
			}),
		},
	});

	assert.deepEqual(result, {
		status: "blocked",
		blocker: { code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", message: "Ticket publication read-back mismatch." },
	});
	assert.equal(persistence.value().stage, "verifying");
});

test("blocks deterministically when nominal read-back changes an approved field", async () => {
	const persistence = memory();
	const result = await publishApprovedTickets({
		definitionId: "definition-6",
		graph,
		manifest: createTicketPublicationManifestStore({ persistence }),
		gateway: {
			createChild: async ({ child }) => ({ stableKey: child.stableKey, linearId: "child-1" }),
			createBlocker: async () => {},
			readBack: async () => ({ parent, children: [{ stableKey: "TICKET-1", title: "Crear tickets", body: "Cuerpo alterado", estimate: 3, workflow: { state: "Triage", assignee: null, cycle: null, labels: [], project: null }, linearId: "child-1", blockedBy: [], blocks: [] }] }),
		},
	});

	assert.deepEqual(result, {
		status: "blocked",
		blocker: { code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", message: "Ticket publication read-back mismatch." },
	});
	assert.equal(persistence.value().stage, "verifying");
});
