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
import { theme } from "../extensions/visual-language.ts";
import { densityTerminal } from "./support/density-terminal.mjs";
import { eachWideWidth, wideCards } from "./support/wide-cards.mjs";

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

const notice = (t, counts = facts) =>
	card(t, { content: explorationNotice(counts, "inline"), details: counts });

const at = (y, width) => ({
	type: "click",
	button: "left",
	x: 3,
	y,
	width,
	height: 4,
	screenX: 3,
	screenY: y,
});

test("below 60 terminal columns the exploration head keeps its counts and ›, and the → action takes its own warning row with no status row", (t) => {
	densityTerminal(t, 44);
	const component = notice(t);
	assert.deepEqual(plain(component, 43), [
		"",
		"◆ Exploration budget 4 lookups · 47 KB   ›",
		"  → continue discovery in an explore child",
	]);
	const raw = component.render(43);
	assert.ok(
		raw[2].includes(
			theme().fg("warning", "→ continue discovery in an explore child"),
		),
	);
	assert.equal(component.handleMouse(at(2, 43)), undefined);
	assert.ok(component.handleMouse(at(1, 43))?.handled);
	const open = plain(component, 43);
	assert.equal(open[1], "◆ Exploration budget 4 lookups · 47 KB   ›");
	assert.equal(open[2], "  → continue discovery in an explore child");
	assert.match(open[3], /^ {2}Exploration budget: 4 tracked lookups/);
});

test("below 60 terminal columns the exploration head keeps both counts with their units at 44 columns and cuts its title with … first", (t) => {
	densityTerminal(t, 44);
	assert.equal(
		plain(notice(t, { lookups: 4, textBytes: 101_000 }), 43)[1],
		"◆ Exploration budget 4 lookups · 101 KB  ›",
	);
	assert.equal(
		plain(notice(t, { lookups: 1234, textBytes: 12_300_000 }), 43)[1],
		"◆ Exploration bu… 1234 lookups · 12.3 MB ›",
	);
});

test("below 60 terminal columns a narrower exploration notice cuts its title with … before › and wraps the action whole", (t) => {
	densityTerminal(t, 44);
	assert.deepEqual(plain(notice(t), 30), [
		"",
		"◆ Explor… 4 lookups · 47 KB ›",
		"  → continue discovery in an",
		"  explore child",
	]);
	const head = (columns, counts) => {
		densityTerminal(t, columns);
		return plain(notice(t, counts), columns - 1)[1];
	};
	assert.equal(
		head(26, { lookups: 4, textBytes: 101_000 }),
		"◆ … 4 lookups · 101 KB ›",
	);
	assert.equal(head(25, facts), "◆ … 4 lookups · 47 KB ›");
	assert.equal(head(21, facts), "4 lookups · 47 KB ›");
});

test("at 60 and 100 terminal columns the exploration notice renders the base's bytes, collapsed and expanded, also after crossing 60 columns both ways", (t) => {
	const terminal = densityTerminal(t, 60);
	const opened = notice(t);
	opened.setExpanded(true);
	const scenarios = { collapsed: notice(t), expanded: opened };
	for (const pass of ["before", "after"]) {
		for (const [name, component] of Object.entries(scenarios))
			eachWideWidth(terminal, (width, columns) =>
				assert.deepEqual(
					component.render(width),
					wideCards.budget[name][width],
					`${pass} ${name} ${width} in ${columns}`,
				),
			);
		terminal.columns = 59;
		const narrow = plain(scenarios.expanded, 58);
		assert.equal(narrow[2], "  → continue discovery in an explore child");
		assert.match(narrow[3], /^ {2}Exploration budget: 4 tracked lookups/);
	}
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
