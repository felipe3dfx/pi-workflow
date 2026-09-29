import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	AssistantMessageComponent,
	BashExecutionComponent,
	InteractiveMode,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";

import { registerChrome } from "../extensions/chrome.ts";
import {
	patchMessages,
	restoreMessages,
} from "../extensions/chrome-messages.ts";

const ORIGINAL = Symbol.for("pi-workflow:chrome-messages:original");
const colors = [];
const code = (name) => {
	if (!colors.includes(name)) colors.push(name);
	return colors.indexOf(name) + 16;
};
const theme = {
	fg: (color, text) => `\x1b[38;5;${code(color)}m${text}\x1b[39m`,
	bg: (color, text) => `\x1b[48;5;${code(color)}m${text}\x1b[49m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	italic: (text) => `\x1b[3m${text}\x1b[23m`,
};
globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")] = theme;

const markdownTheme = new Proxy({}, { get: () => (text) => text });
const plain = (lines) => lines.map((line) => stripVTControlCharacters(line));
const at1155 = new Date(2026, 8, 29, 11, 55).getTime();
const pristine = {
	updateContent: AssistantMessageComponent.prototype.updateContent,
	rebuild: UserMessageComponent.prototype.rebuild,
	addMessageToChat: InteractiveMode.prototype.addMessageToChat,
	toolRender: ToolExecutionComponent.prototype.render,
	toolMouse: ToolExecutionComponent.prototype.handleMouse,
	bashRender: Object.hasOwn(BashExecutionComponent.prototype, "render"),
};

function isPristine() {
	return (
		AssistantMessageComponent.prototype.updateContent ===
			pristine.updateContent &&
		UserMessageComponent.prototype.rebuild === pristine.rebuild &&
		InteractiveMode.prototype.addMessageToChat === pristine.addMessageToChat &&
		ToolExecutionComponent.prototype.render === pristine.toolRender &&
		ToolExecutionComponent.prototype.handleMouse === pristine.toolMouse &&
		Object.hasOwn(BashExecutionComponent.prototype, "render") ===
			pristine.bashRender
	);
}

function patched(t) {
	patchMessages();
	t.after(restoreMessages);
}

function userComponent(text, message = { timestamp: at1155 }) {
	const mode = {
		chatContainer: new Container(),
		getUserMessageText: (message) => message.content,
		getMarkdownThemeWithSettings: () => markdownTheme,
		getMarkdownTransformers: () => [],
		outputPad: 1,
	};
	InteractiveMode.prototype.addMessageToChat.call(mode, {
		role: "user",
		content: text,
		...message,
	});
	return mode.chatContainer.children[0];
}

function assistant(content, overrides = {}) {
	return {
		role: "assistant",
		content,
		stopReason: "stop",
		timestamp: at1155,
		...overrides,
	};
}

function assistantComponent(hidden, label = "Thinking...") {
	return new AssistantMessageComponent(
		undefined,
		hidden,
		markdownTheme,
		label,
		1,
		[],
	);
}

const thought = { type: "thinking", thinking: "weigh the options" };
const answer = { type: "text", text: "Launching six children." };

test("the user message is a prompt block on userMessageBg with a right-aligned timestamp that drops when the width cannot fit it", (t) => {
	patched(t);
	const component = userComponent("Lanza 6 hijos seguidos");
	assert.deepEqual(plain(component.render(40)), [
		" ".repeat(39),
		`   ❯ Lanza 6 hijos seguidos${" ".repeat(2)}11:55 AM  `,
		" ".repeat(39),
	]);
	assert.deepEqual(plain(component.render(30)).slice(1, 2), [
		"   ❯ Lanza 6 hijos seguidos".padEnd(29),
	]);
	assert.equal(
		plain(component.render(120))[1],
		`   ❯ Lanza 6 hijos seguidos${" ".repeat(82)}11:55 AM  `,
	);
	const styled = component.render(40)[1];
	assert.ok(styled.includes(theme.bold(theme.fg("userMessageText", "❯ "))));
	assert.ok(styled.includes(theme.fg("dim", "11:55 AM")));
	assert.ok(styled.includes("\x1b[48;5;"));
});

test("a long user message wraps under the prompt glyph and keeps the timestamp on its first line", (t) => {
	patched(t);
	const component = userComponent(
		"one two three four five six seven eight nine ten",
	);
	assert.deepEqual(plain(component.render(40)).slice(1, 3), [
		`   ❯ one two three four${" ".repeat(6)}11:55 AM  `,
		"     five six seven eight".padEnd(39),
	]);
});

test("a user message without a timestamp renders no clock", (t) => {
	patched(t);
	const component = userComponent("hello", {});
	assert.equal(plain(component.render(40))[1], "   ❯ hello".padEnd(39));
});

test("collapsed thinking reads Thinking while it streams and Thought for its measured duration once text follows", (t) => {
	patched(t);
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const component = assistantComponent(true);
	component.updateContent(assistant([thought], { timestamp: 77 }), true);
	assert.deepEqual(plain(component.render(60)).slice(1), [
		"   ◆ Thinking…".padEnd(60),
	]);
	t.mock.timers.tick(12_600);
	component.updateContent(
		assistant([thought, answer], { timestamp: 77 }),
		true,
	);
	const lines = component.render(60);
	assert.equal(plain(lines)[1], "   ◆ Thought for 12.6s".padEnd(60));
	assert.ok(
		lines[1].includes(
			`${theme.fg("dim", "◆")} ${theme.bold(theme.fg("muted", "Thought"))}${theme.fg("dim", " for 12.6s")}`,
		),
	);
});

test("thought durations round once so the seconds and minutes boundaries roll over", (t) => {
	patched(t);
	const cases = [
		[59_940, "59.9s"],
		[59_960, "1m0s"],
		[60_000, "1m0s"],
		[119_400, "1m59s"],
		[119_600, "2m0s"],
	];
	for (const [ms, label] of cases) {
		t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
		const component = assistantComponent(true);
		component.updateContent(assistant([thought], { timestamp: ms }), true);
		t.mock.timers.tick(ms);
		component.updateContent(
			assistant([thought, answer], { timestamp: ms }),
			true,
		);
		assert.equal(
			plain(component.render(60))[1].trimEnd(),
			`   ◆ Thought for ${label}`,
		);
		t.mock.timers.reset();
	}
});

test("framed blocks never exceed the width at tiny widths", (t) => {
	patched(t);
	const user = userComponent("hello");
	const thinking = assistantComponent(false);
	thinking.updateContent(assistant([thought]), false);
	for (let width = 3; width <= 6; width++)
		for (const component of [user, thinking])
			for (const line of component.render(width))
				assert.ok(
					visibleWidth(line) <= width,
					`width ${width}: ${JSON.stringify(plain([line])[0])}`,
				);
});

test("collapsed thinking without a streamed start shows Thought with no duration", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(assistant([thought]), false);
	assert.deepEqual(plain(component.render(40)).slice(1), [
		"   ◆ Thought".padEnd(40),
	]);
});

test("thinking in a message without a timestamp never borrows another message's duration", (t) => {
	patched(t);
	t.mock.timers.enable({ apis: ["Date"], now: 0 });
	const first = assistantComponent(true);
	first.updateContent(assistant([thought], { timestamp: undefined }), true);
	t.mock.timers.tick(5_000);
	const second = assistantComponent(true);
	second.updateContent(
		assistant([thought, answer], { timestamp: undefined }),
		false,
	);
	assert.equal(plain(second.render(40))[1].trimEnd(), "   ◆ Thought");
});

test("a custom hidden thinking label replaces the Thought header while collapsed", (t) => {
	patched(t);
	const component = assistantComponent(true, "Pondering");
	component.updateContent(assistant([thought]), false);
	assert.equal(plain(component.render(40))[1].trimEnd(), "   ◆ Pondering");
});

test("assistant and user text default to the text color while markdown elements keep their own", (t) => {
	patched(t);
	const identity = (text) => text;
	const colored = {
		heading: identity,
		bold: identity,
		italic: identity,
		underline: identity,
		strikethrough: identity,
		quote: identity,
		quoteBorder: identity,
		hr: identity,
		listBullet: identity,
		codeBlock: identity,
		codeBlockBorder: identity,
		linkUrl: identity,
		link: (text) => theme.fg("link", text),
		code: (text) => theme.fg("code", text),
	};
	const component = new AssistantMessageComponent(
		undefined,
		false,
		colored,
		"Thinking...",
		1,
		[],
	);
	component.updateContent(
		assistant([
			{ type: "text", text: "Plain [docs](https://x.dev) and `run`" },
		]),
		false,
	);
	const [, line] = component.render(60);
	assert.ok(line.includes(theme.fg("text", "Plain ")));
	assert.ok(line.includes(theme.fg("link", "docs")));
	assert.ok(line.includes(theme.fg("code", "run")));
	assert.ok(!line.includes(theme.fg("text", "run")));
	assert.ok(
		userComponent("Lanza hijos")
			.render(40)[1]
			.includes(theme.fg("text", "Lanza hijos")),
	);
});

test("expanded thinking hangs from a muted left bar with the header and non-italic thinkingText", (t) => {
	patched(t);
	const component = assistantComponent(false);
	component.updateContent(assistant([thought]), false);
	const lines = component.render(40);
	assert.deepEqual(
		plain(lines)
			.slice(1)
			.map((line) => line.trimEnd()),
		["   ┃ ◆ Thought", "   ┃", "   ┃ weigh the options"],
	);
	for (const line of lines.slice(1))
		assert.ok(
			line
				.replace("\x1b]133;B\x07\x1b]133;C\x07", "")
				.startsWith(`   ${theme.fg("borderMuted", "┃")} `),
		);
	assert.ok(lines[3].includes(theme.fg("thinkingText", "weigh the options")));
	assert.ok(lines.every((line) => !line.includes("\x1b[3m")));
});

test("a click toggles a thinking run between collapsed and expanded", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(assistant([thought]), false);
	component.render(40);
	component.handleMouse({
		type: "click",
		button: "left",
		x: 2,
		y: 1,
		width: 40,
		height: 2,
	});
	assert.equal(plain(component.render(40)).length, 4);
});

test("each assistant text block carries a dim right-aligned timestamp on its first line", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(assistant([answer]), false);
	const lines = component.render(50);
	assert.deepEqual(plain(lines), [
		"",
		`   Launching six children.${" ".repeat(13)}11:55 AM`,
	]);
	assert.ok(lines[1].includes(theme.fg("dim", "11:55 AM")));
	assert.deepEqual(plain(component.render(30)), [
		"",
		"   Launching six children. ",
	]);
});

test("every rendered line fits the width from 10 to 160 columns", (t) => {
	patched(t);
	const long =
		"A reasonably long sentence that has to wrap across several lines at narrow widths without overflowing.";
	const user = userComponent(long);
	const collapsed = assistantComponent(true);
	collapsed.updateContent(
		assistant([
			{ type: "thinking", thinking: long },
			{ type: "text", text: long },
		]),
		false,
	);
	const expanded = assistantComponent(false);
	expanded.updateContent(
		assistant([
			{ type: "thinking", thinking: long },
			{ type: "text", text: long },
		]),
		false,
	);
	for (let width = 10; width <= 160; width++) {
		for (const component of [user, collapsed, expanded]) {
			for (const line of component.render(width))
				assert.ok(
					visibleWidth(line) <= width,
					`${visibleWidth(line)} > ${width}: ${JSON.stringify(line)}`,
				);
		}
	}
});

test("patching twice keeps a single layer and one restore brings back Pi's methods", () => {
	patchMessages();
	patchMessages();
	assert.equal(
		InteractiveMode.prototype.addMessageToChat[ORIGINAL],
		pristine.addMessageToChat,
	);
	assert.equal(
		AssistantMessageComponent.prototype.updateContent[ORIGINAL],
		pristine.updateContent,
	);
	restoreMessages();
	assert.ok(isPristine());
});

test("a method another extension already replaced is left alone, while the chat hook chains onto it", () => {
	const foreignUpdate = function foreignUpdate() {};
	const foreignAdd = function foreignAdd() {};
	AssistantMessageComponent.prototype.updateContent = foreignUpdate;
	InteractiveMode.prototype.addMessageToChat = foreignAdd;
	try {
		patchMessages();
		assert.equal(
			AssistantMessageComponent.prototype.updateContent,
			foreignUpdate,
		);
		assert.notEqual(InteractiveMode.prototype.addMessageToChat, foreignAdd);
		assert.equal(
			InteractiveMode.prototype.addMessageToChat[ORIGINAL],
			foreignAdd,
		);
		restoreMessages();
		assert.equal(InteractiveMode.prototype.addMessageToChat, foreignAdd);
	} finally {
		AssistantMessageComponent.prototype.updateContent = pristine.updateContent;
		InteractiveMode.prototype.addMessageToChat = pristine.addMessageToChat;
	}
	assert.ok(isPristine());
});

test("the chrome patches the message components on a TUI session_start and restores them on session_shutdown", async () => {
	const handlers = new Map();
	const pi = {
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	const ctx = {
		mode: "tui",
		cwd: "/tmp",
		getContextUsage: () => undefined,
		sessionManager: { buildContextEntries: () => [] },
		ui: {
			setWorkingVisible() {},
			setWorkingIndicator() {},
			setWorkingMessage() {},
			setHeader() {},
			setFooter() {},
			setWidget() {},
			setEditorComponent() {},
		},
	};
	const emit = async (event) => {
		for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
	};
	registerChrome(
		pi,
		{ list: () => [], subscribe: () => () => {} },
		{ get: () => undefined, subscribe: () => () => {} },
		() => () => {},
	);
	await emit("session_start");
	await emit("session_start");
	assert.equal(
		UserMessageComponent.prototype.rebuild[ORIGINAL],
		pristine.rebuild,
	);
	await emit("session_shutdown");
	assert.ok(isPristine());
});

function toolRow() {
	const ui = { requestRender() {} };
	const row = new ToolExecutionComponent(
		"read",
		"call-1",
		{ path: "a.ts" },
		{ showImages: false },
		undefined,
		ui,
		process.cwd(),
	);
	row.updateResult(
		{ content: [{ type: "text", text: "hello world" }], isError: false },
		false,
	);
	return row;
}

test("tool and bash rows start at the assistant margin and never exceed the width", (t) => {
	const tool = toolRow();
	const bash = new BashExecutionComponent("ls", { requestRender() {} });
	bash.appendOutput("hello world");
	bash.setComplete(0, false);
	const bare = plain(tool.render(80));
	patched(t);
	for (const row of [tool, bash]) {
		const lines = plain(row.render(80));
		assert.ok(lines.some((line) => line.trim() !== ""));
		for (const line of lines)
			assert.ok(line === "" || line.startsWith("   "), JSON.stringify(line));
	}
	assert.equal(plain(tool.render(80)).length, bare.length);
	for (let width = 10; width <= 160; width++)
		for (const row of [tool, bash])
			for (const line of row.render(width))
				assert.ok(
					visibleWidth(line) <= width,
					`${width}: ${JSON.stringify(line)}`,
				);
});

test("the row margin is dropped at small widths", (t) => {
	const tool = toolRow();
	const bare = plain(tool.render(20));
	patched(t);
	assert.deepEqual(plain(tool.render(20)), bare);
	assert.ok(plain(tool.render(24)).some((line) => line.startsWith(" ")));
});

test("row mouse events are shifted by the margin and ignore the margin itself", () => {
	const seen = [];
	ToolExecutionComponent.prototype.handleMouse = (event) => {
		seen.push(event);
	};
	try {
		patchMessages();
		const row = toolRow();
		const at = (x) => ({
			x,
			y: 1,
			width: 80,
			height: 3,
			screenX: x,
			screenY: 1,
		});
		row.handleMouse(at(2));
		row.handleMouse(at(77));
		assert.equal(seen.length, 0);
		row.handleMouse(at(10));
		assert.equal(seen[0].x, 7);
		assert.equal(seen[0].width, 74);
	} finally {
		restoreMessages();
		ToolExecutionComponent.prototype.handleMouse = pristine.toolMouse;
	}
	assert.ok(isPristine());
});

test("patching twice keeps one row margin and restore removes the wrapper", () => {
	const tool = toolRow();
	const bare = plain(tool.render(74));
	patchMessages();
	patchMessages();
	assert.equal(
		ToolExecutionComponent.prototype.render[ORIGINAL],
		pristine.toolRender,
	);
	assert.deepEqual(
		plain(tool.render(80)),
		bare.map((line) => (line === "" ? line : `   ${line}`)),
	);
	restoreMessages();
	assert.ok(isPristine());
	assert.ok(!Object.hasOwn(BashExecutionComponent.prototype, "render"));
});
