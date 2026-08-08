import assert from "node:assert/strict";
import test from "node:test";

import { createQaHandoffRuntime } from "../extensions/qa-handoff-runtime.ts";

function setup() {
	const calls = [];
	const handlers = new Map();
	const tools = new Map();
	let active = false;
	let pending = false;
	const publication = {
		allowedTools: [
			"linear_get_user",
			"linear_get_issue",
			"linear_list_comments",
			"linear_save_comment",
			"workflow_qa_handoff",
		],
		start(issueId) {
			calls.push({ operation: "start", issueId });
			active = true;
		},
		setMcpAvailable(available) {
			calls.push({ operation: "setMcpAvailable", available });
		},
		clear() {
			active = false;
			pending = false;
		},
		hasActiveTurn: () => active,
		hasPendingDeveloperSelection: () => pending,
		expectedModelCall: () =>
			active
				? { toolName: "linear_get_user", input: { query: "me" } }
				: undefined,
		nextCallInstruction: () => "next",
		handleToolCall: async (event) => {
			calls.push({ operation: "tool_call", event });
		},
		handleToolResult: async (event) => {
			calls.push({ operation: "tool_result", event });
			return true;
		},
		async complete(input) {
			calls.push({ operation: "complete", input });
			if (input.action === "publish_handoff") {
				pending = false;
				return { status: "continuing" };
			}
			active = false;
			return { status: "cancelled", issueId: "ILA-2321" };
		},
		setPending(value) {
			pending = value;
		},
	};
	const runtime = createQaHandoffRuntime({ mcpPublication: publication });
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
		getActiveTools: () => publication.allowedTools,
	});
	return { calls, handlers, publication, runtime, tools };
}

test("binds the public issue anchor without treating it as publication approval", async () => {
	const { calls, handlers, runtime, tools } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff ILA-2321",
		source: "interactive",
	});

	const prompt = await handlers.get("before_agent_start")({
		type: "before_agent_start",
	});

	assert.equal(runtime.hasActiveTurn(), true);
	assert.deepEqual(calls.slice(0, 2), [
		{ operation: "start", issueId: "ILA-2321" },
		{ operation: "setMcpAvailable", available: true },
	]);
	assert.match(prompt.systemPrompt, /linear_get_user/);
	assert.deepEqual(tools.get("workflow_qa_handoff").parameters, {
		type: "object",
		additionalProperties: false,
		required: ["action"],
		properties: {
			action: {
				type: "string",
				enum: ["publish_handoff", "cancel_decision"],
			},
		},
	});
	assert.equal(
		calls.some(({ operation }) => operation === "authorizeInvocation"),
		false,
	);
});

test("uses the workflow tool only to transport a shared decision claim", async () => {
	const { calls, runtime, tools } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/skill:qa-handoff ILA-2321",
		source: "interactive",
	});

	const result = await tools
		.get("workflow_qa_handoff")
		.execute("tool-1", { action: "publish_handoff" });

	assert.deepEqual(JSON.parse(result.content[0].text), {
		status: "continuing",
	});
	assert.equal(runtime.hasActiveTurn(), true);
	assert.deepEqual(calls.at(-1), {
		operation: "complete",
		input: { action: "publish_handoff" },
	});
});

test("retains the corrective issue-anchor continuation", () => {
	const { runtime } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff invalid",
		source: "interactive",
	});
	const continuation = {
		type: "input",
		text: "ILA-2321",
		source: "interactive",
	};
	assert.equal(runtime.hasPendingAnchorContinuation(), true);
	assert.equal(runtime.shouldContinue(continuation), true);
	runtime.handlePublicEntry(continuation);
	assert.equal(runtime.hasPendingAnchorContinuation(), false);
	assert.equal(runtime.hasActiveTurn(), true);
});

test("exposes pending shared selection after settlement without clearing the turn", async () => {
	const { handlers, publication, runtime } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff ILA-2321",
		source: "interactive",
	});
	publication.setPending(true);
	await handlers.get("agent_settled")({ type: "agent_settled" });

	assert.equal(runtime.hasPendingSelection(), true);
	assert.equal(runtime.hasActiveTurn(), true);
});
