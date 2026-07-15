import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
	createTicketGraphApproval,
	validateTicketGraphApproval,
} from "../extensions/delivery-ticket-graph.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const fixture = JSON.parse(
	await readFile(
		new URL("./fixtures/delivery-ticket-graph.golden.json", import.meta.url),
		"utf8",
	),
);

const actor = { actorId: "owner-1", role: "Owner", authorityRevision: "owner-revision-2" };
const graph = () =>
	createDeliveryTicketGraph({
		parent: fixture.parent,
		coverage: createSpecCoverageIndex(fixture.coverage),
		language: fixture.language,
		tickets: fixture.tickets,
	});

const canonicallyRedigestedInvalidGraph = (mutate) => {
	const value = structuredClone(graph());
	mutate(value.payload);
	value.digest = digestCanonicalValue({
		schema: value.schema,
		schemaVersion: value.schemaVersion,
		payload: value.payload,
	});
	return value;
};

const approvalFor = (value) => {
	const unsigned = {
		schema: "delivery-ticket-graph-approval",
		schemaVersion: 1,
		payload: { actor, parent: value.payload.parent, graphDigest: value.digest },
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
};

test("creates a canonical Spanish graph and binds Owner approval to its exact parent and digest", () => {
	const result = graph();
	assert.deepEqual(result.payload.tickets.map((ticket) => ticket.stableKey), ["TICKET-1", "TICKET-2"]);
	assert.equal(result.schema, "delivery-ticket-graph");
	assert.equal(result.payload.language, "es");
	assert.equal(result.digest, fixture.graphDigest);
	const approval = createTicketGraphApproval({ graph: result, actor });
	assert.equal(approval.digest, fixture.approvalDigest);
	assert.equal(validateTicketGraphApproval({ graph: result, approval, actor, parent: fixture.parent }).ok, true);
});

test("requires an exact top-level Spanish declaration regardless of ticket status", () => {
	for (const [name, language, ticketSpanish] of [
		["missing declaration", undefined, undefined],
		["non-Spanish declaration with ticket approval claim", "en", "approved"],
	]) {
		assert.throws(
			() => {
				const tickets = structuredClone(fixture.tickets);
				if (ticketSpanish) tickets[0].spanish = ticketSpanish;
				return createDeliveryTicketGraph({
					parent: fixture.parent,
					coverage: createSpecCoverageIndex(fixture.coverage),
					tickets,
					language,
				});
			},
			{ code: "PI_WORKFLOW_TICKET_LANGUAGE_INVALID" },
			name,
		);
	}
});

test("rejects every graph boundary independently through the public contract", () => {
	for (const [name, mutate, code] of [
		["empty graph", (value) => (value.tickets = []), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["three acceptance criteria", (value) => (value.tickets[0].acceptanceCriteria = value.tickets[0].acceptanceCriteria.slice(0, 3)), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["eight acceptance criteria", (value) => value.tickets[0].acceptanceCriteria.push("Criterio adicional", "Criterio adicional dos", "Criterio adicional tres", "Criterio adicional cuatro"), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["zero-point estimate", (value) => (value.tickets[0].estimate.points = 0), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["nine-point estimate", (value) => (value.tickets[0].estimate.points = 9), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["out-of-scope reference", (value) => (value.tickets[0].refs[0].id = "US-OUTSIDE"), "PI_WORKFLOW_TICKET_REFERENCE_INVALID"],
		["uncovered numbered story", (value) => value.coverage.stories.push({ id: "US-3", contextId: "delivery-context", acceptanceCriteria: ["US-3-AC-1"] }), "PI_WORKFLOW_TICKET_REFERENCE_INVALID"],
		["uncovered numbered decision", (value) => value.coverage.decisions.push("D-2"), "PI_WORKFLOW_TICKET_REFERENCE_INVALID"],
		["uncovered numbered test", (value) => value.coverage.tests.push("TEST-2"), "PI_WORKFLOW_TICKET_REFERENCE_INVALID"],
		["decision/test-only ticket", (value) => { value.tickets[0].refs = [{ kind: "decision", id: "D-1" }, { kind: "test", id: "TEST-1" }]; value.tickets[0].deliveryBindings = []; }, "PI_WORKFLOW_TICKET_NOT_VERTICAL"],
		["unknown delivery context", (value) => (value.tickets[0].deliveryBindings[0].contextId = "unknown-context"), "PI_WORKFLOW_TICKET_REFERENCE_INVALID"],
	]) {
		assert.throws(() => {
			const value = structuredClone(fixture);
			mutate(value);
			createDeliveryTicketGraph({ parent: value.parent, coverage: createSpecCoverageIndex(value.coverage), language: value.language, tickets: value.tickets });
		}, { code }, name);
	}
});

test("rejects invalid graph invariants and coverage through the public contract", () => {
	for (const [name, mutate, code] of [
		["duplicate keys", (value) => (value.tickets[0].stableKey = "TICKET-1"), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["missing blocker", (value) => (value.tickets[0].blockers = ["MISSING"]), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["cyclic blockers", (value) => { value.tickets[0].blockers = ["TICKET-1"]; value.tickets[1].blockers = ["TICKET-2"]; }, "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["uncovered Spec ref", (value) => value.tickets[0].refs.splice(1), "PI_WORKFLOW_TICKET_REFERENCE_INVALID"],
	]) {
		assert.throws(() => {
			const value = structuredClone(fixture);
			mutate(value);
			createDeliveryTicketGraph({ parent: value.parent, coverage: createSpecCoverageIndex(value.coverage), language: value.language, tickets: value.tickets });
		}, { code }, name);
	}
});

test("rejects unsafe, non-vertical, and multi-context tickets", () => {
	for (const [name, mutate, code] of [
		["unsafe Markdown", (value) => (value.tickets[0].title = "[enlace](https://ejemplo.test)"), "PI_WORKFLOW_TICKET_GRAPH_INVALID"],
		["module-only ticket", (value) => (value.tickets[0].deliveryBindings = []), "PI_WORKFLOW_TICKET_NOT_VERTICAL"],
		["multiple contexts", (value) => { value.coverage.stories[0].contextId = "other-context"; value.tickets[1].deliveryBindings[0].contextId = "other-context"; value.tickets[0].deliveryBindings.push({ storyId: "US-1", acceptanceCriterionId: "US-1-AC-1", contextId: "other-context" }); }, "PI_WORKFLOW_TICKET_CONTEXT_SPAN"],
	]) {
		assert.throws(() => {
			const value = structuredClone(fixture);
			mutate(value);
			createDeliveryTicketGraph({ parent: value.parent, coverage: createSpecCoverageIndex(value.coverage), language: value.language, tickets: value.tickets });
		}, { code }, name);
	}
});

test("rejects stale parent and every approval binding mismatch", () => {
	const result = graph();
	const approval = createTicketGraphApproval({ graph: result, actor });
	for (const [name, mutate] of [
		["stale parent", (value) => (value.parent.revision = "parent-revision-8")],
		["changed Owner revision", (value) => (value.actor.authorityRevision = "owner-revision-3")],
		["changed graph digest", (value) => (value.graph.digest = "other-digest")],
	]) {
		const value = structuredClone({ graph: result, approval, actor, parent: { ...fixture.parent } });
		mutate(value);
		assert.equal(validateTicketGraphApproval(value).blocker.code, name === "stale parent" ? "PI_WORKFLOW_TICKET_PARENT_STALE" : "PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", name);
	}
});

test("rejects approval creation for canonically redigested structurally invalid graphs", () => {
	for (const [name, mutate] of [
		["empty tickets", (payload) => (payload.tickets = [])],
		["unsafe ticket Markdown", (payload) => (payload.tickets[0].title = "[enlace](https://ejemplo.test)")],
		["uncovered coverage story", (payload) => payload.coverage.stories.push({ id: "US-3", contextId: "delivery-context", acceptanceCriteria: ["US-3-AC-1"] })],
	]) {
		assert.throws(
			() => createTicketGraphApproval({ graph: canonicallyRedigestedInvalidGraph(mutate), actor }),
			{ code: "PI_WORKFLOW_TICKET_APPROVAL_MISMATCH" },
			name,
		);
	}
});

test("rejects approval validation for canonically redigested structurally invalid graphs", () => {
	for (const [name, mutate] of [
		["empty tickets", (payload) => (payload.tickets = [])],
		["invalid ticket invariant", (payload) => (payload.tickets[0].acceptanceCriteria = payload.tickets[0].acceptanceCriteria.slice(0, 3))],
		["uncovered coverage story", (payload) => payload.coverage.stories.push({ id: "US-3", contextId: "delivery-context", acceptanceCriteria: ["US-3-AC-1"] })],
	]) {
		const invalidGraph = canonicallyRedigestedInvalidGraph(mutate);
		assert.equal(
			validateTicketGraphApproval({
				graph: invalidGraph,
				approval: approvalFor(invalidGraph),
				actor,
				parent: fixture.parent,
			}).ok,
			false,
			name,
		);
	}
});
