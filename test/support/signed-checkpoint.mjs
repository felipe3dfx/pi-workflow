import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { checkpointGrant, createCheckpointTool } from "../../extensions/child-checkpoint.ts";

function git(cwd, ...args) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function configure(repo, key) {
	git(repo, "config", "user.name", "Child");
	git(repo, "config", "user.email", "child@example.com");
	git(repo, "config", "gpg.format", "ssh");
	git(repo, "config", "user.signingkey", key);
	git(repo, "config", "commit.gpgsign", "true");
}

export async function repository(dir, name, key) {
	const repo = join(dir, name);
	await mkdir(repo);
	git(repo, "init", "--quiet", "--initial-branch=main");
	configure(repo, key);
	await writeFile(join(repo, "README.md"), "readme\n");
	git(repo, "add", "README.md");
	git(repo, "commit", "--quiet", "--message", "chore: init");
	return realpath(repo);
}

export async function withCheckpoint(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-checkpoint-"));
	const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
	process.env.HOME = dir;
	process.env.XDG_CONFIG_HOME = join(dir, "config");
	try {
		const key = join(dir, "key");
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
		const main = await repository(dir, "main", key);
		git(main, "worktree", "add", "--quiet", "-b", "feature", join(dir, "feature"));
		const worktree = await realpath(join(dir, "feature"));
		const grant = await checkpointGrant(worktree, "feature", main);
		const recorded = [];
		const tool = createCheckpointTool(grant, (checkpoint) => recorded.push(checkpoint));
		const checkpoint = (params) => tool.execute("call-1", params);
		return await run({ dir, key, main, worktree, grant, checkpoint, recorded });
	} finally {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(dir, { recursive: true, force: true });
	}
}
