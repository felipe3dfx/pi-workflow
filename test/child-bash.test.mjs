import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { createChildBashTool } from "../extensions/child-bash.ts";
import { withAgentDirectory } from "./support/jev-routing.mjs";

function run(command, cwd) {
	return createChildBashTool(cwd).execute(
		"call-1",
		{ command },
		undefined,
		undefined,
		undefined,
	);
}

function text(result) {
	return result.content.map((part) => part.text).join("");
}

function reserved(command) {
	return `\`${command}\` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.\n`;
}

const hasPython = process.env.PATH.split(delimiter).some((dir) =>
	existsSync(join(dir, "python3")),
);

function temporaryDirectory(t, prefix = "pi-workflow-git-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

const identity = [
	"-c",
	"user.name=Child",
	"-c",
	"user.email=child@example.com",
];

function worktree(t, name = "worktree") {
	const dir = join(temporaryDirectory(t), name);
	mkdirSync(join(dir, "sub"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: dir });
	writeFileSync(join(dir, "file.txt"), "one\n");
	execFileSync("git", ["add", "file.txt"], { cwd: dir });
	execFileSync("git", [...identity, "commit", "-qm", "first"], { cwd: dir });
	writeFileSync(join(dir, "file.txt"), "two\n");
	return dir;
}

function commits(dir) {
	return execFileSync("git", ["rev-list", "--all", "--count"], {
		cwd: dir,
		encoding: "utf8",
	}).trim();
}

function fakeGh(t, failure) {
	const dir = temporaryDirectory(t, "pi-workflow-fake-gh-");
	const log = join(dir, "calls.log");
	writeFileSync(
		join(dir, "gh"),
		`#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n${
			failure
				? `printf '%s\\n' '${failure.stderr}' >&2\nexit ${failure.exitCode}\n`
				: `printf 'fake gh %s\\n' "$*"\n`
		}`,
		{ mode: 0o755 },
	);
	const previous = process.env.PATH;
	process.env.PATH = `${dir}${delimiter}${previous}`;
	t.after(() => {
		process.env.PATH = previous;
	});
	return () => (existsSync(log) ? readFileSync(log, "utf8") : "");
}

function routing(t, state) {
	const dir = withAgentDirectory(t);
	if (state === "on")
		writeFileSync(
			join(dir, "pi-workflow-routing.json"),
			JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
		);
}

async function assertReserved(command, cwd, expected) {
	const result = await run(command, cwd);

	assert.equal(result.isError, true, command);
	assert.equal(result.structuredContent.exit_code, 126, command);
	assert.equal(result.structuredContent.output, reserved(expected), command);
}

for (const state of ["off", "on"]) {
	test(`while Jev routing is ${state}, a child's bash runs git reads in its worktree`, async (t) => {
		routing(t, state);
		const dir = worktree(t);

		for (const [command, expected] of [
			["git status", /On branch/],
			["git diff", /\+two/],
			["git --no-pager diff", /\+two/],
			["git -c color.ui=never log", /first/],
			["git log --oneline", /first/],
			["git show --stat", /file\.txt/],
			["cd sub && git status --short", /file\.txt/],
		]) {
			const result = await run(command, dir);

			assert.equal(result.isError, undefined, command);
			assert.match(text(result), expected, command);
		}
	});

	test(`while Jev routing is ${state}, a child's bash runs gh reads from any directory`, async (t) => {
		routing(t, state);
		const calls = fakeGh(t);
		const dir = worktree(t);

		for (const [command, args] of [
			["gh run view --log-failed", "run view --log-failed"],
			["gh pr view 12", "pr view 12"],
			["gh pr list", "pr list"],
			["gh pr diff 12", "pr diff 12"],
			["gh pr checks 12", "pr checks 12"],
			["gh pr status", "pr status"],
			["gh -R owner/repo pr view 12", "-R owner/repo pr view 12"],
			["gh workflow view ci", "workflow view ci"],
			["cd /tmp && gh pr list", "pr list"],
		]) {
			const result = await run(command, dir);

			assert.equal(result.isError, undefined, command);
			assert.equal(text(result), `fake gh ${args}\n`, command);
		}
		assert.match(calls(), /^run view --log-failed$/m);
	});

	test(`while Jev routing is ${state}, a child's bash propagates a failing gh read`, async (t) => {
		routing(t, state);
		const calls = fakeGh(t, { exitCode: 3, stderr: "gh: run 1 not found" });
		const dir = worktree(t);

		const result = await run("gh run view 1 --log-failed", dir);

		assert.equal(result.isError, true);
		assert.equal(result.structuredContent.exit_code, 3);
		assert.match(result.structuredContent.output, /gh: run 1 not found/);
		assert.match(calls(), /^run view 1 --log-failed$/m);
	});

	test(`while Jev routing is ${state}, a child's bash refuses each reserved git subcommand in its worktree`, async (t) => {
		routing(t, state);
		const dir = worktree(t);

		for (const subcommand of [
			"commit",
			"merge",
			"rebase",
			"cherry-pick",
			"revert",
			"am",
			"reset",
			"tag",
			"branch",
			"update-ref",
			"push",
			"pull",
			"fetch",
			"checkout",
			"switch",
			"restore",
			"clean",
			"stash",
			"add",
			"rm",
			"mv",
			"apply",
			"config",
			"worktree",
			"gc",
			"notes",
		]) {
			await assertReserved(`git ${subcommand}`, dir, `git ${subcommand}`);
		}
	});

	test(`while Jev routing is ${state}, a child's bash finds the git subcommand after leading global options`, async (t) => {
		routing(t, state);
		const dir = worktree(t);

		for (const command of [
			"git --no-pager commit -am x",
			"git -C . commit -am x",
			"git -c user.name=x commit -am x",
			"git --git-dir .git --work-tree . commit -am x",
			"git --git-dir=.git commit -am x",
			"git --namespace n --exec-path /x --config-env a.b=C commit -am x",
			"git -P -C sub -c a.b=c commit -am x",
			"cd sub && git commit -am x",
		]) {
			await assertReserved(command, dir, "git commit");
		}
		assert.equal(commits(dir), "1");
	});

	test(`while Jev routing is ${state}, a child's bash refuses each reserved gh command from any directory`, async (t) => {
		routing(t, state);
		const calls = fakeGh(t);
		const dir = worktree(t);

		for (const [command, expected] of [
			["gh api repos/owner/repo", "gh api"],
			["gh auth status", "gh auth status"],
			["gh secret list", "gh secret list"],
			["gh release view v1", "gh release view"],
			["cd /tmp && gh release create v0", "gh release create"],
			["gh workflow run ci", "gh workflow run"],
			["gh pr create --fill", "gh pr create"],
			["gh issue edit 1", "gh issue edit"],
			["gh -R owner/repo pr merge 12", "gh pr merge"],
			["gh --repo=owner/repo pr close 12", "gh pr close"],
			["gh pr -R owner/repo reopen 12", "gh pr reopen"],
			["gh repo delete owner/repo", "gh repo delete"],
			["gh issue comment 1 -b x", "gh issue comment"],
			["gh pr review 12 --approve", "gh pr review"],
			["gh run rerun 1", "gh run rerun"],
			["gh run cancel 1", "gh run cancel"],
			["gh pr ready 12", "gh pr ready"],
			["gh pr checkout 12", "gh pr checkout"],
		]) {
			await assertReserved(command, dir, expected);
		}
		assert.equal(calls(), "");
	});

	test(`while Jev routing is ${state}, a child's bash runs git in a temporary repository outside its worktree`, async (t) => {
		routing(t, state);
		const dir = worktree(t);
		const outside = temporaryDirectory(t);

		const result = await run(
			`cd '${outside}' && git init -q && git ${identity.join(" ")} commit -q --allow-empty -m x && git log --oneline`,
			dir,
		);

		assert.equal(result.isError, undefined);
		assert.match(text(result), / x$/m);
	});
}

for (const [command, expected, skip] of [
	["/usr/bin/env git commit -am x", "git commit"],
	[
		`python3 -c "import subprocess;subprocess.run(['git','push'])"`,
		"git push",
		!hasPython,
	],
	["sh -c 'gh release create v0'", "gh release create"],
]) {
	test(`a child's bash refuses a reserved command reached through ${command}`, {
		skip,
	}, async (t) => {
		routing(t, "off");
		fakeGh(t);
		const dir = worktree(t);

		assert.equal(
			(await run(command, dir)).structuredContent.output,
			reserved(expected),
		);
		assert.equal(commits(dir), "1");
	});
}

test("a worktree path with a space and a single quote keeps the git guard", async (t) => {
	routing(t, "off");
	const dir = worktree(t, "it's a worktree");
	const outside = temporaryDirectory(t);

	await assertReserved("cd sub && git commit -am x", dir, "git commit");
	assert.match(text(await run("git status", dir)), /On branch/);
	assert.match(
		text(await run(`cd '${outside}' && git init`, dir)),
		/Initialized empty Git repository/,
	);
});

test("a child's bash runs a command that only mentions git", async (t) => {
	routing(t, "off");

	const result = await run("printf 'git commit\\n' | grep -c git", worktree(t));

	assert.equal(result.isError, undefined);
	assert.equal(text(result).trim(), "1");
});

test("a child's bash runs shell arithmetic", async (t) => {
	routing(t, "off");

	assert.equal(text(await run("echo $((2*3))", worktree(t))).trim(), "6");
});
