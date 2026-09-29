import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

import { createChromeEditor } from "../extensions/chrome-editor.ts";

const marked = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => text,
	bg: (_color, text) => text,
};
const bare = { fg: (_c, text) => text, bold: (t) => t, bg: (_c, t) => t };

const items = [
	{
		value: "execute-plan",
		label: "execute-plan",
		description: "<design-doc-path> [--effort N] — Run a plan",
	},
	{ value: "plain", label: "plain", description: "[user] No arguments here" },
	{ value: "skill:pdf", label: "skill:pdf", description: "[user] Make PDFs" },
];

async function editor(theme = marked) {
	const input = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{ theme: () => theme, label: () => "m" },
	);
	input.setAutocompleteProvider({
		getSuggestions: async () => ({ items, prefix: "/" }),
		applyCompletion: (lines, cursorLine, cursorCol) => ({
			lines,
			cursorLine,
			cursorCol,
		}),
	});
	await new Promise((resolve) => setImmediate(resolve));
	input.focused = true;
	return input;
}

const visible = (line) =>
	stripVTControlCharacters(line.replace(CURSOR_MARKER, ""));

const first = (input, width = 100) => input.render(width)[1];

test("a leading known slash command is colored with the heading token", async () => {
	const input = await editor();
	input.setText("/execute-plan doc.md");
	assert.match(first(input), /<mdHeading>\/execute-plan<\/mdHeading> doc\.md/);
	input.setText("/skill:pdf");
	assert.match(first(input), /<mdHeading>\/skill:pdf<\/mdHeading>/);
});

test("unknown commands and ordinary text are left untouched", async () => {
	const input = await editor();
	for (const text of ["/unknown ", "hello /execute-plan", "/", "plain text"]) {
		input.setText(text);
		assert.ok(!first(input).includes("mdHeading"), text);
		assert.ok(!first(input).includes("<muted>"), text);
	}
});

test("the argument hint shows after the command and its space, and disappears once arguments are typed", async () => {
	const input = await editor(bare);
	input.setText("/execute-plan ");
	assert.match(
		visible(first(input)),
		/\/execute-plan <design-doc-path> \[--effort N\]/,
	);
	input.setText("/execute-plan d");
	assert.ok(!visible(first(input)).includes("<design-doc-path>"));
	input.setText("/plain ");
	assert.ok(!visible(first(input)).includes("No arguments"));
});

test("the ghost hint is dim, keeps the text and cursor, and leaves the cursor marker in place", async () => {
	const input = await editor();
	input.setText("/execute-plan ");
	const line = first(input, 200);
	assert.match(line, /<muted>design-doc-path> \[--effort N\]<\/muted>/);
	assert.equal(input.getText(), "/execute-plan ");
	assert.deepEqual(input.getCursor(), { line: 0, col: 14 });
	assert.equal(line.split(CURSOR_MARKER).length, 2);
	assert.ok(line.indexOf(CURSOR_MARKER) < line.indexOf("<muted>"));
	const before = visible(line.slice(0, line.indexOf(CURSOR_MARKER))).replace(
		/<\/?\w+>/g,
		"",
	);
	assert.ok(before.endsWith("/execute-plan "));
});

test("no line exceeds the width at any width", async () => {
	const input = await editor(bare);
	for (const text of [
		"/execute-plan ",
		"/execute-plan",
		"/skill:pdf ",
		"hello",
	]) {
		input.setText(text);
		for (let width = 12; width <= 160; width++) {
			for (const line of input.render(width)) {
				assert.ok(visibleWidth(line) <= width, `${text} @ ${width}`);
			}
		}
	}
});

test("a slower earlier provider cannot overwrite the commands of the newer one", async () => {
	const input = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{ theme: () => marked, label: () => "m" },
	);
	const provide = (resolveWith) => ({
		getSuggestions: () => resolveWith,
		applyCompletion: (lines, cursorLine, cursorCol) => ({
			lines,
			cursorLine,
			cursorCol,
		}),
	});
	let releaseOld;
	const old = new Promise((resolve) => {
		releaseOld = resolve;
	});
	input.setAutocompleteProvider(provide(old));
	input.setAutocompleteProvider(
		provide(
			Promise.resolve({
				items: [{ value: "fresh", label: "fresh", description: "[user] New" }],
				prefix: "/",
			}),
		),
	);
	await new Promise((resolve) => setImmediate(resolve));
	releaseOld({
		items: [{ value: "stale", label: "stale", description: "[user] Old" }],
		prefix: "/",
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual([...input.commands.keys()], ["fresh"]);
});

test("the selected autocomplete row bolds a whole value that contains a single space", async () => {
	const input = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{ theme: () => marked, label: () => "m" },
	);
	const selected = input.theme.selectList.selectedText(
		"→ two words   A description",
	);
	assert.equal(
		selected,
		"<text>❯ two words</text>   <dim>A description</dim>",
	);
});

test("the frame uses the border token regardless of the thinking-level borderColor", async () => {
	const input = await editor();
	input.borderColor = (text) => `<thinkingHigh>${text}</thinkingHigh>`;
	input.focused = false;
	const lines = input.render(40);
	assert.match(lines[0], /^ ?<border>╭/);
	assert.match(lines[1], /<border>│<\/border>/);
	assert.doesNotMatch(lines.join(""), /thinking/);
});

test("bash mode paints the frame with the accent token", async () => {
	const input = await editor();
	input.setText("!ls");
	assert.match(input.render(40)[1], /<accent>│<\/accent>/);
});

test("the frame is brighter while the editor has focus", async () => {
	const input = await editor();
	input.focused = true;
	assert.match(input.render(40)[1], /<borderAccent>│<\/borderAccent>/);
	input.focused = false;
	assert.match(input.render(40)[1], /<border>│<\/border>/);
});

test("typed text carries the text token, including after the cursor", async () => {
	const input = await editor();
	input.setText("hello world");
	const line = first(input);
	assert.match(line, /<text>hello world/);
	input.handleInput("\x1b[D");
	input.handleInput("\x1b[D");
	const moved = first(input);
	assert.equal(moved.split(CURSOR_MARKER).length, 2);
	const tail = moved.slice(moved.indexOf(CURSOR_MARKER));
	assert.ok(tail.includes("\x1b[0m<text>d"));
});

test("the slash token keeps its own color inside the text color", async () => {
	const input = await editor();
	input.setText("/execute-plan doc.md");
	const line = first(input);
	assert.match(line, /<text><mdHeading>\/execute-plan<\/mdHeading> doc\.md/);
	assert.equal(line.split(CURSOR_MARKER).length, 2);
});
