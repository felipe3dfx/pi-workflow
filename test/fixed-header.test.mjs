import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

import { Container, TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import { createChatViewport } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";

import { registerChrome } from "../extensions/chrome.ts";
import { fixHeader } from "../extensions/fixed-header.ts";

const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
const theme = {
	fg: (_color, text) => text,
	bold: (text) => text,
	bg: (_color, text) => text,
};
const lines = (rows) => ({ render: () => rows, invalidate() {} });
const header = lines(["HEADER"]);
const transcript = Array.from({ length: 30 }, (_, i) => `transcript ${i + 1}`);

function fakeTerminal(columns = 40, rows = 12) {
	return {
		start() {},
		stop() {},
		async drainInput() {},
		write() {},
		columns,
		rows,
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
		kittyProtocolActive: false,
		getBufferedInput: () => "",
		hasPendingInput: () => false,
	};
}

function viewport(documentHeader) {
	const document = new Container();
	if (documentHeader) document.addChild(documentHeader);
	document.addChild(lines(transcript));
	return createChatViewport({
		document,
		pendingMessages: new Container(),
		status: new Container(),
		widgetsAbove: new Container(),
		editor: lines(["╭─ editor ─╮", "│ prompt   │", "╰──────────╯"]),
		widgetsBelow: new Container(),
		footer: lines(["FOOTER"]),
		scrollbar: "never",
	});
}

function fullscreen(chat) {
	const tui = new TuiAltScreen(fakeTerminal(), false);
	tui.setLayoutRoot(chat.root);
	tui.start();
	return tui;
}

async function frame(tui) {
	tui.requestRender(true);
	await delay(20);
	return tui
		.getScreenLines()
		.map((line) => stripVTControlCharacters(line).trimEnd());
}

test("in fullscreen the header owns the first row wherever the transcript is scrolled", async () => {
	const chat = viewport();
	const tui = fullscreen(chat);
	const slot = fixHeader(tui, header);
	try {
		assert.ok(slot.active());
		let screen = await frame(tui);
		assert.equal(screen[0], "HEADER");
		assert.equal(screen[1], "transcript 24");
		assert.equal(screen.at(-1), "FOOTER");
		chat.transcript.scrollTo(5);
		screen = await frame(tui);
		assert.equal(screen[0], "HEADER");
		assert.equal(screen[1], "transcript 6");
	} finally {
		slot.stop();
		tui.stop();
	}
});

test("in regular mode the layout is left alone and the header stays in the document", () => {
	const chat = viewport();
	const tui = new TuiMainScreen(fakeTerminal(), false);
	const slot = fixHeader(tui, header);
	assert.equal(slot.active(), false);
	assert.equal(Object.hasOwn(chat.root, NODE), false);
	slot.stop();
});

test("stop restores the original layout method of every patched root", async () => {
	const chat = viewport();
	const tui = fullscreen(chat);
	const slot = fixHeader(tui, header);
	assert.equal(Object.hasOwn(chat.root, NODE), true);
	slot.stop();
	assert.equal(Object.hasOwn(chat.root, NODE), false);
	assert.equal(slot.active(), false);
	const screen = await frame(tui);
	tui.stop();
	assert.equal(screen[0], "transcript 23");
});

test("a new layout root after a renderer swap gets the header again", async () => {
	const first = viewport();
	const tui = fullscreen(first);
	const slot = fixHeader(tui, header);
	const second = viewport();
	try {
		tui.setLayoutRoot(second.root);
		assert.equal(slot.active(), false);
		await delay(150);
		assert.ok(slot.active());
		assert.equal((await frame(tui))[0], "HEADER");
	} finally {
		slot.stop();
		tui.stop();
	}
	assert.equal(Object.hasOwn(first.root, NODE), false);
	assert.equal(Object.hasOwn(second.root, NODE), false);
});

function startChrome() {
	const handlers = new Map();
	const pi = {
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	const factories = {};
	const ctx = {
		mode: "tui",
		cwd: "/tmp",
		getContextUsage: () => undefined,
		sessionManager: { buildContextEntries: () => [], getEntries: () => [] },
		ui: {
			theme,
			setWorkingVisible() {},
			setWorkingIndicator() {},
			setWorkingMessage() {},
			setHeader: (factory) => (factories.header = factory),
			setFooter() {},
			setWidget() {},
			setEditorComponent() {},
		},
	};
	registerChrome(pi, { get: () => undefined, subscribe: () => () => {} });
	const emit = async (event, payload = {}) => {
		for (const handler of handlers.get(event) ?? [])
			await handler(payload, ctx);
	};
	return { emit, factories };
}

test("the chrome header renders once: fixed in fullscreen, in the document in regular mode", async () => {
	const chrome = startChrome();
	await chrome.emit("session_start");
	try {
		const regular = new TuiMainScreen(fakeTerminal(), false);
		const inDocument = chrome.factories.header(regular, theme);
		assert.match(stripVTControlCharacters(inDocument.render(40)[0]), /tmp/);

		const tui = new TuiAltScreen(fakeTerminal(), false);
		const chat = viewport({
			render: (width) => documentHeader.render(width),
			invalidate() {},
		});
		tui.setLayoutRoot(chat.root);
		tui.start();
		const documentHeader = chrome.factories.header(tui, theme);
		assert.deepEqual(documentHeader.render(40), []);
		await frame(tui);
		chat.transcript.scrollToStart();
		const screen = await frame(tui);
		tui.stop();
		assert.match(screen[0], /tmp/);
		assert.equal(screen[1], "transcript 1");
		assert.equal(screen.filter((row) => row.includes("tmp")).length, 1);

		documentHeader.dispose();
		assert.equal(Object.hasOwn(chat.root, NODE), false);
		assert.match(stripVTControlCharacters(documentHeader.render(40)[0]), /tmp/);
	} finally {
		await chrome.emit("session_shutdown", { reason: "quit" });
	}
});
