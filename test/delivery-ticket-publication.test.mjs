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
const guard = { revalidate: async () => {} };
const recoveryLookups = { findChildren: async () => [], findBlockers: async () => [] };

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
		guard,
		graph,
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			...recoveryLookups,
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
		guard,
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
			...recoveryLookups,
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
		guard,
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
			...recoveryLookups,
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
		guard,
		graph,
		manifest: createTicketPublicationManifestStore({ persistence }),
		gateway: {
			...recoveryLookups,
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
		guard,
		graph: dependencyGraph,
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			...recoveryLookups,
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
		guard,
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
			...recoveryLookups,
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
		guard,
		graph,
		manifest: createTicketPublicationManifestStore({ persistence }),
		gateway: {
			...recoveryLookups,
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

test("resumes a partially created graph without repeating a recorded child mutation", async () => {
	const persistence = memory();
	const created = new Map();
	const calls = [];
	let failSecond = true;
	const dependencyGraph = {
		digest: "f".repeat(64),
		payload: { parent: { ...parent, specDigest: "spec-digest" }, tickets: [
			{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
			{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: [] },
		] },
	};
	const gateway = {
		...recoveryLookups,
		createChild: async ({ child }) => {
			calls.push(child.stableKey);
			if (child.stableKey === "TICKET-2" && failSecond) {
				failSecond = false;
				throw new Error("interrupted");
			}
			const value = created.get(child.stableKey) ?? { ...child, linearId: `child-${created.size + 1}` };
			created.set(child.stableKey, value);
			return { stableKey: value.stableKey, linearId: value.linearId };
		},
		createBlocker: async () => {},
		readBack: async () => ({ parent, children: [...created.values()].map((child) => ({ ...child, blockedBy: [], blocks: [] })) }),
	};
	const dependencies = { definitionId: "definition-recovery", graph: dependencyGraph, manifest: createTicketPublicationManifestStore({ persistence }), guard, gateway };

	assert.equal((await publishApprovedTickets(dependencies)).status, "blocked");
	assert.deepEqual(await publishApprovedTickets(dependencies), { status: "tickets-published" });
	assert.deepEqual(calls, ["TICKET-1", "TICKET-2", "TICKET-2"]);
	assert.equal(persistence.value().stage, "verified");
});

test("blocks a non-exact child marker before a duplicate mutation", async () => {
	let mutations = 0;
	const result = await publishApprovedTickets({
		definitionId: "definition-malformed-marker",
		guard,
		graph,
		manifest: createTicketPublicationManifestStore({ persistence: memory() }),
		gateway: {
			findChildren: async () => [{ linearId: "child-unknown" }],
			findBlockers: async () => [],
			createChild: async () => { mutations += 1; return { stableKey: "TICKET-1", linearId: "child-1" }; },
			createBlocker: async () => { mutations += 1; },
			readBack: async () => ({ parent, children: [] }),
		},
	});

	assert.deepEqual(result, {
		status: "blocked",
		blocker: { code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT", message: "Publication marker is ambiguous." },
	});
	assert.equal(mutations, 0);
});

test("refuses cycles and missing references before durable or Linear mutation", async (t) => {
	for (const [name, tickets] of [
		["cycle", [
			{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: ["TICKET-2"] },
			{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
		]],
		["missing reference", [{ ...graph.payload.tickets[0], blockers: ["MISSING"] }]],
	]) {
		await t.test(name, async () => {
			let creates = 0;
			let swaps = 0;
			let mutations = 0;
			const result = await publishApprovedTickets({
				definitionId: `definition-${name}`,
				graph: { digest: "1".repeat(64), payload: { parent: { ...parent, specDigest: "spec-digest" }, tickets } },
				manifest: createTicketPublicationManifestStore({ persistence: {
					read: async () => undefined,
					create: async () => { creates += 1; throw new Error("durable create must not run"); },
					compareAndSwap: async () => { swaps += 1; throw new Error("durable compare-and-swap must not run"); },
				} }),
				guard,
				gateway: {
					...recoveryLookups,
					createChild: async () => { mutations += 1; return { stableKey: "TICKET-1", linearId: "child-1" }; },
					createBlocker: async () => { mutations += 1; },
					readBack: async () => ({ parent, children: [] }),
				},
			});

			assert.equal(result.blocker.code, "PI_WORKFLOW_TICKET_GRAPH_INVALID");
			assert.deepEqual({ creates, swaps, mutations }, { creates: 0, swaps: 0, mutations: 0 });
		});
	}
});

test("resumes a partially recorded blocker stage without repeating an edge mutation", async () => {
	const persistence = memory();
	const children = new Map();
	const blockers = [];
	let failSecond = true;
	const dependencyGraph = {
		digest: "2".repeat(64),
		payload: { parent: { ...parent, specDigest: "spec-digest" }, tickets: [
			{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
			{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
			{ ...graph.payload.tickets[0], stableKey: "TICKET-3", blockers: ["TICKET-1"] },
		] },
	};
	const gateway = {
		...recoveryLookups,
		createChild: async ({ child }) => {
			const value = children.get(child.stableKey) ?? { ...child, linearId: `child-${children.size + 1}` };
			children.set(child.stableKey, value);
			return { stableKey: value.stableKey, linearId: value.linearId };
		},
		createBlocker: async ({ blockedStableKey, blockingStableKey }) => {
			blockers.push(`${blockedStableKey}:${blockingStableKey}`);
			if (blockedStableKey === "TICKET-3" && failSecond) { failSecond = false; throw new Error("interrupted"); }
		},
		readBack: async () => ({ parent, children: [...children.values()].map((child) => ({ ...child, blockedBy: dependencyGraph.payload.tickets.find((ticket) => ticket.stableKey === child.stableKey).blockers, blocks: dependencyGraph.payload.tickets.filter((ticket) => ticket.blockers.includes(child.stableKey)).map((ticket) => ticket.stableKey) })) }),
	};
	const dependencies = { definitionId: "definition-relation-recovery", graph: dependencyGraph, manifest: createTicketPublicationManifestStore({ persistence }), guard, gateway };

	assert.equal((await publishApprovedTickets(dependencies)).status, "blocked");
	assert.deepEqual(await publishApprovedTickets(dependencies), { status: "tickets-published" });
	assert.deepEqual(blockers, ["TICKET-2:TICKET-1", "TICKET-3:TICKET-1", "TICKET-3:TICKET-1"]);
});

test("requires each recovery lookup capability before mutation", async (t) => {
	for (const missing of ["findChildren", "findBlockers"]) {
		await t.test(`missing ${missing}`, async () => {
			let mutations = 0;
			const result = await publishApprovedTickets({
				definitionId: `definition-missing-${missing}`,
				guard,
				graph,
				manifest: createTicketPublicationManifestStore({ persistence: memory() }),
				gateway: {
					...recoveryLookups,
					[missing]: undefined,
					createChild: async () => { mutations += 1; return { stableKey: "TICKET-1", linearId: "child-1" }; },
					createBlocker: async () => { mutations += 1; },
					readBack: async () => ({ parent, children: [] }),
				},
			});

			assert.deepEqual(result, {
				status: "blocked",
				blocker: { code: "PI_WORKFLOW_PUBLICATION_RECOVERY_LOOKUP_REQUIRED", message: "Publication recovery lookup capability is required." },
			});
			assert.equal(mutations, 0);
		});
	}
});

test("resolves a child marker after its external mutation succeeds but recording fails", async () => {
	const persistence = memory();
	const children = new Map();
	let creates = 0;
	let recordFails = true;
	const compareAndSwap = persistence.compareAndSwap;
	persistence.compareAndSwap = async (revision, value) => {
		if (recordFails && value.stage === "creating" && value.children.length === 1) {
			recordFails = false;
			throw new Error("manifest interrupted");
		}
		return compareAndSwap(revision, value);
	};
	const gateway = {
		findChildren: async ({ stableKey }) => [...children.values()].filter((child) => child.stableKey === stableKey),
		findBlockers: async () => [],
		createChild: async ({ child }) => {
			creates += 1;
			const value = { ...child, linearId: `child-${children.size + 1}` };
			children.set(child.stableKey, value);
			return { stableKey: value.stableKey, linearId: value.linearId };
		},
		createBlocker: async () => {},
		readBack: async () => ({ parent, children: [...children.values()].map((child) => ({ ...child, blockedBy: [], blocks: [] })) }),
	};
	const dependencies = { definitionId: "definition-child-crash-window", graph, manifest: createTicketPublicationManifestStore({ persistence }), guard, gateway };

	assert.equal((await publishApprovedTickets(dependencies)).status, "blocked");
	assert.deepEqual(await publishApprovedTickets(dependencies), { status: "tickets-published" });
	assert.deepEqual({ creates, children: children.size }, { creates: 1, children: 1 });
});

test("resolves a blocker marker after its external mutation succeeds but recording fails", async () => {
	const persistence = memory();
	const children = new Map();
	const blockers = [];
	let recordFails = true;
	const compareAndSwap = persistence.compareAndSwap;
	persistence.compareAndSwap = async (revision, value) => {
		if (recordFails && value.stage === "relations" && value.relations.length === 1) {
			recordFails = false;
			throw new Error("manifest interrupted");
		}
		return compareAndSwap(revision, value);
	};
	const dependencyGraph = { digest: "3".repeat(64), payload: { parent: { ...parent, specDigest: "spec-digest" }, tickets: [
		{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
		{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
	] } };
	const gateway = {
		findChildren: async ({ stableKey }) => [...children.values()].filter((child) => child.stableKey === stableKey),
		findBlockers: async (relation) => blockers.filter((blocker) => blocker.blockedStableKey === relation.blockedStableKey && blocker.blockingStableKey === relation.blockingStableKey),
		createChild: async ({ child }) => {
			const value = { ...child, linearId: `child-${children.size + 1}` };
			children.set(child.stableKey, value);
			return { stableKey: value.stableKey, linearId: value.linearId };
		},
		createBlocker: async (relation) => blockers.push({ blockedStableKey: relation.blockedStableKey, blockingStableKey: relation.blockingStableKey }),
		readBack: async () => ({ parent, children: [...children.values()].map((child) => ({ ...child, blockedBy: dependencyGraph.payload.tickets.find((ticket) => ticket.stableKey === child.stableKey).blockers, blocks: dependencyGraph.payload.tickets.filter((ticket) => ticket.blockers.includes(child.stableKey)).map((ticket) => ticket.stableKey) })) }),
	};
	const dependencies = { definitionId: "definition-blocker-crash-window", graph: dependencyGraph, manifest: createTicketPublicationManifestStore({ persistence }), guard, gateway };

	assert.equal((await publishApprovedTickets(dependencies)).status, "blocked");
	assert.deepEqual(await publishApprovedTickets(dependencies), { status: "tickets-published" });
	assert.deepEqual(blockers, [{ blockedStableKey: "TICKET-2", blockingStableKey: "TICKET-1" }]);
});

test("fails closed for ambiguous recovery markers before duplicate mutations", async (t) => {
	const conflict = async ({ childMatches = [], blockerMatches = [] }) => {
		const persistence = memory();
		let childMutations = 0;
		let blockerMutations = 0;
		const dependencyGraph = { digest: "4".repeat(64), payload: { parent: { ...parent, specDigest: "spec-digest" }, tickets: [
			{ ...graph.payload.tickets[0], stableKey: "TICKET-1", blockers: [] },
			{ ...graph.payload.tickets[0], stableKey: "TICKET-2", blockers: ["TICKET-1"] },
		] } };
		const result = await publishApprovedTickets({
			definitionId: "definition-marker-recovery-conflict", graph: dependencyGraph, guard,
			manifest: createTicketPublicationManifestStore({ persistence }),
			gateway: {
				findChildren: async () => childMatches,
				findBlockers: async () => blockerMatches,
				createChild: async ({ child }) => { childMutations += 1; return { stableKey: child.stableKey, linearId: `child-${childMutations}` }; },
				createBlocker: async () => { blockerMutations += 1; },
				readBack: async () => ({ parent, children: [] }),
			},
		});
		return { result, childMutations, blockerMutations, stage: persistence.value().stage };
	};
	const expected = { status: "blocked", blocker: { code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT", message: "Publication marker is ambiguous." } };

	await t.test("multiple child marker matches leave creating durable state", async () => {
		const actual = await conflict({ childMatches: [{ stableKey: "TICKET-1", linearId: "child-1" }, { stableKey: "TICKET-1", linearId: "child-2" }] });
		assert.deepEqual(actual, { result: expected, childMutations: 0, blockerMutations: 0, stage: "creating" });
	});
	await t.test("multiple blocker marker matches leave relations durable state", async () => {
		const actual = await conflict({ blockerMatches: [{ blockedStableKey: "TICKET-2", blockingStableKey: "TICKET-1" }, { blockedStableKey: "TICKET-2", blockingStableKey: "TICKET-1" }] });
		assert.deepEqual(actual, { result: expected, childMutations: 2, blockerMutations: 0, stage: "relations" });
	});
	await t.test("a non-exact blocker marker leaves relations durable state", async () => {
		const actual = await conflict({ blockerMatches: [{ blockedStableKey: "TICKET-1", blockingStableKey: "TICKET-2" }] });
		assert.deepEqual(actual, { result: expected, childMutations: 2, blockerMutations: 0, stage: "relations" });
	});
});
