import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { createInMemoryDecisionStore } from "../extensions/interactive-decisions.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const LINEAR_TOOLS = [
	"linear_get_user",
	"linear_get_issue",
	"linear_list_comments",
	"linear_save_comment",
	"workflow_product_review",
];

const PUBLIC_DIGEST = /\b[a-f0-9]{64}\b/i;
const ISSUE_RESULT_PROTOCOL = /\b[A-Z][A-Z0-9]*-[1-9][0-9]*\s+(?:Aceptado|Cambios requeridos)\b/;

function assertPrivateSelectionSurface(text) {
	assert.doesNotMatch(text, PUBLIC_DIGEST);
	assert.doesNotMatch(text, ISSUE_RESULT_PROTOCOL);
}

const productDraft = {
	scope: "Revisar la publicación del resultado de producto.",
	stories: [
		{
			id: "US-1",
			description: "Como Owner, quiero decidir el resultado.",
			acceptanceCriteria: [
				{
					id: "AC-1",
					description: "La decisión queda vinculada.",
					result: "cumple",
					evidence: ["test:product-review"],
				},
			],
		},
	],
	evidence: [
		{ ref: "test:product-review", description: "Pruebas automatizadas" },
	],
	findings: ["La implementación satisface el alcance."],
	requiredChanges: [],
	parentImpact: "Sin impacto adverso en el parent.",
	siblingImpact: [],
	recommendation: "Aceptado",
};

function validIssue(overrides = {}) {
	return {
		id: "linear-uuid-2324",
		identifier: "ILA-2324",
		title: "Product review",
		description: "Autoritativa",
		updatedAt: "2026-07-27T19:21:01.958Z",
		status: "Ready for PO",
		statusType: "started",
		assignee: "Owner",
		assigneeId: "owner-1",
		cycleId: "cycle-24",
		labels: ["Product"],
		estimate: 5,
		priority: { id: "high", name: "High" },
		project: { id: "project-1", name: "Workflow migration" },
		dueDate: "2026-08-01",
		parentId: "ILA-2296",
		relations: {
			blockedBy: [],
			blocks: [],
			relatedTo: [],
			duplicateOf: null,
		},
		attachments: [],
		...overrides,
	};
}

function publicationPersistence(initialArtifact) {
	let artifact = structuredClone(initialArtifact);
	const recoveries = new Map();
	return {
		getArtifact: () => structuredClone(artifact),
		getRecovery: (issueId) => structuredClone(recoveries.get(issueId)),
		artifacts: {
			read: async () => structuredClone(artifact),
			save: async (value) => {
				if (artifact && JSON.stringify(artifact) !== JSON.stringify(value))
					throw new Error("artifact conflict");
				artifact = structuredClone(value);
				return structuredClone(value);
			},
		},
			recovery: {
			read: async (issueId) => {
				const value = recoveries.get(issueId);
			return value?.stage === "uncertain" || value?.stage === "verified"
					? {
							digest: value.digest,
							stage: value.stage,
							...(value.executionBinding
								? { executionBinding: value.executionBinding }
								: {}),
						}
					: undefined;
			},
			bindExecution: async (value, lease) => {
				const issueId = value.payload.issue.id;
				const executionBinding = {
					decisionId: lease.decisionId,
					operationDigest: lease.operationDigest,
					executionId: lease.executionId,
					generation: lease.generation,
				};
				const existing = recoveries.get(issueId);
				if (
					existing &&
					existing.stage !== "released" &&
					existing.digest !== value.digest
				)
					throw new Error("recovery digest conflict");
				if (
					existing?.executionBinding &&
					existing.stage !== "released" &&
					JSON.stringify(existing.executionBinding) !==
						JSON.stringify(executionBinding)
				)
					throw new Error("recovery execution binding conflict");
				recoveries.set(issueId, {
					...(existing ?? { digest: value.digest, stage: "released" }),
					executionBinding,
				});
				return {
					...executionBinding,
					ref: `workflow://product-review/${issueId}/publication/${value.digest}`,
				};
			},
			claim: async (value, ownerId) => {
				const issueId = value.payload.issue.id;
				const existing = recoveries.get(issueId);
				if (existing?.stage === "verified")
					throw new Error("publication already verified");
				if (
					existing?.stage === "uncertain" &&
					existing.ownerId !== ownerId
				)
					throw new Error("recovery claim already owned");
					recoveries.set(issueId, {
						digest: value.digest,
						stage: "uncertain",
						ownerId,
						executionBinding: existing?.executionBinding,
				});
			},
			release: async (value, ownerId) => {
				const issueId = value.payload.issue.id;
				const existing = recoveries.get(issueId);
				if (existing?.stage === "uncertain" && existing.ownerId !== ownerId)
					throw new Error("recovery claim already owned");
				recoveries.set(issueId, {
					digest: value.digest,
					stage: "released",
					ownerId,
					executionBinding: existing?.executionBinding,
				});
			},
			finalizeVerified: async (value) => {
				const existing = recoveries.get(value.payload.issue.id);
				recoveries.set(value.payload.issue.id, {
					digest: value.digest,
					stage: "verified",
					executionBinding: existing?.executionBinding,
				});
			},
		},
	};
}

function legacyProductReviewArtifact(currentArtifact) {
	const { protectedDigest: _protectedDigest, ...issue } =
		currentArtifact.payload.issue;
	const payload = { ...currentArtifact.payload, issue };
	const unsigned = {
		schema: "product-review",
		schemaVersion: 1,
		language: "es",
		payload,
	};
	const digest = digestCanonicalValue(unsigned);
	return {
		...unsigned,
		digest,
		body: currentArtifact.body.replace(
			`product-review:${currentArtifact.digest}`,
			`product-review:${digest}`,
		),
	};
}

function extensionHarness({
	draft = productDraft,
	persistence = publicationPersistence(),
	activeTools = LINEAR_TOOLS,
	allTools = LINEAR_TOOLS,
	runtimeEnvironment = {},
	authenticatedAuthority,
	interactiveDecisionStore = createInMemoryDecisionStore(),
} = {}) {
	const handlers = new Map();
	const tools = new Map();
	const toolCalls = [];
	piWorkflowExtension(
		{
			exec: async () => ({ code: 0 }),
			getActiveTools: () => [...activeTools],
			getAllTools: () => allTools.map((name) => ({ name })),
			registerCommand: () => {},
			registerTool: (tool) => tools.set(tool.name, tool),
			on: (event, handler) => {
				const registered = handlers.get(event) ?? [];
				registered.push(handler);
				handlers.set(event, registered);
			},
		},
		{
			interactiveDecisions: { store: interactiveDecisionStore },
			productReview: {
				runtime: {
					environment: runtimeEnvironment,
					...(authenticatedAuthority ? { authenticatedAuthority } : {}),
					drafts: { read: async () => structuredClone(draft) },
					artifacts: persistence.artifacts,
					recovery: persistence.recovery,
				},
			},
		},
	);
	for (const handler of handlers.get("session_start") ?? [])
		void handler({ type: "session_start" }, context);
	return {
		tools,
		toolCalls,
		getArtifact: persistence.getArtifact,
		async emit(event, value, context = {}) {
			if (event === "tool_call") toolCalls.push(structuredClone(value));
			let result;
			for (const handler of handlers.get(event) ?? []) {
				const candidate = await handler(value, context);
				if (candidate !== undefined) result = candidate;
			}
			return result;
		},
	};
}

const context = {
	isIdle: () => true,
	cwd: process.cwd(),
	sessionManager: { getSessionId: () => "product-review-test-session" },
	ui: { notify: () => {} },
};

function mcpResult(toolName, toolCallId, payload) {
	return {
		toolName,
		toolCallId,
		content: [{ type: "text", text: JSON.stringify(payload) }],
		isError: false,
	};
}

const ownerActor = {
	id: "owner-1",
	name: "Owner",
	isActive: true,
	isGuest: false,
};

async function callMcp(harness, toolName, toolCallId, input, payload) {
	const event = { toolName, toolCallId, input: structuredClone(input) };
	const callOutcome = await harness.emit("tool_call", event, context);
	if (callOutcome !== undefined) return { event, callOutcome };
	if (payload === undefined) return { event, callOutcome };
	const resultOutcome = await harness.emit(
		"tool_result",
		mcpResult(toolName, toolCallId, payload),
		context,
	);
	return { event, callOutcome, resultOutcome };
}

async function continueOwnerSelection(harness, prefix, result = "Aceptado") {
	const input = { action: "select_result", result };
	const descriptor = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(descriptor.systemPrompt, /Seleccione el resultado/i);
	assert.match(descriptor.systemPrompt, /1\. Aceptado/);
	assert.match(descriptor.systemPrompt, /3\. Cancelar/);
	assert.match(descriptor.systemPrompt, /Do not infer approval/i);
	await harness.emit(
		"input",
		{
			type: "input",
			text: result === "Aceptado" ? "1" : "2",
			source: "interactive",
		},
		context,
	);
	const prompt = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(prompt.systemPrompt, /workflow_product_review/);
	assert.match(prompt.systemPrompt, /select_result/);
	assert.match(prompt.systemPrompt, new RegExp(result));
	assert.doesNotMatch(prompt.systemPrompt, /linear_get_user/);
	assertPrivateSelectionSurface(prompt.systemPrompt);
	const call = {
		toolName: "workflow_product_review",
		toolCallId: `${prefix}-public-selection`,
		input,
	};
	assert.equal(await harness.emit("tool_call", call, context), undefined);
	const resultValue = await harness.tools
		.get("workflow_product_review")
		.execute(call.toolCallId, call.input);
	assert.deepEqual(JSON.parse(resultValue.content[0].text), {
		status: "continuing",
	});
	assertPrivateSelectionSurface(resultValue.content[0].text);
	const continued = await harness.emit(
		"tool_result",
		{
			toolName: call.toolName,
			toolCallId: call.toolCallId,
			content: resultValue.content,
			isError: false,
		},
		context,
	);
	assert.match(continued.content.at(-1).text, /linear_get_issue/);
	assertPrivateSelectionSurface(continued.content.at(-1).text);
	return { call, result: resultValue, continued };
}

async function prepareAndSelect(
	harness,
	prefix,
	issue = validIssue(),
	result = "Aceptado",
	continueHandshake = true,
	actor = ownerActor,
) {
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: "/product-review ILA-2324",
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	await callMcp(
		harness,
		"linear_get_user",
		`${prefix}-auth-prepare`,
		{ query: "me" },
		actor,
	);
	await callMcp(
		harness,
		"linear_get_issue",
		`${prefix}-issue-initial`,
		{ id: "ILA-2324", includeRelations: true },
		issue,
	);
	const verified = await callMcp(
		harness,
		"linear_get_issue",
		`${prefix}-issue-verified`,
		{ id: "ILA-2324", includeRelations: true },
		issue,
	);
	assertPrivateSelectionSurface(verified.resultOutcome.content.at(-1).text);
	if (/linear_get_issue/.test(verified.resultOutcome.content.at(-1).text)) return;
	if (continueHandshake)
		await continueOwnerSelection(harness, prefix, result);
}

async function advanceApprovedToComments(
	harness,
	prefix,
	issue = validIssue(),
) {
	return callMcp(
		harness,
		"linear_get_issue",
		`${prefix}-issue-approved`,
		{ id: "ILA-2324", includeRelations: true },
		issue,
	);
}

async function terminalOutcome(harness, prefix) {
	const input = {};
	await harness.emit(
		"tool_call",
		{
			toolName: "workflow_product_review",
			toolCallId: `${prefix}-terminal`,
			input,
		},
		context,
	);
	const result = await harness.tools.get("workflow_product_review").execute(
		`${prefix}-terminal`,
		input,
	);
	assertPrivateSelectionSurface(result.content[0].text);
	return JSON.parse(result.content[0].text);
}

test("default product-review requires no host authority environment", async () => {
	const harness = extensionHarness({ runtimeEnvironment: {} });
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: "/product-review ILA-2324",
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	const prompt = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(prompt.systemPrompt, /linear_get_user/);
	assert.doesNotMatch(prompt.systemPrompt, /PI_WORKFLOW_OWNER_/);
});

test("public product-review leaves unrelated tool calls untouched until its turn starts", async () => {
	const harness = extensionHarness();
	const readCall = {
		toolName: "read",
		toolCallId: "unrelated-read",
		input: { path: "/tmp/unrelated.txt" },
	};
	assert.equal(await harness.emit("tool_call", readCall, context), undefined);
	assert.deepEqual(readCall.input, { path: "/tmp/unrelated.txt" });

	await harness.emit(
		"input",
		{
			type: "input",
			text: "/product-review ILA-2324",
			source: "interactive",
		},
		context,
	);
	const blockedRead = await harness.emit(
		"tool_call",
		{
			...readCall,
			toolCallId: "active-unrelated-read",
		},
		context,
	);
	assert.equal(blockedRead.block, true);
	assert.equal(
		blockedRead.reason,
		"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
	);
});

test("default product-review blocks when configured Linear MCP tools are inactive", async () => {
	const harness = extensionHarness({
		activeTools: ["workflow_product_review"],
	});
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: "/product-review ILA-2324",
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	const prompt = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.doesNotMatch(prompt.systemPrompt, /linear_get_user/);
	assert.match(prompt.systemPrompt, /blocker/i);
	const input = {};
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "workflow_product_review",
				toolCallId: "inactive-linear-terminal",
				input,
			},
			context,
		),
		undefined,
	);
	const result = await harness.tools
		.get("workflow_product_review")
		.execute("inactive-linear-terminal", input);
	assert.equal(
		JSON.parse(result.content[0].text).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_MCP_UNAVAILABLE",
	);
});

test("default product-review starts authenticated Linear MCP preparation without a direct API key", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("Product review must not use direct Linear HTTP");
	};
	try {
		const harness = extensionHarness();
		assert.deepEqual(
			await harness.emit(
				"input",
				{
					type: "input",
					text: "/product-review ILA-2324",
					source: "interactive",
				},
				context,
			),
			{ action: "continue" },
		);
		const start = await harness.emit(
			"before_agent_start",
			{ type: "before_agent_start" },
			context,
		);
		assert.match(start.systemPrompt, /linear_get_user/);
		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_user",
					toolCallId: "owner-auth-1",
					input: { query: "me" },
				},
				context,
			),
			undefined,
		);
		assert.ok(harness.tools.has("workflow_product_review"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("default product-review accepts real Pi's public ILA-2428 selection call after id-as-identifier evidence", async () => {
	const persistence = publicationPersistence();
	const harness = extensionHarness({ persistence });
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/product-review ILA-2428",
			source: "interactive",
		},
		context,
	);
	await callMcp(
		harness,
		"linear_get_user",
		"real-pi-owner",
		{ query: "me" },
		ownerActor,
	);
	const realPiIssue = {
		id: "ILA-2428",
		title: "Real Pi product review",
		description: "Authoritative Linear issue evidence.",
		priority: { id: "high", name: "High" },
		url: "https://linear.app/example/issue/ILA-2428/real-pi-product-review",
		gitBranchName: "fix/ila-2428-real-pi-product-review",
		createdAt: "2026-07-27T18:21:01.958Z",
		updatedAt: "2026-07-27T19:21:01.958Z",
		startedAt: "2026-07-27T18:31:01.958Z",
		completedAt: null,
		canceledAt: null,
		archivedAt: null,
		dueDate: null,
		status: "Ready for PO",
		statusType: "started",
		labels: ["Product"],
		attachments: [],
		documents: [],
		stateHistory: [],
		createdBy: "Owner",
		createdById: "owner-1",
		assignee: "Owner",
		assigneeId: "owner-1",
		team: "ILA",
		teamId: "team-ila",
		relations: {
			blockedBy: [],
			blocks: [],
			relatedTo: [],
			duplicateOf: null,
		},
	};
	await callMcp(
		harness,
		"linear_get_issue",
		"real-pi-issue-initial",
		{ id: "ILA-2428", includeRelations: true },
		realPiIssue,
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "real-pi-issue-verified",
				input: { id: "ILA-2428", includeRelations: true },
			},
			context,
		),
		undefined,
	);
	const prepared = await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "real-pi-issue-verified", realPiIssue),
		context,
	);
	assertPrivateSelectionSurface(prepared.content.at(-1).text);
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: "Aceptado",
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	const { continued } = await continueOwnerSelection(harness, "real-pi");
	assert.equal(persistence.getArtifact(), undefined);
	assert.match(continued.content.at(-1).text, /linear_get_issue/);
});

test("default product-review prepares only the shared Owner decision descriptor", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/product-review ILA-2324",
			source: "interactive",
		},
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "owner-prepare-auth",
			input: { query: "me" },
		},
		context,
	);
	const authenticated = await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "owner-prepare-auth", {
			id: "owner-1",
			name: "Owner",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	assert.match(authenticated.content.at(-1).text, /linear_get_issue/);
	for (const toolCallId of ["product-issue-initial", "product-issue-fresh"]) {
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId,
				input: { id: "ILA-2324", includeRelations: true },
			},
			context,
		);
		const evidence = await harness.emit(
			"tool_result",
			mcpResult("linear_get_issue", toolCallId, validIssue()),
			context,
		);
		if (toolCallId === "product-issue-initial")
			assert.match(evidence.content.at(-1).text, /linear_get_issue/);
		else {
			assert.match(evidence.content.at(-1).text, /shared decision descriptor/i);
			assert.match(evidence.content.at(-1).text, /Never infer approval from prose/i);
			assert.match(evidence.content.at(-1).text, /select_result/i);
			assert.match(evidence.content.at(-1).text, /Aceptado/);
			assert.match(evidence.content.at(-1).text, /Cambios requeridos/);
			assertPrivateSelectionSurface(evidence.content.at(-1).text);
		}
	}
	const memoryCall = {
		toolName: "mem_context",
		toolCallId: "read-memory-during-review",
		input: { project: "pi-workflow" },
	};
	assert.equal(
		await harness.emit("tool_call", memoryCall, context),
		undefined,
	);
	assert.equal(
		await harness.emit(
			"tool_result",
			mcpResult("mem_context", memoryCall.toolCallId, { observations: [] }),
			context,
		),
		undefined,
	);
	const afterMemory = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(afterMemory.systemPrompt, /Seleccione el resultado/i);
	assert.match(afterMemory.systemPrompt, /1\. Aceptado/);
	assert.match(afterMemory.systemPrompt, /3\. Cancelar/);
});

test("default product-review authenticates exactly once across preparation, approval, and publication", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/product-review ILA-2324",
			source: "interactive",
		},
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "owner-gate-auth",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "owner-gate-auth", {
			id: "owner-1",
			name: "Owner",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	let preparedInstruction;
	for (const toolCallId of ["owner-gate-issue", "owner-gate-fresh"]) {
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId,
				input: { id: "ILA-2324", includeRelations: true },
			},
			context,
		);
		const result = await harness.emit(
			"tool_result",
			mcpResult("linear_get_issue", toolCallId, validIssue()),
			context,
		);
		preparedInstruction = result?.content.at(-1).text;
	}
	assertPrivateSelectionSurface(preparedInstruction);
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	const descriptor = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(descriptor.systemPrompt, /Seleccione el resultado/i);
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: "1",
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	const resumed = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(resumed.systemPrompt, /workflow_product_review/);
	assert.match(resumed.systemPrompt, /select_result/);
	assert.doesNotMatch(resumed.systemPrompt, /linear_get_user/);
	assertPrivateSelectionSurface(resumed.systemPrompt);
	const selectionCall = {
		toolName: "workflow_product_review",
		toolCallId: "owner-gate-selection",
		input: { action: "select_result", result: "Aceptado" },
	};
	assert.equal(await harness.emit("tool_call", selectionCall, context), undefined);
	const selectionResult = await harness.tools
		.get("workflow_product_review")
		.execute(selectionCall.toolCallId, selectionCall.input);
	assert.deepEqual(JSON.parse(selectionResult.content[0].text), {
		status: "continuing",
	});
	assertPrivateSelectionSurface(selectionResult.content[0].text);
	const continued = await harness.emit(
		"tool_result",
		{
			toolName: selectionCall.toolName,
			toolCallId: selectionCall.toolCallId,
			content: selectionResult.content,
			isError: false,
		},
		context,
	);
	assert.match(continued.content.at(-1).text, /linear_get_issue/);
	assertPrivateSelectionSurface(continued.content.at(-1).text);
	assert.equal(
		harness.toolCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
		1,
	);
});

test("default product-review accepts real Pi's public selection call before the exact authenticated MCP publication sequence", async () => {
	const persistence = publicationPersistence();
	const harness = extensionHarness({ persistence });
	await harness.emit(
		"input",
		{ type: "input", text: "/product-review ILA-2324", source: "interactive" },
		context,
	);
	const actor = {
		id: "owner-1",
		name: "Owner",
		isActive: true,
		isGuest: false,
	};
	await harness.emit(
		"tool_call",
		{ toolName: "linear_get_user", toolCallId: "publish-auth-1", input: { query: "me" } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "publish-auth-1", actor),
		context,
	);
	let preparedInstruction;
	for (const toolCallId of ["publish-issue-1", "publish-issue-2"]) {
		await harness.emit(
			"tool_call",
			{ toolName: "linear_get_issue", toolCallId, input: { id: "ILA-2324", includeRelations: true } },
			context,
		);
		const result = await harness.emit(
			"tool_result",
			mcpResult("linear_get_issue", toolCallId, validIssue()),
			context,
		);
		preparedInstruction = result?.content.at(-1).text;
	}
	assertPrivateSelectionSurface(preparedInstruction);
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	await harness.emit(
		"input",
		{ type: "input", text: "Aceptado", source: "interactive" },
		context,
	);
	const { continued } = await continueOwnerSelection(harness, "publish");
	assert.equal(persistence.getArtifact(), undefined);
	assert.match(continued.content.at(-1).text, /linear_get_issue/);
	await harness.emit(
		"tool_call",
		{ toolName: "linear_get_issue", toolCallId: "publish-issue-approved", input: { id: "ILA-2324", includeRelations: true } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "publish-issue-approved", validIssue()),
		context,
	);
	const digest = persistence.getArtifact().digest;
	await harness.emit(
		"tool_call",
		{ toolName: "linear_list_comments", toolCallId: "publish-comments-1", input: { issueId: "ILA-2324" } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "publish-comments-1", {
			comments: [
				{ id: "inline", body: "Referencia de flujo: product-review:not-this-review", quotedText: "anchor", parentId: null },
			],
			hasNextPage: true,
			cursor: "comments-page-2",
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{ toolName: "linear_list_comments", toolCallId: "publish-comments-2", input: { issueId: "ILA-2324", cursor: "comments-page-2" } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "publish-comments-2", { comments: [], hasNextPage: false }),
		context,
	);

	await harness.emit(
		"tool_call",
		{ toolName: "linear_get_issue", toolCallId: "publish-issue-before", input: { id: "ILA-2324", includeRelations: true } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "publish-issue-before", validIssue()),
		context,
	);
	const saveCall = {
		toolName: "linear_save_comment",
		toolCallId: "publish-comment",
		input: { issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" },
	};
	assert.equal(await harness.emit("tool_call", saveCall, context), undefined);
	const expectedBody = await readFile(
		new URL("./fixtures/product-review.accepted.golden.md", import.meta.url),
		"utf8",
	);
	assert.equal(
		saveCall.input.body,
		expectedBody.replace(/product-review:[a-f0-9]{64}/, `product-review:${digest}`),
	);
	const comment = { id: "product-comment-1", body: saveCall.input.body, quotedText: null, parentId: null };
	await harness.emit(
		"tool_result",
		mcpResult("linear_save_comment", "publish-comment", comment),
		context,
	);
	await harness.emit(
		"tool_call",
		{ toolName: "linear_list_comments", toolCallId: "publish-readback", input: { issueId: "ILA-2324" } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "publish-readback", { comments: [comment], hasNextPage: false }),
		context,
	);
	await harness.emit(
		"tool_call",
		{ toolName: "linear_get_issue", toolCallId: "publish-final", input: { id: "ILA-2324", includeRelations: true } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "publish-final", validIssue({ updatedAt: "2026-07-27T19:21:02.958Z" })),
		context,
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{ toolName: "workflow_product_review", toolCallId: "publish-terminal", input: {} },
			context,
		),
		undefined,
	);
	const result = await harness.tools
		.get("workflow_product_review")
		.execute("publish-terminal", {});
	assertPrivateSelectionSurface(result.content[0].text);
	assert.deepEqual(JSON.parse(result.content[0].text), {
		status: "published",
		issueId: "ILA-2324",
		commentId: "product-comment-1",
	});
});

test("public product-review cancellation consumes only the shared cancellation claim", async () => {
	const persistence = publicationPersistence();
	const harness = extensionHarness({ persistence });
	await prepareAndSelect(
		harness,
		"cancel-review",
		validIssue(),
		"Aceptado",
		false,
	);
	const descriptor = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(descriptor.systemPrompt, /3\. Cancelar/);
	await harness.emit(
		"input",
		{ type: "input", text: "3", source: "interactive" },
		context,
	);
	const call = {
		toolName: "workflow_product_review",
		toolCallId: "cancel-review-action",
		input: { action: "cancel_decision" },
	};
	assert.equal(await harness.emit("tool_call", call, context), undefined);
	const result = await harness.tools
		.get("workflow_product_review")
		.execute(call.toolCallId, call.input);
	assert.deepEqual(JSON.parse(result.content[0].text), {
		status: "cancelled",
		issueId: "ILA-2324",
	});
	assert.equal(persistence.getArtifact(), undefined);
	assert.equal(persistence.getRecovery("ILA-2324"), undefined);
	assert.equal(
		harness.toolCalls.some(({ toolName }) => toolName === "linear_save_comment"),
		false,
	);
});

test("public product-review replaces a released lease after review drift", async () => {
	const persistence = publicationPersistence();
	const interactiveDecisionStore = createInMemoryDecisionStore();
	const first = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(first, "drift-first");
	const firstExecution = persistence.getRecovery("ILA-2324").executionBinding;
	await first.emit("session_shutdown", { type: "session_shutdown" }, context);

	const changedDraft = {
		...productDraft,
		findings: ["La evidencia de producto cambió antes de la publicación."],
	};
	const replacement = extensionHarness({
		draft: changedDraft,
		persistence,
		interactiveDecisionStore,
	});
	await prepareAndSelect(replacement, "drift-replacement");
	const replacementExecution =
		persistence.getRecovery("ILA-2324").executionBinding;
	assert.notEqual(replacementExecution.executionId, firstExecution.executionId);
	assert.equal(replacementExecution.generation > firstExecution.generation, true);
	await advanceApprovedToComments(replacement, "drift-replacement");
	assert.deepEqual(persistence.getArtifact().payload.findings, changedDraft.findings);
});

test("public product-review requires changed-actor reapproval before replacing a released lease", async () => {
	const persistence = publicationPersistence();
	const interactiveDecisionStore = createInMemoryDecisionStore();
	const first = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(first, "actor-first");
	const firstExecution = persistence.getRecovery("ILA-2324").executionBinding;
	await first.emit("session_shutdown", { type: "session_shutdown" }, context);

	const changedActor = {
		id: "owner-2",
		name: "Second Owner",
		isActive: true,
		isGuest: false,
	};
	const replacement = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(
		replacement,
		"actor-reapproval",
		validIssue(),
		"Aceptado",
		true,
		changedActor,
	);
	const replacementExecution =
		persistence.getRecovery("ILA-2324").executionBinding;
	assert.notEqual(replacementExecution.executionId, firstExecution.executionId);
	await advanceApprovedToComments(replacement, "actor-reapproval");
	assert.equal(persistence.getArtifact().payload.authority.actorId, "owner-2");
});

test("public product-review selection calls fail closed without authorizing mutation", async (t) => {
	const invalidCalls = [
		["extra field", () => ({ extra: true })],
		[
			"legacy public protocol",
			() => ({
				issueId: "ILA-2324",
				result: "Aceptado",
				digest: "a".repeat(64),
			}),
		],
	];
	for (const [name, inputFor] of invalidCalls) {
		await t.test(name, async () => {
			const persistence = publicationPersistence();
			const harness = extensionHarness({ persistence });
			await prepareAndSelect(
				harness,
				`public-${name}`,
				validIssue(),
				"Aceptado",
				false,
			);
			const blockedCall = await harness.emit(
				"tool_call",
				{
					toolName: "workflow_product_review",
					toolCallId: `public-${name}`,
					input: inputFor(),
				},
				context,
			);
			assert.equal(blockedCall.block, true);
			assert.equal(persistence.getArtifact(), undefined);
			const mutation = {
				issueId: "ILA-2324",
				body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY",
			};
			assert.equal(
				(
					await harness.emit(
						"tool_call",
						{
							toolName: "linear_save_comment",
							toolCallId: `public-${name}-mutation`,
							input: mutation,
						},
						context,
					)
				).block,
				true,
			);
			assert.equal(mutation.body, "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY");
		});
	}

	await t.test("extra exact call", async () => {
		const persistence = publicationPersistence();
		const harness = extensionHarness({ persistence });
		await prepareAndSelect(
			harness,
			"public-extra",
			validIssue(),
			"Aceptado",
			true,
		);
		const input = { action: "select_result", result: "Aceptado" };
		assert.equal(
			(
				await harness.emit(
					"tool_call",
					{
						toolName: "workflow_product_review",
						toolCallId: "public-extra-second",
						input: structuredClone(input),
					},
					context,
				)
			).block,
			true,
		);
		assert.equal(persistence.getArtifact(), undefined);
		const mutation = {
			issueId: "ILA-2324",
			body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY",
		};
		assert.equal(
			(
				await harness.emit(
					"tool_call",
					{
						toolName: "linear_save_comment",
						toolCallId: "public-extra-mutation",
						input: mutation,
					},
					context,
				)
			).block,
			true,
		);
		assert.equal(mutation.body, "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY");
	});
});

test("default product-review blocks inactive, guest, and malformed users after one lookup", async (t) => {
	for (const [name, user] of [
		["inactive", { ...ownerActor, isActive: false }],
		["guest", { ...ownerActor, isGuest: true }],
		["malformed", { id: ownerActor.id, isActive: true, isGuest: false }],
	]) {
		await t.test(name, async () => {
			const harness = extensionHarness();
			await harness.emit(
				"input",
				{
					type: "input",
					text: "/product-review ILA-2324",
					source: "interactive",
				},
				context,
			);
			await callMcp(
				harness,
				"linear_get_user",
				`invalid-${name}`,
				{ query: "me" },
				user,
			);
			const outcome = await harness.tools
				.get("workflow_product_review")
				.execute(`invalid-${name}-terminal`, {});
			assert.equal(
				JSON.parse(outcome.content[0].text).blocker.code,
				name === "malformed"
					? "PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE"
					: "PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH",
			);
			assert.equal(
				harness.toolCalls.filter(({ toolName }) =>
					toolName === "linear_get_user").length,
				1,
			);
		});
	}
});

test("explicit invalid product-review compatibility policies fail closed", () => {
	for (const authenticatedAuthority of [
		{
			actorId: "developer-1",
			role: "Developer",
			authorityRevision: "host-policy-r1",
		},
		{
			actorId: "owner-1",
			role: "Owner",
			authorityRevision: "   ",
		},
	]) {
		assert.throws(
			() => extensionHarness({ authenticatedAuthority }),
			/invalid Owner authority policy/i,
		);
	}
});

test("explicit product-review compatibility policy constrains the authenticated Linear user", async () => {
	const harness = extensionHarness({
		authenticatedAuthority: {
			actorId: "owner-1",
			role: "Owner",
			authorityRevision: "host-policy-r1",
		},
	});
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/product-review ILA-2324",
			source: "interactive",
		},
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "owner-auth-mismatch",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "owner-auth-mismatch", {
			id: "another-owner",
			name: "Another Owner",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	const outcome = await harness.tools
		.get("workflow_product_review")
		.execute("terminal-owner-mismatch", {});
	assertPrivateSelectionSurface(outcome.content[0].text);
	assert.equal(
		JSON.parse(outcome.content[0].text).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH",
	);
});

test("public product-review preserves the first terminal blocker after unrelated model traffic", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{ type: "input", text: "/product-review ILA-2324", source: "interactive" },
		context,
	);
	await callMcp(
		harness,
		"linear_get_user",
		"first-blocker-owner",
		{ query: "me" },
		{ ...ownerActor, isActive: false },
	);
	assert.equal(
		(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_save_issue",
					toolCallId: "after-first-blocker",
					input: { id: "ILA-2324", state: "Done" },
				},
				context,
			)
		).block,
		true,
	);
	const outcome = await harness.tools
		.get("workflow_product_review")
		.execute("first-blocker-terminal", {});
	assertPrivateSelectionSurface(outcome.content[0].text);
	assert.equal(
		JSON.parse(outcome.content[0].text).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH",
	);
});

test("public MCP product-review refuses a valid legacy v1 direct-workflow artifact before mutation", async () => {
	const sourcePersistence = publicationPersistence();
	const source = extensionHarness({ persistence: sourcePersistence });
	await prepareAndSelect(source, "legacy-source");
	await advanceApprovedToComments(source, "legacy-source");
	const legacyArtifact = legacyProductReviewArtifact(
		sourcePersistence.getArtifact(),
	);

	const harness = extensionHarness({
		persistence: publicationPersistence(legacyArtifact),
	});
	await harness.emit(
		"input",
		{ type: "input", text: "/product-review ILA-2324", source: "interactive" },
		context,
	);
	await callMcp(
		harness,
		"linear_get_user",
		"legacy-auth",
		{ query: "me" },
		ownerActor,
	);
	await callMcp(
		harness,
		"linear_get_issue",
		"legacy-issue-initial",
		{ id: "ILA-2324", includeRelations: true },
		validIssue(),
	);
	await callMcp(
		harness,
		"linear_get_issue",
		"legacy-issue-verified",
		{ id: "ILA-2324", includeRelations: true },
		validIssue(),
	);
	assert.equal(
		(
			await terminalOutcome(
				harness,
				"legacy-terminal",
			)
		).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT",
	);
});

test("public product-review marks verified publication terminal and blocks replay", async () => {
	const persistence = publicationPersistence();
	const interactiveDecisionStore = createInMemoryDecisionStore();
	const first = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(first, "adopt-first");
	await advanceApprovedToComments(first, "adopt-first");
	await callMcp(first, "linear_list_comments", "adopt-first-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(first, "linear_get_issue", "adopt-first-issue-mutation", { id: "ILA-2324", includeRelations: true }, validIssue());
	const save = await callMcp(
		first,
		"linear_save_comment",
		"adopt-first-save",
		{ issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" },
		undefined,
	);
	const comment = { id: "adopted-product-review", body: save.event.input.body, quotedText: null, parentId: null };
	await first.emit("tool_result", mcpResult("linear_save_comment", "adopt-first-save", comment), context);
	await callMcp(first, "linear_list_comments", "adopt-first-readback", { issueId: "ILA-2324" }, { comments: [comment], hasNextPage: false });
	const advancedIssue = validIssue({ updatedAt: "2026-07-27T19:21:02.958Z" });
	await callMcp(first, "linear_get_issue", "adopt-first-final", { id: "ILA-2324", includeRelations: true }, advancedIssue);
	assert.deepEqual(await terminalOutcome(first, "adopt-first"), {
		status: "published",
		issueId: "ILA-2324",
		commentId: comment.id,
	});

	const retry = extensionHarness({ persistence, interactiveDecisionStore });
	await retry.emit(
		"input",
		{ type: "input", text: "/product-review ILA-2324", source: "interactive" },
		context,
	);
	await callMcp(retry, "linear_get_user", "replay-auth", { query: "me" }, ownerActor);
	await callMcp(retry, "linear_get_issue", "replay-issue", { id: "ILA-2324", includeRelations: true }, advancedIssue);
	await callMcp(retry, "linear_get_issue", "replay-verify", { id: "ILA-2324", includeRelations: true }, advancedIssue);
	assert.equal(
		(await terminalOutcome(retry, "replay")).blocker.code,
		"PI_WORKFLOW_DECISION_REPLAY",
	);
	assert.equal(
		retry.toolCalls.some(({ toolName }) => toolName === "linear_save_comment"),
		false,
	);
});

test("public product-review recovers an uncertain save across runtime instances without authorizing a duplicate mutation", async () => {
	const persistence = publicationPersistence();
	const interactiveDecisionStore = createInMemoryDecisionStore();
	const interrupted = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(interrupted, "uncertain-first");
	await advanceApprovedToComments(interrupted, "uncertain-first");
	const digest = persistence.getArtifact().digest;
	await callMcp(interrupted, "linear_list_comments", "uncertain-first-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(interrupted, "linear_get_issue", "uncertain-first-issue-mutation", { id: "ILA-2324", includeRelations: true }, validIssue());
	const uncertainSave = await callMcp(
		interrupted,
		"linear_save_comment",
		"uncertain-first-save",
		{ issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" },
		undefined,
	);
	assert.notEqual(uncertainSave.event.input.body, "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY");
	await interrupted.emit("session_shutdown", { type: "session_shutdown" }, context);

	const recovered = extensionHarness({ persistence, interactiveDecisionStore });
	const currentIssue = validIssue({ updatedAt: "2026-07-27T19:21:03.958Z" });
	await prepareAndSelect(recovered, "uncertain-retry", currentIssue);
	await advanceApprovedToComments(recovered, "uncertain-retry", currentIssue);
	assert.equal(persistence.getArtifact().digest, digest);
	const comment = { id: "uncertain-created-comment", body: uncertainSave.event.input.body, quotedText: null, parentId: null };
	const lookup = await callMcp(recovered, "linear_list_comments", "uncertain-retry-comments", { issueId: "ILA-2324" }, { comments: [comment], hasNextPage: false });
	assert.match(lookup.resultOutcome.content.at(-1).text, /linear_list_comments/);
	assert.doesNotMatch(lookup.resultOutcome.content.at(-1).text, /linear_save_comment/);
	await callMcp(recovered, "linear_list_comments", "uncertain-retry-readback", { issueId: "ILA-2324" }, { comments: [comment], hasNextPage: false });
	await callMcp(recovered, "linear_get_issue", "uncertain-retry-final", { id: "ILA-2324", includeRelations: true }, currentIssue);
	assert.deepEqual(await terminalOutcome(recovered, "uncertain-retry"), {
		status: "published",
		issueId: "ILA-2324",
		commentId: comment.id,
	});

	const absentPersistence = publicationPersistence();
	const absentDecisionStore = createInMemoryDecisionStore();
	const absent = extensionHarness({
		persistence: absentPersistence,
		interactiveDecisionStore: absentDecisionStore,
	});
	await prepareAndSelect(absent, "uncertain-absent");
	await advanceApprovedToComments(absent, "uncertain-absent");
	const absentDigest = absentPersistence.getArtifact().digest;
	await callMcp(absent, "linear_list_comments", "uncertain-absent-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(absent, "linear_get_issue", "uncertain-absent-issue", { id: "ILA-2324", includeRelations: true }, validIssue());
	await callMcp(absent, "linear_save_comment", "uncertain-absent-save", { issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" }, undefined);
	await absent.emit("session_shutdown", { type: "session_shutdown" }, context);
	const absentRetry = extensionHarness({
		persistence: absentPersistence,
		interactiveDecisionStore: absentDecisionStore,
	});
	await prepareAndSelect(absentRetry, "uncertain-absent-retry");
	await advanceApprovedToComments(absentRetry, "uncertain-absent-retry");
	assert.equal(absentPersistence.getArtifact().digest, absentDigest);
	const missing = await callMcp(absentRetry, "linear_list_comments", "uncertain-absent-retry-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	assert.equal(missing.resultOutcome, undefined);
	assert.equal(
		(await terminalOutcome(absentRetry, "uncertain-absent-retry")).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PENDING",
	);
});

test("public product-review serializes concurrent save authorization without releasing uncertainty", async () => {
	const persistence = publicationPersistence();
	const interactiveDecisionStore = createInMemoryDecisionStore();
	const claim = persistence.recovery.claim;
	let claims = 0;
	let firstClaimed;
	const firstClaimGate = new Promise((resolve) => { firstClaimed = resolve; });
	let releaseClaims;
	const claimGate = new Promise((resolve) => { releaseClaims = resolve; });
	persistence.recovery.claim = async (...args) => {
		await claim(...args);
		claims += 1;
		if (claims === 1) firstClaimed();
		await claimGate;
	};
	const harness = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(harness, "concurrent-save");
	await advanceApprovedToComments(harness, "concurrent-save");
	const digest = persistence.getArtifact().digest;
	await callMcp(harness, "linear_list_comments", "concurrent-save-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(harness, "linear_get_issue", "concurrent-save-issue", { id: "ILA-2324", includeRelations: true }, validIssue());
	const input = { issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" };
	const first = harness.emit("tool_call", { toolName: "linear_save_comment", toolCallId: "concurrent-save-1", input: structuredClone(input) }, context);
	await firstClaimGate;
	const second = harness.emit("tool_call", { toolName: "linear_save_comment", toolCallId: "concurrent-save-2", input: structuredClone(input) }, context);
	releaseClaims();
	const outcomes = await Promise.all([first, second]);
	assert.equal(outcomes.filter((outcome) => outcome === undefined).length, 1);
	assert.equal(outcomes.filter((outcome) => outcome?.block === true).length, 1);
	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);

	const retry = extensionHarness({ persistence, interactiveDecisionStore });
	await prepareAndSelect(retry, "concurrent-save-retry");
	await advanceApprovedToComments(retry, "concurrent-save-retry");
	assert.equal(persistence.getArtifact().digest, digest);
	await callMcp(retry, "linear_list_comments", "concurrent-save-retry-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	assert.equal(
		(await terminalOutcome(retry, "concurrent-save-retry")).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PENDING",
	);
});

test("public product-review fails closed on malformed, out-of-order, mismatched, and lateral MCP traffic", async (t) => {
	await t.test("out-of-order result", async () => {
		const harness = extensionHarness();
		await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
		await harness.emit("tool_result", mcpResult("linear_get_user", "never-issued", ownerActor), context);
		assert.equal(
			(await terminalOutcome(harness, "out-of-order")).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
		);
	});

	await t.test("mismatched call and lateral mutation", async () => {
		const harness = extensionHarness();
		await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
		const blocked = await harness.emit(
			"tool_call",
			{ toolName: "linear_save_issue", toolCallId: "lateral-mutation", input: { id: "ILA-2324", state: "Done" } },
			context,
		);
		assert.equal(blocked.block, true);
		assert.equal(
			(await terminalOutcome(harness, "lateral")).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID",
		);
	});

	await t.test("mismatched result identity", async () => {
		const harness = extensionHarness();
		await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
		await harness.emit("tool_call", { toolName: "linear_get_user", toolCallId: "expected-owner", input: { query: "me" } }, context);
		await harness.emit("tool_result", mcpResult("linear_get_user", "different-owner", ownerActor), context);
		assert.equal(
			(await terminalOutcome(harness, "mismatched-result")).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
		);
	});

	await t.test("mismatched and conflicting issue identity", async (identityTest) => {
		await identityTest.test("mismatched id-as-identifier", async () => {
			const harness = extensionHarness();
			await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
			await callMcp(harness, "linear_get_user", "mismatched-issue-owner", { query: "me" }, ownerActor);
			await callMcp(
				harness,
				"linear_get_issue",
				"mismatched-issue",
				{ id: "ILA-2324", includeRelations: true },
				validIssue({ id: "ILA-9999", identifier: undefined }),
			);
			assert.equal(
				(await terminalOutcome(harness, "mismatched-issue")).blocker.code,
				"PI_WORKFLOW_PRODUCT_REVIEW_ISSUE_MISMATCH",
			);
		});

		await identityTest.test("conflicting id and identifier", async () => {
			const harness = extensionHarness();
			await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
			await callMcp(harness, "linear_get_user", "conflicting-issue-owner", { query: "me" }, ownerActor);
			await callMcp(
				harness,
				"linear_get_issue",
				"conflicting-issue",
				{ id: "ILA-2324", includeRelations: true },
				validIssue({ id: "ILA-9999" }),
			);
			assert.equal(
				(await terminalOutcome(harness, "conflicting-issue")).blocker.code,
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE",
			);
		});
	});

	await t.test("malformed result", async () => {
		const harness = extensionHarness();
		await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
		await harness.emit("tool_call", { toolName: "linear_get_user", toolCallId: "malformed-owner", input: { query: "me" } }, context);
		await harness.emit(
			"tool_result",
			{ toolName: "linear_get_user", toolCallId: "malformed-owner", content: [{ type: "text", text: "{" }], isError: false },
			context,
		);
		assert.equal(
			(await terminalOutcome(harness, "malformed")).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE",
		);
	});
});

test("public product-review protects every issue snapshot field before mutation", async () => {
	const drifts = [
		["opaque issue id", (issue) => { issue.id = "another-linear-uuid"; }],
		["title", (issue) => { issue.title = "Changed"; }],
		["description", (issue) => { issue.description = "Changed"; }],
		["status", (issue) => { issue.status = "Done"; }],
		["status type", (issue) => { issue.statusType = "completed"; }],
		["assignee", (issue) => { issue.assigneeId = "owner-2"; }],
		["cycle", (issue) => { issue.cycleId = "cycle-25"; }],
		["labels", (issue) => { issue.labels = ["Changed"]; }],
		["estimate", (issue) => { issue.estimate = 8; }],
		["priority", (issue) => { issue.priority = { id: "urgent", name: "Urgent" }; }],
		["project", (issue) => { issue.project = { id: "project-2", name: "Another project" }; }],
		["due date", (issue) => { issue.dueDate = "2026-08-02"; }],
		["unknown field", (issue) => { issue.futureLinearField = { enabled: true }; }],
		["parent", (issue) => { issue.parentId = "ILA-2297"; }],
		["relations", (issue) => { issue.relations.blockedBy = [{ id: "ILA-1" }]; }],
		["attachments", (issue) => { issue.attachments = [{ id: "a", title: "A", url: "https://example.test/a" }]; }],
		["revision", (issue) => { issue.updatedAt = "2026-07-27T19:21:02.958Z"; }],
	];
	for (const [name, mutate] of drifts) {
		const harness = extensionHarness();
		await prepareAndSelect(harness, `drift-${name.replaceAll(" ", "-")}`);
		const drifted = validIssue();
		mutate(drifted);
		await callMcp(
			harness,
			"linear_get_issue",
			`drift-${name}-issue`,
			{ id: "ILA-2324", includeRelations: true },
			drifted,
		);
		assert.equal(
			(await terminalOutcome(harness, `drift-${name}`)).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH",
			name,
		);
	}
});

test("public product-review rejects duplicate canonical roots across comment pages", async () => {
	const harness = extensionHarness();
	await prepareAndSelect(harness, "duplicate-root");
	await advanceApprovedToComments(harness, "duplicate-root");
	const digest = harness.getArtifact().digest;
	const golden = await readFile(new URL("./fixtures/product-review.accepted.golden.md", import.meta.url), "utf8");
	const body = golden.replace(/product-review:[a-f0-9]{64}/, `product-review:${digest}`);
	await callMcp(
		harness,
		"linear_list_comments",
		"duplicate-root-page-1",
		{ issueId: "ILA-2324" },
		{ comments: [{ id: "root-1", body, quotedText: null, parentId: null }], hasNextPage: true, cursor: "duplicate-root-page-2" },
	);
	await callMcp(
		harness,
		"linear_list_comments",
		"duplicate-root-page-2",
		{ issueId: "ILA-2324", cursor: "duplicate-root-page-2" },
		{ comments: [{ id: "root-2", body, quotedText: null, parentId: null }], hasNextPage: false },
	);
	assert.equal(
		(await terminalOutcome(harness, "duplicate-root")).blocker.code,
		"PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT",
	);
});

test("public product-review allows only monotonic comment-induced updatedAt drift after exact read-back", async () => {
	async function reachFinalIssueCheck(prefix) {
		const harness = extensionHarness();
		await prepareAndSelect(harness, prefix);
		await advanceApprovedToComments(harness, prefix);
		await callMcp(harness, "linear_list_comments", `${prefix}-comments`, { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
			await callMcp(harness, "linear_get_issue", `${prefix}-issue-mutation`, { id: "ILA-2324", includeRelations: true }, validIssue());
		const save = await callMcp(
			harness,
			"linear_save_comment",
			`${prefix}-save`,
			{ issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" },
			undefined,
		);
		const comment = { id: `${prefix}-comment`, body: save.event.input.body, quotedText: null, parentId: null };
		await harness.emit("tool_result", mcpResult("linear_save_comment", `${prefix}-save`, comment), context);
		await callMcp(harness, "linear_list_comments", `${prefix}-readback`, { issueId: "ILA-2324" }, { comments: [comment], hasNextPage: false });
		return { harness };
	}

	const regressed = await reachFinalIssueCheck("final-regressed");
	await callMcp(
		regressed.harness,
		"linear_get_issue",
		"final-regressed-issue",
		{ id: "ILA-2324", includeRelations: true },
		validIssue({ updatedAt: "2026-07-27T19:21:00.958Z" }),
	);
	assert.equal(
		(await terminalOutcome(regressed.harness, "final-regressed")).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH",
	);

	const protectedDrift = await reachFinalIssueCheck("final-protected-drift");
	await callMcp(
		protectedDrift.harness,
		"linear_get_issue",
		"final-protected-drift-issue",
		{ id: "ILA-2324", includeRelations: true },
		validIssue({ updatedAt: "2026-07-27T19:21:02.958Z", labels: ["Changed"] }),
	);
	assert.equal(
		(await terminalOutcome(protectedDrift.harness, "final-protected-drift")).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH",
	);
});
