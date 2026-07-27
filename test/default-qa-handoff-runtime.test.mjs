import assert from "node:assert/strict";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";

function extensionHarness() {
	const handlers = new Map();
	const tools = new Map();
	piWorkflowExtension({
		exec: async () => ({ code: 0 }),
		getAllTools: () => [
			{ name: "linear_get_user" },
			{ name: "linear_get_issue" },
			{ name: "workflow_qa_handoff" },
		],
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
		await harness.emit("tool_result", mcpResult("linear_get_issue", "issue-call", {
			id: "ILA-2410",
			title: "Validar preflight",
			updatedAt: "2026-07-27T19:21:01.958Z",
			assignee: { id: "developer-1", name: "Developer" },
			labels: [{ id: "assign-developer", name: "Assign To / Developer" }],
		}), context);

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

test("qa-handoff fails closed when Linear MCP tools are unavailable", async () => {
	const handlers = new Map();
	const tools = new Map();
	piWorkflowExtension({
		exec: async () => ({ code: 0 }),
		getAllTools: () => [{ name: "workflow_qa_handoff" }],
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		on: (event, handler) => {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
	});
	for (const handler of handlers.get("input") ?? []) {
		await handler({ type: "input", text: "/qa-handoff ILA-2410", source: "interactive" }, context);
	}
	for (const handler of handlers.get("before_agent_start") ?? []) {
		await handler({ type: "before_agent_start" }, context);
	}
	const result = await tools.get("workflow_qa_handoff").execute("workflow-call", { issueId: "ILA-2410" });
	assert.equal(JSON.parse(result.content[0].text).blocker.code, "PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE");
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
