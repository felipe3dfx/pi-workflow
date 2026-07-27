import assert from "node:assert/strict";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";

const MCP_TOOL_NAMES = [
	"linear_get_user",
	"linear_get_issue",
	"workflow_qa_handoff",
];

function extensionHarness(toolNames = MCP_TOOL_NAMES) {
	const handlers = new Map();
	const tools = new Map();
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
	});
	return {
		tools,
		async emit(event, value, context) {
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

function validIssue(overrides = {}) {
	return {
		id: "linear-uuid-2410",
		identifier: "ILA-2410",
		updatedAt: "2026-07-27T19:21:01.958Z",
		assignee: { id: "developer-1", name: "Developer" },
		labels: [{ id: "assign-developer", name: "Assign To / Developer" }],
		...overrides,
	};
}

test("default public qa-handoff completes an exact read-only Linear MCP preflight", async () => {
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
				input: { id: "ILA-2410" },
			}, context),
			undefined,
		);
		await harness.emit("tool_result", mcpResult(
			"linear_get_issue",
			"issue-call",
			validIssue({ title: "Validar preflight" }),
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
		assert.deepEqual(JSON.parse(result.content[0].text), {
			status: "authorized",
			issueId: "ILA-2410",
			actorId: "developer-1",
			issueRevision: "2026-07-27T19:21:01.958Z",
		});
		assert.equal("LINEAR_API_KEY" in JSON.parse(result.content[0].text), false);
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

test("qa-handoff blocks wrong tools and out-of-order stages before execution", async () => {
	for (const variant of [
		{
			call: { toolName: "linear_get_issue", toolCallId: "early", input: { id: "ILA-2410" } },
			reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		},
		{
			call: { toolName: "linear_list_comments", toolCallId: "wrong", input: { issueId: "ILA-2410" } },
			reason: "PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
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

test("qa-handoff rejects another issue, actor, malformed revision, and conflicting identifier", async () => {
	const cases = [
		{
			name: "another issue",
			issue: validIssue({ id: "linear-uuid-9999", identifier: "ILA-9999" }),
			code: "PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH",
		},
		{
			name: "another actor",
			issue: validIssue({ assignee: { id: "developer-2" } }),
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
			input: { id: "ILA-2410" },
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
		input: { id: "ILA-2410" },
	}, context);
	const issue = validIssue({ id: "ILA-2410" });
	delete issue.identifier;
	await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", issue), context);
	assert.equal((await terminalOutcome(harness)).status, "authorized");
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
