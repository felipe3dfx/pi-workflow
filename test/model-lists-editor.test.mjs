import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
	CURSOR_MARKER,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createModelLists } from "../extensions/model-lists.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

const keys = {
	enter: "\r",
	escape: "\x1b",
	up: "\x1b[A",
	down: "\x1b[B",
	left: "\x1b[D",
	right: "\x1b[C",
	shiftUp: "\x1b[1;2A",
	shiftDown: "\x1b[1;2B",
};

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

const fakeTheme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

const catalog = [
	{ provider: "openai-codex", id: "gpt-5.6-luna", reasoning: true },
	{
		provider: "openai-codex",
		id: "gpt-6-astra",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh", max: "max" },
	},
	{ provider: "nan", id: "mimo-v2.5", reasoning: false },
];

async function withConfigDirectory(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-model-lists-editor-"));
	try {
		return await run({ dir, path: join(dir, "agent", "pi-workflow-models.json") });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function writeLists(path, lists) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({ schemaVersion: 1, ...lists }), "utf8");
}

function editorContext({
	hasUI = true,
	mode = "tui",
	available = catalog,
	confirm = async () => false,
	keybindings = new KeybindingsManager(TUI_KEYBINDINGS),
} = {}) {
	const notifications = [];
	const opened = [];
	const waiting = [];
	const confirmations = [];
	const ctx = {
		hasUI,
		mode,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			confirm: async (title, message) => {
				confirmations.push({ title, message });
				return confirm();
			},
			custom: (factory) =>
				new Promise((resolve) => {
					const panel = factory({ requestRender() {} }, fakeTheme, keybindings, resolve);
					const waiter = waiting.shift();
					if (waiter) waiter(panel);
					else opened.push(panel);
				}),
		},
		modelRegistry: {
			getAll: () => catalog,
			getAvailable: () => available,
		},
	};
	const nextPanel = () =>
		opened.length > 0
			? Promise.resolve(opened.shift())
			: new Promise((resolve) => waiting.push(resolve));
	return { ctx, notifications, confirmations, nextPanel };
}

function press(panel, ...sequence) {
	for (const data of sequence) panel.handleInput(data);
}

function type(panel, text) {
	press(panel, ...text);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

test("the panel speaks English like the rest of the harness", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel, notifications } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		assert.deepEqual(panel.render(80).slice(0, 4).map((line) => line.trim().replace(/^→ /, "")), [
			"Model lists",
			"Specialists by task type",
			"Tiers (quick · standard · high)",
			"Map: task type → tier",
		]);
		press(panel, keys.enter, keys.enter);
		assert.match(panel.render(80).join("\n"), /\(empty\)/);
		press(panel, keys.escape, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.match(notifications.at(-1).message, /^Saved .* applies after \/reload\.$/);
	});
});

test("adding a model from the catalog with a thinking level and saving writes the file", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.down, keys.down, keys.down, keys.down, keys.enter, "a");
		type(panel, "luna");
		press(panel, keys.enter, keys.down, keys.down, keys.down, keys.down, keys.enter);
		press(panel, keys.escape, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		const saved = await readJson(path);
		assert.deepEqual(saved.specialists.implement, [
			{ model: "openai-codex/gpt-5.6-luna", thinking: "high" },
		]);
		assert.deepEqual(saved.taskTypes, creationMap);
		assert.deepEqual(saved.tiers, { quick: [], standard: [], high: [] });
	});
});

const existing = {
	specialists: {
		implement: [
			{ model: "openai-codex/gpt-5.6-luna", thinking: "high" },
			{ model: "nan/mimo-v2.5", thinking: "low" },
			{ model: "openai-codex/gpt-6-astra", thinking: "max" },
		],
	},
	tiers: { standard: [{ model: "nan/mimo-v2.5", thinking: "medium" }] },
	taskTypes: { implement: "standard" },
};

async function openImplementList(path) {
	await writeLists(path, existing);
	const context = editorContext();
	const editing = createModelLists({ path }).edit(context.ctx);
	const panel = await context.nextPanel();
	press(panel, keys.enter, keys.down, keys.down, keys.down, keys.down, keys.enter);
	return { ...context, editing, panel };
}

async function saveFrom(panel, editing, path) {
	press(panel, keys.escape, keys.escape, "s");
	assert.equal((await editing).status, "saved");
	return readJson(path);
}

test("the catalog lists only available models and keeps stored unavailable entries", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeLists(path, {
			specialists: { chat: [{ model: "openai-codex/gpt-6-astra", thinking: "max" }] },
			tiers: {},
			taskTypes: {},
		});
		const { ctx, nextPanel } = editorContext({ available: [catalog[0]] });
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a");
		const shown = panel.render(80).join("\n");
		assert.match(shown, /openai-codex\/gpt-5\.6-luna/);
		assert.doesNotMatch(shown, /gpt-6-astra|mimo-v2\.5/);
		type(panel, "astra");
		assert.match(panel.render(80).join("\n"), /No matches/);
		press(panel, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "openai-codex/gpt-6-astra", thinking: "max" },
		]);
	});
});

test("after an addition the catalog returns cleared for the next model, and Esc goes back to the list", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a");
		type(panel, "luna");
		press(panel, keys.enter, keys.down, keys.down, keys.down, keys.down, keys.enter);
		const catalogAgain = panel.render(80);
		assert.match(catalogAgain[0], /^Add .*1 model/);
		assert.ok(catalogAgain[1].startsWith(`> ${CURSOR_MARKER}`), JSON.stringify(catalogAgain[1]));
		assert.equal(catalogAgain.filter((line) => /openai-codex|nan\//.test(line)).length, 3);

		type(panel, "mimo");
		press(panel, keys.enter, keys.enter);
		assert.match(panel.render(80)[0], /^Add .*2 models/);
		press(panel, keys.escape);
		const list = panel.render(80);
		assert.equal(list[0], "Specialists: chat");
		assert.match(list[1], /1 {2}openai-codex\/gpt-5\.6-luna/);
		assert.match(list[2], /2 {2}nan\/mimo-v2\.5/);
		press(panel, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "openai-codex/gpt-5.6-luna", thinking: "high" },
			{ model: "nan/mimo-v2.5", thinking: "off" },
		]);
	});
});

test("d removes the selected model from the list", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openImplementList(path);

		press(panel, keys.down, "d");

		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(saved.specialists.implement, [
			{ model: "openai-codex/gpt-5.6-luna", thinking: "high" },
			{ model: "openai-codex/gpt-6-astra", thinking: "max" },
		]);
		assert.deepEqual(saved.tiers.standard, [{ model: "nan/mimo-v2.5", thinking: "medium" }]);
	});
});

test("Shift+arrows move the selected model within the list", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openImplementList(path);

		press(panel, keys.down, keys.down, keys.shiftUp, keys.shiftUp, keys.down, keys.shiftDown);

		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(
			saved.specialists.implement.map((entry) => entry.model),
			["openai-codex/gpt-6-astra", "nan/mimo-v2.5", "openai-codex/gpt-5.6-luna"],
		);
	});
});

test("t cycles the thinking level of the selected model", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openImplementList(path);

		press(panel, "t", keys.down, "t", keys.down, "t");

		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(
			saved.specialists.implement.map((entry) => entry.thinking),
			["off", "off", "off"],
		);
	});
});

test("the add flow offers only the thinking levels the model supports", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a");
		type(panel, "mimo");
		press(panel, keys.enter);
		const levels = panel.render(80).slice(1, -1);

		assert.deepEqual(levels.map((line) => line.trim().replace(/^→ /, "")), ["off"]);
		press(panel, keys.escape, keys.escape, keys.escape, keys.escape, keys.escape);
		await editing;
	});
});

test("t keeps the stored level of a model that is not in the catalog", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeLists(path, {
			specialists: { chat: [{ model: "retired/model", thinking: "medium" }] },
			tiers: {},
			taskTypes: {},
		});
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "t");
		press(panel, keys.escape, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "retired/model", thinking: "medium" },
		]);
	});
});

test("t cycles a stored model that is registered but has no credentials", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeLists(path, {
			specialists: { chat: [{ model: "openai-codex/gpt-6-astra", thinking: "max" }] },
			tiers: {},
			taskTypes: {},
		});
		const { ctx, nextPanel } = editorContext({ available: [catalog[0]] });
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "t", "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "openai-codex/gpt-6-astra", thinking: "off" },
		]);
	});
});

test("the map screen changes a task type's tier with the arrows", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeLists(path, existing);
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.down, keys.down, keys.enter);
		assert.ok(panel.render(80).some((line) => /implement\s+◂ standard ▸/.test(line)));
		press(panel, keys.down, keys.down, keys.down, keys.down, keys.right);
		press(panel, keys.up, keys.left);
		press(panel, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).taskTypes, { implement: "high", operate: "high" });
	});
});

test("the map cycles a task type back to unset", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeLists(path, existing);
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.down, keys.down, keys.enter);
		press(panel, keys.down, keys.down, keys.down, keys.down, keys.right, keys.right);
		assert.ok(panel.render(80).some((line) => /implement\s+◂ — ▸/.test(line)));
		press(panel, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).taskTypes, {});
	});
});

test("s saves from a nested screen but types into the catalog filter", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openImplementList(path);

		press(panel, "a", "s");
		assert.ok(panel.render(80)[1].startsWith("> s"));
		press(panel, keys.escape, "d", "s");

		assert.equal((await editing).status, "saved");
		assert.equal((await readJson(path)).specialists.implement.length, 2);
	});
});

test("s on the thinking-level screen does not save or drop the model being added", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a");
		type(panel, "luna");
		press(panel, keys.enter, "s");
		const settled = await Promise.race([
			editing.then(() => true),
			new Promise((resolve) => setImmediate(() => resolve(false))),
		]);
		assert.equal(settled, false);
		press(panel, keys.enter, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "openai-codex/gpt-5.6-luna", thinking: "off" },
		]);
	});
});

test("a pasted control sequence in the catalog filter never reaches the screen", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a", "\x1b[200~ab\x1b]52;c;SGVsbG8=\x07\x1b[201~");

		for (const line of panel.render(80)) {
			let visible = line;
			for (const own of [CURSOR_MARKER, "\x1b[7m", "\x1b[27m", "\x1b[0m"]) {
				visible = visible.replaceAll(own, "");
			}
			assert.ok(!visible.includes("\x1b") && !visible.includes("\x07"), JSON.stringify(line));
		}
		press(panel, keys.escape, keys.escape, keys.escape, keys.escape);
		await editing;
	});
});

test("the catalog filter shows the input cursor where typing will insert", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a", "a", "b", keys.left);
		const filter = panel.render(80)[1];

		assert.ok(filter.includes(`a${CURSOR_MARKER}\x1b[7mb`), JSON.stringify(filter));
		press(panel, keys.escape, keys.escape, keys.escape, keys.escape);
		await editing;
	});
});

test("the map keeps the tier visible at 40 columns while the arrows change it", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext({ confirm: () => true });
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.down, keys.down, keys.enter);
		assert.match(panel.render(40)[1], /chat\s+◂ quick ▸/);
		press(panel, keys.right);
		assert.match(panel.render(40)[1], /chat\s+◂ standard ▸/);
		press(panel, keys.escape, keys.escape);
		await editing;
	});
});

test("the catalog honours remapped selection keybindings", async (t) => {
	const remapped = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.down": "ctrl+n" });
	setKeybindings(remapped);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel } = editorContext({ keybindings: remapped });
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();

		press(panel, keys.enter, keys.enter, "a", "\x0e", keys.enter, keys.enter, keys.escape, "s");

		assert.equal((await editing).status, "saved");
		assert.deepEqual((await readJson(path)).specialists.chat, [
			{ model: "openai-codex/gpt-6-astra", thinking: "off" },
		]);
	});
});

test("Esc with unsaved changes asks before discarding and reopens the panel when declined", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeLists(path, existing);
		let discard = false;
		const { ctx, nextPanel, confirmations } = editorContext({ confirm: () => discard });
		const editing = createModelLists({ path }).edit(ctx);
		const first = await nextPanel();

		press(first, keys.enter, keys.down, keys.down, keys.down, keys.down, keys.enter, "d");
		press(first, keys.escape, keys.escape, keys.escape);
		const second = await nextPanel();
		assert.equal(confirmations.length, 1);
		assert.match(confirmations[0].title, /Discard/);

		discard = true;
		press(second, keys.escape);

		assert.equal((await editing).status, "cancelled");
		assert.equal(confirmations.length, 2);
		assert.deepEqual((await readJson(path)).specialists, existing.specialists);
	});
});

test("Esc without changes exits without asking", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel, confirmations } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);

		press(await nextPanel(), keys.escape);

		assert.equal((await editing).status, "cancelled");
		assert.equal(confirmations.length, 0);
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("an invalid or unreadable file refuses to open the editor and is kept", async () => {
	await withConfigDirectory(async ({ path }) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, "{ broken", "utf8");
		const invalid = editorContext();
		invalid.ctx.ui.custom = () => assert.fail("the panel must not open");

		assert.equal((await createModelLists({ path }).edit(invalid.ctx)).status, "refused");
		assert.match(invalid.notifications.at(-1).message, /Invalid model lists/);
		assert.equal(await readFile(path, "utf8"), "{ broken");

		await rm(path);
		await symlink(join(dirname(path), "missing-target.json"), path);
		const dangling = editorContext();
		dangling.ctx.ui.custom = () => assert.fail("the panel must not open");

		assert.equal((await createModelLists({ path }).edit(dangling.ctx)).status, "refused");
		assert.match(dangling.notifications.at(-1).message, /Unable to read/);
		assert.equal((await lstat(path)).isSymbolicLink(), true);
	});
});

test("the editor refuses outside the TUI", async (t) => {
	const printed = [];
	t.mock.method(console, "error", (message) => printed.push(message));
	await withConfigDirectory(async ({ path }) => {
		for (const context of [editorContext({ hasUI: false, mode: "print" }), editorContext({ mode: "rpc" })]) {
			context.ctx.ui.custom = () => assert.fail("the panel must not open");
			assert.equal((await createModelLists({ path }).edit(context.ctx)).status, "refused");
		}
		assert.equal(printed.length, 1);
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("every rendered row fits the width and hostile model names cannot inject control sequences", async () => {
	await withConfigDirectory(async ({ path }) => {
		const hostile = "nan/evil\x1b[2J\u202Emodel-with-a-very-long-name-that-overflows";
		await writeLists(path, {
			specialists: { chat: [{ model: hostile, thinking: "low" }] },
			tiers: {},
			taskTypes: {},
		});
		const { ctx, nextPanel } = editorContext();
		ctx.modelRegistry.getAvailable = () => [{ provider: "nan", id: "evil\x1b[2J\u202Ename" }];
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();
		const width = 24;
		const screens = [];

		screens.push(panel.render(width));
		press(panel, keys.enter);
		screens.push(panel.render(width));
		press(panel, keys.enter);
		screens.push(panel.render(width));
		press(panel, "a");
		screens.push(panel.render(width));
		press(panel, keys.enter);
		screens.push(panel.render(width));
		press(panel, keys.escape, keys.escape, keys.escape, keys.escape, keys.down, keys.down, keys.enter);
		screens.push(panel.render(width));

		for (const line of screens.flat()) {
			assert.ok(visibleWidth(line) <= width, JSON.stringify(line));
			for (const unsafe of ["\x1b[2J", "\u202E", "\n"]) {
				assert.ok(!line.includes(unsafe), JSON.stringify(line));
			}
		}
		press(panel, keys.escape, keys.escape);
		assert.equal((await editing).status, "cancelled");
	});
});

test("saving keeps a file another process created while the editor was open", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { ctx, nextPanel, notifications } = editorContext();
		const editing = createModelLists({ path }).edit(ctx);
		const panel = await nextPanel();
		await writeLists(path, existing);

		press(panel, "s");

		assert.equal((await editing).status, "kept");
		assert.deepEqual((await readJson(path)).specialists, existing.specialists);
		assert.match(notifications.at(-1).message, /was not replaced/);
	});
});

test("the extension's edit command opens the panel over the file the create command wrote", async () => {
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
		piWorkflowExtension(pi, {
			modelLists: {
				path,
				research: async () => ({ thinking: "low", notes: "" }),
				classify: async () => ({ chat: 1 }),
			},
		});
		const { ctx, nextPanel } = editorContext({ available: [{ provider: "nan", id: "mimo-v2.5", cost: { input: 1, output: 1 } }] });
		await commands.get("pi-workflow-models").handler("", ctx);

		const editing = commands.get("pi-workflow-models-edit").handler("", ctx);
		const panel = await nextPanel();
		press(panel, keys.enter, keys.enter);

		assert.ok(panel.render(80).some((line) => /1 {2}nan\/mimo-v2\.5\s+thinking: low/.test(line)));
		press(panel, keys.escape, keys.escape, keys.escape);
		await editing;
	});
});
