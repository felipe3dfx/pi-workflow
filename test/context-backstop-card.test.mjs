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
import { densityTerminal } from "./support/density-terminal.mjs";

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
