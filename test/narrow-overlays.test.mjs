import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
	initTheme,
	SettingsSelectorComponent,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	SettingsList,
	TUI_KEYBINDINGS,
	TuiMainScreen,
} from "@earendil-works/pi-tui";

import { createAdvisor } from "../extensions/advisor.ts";
import { renderChildrenBox } from "../extensions/children-box.ts";
import { createChildrenViews } from "../extensions/children-view.ts";
import { patchMenus, restoreMenus } from "../extensions/chrome-menus.ts";
import { capabilities } from "../extensions/configure.ts";
import { createModelProfiles } from "../extensions/model-profiles.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { renderTodoBox } from "../extensions/todo-header.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { catalogOf, driveConfig, keys } from "./support/config-guide.mjs";
import { densityTerminal } from "./support/density-terminal.mjs";
import { catalog } from "./support/model-picker.mjs";

initTheme("dark", false);
const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
const plain = (lines) => lines.map((line) => stripVTControlCharacters(line));
const keybindings = () => new KeybindingsManager(TUI_KEYBINDINGS);

const allSeated = {
	schemaVersion: 1,
	capabilities: Object.fromEntries(
		capabilities.map((capability) => [capability, true]),
	),
	expectations: {},
};
replaceSelection(allSeated);

const wideBytes = JSON.parse(
	readFileSync(
		new URL("./fixtures/wide-overlays.json", import.meta.url),
		"utf8",
	),
);

// Pi's own overlay layout turns the options into the width a component renders at.
function overlayWidth(options, columns, rows = 40) {
	return TuiMainScreen.prototype.resolveOverlayLayout.call(
		TuiMainScreen.prototype,
		options,
		rows,
		columns,
		rows,
	).width;
}

async function openGuide(t, rows = 40) {
	const dir = withAgentDirectory(t);
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
		{ agentDirectory: dir, catalog: catalogOf() },
	);
	let shown;
	const showing = new Promise((resolve) => {
		shown = resolve;
	});
	const closing = driveConfig(
		commands.get("workflow:config"),
		(panel, session) => shown({ panel, options: session.options }),
		{ rows, theme },
	);
	const opened = await showing;
	t.after(async () => {
		opened.panel.handleInput(keys.escape);
		await closing;
	});
	return opened;
}

function uiContext(rows = 40) {
	const opened = [];
	return {
		opened,
		ctx: {
			hasUI: true,
			mode: "tui",
			ui: {
				notify() {},
				confirm: async () => true,
				custom: (factory, options) =>
					new Promise((resolve) => {
						opened.push({
							options,
							panel: factory(
								{ requestRender() {}, terminal: { rows } },
								theme,
								keybindings(),
								resolve,
							),
						});
					}),
			},
			modelRegistry: {
				getAll: () => catalog,
				getAvailable: () => catalog,
			},
		},
	};
}

const longModel = "openai-codex/gpt-6-astra";

async function openProfiles(t, rows = 40) {
	const dir = withAgentDirectory(t);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "pi-workflow-models.json"),
		JSON.stringify({
			schemaVersion: 2,
			active: "daily",
			profiles: {
				daily: { worker: { model: longModel, thinking: "xhigh" } },
			},
		}),
	);
	const { ctx, opened } = uiContext(rows);
	void createModelProfiles(dir).edit(ctx);
	for (let i = 0; i < 100 && opened.length === 0; i++)
		await new Promise((resolve) => setImmediate(resolve));
	return opened[0];
}

async function openAdvisorPicker(t, rows = 40) {
	const { ctx, opened } = uiContext(rows);
	void createAdvisor(withAgentDirectory(t)).choose(ctx);
	return opened[0];
}

function settingsSelector(
	description = "Compact the context when it fills up",
) {
	const list = new SettingsList(
		Array.from({ length: 6 }, (_, i) => ({
			id: `setting-${i}`,
			label: `Setting ${i}`,
			currentValue: "on",
			values: ["on", "off"],
			description,
		})),
		10,
		getSettingsListTheme(),
		() => {},
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

function openFleet(t, rows = 24) {
	let opened;
	const views = createChildrenViews(
		fakeSessions([childRecord("5636"), childRecord("a809")]),
		emptyAudit,
		{ text: () => undefined },
		() => () => {},
	);
	void views.open({
		ui: {
			custom(factory, options) {
				opened = {
					options,
					panel: factory(
						{ requestRender() {}, terminal: { rows } },
						theme,
						keybindings(),
						() => {},
					),
				};
				return new Promise(() => {});
			},
		},
	});
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

async function wideSurfaces(t, columns) {
	const surfaces = {};
	const guide = await openGuide(t);
	surfaces.guide = {
		options: guide.options,
		lines: guide.panel.render(
			overlayWidth(guide.options.overlayOptions, columns),
		),
	};
	const profiles = await openProfiles(t);
	const profilesWidth = overlayWidth(profiles.options.overlayOptions, columns);
	surfaces.profiles = {
		options: profiles.options,
		lines: profiles.panel.render(profilesWidth),
	};
	profiles.panel.handleInput("\r");
	profiles.panel.handleInput(keys.down);
	surfaces.profile = { lines: profiles.panel.render(profilesWidth) };
	profiles.panel.handleInput("\r");
	surfaces.catalog = { lines: profiles.panel.render(profilesWidth) };
	const { selector } = settingsSelector();
	surfaces.settings = { lines: selector.render(columns) };
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
	return surfaces;
}

test("at 60 and 100 terminal columns the overlays and docked lists render the base's bytes", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	const terminal = densityTerminal(t, 60);
	for (const columns of [60, 100]) {
		terminal.columns = columns;
		assert.deepEqual(
			JSON.parse(JSON.stringify(await wideSurfaces(t, columns))),
			wideBytes[columns],
		);
	}
});

test("at 60 and 100 terminal columns the Fleet view renders the base's bytes", (t) => {
	const terminal = densityTerminal(t, 60);
	freezeClock(t);
	const fleet = openFleet(t);
	for (const columns of [60, 100]) {
		terminal.columns = columns;
		assert.deepEqual(
			JSON.parse(
				JSON.stringify({
					options: fleet.options,
					lines: fleet.panel.render(columns),
				}),
			),
			wideBytes.fleet[columns],
		);
	}
});

const narrowColumns = [44, 48, 52, 59];
const plainOf = (panel, width) => plain(panel.render(width));

test("below 60 terminal columns the config guide opens at the full terminal width with padding 1", async (t) => {
	const terminal = densityTerminal(t, 44);
	for (const columns of narrowColumns) {
		terminal.columns = columns;
		const guide = await openGuide(t);
		assert.equal(guide.options.overlayOptions.width, "100%");
		assert.equal(overlayWidth(guide.options.overlayOptions, columns), columns);
		const lines = plainOf(guide.panel, columns);
		assert.equal(lines[3], `│ ${"▸ [x] Child session".padEnd(columns - 4)} │`);
		assert.match(lines[0], /^┌─ Workflow config ─+ \[×\] ─┐$/);
		assert.equal(lines[0].length, columns);
	}
});

test("below 60 terminal columns model profiles and the model picker open at the full terminal width with padding 1", async (t) => {
	const terminal = densityTerminal(t, 44);
	for (const columns of narrowColumns) {
		terminal.columns = columns;
		for (const opened of [await openProfiles(t), await openAdvisorPicker(t)]) {
			assert.equal(opened.options.overlayOptions.width, "100%");
			assert.equal(
				overlayWidth(opened.options.overlayOptions, columns),
				columns,
			);
			const row = plainOf(opened.panel, columns).find((line) =>
				line.includes("▸"),
			);
			assert.equal(row.length, columns);
			assert.match(row, /^│ ▸ \S.* │$/);
		}
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

test("below 60 terminal columns the Fleet view renders at the full terminal width with padding 1", (t) => {
	freezeClock(t);
	const terminal = densityTerminal(t, 44);
	for (const columns of narrowColumns) {
		terminal.columns = columns;
		const lines = plainOf(openFleet(t).panel, columns);
		assert.match(lines[0], /^┌─ Fleet 2 · 2 active ─+ \[×\] ─┐$/);
		assert.equal(lines[0].length, columns);
		assert.equal(
			lines[2],
			`│ ${"▸ ◐ worker 5636".padEnd(columns - 17)}running · 12s │`,
		);
	}
});
