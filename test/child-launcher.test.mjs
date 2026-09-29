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
import { join, relative } from "node:path";
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

function fakeJev(answer) {
	const requests = [];
	const fetch = async (_url, init) => {
		const body = JSON.parse(init.body);
		requests.push(body);
		const answered = answer(body);
		if (answered instanceof Response) return answered;
		return Response.json({
			answers: { choice: { choice: answered, confidence: 0.9 } },
		});
	};
	return { fetch, requests };
}

const sessionPair = { model: "session/model", thinking: "medium" };

function catalogModel(name, reasoning = true) {
	const [provider, id] = name.split("/");
	return { provider, id, reasoning };
}

function launcherContext(
	cwd,
	{ typesafeKey = "typesafe-key", available = [], session = true } = {},
) {
	return {
		cwd,
		model: session ? catalogModel(sessionPair.model) : undefined,
		thinkingLevel: session ? sessionPair.thinking : undefined,
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? typesafeKey : undefined,
			getAvailable: () => available,
		},
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
	assert.equal(result.status, "refused");
	assert.equal("id" in result, false);
	assert.equal(typeof result.warning, "string");
	assert.ok(result.warning.length > 0);
	assert.match(result.reason, reason);
}

test("work Jev keeps in the session is refused with a warning and no child id", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "stay");
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
			fetch: jev.fetch,
		});

		const result = await launcher.decide(
			{ role: "worker", task: "Decide the storage architecture" },
			launcherContext(worktree),
		);

		assertRefused(result, /stays/);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.task, "Decide the storage architecture");
	});
});

test("work stays with a warning and no child id when Jev gives no answer", async () => {
	await withWorkspace(async ({ worktree }) => {
		const failures = [
			{ fetch: fakeJev(() => new Response("down", { status: 503 })).fetch },
			{ fetch: fakeJev(() => "maybe").fetch },
			{
				fetch: async () => {
					throw new TypeError("fetch failed");
				},
			},
		];
		for (const { fetch } of failures) {
			const launcher = createChildLauncher({ modelProfiles: absentProfiles, fetch });
			const result = await launcher.decide(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);
			assertRefused(result, /Jev/);
		}

		const noKey = createChildLauncher({
			modelProfiles: absentProfiles,
			fetch: fakeJev(() => "leave").fetch,
		});
		assertRefused(
			await noKey.decide(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree, { typesafeKey: null }),
			),
			/TypeSafe/,
		);
	});
});

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

const leave = () => fakeJev(() => "leave").fetch;

test("a role Jev lets leave gets its contract prompt and tools", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
			fetch: leave(),
		});
		for (const role of ["explore", "worker", "verify"]) {
			const result = await launcher.decide(
				{ role, task: "Map the launcher module" },
				launcherContext(worktree),
			);
			assert.equal(result.status, "launch");
			assert.equal(result.role, role);
			assert.equal(result.task, "Map the launcher module");
			assert.deepEqual(result.warnings, []);
			assert.match(result.contract.prompt, new RegExp(`You are an? ${role}`));
			assert.ok(result.contract.tools.includes("read"));
		}

		const explore = await launcher.decide(
			{ role: "explore", task: "Map the launcher module" },
			launcherContext(worktree),
		);
		assert.deepEqual(explore.contract.tools, ["read", "grep", "find", "ls"]);
	});
});

test("a missing role uses worker and warns", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
			fetch: leave(),
		});

		const result = await launcher.decide(
			{ task: "Fix the failing test" },
			launcherContext(worktree),
		);

		assert.equal(result.status, "launch");
		assert.equal(result.role, "worker");
		assert.match(result.contract.prompt, /You are a worker/);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0], /worker/);
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
			fetch: leave(),
		});

		const result = await launcher.decide(
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
			fetch: leave(),
		});

		const missing = await launcher.decide(
			{ role: "worker", task: "Fix the failing test" },
			launcherContext(worktree),
		);
		assertRefused(missing, /contract for worker/);
		assert.doesNotMatch(missing.reason, /unknown role/);

		await rm(join(contractsDirectory, "explore.md"));
		await mkdir(join(contractsDirectory, "explore.md"));
		await writeFile(join(contractsDirectory, "verify.md"), "no front matter\n");
		for (const role of ["explore", "verify"]) {
			const unreadable = await launcher.decide(
				{ role, task: "Fix the failing test" },
				launcherContext(worktree),
			);
			assertRefused(unreadable, new RegExp(`contract for ${role}`));
			assert.equal("role" in unreadable, false);
		}

		const noRole = await launcher.decide(
			{ task: "Fix the failing test" },
			launcherContext(worktree),
		);
		assertRefused(noRole, /contract for worker/);
	});
});

test("an invalid, schema version 1, or unreadable model profiles file is refused, not treated as absent", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const path = join(dir, "pi-workflow-models.json");
		const decide = (modelProfiles) =>
			createChildLauncher({ modelProfiles, fetch: leave() }).decide(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);

		await writeFile(path, "{ not json", "utf8");
		const invalid = await decide(createModelProfiles({ path }));
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
			await decide(createModelProfiles({ path })),
			/schema version 1.*recreate the profiles/,
		);

		await rm(path);
		await mkdir(path);
		assertRefused(await decide(createModelProfiles({ path })), /Unable to read/);
	});
});

test("a model profiles file created in this turn is not read and is not a refusal", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const path = join(dir, "pi-workflow-models.json");
		const modelProfiles = createModelProfiles({ path });
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
			fetch: leave(),
		}).decide(
			{ role: "worker", task: "Fix the failing test" },
			launcherContext(worktree, { available: [catalogModel("new/model")] }),
		);

		assert.equal(result.status, "launch");
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
			fetch: leave(),
		});

		for (const candidate of [join(dir, "missing"), file, plain, nested]) {
			const result = await launcher.decide(
				{ role: "worker", task: "Fix the failing test", worktree: candidate },
				launcherContext(worktree),
			);
			assertRefused(result, /worktree/);
			assert.ok(result.reason.includes(candidate));
		}

		assertRefused(
			await launcher.decide(
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
			fetch: leave(),
		});

		const explicit = await launcher.decide(
			{ role: "worker", task: "Fix the failing test", worktree },
			launcherContext(dir),
		);
		assert.equal(explicit.status, "launch");
		assert.equal(explicit.worktree, await realpath(worktree));

		const fromSession = await launcher.decide(
			{ role: "worker", task: "Fix the failing test" },
			launcherContext(worktree),
		);
		assert.equal(fromSession.worktree, await realpath(worktree));

		const relativePath = await launcher.decide(
			{
				role: "worker",
				task: "Fix the failing test",
				worktree: relative(dir, worktree),
			},
			launcherContext(dir),
		);
		assert.equal(relativePath.status, "launch");
		assert.equal(relativePath.worktree, await realpath(worktree));

		const link = join(dir, "link");
		await symlink(worktree, link);
		const throughLink = await launcher.decide(
			{ role: "worker", task: "Fix the failing test", worktree: link },
			launcherContext(dir),
		);
		assert.equal(throughLink.status, "launch");
		assert.equal(throughLink.worktree, await realpath(worktree));
	});
});

test("a request refused by a local check never asks Jev", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const contractsDirectory = await copyContracts(dir, ["explore", "verify"]);
		const listsPath = join(dir, "pi-workflow-models.json");
		await writeFile(listsPath, "{ not json", "utf8");
		const cases = [
			[{ role: "wizard" }, {}, /unknown role/],
			[{ role: "worker" }, { contractsDirectory }, /contract for worker/],
			[
				{ role: "explore" },
				{ modelProfiles: createModelProfiles({ path: listsPath }) },
				/Invalid model profiles/,
			],
			[{ role: "explore", worktree: join(dir, "missing") }, {}, /worktree/],
		];
		for (const [request, options, reason] of cases) {
			const jev = fakeJev(() => "leave");
			const result = await createChildLauncher({
				modelProfiles: absentProfiles,
				fetch: jev.fetch,
				...options,
			}).decide(
				{ task: "Fix the failing test", ...request },
				launcherContext(worktree),
			);
			assertRefused(result, reason);
			assert.equal(jev.requests.length, 0, String(reason));
		}
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
				fetch: leave(),
			}).decide(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);

		const crlf = await decide(contractsDirectory);
		const reference = await decide(realContracts);

		assert.equal(crlf.status, "launch");
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
			fetch: leave(),
		});
		const cases = [
			[plain, { GIT_DIR: join(worktree, ".git") }],
			[nested, { GIT_WORK_TREE: nested }],
		];
		for (const [candidate, variables] of cases) {
			const saved = { ...process.env };
			Object.assign(process.env, variables);
			try {
				const result = await launcher.decide(
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

test("each role runs the model and thinking of its specialist in the active profile, with Jev asked only whether the work leaves", async () => {
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
			const jev = fakeJev(() => "leave");
			const result = await createChildLauncher({
				modelProfiles: profiles,
				fetch: jev.fetch,
			}).decide(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { available: everyModel }),
			);
			assert.equal(result.status, "launch");
			assert.deepEqual({ model: result.model, thinking: result.thinking }, pair);
			assert.deepEqual(result.warnings, []);
			assert.equal(jev.requests.length, 1);
			assert.deepEqual(Object.keys(jev.requests[0].questions), ["choice"]);
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
				fetch: leave(),
			}).decide(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { available: everyModel }),
			);
			assert.equal(result.status, "launch");
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
				fetch: leave(),
			}).decide(
				{ role: "worker", task: "Add the export command" },
				launcherContext(worktree, { available }),
			);
			assertRefused(result, reason);
			assert.match(result.warning, /Launch refused/);
			assert.equal("model" in result, false);
		}
	});
});

test("a misconfigured profile is refused without asking Jev", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "stay");
		const result = await createChildLauncher({
			modelProfiles: loadedProfiles({
				default: { worker: { model: "gone/model", thinking: "low" } },
			}),
			fetch: jev.fetch,
		}).decide(
			{ role: "worker", task: "Decide the storage architecture" },
			launcherContext(worktree),
		);

		assertRefused(result, /gone\/model.*not available in Pi/);
		assert.equal(jev.requests.length, 0);
	});
});

test("a session without a model or thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelProfiles: absentProfiles,
			fetch: leave(),
		}).decide(
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
			fetch: leave(),
		}).decide(
			{ role: "worker", task: "Add the export command" },
			{ ...launcherContext(worktree), thinkingLevel: undefined },
		);

		assertRefused(result, /session/);
	});
});
