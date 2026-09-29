import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	ExtensionInputComponent,
	ExtensionSelectorComponent,
	getSelectListTheme,
	getSettingsListTheme,
	initTheme,
	ModelSelectorComponent,
	OAuthSelectorComponent,
	SettingsSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	SelectList,
	SettingsList,
	Spacer,
	Text,
	visibleWidth,
} from "@earendil-works/pi-tui";

import {
	displayKey,
	hintRows,
	menuRow,
	modalFrame,
	NATIVE,
	patchMenus,
	restoreMenus,
	sectionRule,
} from "../extensions/chrome-menus.ts";
import { createChromeEditor } from "../extensions/chrome-editor.ts";

initTheme("dark", false);
const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
const plain = (lines) => lines.map((line) => stripVTControlCharacters(line));
const selectedBg = theme.bg("selectedBg", "\u0000").split("\u0000")[0];
const pristine = {
	render: SelectList.prototype.render,
	settingsRender: SettingsList.prototype.render,
	renderItem: SelectList.prototype.renderItem,
	renderMainList: SettingsList.prototype.renderMainList,
};

function patched(t) {
	patchMenus();
	t.after(restoreMenus);
}

function selectList(themeOverride = getSelectListTheme()) {
	return new SelectList(
		[
			{ value: "alpha", label: "alpha", description: "The first choice" },
			{ value: "beta", label: "beta", description: "The second choice" },
			{ value: "gamma", label: "gamma" },
		],
		2,
		themeOverride,
	);
}

function settingsList() {
	return new SettingsList(
		[
			{
				id: "compact",
				label: "Auto-compact",
				currentValue: "true",
				values: ["true", "false"],
				description: "Compact context",
			},
			{
				id: "images",
				label: "Block images",
				currentValue: "off",
				values: ["on", "off"],
			},
			{
				id: "theme",
				label: "Theme",
				currentValue: "dark",
				submenu: () => ({ render: () => [], invalidate() {} }),
			},
		],
		2,
		getSettingsListTheme(),
		() => {},
		() => {},
		{ enableSearch: true },
	);
}

test("a patched SelectList marks rows with ○, highlights the selected row full width, and dims descriptions and the scroll info", (t) => {
	patched(t);
	const list = selectList();
	const lines = list.render(60);
	const shown = plain(lines);
	assert.match(shown[0], /^ ○ alpha\s+The first choice\s*$/);
	assert.match(shown[1], /^ ○ beta\s+The second choice$/);
	assert.equal(shown[2], "  (1/3)");
	assert.ok(lines[0].startsWith(selectedBg));
	assert.equal(visibleWidth(lines[0]), 60);
	assert.ok(!lines[1].includes(selectedBg));
	assert.ok(lines[1].includes(theme.fg("dim", "The second choice")));
	assert.equal(lines[2], theme.fg("dim", "  (1/3)"));
	assert.ok(!shown.join("\n").includes("→"));
	assert.ok(!shown.join("\n").includes("▸"));
	list.handleInput("\x1b[B");
	assert.ok(list.render(60)[1].startsWith(selectedBg));
	assert.equal(list.getSelectedItem().value, "beta");
});

test("picker rows turn pi's baked ✓ prefix into ● and strip the blank prefix", (t) => {
	patched(t);
	const list = new SelectList(
		[
			{ value: "dark", label: "✓ dark" },
			{ value: "light", label: "  light", description: "Bright" },
		],
		5,
		getSelectListTheme(),
		{ minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 32 },
	);
	const lines = list.render(60);
	assert.match(plain(lines)[0], /^ ● dark\s*$/);
	assert.match(plain(lines)[1], /^ ○ light {7}Bright$/);
	assert.ok(lines[0].startsWith(selectedBg));
	assert.ok(lines[0].includes(`${theme.fg("text", " ● ")}${strong("dark")}`));
	assert.ok(lines[1].includes(theme.fg("dim", " ○ ")));
	assert.ok(lines[1].includes(theme.fg("text", "light")));
});

test("a patched SettingsList right-aligns values, dims off/false, adds a dim › for submenus, and restyles the hint", (t) => {
	patched(t);
	const list = settingsList();
	const lines = list.render(50);
	const shown = plain(lines);
	assert.deepEqual(shown.slice(2, 5), [
		`▸ Auto-compact${" ".repeat(29)}true   `,
		`▸ Block images${" ".repeat(30)}off   `,
		"  (1/3)",
	]);
	assert.ok(lines[2].startsWith(selectedBg));
	assert.equal(visibleWidth(lines[2]), 50);
	assert.ok(lines[3].includes(theme.fg("dim", "off")));
	const hint = list.render(70).at(-1);
	assert.match(
		stripVTControlCharacters(hint),
		/^ {2}Type search {2}\| {2}Enter\/Space change {2}\| {2}Esc cancel$/,
	);
	assert.ok(hint.includes(theme.bold(theme.fg("text", "Esc"))));
	assert.ok(hint.includes(theme.fg("dim", "  |  ")));
	assert.deepEqual(shown.slice(-2), [
		"  Type search  |  Enter/Space change",
		"  Esc cancel",
	]);
	assert.match(shown.join("\n"), /Compact context/);
	list.handleInput("\x1b[B");
	list.handleInput("\x1b[B");
	assert.match(plain(list.render(50))[3], /^▸ Theme\s+dark ›\s$/);
});

test("a patched SettingsList shows single-value action rows with a › and no value", (t) => {
	patched(t);
	const list = new SettingsList(
		[
			{
				id: "apply",
				label: "Apply",
				currentValue: "save and go back",
				values: ["save and go back"],
			},
		],
		5,
		getSettingsListTheme(),
		() => {},
		() => {},
	);
	assert.match(plain(list.render(30))[0], /^▸ Apply {21}› $/);
});

test("a patched SettingsList search input shows a dim ❯ prompt and a Type to search placeholder", (t) => {
	patched(t);
	const list = settingsList();
	const [line] = list.render(50);
	assert.match(stripVTControlCharacters(line), /^❯ Type to search\s*$/);
	assert.ok(line.startsWith(theme.fg("dim", "❯ ")));
	assert.equal(visibleWidth(line), 50);
	list.handleInput("x");
	assert.match(plain(list.render(50))[0], /^❯ x\s*$/);
	restoreMenus();
	assert.match(plain(list.render(50))[0], /^> x\s*$/);
});

function selectSubmenu(title, description, options, current, done, search) {
	const menu = new Container();
	menu.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
	menu.addChild(new Spacer(1));
	menu.addChild(new Text(theme.fg("muted", description), 0, 0));
	if (search) {
		menu.addChild(new Spacer(1));
		menu.addChild(new Input());
	}
	menu.addChild(new Spacer(1));
	const list = new SelectList(
		options,
		Math.min(options.length, 10),
		getSelectListTheme(),
		{ minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 32 },
	);
	list.setSelectedIndex(
		Math.max(
			0,
			options.findIndex((option) => option.value === current),
		),
	);
	list.onCancel = () => done();
	menu.addChild(list);
	menu.addChild(new Spacer(1));
	const hint = search
		? "  Type to filter · Enter to select · Esc to go back"
		: "  Enter to select · Esc to go back";
	menu.addChild(new Text(theme.fg("dim", hint), 0, 0));
	menu.handleInput = (data) => list.handleInput(data);
	return menu;
}

class SteppedSubmenu extends Container {
	constructor(step) {
		super();
		this.activeComponent = step;
	}
	render(width) {
		return this.activeComponent.render(width);
	}
	handleInput(data) {
		this.activeComponent.handleInput(data);
	}
}

const themeOptions = [
	{
		value: "/",
		label: "  automatic",
		description: "Use separate themes for light and dark",
	},
	{ value: "dark", label: "✓ dark" },
	{ value: "light", label: "  light" },
];

function automaticTheme(done) {
	const content = new Container();
	content.addChild(
		new Text(theme.bold(theme.fg("accent", "Automatic Theme")), 0, 0),
	);
	content.addChild(new Spacer(1));
	content.addChild(
		new Text(theme.fg("muted", "Choose themes for light and dark."), 0, 0),
	);
	content.addChild(new Spacer(1));
	const list = new SettingsList(
		[
			{
				id: "light-theme",
				label: "Light theme",
				description:
					"Theme to use in automatic mode when the terminal is light",
				currentValue: "dark",
				submenu: (value, close) =>
					selectSubmenu(
						"Light Theme",
						"Select the light theme",
						themeOptions.slice(1),
						value,
						close,
					),
			},
			{
				id: "apply",
				label: "Apply",
				currentValue: "save and go back",
				values: ["save and go back"],
			},
		],
		2,
		getSettingsListTheme(),
		() => {},
		() => done(),
	);
	content.addChild(list);
	content.handleInput = (data) => list.handleInput(data);
	return content;
}

function settingsSubmenus() {
	return new SettingsList(
		[
			{
				id: "theme",
				label: "Theme",
				currentValue: "dark",
				submenu: (value, done) =>
					selectSubmenu("Theme", "Select a theme", themeOptions, value, done),
			},
			{
				id: "model-thinking",
				label: "Default thinking level per model",
				currentValue: "1 configured",
				submenu: (_value, done) =>
					new SteppedSubmenu(
						selectSubmenu(
							"Per-Model Thinking Level",
							"Step 1/2 · Select a model to configure",
							[
								{ value: "a", label: "gpt-5", description: "high" },
								{ value: "b", label: "claude" },
							],
							"a",
							done,
							true,
						),
					),
			},
			{
				id: "auto-theme",
				label: "Automatic theme",
				currentValue: "configure",
				submenu: (_value, done) => automaticTheme(done),
			},
		],
		10,
		getSettingsListTheme(),
		() => {},
		() => {},
		{ enableSearch: true },
	);
}

function openSubmenu(id, nested = false) {
	const list = settingsSubmenus();
	list.selectItem(id);
	list.activateItem();
	if (nested) list.handleInput("\r");
	return list;
}

test("settings select submenus hide pi's title, dim the description, and render radio rows with Grok hints", (t) => {
	patched(t);
	const lines = openSubmenu("theme").render(70);
	assert.ok(lines[0].startsWith(theme.fg("dim", "Select a theme")));
	assert.equal(lines[1], "");
	assert.ok(!plain(lines).join("\n").includes("Theme"));
	assert.ok(!lines.join("").includes(accent));
	assert.match(plain([lines[2]])[0], /^ ○ automatic\s+Use separate themes/);
	assert.ok(lines[2].includes(theme.fg("dim", " ○ ")));
	assert.ok(lines[3].startsWith(selectedBg));
	assert.ok(lines[3].includes(`${theme.fg("text", " ● ")}${strong("dark")}`));
	assert.equal(visibleWidth(lines[3]), 70);
	assert.equal(plain([lines.at(-1)])[0], "  Enter select  |  Esc go back");
	assert.ok(
		lines.at(-1).includes(`${strong("Esc")} ${theme.fg("dim", "go back")}`),
	);
});

test("stepped submenus restyle the active step and its search input", (t) => {
	patched(t);
	const list = openSubmenu("model-thinking");
	const lines = list.render(70);
	assert.equal(
		plain(lines)[0].trimEnd(),
		"Step 1/2 · Select a model to configure",
	);
	assert.ok(!lines.join("").includes(accent));
	assert.match(plain([lines[2]])[0], /^❯ Type to search\s*$/);
	assert.ok(lines[4].startsWith(selectedBg));
	assert.ok(lines[5].includes(theme.fg("dim", " ○ ")));
	assert.equal(
		plain([lines.at(-1)])[0],
		"  Type filter  |  Enter select  |  Esc go back",
	);
	restoreMenus();
	const native = plain(list.render(70));
	assert.match(native[4], /^> \s*$/);
	assert.equal(
		native.at(-1).trim(),
		"Type to filter · Enter to select · Esc to go back",
	);
});

test("nested settings submenus keep descriptions and show only the innermost pane", (t) => {
	patched(t);
	const outer = openSubmenu("auto-theme").render(70);
	assert.ok(
		outer[0].startsWith(theme.fg("dim", "Choose themes for light and dark.")),
	);
	assert.ok(
		plain(outer).includes(
			"  Theme to use in automatic mode when the terminal is light",
		),
	);
	assert.match(plain(outer)[3], /^▸ Apply\s+›\s$/);
	assert.equal(plain(outer).at(-1), "  Enter/Space change  |  Esc cancel");
	const inner = plain(openSubmenu("auto-theme", true).render(70));
	assert.deepEqual(
		inner.slice(0, 4).map((line) => line.trimEnd()),
		["Select the light theme", "", " ● dark", " ○ light"],
	);
	assert.equal(inner.at(-1), "  Enter select  |  Esc go back");
});

test("settings submenus never exceed the width from 10 to 160 columns", (t) => {
	patched(t);
	const lists = [
		openSubmenu("theme"),
		openSubmenu("model-thinking"),
		openSubmenu("auto-theme", true),
		openSubmenu("auto-theme"),
	];
	for (let width = 10; width <= 160; width++) {
		for (const list of lists) {
			const lines = list.render(width);
			for (const line of lines)
				assert.ok(
					visibleWidth(line) <= width,
					`${width}: ${JSON.stringify(line)}`,
				);
		}
	}
});

test("closing a restyled submenu returns to the main list", (t) => {
	patched(t);
	const list = openSubmenu("theme");
	list.handleInput("\x1b");
	assert.match(plain(list.render(70))[2], /^▸ Theme\s+dark ›\s$/);
});

test("patched lists never exceed the width from 10 to 160 columns", (t) => {
	patched(t);
	const select = selectList();
	const settings = settingsList();
	for (let width = 10; width <= 160; width++) {
		for (const line of [...select.render(width), ...settings.render(width)]) {
			assert.ok(
				visibleWidth(line) <= width,
				`${width}: ${JSON.stringify(line)}`,
			);
		}
	}
});

test("a native theme keeps the pi-tui rendering, and custom selectors swap their accent marker for ▸", (t) => {
	patched(t);
	const native = { ...getSelectListTheme(), [NATIVE]: true };
	assert.match(plain(selectList(native).render(60))[0], /^→ alpha/);
	const selector = Object.create(ModelSelectorComponent.prototype);
	selector.children = [
		{ render: () => [`${theme.fg("accent", "→ ")}model`, "  other"] },
	];
	const lines = selector.render(20);
	assert.deepEqual(plain(lines), [` ▸ model${" ".repeat(11)}`, "   other"]);
	assert.ok(lines[0].startsWith(` ${selectedBg}`));
});

const strong = (text) => theme.bold(theme.fg("text", text));
const accent = theme.fg("accent", "\u0000").split("\u0000")[0];

function authSelector() {
	return new ExtensionSelectorComponent(
		"Select authentication method:",
		["Sign in with an account", "Sign in with an API key"],
		() => {},
		() => {},
	);
}

function providerSelector() {
	return new OAuthSelectorComponent(
		"login",
		[
			{ id: "a", name: "Anthropic", authType: "oauth" },
			{
				id: "b",
				name: "OpenAI",
				authType: "api_key",
				status: { type: "api_key", source: "stored credential" },
			},
		],
		() => {},
		() => {},
	);
}

function inputDialog() {
	return new ExtensionInputComponent(
		"Project name",
		"",
		() => {},
		() => {},
	);
}

test("the auth-method selector renders a text title, a bold text selected label, and Grok hints", (t) => {
	patched(t);
	const lines = authSelector().render(70);
	const [title, selected, other, hints] = [2, 4, 5, 7].map((i) => lines[i]);
	assert.ok(title.includes(strong("Select authentication method:")));
	assert.ok(!title.includes(accent));
	assert.ok(selected.startsWith(` ${selectedBg}`));
	assert.ok(
		selected.includes(`${strong("▸ ")}${strong("Sign in with an account")}`),
	);
	assert.ok(other.includes(theme.fg("dim", "▸ ")));
	assert.ok(!lines.join("").includes(accent));
	assert.equal(
		plain([hints])[0],
		"  ↑/↓ navigate  |  Enter select  |  Esc/Ctrl+C cancel",
	);
	assert.ok(hints.includes(`${strong("↑/↓")} ${theme.fg("dim", "navigate")}`));
});

test("the provider picker and the input dialog get the same title, row, and hint styling", (t) => {
	patched(t);
	const provider = providerSelector().render(70);
	assert.ok(provider[2].includes(strong("Select provider to configure:")));
	assert.ok(provider[6].startsWith(` ${selectedBg}`));
	assert.ok(provider[6].includes(strong("Anthropic")));
	assert.ok(provider[7].includes(theme.fg("success", " ✓ configured")));
	assert.ok(!provider.join("").includes(accent));
	const input = inputDialog().render(70);
	assert.ok(input[2].includes(strong("Project name")));
	assert.ok(!input.join("").includes(accent));
	assert.equal(plain([input[6]])[0], "  Enter submit  |  Esc/Ctrl+C cancel");
});

test("restyled selectors keep pi's line counts inside the page margin and never exceed the width from 10 to 160 columns", (t) => {
	t.after(restoreMenus);
	const components = [authSelector(), providerSelector(), inputDialog()];
	for (let width = 10; width <= 160; width++) {
		const margin = width >= 16 ? 1 : 0;
		for (const component of components) {
			restoreMenus();
			const native = component.render(width - margin * 2).length;
			patchMenus();
			const lines = component.render(width);
			assert.equal(lines.length, native, `${width}`);
			for (const line of lines)
				assert.ok(
					visibleWidth(line) <= width,
					`${width}: ${JSON.stringify(line)}`,
				);
		}
	}
});

test("the chrome editor autocomplete keeps its ❯ look while the menus are patched", (t) => {
	patched(t);
	const editor = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{ theme: () => theme, label: () => "m" },
	);
	const shown = plain(selectList(editor.theme.selectList).render(60));
	assert.match(shown[0], /^❯ alpha\s+The first choice$/);
	assert.ok(!shown.join("\n").includes("▸"));
});

test("patching twice is idempotent and restore puts the pi-tui methods back", () => {
	patchMenus();
	patchMenus();
	assert.notEqual(SelectList.prototype.renderItem, pristine.renderItem);
	restoreMenus();
	assert.equal(SelectList.prototype.render, pristine.render);
	assert.equal(SettingsList.prototype.render, pristine.settingsRender);
	assert.equal(SelectList.prototype.renderItem, pristine.renderItem);
	assert.equal(SettingsList.prototype.renderMainList, pristine.renderMainList);
	for (const selector of [
		ModelSelectorComponent,
		ExtensionSelectorComponent,
		OAuthSelectorComponent,
		ExtensionInputComponent,
		SettingsSelectorComponent,
	]) {
		assert.equal(Object.hasOwn(selector.prototype, "render"), false);
		assert.equal(Object.hasOwn(selector.prototype, "handleMouse"), false);
	}
	assert.match(plain(selectList().render(60))[0], /^→ alpha/);
	const selector = authSelector();
	const native = selector.render(70);
	patchMenus();
	selector.render(70);
	restoreMenus();
	assert.deepEqual(selector.render(70), native);
});

test("the modal frame puts the title and a dim [×] on a square border and fits every width", () => {
	const body = (inner) => [
		sectionRule(theme, "Profiles", inner),
		menuRow(theme, "default", "active", true, inner, true),
		...hintRows(
			theme,
			[
				["Enter", "open"],
				["Esc", "exit"],
			],
			inner,
		).lines,
	];
	const lines = plain(modalFrame(theme, "Models", body(36), 42));
	assert.deepEqual(lines, [
		`┌─ Models ${"─".repeat(25)} [×] ─┐`,
		`│   Profiles ${"─".repeat(26)}  │`,
		`│  ▸ default${" ".repeat(18)}active ›   │`,
		`│        Enter open  |  Esc exit         │`,
		`└${"─".repeat(40)}┘`,
	]);
	for (let width = 4; width <= 160; width++) {
		for (const line of modalFrame(
			theme,
			"Model profiles",
			body(Math.max(0, width - 6)),
			width,
		)) {
			assert.ok(
				visibleWidth(line) <= width,
				`${width}: ${JSON.stringify(line)}`,
			);
		}
	}
});

function settingsSelector(onCancel = () => {}) {
	const list = settingsSubmenus();
	list.onCancel = onCancel;
	const selector = Object.create(SettingsSelectorComponent.prototype);
	selector.children = [{ render: () => ["─"] }, list, { render: () => ["─"] }];
	selector.settingsList = list;
	return { selector, list };
}

function mouse(type, x, y, width, height) {
	return {
		type,
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

test("settings render inside a margined modal frame titled with the submenu breadcrumb", (t) => {
	patched(t);
	const { selector, list } = settingsSelector();
	const main = plain(selector.render(60));
	assert.match(main[0], /^ ┌─ Settings ─+ \[×\] ─┐$/);
	assert.match(main[1], /^ │ {2}❯ Type to search\s+│$/);
	assert.match(main.at(-1), /^ └─+┘$/);
	assert.ok(!main.includes("─"));
	list.selectItem("auto-theme");
	list.activateItem();
	assert.match(plain(selector.render(60))[0], /─ Settings › Automatic theme ─/);
	list.handleInput("\r");
	const nested = plain(selector.render(60));
	assert.match(nested[0], /─ Settings › Automatic theme › Light theme ─/);
	assert.match(nested[1], /^ │ {2}Select the light theme\s+│$/);
	for (let width = 1; width <= 160; width++)
		for (const line of selector.render(width))
			assert.ok(visibleWidth(line) <= width, `${width}`);
});

test("stepped settings panes use the active step title as the last breadcrumb", (t) => {
	patched(t);
	const { selector, list } = settingsSelector();
	list.selectItem("model-thinking");
	list.activateItem();
	assert.match(
		plain(selector.render(80))[0],
		/─ Settings › Per-Model Thinking Level ─/,
	);
});

test("settings mouse clicks land on the framed rows and the [×] closes every level", (t) => {
	patched(t);
	let cancelled = 0;
	const { selector, list } = settingsSelector(() => cancelled++);
	const lines = selector.render(60);
	const row = plain(lines).findIndex((line) =>
		line.includes("Automatic theme"),
	);
	for (const type of ["press", "click"])
		selector.handleMouse(mouse(type, 8, row, 60, lines.length));
	assert.ok(list.submenuComponent);
	assert.match(plain(selector.render(60))[0], /› Automatic theme/);
	const close = plain(lines)[0].indexOf("×");
	assert.equal(
		selector.handleMouse(mouse("press", close, 0, 60, lines.length)),
		undefined,
	);
	selector.handleMouse(mouse("click", close, 0, 60, lines.length));
	assert.equal(list.submenuComponent, null);
	assert.equal(cancelled, 1);
});

test("the model selector marks the current model with ●, keeps labels in text, and dims its notices", (t) => {
	patched(t);
	const rows = new Container();
	rows.addChild(
		new Text(
			`${theme.fg("accent", "→ ")}${theme.fg("accent", "✓ ")}${theme.fg("accent", "grok")} ${theme.fg("muted", "[demo]")}`,
			0,
			0,
		),
	);
	rows.addChild(
		new Text(
			`  ${theme.fg("accent", "✓ ")}glm ${theme.fg("muted", "[demo]")}`,
			0,
			0,
		),
	);
	rows.addChild(new Text(`    qwen ${theme.fg("muted", "[demo]")}`, 0, 0));
	rows.addChild(
		new Text(theme.fg("success", "  Model catalogs refreshed."), 0, 0),
	);
	const selector = Object.create(ModelSelectorComponent.prototype);
	selector.children = [
		new Text(theme.fg("warning", "Only showing configured models."), 0, 0),
		rows,
	];
	const lines = selector.render(60);
	assert.ok(
		lines[0].includes(theme.fg("dim", "Only showing configured models.")),
	);
	assert.ok(lines[1].includes(`${theme.fg("text", "● ")}${strong("grok")}`));
	assert.ok(
		lines[2].includes(`${theme.fg("text", "● ")}${theme.fg("text", "glm ")}`),
	);
	assert.ok(lines[3].includes(theme.fg("text", "  qwen ")));
	assert.ok(lines[4].includes(theme.fg("dim", "  Model catalogs refreshed.")));
	assert.ok(!lines.join("").includes("✓"));
});

test("hint keys use one casing", () => {
	assert.equal(displayKey("↑↓"), "↑/↓");
	assert.equal(displayKey("enter"), "Enter");
	assert.equal(displayKey("escape/ctrl+c"), "Esc/Ctrl+C");
	assert.equal(displayKey("Ctrl+S"), "Ctrl+S");
});
