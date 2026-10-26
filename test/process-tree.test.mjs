import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createChildBashTool, createConfiguredBashTool } from "../extensions/child-bash.ts";
import { eventually } from "./support/eventually.mjs";
import { alive, gone } from "./support/process-tree.mjs";

const script = fileURLToPath(new URL("../extensions/process-tree.sh", import.meta.url));
const hidden = { PATH: process.env.PATH };

async function scratch(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-sweep-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

async function sweepWithoutProc(t) {
	const dir = await scratch(t);
	const sweep = join(dir, "process-tree.sh");
	await writeFile(sweep, readFileSync(script, "utf8").replaceAll("/proc/self/environ", join(dir, "no-proc")));
	const bin = join(dir, "bin");
	await mkdir(bin);
	if (process.platform === "linux") {
		const ps = execFileSync("/bin/sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
		await writeFile(
			join(bin, "ps"),
			`#!/bin/sh\nfor arg; do shift; if [ "$arg" = -E ]; then set -- "$@" e; else set -- "$@" "$arg"; fi; done\nexec ${ps} "$@"\n`,
		);
		await chmod(join(bin, "ps"), 0o755);
	}
	return { sweep, path: `${bin}${delimiter}${process.env.PATH}` };
}

async function groupsOf(t, id) {
	const groups = await scratch(t);
	await mkdir(join(groups, id));
	return groups;
}

function startTime(pid) {
	return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
}

function lingering(t, env = hidden) {
	const member = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, env, stdio: "ignore" });
	t.after(() => member.kill("SIGKILL"));
	return member;
}

async function sweepOf(sweep, args, path = process.env.PATH) {
	const started = Date.now();
	const swept = spawn("/bin/sh", [sweep, ...args], { env: { ...process.env, PATH: path }, stdio: "ignore" });
	const [code] = await once(swept, "close");
	return { code, elapsed: Date.now() - started };
}

test("the ps-based sweep kills the tree's members and ends without matching its own command line", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const mark = `${randomUUID()}/`;
	const member = lingering(t, { ...process.env, PI_WORKFLOW_PROCESS_TREE: `${mark}child/` });
	const exited = once(member, "exit");
	const { code, elapsed } = await sweepOf(sweep, [mark, "1000", await scratch(t)], path);
	assert.equal(code, 0);
	assert.ok(elapsed < 1000, `the sweep took ${elapsed} ms`);
	const [, signal] = await exited;
	assert.equal(signal, "SIGKILL");
});

test("where /proc exists, a sweep ignores recorded groups", async (t) => {
	const dir = await scratch(t);
	const proc = join(dir, "environ");
	await writeFile(proc, "");
	const sweep = join(dir, "process-tree.sh");
	await writeFile(sweep, readFileSync(script, "utf8").replaceAll("/proc/self/environ", proc));
	const groups = await groupsOf(t, "child");
	const unrelated = lingering(t);
	await writeFile(join(groups, "child", String(unrelated.pid)), startTime(unrelated.pid));
	const { code } = await sweepOf(sweep, [`${randomUUID()}/child/`, "1000", groups]);
	assert.equal(code, 0);
	assert.ok(alive(unrelated.pid));
});

test("a sweep removes its records without following a records directory replaced by a symlink", async (t) => {
	const groups = await scratch(t);
	const outside = await scratch(t);
	const sentinel = join(outside, "sentinel");
	await writeFile(sentinel, "keep");
	await symlink(outside, join(groups, "child"));
	const { code } = await sweepOf(script, [`${randomUUID()}/child/`, "1000", groups]);
	assert.equal(code, 0);
	assert.ok(existsSync(sentinel));
	await assert.rejects(lstat(join(groups, "child")), { code: "ENOENT" });
});

test("a sweep kills a recorded process group whose environment hides the mark, including a background job its exited shell left behind", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const token = randomUUID();
	const groups = await groupsOf(t, "child");
	const job = join(groups, "job.pid");
	const shell = spawn(
		"/bin/sh",
		["-c", 'LC_ALL=C ps -o lstart= -p $$ > "$1/$$"; sleep 300 >/dev/null 2>&1 & echo $! > "$2"', "sh", join(groups, "child"), job],
		{ detached: true, env: hidden, stdio: "ignore" },
	);
	await once(shell, "exit");
	const sleep = Number(readFileSync(job, "utf8"));
	t.after(() => alive(sleep) && process.kill(sleep, "SIGKILL"));
	assert.ok(alive(sleep));
	const { code } = await sweepOf(sweep, [`${token}/child/`, "2000", groups], path);
	assert.equal(code, 0);
	await gone([sleep], Date.now());
});

test("a sweep kills a recorded group's live leader and leaves alone a process that reuses a recorded group's number with another start time", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const groups = await groupsOf(t, "child");
	const unrelated = lingering(t);
	const control = lingering(t);
	await writeFile(join(groups, "child", String(control.pid)), startTime(control.pid));
	await writeFile(join(groups, "child", String(unrelated.pid)), "Thu Jan  1 00:00:00 1970\n");
	const { code } = await sweepOf(sweep, [`${randomUUID()}/child/`, "1000", groups], path);
	assert.equal(code, 0);
	assert.ok(alive(unrelated.pid));
	await gone([control.pid], Date.now());
});

test("a parent's watchdog kills the group a child's descendant started once it is orphaned and the parent dies", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const groups = await groupsOf(t, "child");
	const serverFile = join(groups, "server.pid");
	const pi = spawn(
		process.execPath,
		[
			"-e",
			'const s = require("node:child_process").spawn("sleep", ["300"], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH } }); require("node:fs").writeFileSync(process.argv[1], String(s.pid)); setInterval(() => {}, 1000);',
			serverFile,
		],
		{ detached: true, env: hidden, stdio: "ignore" },
	);
	t.after(() => pi.kill("SIGKILL"));
	const server = Number(await eventually(() => existsSync(serverFile) && readFileSync(serverFile, "utf8")));
	t.after(() => alive(server) && process.kill(server, "SIGKILL"));
	await writeFile(join(groups, "child", String(pi.pid)), startTime(pi.pid));
	const watchdog = spawn("/bin/sh", [sweep, `${randomUUID()}/`, "2000", groups, "watch"], {
		env: { ...process.env, PATH: path },
		stdio: ["pipe", "ignore", "ignore"],
	});
	t.after(() => watchdog.kill("SIGKILL"));
	await eventually(() => existsSync(join(groups, "child", String(server))), Boolean, 600);
	process.kill(pi.pid, "SIGKILL");
	await eventually(() => alive(pi.pid), (living) => !living);
	assert.ok(alive(server));
	const parentDied = Date.now();
	watchdog.stdin.end();
	const [code] = await once(watchdog, "close");
	assert.equal(code, 0);
	const elapsed = await gone([server], parentDied);
	assert.ok(elapsed < 2000, `cleanup took ${elapsed} ms`);
});

test("a parent's watchdog kills the group a marked descendant started outside the recorded groups once it is orphaned", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const token = randomUUID();
	const groups = await groupsOf(t, "child");
	const serverFile = join(groups, "server.pid");
	const pi = spawn(
		process.execPath,
		[
			"-e",
			'const s = require("node:child_process").spawn("sleep", ["300"], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH } }); require("node:fs").writeFileSync(process.argv[1], String(s.pid)); setInterval(() => {}, 1000);',
			serverFile,
		],
		{ detached: true, env: { ...hidden, PI_WORKFLOW_PROCESS_TREE: `${token}/child/` }, stdio: "ignore" },
	);
	t.after(() => pi.kill("SIGKILL"));
	const server = Number(await eventually(() => existsSync(serverFile) && readFileSync(serverFile, "utf8")));
	t.after(() => alive(server) && process.kill(server, "SIGKILL"));
	const watchdog = spawn("/bin/sh", [sweep, `${token}/`, "2000", groups, "watch"], {
		env: { ...process.env, PATH: path },
		stdio: ["pipe", "ignore", "ignore"],
	});
	t.after(() => watchdog.kill("SIGKILL"));
	await eventually(() => existsSync(join(groups, "child", String(server))), Boolean, 600);
	process.kill(pi.pid, "SIGKILL");
	await eventually(() => alive(pi.pid), (living) => !living);
	assert.ok(alive(server));
	const parentDied = Date.now();
	watchdog.stdin.end();
	const [code] = await once(watchdog, "close");
	assert.equal(code, 0);
	const elapsed = await gone([server], parentDied);
	assert.ok(elapsed < 2000, `cleanup took ${elapsed} ms`);
});

test("record mode drops empty old groups and reused numbers but retains a live old group", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const groups = await groupsOf(t, "child");
	const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	t.after(() => exited.kill("SIGKILL"));
	await once(exited, "close");
	const reused = lingering(t);
	const control = lingering(t);
	const emptyRecord = join(groups, "child", String(exited.pid));
	const reusedRecord = join(groups, "child", String(reused.pid));
	const liveRecord = join(groups, "child", String(control.pid));
	await writeFile(emptyRecord, "-\n");
	await writeFile(reusedRecord, "Thu Jan  1 00:00:00 1970\n");
	await writeFile(liveRecord, startTime(control.pid));
	const old = new Date(Date.now() - 120_000);
	await utimes(emptyRecord, old, old);
	await utimes(liveRecord, old, old);
	const { code } = await sweepOf(sweep, [`${randomUUID()}/child/`, "2000", groups, "record", String(control.pid)], path);
	assert.equal(code, 0);
	assert.ok(!existsSync(emptyRecord));
	assert.ok(!existsSync(reusedRecord));
	assert.ok(existsSync(liveRecord));
});

test("a child's bash records its shell's group, so a background job it leaves behind dies with the child's tree", async (t) => {
	for (const [name, create] of [
		["guarded", (cwd) => createChildBashTool(cwd)],
		["configured", (cwd) => createConfiguredBashTool(cwd, {})],
	]) {
		await t.test(name, async (t) => {
			const { sweep, path } = await sweepWithoutProc(t);
			const groups = await groupsOf(t, "child");
			process.env.PI_WORKFLOW_PROCESS_GROUPS = join(groups, "child");
			t.after(() => {
				delete process.env.PI_WORKFLOW_PROCESS_GROUPS;
			});
			const cwd = realpathSync(await scratch(t));
			const result = await create(cwd).execute("call-1", { command: "sleep 300 >/dev/null 2>&1 & echo $!" });
			const sleep = Number(result.content.map((part) => part.text).join("").trim());
			t.after(() => alive(sleep) && process.kill(sleep, "SIGKILL"));
			assert.ok(alive(sleep));
			const { code } = await sweepOf(sweep, [`${randomUUID()}/child/`, "2000", groups], path);
			assert.equal(code, 0);
			await gone([sleep], Date.now());
		});
	}
});
