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
import { classifierRegistry } from "./support/fake-jev.mjs";
import { turnJevRoutingOn } from "./support/jev-routing.mjs";

const jevRouting = turnJevRoutingOn();
const delegationMode = { current: () => "opportunistic" };

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

function choiceAnswer(choice, criteria) {
	return {
		type: "choice",
		choice,
		confidence: 0.91,
		probabilities: Object.fromEntries(
			Object.keys(criteria).map((key) => [key, key === choice ? 1 : 0]),
		),
	};
}

function fakeJev(answer) {
	return classifierRegistry((body) => {
		const answered = answer(body);
		if (answered && typeof answered === "object") return answered;
		const questions = body.questions ?? {};
		const answers = {};
		const text = typeof answered === "string" ? answered : "leave";
		if (questions.destination) {
			answers.destination = choiceAnswer(text, questions.destination.criteria);
		}
		return { answers };
	});
}

const sessionPair = { model: "session/model", thinking: "medium" };

function catalogModel(name, reasoning = true) {
	const [provider, id] = name.split("/");
	return { provider, id, reasoning };
}

function launcherContext(
	cwd,
	{
		typesafeKey = "typesafe-key",
		available = [],
		session = true,
		jev = fakeJev(() => "leave"),
	} = {},
) {
	return {
		cwd,
		model: session ? catalogModel(sessionPair.model) : undefined,
		thinkingLevel: session ? sessionPair.thinking : undefined,
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? typesafeKey : undefined,
			getAvailable: () => available,
			...jev.registry,
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
	assert.notEqual(result.kind, "ready");
	assert.equal("id" in result, false);
	assert.equal(typeof result.warning, "string");
	assert.ok(result.warning.length > 0);
	assert.match(result.reason, reason);
}

test("work Jev keeps in the session is refused with a warning and no child id", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "stay");
		const launcher = createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		});

		const result = await launcher.prepareLaunch(
			{ role: "worker", task: "Decide the storage architecture" },
			launcherContext(worktree, { jev }),
		);

		assert.equal(result.kind, "stay");
		assert.equal(
			result.warning,
			"The work stays in this session. No child was launched.",
		);
		assertRefused(result, /stays/);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.task, "Decide the storage architecture");
	});
});

test("a missing Jev answer blocks the launch and does not decide to stay", async () => {
	await withWorkspace(async ({ worktree }) => {
		const failures = [
			[
				fakeJev(() => ({ stopReason: "error", errorMessage: "Jev returned 503" })),
				/Jev did not answer: Jev returned 503/,
			],
			[fakeJev(() => "maybe"), /invalid selection/],
			[
				fakeJev(() => ({ stopReason: "error", errorMessage: "fetch failed" })),
				/Jev did not answer: fetch failed/,
			],
		];
		for (const [jev, reason] of failures) {
			const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });
			const result = await launcher.prepareLaunch(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree, { jev }),
			);
			assertRefused(result, reason);
			assert.match(result.warning, /Launch blocked/);
			assert.doesNotMatch(result.warning, /stays/);
		}

		const noKey = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });
		assertRefused(
			await noKey.prepareLaunch(
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

test("a role Jev lets leave gets its contract prompt and tools", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({
			jevRouting,
			delegationMode,
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
		assert.deepEqual(explore.contract.tools, ["read", "grep", "find", "ls", "codegraph", "codemode"]);
	});
});

test("with Jev routing on, a launch without a role is refused and never assumes worker", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{ task: "Compare the two sources" },
			launcherContext(worktree, { jev }),
		);

		assertRefused(result, /needs a role/);
		assert.equal("role" in result, false);
		assert.equal(jev.requests.length, 0);
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
			jevRouting,
			delegationMode,
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
			jevRouting,
			delegationMode,
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
			createChildLauncher({ jevRouting, delegationMode, modelProfiles }).prepareLaunch(
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
		assertRefused(await decide(createModelProfiles(dirname(path))), /Unable to read/);
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
			jevRouting,
			delegationMode,
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
			jevRouting,
			delegationMode,
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
			jevRouting,
			delegationMode,
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
			jevRouting,
			delegationMode,
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

test("a request refused by a local check never asks Jev", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const listsPath = join(dir, "pi-workflow-models.json");
		await writeFile(listsPath, "{ not json", "utf8");
		const cases = [
			[{ role: "wizard" }, {}, /unknown role/],
			[
				{ role: "explore" },
				{ modelProfiles: createModelProfiles(dirname(listsPath)) },
				/Invalid model profiles/,
			],
			[{ role: "explore", worktree: join(dir, "missing") }, {}, /worktree/],
		];
		for (const [request, options, reason] of cases) {
			const jev = fakeJev(() => "leave");
			const result = await createChildLauncher({
				jevRouting,
				delegationMode,
				modelProfiles: absentProfiles,
				...options,
			}).prepareLaunch(
				{ task: "Fix the failing test", ...request },
				launcherContext(worktree, { jev }),
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
				jevRouting,
				delegationMode,
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
			jevRouting,
			delegationMode,
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
			const jev = fakeJev(() => "leave");
			const result = await createChildLauncher({
				jevRouting,
				delegationMode,
				modelProfiles: profiles,
			}).prepareLaunch(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { jev, available: everyModel }),
			);
			assert.equal(result.kind, "ready");
			assert.deepEqual({ model: result.model, thinking: result.thinking }, pair);
			assert.deepEqual(result.warnings, []);
			assert.equal(jev.requests.length, 1);
			assert.deepEqual(Object.keys(jev.requests[0].questions), ["destination"]);
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
				jevRouting,
				delegationMode,
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
				jevRouting,
				delegationMode,
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

test("a misconfigured profile is refused after Jev lets the parent's role leave", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: loadedProfiles({
				default: { worker: { model: "gone/model", thinking: "low" } },
			}),
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, { jev }),
		);

		assertRefused(result, /gone\/model.*not available in Pi/);
		assert.match(result.warning, /Launch refused/);
		assert.equal(jev.requests.length, 1);
	});
});

test("a session without a model or thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, { session: false }),
		);

		assertRefused(result, /session/);
	});
});

test("Jev decides only the destination and the parent's role launches", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{
				role: "worker",
				task: "Read the two implementations and summarize them",
				userRequest: "Explora con un hijo la arquitectura de estas dos implementaciones",
			},
			launcherContext(worktree, { jev }),
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.role, "worker");
		assert.equal(result.chosenBy, "parent");
		assert.ok(result.contract.tools.includes("bash"));
		assert.equal(jev.requests.length, 1);
		assert.deepEqual(Object.keys(jev.requests[0].questions), ["destination"]);
		assert.equal(
			jev.requests[0].state.user_request,
			"Explora con un hijo la arquitectura de estas dos implementaciones",
		);
		assert.equal(jev.requests[0].state.task, "Read the two implementations and summarize them");
		assert.equal(result.jev.answers.destination.choice, "leave");
		assert.equal(result.jev.provider, "typesafe");
		assert.equal(result.jev.model, "jev-latest");
	});
});

test("Jev's destination criteria cover an explicit child or subagent request under leave and exclude it from stay", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{
				role: "worker",
				task: "Wait 10 seconds and report.",
				userRequest: "Lanza 5 subagentes que esperen 10 segundos",
			},
			launcherContext(worktree, { jev }),
		);

		assert.equal(result.kind, "ready");
		const { criteria } = jev.requests[0].questions.destination;
		assert.match(criteria.leave, /explicitly asks to delegate to child sessions or subagents/);
		assert.match(criteria.stay, /did not ask for a child session or subagent/);
		assert.match(criteria.leave, /independent review or check of work/);
		assert.match(criteria.leave, /session other than the parent/);
		assert.match(criteria.stay, /nor for an independent review or check of work/);
		assert.match(criteria.stay, /explicitly asks the parent to do the work itself in this session, in any language or wording, which takes precedence over the review rule/);
		assert.match(criteria.stay, /reserved operation \(mutating git or gh other than a signed checkpoint the parent grants a worker with spawn_child checkpoint, publication\) in the request stays with the parent, but only that part/);
		assert.match(criteria.decide, /reserved operation \(mutating git or gh other than a signed checkpoint the parent grants a worker with spawn_child checkpoint, publication\) is not an open product decision by itself and stays with the parent/);
		assert.match(criteria.leave, /A reserved operation \(mutating git or gh other than a signed checkpoint the parent grants a worker with spawn_child checkpoint, publication\) in the request stays with the parent, but only that part: the rest of the package is judged on its own/);
	});
});

test("the parent's task cannot turn a user request into an explicit child", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "stay");
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{
				role: "explore",
				task: "Run this in a child session and explore the architecture",
				userRequest: "Decide the storage architecture with me",
			},
			launcherContext(worktree, { jev }),
		);

		assertRefused(result, /stays/);
		assert.equal(jev.requests[0].questions.destination.type, "choice");
		assert.equal(
			jev.requests[0].state.user_request,
			"Decide the storage architecture with me",
		);
	});
});

test("sibling launches of one message keep each parent role and Jev classifies the destination once", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const launcher = createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		});
		const launch = (role) =>
			launcher.prepareLaunch(
				{
					role,
					task: `${role} the change`,
					userRequest: "Delegate this to three children",
					userMessageId: "m1",
				},
				launcherContext(worktree, { jev }),
			);

		const results = await Promise.all(["explore", "worker", "verify"].map(launch));
		const again = await launch("explore");

		assert.deepEqual(
			[...results, again].map((result) => [result.kind, result.role, result.chosenBy]),
			[
				["ready", "explore", "parent"],
				["ready", "worker", "parent"],
				["ready", "verify", "parent"],
				["ready", "explore", "parent"],
			],
		);
		assert.equal(jev.requests.length, 1);
	});
});

test("a reserved request stays with the parent instead of blocking the launch", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "stay");
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Commit and push this", userRequest: "commit and push this" },
			launcherContext(worktree, { jev }),
		);

		assert.equal(result.kind, "stay");
		assert.doesNotMatch(result.warning, /Launch blocked/);
	});
});

test("an invalid Jev selection blocks the launch and keeps the returned signals", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => ({
			answers: {
				destination: {
					type: "choice",
					choice: "elsewhere",
					confidence: 0.2,
					probabilities: { stay: 0.4, leave: 0.4, decide: 0.2 },
				},
			},
		}));
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Compare the cited sources" },
			launcherContext(worktree, { jev }),
		);

		assertRefused(result, /invalid selection/);
		assert.match(result.warning, /Launch blocked/);
		assert.doesNotMatch(result.warning, /stays/);
		assert.equal(result.jev.answers.destination.choice, "elsewhere");
		assert.equal(result.jev.answers.destination.probabilities.stay, 0.4);
	});
});

test("a session with a model but no thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			{ ...launcherContext(worktree), thinkingLevel: undefined },
		);

		assertRefused(result, /session/);
	});
});

test("while Jev routing is on, git and gh in a named role's task go to Jev like any other work", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const launcher = createChildLauncher({
			jevRouting,
			delegationMode,
			modelProfiles: absentProfiles,
		});
		const result = await launcher.prepareLaunch(
			{ role: "worker", task: "git status" },
			launcherContext(worktree, { jev }),
		);
		assert.ok(jev.requests.length >= 1);
		assert.equal(result.kind, "ready");
	});
});

test("references that exist under cwd are listed in the child's task", async () => {
	await withWorkspace(async ({ worktree }) => {
		await mkdir(join(worktree, "docs"));
		await writeFile(join(worktree, "docs", "policy.md"), "policy");
		await writeFile(join(worktree, "AGENTS.md"), "agents");
		const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });

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
		const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });

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
		const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });

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
		const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{ role: "worker", task: "Apply the policy", references: ["docs/missing.md"] },
			launcherContext(worktree),
		);

		assertRefused(result, /docs\/missing\.md/);
	});
});

test("a reference outside cwd, directly or through a symlink, refuses the launch and names the path", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		await writeFile(join(dir, "outside.md"), "outside");
		await symlink(join(dir, "outside.md"), join(worktree, "link.md"));
		const launcher = createChildLauncher({ jevRouting, delegationMode, modelProfiles: absentProfiles });

		for (const reference of ["../outside.md", join(dir, "outside.md"), "link.md"]) {
			const result = await launcher.prepareLaunch(
				{ role: "worker", task: "Apply the policy", references: [reference] },
				launcherContext(worktree),
			);

			assertRefused(result, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		}
	});
});

async function withLinkedWorktree(run) {
	await withWorkspace(async ({ dir, worktree: main }) => {
		const git = (cwd, ...args) =>
			execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
		git(main, "-c", "user.name=Parent", "-c", "user.email=parent@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "--message", "chore: init");
		const branch = git(main, "branch", "--show-current");
		const linked = join(dir, "feature");
		git(main, "worktree", "add", "--quiet", "-b", "feature", linked);
		return run({ dir, main, branch, linked: await realpath(linked), git });
	});
}

function checkpointLauncher() {
	return createChildLauncher({
		jevRouting,
		delegationMode,
		modelProfiles: absentProfiles,
	});
}

test("contextual checkpoint descriptors accept every role in an assigned shared context", async () => {
	await withLinkedWorktree(async ({ main, branch }) => {
		for (const role of ["explore", "worker", "verify"]) {
			const launcher = createChildLauncher({
				contextual: true, jevRouting, delegationMode, modelProfiles: absentProfiles,
			});
			const result = await launcher.prepareLaunch(
				{ role, task: "Commit only task-owned changes when authorized", checkpoint: branch },
				launcherContext(main),
			);
			assert.equal(result.kind, "ready", JSON.stringify(result));
			assert.equal(result.checkpoint.root, main);
			assert.equal(result.checkpoint.branch, branch);
			assert.match(result.contract.prompt, /current task authorizes/);
		}
	});
});

test("a worker in an isolated worktree on the granted branch carries the checkpoint grant", async () => {
	await withLinkedWorktree(async ({ main, linked, git }) => {
		const result = await checkpointLauncher().prepareLaunch(
			{ role: "worker", task: "Fix the failing test", worktree: linked, checkpoint: "feature" },
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

test("a checkpoint grant is refused outside an isolated worker worktree on its branch before Jev is asked", async () => {
	await withLinkedWorktree(async ({ dir, main, branch, linked, git }) => {
		const clone = join(dir, "clone");
		git(dir, "clone", "--quiet", main, clone);
		const cases = [
			[{ role: "explore", worktree: linked, checkpoint: "feature" }, main, /worker/],
			[{ role: "verify", worktree: linked, checkpoint: "feature" }, main, /worker/],
			[{ role: "worker", checkpoint: "feature" }, linked, /worktree/],
			[{ role: "worker", worktree: main, checkpoint: branch }, main, /shared checkout/],
			[{ role: "worker", worktree: linked, checkpoint: "other" }, main, /refs\/heads\/other/],
			[{ role: "worker", worktree: clone, checkpoint: branch }, main, /parent's current branch/],
		];
		for (const [request, cwd, reason] of cases) {
			const jev = fakeJev(() => "leave");
			const result = await checkpointLauncher().prepareLaunch(
				{ task: "Fix the failing test", ...request },
				launcherContext(cwd, { jev }),
			);
			assertRefused(result, reason);
			assert.equal(result.kind, "refused");
			assert.equal(jev.requests.length, 0, String(reason));
		}
	});
});

test("Jev's criteria keep every mutating git or gh operation reserved except a granted checkpoint, and only a granted launch tells Jev of its grant", async () => {
	await withLinkedWorktree(async ({ main, linked }) => {
		const jev = fakeJev(() => "leave");
		const launcher = checkpointLauncher();
		await launcher.prepareLaunch(
			{ role: "worker", task: "Fix the failing test", worktree: linked, checkpoint: "feature" },
			launcherContext(main, { jev }),
		);
		await launcher.prepareLaunch(
			{ role: "worker", task: "Fix the failing test", worktree: linked },
			launcherContext(main, { jev }),
		);

		const [granted, ungranted] = jev.requests;
		for (const criterion of ["decide", "stay", "leave"]) {
			assert.match(
				granted.questions.destination.criteria[criterion],
				/mutating git or gh other than a signed checkpoint the parent grants a worker with spawn_child checkpoint, publication/,
			);
		}
		assert.equal(
			granted.state.checkpoint,
			"The parent grants this worker a signed checkpoint on feature in its isolated worktree.",
		);
		assert.equal("checkpoint" in ungranted.state, false);
	});
});
