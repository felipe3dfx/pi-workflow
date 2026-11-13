import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { dispatchMouseEvent, retargetMouseEvent } from "@earendil-works/pi-tui/dist/tui.js";
import { patchMessages, restoreMessages } from "../extensions/chrome-messages.ts";

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text, italic: (text) => text };
const markdownTheme = Object.fromEntries(["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "underline", "strikethrough"].map((key) => [key, (text) => text]));

test("framed assistant routes Markdown copy and captured events in the rendered content bounds", (t) => {
	globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")] = theme;
	patchMessages();
	const render = Markdown.prototype.render;
	const originalMouse = Markdown.prototype.handleMouse;
	const copies = [];
	const received = [];
	Markdown.prototype.render = function (width) {
		const lines = render.call(this, width);
		lines[0] = `[Copy]${lines[0].slice(6)}`;
		return lines;
	};
	Markdown.prototype.handleMouse = (event) => {
		received.push(event);
		if (event.type === "press" && event.button === "left" && !event.shift && event.y === 0 && event.x >= 0 && event.x < 6) return { capture: true, render: false };
		if (event.type === "release") {
			copies.push("  alpha\n\tbeta");
			return { handled: true, render: false };
		}
	};
	t.after(() => {
		Markdown.prototype.render = render;
		if (originalMouse === undefined) delete Markdown.prototype.handleMouse;
		else Markdown.prototype.handleMouse = originalMouse;
		restoreMessages();
	});
	for (const width of [80, 25, 7]) {
		const component = new AssistantMessageComponent(undefined, false, markdownTheme, "Thinking...", 1, []);
		component.updateContent({ role: "assistant", content: [{ type: "text", text: "```text\n  alpha\n\tbeta\n```" }], stopReason: "stop" }, false);
		const lines = component.render(width).map(stripVTControlCharacters);
		const row = lines.findIndex((line) => line.includes("[Copy]"));
		const col = lines[row].indexOf("[Copy]");
		const event = { type: "press", button: "left", x: col, y: row, screenX: col + 10, screenY: row + 5, width, height: lines.length, shift: false, alt: false, ctrl: false };
		const before = received.length;
		const result = dispatchMouseEvent(component, event);
		assert.equal(result?.capture, true, `width ${width}: press reaches Markdown`);
		assert.equal(result.render, false);
		assert.equal(received.length, before + 1);
		assert.equal(received.at(-1).x, 0);
		assert.equal(received.at(-1).y, 0);
		assert.equal(received.at(-1).width, width === 80 ? 74 : width === 25 ? 21 : 7);
		assert.equal(result.target.originX, 10 + col);
		assert.equal(result.target.originY, 5 + row);
		const release = retargetMouseEvent({ ...event, type: "release", screenX: event.screenX + 20 }, result.target);
		const ended = dispatchMouseEvent(result.target.component, release);
		assert.equal(ended?.handled, true);
		assert.equal(ended.render, false);
		assert.equal(received.length, before + 2);
		assert.equal(copies.at(-1), "  alpha\n\tbeta");
		const count = copies.length;
		if (col > 0) {
			const calls = received.length;
			assert.equal(dispatchMouseEvent(component, { ...event, x: col - 1, screenX: event.screenX - 1 }), undefined);
			assert.equal(received.length, calls);
		}
		assert.equal(dispatchMouseEvent(component, { ...event, x: col + 6, screenX: event.screenX + 6 }), undefined);
		assert.equal(dispatchMouseEvent(component, { ...event, shift: true }), undefined);
		assert.equal(copies.length, count);
	}
});
