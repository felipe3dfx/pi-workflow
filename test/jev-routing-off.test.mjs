import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { classifierRegistry } from "./support/fake-jev.mjs";
import { withAgentDirectory } from "./support/jev-routing.mjs";

function offLauncher(t) {
	const dir = withAgentDirectory(t);
	const jev = classifierRegistry(() => {
		throw new Error("Jev is unreachable");
	});
	const launcher = createChildLauncher({
		modelProfiles: { load: () => ({ status: "absent" }) },
	});
	return { dir, launcher, jev };
}

async function gitWorktree(dir) {
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	return worktree;
}

function parentContext(cwd, userRequest, jev) {
	return {
		cwd,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? "typesafe-key" : undefined,
			getAvailable: () => [],
			...jev.registry,
		},
		sessionManager: {
			getBranch: () => [
				{ type: "message", message: { role: "user", content: userRequest } },
			],
		},
	};
}

test("while Jev routing is off, every gated parent tool runs without Jev, even from a codemode script", async (t) => {
	const { dir, launcher, jev } = offLauncher(t);
	const ctx = parentContext(
		dir,
		"Fix the parser and open the pull request",
		jev,
	);

	for (const event of [
		{ toolName: "read", input: { path: "src/parser.ts" } },
		{ toolName: "grep", input: { pattern: "parse" } },
		{ toolName: "find", input: { pattern: "*.ts" } },
		{ toolName: "ls", input: { path: "src" } },
		{ toolName: "edit", input: { path: "src/parser.ts" } },
		{ toolName: "write", input: { path: "src/parser.ts" } },
		{ toolName: "bash", input: { command: "git status" } },
		{ toolName: "bash", input: { command: "gh pr create --fill" } },
		{ toolName: "powershell", input: { command: "git status" } },
		{ toolName: "codegraph", input: { operation: "query" } },
		{ toolName: "codegraph", input: { operation: "explore" } },
		{
			toolName: "bash",
			input: { command: "git status" },
			toolCallId: "call-1/1",
			parentToolCallId: "call-1",
		},
	]) {
		assert.deepEqual(await launcher.gateToolCall(event, ctx), { allow: true });
	}
	assert.equal(jev.requests.length, 0);
});

test("while Jev routing is off, a named role keeps git and gh in the parent and launches for other work", async (t) => {
	const { dir, launcher, jev } = offLauncher(t);
	const worktree = await gitWorktree(dir);
	const ctx = parentContext(
		worktree,
		"Run git status, then fix the parser",
		jev,
	);

	for (const [role, task] of [
		["worker", "git status"],
		["worker", "  gh pr create --fill"],
		["verify", "git"],
		["explore", "gh"],
		["worker", "Run git status"],
		["worker", "cd repo && git log"],
		["worker", "/usr/bin/git status"],
		["worker", "git\tstatus"],
		["worker", "Open it with gh pr create"],
		["verify", "Check the branch (git)"],
		["explore", "Map how the parser calls git"],
		["worker", "Commit the fix with git."],
		["worker", "Run Git status"],
		["worker", "GH pr create"],
	]) {
		const kept = await launcher.prepareLaunch({ role, task }, ctx);
		assert.equal(kept.kind, "stay");
		assert.equal(
			kept.reason,
			"git and gh stay in the parent while Jev routing is off.",
		);
		assert.equal("role" in kept, false);
	}

	for (const [role, task] of [
		["worker", "Fix the parser"],
		["worker", "gitignore the build directory"],
		["worker", "Update the github workflow"],
		["worker", "Update the GitHub workflow"],
		["explore", "Read .git/config"],
		["worker", "Remove the ghost entries"],
		["verify", "Check each digit"],
	]) {
		const launched = await launcher.prepareLaunch({ role, task }, ctx);
		assert.equal(launched.kind, "ready");
		assert.equal(launched.role, role);
		assert.equal(launched.task, task);
	}
	assert.equal(jev.requests.length, 0);
});
