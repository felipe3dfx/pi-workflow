import assert from "node:assert/strict";
import test from "node:test";

import { createDefineProductWorkflow } from "../extensions/define-product-workflow.ts";
import {
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
} from "../extensions/product-spec.ts";
import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
	createTicketGraphApproval,
} from "../extensions/delivery-ticket-graph.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

function approvedSpec() {
	const spec = createProductSpecEnvelope({
		definitionId: "definition-1",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Canonical delivery",
		},
		revision: "spec-r1",
		problem:
			"El equipo puede publicar una definición distinta de la que revisó el Owner.",
		solution:
			"El flujo conserva y publica el Spec español exacto aprobado por el Owner.",
		userStories: [
			"Como Owner, quiero aprobar el cuerpo exacto antes de publicarlo.",
			"Como Developer, quiero recibir una definición estable y verificable.",
		],
		decisions: [{
			id: "canonical-parent",
			status: "resolved",
			pertinent: true,
			text: "La descripción del Delivery parent conserva el Spec canónico.",
		}],
		tests: ["Verificar que la descripción publicada coincide con el Spec aprobado."],
		outOfScope: ["Crear los Delivery tickets derivados."],
		supportArtifacts: [],
	});
	const approval = createProductSpecApprovalEnvelope({
		spec,
		actor: {
			actorId: "owner-1",
			role: "Owner",
			authorityRevision: "authority-r1",
		},
	});
	return { spec, approval, sourceRevision: "engram-r1" };
}

function workflow(overrides = {}) {
	return createDefineProductWorkflow({
		delegate: { delegate: async () => { throw new Error("not used"); } },
		createRequestId: () => "request-1",
		project: { name: "pi-workflow", root: "/repo" },
		...overrides,
	});
}

async function approveTicketsWithSaveResult(save) {
	const approved = approvedSpec();
	const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: approved.spec.digest };
	const approvedSpecRef = { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: approved.spec.digest };
	const parentRef = { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" };
	const graph = createDeliveryTicketGraph({ parent, coverage: createSpecCoverageIndex({ stories: [{ id: "story-1", contextId: "context-1", acceptanceCriteria: ["ac-1"] }], decisions: ["decision-1"], tests: ["test-1"] }), language: "es", tickets: [{ stableKey: "TICKET-1", title: "Entregar resultado", outcome: "Resultado verificable", acceptanceCriteria: ["Criterio uno", "Criterio dos", "Criterio tres", "Criterio cuatro"], estimate: { points: 1, rationale: "Trabajo acotado" }, blockers: [], refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }], deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "context-1" }] }] });
	const graphRef = { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
	let pending;
	let clears = 0;
	const subject = workflow({
		delegate: { delegate: async () => ({ status: "completed", executiveSummary: "ready", artifacts: [graphRef], nextRecommended: { kind: "confirmed-route", route: "wayfinder" }, risks: [], launchProvenance: {} }) },
		approvedSpecStore: { read: async () => ({ ...approved, sourceRevision: approvedSpecRef.revision }) },
		readPublishedParent: async () => parent,
		recoverTicketGraph: async () => graph,
		approvedTicketGraphs: { save: async () => graphRef },
		approvedTicketPublication: { save, read: async () => undefined },
		ticketApprovalRecoveryStore: { load: async () => pending, save: async (value) => { pending = structuredClone(value); }, clear: async () => { clears += 1; pending = undefined; } },
		authenticatedAuthority: { current: async () => approved.approval.payload.actor },
	});
	assert.equal((await subject.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef })).status, "tickets-ready");
	return { outcome: await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest }), cleared: clears, pending };
}

test("ticket approval retains recovery when durable approval persistence returns no artifact reference", async () => {
	const result = await approveTicketsWithSaveResult(async () => undefined);
	assert.equal(result.outcome.status, "blocked");
	assert.equal(result.outcome.blocker.code, "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH");
	assert.equal(result.cleared, 0);
	assert.equal(result.pending.definitionId, "definition-1");
});

test("ticket approval retains recovery when durable approval persistence returns a mismatched artifact reference", async () => {
	const result = await approveTicketsWithSaveResult(async () => ({ kind: "engram", project: "pi-workflow", topic: "wrong-publication", revision: "publication-r1", schema: "approved-ticket-publication", schemaVersion: 1, digest: "wrong-digest" }));
	assert.equal(result.outcome.status, "blocked");
	assert.equal(result.outcome.blocker.code, "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH");
	assert.equal(result.cleared, 0);
	assert.equal(result.pending.definitionId, "definition-1");
});

test("approval is persisted and remains recoverable for publication after restart", async () => {
	const approved = approvedSpec();
	let pending = { definitionId: "definition-1", spec: approved.spec };
	let persisted;
	const recovery = {
		load: async () => structuredClone(pending),
		save: async (value) => { pending = structuredClone(value); },
		clear: async () => { pending = undefined; },
	};
	const approvedSpecStore = {
			read: async () => structuredClone(persisted),
			save: async (_id, value) => {
				persisted = { ...structuredClone(value), sourceRevision: "engram-r1" };
				return structuredClone(persisted);
			},
	};
	const first = workflow({
		specApprovalRecoveryStore: recovery,
		authenticatedAuthority: { current: async () => approved.approval.payload.actor },
		approvedSpecStore,
	});
	await first.restoreRecovery();
	const outcome = await first.advance({
		kind: "approve-spec",
		target: approved.spec.payload.target,
		revision: approved.spec.payload.revision,
		digest: approved.spec.digest,
	});

	assert.equal(outcome.status, "spec-approved");
	assert.equal(pending.spec.digest, approved.spec.digest);
	assert.equal(persisted.approval.digest, approved.approval.digest);
	const replacement = workflow({
		specApprovalRecoveryStore: recovery,
		approvedSpecStore,
	});
	assert.deepEqual(await replacement.restoreRecovery(), {
		definitionId: "definition-1",
		phase: "publication",
	});
});

test("publication clears pending approval only after verified success", async () => {
	let clears = 0;
	const recovery = {
		load: async () => undefined,
		save: async () => {},
		clear: async () => { clears += 1; },
	};
	const blocked = workflow({ specApprovalRecoveryStore: recovery });
	assert.equal((await blocked.advance({
		kind: "publish-spec",
		definitionId: "definition-1",
	})).status, "blocked");
	assert.equal(clears, 0);

	const approved = approvedSpec();
	const publicationKey = digestCanonicalValue({
		schema: "delivery-parent-publication",
		definitionId: "definition-1",
		specDigest: approved.spec.digest,
		target: approved.spec.payload.target,
	});
	const parent = {
		id: "parent-1",
		teamId: "team-1",
		title: approved.spec.payload.target.title,
		description: approved.spec.payload.body,
		descriptionRevision: "spec-r1",
		state: "Backlog",
		cycleId: null,
		assigneeId: null,
		publicationKey,
	};
	const published = workflow({
		specApprovalRecoveryStore: {
			...recovery,
		},
		publication: {
			approvedSpecReader: { read: async () => structuredClone(approved) },
			parentSnapshots: {
				persist: async () => ({
					kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/published-parent", revision: "artifact-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest",
				}),
			},
			authenticatedAuthority: {
				current: async () => approved.approval.payload.actor,
			},
			state: {
				prepare: async () => ({
					status: "verified",
					parentId: "parent-1",
				}),
			},
			linear: { read: async () => structuredClone(parent) },
		},
	});
	const outcome = await published.advance({
		kind: "publish-spec",
		definitionId: "definition-1",
	});
	assert.equal(outcome.status, "spec-published");
	assert.equal(clears, 1);
});

test("to-tickets and approval bind only exact verified references and recover compatible state", async () => {
	const approved = approvedSpec();
	const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: approved.spec.digest };
	const approvedSpecRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-spec", revision: "engram-r1", schema: "approved-spec", schemaVersion: 1, digest: approved.spec.digest };
	const parentRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/published-parent", revision: "parent-artifact-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-snapshot-digest" };
	const graph = createDeliveryTicketGraph({
		parent,
		coverage: createSpecCoverageIndex({ stories: [{ id: "story-1", contextId: "context-1", acceptanceCriteria: ["ac-1"] }], decisions: ["decision-1"], tests: ["test-1"] }),
		language: "es",
		tickets: [{ stableKey: "TICKET-1", title: "Entregar resultado", outcome: "Resultado verificable", acceptanceCriteria: ["Criterio uno", "Criterio dos", "Criterio tres", "Criterio cuatro"], estimate: { points: 1, rationale: "Trabajo acotado" }, blockers: [], refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }], deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "context-1" }] }],
	});
	const graphRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/to-tickets/request-1", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
	let calls = 0;
	let recovered;
	const saved = [];
	const state = { load: async () => recovered, save: async (value) => { recovered = structuredClone(value); }, clear: async () => { recovered = undefined; } };
	const subject = workflow({
		delegate: { delegate: async () => { calls += 1; return { status: "completed", executiveSummary: "ready", artifacts: [graphRef], nextRecommended: { kind: "confirmed-route", route: "wayfinder" }, risks: [], launchProvenance: {} }; } },
		approvedSpecStore: { read: async () => ({ ...approved, sourceRevision: approvedSpecRef.revision }) },
		readPublishedParent: async (ref) => ref === parentRef ? parent : undefined,
		recoverTicketGraph: async (ref) => ref === graphRef ? graph : undefined,
		approvedTicketGraphs: { save: async (_definitionId, value) => { saved.push(value); return graphRef; } },
		approvedTicketPublication: { save: async (value) => ({ kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-ticket-publication/definition-1", revision: "publication-r1", schema: "approved-ticket-publication", schemaVersion: 1, digest: digestCanonicalValue({ schema: "approved-ticket-publication", schemaVersion: 1, payload: value }) }), read: async () => undefined },
		ticketApprovalRecoveryStore: state,
		authenticatedAuthority: { current: async () => approved.approval.payload.actor },
	});
	for (const command of [
		{ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef: { ...approvedSpecRef, digest: "stale" }, parentRef },
		{ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef: { ...parentRef, revision: "stale" } },
	]) assert.equal((await subject.advance(command)).status, "blocked");
	const ready = await subject.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef });
	assert.equal(ready.status, "tickets-ready", ready.blocker?.message);
	assert.equal(calls, 1);
	assert.equal(saved[0].digest, graph.digest);
	const approvedOutcome = await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest });
	assert.equal(approvedOutcome.status, "tickets-approved");
	assert.equal(approvedOutcome.approval.payload.graphDigest, graph.digest);
	assert.equal(recovered.definitionId, "definition-1");
});

test("ticket approval fails closed for stale inputs, delegation and recovery drift", async () => {
	const approved = approvedSpec();
	const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: approved.spec.digest };
	const approvedSpecRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-spec", revision: "engram-r1", schema: "approved-spec", schemaVersion: 1, digest: approved.spec.digest };
	const parentRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/published-parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" };
	const graph = createDeliveryTicketGraph({
		parent,
		coverage: createSpecCoverageIndex({ stories: [{ id: "story-1", contextId: "context-1", acceptanceCriteria: ["ac-1"] }], decisions: ["decision-1"], tests: ["test-1"] }),
		language: "es",
		tickets: [{ stableKey: "TICKET-1", title: "Entregar resultado", outcome: "Resultado verificable", acceptanceCriteria: ["Criterio uno", "Criterio dos", "Criterio tres", "Criterio cuatro"], estimate: { points: 1, rationale: "Trabajo acotado" }, blockers: [], refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }], deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "context-1" }] }],
	});
	const graphRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-ticket-graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
	const recoveryState = {
		definitionId: "definition-1", approvedSpecRef, parentRef, graphRef, digest: graph.digest,
		authority: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" },
	};
	let recovered = structuredClone(recoveryState);
	let clears = 0;
	let actor = recoveryState.authority;
	let sourceRevision = approvedSpecRef.revision;
	const subject = workflow({
		delegate: { delegate: async () => ({ status: "blocked", blocker: { code: "PI_WORKFLOW_DELEGATION_INTERRUPTED", message: "interrupted" }, artifacts: [], nextRecommended: { kind: "owner-action" }, risks: [] }) },
		approvedSpecStore: { read: async () => ({ ...approved, sourceRevision }) },
		readPublishedParent: async (ref) => ref.revision === parentRef.revision ? parent : undefined,
		recoverTicketGraph: async (ref) => ref.digest === graph.digest ? graph : undefined,
		approvedTicketGraphs: { save: async () => graphRef },
		approvedTicketPublication: { save: async (value) => ({ kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-ticket-publication/definition-1", revision: "publication-r1", schema: "approved-ticket-publication", schemaVersion: 1, digest: digestCanonicalValue({ schema: "approved-ticket-publication", schemaVersion: 1, payload: value }) }), read: async () => undefined },
		ticketApprovalRecoveryStore: { load: async () => structuredClone(recovered), save: async (value) => { recovered = structuredClone(value); }, clear: async () => { clears += 1; recovered = undefined; } },
		authenticatedAuthority: { current: async () => actor },
	});

	for (const command of [
		{ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef: { ...approvedSpecRef, revision: "missing" }, parentRef },
		{ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef: { ...parentRef, digest: "stale" } },
		{ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef: { ...approvedSpecRef, project: "other" }, parentRef },
	]) {
		const outcome = await subject.advance(command);
		assert.equal(outcome.status, "blocked");
	}
	assert.equal((await subject.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef })).blocker.code, "PI_WORKFLOW_DELEGATION_INTERRUPTED");
	const persistenceMismatch = workflow({
		delegate: { delegate: async () => ({ status: "completed", executiveSummary: "ready", artifacts: [graphRef], nextRecommended: { kind: "confirmed-route", route: "wayfinder" }, risks: [], launchProvenance: {} }) },
		approvedSpecStore: { read: async () => ({ ...approved, sourceRevision: approvedSpecRef.revision }) },
		readPublishedParent: async () => parent,
		recoverTicketGraph: async () => graph,
		approvedTicketGraphs: { save: async () => ({ ...graphRef, digest: "wrong-digest" }) },
		authenticatedAuthority: { current: async () => recoveryState.authority },
	});
	const persistenceOutcome = await persistenceMismatch.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef });
	assert.equal(persistenceOutcome.status, "blocked");
	assert.equal(persistenceOutcome.blocker.code, "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH");

	assert.deepEqual(await subject.restoreRecovery(), { definitionId: "definition-1", phase: "ticket-approval" });
	for (const mismatch of [
		{ graphRef: { ...graphRef, digest: "changed" } },
		{ parentRef: { ...parentRef, revision: "changed" } },
		{ digest: "changed" },
	]) {
		const outcome = await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest, ...mismatch });
		assert.equal(outcome.status, "blocked");
	}
	actor = { actorId: "developer-1", role: "Developer", authorityRevision: "authority-r1" };
	assert.equal((await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest })).status, "blocked");
	actor = { ...recoveryState.authority, authorityRevision: "authority-r2" };
	assert.equal((await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest })).status, "blocked");
	sourceRevision = "stale-spec";
	assert.equal((await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest })).status, "blocked");
	sourceRevision = approvedSpecRef.revision;

	recovered = { ...recoveryState, parentRef: { ...parentRef, project: "other" } };
	assert.equal(await subject.restoreRecovery(), undefined);
	assert.equal(clears, 0);

	recovered = structuredClone(recoveryState);
	actor = recoveryState.authority;
	assert.deepEqual(await subject.restoreRecovery(), { definitionId: "definition-1", phase: "ticket-approval" });
	const approvedOutcome = await subject.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest });
	assert.equal(approvedOutcome.status, "tickets-approved");
	assert.equal(clears, 0);
});

test("to-tickets recovers an exact persisted graph after approval recovery persistence fails", async () => {
	const approved = approvedSpec();
	const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: approved.spec.digest };
	const approvedSpecRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-spec", revision: "engram-r1", schema: "approved-spec", schemaVersion: 1, digest: approved.spec.digest };
	const parentRef = { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/published-parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" };
	const graph = createDeliveryTicketGraph({
		parent,
		coverage: createSpecCoverageIndex({ stories: [{ id: "story-1", contextId: "context-1", acceptanceCriteria: ["ac-1"] }], decisions: ["decision-1"], tests: ["test-1"] }),
		language: "es",
		tickets: [{ stableKey: "TICKET-1", title: "Entregar resultado", outcome: "Resultado verificable", acceptanceCriteria: ["Criterio uno", "Criterio dos", "Criterio tres", "Criterio cuatro"], estimate: { points: 1, rationale: "Trabajo acotado" }, blockers: [], refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }], deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "context-1" }] }],
	});
	const graphRef = { kind: "engram", project: "pi-workflow", topic: `workflow/define-product/definition-1/approved-ticket-graph/${graph.digest}`, revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
	let recoverySaves = 0;
	let persisted;
	const subject = workflow({
		delegate: { delegate: async () => ({ status: "completed", executiveSummary: "ready", artifacts: [graphRef], nextRecommended: { kind: "confirmed-route", route: "wayfinder" }, risks: [], launchProvenance: {} }) },
		approvedSpecStore: { read: async () => ({ ...approved, sourceRevision: approvedSpecRef.revision }) },
		readPublishedParent: async () => parent,
		recoverTicketGraph: async (ref) => ref.digest === graph.digest ? graph : undefined,
		approvedTicketGraphs: { save: async () => graphRef },
		ticketApprovalRecoveryStore: {
			load: async () => persisted,
			save: async (state) => {
				recoverySaves += 1;
				if (recoverySaves === 1) throw new Error("interrupted after graph persistence");
				persisted = structuredClone(state);
			},
			clear: async () => { persisted = undefined; },
		},
		authenticatedAuthority: { current: async () => approved.approval.payload.actor },
	});

	const first = await subject.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef });
	assert.equal(first.status, "blocked");
	assert.equal(first.blocker.code, "PI_WORKFLOW_RECOVERY_FAILED");
	const retry = await subject.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef });
	assert.equal(retry.status, "tickets-ready", retry.blocker?.message);
	assert.deepEqual(retry.graphRef, graphRef);
	assert.equal(persisted.digest, graph.digest);
});

test("publish-tickets reads the exact durable Owner-approved graph after restart without delegating publication", async () => {
	const approved = approvedSpec();
	const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: approved.spec.digest };
	const approvedSpecRef = { kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "approved-spec", schemaVersion: 1, digest: approved.spec.digest };
	const parentRef = { kind: "engram", project: "pi-workflow", topic: "parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: "parent-digest" };
	const graph = createDeliveryTicketGraph({ parent, coverage: createSpecCoverageIndex({ stories: [{ id: "story-1", contextId: "context-1", acceptanceCriteria: ["ac-1"] }], decisions: ["decision-1"], tests: ["test-1"] }), language: "es", tickets: [{ stableKey: "TICKET-1", title: "Entregar resultado", outcome: "Resultado verificable", acceptanceCriteria: ["Criterio uno", "Criterio dos", "Criterio tres", "Criterio cuatro"], estimate: { points: 1, rationale: "Trabajo acotado" }, blockers: [], refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }], deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "context-1" }] }] });
	const graphRef = { kind: "engram", project: "pi-workflow", topic: "graph", revision: "graph-r1", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
	const approval = createTicketGraphApproval({ graph, actor: approved.approval.payload.actor });
	let publication;
	let delegateCalls = 0;
	const dependencies = {
		delegate: { delegate: async () => {
			delegateCalls += 1;
			return { status: "completed", executiveSummary: "ready", artifacts: [graphRef], nextRecommended: { kind: "confirmed-route", route: "wayfinder" }, risks: [], launchProvenance: {} };
		} },
		approvedSpecStore: { read: async () => ({ ...approved, sourceRevision: approvedSpecRef.revision }) },
		readPublishedParent: async () => parent,
		recoverTicketGraph: async () => graph,
		ticketApprovalRecoveryStore: { load: async () => undefined, save: async () => {}, clear: async () => {} },
		authenticatedAuthority: { current: async () => approved.approval.payload.actor },
		approvedTicketPublication: {
			save: async (value) => {
				publication = structuredClone(value);
				return { kind: "engram", project: "pi-workflow", topic: "workflow/define-product/definition-1/approved-ticket-publication/definition-1", revision: "publication-r1", schema: "approved-ticket-publication", schemaVersion: 1, digest: digestCanonicalValue({ schema: "approved-ticket-publication", schemaVersion: 1, payload: value }) };
			},
			read: async () => structuredClone(publication),
		},
		ticketPublication: { publish: async (definitionId) => ({ status: "tickets-published", definitionId }) },
	};
	const pending = workflow({
		...dependencies,
		approvedTicketGraphs: { save: async () => graphRef },
	});
	assert.equal((await pending.advance({ kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef })).status, "tickets-ready");
	assert.equal((await pending.advance({ kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: graph.digest })).status, "tickets-approved");
	assert.deepEqual(publication.approval, approval);

	const restarted = workflow(dependencies);
	assert.deepEqual(await restarted.advance({ kind: "publish-tickets", definitionId: "definition-1" }), { status: "tickets-published", definitionId: "definition-1" });
	assert.equal(delegateCalls, 1);
});
