import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { createRuntimeEngramArtifactStore } from "../extensions/runtime-engram-store.ts";
import { executeResearchSession } from "../extensions/default-define-product.ts";

function createArtifactStore() {
	const revisions = new Map();
	let counter = 0;
	return {
		async readCurrent() {
			return undefined;
		},
		async write(project, topic, content) {
			const key = `${project}:${topic}`;
			counter += 1;
			revisions.set(`${key}:r${counter}`, content);
			return { revision: `r${counter}` };
		},
		async readRevision(project, topic, revision) {
			return revisions.get(`${project}:${topic}:${revision}`);
		},
	};
}

function loadExtension(runtime = {}) {
	const handlers = new Map();
	const tools = new Map();
	piWorkflowExtension(
		{
			exec: async () => ({ code: 0 }),
			registerCommand: () => {},
			registerTool: (tool) => tools.set(tool.name, tool),
			on: (event, handler) => {
				const previous = handlers.get(event);
				handlers.set(event, async (...args) => {
					if (previous) await previous(...args);
					return handler(...args);
				});
			},
		},
		{
			defineProduct: {
				createDefinitionId: () => "definition-1",
				runtime,
			},
		},
	);
	return { handlers, tool: tools.get("workflow_define_product") };
}

function executionContext() {
	const availableModel = {
		provider: "openai-codex",
		id: "gpt-5.6-terra",
		name: "gpt-5.6-terra",
	};
	return {
		cwd: process.cwd(),
		modelRegistry: {
			refresh() {},
			getAvailable() {
				return [availableModel];
			},
		},
		ui: {
			notify() {},
			setStatus() {},
		},
		isIdle: () => true,
		hasUI: true,
		signal: undefined,
		model: availableModel,
		sessionManager: { getSessionId: () => "session-1" },
		isProjectTrusted: () => true,
		abort() {},
		hasPendingMessages: () => false,
		shutdown() {},
		getContextUsage: () => undefined,
		compact() {},
		getSystemPrompt: () => "base",
	};
}

test("research session binds extensions before prompting", async () => {
	const calls = [];
	const result = await executeResearchSession(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "research complete" }],
				},
			],
			bindExtensions: async () => calls.push("bind"),
			subscribe: () => {
				calls.push("subscribe");
				return () => calls.push("unsubscribe");
			},
			prompt: async () => calls.push("prompt"),
			abort: async () => calls.push("abort"),
		},
		"research prompt",
	);
	assert.equal(result.assistantText, "research complete");
	assert.deepEqual(calls, ["bind", "subscribe", "prompt", "unsubscribe"]);
});

test("research session aborts and fails closed after twenty turns", async () => {
	let listener;
	let unsubscribed = false;
	let aborted = false;
	await assert.rejects(
		() =>
			executeResearchSession(
				{
					messages: [],
					bindExtensions: async () => {},
					subscribe: (callback) => {
						listener = callback;
						return () => {
							unsubscribed = true;
						};
					},
					prompt: async () => {
						for (let index = 0; index < 20; index += 1)
							listener({ type: "turn_end" });
					},
					abort: async () => {
						aborted = true;
					},
				},
				"research prompt",
			),
		/PI_WORKFLOW_RESEARCH_MAX_TURNS_EXCEEDED/,
	);
	assert.equal(aborted, true);
	assert.equal(unsubscribed, true);
});

test("runtime Engram store creates a session then reads back its written observation", async () => {
	const requests = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		requests.push({ url, method: init.method ?? "GET", body });
		if (url.endsWith("/sessions")) return new Response("{}", { status: 200 });
		if (url.endsWith("/observations")) {
			return Response.json({ id: 42 });
		}
		if (url.endsWith("/observations/42")) {
			return Response.json({ id: 42, content: "verified snapshot" });
		}
		throw new Error(`Unexpected request: ${url}`);
	};
	try {
		const store = createRuntimeEngramArtifactStore({
			url: "http://engram.test",
			sessionId: () => "pi-session-1",
			directory: () => "/workspace/project",
		});
		assert.deepEqual(
			await store.write("pi-workflow", "workflow/topic", "snapshot"),
			{
				revision: "42",
			},
		);
		assert.equal(
			await store.readRevision("pi-workflow", "workflow/topic", "42"),
			"verified snapshot",
		);
		assert.deepEqual(requests, [
			{
				url: "http://engram.test/sessions",
				method: "POST",
				body: {
					id: "pi-session-1",
					project: "pi-workflow",
					directory: "/workspace/project",
				},
			},
			{
				url: "http://engram.test/observations",
				method: "POST",
				body: {
					session_id: "pi-session-1",
					title: "workflow/topic",
					content: "snapshot",
					type: "workflow_artifact",
					project: "pi-workflow",
					scope: "project",
					topic_key: "workflow/topic",
				},
			},
			{
				url: "http://engram.test/observations/42",
				method: "GET",
				body: undefined,
			},
		]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("default define-product keeps token, research, and artifact identity bound to the session definition", async () => {
	const launches = [];
	const { handlers, tool } = loadExtension({
		artifactStore: createArtifactStore(),
		skillEntries: [
			{
				name: "research",
				path: fileURLToPath(
					new URL("./fixtures/private-skills/research/SKILL.md", import.meta.url),
				),
				scope: "core",
			},
		],
		researchExecutor: async (input) => {
			launches.push(input);
			await input.writeArtifact({
				findings: [
					{
						claim:
							"Competitor maps expose repeated information architecture patterns.",
						evidence: [
							{
								uri: "https://example.com/research",
								title: "Primary source",
								retrievedAt: "2026-07-11T00:00:00.000Z",
							},
						],
					},
				],
				limitations: ["Limited to one public source in the test harness."],
			});
			return {
				assistantText:
					"Research complete. The verified artifact is ready for the Owner.",
			};
		},
	});
	const ctx = executionContext();
	await handlers.get("tool_execution_start")(
		{ type: "tool_execution_start", toolName: "workflow_define_product" },
		ctx,
	);
	await handlers.get("input")(
		{
			type: "input",
			text: "/define-product map a new category",
			source: "interactive",
		},
		ctx,
	);

	const rejected = await tool.execute(
		"tool-0",
		{
			action: "recommend_route",
			definitionId: "agent-controlled-definition",
			domainAnchor: "map a new category",
			assessment: {
				clarity: "unclear",
				breadth: "broad",
				reasons: ["missing product boundaries"],
			},
		},
		undefined,
		undefined,
		ctx,
	);
	assert.equal(rejected.details.blocker.code, "PI_WORKFLOW_DEFINITION_ID_MISMATCH");
	assert.equal(launches.length, 0);

	const recommendation = await tool.execute(
		"tool-1",
		{
			action: "recommend_route",
			domainAnchor: "map a new category",
			assessment: {
				clarity: "unclear",
				breadth: "broad",
				reasons: ["missing product boundaries"],
			},
		},
		undefined,
		undefined,
		ctx,
	);
	assert.equal(recommendation.details.status, "awaiting-confirmation");
	assert.equal(recommendation.details.recommendation.definitionId, "definition-1");
	assert.match(recommendation.details.recommendation.confirmationToken, /^[A-Za-z0-9_-]{43}$/);

	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
	await handlers.get("input")(
		{
			type: "input",
			text: "Yes, use wayfinder and research competitor maps",
			source: "interactive",
		},
		ctx,
	);
	assert.equal(
		await handlers.get("tool_call")(
			{ toolName: "workflow_define_product" },
			ctx,
		),
		undefined,
	);

	const completed = await tool.execute(
		"tool-2",
		{
			action: "confirm_route",
			recommendationRef: recommendation.details.recommendation.digest,
			confirmationToken:
				recommendation.details.recommendation.confirmationToken,
			confirmedRoute: recommendation.details.recommendation.recommendedRoute,
			researchQuestion: "What should we research?",
		},
		undefined,
		undefined,
		ctx,
	);
	assert.equal(completed.details.status, "completed");
	assert.equal(launches.length, 1);
	assert.equal(launches[0].webExtensionPath.includes("pi-web-access"), true);
	assert.equal(launches[0].allowedTools.at(-1), "workflow_artifact_session");
	assert.deepEqual(completed.details.result.artifacts, [
		{
			kind: "engram",
			project: "pi-workflow",
			topic: recommendation.details.recommendation
				? `workflow/define-product/definition-1/research/${recommendation.details.recommendation.digest}`
				: "",
			revision: "r1",
			schema: "research-evidence",
			schemaVersion: 1,
			digest: completed.details.result.artifacts[0].digest,
		},
	]);
	assert.equal(
		completed.details.result.launchProvenance.artifactTopic,
		`workflow/define-product/definition-1/research/${recommendation.details.recommendation.digest}`,
	);
});
