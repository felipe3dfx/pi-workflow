import assert from "node:assert/strict";
import test from "node:test";

import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
} from "../extensions/delivery-ticket-graph.ts";

test("a covered story binds every declared acceptance criterion exactly once", () => {
	const coverage = createSpecCoverageIndex({
		stories: [{ id: "story-1", contextId: "delivery", acceptanceCriteria: ["ac-1", "ac-2"] }],
		decisions: ["decision-1"],
		tests: ["test-1"],
	});
	const ticket = {
		stableKey: "T01",
		title: "Crear flujo estable",
		outcome: "El Owner recibe un grafo verificable",
		acceptanceCriteria: ["Cumple uno", "Cumple dos", "Cumple tres", "Cumple cuatro"],
		estimate: { points: 1, rationale: "Alcance pequeño" },
		blockers: [],
		refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }],
		deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "delivery" }],
	};
	assert.throws(
		() => createDeliveryTicketGraph({
			parent: { id: "parent-1", teamId: "team-1", revision: "r1", specDigest: "spec-1" },
			coverage,
			language: "es",
			tickets: [ticket],
		}),
		/PI_WORKFLOW_TICKET_REFERENCE_INVALID/,
	);
	assert.throws(
		() => createDeliveryTicketGraph({
			parent: { id: "parent-1", teamId: "team-1", revision: "r1", specDigest: "spec-1" },
			coverage,
			language: "es",
			tickets: [{ ...ticket, deliveryBindings: [
				{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "delivery" },
				{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "delivery" },
				{ storyId: "story-1", acceptanceCriterionId: "ac-2", contextId: "delivery" },
			] }],
		}),
		/PI_WORKFLOW_TICKET_REFERENCE_INVALID/,
	);
});
