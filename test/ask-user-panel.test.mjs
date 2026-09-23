import test from "node:test";
import assert from "node:assert/strict";

import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

import {
	createAskUserChoiceTool,
	createAskUserPanelState,
	createAskUserQuestionTool,
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
				component = factory({}, fakeTheme, {}, (result) => resolveDone(result));
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
	send("\t");
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "option", index: 1, label: "No" });
	assert.equal(state.pendingCount, 0);
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

test("R14: ask_user_question opens directly in edit mode, so typing yields the answer immediately", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r14-immediate", { question: "Favorite instrument?" }, undefined, undefined, ctx);
	for (const char of "Xylophone") send(char);
	send("\r");
	const result = await pending;
	assert.deepEqual(result.details, { status: "answered", kind: "text", text: "Xylophone" });
});

test("R14: Esc returns ask_user_question to browse mode, then Shift+X dismisses", async () => {
	const state = createAskUserPanelState();
	const tool = createAskUserQuestionTool(state);
	const { ctx, send } = tuiContext();
	const pending = tool.execute("call-r14-esc-dismiss", { question: "Favorite instrument?" }, undefined, undefined, ctx);
	send("\x1b");
	send("X");
	const result = await pending;
	assert.equal(result.details.status, "refused");
});

test("R15: the free-text row is only IME-focused while actively in edit mode", async () => {
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
