import { stripVTControlCharacters } from "node:util";

import {
	getMarkdownTheme,
	keyText,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Markdown,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { childElapsed, childModelLine } from "../../extensions/child-projection.ts";
import { assistantInset, edgeFor } from "../../extensions/chrome-messages.ts";
import { hidden } from "../../extensions/compact-tools.ts";
import {
	terminalSafeBlock,
	terminalSafeLine,
} from "../../extensions/terminal-safe-text.ts";
import { spread, themeVar } from "../../extensions/visual-language.ts";

export type Failure =
	| "unavailable"
	| "thinking"
	| "provider"
	| "overflow"
	| "aborted"
	| "refused";

export type AdvisorDetails = {
	model?: string;
	thinking?: string;
	failure?: Failure;
};

export type Variant = { glyph: "◇" | "◆" };

export const seating = { advisor: true };
export const previewLines = 3;

const indent = 2;
const running = themeVar("cyan", "dim");
const minModel = 10;

type Result = {
	content: { type: string; text?: string }[];
	details?: AdvisorDetails;
};
type Context = {
	isPartial: boolean;
	isError: boolean;
	expanded: boolean;
	durationMs: number | undefined;
	state: { model?: string; thinking?: string };
	lastComponent: Component | undefined;
};

type Phase = "running" | "done" | "failed" | "stopped" | "refused";

function textOf(result: Result) {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n")
		.trim();
}

function phaseOf(result: Result, context: Context): Phase {
	if (context.isPartial) return "running";
	const failure = result.details?.failure;
	if (failure === "aborted") return "stopped";
	if (failure === "refused") return "refused";
	if (context.isError) return "failed";
	return "done";
}

function middle(text: string, width: number) {
	if (visibleWidth(text) <= width) return text;
	const keep = Math.max(1, width - 1);
	const head = Math.ceil(keep / 2);
	return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

function bodyLines(body: Markdown, inner: number) {
	const lines = body.render(inner).map((line) => line.trimEnd());
	while (lines.length > 0 && lines.at(-1) === "") lines.pop();
	return lines;
}

class Fallback extends Text {
	private last = "";

	constructor() {
		super("", 0, 0);
	}

	update(text: string) {
		if (text === this.last) return;
		this.last = text;
		this.setText(text);
	}
}

export class AdvisorCard implements Component {
	readonly phase: Phase;
	readonly text: string;
	readonly body: Markdown;
	readonly model: string | undefined;
	readonly thinking: string | undefined;
	readonly expanded: boolean;
	readonly durationMs: number | undefined;
	readonly theme: Theme;
	readonly variant: Variant;
	readonly fallback = new Fallback();

	constructor(
		result: Result,
		context: Context,
		theme: Theme,
		variant: Variant,
	) {
		const details = result.details ?? {};
		context.state.model ??= details.model;
		context.state.thinking ??= details.thinking;
		this.model = details.model ?? context.state.model;
		this.thinking = details.thinking ?? context.state.thinking;
		this.phase = phaseOf(result, context);
		this.text = terminalSafeBlock(textOf(result));
		this.body = new Markdown(this.text, 0, 0, getMarkdownTheme());
		this.expanded = context.expanded;
		this.durationMs = context.durationMs;
		this.theme = theme;
		this.variant = variant;
	}

	tone(): ThemeColor | undefined {
		switch (this.phase) {
			case "failed":
				return "error";
			case "stopped":
			case "refused":
				return "dim";
			case "done":
				return "accent";
			default:
				return undefined;
		}
	}

	paint(text: string) {
		const color = this.tone();
		return color ? this.theme.fg(color, text) : running(text, this.theme);
	}

	word() {
		switch (this.phase) {
			case "running":
				return running("consulting…", this.theme);
			case "failed":
				return this.theme.fg("error", "failed");
			case "stopped":
				return this.theme.fg("dim", "stopped");
			case "refused":
				return this.theme.fg("warning", "refused");
			default:
				return "";
		}
	}

	modelLine(width: number) {
		if (!this.model) return "";
		const model = terminalSafeLine(this.model);
		const thinking = this.thinking ? terminalSafeLine(this.thinking) : undefined;
		const full = childModelLine({ model, thinking });
		const suffix = thinking ? ` (${thinking})` : "";
		const name = full.slice(0, full.length - suffix.length);
		return `${middle(name, Math.max(minModel, width - visibleWidth(suffix)))}${suffix}`;
	}

	head(width: number) {
		const t = this.theme;
		const word = this.word();
		const left = `${this.paint(this.variant.glyph)} ${t.bold(t.fg("muted", "Advisor"))}${word ? ` ${word}` : ""}`;
		const elapsed =
			this.durationMs === undefined
				? undefined
				: childElapsed({ createdAt: 0, endedAt: this.durationMs }, 0);
		const fixed = visibleWidth(left) + 2 + (elapsed ? elapsed.length + 3 : 0);
		const model = this.modelLine(width - fixed);
		const meta = [elapsed, model].filter(Boolean).join(" · ");
		return meta ? `${left}  ${t.fg("dim", meta)}` : left;
	}

	content(inner: number) {
		const t = this.theme;
		if (this.phase === "running") return { lines: [], more: 0, folds: false };
		if (this.phase !== "done") {
			const color = this.phase === "failed" ? "error" : "dim";
			return {
				lines: wrapTextWithAnsi(this.text, inner).map((line) =>
					t.fg(color, line),
				),
				more: 0,
				folds: false,
			};
		}
		if (!this.text)
			return {
				lines: [t.fg("dim", "The advisor returned no advice.")],
				more: 0,
				folds: false,
			};
		const all = bodyLines(this.body, inner);
		const folds = all.length > previewLines + 1;
		if (this.expanded || !folds) return { lines: all, more: 0, folds };
		const more = all.length - previewLines;
		return {
			lines: [
				...all.slice(0, previewLines),
				t.fg("dim", `… ${more} more line${more === 1 ? "" : "s"}`),
			],
			more,
			folds,
		};
	}

	hint(folds: boolean) {
		const key = keyText("app.tools.expand");
		if (!key || !folds) return "";
		return this.theme.fg(
			"dim",
			`(${terminalSafeLine(key)} to ${this.expanded ? "collapse" : "expand"})`,
		);
	}

	render(outer: number) {
		if (seating.advisor) return this.card(outer);
		this.fallback.update(this.plain(outer));
		return this.fallback.render(outer);
	}

	card(outer: number) {
		const edge = edgeFor(assistantInset, outer);
		const width = Math.max(1, outer - edge * 2);
		const inner = Math.max(1, width - indent);
		const { lines, more, folds } = this.content(inner);
		const hint = this.hint(folds);
		const head = this.head(width);
		const fits = hint && visibleWidth(head) + visibleWidth(hint) + 2 <= width;
		const top = fits ? spread(head, hint, width) : truncateToWidth(head, width);
		if (hint && !fits && more > 0)
			lines[lines.length - 1] += ` ${hint}`;
		const margin = " ".repeat(edge);
		const pad = " ".repeat(indent);
		return [
			margin + top,
			...lines.map((line) => margin + pad + truncateToWidth(line, inner)),
		];
	}

	plain(outer: number) {
		const head = terminalSafeLine(
			stripVTControlCharacters(this.head(outer)),
		).replace(/^[◇◆] /, "");
		if (this.phase === "running") return head;
		if (this.phase === "done" && !this.expanded) {
			const lines = this.text.split("\n");
			if (lines.length <= previewLines + 1) return `${head}\n${this.text}`;
			const more = lines.length - previewLines;
			return `${head}\n${lines.slice(0, previewLines).join("\n")}\n… ${more} more lines`;
		}
		return `${head}\n${this.text}`;
	}

	invalidate() {
		this.body.invalidate();
	}
}

export function advisorRenderers(variant: Variant) {
	return {
		renderShell: "self" as const,
		renderCall: () => hidden,
		renderResult: (
			result: Result,
			_options: { expanded: boolean; isPartial: boolean },
			theme: Theme,
			context: Context,
		): Component => new AdvisorCard(result, context, theme, variant),
	};
}
