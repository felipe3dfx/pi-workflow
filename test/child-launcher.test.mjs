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
import { createModelLists } from "../extensions/model-lists.ts";

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

function fakeJev(answer, types = { implement: 0.9 }) {
	const requests = [];
	const fetch = async (_url, init) => {
		const body = JSON.parse(init.body);
		requests.push(body);
		if (!body.questions.choice) {
			if (types instanceof Response) return types;
			return Response.json({
				answers: Object.fromEntries(
					Object.keys(body.questions).map((type) => [
						type,
						{ noul: types[type] ?? 0.1 },
					]),
				),
			});
		}
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

function loadedLists({ specialists = {}, tiers = {}, taskTypes = {} }) {
	return {
		load: () => ({
			status: "loaded",
			lists: { schemaVersion: 1, specialists, tiers, taskTypes },
		}),
	};
}

const absentLists = { load: () => ({ status: "absent" }) };

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
			modelLists: absentLists,
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
			const launcher = createChildLauncher({ modelLists: absentLists, fetch });
			const result = await launcher.decide(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);
			assertRefused(result, /Jev/);
		}

		const noKey = createChildLauncher({
			modelLists: absentLists,
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
			modelLists: absentLists,
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
			modelLists: absentLists,
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
			modelLists: absentLists,
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
			modelLists: absentLists,
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

test("an invalid or unreadable model lists file is refused, not treated as absent", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const path = join(dir, "pi-workflow-models.json");
		const decide = (modelLists) =>
			createChildLauncher({ modelLists, fetch: leave() }).decide(
				{ role: "worker", task: "Fix the failing test" },
				launcherContext(worktree),
			);

		await writeFile(path, "{ not json", "utf8");
		const invalid = await decide(createModelLists({ path }));
		assertRefused(invalid, /Invalid model lists/);
		assert.ok(invalid.reason.includes(path));

		await rm(path);
		await mkdir(path);
		assertRefused(await decide(createModelLists({ path })), /Unable to read/);
	});
});

test("a model lists file created in this turn is not read and is not a refusal", async () => {
	await withWorkspace(async ({ dir, worktree }) => {
		const path = join(dir, "pi-workflow-models.json");
		const modelLists = createModelLists({ path });
		await writeFile(
			path,
			JSON.stringify({
				schemaVersion: 1,
				specialists: { implement: [{ model: "new/model", thinking: "low" }] },
				tiers: {},
				taskTypes: {},
			}),
			"utf8",
		);

		const result = await createChildLauncher({
			modelLists,
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
			modelLists: absentLists,
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
			modelLists: absentLists,
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
				{ modelLists: createModelLists({ path: listsPath }) },
				/Invalid model lists/,
			],
			[{ role: "explore", worktree: join(dir, "missing") }, {}, /worktree/],
		];
		for (const [request, options, reason] of cases) {
			const jev = fakeJev(() => "leave");
			const result = await createChildLauncher({
				modelLists: absentLists,
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
				modelLists: absentLists,
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
			modelLists: absentLists,
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

test("Jev classifies the task alone with one yes or no question per task type in one request", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev(() => "leave", { debug: 0.8, implement: 0.6 });
		const launcher = createChildLauncher({
			modelLists: loadedLists({
				specialists: {
					debug: [{ model: "fast/debugger", thinking: "high" }],
					implement: [{ model: "fast/coder", thinking: "low" }],
				},
				tiers: { standard: [{ model: "fast/coder", thinking: "low" }] },
				taskTypes: { debug: "standard" },
			}),
			fetch: jev.fetch,
		});

		const result = await launcher.decide(
			{ role: "verify", task: "Find why the build fails" },
			launcherContext(worktree, {
				available: [catalogModel("fast/debugger"), catalogModel("fast/coder")],
			}),
		);

		assert.equal(result.status, "launch");
		assert.equal(result.model, "fast/debugger");
		assert.equal(result.thinking, "high");
		assert.deepEqual(result.warnings, []);
		assert.equal(jev.requests.length, 2);
		const classification = jev.requests[1];
		assert.deepEqual(classification.state, {
			task: "Find why the build fails",
		});
		assert.deepEqual(Object.keys(classification.questions).sort(), [
			"chat",
			"debug",
			"explain",
			"implement",
			"operate",
			"plan",
			"refactor",
			"research",
			"review",
			"write",
		]);
		for (const question of Object.values(classification.questions)) {
			assert.equal(question.type, "noul");
		}
	});
});

test("a known type walks its specialist list, then the tier list the saved map names, skipping unavailable pairs", async () => {
	await withWorkspace(async ({ worktree }) => {
		const lists = loadedLists({
			specialists: {
				implement: [
					{ model: "gone/model", thinking: "low" },
					{ model: "plain/model", thinking: "high" },
				],
			},
			tiers: {
				standard: [{ model: "standard/model", thinking: "medium" }],
				high: [
					{ model: "gone/other", thinking: "high" },
					{ model: "high/model", thinking: "xhigh" },
					{ model: "high/model", thinking: "high" },
				],
			},
			taskTypes: { implement: "high" },
		});
		const available = [
			catalogModel("plain/model", false),
			catalogModel("standard/model"),
			catalogModel("high/model"),
			catalogModel("session/model"),
		];
		for (const role of ["explore", "worker", "verify"]) {
			const result = await createChildLauncher({
				modelLists: lists,
				fetch: leave(),
			}).decide(
				{ role, task: "Add the export command" },
				launcherContext(worktree, { available }),
			);
			assert.equal(result.status, "launch");
			assert.equal(result.model, "high/model");
			assert.equal(result.thinking, "high");
			assert.deepEqual(result.warnings, []);
		}
	});
});

test("a known type with one defined list walks that list and does not use the session model", async () => {
	await withWorkspace(async ({ worktree }) => {
		const available = [
			catalogModel("special/model"),
			catalogModel("tier/model"),
			catalogModel("session/model"),
		];
		const cases = [
			[
				{
					specialists: {
						implement: [{ model: "special/model", thinking: "low" }],
					},
					tiers: { standard: [] },
					taskTypes: { implement: "standard" },
				},
				{ model: "special/model", thinking: "low" },
			],
			[
				{
					specialists: { implement: [] },
					tiers: { quick: [{ model: "tier/model", thinking: "minimal" }] },
					taskTypes: { implement: "quick" },
				},
				{ model: "tier/model", thinking: "minimal" },
			],
		];
		for (const [lists, expected] of cases) {
			const result = await createChildLauncher({
				modelLists: loadedLists(lists),
				fetch: leave(),
			}).decide(
				{ role: "worker", task: "Add the export command" },
				launcherContext(worktree, { available }),
			);
			assert.equal(result.status, "launch");
			assert.deepEqual(
				{ model: result.model, thinking: result.thinking },
				expected,
			);
		}
	});
});

test("a known type whose selected lists are both undefined uses the session model and thinking", async () => {
	await withWorkspace(async ({ worktree }) => {
		const empty = loadedLists({
			specialists: {
				implement: [],
				debug: [{ model: "x/y", thinking: "low" }],
			},
			tiers: { standard: [], high: [{ model: "x/y", thinking: "low" }] },
			taskTypes: { implement: "standard" },
		});
		const unmapped = loadedLists({
			tiers: { standard: [{ model: "x/y", thinking: "low" }] },
		});
		for (const modelLists of [absentLists, empty, unmapped]) {
			const result = await createChildLauncher({
				modelLists,
				fetch: leave(),
			}).decide(
				{ role: "worker", task: "Add the export command" },
				launcherContext(worktree, { available: [catalogModel("x/y")] }),
			);
			assert.equal(result.status, "launch");
			assert.deepEqual(
				{ model: result.model, thinking: result.thinking },
				sessionPair,
			);
			assert.deepEqual(result.warnings, []);
		}
	});
});

test("an uncertain task type uses the session model and thinking even when lists exist, and warns", async () => {
	await withWorkspace(async ({ worktree }) => {
		const lists = loadedLists({
			specialists: {
				implement: [{ model: "special/model", thinking: "low" }],
				debug: [{ model: "special/model", thinking: "low" }],
			},
			tiers: { standard: [{ model: "special/model", thinking: "low" }] },
			taskTypes: { implement: "standard", debug: "standard" },
		});
		const answers = [
			[{ implement: 0.49, debug: 0.3 }, /0\.5/],
			[{ implement: 0.7, debug: 0.7 }, /tied/],
			[new Response("down", { status: 503 }), /Jev did not answer/],
		];
		for (const [types, why] of answers) {
			const result = await createChildLauncher({
				modelLists: lists,
				fetch: fakeJev(() => "leave", types).fetch,
			}).decide(
				{ role: "worker", task: "Look into the export" },
				launcherContext(worktree, {
					available: [catalogModel("special/model")],
				}),
			);
			assert.equal(result.status, "launch");
			assert.deepEqual(
				{ model: result.model, thinking: result.thinking },
				sessionPair,
			);
			assert.equal(result.warnings.length, 1);
			assert.match(result.warnings[0], /uncertain/);
			assert.match(result.warnings[0], why);
		}
	});
});

test("an unavailable selected pair does not start: the work stays pending with no child id", async () => {
	await withWorkspace(async ({ worktree }) => {
		const lists = loadedLists({
			specialists: {
				implement: [
					{ model: "gone/model", thinking: "low" },
					{ model: "plain/model", thinking: "high" },
				],
			},
			tiers: {
				quick: [{ model: "quick/model", thinking: "low" }],
				standard: [{ model: "gone/other", thinking: "medium" }],
			},
			taskTypes: { implement: "standard" },
		});
		const result = await createChildLauncher({
			modelLists: lists,
			fetch: leave(),
		}).decide(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, {
				available: [
					catalogModel("plain/model", false),
					catalogModel("quick/model"),
					catalogModel("session/model"),
				],
			}),
		);

		assert.equal(result.status, "pending");
		assert.equal("id" in result, false);
		assert.equal("model" in result, false);
		assert.equal("thinking" in result, false);
		assert.ok(result.warning.length > 0);
		assert.match(result.reason, /implement/);
		assert.equal(result.role, "worker");
		assert.match(result.contract.prompt, /You are a worker/);
		assert.equal(result.task, "Add the export command");
		assert.equal(result.worktree, await realpath(worktree));
	});
});

test("a session without a model or thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelLists: absentLists,
			fetch: leave(),
		}).decide(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, { session: false }),
		);

		assertRefused(result, /session/);
	});
});

test("a pending result keeps the warnings collected before selection", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelLists: loadedLists({
				specialists: { implement: [{ model: "gone/model", thinking: "low" }] },
			}),
			fetch: leave(),
		}).decide({ task: "Add the export command" }, launcherContext(worktree));

		assert.equal(result.status, "pending");
		assert.equal(result.role, "worker");
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0], /No role was named/);
	});
});

test("an uncertain type in a session without a model or thinking is refused", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelLists: absentLists,
			fetch: fakeJev(() => "leave", { implement: 0.3 }).fetch,
		}).decide(
			{ role: "worker", task: "Look into the export" },
			launcherContext(worktree, { session: false }),
		);

		assertRefused(result, /session/);
	});
});

test("a top probability of exactly 0.5 is a known type and walks its list", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelLists: loadedLists({
				specialists: {
					implement: [{ model: "special/model", thinking: "low" }],
				},
			}),
			fetch: fakeJev(() => "leave", { implement: 0.5 }).fetch,
		}).decide(
			{ role: "worker", task: "Add the export command" },
			launcherContext(worktree, { available: [catalogModel("special/model")] }),
		);

		assert.equal(result.status, "launch");
		assert.deepEqual(
			{ model: result.model, thinking: result.thinking },
			{ model: "special/model", thinking: "low" },
		);
		assert.deepEqual(result.warnings, []);
	});
});

test("a session with a model but no thinking is refused when the session pair is needed", async () => {
	await withWorkspace(async ({ worktree }) => {
		const result = await createChildLauncher({
			modelLists: absentLists,
			fetch: leave(),
		}).decide(
			{ role: "worker", task: "Add the export command" },
			{ ...launcherContext(worktree), thinkingLevel: undefined },
		);

		assertRefused(result, /session/);
	});
});
