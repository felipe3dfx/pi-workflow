import assert from "node:assert/strict";
import test from "node:test";
import { createProductReviewRuntime } from "../extensions/product-review-runtime.ts";

test("binds the natural Owner selection to the active product-review turn without exposing digests", async () => {
	const calls = [];
	const handlers = new Map();
	const tools = new Map();
	const runtime = createProductReviewRuntime({
		workflow: {
			prepare: async (issueId) => {
				calls.push({ op: "prepare", issueId });
				return {
					status: "prepared",
					recommendation: "Aceptado",
					choices: {
						Aceptado: { digest: "a".repeat(64) },
						"Cambios requeridos": { digest: "b".repeat(64) },
					},
				};
			},
			approve: async (input) => {
				calls.push({ op: "approve", input });
				return { status: "approved" };
			},
			publish: async (input) => {
				calls.push({ op: "publish", input });
				return { status: "published", comment: { id: "comment-1" } };
			},
		},
	});
	runtime.register({
		on: (e, h) => handlers.set(e, h),
		registerTool: (t) => tools.set(t.name, t),
	});
	runtime.handlePublicEntry({
		type: "input",
		text: "/product-review ILA-2324",
		source: "interactive",
	});
	const first = await handlers.get("before_agent_start")({});
	assert.match(first.systemPrompt, /recommendation.*Aceptado/i);
	assert.match(first.systemPrompt, /decide naturally/i);
	assert.match(first.systemPrompt, /interpret the Owner's response yourself/i);
	assert.match(first.systemPrompt, /select_result.*Aceptado.*Cambios requeridos/i);
	assert.match(first.systemPrompt, /language used by the user/i);
	assert.doesNotMatch(first.systemPrompt, /[a-f0-9]{64}/i);
	assert.doesNotMatch(first.systemPrompt, /ILA-2324\s+(?:Aceptado|Cambios requeridos)/);
	const selection = {
		type: "input",
		text: "Me parece bien; adelante con la recomendación.",
		source: "interactive",
	};
	assert.equal(runtime.shouldContinue(selection), true);
	runtime.handlePublicEntry(selection);
	const result = await tools
		.get("workflow_product_review")
		.execute("t", { action: "select_result", result: "Aceptado" });
	assert.equal(JSON.parse(result.content[0].text).status, "published");
	assert.doesNotMatch(result.content[0].text, /[a-f0-9]{64}/i);
	assert.doesNotMatch(result.content[0].text, /ILA-2324\s+(?:Aceptado|Cambios requeridos)/);
	assert.deepEqual(calls, [
		{ op: "prepare", issueId: "ILA-2324" },
		{
			op: "approve",
			input: {
				issueId: "ILA-2324",
				result: "Aceptado",
				digest: "a".repeat(64),
			},
		},
		{ op: "publish", input: { issueId: "ILA-2324" } },
	]);
	assert.deepEqual(
		Object.keys(
			tools.get("workflow_product_review").parameters.properties,
		).sort(),
		["action", "result"],
	);
});

test("rejects extras and exact active-turn binding, then consumes the turn", async () => {
	const calls = [];
	const tools = new Map();
	const runtime = createProductReviewRuntime({
		workflow: {
			prepare: async () => ({
				status: "prepared",
				recommendation: "Aceptado",
				choices: {
					Aceptado: { digest: "a".repeat(64) },
					"Cambios requeridos": { digest: "b".repeat(64) },
				},
			}),
			approve: async (input) => {
				calls.push(input);
				return { status: "approved" };
			},
			publish: async () => ({ status: "published", comment: { id: "comment" } }),
		},
	});
	runtime.register({ on: () => undefined, registerTool: (tool) => tools.set(tool.name, tool) });
	runtime.handlePublicEntry({ type: "input", text: "/product-review ILA-2324", source: "interactive" });
	const selection = { type: "input", text: "Todavía necesita ajustes.", source: "interactive" };
	assert.equal(runtime.shouldContinue(selection), true);
	runtime.handlePublicEntry(selection);
	const rejected = await tools.get("workflow_product_review").execute("tool", {
		body: "extra",
	});
	assert.equal(JSON.parse(rejected.content[0].text).blocker.code, "PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID");
	assert.deepEqual(calls, []);
	const repeated = await tools.get("workflow_product_review").execute("tool-2", {
		action: "select_result",
		result: "Cambios requeridos",
	});
	assert.equal(JSON.parse(repeated.content[0].text).blocker.code, "PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID");
});

test("keeps arbitrary natural-language decisions available for Agent interpretation and clears lifecycle state", () => {
	const handlers = new Map();
	const runtime = createProductReviewRuntime({
		workflow: { prepare: async () => ({ status: "prepared" }), approve: async () => ({}), publish: async () => ({}) },
	});
	runtime.register({ on: (event, handler) => handlers.set(event, handler), registerTool: () => undefined });
	runtime.handlePublicEntry({ type: "input", text: "/product-review ILA-2324", source: "interactive" });
	assert.equal(runtime.hasPendingSelection(), true);
	assert.equal(runtime.shouldContinue({ type: "input", text: "No estoy seguro; explícame la diferencia.", source: "interactive" }), true);
	assert.equal(runtime.hasPendingSelection(), true);
	handlers.get("session_start")();
	assert.equal(runtime.hasActiveTurn(), false);
});
