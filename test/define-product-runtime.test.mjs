import test from "node:test";
import assert from "node:assert/strict";

import { createDefineProductRuntime } from "../extensions/define-product-runtime.ts";

function completedResult() {
	return {
		status: "completed",
		executiveSummary: "done",
		artifacts: [
			{
				kind: "engram",
				project: "pi-workflow",
				topic: "workflow/define-product/definition-1/research/request-1",
				revision: "r1",
				schema: "research-evidence",
				schemaVersion: 1,
				digest: "digest-1",
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
			artifactTopic: "workflow/define-product/definition-1/research/request-1",
		},
	};
}

function registerRuntime() {
	let pendingRecommendation;
	const commands = [];
	const handlers = new Map();
	const tools = new Map();
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => pendingRecommendation,
			reset: () => {
				pendingRecommendation = undefined;
			},
			advance: async (command) => {
				commands.push(command);
				if (command.kind === "recommend-route") {
					pendingRecommendation = {
						definitionId: command.definitionId,
						domainAnchor: command.domainAnchor,
						domainAnchorDigest: "anchor-digest",
						assessment: command.assessment,
						recommendedRoute: "wayfinder",
						digest: "recommendation-1",
						confirmationToken: "0123456789012345678901234567890123456789012",
						issuedAt: 0,
					};
					return {
						status: "awaiting-confirmation",
						recommendation: pendingRecommendation,
					};
				}
				pendingRecommendation = undefined;
				return {
					status: "completed",
					result: completedResult(),
				};
			},
		},
		createDefinitionId: () => "definition-1",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return {
		handlers,
		runtime,
		tool: tools.get("workflow_define_product"),
		pendingRecommendation: () => pendingRecommendation,
		commands,
	};
}

test("define-product publishes and forwards the confirmation token only for explicit confirmation", async () => {
	const { runtime, tool, commands } = registerRuntime();
	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	await tool.execute("tool-1", {
		action: "recommend_route",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.deepEqual(tool.parameters.properties.confirmationToken, {
		type: "string",
		minLength: 43,
		maxLength: 43,
	});
	await tool.execute("tool-2", {
		action: "confirm_route",
		recommendationRef: "recommendation-1",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "What should we research?",
	});
	assert.equal(
		commands.at(-1).confirmationToken,
		"0123456789012345678901234567890123456789012",
	);
});

test("define-product runtime clears prompt and confirmation eligibility after session replacement or shutdown", async () => {
	for (const eventName of ["session_start", "session_shutdown"]) {
		const { handlers, runtime, tool, pendingRecommendation } =
			registerRuntime();
		runtime.handlePublicEntry({
			text: "/define-product map a new category",
			source: "interactive",
		});
		await tool.execute("tool-1", {
			action: "recommend_route",
			definitionId: "definition-1",
			domainAnchor: "map a new category",
			assessment: {
				clarity: "unclear",
				breadth: "broad",
				reasons: ["missing shape"],
			},
		});
		await handlers.get(eventName)({ type: eventName });
		assert.equal(pendingRecommendation(), undefined, eventName);
		assert.equal(
			await handlers.get("before_agent_start")({ systemPrompt: "base" }),
			undefined,
			eventName,
		);
		assert.equal(
			runtime.shouldContinue({
				text: "Yes, use wayfinder",
				source: "interactive",
			}),
			false,
			eventName,
		);
		const outOfTurn = await tool.execute("tool-2", {
			action: "confirm_route",
			recommendationRef: "recommendation-1",
			confirmationToken: "0123456789012345678901234567890123456789012",
			confirmedRoute: "wayfinder",
			researchQuestion: "What should we research?",
		});
		assert.equal(outOfTurn.details.status, "blocked", eventName);
	}
});

test("session start restores private exploration identity while clearing confirmation authorization", async () => {
	const handlers = new Map();
	const tools = new Map();
	let resetCount = 0;
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => ({ digest: "stale", recommendedRoute: "wayfinder" }),
			reset: () => { resetCount += 1; },
			restoreRecovery: async () => "definition-recovered",
			advance: async (command) => ({
				status: "completed",
				result: completedResult(),
				command,
			}),
		},
		createDefinitionId: () => "new-definition",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	assert.equal(resetCount >= 1, true);
	assert.equal(runtime.shouldContinue({ text: "continue", source: "interactive" }), true);
	const confirmation = await tools.get("workflow_define_product").execute("confirm", {
		action: "confirm_route",
		recommendationRef: "stale",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "stale",
	});
	assert.equal(confirmation.details.status, "blocked");
	const exploration = await tools.get("workflow_define_product").execute("explore", {
		action: "request_exploration",
		intent: "prototype",
		focus: "Resume safely",
	});
	assert.equal(exploration.details.command.definitionId, "definition-recovered");
});

test("define-product rejects an agent-supplied definition ID that differs from the session identity", async () => {
	const { runtime, tool, commands } = registerRuntime();
	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	const rejected = await tool.execute("tool-1", {
		action: "recommend_route",
		definitionId: "agent-controlled-definition",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.deepEqual(rejected.details, {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_DEFINITION_ID_MISMATCH",
			message:
				"The supplied definition ID does not match the active define-product session.",
		},
	});
	assert.deepEqual(commands, []);

	const recommendation = await tool.execute("tool-2", {
		action: "recommend_route",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.equal(recommendation.details.recommendation.definitionId, "definition-1");
});

test("Owner can request a public exploration continuation from verified research without runtime IDs", async () => {
	const { handlers, runtime, tool, commands } = registerRuntime();
	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	await tool.execute("tool-1", {
		action: "recommend_route",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	await tool.execute("tool-2", {
		action: "confirm_route",
		recommendationRef: "recommendation-1",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "What should we research?",
	});

	assert.equal(runtime.hasActiveTurn(), true);
	const continuationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(continuationPrompt.systemPrompt, /request_exploration/);
	assert.deepEqual(tool.parameters.properties.intent, {
		type: "string",
		enum: ["prototype", "design-alternative"],
	});
	assert.equal("sessionId" in tool.parameters.properties, false);
	assert.equal("targetTopic" in tool.parameters.properties, false);

	const exploration = await tool.execute("tool-3", {
		action: "request_exploration",
		intent: "prototype",
		focus: "Compare the first-run onboarding directions",
	});
	assert.equal(exploration.details.status, "completed");
	assert.deepEqual(commands.at(-1), {
		kind: "request-exploration",
		definitionId: "definition-1",
		intent: "prototype",
		focus: "Compare the first-run onboarding directions",
	});
	assert.equal(runtime.hasActiveTurn(), true);
});

test("define-product system prompt is scoped to the active guarded turn", async () => {
	const { handlers, runtime, tool } = registerRuntime();
	assert.equal(
		await handlers.get("before_agent_start")({ systemPrompt: "base" }),
		undefined,
	);
	const outOfTurn = await tool.execute("tool-0", {
		action: "recommend_route",
		definitionId: "definition-1",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.equal(outOfTurn.details.status, "blocked");

	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	const recommendationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(recommendationPrompt.systemPrompt, /recommend_route/);

	await tool.execute("tool-1", {
		action: "recommend_route",
		definitionId: "definition-1",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	const confirmationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(confirmationPrompt.systemPrompt, /confirm_route/);

	await tool.execute("tool-2", {
		action: "confirm_route",
		recommendationRef: "recommendation-1",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "What should we research?",
	});
	const explorationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(explorationPrompt.systemPrompt, /request_exploration/);
});
