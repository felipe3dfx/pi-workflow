import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createPiChildSession } from "../extensions/child-sessions.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-workflow-codemode-agent-"));

function worktree(t) {
	const dir = mkdtempSync(join(tmpdir(), "pi-workflow-codemode-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	for (const name of ["a", "b", "c"]) {
		writeFileSync(join(dir, `${name}.txt`), `${name} one\n${name} two\n`);
	}
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync(
		"git",
		["-c", "user.name=Child", "-c", "user.email=child@example.com", "commit", "-qm", "first"],
		{ cwd: dir },
	);
	return dir;
}

async function child(t, role, tools, code) {
	const dir = worktree(t);
	const runtime = await ModelRuntime.create({
		authPath: join(dir, ".git", "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "faux", models: [{ id: "faux" }] });
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey("faux", "key");
	const requests = [];
	faux.setResponses([
		(context) => {
			requests.push(context);
			return fauxAssistantMessage(fauxToolCall("codemode", { code }, { id: "script" }), {
				stopReason: "toolUse",
			});
		},
		(context) => {
			requests.push(context);
			return fauxAssistantMessage(fauxText("finished"));
		},
	]);
	const events = [];
	const handle = await createPiChildSession({
		cwd: dir,
		project: { cwd: dir, trusted: false },
		role,
		model: "faux/faux",
		thinking: "off",
		prompt: "You are a child session.",
		tools,
		modelRegistry: new ModelRegistry(runtime),
		shell: {},
		onEvent: (event) => events.push(event),
		notify: () => {},
		ask: async () => "answer",
		report: () => {},
	});
	t.after(() => handle.dispose());
	return { dir, handle, events, requests };
}

function scriptResult(requests) {
	const result = requests[1].messages.find(
		(message) => message.role === "toolResult" && message.toolCallId === "script",
	);
	return result.content.map((part) => part.text ?? "").join("");
}

const workerTools = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"codemode",
	"ask_parent",
	"report_result",
];

test("a worker's codemode script reads in parallel, edits one file in order, and meets the child bash guard", async (t) => {
	const { dir, handle, events, requests } = await child(
		t,
		"worker",
		workerTools,
		[
			'const reads = await Promise.all(["a.txt", "b.txt", "c.txt"].map((path) => tools.read({ path })));',
			'await Promise.all([tools.edit({ path: "a.txt", edits: [{ oldText: "a one", newText: "a uno" }] }), tools.edit({ path: "a.txt", edits: [{ oldText: "a two", newText: "a dos" }] })]);',
			'const commit = await tools.bash({ command: "git commit -am change" });',
			'return { reads: reads.length, commit, models: typeof models };',
		].join("\n"),
	);

	assert.ok(handle.tools.includes("codemode"));
	assert.equal(await handle.run("Compose the reads."), "finished");

	const output = scriptResult(requests);
	assert.match(output, /Script completed/);
	assert.match(output, /"reads":3/);
	assert.match(output, /"models":"undefined"/);
	assert.match(output, /"exit_code":126/);
	assert.match(output, /`git commit` is reserved for the parent/);
	assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "a uno\na dos\n");
	assert.equal(
		execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(),
		"1",
	);

	const nested = events.filter(
		(event) =>
			(event.type === "tool_execution_start" || event.type === "tool_execution_end") &&
			event.toolCallId !== "script",
	);
	assert.ok(nested.length > 0);
	for (const event of nested) {
		assert.equal(event.parentToolCallId, "script");
		assert.match(event.toolCallId, /^script\/\d+$/);
	}
	const reads = nested.filter((event) => event.toolName === "read");
	const firstEnd = reads.findIndex((event) => event.type === "tool_execution_end");
	assert.equal(
		reads.slice(0, firstEnd).filter((event) => event.type === "tool_execution_start").length,
		3,
	);

	const recorded = handle
		.entries()
		.find((entry) => entry.type === "message" && entry.message.toolCallId === "script")
		.message.nestedCalls.calls;
	assert.deepEqual(
		recorded.map((call) => [call.id.startsWith("script/"), call.name, call.status]),
		[
			[true, "read", "ok"],
			[true, "read", "ok"],
			[true, "read", "ok"],
			[true, "edit", "ok"],
			[true, "edit", "ok"],
			[true, "bash", "error"],
		],
	);
});

test("a child's codemode offers no models API and calls only the child's allowlisted tools", async (t) => {
	const { handle, requests } = await child(
		t,
		"explore",
		["read", "grep", "find", "ls", "codemode", "ask_parent"],
		'return { tools: Object.keys(tools).sort(), models: typeof models };',
	);

	await handle.run("List the tools.");

	const output = scriptResult(requests);
	assert.match(output, /"models":"undefined"/);
	assert.match(output, /"tools":\["ask_parent","find","grep","ls","read"\]/);
	const declarations = JSON.stringify(requests[0].messages);
	assert.match(declarations, /Run JavaScript that calls other tools/);
	assert.doesNotMatch(declarations, /`models`/);
});
