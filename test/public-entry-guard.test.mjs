import test from "node:test";
import assert from "node:assert/strict";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

function loadExtension() {
	const handlers = new Map();
	let commandCount = 0;
	piWorkflowExtension({
		exec: async () => ({ code: 0 }),
		registerCommand: () => {
			commandCount += 1;
		},
		on: (event, handler) => handlers.set(event, handler),
	});
	return { handlers, commandCount };
}

function context(notifications = [], idle = true) {
	return {
		isIdle: () => idle,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
		},
	};
}

test("non-interactive public entries are handled before agent or tool execution", async () => {
	const { handlers } = loadExtension();
	const notifications = [];
	const result = await handlers.get("input")(
		{ type: "input", text: "/skill:deliver-ticket ILA-2304", source: "rpc" },
		context(notifications),
	);
	assert.deepEqual(result, { action: "handled" });
	assert.deepEqual(notifications, [
		{
			message:
				"status: blocked\ncode: PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN\ncapability: deliver-ticket\nmutation: none",
			level: "error",
		},
	]);
	assert.equal(handlers.has("before_agent_start"), false);
});

test("all public command forms reject non-idle and non-interactive delivery", async () => {
	for (const [text, event, idle] of [
		["/define-product idea", { source: "extension" }, true],
		["/skill:deliver-ticket ILA-2304", { source: "rpc" }, true],
		["/qa-handoff ILA-2304", { source: "interactive", streamingBehavior: "steer" }, true],
		["/skill:product-review ILA-2304", { source: "interactive", streamingBehavior: "followUp" }, true],
		["/define-product idea", { source: "interactive" }, false],
	]) {
		const { handlers } = loadExtension();
		const result = await handlers.get("input")(
			{ type: "input", text, ...event },
			context([], idle),
		);
		assert.deepEqual(result, { action: "handled" }, text);
	}
});

test("similarly prefixed commands are not treated as public entries", async () => {
	const { handlers } = loadExtension();
	assert.deepEqual(
		await handlers.get("input")(
			{ type: "input", text: "/define-product-extra", source: "rpc" },
			context(),
		),
		{ action: "continue" },
	);
});

test("a second interactive public entry is handled while the first remains pending", async () => {
	const { handlers } = loadExtension();
	const notifications = [];
	const ctx = context(notifications, true);
	assert.deepEqual(
		await handlers.get("input")(
			{ type: "input", text: "/qa-handoff ILA-2304", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);
	assert.deepEqual(
		await handlers.get("input")(
			{
				type: "input",
				text: "/deliver-ticket ILA-2305",
				source: "interactive",
			},
			ctx,
		),
		{ action: "handled" },
	);
	assert.deepEqual(notifications, [
		{
			message:
				"status: blocked\ncode: PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN\ncapability: deliver-ticket\nmutation: none",
			level: "error",
		},
	]);
	assert.deepEqual(await handlers.get("tool_call")({ toolName: "read" }, ctx), {
		block: true,
		reason:
			"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
	});
});

test("an active pending public entry blocks prompt-injected tool calls until settled", async () => {
	const { handlers } = loadExtension();
	const ctx = context();
	assert.deepEqual(
		await handlers.get("input")(
			{ type: "input", text: "/qa-handoff ILA-2304", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);
	assert.deepEqual(await handlers.get("tool_call")({ toolName: "read" }, ctx), {
		block: true,
		reason:
			"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
	});
	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
	assert.equal(await handlers.get("tool_call")({ toolName: "write" }, ctx), undefined);
});

test("session replacement clears an active public-entry turn", async () => {
	const { handlers } = loadExtension();
	const ctx = context();
	await handlers.get("input")(
		{ type: "input", text: "/product-review ILA-2304", source: "interactive" },
		ctx,
	);
	await handlers.get("session_shutdown")(
		{ type: "session_shutdown", reason: "resume" },
		ctx,
	);
	assert.equal(await handlers.get("tool_call")({ toolName: "bash" }, ctx), undefined);
});
