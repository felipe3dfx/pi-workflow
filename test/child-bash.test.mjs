import test from "node:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { createChildBashTool } from "../extensions/child-bash.ts";
import { withAgentDirectory } from "./support/jev-routing.mjs";

function run(command, cwd = process.cwd()) {
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

const hasPython = process.env.PATH.split(delimiter).some((dir) =>
	existsSync(join(dir, "python3")),
);

for (const [command, program, skip] of [
	["git status", "git"],
	["/usr/bin/env git status", "git"],
	[
		`python3 -c "import subprocess;subprocess.run(['git','--version'])"`,
		"git",
		!hasPython,
	],
	["sh -c 'gh --version'", "gh"],
]) {
	test(`while Jev routing is off, a child's bash stops ${program} in: ${command}`, {
		skip,
	}, async (t) => {
		withAgentDirectory(t);

		const output = text(await run(command));

		assert.match(output, new RegExp(`\\b${program}\\b.*parent`));
		assert.match(output, /blocked/);
		assert.match(output, /ask_parent/);
		assert.doesNotMatch(output, /git version|gh version/);
	});
}

function temporaryDirectory(t, prefix = "pi-workflow-git-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function assertRefused(output, program) {
	assert.match(output, new RegExp(`\\b${program}\\b.*parent`));
	assert.match(output, /ask_parent/);
	assert.doesNotMatch(output, /git version|gh version|On branch/);
}

test("while Jev routing is off, a child's bash runs git init in a directory outside its worktree", async (t) => {
	withAgentDirectory(t);
	const outside = temporaryDirectory(t);

	const output = text(await run(`cd '${outside}' && git init`));

	assert.match(output, /Initialized empty Git repository/);
	assert.ok(existsSync(join(outside, ".git")));
});

test("while Jev routing is off, a child's bash refuses git status at its worktree root", async (t) => {
	withAgentDirectory(t);

	assertRefused(text(await run("git status")), "git");
});

test("while Jev routing is off, a child's bash refuses git status in a subdirectory of its worktree", async (t) => {
	withAgentDirectory(t);

	assertRefused(text(await run("cd test && git status")), "git");
});

test("while Jev routing is off, a child's bash refuses gh outside its worktree", async (t) => {
	withAgentDirectory(t);
	const outside = temporaryDirectory(t);

	assertRefused(text(await run(`cd '${outside}' && gh --version`)), "gh");
});

test("while Jev routing is off, a worktree path with a space and a single quote keeps the git guard", async (t) => {
	withAgentDirectory(t);
	const parent = temporaryDirectory(t);
	const worktree = join(parent, "it's a worktree");
	mkdirSync(join(worktree, "sub"), { recursive: true });
	const outside = temporaryDirectory(t);

	assertRefused(text(await run("cd sub && git status", worktree)), "git");
	assert.match(
		text(await run(`cd '${outside}' && git init`, worktree)),
		/Initialized empty Git repository/,
	);
});

test("while Jev routing is off, a child's bash runs a command that only mentions git", async (t) => {
	withAgentDirectory(t);

	const result = await run("grep -c git README.md");

	assert.equal(result.isError, undefined);
	assert.match(text(result), /^\d+/);
});

test("while Jev routing is off, a child's bash runs shell arithmetic", async (t) => {
	withAgentDirectory(t);

	assert.equal(text(await run("echo $((2*3))")).trim(), "6");
});

test("while Jev routing is on, a child's bash runs git", async (t) => {
	const dir = withAgentDirectory(t);
	writeFileSync(
		join(dir, "pi-workflow-routing.json"),
		JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
	);

	assert.match(
		text(await run("git --version", temporaryDirectory(t))),
		/^git version/,
	);
});
