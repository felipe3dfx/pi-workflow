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
	const tasks = [{ id: 1, text: "Review the doctor output", done: false }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: true, showDone: true }, 80);
	assert.equal(lines.length, 1);
	assert.doesNotMatch(lines[0], /Review the doctor output/);
});

test("an expanded box has margin above and below, and brackets outside the indented text column", () => {
	const tasks = [{ id: 1, text: "Review the doctor output", done: false }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	assert.equal(lines[0], "");
	assert.equal(lines[lines.length - 1], "");
	const top = lines[1];
	const row = lines[2];
	assert.ok(top.startsWith("┌"));
	assert.ok(row.startsWith("  "));
	assert.equal(row.indexOf("┌"), -1);
});

test("a pending row and a done row render distinctly, with a green check on the done row", () => {
	const tasks = [
		{ id: 1, text: "pending task", done: false },
		{ id: 2, text: "finished task", done: true },
	];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	const pendingRow = lines.find((line) => line.includes("pending task"));
	const doneRow = lines.find((line) => line.includes("finished task"));
	assert.ok(pendingRow);
	assert.ok(doneRow);
	assert.match(doneRow, /✓/);
	assert.notEqual(pendingRow, doneRow.replace("finished task", "pending task"));
});

test("hiding done tasks removes done rows but keeps pending rows", () => {
	const tasks = [
		{ id: 1, text: "pending task", done: false },
		{ id: 2, text: "finished task", done: true },
	];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: false }, 80);
	assert.ok(lines.some((line) => line.includes("pending task")));
	assert.ok(!lines.some((line) => line.includes("finished task")));
});

test("the close hint sits at the right edge, outside the text column", () => {
	const tasks = [{ id: 1, text: "x", done: false }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 40);
	const top = lines[1];
	assert.ok(top.endsWith("×"));
	assert.equal(top.length, 40);
});

test("every rendered line respects a narrow terminal width, even with a long task", () => {
	const longText = "x".repeat(200);
	const tasks = [{ id: 1, text: longText, done: false }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 20);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 20, `line exceeds width 20: ${JSON.stringify(line)}`);
	}
});

test("a newline embedded in task text is normalised to a space instead of breaking the layout", () => {
	const tasks = [{ id: 1, text: "line one\nline two", done: false }];
	const lines = renderTodoBox(fakeTheme(), tasks, { collapsed: false, showDone: true }, 80);
	const row = lines.find((line) => line.includes("line one"));
	assert.ok(row);
	assert.ok(row.includes("line two"));
	assert.equal(row.includes("\n"), false);
});
