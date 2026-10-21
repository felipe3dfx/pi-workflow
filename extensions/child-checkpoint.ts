import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { type Static, Type } from "typebox";

export type CheckpointGrant = {
	branch: string;
	root: string;
	gitDir: string;
	commonDir: string;
	base: string;
};

export type Checkpoint = {
	sha: string;
	parent: string;
	base: string;
	branch: string;
};

export const checkpointTool = "checkpoint";

function environment(): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			([name]) => !name.toUpperCase().startsWith("GIT_"),
		),
	);
}

function git(cwd: string, args: string[], input = ""): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"git",
			args,
			{ cwd, env: environment(), maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (!error) return resolve(stdout);
				const detail = String(stderr).trim() || error.message;
				reject(new Error(`git ${args[0]} failed: ${detail}`));
			},
		);
		child.stdin?.on("error", () => {});
		child.stdin?.end(input);
	});
}

async function head(cwd: string): Promise<string | undefined> {
	return git(cwd, ["symbolic-ref", "-q", "HEAD"]).then(
		(ref) => ref.trim(),
		() => undefined,
	);
}

async function scope(cwd: string) {
	const [root, gitDir, commonDir] = (
		await git(cwd, [
			"rev-parse",
			"--show-toplevel",
			"--absolute-git-dir",
			"--path-format=absolute",
			"--git-common-dir",
		])
	)
		.trim()
		.split("\n")
		.map((path) => realpathSync(path));
	return { root, gitDir, commonDir, ref: await head(cwd) };
}

export async function checkpointGrant(
	worktree: string,
	branch: string,
	parent: string,
): Promise<CheckpointGrant> {
	const own = await scope(worktree);
	const theirs = await scope(parent).catch(() => {
		throw new Error(`the parent checkout ${parent} is not a Git checkout`);
	});
	if (own.root === theirs.root) {
		throw new Error(
			`${own.root} is the parent's shared checkout; a checkpoint needs an isolated worktree`,
		);
	}
	if (own.ref !== `refs/heads/${branch}`) {
		throw new Error(
			`${own.root} is on ${own.ref ?? "a detached HEAD"}, not refs/heads/${branch}`,
		);
	}
	if (theirs.ref === own.ref) {
		throw new Error(`${branch} is the parent's current branch`);
	}
	const base = (await git(worktree, ["rev-parse", "HEAD"])).trim();
	return {
		branch,
		root: own.root,
		gitDir: own.gitDir,
		commonDir: own.commonDir,
		base,
	};
}

async function verifyScope(grant: CheckpointGrant) {
	const current = await scope(grant.root);
	for (const key of ["root", "gitDir", "commonDir"] as const) {
		if (current[key] !== grant[key]) {
			throw new Error(
				`the checkpoint scope changed: ${key} is ${current[key]}, not ${grant[key]}`,
			);
		}
	}
	const ref = `refs/heads/${grant.branch}`;
	if (current.ref !== ref) {
		throw new Error(
			`the checkpoint needs HEAD on ${ref}, but it is on ${current.ref ?? "a detached HEAD"}`,
		);
	}
	await git(grant.root, [
		"merge-base",
		"--is-ancestor",
		grant.base,
		"HEAD",
	]).catch(() => {
		throw new Error(`the checkpoint branch no longer descends from the base ${grant.base}`);
	});
}

const header = /^[a-z]+(\([^()\r\n]+\))?!?: \S/;
const attribution = /^(co-authored-by|claude-session):/i;

function verifyMessage(message: string) {
	const lines = message.split(/\r?\n/);
	const problem = !header.test(lines[0] ?? "")
		? "its first line must be a Conventional Commits header, <type>(<scope>): <summary>"
		: lines.some((line) => attribution.test(line))
			? "it must not carry an attribution trailer"
			: undefined;
	if (problem) {
		throw new Error(`the checkpoint message is refused: ${problem}`);
	}
}

async function refs(root: string) {
	return new Map(
		(await git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]))
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => line.split(" ") as [string, string]),
	);
}

function relativePaths(root: string, paths: readonly string[]) {
	if (paths.length === 0) throw new Error("the checkpoint needs at least one path");
	return paths.map((path) => {
		const inside = relative(root, resolve(root, path));
		if (
			inside === "" ||
			inside === ".." ||
			inside.startsWith(`..${sep}`) ||
			isAbsolute(inside)
		) {
			throw new Error(`the checkpoint path ${path} is not inside the worktree ${root}`);
		}
		if (inside.split(sep)[0].toLowerCase() === ".git") {
			throw new Error(`the checkpoint path ${path} is Git metadata`);
		}
		return inside.split(sep).join("/");
	});
}

export const checkpointParameters = Type.Object({
	message: Type.String({
		description:
			"The commit message in the repository's commit template. Its first line must be a Conventional Commits header, and it must carry no Co-authored-by or Claude-Session line.",
	}),
	paths: Type.Array(Type.String(), {
		description:
			"The changed paths to commit, relative to the worktree root. A directory covers the paths under it.",
	}),
});

export function createCheckpointTool(
	grant: CheckpointGrant,
	checkpointed: (checkpoint: Checkpoint) => void,
) {
	return {
		name: checkpointTool,
		label: "Checkpoint",
		description: `Create a signed checkpoint commit of the given paths on ${grant.branch} in this worktree. Hooks and the repository signing configuration apply; the call fails without a commit when signing is not configured or fails.`,
		parameters: checkpointParameters,
		async execute(
			_toolCallId: string,
			params: Static<typeof checkpointParameters>,
		) {
			const { root } = grant;
			await verifyScope(grant);
			verifyMessage(params.message);
			const paths = relativePaths(root, params.paths);
			const signing = await git(root, [
				"config",
				"--type=bool",
				"--get",
				"commit.gpgsign",
			]).catch(() => "");
			if (signing.trim() !== "true") {
				throw new Error(
					"commit signing is not configured: commit.gpgsign is not true, so no checkpoint was created",
				);
			}
			const before = await refs(root);
			const literal = paths.map((path) => `:(literal)${path}`);
			await git(root, ["add", "-A", "--", ...literal]);
			const staged = (
				await git(root, ["diff", "--cached", "--no-renames", "--name-only", "-z"])
			)
				.split("\0")
				.filter((path) => path !== "");
			if (staged.length === 0) {
				throw new Error("the checkpoint has nothing to commit for these paths");
			}
			const outside = staged.filter(
				(file) => !paths.some((path) => file === path || file.startsWith(`${path}/`)),
			);
			if (outside.length > 0) {
				throw new Error(
					`the index holds changes outside the checkpoint paths: ${outside.join(", ")}`,
				);
			}
			const parent = (await git(root, ["rev-parse", "HEAD"])).trim();
			await git(root, ["commit", "--file=-"], params.message);
			const sha = (await git(root, ["rev-parse", "HEAD"])).trim();
			const after = await refs(root);
			const branchRef = `refs/heads/${grant.branch}`;
			const moved = [...new Set([...before.keys(), ...after.keys()])].filter(
				(ref) => ref !== branchRef && before.get(ref) !== after.get(ref),
			);
			if (moved.length > 0) {
				throw new Error(
					`the checkpoint commit ${sha} changed other refs: ${moved.join(", ")}`,
				);
			}
			const parents = (await git(root, ["rev-list", "--parents", "-n", "1", sha]))
				.trim()
				.split(" ")
				.slice(1);
			if (parents.length !== 1 || parents[0] !== parent) {
				throw new Error(
					`the checkpoint commit ${sha} does not have ${parent} as its only parent`,
				);
			}
			if ((await head(root)) !== `refs/heads/${grant.branch}`) {
				throw new Error(`HEAD left refs/heads/${grant.branch} during the checkpoint ${sha}`);
			}
			const object = await git(root, ["cat-file", "commit", sha]);
			const fields = object.slice(0, object.indexOf("\n\n")).split("\n");
			if (!fields.some((line) => /^gpgsig(-sha256)? /.test(line))) {
				throw new Error(`the checkpoint commit ${sha} is not signed`);
			}
			const entries = (
				await git(root, [
					"diff-tree",
					"--no-commit-id",
					"--name-status",
					"--no-renames",
					"-z",
					"-r",
					sha,
				])
			).split("\0");
			const changes: [string, string][] = [];
			for (let at = 0; at + 1 < entries.length; at += 2) {
				changes.push([entries[at], entries[at + 1]]);
			}
			const files = changes.map(([status, file]) => `${status}\t${file}`);
			const unauthorized = changes
				.map(([, file]) => file)
				.filter(
					(file) => !paths.some((path) => file === path || file.startsWith(`${path}/`)),
				);
			if (unauthorized.length > 0) {
				throw new Error(
					`the checkpoint commit ${sha} contains files outside the checkpoint paths: ${unauthorized.join(", ")}`,
				);
			}
			const checkpoint = { sha, parent, base: grant.base, branch: grant.branch };
			checkpointed(checkpoint);
			return {
				content: [
					{
						type: "text" as const,
						text: [
							`Checkpoint ${sha} on ${grant.branch}.`,
							`parent: ${parent}`,
							`base: ${grant.base}`,
							"files:",
							...files.map((file) => `- ${file}`),
						].join("\n"),
					},
				],
				details: { ...checkpoint, files },
			};
		},
	};
}
