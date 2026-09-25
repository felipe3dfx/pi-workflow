import test from "node:test";
import assert from "node:assert/strict";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { createModelLists } from "../extensions/model-lists.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

const creationMap = {
	chat: "quick",
	explain: "quick",
	write: "quick",
	operate: "standard",
	implement: "standard",
	debug: "standard",
	refactor: "standard",
	research: "standard",
	plan: "high",
	review: "high",
};

async function withConfigDirectory(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-model-lists-"));
	try {
		return await run({
			dir,
			path: join(dir, "agent", "pi-workflow-models.json"),
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function model(provider, id, cost = { input: 3, output: 15 }) {
	return {
		provider,
		id,
		name: id,
		contextWindow: 200000,
		maxTokens: 64000,
		reasoning: true,
		input: ["text", "image"],
		cost: { ...cost, cacheRead: 0, cacheWrite: 0 },
	};
}

function commandContext({
	hasUI = true,
	models = [],
	confirm = async () => false,
	custom,
	typesafeKey,
} = {}) {
	const notifications = [];
	const ctx = {
		hasUI,
		mode: hasUI ? "tui" : "print",
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			confirm,
			custom: custom ?? (async () => undefined),
		},
		modelRegistry: {
			getAvailable: () => models,
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? typesafeKey : undefined,
		},
	};
	return { ctx, notifications };
}

const openRouterUrl = "https://openrouter.ai/api/v1/models";

function fakeJev(answer, openRouter = () => Response.json({ data: [] })) {
	const requests = [];
	const openRouterRequests = [];
	const fetch = async (url, init) => {
		if (url === openRouterUrl) {
			openRouterRequests.push({ url, init });
			return openRouter();
		}
		const body = JSON.parse(init.body);
		requests.push({ url, init, body });
		const questions = Object.keys(body.questions);
		const answered = answer(body, questions[0]);
		if (answered instanceof Response) return answered;
		if (typeof answered === "string") {
			return Response.json({
				answers: { [questions[0]]: { choice: answered, confidence: 0.9 } },
			});
		}
		return Response.json({
			answers: Object.fromEntries(
				questions.map((question) => [
					question,
					{ noul: answered[question] ?? 0 },
				]),
			),
		});
	};
	return { fetch, requests, openRouterRequests };
}

function isThinkingQuestion(body) {
	return Object.keys(Object.values(body.questions)[0].criteria).includes("off");
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

test("the command creates the missing file with specialists, tier lists, and the creation map", async () => {
	await withConfigDirectory(async ({ path }) => {
		const lists = createModelLists({
			path,
			research: async (candidate) => ({
				thinking: candidate.provider === "nan" ? "low" : "high",
				notes: `${candidate.id} notes`,
			}),
			classify: async (candidate) =>
				({
					"gpt-5.6-luna": { implement: 1 },
					"gpt-6-astra": { review: 1 },
					"qwen3.8-flash": { chat: 1 },
				})[candidate.id],
		});
		const { ctx } = commandContext({
			models: [
				model("openai-codex", "gpt-5.6-luna", { input: 5, output: 30 }),
				model("openai-codex", "gpt-6-astra", { input: 2, output: 10 }),
				model("nan", "qwen3.8-flash", { input: 0.1, output: 0.5 }),
			],
		});

		const outcome = await lists.create(ctx);

		assert.equal(outcome.status, "created");
		const saved = await readJson(path);
		assert.equal(saved.schemaVersion, 1);
		assert.deepEqual(saved.taskTypes, creationMap);
		assert.deepEqual(saved.specialists.implement, [
			{ model: "openai-codex/gpt-5.6-luna", thinking: "high" },
		]);
		assert.deepEqual(saved.specialists.review, [
			{ model: "openai-codex/gpt-6-astra", thinking: "high" },
		]);
		assert.deepEqual(saved.specialists.chat, [
			{ model: "nan/qwen3.8-flash", thinking: "low" },
		]);
		assert.deepEqual(saved.specialists.plan, []);
		assert.deepEqual(saved.tiers, {
			quick: [{ model: "nan/qwen3.8-flash", thinking: "low" }],
			standard: [{ model: "openai-codex/gpt-6-astra", thinking: "high" }],
			high: [{ model: "openai-codex/gpt-5.6-luna", thinking: "high" }],
		});
	});
});

test("a model that research or Jev cannot place is left out and the others are saved", async () => {
	await withConfigDirectory(async ({ path }) => {
		const lists = createModelLists({
			path,
			research: async (candidate) => {
				if (candidate.id === "offline") throw new Error("search failed");
				return {
					thinking: candidate.id === "unpinned" ? "turbo" : "medium",
					notes: "",
				};
			},
			classify: async (candidate) => {
				if (candidate.id === "jev-down") throw new Error("Jev timed out");
				return { debug: 1 };
			},
		});
		const { ctx, notifications } = commandContext({
			models: [
				model("xai", "grok-4.7"),
				model("nan", "offline"),
				model("nan", "unpinned"),
				model("nan", "jev-down"),
			],
		});

		const outcome = await lists.create(ctx);

		assert.equal(outcome.status, "created");
		assert.deepEqual(
			outcome.leftOut.map((entry) => entry.model),
			["nan/offline", "nan/unpinned", "nan/jev-down"],
		);
		const saved = await readJson(path);
		assert.deepEqual(saved.specialists.debug, [
			{ model: "xai/grok-4.7", thinking: "medium" },
		]);
		assert.deepEqual(saved.tiers, {
			quick: [{ model: "xai/grok-4.7", thinking: "medium" }],
			standard: [],
			high: [],
		});
		const warning = notifications.find((entry) => entry.level === "warning");
		assert.match(warning.message, /nan\/offline: search failed/);
		assert.match(warning.message, /nan\/jev-down: Jev timed out/);
	});
});

const existingContent =
	'{"schemaVersion":1,"specialists":{},"tiers":{},"taskTypes":{}}\n';

async function writeExisting(path) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, existingContent, "utf8");
}

const placeEverything = {
	research: async () => ({ thinking: "low", notes: "" }),
	classify: async () => ({ chat: 1 }),
};

test("in the TUI an existing file is replaced only after confirmation", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeExisting(path);
		const lists = createModelLists({ path, ...placeEverything });
		const questions = [];
		const declined = commandContext({
			models: [model("nan", "gemma4")],
			confirm: async (title, message) => {
				questions.push({ title, message });
				return false;
			},
		});

		assert.equal((await lists.create(declined.ctx)).status, "kept");
		assert.equal(await readFile(path, "utf8"), existingContent);
		assert.equal(questions.length, 1);
		assert.match(questions[0].message, new RegExp(path));

		const confirmed = commandContext({
			models: [model("nan", "gemma4")],
			confirm: async () => true,
		});
		assert.equal((await lists.create(confirmed.ctx)).status, "replaced");
		assert.deepEqual((await readJson(path)).tiers.quick, [
			{ model: "nan/gemma4", thinking: "low" },
		]);
	});
});

test("print mode never replaces an existing file and only warns", async (t) => {
	await withConfigDirectory(async ({ path }) => {
		await writeExisting(path);
		const printed = [];
		t.mock.method(console, "error", (message) => printed.push(message));
		const lists = createModelLists({ path, ...placeEverything });
		const { ctx } = commandContext({
			hasUI: false,
			models: [model("nan", "gemma4")],
			confirm: async () => true,
		});

		assert.equal((await lists.create(ctx)).status, "kept");
		assert.equal(await readFile(path, "utf8"), existingContent);
		assert.equal(printed.length, 1);
		assert.match(printed[0], /not replaced/);
	});
});

test("print mode creates the file when it is missing", async (t) => {
	await withConfigDirectory(async ({ path }) => {
		t.mock.method(console, "error", () => {});
		const lists = createModelLists({ path, ...placeEverything });
		const { ctx } = commandContext({
			hasUI: false,
			models: [model("nan", "gemma4")],
		});

		assert.equal((await lists.create(ctx)).status, "created");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "nan/gemma4", thinking: "low" },
		]);
	});
});

test("the loader reads a valid file, and NaN entries may sit in any list", async () => {
	await withConfigDirectory(async ({ path }) => {
		const content = {
			schemaVersion: 1,
			specialists: {
				research: [{ model: "nan/mimo-v2.5", thinking: "medium" }],
			},
			tiers: {
				high: [
					{ model: "openai-codex/gpt-6-astra", thinking: "low" },
					{ model: "nan/deepseek-v4-flash", thinking: "medium" },
				],
			},
			taskTypes: { research: "high" },
		};
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(content), "utf8");

		assert.deepEqual(createModelLists({ path }).load(), {
			status: "loaded",
			lists: content,
		});
	});
});

test("the loader treats a missing file as absent", async () => {
	await withConfigDirectory(async ({ path }) => {
		assert.deepEqual(createModelLists({ path }).load(), { status: "absent" });
	});
});

test("an invalid or unreadable file is a refusal, not an absent file", async () => {
	await withConfigDirectory(async ({ path }) => {
		await mkdir(dirname(path), { recursive: true });
		const invalid = [
			"{ not json",
			JSON.stringify({
				schemaVersion: 1,
				specialists: {},
				tiers: { premium: [] },
				taskTypes: {},
			}),
			JSON.stringify({
				schemaVersion: 1,
				specialists: {},
				tiers: {},
				taskTypes: { chat: "premium" },
			}),
			JSON.stringify({
				schemaVersion: 1,
				specialists: { chat: [{ model: "nan/gemma4" }] },
				tiers: {},
				taskTypes: {},
			}),
			JSON.stringify({
				schemaVersion: 1,
				specialists: { chats: [] },
				tiers: {},
				taskTypes: {},
			}),
			JSON.stringify({
				schemaVersion: 2,
				specialists: {},
				tiers: {},
				taskTypes: {},
			}),
		];
		for (const content of invalid) {
			await writeFile(path, content, "utf8");
			const result = createModelLists({ path }).load();
			assert.equal(result.status, "refused", content);
			assert.match(result.reason, new RegExp(path));
		}

		await rm(path);
		await mkdir(path);
		const unreadable = createModelLists({ path }).load();
		assert.equal(unreadable.status, "refused");
	});
});

test("a file created in this turn is not read and is not a refusal until /reload", async () => {
	await withConfigDirectory(async ({ path }) => {
		const lists = createModelLists({ path, ...placeEverything });
		const { ctx } = commandContext({ models: [model("nan", "gemma4")] });
		await lists.create(ctx);

		assert.deepEqual(lists.load(), { status: "absent" });

		const afterReload = createModelLists({ path }).load();
		assert.equal(afterReload.status, "loaded");
		assert.deepEqual(afterReload.lists.tiers.quick, [
			{ model: "nan/gemma4", thinking: "low" },
		]);
	});
});

test("a file changed outside the command applies only after /reload", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeExisting(path);
		const lists = createModelLists({ path });
		await writeFile(path, "{ not json", "utf8");

		assert.deepEqual(lists.load(), {
			status: "loaded",
			lists: JSON.parse(existingContent),
		});
		assert.equal(createModelLists({ path }).load().status, "refused");
	});
});

test("the model list commands reject extra arguments with the shared usage", async () => {
	await withConfigDirectory(async ({ path }) => {
		const commands = new Map();
		const pi = {
			on: () => {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool: () => {},
			registerShortcut: () => {},
			registerProvider: () => {},
		};
		piWorkflowExtension(pi, { modelLists: { path, ...placeEverything } });

		for (const name of ["pi-workflow-models", "pi-workflow-models-edit"]) {
			let edits = 0;
			const { ctx, notifications } = commandContext({
				models: [model("nan", "gemma4")],
				custom: async () => {
					edits += 1;
				},
			});
			await commands.get(name).handler("--force", ctx);

			assert.equal(edits, 0, name);
			assert.equal(notifications.length, 1, name);
			assert.equal(notifications[0].level, "error");
			assert.match(
				notifications[0].message,
				/\/pi-workflow-models \| \/pi-workflow-models-edit/,
			);
		}
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("in print mode the model list commands print the usage for extra arguments", async (t) => {
	await withConfigDirectory(async ({ path }) => {
		const printed = [];
		t.mock.method(console, "error", (message) => printed.push(message));
		const commands = new Map();
		const pi = {
			on: () => {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool: () => {},
			registerShortcut: () => {},
			registerProvider: () => {},
		};
		piWorkflowExtension(pi, { modelLists: { path, ...placeEverything } });

		for (const name of ["pi-workflow-models", "pi-workflow-models-edit"]) {
			const { ctx } = commandContext({
				hasUI: false,
				models: [model("nan", "gemma4")],
			});
			await commands.get(name).handler("--force", ctx);
		}

		assert.equal(printed.length, 2);
		for (const message of printed) {
			assert.match(
				message,
				/\/pi-workflow-models \| \/pi-workflow-models-edit/,
			);
		}
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("a file created by another process during classification is never replaced", async (t) => {
	t.mock.method(console, "error", () => {});
	for (const hasUI of [true, false]) {
		await withConfigDirectory(async ({ path }) => {
			const lists = createModelLists({
				path,
				research: placeEverything.research,
				classify: async () => {
					await writeExisting(path);
					return { chat: 1 };
				},
			});
			const confirms = [];
			const { ctx, notifications } = commandContext({
				hasUI,
				models: [model("nan", "gemma4")],
				confirm: async () => {
					confirms.push(true);
					return true;
				},
			});

			const outcome = await lists.create(ctx);

			assert.equal(outcome.status, "kept", `hasUI=${hasUI}`);
			assert.equal(await readFile(path, "utf8"), existingContent);
			assert.equal(confirms.length, 0);
			assert.deepEqual(await readdir(dirname(path)), [
				"pi-workflow-models.json",
			]);
			if (hasUI) assert.match(notifications.at(-1).message, /not replaced/);
		});
	}
});

async function writeDanglingSymlink(path) {
	await mkdir(dirname(path), { recursive: true });
	await symlink(join(dirname(path), "missing-target.json"), path);
}

test("a dangling symlink is unreadable, not absent", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeDanglingSymlink(path);

		const result = createModelLists({ path }).load();

		assert.equal(result.status, "refused");
		assert.match(result.reason, /Unable to read/);
	});
});

test("the command does not replace a dangling symlink without confirmation", async (t) => {
	t.mock.method(console, "error", () => {});
	for (const hasUI of [true, false]) {
		await withConfigDirectory(async ({ path }) => {
			await writeDanglingSymlink(path);
			const questions = [];
			const lists = createModelLists({ path, ...placeEverything });
			const { ctx } = commandContext({
				hasUI,
				models: [model("nan", "gemma4")],
				confirm: async () => {
					questions.push(true);
					return false;
				},
			});

			assert.equal((await lists.create(ctx)).status, "kept", `hasUI=${hasUI}`);
			assert.equal(questions.length, hasUI ? 1 : 0);
			assert.equal((await lstat(path)).isSymbolicLink(), true);
		});
	}
});

test("the command refuses when the file entry cannot be inspected", async (t) => {
	t.mock.method(console, "error", () => {});
	await withConfigDirectory(async ({ dir }) => {
		const notADirectory = join(dir, "agent");
		await writeFile(notADirectory, "", "utf8");
		const path = join(notADirectory, "pi-workflow-models.json");
		const { ctx, notifications } = commandContext({
			models: [model("nan", "gemma4")],
		});

		const outcome = await createModelLists({ path, ...placeEverything }).create(
			ctx,
		);

		assert.equal(outcome.status, "refused");
		assert.match(notifications.at(-1).message, /Unable to read/);
	});
});

test("without injected adapters, Jev picks the thinking level for the cost tier, then the task type", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "medium" : { implement: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				{
					...model("openai-codex", "gpt-6-astra"),
					thinkingLevelMap: { xhigh: "xhigh" },
				},
			],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, []);
		const saved = await readJson(path);
		assert.deepEqual(saved.specialists.implement, [
			{ model: "openai-codex/gpt-6-astra", thinking: "medium" },
		]);
		assert.deepEqual(saved.tiers, {
			quick: [{ model: "openai-codex/gpt-6-astra", thinking: "medium" }],
			standard: [],
			high: [],
		});
		assert.equal(jev.requests.length, 2);
		for (const request of jev.requests) {
			assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(request.init.method, "POST");
			assert.equal(request.init.headers.Authorization, "Bearer ts-secret");
			assert.equal(request.init.headers["Content-Type"], "application/json");
			assert.equal(request.body.model, "jev-latest");
			assert.ok(request.init.signal instanceof AbortSignal);
		}
		const thinking = Object.values(jev.requests[0].body.questions)[0];
		assert.equal(
			jev.requests[0].body.state.tier,
			"quick: Mechanical work, transcription, and cheap sweeps",
		);
		assert.match(thinking.instructions, /tier/);
		assert.deepEqual(Object.keys(thinking.criteria), [
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
		]);
		assert.equal(thinking.type, "choice");
		assert.deepEqual(
			Object.keys(jev.requests[1].body.questions),
			Object.keys(creationMap),
		);
		for (const request of jev.requests) {
			const notes = request.body.state.model;
			assert.match(notes, /gpt-6-astra \(openai-codex\/gpt-6-astra\)/);
			assert.match(notes, /reasoning supported/);
			assert.match(notes, /context window 200000 tokens/);
			assert.match(notes, /max output 64000 tokens/);
			assert.match(notes, /input text, image/);
			assert.match(notes, /\$3 per million input tokens/);
			assert.match(notes, /\$15 per million output tokens/);
			assert.match(
				notes,
				/thinking levels off, minimal, low, medium, high, xhigh/,
			);
		}
	});
});

test("Jev is told plainly when a model reports zero cost", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "low" : { research: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				{
					...model("openai-codex", "gpt-5.6-luna"),
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
			typesafeKey: "ts-secret",
		});

		await lists.create(ctx);

		const notes = jev.requests[0].body.state.model;
		assert.match(notes, /cost reported as 0 per million input tokens/);
		assert.match(notes, /cost reported as 0 per million output tokens/);
	});
});

function specialtiesRequest(requests, name) {
	return requests.find(
		(request) =>
			!isThinkingQuestion(request.body) &&
			request.body.state.model.startsWith(`${name} `),
	);
}

test("Jev researches each model with its OpenRouter description, fetched once and matched by id without signs", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev(
			(body) => (isThinkingQuestion(body) ? "low" : { chat: 0.9 }),
			() =>
				Response.json({
					data: [
						{ id: "x/gpt-6-luna" },
						{
							id: "openai/gpt-6-luna:batch",
							description: "Chat and classification.",
						},
						{ id: "resale/glm-5.3-flash", description: "A resold copy." },
						{ id: "z-ai/glm-5.3-flash", description: "Agentic coding." },
					],
				}),
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx, notifications } = commandContext({
			models: [
				model("openai-codex", "GPT-6-Luna", { input: 1, output: 1 }),
				model("zai", "glm5.3-flash", { input: 2, output: 2 }),
			],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, []);
		assert.equal(jev.openRouterRequests.length, 1);
		assert.ok(jev.openRouterRequests[0].init.signal instanceof AbortSignal);
		const described = {
			"GPT-6-Luna": "Chat and classification.",
			"glm5.3-flash": "Agentic coding.",
		};
		for (const [name, description] of Object.entries(described)) {
			const requests = jev.requests.filter((request) =>
				request.body.state.model.startsWith(`${name} `),
			);
			assert.equal(requests.length, 2, name);
			for (const request of requests) {
				assert.ok(request.body.state.model.includes(description), name);
			}
		}
		assert.doesNotMatch(
			JSON.stringify(jev.requests.map((request) => request.body.state)),
			/resold/,
		);
		assert.deepEqual(
			notifications.filter((entry) => entry.level === "warning"),
			[],
		);
	});
});

test("Jev answers one yes/no question per task type in a single request", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "low" : { debug: 0.7 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [model("xai", "grok-4.7")],
			typesafeKey: "ts-secret",
		});

		await lists.create(ctx);

		assert.equal(jev.requests.length, 2);
		const { questions } = specialtiesRequest(jev.requests, "grok-4.7").body;
		assert.deepEqual(Object.keys(questions), Object.keys(creationMap));
		for (const [type, question] of Object.entries(questions)) {
			assert.equal(question.type, "noul", type);
			assert.match(question.instructions, /`model`/);
			assert.match(question.instructions, new RegExp(type));
			assert.deepEqual(Object.keys(question.criteria), ["true", "false"]);
		}
		assert.deepEqual((await readJson(path)).specialists.debug, [
			{ model: "xai/grok-4.7", thinking: "low" },
		]);
	});
});

test("a model joins every specialist list Jev says yes to, ordered by probability, and one with none keeps its tier", async () => {
	await withConfigDirectory(async ({ path }) => {
		const answers = {
			alpha: { implement: 0.6, review: 0.9 },
			beta: { implement: 0.8, review: 0.49 },
			gamma: { chat: 0.4 },
			delta: { implement: 0.6, review: 0.5 },
		};
		const jev = fakeJev((body) =>
			isThinkingQuestion(body)
				? "low"
				: answers[body.state.model.split(" ")[0]],
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				model("x", "alpha", { input: 1, output: 1 }),
				model("x", "beta", { input: 2, output: 2 }),
				model("x", "gamma", { input: 3, output: 3 }),
				model("x", "delta", { input: 4, output: 4 }),
			],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, []);
		const saved = await readJson(path);
		const names = (entries) => entries.map((entry) => entry.model);
		assert.deepEqual(names(saved.specialists.implement), [
			"x/beta",
			"x/alpha",
			"x/delta",
		]);
		assert.deepEqual(names(saved.specialists.review), ["x/alpha", "x/delta"]);
		assert.deepEqual(names(saved.specialists.chat), []);
		assert.ok(
			Object.values(saved.tiers).some((entries) =>
				names(entries).includes("x/gamma"),
			),
		);
	});
});

test("a model OpenRouter does not describe is researched from the Pi catalog only and reported", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev(
			(body) => (isThinkingQuestion(body) ? "low" : { chat: 0.9 }),
			() =>
				Response.json({
					data: [{ id: "x/two", description: "The second model." }],
				}),
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx, notifications } = commandContext({
			models: [model("x", "one"), model("x", "two")],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, []);
		assert.deepEqual(
			(await readJson(path)).specialists.chat.map((entry) => entry.model),
			["x/one", "x/two"],
		);
		const warnings = notifications.filter((entry) => entry.level === "warning");
		assert.equal(warnings.length, 1);
		assert.equal(
			warnings[0].message,
			"No OpenRouter description, researched from the Pi catalog only:\n- x/one",
		);
	});
});

test("when OpenRouter does not answer, models are researched from the Pi catalog only with one warning", async () => {
	const failures = [
		() => new Response("secret body", { status: 502 }),
		() => {
			throw new TypeError("fetch failed");
		},
		() => new Response("<html>secret body</html>"),
		() => Response.json({ models: [] }),
	];
	for (const failure of failures) {
		await withConfigDirectory(async ({ path }) => {
			const jev = fakeJev(
				(body) => (isThinkingQuestion(body) ? "low" : { chat: 0.9 }),
				failure,
			);
			const lists = createModelLists({ path, fetch: jev.fetch });
			const { ctx, notifications } = commandContext({
				models: [model("x", "one"), model("x", "two")],
				typesafeKey: "ts-secret",
			});

			const outcome = await lists.create(ctx);

			assert.deepEqual(outcome.leftOut, []);
			assert.equal(jev.openRouterRequests.length, 1);
			assert.equal((await readJson(path)).specialists.chat.length, 2);
			const warnings = notifications.filter(
				(entry) => entry.level === "warning",
			);
			assert.equal(warnings.length, 1);
			assert.match(
				warnings[0].message,
				/^OpenRouter did not answer, so models were researched from the Pi catalog only: /,
			);
			assert.doesNotMatch(warnings[0].message, /secret body/);
		});
	}
});

test("a specialties answer missing a task type leaves the model out", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body)
				? "low"
				: Response.json({ answers: { chat: { noul: 0.9 } } }),
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [model("x", "one")],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(
			outcome.leftOut.map((entry) => entry.model),
			["x/one"],
		);
		assert.deepEqual((await readJson(path)).specialists.chat, []);
	});
});

function tierLists(saved) {
	return Object.fromEntries(
		Object.entries(saved.tiers).map(([tier, entries]) => [
			tier,
			entries.map((entry) => entry.model),
		]),
	);
}

test("tiers split the priced catalog into thirds by output cost, input cost breaking ties", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "low" : { chat: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				model("x", "astra", { input: 10, output: 50 }),
				model("x", "sol56", { input: 4, output: 20 }),
				model("x", "luna6", { input: 0.1, output: 0.5 }),
				model("x", "gpt55", { input: 5, output: 30 }),
				model("x", "terra", { input: 2, output: 12 }),
				model("x", "luna56", { input: 0.2, output: 1.2 }),
				model("x", "spark", { input: 1.75, output: 14 }),
				model("x", "sol6", { input: 2, output: 10 }),
			],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, []);
		assert.equal(jev.requests.length, 16);
		assert.deepEqual(tierLists(await readJson(path)), {
			quick: ["x/luna6", "x/luna56", "x/sol6"],
			standard: ["x/sol56", "x/terra", "x/spark"],
			high: ["x/astra", "x/gpt55"],
		});
	});
});

test("input cost breaks a tie in output cost", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "low" : { chat: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				model("x", "dearer-input", { input: 3, output: 10 }),
				model("x", "cheaper-input", { input: 2, output: 10 }),
				model("x", "pricey", { input: 1, output: 20 }),
			],
			typesafeKey: "ts-secret",
		});

		await lists.create(ctx);

		assert.deepEqual(tierLists(await readJson(path)), {
			quick: ["x/cheaper-input"],
			standard: ["x/dearer-input"],
			high: ["x/pricey"],
		});
	});
});

test("models with the same cost share a tier", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "low" : { chat: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				model("x", "first", { input: 1, output: 4 }),
				model("x", "twin", { input: 1, output: 4 }),
				model("x", "pricey", { input: 2, output: 8 }),
			],
			typesafeKey: "ts-secret",
		});

		await lists.create(ctx);

		assert.deepEqual(tierLists(await readJson(path)), {
			quick: ["x/first", "x/twin"],
			standard: [],
			high: ["x/pricey"],
		});
	});
});

test("a model without catalog cost joins only its specialist list, is asked thinking without a tier, and is reported", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "medium" : { research: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx, notifications } = commandContext({
			models: [
				model("nan", "free", { input: 0, output: 0 }),
				model("xai", "grok-4.7"),
			],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, []);
		const saved = await readJson(path);
		assert.deepEqual(saved.specialists.research, [
			{ model: "nan/free", thinking: "medium" },
			{ model: "xai/grok-4.7", thinking: "medium" },
		]);
		assert.deepEqual(tierLists(saved), {
			quick: ["xai/grok-4.7"],
			standard: [],
			high: [],
		});
		const [thinking] = jev.requests.filter(
			(request) =>
				isThinkingQuestion(request.body) &&
				request.body.state.model.startsWith("free "),
		);
		assert.equal(thinking.body.state.tier, undefined);
		assert.doesNotMatch(
			Object.values(thinking.body.questions)[0].instructions,
			/tier/,
		);
		const warnings = notifications.filter((entry) =>
			entry.message.startsWith("No catalog cost"),
		);
		assert.equal(warnings.length, 1);
		assert.match(
			warnings[0].message,
			/No catalog cost, so no tier:\n- nan\/free/,
		);
		assert.doesNotMatch(warnings[0].message, /grok/);
	});
});

test("a model Jev cannot place does not shift the tiers of the others", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) => {
			if (body.state.model.startsWith("mid "))
				return new Response("", { status: 502 });
			return isThinkingQuestion(body) ? "low" : { chat: 0.9 };
		});
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [
				model("x", "cheap", { input: 1, output: 1 }),
				model("x", "mid", { input: 2, output: 2 }),
				model("x", "dear", { input: 3, output: 3 }),
			],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(outcome.leftOut, [
			{ model: "x/mid", reason: "Jev returned 502" },
		]);
		assert.deepEqual(tierLists(await readJson(path)), {
			quick: ["x/cheap"],
			standard: [],
			high: ["x/dear"],
		});
	});
});

test("without a TypeSafe login every model is left out and no request is sent", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev(() => "chat");
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [model("nan", "gemma4"), model("xai", "grok-4.7")],
		});

		const outcome = await lists.create(ctx);

		assert.equal(outcome.status, "created");
		assert.deepEqual(
			outcome.leftOut.map((entry) => entry.model),
			["nan/gemma4", "xai/grok-4.7"],
		);
		for (const entry of outcome.leftOut) {
			assert.equal(
				entry.reason,
				"no TypeSafe API key; run /login and choose TypeSafe (Jev) or set TYPESAFE_API_KEY",
			);
		}
		assert.equal(jev.requests.length, 0);
		assert.deepEqual((await readJson(path)).specialists.chat, []);
	});
});

test("Jev offers only the supported levels and a level outside them is never saved", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body) =>
			isThinkingQuestion(body) ? "high" : { chat: 0.9 },
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [{ ...model("nan", "qwen3.8-flash"), reasoning: false }],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.deepEqual(
			Object.keys(Object.values(jev.requests[0].body.questions)[0].criteria),
			["off"],
		);
		assert.equal(jev.requests.length, 1);
		assert.deepEqual(
			outcome.leftOut.map((entry) => entry.model),
			["nan/qwen3.8-flash"],
		);
		assert.match(outcome.leftOut[0].reason, /high/);
		assert.deepEqual((await readJson(path)).specialists.chat, []);
	});
});

test("a failing Jev response leaves the model out with its status and never the body or the key", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev((body, _question) =>
			isThinkingQuestion(body)
				? "low"
				: new Response("  overloaded, key ts-other  \n", { status: 503 }),
		);
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx, notifications } = commandContext({
			models: [model("nan", "gemma4")],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.equal(outcome.leftOut.length, 1);
		assert.equal(outcome.leftOut[0].reason, "Jev returned 503");
		assert.doesNotMatch(outcome.leftOut[0].reason, /overloaded|ts-other/);
		for (const { message } of notifications)
			assert.doesNotMatch(message, /ts-secret/);
	});
});

test("a Jev response that is not JSON leaves the model out without quoting the body", async () => {
	await withConfigDirectory(async ({ path }) => {
		const jev = fakeJev(() => new Response("<html>proxy secret</html>"));
		const lists = createModelLists({ path, fetch: jev.fetch });
		const { ctx } = commandContext({
			models: [model("nan", "gemma4")],
			typesafeKey: "ts-secret",
		});

		const outcome = await lists.create(ctx);

		assert.equal(outcome.leftOut[0].reason, "Jev returned invalid JSON");
	});
});

test("at most four models are placed at once and every model is still saved in order", async () => {
	await withConfigDirectory(async ({ path }) => {
		let inFlight = 0;
		let peak = 0;
		const waiting = [];
		const lists = createModelLists({
			path,
			research: async () => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => waiting.push(resolve));
				inFlight -= 1;
				return { thinking: "low", notes: "" };
			},
			classify: async () => ({ chat: 1 }),
		});
		const ids = Array.from({ length: 10 }, (_, index) => `m${index}`);
		const { ctx } = commandContext({
			models: ids.map((id) => model("nan", id)),
		});

		const creating = lists.create(ctx);
		while (true) {
			await new Promise((resolve) => setImmediate(resolve));
			const next = waiting.shift();
			if (!next) break;
			next();
		}
		const outcome = await creating;

		assert.equal(peak, 4);
		assert.deepEqual(outcome.leftOut, []);
		assert.deepEqual(
			(await readJson(path)).specialists.chat.map((entry) => entry.model),
			ids.map((id) => `nan/${id}`),
		);
	});
});

test("the extension registers TypeSafe as an API-key provider without models for /login and TYPESAFE_API_KEY", async () => {
	const providers = [];
	piWorkflowExtension({
		on: () => {},
		exec: async () => ({ code: 0 }),
		registerCommand: () => {},
		registerTool: () => {},
		registerShortcut: () => {},
		registerProvider: (provider) => providers.push(provider),
	});

	assert.equal(providers.length, 1);
	const [typesafe] = providers;
	assert.equal(typesafe.id, "typesafe");
	assert.equal(typesafe.name, "TypeSafe (Jev)");
	assert.deepEqual(typesafe.getModels(), []);
	assert.equal(typesafe.auth.oauth, undefined);
	const signal = new AbortController().signal;
	const prompts = [];
	const credential = await typesafe.auth.apiKey.login({
		signal,
		notify: () => {},
		prompt: async (prompt) => {
			prompts.push(prompt.type);
			return "ts-typed";
		},
	});
	assert.deepEqual(prompts, ["secret"]);
	assert.deepEqual(credential, { type: "api_key", key: "ts-typed" });
	const env = {
		env: async (name) => (name === "TYPESAFE_API_KEY" ? "ts-env" : undefined),
	};
	const stored = await typesafe.auth.apiKey.resolve({
		ctx: env,
		credential,
		signal,
	});
	assert.equal(stored.auth.apiKey, "ts-typed");
	const fromEnv = await typesafe.auth.apiKey.resolve({ ctx: env, signal });
	assert.equal(fromEnv.auth.apiKey, "ts-env");
});
