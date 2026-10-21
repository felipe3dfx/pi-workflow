import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

import {
	checkpointGrant,
	createCheckpointTool,
} from "../extensions/child-checkpoint.ts";

const message = "feat(child): add the note\n\nThe child adds a note.\n\nRefs: #283\n";

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

async function repository(dir, name, key) {
	const repo = join(dir, name);
	await mkdir(repo);
	git(repo, "init", "--quiet", "--initial-branch=main");
	configure(repo, key);
	await writeFile(join(repo, "README.md"), "readme\n");
	git(repo, "add", "README.md");
	git(repo, "commit", "--quiet", "--message", "chore: init");
	return realpath(repo);
}

async function withCheckpoint(run) {
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

function text(result) {
	return result.content.map((part) => part.text).join("");
}

test("a granted checkpoint creates a signed commit on the branch and reports it", async () => {
	await withCheckpoint(async ({ worktree, grant, checkpoint, recorded }) => {
		const old = git(worktree, "rev-parse", "HEAD");
		await mkdir(join(worktree, "notes"));
		await writeFile(join(worktree, "notes", "note.md"), "note\n");
		await writeFile(join(worktree, "README.md"), "readme two\n");

		const result = await checkpoint({ message, paths: ["notes", "README.md"] });

		const sha = git(worktree, "rev-parse", "HEAD");
		assert.notEqual(sha, old);
		assert.equal(git(worktree, "rev-parse", `${sha}^`), old);
		assert.match(git(worktree, "cat-file", "commit", sha), /^gpgsig -----BEGIN SSH SIGNATURE-----$/m);
		assert.equal(git(worktree, "log", "-1", "--format=%B", sha), message.trim());
		assert.deepEqual(result.details, {
			sha,
			parent: old,
			base: grant.base,
			branch: "feature",
			files: ["M\tREADME.md", "A\tnotes/note.md"],
		});
		for (const value of [sha, old, grant.base, "feature", "notes/note.md"]) {
			assert.ok(text(result).includes(value), value);
		}
		assert.deepEqual(recorded, [{ sha, parent: old, base: grant.base, branch: "feature" }]);
		assert.equal(git(worktree, "status", "--porcelain"), "");
	});
});

test("the parent verifies a returned checkpoint and integrates it", async () => {
	await withCheckpoint(async ({ main, worktree, grant, checkpoint }) => {
		await writeFile(join(worktree, "note.md"), "note\n");
		const { details } = await checkpoint({ message, paths: ["note.md"] });

		git(main, "merge-base", "--is-ancestor", grant.base, details.sha);
		assert.equal(git(main, "rev-parse", "refs/heads/feature"), details.sha);
		assert.equal(git(main, "show", `${details.sha}:note.md`), "note");
		git(main, "merge", "--quiet", "--no-ff", "--no-edit", "feature");

		assert.equal(await readFile(join(main, "note.md"), "utf8"), "note\n");
		assert.equal(git(main, "rev-parse", "HEAD^2"), details.sha);
		assert.match(git(main, "cat-file", "commit", "HEAD"), /^gpgsig /m);
	});
});

test("a checkpoint is refused after the worktree leaves the granted branch", async () => {
	await withCheckpoint(async ({ worktree, checkpoint }) => {
		git(worktree, "switch", "--quiet", "-c", "other");
		await writeFile(join(worktree, "note.md"), "note\n");
		const head = git(worktree, "rev-parse", "HEAD");

		await assert.rejects(checkpoint({ message, paths: ["note.md"] }), /refs\/heads\/feature/);
		assert.equal(git(worktree, "rev-parse", "HEAD"), head);
	});
});

test("a checkpoint is refused when the Git metadata differs from the grant", async () => {
	await withCheckpoint(async ({ main, worktree, grant }) => {
		await writeFile(join(worktree, "note.md"), "note\n");
		const other = await realpath(join(main, ".git"));
		for (const changed of [{ gitDir: other }, { commonDir: worktree }, { root: main }]) {
			const tool = createCheckpointTool({ ...grant, ...changed }, () => {});
			await assert.rejects(
				tool.execute("call-1", { message, paths: ["note.md"] }),
				/checkpoint/,
			);
		}
		assert.equal(git(worktree, "rev-parse", "HEAD"), grant.base);
		assert.equal(git(main, "rev-list", "--count", "HEAD"), "1");
	});
});

test("a checkpoint is refused when the branch no longer descends from the base", async () => {
	await withCheckpoint(async ({ worktree, grant }) => {
		await writeFile(join(worktree, "note.md"), "note\n");
		const tool = createCheckpointTool(
			{ ...grant, base: "0".repeat(40) },
			() => {},
		);
		await assert.rejects(tool.execute("call-1", { message, paths: ["note.md"] }), /base/);
	});
});

test("checkpoint paths stay inside the worktree and out of .git", async () => {
	await withCheckpoint(async ({ dir, worktree, grant, checkpoint }) => {
		await writeFile(join(dir, "outside.md"), "outside\n");
		for (const path of ["../outside.md", join(dir, "outside.md"), ".git", ".git/config", ".GIT/hooks", "sub/../../outside.md", "."]) {
			await assert.rejects(checkpoint({ message, paths: [path] }), /path/, path);
		}
		await assert.rejects(checkpoint({ message, paths: [] }), /path/);
		assert.equal(git(worktree, "rev-parse", "HEAD"), grant.base);
	});
});

test("Git environment overrides cannot redirect a checkpoint", async () => {
	await withCheckpoint(async ({ dir, key, main, worktree, checkpoint }) => {
		const other = await repository(dir, "other", key);
		const otherHead = git(other, "rev-parse", "HEAD");
		const mainHead = git(main, "rev-parse", "HEAD");
		await writeFile(join(worktree, "note.md"), "note\n");
		await writeFile(join(other, "note.md"), "other\n");
		const saved = {};
		const overrides = {
			GIT_DIR: join(other, ".git"),
			GIT_WORK_TREE: other,
			GIT_INDEX_FILE: join(other, ".git", "index"),
			GIT_COMMON_DIR: join(other, ".git"),
		};
		for (const [name, value] of Object.entries(overrides)) {
			saved[name] = process.env[name];
			process.env[name] = value;
		}
		let result;
		try {
			result = await checkpoint({ message, paths: ["note.md"] });
		} finally {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}

		assert.equal(git(worktree, "rev-parse", "HEAD"), result.details.sha);
		assert.equal(git(other, "rev-parse", "HEAD"), otherHead);
		assert.equal(git(other, "status", "--porcelain"), "?? note.md");
		assert.equal(git(main, "rev-parse", "HEAD"), mainHead);
	});
});

test("a checkpoint is refused without commit signing and creates no commit", async () => {
	await withCheckpoint(async ({ main, worktree, grant, checkpoint }) => {
		git(main, "config", "commit.gpgsign", "false");
		await writeFile(join(worktree, "note.md"), "note\n");

		await assert.rejects(
			checkpoint({ message, paths: ["note.md"] }),
			/commit signing is not configured/,
		);
		assert.equal(git(worktree, "rev-parse", "HEAD"), grant.base);
		assert.equal(git(main, "config", "commit.gpgsign"), "false");
	});
});

test("a signing failure fails the checkpoint and leaves the branch unchanged", async () => {
	await withCheckpoint(async ({ dir, main, worktree, grant, checkpoint }) => {
		git(main, "config", "user.signingkey", join(dir, "missing-key"));
		await writeFile(join(worktree, "note.md"), "note\n");

		await assert.rejects(checkpoint({ message, paths: ["note.md"] }), /git commit failed: .*missing-key/);
		assert.equal(git(worktree, "rev-parse", "refs/heads/feature"), grant.base);
		assert.equal(git(main, "config", "user.signingkey"), join(dir, "missing-key"));
	});
});

test("a checkpoint message needs a Conventional Commits header and no attribution trailer", async () => {
	await withCheckpoint(async ({ worktree, grant, checkpoint }) => {
		await writeFile(join(worktree, "note.md"), "note\n");
		const invalid = [
			"add the note\n\nBody.\n\nRefs: #283",
			"Feat: add the note",
			"feat:add the note",
			"feat(): add the note",
			"feat: add the note\n\nBody.\n\nCo-authored-by: Claude <noreply@anthropic.com>\nRefs: #283",
			"feat: add the note\n\nBody.\n\nclaude-session: abc",
		];
		for (const candidate of invalid) {
			await assert.rejects(checkpoint({ message: candidate, paths: ["note.md"] }), /message/, candidate);
		}
		assert.equal(git(worktree, "rev-parse", "HEAD"), grant.base);

		const { details } = await checkpoint({ message: "build(deps)!: add the note", paths: ["note.md"] });
		assert.equal(git(worktree, "log", "-1", "--format=%B", details.sha), "build(deps)!: add the note");
	});
});

test("a checkpoint is refused when a hook moves another ref, and the error names it", async () => {
	await withCheckpoint(async ({ main, worktree, grant, checkpoint }) => {
		const hooks = join(git(main, "rev-parse", "--absolute-git-dir"), "hooks");
		await mkdir(hooks, { recursive: true });
		await writeFile(join(hooks, "post-commit"), "#!/bin/sh\ngit update-ref refs/heads/main HEAD\n", { mode: 0o755 });
		await writeFile(join(worktree, "note.md"), "note\n");

		const error = await checkpoint({ message, paths: ["note.md"] }).catch((caught) => caught);

		const sha = git(worktree, "rev-parse", "HEAD");
		assert.notEqual(sha, grant.base);
		assert.match(error.message, /refs\/heads\/main/);
		assert.ok(error.message.includes(sha));
		assert.doesNotMatch(error.message, /refs\/heads\/feature/);
	});
});

test("a checkpoint is refused when the index holds a change outside its paths", async () => {
	await withCheckpoint(async ({ worktree, grant, checkpoint }) => {
		await writeFile(join(worktree, "note.md"), "note\n");
		await writeFile(join(worktree, "other.md"), "other\n");
		git(worktree, "add", "other.md");

		await assert.rejects(checkpoint({ message, paths: ["note.md"] }), /other\.md/);
		assert.equal(git(worktree, "rev-parse", "HEAD"), grant.base);
	});
});

test("a checkpoint with nothing to commit is refused", async () => {
	await withCheckpoint(async ({ worktree, grant, checkpoint }) => {
		await assert.rejects(checkpoint({ message, paths: ["README.md"] }), /nothing/);
		assert.equal(git(worktree, "rev-parse", "HEAD"), grant.base);
	});
});

test("a grant needs an isolated worktree on a branch other than the parent's", async () => {
	await withCheckpoint(async ({ dir, main, worktree }) => {
		const clone = join(dir, "clone");
		git(dir, "clone", "--quiet", main, clone);

		await assert.rejects(checkpointGrant(main, "main", main), /shared checkout/);
		await assert.rejects(checkpointGrant(worktree, "other", main), /refs\/heads\/other/);
		await assert.rejects(checkpointGrant(clone, "main", main), /parent's current branch/);
		git(worktree, "switch", "--quiet", "--detach");
		await assert.rejects(checkpointGrant(worktree, "feature", main), /refs\/heads\/feature/);
	});
});
