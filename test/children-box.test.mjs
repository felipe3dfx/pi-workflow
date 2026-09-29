import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { visibleWidth } from "@earendil-works/pi-tui";

import { renderChildrenBox } from "../extensions/children-box.ts";

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

test("the box reads Subagents with the count, and each row shows the state, name, step, model, effort, and elapsed time", () => {
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
	assert.match(lines[0], /▾ Subagents 2 +alt\+a view/);
	assert.match(
		lines[1],
		/\? explore c3d4 asks question 1 +grok-4\.7 \(low\) 1m 02s/,
	);
	assert.match(lines[2], /◐ worker a1b2 bash npm test +grok-4\.7 \(high\) 12s/);
	assert.equal(lines.length, 3);
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
	assert.match(lines[3], /◐ explore e5f6 Fix/);
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
		["◐", "✓", "✗", "–"],
	);
	assert.match(lines[0], /Subagents 4/);
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
	assert.match(lines[0], /Subagents 11/);
	assert.equal(lines.length, 10);
	assert.match(lines[1], /\? w /);
	assert.match(lines[2], /◐ r0 /);
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
	assert.match(row, /<accent>◐<\/accent> <accent>worker<\/accent> a1b2 /);
});

test("the heading is a dim chevron, a bold muted title, and a dim count", () => {
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
		bold: (text) => `<b>${text}</b>`,
	};
	const [heading] = renderChildrenBox(tagged, [child({})], now, 80);
	assert.match(heading, /^<dim>▾<\/dim> <b><muted>Subagents<\/muted><\/b> <dim>1<\/dim> +<dim>alt\+a view<\/dim>$/);
});
