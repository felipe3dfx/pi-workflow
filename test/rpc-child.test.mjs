import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createRpcChildSession, readinessDeadline } from "../extensions/rpc-child.ts";
import { shutdownDeadline } from "../extensions/child-sessions.ts";

const fakePi = fileURLToPath(new URL("./support/fake-pi.mjs", import.meta.url));

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
	assert.equal(value("--tools"), "read,grep,codemode,mcp__*,ask_parent");
	assert.deepEqual(
		argv.filter((arg) => arg === "--approve" || arg === "--no-approve"),
		["--no-approve"],
	);
	assert.ok(argv.includes("--no-extensions"));
	assert.deepEqual(
		argv.flatMap((arg, index) => (arg === "--extension" ? [argv[index + 1]] : [])),
		["builtin:mcp", "builtin:codemode"],
	);
	assert.deepEqual(handle.tools, ["read", "grep", "codemode", "mcp__*", "ask_parent"]);
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
