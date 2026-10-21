import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

import { fauxProvider } from "@earendil-works/pi-ai";
import { getAgentDir, ModelRegistry } from "@earendil-works/pi-coding-agent";

import { checkpointGrant } from "../extensions/child-checkpoint.ts";
import { parseContract } from "../extensions/child-launcher.ts";
import { createPiChildSession } from "../extensions/child-sessions.ts";
import { resolveClaudeBridgeExtension } from "../extensions/web-access.ts";
import { createBridgeParentSession } from "./support/bridge-parent.mjs";
import { installedPackagePath } from "./support/child-session.mjs";

const live = process.env.PI_WORKFLOW_BRIDGE_LIVE === "1";

function git(cwd, ...args) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("a real granted worker signs a checkpoint in its isolated worktree and the parent verifies and integrates it", {
	skip: !live && "Set PI_WORKFLOW_BRIDGE_LIVE=1 to run the real child-owned checkpoint check.",
	timeout: 240_000,
}, async (t) => {
	const sourceAgentDir = getAgentDir();
	assert.ok(
		installedPackagePath(sourceAgentDir, "npm:pi-claude-bridge"),
		"the actual installed pi-claude-bridge package is required",
	);
	const scratch = await realpath(await mkdtemp(join(tmpdir(), "pi-workflow-checkpoint-live-")));
	const agentDir = join(scratch, "agent");
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	t.after(async () => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		await rm(scratch, { recursive: true, force: true });
	});
	await mkdir(join(agentDir, "npm"), { recursive: true });
	await symlink(join(sourceAgentDir, "npm", "node_modules"), join(agentDir, "npm", "node_modules"), "dir");
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-claude-bridge"] }));
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const key = join(scratch, "key");
	execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
	const main = join(scratch, "main");
	await mkdir(main);
	git(main, "init", "--quiet", "--initial-branch=main");
	for (const [name, value] of [
		["user.name", "Parent"],
		["user.email", "parent@example.com"],
		["gpg.format", "ssh"],
		["gpg.ssh.program", "ssh-keygen"],
		["user.signingkey", key],
		["commit.gpgsign", "true"],
	]) {
		git(main, "config", name, value);
	}
	await writeFile(join(main, "README.md"), "readme\n");
	git(main, "add", "README.md");
	git(main, "commit", "--quiet", "--message", "chore: init");
	const worktree = join(scratch, "feature");
	git(main, "worktree", "add", "--quiet", "-b", "feature", worktree);
	const grant = await checkpointGrant(worktree, "feature", main);

	const project = { cwd: main, trusted: false };
	const bridgeExtension = await resolveClaudeBridgeExtension(agentDir, project);
	const native = fauxProvider({ provider: "faux", models: [{ id: "child", reasoning: true }] });
	const { session: parent, runtime } = await createBridgeParentSession({
		cwd: main,
		agentDir,
		extensionPath: bridgeExtension,
		model: native.getModel(),
		nativeProvider: native.provider,
	});
	await parent.bindExtensions({});
	const contract = parseContract(
		await readFile(new URL("../assets/contracts/worker.md", import.meta.url), "utf8"),
	);
	const checkpoints = [];
	const reports = [];
	const child = await createPiChildSession({
		cwd: worktree,
		project,
		role: "worker",
		model: "claude-bridge/claude-haiku-4-5",
		thinking: "low",
		prompt: contract.prompt,
		tools: [...contract.tools, "ask_parent", "report_result", "checkpoint"],
		modelRegistry: new ModelRegistry(runtime),
		shell: {},
		onEvent() {},
		notify() {},
		async ask() {
			return "Continue without an answer.";
		},
		report: (result) => reports.push(result),
		checkpoint: grant,
		checkpointed: (checkpoint) => checkpoints.push(checkpoint),
	});
	try {
		assert.ok(child.tools.includes("checkpoint"));
		const message = "docs(live): add the checkpoint note\n\nThe live check needs a child-owned change.\n\nRefs: #283";
		await child.run(
			[
				"Create the file live-note.md in the worktree root containing exactly one line: checkpoint live",
				"Then run this focused check with bash: grep -qx 'checkpoint live' live-note.md && echo CHECK_OK",
				`After it prints CHECK_OK, call the checkpoint tool with paths ["live-note.md"] and this exact message:\n${message}`,
				"Then call report_result with Verdict done, the returned sha, parent, and base, files_changed, validation, and left_undone.",
			].join("\n\n"),
		);
	} finally {
		await child.dispose();
		parent.dispose();
	}

	assert.equal(checkpoints.length, 1, "the harness recorded exactly one checkpoint");
	const [{ sha, parent: previous, base, branch }] = checkpoints;
	assert.equal(branch, "feature");
	assert.equal(base, grant.base);
	assert.equal(previous, grant.base);
	assert.equal(git(main, "rev-parse", "refs/heads/feature"), sha);
	git(main, "merge-base", "--is-ancestor", base, sha);
	assert.equal(git(main, "rev-parse", `${sha}^`), previous);
	assert.match(git(main, "cat-file", "commit", sha), /^gpgsig /m);
	assert.equal(git(main, "show", `${sha}:live-note.md`), "checkpoint live");
	assert.equal(git(main, "diff-tree", "--no-commit-id", "--name-only", "-r", sha), "live-note.md");
	const reported = reports.at(-1);
	assert.equal(reported?.verdict, "done");
	assert.ok(JSON.stringify(reported).includes(sha), "the child reported the harness SHA");
	assert.match(reported.validation.join("\n"), /CHECK_OK/);

	git(main, "merge", "--quiet", "--no-ff", "--no-edit", "feature");
	assert.equal((await readFile(join(main, "live-note.md"), "utf8")).trim(), "checkpoint live");
	assert.equal(git(main, "rev-parse", "HEAD^2"), sha);
	const focused = join(scratch, "integrated.test.mjs");
	await writeFile(
		focused,
		'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\ntest("the integrated note", () => assert.equal(readFileSync("live-note.md", "utf8").trim(), "checkpoint live"));\n',
	);
	execFileSync(process.execPath, ["--test", focused], { cwd: main, stdio: "pipe" });
	assert.match(git(main, "cat-file", "commit", "HEAD"), /^gpgsig /m);
});
