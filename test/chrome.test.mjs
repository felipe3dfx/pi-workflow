import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { visibleWidth } from "@earendil-works/pi-tui";

import {
	createFooterHints,
	footerHints,
	formatContextTokens,
	formatDuration,
	formatOutputTokens,
	modelLabel,
	renderFooter,
	renderHeader,
	registerChrome,
	renderStatusRow,
	shortenPath,
} from "../extensions/chrome.ts";
import {
	createChromeEditor,
	PLACEHOLDER,
} from "../extensions/chrome-editor.ts";

const theme = {
	fg: (_color, text) => text,
	bold: (text) => text,
	bg: (_color, text) => text,
};

const plain = (lines) => lines.map((line) => stripVTControlCharacters(line));

const header = {
	branch: "main",
	cwd: "/home/ana/Documents/repos/pi-workflow",
	home: "/home/ana",
	working: 2,
	usage: { tokens: 34_000, contextWindow: 256_000 },
};

test("the cwd keeps its last two segments whole and shortens each parent to its first letter", () => {
	assert.equal(shortenPath(header.cwd, header.home), "~/D/repos/pi-workflow");
	assert.equal(
		shortenPath("/home/ana/.config/pi/agent", "/home/ana"),
		"~/.c/pi/agent",
	);
	assert.equal(shortenPath("/var/lib/data/app", "/home/ana"), "/v/l/data/app");
	assert.equal(shortenPath("/home/ana", "/home/ana"), "~");
	assert.equal(shortenPath("/home/ana/repo", "/home/ana"), "~/repo");
	assert.equal(shortenPath("/home/ana/re\x1bpo", "/home/ana"), "~/re po");
});

test("the header shows the branch and cwd on the left and the working children and context usage on the right", () => {
	assert.deepEqual(plain(renderHeader(theme, header, 60)), [
		` main ~/D/repos/pi-workflow${" ".repeat(16)}◆ 2 │ 34K / 256K`,
	]);
	assert.deepEqual(plain(renderHeader(theme, { ...header, working: 0 }, 40)), [
		` main ~/D/repos/pi-workflow${" ".repeat(2)}34K / 256K`,
	]);
	assert.deepEqual(
		plain(
			renderHeader(
				theme,
				{ ...header, working: 0, usage: { tokens: null, contextWindow: 1 } },
				40,
			),
		),
		[" main ~/D/repos/pi-workflow"],
	);
});

test("on a narrow terminal the header truncates the location first and never overflows", () => {
	for (const width of [30, 20, 12, 5, 1]) {
		const [line] = renderHeader(theme, header, width);
		assert.ok(visibleWidth(line) <= width, `width ${width}`);
	}
	assert.match(plain(renderHeader(theme, header, 30))[0], /◆ 2 │ 34K \/ 256K$/);
});

test("token counts and durations use the compact formats", () => {
	assert.deepEqual(
		[999, 3_000, 34_567, 256_000, 1_000_000, 12_000_000].map(
			formatContextTokens,
		),
		["999", "3.0K", "34K", "256K", "1.0M", "12M"],
	);
	assert.deepEqual(
		[420, 2_960, 34_000, 340_000, 1_200_000].map(formatOutputTokens),
		["420", "2.96k", "34.0k", "340k", "1.20m"],
	);
	assert.deepEqual([3_640, 44_000, 128_000, 3_720_000].map(formatDuration), [
		"3.6s",
		"44s",
		"2m8s",
		"1h2m",
	]);
});

test("the status row shows the spinner, activity, and step time on the left and the turn time and output tokens on the right", () => {
	const data = {
		frame: 0,
		label: "Waiting for response…",
		stepMs: 3_600,
		turnMs: 3_700,
		outputTokens: 2_960,
	};
	const [line] = plain(renderStatusRow(theme, data, 70));
	assert.equal(
		line,
		`  ⠋ Waiting for response… 3.6s${" ".repeat(28)}3.7s ⇣2.96k`,
	);
	assert.equal(visibleWidth(line), 69);
	assert.doesNotMatch(plain(renderStatusRow(theme, data, 50))[0], /3\.6s/);
	assert.match(
		plain(renderStatusRow(theme, { ...data, tool: "bash" }, 70))[0],
		/^ {2}⠋ Run bash 3\.6s/,
	);
	assert.deepEqual(
		plain(
			renderStatusRow(
				theme,
				{
					frame: 1,
					waiting: true,
					label: "Subagent: worker a1b2…",
					stepMs: 2_100,
				},
				70,
			),
		),
		["  : Subagent: worker a1b2… 2.1s"],
	);
	for (const width of [20, 8, 1]) {
		assert.ok(visibleWidth(renderStatusRow(theme, data, width)[0]) <= width);
	}
});

const keys = {
	"app.thinking.cycle": "shift+tab",
	"app.model.cycleForward": "ctrl+p",
	"app.tools.expand": "ctrl+o",
	"app.clear": "ctrl+c",
	"app.interrupt": "escape",
	"tui.input.submit": "enter",
	"app.message.followUp": "alt+enter/ctrl+q",
};
const resolve = (binding) => keys[binding] ?? "";

test("the footer shows Pi's real keys for the idle and working contexts, and the question panel can replace them", () => {
	assert.deepEqual(
		plain(renderFooter(theme, footerHints(false, undefined, resolve), 100)),
		[" Shift+Tab:thinking  │  Ctrl+p:model  │  Ctrl+o:expand  │  Ctrl+c:clear"],
	);
	assert.deepEqual(
		plain(renderFooter(theme, footerHints(true, undefined, resolve), 100)),
		[
			" Esc:interrupt  │  Enter:steer  │  Alt+Enter:follow-up  │  Ctrl+o:expand",
		],
	);
	const unbound = footerHints(false, undefined, (binding) =>
		binding === "app.model.cycleForward" ? "" : resolve(binding),
	);
	assert.ok(!unbound.some((hint) => hint.action === "model"));
	const panel = [
		{ key: "↑/↓", action: "select" },
		{ key: "Tab", action: "next option" },
		{ key: "Esc", action: "cancel" },
	];
	assert.deepEqual(
		plain(renderFooter(theme, footerHints(true, panel, resolve), 100)),
		[" ↑/↓:select  │  Tab:next option  │  Esc:cancel"],
	);
});

test("the footer drops the hints that do not fit instead of cutting one in half", () => {
	const hints = footerHints(false, undefined, resolve);
	assert.deepEqual(plain(renderFooter(theme, hints, 37)), [
		" Shift+Tab:thinking  │  Ctrl+p:model",
	]);
	assert.deepEqual(plain(renderFooter(theme, hints, 5)), [""]);
});

test("the shared hint state notifies only when the panel hints change", () => {
	const hints = createFooterHints();
	let calls = 0;
	const off = hints.subscribe(() => calls++);
	hints.set([{ key: "Esc", action: "cancel" }]);
	hints.set([{ key: "Esc", action: "cancel" }]);
	assert.deepEqual(hints.get(), [{ key: "Esc", action: "cancel" }]);
	hints.set(undefined);
	off();
	hints.set([{ key: "Tab", action: "next" }]);
	assert.equal(calls, 2);
});

const tagged = { ...theme, fg: (color, text) => `<${color}>${text}</>` };

test("the model label colors the name by thinking level and dims the suffix, only for reasoning models", () => {
	const levels = {
		off: "thinkingOff",
		minimal: "thinkingMinimal",
		low: "thinkingLow",
		medium: "thinkingMedium",
		high: "thinkingHigh",
		xhigh: "thinkingXhigh",
		max: "thinkingMax",
	};
	for (const [level, token] of Object.entries(levels)) {
		assert.equal(
			modelLabel(
				{ model: { id: "grok-4.7", reasoning: true }, thinkingLevel: level },
				tagged,
			),
			`<${token}>grok-4.7</><dim> (${level})</>`,
		);
	}
	assert.equal(
		modelLabel(
			{ model: { id: "gpt-4o", reasoning: false }, thinkingLevel: "low" },
			tagged,
		),
		"<dim>gpt-4o</>",
	);
	assert.equal(modelLabel({ model: undefined }, tagged), "");
});

function editor(label = "grok-4.7 (low)", rows = 40) {
	return createChromeEditor(
		{ terminal: { rows }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{ theme: () => theme, label: () => label },
	);
}

test("the editor draws a rounded box with the prompt, a placeholder when empty, and the model in the bottom border", () => {
	const input = editor();
	assert.deepEqual(plain(input.render(40)), [
		` ╭${"─".repeat(36)}╮`,
		` │ ❯  ${PLACEHOLDER}${" ".repeat(32 - PLACEHOLDER.length)}│`,
		` ╰${"─".repeat(19)} grok-4.7 (low) ─╯`,
	]);
	input.setText("hello\nworld");
	const lines = plain(input.render(40));
	assert.equal(lines[1], ` │ ❯ hello${" ".repeat(28)}│`);
	assert.match(lines[2], /^ │ {3}world {1,}│$/);
	assert.ok(!lines.join("").includes(PLACEHOLDER));
	for (const line of input.render(40)) assert.equal(visibleWidth(line), 39);
});

test("the editor truncates the label on narrow widths, falls back to Pi's rules when tiny, and shows hidden line counts", () => {
	const narrow = plain(editor().render(14));
	assert.equal(narrow[2], "╰─ grok-4...─╯");
	const ansi = {
		...theme,
		fg: (color, text) => `\x1b[${color === "dim" ? 2 : 31}m${text}\x1b[0m`,
	};
	const styled = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{
			theme: () => theme,
			label: () =>
				modelLabel(
					{ model: { id: "grok-4.7", reasoning: true }, thinkingLevel: "low" },
					ansi,
				),
		},
	);
	assert.equal(plain(styled.render(14))[2], "╰─ grok-4...─╯");
	assert.ok(styled.render(14)[2].includes("\x1b[31mgrok-4"));
	assert.equal(
		plain(styled.render(40))[2],
		` ╰${"─".repeat(19)} grok-4.7 (low) ─╯`,
	);
	for (const width of [9, 14, 24, 40])
		for (const line of styled.render(width))
			assert.ok(visibleWidth(line) <= width);
	assert.equal(plain(editor().render(8))[0], "─".repeat(8));
	const tall = editor("m", 10);
	tall.setText(Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"));
	const lines = plain(tall.render(40));
	assert.match(lines[0], /^ ╭─ ↑ 7 more ─+╮$/);
	assert.equal(lines.length, 7);
});

test("a click in the box moves the cursor to the column under the pointer", () => {
	const input = editor();
	input.setText("hello world");
	input.render(40);
	input.handleMouse({
		type: "click",
		button: "left",
		x: 8,
		y: 1,
		width: 40,
		height: 3,
	});
	assert.deepEqual(input.getCursor(), { line: 0, col: 3 });
});

test("the footer shows other extensions' statuses on the right and drops whole statuses that do not fit", () => {
	const hints = footerHints(false, undefined, resolve);
	const [wide] = plain(
		renderFooter(theme, hints, 100, ["build ok", "lsp: ts"]),
	);
	assert.ok(wide.startsWith(" Shift+Tab:thinking"));
	assert.ok(wide.endsWith("build ok  lsp: ts"));
	assert.equal(visibleWidth(wide), 99);
	const [narrow] = plain(
		renderFooter(theme, hints, 40, ["build ok", "lsp: ts"]),
	);
	assert.equal(narrow, " Shift+Tab:thinking  │  Ctrl+p:model");
	const [partial] = plain(
		renderFooter(theme, hints, 47, ["build ok", "lsp: ts"]),
	);
	assert.ok(partial.endsWith("build ok"));
	assert.ok(!partial.includes("lsp"));
});

function fakeChrome(entries = []) {
	const handlers = new Map();
	const pi = {
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	const timers = new Set();
	const schedule = (run) => {
		const timer = { run };
		timers.add(timer);
		return () => timers.delete(timer);
	};
	let subscriptions = 0;
	let active = 0;
	const sessions = {
		list: () => [],
		subscribe() {
			subscriptions += 1;
			active += 1;
			return () => {
				active -= 1;
			};
		},
	};
	const hintSubs = { active: 0 };
	const hints = {
		get: () => undefined,
		subscribe() {
			hintSubs.active += 1;
			return () => {
				hintSubs.active -= 1;
			};
		},
	};
	const calls = [];
	const factories = {};
	const ctx = {
		mode: "tui",
		cwd: "/tmp",
		model: undefined,
		getContextUsage: () => undefined,
		sessionManager: { buildContextEntries: () => entries },
		ui: {
			theme,
			setWorkingVisible: (visible) => calls.push(["working", visible]),
			setWorkingIndicator: () => calls.push(["indicator"]),
			setWorkingMessage: () => calls.push(["message"]),
			setHeader: (factory) => (factories.header = factory),
			setFooter: (factory) => (factories.footer = factory),
			setWidget: (_key, factory) => (factories.widget = factory),
			setEditorComponent: (factory) => (factories.editor = factory),
		},
	};
	registerChrome(pi, sessions, hints, schedule);
	const emit = async (event, payload = {}) => {
		for (const handler of handlers.get(event) ?? [])
			await handler(payload, ctx);
	};
	const tui = { terminal: { rows: 40 }, requestRender() {} };
	return {
		emit,
		ctx,
		calls,
		factories,
		timers,
		tui,
		subscriptions: () => subscriptions,
		active: () => active,
		hintSubs,
	};
}

const userEntry = (content) => ({
	type: "message",
	message: { role: "user", content },
});

test("session_start repopulates the editor history from the session's user messages in chronological order", async () => {
	const chrome = fakeChrome([
		userEntry("first"),
		{ type: "message", message: { role: "assistant", content: [] } },
		userEntry([
			{ type: "text", text: "sec" },
			{ type: "image", data: "" },
			{ type: "text", text: "ond" },
		]),
		userEntry([{ type: "image", data: "" }]),
		userEntry(""),
		userEntry("third"),
	]);
	await chrome.emit("session_start");
	const input = chrome.factories.editor(
		chrome.tui,
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
	);
	input.handleInput("\x1b[A");
	assert.equal(input.getText(), "third");
	input.handleInput("\x1b[A");
	assert.equal(input.getText(), "second");
	input.handleInput("\x1b[A");
	assert.equal(input.getText(), "first");
});

test("registerChrome installs the chrome and hides Pi's working row on session_start, and restores it on session_shutdown", async () => {
	const chrome = fakeChrome();
	await chrome.emit("session_start");
	assert.deepEqual(Object.keys(chrome.factories).sort(), [
		"editor",
		"footer",
		"header",
		"widget",
	]);
	assert.deepEqual(chrome.calls, [["working", false]]);
	await chrome.emit("agent_start");
	assert.ok(chrome.timers.size > 0);
	await chrome.emit("session_shutdown");
	assert.deepEqual(chrome.calls.slice(1), [
		["working", true],
		["indicator"],
		["message"],
	]);
	assert.equal(chrome.timers.size, 0);
	assert.equal(chrome.active(), 0);
});

test("a second session_start replaces the subscriptions instead of duplicating them", async () => {
	const chrome = fakeChrome();
	await chrome.emit("session_start");
	await chrome.emit("session_start");
	assert.equal(chrome.subscriptions(), 2);
	assert.equal(chrome.active(), 1);
	assert.equal(chrome.hintSubs.active, 1);
});

test("the status row keeps showing a tool that is still running when a later parallel tool ends", async () => {
	const chrome = fakeChrome();
	await chrome.emit("session_start");
	const widget = chrome.factories.widget(chrome.tui, theme);
	await chrome.emit("agent_start");
	assert.match(plain(widget.render(70))[0], /Waiting for response/);
	await chrome.emit("tool_execution_start", {
		toolCallId: "a",
		toolName: "read",
	});
	await chrome.emit("tool_execution_start", {
		toolCallId: "b",
		toolName: "bash",
	});
	assert.match(plain(widget.render(70))[0], /Run bash/);
	await chrome.emit("tool_execution_end", { toolCallId: "b" });
	assert.match(plain(widget.render(70))[0], /Run read/);
	await chrome.emit("tool_execution_end", { toolCallId: "a" });
	assert.match(plain(widget.render(70))[0], /Waiting for response/);
});

test("the footer strips complete escape sequences from styled statuses and renders them dim", () => {
	const dim = { ...theme, fg: (color, text) => `<${color}>${text}</>` };
	const [line] = renderFooter(dim, [], 60, [
		"\x1b[38;2;187;154;247m🔌 MCP: 3 servers\x1b[39m",
		"\x1b]8;;https://x.test\x07link\x1b]8;;\x07",
	]);
	assert.ok(line.endsWith("<dim>🔌 MCP: 3 servers</>  <dim>link</>"));
	assert.ok(!line.includes("[38;2"));
	assert.ok(!line.includes("\x1b"));
});

test("the model label strips escape sequences from the model id", () => {
	assert.equal(
		modelLabel(
			{ model: { id: "\x1b[1mgrok\x1b[22m", reasoning: false } },
			theme,
		),
		"grok",
	);
});

test("the footer registered on session_start renders the other extensions' statuses", async () => {
	const chrome = fakeChrome();
	await chrome.emit("session_start");
	const footer = chrome.factories.footer(chrome.tui, theme, {
		getGitBranch: () => "main",
		onBranchChange: () => () => {},
		getExtensionStatuses: () => new Map([["lsp", "lsp: ts"]]),
	});
	assert.match(plain(footer.render(100))[0], /lsp: ts$/);
});

const commands = Array.from({ length: 8 }, (_, i) => ({
	value: `cmd${i}`,
	label: `cmd${i}`,
	description: `run command ${i}`,
}));

async function withMenu(width = 60) {
	const input = editor("m");
	input.setAutocompleteProvider({
		getSuggestions: async (lines) => ({ prefix: lines[0], items: commands }),
		applyCompletion: (_lines, _line, _col, item) => ({
			lines: [`/${item.value} `],
			cursorLine: 0,
			cursorCol: item.value.length + 2,
		}),
	});
	input.handleInput("/");
	await new Promise((resolve) => setImmediate(resolve));
	return { input, lines: plain(input.render(width)) };
}

test("the autocomplete list renders above the box between rules, with the total count and the selected row marked", async () => {
	const { lines } = await withMenu();
	assert.equal(lines.length, 10);
	assert.equal(lines[0], ` ${"─".repeat(56)}8─`);
	assert.match(lines[1], /^ {3}❯ cmd0 +run command 0 +$/);
	assert.match(lines[2], /^ {5}cmd1 +run command 1 +$/);
	assert.equal(lines[6], ` ${"─".repeat(58)}`);
	assert.match(lines[7], /^ ╭─+╮$/);
	assert.match(lines[8], /^ │ ❯ \/ +│$/);
	assert.match(lines[9], /^ ╰─+ m ─╯$/);
});

test("the autocomplete block paints only the selected row background and never exceeds the terminal width", async () => {
	const painted = { ...theme, bg: (color, text) => `<${color}>${text}</>` };
	const input = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{ theme: () => painted, label: () => "m" },
	);
	input.setAutocompleteProvider({
		getSuggestions: async () => ({ prefix: "/", items: commands }),
		applyCompletion: (lines, cursorLine, cursorCol) => ({
			lines,
			cursorLine,
			cursorCol,
		}),
	});
	input.handleInput("/");
	await new Promise((resolve) => setImmediate(resolve));
	const lines = input.render(50);
	assert.ok(lines[1].startsWith(" <selectedBg>"));
	assert.ok(!lines[2].includes("Bg>"));
	for (const width of [12, 20, 36, 60, 120]) {
		const { lines: rendered } = await withMenu(width);
		for (const line of rendered)
			assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
		assert.equal(visibleWidth(rendered[1]), width - (width >= 16 ? 1 : 0));
	}
});

test("a click on an autocomplete row above the box selects that row, and box clicks still land in the text", async () => {
	const { input } = await withMenu();
	const click = (type, y, x = 7) =>
		input.handleMouse({ type, button: "left", x, y, width: 60, height: 10 });
	assert.equal(click("press", 0), undefined);
	click("press", 3);
	click("click", 3);
	assert.equal(input.getText(), "/cmd2 ");
	input.setText("hello world");
	input.render(60);
	click("click", 1, 8);
	assert.deepEqual(input.getCursor(), { line: 0, col: 3 });
});

test("the editor falls back to Pi's rules instead of throwing when padding leaves almost no content width", () => {
	const input = editor();
	input.setPaddingX(3);
	input.setText("日本語日本語日本語日本語");
	for (const width of [12, 13, 14]) {
		assert.doesNotThrow(() => input.render(width), `width ${width}`);
	}
	assert.equal(plain(input.render(12))[0], "─".repeat(12));
});

test("the header, status row, footer, and box keep a one-column margin that shrinks to zero on small widths", async () => {
	const data = { frame: 0, label: "Working", stepMs: 1_000 };
	const hints = footerHints(false, undefined, resolve);
	for (const width of [80, 40]) {
		for (const lines of [
			plain(renderHeader(theme, header, width)),
			plain(renderStatusRow(theme, data, width)),
			plain(renderFooter(theme, hints, width)),
			plain(editor().render(width)),
		])
			for (const line of lines) {
				assert.match(line, /^ {1,2}\S/, `${width}: ${line}`);
				assert.ok(visibleWidth(line) <= width - 1);
			}
		assert.match(plain(renderStatusRow(theme, data, width))[0], /^ {2}⠋/);
	}
	for (const width of [15, 12, 5]) {
		assert.doesNotMatch(
			plain(
				renderHeader(theme, { ...header, working: 0, usage: undefined }, width),
			)[0],
			/^ /,
		);
		assert.doesNotMatch(plain(renderFooter(theme, hints, width))[0], /^ /);
		assert.match(plain(renderStatusRow(theme, data, width))[0], /^ ?⠋/);
		assert.doesNotMatch(plain(editor().render(width))[0], /^ /);
		for (const line of [
			...renderHeader(theme, header, width),
			...renderStatusRow(theme, data, width),
			...renderFooter(theme, hints, width),
			...editor().render(width),
		])
			assert.ok(visibleWidth(line) <= width);
	}
});

test("the autocomplete rows and box clicks stay aligned inside the margin and are unshifted without it", async () => {
	const { input } = await withMenu(60);
	const at = (type, y, x) =>
		input.handleMouse({ type, button: "left", x, y, width: 60, height: 10 });
	at("click", 3, 1);
	assert.equal(input.getText(), "/cmd2 ");
	input.setText("hello world");
	input.render(60);
	at("click", 1, 6);
	assert.deepEqual(input.getCursor(), { line: 0, col: 1 });
	const small = editor();
	small.setText("hello world");
	small.render(14);
	small.handleMouse({
		type: "click",
		button: "left",
		x: 6,
		y: 1,
		width: 14,
		height: 3,
	});
	assert.deepEqual(small.getCursor(), { line: 0, col: 2 });
	assert.match(plain(small.render(14))[0], /^╭/);
});
