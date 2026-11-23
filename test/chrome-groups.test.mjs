import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

import {
	BashExecutionComponent,
	CustomMessageComponent,
	getMarkdownTheme,
	InteractiveMode,
	initTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Markdown,
	ScrollView,
	setCapabilityOverrides,
	TuiAltScreen,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createAdvisor } from "../extensions/advisor.ts";
import { toolKind, transcriptCursor } from "../extensions/chrome-groups.ts";
import { createChromeEditor } from "../extensions/chrome-editor.ts";
import {
	patchMessages,
	restoreMessages,
} from "../extensions/chrome-messages.ts";
import {
	compactToolRenderers,
	syncCompactTools,
} from "../extensions/compact-tools.ts";
import { readSelection } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { densityTerminal } from "./support/density-terminal.mjs";
import { writeAdvisorModel } from "./support/advisor-model.mjs";

const at1155 = new Date(2026, 8, 29, 11, 55).getTime();
const markdownTheme = new Proxy({}, { get: () => (text) => text });
const plain = (lines) =>
	lines.map((line) => stripVTControlCharacters(line).trimEnd());

const renderers = new Map();
const pristineMouse = ToolExecutionComponent.prototype.handleMouse;

function loadSession() {
	const tools = new Map();
	const resolvers = [];
	const pi = {
		on() {},
		registerCommand() {},
		registerShortcut() {},
		registerMessageRenderer: (type, render) => renderers.set(type, render),
		registerToolRenderer: (resolver) => resolvers.push(resolver),
		registerProvider() {},
		registerTool: (tool) => tools.set(tool.name, tool),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	};
	const preview = readSelection(undefined, []);
	if (preview.status === "ready") replaceSelection(preview.selection);
	piWorkflowExtension(pi);
	syncCompactTools(pi, { cwd: process.cwd(), isProjectTrusted: () => false });
	return {
		getToolDefinition: (name) => tools.get(name),
		extensionRunner: {
			resolveToolRenderers: (name, base) =>
				resolvers.reduceRight(
					(next, resolver) => () => resolver(name, next),
					base,
				)(),
		},
	};
}

function chat(t, { hideThinking = true } = {}) {
	initTheme("dark", false);
	patchMessages();
	t.after(restoreMessages);
	const session = loadSession();
	const ui = { requestRender() {} };
	const mode = {
		chatContainer: new Container(),
		getUserMessageText: (message) => message.content,
		getMarkdownThemeWithSettings: () => markdownTheme,
		getMarkdownTransformers: () => [],
		outputPad: 1,
		session,
	};
	const add = (message) =>
		InteractiveMode.prototype.addMessageToChat.call(mode, {
			timestamp: at1155,
			...message,
		});
	add({ role: "user", content: "Review the PRs" });
	const say = (content, stopReason = "toolUse") => {
		add({ role: "assistant", content, stopReason });
		const [component] = mode.chatContainer.children.slice(-1);
		if (hideThinking) component.setHideThinkingBlock(true);
		return component;
	};
	const tool = (
		name,
		args,
		{ text = "ok", isError = false, done = true } = {},
	) => {
		const component = new ToolExecutionComponent(
			name,
			`call-${mode.chatContainer.children.length}`,
			args,
			{ showImages: false },
			InteractiveMode.prototype.getRegisteredToolDefinition.call(mode, name),
			ui,
			"/",
		);
		if (done)
			component.updateResult(
				{ content: [{ type: "text", text }], isError },
				false,
			);
		mode.chatContainer.addChild(component);
		return component;
	};
	const card = (customType, details) => {
		const component = new CustomMessageComponent(
			{ role: "custom", customType, content: "", details, display: true },
			renderers.get(customType),
			markdownTheme,
			1,
		);
		mode.chatContainer.addChild(component);
		return component;
	};
	const render = (width = 80) => plain(mode.chatContainer.render(width));
	return { mode, say, tool, card, render };
}

const thought = (text = "think") => ({ type: "thinking", thinking: text });
const said = (text) => ({ type: "text", text });

function body(lines) {
	return lines.slice(lines.findIndex((line) => line.includes("◆ Thought")));
}

function click(container, width, row) {
	container.render(width);
	return container.handleMouse({
		type: "click",
		button: "left",
		x: 5,
		y: row,
		width,
		height: 1000,
		screenX: 5,
		screenY: row,
	});
}

test("Pi tool names map onto Grok's verb buckets", () => {
	assert.equal(toolKind("read", { path: "a.ts" }), "file");
	assert.equal(
		toolKind("read", { path: "/x/skills/review/SKILL.md" }),
		"skill",
	);
	assert.equal(toolKind("grep", {}), "search");
	assert.equal(toolKind("find", {}), "search");
	assert.equal(toolKind("ls", {}), "dir");
	assert.equal(toolKind("tool_search", {}), "mcpSearch");
	assert.equal(toolKind("spawn_child", {}), "subagent");
	assert.equal(toolKind("bash", {}), "command");
	assert.equal(toolKind("edit", {}), "edit");
	assert.equal(toolKind("write", {}), "edit");
	assert.equal(toolKind("mcp__engram__mem_search", {}), "mcp");
	assert.equal(toolKind("ask_user_choice", {}), "question");
	assert.equal(toolKind("codemode", {}), "script");
	assert.equal(toolKind("codegraph", {}), "tool");
});

test("read-only tools and the thoughts between them fold into one ◈ row while commands and MCP calls stay contiguous rows", (t) => {
	const { say, tool, render } = chat(t);
	say([thought(), said("Taking a look.")]);
	tool("read", { path: "/x/skills/review/SKILL.md" });
	tool("tool_search", { query: "engram" });
	tool("mcp__engram__mem_context", { project: "p" });
	tool("bash", { command: "gh pr view 904" });
	say([thought()]);
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { isError: true });
	say([said("Ready.")], "stop");
	assert.deepEqual(body(render()), [
		"   ◆ Thought",
		"",
		"   Taking a look.                                                    11:55 AM",
		"",
		"   ◈ Read 1 skill, Searched 1 MCP tool",
		"   ◆ Engram Mem Context",
		"   ◆ Run gh pr view 904",
		"   ◈ Read 1 file, Searched 1 pattern · 1 failed",
		"",
		"   Ready.                                                            11:55 AM",
	]);
});

test("a running member switches the header to the present tense", (t) => {
	const { tool, render } = chat(t);
	tool("read", { path: "a.ts" });
	const second = tool("read", { path: "b.ts" }, { done: false });
	assert.ok(render().includes("   ◈ Reading 2 files"));
	second.updateResult({ content: [{ type: "text", text: "ok" }] }, false);
	assert.ok(render().includes("   ◈ Read 2 files"));
});

test("each kind in a header keeps its own tense while another kind runs", (t) => {
	const { tool, render } = chat(t);
	tool("read", { path: "a.ts" });
	const search = tool("grep", { pattern: "TODO" }, { done: false });
	assert.ok(render().includes("   ◈ Read 1 file, Searching 1 pattern"));
	search.updateResult({ content: [{ type: "text", text: "ok" }] }, false);
	assert.ok(render().includes("   ◈ Read 1 file, Searched 1 pattern"));
});

test("a run longer than eleven rows folds its oldest rows into a ◈ header and keeps the last ten", (t) => {
	const { say, tool, render } = chat(t);
	say([thought()]);
	for (let i = 0; i < 12; i++) tool("bash", { command: `echo ${i}` });
	const lines = render();
	const header = lines.indexOf("   ◈ Ran 2 commands");
	assert.deepEqual(lines.slice(header, header + 3), [
		"   ◈ Ran 2 commands",
		"   ◆ Run echo 2",
		"   ◆ Run echo 3",
	]);
	assert.equal(lines.filter((line) => line.startsWith("   ◆ Run")).length, 10);
	assert.ok(!lines.slice(header).includes(""));
	assert.ok(!lines.some((line) => line.includes("◆ Thought")));
});

test("ctrl+o expands every tool, which dissolves the groups and restores the gaps around full output", (t) => {
	const { mode, tool, render } = chat(t);
	tool("read", { path: "a.ts" }, { text: "alpha" });
	tool("read", { path: "b.ts" }, { text: "beta" });
	for (const child of mode.chatContainer.children)
		if (child instanceof ToolExecutionComponent) child.setExpanded(true);
	const lines = render();
	assert.ok(!lines.some((line) => line.includes("◈")));
	assert.ok(lines.some((line) => line.includes("alpha")));
	assert.ok(lines.some((line) => line.includes("beta")));
	const second = lines.findIndex((line) => line.includes("read b.ts"));
	assert.equal(lines[second - 1], "");
});

test("the mouse layout matches the folded lines, a header click opens the group and a member click reaches its tool", (t) => {
	const { mode, tool, render } = chat(t);
	const container = mode.chatContainer;
	tool("read", { path: "a.ts" });
	const member = tool("grep", { pattern: "TODO" }, { text: "hit" });
	const command = tool("bash", { command: "ls" }, { text: "files" });
	for (let width = 10; width <= 160; width++) {
		const lines = container.render(width);
		const heights = container.childLines.parts.reduce(
			(sum, part) => sum + part.length,
			0,
		);
		assert.equal(heights, lines.length, `width ${width}`);
		for (const line of lines)
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
	}
	const closed = render();
	const header = closed.indexOf("   ◈ Read 1 file, Searched 1 pattern");
	const bash = closed.indexOf("   ◆ Run ls");
	assert.equal(bash, header + 1);
	assert.ok(click(container, 80, bash)?.handled);
	assert.equal(command.expanded, true);
	command.setExpanded(false);
	assert.ok(click(container, 80, header)?.handled);
	const open = render();
	assert.deepEqual(open.slice(header, header + 4), [
		"   ◈ Read 1 file, Searched 1 pattern",
		"   ◆ Read a.ts",
		"   ◆ Search TODO",
		"   ◆ Run ls",
	]);
	assert.ok(click(container, 80, header + 2)?.handled);
	assert.equal(member.expanded, true);
	member.setExpanded(false);
	assert.ok(click(container, 80, header)?.handled);
	assert.deepEqual(render(), closed);
});

test("the fold survives a rebuild and restore puts Pi's container render back", (t) => {
	const { mode, tool, render } = chat(t);
	tool("read", { path: "a.ts" });
	assert.ok(render().includes("   ◈ Read 1 file"));
	mode.chatContainer.clear();
	tool("ls", { path: "src" });
	assert.ok(render().includes("   ◈ Listed 1 dir"));
	restoreMessages();
	assert.equal(mode.chatContainer.render, Container.prototype.render);
	assert.ok(render().some((line) => line.includes("List src")));
});

test("expanding the first member of an opened group keeps its siblings open and still counts it", (t) => {
	const { mode, tool, render } = chat(t);
	const container = mode.chatContainer;
	const first = tool("read", { path: "a.ts" }, { text: "alpha" });
	tool("read", { path: "b.ts" });
	tool("read", { path: "c.ts" });
	const header = render().indexOf("   ◈ Read 3 files");
	assert.ok(click(container, 80, header)?.handled);
	assert.ok(click(container, 80, header + 1)?.handled);
	assert.equal(first.expanded, true);
	const lines = render();
	assert.equal(lines[header], "   ◈ Read 3 files");
	assert.ok(lines.some((line) => line.includes("alpha")));
	assert.ok(lines.includes("   ◆ Read b.ts"));
	assert.ok(lines.includes("   ◆ Read c.ts"));
	first.setExpanded(false);
	assert.ok(click(container, 80, header)?.handled);
	first.setExpanded(true);
	const closed = render();
	assert.equal(closed[header], "   ◈ Read 3 files");
	assert.ok(closed.some((line) => line.includes("alpha")));
	assert.ok(!closed.includes("   ◆ Read b.ts"));
});

test("a leading thought that stops running keeps its opened group open", (t) => {
	const { mode, say, tool, render } = chat(t);
	const container = mode.chatContainer;
	const message = say([thought()]);
	message.updateContent(
		{
			role: "assistant",
			content: [thought()],
			stopReason: "toolUse",
			timestamp: at1155,
		},
		true,
	);
	tool("read", { path: "a.ts" });
	tool("read", { path: "b.ts" });
	const header = render().indexOf("   ◈ Read 2 files");
	assert.ok(header >= 0);
	assert.ok(click(container, 80, header)?.handled);
	message.updateContent(
		{
			role: "assistant",
			content: [thought()],
			stopReason: "toolUse",
			timestamp: at1155,
		},
		false,
	);
	const lines = render();
	assert.ok(lines.includes("   ◆ Read a.ts"));
	assert.ok(lines.includes("   ◆ Read b.ts"));
});

test("a reloaded module instance folds the thoughts and keeps the groups the previous instance opened", async (t) => {
	const { mode, say, tool, render } = chat(t);
	say([thought()]);
	tool("read", { path: "a.ts" });
	tool("read", { path: "b.ts" });
	const header = render().indexOf("   ◈ Read 2 files");
	assert.ok(click(mode.chatContainer, 80, header)?.handled);
	const reloaded = await import("../extensions/chrome-groups.ts?reload");
	reloaded.patchChat(mode.chatContainer, () => ({ left: 3, right: 3 }));
	t.after(reloaded.restoreChat);
	const lines = render();
	assert.equal(lines[header], "   ◈ Read 2 files");
	assert.ok(lines.includes("   ◆ Read a.ts"));
	assert.ok(click(mode.chatContainer, 80, header)?.handled);
	const closed = render();
	assert.ok(!closed.some((line) => line.includes("◆ Thought")));
	assert.ok(!closed.includes("   ◆ Read a.ts"));
});

const result = (id, state = "completed", text = "Ready.") => ({
	id: `${id}-0000-4000-8000-000000000000`,
	state,
	role: "worker",
	model: "openai/gpt-6-luna",
	thinking: "high",
	task: "Review the parser",
	elapsedMs: 62_000,
	text,
});

test("consecutive subagent result cards fold into one ◈ row that counts the failures, while a lone card and a question stay visible", (t) => {
	const { mode, say, card, render } = chat(t);
	const container = mode.chatContainer;
	card("pi-workflow-child-result", result("1111"));
	say([said("On it.")], "stop");
	card("pi-workflow-child-result", result("2222"));
	card("pi-workflow-child-result", result("3333", "failed", "no activity"));
	card("pi-workflow-child-result", result("4444"));
	card("pi-workflow-child-question", {
		...result("5555", "waiting", "Go on?"),
		question: 2,
	});
	const closed = render();
	assert.ok(closed.includes("   ◆ Subagent worker 1111  1m 02s"));
	const header = closed.indexOf("   ◈ Ran 3 subagents · 1 failed");
	assert.ok(header > 0);
	assert.ok(!closed.some((line) => line.includes("worker 2222")));
	assert.equal(closed[header + 1], "");
	assert.equal(
		closed[header + 2],
		"   ◆ Subagent worker 5555 asks · question 2",
	);
	for (let width = 10; width <= 160; width++) {
		const lines = container.render(width);
		const heights = container.childLines.parts.reduce(
			(sum, part) => sum + part.length,
			0,
		);
		assert.equal(heights, lines.length, `width ${width}`);
		for (const line of lines)
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
	}
	assert.ok(click(container, 80, header)?.handled);
	assert.deepEqual(render().slice(header, header + 5), [
		"   ◈ Ran 3 subagents · 1 failed",
		"   ◆ Subagent worker 2222  1m 02s",
		"   ◆ Subagent worker 3333 failed  1m 02s",
		"     no activity",
		"   ◆ Subagent worker 4444  1m 02s",
	]);
	assert.ok(click(container, 80, header)?.handled);
	for (const child of container.children)
		if (child instanceof CustomMessageComponent) child.setExpanded(true);
	const expanded = render();
	assert.ok(!expanded.some((line) => line.includes("◈")));
	assert.ok(expanded.some((line) => line.includes("worker 2222")));
});

function mouse(container, width, type, row, x = 5) {
	container.render(width);
	return container.handleMouse({
		type,
		button: type === "move" ? "none" : "left",
		x,
		y: row,
		width,
		height: 1000,
		screenX: x,
		screenY: row,
	});
}

test("the blank line above a row and the margin columns reach the row", (t) => {
	const { mode, say, tool, render } = chat(t);
	const container = mode.chatContainer;
	say([thought(), said("Looking.")]);
	const command = tool("bash", { command: "ls" }, { text: "one\ntwo" });
	const rows = render();
	const run = rows.indexOf("   ◆ Run ls");
	assert.equal(rows[run - 1], "");
	assert.ok(mouse(container, 80, "click", run - 1)?.handled);
	assert.equal(command.expanded, true);
	command.setExpanded(false);
	assert.ok(mouse(container, 80, "click", run, 0)?.handled);
	assert.equal(command.expanded, true);
	command.setExpanded(false);
	assert.ok(mouse(container, 80, "click", run, 79)?.handled);
	assert.equal(command.expanded, true);
});

test("an open row collapses from its header only, so its body stays selectable", (t) => {
	const { mode, say, tool, render } = chat(t);
	const container = mode.chatContainer;
	say([thought("first step\n\nsecond step"), said("Looking.")]);
	const command = tool("bash", { command: "ls" }, { text: "one\ntwo" });
	command.setExpanded(true);
	const rows = render();
	const head = rows.indexOf("   ┃ $ ls");
	assert.equal(mouse(container, 80, "click", head + 2), undefined);
	assert.equal(command.expanded, true);
	assert.ok(mouse(container, 80, "click", head)?.handled);
	assert.equal(command.expanded, false);
	const thinking = render().indexOf("   ◆ Thought");
	assert.ok(mouse(container, 80, "click", thinking)?.handled);
	const open = render();
	const step = open.findIndex((line) => line.includes("second step"));
	assert.ok(step > thinking);
	assert.equal(mouse(container, 80, "click", step), undefined);
	assert.ok(render().some((line) => line.includes("second step")));
});

test("hovering a clickable row points at it and leaving it restores the glyph", (t) => {
	const { mode, say, tool, render } = chat(t);
	const container = mode.chatContainer;
	say([thought(), said("Looking.")]);
	tool("bash", { command: "ls" }, { text: "one" });
	const run = render().indexOf("   ◆ Run ls");
	assert.ok(mouse(container, 80, "move", run - 1)?.handled);
	assert.equal(render()[run], "   ▸ Run ls");
	assert.equal(mouse(container, 80, "move", run), undefined);
	const text = render().findIndex((line) => line.includes("Looking."));
	assert.ok(mouse(container, 80, "move", text)?.handled);
	assert.equal(render()[run], "   ◆ Run ls");
	assert.equal(mouse(container, 80, "move", text), undefined);
});

const shows = (rows, text) => rows.some((line) => line.trimEnd() === text);

test("the transcript cursor starts at the last clickable row, moves between rows, and toggles the one it selects", (t) => {
	const { mode, say, tool, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	say([thought(), said("Looking.")]);
	const first = tool("bash", { command: "ls" }, { text: "one" });
	say([said("Then.")]);
	tool("bash", { command: "pwd" }, { text: "/" });
	render();
	assert.equal(transcriptCursor.active(), false);
	assert.ok(transcriptCursor.move(-1));
	assert.equal(transcriptCursor.active(), true);
	assert.ok(shows(render(), "   ▸ Run pwd"));
	assert.ok(transcriptCursor.move(-1));
	const rows = render();
	assert.ok(shows(rows, "   ▸ Run ls"));
	assert.ok(shows(rows, "   ◆ Run pwd"));
	assert.ok(transcriptCursor.toggle());
	assert.equal(first.expanded, true);
	const expanded = mode.chatContainer.render(80);
	const head = expanded.findIndex((line) => line.includes("$ ls"));
	const background = "\u001b[48";
	assert.ok(expanded[head].includes(background));
	assert.ok(!(expanded[head + 1] ?? "").includes(background));
	assert.ok(transcriptCursor.toggle());
	assert.equal(first.expanded, false);
	assert.ok(transcriptCursor.move(-1));
	assert.ok(shows(render(), "   ▸ Thought"));
	assert.ok(transcriptCursor.move(-1));
	assert.ok(shows(render(), "   ▸ Thought"));
	transcriptCursor.leave();
	assert.equal(transcriptCursor.active(), false);
	assert.ok(!render().some((line) => line.includes("▸")));
	assert.equal(mode.chatContainer.children.length > 0, true);
});

test("hover and the transcript cursor point at an advisor card's ◇ head as they do at ◆ rows", (t) => {
	const dir = withAgentDirectory(t);
	writeAdvisorModel(dir, {
		model: "anthropic/claude-opus-5",
		thinking: "high",
	});
	let advisor;
	createAdvisor(dir).offer({
		registerTool: (definition) => {
			advisor = definition;
		},
	});
	const { mode, say, tool, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	const container = mode.chatContainer;
	say([said("Looking.")]);
	tool("bash", { command: "ls" }, { text: "one" });
	say([said("Asking.")]);
	const card = new ToolExecutionComponent(
		"advisor",
		"call-advisor",
		{},
		{ showImages: false },
		compactToolRenderers("advisor", () => advisor),
		{ requestRender() {} },
		"/",
	);
	card.updateResult(
		{
			content: [{ type: "text", text: "Sound." }],
			details: { model: "anthropic/claude-opus-5", thinking: "high" },
			isError: false,
			durationMs: 9_000,
		},
		false,
	);
	container.addChild(card);
	const head = "   ◇ Advisor  9s · claude-opus-5 (high)";
	const row = render().indexOf(head);
	assert.ok(row > 0);
	assert.ok(mouse(container, 80, "move", row - 1)?.handled);
	assert.equal(render()[row], "   ▸ Advisor  9s · claude-opus-5 (high)");
	const text = render().findIndex((line) => line.includes("Asking."));
	assert.ok(mouse(container, 80, "move", text)?.handled);
	assert.equal(render()[row], head);
	assert.ok(transcriptCursor.move(-1));
	assert.ok(shows(render(), "   ▸ Advisor  9s · claude-opus-5 (high)"));
	assert.ok(transcriptCursor.toggle());
	assert.equal(card.expanded, true);
	assert.ok(transcriptCursor.toggle());
	assert.equal(card.expanded, false);
	assert.ok(transcriptCursor.move(-1));
	const rows = render();
	assert.ok(shows(rows, "   ▸ Run ls"));
	assert.ok(shows(rows, head));
});

test("moving the cursor off screen scrolls the transcript to it, and leaving returns to the end", (t) => {
	const { mode, say, tool, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	say([said("Start.")]);
	tool("bash", { command: "ls" }, { text: "one" });
	for (let i = 0; i < 30; i++) say([said(`Line ${i}.`)]);
	const total = render().length;
	const calls = [];
	mode.transcriptScrollView = {
		contentHeight: total + 2,
		scrollTop: total + 2 - 10,
		viewportHeight: 10,
		isFollowingEnd: true,
		scrollTo: (top, options) => calls.push(["to", top, options]),
		scrollToEnd: () => calls.push(["end"]),
	};
	assert.ok(transcriptCursor.move(-1));
	const run = render().findIndex((line) => line.trimEnd() === "   ▸ Run ls");
	assert.deepEqual(calls, [["to", 2 + run - 3, { disableFollow: true }]]);
	transcriptCursor.leave();
	assert.deepEqual(calls.at(-1), ["end"]);
});

test("while the cursor is active the editor moves, toggles and leaves it, and other keys reach the input", (t) => {
	const { tool, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	const command = tool("bash", { command: "ls" }, { text: "one" });
	tool("bash", { command: "pwd" }, { text: "/" });
	render();
	const input = createChromeEditor(
		{ terminal: { rows: 40 }, requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{
			theme: () => ({ fg: (_c, x) => x, bold: (x) => x, bg: (_c, x) => x }),
			label: () => "m",
		},
	);
	input.focused = true;
	input.handleInput("x");
	assert.equal(input.getText(), "x");
	assert.ok(transcriptCursor.move(-1));
	input.handleInput("\x1b[A");
	assert.ok(shows(render(), "   ▸ Run ls"));
	input.handleInput("\r");
	assert.equal(command.expanded, true);
	input.handleInput(" ");
	assert.equal(command.expanded, false);
	input.handleInput("\x1b");
	assert.equal(transcriptCursor.active(), false);
	assert.equal(input.getText(), "x");
	assert.ok(transcriptCursor.move(-1));
	input.handleInput("y");
	assert.equal(transcriptCursor.active(), false);
	assert.equal(input.getText(), "xy");
});

test("a Copy control inside an open thought receives the click, and the rest of the body neither collapses nor captures it", (t) => {
	const render = Markdown.prototype.render;
	const original = Markdown.prototype.handleMouse;
	const pressed = [];
	Markdown.prototype.render = function (width) {
		const lines = render.call(this, width);
		if (this.text?.includes("alpha")) lines[0] = `[Copy]${lines[0].slice(6)}`;
		return lines;
	};
	Markdown.prototype.handleMouse = function (event) {
		if (!this.text?.includes("alpha")) return original?.call(this, event);
		if (event.type === "press" && event.y === 0 && event.x < 6) {
			pressed.push(event);
			return { capture: true, render: false };
		}
		return undefined;
	};
	t.after(() => {
		Markdown.prototype.render = render;
		if (original === undefined) delete Markdown.prototype.handleMouse;
		else Markdown.prototype.handleMouse = original;
	});
	const { mode, say, render: rows } = chat(t);
	const container = mode.chatContainer;
	say([thought("```text\nalpha\nbeta\n```"), said("Done.")]);
	assert.ok(
		mouse(container, 80, "click", rows().indexOf("   ◆ Thought"))?.handled,
	);
	const open = rows();
	const copy = open.findIndex((line) => line.includes("[Copy]"));
	assert.ok(copy > 0);
	const col = open[copy].indexOf("[Copy]");
	assert.equal(mouse(container, 80, "press", copy, col)?.capture, true);
	assert.equal(pressed.length, 1);
	const beta = open.findIndex((line) => line.includes("beta"));
	assert.equal(mouse(container, 80, "click", beta), undefined);
	assert.deepEqual(rows(), open);
});

function asked(mode, question, label) {
	const component = new ToolExecutionComponent(
		"ask_user_question",
		"call-asked",
		{ question },
		{ showImages: false },
		InteractiveMode.prototype.getRegisteredToolDefinition.call(
			mode,
			"ask_user_question",
		),
		{ requestRender() {} },
		"/",
	);
	component.updateResult(
		{
			content: [{ type: "text", text: label }],
			details: { status: "answered", kind: "option", label },
			isError: false,
		},
		false,
	);
	mode.chatContainer.addChild(component);
	return component;
}

function transcript(t) {
	const session = chat(t);
	const { mode, say, tool, card } = session;
	say([thought(), said("Looking.")]);
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { text: "hit" });
	tool("bash", { command: "ls" }, { text: "one" });
	asked(mode, "Which rollout?", "Gradual rollout");
	card("pi-workflow-child-result", result("1111"));
	return session;
}

test("below 60 terminal columns every transcript block puts its glyph in the 2-column lane and its body at the same column", (t) => {
	const { render } = transcript(t);
	densityTerminal(t, 44);
	const lines = render(43);
	for (const expected of [
		"◆ Thought",
		"◈ Read 1 file, Searched 1 pattern",
		"◆ Run ls",
		"◆ Subagent worker 1111  1m 02s",
	])
		assert.ok(lines.includes(expected), `${expected}\n${lines.join("\n")}`);
	const asked = lines.indexOf("◆ Asked Which rollout?");
	assert.equal(lines[asked + 1], "↳ Gradual rollout");
	assert.ok(lines.some((line) => /^ {2}Looking\. +11:55 AM$/.test(line)));
	assert.ok(lines.some((line) => line.startsWith(" ❯ Review the PRs")));
});

test("in a 44-column terminal, with or without the scrollbar, no transcript block nor the selection paints the last column except the user message background", (t) => {
	const { mode } = transcript(t);
	t.after(() => transcriptCursor.leave());
	densityTerminal(t, 44);
	mode.chatContainer.render(43);
	assert.ok(transcriptCursor.move(-1));
	const painted = (line) => visibleWidth(line.replace(/ +$/, ""));
	for (const available of [43, 44]) {
		const lines = mode.chatContainer.render(available);
		const prompt = plain(lines).findIndex((line) =>
			line.startsWith(" ❯ Review the PRs"),
		);
		const user = new Set([prompt - 1, prompt, prompt + 1]);
		const selection = lines.findIndex((line) => line.includes("▸"));
		assert.ok(lines[selection].includes("\x1b[48;"), lines[selection]);
		assert.equal(painted(lines[selection]), available - 1);
		lines.forEach((line, i) => {
			if (user.has(i)) {
				assert.ok(line.includes("\x1b[48;"), line);
				assert.equal(visibleWidth(line), available);
			} else assert.ok(painted(line) <= available - 1, `${available}: ${line}`);
		});
	}
});

test("crossing 60 terminal columns in both directions moves the same Asked answer arrow into the lane and back", (t) => {
	const { render } = transcript(t);
	const terminal = densityTerminal(t, 60);
	const arrow = [];
	for (const columns of [60, 44, 60]) {
		terminal.columns = columns;
		const lines = render(columns - 1);
		const answer = lines.find((line) => line.includes("↳ Gradual rollout"));
		arrow.push(answer.indexOf("↳"));
	}
	assert.deepEqual(arrow, [5, 0, 5]);
});

test("at 60 and 100 terminal columns the selection background reaches the last column", (t) => {
	const { mode } = transcript(t);
	t.after(() => transcriptCursor.leave());
	const terminal = densityTerminal(t, 60);
	mode.chatContainer.render(59);
	assert.ok(transcriptCursor.move(-1));
	for (const [columns, widths] of [
		[60, [59, 60]],
		[100, [99, 100]],
	]) {
		terminal.columns = columns;
		for (const width of widths) {
			const lines = mode.chatContainer.render(width);
			const selection = lines.find((line) => line.includes("▸"));
			assert.ok(selection.startsWith("\x1b[48;"), selection);
			assert.equal(selection.indexOf("\x1b[49m"), selection.length - 5);
			assert.equal(visibleWidth(selection), width, `${width} in ${columns}`);
		}
	}
});

function advisorRow(t, durationMs) {
	const dir = withAgentDirectory(t);
	writeAdvisorModel(dir, {
		model: "anthropic/claude-opus-5",
		thinking: "high",
	});
	let advisor;
	createAdvisor(dir).offer({
		registerTool: (definition) => {
			advisor = definition;
		},
	});
	const row = new ToolExecutionComponent(
		"advisor",
		"call-advisor",
		{},
		{ showImages: false },
		compactToolRenderers("advisor", () => advisor),
		{ requestRender() {} },
		"/",
	);
	row.updateResult(
		{
			content: [{ type: "text", text: "Sound." }],
			details: { model: "anthropic/claude-opus-5", thinking: "high" },
			isError: false,
			durationMs,
		},
		false,
	);
	return row;
}

function explorationBudgetNotice() {
	return new CustomMessageComponent(
		{
			role: "custom",
			customType: "pi-workflow-exploration-budget",
			content: "Continue discovery in an explore child.",
			details: { lookups: 40, textBytes: 120_000 },
			display: true,
		},
		renderers.get("pi-workflow-exploration-budget"),
		markdownTheme,
		1,
	);
}

function wideTranscript(t) {
	setCapabilityOverrides({ trueColor: true, hyperlinks: false });
	t.after(() => setCapabilityOverrides({}));
	const session = chat(t);
	const { mode, say, tool, card } = session;
	const ui = { requestRender() {} };
	say([thought(), said("Looking.")]);
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { text: "hit" });
	tool("bash", { command: "ls" }, { text: "one" });
	asked(mode, "Which rollout?", "Gradual rollout");
	card("pi-workflow-child-result", { ...result("1111"), elapsedMs: 42_000 });
	say([said("Checking.")], "stop");
	const bash = new BashExecutionComponent("ls", ui);
	bash.appendOutput("hello world");
	bash.setComplete(0, false);
	mode.chatContainer.addChild(bash);
	mode.chatContainer.addChild(advisorRow(t, 15_000));
	mode.chatContainer.addChild(explorationBudgetNotice());
	return session;
}

const wideBytes = JSON.parse(
	readFileSync(new URL("./fixtures/wide-render.json", import.meta.url), "utf8"),
);

test("at 60 and 100 terminal columns the transcript renders the base's bytes", (t) => {
	const { mode } = wideTranscript(t);
	const terminal = densityTerminal(t, 60);
	for (const [columns, widths] of [
		[60, [59, 60]],
		[100, [99, 100]],
	]) {
		terminal.columns = columns;
		for (const width of widths)
			assert.deepEqual(
				mode.chatContainer.render(width),
				wideBytes.transcript[width],
				`${width} in ${columns}`,
			);
	}
});

const markdownAnswer = [
	"Plan:",
	"",
	"- one",
	"  - two",
	"    - three deep item that wraps across a phone width",
	"- four",
	"",
	"```ts",
	"const answer = compute(1, 2);",
	"  return answer;",
	"const veryLongIdentifierNameThatCannotBreakAnywhereAtAll = 1;",
	"```",
	"",
	"| Key | Value |",
	"| --- | ----- |",
	"| a   | one   |",
].join("\n");

test("at 60 and 100 terminal columns assistant Markdown lists, code blocks and tables render the base's bytes", (t) => {
	setCapabilityOverrides({ trueColor: true, hyperlinks: false });
	t.after(() => setCapabilityOverrides({}));
	const { mode, say } = chat(t);
	mode.getMarkdownThemeWithSettings = getMarkdownTheme;
	const answer = say([said(markdownAnswer)], "stop");
	const terminal = densityTerminal(t, 60);
	for (const [columns, widths] of [
		[60, [59, 60]],
		[100, [99, 100]],
	]) {
		terminal.columns = columns;
		for (const width of widths)
			assert.deepEqual(
				answer.render(width),
				wideBytes.markdown[width],
				`${width} in ${columns}`,
			);
	}
});

test("below 60 terminal columns a click on a row's last content cell toggles it, and a click on the right margin next to it does not", (t) => {
	const { mode, tool, render } = chat(t);
	densityTerminal(t, 44);
	const command = tool("bash", { command: "ls" }, { text: "one" });
	const run = render(43).indexOf("◆ Run ls");
	assert.equal(mouse(mode.chatContainer, 43, "click", run, 42), undefined);
	assert.equal(command.expanded, false);
	assert.ok(mouse(mode.chatContainer, 43, "click", run, 41)?.handled);
	assert.equal(command.expanded, true);
});

test("below 60 terminal columns a click on the last content cell of a thinking header, group label, result card or runtime notice toggles it, and a click on the right margin next to it does not", (t) => {
	const { mode, say, tool, card, render } = chat(t);
	densityTerminal(t, 44);
	say([thought(), said("Looking.")], "stop");
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { text: "hit" });
	say([said("Next.")], "stop");
	card("pi-workflow-child-result", result("1111"));
	say([said("Then.")], "stop");
	mode.chatContainer.addChild(explorationBudgetNotice());
	for (const head of [
		"◆ Thought",
		"◈ Read 1 file, Searched 1 pattern",
		"◆ Subagent worker 1111",
		"◆ Exploration budget",
	]) {
		const before = render(43);
		const row = before.findIndex((line) => line.startsWith(head));
		assert.ok(row >= 0, `${head}\n${before.join("\n")}`);
		assert.equal(mouse(mode.chatContainer, 43, "click", row, 42), undefined);
		assert.deepEqual(render(43), before, head);
		assert.ok(mouse(mode.chatContainer, 43, "click", row, 41)?.handled, head);
		assert.notDeepEqual(render(43), before, head);
	}
});

test("below 60 terminal columns a group label click opens the group and the keyboard cursor toggles a row at its first content cell", (t) => {
	const seen = [];
	ToolExecutionComponent.prototype.handleMouse = (event) => {
		seen.push(event);
		return { handled: true };
	};
	t.after(() => {
		ToolExecutionComponent.prototype.handleMouse = pristineMouse;
	});
	const { mode, tool, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	densityTerminal(t, 44);
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { text: "hit" });
	tool("bash", { command: "ls" }, { text: "one" });
	const header = render(43).indexOf("◈ Read 1 file, Searched 1 pattern");
	assert.ok(header >= 0);
	assert.ok(mouse(mode.chatContainer, 43, "click", header, 3)?.handled);
	assert.deepEqual(render(43).slice(header, header + 3), [
		"◈ Read 1 file, Searched 1 pattern",
		"◆ Read a.ts",
		"◆ Search TODO",
	]);
	assert.ok(transcriptCursor.move(-1));
	assert.ok(transcriptCursor.toggle());
	assert.deepEqual(
		seen.map(({ x, width }) => [x, width]),
		[[0, 42]],
	);
});

test("crossing 60 terminal columns keeps the selection on a thinking block that follows a paragraph which reflows", (t) => {
	const { say, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	const terminal = densityTerminal(t, 44);
	say(
		[
			thought("first"),
			said(
				"A paragraph long enough to wrap across several rows at any of these widths, so its height changes with the lane.",
			),
			thought("second"),
		],
		"stop",
	);
	render(43);
	assert.ok(transcriptCursor.move(-1));
	const second = (lines) => lines.findLastIndex((line) => /Thought/.test(line));
	for (const columns of [44, 60, 44]) {
		terminal.columns = columns;
		const lines = render(43);
		assert.match(lines[second(lines)], /▸ Thought/, `${columns}`);
		assert.equal(lines.filter((line) => line.includes("▸")).length, 1);
	}
});

test("crossing 60 terminal columns in both directions keeps expanded blocks, open groups, the selection, keyboard focus and a manual scroll position", async (t) => {
	const { mode, say, tool, render } = chat(t);
	t.after(() => transcriptCursor.leave());
	const terminal = densityTerminal(t, 44);
	const scroll = new ScrollView(mode.chatContainer, {
		follow: "end",
		primary: true,
	});
	mode.transcriptScrollView = scroll;
	say([thought(), said("Looking.")], "stop");
	for (let i = 0; i < 6; i++)
		say(
			[
				said(
					`Paragraph ${i} keeps going long enough to wrap over several rows, so the transcript height changes when the lane appears or goes away again.`,
				),
			],
			"stop",
		);
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { text: "hit" });
	const command = tool("bash", { command: "ls" }, { text: "one" });
	const last = tool("bash", { command: "pwd" }, { text: "/" });
	const { tui, editor, press, resize } = await fullscreen(t, terminal, scroll);
	const container = mode.chatContainer;
	const thinking = render(44).indexOf("◆ Thought");
	assert.ok(mouse(container, 44, "click", thinking)?.handled);
	const header = render(44).indexOf("◈ Read 1 file, Searched 1 pattern");
	assert.ok(mouse(container, 44, "click", header)?.handled);
	command.setExpanded(true);
	const frame = async (columns) => {
		await resize(columns);
		const lines = tui.getScreenLines();
		const shown = lines.map((line) => stripVTControlCharacters(line));
		assert.ok(shown.some((line) => line.includes("What should we build")));
		assert.equal(tui.getFocusedComponent(), editor);
		return lines;
	};
	await frame(60);
	assert.ok(transcriptCursor.move(-1));
	scroll.scrollBy(-3);
	const top = scroll.scrollTop;
	assert.ok(top > 0 && !scroll.isFollowingEnd);
	const narrow = await frame(44);
	assert.ok(Math.max(...narrow.map(visibleWidth)) <= 44);
	assert.equal(scroll.scrollTop, top);
	assert.equal(scroll.isFollowingEnd, false);
	press("\r");
	assert.equal(tui.getFocusedComponent(), editor);
	assert.equal(last.expanded, true);
	assert.ok(Math.max(...(await frame(60)).map(visibleWidth)) > 44);
	const wide = render(60).map((line) => line.trimEnd());
	assert.ok(wide.includes("   ┃ ◆ Thought"));
	assert.ok(wide.includes("   ◆ Read a.ts"));
	assert.ok(wide.includes("   ┃ $ ls"));
	assert.equal(scroll.scrollTop, top);
	assert.equal(scroll.isFollowingEnd, false);
	press(" ");
	assert.equal(tui.getFocusedComponent(), editor);
	assert.equal(last.expanded, false);
	assert.deepEqual(await frame(44), narrow);
	assert.equal(command.expanded, true);
	assert.equal(transcriptCursor.active(), true);
});

// The transcript viewport above a focused Chrome editor in Pi's fullscreen
// TUI, whose terminal reads the density terminal's columns. `press` sends a
// key through the terminal input path; `resize` sets the columns, fires the
// terminal's resize and resolves once that frame is written.
async function fullscreen(t, density, scroll) {
	let input;
	let resized;
	let written;
	const frame = () =>
		new Promise((resolve) => {
			written = resolve;
		});
	const terminal = {
		start(onInput, onResize) {
			input = onInput;
			resized = onResize;
		},
		stop() {},
		async drainInput() {},
		write(data) {
			if (data.startsWith("\x1b[?2026h")) written?.();
		},
		get columns() {
			return density.columns;
		},
		rows: 24,
		kittyProtocolActive: false,
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
	};
	const tui = new TuiAltScreen(terminal);
	const editor = createChromeEditor(
		tui,
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false },
		{
			theme: () => ({ fg: (_c, x) => x, bold: (x) => x, bg: (_c, x) => x }),
			label: () => "m",
		},
	);
	tui.addChild(scroll);
	tui.addChild(editor);
	tui.setLayoutRoot(new VStack([{ component: scroll, grow: 1 }, editor]));
	tui.setFocus(editor);
	const first = frame();
	tui.start();
	t.after(() => tui.stop());
	await first;
	return {
		tui,
		editor,
		press: (key) => input(key),
		resize(columns) {
			const shown = frame();
			density.columns = columns;
			resized();
			return shown;
		},
	};
}

function scrollStates(scroll, contents) {
	return contents.map((content) => {
		scroll.updateLayout(content, 8, () => {});
		return [scroll.scrollTop, scroll.isFollowingEnd];
	});
}

test("at a fixed 44 or 100 terminal columns, or resized 44 to 59 or 100 to 60, a manual scroll through a shrink and a regrow behaves as in Pi alone", (t) => {
	const { mode, say } = chat(t);
	const terminal = densityTerminal(t, 44);
	for (const [from, columns] of [
		[44, 44],
		[100, 100],
		[44, 59],
		[100, 60],
	]) {
		terminal.columns = from;
		const views = [0, 1].map(() => {
			const scroll = new ScrollView(new Container(), { follow: "end" });
			scroll.updateLayout(33, 8, () => {});
			scroll.scrollTo(20);
			return scroll;
		});
		mode.transcriptScrollView = views[0];
		say([said(`At ${from}.`)], "stop");
		terminal.columns = columns;
		const native = scrollStates(views[1], [22, 33]);
		assert.deepEqual(native, [
			[14, true],
			[25, true],
		]);
		assert.deepEqual(
			scrollStates(views[0], [22, 33]),
			native,
			`${from}→${columns}`,
		);
	}
});

test("crossing 60 terminal columns that lands a manual scroll position exactly at or clamps it to the end of the transcript does not follow the end, and crossing back restores the original row", (t) => {
	const { mode, say } = chat(t);
	const terminal = densityTerminal(t, 44);
	for (const [contentHeight, expectedAt60] of [
		[23, [15, false]],
		[22, [14, false]],
	]) {
		terminal.columns = 44;
		const scroll = new ScrollView(new Container(), { follow: "end" });
		mode.transcriptScrollView = scroll;
		say([said(`Hooked at ${contentHeight}.`)], "stop");
		scroll.updateLayout(33, 8, () => {});
		scroll.scrollTo(15);
		assert.deepEqual([scroll.scrollTop, scroll.isFollowingEnd], [15, false]);
		terminal.columns = 60;
		assert.deepEqual(
			scrollStates(scroll, [contentHeight]),
			[expectedAt60],
			`${contentHeight}`,
		);
		terminal.columns = 44;
		assert.deepEqual(
			scrollStates(scroll, [33]),
			[[15, false]],
			`${contentHeight}`,
		);
	}
});

test("below 60 terminal columns the advisor card takes the row's lane through the row margin, which a click on its last content cell reaches and a click on the margin does not", (t) => {
	const { mode, render } = chat(t);
	densityTerminal(t, 44);
	const card = advisorRow(t, 9_000);
	mode.chatContainer.addChild(card);
	const lines = render(43);
	const head = lines.findIndex((line) => line.startsWith("◇ Advisor "));
	assert.match(lines[head], /^◇ Advisor {2}\S+ · claude-opus-5 \(high\)$/);
	assert.equal(lines[head + 1], "  Sound.");
	const open = card.expanded;
	assert.equal(mouse(mode.chatContainer, 43, "click", head, 42), undefined);
	assert.equal(card.expanded, open);
	assert.ok(mouse(mode.chatContainer, 43, "click", head, 41)?.handled);
	assert.equal(card.expanded, !open);
});
