import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import {
	CustomMessageComponent,
	InteractiveMode,
	initTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth } from "@earendil-works/pi-tui";

import { toolKind } from "../extensions/chrome-groups.ts";
import {
	patchMessages,
	restoreMessages,
} from "../extensions/chrome-messages.ts";
import { syncCompactTools } from "../extensions/compact-tools.ts";
import { readSelection, replaceSelection } from "../extensions/configure.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

const at1155 = new Date(2026, 8, 29, 11, 55).getTime();
const markdownTheme = new Proxy({}, { get: () => (text) => text });
const plain = (lines) =>
	lines.map((line) => stripVTControlCharacters(line).trimEnd());

const renderers = new Map();

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
	add({ role: "user", content: "Revisa los PR" });
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
	say([thought(), said("Voy a revisar.")]);
	tool("read", { path: "/x/skills/review/SKILL.md" });
	tool("tool_search", { query: "engram" });
	tool("mcp__engram__mem_context", { project: "p" });
	tool("bash", { command: "gh pr view 904" });
	say([thought()]);
	tool("read", { path: "a.ts" });
	tool("grep", { pattern: "TODO" }, { isError: true });
	say([said("Listo.")], "stop");
	assert.deepEqual(body(render()), [
		"   ◆ Thought",
		"",
		"   Voy a revisar.                                                    11:55 AM",
		"",
		"   ◈ Read 1 skill, Searched 1 MCP tool",
		"   ◆ Engram Mem Context",
		"   ◆ Run gh pr view 904",
		"   ◈ Read 1 file, Searched 1 pattern · 1 failed",
		"",
		"   Listo.                                                            11:55 AM",
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
		const heights = container.mouseLayout.children.reduce(
			(sum, entry) => sum + entry.height,
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
		{ role: "assistant", content: [thought()], stopReason: "toolUse", timestamp: at1155 },
		true,
	);
	tool("read", { path: "a.ts" });
	tool("read", { path: "b.ts" });
	const header = render().indexOf("   ◈ Read 2 files");
	assert.ok(header >= 0);
	assert.ok(click(container, 80, header)?.handled);
	message.updateContent(
		{ role: "assistant", content: [thought()], stopReason: "toolUse", timestamp: at1155 },
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
	reloaded.patchChat(mode.chatContainer, () => 3);
	t.after(reloaded.restoreChat);
	const lines = render();
	assert.equal(lines[header], "   ◈ Read 2 files");
	assert.ok(lines.includes("   ◆ Read a.ts"));
	assert.ok(click(mode.chatContainer, 80, header)?.handled);
	const closed = render();
	assert.ok(!closed.some((line) => line.includes("◆ Thought")));
	assert.ok(!closed.includes("   ◆ Read a.ts"));
});

const result = (id, state = "completed", text = "Listo.") => ({
	id: `${id}-0000-4000-8000-000000000000`,
	state,
	role: "worker",
	model: "openai/gpt-6-luna",
	thinking: "high",
	task: "Revisa el parser",
	elapsedMs: 62_000,
	text,
});

test("consecutive subagent result cards fold into one ◈ row that counts the failures, while a lone card and a question stay visible", (t) => {
	const { mode, say, card, render } = chat(t);
	const container = mode.chatContainer;
	card("pi-workflow-child-result", result("1111"));
	say([said("Sigo.")], "stop");
	card("pi-workflow-child-result", result("2222"));
	card("pi-workflow-child-result", result("3333", "failed", "no activity"));
	card("pi-workflow-child-result", result("4444"));
	card("pi-workflow-child-question", {
		...result("5555", "waiting", "¿Sigo?"),
		question: 2,
	});
	const closed = render();
	assert.ok(
		closed.includes("   ◆ Subagent worker 1111  1m 02s"),
	);
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
		const heights = container.mouseLayout.children.reduce(
			(sum, entry) => sum + entry.height,
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
