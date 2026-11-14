import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { createModelProfiles } from "../extensions/model-profiles.ts";

const realContracts = fileURLToPath(
	new URL("../assets/contracts/", import.meta.url),
);

async function withWorkspace(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-child-launcher-"));
	try {
		const worktree = join(dir, "repo");
		await mkdir(worktree);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		return await run({ dir, worktree });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const sessionPair = { model: "session/model", thinking: "medium" };

function catalogModel(name, reasoning = true) {
	const [provider, id] = name.split("/");
	return { provider, id, reasoning };
}

function launcherContext(cwd, { available = [], session = true } = {}) {
	return {
		cwd,
		model: session ? catalogModel(sessionPair.model) : undefined,
		thinkingLevel: session ? sessionPair.thinking : undefined,
		modelRegistry: { getAvailable: () => available },
	};
}

function loadedProfiles(profiles, active = "default") {
	return {
		load: () => ({
			status: "loaded",
			profiles: { schemaVersion: 2, active, profiles },
		}),
	};
}

const absentProfiles = { load: () => ({ status: "absent" }) };

function assertRefused(result, reason) {
	assert.notEqual(result.kind, "ready");
	assert.equal("id" in result, false);
	assert.equal(typeof result.warning, "string");
	assert.ok(result.warning.length > 0);
	assert.match(result.reason, reason);
}

async function copyContracts(dir, roles) {
	const contracts = join(dir, "contracts");
	await mkdir(contracts);
	for (const role of roles) {
		await copyFile(
			join(realContracts, `${role}.md`),
			join(contracts, `${role}.md`),
		);
	}
	return contracts;
}

test("a role the parent names gets its contract prompt and tools", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
		});
		for (const role of ["explore", "worker", "verify"]) {
			const result = await launcher.prepareLaunch(
				{ role, task: "Map the launcher module" },
				launcherContext(worktree),
			);
			assert.equal(result.kind, "ready");
			assert.equal(result.role, role);
			assert.equal(result.task, "Map the launcher module");
			assert.deepEqual(result.warnings, []);
			assert.match(result.contract.prompt, new RegExp(`You are an? ${role}`));
			assert.ok(result.contract.tools.includes("read"));
		}

		const explore = await launcher.prepareLaunch(
			{ role: "explore", task: "Map the launcher module" },
			launcherContext(worktree),
		);
		assert.deepEqual(explore.contract.tools, [
			"read",
			"grep",
			"find",
			"ls",
			"codegraph",
			"codemode",
		]);
	});
});

test("a named role launches without reading the task text or consulting a classifier", async () => {
	await withWorkspace(async ({ worktree }) => {
		const classified = [];
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });
		const ctx = {
			cwd: worktree,
			model: catalogModel(sessionPair.model),
			thinkingLevel: sessionPair.thinking,
			modelRegistry: {
				getAvailable: () => [],
				classify: async (...request) => {
					classified.push(request);
					throw new Error("no classifier is registered");
				},
			},
		};

		for (const [role, task] of [
			["worker", "git status"],
			["worker", "  gh pr create --fill"],
			["verify", "Check the branch (git)"],
			["explore", "Map how the parser calls git"],
			["worker", "Fix the parser"],
		]) {
			const launched = await launcher.prepareLaunch({ role, task }, ctx);
			assert.equal(launched.kind, "ready");
			assert.equal(launched.role, role);
			assert.equal(launched.task, task);
		}
		assert.deepEqual(classified, []);
	});
});

test("a launch without a role is refused and never assumes worker", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{ task: "Compare the two sources" },
			launcherContext(worktree),
		);

		assertRefused(result, /needs a role/);
		assert.equal("role" in result, false);
	});
});

test("an unknown role is refused even when a contract file has its name", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const contractsDirectory = await copyContracts(dir, [
			"explore",
			"worker",
			"verify",
		]);
		await writeFile(
			join(contractsDirectory, "wizard.md"),
			"---\ntools: read\n---\nYou are a wizard.\n",
		);
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
			contractsDirectory,
		});

		const result = await launcher.prepareLaunch(
			{ role: "wizard", task: "Fix the failing test" },
			launcherContext(worktree),
		);

		assertRefused(result, /unknown role wizard/);
		assert.equal("role" in result, false);
	});
});

test("a missing or unreadable contract is refused and never falls back to worker", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const contractsDirectory = await copyContracts(dir, ["explore", "verify"]);
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
			contractsDirectory,
		});

		const missing = await launcher.prepareLaunch(
			{ role: "worker", task: "Fix the failing test" },
			launcherContext(worktree),
		);
		assertRefused(missing, /contract for worker/);
		assert.doesNotMatch(missing.reason, /unknown role/);

		await rm(join(contractsDirectory, "explore.md"));
		await mkdir(join(contractsDirectory, "explore.md"));
		await writeFile(join(contractsDirectory, "verify.md"), "no front matter\n");
		for (const role of ["explore", "verify"]) {
			const unreadable = await launcher.prepareLaunch(
				{ role, task: "Fix the failing test" },
				launcherContext(worktree),
			);
			assertRefused(unreadable, new RegExp(`contract for ${role}`));
			assert.equal("role" in unreadable, false);
		}
	});
});

test("an invalid, schema version 1, or unreadable model profiles file is refused, not treated as absent", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const path = join(dir, "pi-workflow-models.json");
		const decide = (modelProfiles) =>
			createChildLauncher({ modelProfiles }).prepareLaunch(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);

		await writeFile(path, "{ not json", "utf8");
		const invalid = await decide(createModelProfiles(dirname(path)));
		assertRefused(invalid, /Invalid model profiles/);
		assert.ok(invalid.reason.includes(path));

		await writeFile(
			path,
			JSON.stringify({
				schemaVersion: 1,
				specialists: { implement: [{ model: "x/y", thinking: "low" }] },
				tiers: {},
				taskTypes: {},
			}),
			"utf8",
		);
		assertRefused(
			await decide(createModelProfiles(dirname(path))),
			/schema version 1.*recreate the profiles/,
		);

		await rm(path);
		await mkdir(path);
		assertRefused(
			await decide(createModelProfiles(dirname(path))),
			/Unable to read/,
		);
	});
});

test("a model profiles file created in this turn is not read and is not a refusal", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const path = join(dir, "pi-workflow-models.json");
		const modelProfiles = createModelProfiles(dirname(path));
		await writeFile(
			path,
			JSON.stringify({
				schemaVersion: 2,
				active: "default",
				profiles: {
					default: { worker: { model: "new/model", thinking: "low" } },
				},
			}),
			"utf8",
		);

		const result = await createChildLauncher({
			modelProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Fix the failing test" },
			launcherContext(worktree, { available: [catalogModel("new/model")] }),
		);

		assert.equal(result.kind, "ready");
		assert.deepEqual(
			{ model: result.model, thinking: result.thinking },
			sessionPair,
		);
	});
});

test("an invalid worktree is refused before any child would be created", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const plain = join(dir, "plain");
		await mkdir(plain);
		const nested = join(worktree, "src");
		await mkdir(nested);
		const file = join(dir, "file.txt");
		await writeFile(file, "not a directory", "utf8");
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
		});

		for (const candidate of [join(dir, "missing"), file, plain, nested]) {
			const result = await launcher.prepareLaunch(
				{ role: "worker", task: "Fix the failing test", worktree: candidate },
				launcherContext(worktree),
			);
			assertRefused(result, /worktree/);
			assert.ok(result.reason.includes(candidate));
		}

		assertRefused(
			await launcher.prepareLaunch(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(nested),
			),
			/worktree/,
		);
	});
});

test("a Git root worktree is the launch root", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
		});

		const explicit = await launcher.prepareLaunch(
			{ role: "worker", task: "Fix the failing test", worktree },
			launcherContext(dir),
		);
		assert.equal(explicit.kind, "ready");
		assert.equal(explicit.worktree, await realpath(worktree));

		const fromSession = await launcher.prepareLaunch(
			{ role: "worker", task: "Fix the failing test" },
			launcherContext(worktree),
		);
		assert.equal(fromSession.worktree, await realpath(worktree));

		const relativePath = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "Fix the failing test",
				worktree: relative(dir, worktree),
			},
			launcherContext(dir),
		);
		assert.equal(relativePath.kind, "ready");
		assert.equal(relativePath.worktree, await realpath(worktree));

		const link = join(dir, "link");
		await symlink(worktree, link);
		const throughLink = await launcher.prepareLaunch(
			{ role: "worker", task: "Fix the failing test", worktree: link },
			launcherContext(dir),
		);
		assert.equal(throughLink.kind, "ready");
		assert.equal(throughLink.worktree, await realpath(worktree));
	});
});

test("a parent .pi/mcp.json absent from the worktree is reported at launch, not inherited", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
		});
		const parent = join(dir, "parent");
		await mkdir(join(parent, ".pi"), { recursive: true });
		await writeFile(join(parent, ".pi", "mcp.json"), "{}");

		const missing = await launcher.prepareLaunch(
			{ role: "explore", task: "Map the code", worktree },
			launcherContext(parent),
		);
		assert.equal(missing.kind, "ready");
		assert.deepEqual(missing.warnings, [
			`The parent's .pi/mcp.json is absent from the worktree ${await realpath(worktree)}; the child does not inherit it.`,
		]);

		await mkdir(join(worktree, ".pi"));
		await writeFile(join(worktree, ".pi", "mcp.json"), "{}");
		const present = await launcher.prepareLaunch(
			{ role: "explore", task: "Map the code", worktree },
			launcherContext(parent),
		);
		assert.deepEqual(present.warnings, []);

		const same = await launcher.prepareLaunch(
			{ role: "explore", task: "Map the code" },
			launcherContext(worktree),
		);
		assert.deepEqual(same.warnings, []);
	});
});

test("a contract saved with CRLF line endings reads like the LF one", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const contractsDirectory = await copyContracts(dir, ["worker"]);
		const path = join(contractsDirectory, "worker.md");
		const lf = await readFile(path, "utf8");
		await writeFile(path, lf.replaceAll("\n", "\r\n"), "utf8");
		const decide = (directory) =>
			createChildLauncher({
				modelProfiles: absentProfiles,
				contractsDirectory: directory,
			}).prepareLaunch(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);

		const crlf = await decide(contractsDirectory);
		const reference = await decide(realContracts);

		assert.equal(crlf.kind, "ready");
		assert.deepEqual(crlf.contract, reference.contract);
	});
});

test("git location variables in the environment cannot make a false worktree root valid", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const plain = join(dir, "plain");
		await mkdir(plain);
		const nested = join(worktree, "src");
		await mkdir(nested);
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
		});
		const cases = [
			[plain, { GIT_DIR: join(worktree, ".git") }],
			[nested, { GIT_WORK_TREE: nested }],
		];
		for (const [candidate, variables] of cases) {
			const saved = { ...process.env };
			Object.assign(process.env, variables);
			try {
				const result = await launcher.prepareLaunch(
					{ role: "worker", task: "Fix the failing test", worktree: candidate },
					launcherContext(dir),
				);
				assertRefused(result, /worktree/);
			} finally {
				for (const name of Object.keys(variables)) {
					if (name in saved) process.env[name] = saved[name];
					else delete process.env[name];
				}
			}
		}
	});
});

const everyRole = {
	explorer: { model: "fast/scout", thinking: "low" },
	worker: { model: "steady/coder", thinking: "medium" },
	verifier: { model: "sharp/judge", thinking: "high" },
};

const everyModel = [
	catalogModel("fast/scout"),
	catalogModel("steady/coder"),
	catalogModel("sharp/judge"),
	catalogModel("session/model"),
];

test("each role the parent chooses runs the model and thinking of that entry in the active profile", async () => {
	await withWorkspace(async ({ worktree }) => {
		const profiles = loadedProfiles(
			{ other: {}, main: everyRole, unused: { worker: everyRole.verifier } },
			"main",
		);
		const expected = {
			explore: everyRole.explorer,
			worker: everyRole.worker,
			verify: everyRole.verifier,
		};
		for (const [role, pair] of Object.entries(expected)) {
			const result = await createChildLauncher({
				modelProfiles: profiles,
			}).prepareLaunch(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { available: everyModel }),
			);
			assert.equal(result.kind, "ready");
			assert.deepEqual(
				{ model: result.model, thinking: result.thinking },
				pair,
			);
			assert.deepEqual(result.warnings, []);
		}
	});
});

test("a specialist missing from the active profile, or no profiles file, inherits the session model and thinking", async () => {
	await withWorkspace(async ({ worktree }) => {
		const cases = [
			[absentProfiles, "worker"],
			[loadedProfiles({ default: {} }), "worker"],
			[loadedProfiles({ default: { worker: everyRole.worker } }), "explore"],
			[loadedProfiles({ default: { explorer: everyRole.explorer } }), "verify"],
			[loadedProfiles({ default: {}, other: everyRole }), "worker"],
		];
		for (const [modelProfiles, role] of cases) {
			const result = await createChildLauncher({
				modelProfiles,
			}).prepareLaunch(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { available: everyModel }),
			);
			assert.equal(result.kind, "ready");
			assert.deepEqual(
				{ model: result.model, thinking: result.thinking },
				sessionPair,
			);
		}
	});
});

test("a configured model Pi cannot run is refused with the profile, specialist, and model, and never falls back", async () => {
	await withWorkspace(async ({ worktree }) => {
		const cases = [
			[
				{ worker: { model: "gone/model", thinking: "low" } },
				[catalogModel("session/model")],
				/Profile main sets worker to gone\/model at low, but that model is not available in Pi\./,
			],
			[
				{ worker: { model: "plain/model", thinking: "high" } },
				[catalogModel("plain/model", false), catalogModel("session/model")],
				/Profile main sets worker to plain\/model at high, but that model does not support thinking high\./,
			],
		];
		for (const [profile, available, reason] of cases) {
			const result = await createChildLauncher({
				modelProfiles: loadedProfiles({ main: profile }, "main"),
			}).prepareLaunch(
				{ role: "worker", task: "Add the export command" },
				launcherContext(worktree, { available }),
			);
			assertRefused(result, reason);
			assert.match(result.warning, /Launch refused/);
			assert.equal("model" in result, false);
		}
	});
});

test("a misconfigured profile is refused for the parent's role", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelProfiles: loadedProfiles({
				default: { worker: { model: "gone/model", thinking: "low" } },
			}),
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree),
		);

		assertRefused(result, /gone\/model.*not available in Pi/);
		assert.match(result.warning, /Launch refused/);
	});
});

test("a session without a model or thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, { session: false }),
		);

		assertRefused(result, /session/);
	});
});

test("a session with a model but no thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			{ ...launcherContext(worktree), thinkingLevel: undefined },
		);

		assertRefused(result, /session/);
	});
});

test("references that exist under cwd are listed in the child's task", async () => {
	await withWorkspace(async ({ worktree }) => {
		await mkdir(join(worktree, "docs"));
		await writeFile(join(worktree, "docs", "policy.md"), "policy");
		await writeFile(join(worktree, "AGENTS.md"), "agents");
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "Apply the policy",
				references: ["docs/policy.md", "AGENTS.md"],
			},
			launcherContext(worktree),
		);

		assert.equal(result.kind, "ready");
		assert.match(result.task, /^Apply the policy/);
		assert.match(result.task, /docs\/policy\.md/);
		assert.match(result.task, /AGENTS\.md/);
		assert.deepEqual(result.references, ["docs/policy.md", "AGENTS.md"]);
		assert.equal(result.chosenBy, "parent");
	});
});

test("references checked from a subdirectory reach the child as absolute paths", async () => {
	await withWorkspace(async ({ worktree }) => {
		await mkdir(join(worktree, "docs"));
		await writeFile(join(worktree, "docs", "policy.md"), "policy");
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "Apply the policy",
				references: ["policy.md"],
				worktree: "..",
			},
			launcherContext(join(worktree, "docs")),
		);

		assert.equal(result.kind, "ready");
		const absolute = await realpath(join(worktree, "docs", "policy.md"));
		assert.match(
			result.task,
			new RegExp(`\\n- ${absolute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
		);
	});
});

test("a launch without references keeps the task unchanged", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{ role: "worker", task: "Apply the policy" },
			launcherContext(worktree),
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.task, "Apply the policy");
	});
});

test("a reference that does not exist refuses the launch and names the path", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "Apply the policy",
				references: ["docs/missing.md"],
			},
			launcherContext(worktree),
		);

		assertRefused(result, /docs\/missing\.md/);
	});
});

test("a reference outside cwd, directly or through a symlink, refuses the launch and names the path", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		await writeFile(join(dir, "outside.md"), "outside");
		await symlink(join(dir, "outside.md"), join(worktree, "link.md"));
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		for (const reference of [
			"../outside.md",
			join(dir, "outside.md"),
			"link.md",
		]) {
			const result = await launcher.prepareLaunch(
				{ role: "worker", task: "Apply the policy", references: [reference] },
				launcherContext(worktree),
			);

			assertRefused(
				result,
				new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			);
		}
	});
});

async function withLinkedWorktree(run) {
	await withWorkspace(async ({ dir, worktree: main }) => {
		const git = (cwd, ...args) =>
			execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
		git(
			main,
			"-c",
			"user.name=Parent",
			"-c",
			"user.email=parent@example.com",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--quiet",
			"--allow-empty",
			"--message",
			"chore: init",
		);
		const branch = git(main, "branch", "--show-current");
		const linked = join(dir, "feature");
		git(main, "worktree", "add", "--quiet", "-b", "feature", linked);
		return run({ dir, main, branch, linked: await realpath(linked), git });
	});
}

function checkpointLauncher() {
	return createChildLauncher({
		modelProfiles: absentProfiles,
	});
}

test("contextual checkpoint descriptors accept every role in an assigned shared context", async () => {
	await withLinkedWorktree(async ({ main, branch }) => {
		for (const role of ["explore", "worker", "verify"]) {
			const launcher = createChildLauncher({
				contextual: true,
				modelProfiles: absentProfiles,
			});
			const result = await launcher.prepareLaunch(
				{
					role,
					task: "Commit only task-owned changes when authorized",
					checkpoint: branch,
				},
				launcherContext(main),
			);
			assert.equal(result.kind, "ready", JSON.stringify(result));
			assert.equal(result.checkpoint.root, await realpath(main));
			assert.equal(result.checkpoint.branch, branch);
			assert.match(result.contract.prompt, /current task authorizes/);
		}
	});
});

test("a worker in an isolated worktree on the granted branch carries the checkpoint grant", async () => {
	await withLinkedWorktree(async ({ main, linked, git }) => {
		const result = await checkpointLauncher().prepareLaunch(
			{
				role: "worker",
				task: "Fix the failing test",
				worktree: linked,
				checkpoint: "feature",
			},
			launcherContext(main),
		);

		assert.equal(result.kind, "ready");
		assert.deepEqual(result.checkpoint, {
			branch: "feature",
			root: linked,
			gitDir: await realpath(git(linked, "rev-parse", "--absolute-git-dir")),
			commonDir: await realpath(join(main, ".git")),
			base: git(linked, "rev-parse", "HEAD"),
		});
	});
});

test("a launch without a checkpoint carries no grant", async () => {
	await withLinkedWorktree(async ({ main, linked }) => {
		const result = await checkpointLauncher().prepareLaunch(
			{ role: "worker", task: "Fix the failing test", worktree: linked },
			launcherContext(main),
		);

		assert.equal(result.kind, "ready");
		assert.equal("checkpoint" in result, false);
	});
});

test("a checkpoint grant is refused outside an isolated worker worktree on its branch", async () => {
	await withLinkedWorktree(async ({ dir, main, branch, linked, git }) => {
		const clone = join(dir, "clone");
		git(dir, "clone", "--quiet", main, clone);
		const cases = [
			[
				{ role: "explore", worktree: linked, checkpoint: "feature" },
				main,
				/worker/,
			],
			[
				{ role: "verify", worktree: linked, checkpoint: "feature" },
				main,
				/worker/,
			],
			[{ role: "worker", checkpoint: "feature" }, linked, /worktree/],
			[
				{ role: "worker", worktree: main, checkpoint: branch },
				main,
				/shared checkout/,
			],
			[
				{ role: "worker", worktree: linked, checkpoint: "other" },
				main,
				/refs\/heads\/other/,
			],
			[
				{ role: "worker", worktree: clone, checkpoint: branch },
				main,
				/parent's current branch/,
			],
		];
		for (const [request, cwd, reason] of cases) {
			const result = await checkpointLauncher().prepareLaunch(
				{ task: "Fix the failing test", ...request },
				launcherContext(cwd),
			);
			assertRefused(result, reason);
			assert.equal(result.kind, "refused");
		}
	});
});
