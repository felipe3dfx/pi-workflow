import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	CustomMessageComponent,
	initTheme,
} from "@earendil-works/pi-coding-agent";

import {
	EXPLORATION_BUDGET_TYPE,
	formatBytes,
	registerExplorationBudgetCard,
} from "../extensions/exploration-budget-card.ts";
import { explorationNotice } from "../extensions/exploration-budget.ts";

const piTui = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"@earendil-works/pi-tui",
	)
);
const markdownTheme = new Proxy({}, { get: () => (text) => text });

function card(t, message) {
	initTheme("dark", false);
	const { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } = piTui;
	setKeybindings(
		new KeybindingsManager({
			...TUI_KEYBINDINGS,
			"app.tools.expand": { defaultKeys: "ctrl+o" },
		}),
	);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	const renderers = new Map();
	registerExplorationBudgetCard({
		registerMessageRenderer: (type, render) => renderers.set(type, render),
	});
	return new CustomMessageComponent(
		{
			role: "custom",
			display: true,
			customType: EXPLORATION_BUDGET_TYPE,
			...message,
		},
		renderers.get(EXPLORATION_BUDGET_TYPE),
		markdownTheme,
		1,
	);
}

const plain = (component, width = 120) =>
	component
		.render(width)
		.map((line) => stripVTControlCharacters(line).trimEnd());

const facts = { lookups: 4, textBytes: 47_029 };

test("a collapsed exploration notice is one row with the counts and Pi's expand key", (t) => {
	const component = card(t, {
		content: explorationNotice(facts, "inline"),
		details: facts,
	});
	const lines = plain(component);
	assert.equal(lines.length, 2);
	assert.match(
		lines[1],
		/^ {3}◆ Exploration budget · 4 lookups · 47 KB → continue discovery in an explore child +\(ctrl\+o to expand\)$/,
	);
});

test("an expanded exploration notice shows the full model-facing text below the row", (t) => {
	const component = card(t, {
		content: explorationNotice(facts, "inline"),
		details: facts,
	});
	component.setExpanded(true);
	const lines = plain(component);
	assert.match(lines[1], /\(ctrl\+o to collapse\)$/);
	assert.match(
		lines.slice(2).join(" "),
		/grants no mutation or guard bypass authority/,
	);
});

test("a click on the row toggles the notice text, and a click on the text does not", (t) => {
	const component = card(t, {
		content: explorationNotice(facts, "inline"),
		details: facts,
	});
	const at = (y) => ({
		type: "click",
		button: "left",
		x: 6,
		y,
		width: 120,
		height: component.render(120).length,
		screenX: 6,
		screenY: y,
	});
	assert.equal(plain(component).length, 2);
	assert.ok(component.handleMouse(at(1))?.handled);
	component.invalidate();
	const open = plain(component);
	assert.ok(open.length > 2);
	assert.equal(component.handleMouse(at(2)), undefined);
	assert.ok(component.handleMouse(at(1))?.handled);
	component.invalidate();
	assert.equal(plain(component).length, 2);
});

test("a notice without numeric facts falls back to Pi's default rendering", (t) => {
	const component = card(t, { content: "raw", details: {} });
	assert.ok(
		plain(component).some((line) =>
			line.includes(`[${EXPLORATION_BUDGET_TYPE}]`),
		),
	);
});

test("byte counts read as B, KB, or MB", () => {
	assert.equal(formatBytes(512), "512 B");
	assert.equal(formatBytes(47_029), "47 KB");
	assert.equal(formatBytes(2_400_000), "2.4 MB");
});
