import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { markToggle } from "./chrome-groups.ts";
import { assistantInset, blockMargin } from "./chrome-messages.ts";
import { terminalSafeBlock } from "./terminal-safe-text.ts";
import { spread } from "./visual-language.ts";

export type NoticeMessage = { content: unknown; details?: unknown };

const opened = new WeakMap<NoticeMessage, boolean>();

function noticeText(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export class RuntimeNoticeCard implements Component {
	message: NoticeMessage;
	head: string;
	text: string;
	expanded: boolean;
	theme: Theme;

	constructor(
		message: NoticeMessage,
		head: string,
		expanded: boolean,
		theme: Theme,
	) {
		this.message = message;
		this.head = head;
		this.text = noticeText(message.content);
		this.expanded = expanded;
		this.theme = theme;
		markToggle(this);
	}

	open() {
		return this.expanded || opened.get(this.message) === true;
	}

	invalidate() {}

	handleMouse(event: TuiMouseEvent) {
		if (event.type !== "click" || event.button !== "left" || event.y > 0)
			return undefined;
		opened.set(this.message, !this.open());
		return { handled: true };
	}

	render(outer: number) {
		const t = this.theme;
		const { left, width: room } = blockMargin(assistantInset, outer);
		const width = Math.max(1, room);
		const margin = " ".repeat(left);
		const key = keyText("app.tools.expand");
		const hint = key
			? t.fg("dim", `(${key} to ${this.open() ? "collapse" : "expand"})`)
			: "";
		const top =
			hint && visibleWidth(this.head) + visibleWidth(hint) + 2 <= width
				? spread(this.head, hint, width)
				: truncateToWidth(this.head, width);
		const lines = [margin + top];
		if (!this.open() || !this.text) return lines;
		const inner = Math.max(1, width - 2);
		for (const line of wrapTextWithAnsi(
			t.fg("dim", terminalSafeBlock(this.text)),
			inner,
		))
			lines.push(`${margin}  ${line}`);
		return lines;
	}
}
