import test from "node:test";
import assert from "node:assert/strict";

import { createDefineProductWorkflow } from "../extensions/define-product-workflow.ts";

function createWorkflow(
	delegateResult = {
		status: "completed",
		executiveSummary: "done",
		artifacts: [
			{
				kind: "engram",
				project: "pi-workflow",
				topic: "topic",
				revision: "r1",
				schema: "research-evidence",
				schemaVersion: 1,
				digest: "digest",
			},
		],
		nextRecommended: { kind: "confirmed-route", route: "wayfinder" },
		risks: [],
		launchProvenance: {
			agentName: "research",
			assetVersion: 1,
			assetDigest: "asset-digest",
			capabilityProfile: "research-reader",
			provider: "openai-codex",
			model: "gpt-5.6-terra",
			effort: "medium",
			inheritContext: false,
			promptMode: "replace",
			skillRefs: [],
			standardRefs: [],
			allowedTools: ["read"],
			deniedCapabilities: ["bash"],
			artifactTopic: "topic",
		},
	},
) {
	const intents = [];
	const workflow = createDefineProductWorkflow({
		delegate: {
			delegate: async (intent) => {
				intents.push(intent);
				return delegateResult;
			},
		},
		createRequestId: () => "request-1",
		project: { name: "pi-workflow", root: "/repo" },
	});
	return { workflow, intents, delegateResult };
}

test("define-product recommends wayfinder or grilling without delegating", async () => {
	const broad = createWorkflow();
	const wayfinder = await broad.workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-1",
		domainAnchor: "Explore a new product area",
		assessment: {
			clarity: "clear",
			breadth: "broad",
			reasons: ["many unknowns"],
		},
	});
	assert.equal(wayfinder.status, "awaiting-confirmation");
	assert.equal(wayfinder.recommendation.recommendedRoute, "wayfinder");
	assert.deepEqual(broad.intents, []);

	const narrow = createWorkflow();
	const grilling = await narrow.workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-2",
		domainAnchor: "Refine one onboarding flow",
		assessment: {
			clarity: "clear",
			breadth: "narrow",
			reasons: ["single flow"],
		},
	});
	assert.equal(grilling.status, "awaiting-confirmation");
	assert.equal(grilling.recommendation.recommendedRoute, "grilling");
	assert.deepEqual(narrow.intents, []);
});

test("define-product requires a one-time token bound to the active workflow state before delegation", async () => {
	const { workflow, intents } = createWorkflow();
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-1",
		domainAnchor: "Explore a new product area",
		assessment: {
			clarity: "unclear",
			breadth: "narrow",
			reasons: ["unknown outcome"],
		},
		workflowStateId: "workflow-state-1",
	});
	assert.equal(recommendation.status, "awaiting-confirmation");
	assert.match(
		recommendation.recommendation.confirmationToken,
		/^[A-Za-z0-9_-]{43}$/,
	);

	const missing = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmedRoute: recommendation.recommendation.recommendedRoute,
		researchQuestion: "What should we research?",
		workflowStateId: "workflow-state-1",
	});
	assert.equal(missing.status, "blocked");
	assert.deepEqual(intents, []);

	const completed = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmedRoute: recommendation.recommendation.recommendedRoute,
		researchQuestion: "What should we research?",
		confirmationToken: recommendation.recommendation.confirmationToken,
		workflowStateId: "workflow-state-1",
	});
	assert.equal(completed.status, "blocked");
	assert.deepEqual(intents, []);
});

test("define-product rejects a token from another workflow state and consumes a valid token before delegation", async () => {
	const { workflow, intents } = createWorkflow();
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-1",
		domainAnchor: "Explore a new product area",
		assessment: {
			clarity: "unclear",
			breadth: "narrow",
			reasons: ["unknown outcome"],
		},
		workflowStateId: "workflow-state-1",
	});
	const wrongState = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmedRoute: recommendation.recommendation.recommendedRoute,
		researchQuestion: "What should we research?",
		confirmationToken: recommendation.recommendation.confirmationToken,
		workflowStateId: "workflow-state-2",
	});
	assert.equal(wrongState.status, "blocked");
	assert.deepEqual(intents, []);

	const fresh = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-2",
		domainAnchor: "Explore another product area",
		assessment: {
			clarity: "unclear",
			breadth: "narrow",
			reasons: ["unknown outcome"],
		},
		workflowStateId: "workflow-state-3",
	});
	const confirmation = {
		kind: "confirm-route",
		recommendationRef: fresh.recommendation.digest,
		confirmedRoute: fresh.recommendation.recommendedRoute,
		researchQuestion: "What should we research?",
		confirmationToken: fresh.recommendation.confirmationToken,
		workflowStateId: "workflow-state-3",
	};
	const [first, retry] = await Promise.all([
		workflow.advance(confirmation),
		workflow.advance(confirmation),
	]);
	assert.equal(first.status, "completed");
	assert.equal(retry.status, "blocked");
	assert.equal(intents.length, 1);
});

test("define-product expires confirmation tokens at the interactive confirmation boundary", async () => {
	const intents = [];
	const { delegateResult } = createWorkflow();
	let now = 1_000;
	const workflow = createDefineProductWorkflow({
		delegate: { delegate: async (intent) => {
			intents.push(intent);
			return delegateResult;
		} },
		createRequestId: () => "request-1",
		project: { name: "pi-workflow", root: "/repo" },
		now: () => now,
	});
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-1",
		domainAnchor: "Explore a new product area",
		assessment: { clarity: "unclear", breadth: "narrow", reasons: ["unknown"] },
		workflowStateId: "workflow-state-1",
	});
	assert.equal(recommendation.status, "awaiting-confirmation");
	assert.equal(recommendation.recommendation.issuedAt, 1_000);
	const confirmation = {
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmationToken: recommendation.recommendation.confirmationToken,
		confirmedRoute: recommendation.recommendation.recommendedRoute,
		researchQuestion: "What should we research?",
		workflowStateId: "workflow-state-1",
	};

	now += 5 * 60 * 1_000 - 1;
	const justBefore = await workflow.advance(confirmation);
	assert.equal(justBefore.status, "completed");
	assert.equal(intents.length, 1);

	const renewed = await workflow.advance({
		...confirmation,
		kind: "recommend-route",
		definitionId: "definition-2",
		domainAnchor: "Another product area",
		assessment: { clarity: "unclear", breadth: "narrow", reasons: ["unknown"] },
	});
	assert.equal(renewed.status, "awaiting-confirmation");
	now += 5 * 60 * 1_000;
	const atBoundary = await workflow.advance({
		...confirmation,
		recommendationRef: renewed.recommendation.digest,
		confirmationToken: renewed.recommendation.confirmationToken,
	});
	assert.deepEqual(atBoundary, {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_ROUTE_CONFIRMATION_EXPIRED",
			message: "The route confirmation token has expired. Request a new recommendation.",
		},
	});
	assert.equal(workflow.pendingRecommendation(), undefined);

	const afterExpiry = await workflow.advance({
		...confirmation,
		recommendationRef: renewed.recommendation.digest,
		confirmationToken: renewed.recommendation.confirmationToken,
	});
	assert.equal(afterExpiry.status, "blocked");
	assert.equal(intents.length, 1);
});

test("define-product clears its authoritative recommendation after terminal confirmation blockers", async () => {
	for (const confirmation of [
		{
			recommendationRef: "wrong",
			confirmedRoute: "wayfinder",
			researchQuestion: "What should we research?",
		},
		{ researchQuestion: "   " },
	]) {
		const { workflow, intents } = createWorkflow();
		const recommendation = await workflow.advance({
			kind: "recommend-route",
			definitionId: "definition-1",
			domainAnchor: "Explore a new product area",
			assessment: {
				clarity: "unclear",
				breadth: "narrow",
				reasons: ["unknown outcome"],
			},
		});
		const blocked = await workflow.advance({
			kind: "confirm-route",
			recommendationRef: recommendation.recommendation.digest,
			confirmationToken: recommendation.recommendation.confirmationToken,
			confirmedRoute: recommendation.recommendation.recommendedRoute,
			...confirmation,
		});
		assert.equal(blocked.status, "blocked");
		assert.equal(workflow.pendingRecommendation(), undefined);
		assert.deepEqual(intents, []);
	}
});

test("define-product resets its authoritative recommendation and preserves successful settled confirmation", async () => {
	const { workflow, intents } = createWorkflow();
	const stale = await workflow.advance({
		kind: "recommend-route",
		definitionId: "stale-definition",
		domainAnchor: "Stale idea",
		assessment: { clarity: "clear", breadth: "narrow", reasons: ["one flow"] },
	});
	workflow.reset();
	assert.equal(workflow.pendingRecommendation(), undefined);
	const resetBlocked = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: stale.recommendation.digest,
		confirmedRoute: "grilling",
		researchQuestion: "What should we research?",
	});
	assert.equal(resetBlocked.status, "blocked");

	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-1",
		domainAnchor: "Explore a new product area",
		assessment: {
			clarity: "unclear",
			breadth: "narrow",
			reasons: ["unknown outcome"],
		},
	});
	const completed = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmationToken: recommendation.recommendation.confirmationToken,
		confirmedRoute: recommendation.recommendation.recommendedRoute,
		researchQuestion: "What should we research?",
	});
	assert.equal(completed.status, "completed");
	assert.equal(workflow.pendingRecommendation(), undefined);
	assert.equal(intents.length, 1);
	assert.equal(intents[0].kind, "research");
	assert.equal(
		intents[0].targetTopic,
		`workflow/define-product/definition-1/research/${recommendation.recommendation.digest}`,
	);
});
