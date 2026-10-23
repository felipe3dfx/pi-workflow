import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { installChildRuntime, parentChannel } from "../extensions/child-runtime.ts";

async function runtime(t, role = "worker", config = {}) {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-workflow-child-runtime-")));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const toChild = new PassThrough();
	const fromChild = new PassThrough();
	const frames = [];
	let buffer = "";
	fromChild.setEncoding("utf8");
	fromChild.on("data", (chunk) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop();
		frames.push(...lines.map((line) => JSON.parse(line)));
	});
	const tools = new Map();
	const handlers = new Map();
	installChildRuntime(
		{
			registerTool: (tool) => tools.set(tool.name, tool),
			on: (event, handler) => handlers.set(event, handler),
		},
		{ role, cwd, shell: {}, checkpoint: false, ...config },
		parentChannel(toChild, fromChild),
	);
	const flushed = () => new Promise((resolve) => setImmediate(resolve));
	const answer = (reply) => toChild.write(`${JSON.stringify(reply)}\n`);
	return { tools, handlers, frames, flushed, answer, toChild };
}

test("the child runtime registers the guarded bash, ask_parent and report_result and connects", async (t) => {
	const worker = await runtime(t, "worker");
	await worker.flushed();
	assert.deepEqual([...worker.tools.keys()], ["bash", "ask_parent", "report_result"]);
	assert.deepEqual(worker.frames, [{ type: "ready" }]);
	const explorer = await runtime(t, "explore");
	assert.deepEqual([...explorer.tools.keys()], ["bash", "ask_parent"]);
});

test("the child's bash refuses a command reserved for the parent", async (t) => {
	const { tools } = await runtime(t);
	const result = await tools.get("bash").execute("call-1", { command: "git push origin HEAD" });
	assert.equal(
		result.structuredContent.output,
		"`git push` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.\n",
	);
});

test("ask_parent waits for the parent's correlated answer", async (t) => {
	const { tools, frames, flushed, answer } = await runtime(t);
	const first = tools.get("ask_parent").execute("call-1", { question: "Which file?" });
	const second = tools.get("ask_parent").execute("call-2", { question: "Which test?" });
	await flushed();
	assert.deepEqual(frames.slice(1), [
		{ type: "ask", question: "Which file?", id: 1 },
		{ type: "ask", question: "Which test?", id: 2 },
	]);
	answer({ id: 2, error: "A question is already waiting for the parent's reply." });
	answer({ id: 1, answer: "README.md" });
	assert.deepEqual((await first).content, [{ type: "text", text: "README.md" }]);
	await assert.rejects(second, /A question is already waiting for the parent's reply/);
});

test("an aborted ask_parent withdraws its question and ignores a late answer", async (t) => {
	const { tools, frames, flushed, answer } = await runtime(t);
	const call = new AbortController();
	const asked = tools.get("ask_parent").execute("call-1", { question: "Which file?" }, call.signal);
	call.abort();
	await assert.rejects(asked, /The call was aborted/);
	answer({ id: 1, answer: "late" });
	await flushed();
	assert.deepEqual(frames.slice(1), [
		{ type: "ask", question: "Which file?", id: 1 },
		{ type: "withdraw", id: 1 },
	]);
});

test("a closed parent channel rejects pending and later questions", async (t) => {
	const { tools, toChild } = await runtime(t);
	const asked = tools.get("ask_parent").execute("call-1", { question: "Which file?" });
	toChild.end();
	await assert.rejects(asked, /The parent channel closed; no answer will come/);
	await assert.rejects(
		tools.get("ask_parent").execute("call-2", { question: "Again?" }),
		/The parent channel closed/,
	);
});

test("report_result sends the structured result and waits for the parent to record it", async (t) => {
	const { tools, frames, flushed, answer } = await runtime(t);
	const report = tools.get("report_result");
	await assert.rejects(
		report.execute("call-1", { verdict: "blocked", files_changed: [], validation: [], left_undone: [] }),
		/A blocked Verdict needs a reason/,
	);
	const result = { verdict: "done", files_changed: ["a.ts: added"], validation: [], left_undone: [] };
	const recorded = report.execute("call-2", result);
	await flushed();
	assert.deepEqual(frames.at(-1), { type: "report", result, id: 1 });
	answer({ id: 1 });
	assert.deepEqual((await recorded).content, [{ type: "text", text: "Result recorded." }]);
});

test("a verifier reports with the verifier's result schema", async (t) => {
	const { tools } = await runtime(t, "verify");
	assert.ok(tools.get("report_result").parameters.properties.verdict.anyOf.some((option) => option.const === "pass"));
});

test("the child keeps its contract free of APPEND_SYSTEM.md", async (t) => {
	const { handlers } = await runtime(t);
	const event = { systemPromptOptions: { appendSystemPrompt: "Appended by the user." } };
	handlers.get("before_agent_start")(event);
	assert.equal(event.systemPromptOptions.appendSystemPrompt, "");
});
