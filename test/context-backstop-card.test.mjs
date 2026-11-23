import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	CustomMessageComponent,
	initTheme,
} from "@earendil-works/pi-coding-agent";

import { registerContextBackstopCard } from "../extensions/context-backstop-card.ts";
import {
	backstopNotice,
	CONTEXT_BACKSTOP_TYPE,
} from "../extensions/context-backstop.ts";
import { theme } from "../extensions/visual-language.ts";
import { densityTerminal } from "./support/density-terminal.mjs";
import { eachWideWidth, wideCards } from "./support/wide-cards.mjs";

const piTui = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"@earendil-works/pi-tui",
	)
);
const markdownTheme = new Proxy({}, { get: () => (text) => text });

function card(t, details, content = backstopNotice(details)) {
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
	registerContextBackstopCard({
		registerMessageRenderer: (type, render) => renderers.set(type, render),
	});
	return new CustomMessageComponent(
		{
			role: "custom",
			display: true,
			customType: CONTEXT_BACKSTOP_TYPE,
			content,
			details,
		},
		renderers.get(CONTEXT_BACKSTOP_TYPE),
		markdownTheme,
		1,
	);
}

const plain = (component, width = 140) =>
	component
		.render(width)
		.map((line) => stripVTControlCharacters(line).trimEnd());

const facts = { tokens: 156_514, threshold: 150_000, contextWindow: 1_000_000 };

test("a collapsed backstop is one row with the usage, its meter, the ask and Pi's expand key", (t) => {
	const lines = plain(card(t, facts));
	assert.equal(lines.length, 2);
	assert.match(
		lines[1],
		/^ {3}◆ Context 156K \/ 150K ▰▱▱▱▱▱▱▱ · delegate the next bounded unit +\(ctrl\+o to expand\)$/,
	);
});

test("the collapsed row states when the advisor was last consulted, or that it was not", (t) => {
	assert.match(
		plain(card(t, { ...facts, advisor: { turnsAgo: 3 } }))[1],
		/· delegate the next bounded unit · advisor ✓ 3 turns ago +\(ctrl/,
	);
	assert.match(
		plain(card(t, { ...facts, advisor: { turnsAgo: 1 } }))[1],
		/· advisor ✓ 1 turn ago +\(ctrl/,
	);
	assert.match(
		plain(card(t, { ...facts, advisor: { turnsAgo: 0 } }))[1],
		/· advisor ✓ this turn +\(ctrl/,
	);
	assert.match(
		plain(card(t, { ...facts, advisor: {} }))[1],
		/· advisor not consulted +\(ctrl/,
	);
});

test("without a known window the row omits the meter", (t) => {
	const { contextWindow: _, ...windowless } = facts;
	assert.match(
		plain(card(t, windowless))[1],
		/◆ Context 156K \/ 150K · delegate/,
	);
});

test("a narrow row is truncated to the width and drops the expand key", (t) => {
	const component = card(t, { ...facts, advisor: { turnsAgo: 3 } });
	const lines = component.render(40);
	assert.equal(lines.length, 2);
	assert.ok(piTui.visibleWidth(lines[1]) <= 40);
	const text = stripVTControlCharacters(lines[1]);
	assert.match(text, /◆ Context 156K/);
	assert.doesNotMatch(text, /ctrl\+o/);
});

test("an expanded backstop shows the full model-facing text below the row", (t) => {
	const component = card(t, { ...facts, advisor: {} });
	component.setExpanded(true);
	const lines = plain(component);
	assert.match(lines[1], /\(ctrl\+o to collapse\)$/);
	const body = lines.slice(2).join(" ").replace(/\s+/g, " ");
	assert.match(body, /holds 156,514 tokens/);
	assert.match(
		body,
		/Consult the advisor before choosing the delegation boundary/,
	);
	assert.match(body, /grants no mutation or guard bypass authority/);
});

test("a backstop without numeric details falls back to Pi's default rendering", (t) => {
	assert.ok(
		plain(card(t, undefined, "raw")).some((line) =>
			line.includes(`[${CONTEXT_BACKSTOP_TYPE}]`),
		),
	);
});

test("below 60 terminal columns the backstop head keeps the usage, its meter and ›, and the → action takes its own row", (t) => {
	densityTerminal(t, 44);
	assert.deepEqual(plain(card(t, facts), 43), [
		"",
		`◆ Context 156K / 150K ▰▱▱▱▱▱▱▱${" ".repeat(11)}›`,
		"  → delegate the next bounded unit",
	]);
	const raw = card(t, facts).render(43);
	assert.ok(
		raw[2].includes(theme().fg("warning", "→ delegate the next bounded unit")),
	);
	assert.ok(raw[1].endsWith(theme().fg("dim", "›")));
});

test("below 60 terminal columns the backstop states the advisor on a dim row of its own, only when the details carry it", (t) => {
	densityTerminal(t, 44);
	for (const [advisor, status] of [
		[{ turnsAgo: 3 }, "advisor ✓ 3 turns ago"],
		[{ turnsAgo: 1 }, "advisor ✓ 1 turn ago"],
		[{ turnsAgo: 0 }, "advisor ✓ this turn"],
		[{}, "advisor not consulted"],
	])
		assert.deepEqual(plain(card(t, { ...facts, advisor }), 43).slice(1), [
			`◆ Context 156K / 150K ▰▱▱▱▱▱▱▱${" ".repeat(11)}›`,
			"  → delegate the next bounded unit",
			`  ${status}`,
		]);
	const raw = card(t, { ...facts, advisor: {} }).render(43);
	assert.ok(raw[3].includes(theme().fg("dim", "advisor not consulted")));
});

test("below 60 terminal columns a backstop narrower than its row cuts the head with … before › and wraps the action whole", (t) => {
	densityTerminal(t, 44);
	assert.deepEqual(plain(card(t, { ...facts, advisor: { turnsAgo: 3 } }), 24), [
		"",
		"◆ Context 156K / 150… ›",
		"  → delegate the next",
		"  bounded unit",
		"  advisor ✓ 3 turns ago",
	]);
	for (const width of [1, 2, 3, 5])
		for (const line of card(t, facts).render(width))
			assert.ok(piTui.visibleWidth(line) <= width - 1, `${width}: ${line}`);
});

test("below 60 terminal columns an expanded backstop keeps ›, the action and the advisor row above the full text", (t) => {
	densityTerminal(t, 44);
	const component = card(t, { ...facts, advisor: {} });
	component.setExpanded(true);
	const lines = plain(component, 43);
	assert.deepEqual(lines.slice(1, 5), [
		`◆ Context 156K / 150K ▰▱▱▱▱▱▱▱${" ".repeat(11)}›`,
		"  → delegate the next bounded unit",
		"  advisor not consulted",
		"  Context backstop: the parent context",
	]);
	for (const line of lines.slice(4)) assert.match(line, /^ {2}\S/);
});

test("at 60 and 100 terminal columns the backstop renders the base's bytes, collapsed, with each advisor state and expanded", (t) => {
	const terminal = densityTerminal(t, 60);
	const scenarios = {
		bare: () => card(t, facts),
		consulted: () =>
			card(t, { ...facts, advisor: { turnsAgo: 3 } }, backstopNotice(facts)),
		unconsulted: () =>
			card(t, { ...facts, advisor: {} }, backstopNotice(facts)),
		expanded: () => {
			const component = card(t, { ...facts, advisor: { turnsAgo: 0 } });
			component.setExpanded(true);
			return component;
		},
	};
	for (const [name, make] of Object.entries(scenarios))
		eachWideWidth(terminal, (width, columns) =>
			assert.deepEqual(
				make().render(width),
				wideCards.backstop[name][width],
				`${name} ${width} in ${columns}`,
			),
		);
});

test("one backstop opened by a click and crossing 60 terminal columns in both directions switches layout on each render and stays open", (t) => {
	const terminal = densityTerminal(t, 60);
	const component = card(t, { ...facts, advisor: { turnsAgo: 0 } });
	assert.ok(
		component.handleMouse({
			type: "click",
			button: "left",
			x: 3,
			y: 1,
			width: 59,
			height: 2,
			screenX: 3,
			screenY: 1,
		})?.handled,
	);
	assert.deepEqual(component.render(59), wideCards.backstop.expanded[59]);
	terminal.columns = 59;
	const narrow = plain(component, 58);
	assert.deepEqual(narrow.slice(1, 4), [
		`◆ Context 156K / 150K ▰▱▱▱▱▱▱▱${" ".repeat(26)}›`,
		"  → delegate the next bounded unit",
		"  advisor ✓ this turn",
	]);
	assert.match(narrow[4], /^ {2}Context backstop:/);
	terminal.columns = 60;
	assert.deepEqual(component.render(59), wideCards.backstop.expanded[59]);
});

test("below 60 terminal columns the notice card puts its glyph in the lane, its body at the body column and keeps the right margin", (t) => {
	densityTerminal(t, 44);
	const component = card(t, facts);
	const closed = plain(component, 43);
	assert.match(closed[1], /^◆ Context 156K \/ 150K/);
	assert.ok(
		component.handleMouse({
			type: "click",
			button: "left",
			x: 0,
			y: 1,
			width: 43,
			height: 2,
			screenX: 0,
			screenY: 1,
		})?.handled,
	);
	const open = component.render(43);
	assert.ok(open.length > 2);
	for (const line of plain(component, 43).slice(2))
		assert.match(line, /^ {2}\S/);
	for (const line of open) assert.ok(piTui.visibleWidth(line) <= 42);
});
