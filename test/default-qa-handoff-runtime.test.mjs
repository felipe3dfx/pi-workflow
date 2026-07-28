import assert from "node:assert/strict";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { createQaHandoffDraftStore } from "../extensions/qa-handoff-draft-store.ts";

const MCP_TOOL_NAMES = [
	"linear_get_user",
	"linear_get_issue",
	"linear_list_comments",
	"linear_save_comment",
	"workflow_qa_handoff",
];

function extensionHarness(
	toolNames = MCP_TOOL_NAMES,
	injectedDrafts,
	injectedArtifacts,
	injectedRecovery,
) {
	const handlers = new Map();
	const tools = new Map();
	const toolCalls = [];
	const persistedDrafts = new Map();
	const persistedArtifacts = new Map();
	const publicationRecoveries = new Map();
	piWorkflowExtension({
		exec: async () => ({ code: 0 }),
		getAllTools: () => toolNames.map((name) => ({ name })),
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		on: (event, handler) => {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
	}, {
		qaHandoff: {
			recovery: injectedRecovery ?? {
				read: async (issueId) => {
					const recovery = publicationRecoveries.get(issueId);
					return recovery?.stage === "uncertain"
						? { digest: recovery.digest }
						: undefined;
				},
				claim: async (artifact) => {
					const issueId = artifact.payload.issue.id;
					const claim = { digest: artifact.digest, stage: "uncertain" };
					const existing = publicationRecoveries.get(issueId);
					if (existing && JSON.stringify(existing) !== JSON.stringify(claim))
						throw new Error("recovery conflict");
					publicationRecoveries.set(issueId, structuredClone(claim));
				},
				release: async (artifact) => {
					publicationRecoveries.set(artifact.payload.issue.id, {
						digest: artifact.digest,
						stage: "released",
					});
				},
			},
			drafts: injectedDrafts ?? {
				read: async (issueId) => structuredClone(persistedDrafts.get(issueId)?.payload.draft),
				save: async ({ issueId, draft }) => {
					const artifact = { payload: { issue: { id: issueId }, draft }, digest: "a".repeat(64) };
					const existing = persistedDrafts.get(issueId);
					if (existing && JSON.stringify(existing) !== JSON.stringify(artifact)) throw Object.assign(new Error("conflict"), { code: "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT" });
					persistedDrafts.set(issueId, structuredClone(artifact));
					return structuredClone(artifact);
				},
			},
			artifacts: injectedArtifacts ?? {
				read: async (issueId) => structuredClone(persistedArtifacts.get(issueId)),
				save: async (artifact) => {
					const issueId = artifact.payload.issue.id;
					const existing = persistedArtifacts.get(issueId);
					if (existing && JSON.stringify(existing) !== JSON.stringify(artifact)) throw Object.assign(new Error("conflict"), { code: "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT" });
					persistedArtifacts.set(issueId, structuredClone(artifact));
					return structuredClone(artifact);
				},
			},
		},
	});
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

function mcpResult(toolName, toolCallId, payload) {
	return {
		toolName,
		toolCallId,
		content: [{ type: "text", text: JSON.stringify(payload) }],
		isError: false,
	};
}

async function startPreflight(harness) {
	await harness.emit("input", {
		type: "input",
		text: "/qa-handoff ILA-2410",
		source: "interactive",
	}, context);
}

async function advanceToIssue(harness) {
	await startPreflight(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", mcpResult("linear_get_user", "user-call", {
		id: "developer-1",
		name: "Developer",
		isActive: true,
		isGuest: false,
	}), context);
}

async function verifyIssue(harness, issue = validIssue()) {
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-verify-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-verify-call",
		issue,
	), context);
}

async function advanceToComments(harness, issue = validIssue()) {
	await advanceToIssue(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-call",
		issue,
	), context);
	await verifyIssue(harness, issue);
	return harness.persistedArtifacts.get("ILA-2410");
}

async function terminalOutcome(harness) {
	const result = await harness.tools.get("workflow_qa_handoff").execute(
		"workflow-call",
		{ issueId: "ILA-2410" },
	);
	return JSON.parse(result.content[0].text);
}

async function terminalBlocker(harness) {
	return (await terminalOutcome(harness)).blocker.code;
}

async function readCommentsBefore(harness, existingComments = []) {
	await harness.emit("tool_call", {
		toolName: "linear_list_comments",
		toolCallId: "comments-before-call",
		input: { issueId: "ILA-2410" },
	}, context);
	await harness.emit("tool_result", mcpResult("linear_list_comments", "comments-before-call", {
		comments: existingComments,
		hasNextPage: false,
	}), context);
}

async function revalidateActorBeforeMutation(harness, actor = {
	id: "developer-1",
	name: "Developer",
	isActive: true,
	isGuest: false,
}) {
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-before-mutation-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_get_user",
		"user-before-mutation-call",
		actor,
	), context);
}

async function verifyIssueBeforeMutation(harness, issue = validIssue()) {
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-before-mutation-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-before-mutation-call",
		issue,
	), context);
}

async function publishFromPersistedArtifact(
	harness,
	existingComments = [],
	issue = validIssue(),
) {
	const artifact = harness.persistedArtifacts.get("ILA-2410");
	assert.ok(artifact);
	await readCommentsBefore(harness, existingComments);
	let comment = existingComments.find(({ body }) => body === artifact.body);
	if (!comment) {
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness, issue);
		await harness.emit("tool_call", {
			toolName: "linear_save_comment",
			toolCallId: "comment-create-call",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		}, context);
		comment = { id: "comment-2410", body: artifact.body };
		await harness.emit("tool_result", mcpResult(
			"linear_save_comment",
			"comment-create-call",
			comment,
		), context);
	}
	await harness.emit("tool_call", {
		toolName: "linear_list_comments",
		toolCallId: "comments-readback-call",
		input: { issueId: "ILA-2410" },
	}, context);
	await harness.emit("tool_result", mcpResult("linear_list_comments", "comments-readback-call", {
		comments: [comment],
		hasNextPage: false,
	}), context);
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-final-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-final-call",
		issue,
	), context);
	return { artifact, comment, outcome: await terminalOutcome(harness) };
}

function validIssue(overrides = {}) {
	return {
		id: "linear-uuid-2410",
		identifier: "ILA-2410",
		title: "Validate preflight",
		description: "```qa-handoff-evidence\n{\"schema\":\"qa-handoff-evidence\",\"schemaVersion\":1,\"pullRequestAttachmentId\":\"pr\",\"buildAttachmentId\":\"build\",\"qaEnvironmentAttachmentId\":\"qa\",\"acceptanceCriteria\":[{\"id\":\"AC-1\",\"description\":\"Cumple el criterio acordado.\",\"evidenceAttachmentIds\":[\"test\"]}]}\n```",
		updatedAt: "2026-07-27T19:21:01.958Z",
		status: "In Code Review",
		statusType: "started",
		assignee: "Developer",
		assigneeId: "developer-1",
		cycleId: "cycle-24",
		labels: ["Assign To / Developer", "QA"],
		parentId: "ILA-2400",
		relations: {
			blockedBy: [{ id: "ILA-2401", title: "Prepare QA environment" }],
			blocks: [{ id: "ILA-2411", title: "Run QA" }],
			relatedTo: [{ id: "ILA-2399", title: "Delivery plan" }],
			duplicateOf: null,
		},
		attachments: [
			{ id: "pr", title: "PR #47", url: "https://github.com/example/repo/pull/47" },
			{ id: "build", title: "Build 47", url: "https://github.com/example/repo/actions/runs/47" },
			{ id: "qa", title: "Entorno QA", url: "https://pi-workflow-qa.vercel.app" },
			{ id: "test", title: "Prueba integrada", url: "https://github.com/example/repo/actions/runs/48" },
		],
		...overrides,
	};
}

test("default public qa-handoff publishes the canonical artifact through the exact Linear MCP sequence", async () => {
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
			await harness.emit("tool_call", {
				toolName: "linear_get_user",
				toolCallId: "user-call",
				input: { query: "me" },
			}, context),
			undefined,
		);
		await harness.emit("tool_result", mcpResult("linear_get_user", "user-call", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}), context);

		assert.equal(
			await harness.emit("tool_call", {
				toolName: "linear_get_issue",
				toolCallId: "issue-call",
				input: { id: "ILA-2410", includeRelations: true },
			}, context),
			undefined,
		);
		const issue = validIssue({ title: "Validar preflight" });
		await harness.emit("tool_result", mcpResult(
			"linear_get_issue",
			"issue-call",
			issue,
		), context);
		await verifyIssue(harness, issue);

		const artifact = harness.persistedArtifacts.get("ILA-2410");
		assert.equal(artifact.schema, "qa-handoff");
		assert.equal(artifact.payload.issue.revision, "2026-07-27T19:21:01.958Z");
		assert.deepEqual(artifact.payload.authority, {
			actorId: "developer-1",
			role: "Developer",
			authorityRevision: artifact.payload.authority.authorityRevision,
		});
		assert.match(artifact.payload.authority.authorityRevision, /^[a-f0-9]{64}$/);
		assert.match(artifact.body, new RegExp(`Referencia de flujo: qa-handoff:${artifact.digest}$`, "m"));

		assert.equal(
			await harness.emit("tool_call", {
				toolName: "linear_list_comments",
				toolCallId: "comments-before-call",
				input: { issueId: "ILA-2410" },
			}, context),
			undefined,
		);
		const commentsInstruction = await harness.emit("tool_result", mcpResult(
			"linear_list_comments",
			"comments-before-call",
			{ comments: [], hasNextPage: false },
		), context);
		assert.match(
			commentsInstruction.content.at(-1).text,
			/linear_get_user.*me/s,
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
		await harness.emit("tool_result", mcpResult(
			"linear_save_comment",
			"comment-create-call",
			comment,
		), context);

		assert.equal(
			await harness.emit("tool_call", {
				toolName: "linear_list_comments",
				toolCallId: "comments-readback-call",
				input: { issueId: "ILA-2410" },
			}, context),
			undefined,
		);
		await harness.emit("tool_result", mcpResult(
			"linear_list_comments",
			"comments-readback-call",
			{ comments: [comment], hasNextPage: false },
		), context);
		await harness.emit("tool_call", {
			toolName: "linear_get_issue",
			toolCallId: "issue-final-call",
			input: { id: "ILA-2410", includeRelations: true },
		}, context);
		await harness.emit("tool_result", mcpResult(
			"linear_get_issue",
			"issue-final-call",
			issue,
		), context);

		assert.equal(
			await harness.emit("tool_call", {
				toolName: "workflow_qa_handoff",
				toolCallId: "workflow-call",
				input: { issueId: "ILA-2410" },
			}, context),
			undefined,
		);
		const result = await harness.tools.get("workflow_qa_handoff").execute(
			"workflow-call",
			{ issueId: "ILA-2410" },
		);
		const outcome = JSON.parse(result.content[0].text);
		assert.deepEqual(outcome, {
			status: "published",
			issueId: "ILA-2410",
			commentId: "comment-2410",
		});
		assert.deepEqual(harness.toolCalls, [
			{ toolName: "linear_get_user", toolCallId: "user-call", input: { query: "me" } },
			{ toolName: "linear_get_issue", toolCallId: "issue-call", input: { id: "ILA-2410", includeRelations: true } },
			{ toolName: "linear_get_issue", toolCallId: "issue-verify-call", input: { id: "ILA-2410", includeRelations: true } },
			{ toolName: "linear_list_comments", toolCallId: "comments-before-call", input: { issueId: "ILA-2410" } },
			{ toolName: "linear_get_user", toolCallId: "user-before-mutation-call", input: { query: "me" } },
			{ toolName: "linear_get_issue", toolCallId: "issue-before-mutation-call", input: { id: "ILA-2410", includeRelations: true } },
			{ toolName: "linear_save_comment", toolCallId: "comment-create-call", input: { issueId: "ILA-2410", body: artifact.body } },
			{ toolName: "linear_list_comments", toolCallId: "comments-readback-call", input: { issueId: "ILA-2410" } },
			{ toolName: "linear_get_issue", toolCallId: "issue-final-call", input: { id: "ILA-2410", includeRelations: true } },
			{ toolName: "workflow_qa_handoff", toolCallId: "workflow-call", input: { issueId: "ILA-2410" } },
		]);
		assert.equal("LINEAR_API_KEY" in outcome, false);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousKey === undefined) delete process.env.LINEAR_API_KEY;
		else process.env.LINEAR_API_KEY = previousKey;
	}
});

test("qa-handoff blocks extra MCP input before execution", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" },
		context,
	);
	assert.deepEqual(
		await harness.emit("tool_call", {
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me", limit: 1 },
		}, context),
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
		await harness.emit("tool_call", {
			toolName: "read",
			toolCallId: "wrong-read",
			input: { path: "/tmp/unrelated" },
		}, context),
		{ block: true, reason: "PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities" },
	);
});

test("settled default qa-handoff releases unrelated tools", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);

	await harness.emit("agent_settled", { type: "agent_settled" }, context);

	assert.equal(
		await harness.emit("tool_call", {
			toolName: "write",
			toolCallId: "unrelated-call",
			input: { path: "/tmp/unrelated", content: "unrelated" },
		}, context),
		undefined,
	);
});

test("qa-handoff fails closed when Linear MCP tools are unavailable", async () => {
	const harness = extensionHarness(["workflow_qa_handoff"]);
	await harness.emit("input", {
		type: "input",
		text: "/qa-handoff ILA-2410",
		source: "interactive",
	}, context);
	await harness.emit("before_agent_start", { type: "before_agent_start" }, context);
	const result = await harness.tools.get("workflow_qa_handoff").execute("workflow-call", { issueId: "ILA-2410" });
	assert.equal(JSON.parse(result.content[0].text).blocker.code, "PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE");
});

test("qa-handoff classifies an explicit MCP unauthenticated error", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		content: [{ type: "text", text: JSON.stringify({ code: "UNAUTHENTICATED" }) }],
		isError: true,
	}, context);

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
		await harness.emit("tool_call", {
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		}, context);
		await harness.emit("tool_result", {
			toolName: "linear_get_user",
			toolCallId: "user-call",
			content: [{ type: "text", text: '{"code":"UNAUTHENTICATED"}' }],
			...(variant.isError === undefined ? {} : { isError: variant.isError }),
		}, context);

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
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		content: [{ type: "text", text: JSON.stringify({ code: "UNAUTHENTICATED", message: "login required" }) }],
		isError: true,
	}, context);

	assert.equal(
		await terminalBlocker(harness),
		"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
	);
});

test("qa-handoff preserves actionable MCP failure classifications", async () => {
	for (const variant of [
		{ upstream: "PERMISSION_DENIED", expected: "PI_WORKFLOW_QA_HANDOFF_MCP_PERMISSION_DENIED" },
		{ upstream: "RATE_LIMITED", expected: "PI_WORKFLOW_QA_HANDOFF_MCP_RATE_LIMITED" },
		{ upstream: "TRANSPORT_ERROR", expected: "PI_WORKFLOW_QA_HANDOFF_MCP_TRANSPORT_FAILED" },
	]) {
		const harness = extensionHarness();
		await startPreflight(harness);
		await harness.emit("tool_call", {
			toolName: "linear_get_user",
			toolCallId: "user-call",
			input: { query: "me" },
		}, context);
		await harness.emit("tool_result", {
			toolName: "linear_get_user",
			toolCallId: "user-call",
			content: [{
				type: "text",
				text: JSON.stringify({
					code: variant.upstream,
					message: "Actionable upstream failure.",
				}),
			}],
			isError: true,
		}, context);

		assert.equal(await terminalBlocker(harness), variant.expected, variant.upstream);
	}
});

test("qa-handoff rejects malformed actionable MCP error envelopes", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		content: [{
			type: "text",
			text: JSON.stringify({
				code: "RATE_LIMITED",
				message: 429,
				partialResult: { id: "developer-1" },
			}),
		}],
		isError: true,
	}, context);

	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE");
});

test("qa-handoff blocks wrong tools and out-of-order stages before execution", async () => {
	for (const variant of [
		{
			call: { toolName: "linear_get_issue", toolCallId: "early", input: { id: "ILA-2410" } },
			reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		},
		{
			call: { toolName: "linear_list_comments", toolCallId: "wrong", input: { issueId: "ILA-2410" } },
			reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		},
	]) {
		const harness = extensionHarness();
		await startPreflight(harness);
		assert.deepEqual(
			await harness.emit("tool_call", variant.call, context),
			{ block: true, reason: variant.reason },
		);
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
			await harness.emit("tool_call", {
				toolName: "linear_list_comments",
				toolCallId: "comments-before-call",
				input,
			}, context),
			{ block: true, reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" },
		);
		assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID");
	}
});

test("qa-handoff blocks authenticated Developer actor drift immediately before mutation", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);

	assert.equal(
		await harness.emit("tool_call", {
			toolName: "linear_get_user",
			toolCallId: "user-before-mutation-call",
			input: { query: "me" },
		}, context),
		undefined,
	);
	await harness.emit("tool_result", mcpResult(
		"linear_get_user",
		"user-before-mutation-call",
		{
			id: "developer-2",
			name: "Another Developer",
			isActive: true,
			isGuest: false,
		},
	), context);

	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH");
	assert.equal(
		harness.toolCalls.some(({ toolName }) => toolName === "linear_save_comment"),
		false,
	);
});

test("qa-handoff blocks complete issue snapshot drift immediately before mutation", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);

	assert.equal(
		await harness.emit("tool_call", {
			toolName: "linear_get_issue",
			toolCallId: "issue-before-mutation-call",
			input: { id: "ILA-2410", includeRelations: true },
		}, context),
		undefined,
	);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-before-mutation-call",
		validIssue({ estimate: 8 }),
	), context);

	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH");
	assert.equal(
		harness.toolCalls.some(({ toolName }) => toolName === "linear_save_comment"),
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
	await harness.emit("tool_call", {
		toolName: "linear_save_comment",
		toolCallId: "comment-create-call",
		input: {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		},
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_save_comment",
		"comment-create-call",
		created,
	), context);
	await harness.emit("tool_call", {
		toolName: "linear_list_comments",
		toolCallId: "comments-readback-call",
		input: { issueId: "ILA-2410" },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_list_comments",
		"comments-readback-call",
		{ comments: [created], hasNextPage: false },
	), context);

	assert.equal(
		await harness.emit("tool_call", {
			toolName: "linear_get_issue",
			toolCallId: "issue-final-call",
			input: { id: "ILA-2410", includeRelations: true },
		}, context),
		undefined,
	);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-final-call",
		validIssue({ status: "Ready for QA" }),
	), context);

	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH");
});

test("qa-handoff permits only one exact root comment creation input", async () => {
	for (const mutate of [
		(input) => ({ ...input, issueId: "ILA-9999" }),
		(input) => ({ ...input, body: `${input.body}\nAlterado` }),
		(input) => ({ ...input, parentId: "parent-comment" }),
		(input) => ({ ...input, id: "existing-comment" }),
	]) {
		const harness = extensionHarness();
		const artifact = await advanceToComments(harness);
		await harness.emit("tool_call", {
			toolName: "linear_list_comments",
			toolCallId: "comments-before-call",
			input: { issueId: "ILA-2410" },
		}, context);
		await harness.emit("tool_result", mcpResult(
			"linear_list_comments",
			"comments-before-call",
			{ comments: [], hasNextPage: false },
		), context);
		const exact = {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		};
		assert.deepEqual(
			await harness.emit("tool_call", {
				toolName: "linear_save_comment",
				toolCallId: "comment-create-call",
				input: mutate(exact),
			}, context),
			{ block: true, reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" },
		);
		assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID");
	}
});

test("qa-handoff detects only the exact visible artifact reference before mutation", async () => {
	const conflict = extensionHarness();
	const artifact = await advanceToComments(conflict);
	const marker = `Referencia de flujo: qa-handoff:${artifact.digest}`;
	await conflict.emit("tool_call", {
		toolName: "linear_list_comments",
		toolCallId: "comments-before-call",
		input: { issueId: "ILA-2410" },
	}, context);
	await conflict.emit("tool_result", mcpResult(
		"linear_list_comments",
		"comments-before-call",
		{
			comments: [{ id: "conflict", body: `Cuerpo distinto.\n\n${marker}` }],
			hasNextPage: false,
		},
	), context);
	assert.equal(await terminalBlocker(conflict), "PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT");
	assert.equal(
		conflict.toolCalls.some(({ toolName }) => toolName === "linear_save_comment"),
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
		nearMarker.toolCalls.filter(({ toolName }) => toolName === "linear_save_comment").length,
		1,
	);
});

test("qa-handoff verifies the final issue snapshot on the existing-idempotent path", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	const existing = { id: "comment-existing", body: artifact.body };
	await readCommentsBefore(harness, [existing]);
	await harness.emit("tool_call", {
		toolName: "linear_list_comments",
		toolCallId: "comments-readback-call",
		input: { issueId: "ILA-2410" },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_list_comments",
		"comments-readback-call",
		{ comments: [existing], hasNextPage: false },
	), context);
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-final-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_get_issue",
		"issue-final-call",
		validIssue({ cycleId: "cycle-25" }),
	), context);

	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH");
	assert.equal(
		harness.toolCalls.some(({ toolName }) => toolName === "linear_save_comment"),
		false,
	);
});

test("qa-handoff never treats an inline description comment as the canonical root comment", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	await harness.emit("tool_call", {
		toolName: "linear_list_comments",
		toolCallId: "comments-before-call",
		input: { issueId: "ILA-2410" },
	}, context);
	await harness.emit("tool_result", mcpResult(
		"linear_list_comments",
		"comments-before-call",
		{
			comments: [{
				id: "inline-comment",
				body: artifact.body,
				quotedText: "Descripción seleccionada",
			}],
			hasNextPage: false,
		},
	), context);
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

test("qa-handoff recovers an uncertain creation through lookup without duplicating the mutation", async () => {
	const harness = extensionHarness();
	const artifact = await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit("tool_call", {
		toolName: "linear_save_comment",
		toolCallId: "uncertain-comment-create",
		input: {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		},
	}, context);

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING");

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	const existing = { id: "comment-created-before-interruption", body: artifact.body };
	const recovered = await publishFromPersistedArtifact(harness, [existing]);

	assert.deepEqual(recovered.outcome, {
		status: "published",
		issueId: "ILA-2410",
		commentId: existing.id,
	});
	assert.equal(
		harness.toolCalls.filter(({ toolName }) => toolName === "linear_save_comment").length,
		1,
	);
});

test("qa-handoff blocks mutation when its durable recovery claim cannot be verified", async () => {
	const harness = extensionHarness(
		MCP_TOOL_NAMES,
		undefined,
		undefined,
		{
			read: async () => undefined,
			claim: async () => {
				throw new Error("recovery read-back mismatch");
			},
			release: async () => {},
		},
	);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);

	assert.deepEqual(
		await harness.emit("tool_call", {
			toolName: "linear_save_comment",
			toolCallId: "comment-create-call",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		}, context),
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

test("qa-handoff keeps a rate-limited comment mutation lookup-only", async () => {
	const harness = extensionHarness();
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	await revalidateActorBeforeMutation(harness);
	await verifyIssueBeforeMutation(harness);
	await harness.emit("tool_call", {
		toolName: "linear_save_comment",
		toolCallId: "rate-limited-create",
		input: {
			issueId: "ILA-2410",
			body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
		},
	}, context);
	await harness.emit("tool_result", {
		toolName: "linear_save_comment",
		toolCallId: "rate-limited-create",
		content: [{ type: "text", text: JSON.stringify({ code: "RATE_LIMITED" }) }],
		isError: true,
	}, context);
	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_MCP_RATE_LIMITED");

	await harness.emit("session_shutdown", { type: "session_shutdown" }, context);
	await harness.emit("session_start", { type: "session_start" }, context);
	await advanceToComments(harness);
	await readCommentsBefore(harness);
	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING");
	assert.equal(
		harness.toolCalls.filter(({ toolName }) => toolName === "linear_save_comment").length,
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
		await harness.emit("tool_call", {
			toolName: "linear_list_comments",
			toolCallId: "comments-before-call",
			input: { issueId: "ILA-2410" },
		}, context);
		await harness.emit("tool_result", mcpResult(
			"linear_list_comments",
			"comments-before-call",
			{ comments: [], hasNextPage: false },
		), context);
		await revalidateActorBeforeMutation(harness);
		await verifyIssueBeforeMutation(harness);
		const created = { id: "comment-2410", body: artifact.body };
		await harness.emit("tool_call", {
			toolName: "linear_save_comment",
			toolCallId: "comment-create-call",
			input: {
				issueId: "ILA-2410",
				body: "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY",
			},
		}, context);
		await harness.emit("tool_result", mcpResult(
			"linear_save_comment",
			"comment-create-call",
			created,
		), context);
		await harness.emit("tool_call", {
			toolName: "linear_list_comments",
			toolCallId: "comments-readback-call",
			input: { issueId: "ILA-2410" },
		}, context);
		await harness.emit("tool_result", mcpResult(
			"linear_list_comments",
			"comments-readback-call",
			{
				comments: [{
					id: readBack.id,
					body: readBack.body ?? artifact.body,
				}],
				hasNextPage: false,
			},
		), context);
		assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH");
	}
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
			issue: validIssue({ assignee: "Another Developer", assigneeId: "developer-2" }),
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
		await harness.emit("tool_call", {
			toolName: "linear_get_issue",
			toolCallId: "issue-call",
			input: { id: "ILA-2410", includeRelations: true },
		}, context);
		await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", variant.issue), context);
		assert.equal(await terminalBlocker(harness), variant.code, variant.name);
	}
});

test("qa-handoff rejects mismatched call identities and mixed MCP content", async () => {
	const wrongIdentity = extensionHarness();
	await startPreflight(wrongIdentity);
	await wrongIdentity.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await wrongIdentity.emit("tool_result", mcpResult("linear_get_user", "other-call", {
		id: "developer-1",
		name: "Developer",
		isActive: true,
		isGuest: false,
	}), context);
	assert.equal(await terminalBlocker(wrongIdentity), "PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE");

	const mixedContent = extensionHarness();
	await startPreflight(mixedContent);
	await mixedContent.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await mixedContent.emit("tool_result", {
		...mcpResult("linear_get_user", "user-call", {
			id: "developer-1",
			name: "Developer",
			isActive: true,
			isGuest: false,
		}),
		content: [
			{ type: "text", text: JSON.stringify({ id: "developer-1", name: "Developer", isActive: true, isGuest: false }) },
			{ type: "image", data: "unexpected" },
		],
	}, context);
	assert.equal(await terminalBlocker(mixedContent), "PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE");
});

test("qa-handoff accepts the MCP issue contract when id is the identifier", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	const issue = validIssue({ id: "ILA-2410" });
	delete issue.identifier;
	delete issue.parentId;
	delete issue.relations.duplicateOf;
	await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", issue), context);
	await verifyIssue(harness, issue);
	assert.equal((await publishFromPersistedArtifact(harness, [], issue)).outcome.status, "published");
});

test("qa-handoff treats reordered Linear evidence as the same current snapshot", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	const issue = validIssue();
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", issue), context);
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

	assert.equal((await publishFromPersistedArtifact(harness, [], issue)).outcome.status, "published");
});

test("qa-handoff blocks issue evidence drift before draft persistence", async () => {
	const harness = extensionHarness();
	await advanceToIssue(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", validIssue()), context);
	await verifyIssue(harness, validIssue({ updatedAt: "2026-07-27T19:22:01.958Z" }));

	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH");
});

test("qa-handoff classifies partial actor evidence as malformed", async () => {
	const harness = extensionHarness();
	await startPreflight(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", mcpResult("linear_get_user", "user-call", {
		id: "developer-1",
		name: "Developer",
		isActive: true,
	}), context);
	assert.equal(await terminalBlocker(harness), "PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE");
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
	const harness = extensionHarness(MCP_TOOL_NAMES, drafts);
	await advanceToIssue(harness);
	await harness.emit("tool_call", {
		toolName: "linear_get_issue",
		toolCallId: "issue-call",
		input: { id: "ILA-2410", includeRelations: true },
	}, context);
	const issue = validIssue();
	await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", issue), context);
	await verifyIssue(harness, issue);
	const outcome = (await publishFromPersistedArtifact(harness, [], issue)).outcome;

	assert.equal(outcome.status, "published", JSON.stringify(outcome));
	assert.equal(writes, 1);
	const stored = values.get("workflow/qa-handoff-draft/ILA-2410").content;
	assert.equal(stored.endsWith("\n"), true);
	assert.match(JSON.parse(stored).digest, /^[a-f0-9]{64}$/);
	assert.equal([...harness.tools.keys()].some((name) => name.includes("comment")), false);
});

test("qa-handoff fails closed on malformed MCP evidence", async () => {
	const harness = extensionHarness();
	await harness.emit(
		"input",
		{ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" },
		context,
	);
	await harness.emit("tool_call", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		input: { query: "me" },
	}, context);
	await harness.emit("tool_result", {
		toolName: "linear_get_user",
		toolCallId: "user-call",
		content: [{ type: "text", text: "not-json" }],
		isError: false,
	}, context);
	const result = await harness.tools.get("workflow_qa_handoff").execute(
		"workflow-call",
		{ issueId: "ILA-2410" },
	);
	assert.equal(
		JSON.parse(result.content[0].text).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
	);
});
