import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const LINEAR_TOOLS = [
	"linear_get_user",
	"linear_get_issue",
	"linear_list_comments",
	"linear_save_comment",
	"workflow_product_review",
];

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
					? { digest: value.digest, stage: value.stage }
					: undefined;
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
				});
			},
			finalizeVerified: async (value) => {
				recoveries.set(value.payload.issue.id, {
					digest: value.digest,
					stage: "verified",
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
	runtimeEnvironment = {
		PI_WORKFLOW_OWNER_ACTOR_ID: "owner-1",
		PI_WORKFLOW_OWNER_AUTHORITY_REVISION: "owner-r1",
	},
} = {}) {
	const handlers = new Map();
	const tools = new Map();
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
			productReview: {
				runtime: {
					environment: runtimeEnvironment,
					drafts: { read: async () => structuredClone(draft) },
					artifacts: persistence.artifacts,
					recovery: persistence.recovery,
				},
			},
		},
	);
	return {
		tools,
		async emit(event, value, context = {}) {
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

async function continueOwnerSelection(
	harness,
	prefix,
	digest,
	{ issueId = "ILA-2324", result = "Aceptado" } = {},
) {
	const input = { issueId, result, digest };
	const prompt = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	assert.match(prompt.systemPrompt, /workflow_product_review/);
	assert.ok(prompt.systemPrompt.includes(JSON.stringify(input)));
	assert.doesNotMatch(prompt.systemPrompt, /linear_get_user/);
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
		...input,
	});
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
	assert.match(continued.content.at(-1).text, /linear_get_user/);
	return { call, result: resultValue, continued };
}

async function prepareAndSelect(
	harness,
	prefix,
	issue = validIssue(),
	result = "Aceptado",
	continueHandshake = true,
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
		ownerActor,
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
	const escapedResult = result.replace(" ", "\\s+");
	const digest = verified.resultOutcome.content
		.at(-1)
		.text.match(new RegExp(`ILA-2324 ${escapedResult} ([a-f0-9]{64})`))[1];
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: `ILA-2324 ${result} ${digest}`,
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	if (continueHandshake)
		await continueOwnerSelection(harness, prefix, digest, { result });
	return digest;
}

async function advanceApprovedToComments(
	harness,
	prefix,
	issue = validIssue(),
) {
	await callMcp(
		harness,
		"linear_get_user",
		`${prefix}-auth-approved`,
		{ query: "me" },
		ownerActor,
	);
	return callMcp(
		harness,
		"linear_get_issue",
		`${prefix}-issue-approved`,
		{ id: "ILA-2324", includeRelations: true },
		issue,
	);
}

async function terminalOutcome(harness, prefix, digest) {
	await harness.emit(
		"tool_call",
		{
			toolName: "workflow_product_review",
			toolCallId: `${prefix}-terminal`,
			input: { issueId: "ILA-2324", result: "Aceptado", digest },
		},
		context,
	);
	const result = await harness.tools.get("workflow_product_review").execute(
		`${prefix}-terminal`,
		{ issueId: "ILA-2324", result: "Aceptado", digest },
	);
	return JSON.parse(result.content[0].text);
}

test("public guard admits unavailable product-review only for an active /product-review turn", async () => {
	const harness = extensionHarness({ runtimeEnvironment: {} });
	const input = {
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: "a".repeat(64),
	};
	const outside = await harness.emit(
		"tool_call",
		{
			toolName: "workflow_product_review",
			toolCallId: "unconfigured-outside",
			input,
		},
		context,
	);
	assert.equal(outside.block, true);

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
	const admittedCall = {
		toolName: "workflow_product_review",
		toolCallId: "unconfigured-admitted",
		input,
	};
	assert.equal(await harness.emit("tool_call", admittedCall, context), undefined);
	const result = await harness.tools
		.get("workflow_product_review")
		.execute(admittedCall.toolCallId, admittedCall.input);
	assert.equal(
		JSON.parse(result.content[0].text).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_CONFIGURATION_REQUIRED",
	);
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	const after = await harness.emit(
		"tool_call",
		{
			toolName: "workflow_product_review",
			toolCallId: "unconfigured-after",
			input,
		},
		context,
	);
	assert.equal(after.block, true);
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
	const input = {
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: "a".repeat(64),
	};
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
	const digest = prepared.content
		.at(-1)
		.text.match(/ILA-2428 Aceptado ([a-f0-9]{64})/)[1];
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: `ILA-2428 Aceptado ${digest}`,
				source: "interactive",
			},
			context,
		),
		{ action: "continue" },
	);
	const { continued } = await continueOwnerSelection(
		harness,
		"real-pi",
		digest,
		{ issueId: "ILA-2428" },
	);
	assert.equal(persistence.getArtifact(), undefined);
	assert.equal(
		continued.content.at(-1).text,
		'Product review protocol: call linear_get_user exactly once now with {"query":"me"}. This is the only permitted next action; do not add fields or call tools in parallel.',
	);
});

test("default product-review prepares exact Owner choices from authenticated protected issue evidence and the canonical draft", async () => {
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
			assert.match(evidence.content.at(-1).text, /ILA-2324 Aceptado [a-f0-9]{64}/);
			assert.match(
				evidence.content.at(-1).text,
				/ILA-2324 Cambios requeridos [a-f0-9]{64}/,
			);
		}
	}
});

test("default product-review settles preparation, accepts the exact Owner choice, and reauthenticates before publication", async () => {
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
	const acceptedDigest = preparedInstruction.match(
		/ILA-2324 Aceptado ([a-f0-9]{64})/,
	)[1];
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	assert.deepEqual(
		await harness.emit(
			"input",
			{
				type: "input",
				text: `ILA-2324 Aceptado ${acceptedDigest}`,
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
	assert.match(resumed.systemPrompt, new RegExp(acceptedDigest));
	assert.doesNotMatch(resumed.systemPrompt, /linear_get_user/);
	const selectionCall = {
		toolName: "workflow_product_review",
		toolCallId: "owner-gate-selection",
		input: {
			issueId: "ILA-2324",
			result: "Aceptado",
			digest: acceptedDigest,
		},
	};
	assert.equal(await harness.emit("tool_call", selectionCall, context), undefined);
	const selectionResult = await harness.tools
		.get("workflow_product_review")
		.execute(selectionCall.toolCallId, selectionCall.input);
	assert.deepEqual(JSON.parse(selectionResult.content[0].text), {
		status: "continuing",
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: acceptedDigest,
	});
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
	assert.match(continued.content.at(-1).text, /linear_get_user/);
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
	const digest = preparedInstruction.match(/ILA-2324 Aceptado ([a-f0-9]{64})/)[1];
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	await harness.emit(
		"input",
		{ type: "input", text: `ILA-2324 Aceptado ${digest}`, source: "interactive" },
		context,
	);
	const { continued } = await continueOwnerSelection(
		harness,
		"publish",
		digest,
	);
	assert.equal(persistence.getArtifact(), undefined);
	assert.equal(
		continued.content.at(-1).text,
		'Product review protocol: call linear_get_user exactly once now with {"query":"me"}. This is the only permitted next action; do not add fields or call tools in parallel.',
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{ toolName: "linear_get_user", toolCallId: "publish-auth-2", input: { query: "me" } },
			context,
		),
		undefined,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "publish-auth-2", actor),
		context,
	);
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
		{ toolName: "linear_get_user", toolCallId: "publish-auth-3", input: { query: "me" } },
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "publish-auth-3", actor),
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
			{ toolName: "workflow_product_review", toolCallId: "publish-terminal", input: { issueId: "ILA-2324", result: "Aceptado", digest } },
			context,
		),
		undefined,
	);
	const result = await harness.tools
		.get("workflow_product_review")
		.execute("publish-terminal", { issueId: "ILA-2324", result: "Aceptado", digest });
	assert.deepEqual(JSON.parse(result.content[0].text), {
		status: "published",
		issueId: "ILA-2324",
		commentId: "product-comment-1",
	});
});

test("public product-review selection calls fail closed without authorizing mutation", async (t) => {
	const invalidCalls = [
		[
			"wrong shape",
			(digest) => ({
				issueId: "ILA-2324",
				result: "Aceptado",
				digest,
				extra: true,
			}),
		],
		[
			"mismatched selection",
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
			const digest = await prepareAndSelect(
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
					input: inputFor(digest),
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
		const digest = await prepareAndSelect(
			harness,
			"public-extra",
			validIssue(),
			"Aceptado",
			false,
		);
		const input = { issueId: "ILA-2324", result: "Aceptado", digest };
		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "workflow_product_review",
					toolCallId: "public-extra-first",
					input: structuredClone(input),
				},
				context,
			),
			undefined,
		);
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

test("default product-review requires the authenticated Linear user to match the configured Owner actor exactly", async () => {
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
		.execute("terminal-owner-mismatch", {
			issueId: "ILA-2324",
			result: "Aceptado",
			digest: "a".repeat(64),
		});
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
		{ ...ownerActor, id: "another-owner" },
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
		.execute("first-blocker-terminal", {
			issueId: "ILA-2324",
			result: "Aceptado",
			digest: "a".repeat(64),
		});
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
				legacyArtifact.digest,
			)
		).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT",
	);
});

test("public product-review adopts the exact canonical root comment across paginated idempotent retries", async () => {
	const persistence = publicationPersistence();
	const first = extensionHarness({ persistence });
	const digest = await prepareAndSelect(first, "adopt-first");
	await advanceApprovedToComments(first, "adopt-first");
	await callMcp(first, "linear_list_comments", "adopt-first-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(first, "linear_get_user", "adopt-first-auth-mutation", { query: "me" }, ownerActor);
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
	assert.deepEqual(await terminalOutcome(first, "adopt-first", digest), {
		status: "published",
		issueId: "ILA-2324",
		commentId: comment.id,
	});

	const retry = extensionHarness({ persistence });
	const retryDigest = await prepareAndSelect(retry, "adopt-retry", advancedIssue);
	assert.equal(retryDigest, digest);
	await advanceApprovedToComments(retry, "adopt-retry", advancedIssue);
	await callMcp(
		retry,
		"linear_list_comments",
		"adopt-retry-page-1",
		{ issueId: "ILA-2324" },
		{ comments: [{ id: "inline-copy", body: comment.body, quotedText: "anchor", parentId: null }], hasNextPage: true, cursor: "adopt-page-2" },
	);
	const adopted = await callMcp(
		retry,
		"linear_list_comments",
		"adopt-retry-page-2",
		{ issueId: "ILA-2324", cursor: "adopt-page-2" },
		{ comments: [comment], hasNextPage: false },
	);
	assert.match(adopted.resultOutcome.content.at(-1).text, /linear_list_comments/);
	assert.doesNotMatch(adopted.resultOutcome.content.at(-1).text, /linear_save_comment/);
	await callMcp(retry, "linear_list_comments", "adopt-retry-readback-1", { issueId: "ILA-2324" }, { comments: [], hasNextPage: true, cursor: "readback-page-2" });
	await callMcp(retry, "linear_list_comments", "adopt-retry-readback-2", { issueId: "ILA-2324", cursor: "readback-page-2" }, { comments: [comment], hasNextPage: false });
	await callMcp(retry, "linear_get_issue", "adopt-retry-final", { id: "ILA-2324", includeRelations: true }, advancedIssue);
	assert.deepEqual(await terminalOutcome(retry, "adopt-retry", digest), {
		status: "published",
		issueId: "ILA-2324",
		commentId: comment.id,
	});
});

test("public product-review recovers an uncertain save across runtime instances without authorizing a duplicate mutation", async () => {
	const persistence = publicationPersistence();
	const interrupted = extensionHarness({ persistence });
	const digest = await prepareAndSelect(interrupted, "uncertain-first");
	await advanceApprovedToComments(interrupted, "uncertain-first");
	await callMcp(interrupted, "linear_list_comments", "uncertain-first-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(interrupted, "linear_get_user", "uncertain-first-auth-mutation", { query: "me" }, ownerActor);
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

	const recovered = extensionHarness({ persistence });
	const currentIssue = validIssue({ updatedAt: "2026-07-27T19:21:03.958Z" });
	assert.equal(await prepareAndSelect(recovered, "uncertain-retry", currentIssue), digest);
	await advanceApprovedToComments(recovered, "uncertain-retry", currentIssue);
	const comment = { id: "uncertain-created-comment", body: uncertainSave.event.input.body, quotedText: null, parentId: null };
	const lookup = await callMcp(recovered, "linear_list_comments", "uncertain-retry-comments", { issueId: "ILA-2324" }, { comments: [comment], hasNextPage: false });
	assert.match(lookup.resultOutcome.content.at(-1).text, /linear_list_comments/);
	assert.doesNotMatch(lookup.resultOutcome.content.at(-1).text, /linear_save_comment/);
	await callMcp(recovered, "linear_list_comments", "uncertain-retry-readback", { issueId: "ILA-2324" }, { comments: [comment], hasNextPage: false });
	await callMcp(recovered, "linear_get_issue", "uncertain-retry-final", { id: "ILA-2324", includeRelations: true }, currentIssue);
	assert.deepEqual(await terminalOutcome(recovered, "uncertain-retry", digest), {
		status: "published",
		issueId: "ILA-2324",
		commentId: comment.id,
	});

	const absentPersistence = publicationPersistence();
	const absent = extensionHarness({ persistence: absentPersistence });
	const absentDigest = await prepareAndSelect(absent, "uncertain-absent");
	await advanceApprovedToComments(absent, "uncertain-absent");
	await callMcp(absent, "linear_list_comments", "uncertain-absent-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(absent, "linear_get_user", "uncertain-absent-auth", { query: "me" }, ownerActor);
	await callMcp(absent, "linear_get_issue", "uncertain-absent-issue", { id: "ILA-2324", includeRelations: true }, validIssue());
	await callMcp(absent, "linear_save_comment", "uncertain-absent-save", { issueId: "ILA-2324", body: "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY" }, undefined);
	await absent.emit("session_shutdown", { type: "session_shutdown" }, context);
	const absentRetry = extensionHarness({ persistence: absentPersistence });
	assert.equal(await prepareAndSelect(absentRetry, "uncertain-absent-retry"), absentDigest);
	await advanceApprovedToComments(absentRetry, "uncertain-absent-retry");
	const missing = await callMcp(absentRetry, "linear_list_comments", "uncertain-absent-retry-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	assert.equal(missing.resultOutcome, undefined);
	assert.equal(
		(await terminalOutcome(absentRetry, "uncertain-absent-retry", absentDigest)).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PENDING",
	);
});

test("public product-review serializes concurrent save authorization without releasing uncertainty", async () => {
	const persistence = publicationPersistence();
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
	const harness = extensionHarness({ persistence });
	const digest = await prepareAndSelect(harness, "concurrent-save");
	await advanceApprovedToComments(harness, "concurrent-save");
	await callMcp(harness, "linear_list_comments", "concurrent-save-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	await callMcp(harness, "linear_get_user", "concurrent-save-auth", { query: "me" }, ownerActor);
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

	const retry = extensionHarness({ persistence });
	assert.equal(await prepareAndSelect(retry, "concurrent-save-retry"), digest);
	await advanceApprovedToComments(retry, "concurrent-save-retry");
	await callMcp(retry, "linear_list_comments", "concurrent-save-retry-comments", { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
	assert.equal(
		(await terminalOutcome(retry, "concurrent-save-retry", digest)).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PENDING",
	);
});

test("public product-review fails closed on malformed, out-of-order, mismatched, and lateral MCP traffic", async (t) => {
	await t.test("out-of-order result", async () => {
		const harness = extensionHarness();
		await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
		await harness.emit("tool_result", mcpResult("linear_get_user", "never-issued", ownerActor), context);
		assert.equal(
			(await terminalOutcome(harness, "out-of-order", "a".repeat(64))).blocker.code,
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
			(await terminalOutcome(harness, "lateral", "a".repeat(64))).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID",
		);
	});

	await t.test("mismatched result identity", async () => {
		const harness = extensionHarness();
		await harness.emit("input", { type: "input", text: "/product-review ILA-2324", source: "interactive" }, context);
		await harness.emit("tool_call", { toolName: "linear_get_user", toolCallId: "expected-owner", input: { query: "me" } }, context);
		await harness.emit("tool_result", mcpResult("linear_get_user", "different-owner", ownerActor), context);
		assert.equal(
			(await terminalOutcome(harness, "mismatched-result", "a".repeat(64))).blocker.code,
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
				(await terminalOutcome(harness, "mismatched-issue", "a".repeat(64))).blocker.code,
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
				(await terminalOutcome(harness, "conflicting-issue", "a".repeat(64))).blocker.code,
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
			(await terminalOutcome(harness, "malformed", "a".repeat(64))).blocker.code,
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
		const digest = await prepareAndSelect(harness, `drift-${name.replaceAll(" ", "-")}`);
		await callMcp(harness, "linear_get_user", `drift-${name}-auth`, { query: "me" }, ownerActor);
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
			(await terminalOutcome(harness, `drift-${name}`, digest)).blocker.code,
			"PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH",
			name,
		);
	}
});

test("public product-review rejects duplicate canonical roots across comment pages", async () => {
	const harness = extensionHarness();
	const digest = await prepareAndSelect(harness, "duplicate-root");
	await advanceApprovedToComments(harness, "duplicate-root");
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
		(await terminalOutcome(harness, "duplicate-root", digest)).blocker.code,
		"PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT",
	);
});

test("public product-review allows only monotonic comment-induced updatedAt drift after exact read-back", async () => {
	async function reachFinalIssueCheck(prefix) {
		const harness = extensionHarness();
		const digest = await prepareAndSelect(harness, prefix);
		await advanceApprovedToComments(harness, prefix);
		await callMcp(harness, "linear_list_comments", `${prefix}-comments`, { issueId: "ILA-2324" }, { comments: [], hasNextPage: false });
		await callMcp(harness, "linear_get_user", `${prefix}-auth-mutation`, { query: "me" }, ownerActor);
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
		return { harness, digest };
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
		(await terminalOutcome(regressed.harness, "final-regressed", regressed.digest)).blocker.code,
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
		(await terminalOutcome(protectedDrift.harness, "final-protected-drift", protectedDrift.digest)).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH",
	);
});
