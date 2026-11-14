import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import { renderTodoBox } from "../extensions/todo-header.ts";

function fakeTheme() {
	return {
		fg: (_color, text) => text,
		bold: (text) => text,
	};
}

test("an empty task list omits the box entirely", () => {
	const lines = renderTodoBox(
		fakeTheme(),
		[],
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	assert.deepEqual(lines, []);
});

test("a collapsed box renders a single closed line and no task rows", () => {
	const tasks = [{ id: 1, text: "Review the doctor output", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: true, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	assert.equal(lines.length, 1);
	assert.doesNotMatch(lines[0], /Review the doctor output/);
});

test("an expanded box has margin above and below, and brackets outside the indented text column", () => {
	const tasks = [{ id: 1, text: "Review the doctor output", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	assert.equal(lines[0], "");
	assert.equal(lines[lines.length - 1], "");
	const top = lines[1];
	const row = lines[2];
	assert.ok(top.startsWith("┌"));
	assert.ok(row.startsWith("│ "));
	assert.ok(row.endsWith("│"));
	assert.equal(row.indexOf("┌"), -1);
	assert.ok(lines[lines.length - 2].startsWith("└"));
	assert.ok(lines[lines.length - 2].endsWith("┘"));
});

test("a pending row and a done row render distinctly, with a green check on the done row", () => {
	const tasks = [
		{ id: 1, text: "pending task", state: "pending" },
		{ id: 2, text: "finished task", state: "done" },
	];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	const pendingRow = lines.find((line) => line.includes("pending task"));
	const doneRow = lines.find((line) => line.includes("finished task"));
	assert.ok(pendingRow);
	assert.ok(doneRow);
	assert.match(doneRow, /✓/);
	assert.notEqual(pendingRow, doneRow.replace("finished task", "pending task"));
});

test("each Task state renders its own glyph, keeping the pending box and the done check", () => {
	const tasks = [
		{ id: 1, text: "pending task", state: "pending" },
		{ id: 2, text: "working task", state: "in progress" },
		{ id: 3, text: "finished task", state: "done" },
		{ id: 4, text: "stuck task", state: "blocked" },
	];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	const row = (text) => lines.find((line) => line.includes(text));
	assert.ok(row("pending task").includes("□ pending task"));
	assert.ok(row("working task").includes("◐ working task"));
	assert.ok(row("finished task").includes("✓ finished task"));
	assert.ok(row("stuck task").includes("! stuck task"));
});

test("hiding done tasks removes only done rows", () => {
	const tasks = [
		{ id: 1, text: "pending task", state: "pending" },
		{ id: 2, text: "finished task", state: "done" },
		{ id: 3, text: "working task", state: "in progress" },
		{ id: 4, text: "stuck task", state: "blocked" },
	];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: false },
		80,
		new Map(),
		99,
		1,
	).lines;
	assert.ok(lines.some((line) => line.includes("pending task")));
	assert.ok(lines.some((line) => line.includes("working task")));
	assert.ok(lines.some((line) => line.includes("stuck task")));
	assert.ok(!lines.some((line) => line.includes("finished task")));
});

test("the close hint sits at the right edge, outside the text column", () => {
	const tasks = [{ id: 1, text: "x", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		40,
		new Map(),
		99,
		1,
	).lines;
	const top = lines[1];
	assert.ok(top.endsWith("×"));
	assert.equal(top.length, 40);
});

test("every rendered line respects a narrow terminal width, even with a long task", () => {
	const longText = "x".repeat(200);
	const tasks = [{ id: 1, text: longText, state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		20,
		new Map(),
		99,
		1,
	).lines;
	for (const line of lines) {
		assert.ok(
			visibleWidth(line) <= 20,
			`line exceeds width 20: ${JSON.stringify(line)}`,
		);
	}
});

test("a newline embedded in task text is normalised to a space instead of breaking the layout", () => {
	const tasks = [{ id: 1, text: "line one\nline two", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	const row = lines.find((line) => line.includes("line one"));
	assert.ok(row);
	assert.ok(row.includes("line two"));
	assert.equal(row.includes("\n"), false);
});

test("a CRLF embedded in task text is normalised, not just the LF", () => {
	const tasks = [{ id: 1, text: "line one\r\nline two", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	const row = lines.find((line) => line.includes("line one"));
	assert.ok(row);
	assert.ok(row.includes("line two"));
	assert.equal(row.includes("\r"), false);
	assert.equal(row.includes("\n"), false);
});

test("a CSI escape sequence in task text is neutralised before styling", () => {
	const tasks = [{ id: 1, text: "clear \x1b[2J the screen", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	for (const line of lines) {
		assert.equal(
			line.includes("\x1b"),
			false,
			`line contains ESC: ${JSON.stringify(line)}`,
		);
	}
});

test("a right-to-left override character is blanked", () => {
	const tasks = [{ id: 1, text: "before ‮after", state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	for (const line of lines) {
		assert.equal(
			line.includes("‮"),
			false,
			`line contains U+202E: ${JSON.stringify(line)}`,
		);
	}
});

test("a ZWJ family emoji keeps its full width instead of being stripped", () => {
	const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
	const tasks = [{ id: 1, text: family, state: "pending" }];
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		99,
		1,
	).lines;
	const row = lines.find((line) => line.includes("\u{1F468}"));
	assert.ok(row);
	assert.ok(row.includes(family));
});

test("an in progress task linked to a working child shows the child's role and short id", () => {
	const tasks = [
		{ id: 1, text: "Fix the parser", state: "in progress" },
		{ id: 2, text: "Review the parser", state: "pending" },
		{ id: 3, text: "Write the notes", state: "in progress" },
	];
	const executors = new Map([
		[1, { role: "worker", id: "a1b2c3d4-0000-0000-0000-000000000000" }],
		[2, { role: "verify", id: "e5f6a7b8-0000-0000-0000-000000000000" }],
	]);
	const lines = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		executors,
		99,
		1,
	).lines;
	const row = (text) => lines.find((line) => line.includes(text));
	assert.match(row("Fix the parser"), /◐ Fix the parser ← worker a1b2 +│$/);
	assert.doesNotMatch(row("Review the parser"), /←/);
	assert.doesNotMatch(row("Write the notes"), /←/);
});

test("height budget reserves five rows and caps a page at eight tasks", () => {
	const tasks = Array.from({ length: 12 }, (_, i) => ({
		id: i + 1,
		text: `task ${i + 1}`,
		state: "pending",
	}));
	const layout = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		18,
		1,
	);
	assert.equal(layout.capacity, 1);
	assert.equal(layout.lines.length, 6);
	assert.ok(layout.lines.some((line) => line.includes("task 1")));
	assert.ok(!layout.lines.some((line) => line.includes("task 2")));
	const tall = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		new Map(),
		39,
		2,
	);
	assert.equal(tall.capacity, 8);
	assert.equal(tall.page, 2);
	assert.ok(tall.lines.some((line) => line.includes("task 9")));
	assert.ok(!tall.lines.some((line) => line.includes("task 1│")));
});

test("narrow controls do not displace a higher priority page position", () => {
	const tasks = Array.from({ length: 12 }, (_, i) => ({
		id: i + 1,
		text: `task ${i + 1}`,
		state: "pending",
	}));
	const layout = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		11,
		new Map(),
		18,
		1,
	);
	assert.deepEqual(
		layout.targets.filter((target) => target.row !== 1),
		[],
	);
});

test("compact summary shows keyboard hints when they fit and stays within narrow widths", () => {
	const tasks = [
		{ id: 1, text: "work", state: "pending" },
		{ id: 2, text: "done", state: "done" },
	];
	const state = { collapsed: false, showDone: false };
	const wide = renderTodoBox(
		fakeTheme(),
		tasks,
		state,
		80,
		new Map(),
		17,
		1,
	).lines;
	assert.equal(wide.length, 1);
	assert.match(wide[0], /1\/2 Without done/);
	assert.match(wide[0], /Alt\+Shift\+T\/H\/P\/N/);
	const narrow = renderTodoBox(
		fakeTheme(),
		tasks,
		state,
		12,
		new Map(),
		17,
		1,
	).lines;
	assert.equal(narrow.length, 1);
	assert.ok(visibleWidth(narrow[0]) <= 12);
});

test("extreme heights, manual collapse and compact preserve the requested page", () => {
	const tasks = [{ id: 1, text: "work", state: "pending" }];
	const state = { collapsed: false, showDone: false };
	for (const rows of [1, 2]) {
		const layout = renderTodoBox(
			fakeTheme(),
			tasks,
			state,
			80,
			new Map(),
			rows,
			7,
		);
		assert.deepEqual(layout.lines, []);
		assert.equal(layout.page, 7);
	}
	for (const rows of [3, 17]) {
		const layout = renderTodoBox(
			fakeTheme(),
			tasks,
			state,
			80,
			new Map(),
			rows,
			7,
		);
		assert.equal(layout.capacity, 0);
		assert.equal(layout.lines.length, 1);
		assert.match(layout.lines[0], /1\/1 Without done/);
		assert.equal(layout.page, 7);
		assert.equal(layout.pageCount, null);
		assert.deepEqual(layout.targets, []);
	}
	const collapsed = renderTodoBox(
		fakeTheme(),
		tasks,
		{ ...state, collapsed: true },
		12,
		new Map(),
		3,
		7,
	);
	assert.equal(collapsed.page, 7);
	assert.deepEqual(collapsed.targets, [
		{ action: "expand", row: 0, start: 0, end: 12 },
	]);
	const expanded = renderTodoBox(
		fakeTheme(),
		tasks,
		state,
		80,
		new Map(),
		18,
		collapsed.page,
	);
	assert.equal(expanded.page, 1);
	assert.equal(expanded.pageCount, 1);
});

test("threshold is unfiltered and empty filtered results retain reversible controls without a message row", () => {
	const tasks = Array.from({ length: 8 }, (_, i) => ({
		id: i + 1,
		text: `done ${i + 1}`,
		state: "done",
	}));
	const state = { collapsed: false, showDone: false };
	const below = renderTodoBox(
		fakeTheme(),
		tasks.slice(0, 7),
		state,
		80,
		new Map(),
		39,
		1,
	);
	assert.equal(below.capacity, 8);
	assert.equal(below.lines.length, 4);
	assert.ok(!below.targets.some((target) => target.action === "filter"));
	const at = renderTodoBox(fakeTheme(), tasks, state, 80, new Map(), 39, 6);
	assert.equal(at.page, 1);
	assert.equal(at.pageCount, 1);
	assert.equal(at.lines.length, 5);
	assert.match(at.lines[2], /0\/8 Without done/);
	assert.ok(at.targets.some((target) => target.action === "filter"));
	const above = renderTodoBox(
		fakeTheme(),
		[...tasks, { id: 9, text: "pending", state: "pending" }],
		state,
		80,
		new Map(),
		38,
		1,
	);
	assert.equal(above.capacity, 7);
	assert.ok(above.lines.some((line) => line.includes("pending")));
});

test("logical targets identify only rendered cells, with sanitized Unicode task and executor text", () => {
	const tasks = Array.from({ length: 9 }, (_, i) => ({
		id: i + 1,
		text: `界👨‍👩‍👧‍👦\u001b[2J task ${i}`,
		state: i === 0 ? "in progress" : "pending",
	}));
	const executors = new Map([[1, { role: "work\u001b[2Jer", id: "ab\ncd" }]]);
	for (const width of [0, 1, 2, 11, 22, 80]) {
		const layout = renderTodoBox(
			fakeTheme(),
			tasks,
			{ collapsed: false, showDone: true },
			width,
			executors,
			39,
			1,
		);
		for (const line of layout.lines) {
			assert.ok(visibleWidth(line) <= width);
			assert.ok(!line.includes("\u001b[2J"));
			assert.ok(!line.includes("\n"));
		}
		for (const target of layout.targets) {
			assert.ok(target.start >= 0 && target.end > target.start);
			assert.ok(target.end <= visibleWidth(layout.lines[target.row]));
		}
		const close = layout.targets.find((target) => target.action === "collapse");
		assert.equal(Boolean(close), width >= 2);
		if (close) assert.equal(layout.lines[1].at(-1), "×");
	}
	const wide = renderTodoBox(
		fakeTheme(),
		tasks,
		{ collapsed: false, showDone: true },
		80,
		executors,
		39,
		1,
	);
	for (const [action, label] of [
		["previous", "‹"],
		["next", "›"],
		["filter", "Without done"],
	]) {
		const target = wide.targets.find((item) => item.action === action);
		assert.ok(target);
		assert.equal(wide.lines[target.row].slice(target.start, target.end), label);
	}
});

test("compact defers clamping until expansion, and the returned clamp persists on enlargement", () => {
	const tasks = Array.from({ length: 12 }, (_, i) => ({
		id: i + 1,
		text: `task ${i + 1}`,
		state: "pending",
	}));
	const state = { collapsed: false, showDone: true };
	const initial = renderTodoBox(
		fakeTheme(),
		tasks,
		state,
		80,
		new Map(),
		18,
		7,
	);
	assert.equal(initial.page, 7);
	const compact = renderTodoBox(
		fakeTheme(),
		tasks.slice(0, 3),
		state,
		80,
		new Map(),
		17,
		initial.page,
	);
	assert.equal(compact.page, 7);
	const expanded = renderTodoBox(
		fakeTheme(),
		tasks.slice(0, 3),
		state,
		80,
		new Map(),
		18,
		compact.page,
	);
	assert.equal(expanded.page, 3);
	assert.ok(expanded.lines.some((line) => line.includes("task 3")));
	const larger = renderTodoBox(
		fakeTheme(),
		tasks,
		state,
		80,
		new Map(),
		39,
		expanded.page,
	);
	assert.equal(larger.page, 2);
	const restored = renderTodoBox(
		fakeTheme(),
		tasks,
		state,
		80,
		new Map(),
		18,
		larger.page,
	);
	assert.equal(restored.page, 2);
});
