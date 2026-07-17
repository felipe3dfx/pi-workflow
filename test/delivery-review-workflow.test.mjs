import test from "node:test";
import assert from "node:assert/strict";

import { createDeliveryReviewWorkflow } from "../extensions/delivery-review-workflow.ts";
import { createReviewSnapshot } from "../extensions/review-router.ts";

const evidence = {
	kind: "engram",
	project: "pi-workflow",
	topic: "evidence/risk-1",
	revision: "revision-1",
	schema: "review-evidence",
	schemaVersion: 1,
	digest: "evidence-digest",
};

function snapshot(risks) {
	return createReviewSnapshot({
		subject: {
			kind: "delivery-ticket",
			id: "ILA-2315",
			digest: "subject-digest",
		},
		manifest: [
			{ ...evidence, topic: "manifest/verify", digest: "verify-digest" },
		],
		risks,
	});
}

test("deliver-ticket consumes the normal plan and launches only its selected lens with ReviewPlanRef", async () => {
	const launches = [];
	const workflow = createDeliveryReviewWorkflow({
		launch: async (request) => {
			launches.push(request);
			return { status: "completed" };
		},
	});
	const result = await workflow.run({
		requestId: "request-1",
		snapshot: snapshot([
			{
				kind: "review",
				id: "risk-1",
				severity: "critical",
				summary: "Risk",
				lens: "risk",
				evidence,
			},
			{
				kind: "review",
				id: "readability-1",
				severity: "warning",
				summary: "Readability",
				lens: "readability",
				evidence: {
					...evidence,
					topic: "evidence/readability",
					digest: "readability-digest",
				},
			},
		]),
		receipts: [],
	});
	assert.equal(launches.length, 1);
	assert.equal(launches[0].lens, "risk");
	assert.deepEqual(launches[0].reviewPlanRef, result.plan.ref);
	assert.equal(result.outcomes.length, 1);
});

test("deliver-ticket performs no launch when the normal plan selects no lens", async () => {
	let launches = 0;
	const workflow = createDeliveryReviewWorkflow({
		launch: async () => {
			launches += 1;
		},
	});
	const result = await workflow.run({
		requestId: "request-1",
		snapshot: snapshot([]),
		receipts: [],
	});
	assert.equal(launches, 0);
	assert.deepEqual(result.outcomes, []);
});
