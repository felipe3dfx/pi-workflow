import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { visibleWidth } from "@earendil-works/pi-tui";

import { loadThemeFromPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { childGlyph, renderChildrenBox } from "../extensions/children-box.ts";
import { densityTerminal } from "./support/density-terminal.mjs";

const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => `\x1b[7m${text}\x1b[27m`,
	bold: (text) => text,
};

const now = 1_000_000;

function child(overrides) {
	return {
		id: "a1b2c3d4-0000-0000-0000-000000000000",
		role: "worker",
		task: "Fix the failing test\nwith details",
		worktree: "/repo",
		model: "xai/grok-4.7",
		thinking: "high",
		state: "running",
		createdAt: now - 20_000,
		startedAt: now - 12_000,
		...overrides,
	};
}

test("no children, or only children that finished more than 60 seconds ago, render nothing", () => {
	assert.deepEqual(renderChildrenBox(theme, [], now, 80), []);
	assert.deepEqual(
		renderChildrenBox(
			theme,
			[child({ state: "completed", endedAt: now - 60_000 })],
			now,
			80,
		),
		[],
	);
});

test("the box reads Subagents with counts by state, and each row shows the state, name, step, model, effort, and elapsed time", () => {
	const lines = renderChildrenBox(
		theme,
		[
			child({ step: "bash npm test" }),
			child({
				id: "c3d4",
				role: "explore",
				state: "waiting",
				thinking: "low",
				step: "asks question 1",
				startedAt: now - 62_000,
			}),
		],
		now,
		100,
	);
	assert.match(lines[0], /▾ Subagents 1 waiting · 1 running +alt\+a view/);
	assert.match(
		lines[1],
		/\? explore c3d4 asks question 1 +grok-4\.7 \(low\) 1m 02s/,
	);
	assert.match(lines[2], /⠦ worker a1b2 bash npm test +grok-4\.7 \(high\) 12s/);
	assert.equal(lines.length, 3);
});

test("a row reads its full elapsed time at narrow and wide widths, shortening a long model instead", () => {
	const row = (width) =>
		stripVTControlCharacters(
			renderChildrenBox(
				theme,
				[
					child({
						model: "claude-sonnet-4-6-with-custom-identifier",
						thinking: undefined,
						startedAt: now - 3_240,
					}),
				],
				now,
				width,
			)[1],
		);
	assert.equal(row(44), " claude-sonnet-4-6-with-custom-ident... 3.2s");
	assert.match(row(100), / claude-sonnet-4-6-with-custom-identifier 3\.2s$/);
});

test("the first row is highlighted, a queued row shows queued, and the task's first line stands in for a missing step", () => {
	const lines = renderChildrenBox(
		theme,
		[child({ step: "bash npm test" }), child({ id: "q", state: "queued" })],
		now,
		80,
	);
	assert.ok(lines[1].startsWith("\x1b[7m"));
	assert.ok(!lines[2].startsWith("\x1b[7m"));
	assert.match(lines[2], /○ worker q Fix the failing test +queued$/);
	assert.match(lines[1], /worker a1b2 /);
});

test("every row shows its role plus a four-character id, even when the role is unique", () => {
	const lines = renderChildrenBox(
		theme,
		[
			child({ id: "a1b2-x" }),
			child({ id: "c3d4-y" }),
			child({ id: "e5f6-z", role: "explore" }),
		],
		now,
		80,
	);
	assert.match(lines[1], /worker a1b2 /);
	assert.match(lines[2], /worker c3d4 /);
	assert.match(lines[3], /⠦ explore e5f6 Fix/);
});

test("finished rows stay 60 seconds, at most the three latest, after the working rows", () => {
	const finished = (id, state, endedAgo) =>
		child({ id, role: id, state, endedAt: now - endedAgo });
	const lines = renderChildrenBox(
		theme,
		[
			finished("old", "completed", 59_000),
			finished("done", "completed", 1_000),
			finished("broke", "failed", 2_000),
			child({ id: "live", role: "live" }),
			finished("stopped", "cancelled", 3_000),
			finished("slow", "timed out", 4_000),
		],
		now,
		80,
	);
	assert.deepEqual(
		lines
			.slice(1)
			.map((line) => stripVTControlCharacters(line).trim().split(" ")[0]),
		["⠦", "✓", "✗", "–"],
	);
	assert.match(lines[0], /Subagents 1 running · 3 finished /);
	assert.doesNotMatch(lines.join("\n"), /old|slow/);
});

test("waiting rows come first, then running, then queued, and the box shows eight rows plus … N more", () => {
	const records = [
		...Array.from({ length: 4 }, (_, i) =>
			child({ id: `r${i}`, role: `r${i}` }),
		),
		...Array.from({ length: 5 }, (_, i) =>
			child({ id: `q${i}`, role: `q${i}`, state: "queued" }),
		),
		child({ id: "w", role: "w", state: "waiting" }),
		child({
			id: "t",
			role: "t",
			state: "timed out",
			endedAt: now - 1_000,
		}),
	];
	const lines = renderChildrenBox(theme, records, now, 80);
	assert.match(
		lines[0],
		/Subagents 1 waiting · 4 running · 5 queued · 1 finished /,
	);
	assert.equal(lines.length, 10);
	assert.match(lines[1], /\? w /);
	assert.match(lines[2], /⠦ r0 /);
	assert.match(lines[6], /○ q0 /);
	assert.match(lines[9], /… 3 more · alt\+a view/);
});

test("every line fits the width, including wide task text", () => {
	for (const width of [20, 40, 80]) {
		const lines = renderChildrenBox(
			theme,
			[child({ task: "修复失败的测试".repeat(10) })],
			now,
			width,
		);
		for (const line of lines) assert.ok(visibleWidth(line) <= width);
	}
});

test("the running glyph and the role use the accent while the short id stays plain", () => {
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
	};
	const [, row] = renderChildrenBox(tagged, [child({})], now, 200);
	assert.match(row, /<accent>⠦<\/accent> <accent>worker<\/accent> a1b2 /);
});

test("the heading is a dim chevron, a bold muted title, and dim counts with waiting in the warning tone", () => {
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
		bold: (text) => `<b>${text}</b>`,
	};
	const [heading] = renderChildrenBox(tagged, [child({})], now, 200);
	assert.match(
		heading,
		/^<dim>▾<\/dim> <b><muted>Subagents<\/muted><\/b> <dim>1 running<\/dim> +<dim>alt\+a view<\/dim>$/,
	);
	const [waiting] = renderChildrenBox(
		tagged,
		[child({ state: "waiting" }), child({})],
		now,
		200,
	);
	assert.match(
		waiting,
		/<warning>1 waiting<\/warning><dim> · <\/dim><dim>1 running<\/dim>/,
	);
});

test("a running row cycles the working spinner every 133 ms while other states keep their glyph", () => {
	const glyphAt = (record, at) =>
		stripVTControlCharacters(renderChildrenBox(theme, [record], at, 80)[1])
			.trim()
			.split(" ")[0];
	const start = 1_000_000 - (1_000_000 % (133 * 8));
	assert.deepEqual(
		Array.from({ length: 9 }, (_, i) => glyphAt(child({}), start + i * 133)),
		["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠋"],
	);
	assert.equal(glyphAt(child({}), start + 132), "⠋");
	for (const [state, glyph] of [
		["queued", "○"],
		["waiting", "?"],
		["completed", "✓"],
		["failed", "✗"],
		["cancelled", "–"],
		["timed out", "⧖"],
	]) {
		for (const at of [start, start + 133])
			assert.equal(glyphAt(child({ state, endedAt: at }), at), glyph);
	}
});

test("below 60 terminal columns a finished timed-out row keeps the words timed out beside ✗ and drops the model so its task stays visible, so it never reads as failed, and 60 columns or more keeps ⧖", (t) => {
	const finished = (state) =>
		child({ state, startedAt: now - 12_000, endedAt: now - 2_000 });
	const rows = (columns) =>
		["failed", "timed out"].map((state) =>
			stripVTControlCharacters(
				renderChildrenBox(theme, [finished(state)], now, columns)[1],
			),
		);
	const terminal = densityTerminal(t, 43);
	assert.deepEqual(rows(43), [
		" ✗ worker a1b2 Fix t... grok-4.7 (high) 10s",
		" ✗ timed out worker a1b2 Fix the fai... 10s",
	]);
	terminal.columns = 44;
	assert.deepEqual(rows(44), [
		" ✗ worker a1b2 Fix th... grok-4.7 (high) 10s",
		" ✗ timed out worker a1b2 Fix the fail... 10s",
	]);
	terminal.columns = 59;
	assert.deepEqual(rows(59), [
		" ✗ worker a1b2 Fix the failing test     grok-4.7 (high) 10s",
		` ✗ timed out worker a1b2 Fix the failing test${" ".repeat(11)}10s`,
	]);
	terminal.columns = 60;
	assert.deepEqual(rows(60), [
		" ✗ worker a1b2 Fix the failing test      grok-4.7 (high) 10s",
		" ⧖ worker a1b2 Fix the failing test      grok-4.7 (high) 10s",
	]);
	terminal.columns = 100;
	assert.deepEqual(rows(100), [
		` ✗ worker a1b2 Fix the failing test${" ".repeat(46)}grok-4.7 (high) 10s`,
		` ⧖ worker a1b2 Fix the failing test${" ".repeat(46)}grok-4.7 (high) 10s`,
	]);
});

test("below 60 terminal columns a timed-out row shows the shared ✗ in the error tone, and 60 columns or more keeps ⧖, across the boundary both ways", (t) => {
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
	};
	const at = now - (now % (133 * 8));
	const records = [
		child({ id: "run", role: "run", step: "step" }),
		child({ id: "ask", role: "ask", state: "waiting", step: "step" }),
		child({ id: "que", role: "que", state: "queued", step: "step" }),
		child({
			id: "don",
			role: "don",
			state: "completed",
			endedAt: at,
			step: "step",
		}),
		child({
			id: "bad",
			role: "bad",
			state: "failed",
			endedAt: at - 1,
			step: "step",
		}),
		child({
			id: "off",
			role: "off",
			state: "timed out",
			endedAt: at - 2,
			step: "step",
		}),
	];
	const glyphs = () =>
		renderChildrenBox(tagged, records, at, 200)
			.slice(1)
			.map((row) => row.split(" ")[1]);
	const narrow = [
		"<warning>?</warning>",
		"<accent>⠋</accent>",
		"<muted>○</muted>",
		"<success>✓</success>",
		"<error>✗</error>",
		"<error>✗</error>",
	];
	const wide = [...narrow.slice(0, 5), "<error>⧖</error>"];
	const terminal = densityTerminal(t, 44);
	assert.deepEqual(glyphs(), narrow);
	assert.match(
		renderChildrenBox(theme, records, at, 43)[0],
		/^▾ Subagents 1 waiting/,
	);
	terminal.columns = 60;
	assert.deepEqual(glyphs(), wide);
	terminal.columns = 59;
	assert.deepEqual(glyphs(), narrow);
	terminal.columns = 100;
	assert.deepEqual(glyphs(), wide);
	terminal.columns = 44;
	const cancelled = child({ state: "cancelled", endedAt: at });
	assert.equal(childGlyph(tagged, cancelled), "<muted>–</muted>");
	assert.equal(
		childGlyph(tagged, { ...cancelled, state: "timed out" }),
		"<error>✗</error>",
	);
});

test("a running child's glyph and spinner take the cyan theme var, while finished glyphs keep their tokens", () => {
	const workflow = loadThemeFromPath(
		new URL("../themes/pi-workflow.json", import.meta.url).pathname,
		"truecolor",
	);
	const cyan = "\x1b[38;2;125;207;255m";
	const [, row] = renderChildrenBox(workflow, [child({})], now, 80);
	assert.ok(row.includes(`${cyan}⠦`), row);
	assert.equal(childGlyph(workflow, child({})), `${cyan}◐\x1b[39m`);
	assert.equal(
		childGlyph(workflow, child({ state: "completed" })),
		workflow.fg("success", "✓"),
	);
	const tagged = { ...theme, fg: (color, text) => `<${color}>${text}` };
	assert.equal(childGlyph(tagged, child({})), "<accent>◐");
});
