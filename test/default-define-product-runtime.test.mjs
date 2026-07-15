import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { createRuntimeEngramArtifactStore } from "../extensions/runtime-engram-store.ts";
import { createEngramApprovedSpecReader } from "../extensions/engram-approved-spec-reader.ts";
import { createInMemoryDelegationCheckpointStore } from "../extensions/delegation-checkpoints.ts";
import * as defaultDefineProductModule from "../extensions/default-define-product.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

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
				runtime: {
					checkpointStore: createInMemoryDelegationCheckpointStore(),
					...runtime,
				},
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

function productionSpecRequest(overrides = {}) {
	return {
		action: "to_spec",
		target: {
			kind: "linear-parent-description",
			teamId: "team-grupo-ilao",
			title: "Incorporar aprobaciones exactas del Spec",
		},
		revision: "spec-r1",
		problem:
			"El equipo necesita gestionar clientes y permisos correctamente.",
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
		supportArtifactAliases: ["research"],
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
				readCurrent: async (project, topic) => approvedTopics.get(`${project}:${topic}`),
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

async function prepareProductionSpec(runtimeOptions = {}) {
	const { handlers, tool } = loadExtension(
		productionSpecRuntimeOptions(runtimeOptions),
	);
	const ctx = executionContext();
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
	const ready = await tool.execute(
		"spec",
		productionSpecRequest(),
		undefined,
		undefined,
		ctx,
	);
	assert.equal(ready.details.status, "spec-ready");
	return { ctx, handlers, ready, tool };
}

test("production session manager creates named persistent sessions and resumes the exact identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-session-test-"));
	try {
		const sessionDirectory = join(root, "sessions");
		assert.equal(
			typeof defaultDefineProductModule.createRecoverableSessionManager,
			"function",
		);
		const first = await defaultDefineProductModule.createRecoverableSessionManager(
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
		const resumed = await defaultDefineProductModule.createRecoverableSessionManager(
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
			resumed.getEntries().some(
				(entry) => entry.type === "message" && entry.message.role === "assistant",
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
			messages: [{
				role: "assistant",
				content: [{ type: "text", text: "cancelled cleanly" }],
			}],
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
		assert.deepEqual(calls.progress, [{
			batchKey: "comparison-1",
			payload: { completed: 1 },
		}]);
		await executor.intervene("active-production-session", {
			kind: "steer",
			guidance: "Narrow to first-run onboarding.",
		});
		await assert.rejects(
			() => executor.intervene("different-session", {
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

test("runtime Engram store exposes unsupported atomic CAS and refuses every write before I/O", async () => {
	const requests = [];
	let observation;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		requests.push({ url, method: init.method ?? "GET", body });
		if (url.includes("/observations?")) {
			return Response.json(observation ? [observation] : []);
		}
		if (url.endsWith("/sessions")) return new Response("{}", { status: 200 });
		if (url.endsWith("/observations")) {
			observation = {
				id: 42,
				project: body.project,
				topic_key: body.topic_key,
				content: body.content,
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
		assert.equal(store.capabilities.atomicCompareAndSwap, false);
		await assert.rejects(
			() => store.write("pi-workflow", "workflow/topic", "snapshot", undefined),
			(error) => {
				assert.equal(
					error.code,
					"PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_UNSUPPORTED",
				);
				assert.match(error.message, /atomic conditional writes are unsupported/i);
				assert.doesNotMatch(error.message, /compare-and-swap conflict/i);
				return true;
			},
		);
		assert.equal(requests.length, 0);
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
	const workflow = createDefaultDefineProductWorkflow(
		{},
		() => ctx,
		{
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
		},
	);
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
		save: async (state) => { recoveryState = structuredClone(state); },
		clear: async () => { recoveryState = undefined; },
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
					findings: [{
						claim: "Verified research",
						evidence: [{
							uri: "https://example.com/research",
							title: "Research",
							retrievedAt: "2026-07-14T00:00:00.000Z",
						}],
					}],
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
	assert.equal(calls[1].launchOptions.resumeSessionId, calls[0].launchOptions.sessionId);
	assert.deepEqual(
		calls[1].launchOptions.verifiedArtifacts.map(({ schema }) => schema),
		["workflow-progress"],
	);
	assert.equal(calls[2].launchOptions.attempt, 2);
	assert.equal(calls[2].launchOptions.resumeSessionId, undefined);
	assert.equal("partialOutput" in calls[1].launchOptions, false);
	const terminal = JSON.parse(
		(await artifactStore.readCurrent(
			"pi-workflow",
			recovered.result.artifacts[0].topic,
		)).content,
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

test("default packaged entry approves with configured Owner authority and ignores attacker identity arguments", async () => {
	const previousActorId = process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	const previousRevision = process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	process.env.PI_WORKFLOW_OWNER_ACTOR_ID = "owner-felipe";
	process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = "owner-policy-r3";
	try {
		const { ctx, ready, tool } = await prepareProductionSpec();
		assert.equal("actor" in tool.parameters.properties, false);
		assert.equal("actorId" in tool.parameters.properties, false);
		assert.equal("authorityRevision" in tool.parameters.properties, false);

		const approved = await tool.execute(
			"approval",
			{
				action: "approve_spec",
				actor: {
					actorId: "attacker",
					role: "Owner",
					authorityRevision: "attacker-r9",
				},
				actorId: "attacker",
				role: "Owner",
				authorityRevision: "attacker-r9",
				target: ready.details.spec.payload.target,
				revision: ready.details.spec.payload.revision,
				digest: ready.details.spec.digest,
			},
			undefined,
			undefined,
			ctx,
		);

		assert.equal(approved.details.status, "spec-approved");
		assert.deepEqual(approved.details.approval.payload.actor, {
			actorId: "owner-felipe",
			role: "Owner",
			authorityRevision: "owner-policy-r3",
		});
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

test("default runtime publishes the Engram-approved body through configured Linear", async () => {
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
				return Response.json({ data: {
					viewer: { id: "owner-felipe" },
					team: {
						id: "team-grupo-ilao",
						cyclesEnabled: true,
						states: { nodes: [{ id: "backlog-1", type: "backlog", updatedAt: "2026-07-14T00:00:00.000Z" }] },
					},
				} });
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
				return Response.json({ data: { issueCreate: { success: true, issue: parent } } });
			}
			return Response.json({ data: { issue: parent } });
		}
		if (url.pathname === "/observations" && (init.method ?? "GET") === "GET") {
			const key = `${url.searchParams.get("project")}:${url.searchParams.get("topic_key")}`;
			const current = observations.get(key);
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
		const { ctx, ready, tool } = await prepareProductionSpec({
			approvedSpecReader: undefined,
			authenticatedAuthority: {
				current: async () => ({ actorId: "owner-felipe", role: "Owner", authorityRevision: "owner-policy-r3" }),
			},
			publicationManifest: {
				create: (value) => ({ ...value, digest: digestCanonicalValue(value) }),
				load: async () => manifest && { revision: String(manifestRevision), value: structuredClone(manifest) },
				save: async (value, expectedRevision) => {
					assert.equal(expectedRevision, manifest ? String(manifestRevision) : undefined);
					manifest = structuredClone(value);
					manifestRevision += 1;
					return String(manifestRevision);
				},
			},
		});
		const approved = await tool.execute("approval", {
			action: "approve_spec",
			target: ready.details.spec.payload.target,
			revision: ready.details.spec.payload.revision,
			digest: ready.details.spec.digest,
		}, undefined, undefined, ctx);
		assert.equal(approved.details.status, "spec-approved");
		const published = await tool.execute("publication", { action: "publish_spec" }, undefined, undefined, ctx);
		assert.equal(published.details.status, "spec-published", JSON.stringify(published.details));
		assert.equal(parent.description, ready.details.spec.payload.body);
		assert.equal(manifest.stage, "verified");
	} finally {
		globalThis.fetch = originalFetch;
		if (previousLinearKey === undefined) delete process.env.LINEAR_API_KEY;
		else process.env.LINEAR_API_KEY = previousLinearKey;
		if (previousLinearUrl === undefined) delete process.env.LINEAR_API_URL;
		else process.env.LINEAR_API_URL = previousLinearUrl;
	}
});

test("default packaged entry fails closed when configured Owner authority is incomplete", async () => {
	const previousActorId = process.env.PI_WORKFLOW_OWNER_ACTOR_ID;
	const previousRevision = process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	process.env.PI_WORKFLOW_OWNER_ACTOR_ID = "owner-felipe";
	process.env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION = "   ";
	try {
		const { ctx, ready, tool } = await prepareProductionSpec();
		const outcome = await tool.execute(
			"approval-with-invalid-config",
			{
				action: "approve_spec",
				target: ready.details.spec.payload.target,
				revision: ready.details.spec.payload.revision,
				digest: ready.details.spec.digest,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(outcome.details.status, "blocked");
		assert.equal(
			outcome.details.blocker.code,
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
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
		productionSpecRequest({ target: undefined }),
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
				"El equipo puede revisar <?xml version=\"1.0\"?> antes de publicar.",
		}),
		undefined,
		undefined,
		ctx,
	);
	assert.equal(blocked.details.status, "blocked");
	assert.equal(blocked.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
	const prompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(prompt.systemPrompt, /approve_spec/);

	const approved = await tool.execute(
		"approval-after-retries",
		{
			action: "approve_spec",
			target: ready.details.spec.payload.target,
			revision: ready.details.spec.payload.revision,
			digest: ready.details.spec.digest,
		},
		undefined,
		undefined,
		ctx,
	);
	assert.equal(approved.details.status, "spec-approved");
	assert.equal(approved.details.spec.digest, ready.details.spec.digest);
	assert.deepEqual(approved.details.approval.payload.actor, ownerAuthority);
});

test("default define-product keeps token, research, and artifact identity bound to the session definition", async () => {
	const launches = [];
	const { handlers, tool } = loadExtension({
		artifactStore: createArtifactStore(),
		webExtensionPath: fileURLToPath(
			new URL("./fixtures/pi-web-access/index.ts", import.meta.url),
		),
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
