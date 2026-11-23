import { createRequire } from "node:module";
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
import { Container, Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { loadThemeFromPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { registerChrome } from "../extensions/chrome.ts";
import {
	patchMessages,
	registerMessages,
	restoreMessages,
	thinkingSteps,
} from "../extensions/chrome-messages.ts";
import { registerCompactTools } from "../extensions/compact-tools.ts";
import { readSelection } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";

import { densityTerminal } from "./support/density-terminal.mjs";

const piTui = await import(
	createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
		"@earendil-works/pi-tui",
	)
);
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
	renderToken: Markdown.prototype.renderToken,
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
			pristine.bashRender &&
		Markdown.prototype.renderToken === pristine.renderToken
	);
}

function patched(t) {
	patchMessages();
	t.after(restoreMessages);
}

function userComponent(text, message = { timestamp: at1155 }, outputPad = 1) {
	const mode = {
		chatContainer: new Container(),
		getUserMessageText: (message) => message.content,
		getMarkdownThemeWithSettings: () => markdownTheme,
		getMarkdownTransformers: () => [],
		outputPad,
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

function assistantComponent(hidden, label = "Thinking...", outputPad = 1) {
	return new AssistantMessageComponent(
		undefined,
		hidden,
		markdownTheme,
		label,
		outputPad,
		[],
	);
}

const thought = { type: "thinking", thinking: "weigh the options" };
const answer = { type: "text", text: "Launching six children." };

test("the user message is a prompt block on userMessageBg with a right-aligned timestamp that drops when the width cannot fit it", (t) => {
	patched(t);
	const component = userComponent("Spawn six children now");
	assert.deepEqual(plain(component.render(40)), [
		" ".repeat(39),
		`   ❯ Spawn six children now${" ".repeat(2)}11:55 AM  `,
		" ".repeat(39),
	]);
	assert.deepEqual(plain(component.render(30)).slice(1, 2), [
		"   ❯ Spawn six children now".padEnd(29),
	]);
	assert.equal(
		plain(component.render(120))[1],
		`   ❯ Spawn six children now${" ".repeat(82)}11:55 AM  `,
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

test("pasted user text is plain, dedented after the first line and wraps under each line's own indent", (t) => {
	patched(t);
	const component = userComponent(
		"Fix this: [issues]\n    /tmp/pkg.json\n      Host packages must be declared in peers\n    **not markdown**",
	);
	assert.deepEqual(plain(component.render(40)).slice(1, 6), [
		`   ❯ Fix this: [issues]${" ".repeat(6)}11:55 AM  `,
		"     /tmp/pkg.json".padEnd(39),
		"       Host packages must".padEnd(39),
		"       be declared in peers".padEnd(39),
		"     **not markdown**".padEnd(39),
	]);
	const deep = userComponent(`a\n${" ".repeat(20)}deep`);
	assert.equal(plain(deep.render(40))[2].trimEnd(), "     deep");
	const nested = userComponent(`a\n  b\n${" ".repeat(14)}c`);
	assert.equal(plain(nested.render(40))[3].trimEnd(), `     ${" ".repeat(8)}c`);
	for (let width = 3; width <= 60; width++)
		for (const line of component.render(width))
			assert.ok(visibleWidth(line) <= width, `width ${width}`);
});

test("an assistant error is a red glyph with muted text that wraps under the text", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(
		assistant([], {
			stopReason: "error",
			errorMessage: "This operation was aborted by the provider",
		}),
	);
	const lines = component.render(40);
	assert.deepEqual(
		plain(lines)
			.slice(1)
			.map((line) => line.trimEnd()),
		["   ◆ Error: This operation was", "     aborted by the provider"],
	);
	const muted = theme.fg("muted", "").replace("\x1b[39m", "");
	assert.ok(lines[1].includes(`${theme.fg("error", "◆")} ${muted}Error:`));
});

test("MCP tools and tools without a call renderer get the compact self-rendered row through the tool renderer resolver, others keep their definition", (t) => {
	patched(t);
	const preview = readSelection(undefined, []);
	if (preview.status === "ready") replaceSelection(preview.selection);
	const own = { name: "read", renderCall() {} };
	const mcp = {
		name: "mcp__engram__mem_search",
		label: "engram/mem_search",
		renderCall() {},
	};
	const bare = { name: "spawn_child", label: "Spawn Child" };
	const definitions = { read: own, [mcp.name]: mcp, spawn_child: bare };
	const resolvers = [];
	registerCompactTools({
		registerToolRenderer: (resolver) => resolvers.push(resolver),
		registerTool() {},
	});
	assert.equal(resolvers.length, 1);
	const mode = {
		session: {
			getToolDefinition: (name) => definitions[name],
			extensionRunner: { resolveToolRenderers: resolvers[0] },
		},
	};
	const lookup = (name) =>
		InteractiveMode.prototype.getRegisteredToolDefinition.call(mode, name);
	assert.equal(lookup("read").renderCall, own.renderCall);
	for (const name of [mcp.name, "spawn_child", "unknown_tool"]) {
		const definition = lookup(name);
		assert.equal(definition.renderShell, "self", name);
		assert.notEqual(definition.renderCall, mcp.renderCall);
	}
	const row = new ToolExecutionComponent(
		mcp.name,
		"call-1",
		{ query: "x" },
		{ showImages: false },
		lookup(mcp.name),
		{ requestRender() {} },
		"/",
	);
	row.updateResult({ content: [{ type: "text", text: "Found 2" }] }, false);
	assert.deepEqual(
		plain(row.render(40)).map((line) => line.trimEnd()),
		["", "   ◆ Engram Mem Search"],
	);
});

test("a user message without a timestamp renders no clock", (t) => {
	patched(t);
	const component = userComponent("hello", {});
	assert.equal(plain(component.render(40))[1], "   ❯ hello".padEnd(39));
});

test("collapsed thinking reads Thinking with the current step while it streams and Thought with its measured duration once text follows", (t) => {
	patched(t);
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const component = assistantComponent(true);
	component.updateContent(assistant([thought], { timestamp: 77 }), true);
	assert.deepEqual(plain(component.render(60)).slice(1), [
		"   ◆ Thinking… · weigh the options".padEnd(60),
	]);
	t.mock.timers.tick(12_600);
	component.updateContent(
		assistant([thought, answer], { timestamp: 77 }),
		true,
	);
	const lines = component.render(60);
	assert.equal(plain(lines)[1], "   ◆ Thought for 13s".padEnd(60));
	assert.ok(
		lines[1].includes(
			`${theme.fg("dim", "◆")} ${theme.bold(theme.fg("muted", "Thought"))}${theme.fg("dim", " for 13s")}`,
		),
	);
});

test("a thought shorter than a second reads Thought without a duration", (t) => {
	patched(t);
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const component = assistantComponent(true);
	component.updateContent(assistant([thought], { timestamp: 13 }), true);
	t.mock.timers.tick(400);
	component.updateContent(
		assistant([thought, answer], { timestamp: 13 }),
		true,
	);
	assert.equal(plain(component.render(60))[1].trimEnd(), "   ◆ Thought");
});

test("thought durations round once so the seconds and minutes boundaries roll over", (t) => {
	patched(t);
	const cases = [
		[9_940, "9.9s"],
		[9_960, "10s"],
		[59_400, "59s"],
		[59_600, "1m0s"],
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

test("a custom hidden thinking label replaces the Thought text while collapsed and keeps a single glyph and the duration", (t) => {
	patched(t);
	const component = assistantComponent(true, "Pondering");
	component.updateContent(assistant([thought]), false);
	assert.equal(plain(component.render(40))[1].trimEnd(), "   ◆ Pondering");
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const glyph = assistantComponent(true, "◆ Thought");
	glyph.updateContent(assistant([thought], { timestamp: 91 }), true);
	t.mock.timers.tick(3_000);
	glyph.updateContent(assistant([thought, answer], { timestamp: 91 }), true);
	assert.equal(plain(glyph.render(40))[1].trimEnd(), "   ◆ Thought for 3.0s");
});

test("thinking splits into steps at blank lines, headings and bold-only lines, and titles the last step", () => {
	assert.deepEqual(thinkingSteps([]), { count: 0, title: "" });
	assert.deepEqual(thinkingSteps(["one line\nstill one"]), {
		count: 1,
		title: "one line",
	});
	assert.deepEqual(
		thinkingSteps([
			"Read the file. Then more.\n\n\nSecond paragraph",
			"## Plan\n\nThe plan body\n**Check it**\nbody",
		]),
		{ count: 4, title: "Check it" },
	);
	assert.deepEqual(thinkingSteps(["# A\n\n# B\n\ntext"]), {
		count: 2,
		title: "B",
	});
	assert.deepEqual(thinkingSteps(["Is it done? Maybe"]), {
		count: 1,
		title: "Is it done?",
	});
	assert.deepEqual(thinkingSteps(["#hashtag line\n**not** bold only"]), {
		count: 1,
		title: "#hashtag line",
	});
	const long = `${"word ".repeat(40_000)}\n\n`.repeat(20);
	const start = performance.now();
	assert.equal(thinkingSteps([long]).count, 20);
	assert.ok(performance.now() - start < 500);
});

test("a finished run shows its duration and never a step count", (t) => {
	patched(t);
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const steps = {
		type: "thinking",
		thinking: "**Scan**\n\nfirst\n\nsecond\n\nthird",
	};
	const component = assistantComponent(true);
	component.updateContent(assistant([steps], { timestamp: 5 }), true);
	assert.equal(
		plain(component.render(60))[1].trimEnd(),
		"   ◆ Thinking… · third",
	);
	t.mock.timers.tick(12_600);
	component.updateContent(assistant([steps, answer], { timestamp: 5 }), true);
	const lines = component.render(60);
	assert.equal(plain(lines)[1].trimEnd(), "   ◆ Thought for 13s");
	assert.ok(
		lines[1].includes(
			`${theme.fg("dim", "◆")} ${theme.bold(theme.fg("muted", "Thought"))}${theme.fg("dim", " for 13s")}`,
		),
	);
	const unknown = assistantComponent(true);
	unknown.updateContent(assistant([steps]), false);
	assert.equal(plain(unknown.render(60))[1].trimEnd(), "   ◆ Thought");
});

test("the streaming step title is dim, sanitized and truncated to the width", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(
		assistant([
			{
				type: "thinking",
				thinking: `Checking \x1b[31mthe 日本 configuration ${"and more ".repeat(20)}`,
			},
		]),
		true,
	);
	const lines = component.render(40);
	assert.equal(plain(lines)[1], "   ◆ Thinking… · Checking  [31mthe …    ");
	assert.ok(lines[1].includes(theme.fg("dim", " · Checking  [31mthe …")));
	assert.equal(
		plain(component.render(24))[1].trimEnd(),
		"  ◆ Thinking… · Check…",
	);
	assert.equal(plain(component.render(18))[1].trimEnd(), "◆ Thinking… · Che…");
	assert.equal(plain(component.render(16))[1].trimEnd(), "◆ Thinking…");
});

test("a collapsed header advertises Pi's thinking toggle key and drops the hint first when the width is tight", (t) => {
	patched(t);
	const { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } = piTui;
	setKeybindings(
		new KeybindingsManager({
			...TUI_KEYBINDINGS,
			"app.thinking.toggle": { defaultKeys: "ctrl+t" },
		}),
	);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	const component = assistantComponent(true);
	component.updateContent(assistant([thought]), false);
	const lines = component.render(40);
	assert.equal(plain(lines)[1].trimEnd(), "   ◆ Thought  (ctrl+t to expand)");
	assert.ok(lines[1].includes(theme.fg("dim", "  (ctrl+t to expand)")));
	assert.equal(plain(component.render(30))[1].trimEnd(), "   ◆ Thought");
	const expanded = assistantComponent(false);
	expanded.updateContent(assistant([thought]), false);
	assert.ok(!plain(expanded.render(60)).join("\n").includes("to expand"));
	for (let width = 3; width <= 80; width++)
		for (const line of component.render(width))
			assert.ok(visibleWidth(line) <= width, `width ${width}`);
});

test("a throw in the patched updateContent falls back to Pi's renderer for that call only", (t) => {
	patched(t);
	// A label Pi can trim and print, but whose trim() result the chrome cannot use.
	const component = assistantComponent(true, {
		trim() {
			return this;
		},
		toString: () => "Pondering",
	});
	component.updateContent(assistant([thought]), false);
	const fallback = plain(component.render(40)).join("\n");
	assert.ok(fallback.includes("Pondering"));
	assert.ok(!fallback.includes("◆"));
	component.hiddenThinkingLabel = "Thinking...";
	component.updateContent(assistant([thought]), false);
	assert.equal(plain(component.render(40))[1].trimEnd(), "   ◆ Thought");
});

test("Markdown transformers see the same message type, streaming state, saved entry id and timestamp under the chrome as under Pi", (t) => {
	const contexts = () => {
		let seen;
		const component = new AssistantMessageComponent(
			undefined,
			false,
			markdownTheme,
			"Thinking...",
			1,
			[
				(markdown, { availableWidth: _, ...context }) => {
					seen.set(JSON.stringify(context), context);
					return markdown;
				},
			],
			"entry-7",
			"2026-09-29T11:55:00.000Z",
		);
		return [true, false].map((isStreaming) => {
			seen = new Map();
			component.updateContent(assistant([thought, answer]), isStreaming);
			component.render(60);
			return [...seen.values()];
		});
	};
	const expected = [true, false].map((isStreaming) =>
		["assistant-thinking", "assistant"].map((messageType) => ({
			messageType,
			isStreaming,
			messageId: "entry-7",
			timestamp: "2026-09-29T11:55:00.000Z",
		})),
	);
	const pi = contexts();
	assert.deepEqual(pi, expected);
	patched(t);
	assert.deepEqual(contexts(), pi);
});

test("a finished thinking run is saved once and restored on session_start so the collapsed header keeps its duration after a reload", async (t) => {
	const handlers = new Map();
	const saved = [];
	const pi = {
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		appendEntry: (customType, data) =>
			saved.push({ type: "custom", customType, data }),
	};
	const ctx = {
		mode: "tui",
		sessionManager: {
			getEntries: () => [{ type: "custom", customType: "other" }, ...saved],
		},
	};
	const start = async () => {
		for (const handler of handlers.get("session_start")) await handler({}, ctx);
	};
	registerMessages(pi);
	patched(t);
	await start();
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const component = assistantComponent(true);
	component.updateContent(assistant([thought], { timestamp: 42 }), true);
	t.mock.timers.tick(4_200);
	for (let i = 0; i < 3; i++) {
		component.updateContent(
			assistant([thought, answer], { timestamp: 42 }),
			i < 2,
		);
		component.render(40);
	}
	assert.deepEqual(saved, [
		{
			type: "custom",
			customType: "pi-workflow-thinking-time",
			data: { timestamp: 42, runIndex: 0, ms: 4_200 },
		},
	]);
	restoreMessages();
	patchMessages();
	await start();
	const reloaded = assistantComponent(true);
	reloaded.updateContent(
		assistant([thought, answer], { timestamp: 42 }),
		false,
	);
	assert.equal(
		plain(reloaded.render(40))[1].trimEnd(),
		"   ◆ Thought for 4.2s",
	);
	assert.equal(saved.length, 1);
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
		userComponent("Spawn child")
			.render(40)[1]
			.includes(theme.fg("text", "Spawn child")),
	);
});

test("tabs in a prompt expand to three spaces before the dedent and the hanging indent", (t) => {
	patched(t);
	const lines = plain(userComponent("Steps:\n\tone\n\t\ttwo").render(60));
	const one = lines.find((line) => line.includes("one"));
	const two = lines.find((line) => line.includes("two"));
	assert.ok(!one.includes("\t") && !two.includes("\t"));
	assert.equal(two.indexOf("two") - one.indexOf("one"), 3);
	assert.equal(
		one.indexOf("one"),
		lines.find((line) => line.includes("Steps")).indexOf("Steps"),
	);
});

test("only the latest collapsed thinking row advertises the expand hint", (t) => {
	patched(t);
	const { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } = piTui;
	setKeybindings(
		new KeybindingsManager({
			...TUI_KEYBINDINGS,
			"app.thinking.toggle": { defaultKeys: "ctrl+t" },
		}),
	);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	const hinted = (component) =>
		plain(component.render(60)).join("\n").includes("to expand");
	const older = assistantComponent(true);
	older.updateContent(assistant([thought]), false);
	assert.equal(hinted(older), true);
	const newer = assistantComponent(true);
	newer.updateContent(
		assistant([thought], { timestamp: at1155 + 1000 }),
		false,
	);
	assert.equal(hinted(newer), true);
	assert.equal(hinted(older), false);
});

test("a chat rebuilt from an older session gives the expand hint back to its latest collapsed row", (t) => {
	patched(t);
	const { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } = piTui;
	setKeybindings(
		new KeybindingsManager({
			...TUI_KEYBINDINGS,
			"app.thinking.toggle": { defaultKeys: "ctrl+t" },
		}),
	);
	t.after(() => setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS)));
	const hinted = (component) =>
		plain(component.render(60)).join("\n").includes("to expand");
	const newer = assistantComponent(true);
	newer.updateContent(
		assistant([thought], { timestamp: at1155 + 1000 }),
		false,
	);
	const mode = {
		chatContainer: new Container(),
		renderSessionItems() {
			const older = assistantComponent(true);
			older.updateContent(assistant([thought]), false);
			this.chatContainer.addChild(older);
		},
	};
	InteractiveMode.prototype.renderSessionEntries.call(mode, []);
	const [older] = mode.chatContainer.children;
	assert.equal(hinted(older), true);
	assert.equal(hinted(newer), false);
	assert.notEqual(mode.chatContainer.render, Container.prototype.render);
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
	const streaming = assistantComponent(true);
	streaming.updateContent(
		assistant([{ type: "thinking", thinking: `**${long}**\n\n${long}` }]),
		true,
	);
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
		for (const component of [user, streaming, collapsed, expanded]) {
			for (const line of component.render(width))
				assert.ok(
					visibleWidth(line) <= width,
					`${visibleWidth(line)} > ${width}: ${JSON.stringify(line)}`,
				);
		}
	}
});

test("the chrome patches the message components on a TUI session_start, keeps them across session replacement and restores them on quit", async () => {
	const handlers = new Map();
	const pi = {
		registerShortcut() {},
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	const ctx = {
		mode: "tui",
		cwd: "/tmp",
		getContextUsage: () => undefined,
		sessionManager: { buildContextEntries: () => [], getEntries: () => [] },
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
	const emit = async (event, payload = {}) => {
		for (const handler of handlers.get(event) ?? [])
			await handler({ type: event, ...payload }, ctx);
	};
	registerChrome(
		pi,
		{ get: () => undefined, subscribe: () => () => {} },
		() => () => {},
	);
	await emit("session_start");
	await emit("session_start");
	assert.notEqual(UserMessageComponent.prototype.rebuild, pristine.rebuild);
	for (const reason of ["reload", "new", "resume", "fork"]) {
		await emit("session_shutdown", { reason });
		assert.notEqual(
			UserMessageComponent.prototype.rebuild,
			pristine.rebuild,
			reason,
		);
	}
	await emit("session_shutdown", { reason: "quit" });
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
	assert.deepEqual(
		plain(tool.render(80)),
		bare.map((line) => (line === "" ? line : `   ${line}`)),
	);
	restoreMessages();
	assert.ok(isPristine());
	assert.ok(!Object.hasOwn(BashExecutionComponent.prototype, "render"));
});

test("each heading level of Pi's Markdown theme takes its own theme var color, with Pi's bold and underline kept, a Markdown theme of its own keeps its heading, and restore returns Pi's heading color", (t) => {
	const key = Symbol.for("@earendil-works/pi-coding-agent:theme");
	const workflow = loadThemeFromPath(
		new URL("../themes/pi-workflow.json", import.meta.url).pathname,
		"truecolor",
	);
	globalThis[key] = workflow;
	t.after(() => {
		globalThis[key] = theme;
	});
	const headingTheme = {
		...markdownTheme,
		heading: (text) => globalThis[key].fg("mdHeading", text),
		bold: (text) => `<b>${text}`,
		underline: (text) => `<u>${text}`,
	};
	const source = [1, 2, 3, 4, 5, 6]
		.map((level) => `${"#".repeat(level)} Level ${level}`)
		.join("\n\n");
	const render = (heading = headingTheme.heading) =>
		new Markdown(
			source,
			0,
			0,
			new Proxy(
				{ ...headingTheme, heading },
				{
					get: (target, name) => target[name] ?? ((text) => text),
				},
			),
		)
			.render(60)
			.filter((line) => line.trim());
	patched(t);
	const lines = render();
	const rgb = [
		"26;188;156",
		"122;162;247",
		"157;124;216",
		"120;120;120",
		"108;108;108",
		"90;90;90",
	];
	assert.equal(lines.length, 6);
	lines.forEach((line, i) => {
		assert.ok(line.includes(`\x1b[38;2;${rgb[i]}m`), line);
		assert.ok(line.includes("<b>"), line);
	});
	assert.ok(lines[0].includes("<u>"));
	assert.ok(!lines[1].includes("<u>"));
	const own = render((text) => `<heading>${text}`);
	assert.ok(
		own.every(
			(line) => line.includes("<heading>") && !line.includes("\x1b[38;2;"),
		),
		own.join("\n"),
	);

	globalThis[key] = theme;
	const fallback = render();
	assert.ok(
		fallback.every((line) =>
			line.includes(theme.fg("mdHeading", "|").split("|")[0]),
		),
		fallback.join("\n"),
	);

	globalThis[key] = workflow;
	restoreMessages();
	const pi = workflow.fg("mdHeading", "|").split("|")[0];
	assert.ok(render().every((line) => line.includes(pi)));
});

test("below 60 terminal columns assistant text starts after the 2-column lane with a 1-column right margin", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const component = assistantComponent(true);
	component.updateContent(assistant([answer]), false);
	assert.deepEqual(plain(component.render(43)), [
		"",
		`  Launching six children.${" ".repeat(9)}11:55 AM`,
	]);
	const long = assistantComponent(true);
	long.updateContent(
		assistant([
			{
				type: "text",
				text: "Review the narrow terminal layout before changing the status bar and the wrapping rules for long messages.",
			},
		]),
		false,
	);
	const lines = plain(long.render(43)).slice(1);
	assert.ok(lines.length > 1);
	for (const line of lines) {
		assert.match(line, /^ {2}\S/);
		assert.ok(visibleWidth(line) <= 42, JSON.stringify(line));
	}
});

test("below 60 terminal columns the user message background reaches both edges with padding 1 and its text one column right of the lane", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const component = userComponent("Spawn six children now");
	const lines = component.render(43);
	assert.deepEqual(plain(lines), [
		" ".repeat(43),
		` ❯ Spawn six children now${" ".repeat(9)}11:55 AM `,
		" ".repeat(43),
	]);
	for (const line of lines) {
		const band = line.indexOf("\x1b[48;5;");
		assert.ok(band >= 0, line);
		assert.equal(stripVTControlCharacters(line.slice(0, band)), "");
	}
	const wrapped = plain(
		userComponent("one two three four five six seven eight nine ten").render(
			43,
		),
	);
	assert.equal(wrapped.length, 4);
	assert.match(wrapped[2], /^ {3}\S/);
});

test("below 60 terminal columns the right margin and the user padding stay 1 when Pi's output padding is 0", (t) => {
	patched(t);
	densityTerminal(t, 44);
	assert.deepEqual(
		plain(userComponent("Zero padding", { timestamp: at1155 }, 0).render(43)),
		[
			" ".repeat(43),
			` ❯ Zero padding${" ".repeat(19)}11:55 AM `,
			" ".repeat(43),
		],
	);
	const component = assistantComponent(true, "Thinking...", 0);
	component.updateContent(assistant([thought, answer]), false);
	const lines = plain(component.render(43)).map((line) => line.trimEnd());
	assert.deepEqual(lines.slice(1), [
		"◆ Thought",
		"",
		`  Launching six children.${" ".repeat(9)}11:55 AM`,
	]);
});

test("below 60 terminal columns thinking, its rail and notices put their glyph in the lane and their body after it", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const collapsed = assistantComponent(true);
	collapsed.updateContent(assistant([thought]), false);
	assert.deepEqual(plain(collapsed.render(43)).slice(1), [
		"◆ Thought".padEnd(43),
	]);
	const expanded = assistantComponent(false);
	expanded.updateContent(assistant([thought]), false);
	assert.deepEqual(
		plain(expanded.render(43))
			.slice(1)
			.map((line) => line.trimEnd()),
		["┃ ◆ Thought", "┃", "┃ weigh the options"],
	);
	const failed = assistantComponent(true);
	failed.updateContent(
		assistant([], {
			stopReason: "error",
			errorMessage:
				"This operation was aborted by the provider after a long wait",
		}),
	);
	const notice = plain(failed.render(43)).slice(1);
	assert.equal(notice[0].slice(0, 2), "◆ ");
	assert.match(notice[1], /^ {2}\S/);
	for (const line of notice) assert.ok(visibleWidth(line.trimEnd()) <= 42);
});

test("below 60 terminal columns tool and bash rows put their glyph in the lane and keep the right margin", (t) => {
	const tool = toolRow();
	const bash = new BashExecutionComponent("ls", { requestRender() {} });
	bash.appendOutput("hello world");
	bash.setComplete(0, false);
	const bare = plain(tool.render(42));
	patched(t);
	densityTerminal(t, 44);
	assert.deepEqual(plain(tool.render(43)), bare);
	const border = "─".repeat(42);
	const lines = plain(bash.render(43));
	assert.deepEqual(
		lines.map((line) => line.trimEnd()),
		["", border, "$ ls", "", "  hello world", border],
	);
	for (const line of lines) assert.ok(visibleWidth(line) <= 42, line);
});

test("below 60 terminal columns native Bash keeps its streaming, preview, expansion and exit status with the output after the lane", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const bash = new BashExecutionComponent("make", { requestRender() {} });
	t.after(() => bash.loader.stop());
	bash.appendOutput("step 1");
	const running = plain(bash.render(43)).map((line) => line.trimEnd());
	assert.deepEqual(running.slice(2, 5), ["$ make", "", "  step 1"]);
	assert.match(running[6], /^ {2}\S Running\.\.\./, running.join("\n"));
	bash.appendOutput(
		`\n${Array.from({ length: 24 }, (_, i) => `line ${i}`).join("\n")}`,
	);
	bash.setComplete(2, false);
	const collapsed = plain(bash.render(43)).map((line) => line.trimEnd());
	assert.equal(collapsed.filter((line) => /^ {2}line /.test(line)).length, 20);
	assert.ok(collapsed.some((line) => /^ {2}\.\.\. 5 more lines/.test(line)));
	assert.ok(collapsed.includes("  (exit 2)"));
	bash.setExpanded(true);
	const expanded = plain(bash.render(43)).map((line) => line.trimEnd());
	assert.equal(expanded.filter((line) => /^ {2}line /.test(line)).length, 24);
	assert.ok(expanded.includes("  step 1"));
});

test("below 60 terminal columns a wrapping native Bash command starts after its glyph and its wrapped output rows start after the lane, all inside the right margin", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const words = Array.from({ length: 12 }, (_, i) => `word${i}`).join(" ");
	const bash = new BashExecutionComponent(`echo ${words}`, {
		requestRender() {},
	});
	bash.appendOutput(words);
	bash.setComplete(0, false);
	for (const expanded of [false, true]) {
		bash.setExpanded(expanded);
		const lines = plain(bash.render(43));
		const command = lines.findIndex((line) => line.startsWith("$ "));
		assert.match(lines[command], /^\$ echo word0 /, lines.join("\n"));
		const first = lines.findIndex((line) => /^ {2}word0 /.test(line));
		const body = lines.slice(first, -1).map((line) => line.trimEnd());
		assert.ok(first > command && body.length >= 2, lines.join("\n"));
		for (const line of body) assert.match(line, /^ {2}word\d+/, `${expanded}`);
		assert.equal(body.map((line) => line.trim()).join(" "), words);
		for (const line of lines) assert.ok(visibleWidth(line) <= 42, line);
	}
});

test("below 60 terminal columns native Bash shrinks its lane to keep one output cell, fits every row in the 2 or 3 columns it is given and paints nothing when the margin takes its only column", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const bash = new BashExecutionComponent("ls", { requestRender() {} });
	bash.appendOutput("t");
	bash.setComplete(0, false);
	for (const [outer, row] of [
		[3, " t"],
		[2, "t"],
	]) {
		const lines = plain(bash.render(outer));
		assert.ok(lines.includes(row), `${outer}: ${JSON.stringify(lines)}`);
		for (const line of lines)
			assert.ok(visibleWidth(line) <= outer - 1, `${outer}: ${line}`);
	}
	for (const expanded of [false, true]) {
		bash.setExpanded(expanded);
		const lines = plain(bash.render(1));
		assert.deepEqual(
			lines.map(visibleWidth).filter((width) => width > 0),
			[],
			`${expanded}: ${JSON.stringify(lines)}`,
		);
	}
});

test("only the terminal's columns decide the density, whatever width the component is given", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(assistant([answer]), false);
	const wide = (width) => plain(component.render(width));
	const today = { 43: wide(43), 59: wide(59), 99: wide(99) };
	const terminal = densityTerminal(t, 44);
	assert.match(plain(component.render(43))[1], /^ {2}Launching/);
	terminal.columns = 59;
	assert.match(plain(component.render(59))[1], /^ {2}Launching/);
	terminal.columns = 60;
	assert.deepEqual(plain(component.render(59)), today[59]);
	assert.match(today[59][1], /^ {3}Launching/);
	terminal.columns = 100;
	assert.deepEqual(plain(component.render(99)), today[99]);
	terminal.columns = 60;
	assert.deepEqual(plain(component.render(43)), today[43]);
});

test("row mouse events below 60 terminal columns reach the content cell under the pointer and the right margin reaches nothing, for tool rows", (t) => {
	const seen = [];
	ToolExecutionComponent.prototype.handleMouse = (event) => {
		seen.push(event);
	};
	t.after(() => {
		restoreMessages();
		ToolExecutionComponent.prototype.handleMouse = pristine.toolMouse;
	});
	patchMessages();
	densityTerminal(t, 44);
	const at = (x) => ({ x, y: 2, width: 43, height: 4, screenX: x, screenY: 2 });
	const row = toolRow();
	row.handleMouse(at(42));
	assert.equal(seen.length, 0);
	row.handleMouse(at(0));
	row.handleMouse(at(41));
	assert.deepEqual(
		seen.map(({ x, width }) => [x, width]),
		[
			[0, 42],
			[41, 42],
		],
	);
});

test("a click on native Bash output below 60 terminal columns reaches the output cell it renders, and the lane, the right margin and the border reach nothing", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const bash = new BashExecutionComponent(
		"echo a command long enough to wrap the row",
		{ requestRender() {} },
	);
	bash.appendOutput("target output");
	bash.setComplete(0, false);
	bash.setExpanded(true);
	const output = bash.contentContainer.children[1];
	const seen = [];
	output.handleMouse = (event) => {
		seen.push(event);
		return { handled: true };
	};
	const lines = plain(bash.render(43));
	const row = lines.findIndex((line) => line.trimEnd() === "  target output");
	assert.ok(row > 0, lines.join("\n"));
	const click = (x, y = row) =>
		bash.handleMouse({
			type: "click",
			button: "left",
			x,
			y,
			width: 43,
			height: lines.length,
			screenX: x,
			screenY: y,
		});
	assert.equal(click(1), undefined);
	assert.equal(click(42), undefined);
	assert.equal(click(2, lines.length - 1), undefined);
	assert.equal(seen.length, 0);
	assert.ok(click(2)?.handled);
	assert.ok(click(41)?.handled);
	assert.deepEqual(
		seen.map(({ x, y, width }) => [x, y, width]),
		[
			[1, 1, 42],
			[40, 1, 42],
		],
	);
});

// Stands in for Markdown's click handler for one test: it handles every event
// and records it in the returned list.
function markdownClicks(t) {
	const original = Markdown.prototype.handleMouse;
	const seen = [];
	Markdown.prototype.handleMouse = (event) => {
		seen.push(event);
		return { handled: true };
	};
	t.after(() => {
		if (original === undefined) delete Markdown.prototype.handleMouse;
		else Markdown.prototype.handleMouse = original;
	});
	return seen;
}

test("a click on an open thought's body below 60 terminal columns reaches the text cell under it across the full unstamped width, and the rail and right margin reach nothing", (t) => {
	const seen = markdownClicks(t);
	patched(t);
	densityTerminal(t, 44);
	const component = assistantComponent(false);
	component.updateContent(assistant([thought]), false);
	const lines = plain(component.render(43));
	const body = lines.findIndex((line) => line.startsWith("┃ weigh"));
	const click = (x) =>
		component.handleMouse({
			type: "click",
			button: "left",
			x,
			y: body,
			width: 43,
			height: lines.length,
			screenX: x,
			screenY: body,
		});
	assert.equal(click(1), undefined);
	assert.equal(click(42), undefined);
	assert.ok(click(2)?.handled);
	assert.ok(click(41)?.handled);
	assert.deepEqual(
		seen.map(({ x, width }) => [x, width]),
		[
			[0, 40],
			[39, 40],
		],
	);
});

test("a click on assistant text below 60 terminal columns reaches the text cell under it, and the lane and right margin reach nothing", (t) => {
	const seen = markdownClicks(t);
	patched(t);
	densityTerminal(t, 44);
	const component = assistantComponent(true);
	component.updateContent(assistant([answer]), false);
	component.render(43);
	const click = (x) =>
		component.handleMouse({
			type: "click",
			button: "left",
			x,
			y: 1,
			width: 43,
			height: 2,
			screenX: x,
			screenY: 1,
		});
	assert.equal(click(1), undefined);
	assert.equal(click(42), undefined);
	assert.ok(click(2)?.handled);
	assert.ok(click(5)?.handled);
	assert.deepEqual(
		seen.map(({ x }) => x),
		[0, 3],
	);
});

const reviewWrap =
	"Review the narrow terminal layout before changing the status bar and the wrapping rules for long messages.";
const reviewFull =
	"Review the narrow terminal layout before changing the status bar and the wrapping";
const text = (value) => ({ type: "text", text: value });

test("in a 44-column terminal assistant text wraps at 40 columns and a multi-line message ends its last line with the stamp, or puts it on a row of its own, never on the first line", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const component = assistantComponent(true);
	component.updateContent(assistant([text(reviewWrap)]), false);
	assert.deepEqual(plain(component.render(43)), [
		"",
		"  Review the narrow terminal layout before",
		"  changing the status bar and the wrapping",
		`  rules for long messages.${" ".repeat(8)}11:55 AM`,
	]);
	component.updateContent(assistant([text(reviewFull)]), false);
	assert.deepEqual(plain(component.render(43)), [
		"",
		"  Review the narrow terminal layout before",
		"  changing the status bar and the wrapping",
		`${" ".repeat(34)}11:55 AM`,
	]);
});

test("below 60 terminal columns a one-line assistant message keeps the stamp after its text while it fits and moves it to a row of its own one column later", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const component = assistantComponent(true);
	component.updateContent(
		assistant([text("Review the narrow layout today")]),
		false,
	);
	assert.deepEqual(plain(component.render(43)), [
		"",
		"  Review the narrow layout today  11:55 AM",
	]);
	component.updateContent(
		assistant([text("Review the narrow layout please")]),
		false,
	);
	assert.deepEqual(plain(component.render(43)), [
		"",
		"  Review the narrow layout please".padEnd(42),
		`${" ".repeat(34)}11:55 AM`,
	]);
});

test("below 60 terminal columns a streaming assistant message places its stamp again on every render", (t) => {
	patched(t);
	const terminal = densityTerminal(t, 44);
	const component = assistantComponent(true);
	const stream = (...blocks) => {
		const content = blocks.map((block) =>
			typeof block === "string" ? text(block) : block,
		);
		component.updateContent(assistant(content), true);
		return plain(component.render(43)).slice(1);
	};
	assert.deepEqual(stream("Review the narrow layout today"), [
		"  Review the narrow layout today  11:55 AM",
	]);
	assert.deepEqual(stream("Review the narrow layout please"), [
		"  Review the narrow layout please".padEnd(42),
		`${" ".repeat(34)}11:55 AM`,
	]);
	assert.deepEqual(stream(reviewFull), [
		"  Review the narrow terminal layout before",
		"  changing the status bar and the wrapping",
		`${" ".repeat(34)}11:55 AM`,
	]);
	assert.deepEqual(stream(reviewWrap), [
		"  Review the narrow terminal layout before",
		"  changing the status bar and the wrapping",
		`  rules for long messages.${" ".repeat(8)}11:55 AM`,
	]);
	const parts = stream("First paragraph.", thought, "Final paragraph.");
	const last = `  Final paragraph.${" ".repeat(16)}11:55 AM`;
	assert.deepEqual(
		parts.filter((line) => line.includes("11:55 AM")),
		[last],
	);
	assert.equal(parts.at(-1), last);
	assert.deepEqual(stream("Review the narrow layout please"), [
		"  Review the narrow layout please".padEnd(42),
		`${" ".repeat(34)}11:55 AM`,
	]);
	terminal.columns = 45;
	assert.deepEqual(plain(component.render(44)).slice(1), [
		"  Review the narrow layout please  11:55 AM",
	]);
});

test("below 60 terminal columns a multi-line user message ends its last line with the stamp, or puts it in the bottom background row", (t) => {
	patched(t);
	densityTerminal(t, 44);
	const fits = userComponent(
		"one two three four five six seven eight nine ten",
	);
	assert.deepEqual(plain(fits.render(43)), [
		" ".repeat(43),
		" ❯ one two three four five six seven eight ",
		`   nine ten${" ".repeat(23)}11:55 AM `,
		" ".repeat(43),
	]);
	const full = userComponent(
		"one two three four five six seven eight one two three four five six seven",
	);
	const lines = full.render(43);
	assert.deepEqual(plain(lines), [
		" ".repeat(43),
		" ❯ one two three four five six seven eight ",
		"   one two three four five six seven".padEnd(43),
		`${" ".repeat(34)}11:55 AM `,
	]);
	const open = `\x1b[48;5;${code("userMessageBg")}m`;
	const close = "\x1b[49m";
	const row = ["A", "B", "C", "D"].reduce(
		(line, mark) => line.replaceAll(`\x1b]133;${mark}\x07`, ""),
		lines[3],
	);
	assert.ok(row.startsWith(open), JSON.stringify(row));
	assert.ok(row.endsWith(close), JSON.stringify(row));
	const band = row.slice(open.length, -close.length);
	for (const reset of [close, "\x1b[0m", "\x1b[m", "\x1b[48;"])
		assert.ok(!band.includes(reset), JSON.stringify(row));
});

test("below 60 terminal columns a click reaches assistant text across the full 40 columns, and the stamp, its own row and the right margin reach nothing", (t) => {
	const seen = markdownClicks(t);
	patched(t);
	densityTerminal(t, 44);
	const component = assistantComponent(true);
	const click = (x, y) =>
		component.handleMouse({
			type: "click",
			button: "left",
			x,
			y,
			width: 43,
			height: 4,
			screenX: x,
			screenY: y,
		});
	component.updateContent(assistant([text(reviewWrap)]), false);
	component.render(43);
	assert.equal(click(42, 1), undefined);
	assert.equal(click(34, 3), undefined);
	assert.equal(click(41, 3), undefined);
	assert.equal(seen.length, 0);
	assert.ok(click(41, 1)?.handled);
	assert.ok(click(25, 3)?.handled);
	component.updateContent(assistant([text(reviewFull)]), false);
	component.render(43);
	assert.equal(click(2, 3), undefined);
	assert.equal(click(34, 3), undefined);
	assert.deepEqual(
		seen.map(({ x, y, width }) => [x, y, width]),
		[
			[39, 0, 40],
			[23, 2, 40],
		],
	);
});

test("a stamped multi-line assistant message crossing 60 terminal columns in both directions switches between the narrow placement and today's first-line stamp", (t) => {
	patched(t);
	const component = assistantComponent(true);
	component.updateContent(assistant([text(reviewWrap)]), false);
	const narrow = [
		"",
		"  Review the narrow terminal layout before",
		"  changing the status bar and the wrapping",
		`  rules for long messages.${" ".repeat(8)}11:55 AM`,
	];
	const wide = [
		"",
		`   Review the narrow terminal layout before${" ".repeat(5)}11:55 AM`,
		`   changing the status bar and the wrapping${" ".repeat(3)}`,
		`   rules for long messages.${" ".repeat(19)}`,
	];
	const terminal = densityTerminal(t, 59);
	assert.deepEqual(plain(component.render(43)), narrow);
	terminal.columns = 60;
	assert.deepEqual(plain(component.render(59)), wide);
	terminal.columns = 59;
	assert.deepEqual(plain(component.render(43)), narrow);
	terminal.columns = 60;
	assert.deepEqual(plain(component.render(59)), wide);
});

test("below 60 terminal columns every rendered line fits the width down to 3 columns", (t) => {
	patched(t);
	const terminal = densityTerminal(t, 59);
	const long =
		"A reasonably long sentence that has to wrap across several lines at narrow widths without overflowing.";
	const user = userComponent(long);
	const expanded = assistantComponent(false);
	expanded.updateContent(
		assistant([
			{ type: "thinking", thinking: long },
			{ type: "text", text: long },
		]),
		false,
	);
	const failed = assistantComponent(true);
	failed.updateContent(
		assistant([], { stopReason: "error", errorMessage: long }),
	);
	const tool = toolRow();
	for (let width = 3; width <= 58; width++) {
		terminal.columns = width + 1;
		for (const component of [user, expanded, failed, tool])
			for (const line of component.render(width))
				assert.ok(
					visibleWidth(line) <= width,
					`${visibleWidth(line)} > ${width}: ${JSON.stringify(line)}`,
				);
	}
});
