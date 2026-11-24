import {
	keyText,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
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
import {
	affordance,
	narrowScreen,
	pinRight,
	spread,
} from "./visual-language.ts";

export type NoticeMessage = { content: unknown; details?: unknown };

export type Span = { text: string; tone: ThemeColor };

export type NoticeParts = {
	title: string;
	metric: Span;
	action: string;
	status?: Span[];
	// Separators of the single wide row at 60 columns and above: the metric's
	// sits inside the metric's tone, the action's inside the dim action.
	wide: { metric: string; action: string };
};

const lane = "  ";

// Adjacent spans of one tone share one colour run.
function paint(t: Theme, spans: Span[]) {
	const runs: Span[] = [];
	for (const span of spans) {
		const last = runs.at(-1);
		if (last?.tone === span.tone) last.text += span.text;
		else runs.push({ ...span });
	}
	return runs.map((run) => t.fg(run.tone, run.text)).join("");
}

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

	label(title: string) {
		const t = this.theme;
		return `${t.fg("warning", "◆")} ${t.bold(t.fg("muted", title))}`;
	}

	body(inner: number) {
		if (!this.open() || !this.text) return [];
		return wrapTextWithAnsi(
			this.theme.fg("dim", terminalSafeBlock(this.text)),
			inner,
		);
	}

	// The metric outranks the title: the title is cut with … down to one cell,
	// and with no cell left the metric stands alone.
	narrowHead(room: number) {
		const { title, metric } = this.parts;
		const painted = paint(this.theme, [metric]);
		const titleRoom = room - visibleWidth(`◆  ${metric.text}`);
		if (titleRoom < 1) return painted;
		return `${this.label(truncateToWidth(title, titleRoom, "…"))} ${painted}`;
	}

	narrow(outer: number) {
		const t = this.theme;
		const { width } = blockMargin(assistantInset, outer);
		if (width < 1) return [""];
		// The lane gives way to the text so the action always has a cell.
		const pad = lane.slice(0, width - 1);
		const inner = width - pad.length;
		const { action, status } = this.parts;
		const mark = affordance(t);
		const lines = [
			pinRight(this.narrowHead(width - visibleWidth(mark) - 1), mark, width),
			...wrapTextWithAnsi(t.fg("warning", `→ ${action}`), inner).map(
				(line) => pad + line,
			),
		];
		if (status) lines.push(pad + truncateToWidth(paint(t, status), inner, "…"));
		for (const line of this.body(inner)) lines.push(pad + line);
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	wideLine() {
		const t = this.theme;
		const { title, metric, action, status, wide } = this.parts;
		const row = paint(t, [
			{ ...metric, text: wide.metric + metric.text },
			{ tone: "dim", text: wide.action + action },
		]);
		const [first, ...rest] = status ?? [];
		const trail = first
			? paint(t, [{ ...first, text: ` · ${first.text}` }, ...rest])
			: "";
		return `${this.label(title)} ${row}${trail}`;
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
		const line = this.wideLine();
		const top =
			hint && visibleWidth(line) + visibleWidth(hint) + 2 <= width
				? spread(line, hint, width)
				: truncateToWidth(line, width);
		return [
			margin + top,
			...this.body(Math.max(1, width - 2)).map((body) => `${margin}  ${body}`),
		];
	}
}
