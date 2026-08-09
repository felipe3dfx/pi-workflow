import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { createDefineProductRuntime } from "../extensions/define-product-runtime.ts";
import { createSingleUserAuthoritySession } from "../extensions/single-user-authority.ts";
import { createRuntimeEngramArtifactStore } from "../extensions/runtime-engram-store.ts";
import { createEngramApprovedSpecReader } from "../extensions/engram-approved-spec-reader.ts";
import { createInMemoryDelegationCheckpointStore } from "../extensions/delegation-checkpoints.ts";
import { createLinearDeliveryParentGateway } from "../extensions/linear-delivery-parent-gateway.ts";
import { createRuntimeLinearDeliveryParentTransport } from "../extensions/runtime-linear-delivery-parent.ts";
import * as defaultDefineProductModule from "../extensions/default-define-product.ts";
import {
	canonicalJson,
	digestCanonicalValue,
} from "../extensions/workflow-contracts.ts";
import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
	createTicketGraphApproval,
} from "../extensions/delivery-ticket-graph.ts";
import {
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
} from "../extensions/product-spec.ts";
import { createWorkflowArtifactInterface } from "../extensions/workflow-artifacts.ts";
import { createInMemoryDecisionStore } from "../extensions/interactive-decisions.ts";

test("to-tickets gives one corrective turn when the first turn omits the required graph write", async () => {
	const prompts = [];
	let wroteGraph = false;
	const result =
		await defaultDefineProductModule.executeRequiredTicketGraphTurn({
			prompt: "generate",
			execute: async (prompt) => {
				prompts.push(prompt);
				if (prompts.length === 2) wroteGraph = true;
				return `turn-${prompts.length}`;
			},
			hasWrittenGraph: () => wroteGraph,
		});
	assert.equal(result, "turn-2");
	assert.equal(prompts[0], "generate");
	assert.match(prompts[1], /action=write_graph/);
	assert.match(prompts[1], /graph\.payload\.coverage/);
});

test("to-tickets does not spend a corrective turn after a successful graph write", async () => {
	let calls = 0;
	const result =
		await defaultDefineProductModule.executeRequiredTicketGraphTurn({
			prompt: "generate",
			execute: async () => {
				calls += 1;
				return "written";
			},
			hasWrittenGraph: () => true,
		});
	assert.equal(result, "written");
	assert.equal(calls, 1);
});

const {
	createDefaultDefineProductWorkflow,
	createDefaultExplorationExecutor,
	executeResearchSession,
} = defaultDefineProductModule;

function createArtifactStore() {
	const revisions = new Map();
	let counter = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
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

function createAtomicArtifactStore() {
	const topics = new Map();
	const revisions = new Map();
	let counter = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		async readCurrent(project, topic) {
			return topics.get(`${project}:${topic}`);
		},
		async write(project, topic, content, expectedRevision) {
			const key = `${project}:${topic}`;
			const current = topics.get(key);
			if (current?.revision !== expectedRevision) {
				throw Object.assign(new Error("compare-and-swap conflict"), {
					code: "revision-conflict",
				});
			}
			counter += 1;
			const stored = { revision: `atomic-r${counter}`, content };
			topics.set(key, stored);
			revisions.set(`${key}:${stored.revision}`, content);
			return { revision: stored.revision };
		},
		async readRevision(project, topic, revision) {
			return revisions.get(`${project}:${topic}:${revision}`);
		},
	};
}

const DEFINE_PRODUCT_MCP_TOOLS = [
	"linear_get_user",
	"linear_list_teams",
	"linear_list_issue_statuses",
	"linear_list_issues",
	"linear_save_issue",
	"linear_get_issue",
	"workflow_define_product",
];

function loadExtension(runtime = {}) {
	const { interactiveDecisionStore, ...defineProductRuntime } = runtime;
	const handlers = new Map();
	const handlerCounts = new Map();
	const tools = new Map();
	piWorkflowExtension(
		{
			exec: async () => ({ code: 0 }),
			getActiveTools: () => [...DEFINE_PRODUCT_MCP_TOOLS],
			getAllTools: () => DEFINE_PRODUCT_MCP_TOOLS.map((name) => ({ name })),
			registerCommand: () => {},
			registerTool: (tool) => tools.set(tool.name, tool),
			on: (event, handler) => {
				handlerCounts.set(event, (handlerCounts.get(event) ?? 0) + 1);
				const previous = handlers.get(event);
				handlers.set(event, async (...args) => {
					const previousOutcome = previous
						? await previous(...args)
						: undefined;
					return (await handler(...args)) ?? previousOutcome;
				});
			},
		},
		{
			interactiveDecisions: {
				store: interactiveDecisionStore ?? createInMemoryDecisionStore(),
			},
			defineProduct: {
				createDefinitionId: () => "definition-1",
				runtime: {
					checkpointStore: createInMemoryDelegationCheckpointStore(),
					...defineProductRuntime,
				},
			},
		},
	);
	return {
		handlerCounts,
		handlers,
		tool: tools.get("workflow_define_product"),
	};
}

function loadAuthorityRuntime() {
	const handlers = new Map();
	const authoritySession = createSingleUserAuthoritySession();
	const runtime = createDefineProductRuntime({
		workflow: {
			advance: async () => ({
				status: "blocked",
				blocker: { code: "unused", message: "unused" },
			}),
			pendingRecommendation: () => undefined,
			reset() {},
		},
		createDefinitionId: () => "definition-authority",
		authoritySession,
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool() {},
	});
	return { handlers, runtime };
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

async function authenticateOwner(handlers, ctx, id = "owner-1") {
	const toolCallId = `authenticate-${id}`;
	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	await handlers.get("tool_call")(
		{ toolName: "linear_get_user", toolCallId, input: { query: "me" } },
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolName: "linear_get_user",
			toolCallId,
			content: [
				{
					type: "text",
					text: JSON.stringify({
						id,
						name: "Owner",
						isActive: true,
						isGuest: false,
					}),
				},
			],
			isError: false,
		},
		ctx,
	);
}

function productionSpecRequest(overrides = {}) {
	return {
		action: "to_spec",
		teamId: "team-grupo-ilao",
		title: "Incorporar aprobaciones exactas del Spec",
		problem: "El equipo necesita gestionar clientes y permisos correctamente.",
		solution:
			"El flujo genera un Spec español exacto y exige aprobación vinculada a su identidad completa.",
		userStories: [
			"Como Owner, quiero revisar el cuerpo exacto, para conservar autoridad sobre la definición publicada.",
		],
		decisions: [
			{
				id: "exact-approval",
				status: "resolved",
				pertinent: true,
				text: "La aprobación se vincula al resumen criptográfico exacto antes de publicar.",
			},
		],
		tests: ["Verificar la aprobación exacta antes de publicar."],
		outOfScope: [
			"La publicación de la descripción del Delivery parent en Linear queda fuera del alcance.",
		],
		...overrides,
	};
}

function productionSpecRuntimeOptions(overrides = {}) {
	let pendingSpec;
	const approvedTopics = new Map();
	let approvedRevision = 0;
	return {
		artifactStore: createArtifactStore(),
		checkpointStore: createInMemoryDelegationCheckpointStore(),
		specApprovalRecoveryStore: {
			load: async () => structuredClone(pendingSpec),
			save: async (state) => {
				pendingSpec = structuredClone(state);
			},
			clear: async () => {
				pendingSpec = undefined;
			},
		},
		approvedSpecReader: createEngramApprovedSpecReader({
			project: "pi-workflow",
			store: {
				readCurrent: async (project, topic) =>
					approvedTopics.get(`${project}:${topic}`),
				write: async (project, topic, content) => {
					approvedRevision += 1;
					const stored = { revision: `approved-r${approvedRevision}`, content };
					approvedTopics.set(`${project}:${topic}`, stored);
					return { revision: stored.revision };
				},
				readRevision: async (project, topic, revision) => {
					const stored = approvedTopics.get(`${project}:${topic}`);
					return stored?.revision === revision ? stored.content : undefined;
				},
			},
		}),
		webExtensionPath: fileURLToPath(
			new URL("./fixtures/pi-web-access/index.ts", import.meta.url),
		),
		skillEntries: [
			{
				name: "research",
				path: fileURLToPath(
					new URL(
						"./fixtures/private-skills/research/SKILL.md",
						import.meta.url,
					),
				),
				scope: "core",
			},
		],
		researchExecutor: async (input) => {
			await input.writeArtifact({
				findings: [
					{
						claim: "La aprobación exacta requiere una identidad autenticada.",
						evidence: [
							{
								uri: "https://example.com/authority",
								title: "Authority source",
								retrievedAt: "2026-07-14T00:00:00.000Z",
							},
						],
					},
				],
				limitations: [],
			});
			return { assistantText: "Research ready." };
		},
		...overrides,
	};
}

async function prepareProductionSpec(runtimeOptions = {}, specOverrides = {}) {
	const { handlerCounts, handlers, tool } = loadExtension(
		productionSpecRuntimeOptions(runtimeOptions),
	);
	const ctx = executionContext();
	let authorityLookupCount = 0;
	await handlers.get("tool_execution_start")(
		{ type: "tool_execution_start", toolName: "workflow_define_product" },
		ctx,
	);
	await handlers.get("input")(
		{
			type: "input",
			text: "/define-product redactar el Spec aprobado",
			source: "interactive",
		},
		ctx,
	);
	authorityLookupCount += 1;
	await handlers.get("tool_call")(
		{
			toolName: "linear_get_user",
			toolCallId: "define-execution-user",
			input: { query: "me" },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolName: "linear_get_user",
			toolCallId: "define-execution-user",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						id: "owner-felipe",
						name: "Owner",
						isActive: true,
						isGuest: false,
					}),
				},
			],
			isError: false,
		},
		ctx,
	);
	const recommendation = await tool.execute(
		"recommend",
		{
			action: "recommend_route",
			domainAnchor: "Definir aprobaciones exactas",
			assessment: {
				clarity: "unclear",
				breadth: "broad",
				reasons: ["research"],
			},
		},
		undefined,
		undefined,
		ctx,
	);
	const routeDecisionPrompt = await handlers.get("before_agent_start")(
		{ systemPrompt: "base" },
		ctx,
	);
	assert.match(
		routeDecisionPrompt.systemPrompt,
		/Present this decision verbatim/,
	);
	assert.doesNotMatch(
		routeDecisionPrompt.systemPrompt,
		/call workflow_define_product.*confirm_route/i,
	);
	await handlers.get("input")(
		{
			type: "input",
			text: "1",
			source: "interactive",
		},
		ctx,
	);
	await tool.execute(
		"research",
		{
			action: "confirm_route",
			recommendationRef: recommendation.details.recommendation.digest,
			confirmationToken:
				recommendation.details.recommendation.confirmationToken,
			confirmedRoute: "wayfinder",
			researchQuestion: "¿Cómo debe funcionar la aprobación?",
		},
		undefined,
		undefined,
		ctx,
	);
	await handlers.get("tool_call")(
		{
			toolName: "linear_list_teams",
			toolCallId: "team-options",
			input: { limit: 50, orderBy: "updatedAt" },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolName: "linear_list_teams",
			toolCallId: "team-options",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						teams: [
							{ id: "team-grupo-ilao", name: "Grupo ILAO" },
							{ id: "team-1", name: "Grupo Ilao MCP" },
						],
						hasNextPage: false,
					}),
				},
			],
			isError: false,
		},
		ctx,
	);
	const teamDecisionPrompt = await handlers.get("before_agent_start")(
		{ systemPrompt: "base" },
		ctx,
	);
	assert.match(teamDecisionPrompt.systemPrompt, /Which Linear team/);
	const sameTurn = await tool.execute(
		"same-turn-spec",
		productionSpecRequest(specOverrides),
		undefined,
		undefined,
		ctx,
	);
	assert.equal(sameTurn.details.status, "blocked");
	assert.equal(
		sameTurn.details.blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	await handlers.get("input")(
		{
			type: "input",
			text: specOverrides.teamId === "team-1" ? "2" : "1",
			source: "interactive",
		},
		ctx,
	);
	const ready = await tool.execute(
		"spec",
		productionSpecRequest(specOverrides),
		undefined,
		undefined,
		ctx,
	);
	assert.equal(ready.details.status, "spec-ready");
	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	return {
		authorityLookupCount,
		ctx,
		handlerCounts,
		handlers,
		ready,
		tool,
	};
}

test("production session manager creates named persistent sessions and resumes the exact identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-session-test-"));
	try {
		const sessionDirectory = join(root, "sessions");
		assert.equal(
			typeof defaultDefineProductModule.createRecoverableSessionManager,
			"function",
		);
		const first =
			await defaultDefineProductModule.createRecoverableSessionManager(
				root,
				sessionDirectory,
				{
					attempt: 1,
					sessionId: "production-session-1",
					verifiedArtifacts: [],
				},
			);
		first.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "verified progress" }],
			api: "openai-responses",
			provider: "openai-codex",
			model: "gpt-5.6-terra",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		const resumed =
			await defaultDefineProductModule.createRecoverableSessionManager(
				join(root, "different-disposable-copy"),
				sessionDirectory,
				{
					attempt: 1,
					sessionId: "new-request-id",
					resumeSessionId: "production-session-1",
					verifiedArtifacts: [],
				},
			);
		assert.equal(resumed.getSessionId(), "production-session-1");
		assert.equal(resumed.getSessionName(), "production-session-1");
		assert.match(resumed.getSessionFile(), /production-session-1/);
		assert.equal(
			resumed
				.getEntries()
				.some(
					(entry) =>
						entry.type === "message" && entry.message.role === "assistant",
				),
			true,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("production exploration tool merges scoped progress and intervenes only in the exact active Pi session", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-executor-test-"));
	try {
		const calls = { progress: [], steer: [], abort: 0 };
		let sessionOptions;
		let releasePrompt;
		let sessionCreated;
		const created = new Promise((resolve) => {
			sessionCreated = resolve;
		});
		const promptPending = new Promise((resolve) => {
			releasePrompt = resolve;
		});
		const fakeSession = {
			sessionId: "active-production-session",
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "cancelled cleanly" }],
				},
			],
			async bindExtensions() {},
			subscribe() {
				return () => {};
			},
			async prompt() {
				await promptPending;
			},
			async steer(guidance) {
				calls.steer.push(guidance);
			},
			async abort() {
				calls.abort += 1;
				releasePrompt();
			},
			dispose() {},
		};
		const executor = createDefaultExplorationExecutor(
			join(root, "sessions"),
			async (options) => {
				sessionOptions = options;
				sessionCreated();
				return { session: fakeSession };
			},
		);
		const artifact = {
			kind: "engram",
			project: "pi-workflow",
			topic: "workflow/exploration",
			revision: "progress-r1",
			schema: "workflow-progress",
			schemaVersion: 1,
			digest: "progress-digest",
		};
		const running = executor.execute({
			cwd: root,
			launchOptions: {
				attempt: 1,
				sessionId: "active-production-session",
				verifiedArtifacts: [],
			},
			model: executionContext().model,
			thinkingLevel: "medium",
			intent: "prototype",
			prompt: "Explore",
			systemPrompt: "Explore in isolation",
			allowedTools: ["workflow_artifact_session"],
			launchProvenance: {},
			readArtifact: async () => "research",
			mergeProgress: async (batch) => {
				calls.progress.push(batch);
				return artifact;
			},
			writeArtifact: async () => {
				throw new Error("terminal write is not expected after cancellation");
			},
		});
		await created;
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(sessionOptions.sessionManager.isPersisted(), true);
		assert.equal(
			sessionOptions.sessionManager.getSessionId(),
			"active-production-session",
		);
		const tool = sessionOptions.customTools.find(
			(candidate) => candidate.name === "workflow_artifact_session",
		);
		assert.deepEqual(tool.parameters.properties.action.enum, [
			"read_alias",
			"merge_progress",
			"write_snapshot",
		]);
		assert.equal("topic" in tool.parameters.properties, false);
		assert.deepEqual(tool.parameters.properties.discoveredPaths, {
			type: "array",
			items: { type: "string" },
		});
		const merged = await tool.execute("tool-progress", {
			action: "merge_progress",
			batchKey: "comparison-1",
			payload: { completed: 1 },
		});
		assert.deepEqual(merged.details, artifact);
		assert.deepEqual(calls.progress, [
			{
				batchKey: "comparison-1",
				payload: { completed: 1 },
			},
		]);
		await executor.intervene("active-production-session", {
			kind: "steer",
			guidance: "Narrow to first-run onboarding.",
		});
		await assert.rejects(
			() =>
				executor.intervene("different-session", {
					kind: "cancel",
					reason: "must not affect the active session",
				}),
			/exact active Pi session is unavailable/,
		);
		await executor.intervene("active-production-session", {
			kind: "cancel",
			reason: "Owner cancelled",
		});
		assert.deepEqual(calls.steer, ["Narrow to first-run onboarding."]);
		assert.equal(calls.abort, 1);
		await running;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

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

test("runtime Engram store performs conditional writes with exact read-back", async () => {
	const requests = [];
	let observation;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		requests.push({ url, method: init.method ?? "GET", body });
		if (url.includes("/observations?")) {
			return Response.json(
				observation
					? [{ ...observation, topic_key: "workflow/unrelated" }]
					: [],
			);
		}
		if (url.includes("/search?")) {
			return Response.json(
				observation
					? [{ ...observation, id: 41, content: '{"value":0}' }, observation]
					: [],
			);
		}
		if (url.endsWith("/sessions")) return new Response("{}", { status: 200 });
		if (url.endsWith("/observations")) {
			observation = {
				id: 42,
				project: body.project,
				topic_key: body.topic_key.toLowerCase(),
				title: body.title,
				content: body.content.trimEnd(),
			};
			return Response.json({ id: 42 });
		}
		if (url.endsWith("/observations/42")) {
			return Response.json(observation);
		}
		throw new Error(`Unexpected request: ${url}`);
	};
	try {
		const store = createRuntimeEngramArtifactStore({
			url: "http://engram.test",
			sessionId: () => "pi-session-1",
			directory: () => "/workspace/project",
		});
		assert.equal(store.capabilities.atomicCompareAndSwap, true);
		const content = '{"value":1}\n';
		const created = await store.write(
			"pi-workflow",
			"workflow/TOPIC",
			content,
			undefined,
		);
		assert.equal(created.revision, "42");
		assert.deepEqual(await store.readCurrent("pi-workflow", "workflow/TOPIC"), {
			revision: "42",
			content,
		});
		assert.equal(
			await store.readRevision("pi-workflow", "workflow/TOPIC", "42"),
			content,
		);
		assert.deepEqual(
			requests
				.filter((request) => request.method === "POST")
				.map((request) => request.body),
			[
				{
					id: "pi-session-1",
					project: "pi-workflow",
					directory: "/workspace/project",
				},
				{
					project: "pi-workflow",
					topic_key: "workflow/TOPIC",
					title: "pi-workflow artifact+lf: workflow/TOPIC",
					content: '{"value":1}\n',
					type: "architecture",
					scope: "project",
					session_id: "pi-session-1",
					expected_revision: null,
				},
			],
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("default workflow executes prototype and design-alternative in disposable isolation with exact provenance", async () => {
	const explorations = [];
	const skillPath = fileURLToPath(
		new URL("./fixtures/private-skills/research/SKILL.md", import.meta.url),
	);
	const ctx = executionContext();
	const workflow = createDefaultDefineProductWorkflow({}, () => ctx, {
		artifactStore: createArtifactStore(),
		checkpointStore: createInMemoryDelegationCheckpointStore(),
		webExtensionPath: fileURLToPath(
			new URL("./fixtures/pi-web-access/index.ts", import.meta.url),
		),
		skillEntries: [
			{ name: "research", path: skillPath, scope: "core" },
			{ name: "prototype", path: skillPath, scope: "core" },
			{ name: "codebase-design", path: skillPath, scope: "core" },
		],
		researchExecutor: async (input) => {
			await input.writeArtifact({
				findings: [
					{
						claim: "A verified research input is available.",
						evidence: [
							{
								uri: "https://example.com/source",
								title: "Source",
								retrievedAt: "2026-07-14T00:00:00.000Z",
							},
						],
					},
				],
				limitations: [],
			});
			return { assistantText: "Research ready." };
		},
		explorationExecutor: async (input) => {
			explorations.push(input);
			assert.notEqual(input.cwd, process.cwd());
			assert.equal(input.launchProvenance.agentName, "prototype");
			assert.equal(
				input.launchProvenance.capabilityProfile,
				"isolated-prototype",
			);
			assert.deepEqual(input.allowedTools, [
				"read",
				"grep",
				"find",
				"ls",
				"edit",
				"write",
				"bash",
				"workflow_artifact_session",
			]);
			assert.equal("checkpointStore" in input, false);
			await input.writeArtifact({
				summary: `${input.intent} result`,
				comparison: [
					{
						criterion: "Owner comparability",
						assessment: `${input.intent} can be compared from the same schema.`,
					},
				],
				changedPaths:
					input.intent === "prototype" ? ["prototype/index.html"] : [],
				limitations: [],
			});
			return { assistantText: `${input.intent} ready.` };
		},
	});
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-runtime",
		domainAnchor: "Compare onboarding directions",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["Multiple viable directions"],
		},
		workflowStateId: "runtime-state",
	});
	const research = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmationToken: recommendation.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "Which direction should be explored?",
		workflowStateId: "runtime-state",
	});
	assert.equal(research.result.status, "completed");
	for (const intent of ["prototype", "design-alternative"]) {
		const result = await workflow.advance({
			kind: "request-exploration",
			definitionId: "definition-runtime",
			intent,
			focus: "Compare onboarding directions",
		});
		assert.equal(result.result.status, "completed");
		assert.equal(result.result.artifacts[0].schema, "design-exploration");
		assert.equal(result.result.launchProvenance.agentName, "prototype");
	}
	assert.deepEqual(
		explorations.map(({ intent }) => intent),
		["prototype", "design-alternative"],
	);
});

test("default runtime resumes compatible exploration, persists progress, and performs one discovered-path retry", async () => {
	const calls = [];
	let recoveryState;
	const explorationRecoveryStore = {
		load: async () => recoveryState,
		save: async (state) => {
			recoveryState = structuredClone(state);
		},
		clear: async () => {
			recoveryState = undefined;
		},
	};
	const artifactStore = createAtomicArtifactStore();
	const skillPath = fileURLToPath(
		new URL("./fixtures/private-skills/research/SKILL.md", import.meta.url),
	);
	const workflow = createDefaultDefineProductWorkflow(
		{},
		() => executionContext(),
		{
			artifactStore,
			checkpointStore: createInMemoryDelegationCheckpointStore(),
			explorationRecoveryStore,
			createRequestId: () => "request-recoverable",
			webExtensionPath: fileURLToPath(
				new URL("./fixtures/pi-web-access/index.ts", import.meta.url),
			),
			skillEntries: [
				{ name: "research", path: skillPath, scope: "core" },
				{ name: "prototype", path: skillPath, scope: "core" },
			],
			researchExecutor: async (input) => {
				await input.writeArtifact({
					findings: [
						{
							claim: "Verified research",
							evidence: [
								{
									uri: "https://example.com/research",
									title: "Research",
									retrievedAt: "2026-07-14T00:00:00.000Z",
								},
							],
						},
					],
					limitations: [],
				});
				return { assistantText: "Research ready." };
			},
			explorationExecutor: async (input) => {
				calls.push(input);
				const call = calls.length;
				const progress = await input.mergeProgress({
					batchKey: `comparison-${call}`,
					...(call === 1 ? {} : { supersedes: `comparison-${call - 1}` }),
					payload: { completed: call },
				});
				if (call === 1) {
					throw Object.assign(new Error("transport interrupted"), {
						code: "PI_WORKFLOW_DELEGATION_INTERRUPTED",
						interrupted: true,
						sessionId: input.launchOptions.sessionId,
						verifiedArtifacts: [progress],
						partialOutput: "discard this",
					});
				}
				await input.writeArtifact({
					summary: "Comparable result",
					comparison: [{ criterion: "Recovery", assessment: "Bounded." }],
					changedPaths: ["extensions/workflow-contracts.ts"],
					limitations: [],
				});
				return {
					assistantText: "Exploration ready.",
					...(call === 2
						? { discoveredPaths: ["extensions/workflow-contracts.ts"] }
						: {}),
				};
			},
		},
	);
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-recovery",
		domainAnchor: "Compare recovery",
		assessment: { clarity: "unclear", breadth: "broad", reasons: ["unknown"] },
		workflowStateId: "state-recovery",
	});
	await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmationToken: recommendation.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "What recovery should we compare?",
		workflowStateId: "state-recovery",
	});
	const command = {
		kind: "request-exploration",
		definitionId: "definition-recovery",
		intent: "prototype",
		focus: "Compare recovery behavior",
	};
	const interrupted = await workflow.advance(command);
	assert.equal(
		interrupted.result.blocker.code,
		"PI_WORKFLOW_DELEGATION_INTERRUPTED",
	);
	const recovered = await workflow.advance(command);
	assert.equal(recovered.result.status, "completed");
	assert.equal(calls.length, 3);
	assert.equal(
		calls[1].launchOptions.resumeSessionId,
		calls[0].launchOptions.sessionId,
	);
	assert.deepEqual(
		calls[1].launchOptions.verifiedArtifacts.map(({ schema }) => schema),
		["workflow-progress"],
	);
	assert.equal(calls[2].launchOptions.attempt, 2);
	assert.equal(calls[2].launchOptions.resumeSessionId, undefined);
	assert.equal("partialOutput" in calls[1].launchOptions, false);
	const terminal = JSON.parse(
		(
			await artifactStore.readCurrent(
				"pi-workflow",
				recovered.result.artifacts[0].topic,
			)
		).content,
	);
	assert.deepEqual(
		terminal.payload.progressBatches.map(({ batchKey, supersedes }) => ({
			batchKey,
			supersedes,
		})),
		[
			{ batchKey: "comparison-1", supersedes: undefined },
			{ batchKey: "comparison-2", supersedes: "comparison-1" },
			{ batchKey: "comparison-3", supersedes: "comparison-2" },
		],
	);
});

test("default packaged entry ignores legacy Owner environment and privately binds the authenticated user", async () => {
	const previousActorId = process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	const previousRevision = process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	process.env.PI_WORKFLOW_OWNER_ACTOR_ID = "legacy-environment-must-be-ignored";
	process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = "legacy-environment-r3";
	try {
		const { ctx, handlerCounts, handlers, tool } =
			await prepareProductionSpec();
		assert.equal("actor" in tool.parameters.properties, false);
		assert.equal("actorId" in tool.parameters.properties, false);
		assert.equal("authorityRevision" in tool.parameters.properties, false);
		assert.ok((handlerCounts.get("agent_settled") ?? 0) >= 3);

		await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
		const approvalPrompt = await handlers.get("before_agent_start")({
			systemPrompt: "base",
		});
		assert.match(approvalPrompt.systemPrompt, /spec-approved/);
		assert.match(approvalPrompt.systemPrompt, /publish_spec/);
		assert.match(approvalPrompt.systemPrompt, /same turn/);
		assert.match(
			approvalPrompt.systemPrompt,
			/do not ask for another human confirmation/i,
		);
		for (const event of [
			{ type: "input", text: "Apruebo.", source: "extension" },
			{
				type: "input",
				text: "Apruebo.",
				source: "interactive",
				streamingBehavior: "followUp",
			},
		]) {
			await handlers.get("input")(event, ctx);
			const refused = await tool.execute(
				"refused-approval",
				{ action: "approve_spec" },
				undefined,
				undefined,
				ctx,
			);
			assert.equal(refused.details.status, "blocked");
			assert.equal(
				refused.details.blocker.code,
				"PI_WORKFLOW_DECISION_CLAIM_MISSING",
			);
		}

		await handlers.get("input")(
			{ type: "input", text: "1", source: "interactive" },
			ctx,
		);
		assert.equal(
			await handlers.get("tool_call")(
				{ type: "tool_call", toolName: "workflow_define_product" },
				ctx,
			),
			undefined,
		);
		const approved = await tool.execute(
			"approval",
			{ action: "approve_spec" },
			undefined,
			undefined,
			ctx,
		);

		assert.equal(approved.details.status, "spec-approved");
		assert.equal(approved.details.approval.status, "approved");
		assert.equal(approved.details.approval.actor, undefined);
		assert.doesNotMatch(
			approved.content[0].text,
			/authorityRevision|digest|revision/,
		);
	} finally {
		if (previousActorId === undefined) {
			delete process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
		} else {
			process.env.PI_WORKFLOW_OWNER_ACTOR_ID = previousActorId;
		}
		if (previousRevision === undefined) {
			delete process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
		} else {
			process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = previousRevision;
		}
	}
});

test("default packaged approval requires no launch-host Owner authority", async () => {
	const previousActorId = process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	const previousRevision = process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	delete process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	delete process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	try {
		const { authorityLookupCount, ctx, handlerCounts, handlers, tool } =
			await prepareProductionSpec();
		assert.equal(authorityLookupCount, 1);
		assert.ok((handlerCounts.get("agent_settled") ?? 0) >= 3);
		await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
		await handlers.get("input")(
			{ type: "input", text: "1", source: "interactive" },
			ctx,
		);
		const outcome = await tool.execute(
			"approval-without-host-authority",
			{ action: "approve_spec" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(outcome.details.status, "spec-approved");
		assert.equal(outcome.details.approval.status, "approved");
	} finally {
		if (previousActorId === undefined)
			delete process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
		else process.env.PI_WORKFLOW_OWNER_ACTOR_ID = previousActorId;
		if (previousRevision === undefined)
			delete process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
		else process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = previousRevision;
	}
});

test("runtime authentication reservations reject reset, replacement, late duplicate, and concurrent result reuse", async (t) => {
	const user = {
		id: "owner-felipe",
		name: "Owner",
		isActive: true,
		isGuest: false,
	};
	const result = (toolCallId, value = user) => ({
		toolName: "linear_get_user",
		toolCallId,
		content: [{ type: "text", text: JSON.stringify(value) }],
		isError: false,
	});
	const call = (toolCallId) => ({
		toolName: "linear_get_user",
		toolCallId,
		input: { query: "me" },
	});

	await t.test("session reset", async () => {
		const { handlers } = loadExtension(productionSpecRuntimeOptions());
		const ctx = executionContext();
		await handlers.get("input")(
			{ text: "/define-product first", source: "interactive" },
			ctx,
		);
		assert.equal(
			await handlers.get("tool_call")(call("reused-reset"), ctx),
			undefined,
		);
		await handlers.get("session_start")({}, ctx);
		await handlers.get("input")(
			{ text: "/define-product after reset", source: "interactive" },
			ctx,
		);
		await handlers.get("tool_call")(call("reused-reset"), ctx);
		await handlers.get("tool_result")(result("reused-reset"), ctx);
		const prompt = await handlers.get("before_agent_start")(
			{ systemPrompt: "base" },
			ctx,
		);
		assert.match(prompt.systemPrompt, /call linear_get_user with only/i);
	});

	await t.test("active replacement and late duplicate", async () => {
		const { handlers, runtime } = loadAuthorityRuntime();
		runtime.handlePublicEntry({
			text: "/define-product first",
			source: "interactive",
		});
		assert.equal(await handlers.get("tool_call")(call("old-call")), undefined);
		runtime.handlePublicEntry({
			text: "/define-product replacement",
			source: "interactive",
		});
		assert.deepEqual(await handlers.get("tool_call")(call("old-call")), {
			block: true,
			reason: "PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
		});
		assert.equal(await handlers.get("tool_call")(call("new-call")), undefined);
		await handlers.get("tool_result")(result("old-call"));
		const pending = await handlers.get("before_agent_start")({
			systemPrompt: "base",
		});
		assert.match(pending.systemPrompt, /one pending linear_get_user result/i);
		await handlers.get("tool_result")(result("new-call"));
		await handlers.get("tool_result")(
			result("old-call", { ...user, id: "late-duplicate" }),
		);
		const authenticated = await handlers.get("before_agent_start")({
			systemPrompt: "base",
		});
		assert.doesNotMatch(authenticated.systemPrompt, /linear_get_user/);
		assert.doesNotMatch(
			authenticated.systemPrompt,
			/stop without approving or mutating/i,
		);
	});

	await t.test("concurrent duplicate results", async () => {
		const { handlers } = loadExtension(productionSpecRuntimeOptions());
		const ctx = executionContext();
		await handlers.get("input")(
			{ text: "/define-product concurrent", source: "interactive" },
			ctx,
		);
		assert.equal(
			await handlers.get("tool_call")(call("concurrent-call"), ctx),
			undefined,
		);
		await Promise.all([
			handlers.get("tool_result")(result("concurrent-call"), ctx),
			handlers.get("tool_result")(
				result("concurrent-call", { ...user, id: "duplicate-user" }),
				ctx,
			),
		]);
		const prompt = await handlers.get("before_agent_start")(
			{ systemPrompt: "base" },
			ctx,
		);
		assert.doesNotMatch(prompt.systemPrompt, /linear_get_user/);
		assert.doesNotMatch(
			prompt.systemPrompt,
			/stop without approving or mutating/i,
		);
	});
});

test("default define-product blocks inactive, guest, and malformed users after one lookup", async (t) => {
	for (const [name, user] of [
		[
			"inactive",
			{ id: "owner-felipe", name: "Owner", isActive: false, isGuest: false },
		],
		[
			"guest",
			{ id: "owner-felipe", name: "Owner", isActive: true, isGuest: true },
		],
		["malformed", { id: "owner-felipe", isActive: true, isGuest: false }],
	]) {
		await t.test(name, async () => {
			const { handlers } = loadExtension(productionSpecRuntimeOptions());
			const ctx = executionContext();
			await handlers.get("input")(
				{
					type: "input",
					text: "/define-product validar autoridad",
					source: "interactive",
				},
				ctx,
			);
			const prompt = await handlers.get("before_agent_start")({
				systemPrompt: "base",
			});
			assert.match(prompt.systemPrompt, /linear_get_user/);
			assert.equal(
				await handlers.get("tool_call")(
					{
						toolName: "linear_get_user",
						toolCallId: `define-invalid-${name}`,
						input: { query: "me" },
					},
					ctx,
				),
				undefined,
			);
			await handlers.get("tool_result")(
				{
					toolName: "linear_get_user",
					toolCallId: `define-invalid-${name}`,
					content: [{ type: "text", text: JSON.stringify(user) }],
					isError: false,
				},
				ctx,
			);
			const stopped = await handlers.get("before_agent_start")({
				systemPrompt: "base",
			});
			assert.match(stopped.systemPrompt, /stop without approving or mutating/i);
			assert.doesNotMatch(
				stopped.systemPrompt,
				/call linear_get_user with only/i,
			);
		});
	}
});

test("default define-product persists and restores exact approved-revision recovery through terminal publication", async () => {
	const artifactStore = createAtomicArtifactStore();
	const owner = {
		actorId: "owner-1",
		role: "Owner",
		authorityRevision: "authority-r1",
	};
	const issues = new Map([
		[
			"ILA-2317",
			{
				id: "ILA-2317",
				description: "Descripción anterior",
				updatedAt: "issue-r1",
				workflow: {
					state: "In Progress",
					assignee: "owner-1",
					cycle: "cycle-1",
					labels: ["workflow"],
					project: "pi-workflow",
				},
			},
		],
	]);
	const comments = new Map();
	const interactiveDecisionStore = createInMemoryDecisionStore();
	const linearApprovedRevision = {
		getIssue: async ({ id }) => structuredClone(issues.get(id)),
		listComments: async ({ issueId }) =>
			structuredClone(comments.get(issueId) ?? []),
		async saveComment({ issueId, body }) {
			const comment = {
				id: `comment-${(comments.get(issueId) ?? []).length + 1}`,
				body,
			};
			comments.set(issueId, [...(comments.get(issueId) ?? []), comment]);
			return structuredClone(comment);
		},
		async saveIssue({ id, description }) {
			const current = issues.get(id);
			const updated = {
				...current,
				description,
				updatedAt: `${current.updatedAt}:updated`,
			};
			issues.set(id, updated);
			return structuredClone(updated);
		},
	};
	const options = {
		artifactStore,
		checkpointStore: createInMemoryDelegationCheckpointStore(),
		linearApprovedRevision,
		authenticatedAuthority: { current: async () => owner },
		interactiveDecisionStore,
	};
	const initial = createDefaultDefineProductWorkflow(
		{},
		() => executionContext(),
		options,
	);
	const ready = await initial.advance({
		kind: "to-approved-revision",
		definitionId: "definition-1",
		revisionKind: "product-revision",
		affectedIssues: [
			{ id: "ILA-2317", nextDescription: "Descripción aprobada" },
		],
		sourceCommentKind: "product-revision",
		sourceCommentBody:
			"Revisión aprobada.\n\nReferencia de flujo: product-revision:{{digest}}",
	});
	assert.equal(ready.status, "revision-ready", JSON.stringify(ready));
	const digest = ready.revision.digest;

	const approvalRuntime = loadExtension(options);
	const approvalContext = executionContext();
	await approvalRuntime.handlers.get("session_start")({}, approvalContext);
	await authenticateOwner(approvalRuntime.handlers, approvalContext);
	const approvalPrompt = (
		await approvalRuntime.handlers.get("before_agent_start")(
			{ systemPrompt: "base" },
			approvalContext,
		)
	).systemPrompt;
	assert.doesNotMatch(approvalPrompt, new RegExp(digest));
	const wrongApproval = await approvalRuntime.tool.execute("wrong", {
		action: "approve_approved_revision",
		definitionId: "definition-1",
		digest: "0".repeat(64),
	});
	assert.equal(wrongApproval.details.status, "blocked");
	await approvalRuntime.handlers.get("input")(
		{ type: "input", text: "1", source: "interactive" },
		executionContext(),
	);
	const approved = await approvalRuntime.tool.execute("approve", {
		action: "approve_approved_revision",
	});
	assert.equal(
		approved.details.status,
		"revision-approved",
		JSON.stringify(approved.details),
	);
	assert.equal(approved.details.revision.digest, undefined);
	const approvalMarker = await artifactStore.readCurrent(
		"pi-workflow",
		"workflow/define-product/approved-revision-recovery",
	);
	const approvedDigest = JSON.parse(approvalMarker.content).digest;

	const publicationRuntime = loadExtension(options);
	const publicationContext = executionContext();
	await publicationRuntime.handlers.get("session_start")(
		{},
		publicationContext,
	);
	await authenticateOwner(publicationRuntime.handlers, publicationContext);
	const publicationPrompt = (
		await publicationRuntime.handlers.get("before_agent_start")(
			{ systemPrompt: "base" },
			publicationContext,
		)
	).systemPrompt;
	assert.doesNotMatch(publicationPrompt, new RegExp(approvedDigest));
	const wrongPublication = await publicationRuntime.tool.execute("wrong", {
		action: "publish_approved_revision",
		definitionId: "definition-1",
		digest: "f".repeat(64),
	});
	assert.equal(wrongPublication.details.status, "blocked");
	const published = await publicationRuntime.tool.execute("publish", {
		action: "publish_approved_revision",
	});
	assert.equal(
		published.details.status,
		"revision-published",
		JSON.stringify(published.details),
	);
	assert.equal(issues.get("ILA-2317").description, "Descripción aprobada");

	const terminal = createDefaultDefineProductWorkflow(
		{},
		() => executionContext(),
		options,
	);
	assert.equal(await terminal.restoreRecovery(), undefined);
	const marker = await artifactStore.readCurrent(
		"pi-workflow",
		"workflow/define-product/approved-revision-recovery",
	);
	assert.deepEqual(JSON.parse(marker.content), {
		definitionId: "definition-1",
		digest: approvedDigest,
		phase: "completed",
	});
});

test("default define-product to-tickets delegates exact refs, persists the graph, and returns tickets-ready", async () => {
	const artifactStore = createAtomicArtifactStore();
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
		decisions: [
			{
				id: "decision-1",
				status: "resolved",
				pertinent: true,
				text: "La descripción del Delivery parent conserva el Spec canónico.",
			},
		],
		tests: [
			"Verificar que la descripción publicada coincide con el Spec aprobado.",
		],
		outOfScope: ["Crear los Delivery tickets derivados."],
		supportArtifacts: [],
	});
	const approvedSnapshot = {
		spec,
		approval: createProductSpecApprovalEnvelope({
			spec,
			actor: {
				actorId: "owner-1",
				role: "Owner",
				authorityRevision: "authority-r1",
			},
		}),
	};
	const approvedTopic = "workflow/define-product/definition-1/approved-spec";
	const { revision: approvedRevision } = await artifactStore.write(
		"pi-workflow",
		approvedTopic,
		`${JSON.stringify(approvedSnapshot)}\n`,
		undefined,
	);
	const approved = { ...approvedSnapshot, sourceRevision: approvedRevision };
	const parent = {
		id: "parent-1",
		teamId: "team-1",
		revision: "spec-r1",
		specDigest: spec.digest,
	};
	const parentUnsigned = {
		schema: "delivery-parent",
		schemaVersion: 1,
		payload: parent,
	};
	const parentRef = await createWorkflowArtifactInterface(artifactStore)
		.openSession({
			project: { name: "pi-workflow", root: process.cwd() },
			topic: "workflow/define-product/definition-1/published-parent",
			schema: "delivery-parent",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		})
		.writeDeliveryParentSnapshot({
			...parentUnsigned,
			digest: digestCanonicalValue(parentUnsigned),
		});
	const approvedSpecRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: approvedTopic,
		revision: approvedRevision,
		schema: "approved-spec",
		schemaVersion: 1,
		digest: spec.digest,
	};
	const launches = [];
	const workflow = createDefaultDefineProductWorkflow(
		{},
		() => executionContext(),
		{
			artifactStore,
			checkpointStore: createInMemoryDelegationCheckpointStore(),
			approvedSpecReader: { read: async () => structuredClone(approved) },
			authenticatedAuthority: {
				current: async () => approved.approval.payload.actor,
			},
			ticketGraphExecutor: async (input) => {
				launches.push(input);
				assert.match(await input.readArtifact("approved-spec"), /product-spec/);
				assert.match(await input.readArtifact("delivery-parent"), /parent-1/);
				const graph = createDeliveryTicketGraph({
					parent,
					language: "es",
					coverage: createSpecCoverageIndex({
						stories: [
							{
								id: "story-1",
								contextId: "context-1",
								acceptanceCriteria: ["ac-1"],
							},
						],
						decisions: ["decision-1"],
						tests: ["test-1"],
					}),
					tickets: [
						{
							stableKey: "TICKET-1",
							title: "Entregar alcance",
							outcome: "Resultado verificable",
							acceptanceCriteria: [
								"Criterio uno",
								"Criterio dos",
								"Criterio tres",
								"Criterio cuatro",
							],
							estimate: { points: 1, rationale: "Trabajo acotado" },
							blockers: [],
							refs: [
								{ kind: "story", id: "story-1" },
								{ kind: "decision", id: "decision-1" },
								{ kind: "test", id: "test-1" },
							],
							deliveryBindings: [
								{
									storyId: "story-1",
									acceptanceCriterionId: "ac-1",
									contextId: "context-1",
								},
							],
						},
					],
				});
				await input.writeArtifact(graph);
				return { assistantText: "Ticket graph ready." };
			},
		},
	);
	const outcome = await workflow.advance({
		kind: "to-tickets",
		definitionId: "definition-1",
		approvedSpecRef,
		parentRef,
	});
	assert.equal(outcome.status, "tickets-ready", outcome.blocker?.message);
	assert.equal(launches.length, 1);
	assert.equal(launches[0].allowedTools.at(-1), "workflow_artifact_session");
	assert.deepEqual(outcome.graph.payload.parent, parent);
	const persisted = await artifactStore.readRevision(
		"pi-workflow",
		outcome.graphRef.topic,
		outcome.graphRef.revision,
	);
	assert.equal(JSON.parse(persisted).digest, outcome.graph.digest);
});

test("explicit legacy gateway compatibility publishes the Engram-approved body", async () => {
	const originalFetch = globalThis.fetch;
	const previousLinearKey = process.env.LINEAR_API_KEY;
	const previousLinearUrl = process.env.LINEAR_API_URL;
	process.env.LINEAR_API_KEY = "linear-key";
	process.env.LINEAR_API_URL = "https://linear.test/graphql";
	const observations = new Map();
	let observationId = 0;
	let manifest;
	let manifestRevision = 0;
	let parent;
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		if (url.hostname === "linear.test") {
			assert.equal(init.headers.Authorization, "linear-key");
			const request = JSON.parse(String(init.body));
			if (request.operationName === "DeliveryParentPreflight") {
				return Response.json({
					data: {
						viewer: { id: "owner-felipe" },
						team: {
							id: "team-grupo-ilao",
							cyclesEnabled: true,
							states: {
								nodes: [
									{
										id: "backlog-1",
										type: "backlog",
										updatedAt: "2026-07-14T00:00:00.000Z",
									},
								],
							},
						},
					},
				});
			}
			if (request.operationName === "DeliveryParentCreate") {
				parent = {
					id: "linear-parent-1",
					team: { id: request.variables.input.teamId },
					title: request.variables.input.title,
					description: request.variables.input.description,
					state: { id: "backlog-1", type: "backlog" },
					cycle: null,
					assignee: null,
				};
				return Response.json({
					data: { issueCreate: { success: true, issue: parent } },
				});
			}
			return Response.json({ data: { issue: parent } });
		}
		if (url.pathname === "/sessions" && init.method === "POST")
			return Response.json({});
		if (url.pathname === "/observations" && (init.method ?? "GET") === "GET") {
			const key = `${url.searchParams.get("project")}:${url.searchParams.get("topic_key")}`;
			const current = observations.get(key);
			return Response.json(current ? [current] : []);
		}
		if (url.pathname === "/search") {
			const current = observations.get(
				`${url.searchParams.get("project")}:${url.searchParams.get("q")}`,
			);
			return Response.json(current ? [current] : []);
		}
		if (url.pathname === "/observations" && init.method === "POST") {
			const body = JSON.parse(String(init.body));
			observationId += 1;
			const stored = { id: observationId, ...body };
			observations.set(`${body.project}:${body.topic_key}`, stored);
			observations.set(String(observationId), stored);
			return Response.json({ id: observationId });
		}
		if (url.pathname.startsWith("/observations/")) {
			return Response.json(observations.get(url.pathname.split("/").at(-1)));
		}
		throw new Error(`Unexpected Engram request: ${url}`);
	};
	try {
		const { ctx, handlers, ready, tool } = await prepareProductionSpec({
			approvedSpecReader: undefined,
			linearDeliveryParents: createLinearDeliveryParentGateway(
				createRuntimeLinearDeliveryParentTransport({
					apiKey: "linear-key",
					url: "https://linear.test/graphql",
				}),
			),
			authenticatedAuthority: {
				current: async () => ({
					actorId: "owner-felipe",
					role: "Owner",
					authorityRevision: "owner-policy-r3",
				}),
			},
			publicationManifest: {
				create: (value) => ({ ...value, digest: digestCanonicalValue(value) }),
				load: async () =>
					manifest && {
						revision: String(manifestRevision),
						value: structuredClone(manifest),
					},
				save: async (value, expectedRevision) => {
					assert.equal(
						expectedRevision,
						manifest ? String(manifestRevision) : undefined,
					);
					manifest = structuredClone(value);
					manifestRevision += 1;
					return String(manifestRevision);
				},
			},
		});
		await handlers.get("input")(
			{ type: "input", text: "1", source: "interactive" },
			ctx,
		);
		const approved = await tool.execute(
			"approval",
			{ action: "approve_spec" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(approved.details.status, "spec-approved");
		const published = await tool.execute(
			"publication",
			{ action: "publish_spec" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(
			published.details.status,
			"spec-published",
			JSON.stringify(published.details),
		);
		assert.equal(parent.description, ready.details.spec.body);
		assert.equal(manifest.stage, "verified");
	} finally {
		globalThis.fetch = originalFetch;
		if (previousLinearKey === undefined) delete process.env.LINEAR_API_KEY;
		else process.env.LINEAR_API_KEY = previousLinearKey;
		if (previousLinearUrl === undefined) delete process.env.LINEAR_API_URL;
		else process.env.LINEAR_API_URL = previousLinearUrl;
	}
});

test("injected authenticated authority blocks mismatched Spec approval after one user lookup", async () => {
	const policy = {
		actorId: "compatibility-owner",
		role: "Owner",
		authorityRevision: "compatibility-r1",
	};
	let persistedApprovals = 0;
	const { authorityLookupCount, ctx, handlers, tool } =
		await prepareProductionSpec({
			authenticatedAuthority: { current: async () => policy },
			approvedSpecReader: {
				read: async () => {
					throw new Error("No approved Spec should exist.");
				},
				save: async () => {
					persistedApprovals += 1;
					throw new Error("A mismatched approval must not be persisted.");
				},
			},
		});
	await handlers.get("input")(
		{ type: "input", text: "1", source: "interactive" },
		ctx,
	);
	const outcome = await tool.execute(
		"policy-approval",
		{ action: "approve_spec" },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(outcome.details.status, "blocked");
	assert.equal(
		outcome.details.blocker.code,
		"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
	);
	assert.equal(persistedApprovals, 0);
	assert.equal(authorityLookupCount, 1);
});

test("default define-product uses one user lookup and ignores LINEAR_API_KEY and legacy Owner environment", async () => {
	const previousActorId = process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	const previousRevision = process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	const previousLinearKey = process.env.LINEAR_API_KEY;
	delete process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	delete process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	process.env.LINEAR_API_KEY = "must-not-be-read";
	try {
		const { authorityLookupCount, ctx, handlers, ready, tool } =
			await prepareProductionSpec(
				{ artifactStore: createAtomicArtifactStore() },
				{ teamId: "team-1" },
			);
		await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
		await handlers.get("input")(
			{ type: "input", text: "1", source: "interactive" },
			ctx,
		);
		const approved = await tool.execute(
			"approve-mcp",
			{ action: "approve_spec" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(approved.details.status, "spec-approved");

		const emitResult = (toolName, toolCallId, payload, isError = false) =>
			handlers.get("tool_result")(
				{
					toolName,
					toolCallId,
					content: [{ type: "text", text: JSON.stringify(payload) }],
					isError,
				},
				ctx,
			);
		let sequence = 0;
		const mcpCalls = [];
		async function mcp(toolName, input, payload) {
			sequence += 1;
			const toolCallId = `define-mcp-${sequence}`;
			const event = { toolName, toolCallId, input: structuredClone(input) };
			const blocked = await handlers.get("tool_call")(event, ctx);
			assert.equal(blocked, undefined, JSON.stringify(blocked));
			mcpCalls.push({ toolName, input: structuredClone(event.input) });
			await emitResult(toolName, toolCallId, payload);
			return event;
		}

		const initialEvent = {
			toolName: "workflow_define_product",
			toolCallId: "publish-mcp-start",
			input: { action: "publish_spec" },
		};
		assert.equal(await handlers.get("tool_call")(initialEvent, ctx), undefined);
		const continuing = await tool.execute(
			initialEvent.toolCallId,
			initialEvent.input,
			undefined,
			undefined,
			ctx,
		);
		assert.deepEqual(continuing.details, { status: "continuing" });
		const continuation = await emitResult(
			initialEvent.toolName,
			initialEvent.toolCallId,
			continuing.details,
		);
		assert.match(continuation.content.at(-1).text, /linear_list_teams/);

		await mcp(
			"linear_list_teams",
			{ limit: 250, orderBy: "updatedAt", includeArchived: false },
			{
				teams: [{ id: "team-1", name: "Grupo ilao" }],
				hasNextPage: false,
			},
		);
		await mcp(
			"linear_list_issue_statuses",
			{ team: "team-1" },
			{ statuses: [{ id: "backlog-1", name: "Backlog", type: "backlog" }] },
		);
		const candidateInput = {
			team: "team-1",
			query: ready.details.spec.target.title,
			limit: 250,
			orderBy: "updatedAt",
			includeArchived: false,
			fields: [
				"id",
				"title",
				"description",
				"status",
				"statusType",
				"assigneeId",
				"teamId",
				"cycleId",
			],
		};
		await mcp("linear_list_issues", candidateInput, {
			issues: [],
			hasNextPage: false,
		});
		const issue = {
			id: "linear-parent-1",
			identifier: "ILA-3000",
			team: { id: "team-1", name: "Grupo ilao" },
			title: ready.details.spec.target.title,
			description: ready.details.spec.body,
			status: { id: "backlog-1", name: "Backlog", type: "backlog" },
			assignee: null,
			assigneeId: null,
			cycle: null,
			cycleId: null,
		};
		await mcp(
			"linear_save_issue",
			{
				team: "team-1",
				title: "PI_WORKFLOW_CANONICAL_DELIVERY_PARENT_TITLE",
				description: "PI_WORKFLOW_CANONICAL_DELIVERY_PARENT_DESCRIPTION",
				state: "backlog-1",
			},
			issue,
		);
		await mcp(
			"linear_get_issue",
			{ id: issue.id, includeRelations: true },
			issue,
		);
		await mcp("linear_list_issues", candidateInput, {
			issues: [issue],
			hasNextPage: false,
		});

		const terminalEvent = {
			toolName: "workflow_define_product",
			toolCallId: "publish-mcp-terminal",
			input: { action: "publish_spec" },
		};
		assert.equal(
			await handlers.get("tool_call")(terminalEvent, ctx),
			undefined,
		);
		const published = await tool.execute(
			terminalEvent.toolCallId,
			terminalEvent.input,
			undefined,
			undefined,
			ctx,
		);
		assert.deepEqual(published.details, {
			status: "spec-published",
			parent: {
				id: issue.id,
				teamId: "team-1",
				title: issue.title,
				description: issue.description,
				state: "Backlog",
				cycleId: null,
				assigneeId: null,
			},
		});
		assert.doesNotMatch(
			published.content[0].text,
			/digest|revision|publicationKey|parentRef/,
		);
		assert.equal(authorityLookupCount, 1);
		assert.equal(
			mcpCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
			0,
		);
		assert.equal(
			mcpCalls.filter(({ toolName }) => toolName === "linear_save_issue")
				.length,
			1,
		);
		assert.deepEqual(
			mcpCalls.find(({ toolName }) => toolName === "linear_save_issue").input,
			{
				team: "team-1",
				title: issue.title,
				description: issue.description,
				state: "backlog-1",
			},
		);
	} finally {
		if (previousActorId === undefined)
			delete process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
		else process.env.PI_WORKFLOW_OWNER_ACTOR_ID = previousActorId;
		if (previousRevision === undefined)
			delete process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
		else process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = previousRevision;
		if (previousLinearKey === undefined) delete process.env.LINEAR_API_KEY;
		else process.env.LINEAR_API_KEY = previousLinearKey;
	}
});

test("default packaged define-product routes publish_tickets to MCP when no native ticket gateway is injected", async () => {
	let active = false;
	const calls = [];
	const ticketMcpPublication = {
		allowedTools: [
			"linear_get_user",
			"linear_get_issue",
			"linear_list_issue_statuses",
			"linear_list_issues",
			"linear_save_issue",
			"workflow_define_product",
		],
		setMcpAvailable() {},
		clear() {
			active = false;
		},
		hasActiveTurn: () => active,
		begin: async (definitionId, toolCallId, input) => {
			active = true;
			calls.push({ definitionId, toolCallId, input });
			return { status: "continuing" };
		},
		complete: async () => ({
			status: "blocked",
			blocker: { code: "unused", message: "unused" },
		}),
		expectedModelCall: () =>
			active
				? { toolName: "linear_get_user", input: { query: "me" } }
				: undefined,
		nextCallInstruction: () => undefined,
		handleToolCall: async () => undefined,
		handleToolResult: async () => false,
	};
	const workflow = createDefaultDefineProductWorkflow({}, () => undefined, {
		artifactStore: createAtomicArtifactStore(),
		checkpointStore: createInMemoryDelegationCheckpointStore(),
		ticketMcpPublication,
	});
	assert.equal(workflow.ticketMcpPublication, ticketMcpPublication);
	assert.equal("linearDeliveryTickets" in workflow, false);

	const nativeGateway = {
		readAuthoritySnapshot: async () => ({}),
		findChildren: async () => [],
		findBlockers: async () => [],
		createChild: async () => ({}),
		createBlocker: async () => {},
		readBack: async () => ({}),
	};
	const compatible = createDefaultDefineProductWorkflow({}, () => undefined, {
		artifactStore: createAtomicArtifactStore(),
		checkpointStore: createInMemoryDelegationCheckpointStore(),
		linearDeliveryTickets: nativeGateway,
		ticketMcpPublication,
	});
	assert.equal(compatible.ticketMcpPublication, undefined);
	assert.deepEqual(calls, []);
});

test("default define-product restores approved ticket publication across sandbox roots and routes action-only publication to MCP", async () => {
	const previousCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousAgentHome = process.env.PI_AGENT_HOME;
	const sandboxOne = await mkdtemp(
		join(tmpdir(), "pi-workflow-ticket-recovery-one-"),
	);
	const sandboxTwo = await mkdtemp(
		join(tmpdir(), "pi-workflow-ticket-recovery-two-"),
	);
	const artifactStore = createAtomicArtifactStore();
	const definitionId = "definition-1";
	const actor = {
		actorId: "owner-1",
		role: "Owner",
		authorityRevision: "authority-r1",
	};
	const spec = createProductSpecEnvelope({
		definitionId,
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Publicación recuperable",
		},
		revision: "spec-r1",
		problem: "La aprobación no sobrevive al reemplazo del sandbox.",
		solution: "La continuación aprobada se conserva en Engram.",
		userStories: ["Como Owner, quiero publicar los tickets ya aprobados."],
		decisions: [
			{
				id: "decision-1",
				status: "resolved",
				pertinent: true,
				text: "La publicación se reanuda sin identidad suministrada por el agente.",
			},
		],
		tests: ["Verificar la recuperación entre sandboxes."],
		outOfScope: ["Buscar otras definiciones pendientes."],
		supportArtifacts: [],
	});
	const approval = createProductSpecApprovalEnvelope({ spec, actor });
	const approved = { spec, approval, sourceRevision: "approved-r1" };
	const approvedSpecRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: `workflow/define-product/${definitionId}/approved-spec`,
		revision: approved.sourceRevision,
		schema: "approved-spec",
		schemaVersion: 1,
		digest: spec.digest,
	};
	const parent = {
		id: "ILA-2436",
		teamId: "team-1",
		revision: "parent-r1",
		specDigest: spec.digest,
	};
	const parentUnsigned = {
		schema: "delivery-parent",
		schemaVersion: 1,
		payload: parent,
	};
	const parentRef = await createWorkflowArtifactInterface(artifactStore)
		.openSession({
			project: { name: "pi-workflow", root: process.cwd() },
			topic: `workflow/define-product/${definitionId}/published-parent`,
			schema: "delivery-parent",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		})
		.writeDeliveryParentSnapshot({
			...parentUnsigned,
			digest: digestCanonicalValue(parentUnsigned),
		});
	const graph = createDeliveryTicketGraph({
		parent,
		language: "es",
		coverage: createSpecCoverageIndex({
			stories: [
				{
					id: "story-1",
					contextId: "delivery",
					acceptanceCriteria: ["ac-1"],
				},
			],
			decisions: ["decision-1"],
			tests: ["test-1"],
		}),
		tickets: [
			{
				stableKey: "T-1",
				title: "Restaurar publicación",
				outcome: "La publicación aprobada se restaura.",
				acceptanceCriteria: ["Uno", "Dos", "Tres", "Cuatro"],
				estimate: { points: 1, rationale: "Cambio acotado" },
				blockers: [],
				refs: [
					{ kind: "story", id: "story-1" },
					{ kind: "decision", id: "decision-1" },
					{ kind: "test", id: "test-1" },
				],
				deliveryBindings: [
					{
						storyId: "story-1",
						acceptanceCriterionId: "ac-1",
						contextId: "delivery",
					},
				],
			},
		],
	});
	try {
		process.env.PI_CODING_AGENT_DIR = sandboxOne;
		delete process.env.PI_AGENT_HOME;
		const first = createDefaultDefineProductWorkflow(
			{},
			() => executionContext(),
			{
				artifactStore,
				checkpointStore: createInMemoryDelegationCheckpointStore(),
				approvedSpecReader: { read: async () => structuredClone(approved) },
				authenticatedAuthority: { current: async () => actor },
				ticketGraphExecutor: async (input) => {
					await input.writeArtifact(graph);
					return { assistantText: "Ticket graph ready." };
				},
			},
		);
		const ready = await first.advance({
			kind: "to-tickets",
			definitionId,
			approvedSpecRef,
			parentRef,
		});
		assert.equal(ready.status, "tickets-ready", ready.blocker?.message);
		const approvedTickets = await first.advance({
			kind: "approve-tickets",
			definitionId,
			parentRef,
			graphRef: ready.graphRef,
			digest: ready.graph.digest,
		});
		assert.equal(
			approvedTickets.status,
			"tickets-approved",
			approvedTickets.blocker?.message,
		);

		process.env.PI_CODING_AGENT_DIR = sandboxTwo;
		const second = loadExtension({
			artifactStore,
			approvedSpecReader: { read: async () => structuredClone(approved) },
		});
		const secondContext = executionContext();
		await second.handlers.get("session_start")({}, secondContext);
		await authenticateOwner(second.handlers, secondContext);
		await second.handlers.get("before_agent_start")(
			{ systemPrompt: "base" },
			secondContext,
		);
		await second.handlers.get("input")(
			{ type: "input", text: "1", source: "interactive" },
			secondContext,
		);
		const startEvent = {
			toolName: "workflow_define_product",
			toolCallId: "cross-sandbox-publication",
			input: { action: "publish_tickets" },
		};
		assert.equal(
			await second.handlers.get("tool_call")(startEvent, secondContext),
			undefined,
		);
		const publication = await second.tool.execute(
			startEvent.toolCallId,
			startEvent.input,
			undefined,
			undefined,
			secondContext,
		);
		assert.deepEqual(publication.details, { status: "continuing" });
		const continuation = await second.handlers.get("tool_result")(
			{
				...startEvent,
				content: [{ type: "text", text: JSON.stringify(publication.details) }],
				isError: false,
			},
			secondContext,
		);
		assert.match(continuation.content.at(-1).text, /linear_get_issue/);

		let sequence = 0;
		const mcpCalls = [];
		async function call(toolName, input) {
			sequence += 1;
			const event = {
				toolName,
				toolCallId: `cross-sandbox-${sequence}`,
				input: structuredClone(input),
			};
			assert.equal(
				await second.handlers.get("tool_call")(event, secondContext),
				undefined,
			);
			mcpCalls.push({ toolName, input: structuredClone(event.input) });
			return event;
		}
		async function result(event, payload) {
			await second.handlers.get("tool_result")(
				{
					toolName: event.toolName,
					toolCallId: event.toolCallId,
					content: [{ type: "text", text: JSON.stringify(payload) }],
					isError: false,
				},
				secondContext,
			);
		}
		async function mcp(toolName, input, payload) {
			const event = await call(toolName, input);
			await result(event, payload);
			return event;
		}

		const issueFields = [
			"id",
			"title",
			"description",
			"estimate",
			"status",
			"statusType",
			"assigneeId",
			"cycleId",
			"labels",
			"projectId",
			"parentId",
			"teamId",
		];
		const parentIssue = {
			id: parent.id,
			teamId: parent.teamId,
			title: spec.payload.target.title,
			description: spec.payload.body,
			updatedAt: parent.revision,
			status: { id: "backlog-1", name: "Backlog", type: "backlog" },
			assigneeId: null,
			cycleId: null,
		};
		await mcp(
			"linear_get_issue",
			{ id: parent.id, includeRelations: true },
			parentIssue,
		);
		await mcp("linear_list_issue_statuses", { team: parent.teamId }, [
			{ id: "backlog-1", name: "Backlog", type: "backlog" },
		]);
		await mcp(
			"linear_list_issues",
			{
				team: parent.teamId,
				parentId: parent.id,
				query: "Restaurar publicación",
				limit: 250,
				orderBy: "updatedAt",
				includeArchived: false,
				fields: issueFields,
			},
			{ issues: [], hasNextPage: false },
		);
		await mcp(
			"linear_get_issue",
			{ id: parent.id, includeRelations: true },
			parentIssue,
		);
		const save = await call("linear_save_issue", {
			team: parent.teamId,
			parentId: parent.id,
			title: "PI_WORKFLOW_CANONICAL_DELIVERY_TICKET_TITLE",
			description: "PI_WORKFLOW_CANONICAL_DELIVERY_TICKET_BODY",
			estimate: 1,
			state: "backlog-1",
			assignee: null,
			cycle: null,
			labels: [],
			project: null,
		});
		const child = {
			id: "ILA-2437",
			teamId: parent.teamId,
			parentId: parent.id,
			title: save.input.title,
			description: save.input.description,
			estimate: 1,
			status: { id: "backlog-1", name: "Backlog", type: "backlog" },
			assigneeId: null,
			cycleId: null,
			labels: [],
			projectId: null,
		};
		await result(save, child);
		await mcp(
			"linear_get_issue",
			{ id: child.id, includeRelations: true },
			child,
		);
		await mcp(
			"linear_get_issue",
			{ id: parent.id, includeRelations: true },
			parentIssue,
		);
		await mcp(
			"linear_list_issues",
			{
				team: parent.teamId,
				parentId: parent.id,
				limit: 250,
				orderBy: "updatedAt",
				includeArchived: false,
				fields: issueFields,
			},
			{ issues: [child], hasNextPage: false },
		);
		await mcp(
			"linear_get_issue",
			{ id: child.id, includeRelations: true },
			{ ...child, relations: { blockedBy: [], blocks: [] } },
		);
		const terminalEvent = {
			toolName: "workflow_define_product",
			toolCallId: "cross-sandbox-terminal",
			input: { action: "publish_tickets" },
		};
		assert.equal(
			await second.handlers.get("tool_call")(terminalEvent, secondContext),
			undefined,
		);
		const terminal = await second.tool.execute(
			terminalEvent.toolCallId,
			terminalEvent.input,
			undefined,
			undefined,
			secondContext,
		);
		assert.deepEqual(terminal.details, { status: "tickets-published" });
		assert.equal(
			mcpCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
			0,
		);
		assert.equal(
			mcpCalls.filter(({ toolName }) => toolName === "linear_save_issue")
				.length,
			1,
		);
	} finally {
		if (previousCodingAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousCodingAgentDir;
		}
		if (previousAgentHome === undefined) delete process.env.PI_AGENT_HOME;
		else process.env.PI_AGENT_HOME = previousAgentHome;
		await Promise.all([
			rm(sandboxOne, { recursive: true, force: true }),
			rm(sandboxTwo, { recursive: true, force: true }),
		]);
	}
});

test("default public publish_tickets uses canonical Engram re-reads before mutations", async () => {
	const originalFetch = globalThis.fetch;
	const observations = new Map();
	let revision = 0;
	const definitionId = "definition-tickets";
	const parent = {
		id: "parent-1",
		teamId: "team-1",
		revision: "parent-r1",
		specDigest: "spec-digest",
	};
	const spec = createProductSpecEnvelope({
		definitionId,
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Delivery",
		},
		revision: "parent-r1",
		problem: "Problema exacto",
		solution: "Solución exacta",
		userStories: ["Como Owner, quiero publicar tickets exactos."],
		decisions: [
			{
				id: "decision-1",
				status: "resolved",
				pertinent: true,
				text: "El grafo aprobado es canónico.",
			},
		],
		tests: ["Verificar publicación exacta."],
		outOfScope: ["Delegación."],
		supportArtifacts: [],
	});
	parent.specDigest = spec.digest;
	const graph = createDeliveryTicketGraph({
		parent,
		language: "es",
		coverage: createSpecCoverageIndex({
			stories: [
				{
					id: "story-1",
					contextId: "delivery",
					acceptanceCriteria: ["ac-1", "ac-2"],
				},
			],
			decisions: ["decision-1"],
			tests: ["test-1"],
		}),
		tickets: [
			{
				stableKey: "T-1",
				title: "Primero",
				outcome: "Primer resultado",
				acceptanceCriteria: ["Uno", "Dos", "Tres", "Cuatro"],
				estimate: { points: 1, rationale: "Pequeño" },
				blockers: [],
				refs: [
					{ kind: "story", id: "story-1" },
					{ kind: "decision", id: "decision-1" },
					{ kind: "test", id: "test-1" },
				],
				deliveryBindings: [
					{
						storyId: "story-1",
						acceptanceCriterionId: "ac-1",
						contextId: "delivery",
					},
				],
			},
			{
				stableKey: "T-2",
				title: "Segundo",
				outcome: "Segundo resultado",
				acceptanceCriteria: ["Uno", "Dos", "Tres", "Cuatro"],
				estimate: { points: 2, rationale: "Pequeño" },
				blockers: ["T-1"],
				refs: [
					{ kind: "story", id: "story-1" },
					{ kind: "decision", id: "decision-1" },
					{ kind: "test", id: "test-1" },
				],
				deliveryBindings: [
					{
						storyId: "story-1",
						acceptanceCriterionId: "ac-2",
						contextId: "delivery",
					},
				],
			},
		],
	});
	const owner = {
		actorId: "owner-1",
		role: "Owner",
		authorityRevision: "authority-r1",
	};
	const approval = createTicketGraphApproval({ graph, actor: owner });
	const put = (topic, content) => {
		const stored = {
			id: ++revision,
			project: "pi-workflow",
			topic_key: topic,
			content,
		};
		observations.set(`pi-workflow:${topic}`, stored);
		observations.set(String(stored.id), stored);
		return String(stored.id);
	};
	const specTopic = `workflow/define-product/${definitionId}/approved-spec`;
	const graphTopic = `workflow/define-product/${definitionId}/approved-ticket-graph/${graph.digest}`;
	const specRevision = put(
		specTopic,
		JSON.stringify({
			spec,
			approval: createProductSpecApprovalEnvelope({ spec, actor: owner }),
		}),
	);
	const parentTopic = `workflow/define-product/${definitionId}/published-parent`;
	const parentUnsigned = {
		schema: "delivery-parent",
		schemaVersion: 1,
		payload: parent,
	};
	const parentRevision = put(
		parentTopic,
		`${canonicalJson({ ...parentUnsigned, digest: digestCanonicalValue(parentUnsigned) })}\n`,
	);
	const graphRevision = put(graphTopic, `${canonicalJson(graph)}\n`);
	const publication = {
		definitionId,
		approvedSpecRef: {
			kind: "engram",
			project: "pi-workflow",
			topic: specTopic,
			revision: specRevision,
			schema: "approved-spec",
			schemaVersion: 1,
			digest: spec.digest,
		},
		parentRef: {
			kind: "engram",
			project: "pi-workflow",
			topic: parentTopic,
			revision: parentRevision,
			schema: "delivery-parent",
			schemaVersion: 1,
			digest: digestCanonicalValue(parentUnsigned),
		},
		graphRef: {
			kind: "engram",
			project: "pi-workflow",
			topic: graphTopic,
			revision: graphRevision,
			schema: "delivery-ticket-graph",
			schemaVersion: 1,
			digest: graph.digest,
		},
		graphParent: parent,
		approval,
	};
	const unsigned = {
		schema: "approved-ticket-publication",
		schemaVersion: 1,
		payload: publication,
	};
	put(
		`workflow/define-product/${definitionId}/approved-ticket-publication`,
		`${canonicalJson({ ...unsigned, digest: digestCanonicalValue(unsigned) })}\n`,
	);
	let stale = false;
	let recovery = {
		definitionId,
		approvedSpecRef: publication.approvedSpecRef,
		parentRef: publication.parentRef,
		graphRef: publication.graphRef,
		digest: graph.digest,
		authority: owner,
	};
	const mutations = [];
	const linearDeliveryTickets = {
		readAuthoritySnapshot: async (input) => ({
			...input,
			authorityRevision: input.authorityRevision,
			requiredCapabilities: [
				"sub-issues",
				"native-blockers",
				"estimates",
				"triage-state",
			],
			mutationPermission: true,
			state: { parent: "compatible", team: "compatible" },
		}),
		findChildren: async () => [],
		findBlockers: async () => [],
		createChild: async ({ child }) => {
			mutations.push(`child:${child.stableKey}`);
			return { stableKey: child.stableKey, linearId: child.stableKey };
		},
		createBlocker: async ({ blockedStableKey }) => {
			mutations.push(`edge:${blockedStableKey}`);
		},
		readBack: async () => ({
			parent: {
				id: parent.id,
				teamId: parent.teamId,
				revision: parent.revision,
			},
			children: graph.payload.tickets.map((ticket) => ({
				stableKey: ticket.stableKey,
				title: ticket.title,
				body: `Resultado\n\n${ticket.outcome}\n\nCriterios de aceptación\n\n${ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
				estimate: ticket.estimate.points,
				workflow: {
					state: "Triage",
					assignee: null,
					cycle: null,
					labels: [],
					project: null,
				},
				linearId: ticket.stableKey,
				blockedBy: ticket.blockers,
				blocks: ticket.stableKey === "T-1" ? ["T-2"] : [],
			})),
		}),
	};
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		if (url.pathname === "/sessions" && init.method === "POST")
			return Response.json({});
		if (url.pathname === "/observations" && (init.method ?? "GET") === "GET")
			return Response.json(
				observations.get(
					`${url.searchParams.get("project")}:${url.searchParams.get("topic_key")}`,
				)
					? [
							observations.get(
								`${url.searchParams.get("project")}:${url.searchParams.get("topic_key")}`,
							),
						]
					: [],
			);
		if (url.pathname === "/observations" && init.method === "POST") {
			const body = JSON.parse(String(init.body));
			const current = observations.get(`${body.project}:${body.topic_key}`);
			if (
				(current?.id && String(current.id)) !==
				(body.expected_revision ?? undefined)
			)
				return new Response("conflict", { status: 409 });
			const stored = { id: ++revision, ...body };
			observations.set(`${body.project}:${body.topic_key}`, stored);
			observations.set(String(stored.id), stored);
			return Response.json({ id: stored.id });
		}
		if (url.pathname === "/search") {
			const topic = url.searchParams.get("q")?.toLowerCase();
			const project = url.searchParams.get("project");
			const unique = new Map(
				[...observations.values()].map((item) => [item.id, item]),
			);
			return Response.json(
				[...unique.values()].filter(
					(item) =>
						item.project === project && item.topic_key.toLowerCase() === topic,
				),
			);
		}
		return Response.json(observations.get(url.pathname.split("/").at(-1)));
	};
	try {
		const { handlers, tool } = loadExtension({
			ticketApprovalRecoveryStore: {
				load: async () => recovery,
				save: async (value) => {
					recovery = value;
				},
				clear: async () => {
					recovery = undefined;
				},
			},
			authenticatedAuthority: {
				current: async () =>
					stale ? { ...owner, authorityRevision: "authority-r2" } : owner,
			},
			linearDeliveryTickets,
		});
		await handlers.get("session_start")({}, executionContext());
		stale = true;
		const injected = await tool.execute(
			"injected",
			{
				action: "publish_tickets",
				definitionId,
				authority: { actorId: "attacker" },
			},
			undefined,
			undefined,
			executionContext(),
		);
		assert.equal(
			injected.details.blocker.code,
			"PI_WORKFLOW_TICKET_APPROVAL_MISMATCH",
		);
		const blocked = await tool.execute(
			"stale",
			{ action: "publish_tickets" },
			undefined,
			undefined,
			executionContext(),
		);
		assert.equal(
			blocked.details.blocker.code,
			"PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT",
		);
		assert.deepEqual(mutations, []);
		stale = false;
		const published = await tool.execute(
			"published",
			{ action: "publish_tickets" },
			undefined,
			undefined,
			executionContext(),
		);
		assert.equal(
			published.details.status,
			"tickets-published",
			JSON.stringify(published.details),
		);
		assert.deepEqual(mutations, ["child:T-1", "child:T-2", "edge:T-2"]);
		assert.equal(recovery.definitionId, definitionId);
		assert.equal(recovery.digest, graph.digest);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("default packaged entry ignores incomplete legacy Owner environment", async () => {
	const previousActorId = process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	const previousRevision = process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	process.env.PI_WORKFLOW_OWNER_ACTOR_ID = "owner-felipe";
	process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = "   ";
	try {
		const { ctx, handlers, tool } = await prepareProductionSpec();
		await handlers.get("input")(
			{ type: "input", text: "1", source: "interactive" },
			ctx,
		);
		const outcome = await tool.execute(
			"approval-with-invalid-config",
			{ action: "approve_spec" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(outcome.details.status, "spec-approved");
	} finally {
		if (previousActorId === undefined) {
			delete process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
		} else {
			process.env.PI_WORKFLOW_OWNER_ACTOR_ID = previousActorId;
		}
		if (previousRevision === undefined) {
			delete process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
		} else {
			process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = previousRevision;
		}
	}
});

test("production runtime preserves pending Spec, active turn, and authority after blocked to-spec retries", async () => {
	const ownerAuthority = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const { ctx, handlers, ready, tool } = await prepareProductionSpec({
		authenticatedAuthority: { current: async () => ownerAuthority },
	});

	const malformed = await tool.execute(
		"malformed-retry",
		productionSpecRequest({ teamId: undefined }),
		undefined,
		undefined,
		ctx,
	);
	assert.equal(malformed.details.status, "blocked");
	assert.equal(
		malformed.details.blocker.code,
		"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
	);

	const blocked = await tool.execute(
		"blocked-retry",
		productionSpecRequest({
			problem:
				'El equipo puede revisar <?xml version="1.0"?> antes de publicar.',
		}),
		undefined,
		undefined,
		ctx,
	);
	assert.equal(blocked.details.status, "blocked");
	assert.equal(
		blocked.details.blocker.code,
		"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
	);
	const prompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(prompt.systemPrompt, /approve_spec/);

	await handlers.get("input")(
		{ type: "input", text: "1", source: "interactive" },
		ctx,
	);
	const approved = await tool.execute(
		"approval-after-retries",
		{ action: "approve_spec" },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(approved.details.status, "spec-approved");
	assert.deepEqual(approved.details.spec, ready.details.spec);
	assert.equal(approved.details.approval.status, "approved");
	assert.equal(approved.details.approval.actor, undefined);
});

test("Owner feedback revises a ready Spec without repeating known target context", async () => {
	const ownerAuthority = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const { ctx, handlers, ready, tool } = await prepareProductionSpec({
		authenticatedAuthority: { current: async () => ownerAuthority },
	});

	await handlers.get("input")(
		{
			type: "input",
			text: "Ctrl+O es un único toggle; ajusta la Spec.",
			source: "interactive",
		},
		ctx,
	);
	const revisionPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(revisionPrompt.systemPrompt, /feedback on the ready Spec/i);
	assert.match(
		revisionPrompt.systemPrompt,
		/reuse the exact privately retained Linear team/i,
	);
	assert.match(revisionPrompt.systemPrompt, /derive the title/i);
	assert.match(revisionPrompt.systemPrompt, /professional neutral Spanish/i);

	const { teamId: _knownTeam, ...revisionRequest } = productionSpecRequest({
		solution:
			"El flujo genera una definición exacta y Ctrl+O alterna entre las vistas compacta y detallada.",
	});
	const revised = await tool.execute(
		"revised-spec",
		revisionRequest,
		undefined,
		undefined,
		ctx,
	);
	assert.equal(
		revised.details.status,
		"spec-ready",
		JSON.stringify(revised.details),
	);
	assert.equal(
		revised.details.spec.target.teamId,
		ready.details.spec.target.teamId,
	);
	assert.match(revised.details.spec.body, /Ctrl\+O alterna/);
});

test("Owner feedback revises a recovered ready Spec without rerunning research", async () => {
	const ownerAuthority = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const { ctx, handlers, ready, tool } = await prepareProductionSpec({
		authenticatedAuthority: { current: async () => ownerAuthority },
	});
	await handlers.get("session_start")({ type: "session_start" }, ctx);
	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	await handlers.get("tool_call")(
		{
			toolName: "linear_get_user",
			toolCallId: "recovered-spec-user",
			input: { query: "me" },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolName: "linear_get_user",
			toolCallId: "recovered-spec-user",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						id: "owner-felipe",
						name: "Owner",
						isActive: true,
						isGuest: false,
					}),
				},
			],
			isError: false,
		},
		ctx,
	);
	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	await handlers.get("input")(
		{
			type: "input",
			text: "Ctrl+O es un único toggle; ajusta la Spec.",
			source: "interactive",
		},
		ctx,
	);
	const { teamId: _knownTeam, ...revisionRequest } = productionSpecRequest({
		solution:
			"El flujo recuperado conserva la investigación y Ctrl+O alterna ambas vistas.",
	});
	const revised = await tool.execute(
		"revised-spec-after-recovery",
		revisionRequest,
		undefined,
		undefined,
		ctx,
	);
	assert.equal(
		revised.details.status,
		"spec-ready",
		JSON.stringify(revised.details),
	);
	assert.equal(
		revised.details.spec.target.teamId,
		ready.details.spec.target.teamId,
	);
	assert.match(revised.details.spec.body, /Ctrl\+O alterna/);

	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	await handlers.get("input")(
		{
			type: "input",
			text: "1",
			source: "interactive",
		},
		ctx,
	);
	const approved = await tool.execute(
		"approve-recovered-revision",
		{ action: "approve_spec" },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(
		approved.details.status,
		"spec-approved",
		JSON.stringify(approved.details),
	);
});

test("exact shared Owner choice approves the durable pending Spec", async () => {
	const ownerAuthority = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const { ctx, handlers, ready, tool } = await prepareProductionSpec({
		authenticatedAuthority: { current: async () => ownerAuthority },
	});

	await handlers.get("input")(
		{
			type: "input",
			text: "1",
			source: "interactive",
		},
		ctx,
	);
	const approved = await tool.execute(
		"approve-after-missed-session-recovery",
		{ action: "approve_spec" },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(
		approved.details.status,
		"spec-approved",
		JSON.stringify(approved.details),
	);
	assert.deepEqual(approved.details.spec, ready.details.spec);
});

test("default define-product host-binds the corrective reply after a missing domain anchor", async () => {
	let ticketRecovery;
	const { handlers, tool } = loadExtension({
		ticketApprovalRecoveryStore: {
			load: async () => ticketRecovery,
			save: async (value) => {
				ticketRecovery = structuredClone(value);
			},
			clear: async () => {
				ticketRecovery = undefined;
			},
		},
	});
	const ctx = executionContext();
	await handlers.get("tool_execution_start")(
		{ type: "tool_execution_start", toolName: "workflow_define_product" },
		ctx,
	);
	await handlers.get("input")(
		{ type: "input", text: "/define-product", source: "interactive" },
		ctx,
	);
	const correctivePrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(
		correctivePrompt.systemPrompt,
		/What product idea or problem should define the domain scope\?/,
	);
	assert.doesNotMatch(correctivePrompt.systemPrompt, /recommend_route/);

	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
	await handlers.get("input")(
		{
			type: "input",
			text: "  Preserve my exact corrective product idea  ",
			source: "interactive",
		},
		ctx,
	);
	const recommendation = await tool.execute(
		"corrective-recommendation",
		{
			action: "recommend_route",
			domainAnchor: "model rewrite",
			assessment: {
				clarity: "clear",
				breadth: "narrow",
				reasons: ["bounded"],
			},
		},
		undefined,
		undefined,
		ctx,
	);
	assert.equal(recommendation.details.status, "awaiting-confirmation");
	assert.equal(recommendation.details.recommendation.domainAnchor, undefined);
	assert.doesNotMatch(
		recommendation.content[0].text,
		/model rewrite|corrective product idea/,
	);
});

test("default define-product keeps token, research, and artifact identity bound to the session definition", async () => {
	const launches = [];
	const { handlers, tool } = loadExtension({
		artifactStore: createArtifactStore(),
		webExtensionPath: fileURLToPath(
			new URL("./fixtures/pi-web-access/index.ts", import.meta.url),
		),
		skillEntries: [],
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
	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	await handlers.get("tool_call")(
		{
			toolName: "linear_get_user",
			toolCallId: "identity-binding-user",
			input: { query: "me" },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolName: "linear_get_user",
			toolCallId: "identity-binding-user",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						id: "owner-felipe",
						name: "Owner",
						isActive: true,
						isGuest: false,
					}),
				},
			],
			isError: false,
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
	assert.equal(
		rejected.details.blocker.code,
		"PI_WORKFLOW_DEFINITION_ID_MISMATCH",
	);
	assert.equal(launches.length, 0);

	const recommendation = await tool.execute(
		"tool-1",
		{
			action: "recommend_route",
			domainAnchor: "model-rewritten category map",
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
	assert.deepEqual(Object.keys(recommendation.details.recommendation).sort(), [
		"assessment",
		"recommendedRoute",
	]);
	assert.doesNotMatch(
		recommendation.content[0].text,
		/definitionId|domainAnchor|digest|confirmationToken/,
	);

	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
	await handlers.get("before_agent_start")({ systemPrompt: "base" }, ctx);
	await handlers.get("input")(
		{
			type: "input",
			text: "1",
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
	assert.equal(completed.details.result.artifacts, undefined);
	assert.equal("launchProvenance" in completed.details.result, false);
	assert.doesNotMatch(
		completed.content[0].text,
		/definition-1|artifactTopic|gpt-5\.6-terra|digest|revision|schema|confirmationToken/,
	);
});
