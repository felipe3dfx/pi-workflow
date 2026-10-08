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
	const lines = renderTodoBox(fakeTheme(), [], { collapsed: false, showDone: true }, 80);
	assert.deepEqual(lines, []);
});

test("a collapsed box renders a single closed line and no task rows", () => {
	const tasks = [{ id: 1, text: "Review the doctor output", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: true, showDone: true }, 80);
	assert.equal(lines.length, 1);
	assert.doesNotMatch(lines[0], /Review the doctor output/);
});

test("an expanded box has margin above and below, and brackets outside the indented text column", () => {
	const tasks = [{ id: 1, text: "Review the doctor output", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
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
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
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
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	const glyphs = tasks.map((task) => lines.find((line) => line.includes(task.text)).slice(2, 3));
	assert.equal(glyphs[0], "□");
	assert.equal(glyphs[2], "✓");
	assert.equal(new Set(glyphs).size, 4);
});

test("hiding done tasks removes only done rows", () => {
	const tasks = [
		{ id: 1, text: "pending task", state: "pending" },
		{ id: 2, text: "finished task", state: "done" },
		{ id: 3, text: "working task", state: "in progress" },
		{ id: 4, text: "stuck task", state: "blocked" },
	];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: false }, 80);
	assert.ok(lines.some((line) => line.includes("pending task")));
	assert.ok(lines.some((line) => line.includes("working task")));
	assert.ok(lines.some((line) => line.includes("stuck task")));
	assert.ok(!lines.some((line) => line.includes("finished task")));
});

test("the close hint sits at the right edge, outside the text column", () => {
	const tasks = [{ id: 1, text: "x", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 40);
	const top = lines[1];
	assert.ok(top.endsWith("×"));
	assert.equal(top.length, 40);
});

test("every rendered line respects a narrow terminal width, even with a long task", () => {
	const longText = "x".repeat(200);
	const tasks = [{ id: 1, text: longText, state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 20);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 20, `line exceeds width 20: ${JSON.stringify(line)}`);
	}
});

test("a newline embedded in task text is normalised to a space instead of breaking the layout", () => {
	const tasks = [{ id: 1, text: "line one\nline two", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	const row = lines.find((line) => line.includes("line one"));
	assert.ok(row);
	assert.ok(row.includes("line two"));
	assert.equal(row.includes("\n"), false);
});

test("a CRLF embedded in task text is normalised, not just the LF", () => {
	const tasks = [{ id: 1, text: "line one\r\nline two", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	const row = lines.find((line) => line.includes("line one"));
	assert.ok(row);
	assert.ok(row.includes("line two"));
	assert.equal(row.includes("\r"), false);
	assert.equal(row.includes("\n"), false);
});

test("a CSI escape sequence in task text is neutralised before styling", () => {
	const tasks = [{ id: 1, text: "clear \x1b[2J the screen", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	for (const line of lines) {
		assert.equal(line.includes("\x1b"), false, `line contains ESC: ${JSON.stringify(line)}`);
	}
});

test("a right-to-left override character is blanked", () => {
	const tasks = [{ id: 1, text: "before ‮after", state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	for (const line of lines) {
		assert.equal(line.includes("‮"), false, `line contains U+202E: ${JSON.stringify(line)}`);
	}
});

test("a ZWJ family emoji keeps its full width instead of being stripped", () => {
	const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
	const tasks = [{ id: 1, text: family, state: "pending" }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	const row = lines.find((line) => line.includes("\u{1F468}"));
	assert.ok(row);
	assert.ok(row.includes(family));
});
