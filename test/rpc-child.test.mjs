import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { channelFrameLimit, createRpcChildSession, readinessDeadline } from "../extensions/rpc-child.ts";
import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildSessions, shutdownDeadline } from "../extensions/child-sessions.ts";
import { eventually } from "./support/eventually.mjs";

const fakePi = fileURLToPath(new URL("./support/fake-pi.mjs", import.meta.url));
const childRuntime = fileURLToPath(new URL("../extensions/child-runtime.ts", import.meta.url));

async function scratch(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-rpc-child-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

async function fakeChild(t, scenario, spec = {}, options = {}) {
	const dir = await scratch(t);
	const record = join(dir, "record.json");
	process.env.FAKE_PI_SCENARIO = scenario;
	process.env.FAKE_PI_RECORD = record;
	t.after(() => {
		delete process.env.FAKE_PI_SCENARIO;
		delete process.env.FAKE_PI_RECORD;
		delete process.env.FAKE_PI_DELIVER;
		delete process.env.FAKE_PI_WITHDRAW_MS;
		delete process.env.FAKE_PI_LINGER_MS;
		delete process.env.FAKE_PI_FRAME_BYTES;
	});
	const events = [];
	const notes = [];
	const create = createRpcChildSession({
		command: [process.execPath, fakePi],
		sessionRoot: join(dir, "sessions"),
		...options,
	});
	const handle = await create({
		cwd: dir,
		project: { cwd: dir, trusted: false },
		role: "explore",
		model: "fake/echo",
		thinking: "off",
		prompt: "You are a child.",
		tools: ["read", "grep", "codemode", "mcp__*", "bash", "ask_parent"],
		modelRegistry: {},
		shell: {},
		onEvent: (event) => events.push(event),
		notify: (message) => notes.push(message),
		ask: async () => "answer",
		report() {},
		checkpointed() {},
		...spec,
	});
	t.after(() => handle.dispose());
	const launched = () => JSON.parse(readFileSync(record, "utf8"));
	return { handle, events, notes, launched, record, dir };
}

test("a queued RPC child opens no process until it runs", async (t) => {
	const { handle, record } = await fakeChild(t, "complete");
	assert.equal(existsSync(record), false);
	await handle.dispose();
	assert.equal(existsSync(record), false);
});

test("an RPC child runs as its own Pi process in its worktree with the selected launch", async (t) => {
	const { handle, launched, dir } = await fakeChild(t, "complete");
	assert.equal(await handle.run("Say done."), "DONE");
	const { argv, cwd } = launched();
	assert.equal(cwd, dir);
	const value = (name) => argv[argv.indexOf(name) + 1];
	assert.equal(value("--mode"), "rpc");
	assert.equal(value("--session-dir"), join(dir, "sessions", handle.sessionId));
	assert.equal(value("--session-id"), handle.sessionId);
	assert.equal(value("--model"), "fake/echo");
	assert.equal(value("--thinking"), "off");
	assert.equal(value("--system-prompt"), "You are a child.");
	assert.equal(value("--tools"), "read,grep,codemode,mcp__*,bash,ask_parent");
	assert.deepEqual(
		argv.filter((arg) => arg === "--approve" || arg === "--no-approve"),
		["--no-approve"],
	);
	assert.ok(argv.includes("--no-extensions"));
	assert.deepEqual(
		argv.flatMap((arg, index) => (arg === "--extension" ? [argv[index + 1]] : [])),
		["builtin:mcp", "builtin:codemode", childRuntime],
	);
	assert.deepEqual(JSON.parse(value("--pi-workflow-child")), {
		role: "explore",
		cwd: dir,
		shell: {},
		checkpoint: false,
	});
	assert.deepEqual(handle.tools, ["read", "grep", "codemode", "mcp__*", "bash", "ask_parent"]);
});

test("an RPC child asks the parent over its channel and continues with the answer", async (t) => {
	const questions = [];
	const { handle } = await fakeChild(t, "ask", {
		ask: async (question) => {
			questions.push(question);
			return "README.md";
		},
	});
	assert.equal(await handle.run("Ask first."), "ANSWER README.md");
	assert.deepEqual(questions, ["Which file?"]);
});

test("a consultation the parent cannot answer reaches the child as an error", async (t) => {
	const { handle } = await fakeChild(t, "ask", {
		ask: async () => {
			throw new Error("A question is already waiting for the parent's reply.");
		},
	});
	assert.equal(
		await handle.run("Ask first."),
		"ERROR A question is already waiting for the parent's reply.",
	);
});

test("a question the child withdraws aborts the parent's wait", async (t) => {
	const signals = [];
	const { handle } = await fakeChild(t, "withdraw", {
		ask: (_question, signal) => {
			signals.push(signal);
			return new Promise(() => {});
		},
	});
	assert.equal(await handle.run("Ask first."), "DONE");
	assert.equal(signals.length, 1);
	assert.equal(signals[0].aborted, true);
});

test("a late answer to a question the child withdrew is refused", async (t) => {
	const dir = await scratch(t);
	process.env.FAKE_PI_SCENARIO = "withdraw";
	process.env.FAKE_PI_WITHDRAW_MS = "50";
	process.env.FAKE_PI_LINGER_MS = "300";
	t.after(() => {
		delete process.env.FAKE_PI_SCENARIO;
		delete process.env.FAKE_PI_WITHDRAW_MS;
		delete process.env.FAKE_PI_LINGER_MS;
	});
	const core = createChildSessions({
		create: createRpcChildSession({ command: [process.execPath, fakePi], sessionRoot: join(dir, "sessions") }),
		send() {},
		idle: () => false,
		trace() {},
		report() {},
		audit: createChildAudit({ root: "", parent: () => undefined }),
	});
	t.after(() => core.disposeAll());
	const { id } = await core.start(
		{ role: "explore", contract: { prompt: "You are a child.", tools: [] }, task: "Ask.", worktree: dir, model: "fake/echo", thinking: "off", chosenBy: "parent", references: [] },
		{ background: true, modelRegistry: {}, project: () => ({ cwd: dir, trusted: false }), shell: () => ({}) },
	);
	await eventually(() => core.get(id), (child) => child?.state === "waiting");
	await eventually(() => core.get(id), (child) => child?.state === "running");
	assert.throws(
		() => core.reply(id, 1, "late", "parent"),
		/Question 1 of child .* was withdrawn: the call that asked it ended/,
	);
	await eventually(() => core.get(id), (child) => child?.state === "completed");
});

test("a child that disconnects withdraws its open question", async (t) => {
	const signals = [];
	const { handle } = await fakeChild(t, "ask", {
		ask: (_question, signal) => {
			signals.push(signal);
			return new Promise(() => {});
		},
	});
	const run = handle.run("Ask first.");
	run.catch(() => {});
	while (signals.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(signals[0].aborted, false);
	await handle.dispose();
	assert.equal(signals[0].aborted, true);
	await assert.rejects(run, /exited/);
});

test("a child's structured report reaches the parent apart from its final answer", async (t) => {
	const reports = [];
	const { handle } = await fakeChild(t, "report", {
		role: "worker",
		report: (result) => reports.push(result),
	});
	assert.equal(await handle.run("Work."), "DONE");
	assert.deepEqual(reports, [
		{ verdict: "done", files_changed: ["a.ts: added"], validation: [], left_undone: [] },
	]);
});

test("an oversized channel frame fails the child", async (t) => {
	assert.equal(channelFrameLimit, 1024 * 1024);
	process.env.FAKE_PI_FRAME_BYTES = String(channelFrameLimit + 1);
	const { handle } = await fakeChild(t, "oversize");
	await assert.rejects(handle.run("Say done."), /channel frame over 1048576 bytes/);
});

test("readiness waits for the child runtime to connect its channel", async (t) => {
	const { handle } = await fakeChild(t, "no-runtime", {}, {
		schedule(run, ms) {
			if (ms === readinessDeadline) setTimeout(run, 200);
			return () => {};
		},
	});
	await assert.rejects(handle.run("Say done."), /did not become ready within 10000 ms/);
});

test("a trusted parent launches its RPC child with exactly --approve", async (t) => {
	const { handle, launched, dir } = await fakeChild(t, "complete", {
		project: { cwd: "/elsewhere", trusted: true },
	});
	await handle.run("Say done.");
	const { argv } = launched();
	assert.deepEqual(
		argv.filter((arg) => arg === "--approve" || arg === "--no-approve"),
		["--approve"],
	);
	assert.equal(launched().cwd, dir);
});

test("RPC events reach onEvent in the SDK shape with one cumulative assistant message", async (t) => {
	const { handle, events } = await fakeChild(t, "complete");
	await handle.run("Say done.");
	const assistant = events.filter(
		(event) =>
			event.type.startsWith("message_") && event.message?.role === "assistant",
	);
	assert.deepEqual(
		assistant.map((event) => event.type),
		["message_start", "message_update", "message_update", "message_update", "message_update", "message_end"],
	);
	assert.ok(assistant.every((event) => event.message === assistant[0].message));
	assert.deepEqual(assistant[0].message.content, [{ type: "text", text: "DONE" }]);
	assert.equal(assistant[0].message.stopReason, "stop");
	assert.equal(events.at(-1).type, "agent_settled");
	assert.deepEqual(
		handle.entries().filter((entry) => entry.type === "message").map((entry) => entry.message.role),
		["user", "assistant"],
	);
});

test("the transcript entries are current when an RPC message ends", async (t) => {
	const { handle, events } = await fakeChild(t, "complete", {
		onEvent(event) {
			events.push({ type: event.type, entries: handle.entries().length });
		},
	});
	await handle.run("Say done.");
	const counts = events
		.filter((event) => event.type === "message_end")
		.map((event) => event.entries);
	assert.equal(counts.length, 2);
	assert.ok(counts[0] >= 1);
	assert.equal(counts[1], 2);
});

test("an RPC child run fails on an error stop reason, an aborted settle and a handled prompt", async (t) => {
	for (const [scenario, message] of [
		["error", /provider failed/],
		["abort-settles", /aborted/],
		["handled", /started no run/],
	]) {
		await t.test(scenario, async (t) => {
			const { handle } = await fakeChild(t, scenario);
			await assert.rejects(handle.run("Say done."), message);
		});
	}
});

test("an RPC child that dies after launch fails its run with the exit", async (t) => {
	const { handle } = await fakeChild(t, "crash");
	await assert.rejects(handle.run("Say done."), /exited with code 7/);
});

test("an RPC child that cannot start fails its run with its diagnostics", async (t) => {
	const { handle } = await fakeChild(t, "refuse");
	await assert.rejects(handle.run("Say done."), /exited with code 3.*fake pi refused to start/s);
});

test("readiness is a correlated state reply within the readiness deadline", async (t) => {
	assert.equal(readinessDeadline, 10_000);
	const scheduled = [];
	const { handle } = await fakeChild(t, "silent", {}, {
		schedule(run, ms) {
			scheduled.push(ms);
			if (ms === readinessDeadline) setImmediate(run);
			return () => {};
		},
	});
	await assert.rejects(
		handle.run("Say done."),
		/did not become ready within 10000 ms/,
	);
	assert.ok(scheduled.includes(readinessDeadline));
});

test("readiness refuses a Pi process running another session or model", async (t) => {
	for (const [scenario, message] of [
		["other-session", /session other instead of/],
		["other-model", /fake\/other at off instead of the selected fake\/echo at off/],
	]) {
		await t.test(scenario, async (t) => {
			const { handle } = await fakeChild(t, scenario);
			await assert.rejects(handle.run("Say done."), message);
		});
	}
});

test("an RPC child steers, reports undelivered steering and aborts", async (t) => {
	const { handle, events } = await fakeChild(t, "steer");
	const run = handle.run("Wait.");
	while (!events.some((event) => event.type === "message_end")) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	await handle.steer("Check the tests.");
	assert.deepEqual(handle.clearQueue(), ["Check the tests."]);
	await handle.abort();
	await assert.rejects(run, /aborted/);
});

test("disposing an RPC child kills a process that ignores shutdown after the deadline", async (t) => {
	const waits = [];
	const { handle, launched } = await fakeChild(t, "linger", {}, {
		schedule(run, ms) {
			waits.push(ms);
			const timer = setTimeout(run, ms === shutdownDeadline ? 10 : ms);
			return () => clearTimeout(timer);
		},
	});
	await handle.run("Say done.");
	const { pid } = launched();
	await handle.dispose();
	assert.ok(waits.includes(shutdownDeadline));
	assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("an RPC child refuses contextual authorization instead of dropping it", async (t) => {
	await assert.rejects(
		fakeChild(t, "complete", { authorization: {} }),
		/Contextual authorization is not available to RPC children/,
	);
});

test("an RPC child refuses construction when Pi is not installed", async (t) => {
	const previous = process.env.PATH;
	process.env.PATH = await scratch(t);
	t.after(() => {
		process.env.PATH = previous;
	});
	const create = createRpcChildSession();
	await assert.rejects(
		create({ cwd: "/tmp", project: { cwd: "/tmp", trusted: false }, model: "fake/echo", thinking: "off", tools: [], prompt: "" }),
		/Pi was not found on PATH/,
	);
});
