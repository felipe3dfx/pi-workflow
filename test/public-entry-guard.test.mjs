import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

function skillBootstrapInput(name) {
	return {
		path: fileURLToPath(
			new URL(`../skills/${name}/SKILL.md`, import.meta.url),
		),
	};
}

function loadExtension(options = {}) {
	const handlers = new Map();
	const tools = new Map();
	let commandCount = 0;
	piWorkflowExtension(
		{
			exec: async () => ({ code: 0 }),
			registerCommand: () => {
				commandCount += 1;
			},
			registerTool: (tool) => tools.set(tool.name, tool),
			on: (event, handler) => handlers.set(event, handler),
		},
		options,
	);
	return { handlers, commandCount, tools };
}

function implementedWorkflow() {
	let pendingRecommendation;
	return {
		pendingRecommendation: () => pendingRecommendation,
		reset: () => {
			pendingRecommendation = undefined;
		},
		advance: async (command) => {
			if (command.kind === "recommend-route") {
				pendingRecommendation = {
					definitionId: command.definitionId,
					domainAnchor: command.domainAnchor,
					domainAnchorDigest: "anchor-digest",
					assessment: command.assessment,
					recommendedRoute: "wayfinder",
					digest: "recommendation-1",
				};
				return {
					status: "awaiting-confirmation",
					recommendation: pendingRecommendation,
				};
			}
			pendingRecommendation = undefined;
			return {
				status: "blocked",
				blocker: { code: "blocked", message: "not used" },
			};
		},
	};
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
});

test("all public command forms reject non-idle and non-interactive delivery", async () => {
	for (const [text, event, idle] of [
		["/define-product idea", { source: "extension" }, true],
		["/skill:deliver-ticket ILA-2304", { source: "rpc" }, true],
		[
			"/qa-handoff ILA-2304",
			{ source: "interactive", streamingBehavior: "steer" },
			true,
		],
		[
			"/skill:product-review ILA-2304",
			{ source: "interactive", streamingBehavior: "followUp" },
			true,
		],
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
	assert.equal(
		await handlers.get("tool_call")({ toolName: "write" }, ctx),
		undefined,
	);
});

test("qa-handoff prompt may bootstrap only its exact public skill before asking for a missing issue ID", async () => {
	const prompt = await readFile(
		new URL("../prompts/qa-handoff.md", import.meta.url),
		"utf8",
	);
	const requestedSkill = prompt.match(
		/Load and follow the `([^`]+)` skill\./,
	)?.[1];
	assert.equal(requestedSkill, "qa-handoff");

	const { handlers } = loadExtension();
	const ctx = context();
	await handlers.get("input")(
		{ type: "input", text: "/qa-handoff", source: "interactive" },
		ctx,
	);
	assert.equal(
		await handlers.get("tool_call")(
			{
				type: "tool_call",
				toolCallId: "skill-1",
				toolName: "read",
				input: skillBootstrapInput(requestedSkill),
			},
			ctx,
		),
		undefined,
	);
	const skill = await readFile(
		new URL("../skills/qa-handoff/SKILL.md", import.meta.url),
		"utf8",
	);
	assert.match(skill, /What single Linear issue ID anchors this QA handoff\?/);
});

test("skill bootstrap is one-time, homonymous, and unavailable to pending capabilities", async () => {
	for (const capability of ["define-product", "product-review"]) {
		const { handlers } = loadExtension();
		const ctx = context();
		await handlers.get("input")(
			{ type: "input", text: `/${capability}`, source: "interactive" },
			ctx,
		);
		const toolCall = (name) =>
			handlers.get("tool_call")(
				{
					type: "tool_call",
					toolCallId: `skill-${name}`,
					toolName: "read",
					input: skillBootstrapInput(name),
				},
				ctx,
			);
		assert.match(
			(await toolCall("qa-handoff")).reason,
			/PI_WORKFLOW_CAPABILITY_PENDING/,
		);
		assert.equal(await toolCall(capability), undefined);
		assert.match(
			(await toolCall(capability)).reason,
			/PI_WORKFLOW_CAPABILITY_PENDING/,
		);
	}

	const pending = loadExtension();
	const ctx = context();
	await pending.handlers.get("input")(
		{ type: "input", text: "/deliver-ticket ILA-2368", source: "interactive" },
		ctx,
	);
	const blocked = await pending.handlers.get("tool_call")(
		{
			type: "tool_call",
			toolCallId: "skill-delivery",
			toolName: "read",
			input: skillBootstrapInput("deliver-ticket"),
		},
		ctx,
	);
	assert.match(blocked.reason, /PI_WORKFLOW_CAPABILITY_PENDING/);
});

test("public-entry guard blocks define-product tool calls without an active authorized capability", async () => {
	const { handlers } = loadExtension();
	assert.deepEqual(
		await handlers.get("tool_call")(
			{ toolName: "workflow_define_product" },
			context(),
		),
		{
			block: true,
			reason:
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
		},
	);
});

test("default define-product is implemented and allows only its workflow-owned tool during guarded turns", async () => {
	const { handlers, tools } = loadExtension();
	const ctx = context();
	assert.ok(tools.has("workflow_define_product"));
	await handlers.get("input")(
		{
			type: "input",
			text: "/define-product map a new category",
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
	assert.deepEqual(await handlers.get("tool_call")({ toolName: "read" }, ctx), {
		block: true,
		reason:
			"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
	});
});

test("implemented define-product preserves authorization for the settled confirmation turn", async () => {
	const { handlers, tools } = loadExtension({
		defineProduct: {
			workflow: implementedWorkflow(),
		},
	});
	const ctx = context();
	await handlers.get("input")(
		{
			type: "input",
			text: "/define-product map a new category",
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
	assert.deepEqual(await handlers.get("tool_call")({ toolName: "read" }, ctx), {
		block: true,
		reason:
			"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
	});
	await tools.get("workflow_define_product").execute("tool-1", {
		action: "recommend_route",
		definitionId: "definition-1",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
	assert.equal(
		await handlers.get("tool_call")(
			{ toolName: "workflow_define_product" },
			ctx,
		),
		undefined,
	);
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
});

test("implemented qa-handoff allows only its workflow tool for the exact admitted issue", async () => {
	const calls = [];
	const { handlers, tools } = loadExtension({
		qaHandoff: {
			workflow: {
				authorizeInvocation: async (issueId) => {
					calls.push({ operation: "authorize", issueId });
					return { status: "authorized", artifact: { digest: "digest-1" } };
				},
				publish: async (input) => {
					calls.push({ operation: "publish", input });
					return {
						status: "published",
						artifact: { digest: "digest-1" },
						comment: { id: "opaque-comment", body: "body" },
					};
				},
			},
		},
	});
	const ctx = context();
	assert.ok(tools.has("workflow_qa_handoff"));
	await handlers.get("input")(
		{ type: "input", text: "/qa-handoff ILA-2321", source: "interactive" },
		ctx,
	);
	assert.equal(
		await handlers.get("tool_call")({ toolName: "workflow_qa_handoff" }, ctx),
		undefined,
	);
	assert.deepEqual(
		await handlers.get("tool_call")({ toolName: "linear_save_issue" }, ctx),
		{
			block: true,
			reason:
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
		},
	);
	await tools
		.get("workflow_qa_handoff")
		.execute("tool-1", { issueId: "ILA-2321" });
	assert.deepEqual(
		await handlers.get("tool_call")({ toolName: "workflow_qa_handoff" }, ctx),
		{
			block: true,
			reason:
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
		},
	);
	assert.equal(
		await handlers.get("before_agent_start")(
			{ type: "before_agent_start" },
			ctx,
		),
		undefined,
	);
	assert.deepEqual(calls, [
		{ operation: "authorize", issueId: "ILA-2321" },
		{ operation: "publish", input: { issueId: "ILA-2321" } },
	]);
});

test("qa-handoff admits one plain valid ID after the invalid-anchor corrective turn", async () => {
	const calls = [];
	const { handlers, tools } = loadExtension({
		qaHandoff: {
			workflow: {
				authorizeInvocation: async (issueId) => {
					calls.push({ operation: "authorize", issueId });
					return { status: "authorized" };
				},
				publish: async (input) => {
					calls.push({ operation: "publish", input });
					return { status: "published", comment: { id: "comment-1" } };
				},
			},
		},
	});
	const ctx = context();
	assert.deepEqual(
		await handlers.get("input")(
			{ type: "input", text: "/qa-handoff not-an-id", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);
	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);

	assert.deepEqual(
		await handlers.get("input")(
			{ type: "input", text: "ILA-2321", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);
	assert.equal(
		await handlers.get("tool_call")({ toolName: "workflow_qa_handoff" }, ctx),
		undefined,
	);
	const result = await tools.get("workflow_qa_handoff").execute("tool-1", {
		issueId: "ILA-2321",
	});
	assert.equal(JSON.parse(result.content[0].text).status, "published");
	assert.deepEqual(
		await handlers.get("tool_call")({ toolName: "workflow_qa_handoff" }, ctx),
		{
			block: true,
			reason:
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
		},
	);
	assert.deepEqual(calls, [
		{ operation: "authorize", issueId: "ILA-2321" },
		{ operation: "publish", input: { issueId: "ILA-2321" } },
	]);
});

test("unrelated plain input remains outside qa-handoff continuation", async () => {
	const calls = [];
	const { handlers } = loadExtension({
		qaHandoff: {
			workflow: {
				authorizeInvocation: async (issueId) => {
					calls.push(issueId);
					return { status: "authorized" };
				},
				publish: async () => ({ status: "published" }),
			},
		},
	});
	const ctx = context();
	await handlers.get("input")(
		{ type: "input", text: "/qa-handoff", source: "interactive" },
		ctx,
	);
	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);

	assert.deepEqual(
		await handlers.get("input")(
			{
				type: "input",
				text: "summarize the current work",
				source: "interactive",
			},
			ctx,
		),
		{ action: "continue" },
	);
	assert.equal(
		await handlers.get("tool_call")({ toolName: "read" }, ctx),
		undefined,
	);
	assert.deepEqual(calls, []);
});

test("settled qa-handoff cannot reuse authorization through public tool fallback", async () => {
	const { handlers } = loadExtension({
		qaHandoff: {
			workflow: {
				authorizeInvocation: async () => ({ status: "authorized" }),
				publish: async () => ({ status: "published" }),
			},
		},
	});
	const ctx = context();
	await handlers.get("input")(
		{ type: "input", text: "/qa-handoff ILA-2321", source: "interactive" },
		ctx,
	);

	await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);

	assert.deepEqual(
		await handlers.get("tool_call")({ toolName: "workflow_qa_handoff" }, ctx),
		{
			block: true,
			reason:
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities",
		},
	);
	assert.equal(
		await handlers.get("before_agent_start")(
			{ type: "before_agent_start" },
			ctx,
		),
		undefined,
	);
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
	assert.equal(
		await handlers.get("tool_call")({ toolName: "bash" }, ctx),
		undefined,
	);
});
