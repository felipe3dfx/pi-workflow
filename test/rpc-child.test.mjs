import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { delimiter, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
	channelFrameLimit,
	createRpcChildSession,
	installedPi,
	pruneChildSessions,
	readinessDeadline,
} from "../extensions/rpc-child.ts";
import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildSessions } from "../extensions/child-sessions.ts";
import { shutdownDeadline } from "../extensions/child-handle.ts";
import { treeDeadline } from "../extensions/process-tree.ts";
import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { alive, descendants, gone, parent } from "./support/process-tree.mjs";
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
		delete process.env.FAKE_PI_LACKS;
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
		role: "worker",
		model: "fake/echo",
		thinking: "off",
		prompt: "You are a child.",
		tools: ["read", "grep", "codemode", "mcp__*", "bash", "ask_parent"],
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

test("a child runs the parent's own Pi executable when the parent is Pi", (t) => {
	const parentPi = "/opt/pi/1.4.0/pi";
	const execPath = process.execPath;
	process.execPath = parentPi;
	t.after(() => {
		process.execPath = execPath;
	});
	assert.equal(installedPi(), parentPi);
});

test("a child of a parent that is not Pi runs the installed Pi from PATH, never a package's node_modules/.bin", async (t) => {
	const dir = await scratch(t);
	const packageBin = join(dir, "node_modules", ".bin");
	const installed = join(dir, "installed");
	for (const directory of [packageBin, installed]) {
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "pi"), "#!/bin/sh\n");
		await chmod(join(directory, "pi"), 0o755);
	}
	const path = process.env.PATH;
	process.env.PATH = [packageBin, installed].join(delimiter);
	t.after(() => {
		process.env.PATH = path;
	});
	assert.equal(installedPi(), join(installed, "pi"));
	process.env.PATH = packageBin;
	assert.throws(() => installedPi(), /Pi was not found on PATH/);
});

async function piOnPath(t, version) {
	const dir = await scratch(t);
	const checks = join(dir, "version-checks");
	await writeFile(
		join(dir, "pi"),
		`#!/bin/sh\nif [ "$1" = "--version" ]; then echo >> "${checks}"; echo "${version}"; exit 0; fi\nexec "${process.execPath}" "${fakePi}" "$@"\n`,
	);
	await chmod(join(dir, "pi"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = [dir, path].join(delimiter);
	t.after(() => {
		process.env.PATH = path;
	});
	return { pi: join(dir, "pi"), checks: () => (existsSync(checks) ? readFileSync(checks, "utf8").length : 0) };
}

test("a child refuses a Pi on PATH whose version differs from the parent's, naming both", async (t) => {
	const { pi } = await piOnPath(t, "0.9.0");
	await assert.rejects(
		fakeChild(t, "complete", {}, { command: undefined }),
		{ message: `The Pi on PATH at ${pi} is version 0.9.0, but the parent runs Pi ${VERSION}; a child must run the parent's Pi version.` },
	);
});

test("a factory checks the version of the Pi on PATH once, and its readiness timeout names the executable and version", async (t) => {
	const { pi, checks } = await piOnPath(t, VERSION);
	const options = {
		command: undefined,
		schedule(run, ms) {
			if (ms === readinessDeadline) setImmediate(run);
			return () => {};
		},
	};
	const create = createRpcChildSession({ ...options, sessionRoot: join(await scratch(t), "sessions") });
	const spec = {
		cwd: tmpdir(),
		project: { cwd: tmpdir(), trusted: false },
		role: "worker",
		model: "fake/echo",
		thinking: "off",
		prompt: "",
		tools: [],
		shell: {},
		onEvent() {},
		notify() {},
		ask: async () => "",
		report() {},
		checkpointed() {},
	};
	process.env.FAKE_PI_SCENARIO = "silent";
	t.after(() => {
		delete process.env.FAKE_PI_SCENARIO;
	});
	const first = await create(spec);
	const second = await create(spec);
	t.after(() => Promise.all([first.dispose(), second.dispose()]));
	assert.equal(checks(), 1);
	await assert.rejects(first.run("Say done."), {
		message: `The child Pi process ${pi} (Pi ${VERSION}) did not become ready within ${readinessDeadline} ms.`,
	});
});

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
		["builtin:mcp", childRuntime],
	);
	assert.deepEqual(JSON.parse(value("--pi-workflow-child")), {
		role: "worker",
		cwd: dir,
		shell: {},
		codegraph: false,
	});
});

test("an RPC child gets codegraph when the parent has CodeGraph seated", async (t) => {
	const seated = Object.fromEntries(capabilities.map((capability) => [capability, false]));
	replaceSelection({ schemaVersion: 1, capabilities: { ...seated, codegraph: true }, expectations: {} });
	t.after(() => replaceSelection({ schemaVersion: 1, capabilities: seated, expectations: {} }));
	const { handle, launched } = await fakeChild(t, "complete");
	await handle.run("Say done.");
	const { argv } = launched();
	assert.equal(JSON.parse(argv[argv.indexOf("--pi-workflow-child") + 1]).codegraph, true);
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
		{ role: "worker", contract: { prompt: "You are a child.", tools: [] }, task: "Ask.", worktree: dir, model: "fake/echo", thinking: "off", chosenBy: "parent", references: [] },
		{ background: true, project: () => ({ cwd: dir, trusted: false }), shell: () => ({}) },
	);
	await eventually(() => core.get(id), (child) => child?.state === "waiting");
	await eventually(() => core.get(id), (child) => child?.state === "running");
	assert.throws(
		() => core.reply(id, 1, "late", "parent"),
		/Question 1 of child .* was withdrawn: the call that asked it ended/,
	);
	await eventually(() => core.get(id), (child) => child?.state === "completed");
});

test("a child's session directory outlives the child for continue_child and is removed when the parent ends its children", async (t) => {
	const dir = await scratch(t);
	const sessions = join(dir, "sessions");
	process.env.FAKE_PI_SCENARIO = "complete";
	t.after(() => {
		delete process.env.FAKE_PI_SCENARIO;
	});
	const core = createChildSessions({
		create: createRpcChildSession({ command: [process.execPath, fakePi], sessionRoot: sessions }),
		send() {},
		idle: () => false,
		trace() {},
		report() {},
		audit: createChildAudit({ root: "", parent: () => undefined }),
	});
	const { id } = await core.start(
		{ role: "worker", contract: { prompt: "You are a child.", tools: [] }, task: "Say done.", worktree: dir, model: "fake/echo", thinking: "off", chosenBy: "parent", references: [] },
		{ background: true, project: () => ({ cwd: dir, trusted: false }), shell: () => ({}) },
	);
	await eventually(() => core.get(id), (child) => child?.state === "completed");
	assert.equal(readdirSync(sessions).length, 1);
	await core.disposeAll();
	assert.deepEqual(readdirSync(sessions), []);
});

test("pruning removes the child session directories of parents that are gone and keeps those of live parents", async (t) => {
	const agentDir = await scratch(t);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	const root = join(agentDir, "pi-workflow-children");
	const gone = String(childProcess.spawnSync(process.execPath, ["-e", ""]).pid);
	const kept = [String(process.pid), String(process.ppid)];
	for (const name of [...kept, gone, "6f1c2b8e-legacy"]) await mkdir(join(root, name, "child"), { recursive: true });
	await pruneChildSessions();
	assert.deepEqual(readdirSync(root).sort(), kept.sort());
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

function spawned(t) {
	const processes = [];
	const spawn = childProcess.spawn;
	childProcess.spawn = (...args) => {
		const child = spawn(...args);
		processes.push(child);
		return child;
	};
	syncBuiltinESMExports();
	t.after(() => {
		childProcess.spawn = spawn;
		syncBuiltinESMExports();
	});
	return processes;
}

test("an error on the child's output streams fails the child, not the parent", async (t) => {
	for (const stream of ["stdout", "stderr"]) {
		await t.test(stream, async (t) => {
			const processes = spawned(t);
			let asked = false;
			const { handle } = await fakeChild(t, "ask", {
				ask: () => {
					asked = true;
					return new Promise(() => {});
				},
			});
			const run = handle.run("Ask first.");
			run.catch(() => {});
			await eventually(() => asked, Boolean);
			const pi = processes.find((child) => child.spawnargs.includes("--mode"));
			pi[stream].emit("error", new Error("read EIO"));
			await assert.rejects(run, /read EIO/);
		});
	}
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

test("an RPC child fetches its transcript when it is read and when its run ends, not on every message", async (t) => {
	const commands = join(await scratch(t), "commands");
	process.env.FAKE_PI_COMMANDS = commands;
	t.after(() => {
		delete process.env.FAKE_PI_COMMANDS;
	});
	const fetches = () => readFileSync(commands, "utf8").split("\n").filter((type) => type === "get_entries").length;
	const roles = (handle) => handle.entries().filter((entry) => entry.type === "message").map((entry) => entry.message.role);

	const complete = await fakeChild(t, "complete");
	await complete.handle.run("Say done.");
	assert.equal(fetches(), 1);
	assert.deepEqual(roles(complete.handle), ["user", "assistant"]);
	assert.equal(fetches(), 1);

	const steering = await fakeChild(t, "steer");
	const run = steering.handle.run("Wait.");
	await eventually(() => steering.events.some((event) => event.type === "message_end"), Boolean);
	assert.deepEqual(roles(steering.handle), []);
	await eventually(() => roles(steering.handle), (read) => read.length === 1);
	await steering.handle.abort();
	await assert.rejects(run, /aborted/);
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

test("an RPC child whose executable is missing fails its run with the spawn error", async (t) => {
	const { handle } = await fakeChild(t, "complete", {}, { command: [join(tmpdir(), "pi-workflow-missing-pi")] });
	await assert.rejects(handle.run("Say done."), /ENOENT/);
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

test("readiness refuses a child that lacks a contract tool, except codegraph while CodeGraph is unseated", async (t) => {
	process.env.FAKE_PI_LACKS = "bash";
	const lacking = await fakeChild(t, "complete");
	await assert.rejects(lacking.handle.run("Say done."), /lacks the contract tools bash\./);
	process.env.FAKE_PI_LACKS = "codegraph";
	const unseated = await fakeChild(t, "complete", { role: "explore", tools: ["read", "codegraph", "ask_parent"] });
	assert.equal(await unseated.handle.run("Say done."), "DONE");
	const capabilityOff = Object.fromEntries(capabilities.map((capability) => [capability, false]));
	replaceSelection({ schemaVersion: 1, capabilities: { ...capabilityOff, codegraph: true }, expectations: {} });
	t.after(() => replaceSelection({ schemaVersion: 1, capabilities: capabilityOff, expectations: {} }));
	const seated = await fakeChild(t, "complete", { role: "explore", tools: ["read", "codegraph", "ask_parent"] });
	await assert.rejects(seated.handle.run("Say done."), /lacks the contract tools codegraph\./);
});

test("an RPC child whose transcript cannot be read fails its run", async (t) => {
	const { handle } = await fakeChild(t, "entries-fail");
	await assert.rejects(handle.run("Say done."), /entries unavailable/);
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

test("cancelling an RPC child asks it to abort, then kills its whole process tree after the shutdown deadline", async (t) => {
	assert.equal(shutdownDeadline, 1_000);
	const waits = [];
	const tree = await descendants(t);
	const commands = join(await scratch(t), "commands");
	process.env.FAKE_PI_COMMANDS = commands;
	t.after(() => {
		delete process.env.FAKE_PI_COMMANDS;
	});
	const { handle, launched } = await fakeChild(t, "linger", {}, {
		schedule(run, ms) {
			waits.push(ms);
			const timer = setTimeout(run, ms === shutdownDeadline ? 10 : ms);
			return () => clearTimeout(timer);
		},
	});
	await handle.run("Say done.");
	const pids = [launched().pid, ...(await tree())];
	await handle.dispose();
	assert.ok(waits.includes(shutdownDeadline));
	assert.ok(readFileSync(commands, "utf8").split("\n").includes("abort"));
	assert.deepEqual(pids.filter(alive), []);
});

test("every child end sweeps the child's process tree exactly once", async (t) => {
	const sweeps = (processes) =>
		processes.filter(
			(child) => child.spawnargs.some((arg) => arg.endsWith("process-tree.sh")) && !child.spawnargs.includes("watch"),
		).length;
	await t.test("clean exit", async (t) => {
		const processes = spawned(t);
		const { handle } = await fakeChild(t, "complete");
		await handle.run("Say done.");
		await handle.dispose();
		assert.equal(sweeps(processes), 1);
	});
	await t.test("crash", async (t) => {
		const processes = spawned(t);
		const { handle } = await fakeChild(t, "crash");
		await assert.rejects(handle.run("Say done."), /exited with code 7/);
		await handle.dispose();
		assert.equal(sweeps(processes), 1);
	});
	await t.test("past the shutdown deadline", async (t) => {
		const processes = spawned(t);
		const { handle } = await fakeChild(t, "linger", {}, {
			schedule(run, ms) {
				const timer = setTimeout(run, ms === shutdownDeadline ? 10 : ms);
				return () => clearTimeout(timer);
			},
		});
		await handle.run("Say done.");
		await handle.dispose();
		assert.equal(sweeps(processes), 1);
	});
});

test("an RPC child that crashes leaves no descendant within the tree deadline", async (t) => {
	assert.equal(treeDeadline, 2_000);
	const tree = await descendants(t);
	const { handle } = await fakeChild(t, "crash");
	const run = assert.rejects(handle.run("Say done."), /exited with code 7/);
	const pids = await tree();
	await run;
	const crashed = Date.now();
	await eventually(() => pids.filter(alive), (left) => left.length === 0);
	assert.ok(Date.now() - crashed < treeDeadline);
});

test("a parent that exits or is killed leaves no RPC child or descendant within the tree deadline", async (t) => {
	for (const ending of ["shutdown", "SIGKILL"]) {
		await t.test(ending, async (t) => {
			const tree = await descendants(t);
			const dir = await scratch(t);
			const record = join(dir, "record.json");
			process.env.FAKE_PI_SCENARIO = "linger";
			process.env.FAKE_PI_RECORD = record;
			t.after(() => {
				delete process.env.FAKE_PI_SCENARIO;
				delete process.env.FAKE_PI_RECORD;
			});
			const started = await parent(t, {
				command: [process.execPath, fakePi],
				sessionRoot: join(dir, "sessions"),
				cwd: dir,
				model: "fake/echo",
				ending,
			});
			assert.equal(started.answer, "DONE");
			const pids = [JSON.parse(readFileSync(record, "utf8")).pid, ...(await tree())];
			started.end();
			const elapsed = await gone(pids, await started.exited);
			assert.ok(elapsed < treeDeadline, `cleanup took ${elapsed} ms`);
			t.diagnostic(`no child process remains ${elapsed} ms after the parent ${ending === "SIGKILL" ? "was killed" : "exited"}`);
		});
	}
});

test("a contextual RPC child loads the common tool sources by path with no tool allowlist", async (t) => {
	const { handle, launched, dir } = await fakeChild(t, "complete", {
		role: "explore",
		authorization: { authority: () => ({}), classify: async () => ({}) },
		sources: { paths: ["tools/selected.ts"] },
	});
	await handle.run("Say done.");
	const { argv } = launched();
	assert.equal(argv.includes("--tools"), false);
	assert.deepEqual(
		argv.flatMap((arg, index) => (arg === "--extension" ? [argv[index + 1]] : [])),
		["builtin:mcp", "builtin:tool-search", join(dir, "tools/selected.ts"), childRuntime],
	);
	assert.deepEqual(JSON.parse(argv[argv.indexOf("--pi-workflow-child") + 1]).contextual, {
		active: ["read", "bash", "edit", "write", "grep", "find", "ls", "codemode", "tool_search"],
	});
});

test("an RPC child refuses common tool factories, which cannot load in its process", async (t) => {
	await assert.rejects(
		fakeChild(t, "complete", {
			authorization: { authority: () => ({}), classify: async () => ({}) },
			sources: { factories: [() => {}] },
		}),
		/Common tool factories cannot load in a child process; select the common tool sources by path\./,
	);
});

test("the parent's contextual policy answers its RPC child and held decisions stay pending", async (t) => {
	const calls = [];
	const { handle, dir } = await fakeChild(t, "policy", {
		authorization: {
			authority: (ctx) => {
				calls.push(["authority", ctx.cwd, ctx.signal instanceof AbortSignal]);
				return { assignment: "Edit assigned.txt", instructions: [] };
			},
			classify: async (proposal, signal) => {
				calls.push(["classify", proposal, signal instanceof AbortSignal]);
				return { reason: "unknown" };
			},
			onDecision: (decision) => {
				calls.push(["decision", decision]);
			},
		},
	});
	const decision = { kind: "held", reason: "The scope is unknown.", call: "call-1" };
	assert.deepEqual(JSON.parse(await handle.run("Act.")), [
		{ id: 1, answer: JSON.stringify({ assignment: "Edit assigned.txt", instructions: [] }) },
		{ id: 2, answer: JSON.stringify({ reason: "unknown" }) },
		{ id: 3, answer: "null" },
	]);
	assert.deepEqual(calls, [
		["authority", dir, true],
		["classify", { action: { tool: "write" } }, true],
		["decision", decision],
	]);
	assert.deepEqual(handle.pendingAuthorizations(), [decision]);
});

test("an operational RPC child gets no answer from a contextual policy", async (t) => {
	const { handle } = await fakeChild(t, "policy");
	const replies = JSON.parse(await handle.run("Act."));
	assert.deepEqual(replies[0], { id: 1, error: "This child has no contextual authorization." });
});

test("a checkpoint the RPC child commits is recorded by the parent", async (t) => {
	const recorded = [];
	const { handle } = await fakeChild(t, "checkpoint", { checkpointed: (checkpoint) => recorded.push(checkpoint) });
	assert.equal(await handle.run("Commit."), "DONE");
	assert.deepEqual(recorded, [{ sha: "c0ffee", parent: "base", base: "base", branch: "feature" }]);
});

test("a granted RPC worker receives its checkpoint grant", async (t) => {
	const grant = { branch: "feature", root: "/repo", gitDir: "/repo/.git", commonDir: "/repo/.git", base: "base" };
	const { handle, launched } = await fakeChild(t, "complete", { checkpoint: grant });
	await handle.run("Say done.");
	const { argv } = launched();
	assert.deepEqual(JSON.parse(argv[argv.indexOf("--pi-workflow-child") + 1]).checkpoint, grant);
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

async function agentWith(t, packages) {
	const agentDir = await scratch(t);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	const modules = join(agentDir, "npm", "node_modules");
	for (const [name, manifest] of Object.entries(packages)) {
		await mkdir(join(modules, name, "src"), { recursive: true });
		await writeFile(join(modules, name, "package.json"), JSON.stringify({ name, ...manifest }));
		if (manifest.pi) await writeFile(join(modules, name, "src", "index.ts"), "export default () => {};\n");
	}
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({ packages: Object.keys(packages).map((name) => `npm:${name}`) }),
	);
	return { modules };
}

const bridgeManifest = {
	version: "0.9.3",
	repository: { type: "git", url: "git+https://github.com/elidickinson/pi-claude-bridge.git" },
	pi: { extensions: ["./src/index.ts"] },
};
const extensionsOf = (argv) =>
	argv.flatMap((arg, index) => (arg === "--extension" ? [argv[index + 1]] : []));

test("an explorer RPC child receives the pi-web-access extension and other roles do not", async (t) => {
	const { modules } = await agentWith(t, { "pi-web-access": { pi: { extensions: ["./src/index.ts"] } } });
	const explorer = await fakeChild(t, "complete", { role: "explore" });
	await explorer.handle.run("Say done.");
	assert.deepEqual(extensionsOf(explorer.launched().argv).slice(1), [
		join(modules, "pi-web-access", "src", "index.ts"),
		childRuntime,
	]);
	const worker = await fakeChild(t, "complete");
	await worker.handle.run("Say done.");
	assert.deepEqual(extensionsOf(worker.launched().argv), ["builtin:mcp", childRuntime]);
});

test("a Claude Bridge RPC child receives the official provider extension and a native model child does not", async (t) => {
	const { modules } = await agentWith(t, { "pi-claude-bridge": bridgeManifest });
	const bridge = await fakeChild(t, "complete", { role: "worker", model: "claude-bridge/claude-haiku-4-5" });
	await bridge.handle.run("Say done.");
	assert.deepEqual(extensionsOf(bridge.launched().argv).slice(1), [
		await realpath(join(modules, "pi-claude-bridge", "src", "index.ts")),
		childRuntime,
	]);
	const native = await fakeChild(t, "complete");
	await native.handle.run("Say done.");
	assert.deepEqual(extensionsOf(native.launched().argv), ["builtin:mcp", childRuntime]);
});

test("a missing pi-web-access or Claude Bridge package fails the launch with its cause", async (t) => {
	await agentWith(t, {});
	await assert.rejects(fakeChild(t, "complete", { role: "explore" }), /pi-web-access is not installed locally, so the explorer has no web tools/);
	await assert.rejects(
		fakeChild(t, "complete", { role: "worker", model: "claude-bridge/claude-haiku-4-5" }),
		/official pi-claude-bridge package is not installed and configured/,
	);
});

test("a pi-web-access package without an extension fails the launch with its cause", async (t) => {
	await agentWith(t, { "pi-web-access": {} });
	await assert.rejects(fakeChild(t, "complete", { role: "explore" }), /pi-web-access could not be loaded, so the explorer has no web tools/);
});
