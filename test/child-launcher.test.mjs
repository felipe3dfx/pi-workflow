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
import { classifierRegistry } from "./support/fake-jev.mjs";
import { turnJevRoutingOn } from "./support/jev-routing.mjs";

turnJevRoutingOn();

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
		const specialists = ["explorer", "worker", "verifier"];
		const text = typeof answered === "string" ? answered : "leave";
		const named = specialists.includes(text);
		const destinations = ["stay", "leave", "decide"];
		const suggested = body.state?.suggested_specialist;
		if (questions.specialist) {
			const picked = named
				? text
				: specialists.includes(suggested)
					? suggested
					: destinations.includes(text)
						? "worker"
						: text;
			answers.specialist = choiceAnswer(picked, questions.specialist.criteria);
		}
		if (questions.destination) {
			const picked = destinations.includes(text) ? text : named ? "leave" : text;
			answers.destination = choiceAnswer(picked, questions.destination.criteria);
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
			const launcher = createChildLauncher({ modelProfiles: absentProfiles });
			const result = await launcher.prepareLaunch(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree, { jev }),
			);
			assertRefused(result, reason);
			assert.match(result.warning, /Launch blocked/);
			assert.doesNotMatch(result.warning, /stays/);
		}

		const noKey = createChildLauncher({ modelProfiles: absentProfiles });
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
		assert.deepEqual(explore.contract.tools, ["read", "grep", "find", "ls"]);
	});
});

test("a missing role launches the specialist Jev chooses and does not assume worker", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launcher = createChildLauncher({ modelProfiles: absentProfiles });

		const result = await launcher.prepareLaunch(
			{ task: "Compare the two sources" },
			launcherContext(worktree, { jev: fakeJev(() => "explorer") }),
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.role, "explore");
		assert.match(result.contract.prompt, /You are an explore/);
		assert.deepEqual(result.warnings, []);
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

		const noRole = await launcher.prepareLaunch(
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
			createChildLauncher({ modelProfiles }).prepareLaunch(
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

test("a request refused by a local check never asks Jev", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const listsPath = join(dir, "pi-workflow-models.json");
		await writeFile(listsPath, "{ not json", "utf8");
		const cases = [
			[{ role: "wizard" }, {}, /unknown role/],
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

test("each specialist Jev chooses runs the model and thinking of that entry in the active profile", async () => {
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
			}).prepareLaunch(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { jev, available: everyModel }),
			);
			assert.equal(result.kind, "ready");
			assert.deepEqual({ model: result.model, thinking: result.thinking }, pair);
			assert.deepEqual(result.warnings, []);
			assert.equal(jev.requests.length, 1);
			assert.deepEqual(Object.keys(jev.requests[0].questions).sort(), [
				"destination",
				"specialist",
			]);
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

test("a misconfigured profile is refused after Jev selects that specialist", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const result = await createChildLauncher({
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
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, { session: false }),
		);

		assertRefused(result, /session/);
	});
});

test("an explicit child request launches the specialist Jev chooses and does not ask whether to stay", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev((body) => {
			assert.equal(body.questions.destination, undefined);
			return "explorer";
		});
		const result = await createChildLauncher({
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{
				role: "worker",
				task: "Decide the storage architecture",
				userRequest: "Explora con un hijo la arquitectura de estas dos implementaciones",
			},
			launcherContext(worktree, { jev }),
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.role, "explore");
		assert.deepEqual(result.warnings, []);
		assert.equal(jev.requests[0].state.delegation_intent, "explicit");
		assert.equal(
			jev.requests[0].state.user_request,
			"Explora con un hijo la arquitectura de estas dos implementaciones",
		);
		assert.equal(jev.requests[0].state.suggested_specialist, "worker");
		assert.equal(jev.requests[0].state.task, "Decide the storage architecture");
		assert.equal(result.jev.answers.specialist.choice, "explorer");
		assert.equal(result.jev.provider, "typesafe");
		assert.equal(result.jev.model, "jev-latest");
		assert.equal(result.jev.answers.specialist.confidence, 0.91);
	});
});

test("the parent's task cannot turn a user request into an explicit child", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "stay");
		const result = await createChildLauncher({
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
		assert.equal(jev.requests[0].state.delegation_intent, "optional");
		assert.equal(jev.requests[0].questions.destination.type, "choice");
		assert.equal(
			jev.requests[0].state.user_request,
			"Decide the storage architecture with me",
		);
	});
});

test("Jev can choose explorer when the suggested role is worker", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{
				role: "worker",
				task: "Compare the cited sources",
				userRequest: "Usa un hijo para comparar estas fuentes",
			},
			launcherContext(worktree, { jev: fakeJev(() => "explorer") }),
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.role, "explore");
	});
});

test("an implementation package and an independent check take the specialist Jev names", async () => {
	await withWorkspace(async ({ worktree }) => {
		const launch = (specialist, userRequest) =>
			createChildLauncher({
				modelProfiles: absentProfiles,
			}).prepareLaunch(
				{ task: userRequest, userRequest },
				launcherContext(worktree, { jev: fakeJev(() => specialist) }),
			);
		const implementation = await launch(
			"worker",
			"Add the missing export and its test",
		);
		const check = await launch(
			"verifier",
			"Haz una comprobación independiente del cambio ya hecho",
		);

		assert.equal(implementation.kind, "ready");
		assert.equal(implementation.role, "worker");
		assert.equal(check.kind, "ready");
		assert.equal(check.role, "verify");
	});
});

test("an invalid Jev selection blocks the launch and keeps the returned signals", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => ({
			answers: {
				specialist: {
					type: "choice",
					choice: "architect",
					confidence: 0.2,
					probabilities: { explorer: 0.4, worker: 0.4, verifier: 0.2 },
				},
				destination: {
					type: "choice",
					choice: "leave",
					confidence: 0.8,
					probabilities: { stay: 0.1, leave: 0.9 },
				},
			},
		}));
		const result = await createChildLauncher({
			modelProfiles: absentProfiles,
		}).prepareLaunch(
			{ role: "worker", task: "Compare the cited sources" },
			launcherContext(worktree, { jev }),
		);

		assertRefused(result, /invalid selection/);
		assert.match(result.warning, /Launch blocked/);
		assert.doesNotMatch(result.warning, /stays/);
		assert.equal(result.jev.answers.specialist.choice, "architect");
		assert.equal(result.jev.answers.specialist.probabilities.explorer, 0.4);
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

test("while Jev routing is on, git and gh in a named role's task go to Jev like any other work", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave");
		const launcher = createChildLauncher({
			modelProfiles: absentProfiles,
			fetch: jev.fetch,
		});
		const result = await launcher.prepareLaunch(
			{ role: "worker", task: "git status" },
			launcherContext(worktree),
		);
		assert.ok(jev.requests.length >= 1);
		assert.notEqual(
			result.reason,
			"git and gh stay in the parent while Jev routing is off.",
		);
	});
});
