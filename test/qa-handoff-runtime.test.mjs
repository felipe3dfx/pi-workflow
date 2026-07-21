import assert from "node:assert/strict";
import test from "node:test";

import { createQaHandoffRuntime } from "../extensions/qa-handoff-runtime.ts";

function setup() {
	const calls = [];
	const handlers = new Map();
	const tools = new Map();
	const workflow = {
		async authorizeInvocation(issueId) {
			calls.push({ operation: "authorizeInvocation", issueId });
			return {
				status: "authorized",
				artifact: { digest: "authorized-digest" },
			};
		},
		async publish(input) {
			calls.push({ operation: "publish", input });
			return {
				status: "published",
				artifact: { digest: "authorized-digest" },
				comment: { id: "opaque-comment", body: "cuerpo" },
			};
		},
	};
	const runtime = createQaHandoffRuntime({ workflow });
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return { calls, handlers, runtime, tools };
}

test("binds one Linear ID from the admitted public turn and publishes only that issue", async () => {
	const { calls, handlers, runtime, tools } = setup();
	const event = {
		type: "input",
		text: "/qa-handoff ILA-2321",
		source: "interactive",
	};

	runtime.handlePublicEntry(event);
	const prompt = await handlers.get("before_agent_start")({
		type: "before_agent_start",
	});
	const result = await tools.get("workflow_qa_handoff").execute("tool-1", {
		issueId: "ILA-2321",
	});

	assert.equal(runtime.toolName, "workflow_qa_handoff");
	assert.equal(runtime.hasActiveTurn(), false);
	assert.deepEqual(calls, [
		{ operation: "authorizeInvocation", issueId: "ILA-2321" },
		{ operation: "publish", input: { issueId: "ILA-2321" } },
	]);
	assert.match(prompt.systemPrompt, /issueId="ILA-2321"/);
	assert.deepEqual(
		tools.get("workflow_qa_handoff").parameters,
		{
			type: "object",
			additionalProperties: false,
			required: ["issueId"],
			properties: {
				issueId: {
					type: "string",
					pattern: "^[A-Z][A-Z0-9]*-[1-9][0-9]*$",
				},
			},
		},
	);
	assert.equal(JSON.parse(result.content[0].text).status, "published");
});

test("blocks mismatched or augmented tool input without reaching publication", async () => {
	const { calls, runtime, tools } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/skill:qa-handoff ILA-2321",
		source: "interactive",
	});

	for (const input of [
		{ issueId: "ILA-2322" },
		{ issueId: "ILA-2321", body: "caller body" },
		{ issueId: "ILA-2321", digest: "caller digest" },
		{
			issueId: "ILA-2321",
			authority: { actorId: "caller", role: "Developer" },
		},
	]) {
		const result = await tools.get("workflow_qa_handoff").execute("tool-1", input);
		const outcome = JSON.parse(result.content[0].text);
		assert.equal(outcome.status, "blocked");
		assert.equal(outcome.blocker.code, "PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID");
	}
	assert.deepEqual(calls, [
		{ operation: "authorizeInvocation", issueId: "ILA-2321" },
	]);
});

test("returns a stable blocker when workflow publication rejects", async () => {
	const workflow = {
		authorizeInvocation: async () => ({ status: "authorized" }),
		publish: async () => {
			throw new Error("Linear publication failed.");
		},
	};
	const rejectingRuntime = createQaHandoffRuntime({ workflow });
	const rejectingTools = new Map();
	rejectingRuntime.register({
		on: () => undefined,
		registerTool: (tool) => rejectingTools.set(tool.name, tool),
	});
	rejectingRuntime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff ILA-2321",
		source: "interactive",
	});

	const result = await rejectingTools.get("workflow_qa_handoff").execute("tool-1", {
		issueId: "ILA-2321",
	});

	assert.deepEqual(JSON.parse(result.content[0].text), {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_QA_HANDOFF_PUBLICATION_FAILED",
			message: "Linear publication failed.",
		},
	});
});

test("does not authorize malformed or multi-ID public input", () => {
	for (const text of [
		"/qa-handoff",
		"/qa-handoff ila-2321",
		"/qa-handoff ILA-2321 ILA-2322",
	]) {
		const { calls, runtime } = setup();
		runtime.handlePublicEntry({ type: "input", text, source: "interactive" });
		assert.equal(runtime.hasActiveTurn(), false, text);
		assert.deepEqual(calls, [], text);
	}
});

test("authorizes one plain valid ID after the invalid-anchor corrective turn", async () => {
	const { calls, handlers, runtime, tools } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff invalid",
		source: "interactive",
	});
	assert.equal(runtime.hasActiveTurn(), false);
	assert.equal(runtime.hasPendingAnchorContinuation(), true);

	await handlers.get("agent_settled")({ type: "agent_settled" });
	const continuation = {
		type: "input",
		text: "ILA-2321",
		source: "interactive",
	};
	assert.equal(runtime.shouldContinue(continuation), true);
	runtime.handlePublicEntry(continuation);
	assert.equal(runtime.hasPendingAnchorContinuation(), false);
	assert.equal(runtime.hasActiveTurn(), true);

	const first = await tools.get("workflow_qa_handoff").execute("tool-1", {
		issueId: "ILA-2321",
	});
	const second = await tools.get("workflow_qa_handoff").execute("tool-2", {
		issueId: "ILA-2321",
	});

	assert.equal(JSON.parse(first.content[0].text).status, "published");
	assert.equal(
		JSON.parse(second.content[0].text).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID",
	);
	assert.deepEqual(calls, [
		{ operation: "authorizeInvocation", issueId: "ILA-2321" },
		{ operation: "publish", input: { issueId: "ILA-2321" } },
	]);
});

test("does not treat unrelated plain input as an invalid-anchor continuation", () => {
	const { calls, runtime } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff",
		source: "interactive",
	});

	assert.equal(runtime.shouldContinue({
		type: "input",
		text: "please summarize the repository",
		source: "interactive",
	}), false);
	assert.equal(runtime.hasPendingAnchorContinuation(), false);
	assert.equal(runtime.hasActiveTurn(), false);
	assert.deepEqual(calls, []);
});

test("consumes authorization after one terminal tool execution", async () => {
	const { calls, handlers, runtime, tools } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff ILA-2321",
		source: "interactive",
	});

	const first = await tools.get("workflow_qa_handoff").execute("tool-1", {
		issueId: "ILA-2321",
	});
	const second = await tools.get("workflow_qa_handoff").execute("tool-2", {
		issueId: "ILA-2321",
	});

	assert.equal(JSON.parse(first.content[0].text).status, "published");
	assert.equal(
		JSON.parse(second.content[0].text).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID",
	);
	assert.equal(runtime.hasActiveTurn(), false);
	assert.equal(
		await handlers.get("before_agent_start")({ type: "before_agent_start" }),
		undefined,
	);
	assert.equal(calls.filter(({ operation }) => operation === "publish").length, 1);
});

test("settlement clears an unused authorization before a later turn", async () => {
	const { calls, handlers, runtime, tools } = setup();
	runtime.handlePublicEntry({
		type: "input",
		text: "/qa-handoff ILA-2321",
		source: "interactive",
	});

	await handlers.get("agent_settled")({ type: "agent_settled" });
	const prompt = await handlers.get("before_agent_start")({
		type: "before_agent_start",
	});
	const result = await tools.get("workflow_qa_handoff").execute("tool-late", {
		issueId: "ILA-2321",
	});

	assert.equal(prompt, undefined);
	assert.equal(runtime.hasActiveTurn(), false);
	assert.equal(
		JSON.parse(result.content[0].text).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID",
	);
	assert.deepEqual(calls, [
		{ operation: "authorizeInvocation", issueId: "ILA-2321" },
	]);
});
