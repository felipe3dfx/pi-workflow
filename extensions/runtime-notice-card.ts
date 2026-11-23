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
import { affordance, narrowScreen, spread } from "./visual-language.ts";

export type NoticeMessage = { content: unknown; details?: unknown };

export type NoticeParts = {
	head: string;
	action: string;
	status?: string;
	// Today's single wide row, kept byte for byte at 60 columns and above.
	line: string;
};

const lane = "  ";

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
	parts: NoticeParts;
	text: string;
	expanded: boolean;
	theme: Theme;

	constructor(
		message: NoticeMessage,
		parts: NoticeParts,
		expanded: boolean,
		theme: Theme,
	) {
		this.message = message;
		this.parts = parts;
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
		return narrowScreen() ? this.narrow(outer) : this.wide(outer);
	}

	narrow(outer: number) {
		const t = this.theme;
		const { width } = blockMargin(assistantInset, outer);
		const inner = Math.max(1, width - lane.length);
		const { head, action, status } = this.parts;
		const lines = [
			spread(head, affordance(t), width, "…"),
			...wrapTextWithAnsi(t.fg("warning", `→ ${action}`), inner).map(
				(line) => lane + line,
			),
		];
		if (status) lines.push(lane + truncateToWidth(status, inner, "…"));
		if (this.open() && this.text)
			for (const line of wrapTextWithAnsi(
				t.fg("dim", terminalSafeBlock(this.text)),
				inner,
			))
				lines.push(lane + line);
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	wide(outer: number) {
		const t = this.theme;
		const { left, width: room } = blockMargin(assistantInset, outer);
		const width = Math.max(1, room);
		const margin = " ".repeat(left);
		const key = keyText("app.tools.expand");
		const hint = key
			? t.fg("dim", `(${key} to ${this.open() ? "collapse" : "expand"})`)
			: "";
		const top =
			hint && visibleWidth(this.parts.line) + visibleWidth(hint) + 2 <= width
				? spread(this.parts.line, hint, width)
				: truncateToWidth(this.parts.line, width);
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
