import test from "node:test";
import assert from "node:assert/strict";

import {
	CURSOR_MARKER,
	renderFakeCursor,
	stripTerminalSequences,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { modelLabel } from "../extensions/chrome.ts";
import { createChromeEditor } from "../extensions/chrome-editor.ts";
import { densityTerminal } from "./support/density-terminal.mjs";

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

const visible = (line) => stripTerminalSequences(line);

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
	assert.equal(selected, "<text>❯ two words</text>   <dim>A description</dim>");
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
	assert.ok(
		moved.includes(`<text>hello wor${CURSOR_MARKER}${renderFakeCursor("l")}d`),
	);
});

test("the slash token keeps its own color inside the text color", async () => {
	const input = await editor();
	input.setText("/execute-plan doc.md");
	const line = first(input);
	assert.match(line, /<text><mdHeading>\/execute-plan<\/mdHeading> doc\.md/);
	assert.equal(line.split(CURSOR_MARKER).length, 2);
});

function opus(theme = bare) {
	return createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{
			theme: () => theme,
			label: () =>
				modelLabel(
					{
						model: { id: "claude-opus-5-5", reasoning: true },
						thinkingLevel: "high",
					},
					theme,
				),
		},
	);
}

test("below 60 terminal columns the editor touches the edge, with the short placeholder and the model and level caption", (t) => {
	densityTerminal(t, 44);
	assert.deepEqual(opus().render(44).map(visible), [
		`╭${"─".repeat(42)}╮`,
		`│ ❯  What should we build?${" ".repeat(17)}│`,
		`╰${"─".repeat(24)} opus-5-5 · high ─╯`,
	]);
});

test("below 60 terminal columns the caption drops a leading claude- and a provider prefix, and keeps other ids whole", (t) => {
	densityTerminal(t, 44);
	const label = (id, reasoning = true) =>
		modelLabel({ model: { id, reasoning }, thinkingLevel: "high" }, marked);
	assert.equal(
		label("claude-opus-5-5"),
		"<thinkingHigh>opus-5-5</thinkingHigh><dim> · high</dim>",
	);
	assert.equal(
		label("gpt-6-astra"),
		"<thinkingHigh>gpt-6-astra</thinkingHigh><dim> · high</dim>",
	);
	assert.equal(
		label("openrouter/claude-sonnet-5-5"),
		"<thinkingHigh>sonnet-5-5</thinkingHigh><dim> · high</dim>",
	);
	assert.equal(label("claude-haiku-5-5", false), "<dim>haiku-5-5</dim>");
});

test("below 60 terminal columns a click on a typed character lands on that character with no margin", (t) => {
	densityTerminal(t, 44);
	const input = opus();
	input.setText("hello world");
	const [, row] = input.render(44).map(visible);
	assert.equal(row.slice(0, 11), "│ ❯ hello w");
	input.handleMouse({
		type: "click",
		button: "left",
		x: 7,
		y: 1,
		width: 44,
		height: 3,
	});
	assert.deepEqual(input.getCursor(), { line: 0, col: 3 });
});

test("crossing 60 terminal columns in both directions keeps the typed text and cursor while the margin follows the terminal", (t) => {
	const terminal = densityTerminal(t, 59);
	const input = opus();
	input.setText("hello world");
	input.handleInput("\x1b[D");
	const top = (columns) => {
		terminal.columns = columns;
		return input.render(columns).map(visible)[0];
	};
	assert.equal(top(59), `╭${"─".repeat(57)}╮`);
	assert.equal(top(60), ` ╭${"─".repeat(56)}╮`);
	assert.equal(top(59), `╭${"─".repeat(57)}╮`);
	assert.equal(input.getText(), "hello world");
	assert.deepEqual(input.getCursor(), { line: 0, col: 10 });
});

test("command names in the autocomplete rows get a slash prefix, and other completions do not", async () => {
	const input = await editor(bare);
	const rows = ["  plain   [user] desc", "❯ skill:pdf   Make PDFs"];
	input.setText("/p");
	const shown = input.renderMenu(rows, 40, bare).map(visible);
	assert.match(shown[1], /^ {2} {2}\/plain {3}/);
	assert.match(shown[2], /^ {2}❯ \/skill:pdf/);
	input.setText("@src");
	const files = input.renderMenu(rows, 40, bare).map(visible);
	assert.doesNotMatch(files.join(""), /\//);
});
