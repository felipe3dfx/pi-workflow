import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { installChildRuntime, parentChannel } from "../extensions/child-runtime.ts";
import { eventually } from "./support/eventually.mjs";
import { withCheckpoint } from "./support/signed-checkpoint.mjs";

async function runtime(t, role = "worker", config = {}, serve = () => undefined) {
	const cwd = config.cwd ?? (await realpath(await mkdtemp(join(tmpdir(), "pi-workflow-child-runtime-"))));
	if (!config.cwd) t.after(() => rm(cwd, { recursive: true, force: true }));
	const toChild = new PassThrough();
	const fromChild = new PassThrough();
	const frames = [];
	const answer = (reply) => toChild.write(`${JSON.stringify(reply)}\n`);
	let buffer = "";
	fromChild.setEncoding("utf8");
	fromChild.on("data", (chunk) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop();
		for (const frame of lines.map((line) => JSON.parse(line))) {
			frames.push(frame);
			const reply = serve(frame);
			if (reply !== undefined) Promise.resolve(reply).then((value) => answer({ id: frame.id, ...value }));
		}
	});
	const tools = new Map();
	const handlers = new Map();
	const entries = [];
	let active = ["read", "bash", "edit", "write"];
	const pi = {
		registerTool: (tool) => tools.set(tool.name, tool),
		on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		getAllTools: () => [...tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
		getActiveTools: () => active,
		setActiveTools: (names) => {
			active = names;
		},
		appendEntry: (customType, data) => entries.push({ customType, data }),
	};
	await installChildRuntime(
		pi,
		{ role, cwd, shell: {}, ...config },
		parentChannel(toChild, fromChild),
		{ cwd, getSystemPrompt: () => "You are a child.", signal: undefined },
	);
	const flushed = () => new Promise((resolve) => setImmediate(resolve));
	const emit = async (event, payload, ctx = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? [])
			result = (await handler(payload, { cwd, getSystemPrompt: () => "You are a child.", signal: undefined, ...ctx })) ?? result;
		return result;
	};
	return { cwd, tools, handlers, emit, frames, flushed, answer, toChild, entries, active: () => active };
}

test("the child runtime registers the guarded bash, ask_parent and report_result and connects", async (t) => {
	const worker = await runtime(t, "worker");
	await worker.flushed();
	assert.deepEqual([...worker.tools.keys()], ["bash", "ask_parent", "report_result"]);
	assert.deepEqual(worker.frames, [{ type: "ready", tools: ["read", "bash", "edit", "write"] }]);
	const explorer = await runtime(t, "explore");
	assert.deepEqual([...explorer.tools.keys()], ["bash", "ask_parent"]);
});

test("the child registers codegraph only when the parent has CodeGraph seated", async (t) => {
	const seated = await runtime(t, "explore", { codegraph: true });
	assert.deepEqual([...seated.tools.keys()], ["bash", "codegraph", "ask_parent"]);
	assert.deepEqual(seated.tools.get("codegraph").parameters.properties.operation.enum, ["query", "explore"]);
	const unseated = await runtime(t, "explore");
	assert.equal(unseated.tools.has("codegraph"), false);
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

test("the child drops a malformed reply and still takes the parent's answer", async (t) => {
	const { tools, toChild, answer } = await runtime(t);
	const asked = tools.get("ask_parent").execute("call-1", { question: "Which file?" });
	toChild.write("null\n5\n{\"answer\":\"stray\"}\n");
	answer({ id: 1, answer: "README.md" });
	assert.deepEqual((await asked).content, [{ type: "text", text: "README.md" }]);
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
	const { emit } = await runtime(t);
	const event = { systemPromptOptions: { appendSystemPrompt: "Appended by the user." } };
	await emit("before_agent_start", event);
	assert.equal(event.systemPromptOptions.appendSystemPrompt, "");
});

test("a granted worker commits through checkpoint and the parent records it before the tool returns", async (t) => {
	await withCheckpoint(async ({ worktree, grant }) => {
		let acknowledge;
		const { tools, frames } = await runtime(t, "worker", { cwd: worktree, checkpoint: grant }, (frame) =>
			frame.type === "checkpoint"
				? new Promise((resolve) => {
						acknowledge = () => resolve({});
					})
				: undefined,
		);
		assert.deepEqual([...tools.keys()], ["bash", "ask_parent", "report_result", "checkpoint"]);
		const refused = await tools.get("bash").execute("call-0", { command: "git commit -m 'feat: x'" });
		assert.match(refused.structuredContent.output, /Commit through the checkpoint tool instead/);
		await writeFile(join(worktree, "a.txt"), "A\n");
		let returned = false;
		const committed = tools
			.get("checkpoint")
			.execute("call-1", { message: "feat: add a", paths: ["a.txt"] })
			.then((result) => {
				returned = true;
				return result;
			});
		await eventually(() => frames.some((frame) => frame.type === "checkpoint"));
		assert.equal(returned, false);
		acknowledge();
		const { details } = await committed;
		assert.deepEqual(frames.find((frame) => frame.type === "checkpoint").checkpoint, {
			sha: details.sha,
			parent: details.parent,
			base: grant.base,
			branch: "feature",
		});
	});
});

test("a checkpoint the parent fails to record fails the checkpoint call with the parent's error", async (t) => {
	await withCheckpoint(async ({ worktree, grant }) => {
		const { tools } = await runtime(t, "worker", { cwd: worktree, checkpoint: grant }, (frame) =>
			frame.type === "checkpoint" ? { error: "The parent could not record the checkpoint." } : undefined,
		);
		await writeFile(join(worktree, "a.txt"), "A\n");
		await assert.rejects(
			tools.get("checkpoint").execute("call-1", { message: "feat: add a", paths: ["a.txt"] }),
			/The parent could not record the checkpoint\./,
		);
	});
});

const ordinary = {
	prohibited: false,
	scope: "within",
	ownership: "assigned",
	effects: "ordinary",
	confirmed: false,
	commit: false,
	reason: "The assigned edit.",
};

test("a contextual child evaluates every tool call, nested ones included, through the parent's policy", async (t) => {
	const authority = { assignment: "Edit assigned.txt only.", instructions: [] };
	const proposals = [];
	const questions = [];
	const decisions = [];
	const child = await runtime(t, "explore", { contextual: { active: ["read", "codemode"] } }, (frame) => {
		if (frame.type === "policy" && frame.method === "authority") return { answer: JSON.stringify(authority) };
		if (frame.type === "policy" && frame.method === "classify") {
			proposals.push(frame.value);
			return {
				answer: JSON.stringify(
					frame.value.action.input.path === "assigned.txt"
						? ordinary
						: { ...ordinary, scope: "unknown", reason: "other.txt is not in the assignment." },
				),
			};
		}
		if (frame.type === "ask") {
			const question = JSON.parse(frame.question.slice(frame.question.indexOf("\n") + 1));
			questions.push(question);
			return {
				answer: JSON.stringify({
					ref: question.ref,
					kind: "deny",
					answer: "other.txt belongs to another task.",
				}),
			};
		}
		if (frame.type === "policy" && frame.method === "decision") {
			decisions.push(frame.value);
			return { answer: "null" };
		}
	});
	assert.deepEqual([...child.tools.keys()], ["bash", "ask_parent", "report_result", "checkpoint"]);
	assert.match(child.tools.get("ask_parent").description, /leaves the action held, not permitted/);
	assert.deepEqual(child.active(), ["read", "bash", "edit", "write", "codemode"]);
	await child.emit("context_with_system", {
		type: "context_with_system",
		messages: [{ role: "system", content: "You are a child.\n\nProject rules.", timestamp: 1 }],
	});
	assert.equal(
		await child.emit("tool_call", {
			type: "tool_call",
			toolCallId: "call-1",
			toolName: "write",
			input: { path: "assigned.txt", content: "A" },
		}),
		undefined,
	);
	assert.deepEqual(
		await child.emit("tool_call", {
			type: "tool_call",
			toolCallId: "script/1",
			parentToolCallId: "script",
			toolName: "write",
			input: { path: "other.txt", content: "B" },
		}),
		{ block: true, reason: "Action prohibited: other.txt belongs to another task." },
	);
	assert.deepEqual(proposals[0].authority, authority);
	assert.deepEqual(proposals[0].action, { tool: "write", input: { path: "assigned.txt", content: "A" }, cwd: child.cwd });
	assert.equal(proposals[0].context.systemPrompt, "You are a child.\n\nProject rules.");
	assert.deepEqual(questions.map((question) => [question.action.input.path, question.reason]), [
		["other.txt", "other.txt is not in the assignment."],
	]);
	assert.deepEqual(decisions.map((decision) => [decision.call, decision.kind]), [
		["call-1", "allow"],
		["script/1", "deny"],
	]);
	assert.deepEqual(child.entries.map((entry) => [entry.customType, entry.data.kind]), [
		["pi-workflow-authorization", "deny"],
	]);
});

test("a contextual child holds a call when the parent's policy cannot answer", async (t) => {
	const child = await runtime(t, "worker", { contextual: { active: [] } }, (frame) =>
		frame.type === "policy" ? { error: "The parent's policy is unavailable." } : undefined,
	);
	await child.emit("context_with_system", {
		type: "context_with_system",
		messages: [{ role: "system", content: "You are a child.", timestamp: 1 }],
	});
	const blocked = await child.emit("tool_call", {
		type: "tool_call",
		toolCallId: "call-1",
		toolName: "write",
		input: { path: "assigned.txt", content: "A" },
	});
	assert.equal(blocked.block, true);
	assert.match(blocked.reason, /^Authorization held; consultation required: .*The parent's policy is unavailable\./);
});

test("an operational child installs no contextual evaluation", async (t) => {
	const { handlers, tools } = await runtime(t, "worker");
	assert.equal(handlers.has("tool_call"), false);
	assert.equal(tools.has("checkpoint"), false);
});

test("consultation references remain strings for numeric question ids", async () => {
	const { consultation } = await import("../extensions/child-runtime.ts");
	const text = consultation({ id: "12345678-0000-0000-0000-000000000000", proposal: { action: {} }, reason: "reason", effects: "effects" });
	const summary = JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
	assert.equal(summary.ref, "q12345678");
});
