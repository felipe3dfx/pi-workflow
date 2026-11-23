import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
	getSettingsListTheme,
	initTheme,
	SettingsSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, SettingsList } from "@earendil-works/pi-tui";
import { createChatViewport } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";

import { createAdvisor } from "../extensions/advisor.ts";
import { renderChildrenBox } from "../extensions/children-box.ts";
import { createChildrenViews } from "../extensions/children-view.ts";
import { patchMenus, restoreMenus } from "../extensions/chrome-menus.ts";
import { capabilities } from "../extensions/configure.ts";
import { fixHeader } from "../extensions/fixed-header.ts";
import { createModelProfiles } from "../extensions/model-profiles.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { renderTodoBox } from "../extensions/todo-header.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { catalogOf, keys } from "./support/config-guide.mjs";
import { densityTerminal } from "./support/density-terminal.mjs";
import { eventually } from "./support/eventually.mjs";
import { catalog } from "./support/model-picker.mjs";
import { piScreen } from "./support/pi-screen.mjs";

initTheme("dark", false);
const THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");
const theme = globalThis[THEME];
const plain = (lines) => lines.map((line) => stripVTControlCharacters(line));

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(
		capabilities.map((capability) => [capability, true]),
	),
	expectations: {},
});

const wideBytes = JSON.parse(
	readFileSync(
		new URL("./fixtures/wide-overlays.json", import.meta.url),
		"utf8",
	),
);

function context(screen) {
	return {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		isProjectTrusted: () => false,
		ui: { notify() {}, confirm: async () => true, custom: screen.custom },
		modelRegistry: { getAll: () => catalog, getAvailable: () => catalog },
	};
}

function click(x, y, width = 44, height = 40) {
	return {
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

async function openGuide(t, screen) {
	const commands = new Map();
	piWorkflowExtension(
		{
			on() {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			sendMessage() {},
		},
		{ agentDirectory: withAgentDirectory(t), catalog: catalogOf() },
	);
	const before = screen.opened.length;
	const closing = commands.get("workflow:config").handler("", context(screen));
	await eventually(() => screen.opened.length > before);
	const opened = screen.opened.at(-1);
	opened.close = async () => {
		opened.panel.handleInput(keys.escape);
		opened.panel.handleInput(keys.escape);
		await closing;
	};
	t.after(() => (opened.closed ? undefined : opened.close()));
	return opened;
}

const longModel = "openai-codex/gpt-6-astra";

async function openProfiles(t, screen, profiles) {
	const dir = withAgentDirectory(t);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "pi-workflow-models.json"),
		JSON.stringify({
			schemaVersion: 2,
			active: Object.keys(profiles ?? { daily: 0 })[0],
			profiles: profiles ?? {
				daily: { worker: { model: longModel, thinking: "xhigh" } },
			},
		}),
	);
	const before = screen.opened.length;
	void createModelProfiles(dir).edit(context(screen));
	assert.equal(screen.opened.length, before + 1);
	const opened = screen.opened.at(-1);
	opened.close = () => opened.panel.handleInput(keys.escape);
	return opened;
}

function openAdvisorPicker(t, screen) {
	const before = screen.opened.length;
	void createAdvisor(withAgentDirectory(t)).choose(context(screen));
	assert.equal(screen.opened.length, before + 1);
	const opened = screen.opened.at(-1);
	opened.close = () => opened.panel.handleInput(keys.escape);
	return opened;
}

function settingsSelector({
	description = "Compact the context when it fills up",
	value = "on",
	changes = [],
} = {}) {
	const list = new SettingsList(
		Array.from({ length: 6 }, (_, i) => ({
			id: `setting-${i}`,
			label: `Setting ${i}`,
			currentValue: value,
			values: [value, "off"],
			description,
		})),
		10,
		getSettingsListTheme(),
		(id, chosen) => changes.push([id, chosen]),
		() => {},
		{ enableSearch: true },
	);
	const selector = Object.create(SettingsSelectorComponent.prototype);
	selector.children = [{ render: () => ["─"] }, list, { render: () => ["─"] }];
	selector.settingsList = list;
	return { selector, list };
}

const clock = 1_000_000_000_000;

function childRecord(id, overrides = {}) {
	return {
		id: `${id}000000-0000-0000-0000-000000000000`,
		role: "worker",
		task: "Run the focused tests and report what fails.",
		worktree: "/home/u/repos/pi-workflow",
		model: "xai/gpt-6-luna",
		thinking: "high",
		state: "running",
		createdAt: clock - 12_000,
		startedAt: clock - 12_000,
		step: "bash npm test",
		...overrides,
	};
}

function fakeSessions(records) {
	return {
		list: () => records.map((item) => ({ ...item })),
		get: (id) => records.find((item) => item.id === id),
		subscribe: () => () => {},
		follow: () => () => {},
		thread: () => ({ entries: [] }),
		changedFiles: () => [],
		context: () => undefined,
	};
}

const emptyAudit = {
	list: async () => ({ records: [] }),
	read: async () => undefined,
	segment: async () => undefined,
};

function freezeClock(t) {
	t.mock.timers.enable({ apis: ["Date"], now: clock });
}

function openFleet(t, screen) {
	const views = createChildrenViews(
		fakeSessions([childRecord("5636"), childRecord("a809")]),
		emptyAudit,
		{ text: () => undefined },
		() => () => {},
	);
	const before = screen.opened.length;
	void views.open({ ui: { custom: screen.custom } });
	assert.equal(screen.opened.length, before + 1);
	const opened = screen.opened.at(-1);
	opened.close = () => views.close();
	t.after(() => views.close());
	return opened;
}

const boxRecords = Array.from({ length: 11 }, (_, i) =>
	childRecord(`${1000 + i}`),
);

function todoTasks(count) {
	return Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		text: `Task ${i + 1}`,
		state: i === 0 ? "in progress" : "pending",
	}));
}

const todoState = { collapsed: false, showDone: true };

// The width Pi gave the overlay on its last frame, and the overlay at that width.
function shown(opened) {
	const { width } = opened.handle.getBounds();
	return { width, lines: opened.panel.render(width) };
}

test("at 60 and 100 terminal columns the overlays and docked lists open at the base's widths and render the base's bytes", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	for (const columns of [60, 100]) {
		const screen = piScreen(t, columns, { theme });
		const guide = await openGuide(t, screen);
		await screen.frame();
		const surfaces = { guide: shown(guide) };
		await guide.close();
		const profiles = await openProfiles(t, screen);
		await screen.frame();
		surfaces.profiles = shown(profiles);
		profiles.panel.handleInput("\r");
		profiles.panel.handleInput(keys.down);
		surfaces.profile = { lines: shown(profiles).lines };
		profiles.panel.handleInput("\r");
		surfaces.catalog = { lines: shown(profiles).lines };
		surfaces.settings = { lines: settingsSelector().selector.render(columns) };
		surfaces.box = {
			lines: renderChildrenBox(theme, boxRecords, clock, columns),
		};
		surfaces.todo = {
			lines: renderTodoBox(
				theme,
				todoTasks(12),
				todoState,
				columns,
				new Map(),
				40,
				2,
			).lines,
		};
		const advisor = openAdvisorPicker(t, screen);
		await screen.frame();
		surfaces.advisor = shown(advisor);
		assert.deepEqual(surfaces, wideBytes[columns]);
	}
});

test("at 60 and 100 terminal columns the Fleet view opens at the base's width and renders the base's bytes", async (t) => {
	freezeClock(t);
	for (const columns of [60, 100]) {
		const screen = piScreen(t, columns, { rows: 24, theme });
		const fleet = openFleet(t, screen);
		await screen.frame();
		assert.deepEqual(shown(fleet), wideBytes.fleet[columns]);
	}
});

const narrowColumns = [44, 48, 52, 59];

test("below 60 terminal columns the config guide, model profiles, the Advisor picker and the Fleet view open through Pi at the full terminal width with padding 1", async (t) => {
	freezeClock(t);
	for (const columns of narrowColumns) {
		const screen = piScreen(t, columns, { theme });
		const overlay = async (opened) => {
			const lines = await screen.frame();
			const { row, col, width, height } = opened.handle.getBounds();
			assert.deepEqual({ col, width }, { col: 0, width: columns });
			return lines.slice(row, row + height);
		};

		const guide = await openGuide(t, screen);
		let lines = await overlay(guide);
		assert.match(lines[0], /^┌─ Workflow config ─+ \[×\] ─┐$/);
		assert.equal(lines[3], `│ ${"▸ [x] Child session".padEnd(columns - 4)} │`);
		await guide.close();

		const profiles = await openProfiles(t, screen);
		lines = await overlay(profiles);
		assert.match(lines[0], /^┌─ Model profiles ─+ \[×\] ─┐$/);
		assert.equal(lines[3].length, columns);
		assert.match(lines[3], /^│ ▸ daily +● active › {2}│$/);
		profiles.close();
		assert.ok(profiles.closed);

		const advisor = openAdvisorPicker(t, screen);
		lines = await overlay(advisor);
		assert.match(lines[0], /^┌─ Advisor model ─+ \[×\] ─┐$/);
		assert.equal(lines[4].length, columns);
		assert.match(lines[4], /^│ ▸ openai-codex\/gpt-5\.6-luna +› {2}│$/);
		advisor.close();
		assert.ok(advisor.closed);

		const fleet = openFleet(t, screen);
		lines = await overlay(fleet);
		assert.match(lines[0], /^┌─ Fleet 2 · 2 active ─+ \[×\] ─┐$/);
		assert.equal(
			lines[2],
			`│ ${"▸ ◐ worker 5636".padEnd(columns - 17)}running · 12s │`,
		);
		fleet.close();
	}
});

test("below 60 terminal columns settings render at the full terminal width with padding 1", (t) => {
	patchMenus();
	t.after(restoreMenus);
	const terminal = densityTerminal(t, 44);
	for (const columns of narrowColumns) {
		terminal.columns = columns;
		const lines = plain(settingsSelector().selector.render(columns));
		assert.match(lines[0], /^┌─ Settings ─+ \[×\] ─┐$/);
		assert.equal(lines[0].length, columns);
		assert.equal(lines[3], `│ ${"▸ Setting 0".padEnd(columns - 9)}on    │`);
	}
});

test("an open overlay keeps the width and padding it opened with while the terminal crosses 60 columns either way, and lays out again when reopened", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	freezeClock(t);
	const screen = piScreen(t, 44, { theme });
	const overlays = ["guide", "profiles", "advisor", "fleet"];
	const openAll = async () => ({
		guide: await openGuide(t, screen),
		profiles: await openProfiles(t, screen),
		advisor: openAdvisorPicker(t, screen),
		fleet: openFleet(t, screen),
		settings: settingsSelector().selector,
	});
	const layout = async (opened) => {
		await screen.frame();
		return {
			...Object.fromEntries(
				overlays.map((name) => {
					const { width, lines } = shown(opened[name]);
					return [name, { width, lines: plain(lines) }];
				}),
			),
			settings: plain(opened.settings.render(screen.terminal.columns)),
		};
	};
	const widths = (frames) =>
		Object.fromEntries(overlays.map((name) => [name, frames[name].width]));
	const closeAll = async (opened) => {
		await opened.guide.close();
		opened.profiles.close();
		opened.advisor.close();
		opened.fleet.close();
		assert.ok(overlays.every((name) => opened[name].closed));
	};
	const fullWidth = (frames, columns) => {
		assert.deepEqual(widths(frames), {
			guide: columns,
			profiles: columns,
			advisor: columns,
			fleet: columns,
		});
		assert.equal(
			frames.guide.lines[3],
			`│ ${"▸ [x] Child session".padEnd(columns - 4)} │`,
		);
		assert.match(frames.settings[0], /^┌─ Settings/);
		assert.equal(frames.settings[0].length, columns);
	};

	const narrow = await openAll();
	const opening = await layout(narrow);
	fullWidth(opening, 44);
	screen.terminal.columns = 64;
	const grown = await layout(narrow);
	assert.deepEqual(grown, opening);
	assert.equal(narrow.settings.handleMouse(click(42, 3, 64)), undefined);
	assert.equal(narrow.settings.handleMouse(click(41, 3, 64))?.handled, true);
	assert.match(plain(narrow.settings.render(64))[3], /^│ ▸ Setting 0 +off +│$/);
	await closeAll(narrow);

	screen.terminal.columns = 80;
	const wide = await openAll();
	const wideOpening = await layout(wide);
	assert.deepEqual(widths(wideOpening), {
		guide: 56,
		profiles: 56,
		advisor: 56,
		fleet: 80,
	});
	assert.equal(
		wideOpening.guide.lines[3],
		`│  ${"▸ [x] Child session".padEnd(50)}  │`,
	);
	assert.match(wideOpening.fleet.lines[0], /^ ┌─ Fleet/);
	assert.match(wideOpening.settings[0], /^ ┌─ Settings/);
	screen.terminal.columns = 59;
	const shrunk = await layout(wide);
	assert.deepEqual(widths(shrunk), { ...widths(wideOpening), fleet: 59 });
	for (const name of ["guide", "profiles", "advisor"])
		assert.deepEqual(shrunk[name], wideOpening[name]);
	assert.match(shrunk.fleet.lines[0], /^ ┌─ Fleet/);
	assert.match(shrunk.settings[0], /^ ┌─ Settings/);
	screen.terminal.columns = 90;
	const regrown = await layout(wide);
	assert.deepEqual(regrown, wideOpening);
	await closeAll(wide);

	screen.terminal.columns = 59;
	fullWidth(await layout(await openAll()), 59);
});

const overlongModel = "openai-codex/gpt-6-astra-preview-2026-11-extended";

test("model profiles end a model id cut by the row with …, and show a model id that fits whole, below 60 terminal columns", async (t) => {
	const cut = {
		44: "│ ▸ worker openai-codex/gpt-6-astra-pr… ›  │",
		48: "│ ▸ worker openai-codex/gpt-6-astra-previe… ›  │",
		52: "│ ▸ worker openai-codex/gpt-6-astra-preview-20… ›  │",
		59: "│ ▸ worker openai-codex/gpt-6-astra-preview-2026-11-e… ›  │",
	};
	for (const columns of narrowColumns) {
		const screen = piScreen(t, columns, { theme });
		const profiles = await openProfiles(t, screen, {
			daily: { worker: { model: overlongModel, thinking: "xhigh" } },
		});
		profiles.panel.handleInput("\r");
		assert.equal(plain(profiles.panel.render(columns))[4], cut[columns]);
	}
	const screen = piScreen(t, 59, { theme });
	const profiles = await openProfiles(t, screen, {
		daily: { worker: { model: "nan/mimo-v2.5", thinking: "high" } },
	});
	profiles.panel.handleInput("\r");
	assert.equal(
		plain(profiles.panel.render(59))[4],
		`│ ▸ worker${" ".repeat(14)}nan/mimo-v2.5 · thinking: high ›  │`,
	);
});

const longDescription =
	"Compact the context when it fills up so the session can keep working without losing the thread of the conversation so far.";

const settingsHints = [
	"│   Type search  |  Enter/Space change     │",
	"│   Esc cancel                             │",
];

function scrollsAroundSelection(t) {
	const terminal = densityTerminal(t, 44);
	terminal.rows = 12;
	const { selector, list } = settingsSelector({
		description: longDescription,
	});
	const frame = () => plain(selector.render(44));
	let lines = frame();
	assert.equal(lines.length, 12);
	assert.deepEqual(lines.slice(-3, -1), settingsHints);
	assert.equal(lines.at(-1), `└${"─".repeat(42)}┘`);
	assert.ok(lines.some((line) => line.startsWith("│ ▸ Setting 0 ")));

	for (let i = 0; i < 5; i++) list.handleInput("\x1b[B");
	lines = frame();
	assert.equal(lines.length, 12);
	assert.deepEqual(lines.slice(-3, -1), settingsHints);
	const row = lines.findIndex((line) => line.startsWith("│ ▸ Setting 5 "));
	assert.ok(row > 0, lines.join("\n"));
	assert.ok(!lines.some((line) => line.startsWith("│ ▸ Setting 0 ")));
	return { selector, frame, row, lines };
}

test("settings taller than a narrow screen scroll around the selected row with their hints in view, and a click reaches the row it lands on", (t) => {
	patchMenus();
	t.after(restoreMenus);
	const { selector, frame, row, lines } = scrollsAroundSelection(t);
	assert.equal(selector.handleMouse(click(1, row, 44, 12)), undefined);
	assert.equal(
		selector.handleMouse(click(2, lines.length - 3, 44, 12)),
		undefined,
	);
	assert.match(frame()[row], /^│ ▸ Setting 5 +on +│$/);
	assert.equal(selector.handleMouse(click(2, row, 44, 12))?.handled, true);
	assert.match(frame()[row], /^│ ▸ Setting 5 +off +│$/);
});

test("tall narrow settings scroll around the selected row under a theme without a selection background", (t) => {
	patchMenus();
	t.after(restoreMenus);
	const styled = globalThis[THEME];
	globalThis[THEME] = new Proxy(styled, {
		get: (target, key) =>
			key === "fg" || key === "bg"
				? (_color, text) => text
				: key === "bold"
					? (text) => text
					: Reflect.get(target, key),
	});
	t.after(() => {
		globalThis[THEME] = styled;
	});
	scrollsAroundSelection(t);
});

test("a click below the scrolled rows of narrow settings changes no hidden setting", (t) => {
	patchMenus();
	t.after(restoreMenus);
	const terminal = densityTerminal(t, 44);
	terminal.rows = 7;
	const changes = [];
	const { selector } = settingsSelector({ changes });
	const lines = plain(selector.render(44));
	assert.equal(lines.length, 7);
	assert.equal(lines.at(-1), `└${"─".repeat(42)}┘`);
	assert.equal(selector.handleMouse(click(2, 6, 44, 7)), undefined);
	assert.deepEqual(changes, []);
});

// Pi's fullscreen chat layout on a narrow screen: a fixed header, the
// transcript, the dock with `widgets` above the editor slot holding `selector`,
// and a footer.
function narrowDock(t, screen, selector, widgets = new Container()) {
	const editor = new Container();
	editor.addChild(selector);
	const document = new Container();
	document.addChild({ render: () => ["transcript"], invalidate() {} });
	const chat = createChatViewport({
		document,
		pendingMessages: new Container(),
		status: new Container(),
		widgetsAbove: widgets,
		editor,
		widgetsBelow: new Container(),
		footer: { render: () => ["FOOTER"], invalidate() {} },
		scrollbar: "never",
	});
	screen.tui.setLayoutRoot(chat.root);
	const header = fixHeader(screen.tui, {
		render: () => ["HEADER"],
		invalidate() {},
	});
	t.after(() => header.stop());
	assert.ok(header.active());
}

const themes = [
	"dark",
	"light",
	"catppuccin",
	"dracula",
	"gruvbox",
	"monokai",
	"nord",
	"one-dark",
	"solarized",
	"tokyo-night",
	"everforest",
	"rose-pine",
];

// Pi's own Settings, with its Theme submenu offering `themes`.
function piSettings(previews) {
	const callbacks = new Proxy(
		{},
		{
			get: (_, name) =>
				name === "onThemePreview" ? (value) => previews.push(value) : () => {},
		},
	);
	return new SettingsSelectorComponent(
		{
			autoCompact: true,
			steeringMode: "all",
			followUpMode: "all",
			transport: "sse",
			thinkingLevel: "off",
			currentTheme: "dark",
			terminalTheme: "dark",
			availableThemes: themes,
			warnings: {},
			modelThinkingLevels: {},
			availableDefaultModels: [],
			fullscreenWheelScrollLines: "auto",
		},
		callbacks,
	);
}

test("in a narrow fullscreen dock with a fixed header and a footer, tall settings keep their hints and bottom border in view", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	const screen = piScreen(t, 44, { rows: 12, theme });
	const { selector, list } = settingsSelector({
		description: longDescription,
	});
	narrowDock(t, screen, selector);

	for (const selected of [0, 5]) {
		for (let i = 0; i < selected; i++) list.handleInput("\x1b[B");
		const lines = await screen.frame();
		assert.equal(lines.length, 12);
		assert.equal(lines[0], "HEADER");
		assert.match(lines[2], /^┌─ Settings ─+ \[×\] ─┐$/);
		assert.deepEqual(lines.slice(8, 12), [
			...settingsHints,
			`└${"─".repeat(42)}┘`,
			"FOOTER",
		]);
		assert.ok(
			lines.some((line) => line.startsWith(`│ ▸ Setting ${selected} `)),
			lines.join("\n"),
		);
	}
});

test("in a narrow fullscreen dock, the Settings Theme submenu keeps the theme chosen with the keyboard and its hint in view", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	const screen = piScreen(t, 44, { rows: 12, theme });
	const previews = [];
	const selector = piSettings(previews);
	narrowDock(t, screen, selector);
	const list = selector.getSettingsList();
	for (const character of "theme") list.handleInput(character);
	list.handleInput("\r");
	for (let i = 0; i < 6; i++) list.handleInput("\x1b[B");
	assert.equal(previews.at(-1), "nord");

	const lines = await screen.frame();
	assert.equal(lines.length, 12);
	assert.match(lines[2], /^┌─ Settings › Theme ─+ \[×\] ─┐$/);
	assert.deepEqual(lines.slice(9, 12), [
		`│ ${"  Enter select  |  Esc go back".padEnd(40)} │`,
		`└${"─".repeat(42)}┘`,
		"FOOTER",
	]);
	const row = lines.findIndex((line) => line.startsWith("│  ○ nord "));
	assert.ok(row > 2 && row < 9, lines.join("\n"));
	const painted = screen.tui.getScreenLines()[row];
	assert.ok(
		painted.includes(theme.bg("selectedBg", "\0").split("\0")[0]),
		JSON.stringify(painted),
	);
});

const running = (count) =>
	Array.from({ length: count }, (_, i) => childRecord(`${2000 + i}`));

function widgets(children, tasks) {
	const above = new Container();
	above.addChild({
		render: (width) => [
			...renderChildrenBox(theme, running(children), clock, width),
			...renderTodoBox(
				theme,
				todoTasks(tasks),
				todoState,
				width,
				new Map(),
				12,
				1,
			).lines,
		],
		invalidate() {},
	});
	return above;
}

test("in a narrow fullscreen dock crowded by running children and a Todo, tall settings keep their frame, selected row and hints in view while Pi shrinks the widgets", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	freezeClock(t);
	for (const children of [3, 4]) {
		const screen = piScreen(t, 44, { rows: 12, theme });
		const { selector, list } = settingsSelector({
			description: longDescription,
		});
		narrowDock(t, screen, selector, widgets(children, 1));
		for (const selected of [0, 5]) {
			for (let i = 0; i < selected; i++) list.handleInput("\x1b[B");
			const lines = await screen.frame();
			const top = lines.findIndex((line) => /^┌─ Settings /.test(line));
			assert.ok(top > 0, lines.join("\n"));
			const bottom = lines.indexOf(`└${"─".repeat(42)}┘`, top);
			assert.ok(bottom > top, lines.join("\n"));
			assert.deepEqual(lines.slice(bottom - 2, bottom), settingsHints);
			assert.ok(
				lines
					.slice(top + 1, bottom - 2)
					.some((line) => line.startsWith(`│ ▸ Setting ${selected} `)),
				lines.join("\n"),
			);
		}
	}
});

test("narrow settings end a value cut by the row with …", (t) => {
	patchMenus();
	t.after(restoreMenus);
	densityTerminal(t, 44);
	const value = `provider/${"m".repeat(40)}`;
	const lines = plain(settingsSelector({ value }).selector.render(44));
	assert.equal(lines[3], `│ ▸ Setting… provider/${"m".repeat(16)}…    │`);
});

test("a click on a narrow config guide row reaches that row, and a click on its padding does not", async (t) => {
	const screen = piScreen(t, 44, { theme });
	const guide = await openGuide(t, screen);
	const row = () => plain(guide.panel.render(44))[4];
	assert.equal(row(), `│ ${"  [x] Todo".padEnd(40)} │`);
	assert.equal(guide.panel.handleMouse(click(1, 4)), undefined);
	assert.equal(guide.panel.handleMouse(click(42, 4)), undefined);
	assert.equal(row(), `│ ${"  [x] Todo".padEnd(40)} │`);
	assert.deepEqual(guide.panel.handleMouse(click(2, 4)), { handled: true });
	assert.equal(row(), `│ ${"▸ [ ] Todo".padEnd(38)} • │`);
});

test("a click on a narrow Fleet row reaches that row, and a click on its padding does not", (t) => {
	freezeClock(t);
	const screen = piScreen(t, 44, { rows: 24, theme });
	const fleet = openFleet(t, screen);
	const row = () => plain(fleet.panel.render(44))[4];
	const unselected = `│   ◐ worker a809${" ".repeat(12)}running · 12s │`;
	assert.equal(row(), unselected);
	assert.equal(fleet.panel.handleMouse(click(1, 4, 44, 24)), undefined);
	assert.equal(row(), unselected);
	assert.deepEqual(fleet.panel.handleMouse(click(2, 4, 44, 24)), {
		handled: true,
	});
	assert.equal(row(), `│ ▸ ◐ worker a809${" ".repeat(12)}running · 12s │`);
});

test("the subagents box ends its 8-row cap with … N more · Alt+A below 60 terminal columns, across 59/60 crossings both ways", (t) => {
	const terminal = densityTerminal(t, 59);
	const tail = (columns) =>
		stripVTControlCharacters(
			renderChildrenBox(theme, boxRecords, clock, columns).at(-1),
		);
	assert.equal(tail(59), " … 3 more · Alt+A");
	terminal.columns = 60;
	assert.equal(tail(60), " … 3 more · alt+a view");
	terminal.columns = 59;
	assert.equal(tail(59), " … 3 more · Alt+A");
	terminal.columns = 44;
	assert.equal(tail(43), " … 3 more · Alt+A");
});

test("below 60 terminal columns empty docked lists render nothing and the Todo keeps its pagination (preserved)", (t) => {
	densityTerminal(t, 44);
	assert.deepEqual(renderChildrenBox(theme, [], clock, 44), []);
	assert.deepEqual(
		renderTodoBox(theme, [], todoState, 44, new Map(), 40, 1).lines,
		[],
	);
	const paged = renderTodoBox(
		theme,
		todoTasks(12),
		todoState,
		44,
		new Map(),
		40,
		2,
	);
	assert.equal(paged.pageCount, 2);
	assert.deepEqual(plain(paged.lines).slice(2, 7), [
		`│ □ Task 9${" ".repeat(33)}│`,
		`│ □ Task 10${" ".repeat(32)}│`,
		`│ □ Task 11${" ".repeat(32)}│`,
		`│ □ Task 12${" ".repeat(32)}│`,
		"12/12 All 2/2 ‹ › Without done",
	]);
});

test("below 60 terminal columns settings descriptions hard-wrap an unbreakable token", (t) => {
	patchMenus();
	t.after(restoreMenus);
	densityTerminal(t, 44);
	const token = "x".repeat(60);
	const lines = plain(
		settingsSelector({ description: token }).selector.render(44),
	);
	const wrapped = lines
		.map((line) => /^│ {3}(x+) +│$/.exec(line)?.[1])
		.filter(Boolean);
	assert.deepEqual(wrapped, ["x".repeat(36), "x".repeat(24)]);
});

const longProfile = "release-candidate-profile-for-the-narrow-screen-checks";

test("below 60 terminal columns a profile heading cut by the frame ends with …", async (t) => {
	const screen = piScreen(t, 44, { theme });
	const profiles = await openProfiles(t, screen, { [longProfile]: {} });
	profiles.panel.handleInput("\r");
	assert.equal(
		plain(profiles.panel.render(44))[0],
		"┌─ Profile release-candidate-profil…  [×] ─┐",
	);
});

test("below 60 terminal columns the profile name rule wraps instead of being cut", async (t) => {
	const screen = piScreen(t, 44, { theme });
	const profiles = await openProfiles(t, screen);
	profiles.panel.handleInput("c");
	for (const character of "Bad") profiles.panel.handleInput(character);
	profiles.panel.handleInput("\r");
	const lines = plain(profiles.panel.render(44));
	assert.deepEqual(lines.slice(2, 4), [
		`│ ${"Use 1 to 64 lowercase letters, digits,".padEnd(40)} │`,
		`│ ${"or hyphens for the name.".padEnd(40)} │`,
	]);
});
