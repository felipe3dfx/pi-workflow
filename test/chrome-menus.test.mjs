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

test("a patched SelectList marks rows with ▸, highlights the selected row full width, and dims descriptions and the scroll info", (t) => {
	patched(t);
	const list = selectList();
	const lines = list.render(60);
	const shown = plain(lines);
	assert.match(shown[0], /^▸ alpha\s+The first choice\s*$/);
	assert.match(shown[1], /^▸ beta\s+The second choice$/);
	assert.equal(shown[2], "  (1/3)");
	assert.ok(lines[0].startsWith(selectedBg));
	assert.equal(visibleWidth(lines[0]), 60);
	assert.ok(!lines[1].includes(selectedBg));
	assert.ok(lines[1].includes(theme.fg("dim", "The second choice")));
	assert.equal(lines[2], theme.fg("dim", "  (1/3)"));
	assert.ok(!shown.join("\n").includes("→"));
	list.handleInput("\x1b[B");
	assert.ok(list.render(60)[1].startsWith(selectedBg));
	assert.equal(list.getSelectedItem().value, "beta");
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

test("settings select submenus get a text title, ▸ rows on selectedBg, and Grok hints", (t) => {
	patched(t);
	const lines = openSubmenu("theme").render(70);
	assert.ok(lines[0].includes(strong("Theme")));
	assert.ok(lines[2].includes(theme.fg("muted", "Select a theme")));
	assert.ok(!lines.join("").includes(accent));
	assert.match(plain([lines[4]])[0], /^▸ {3}automatic\s+Use separate themes/);
	assert.ok(lines[4].includes(theme.fg("dim", "▸ ")));
	assert.ok(lines[5].startsWith(selectedBg));
	assert.ok(lines[5].includes(`${strong("▸ ")}${strong("✓ dark")}`));
	assert.equal(visibleWidth(lines[5]), 70);
	assert.equal(plain([lines.at(-1)])[0], "  Enter select  |  Esc go back");
	assert.ok(
		lines.at(-1).includes(`${strong("Esc")} ${theme.fg("dim", "go back")}`),
	);
});

test("stepped submenus restyle the active step and its search input", (t) => {
	patched(t);
	const list = openSubmenu("model-thinking");
	const lines = list.render(70);
	assert.ok(lines[0].includes(strong("Per-Model Thinking Level")));
	assert.ok(!lines.join("").includes(accent));
	assert.match(plain([lines[4]])[0], /^❯ Type to search\s*$/);
	assert.ok(lines[6].startsWith(selectedBg));
	assert.ok(lines[7].includes(theme.fg("dim", "▸ ")));
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

test("nested settings submenus keep descriptions and restyle the inner select submenu", (t) => {
	patched(t);
	const outer = plain(openSubmenu("auto-theme").render(70));
	assert.equal(outer[0].trim(), "Automatic Theme");
	assert.ok(
		outer.includes(
			"  Theme to use in automatic mode when the terminal is light",
		),
	);
	assert.equal(outer.at(-1), "  Enter/Space change  |  Esc cancel");
	const inner = openSubmenu("auto-theme", true).render(70);
	assert.ok(inner.some((line) => line.includes(strong("Automatic Theme"))));
	assert.ok(inner.some((line) => line.includes(strong("Light Theme"))));
	assert.ok(!inner.join("").includes(accent));
	assert.equal(plain([inner.at(-1)])[0], "  Enter select  |  Esc go back");
});

test("settings submenus keep pi's line counts and never exceed the width from 10 to 160 columns", (t) => {
	t.after(restoreMenus);
	const submenus = [
		openSubmenu("theme"),
		openSubmenu("model-thinking"),
		openSubmenu("auto-theme", true),
	];
	const lists = [...submenus, openSubmenu("auto-theme")];
	for (let width = 10; width <= 160; width++) {
		for (const list of lists) {
			restoreMenus();
			const native = list.render(width).length;
			patchMenus();
			const lines = list.render(width);
			if (submenus.includes(list))
				assert.equal(lines.length, native, `${width}`);
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
	assert.deepEqual(plain(lines), [`▸ model${" ".repeat(13)}`, "  other"]);
	assert.ok(lines[0].startsWith(selectedBg));
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
	assert.ok(selected.startsWith(selectedBg));
	assert.ok(
		selected.includes(`${strong("▸ ")}${strong("Sign in with an account")}`),
	);
	assert.ok(other.includes(theme.fg("dim", "▸ ")));
	assert.ok(!lines.join("").includes(accent));
	assert.equal(
		plain([hints])[0],
		" ↑↓ navigate  |  enter select  |  escape/ctrl+c cancel",
	);
	assert.ok(hints.includes(`${strong("↑↓")} ${theme.fg("dim", "navigate")}`));
});

test("the provider picker and the input dialog get the same title, row, and hint styling", (t) => {
	patched(t);
	const provider = providerSelector().render(70);
	assert.ok(provider[2].includes(strong("Select provider to configure:")));
	assert.ok(provider[6].startsWith(selectedBg));
	assert.ok(provider[6].includes(strong("Anthropic")));
	assert.ok(provider[7].includes(theme.fg("success", " ✓ configured")));
	assert.ok(!provider.join("").includes(accent));
	const input = inputDialog().render(70);
	assert.ok(input[2].includes(strong("Project name")));
	assert.ok(!input.join("").includes(accent));
	assert.equal(plain([input[6]])[0], " enter submit  |  escape/ctrl+c cancel");
});

test("restyled selectors keep pi's line counts and never exceed the width from 10 to 160 columns", (t) => {
	t.after(restoreMenus);
	const components = [authSelector(), providerSelector(), inputDialog()];
	for (let width = 10; width <= 160; width++) {
		for (const component of components) {
			restoreMenus();
			const native = component.render(width).length;
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
	])
		assert.equal(Object.hasOwn(selector.prototype, "render"), false);
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
