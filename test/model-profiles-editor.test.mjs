import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";

import {
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { execFileSync } from "node:child_process";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { capabilities, replaceSelection } from "../extensions/configure.ts";
import { createModelProfiles } from "../extensions/model-profiles.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { classifierRegistry } from "./support/fake-jev.mjs";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
	expectations: {},
});

const keys = {
	enter: "\r",
	escape: "\x1b",
	up: "\x1b[A",
	down: "\x1b[B",
	backspace: "\x7f",
};

const fakeTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
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
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-model-profiles-editor-"));
	try {
		return await run({ dir, path: join(dir, "agent", "pi-workflow-models.json") });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function writeProfiles(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({ schemaVersion: 2, ...content }), "utf8");
}

function editorContext({
	hasUI = true,
	mode = "tui",
	available = catalog,
	confirm = async () => false,
	keybindings = new KeybindingsManager(TUI_KEYBINDINGS),
	rows = 40,
	theme = fakeTheme,
} = {}) {
	const notifications = [];
	const opened = [];
	const waiting = [];
	const confirmations = [];
	const overlays = [];
	const ctx = {
		hasUI,
		mode,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			confirm: async (title, message) => {
				confirmations.push({ title, message });
				return confirm();
			},
			custom: (factory, options) =>
				new Promise((resolve) => {
					overlays.push(options);
					const panel = factory({ requestRender() {}, terminal: { rows } }, theme, keybindings, resolve);
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
	return { ctx, notifications, confirmations, overlays, nextPanel };
}

function press(panel, ...sequence) {
	for (const data of sequence) panel.handleInput(data);
}

function type(panel, text) {
	press(panel, ...text);
}

function lines(panel, width = 120) {
	const [top, ...rest] = panel.render(width).map((line) => stripVTControlCharacters(line));
	const title = top.replace(/^┌─ /, "").replace(/ ─+( \[×\] )?─┐$/, "");
	const body = rest
		.slice(0, -1)
		.map((line) => line.slice(1, -1).trim().replace(/^▸ /, "").replace(/\s*›$/, "").replace(/ {2,}/g, " "))
		.filter((line) => line !== "" && !/ ─+$/.test(line));
	return [title, ...body];
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function openPanel(path, options) {
	const context = editorContext(options);
	const editing = createModelProfiles({ path }).edit(context.ctx);
	const panel = await context.nextPanel();
	return { ...context, editing, panel };
}

async function saveFrom(panel, editing, path) {
	press(panel, "s");
	assert.equal((await editing).status, "saved");
	return readJson(path);
}

const existing = {
	active: "daily",
	profiles: {
		daily: {
			explorer: { model: "nan/mimo-v2.5", thinking: "off" },
			worker: { model: "openai-codex/gpt-5.6-luna", thinking: "medium" },
		},
		deep: {
			verifier: { model: "openai-codex/gpt-6-astra", thinking: "max" },
		},
	},
};

test("without a file the panel starts with one empty default profile marked active, and saving creates the file", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing, notifications } = await openPanel(path);

		assert.equal(lines(panel)[0], "Model profiles");
		assert.match(lines(panel)[1], /^default ● active$/);
		press(panel, keys.enter);
		assert.deepEqual(lines(panel).slice(0, 4), [
			"Profile default (active)",
			"explorer inherits session model",
			"worker inherits session model",
			"verifier inherits session model",
		]);

		assert.deepEqual(await saveFrom(panel, editing, path), {
			schemaVersion: 2,
			active: "default",
			profiles: { default: {} },
		});
		assert.match(notifications.at(-1).message, /^Saved model profiles to .*\.$/);
	});
});

test("Enter on a specialist picks a model by filter, then a thinking level it supports", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openPanel(path);

		press(panel, keys.enter, keys.down, keys.enter);
		type(panel, "luna");
		assert.deepEqual(lines(panel).slice(2, 4), ["openai-codex/gpt-5.6-luna", "type filter | ↑/↓ choose | Enter select | Esc back"]);
		press(panel, keys.enter);
		assert.deepEqual(lines(panel).slice(1, 6), ["off", "minimal", "low", "medium", "high"]);
		press(panel, keys.down, keys.down, keys.enter);

		assert.match(lines(panel)[2], /^worker\s+openai-codex\/gpt-5\.6-luna · thinking: low$/);
		press(panel, keys.escape);
		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(saved.profiles.default, {
			worker: { model: "openai-codex/gpt-5.6-luna", thinking: "low" },
		});
	});
});

test("the model picker lists only available models and the thinking screen only supported levels", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openPanel(path, { available: [catalog[1], catalog[2]] });

		press(panel, keys.enter, keys.enter);
		assert.deepEqual(lines(panel).slice(2, 4), ["openai-codex/gpt-6-astra", "nan/mimo-v2.5"]);
		press(panel, keys.down, keys.enter);
		assert.deepEqual(lines(panel).slice(1, 3), ["off", "↑/↓ choose | Enter confirm | Esc back"]);
		press(panel, "s");
		assert.match(lines(panel)[0], /Thinking level/);
		press(panel, keys.escape, keys.escape, keys.escape, keys.escape);

		assert.equal((await editing).status, "cancelled");
	});
});

test("i clears a specialist back to inheriting the session model", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing } = await openPanel(path);

		press(panel, keys.enter, keys.down, "i");
		assert.match(lines(panel)[2], /^worker\s+inherits session model$/);
		press(panel, keys.escape);

		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(saved.profiles.daily, {
			explorer: { model: "nan/mimo-v2.5", thinking: "off" },
		});
		assert.deepEqual(saved.profiles.deep, existing.profiles.deep);
	});
});

test("c creates an empty profile and a makes it active", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing } = await openPanel(path);

		press(panel, "c");
		assert.equal(lines(panel)[0], "New profile name");
		type(panel, "fast");
		press(panel, keys.enter);
		assert.match(lines(panel)[3], /^→?\s*fast$/);
		press(panel, "a");
		assert.match(lines(panel)[3], /^fast ● active$/);

		const saved = await saveFrom(panel, editing, path);
		assert.equal(saved.active, "fast");
		assert.deepEqual(saved.profiles.fast, {});
		assert.deepEqual(Object.keys(saved.profiles), ["daily", "deep", "fast"]);
	});
});

test("a new name must be a slug that no other profile uses", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing } = await openPanel(path);

		press(panel, "c");
		type(panel, "Fast");
		press(panel, keys.enter);
		assert.match(lines(panel)[1], /lowercase letters, digits, or hyphens/);
		press(panel, keys.backspace, keys.backspace, keys.backspace, keys.backspace);
		type(panel, "deep");
		press(panel, keys.enter);
		assert.match(lines(panel)[1], /deep already exists/);
		type(panel, "-".repeat(61));
		press(panel, keys.enter);
		assert.match(lines(panel)[1], /1 to 64/);
		press(panel, keys.escape);
		assert.equal(lines(panel)[0], "Model profiles");

		press(panel, keys.escape);
		assert.equal((await editing).status, "cancelled");
	});
});

test("d duplicates the selected profile under a new name", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing } = await openPanel(path);

		press(panel, "d");
		assert.equal(lines(panel)[0], "Duplicate daily as");
		press(panel, keys.enter);
		press(panel, keys.enter, "i");

		const saved = await saveFrom(panel, editing, path);
		assert.equal(saved.active, "daily");
		assert.deepEqual(saved.profiles.daily, existing.profiles.daily);
		assert.deepEqual(saved.profiles["daily-copy"], {
			worker: existing.profiles.daily.worker,
		});
	});
});

test("renaming the active profile keeps its place and moves the active mark", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing } = await openPanel(path);

		press(panel, "r");
		press(panel, ..."daily".split("").map(() => keys.backspace));
		type(panel, "main");
		press(panel, keys.enter);
		assert.match(lines(panel)[1], /^main ● active$/);

		const saved = await saveFrom(panel, editing, path);
		assert.equal(saved.active, "main");
		assert.deepEqual(Object.keys(saved.profiles), ["main", "deep"]);
		assert.deepEqual(saved.profiles.main, existing.profiles.daily);
	});
});

test("renaming to the same name changes nothing", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing, confirmations } = await openPanel(path);

		press(panel, "r", keys.enter, keys.escape);

		assert.equal((await editing).status, "cancelled");
		assert.equal(confirmations.length, 0);
	});
});

test("x refuses to delete the active profile and deletes another only after y", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing } = await openPanel(path);

		press(panel, "x");
		assert.match(lines(panel)[1], /daily is the active profile and cannot be deleted/);
		assert.equal(lines(panel)[0], "Model profiles");

		press(panel, keys.down, "x");
		assert.equal(lines(panel)[0], "Delete profile deep?");
		press(panel, "n");
		assert.match(lines(panel)[2], /deep/);
		press(panel, "x", keys.escape);
		assert.match(lines(panel)[2], /deep/);
		press(panel, "x", "y");
		assert.equal(lines(panel).length, 3);

		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(saved.profiles, { daily: existing.profiles.daily });
	});
});

test("Esc with unsaved changes asks before discarding and reopens the panel when declined", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		let discard = false;
		const { panel, editing, confirmations, nextPanel } = await openPanel(path, {
			confirm: () => discard,
		});

		press(panel, keys.down, "a", keys.escape);
		const second = await nextPanel();
		assert.equal(confirmations.length, 1);
		assert.match(confirmations[0].title, /Discard/);
		assert.match(lines(second)[2], /^deep ● active$/);

		discard = true;
		press(second, keys.escape);

		assert.equal((await editing).status, "cancelled");
		assert.equal(confirmations.length, 2);
		assert.equal((await readJson(path)).active, "daily");
	});
});

test("Esc without changes exits without asking and writes nothing", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing, confirmations } = await openPanel(path);

		press(panel, keys.escape);

		assert.equal((await editing).status, "cancelled");
		assert.equal(confirmations.length, 0);
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("an invalid, schema version 1, or unreadable file refuses to open the panel and is kept", async () => {
	await withConfigDirectory(async ({ path }) => {
		await mkdir(dirname(path), { recursive: true });
		const refusals = [
			["{ broken", /Invalid model profiles/],
			[
				JSON.stringify({ schemaVersion: 1, specialists: {}, tiers: {}, taskTypes: {} }),
				/schema version 1.*recreate the profiles with \/workflow:models/,
			],
		];
		for (const [content, reason] of refusals) {
			await writeFile(path, content, "utf8");
			const invalid = editorContext();
			invalid.ctx.ui.custom = () => assert.fail("the panel must not open");

			assert.equal((await createModelProfiles({ path }).edit(invalid.ctx)).status, "refused");
			assert.match(invalid.notifications.at(-1).message, reason);
			assert.equal(await readFile(path, "utf8"), content);
		}

		await rm(path);
		await symlink(join(dirname(path), "missing-target.json"), path);
		const dangling = editorContext();
		dangling.ctx.ui.custom = () => assert.fail("the panel must not open");

		assert.equal((await createModelProfiles({ path }).edit(dangling.ctx)).status, "refused");
		assert.match(dangling.notifications.at(-1).message, /Unable to read/);
		assert.equal((await lstat(path)).isSymbolicLink(), true);
	});
});

test("the panel refuses outside the TUI", async (t) => {
	const printed = [];
	t.mock.method(console, "error", (message) => printed.push(message));
	await withConfigDirectory(async ({ path }) => {
		for (const context of [editorContext({ hasUI: false, mode: "print" }), editorContext({ mode: "rpc" })]) {
			context.ctx.ui.custom = () => assert.fail("the panel must not open");
			assert.equal((await createModelProfiles({ path }).edit(context.ctx)).status, "refused");
		}
		assert.deepEqual(printed, ["The model profiles panel needs the TUI."]);
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});

test("the model picker honours remapped selection keybindings", async (t) => {
	const remapped = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.down": "ctrl+n" });
	setKeybindings(remapped);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openPanel(path, { keybindings: remapped });

		press(panel, keys.enter, keys.enter, "\x0e", keys.enter, keys.enter, keys.escape);

		const saved = await saveFrom(panel, editing, path);
		assert.deepEqual(saved.profiles.default.explorer, {
			model: "openai-codex/gpt-6-astra",
			thinking: "off",
		});
	});
});

test("the panel opens as a centered overlay framed like a Grok modal at every width", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing, overlays } = await openPanel(path);

		assert.deepEqual(overlays[0], {
			overlay: true,
			overlayOptions: { anchor: "center", width: "70%", minWidth: 44, maxHeight: "100%" },
		});
		const shown = panel.render(60);
		assert.deepEqual(shown, [
			`┌─ Model profiles ${"─".repeat(35)} [×] ─┐`,
			`│${" ".repeat(58)}│`,
			`│   Profiles ${"─".repeat(44)}  │`,
			`│  ▸ daily${" ".repeat(36)}● active ›   │`,
			`│  ▸ deep${" ".repeat(46)}›   │`,
			`│${" ".repeat(58)}│`,
			"│  Enter open  |  a activate  |  c create  |  d duplicate  │",
			`│      r rename  |  x delete  |  s save  |  Esc exit${" ".repeat(7)}│`,
			`└${"─".repeat(58)}┘`,
		]);
		for (const width of [10, 24, 44, 80, 120, 160]) {
			const lines = panel.render(width);
			assert.ok(lines.at(-1).startsWith("└"));
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
		}
		press(panel, keys.escape);
		assert.equal((await editing).status, "cancelled");
	});
});

test("every rendered row fits the width and hostile model names cannot inject control sequences", async () => {
	await withConfigDirectory(async ({ path }) => {
		const longName = "nan/model-with-a-very-long-name-that-overflows";
		await writeProfiles(path, {
			active: "default",
			profiles: { default: { explorer: { model: longName, thinking: "low" } } },
		});
		const { ctx, nextPanel } = editorContext();
		ctx.modelRegistry.getAvailable = () => [{ provider: "nan", id: "evil\x1b[2J‮name" }];
		const editing = createModelProfiles({ path }).edit(ctx);
		const panel = await nextPanel();
		const width = 24;
		const screens = [];

		screens.push(panel.render(width));
		press(panel, keys.enter);
		screens.push(panel.render(width));
		press(panel, keys.enter);
		screens.push(panel.render(width));
		press(panel, keys.enter);
		screens.push(panel.render(width));
		press(panel, keys.escape, keys.escape, keys.escape, "x");
		screens.push(panel.render(width));

		for (const line of screens.flat()) {
			assert.ok(visibleWidth(line) <= width, JSON.stringify(line));
			for (const unsafe of ["\x1b[2J", "‮", "\n"]) {
				assert.ok(!line.includes(unsafe), JSON.stringify(line));
			}
		}
		press(panel, keys.escape);
		assert.equal((await editing).status, "cancelled");
	});
});

test("saving keeps a file changed or corrupted while the panel was open", async () => {
	await withConfigDirectory(async ({ path }) => {
		for (const changed of [
			JSON.stringify({ schemaVersion: 2, active: "other", profiles: { other: {} } }),
			"{ not json",
		]) {
			await writeProfiles(path, existing);
			const { panel, editing, notifications } = await openPanel(path);
			await writeFile(path, changed, "utf8");

			press(panel, "s");

			assert.equal((await editing).status, "kept");
			assert.equal(await readFile(path, "utf8"), changed);
			assert.match(notifications.at(-1).message, /changed on disk since the panel opened/);
			assert.equal(notifications.at(-1).level, "warning");
		}
	});
});

test("saving keeps a file that became unreadable while the panel was open", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing, notifications } = await openPanel(path);
		await rm(path);
		await mkdir(path);

		press(panel, "s");

		assert.equal((await editing).status, "kept");
		assert.match(notifications.at(-1).message, /changed on disk/);
	});
});

test("a launch right after a panel save uses the saved profile", async () => {
	await withConfigDirectory(async ({ dir, path }) => {
		const profiles = createModelProfiles({ path });
		const context = editorContext();
		const editing = profiles.edit(context.ctx);
		const panel = await context.nextPanel();
		press(panel, keys.enter, keys.down, keys.enter);
		type(panel, "luna");
		press(panel, keys.enter, keys.down, keys.down, keys.enter, keys.escape);
		press(panel, "s");
		assert.equal((await editing).status, "saved");

		const worktree = join(dir, "repo");
		await mkdir(worktree);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		const jev = classifierRegistry(() => ({
			answers: {
				specialist: {
					type: "choice",
					choice: "worker",
					confidence: 0.9,
					probabilities: { explorer: 0, worker: 1, verifier: 0 },
				},
				destination: {
					type: "choice",
					choice: "leave",
					confidence: 0.9,
					probabilities: { stay: 0, leave: 1 },
				},
			},
		}));
		const result = await createChildLauncher({
			modelProfiles: profiles,
		}).prepareLaunch(
			{ role: "worker", task: "Add the export command" },
			{
				cwd: worktree,
				model: undefined,
				thinkingLevel: undefined,
				modelRegistry: {
					getApiKeyForProvider: async () => "typesafe-key",
					getAvailable: () => catalog,
					...jev.registry,
				},
			},
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.model, "openai-codex/gpt-5.6-luna");
		assert.equal(result.thinking, "low");
	});
});

test("re-picking a cleared specialist to the same value is not an unsaved change", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const { panel, editing, confirmations } = await openPanel(path);

		press(panel, keys.enter, "i", keys.enter);
		type(panel, "mimo");
		press(panel, keys.enter, keys.enter, keys.escape, keys.escape);

		assert.equal((await editing).status, "cancelled");
		assert.equal(confirmations.length, 0);
	});
});

test("the model picker does not offer a model with no supported thinking levels", async () => {
	await withConfigDirectory(async ({ path }) => {
		const silent = {
			provider: "acme",
			id: "silent",
			reasoning: true,
			thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
		};
		const context = editorContext({ available: [...catalog, silent] });
		context.ctx.modelRegistry.getAll = () => [...catalog, silent];
		const editing = createModelProfiles({ path }).edit(context.ctx);
		const panel = await context.nextPanel();

		press(panel, keys.enter, keys.enter);

		const rows = lines(panel);
		assert.ok(rows.includes("openai-codex/gpt-5.6-luna"));
		assert.ok(!rows.includes("acme/silent"));
		press(panel, keys.escape, keys.escape, keys.escape);
		assert.equal((await editing).status, "cancelled");
	});
});

test("saving keeps a file another process created while the panel was open", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing, notifications } = await openPanel(path);
		await writeProfiles(path, existing);

		press(panel, "s");

		assert.equal((await editing).status, "kept");
		assert.deepEqual((await readJson(path)).profiles, existing.profiles);
		assert.match(notifications.at(-1).message, /was not replaced/);
	});
});

test("/workflow:models opens the panel over the saved profiles and /workflow:models-edit no longer exists", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		const commands = new Map();
		const pi = {
			on: () => {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool: () => {},
			registerShortcut: () => {},
			registerProvider: () => {},
			registerMessageRenderer: () => {},
		};
		piWorkflowExtension(pi, { modelProfiles: { path } });
		const { ctx, nextPanel } = editorContext();

		assert.equal(commands.has("workflow:models-edit"), false);
		const editing = commands.get("workflow:models").handler("", ctx);
		const panel = await nextPanel();
		press(panel, keys.enter);

		assert.match(lines(panel)[1], /^explorer\s+nan\/mimo-v2\.5 · thinking: off$/);
		press(panel, keys.escape, keys.escape);
		await editing;
	});
});

test("the profile screen highlights the row that Enter opens", async () => {
	await withConfigDirectory(async ({ path }) => {
		const { panel, editing } = await openPanel(path, {
			theme: { ...fakeTheme, bg: (_color, text) => `\x1b[7m${text}` },
		});
		press(panel, keys.enter, keys.down, keys.down);

		const marked = panel
			.render(80)
			.filter((line) => line.includes("\x1b[7m"))
			.map((line) => stripVTControlCharacters(line));
		assert.equal(marked.length, 1);
		assert.match(marked[0], /verifier/);
		press(panel, keys.enter);
		assert.match(lines(panel)[0], /verifier model$/);
		press(panel, keys.escape, keys.escape, keys.escape);
		assert.equal((await editing).status, "cancelled");
	});
});

test("clicking [×] exits like Esc, asking first when there are unsaved changes", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		let discard = false;
		const { panel, editing, confirmations, nextPanel } = await openPanel(path, {
			confirm: () => discard,
		});
		const click = (x, y) => panel.handleMouse({ type: "click", button: "left", x, y });
		const top = stripVTControlCharacters(panel.render(60)[0]);
		const x = top.indexOf("[×]") + 1;

		assert.equal(click(x - 3, 0), undefined);
		assert.equal(click(x, 1), undefined);
		press(panel, keys.down, "a");
		assert.deepEqual(click(x, 0), { handled: true });
		const second = await nextPanel();
		assert.equal(confirmations.length, 1);

		discard = true;
		second.render(60);
		second.handleMouse({ type: "click", button: "left", x, y: 0 });
		assert.equal((await editing).status, "cancelled");
	});
});

test("on a short terminal the panel never exceeds the height and keeps its bottom border and hints", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeProfiles(path, existing);
		for (const rows of [3, 4, 6, 8, 10, 14]) {
			const { panel, editing } = await openPanel(path, { rows });
			for (const width of [10, 44, 80]) {
				const shown = panel.render(width);
				assert.ok(shown.length <= rows, `${rows}x${width}: ${shown.length}`);
				assert.ok(shown.at(-1).startsWith("└") || width < 4);
			}
			press(panel, keys.escape);
			await editing;
		}
		const { panel, editing } = await openPanel(path, { rows: 10 });
		assert.match(stripVTControlCharacters(panel.render(80).at(-2)), /Enter open|Esc exit/);
		press(panel, keys.escape);
		await editing;
	});
});
