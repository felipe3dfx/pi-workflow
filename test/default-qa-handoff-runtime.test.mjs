import assert from "node:assert/strict";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { produceQaHandoffDraft } from "../extensions/qa-handoff-draft-producer.ts";
import { createQaHandoffDraftStore } from "../extensions/qa-handoff-draft-store.ts";
import { createQaHandoffPublicationRecoveryStore } from "../extensions/qa-handoff-publication-recovery.ts";
import { createQaHandoffArtifact } from "../extensions/qa-handoff-workflow.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const MCP_TOOL_NAMES = [
	"linear_get_user",
	"linear_get_issue",
	"linear_list_comments",
	"linear_save_comment",
	"workflow_qa_handoff",
];

function extensionHarness({
	toolNames = MCP_TOOL_NAMES,
	drafts: injectedDrafts,
	artifacts: injectedArtifacts,
	recovery: injectedRecovery,
	toolIdentityReservationCapacity,
} = {}) {
	const handlers = new Map();
	const tools = new Map();
	const toolCalls = [];
	const persistedDrafts = new Map();
	const persistedArtifacts = new Map();
	const publicationRecoveries = new Map();
	const recovery = injectedRecovery ?? {
		read: async (issueId) => {
			const stored = publicationRecoveries.get(issueId);
			return stored?.stage === "uncertain" || stored?.stage === "verified"
				? { digest: stored.digest, stage: stored.stage }
				: undefined;
		},
		claim: async (artifact, ownerId) => {
			const issueId = artifact.payload.issue.id;
			const claim = { digest: artifact.digest, stage: "uncertain", ownerId };
			const existing = publicationRecoveries.get(issueId);
			if (existing && existing.digest !== claim.digest)
				throw new Error("recovery conflict");
			if (existing?.stage === "uncertain" && existing.ownerId !== ownerId)
				throw new Error("recovery claim is already owned");
			publicationRecoveries.set(issueId, structuredClone(claim));
		},
		release: async (artifact, ownerId) => {
			const existing = publicationRecoveries.get(artifact.payload.issue.id);
			if (existing?.stage === "uncertain" && existing.ownerId !== ownerId)
				throw new Error("recovery claim is already owned");
			publicationRecoveries.set(artifact.payload.issue.id, {
				digest: artifact.digest,
				stage: "released",
			});
		},
		finalizeVerified: async (artifact) => {
			publicationRecoveries.set(artifact.payload.issue.id, {
				digest: artifact.digest,
				stage: "verified",
			});
		},
	};
	piWorkflowExtension(
		{
			exec: async () => ({ code: 0 }),
			getAllTools: () => toolNames.map((name) => ({ name })),
			registerCommand: () => {},
			registerTool: (tool) => tools.set(tool.name, tool),
			on: (event, handler) => {
				const registered = handlers.get(event) ?? [];
				registered.push(handler);
				handlers.set(event, registered);
			},
		},
		{
			qaHandoff: {
				recovery,
				toolIdentityReservationCapacity,
				drafts: injectedDrafts ?? {
					read: async (issueId) =>
						structuredClone(persistedDrafts.get(issueId)?.payload.draft),
					save: async ({ issueId, draft }) => {
						const artifact = {
							payload: { issue: { id: issueId }, draft },
							digest: "a".repeat(64),
						};
						const existing = persistedDrafts.get(issueId);
						if (
							existing &&
							JSON.stringify(existing) !== JSON.stringify(artifact)
						)
							throw Object.assign(new Error("conflict"), {
								code: "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT",
							});
						persistedDrafts.set(issueId, structuredClone(artifact));
						return structuredClone(artifact);
					},
				},
				artifacts: injectedArtifacts ?? {
					read: async (issueId) =>
						structuredClone(persistedArtifacts.get(issueId)),
					save: async (artifact) => {
						const issueId = artifact.payload.issue.id;
						const existing = persistedArtifacts.get(issueId);
						if (
							existing &&
							JSON.stringify(existing) !== JSON.stringify(artifact)
						)
							throw Object.assign(new Error("conflict"), {
								code: "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT",
							});
						persistedArtifacts.set(issueId, structuredClone(artifact));
						return structuredClone(artifact);
					},
				},
			},
		},
	);
	return {
		tools,
		toolCalls,
		persistedArtifacts,
		publicationRecoveries,
		async emit(event, value, context) {
			let result;
			for (const handler of handlers.get(event) ?? []) {
				const candidate = await handler(value, context);
				if (candidate !== undefined) result = candidate;
			}
			if (event === "tool_call") toolCalls.push(structuredClone(value));
			return result;
		},
	};
}

const context = {
	isIdle: () => true,
	ui: { notify: () => {} },
};

function productionRecoveryStore() {
	const values = new Map();
	let revision = 0;
	return createQaHandoffPublicationRecoveryStore({
		project: "pi-workflow",
		store: {
			capabilities: { atomicCompareAndSwap: true },
			readCurrent: async (_project, topic) => values.get(topic),
			readRevision: async (_project, topic, expectedRevision) => {
				const current = values.get(topic);
				return current?.revision === expectedRevision
					? current.content
					: undefined;
			},
			write: async (_project, topic, content, expectedRevision) => {
				const current = values.get(topic);
				assert.equal(current?.revision, expectedRevision);
				revision += 1;
				const saved = { revision: `recovery-${revision}`, content };
				values.set(topic, saved);
				return { revision: saved.revision };
			},
		},
	});
}

function mcpResult(toolName, toolCallId, payload) {
	return {
		toolName,
		toolCallId,
		content: [{ type: "text", text: JSON.stringify(payload) }],
		isError: false,
	};
}

const helperCallSequences = new WeakMap();

function nextHelperCallId(harness, base) {
	let sequences = helperCallSequences.get(harness);
	if (!sequences) {
		sequences = new Map();
		helperCallSequences.set(harness, sequences);
	}
	const sequence = (sequences.get(base) ?? 0) + 1;
	sequences.set(base, sequence);
	return sequence === 1 ? base : `${base}-${sequence}`;
}

async function startPreflight(harness) {
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/qa-handoff ILA-2410",
			source: "interactive",
		},
		context,
	);
}

async function advanceToIssue(harness) {
	await startPreflight(harness);
	const toolCallId = nextHelperCallId(harness, "user-call");
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId,
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", toolCallId, {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
}

async function verifyIssue(harness, issue = validIssue()) {
	const toolCallId = nextHelperCallId(harness, "issue-verify-call");
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId,
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", toolCallId, issue),
		context,
	);
}

async function advanceToComments(harness, issue = validIssue()) {
	await advanceToIssue(harness);
	const toolCallId = nextHelperCallId(harness, "issue-call");
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId,
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", toolCallId, issue),
		context,
	);
	await verifyIssue(harness, issue);
	return harness.persistedArtifacts.get("ILA-2410");
}

async function terminalOutcome(harness) {
	const result = await harness.tools
		.get("workflow_qa_handoff")
		.execute("workflow-call", { issueId: "ILA-2410" });
	return JSON.parse(result.content[0].text);
}

async function terminalBlocker(harness) {
	return (await terminalOutcome(harness)).blocker.code;
}

async function readCommentsBefore(harness, existingComments = []) {
	const toolCallId = nextHelperCallId(harness, "comments-before-call");
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId,
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", toolCallId, {
			comments: existingComments,
			hasNextPage: false,
		}),
		context,
	);
}

async function revalidateActorBeforeMutation() {
	// The active non-guest Linear identity is frozen from the execution's one lookup.
}

async function verifyIssueBeforeMutation(harness, issue = validIssue()) {
	const toolCallId = nextHelperCallId(harness, "issue-before-mutation-call");
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId,
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", toolCallId, issue),
		context,
	);
}

async function publishFromPersistedArtifact(
	harness,
	existingComments = [],
	issue = validIssue(),
	finalIssue = issue,
) {
	const artifact = harness.persistedArtifacts.get("ILA-2410");
	assert.ok(artifact);
	await readCommentsBefore(harness, existingComments);
	let comment = existingComments.find(({ body }) => body === artifact.body);
	if (!comment) {
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness, issue);
		const commentCallId = nextHelperCallId(harness, "comment-create-call");
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: commentCallId,
				input: {
					issueId: "ILA-2410",
					body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
				},
			},
			context,
		);
		comment = { id: "comment-2410", body: artifact.body };
		await harness.emit(
			"tool_result",
			mcpResult("linear_save_comment", commentCallId, comment),
			context,
		);
	}
	const commentsReadbackCallId = nextHelperCallId(
		harness,
		"comments-readback-call",
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: commentsReadbackCallId,
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", commentsReadbackCallId, {
			comments: [comment],
			hasNextPage: false,
		}),
		context,
	);
	const issueFinalCallId = nextHelperCallId(harness, "issue-final-call");
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: issueFinalCallId,
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", issueFinalCallId, finalIssue),
		context,
	);
	return { artifact, comment, outcome: await terminalOutcome(harness) };
}

function validIssue(overrides = {}) {
	return {
		id: "linear-uuid-2410",
		identifier: "ILA-2410",
		title: "Validate preflight",
		description:
			'```qa-handoff-evidence\n{"schema":"qa-handoff-evidence","schemaVersion":1,"pullRequestAttachmentId":"pr","buildAttachmentId":"build","qaEnvironmentAttachmentId":"qa","acceptanceCriteria":[{"id":"AC-1","description":"Cumple el criterio acordado.","evidenceAttachmentIds":["test"]}]}\n```',
		updatedAt: "2026-07-27T19:21:01.958Z",
		status: "In Code Review",
		statusType: "started",
		assignee: "Developer",
		assigneeId: "developer-1",
		cycleId: "cycle-24",
		labels: ["Developer", "QA"],
		parentId: "ILA-2400",
		relations: {
			blockedBy: [{ id: "ILA-2401", title: "Prepare QA environment" }],
			blocks: [{ id: "ILA-2411", title: "Run QA" }],
			relatedTo: [{ id: "ILA-2399", title: "Delivery plan" }],
			duplicateOf: null,
		},
		attachments: [
			{
				id: "pr",
				title: "PR #47",
				url: "https://github.com/example/repo/pull/47",
			},
			{
				id: "build",
				title: "Build 47",
				url: "https://github.com/example/repo/actions/runs/47",
			},
			{
				id: "qa",
				title: "Entorno QA",
				url: "https://pi-workflow-qa.vercel.app",
			},
			{
				id: "test",
				title: "Prueba integrada",
				url: "https://github.com/example/repo/actions/runs/48",
			},
		],
		...overrides,
	};
}

test("default public qa-handoff publishes its deterministic production artifact through the exact Linear MCP sequence", async () => {
	const previousKey = process.env.LINEAR_API_KEY;
	process.env.LINEAR_API_KEY = "must-not-be-read";
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("QA preflight must not use direct HTTP");
	};
	try {
		const harness = extensionHarness();
		assert.deepEqual(
			await harness.emit(
				"input",
				{ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" },
				context,
			),
			{ action: "continue" },
		);

		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_user",
					toolCallId: "user-call",
					input: { query: "me" },
				},
				context,
			),
			undefined,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_get_user", "user-call", {
				id: "developer-1",
				name: "Developer",
				isActive: true,
				isGuest: false,
			}),
			context,
		);

		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_issue",
					toolCallId: "issue-call",
					input: { id: "ILA-2410", includeRelations: true },
				},
				context,
			),
			undefined,
		);
		const issue = validIssue({ title: "Validar preflight" });
		await harness.emit(
			"tool_result",
			mcpResult("linear_get_issue", "issue-call", issue),
			context,
		);
		await verifyIssue(harness, issue);

		const artifact = harness.persistedArtifacts.get("ILA-2410");
		const producedDraft = produceQaHandoffDraft(issue);
		assert.equal(producedDraft.status, "produced");
		const {
			issue: _artifactIssue,
			authority: _artifactAuthority,
			...artifactDraft
		} = artifact.payload;
		assert.deepEqual(artifactDraft, producedDraft.draft);
		assert.equal(artifact.schema, "qa-handoff");
		assert.equal(artifact.schemaVersion, 1);
		assert.equal(artifact.language, "es");
		assert.equal(artifact.payload.issue.revision, "2026-07-27T19:21:01.958Z");
		assert.deepEqual(artifact.payload.authority, {
			actorId: "developer-1",
			role: "Developer",
			authorityRevision: artifact.payload.authority.authorityRevision,
		});
		assert.equal(
			artifact.payload.authority.authorityRevision,
			"single-user/v1",
		);
		assert.equal(
			artifact.digest,
			digestCanonicalValue({
				schema: artifact.schema,
				schemaVersion: artifact.schemaVersion,
				language: artifact.language,
				payload: artifact.payload,
			}),
		);
		for (const invariant of [
			"# Entrega para QA — ILA-2410",
			"## Resultado\n\n**Estado:** Listo para QA",
			producedDraft.draft.outcome.summary,
			"## Evidencia de PR y build",
			"## Entorno de QA",
			"## Criterios de aceptación",
			"## Guía de pruebas",
			"## Riesgos y restricciones\n\nNinguno conocido.",
		]) {
			assert.equal(artifact.body.includes(invariant), true);
		}
		assert.match(
			artifact.body,
			new RegExp(`Referencia de flujo: qa-handoff:${artifact.digest}$`, "m"),
		);

		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_list_comments",
					toolCallId: "comments-before-call",
					input: { issueId: "ILA-2410" },
				},
				context,
			),
			undefined,
		);
		const commentsInstruction = await harness.emit(
			"tool_result",
			mcpResult("linear_list_comments", "comments-before-call", {
				comments: [],
				hasNextPage: false,
			}),
			context,
		);
		assert.match(
			commentsInstruction.content.at(-1).text,
			/linear_get_issue.*ILA-2410/s,
		);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness, issue);

		const createCall = {
			toolName: "linear_save_comment",
			toolCallId: "comment-create-call",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		};
		assert.equal(
			await harness.emit("tool_call", createCall, context),
			undefined,
		);
		assert.deepEqual(createCall.input, {
			issueId: "ILA-2410",
			body: artifact.body,
		});
		const comment = { id: "comment-2410", body: createCall.input.body };
		await harness.emit(
			"tool_result",
			mcpResult("linear_save_comment", "comment-create-call", comment),
			context,
		);

		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_list_comments",
					toolCallId: "comments-readback-call",
					input: { issueId: "ILA-2410" },
				},
				context,
			),
			undefined,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_list_comments", "comments-readback-call", {
				comments: [comment],
				hasNextPage: false,
			}),
			context,
		);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-final-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_get_issue", "issue-final-call", issue),
			context,
		);

		assert.equal(
			await harness.emit(
				"tool_call",
				{
					toolName: "workflow_qa_handoff",
					toolCallId: "workflow-call",
					input: { issueId: "ILA-2410" },
				},
				context,
			),
			undefined,
		);
		const result = await harness.tools
			.get("workflow_qa_handoff")
			.execute("workflow-call", { issueId: "ILA-2410" });
		const outcome = JSON.parse(result.content[0].text);
		assert.deepEqual(outcome, {
			status: "published",
			issueId: "ILA-2410",
			commentId: "comment-2410",
		});
		assert.deepEqual(harness.publicationRecoveries.get("ILA-2410"), {
			digest: artifact.digest,
			stage: "verified",
		});
		assert.deepEqual(harness.toolCalls, [
			{
				toolName: "linear_get_user",
				toolCallId: "user-call",
				input: { query: "me" },
			},
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-verify-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			{
				toolName: "linear_list_comments",
				toolCallId: "comments-before-call",
				input: { issueId: "ILA-2410" },
			},
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-before-mutation-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			{
				toolName: "linear_save_comment",
				toolCallId: "comment-create-call",
				input: { issueId: "ILA-2410", body: artifact.body },
			},
			{
				toolName: "linear_list_comments",
				toolCallId: "comments-readback-call",
				input: { issueId: "ILA-2410" },
			},
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-final-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			{
				toolName: "workflow_qa_handoff",
				toolCallId: "workflow-call",
				input: { issueId: "ILA-2410" },
			},
		]);
		assert.equal("LINEAR_API_KEY" in outcome, false);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousKey === undefined) delete process.env.LINEAR_API_KEY;
		else process.env.LINEAR_API_KEY = previousKey;
	}
});

test("qa-handoff preserves legacy authority provenance when approved content is unchanged", async () => {
	const issue = validIssue();
	const produced = produceQaHandoffDraft(issue);
	assert.equal(produced.status, "produced");
	const historicalActor = {
		id: "developer-1",
		name: "Developer",
		isActive: true,
		isGuest: false,
	};
	const legacy = createQaHandoffArtifact(
		{ id: "ILA-2410", updatedAt: issue.updatedAt },
		{
			actorId: historicalActor.id,
			role: "Developer",
			authorityRevision: digestCanonicalValue(historicalActor),
		},
		produced.draft,
	);
	const harness = extensionHarness();
	harness.persistedArtifacts.set("ILA-2410", structuredClone(legacy));
	const artifact = await advanceToComments(harness, issue);
	assert.deepEqual(artifact, legacy);
	const { outcome } = await publishFromPersistedArtifact(harness, [], issue);
	assert.equal(outcome.status, "published");
	assert.deepEqual(harness.persistedArtifacts.get("ILA-2410"), legacy);
	assert.equal(
		harness.toolCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
		1,
	);
});

test("qa-handoff blocks extra MCP input before execution", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" },
		context,
	);
	assert.deepEqual(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "user-call",
				input: { query: "me", limit: 1 },
			},
			context,
		),
		{ block: true, reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" },
	);
	assert.deepEqual(await terminalOutcome(harness), {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
			message:
				"QA handoff MCP tool, input, issue, body, or stage did not match the active publication plan.",
		},
	});
});

test("qa-handoff blocks non-protocol reads before execution", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" },
		context,
	);
	assert.deepEqual(
		await harness.emit(
			"tool_call",
			{
				toolName: "read",
				toolCallId: "wrong-read",
				input: { path: "/tmp/unrelated" },
			},
			context,
		),
		{
			block: true,
			reason:
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
		},
	);
});

test("settled default qa-handoff releases unrelated tools", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);

	await harness.emit("agent_settled", { type: "agent_settled" }, context);

	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "write",
				toolCallId: "unrelated-call",
				input: { path: "/tmp/unrelated", content: "unrelated" },
			},
			context,
		),
		undefined,
	);
});

test("qa-handoff fails closed when Linear MCP tools are unavailable", async () => {
	const harness = extensionHarness({ toolNames: ["workflow_qa_handoff"] });
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/qa-handoff ILA-2410",
			source: "interactive",
		},
		context,
	);
	await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		context,
	);
	const result = await harness.tools
		.get("workflow_qa_handoff")
		.execute("workflow-call", { issueId: "ILA-2410" });
	assert.equal(
		JSON.parse(result.content[0].text).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE",
	);
});

test("qa-handoff classifies an explicit MCP unauthenticated error", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			content: [
				{ type: "text", text: JSON.stringify({ code: "UNAUTHENTICATED" }) },
			],
			isError: true,
		},
		context,
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_UNAUTHENTICATED",
	);
});

test("qa-handoff keeps an unauthenticated marker without a true error signal incompatible", async () => {
	for (const variant of [
		{ name: "missing isError", isError: undefined },
		{ name: "false isError", isError: false },
	]) {
		const harness = extensionHarness();
		await startPreflight(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "user-call",
				input: { query: "me" },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			{
				toolName: "linear_get_user",
				toolCallId: "user-call",
				content: [{ type: "text", text: '{"code":"UNAUTHENTICATED"}' }],
				...(variant.isError === undefined ? {} : { isError: variant.isError }),
			},
			context,
		);

		assert.equal(
			await terminalBlocker(harness),
			"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
			variant.name,
		);
	}
});

test("qa-handoff keeps ambiguous MCP errors incompatible", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						code: "UNAUTHENTICATED",
						message: "login required",
					}),
				},
			],
			isError: true,
		},
		context,
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);
});

test("qa-handoff preserves actionable MCP failure classifications", async () => {
	for (const variant of [
		{
			upstream: "PERMISSION_DENIED",
			expected: "PI_WORKFLOW_QA_HANDOFF_MCP_PERMISSION_DENIED",
		},
		{
			upstream: "RATE_LIMITED",
			expected: "PI_WORKFLOW_QA_HANDOFF_MCP_RATE_LIMITED",
		},
		{
			upstream: "TRANSPORT_ERROR",
			expected: "PI_WORKFLOW_QA_HANDOFF_MCP_TRANSPORT_FAILED",
		},
	]) {
		const harness = extensionHarness();
		await startPreflight(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "user-call",
				input: { query: "me" },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			{
				toolName: "linear_get_user",
				toolCallId: "user-call",
				content: [
					{
						type: "text",
						text: JSON.stringify({
							code: variant.upstream,
							message: "Actionable upstream failure.",
						}),
					},
				],
				isError: true,
			},
			context,
		);

		assert.equal(
			await terminalBlocker(harness),
			variant.expected,
			variant.upstream,
		);
	}
});

test("qa-handoff rejects malformed actionable MCP error envelopes", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						code: "RATE_LIMITED",
						message: 429,
						partialResult: { id: "developer-1" },
					}),
				},
			],
			isError: true,
		},
		context,
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);
});

test("qa-handoff blocks wrong tools and out-of-order stages before execution", async () => {
	for (const variant of [
		{
			call: {
				toolName: "linear_get_issue",
				toolCallId: "early",
				input: { id: "ILA-2410" },
			},
			reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		},
		{
			call: {
				toolName: "linear_list_comments",
				toolCallId: "wrong",
				input: { issueId: "ILA-2410" },
			},
			reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		},
	]) {
		const harness = extensionHarness();
		await startPreflight(harness);
		assert.deepEqual(await harness.emit("tool_call", variant.call, context), {
			block: true,
			reason: variant.reason,
		});
		assert.equal(
			await terminalBlocker(harness),
			"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		);
	}
});

test("qa-handoff blocks wrong comment-list issues and fields", async () => {
	for (const input of [
		{ issueId: "ILA-9999" },
		{ issueId: "ILA-2410", limit: 250 },
	]) {
		const harness = extensionHarness();
		await advanceToComments(harness);
		assert.deepEqual(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_list_comments",
					toolCallId: "comments-before-call",
					input,
				},
				context,
			),
			{ block: true, reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" },
		);
		assert.equal(
			await terminalBlocker(harness),
			"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		);
	}
});

test("qa-handoff rejects a repeated identity lookup before mutation", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);

	assert.deepEqual(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "user-before-mutation-call",
				input: { query: "me" },
			},
			context,
		),
		{ block: true, reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" },
	);
	assert.equal(
		harness.toolCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
		2,
	);
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff blocks complete issue snapshot drift immediately before mutation", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);

	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-before-mutation-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		),
		undefined,
	);
	await harness.emit(
		"tool_result",
		mcpResult(
			"linear_get_issue",
			"issue-before-mutation-call",
			validIssue({ estimate: 8 }),
		),
		context,
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
	);
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff blocks protected issue mutation after comment creation and exact readback", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	const created = { id: "comment-2410", body: artifact.body };
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "comment-create-call",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_save_comment", "comment-create-call", created),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-readback-call",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-readback-call", {
			comments: [created],
			hasNextPage: false,
		}),
		context,
	);

	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-final-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		),
		undefined,
	);
	await harness.emit(
		"tool_result",
		mcpResult(
			"linear_get_issue",
			"issue-final-call",
			validIssue({ status: "Ready for QA" }),
		),
		context,
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
	);
});

test("qa-handoff permits only one exact root comment creation input", async () => {
	for (const mutate of [
		(input) => ({ ...input, issueId: "ILA-9999" }),
		(input) => ({ ...input, body: `${input.body}\nAlterado` }),
		(input) => ({ ...input, parentId: "parent-comment" }),
		(input) => ({ ...input, id: "existing-comment" }),
	]) {
		const harness = extensionHarness();
		await advanceToComments(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_list_comments",
				toolCallId: "comments-before-call",
				input: { issueId: "ILA-2410" },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_list_comments", "comments-before-call", {
				comments: [],
				hasNextPage: false,
			}),
			context,
		);
		const exact = {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		};
		assert.deepEqual(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_save_comment",
					toolCallId: "comment-create-call",
					input: mutate(exact),
				},
				context,
			),
			{ block: true, reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" },
		);
		assert.equal(
			await terminalBlocker(harness),
			"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		);
	}
});

test("qa-handoff finds an exact existing comment on a later page", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-page-1",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-page-1", {
			comments: [],
			hasNextPage: true,
			cursor: "cursor-2",
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-page-2",
			input: { issueId: "ILA-2410", cursor: "cursor-2" },
		},
		context,
	);
	const existing = { id: "existing-page-2", body: artifact.body };
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-page-2", {
			comments: [existing],
			hasNextPage: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-readback-call",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-readback-call", {
			comments: [existing],
			hasNextPage: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-final-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-final-call", validIssue()),
		context,
	);
	assert.equal((await terminalOutcome(harness)).status, "published");
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff rejects blank and repeated pagination cursors", async () => {
	const blank = extensionHarness();
	await advanceToComments(blank);
	await blank.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "blank-page",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await blank.emit(
		"tool_result",
		mcpResult("linear_list_comments", "blank-page", {
			comments: [],
			hasNextPage: true,
			cursor: "",
		}),
		context,
	);
	assert.equal(
		await terminalBlocker(blank),
		"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
	);

	const nonString = extensionHarness();
	await advanceToComments(nonString);
	await nonString.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "non-string-page",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await nonString.emit(
		"tool_result",
		mcpResult("linear_list_comments", "non-string-page", {
			comments: [],
			hasNextPage: true,
			cursor: 42,
		}),
		context,
	);
	assert.equal(
		await terminalBlocker(nonString),
		"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
	);

	const repeated = extensionHarness();
	await advanceToComments(repeated);
	await repeated.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "repeat-page-1",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await repeated.emit(
		"tool_result",
		mcpResult("linear_list_comments", "repeat-page-1", {
			comments: [],
			hasNextPage: true,
			cursor: "same-cursor",
		}),
		context,
	);
	await repeated.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "repeat-page-2",
			input: { issueId: "ILA-2410", cursor: "same-cursor" },
		},
		context,
	);
	await repeated.emit(
		"tool_result",
		mcpResult("linear_list_comments", "repeat-page-2", {
			comments: [],
			hasNextPage: true,
			cursor: "same-cursor",
		}),
		context,
	);
	assert.equal(
		await terminalBlocker(repeated),
		"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
	);
});

test("qa-handoff detects only the exact visible artifact reference before mutation", async () => {
	const conflict = extensionHarness();
	const artifact = await advanceToComments(conflict);
	const marker = `Referencia de flujo: qa-handoff:${artifact.digest}`;
	await conflict.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-before-call",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await conflict.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-before-call", {
			comments: [{ id: "conflict", body: `Cuerpo distinto.\n\n${marker}` }],
			hasNextPage: false,
		}),
		context,
	);
	assert.equal(
		await terminalBlocker(conflict),
		"PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT",
	);
	assert.equal(
		conflict.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);

	const nearMarker = extensionHarness();
	const nearArtifact = await advanceToComments(nearMarker);
	const nearReference = `Referencia de flujo: qa-handoff:${nearArtifact.digest}`;
	const result = await publishFromPersistedArtifact(nearMarker, [
		{ id: "embedded", body: `Prosa con ${nearReference} dentro de una línea.` },
		{ id: "trailing", body: `${nearReference}-extra` },
	]);
	assert.equal(result.outcome.status, "published");
	assert.equal(
		nearMarker.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff adopts its exact comment after Linear advances issue updatedAt", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	const updatedIssue = validIssue({ updatedAt: "2026-07-27T19:22:01.958Z" });
	const first = await publishFromPersistedArtifact(
		harness,
		[],
		validIssue(),
		updatedIssue,
	);
	assert.deepEqual(first.outcome, {
		status: "published",
		issueId: "ILA-2410",
		commentId: first.comment.id,
	});

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness, updatedIssue);
	const retried = await publishFromPersistedArtifact(
		harness,
		[first.comment],
		updatedIssue,
	);
	assert.deepEqual(retried.outcome, first.outcome);
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff verifies the final issue snapshot on the existing-idempotent path", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	const existing = { id: "comment-existing", body: artifact.body };
	await readCommentsBefore(harness, [existing]);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-readback-call",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-readback-call", {
			comments: [existing],
			hasNextPage: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-final-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult(
			"linear_get_issue",
			"issue-final-call",
			validIssue({ cycleId: "cycle-25" }),
		),
		context,
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
	);
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff never treats an inline description comment as the canonical root comment", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-before-call",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-before-call", {
			comments: [
				{
					id: "inline-comment",
					body: artifact.body,
					quotedText: "Descripción seleccionada",
				},
			],
			hasNextPage: false,
		}),
		context,
	);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	const createCall = {
		toolName: "linear_save_comment",
		toolCallId: "comment-create-call",
		input: {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		},
	};

	assert.equal(await harness.emit("tool_call", createCall, context), undefined);
	assert.equal(createCall.input.body, artifact.body);
});

test("qa-handoff retries safely when interrupted before comment authorization", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	const retried = await publishFromPersistedArtifact(harness);
	assert.equal(retried.outcome.status, "published");
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff recovers an uncertain creation through lookup without duplicating the mutation", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "uncertain-comment-create",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING",
	);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	const existing = {
		id: "comment-created-before-interruption",
		body: artifact.body,
	};
	const recovered = await publishFromPersistedArtifact(harness, [existing]);

	assert.deepEqual(recovered.outcome, {
		status: "published",
		issueId: "ILA-2410",
		commentId: existing.id,
	});
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff releases a claim acquired after its turn is cancelled and retries safely", async () => {
	let recoveryState;
	let releaseClaim;
	const claimPaused = new Promise((resolve) => {
		releaseClaim = resolve;
	});
	let signalClaimed;
	const claimed = new Promise((resolve) => {
		signalClaimed = resolve;
	});
	const harness = extensionHarness({
		recovery: {
			read: async () => {
				if (recoveryState?.stage !== "uncertain") return undefined;
				return { digest: recoveryState.digest, stage: recoveryState.stage };
			},
			claim: async (artifact, ownerId) => {
				recoveryState = {
					digest: artifact.digest,
					stage: "uncertain",
					ownerId,
				};
				signalClaimed();
				await claimPaused;
			},
			release: async (artifact, ownerId) => {
				assert.deepEqual(recoveryState, {
					digest: artifact.digest,
					stage: "uncertain",
					ownerId,
				});
				recoveryState = { digest: artifact.digest, stage: "released" };
			},
			finalizeVerified: async (artifact) => {
				recoveryState = { digest: artifact.digest, stage: "verified" };
			},
		},
	});
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	const pendingCall = harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "claim-before-shutdown",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	await claimed;

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	releaseClaim();
	assert.equal((await pendingCall)?.block, true);
	assert.equal(recoveryState.stage, "released");

	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	assert.equal(
		(await publishFromPersistedArtifact(harness)).outcome.status,
		"published",
	);
	assert.equal(recoveryState.stage, "verified");
});

test("qa-handoff keeps recovery ownership generation-specific across replacement races", async () => {
	const draftsByIssue = new Map();
	const artifactsByIssue = new Map();
	const drafts = {
		read: async (issueId) => structuredClone(draftsByIssue.get(issueId)),
		save: async ({ issueId, draft }) => {
			const existing = draftsByIssue.get(issueId);
			if (existing && JSON.stringify(existing) !== JSON.stringify(draft))
				throw new Error("draft conflict");
			draftsByIssue.set(issueId, structuredClone(draft));
			return {
				payload: { issue: { id: issueId }, draft },
				digest: "a".repeat(64),
			};
		},
	};
	const artifacts = {
		read: async (issueId) => structuredClone(artifactsByIssue.get(issueId)),
		save: async (artifact) => {
			const issueId = artifact.payload.issue.id;
			const existing = artifactsByIssue.get(issueId);
			if (existing && JSON.stringify(existing) !== JSON.stringify(artifact))
				throw new Error("artifact conflict");
			artifactsByIssue.set(issueId, structuredClone(artifact));
			return structuredClone(artifact);
		},
	};
	let recoveryState;
	let firstOwnerId;
	const rejectedOwners = [];
	let resumeFirstClaim;
	const firstClaimGate = new Promise((resolve) => {
		resumeFirstClaim = resolve;
	});
	let signalFirstClaim;
	const firstClaimStarted = new Promise((resolve) => {
		signalFirstClaim = resolve;
	});
	let resumeStaleRelease;
	const staleReleaseGate = new Promise((resolve) => {
		resumeStaleRelease = resolve;
	});
	let signalStaleRelease;
	const staleReleaseStarted = new Promise((resolve) => {
		signalStaleRelease = resolve;
	});
	let claimCount = 0;
	const recovery = {
		read: async () =>
			recoveryState?.stage === "uncertain"
				? { digest: recoveryState.digest, stage: recoveryState.stage }
				: undefined,
		claim: async (artifact, ownerId) => {
			claimCount += 1;
			if (claimCount === 1) {
				firstOwnerId = ownerId;
				signalFirstClaim();
				await firstClaimGate;
			}
			if (
				recoveryState?.stage === "uncertain" &&
				recoveryState.ownerId !== ownerId
			) {
				rejectedOwners.push(ownerId);
				throw new Error("recovery claim is already owned");
			}
			recoveryState = { digest: artifact.digest, stage: "uncertain", ownerId };
		},
		release: async (artifact, ownerId) => {
			assert.equal(ownerId, firstOwnerId);
			assert.equal(recoveryState.ownerId, ownerId);
			signalStaleRelease();
			await staleReleaseGate;
			assert.equal(recoveryState.ownerId, ownerId);
			recoveryState = { digest: artifact.digest, stage: "released", ownerId };
		},
		finalizeVerified: async () => {},
	};
	const replacement = extensionHarness({ drafts, artifacts, recovery });
	const third = extensionHarness({ drafts, artifacts, recovery });
	for (const harness of [replacement, third]) {
		await advanceToComments(harness);
		await readCommentsBefore(harness);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness);
	}
	const firstCall = replacement.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "stale-generation-comment",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	await firstClaimStarted;

	await replacement.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(replacement);
	await readCommentsBefore(replacement);
	await revalidateActorBeforeMutation(replacement);
	await verifyIssueBeforeMutation(replacement);
	resumeFirstClaim();
	await staleReleaseStarted;

	const replacementAttempt = await replacement.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "replacement-generation-comment",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	const thirdAttempt = await third.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "third-runtime-comment",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	assert.equal(replacementAttempt?.block, true);
	assert.equal(thirdAttempt?.block, true);
	assert.equal(rejectedOwners.length, 2);
	assert.equal(rejectedOwners.includes(firstOwnerId), false);

	resumeStaleRelease();
	assert.equal((await firstCall)?.block, true);
	await replacement.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(replacement);
	await readCommentsBefore(replacement);
	await revalidateActorBeforeMutation(replacement);
	await verifyIssueBeforeMutation(replacement);
	assert.equal(
		await replacement.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "sole-authorized-comment",
				input: {
					issueId: "ILA-2410",
					body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
				},
			},
			context,
		),
		undefined,
	);
	await third.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(third);
	await readCommentsBefore(third);
	assert.equal(
		await terminalBlocker(third),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING",
	);
});

test("qa-handoff cancels stale draft persistence after an awaited read", async () => {
	const persistedDrafts = new Map();
	const persistedArtifacts = new Map();
	let resumeDraftRead;
	const draftReadGate = new Promise((resolve) => {
		resumeDraftRead = resolve;
	});
	let signalDraftRead;
	const draftReadStarted = new Promise((resolve) => {
		signalDraftRead = resolve;
	});
	let pauseFirstRead = true;
	let draftSaves = 0;
	let artifactSaves = 0;
	const harness = extensionHarness({
		drafts: {
			read: async (issueId) => {
				if (pauseFirstRead) {
					pauseFirstRead = false;
					signalDraftRead();
					await draftReadGate;
				}
				return structuredClone(persistedDrafts.get(issueId));
			},
			save: async ({ issueId, draft }) => {
				draftSaves += 1;
				persistedDrafts.set(issueId, structuredClone(draft));
				return {
					payload: { issue: { id: issueId }, draft },
					digest: "a".repeat(64),
				};
			},
		},
		artifacts: {
			read: async (issueId) => structuredClone(persistedArtifacts.get(issueId)),
			save: async (artifact) => {
				artifactSaves += 1;
				persistedArtifacts.set(
					artifact.payload.issue.id,
					structuredClone(artifact),
				);
				return structuredClone(artifact);
			},
		},
	});
	await advanceToIssue(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "paused-draft-issue",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "paused-draft-issue", validIssue()),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "paused-draft-verify",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const pendingVerification = harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "paused-draft-verify", validIssue()),
		context,
	);
	await draftReadStarted;
	await harness.emit("session_start", { type: "session_start" }, context);
	await startPreflight(harness);
	resumeDraftRead();
	await pendingVerification;
	assert.equal(draftSaves, 0);
	assert.equal(artifactSaves, 0);

	await advanceToComments(harness);
	assert.equal(draftSaves, 1);
	assert.equal(artifactSaves, 1);
});

test("qa-handoff replacement bypasses canceled never-settling preparation", async () => {
	const persistedDrafts = new Map();
	const persistedArtifacts = new Map();
	let signalReadStarted;
	const readStarted = new Promise((resolve) => {
		signalReadStarted = resolve;
	});
	const neverSettles = new Promise(() => {});
	let blockFirstRead = true;
	const harness = extensionHarness({
		drafts: {
			read: async (issueId) => {
				if (blockFirstRead) {
					blockFirstRead = false;
					signalReadStarted();
					await neverSettles;
				}
				return structuredClone(persistedDrafts.get(issueId));
			},
			save: async ({ issueId, draft }) => {
				persistedDrafts.set(issueId, structuredClone(draft));
				return {
					payload: { issue: { id: issueId }, draft },
					digest: "a".repeat(64),
				};
			},
		},
		artifacts: {
			read: async (issueId) => structuredClone(persistedArtifacts.get(issueId)),
			save: async (artifact) => {
				persistedArtifacts.set(
					artifact.payload.issue.id,
					structuredClone(artifact),
				);
				return structuredClone(artifact);
			},
		},
	});
	await startPreflight(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "never-settling-user",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "never-settling-user", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "never-settling-issue",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "never-settling-issue", validIssue()),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "never-settling-verify",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const abandonedPreparation = harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "never-settling-verify", validIssue()),
		context,
	);
	await readStarted;
	await harness.emit("agent_settled", { type: "agent_settled" }, context);

	await advanceToComments(harness);
	assert.ok(persistedArtifacts.get("ILA-2410"));
	void abandonedPreparation;
});

test("qa-handoff reconciles an already-started artifact write before replacement persistence", async () => {
	const persistedDrafts = new Map();
	const persistedArtifacts = new Map();
	let resumeArtifactSave;
	const artifactSaveGate = new Promise((resolve) => {
		resumeArtifactSave = resolve;
	});
	let signalArtifactSave;
	const artifactSaveStarted = new Promise((resolve) => {
		signalArtifactSave = resolve;
	});
	let pauseFirstSave = true;
	let artifactSaves = 0;
	const harness = extensionHarness({
		drafts: {
			read: async (issueId) => structuredClone(persistedDrafts.get(issueId)),
			save: async ({ issueId, draft }) => {
				persistedDrafts.set(issueId, structuredClone(draft));
				return {
					payload: { issue: { id: issueId }, draft },
					digest: "a".repeat(64),
				};
			},
		},
		artifacts: {
			read: async (issueId) => structuredClone(persistedArtifacts.get(issueId)),
			save: async (artifact) => {
				artifactSaves += 1;
				if (pauseFirstSave) {
					pauseFirstSave = false;
					signalArtifactSave();
					await artifactSaveGate;
				}
				persistedArtifacts.set(
					artifact.payload.issue.id,
					structuredClone(artifact),
				);
				return structuredClone(artifact);
			},
		},
	});
	await advanceToIssue(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "paused-artifact-issue",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "paused-artifact-issue", validIssue()),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "paused-artifact-verify",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const pendingVerification = harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "paused-artifact-verify", validIssue()),
		context,
	);
	await artifactSaveStarted;
	await harness.emit("session_start", { type: "session_start" }, context);
	await startPreflight(harness);
	resumeArtifactSave();
	await pendingVerification;
	assert.equal(artifactSaves, 1);

	await advanceToComments(harness);
	assert.equal(artifactSaves, 1);
	assert.ok(persistedArtifacts.get("ILA-2410"));
});

test("qa-handoff reserves settled tool identities across replacement generations", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "settled-reused-call",
			input: { query: "me" },
		},
		context,
	);
	const settledResult = mcpResult("linear_get_user", "settled-reused-call", {
		id: "developer-1",
		name: "Developer",
		isActive: true,
		isGuest: false,
	});
	await harness.emit("tool_result", structuredClone(settledResult), context);
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	await startPreflight(harness);

	assert.equal(
		(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_user",
					toolCallId: "settled-reused-call",
					input: { query: "me" },
				},
				context,
			)
		)?.block,
		true,
	);
	assert.equal(
		await harness.emit("tool_result", structuredClone(settledResult), context),
		undefined,
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "settled-replacement-fresh-call",
				input: { query: "me" },
			},
			context,
		),
		undefined,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "settled-replacement-fresh-call", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	assert.equal(
		(
			await harness.emit("before_agent_start", {}, context)
		).systemPrompt.includes("linear_get_issue"),
		true,
	);
});

test("qa-handoff ignores an unresolved old result when a replacement reuses its identity", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "reused-unresolved-call",
				input: { query: "me" },
			},
			context,
		),
		undefined,
	);
	await harness.emit("session_start", { type: "session_start" }, context);
	await startPreflight(harness);
	assert.equal(
		(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_user",
					toolCallId: "reused-unresolved-call",
					input: { query: "me" },
				},
				context,
			)
		)?.block,
		true,
	);
	assert.equal(
		await harness.emit(
			"tool_result",
			mcpResult("linear_get_user", "reused-unresolved-call", {
				id: "developer-1",
				name: "Developer",
				isActive: true,
				isGuest: false,
			}),
			context,
		),
		undefined,
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "replacement-fresh-call",
				input: { query: "me" },
			},
			context,
		),
		undefined,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "replacement-fresh-call", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "replacement-issue-after-stale-result",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		),
		undefined,
	);
});

test("qa-handoff reserves identities across sessions through the runtime capacity boundary", async () => {
	const runtimeCapacity = 2;
	const harness = extensionHarness({
		toolIdentityReservationCapacity: runtimeCapacity,
	});
	for (let index = 0; index < runtimeCapacity; index += 1) {
		if (index > 0)
			await harness.emit("session_start", { type: "session_start" }, context);
		await startPreflight(harness);
		const block = await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: `runtime-reservation-${index}`,
				input: { query: "me" },
			},
			context,
		);
		assert.equal(block, undefined, `reservation ${index}`);
	}

	await harness.emit("session_start", { type: "session_start" }, context);
	await startPreflight(harness);
	assert.equal(
		(
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_user",
					toolCallId: "runtime-reservation-over-capacity",
					input: { query: "me" },
				},
				context,
			)
		)?.block,
		true,
	);
	assert.deepEqual(await terminalOutcome(harness), {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
			message:
				"The QA handoff extension runtime exhausted its bounded 2 tool identity reservation capacity; reload the extension before starting another handoff.",
		},
	});
});

test("qa-handoff grants only one concurrent owner permission to mutate", async () => {
	const recovery = productionRecoveryStore();
	const first = extensionHarness({ recovery });
	const second = extensionHarness({ recovery });
	for (const harness of [first, second]) {
		await advanceToComments(harness);
		await readCommentsBefore(harness);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness);
	}
	const mutation = {
		toolName: "linear_save_comment",
		toolCallId: "concurrent-create",
		input: {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		},
	};
	assert.equal(
		await first.emit("tool_call", structuredClone(mutation), context),
		undefined,
	);
	assert.equal(
		(await second.emit("tool_call", structuredClone(mutation), context))?.block,
		true,
	);
	assert.equal(
		await terminalBlocker(second),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
	);
});

test("qa-handoff serializes concurrent mutation calls within one runtime", async () => {
	const harness = extensionHarness({ recovery: productionRecoveryStore() });
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	const input = {
		issueId: "ILA-2410",
		body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
	};
	const [first, second] = await Promise.all([
		harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "concurrent-create-1",
				input: structuredClone(input),
			},
			context,
		),
		harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "concurrent-create-2",
				input: structuredClone(input),
			},
			context,
		),
	]);
	assert.equal(first, undefined);
	assert.equal(second?.block, true);
	assert.equal(second?.reason, "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID");
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_save_comment",
			toolCallId: "concurrent-create-1",
			content: [
				{ type: "text", text: JSON.stringify({ code: "PERMISSION_DENIED" }) },
			],
			isError: true,
		},
		context,
	);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_PERMISSION_DENIED",
	);
});

test("qa-handoff serializes concurrent duplicate permission results before releasing recovery", async () => {
	let releaseCalls = 0;
	const harness = extensionHarness({
		recovery: {
			read: async () => undefined,
			claim: async () => {},
			release: async () => {
				releaseCalls += 1;
			},
			finalizeVerified: async () => {},
		},
	});
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "duplicate-permission-result",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	const result = {
		toolName: "linear_save_comment",
		toolCallId: "duplicate-permission-result",
		content: [
			{ type: "text", text: JSON.stringify({ code: "PERMISSION_DENIED" }) },
		],
		isError: true,
	};

	await Promise.all([
		harness.emit("tool_result", structuredClone(result), context),
		harness.emit("tool_result", structuredClone(result), context),
	]);

	assert.equal(releaseCalls, 1);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_PERMISSION_DENIED",
	);
});

test("qa-handoff ignores a concurrent duplicate final result after durable finalization", async () => {
	let finalizeCalls = 0;
	let signalFinalizeStarted;
	const finalizeStarted = new Promise((resolve) => {
		signalFinalizeStarted = resolve;
	});
	let releaseFinalize;
	const finalizeGate = new Promise((resolve) => {
		releaseFinalize = resolve;
	});
	const harness = extensionHarness({
		recovery: {
			read: async () => undefined,
			claim: async () => {},
			release: async () => {},
			finalizeVerified: async () => {
				finalizeCalls += 1;
				signalFinalizeStarted();
				await finalizeGate;
			},
		},
	});
	const artifact = await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "comment-create-call",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	const comment = { id: "comment-2410", body: artifact.body };
	await harness.emit(
		"tool_result",
		mcpResult("linear_save_comment", "comment-create-call", comment),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "comments-readback-call",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "comments-readback-call", {
			comments: [comment],
			hasNextPage: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "duplicate-final-result",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const result = mcpResult(
		"linear_get_issue",
		"duplicate-final-result",
		validIssue(),
	);

	const first = harness.emit("tool_result", structuredClone(result), context);
	await finalizeStarted;
	const duplicate = harness.emit(
		"tool_result",
		structuredClone(result),
		context,
	);
	releaseFinalize();
	await Promise.all([first, duplicate]);

	assert.equal(finalizeCalls, 1);
	assert.deepEqual(await terminalOutcome(harness), {
		status: "published",
		issueId: "ILA-2410",
		commentId: "comment-2410",
	});
});

test("qa-handoff does not resurrect a cleared turn after recovery release resumes", async () => {
	let signalReleaseStarted;
	const releaseStarted = new Promise((resolve) => {
		signalReleaseStarted = resolve;
	});
	let resumeRelease;
	const releaseGate = new Promise((resolve) => {
		resumeRelease = resolve;
	});
	const harness = extensionHarness({
		recovery: {
			read: async () => undefined,
			claim: async () => {},
			release: async () => {
				signalReleaseStarted();
				await releaseGate;
			},
			finalizeVerified: async () => {},
		},
	});
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "release-before-shutdown",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	const pendingResult = harness.emit(
		"tool_result",
		{
			toolName: "linear_save_comment",
			toolCallId: "release-before-shutdown",
			content: [
				{ type: "text", text: JSON.stringify({ code: "PERMISSION_DENIED" }) },
			],
			isError: true,
		},
		context,
	);
	await releaseStarted;

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	resumeRelease();
	await pendingResult;

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
	);
});

test("qa-handoff does not corrupt a replacement turn after recovery finalization resumes", async () => {
	let signalFinalizeStarted;
	const finalizeStarted = new Promise((resolve) => {
		signalFinalizeStarted = resolve;
	});
	let resumeFinalize;
	const finalizeGate = new Promise((resolve) => {
		resumeFinalize = resolve;
	});
	const harness = extensionHarness({
		recovery: {
			read: async () => undefined,
			claim: async () => {},
			release: async () => {},
			finalizeVerified: async () => {
				signalFinalizeStarted();
				await finalizeGate;
			},
		},
	});
	const artifact = await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "comment-before-replacement",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	const comment = { id: "comment-before-replacement", body: artifact.body };
	await harness.emit(
		"tool_result",
		mcpResult("linear_save_comment", "comment-before-replacement", comment),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "readback-before-replacement",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "readback-before-replacement", {
			comments: [comment],
			hasNextPage: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "final-before-replacement",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const pendingFinalResult = harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "final-before-replacement", validIssue()),
		context,
	);
	await finalizeStarted;

	await harness.emit("session_start", { type: "session_start" }, context);
	await harness.emit(
		"input",
		{
			type: "input",
			text: "/qa-handoff ILA-2411",
			source: "interactive",
		},
		context,
	);
	resumeFinalize();
	await pendingFinalResult;
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_user",
				toolCallId: "replacement-user",
				input: { query: "me" },
			},
			context,
		),
		undefined,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_user", "replacement-user", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "replacement-issue",
				input: { id: "ILA-2411", includeRelations: true },
			},
			context,
		),
		undefined,
	);
});

test("qa-handoff applies first concurrent result and fails closed without later corruption", async () => {
	async function pendingCommentResult() {
		const harness = extensionHarness();
		const artifact = await advanceToComments(harness);
		await readCommentsBefore(harness);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "conflicting-comment-result",
				input: {
					issueId: "ILA-2410",
					body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
				},
			},
			context,
		);
		return { harness, artifact };
	}

	const acceptedFirst = await pendingCommentResult();
	const valid = mcpResult("linear_save_comment", "conflicting-comment-result", {
		id: "accepted-comment",
		body: acceptedFirst.artifact.body,
	});
	const malformed = mcpResult(
		"linear_save_comment",
		"conflicting-comment-result",
		{ id: "conflicting-comment", body: "different body" },
	);
	await Promise.all([
		acceptedFirst.harness.emit("tool_result", structuredClone(valid), context),
		acceptedFirst.harness.emit(
			"tool_result",
			structuredClone(malformed),
			context,
		),
	]);
	assert.equal(
		await terminalBlocker(acceptedFirst.harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);

	const malformedFirst = await pendingCommentResult();
	await Promise.all([
		malformedFirst.harness.emit(
			"tool_result",
			structuredClone(malformed),
			context,
		),
		malformedFirst.harness.emit("tool_result", structuredClone(valid), context),
	]);
	assert.equal(
		await terminalBlocker(malformedFirst.harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);
});

test("qa-handoff ignores settled duplicate results and rejects conflicting late payloads", async () => {
	const duplicate = extensionHarness();
	await startPreflight(duplicate);
	await duplicate.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "late-user-result",
			input: { query: "me" },
		},
		context,
	);
	const actorResult = mcpResult("linear_get_user", "late-user-result", {
		id: "developer-1",
		name: "Developer",
		isActive: true,
		isGuest: false,
	});
	await duplicate.emit("tool_result", structuredClone(actorResult), context);
	assert.equal(
		await duplicate.emit("tool_result", structuredClone(actorResult), context),
		undefined,
	);
	assert.equal(
		await duplicate.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-after-late-duplicate",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		),
		undefined,
	);

	const conflict = extensionHarness();
	await startPreflight(conflict);
	await conflict.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "late-conflicting-result",
			input: { query: "me" },
		},
		context,
	);
	await conflict.emit(
		"tool_result",
		{
			...structuredClone(actorResult),
			toolCallId: "late-conflicting-result",
		},
		context,
	);
	await conflict.emit(
		"tool_result",
		mcpResult("linear_get_user", "late-conflicting-result", {
			id: "developer-2",
			name: "Another Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	assert.equal(
		await terminalBlocker(conflict),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);
});

test("qa-handoff ignores a final result duplicated after settlement", async () => {
	let finalizeCalls = 0;
	const harness = extensionHarness({
		recovery: {
			read: async () => undefined,
			claim: async () => {},
			release: async () => {},
			finalizeVerified: async () => {
				finalizeCalls += 1;
			},
		},
	});
	const artifact = await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "late-final-comment",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	const comment = { id: "late-final-comment", body: artifact.body };
	await harness.emit(
		"tool_result",
		mcpResult("linear_save_comment", "late-final-comment", comment),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_list_comments",
			toolCallId: "late-final-readback",
			input: { issueId: "ILA-2410" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_list_comments", "late-final-readback", {
			comments: [comment],
			hasNextPage: false,
		}),
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "settled-final-result",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const finalResult = mcpResult(
		"linear_get_issue",
		"settled-final-result",
		validIssue(),
	);
	await harness.emit("tool_result", structuredClone(finalResult), context);
	assert.equal(finalizeCalls, 1);
	assert.equal(
		await harness.emit("tool_result", structuredClone(finalResult), context),
		undefined,
	);
	assert.equal(finalizeCalls, 1);
	assert.deepEqual(await terminalOutcome(harness), {
		status: "published",
		issueId: "ILA-2410",
		commentId: comment.id,
	});
});

test("qa-handoff blocks mutation when its durable recovery claim cannot be verified", async () => {
	const harness = extensionHarness({
		recovery: {
			read: async () => undefined,
			claim: async () => {
				throw new Error("recovery read-back mismatch");
			},
			release: async () => {},
			finalizeVerified: async () => {},
		},
	});
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);

	assert.deepEqual(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "comment-create-call",
				input: {
					issueId: "ILA-2410",
					body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
				},
			},
			context,
		),
		{
			block: true,
			reason: "PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
		},
	);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
	);
});

test("qa-handoff safely retries through production recovery after permission denial", async () => {
	const harness = extensionHarness({ recovery: productionRecoveryStore() });
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "permission-denied-create",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_save_comment",
			toolCallId: "permission-denied-create",
			content: [
				{ type: "text", text: JSON.stringify({ code: "PERMISSION_DENIED" }) },
			],
			isError: true,
		},
		context,
	);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_PERMISSION_DENIED",
	);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	const retried = await publishFromPersistedArtifact(harness);
	assert.equal(retried.outcome.status, "published");
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		2,
	);
});

test("qa-handoff keeps a rate-limited comment mutation lookup-only", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "rate-limited-create",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_save_comment",
			toolCallId: "rate-limited-create",
			content: [
				{ type: "text", text: JSON.stringify({ code: "RATE_LIMITED" }) },
			],
			isError: true,
		},
		context,
	);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_RATE_LIMITED",
	);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING",
	);
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff keeps post-create transport and malformed results lookup-only", async () => {
	for (const variant of [
		{
			name: "transport",
			result: {
				content: [
					{ type: "text", text: JSON.stringify({ code: "TRANSPORT_ERROR" }) },
				],
				isError: true,
			},
			expected: "PI_WORKFLOW_QA_HANDOFF_MCP_TRANSPORT_FAILED",
		},
		{
			name: "partial success",
			result: mcpResult("linear_save_comment", "uncertain-create", {}),
			expected: "PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
		},
	]) {
		const harness = extensionHarness();
		await advanceToComments(harness);
		await readCommentsBefore(harness);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "uncertain-create",
				input: {
					issueId: "ILA-2410",
					body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
				},
			},
			context,
		);
		await harness.emit(
			"tool_result",
			{
				toolName: "linear_save_comment",
				toolCallId: "uncertain-create",
				...variant.result,
			},
			context,
		);
		assert.equal(
			await terminalBlocker(harness),
			variant.expected,
			variant.name,
		);

		await harness.emit(
			"session_shutdown",
			{ type: "session_shutdown" },
			context,
		);
		await harness.emit("session_start", { type: "session_start" }, context);
		await advanceToComments(harness);
		await readCommentsBefore(harness);
		assert.equal(
			await terminalBlocker(harness),
			"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING",
			variant.name,
		);
		assert.equal(
			harness.toolCalls.filter(
				({ toolName }) => toolName === "linear_save_comment",
			).length,
			1,
			variant.name,
		);
	}
});

test("qa-handoff fails closed on unreadable durable recovery", async () => {
	const recovery = {
		read: async () => {
			throw new Error("corrupt recovery");
		},
		claim: async () => {},
		release: async () => {},
		finalizeVerified: async () => {},
	};
	const harness = extensionHarness({ recovery });
	await advanceToComments(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
	);
});

test("qa-handoff preserves verified recovery across public-seam digest drift", async () => {
	const verified = { digest: "b".repeat(64), stage: "verified" };
	const recovery = {
		read: async () => structuredClone(verified),
		claim: async () => {
			throw new Error("must not claim drifted recovery");
		},
		release: async () => {
			throw new Error("must not release drifted recovery");
		},
		finalizeVerified: async () => {
			throw new Error("must not replace verified recovery");
		},
	};
	const harness = extensionHarness({ recovery });
	await advanceToComments(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_DIGEST_MISMATCH",
	);
	assert.deepEqual(await recovery.read(), verified);
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff never releases uncertainty for mismatched permission results", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_save_comment",
			toolCallId: "uncertain-create",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_save_comment",
			toolCallId: "stale-create",
			content: [
				{ type: "text", text: JSON.stringify({ code: "PERMISSION_DENIED" }) },
			],
			isError: true,
		},
		context,
	);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING",
	);
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff durably adopts an existing exact comment", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	assert.equal(
		(
			await publishFromPersistedArtifact(harness, [
				{
					id: "existing-2410",
					body: artifact.body,
				},
			])
		).outcome.status,
		"published",
	);
	assert.deepEqual(harness.publicationRecoveries.get("ILA-2410"), {
		digest: artifact.digest,
		stage: "verified",
	});

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_ALREADY_VERIFIED",
	);
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff preserves verified recovery when the comment disappears", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	assert.equal(
		(await publishFromPersistedArtifact(harness)).outcome.status,
		"published",
	);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_ALREADY_VERIFIED",
	);
	assert.equal(
		harness.toolCalls.filter(
			({ toolName }) => toolName === "linear_save_comment",
		).length,
		1,
	);
});

test("qa-handoff remains blocked until comment read-back confirms exact ID and body", async () => {
	for (const readBack of [
		{ id: "different-comment", body: undefined },
		{ id: "comment-2410", body: "cuerpo distinto" },
	]) {
		const harness = extensionHarness();
		const artifact = await advanceToComments(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_list_comments",
				toolCallId: "comments-before-call",
				input: { issueId: "ILA-2410" },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_list_comments", "comments-before-call", {
				comments: [],
				hasNextPage: false,
			}),
			context,
		);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness);
		const created = { id: "comment-2410", body: artifact.body };
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_save_comment",
				toolCallId: "comment-create-call",
				input: {
					issueId: "ILA-2410",
					body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
				},
			},
			context,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_save_comment", "comment-create-call", created),
			context,
		);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_list_comments",
				toolCallId: "comments-readback-call",
				input: { issueId: "ILA-2410" },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_list_comments", "comments-readback-call", {
				comments: [
					{
						id: readBack.id,
						body: readBack.body ?? artifact.body,
					},
				],
				hasNextPage: false,
			}),
			context,
		);
		assert.equal(
			await terminalBlocker(harness),
			"PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH",
		);
	}
});

test("qa-handoff accepts Linear MCP's flattened grouped Developer label", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	const issue = validIssue({ labels: ["Developer"] });
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const freshnessInstruction = await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", issue),
		context,
	);
	assert.match(
		freshnessInstruction.content.at(-1).text,
		/additional freshness read.*linear_get_issue/s,
	);

	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-freshness-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		),
		undefined,
	);
});

test("qa-handoff rejects another issue, actor, malformed revision, and conflicting identifier", async () => {
	const cases = [
		{
			name: "another issue",
			issue: validIssue({ id: "linear-uuid-9999", identifier: "ILA-9999" }),
			code: "PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH",
		},
		{
			name: "another actor",
			issue: validIssue({
				assignee: "Another Developer",
				assigneeId: "developer-2",
			}),
			code: "PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
		},
		{
			name: "malformed revision",
			issue: validIssue({ updatedAt: "unknown" }),
			code: "PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
		},
		{
			name: "conflicting identifier",
			issue: validIssue({ identifier: "ILA-9999" }),
			code: "PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH",
		},
	];
	for (const variant of cases) {
		const harness = extensionHarness();
		await advanceToIssue(harness);
		await harness.emit(
			"tool_call",
			{
				toolName: "linear_get_issue",
				toolCallId: "issue-call",
				input: { id: "ILA-2410", includeRelations: true },
			},
			context,
		);
		await harness.emit(
			"tool_result",
			mcpResult("linear_get_issue", "issue-call", variant.issue),
			context,
		);
		assert.equal(await terminalBlocker(harness), variant.code, variant.name);
	}
});

test("qa-handoff preserves a terminal MCP blocker through the real workflow tool call", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	const issue = validIssue();
	delete issue.assignee;
	delete issue.assigneeId;
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", issue),
		context,
	);

	assert.equal(
		await harness.emit(
			"tool_call",
			{
				toolName: "workflow_qa_handoff",
				toolCallId: "workflow-call",
				input: { issueId: "ILA-2410" },
			},
			context,
		),
		undefined,
	);
	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
	);
});

test("qa-handoff rejects mismatched call identities and mixed MCP content", async () => {
	const wrongIdentity = extensionHarness();
	await startPreflight(wrongIdentity);
	await wrongIdentity.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		},
		context,
	);
	await wrongIdentity.emit(
		"tool_result",
		mcpResult("linear_get_user", "other-call", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		context,
	);
	assert.equal(
		await terminalBlocker(wrongIdentity),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);

	const mixedContent = extensionHarness();
	await startPreflight(mixedContent);
	await mixedContent.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		},
		context,
	);
	await mixedContent.emit(
		"tool_result",
		{
			...mcpResult("linear_get_user", "user-call", {
				id: "developer-1",
				name: "Developer",
				isActive: true,
				isGuest: false,
			}),
			content: [
				{
					type: "text",
					text: JSON.stringify({
						id: "developer-1",
						name: "Developer",
						isActive: true,
						isGuest: false,
					}),
				},
				{ type: "image", data: "unexpected" },
			],
		},
		context,
	);
	assert.equal(
		await terminalBlocker(mixedContent),
		"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
	);
});

test("qa-handoff accepts the MCP issue contract when id is the identifier", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const issue = validIssue({ id: "ILA-2410" });
	delete issue.identifier;
	delete issue.parentId;
	delete issue.relations.duplicateOf;
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", issue),
		context,
	);
	await verifyIssue(harness, issue);
	assert.equal(
		(await publishFromPersistedArtifact(harness, [], issue)).outcome.status,
		"published",
	);
});

test("qa-handoff treats reordered Linear evidence as the same current snapshot", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	const issue = validIssue();
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", issue),
		context,
	);
	await verifyIssue(harness, {
		...issue,
		labels: [...issue.labels].reverse(),
		attachments: [...issue.attachments].reverse(),
		relations: {
			...issue.relations,
			blockedBy: [...issue.relations.blockedBy].reverse(),
			blocks: [...issue.relations.blocks].reverse(),
			relatedTo: [...issue.relations.relatedTo].reverse(),
		},
	});

	assert.equal(
		(await publishFromPersistedArtifact(harness, [], issue)).outcome.status,
		"published",
	);
});

test("qa-handoff blocks issue evidence drift before draft persistence", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", validIssue()),
		context,
	);
	await verifyIssue(
		harness,
		validIssue({ updatedAt: "2026-07-27T19:22:01.958Z" }),
	);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
	);
});

test("public qa-handoff rejects an issue-keyed draft stale against freshly verified evidence", async () => {
	const seeded = extensionHarness();
	const currentArtifact = await advanceToComments(seeded);
	const {
		issue: _issue,
		authority: _authority,
		...currentDraft
	} = currentArtifact.payload;
	const staleDraft = {
		...currentDraft,
		acceptanceCriteria: currentDraft.acceptanceCriteria.map((criterion) => ({
			...criterion,
			description: `${criterion.description} Evidencia obsoleta.`,
		})),
	};
	let artifactSaves = 0;
	const harness = extensionHarness({
		drafts: {
			read: async () => structuredClone(staleDraft),
			save: async () => {
				throw new Error("stale draft must not be overwritten implicitly");
			},
		},
		artifacts: {
			read: async () => undefined,
			save: async (artifact) => {
				artifactSaves += 1;
				return artifact;
			},
		},
	});
	await advanceToIssue(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const issue = validIssue();
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", issue),
		context,
	);
	await verifyIssue(harness, issue);

	assert.deepEqual(await terminalOutcome(harness), {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_QA_HANDOFF_DRAFT_STALE",
			message:
				"The persisted QA handoff draft does not match the freshly verified Linear evidence; replace the stale draft before publishing.",
		},
	});
	assert.equal(artifactSaves, 0);
	assert.equal(
		harness.toolCalls.some(
			({ toolName }) => toolName === "linear_save_comment",
		),
		false,
	);
});

test("qa-handoff blocks inactive, guest, and malformed users after one lookup", async (t) => {
	for (const [name, user, code] of [
		[
			"inactive",
			{ id: "developer-1", name: "Developer", isActive: false, isGuest: false },
			"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
		],
		[
			"guest",
			{ id: "developer-1", name: "Developer", isActive: true, isGuest: true },
			"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
		],
		[
			"malformed",
			{ id: "developer-1", name: "Developer", isActive: true },
			"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
		],
	]) {
		await t.test(name, async () => {
			const harness = extensionHarness();
			await startPreflight(harness);
			await harness.emit(
				"tool_call",
				{
					toolName: "linear_get_user",
					toolCallId: `user-${name}`,
					input: { query: "me" },
				},
				context,
			);
			await harness.emit(
				"tool_result",
				mcpResult("linear_get_user", `user-${name}`, user),
				context,
			);
			assert.equal(await terminalBlocker(harness), code);
			assert.equal(
				harness.toolCalls.filter(({ toolName }) =>
					toolName === "linear_get_user").length,
				1,
			);
		});
	}
});

test("public qa-handoff persists a canonical draft without mutating Linear", async () => {
	const values = new Map();
	let writes = 0;
	const drafts = createQaHandoffDraftStore({
		project: "pi-workflow",
		store: {
			capabilities: { atomicCompareAndSwap: true },
			readCurrent: async (_project, topic) => values.get(topic),
			write: async (_project, topic, content, expectedRevision) => {
				assert.equal(expectedRevision, undefined);
				writes += 1;
				const stored = { revision: `draft-${writes}`, content };
				values.set(topic, stored);
				return { revision: stored.revision };
			},
			readRevision: async (_project, topic, revision) => {
				const stored = values.get(topic);
				return stored?.revision === revision ? stored.content : undefined;
			},
		},
	});
	const harness = extensionHarness({ drafts });
	await advanceToIssue(harness);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		},
		context,
	);
	const issue = validIssue();
	await harness.emit(
		"tool_result",
		mcpResult("linear_get_issue", "issue-call", issue),
		context,
	);
	await verifyIssue(harness, issue);
	const outcome = (await publishFromPersistedArtifact(harness, [], issue))
		.outcome;

	assert.equal(outcome.status, "published", JSON.stringify(outcome));
	assert.equal(writes, 1);
	const stored = values.get("workflow/qa-handoff-draft/ILA-2410").content;
	assert.equal(stored.endsWith("\n"), true);
	assert.match(JSON.parse(stored).digest, /^[a-f0-9]{64}$/);
	assert.equal(
		[...harness.tools.keys()].some((name) => name.includes("comment")),
		false,
	);
});

test("qa-handoff fails closed on malformed MCP evidence", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" },
		context,
	);
	await harness.emit(
		"tool_call",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		},
		context,
	);
	await harness.emit(
		"tool_result",
		{
			toolName: "linear_get_user",
			toolCallId: "user-call",
			content: [{ type: "text", text: "not-json" }],
			isError: false,
		},
		context,
	);
	const result = await harness.tools
		.get("workflow_qa_handoff")
		.execute("workflow-call", { issueId: "ILA-2410" });
	assert.equal(
		JSON.parse(result.content[0].text).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
	);
});
