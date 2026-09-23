import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
		return await run({ dir, path: join(dir, "agent", "pi-workflow-models.json") });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function model(provider, id) {
	return { provider, id, name: id, contextWindow: 200000, reasoning: true };
}

function commandContext({ hasUI = true, models = [], confirm = async () => false, editor } = {}) {
	const notifications = [];
	const ctx = {
		hasUI,
		mode: hasUI ? "tui" : "print",
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			confirm,
			editor: editor ?? (async () => undefined),
		},
		modelRegistry: { getAvailable: () => models },
	};
	return { ctx, notifications };
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
				({ "gpt-5.6-luna": "implement", "gpt-6-astra": "review", "qwen3.8-flash": "chat" })[
					candidate.id
				],
		});
		const { ctx } = commandContext({
			models: [
				model("openai-codex", "gpt-5.6-luna"),
				model("openai-codex", "gpt-6-astra"),
				model("nan", "qwen3.8-flash"),
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
		assert.deepEqual(saved.specialists.chat, [{ model: "nan/qwen3.8-flash", thinking: "low" }]);
		assert.deepEqual(saved.specialists.plan, []);
		assert.deepEqual(saved.tiers, {
			quick: [{ model: "nan/qwen3.8-flash", thinking: "low" }],
			standard: [{ model: "openai-codex/gpt-5.6-luna", thinking: "high" }],
			high: [{ model: "openai-codex/gpt-6-astra", thinking: "high" }],
		});
	});
});

test("a model that research or Jev cannot place is left out and the others are saved", async () => {
	await withConfigDirectory(async ({ path }) => {
		const lists = createModelLists({
			path,
			research: async (candidate) => {
				if (candidate.id === "offline") throw new Error("search failed");
				return { thinking: candidate.id === "unpinned" ? "turbo" : "medium", notes: "" };
			},
			classify: async (candidate) => {
				if (candidate.id === "jev-down") throw new Error("Jev timed out");
				return candidate.id === "abstained" ? "premium" : "debug";
			},
		});
		const { ctx, notifications } = commandContext({
			models: [
				model("xai", "grok-4.7"),
				model("nan", "offline"),
				model("nan", "unpinned"),
				model("nan", "jev-down"),
				model("nan", "abstained"),
			],
		});

		const outcome = await lists.create(ctx);

		assert.equal(outcome.status, "created");
		assert.deepEqual(
			outcome.leftOut.map((entry) => entry.model),
			["nan/offline", "nan/unpinned", "nan/jev-down", "nan/abstained"],
		);
		const saved = await readJson(path);
		assert.deepEqual(saved.specialists.debug, [{ model: "xai/grok-4.7", thinking: "medium" }]);
		assert.deepEqual(saved.tiers, {
			quick: [],
			standard: [{ model: "xai/grok-4.7", thinking: "medium" }],
			high: [],
		});
		const warning = notifications.find((entry) => entry.level === "warning");
		assert.match(warning.message, /nan\/offline: search failed/);
		assert.match(warning.message, /nan\/jev-down: Jev timed out/);
	});
});

const existingContent = '{"schemaVersion":1,"specialists":{},"tiers":{},"taskTypes":{}}\n';

async function writeExisting(path) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, existingContent, "utf8");
}

const placeEverything = {
	research: async () => ({ thinking: "low", notes: "" }),
	classify: async () => "chat",
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
		const { ctx } = commandContext({ hasUI: false, models: [model("nan", "gemma4")] });

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
			specialists: { research: [{ model: "nan/mimo-v2.5", thinking: "medium" }] },
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

		assert.deepEqual(createModelLists({ path }).load(), { status: "loaded", lists: content });
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
			JSON.stringify({ schemaVersion: 1, specialists: {}, tiers: { premium: [] }, taskTypes: {} }),
			JSON.stringify({ schemaVersion: 1, specialists: {}, tiers: {}, taskTypes: { chat: "premium" } }),
			JSON.stringify({ schemaVersion: 1, specialists: { chat: [{ model: "nan/gemma4" }] }, tiers: {}, taskTypes: {} }),
			JSON.stringify({ schemaVersion: 1, specialists: { chats: [] }, tiers: {}, taskTypes: {} }),
			JSON.stringify({ schemaVersion: 2, specialists: {}, tiers: {}, taskTypes: {} }),
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
		assert.deepEqual(afterReload.lists.tiers.quick, [{ model: "nan/gemma4", thinking: "low" }]);
	});
});

test("a file changed outside the command applies only after /reload", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeExisting(path);
		const lists = createModelLists({ path });
		await writeFile(path, "{ not json", "utf8");

		assert.deepEqual(lists.load(), { status: "loaded", lists: JSON.parse(existingContent) });
		assert.equal(createModelLists({ path }).load().status, "refused");
	});
});

test("the TUI editor writes the same file, reopening on invalid content", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeExisting(path);
		const edited = {
			schemaVersion: 1,
			specialists: { chat: [{ model: "nan/gemma4", thinking: "low" }] },
			tiers: { quick: [{ model: "nan/gemma4", thinking: "low" }] },
			taskTypes: { chat: "quick" },
		};
		const prefills = [];
		const answers = ["{ broken", JSON.stringify(edited)];
		const { ctx } = commandContext({
			editor: async (title, prefill) => {
				prefills.push({ title, prefill });
				return answers.shift();
			},
		});
		const lists = createModelLists({ path });

		assert.equal((await lists.edit(ctx)).status, "saved");
		assert.equal(prefills[0].prefill, existingContent);
		assert.equal(prefills[1].prefill, "{ broken");
		assert.match(prefills[1].title, /Invalid/);
		assert.deepEqual(await readJson(path), edited);
		assert.deepEqual(lists.load(), { status: "loaded", lists: JSON.parse(existingContent) });
		assert.deepEqual(createModelLists({ path }).load(), { status: "loaded", lists: edited });
	});
});

test("the TUI editor starts a missing file from the creation map and cancel writes nothing", async () => {
	await withConfigDirectory(async ({ path }) => {
		const prefills = [];
		const { ctx } = commandContext({
			editor: async (_title, prefill) => {
				prefills.push(prefill);
				return undefined;
			},
		});

		assert.equal((await createModelLists({ path }).edit(ctx)).status, "cancelled");
		const template = JSON.parse(prefills[0]);
		assert.deepEqual(template.taskTypes, creationMap);
		assert.deepEqual(template.tiers, { quick: [], standard: [], high: [] });
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("the editor refuses without the TUI and writes nothing", async (t) => {
	await withConfigDirectory(async ({ path }) => {
		const printed = [];
		t.mock.method(console, "error", (message) => printed.push(message));
		const { ctx } = commandContext({ hasUI: false, editor: async () => JSON.stringify({}) });

		assert.equal((await createModelLists({ path }).edit(ctx)).status, "refused");
		assert.equal(printed.length, 1);
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("the extension registers the create command and the TUI editor over the same file", async () => {
	await withConfigDirectory(async ({ path }) => {
		const commands = new Map();
		const pi = {
			on: () => {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool: () => {},
		};
		piWorkflowExtension(pi, { modelLists: { path, ...placeEverything } });

		const created = commandContext({ models: [model("nan", "gemma4")] });
		await commands.get("pi-workflow-models").handler("", created.ctx);
		const saved = await readFile(path, "utf8");

		const prefills = [];
		const edited = commandContext({
			editor: async (_title, prefill) => {
				prefills.push(prefill);
				return undefined;
			},
		});
		await commands.get("pi-workflow-models-edit").handler("", edited.ctx);

		assert.deepEqual(JSON.parse(prefills[0]), JSON.parse(saved));
		assert.deepEqual(JSON.parse(saved).specialists.chat, [{ model: "nan/gemma4", thinking: "low" }]);
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
		};
		piWorkflowExtension(pi, { modelLists: { path, ...placeEverything } });

		for (const name of ["pi-workflow-models", "pi-workflow-models-edit"]) {
			let edits = 0;
			const { ctx, notifications } = commandContext({
				models: [model("nan", "gemma4")],
				editor: async () => {
					edits += 1;
					return undefined;
				},
			});
			await commands.get(name).handler("--force", ctx);

			assert.equal(edits, 0, name);
			assert.equal(notifications.length, 1, name);
			assert.equal(notifications[0].level, "error");
			assert.match(notifications[0].message, /\/pi-workflow-models \| \/pi-workflow-models-edit/);
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
		};
		piWorkflowExtension(pi, { modelLists: { path, ...placeEverything } });

		for (const name of ["pi-workflow-models", "pi-workflow-models-edit"]) {
			const { ctx } = commandContext({ hasUI: false, models: [model("nan", "gemma4")] });
			await commands.get(name).handler("--force", ctx);
		}

		assert.equal(printed.length, 2);
		for (const message of printed) {
			assert.match(message, /\/pi-workflow-models \| \/pi-workflow-models-edit/);
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
					return "chat";
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
			assert.deepEqual(await readdir(dirname(path)), ["pi-workflow-models.json"]);
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

test("the TUI editor refuses a dangling symlink instead of starting a new file", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeDanglingSymlink(path);
		let edits = 0;
		const { ctx } = commandContext({
			editor: async () => {
				edits += 1;
				return JSON.stringify({ schemaVersion: 1, specialists: {}, tiers: {}, taskTypes: {} });
			},
		});

		assert.equal((await createModelLists({ path }).edit(ctx)).status, "refused");
		assert.equal(edits, 0);
		assert.equal((await lstat(path)).isSymbolicLink(), true);
	});
});

test("the command refuses when the file entry cannot be inspected", async (t) => {
	t.mock.method(console, "error", () => {});
	await withConfigDirectory(async ({ dir }) => {
		const notADirectory = join(dir, "agent");
		await writeFile(notADirectory, "", "utf8");
		const path = join(notADirectory, "pi-workflow-models.json");
		const { ctx, notifications } = commandContext({ models: [model("nan", "gemma4")] });

		const outcome = await createModelLists({ path, ...placeEverything }).create(ctx);

		assert.equal(outcome.status, "refused");
		assert.match(notifications.at(-1).message, /Unable to read/);
	});
});

test("the TUI editor does not replace a file created by another process while editing", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, notifications } = commandContext({
			editor: async (_title, prefill) => {
				await writeExisting(path);
				return prefill;
			},
		});

		const outcome = await createModelLists({ path }).edit(ctx);

		assert.equal(outcome.status, "kept");
		assert.equal(await readFile(path, "utf8"), existingContent);
		assert.match(notifications.at(-1).message, /not replaced/);
	});
});
