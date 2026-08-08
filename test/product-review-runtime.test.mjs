import assert from "node:assert/strict";
import test from "node:test";

import { createProductReviewRuntime } from "../extensions/product-review-runtime.ts";

function harness() {
	const handlers = new Map();
	const tools = new Map();
	const calls = [];
	let active = false;
	let pending = false;
	const publication = {
		allowedTools: [
			"linear_get_user",
			"linear_get_issue",
			"linear_list_comments",
			"linear_save_comment",
			"workflow_product_review",
		],
		start(issueId) {
			calls.push({ op: "start", issueId });
			active = true;
			pending = true;
		},
		setMcpAvailable(value) {
			calls.push({ op: "available", value });
		},
		clear() {
			active = false;
			pending = false;
		},
		hasActiveTurn: () => active,
		hasPendingOwnerSelection: () => pending,
		expectedModelCall: () => undefined,
		nextCallInstruction: () => undefined,
		async handleToolCall(event) {
			calls.push({ op: "tool-call", event });
		},
		async handleToolResult() {
			return false;
		},
		async complete(input) {
			calls.push({ op: "complete", input });
			if (input.action === "cancel_decision") {
				active = false;
				pending = false;
				return { status: "cancelled", issueId: "ILA-2324" };
			}
			return { status: "continuing" };
		},
	};
	const runtime = createProductReviewRuntime({ mcpPublication: publication });
	runtime.register({
		getActiveTools: () => publication.allowedTools,
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return { calls, handlers, runtime, tools };
}

test("keeps product-review runtime as typed transport without prose authorization", async () => {
	const subject = harness();
	subject.runtime.handlePublicEntry({
		type: "input",
		text: "/product-review ILA-2324",
		source: "interactive",
	});
	const prose = {
		type: "input",
		text: "Me parece bien; adelante.",
		source: "interactive",
	};
	assert.equal(subject.runtime.shouldContinue(prose), false);
	subject.runtime.handlePublicEntry(prose);
	assert.deepEqual(subject.calls, [{ op: "start", issueId: "ILA-2324" }]);

	await subject.handlers.get("tool_call")({
		toolName: "workflow_product_review",
		toolCallId: "selection",
		input: { action: "select_result", result: "Aceptado" },
	});
	const result = await subject.tools.get("workflow_product_review").execute(
		"selection",
		{ action: "select_result", result: "Aceptado" },
	);
	assert.deepEqual(JSON.parse(result.content[0].text), { status: "continuing" });
	assert.deepEqual(subject.calls.at(-1), {
		op: "complete",
		input: { action: "select_result", result: "Aceptado" },
	});
});

test("exposes shared-decision cancellation without a legacy direct workflow", async () => {
	const subject = harness();
	subject.runtime.handlePublicEntry({
		type: "input",
		text: "/product-review ILA-2324",
		source: "interactive",
	});
	const tool = subject.tools.get("workflow_product_review");
	assert.deepEqual(tool.parameters.required, ["action"]);
	assert.deepEqual(tool.parameters.properties.action.enum, [
		"select_result",
		"cancel_decision",
	]);
	const result = await tool.execute("cancel", { action: "cancel_decision" });
	assert.deepEqual(JSON.parse(result.content[0].text), {
		status: "cancelled",
		issueId: "ILA-2324",
	});
	assert.equal(subject.runtime.hasActiveTurn(), false);
});

test("clears lifecycle state without retaining an ephemeral authorization flag", () => {
	const subject = harness();
	subject.runtime.handlePublicEntry({
		type: "input",
		text: "/product-review ILA-2324",
		source: "interactive",
	});
	assert.equal(subject.runtime.hasActiveTurn(), true);
	subject.handlers.get("session_start")();
	assert.equal(subject.runtime.hasActiveTurn(), false);
});
