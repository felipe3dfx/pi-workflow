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

function run(command, cwd, options) {
	return createChildBashTool(cwd, options).execute(
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
			["gh --repo=owner/repo pr view 12", "--repo=owner/repo pr view 12"],
			["gh pr -R owner/repo view 12", "pr -R owner/repo view 12"],
			["gh pr list --state open", "pr list --state open"],
			["gh workflow view ci", "workflow view ci"],
			["gh repo clone owner/repo", "repo clone owner/repo"],
			["gh label list", "label list"],
			["gh run view 1 --log-failed", "run view 1 --log-failed"],
			["gh run download 1", "run download 1"],
			["gh run watch 1", "run watch 1"],
			["gh search issues x", "search issues x"],
			["gh search", "search"],
			["gh release view v1", "release view v1"],
			["gh", ""],
			["gh help pr", "help pr"],
			["gh --version", "--version"],
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
			"bisect",
			"sparse-checkout",
			"update-index",
			"read-tree",
			"symbolic-ref",
			"replace",
			"filter-branch",
			"prune",
			"stage",
			"send-email",
			"maintenance",
			"repack",
		]) {
			await assertReserved(`git ${subcommand}`, dir, `git ${subcommand}`);
		}
	});

	test(`while Jev routing is ${state}, a child's bash refuses mutating remote, submodule, reflog, and lfs verbs in its worktree`, async (t) => {
		routing(t, state);
		const dir = worktree(t);

		for (const [command, expected] of [
			["git remote add upstream https://example.invalid/r", "git remote add"],
			["git remote set-url origin x", "git remote set-url"],
			["git remote remove origin", "git remote remove"],
			["git remote rm origin", "git remote rm"],
			["git remote rename origin o", "git remote rename"],
			["git remote update", "git remote update"],
			["git remote prune origin", "git remote prune"],
			["git remote set-head origin -a", "git remote set-head"],
			["git remote set-branches origin main", "git remote set-branches"],
			["git remote -v add upstream x", "git remote add"],
			["git submodule add https://example.invalid/r", "git submodule add"],
			["git submodule update --init", "git submodule update"],
			["git submodule init", "git submodule init"],
			["git submodule deinit --all", "git submodule deinit"],
			["git submodule sync", "git submodule sync"],
			["git submodule --quiet foreach true", "git submodule foreach"],
			["git submodule absorbgitdirs", "git submodule absorbgitdirs"],
			["git submodule set-branch -b main x", "git submodule set-branch"],
			["git submodule set-url x y", "git submodule set-url"],
			["git reflog expire --all", "git reflog expire"],
			["git reflog delete HEAD@{0}", "git reflog delete"],
			["git lfs push origin main", "git lfs push"],
			["git lfs --dry-run push origin", "git lfs push"],
		]) {
			await assertReserved(command, dir, expected);
		}
	});

	test(`while Jev routing is ${state}, a child's bash runs remote, submodule, and reflog reads in its worktree`, async (t) => {
		routing(t, state);
		const dir = worktree(t);
		execFileSync(
			"git",
			["remote", "add", "origin", "https://example.invalid/r"],
			{ cwd: dir },
		);

		for (const [command, expected] of [
			["git remote -v", /origin\s+https:\/\/example\.invalid\/r/],
			["git remote get-url origin", /^https:\/\/example\.invalid\/r$/m],
			["git submodule status", /^\(no output\)$/],
			["git reflog", /first/],
		]) {
			const result = await run(command, dir);

			assert.equal(result.isError, undefined, command);
			assert.match(text(result), expected, command);
		}
	});

	test(`while Jev routing is ${state}, a child's bash refuses an inline git alias in its worktree`, async (t) => {
		routing(t, state);
		const dir = worktree(t);

		for (const command of [
			"git -c alias.ci=commit ci -am x",
			"git -calias.p=push p",
			"git -c color.ui=never -c alias.s=status s",
		]) {
			await assertReserved(command, dir, "git -c alias");
		}
		assert.equal(commits(dir), "1");
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

	test(`while Jev routing is ${state}, a child's bash refuses every gh command outside the allowed reads from any directory`, async (t) => {
		routing(t, state);
		const calls = fakeGh(t);
		const dir = worktree(t);

		for (const [command, expected] of [
			["gh api repos/owner/repo", "gh api repos/owner/repo"],
			["gh workflow run ci", "gh workflow run"],
			["gh pr create --fill", "gh pr create"],
			["gh issue edit 1", "gh issue edit"],
			["gh -R owner/repo pr merge 12", "gh pr merge"],
			["gh --repo=owner/repo pr close 12", "gh pr close"],
			["gh pr -R owner/repo reopen 12", "gh pr reopen"],
			["gh pr --subject x merge 12", "gh pr"],
			["gh pr --subject view merge 12", "gh pr"],
			["gh --help pr merge 12", "gh pr"],
			["gh pr --help", "gh pr"],
			["gh status", "gh status"],
			["gh pr revert 1", "gh pr revert"],
			["gh pr checkout 12", "gh pr checkout"],
			["gh repo set-default owner/repo", "gh repo set-default"],
			["gh repo autolink create x y", "gh repo autolink"],
			["gh project item-add 1", "gh project item-add"],
			["gh label clone owner/other", "gh label clone"],
			["gh browse", "gh browse"],
			["cd /tmp && gh release create v0", "gh release create"],
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

test("a child's guard does not reach processes its command starts", async (t) => {
	routing(t, "off");
	const dir = worktree(t);

	for (const command of [
		"sh -c 'git config core.hooksPath .husky'",
		"sh -c 'git stash list'",
		"printf 'branch --show-current\\n' | xargs git",
	]) {
		const result = await run(command, dir);

		assert.equal(result.isError, undefined, command);
	}
	assert.equal(
		execFileSync("git", ["config", "core.hooksPath"], {
			cwd: dir,
			encoding: "utf8",
		}).trim(),
		".husky",
	);
});

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

test("a child's bash keeps the user's shell prefix alongside the guard", async (t) => {
	routing(t, "off");
	const dir = worktree(t);
	const prefix = "greet() { echo hello; }\nPI_WORKFLOW_PREFIX=on";

	const user = await run('greet; echo "$PI_WORKFLOW_PREFIX"', dir, prefix);
	const result = await run("git commit -am x", dir, prefix);

	assert.equal(text(user), "hello\non\n");
	assert.equal(result.structuredContent.exit_code, 126);
	assert.equal(result.structuredContent.output, reserved("git commit"));
	assert.equal(commits(dir), "1");
});

test("a child's bash keeps the guard when the user's prefix aliases git and gh", async (t) => {
	routing(t, "off");
	fakeGh(t);
	const dir = worktree(t);
	const prefix =
		"shopt -s expand_aliases\nalias git='echo aliased'\nalias gh='echo aliased'";

	const status = await run("git status", dir, prefix);
	const read = await run("gh pr view 12", dir, prefix);
	const result = await run("git commit -am x", dir, prefix);

	assert.match(text(status), /On branch/);
	assert.equal(text(read), "fake gh pr view 12\n");
	assert.equal(result.structuredContent.exit_code, 126);
	assert.equal(result.structuredContent.output, reserved("git commit"));
	assert.equal(commits(dir), "1");
});

test("a child's bash keeps the guard when the user's prefix sets nounset", async (t) => {
	routing(t, "off");
	fakeGh(t);
	const dir = worktree(t);

	for (const [command, expected] of [
		["git -c alias.ci=commit ci", "git -c alias"],
		["git commit -am x", "git commit"],
		["gh pr merge 12", "gh pr merge"],
		["gh pr --subject view merge 12", "gh pr"],
	]) {
		const result = await run(command, dir, "set -u");

		assert.equal(result.structuredContent.exit_code, 126, command);
		assert.equal(result.structuredContent.output, reserved(expected), command);
	}
	const missing = await run("git -c", dir, "set -u");
	assert.equal(missing.structuredContent.exit_code, 129);
	assert.doesNotMatch(missing.structuredContent.output, /unbound|reserved/);
	assert.match(text(await run("git status", dir, "set -u")), /On branch/);
	assert.equal(text(await run("gh", dir, "set -u")), "fake gh \n");
});

test("a child's bash reports a syntax error two lines below the command's line", async (t) => {
	routing(t, "off");

	const result = await run("echo ok\nif then", worktree(t));

	assert.equal(result.isError, true);
	assert.match(text(result), /line 4: syntax error/);
});

test("a child's bash for a missing directory is created and its commands fail", async (t) => {
	routing(t, "off");

	await assert.rejects(
		run("git status", join(temporaryDirectory(t), "missing")),
	);
});
