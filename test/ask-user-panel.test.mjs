import test from "node:test";
import assert from "node:assert/strict";

import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";

import {
	createAskUserChoiceTool,
	createAskUserPanelState,
	createAskUserQuestionTool,
	registerAskUserQueueCounter,
} from "../extensions/ask-user-panel.ts";

const fakeTheme = {
	fg: (_name, text) => text,
	bold: (text) => text,
};

function noUiContext(mode) {
	return {
		hasUI: mode === "rpc",
		mode,
		ui: {
			custom: () => {
				throw new Error("ui.custom must not be called without a TUI panel");
			},
		},
		getContextUsage: () => undefined,
	};
}

const fakeKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const SPACE = " ";

function tuiContext() {
	let component;
	let resolveDone;
	const donePromise = new Promise((resolve) => {
		resolveDone = resolve;
	});
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			custom: (factory) => {
				component = factory({}, fakeTheme, fakeKeybindings, (result) => resolveDone(result));
				return donePromise;
			},
		},
		getContextUsage: () => ({ tokens: 1234, contextWindow: 200000, percent: 0.6 }),
	};
	return {
		ctx,
		send: (data) => component.handleInput(data),
		render: (width = 80) => component.render(width),
	};
}

test("print mode refuses ask_user_choice without inventing an answer and never opens the panel", async () => {
	const tool = createAskUserChoiceTool(createAskUserPanelState());
	const result = await tool.execute(
		"call-1",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }] },
		undefined,
		undefined,
		noUiContext("print"),
	);
	assert.equal(result.details.status, "refused");
	assert.match(result.content[0].text, /Refused/);
});

test("a session with hasUI but no TUI mode refuses ask_user_question the same way", async () => {
	const tool = createAskUserQuestionTool(createAskUserPanelState());
	const result = await tool.execute("call-2", { question: "Why?" }, undefined, undefined, noUiContext("rpc"));
	assert.equal(result.details.status, "refused");
});

test("TUI ask_user_choice answers with the selected option on Enter", async () => {
	const state = createAskUserPanelState();
	state.pendingCount = 1;
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-3",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }] },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(state.pendingCount, 1);
	send(DOWN);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "option", index: 1, label: "No" });
});

test("digits jump directly to the numbered option", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-4",
		{ question: "Pick one", options: [{ label: "A" }, { label: "B" }, { label: "C" }] },
		undefined,
		undefined,
		ctx,
	);
	send("3");
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "option", index: 2, label: "C" });
});

test("Esc leaves the panel open instead of resolving it", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-5",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }] },
		undefined,
		undefined,
		ctx,
	);
	let settled = false;
	pending.then(() => {
		settled = true;
	});
	send("\x1b");
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(settled, false);
	send("\r");
	const result = await pending;
	assert.equal(result.details.status, "answered");
});

test("Shift+X dismisses the panel with a refusal, never an invented answer", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-6",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }] },
		undefined,
		undefined,
		ctx,
	);
	send("X");
	const result = await pending;
	assert.equal(result.details.status, "refused");
	assert.match(result.details.reason, /Shift\+X/);
});

test("ask_user_question collects free text typed into the z row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-7", { question: "What should happen next?" }, undefined, undefined, ctx);
	for (const char of "later") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "later" });
});

test("z jumps to the free-text row for ask_user_choice when free text is allowed", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-8",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }] },
		undefined,
		undefined,
		ctx,
	);
	send("z");
	for (const char of "maybe") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "maybe" });
});

test("both tools run sequentially so a second panel cannot evict the first", () => {
	const state = createAskUserPanelState();
	assert.equal(createAskUserChoiceTool(state).executionMode, "sequential");
	assert.equal(createAskUserQuestionTool(state).executionMode, "sequential");
});

test("render truncates every line to the requested width even with wide characters", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-r2",
		{
			question: "部署到生产环境吗？",
			options: [
				{ label: "是", description: "立即部署到生产环境中去" },
				{ label: "否" },
			],
		},
		undefined,
		undefined,
		ctx,
	);
	for (const line of render(20)) {
		assert.ok(visibleWidth(line) <= 20, `line exceeds width 20: ${JSON.stringify(line)}`);
	}
	send("X");
	await pending;
});

test("the panel header names the waiting count and the token count from ctx.getContextUsage", async () => {
	const state = createAskUserPanelState();
	state.pendingCount = 1;
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-r7-header",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }] },
		undefined,
		undefined,
		ctx,
	);
	const [header] = render(80);
	assert.match(header, /1 question waiting/);
	assert.match(header, /1234 tokens/);
	send("X");
	await pending;
});

test("options render numbered with a radio and their description, and z is the free-text row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-r7-rows",
		{
			question: "Deploy now?",
			options: [
				{ label: "Yes", description: "Ship it" },
				{ label: "No" },
			],
		},
		undefined,
		undefined,
		ctx,
	);
	const lines = render(80);
	assert.equal(lines[2], "1 (●) Yes  Ship it");
	assert.equal(lines[3], "2 (○) No");
	assert.equal(lines[4], "z (○) Type your answer");
	send(DOWN);
	send(DOWN);
	const hintLines = render(80);
	assert.match(hintLines[hintLines.length - 1], /Enter:edit free text/);
	send("X");
	await pending;
});

test("the browse hint omits the z key and states what Esc does when free text is disabled", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-f1-hint",
		{ question: "Deploy now?", options: [{ label: "Yes" }, { label: "No" }], allowFreeText: false },
		undefined,
		undefined,
		ctx,
	);
	const lines = render(80);
	const hint = lines[lines.length - 1];
	assert.doesNotMatch(hint, /z:/);
	assert.match(hint, /Esc:panel stays open/);
	send("X");
	await pending;
});

test("typing X after other characters into the free-text row inserts it instead of dismissing", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r3-insert", { question: "What tech?" }, undefined, undefined, ctx);
	send("a");
	send("X");
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "aX" });
});

test("aborting before the panel opens refuses without ever calling ui.custom", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const controller = new AbortController();
	controller.abort();
	let opened = false;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			custom: () => {
				opened = true;
				return new Promise(() => {});
			},
		},
		getContextUsage: () => undefined,
	};
	const result = await tool.execute(
		"call-r4-preaborted",
		{ question: "Deploy?", options: [{ label: "Yes" }] },
		controller.signal,
		undefined,
		ctx,
	);
	assert.equal(opened, false);
	assert.equal(result.details.status, "refused");
});

test("aborting while the panel is open resolves with a refusal, not an invented answer", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx } = tuiContext();
	const controller = new AbortController();
	const pending = tool.execute(
		"call-r4-midflight",
		{ question: "Deploy?", options: [{ label: "Yes" }] },
		controller.signal,
		undefined,
		ctx,
	);
	controller.abort();
	const result = await pending;
	assert.equal(result.details.status, "refused");
	assert.match(result.details.reason, /aborted/i);
});

test("free text captures a bracketed paste as plain text", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r5-paste", { question: "Paste the log" }, undefined, undefined, ctx);
	send("\x1b[200~pasted answer\x1b[201~");
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "pasted answer" });
});

test("free text captures an emoji typed directly", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r5-emoji", { question: "React with an emoji" }, undefined, undefined, ctx);
	send("😀");
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "😀" });
});

test("free text captures a kitty CSI-u printable key", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r5-kitty", { question: "Kitty protocol input" }, undefined, undefined, ctx);
	send("\x1b[97u");
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "a" });
});

test("the active free-text row scrolls to keep the cursor and the answer's end visible", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute("call-r11", { question: "Explain" }, undefined, undefined, ctx);
	const longAnswer = "x".repeat(80);
	for (const char of longAnswer) send(char);
	const lines = render(30);
	const freeTextLine = lines.find((line) => line.startsWith("z ("));
	assert.ok(freeTextLine.includes("\x1b[7m"), "expected an inverse-video cursor marker");
	assert.ok(freeTextLine.includes(longAnswer.slice(-5)), "expected the tail of the long answer to stay visible");
	send("\r");
	await pending;
});

test("the abort listener is removed once the panel resolves normally", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const controller = new AbortController();
	let addCount = 0;
	let removeCount = 0;
	const realAdd = controller.signal.addEventListener.bind(controller.signal);
	const realRemove = controller.signal.removeEventListener.bind(controller.signal);
	controller.signal.addEventListener = (...args) => {
		addCount += 1;
		return realAdd(...args);
	};
	controller.signal.removeEventListener = (...args) => {
		removeCount += 1;
		return realRemove(...args);
	};
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-r13",
		{ question: "Deploy?", options: [{ label: "Yes" }] },
		controller.signal,
		undefined,
		ctx,
	);
	send("\r");
	await pending;
	assert.equal(addCount, 1);
	assert.equal(removeCount, 1);
});

test("ask_user_choice: typing after z in edit mode produces the typed answer", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-r12-edit",
		{ question: "Favorite instrument?", options: [{ label: "Piano" }] },
		undefined,
		undefined,
		ctx,
	);
	send("z");
	for (const char of "Xylophone") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "Xylophone" });
});

test("ask_user_choice: Shift+X in browse mode refuses without entering edit mode", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-r12-browse-dismiss",
		{ question: "Favorite instrument?", options: [{ label: "Piano" }] },
		undefined,
		undefined,
		ctx,
	);
	send("X");
	const result = await pending;
	assert.equal(result.details.status, "refused");
});

test("ask_user_choice: Esc in edit mode returns to browse without refusing, and the panel stays open", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-r12-esc-edit",
		{ question: "Favorite instrument?", options: [{ label: "Piano" }] },
		undefined,
		undefined,
		ctx,
	);
	send("z");
	send("Vio");
	let settled = false;
	pending.then(() => {
		settled = true;
	});
	send("\x1b");
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(settled, false);
	send("z");
	for (const char of "lin") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "Violin" });
});

test("ask_user_choice free text still requires z before typing takes effect", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-r12-requires-z",
		{ question: "Favorite instrument?", options: [{ label: "Piano" }] },
		undefined,
		undefined,
		ctx,
	);
	send("z");
	for (const char of "ignored") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "ignored" });
});

test("ask_user_question opens directly in edit mode, so typing yields the answer immediately", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r14-immediate", { question: "Favorite instrument?" }, undefined, undefined, ctx);
	for (const char of "Xylophone") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "Xylophone" });
});

test("Esc returns ask_user_question to browse mode, then Shift+X dismisses", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r14-esc-dismiss", { question: "Favorite instrument?" }, undefined, undefined, ctx);
	send("\x1b");
	send("X");
	const result = await pending;
	assert.equal(result.details.status, "refused");
});

test("the free-text row is only IME-focused while actively in edit mode", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute("call-r15-focus", { question: "Favorite instrument?" }, undefined, undefined, ctx);
	const editLine = render(80).find((line) => line.startsWith("z ("));
	assert.ok(editLine.includes(CURSOR_MARKER), "expected the marker while in edit mode");
	send("\x1b");
	const browseLine = render(80).find((line) => line.startsWith("z ("));
	assert.ok(!browseLine.includes(CURSOR_MARKER), "did not expect the marker while in browse mode");
	send("X");
	await pending;
});

function fakeQueueCounterPi() {
	const handlers = {};
	const pi = {
		on: (event, handler) => {
			handlers[event] = handler;
		},
	};
	return {
		pi,
		messageEnd: (content) => handlers.message_end({ type: "message_end", message: { role: "assistant", content } }),
		toolExecutionEnd: (toolName, toolCallId) =>
			handlers.tool_execution_end({ type: "tool_execution_end", toolCallId, toolName, result: {}, isError: false }),
		turnEnd: () => handlers.turn_end({ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }),
	};
}

test("the header counts ask_user_* calls queued in the same assistant message and decrements as each finishes", async () => {
	const state = createAskUserPanelState();
	const counter = fakeQueueCounterPi();
	registerAskUserQueueCounter(counter.pi, state);
	counter.messageEnd([
		{ type: "toolCall", id: "1", name: "ask_user_choice", arguments: {} },
		{ type: "toolCall", id: "2", name: "ask_user_question", arguments: {} },
	]);
	assert.equal(state.pendingCount, 2);

	const choiceTool = createAskUserChoiceTool(state);
	const first = tuiContext();
	const pendingFirst = choiceTool.execute(
		"call-f2-1",
		{ question: "Deploy now?", options: [{ label: "Yes" }] },
		undefined,
		undefined,
		first.ctx,
	);
	assert.match(first.render(80)[0], /2 questions waiting/);
	first.send("\r");
	await pendingFirst;
	counter.toolExecutionEnd("ask_user_choice", "1");
	assert.equal(state.pendingCount, 1);

	const questionTool = createAskUserQuestionTool(state);
	const second = tuiContext();
	const pendingSecond = questionTool.execute("call-f2-2", { question: "Why?" }, undefined, undefined, second.ctx);
	assert.match(second.render(80)[0], /1 question waiting/);
	second.send("\x1b");
	second.send("X");
	await pendingSecond;
	counter.toolExecutionEnd("ask_user_question", "2");
	assert.equal(state.pendingCount, 0);
});

test("a blocked or invalid first call still frees its slot via tool_execution_end, leaving the valid second call counted", async () => {
	const state = createAskUserPanelState();
	const counter = fakeQueueCounterPi();
	registerAskUserQueueCounter(counter.pi, state);
	counter.messageEnd([
		{ type: "toolCall", id: "1", name: "ask_user_choice", arguments: {} },
		{ type: "toolCall", id: "2", name: "ask_user_question", arguments: {} },
	]);
	assert.equal(state.pendingCount, 2);

	counter.toolExecutionEnd("ask_user_choice", "1");
	assert.equal(state.pendingCount, 1);

	const questionTool = createAskUserQuestionTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = questionTool.execute("call-f2-blocked", { question: "Why?" }, undefined, undefined, ctx);
	assert.match(render(80)[0], /1 question waiting/);
	send("\x1b");
	send("X");
	await pending;
	counter.toolExecutionEnd("ask_user_question", "2");
	assert.equal(state.pendingCount, 0);
});

test("turn_end resets the waiting count even when calls were skipped by an abort", async () => {
	const state = createAskUserPanelState();
	const counter = fakeQueueCounterPi();
	registerAskUserQueueCounter(counter.pi, state);
	counter.messageEnd([
		{ type: "toolCall", id: "1", name: "ask_user_choice", arguments: {} },
		{ type: "toolCall", id: "2", name: "ask_user_question", arguments: {} },
	]);
	assert.equal(state.pendingCount, 2);

	counter.toolExecutionEnd("ask_user_choice", "1");
	assert.equal(state.pendingCount, 1);

	counter.turnEnd();
	assert.equal(state.pendingCount, 0);
});

test("the waiting count never goes negative when a panel runs without being counted by message_end", async () => {
	const state = createAskUserPanelState();
	const counter = fakeQueueCounterPi();
	registerAskUserQueueCounter(counter.pi, state);
	assert.equal(state.pendingCount, 0);

	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-f2-uncounted", { question: "Deploy?", options: [{ label: "Yes" }] }, undefined, undefined, ctx);
	send("\r");
	await pending;
	counter.toolExecutionEnd("ask_user_choice", "call-f2-uncounted");
	assert.equal(state.pendingCount, 0);
});

test("a question with embedded newlines wraps into separate one-line render entries", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const question = "Deploy now?\nRestart workers?\nContinue?";
	const pending = tool.execute(
		"call-multiline-question",
		{ question, options: [{ label: "Yes" }] },
		undefined,
		undefined,
		ctx,
	);
	const width = 20;
	const lines = render(width);
	for (const line of lines) {
		assert.ok(!line.includes("\n"), `line contains an embedded newline: ${JSON.stringify(line)}`);
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${JSON.stringify(line)}`);
	}
	assert.equal(lines.length, 7, "expected header + 3 question lines + option + free-text + hint");
	assert.ok(lines.some((line) => line.includes("Deploy now?")));
	assert.ok(lines.some((line) => line.includes("Restart workers?")));
	assert.ok(lines.some((line) => line.includes("Continue?")));
	send("X");
	await pending;
});

test("newlines in option labels and descriptions are normalized so each option stays one render row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-multiline-option",
		{
			question: "Pick one",
			options: [
				{ label: "Yes\nplease", description: "Ship it\nnow" },
				{ label: "No" },
			],
		},
		undefined,
		undefined,
		ctx,
	);
	const width = 80;
	const lines = render(width);
	for (const line of lines) {
		assert.ok(!line.includes("\n"), `line contains an embedded newline: ${JSON.stringify(line)}`);
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${JSON.stringify(line)}`);
	}
	assert.ok(lines.some((line) => line.includes("Yes please") && line.includes("Ship it now")));
	send("X");
	await pending;
});

test("CR and CRLF line endings in the question normalize like LF before wrapping", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const question = "Deploy now?\r\nRestart workers?\rContinue?";
	const pending = tool.execute(
		"call-cr-question",
		{ question, options: [{ label: "Yes" }] },
		undefined,
		undefined,
		ctx,
	);
	const width = 20;
	const lines = render(width);
	for (const line of lines) {
		assert.ok(!line.includes("\r"), `line contains a stray carriage return: ${JSON.stringify(line)}`);
		assert.ok(!line.includes("\n"), `line contains an embedded newline: ${JSON.stringify(line)}`);
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${JSON.stringify(line)}`);
	}
	assert.equal(lines.length, 7, "expected header + 3 question lines + option + free-text + hint");
	send("X");
	await pending;
});

test("an ANSI erase-screen sequence and a bidi override in the question cannot break out of a rendered row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const question = "Deploy\x1b[2Jnow?‮evil?";
	const pending = tool.execute(
		"call-escape-question",
		{ question, options: [{ label: "Yes" }] },
		undefined,
		undefined,
		ctx,
	);
	const width = 80;
	const lines = render(width);
	for (const line of lines) {
		assert.ok(!line.includes("\x1b[2J"), `line contains the raw escape sequence: ${JSON.stringify(line)}`);
		assert.ok(!line.includes("‮"), `line contains the bidi override: ${JSON.stringify(line)}`);
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${JSON.stringify(line)}`);
	}
	send("X");
	await pending;
});

test("an ANSI erase-screen sequence and a bidi override in an option label/description are neutralized", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-escape-option",
		{
			question: "Pick one",
			options: [{ label: "Yes\x1b[2J", description: "Ship‮it" }],
		},
		undefined,
		undefined,
		ctx,
	);
	const width = 80;
	const lines = render(width);
	for (const line of lines) {
		assert.ok(!line.includes("\x1b[2J"), `line contains the raw escape sequence: ${JSON.stringify(line)}`);
		assert.ok(!line.includes("‮"), `line contains the bidi override: ${JSON.stringify(line)}`);
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${JSON.stringify(line)}`);
	}
	send("X");
	await pending;
});

test("a tab in the question does not exceed the render width", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const question = "Deploy\tnow?";
	const pending = tool.execute(
		"call-tab-question",
		{ question, options: [{ label: "Yes" }] },
		undefined,
		undefined,
		ctx,
	);
	const width = 10;
	const lines = render(width);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: ${JSON.stringify(line)}`);
	}
	send("X");
	await pending;
});

test("a ZWJ emoji sequence in an option label keeps its visible width unchanged", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
	const pending = tool.execute(
		"call-zwj-option",
		{ question: "Pick one", options: [{ label: family }] },
		undefined,
		undefined,
		ctx,
	);
	const width = 80;
	const lines = render(width);
	const optionLine = lines.find((line) => line.includes(family));
	assert.ok(optionLine, "expected the ZWJ emoji sequence to survive normalization intact");
	assert.equal(visibleWidth(optionLine), visibleWidth(`1 (●) ${family}`));
	send("X");
	await pending;
});

test("Down and Up move the active row in browse mode, and Enter answers the active row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-nav-1",
		{
			question: "Pick one",
			options: [{ label: "A" }, { label: "B" }, { label: "C" }],
			allowFreeText: false,
		},
		undefined,
		undefined,
		ctx,
	);
	send(DOWN);
	send(DOWN);
	send(UP);
	assert.ok(render(80).some((line) => line === "2 (●) B"));
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "option", index: 1, label: "B" });
});

test("Tab no longer moves the active row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-nav-tab",
		{ question: "Pick one", options: [{ label: "A" }, { label: "B" }], allowFreeText: false },
		undefined,
		undefined,
		ctx,
	);
	send("\t");
	assert.ok(render(80).some((line) => line === "1 (●) A"));
	send("X");
	await pending;
});

test("Up/Down from edit mode leave edit mode and move the active row", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-nav-edit-exit",
		{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] },
		undefined,
		undefined,
		ctx,
	);
	send("z");
	send("hi");
	send(DOWN);
	assert.ok(render(80).some((line) => line === "1 (●) A"));
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "option", index: 0, label: "A" });
});

test("multiple mode renders checkboxes instead of radios", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-multi-render",
		{ question: "Pick some", options: [{ label: "A" }, { label: "B" }], allowFreeText: false, multiple: true },
		undefined,
		undefined,
		ctx,
	);
	let lines = render(80);
	assert.ok(lines.some((line) => line === "1 [ ] A"));
	assert.ok(lines.some((line) => line === "2 [ ] B"));
	send(SPACE);
	lines = render(80);
	assert.ok(lines.some((line) => line === "1 [x] A"));
	send("\r");
	await pending;
});

test("multiple mode: the free-text row is never rendered as a checkbox, since Space cannot mark it", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-multi-freetext-glyph",
		{ question: "Pick some", options: [{ label: "A" }], multiple: true },
		undefined,
		undefined,
		ctx,
	);
	send(DOWN);
	send("z");
	send("x");
	const lines = render(80);
	const freeTextLine = lines.find((line) => line.startsWith("z "));
	assert.ok(freeTextLine.startsWith("z (") && !freeTextLine.startsWith("z ["));
	send(UP);
	send(SPACE);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, {
		status: "answered",
		kind: "options",
		indices: [0],
		labels: ["A"],
		text: "x",
	});
});

test("multiple mode: Space toggles the active option", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-multi-space",
		{ question: "Pick some", options: [{ label: "A" }, { label: "B" }], allowFreeText: false, multiple: true },
		undefined,
		undefined,
		ctx,
	);
	send(SPACE);
	assert.ok(render(80).some((line) => line === "1 [x] A"));
	send(SPACE);
	assert.ok(render(80).some((line) => line === "1 [ ] A"));
	send(SPACE);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "options", indices: [0], labels: ["A"] });
});

test("multiple mode: digits jump without marking", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-multi-digit",
		{
			question: "Pick some",
			options: [{ label: "A" }, { label: "B" }, { label: "C" }],
			allowFreeText: false,
			multiple: true,
		},
		undefined,
		undefined,
		ctx,
	);
	send("2");
	let lines = render(80);
	assert.ok(lines.some((line) => line === "2 [ ] B"), "digit alone must not mark the option");
	send(SPACE);
	lines = render(80);
	assert.ok(lines.some((line) => line === "2 [x] B"));
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "options", indices: [1], labels: ["B"] });
});

test("multiple mode: Enter with nothing marked is ignored", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-multi-empty-enter",
		{ question: "Pick some", options: [{ label: "A" }, { label: "B" }], allowFreeText: false, multiple: true },
		undefined,
		undefined,
		ctx,
	);
	let settled = false;
	pending.then(() => {
		settled = true;
	});
	send("\r");
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(settled, false);
	send("1");
	send(SPACE);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "options", indices: [0], labels: ["A"] });
});

test("multiple mode: free text typed into the z row is included with the marked options", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-multi-freetext",
		{ question: "Pick some", options: [{ label: "A" }, { label: "B" }], multiple: true },
		undefined,
		undefined,
		ctx,
	);
	send("1");
	send(SPACE);
	send("z");
	for (const char of "also this") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, {
		status: "answered",
		kind: "options",
		indices: [0],
		labels: ["A"],
		text: "also this",
	});
});

test("multiple mode: Enter with only free text and no option marked with Space is ignored", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute(
		"call-multi-freetext-only",
		{ question: "Pick some", options: [{ label: "A" }, { label: "B" }], multiple: true },
		undefined,
		undefined,
		ctx,
	);
	let settled = false;
	pending.then(() => {
		settled = true;
	});
	send("z");
	for (const char of "just text") send(char);
	send("\r");
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(settled, false, "free text alone must not be enough to submit");
	send(DOWN);
	send(SPACE);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, {
		status: "answered",
		kind: "options",
		indices: [0],
		labels: ["A"],
		text: "just text",
	});
});

test("multiple mode: the edit-mode hint reflects whether anything is marked", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-multi-edit-hint",
		{ question: "Pick some", options: [{ label: "A" }], multiple: true },
		undefined,
		undefined,
		ctx,
	);
	send("z");
	assert.match(render(80).at(-1), /select at least one/);
	send(UP);
	send(SPACE);
	send("z");
	assert.match(render(80).at(-1), /submit marked/);
	send("\r");
	await pending;
});

test("without multiple, ask_user_choice behaviour and result stay exactly as a single radio choice", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserChoiceTool(state);
	const { ctx, send, render } = tuiContext();
	const pending = tool.execute(
		"call-single-unchanged",
		{ question: "Pick one", options: [{ label: "A" }, { label: "B" }], allowFreeText: false },
		undefined,
		undefined,
		ctx,
	);
	const lines = render(80);
	assert.ok(lines.some((line) => line === "1 (●) A"));
	assert.ok(lines.some((line) => line === "2 (○) B"));
	send(DOWN);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "option", index: 1, label: "B" });
});
