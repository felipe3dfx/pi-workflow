import {
	keyText,
	type Theme,
	type ThemeColor,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Markdown,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { Details } from "./advisor.ts";
import { childElapsed, childModelLine } from "./child-projection.ts";
import {
	bodyLines,
	clean,
	expandHint,
	Fallback,
	frame,
	markdownBody,
	paintCard,
	plainHead,
} from "./child-result-card.ts";
import { hidden } from "./compact-tools.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";
import {
	affordance,
	narrowScreen,
	runStateMark,
	themeVar,
} from "./visual-language.ts";

type RenderContext = Parameters<NonNullable<ToolDefinition["renderResult"]>>[3];
type Result = {
	content: { type: string; text?: string }[];
	details?: unknown;
};
type Phase = "running" | "done" | "failed" | "stopped" | "refused";

// Narrow, the Advisor takes the cards' ◆ and the label carries its role (NS-20).
const glyph = () => (narrowScreen() ? "◆" : "◇");
const previewLines = 3;
const minModel = 10;
const running = themeVar("cyan", "dim");

function preview(lines: string[], expanded: boolean) {
	return expanded || lines.length <= previewLines + 1
		? { shown: lines, more: 0 }
		: {
				shown: lines.slice(0, previewLines),
				more: lines.length - previewLines,
			};
}

function phaseOf(failure: Details["failure"], context: RenderContext): Phase {
	if (context.isPartial) return "running";
	if (failure === "aborted") return "stopped";
	if (failure === "refused") return "refused";
	return context.isError ? "failed" : "done";
}

function middle(text: string, width: number) {
	if (visibleWidth(text) <= width) return text;
	const chars = Array.from(text);
	const keep = Math.max(1, width - 1);
	const head = Math.ceil(keep / 2);
	return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - (keep - head)).join("")}`;
}

class AdvisorCard implements Component {
	readonly phase: Phase;
	readonly model: string | undefined;
	readonly thinking: string | undefined;
	readonly text: string;
	readonly body: Markdown;
	readonly expanded: boolean;
	readonly durationMs: number | undefined;
	readonly theme: Theme;
	readonly fallback = new Fallback();

	constructor(result: Result, context: RenderContext, theme: Theme) {
		const details = (result.details ?? {}) as Details;
		const kept = context.state as Details;
		if (details.model) {
			kept.model = details.model;
			kept.thinking = details.thinking;
		}
		this.model = kept.model && terminalSafeLine(kept.model);
		this.thinking = kept.thinking && terminalSafeLine(kept.thinking);
		this.phase = phaseOf(details.failure, context);
		this.text = clean(
			result.content
				.filter((part) => part.type === "text")
				.map((part) => part.text ?? "")
				.join("\n"),
		);
		this.body = markdownBody(this.text);
		this.expanded = context.expanded;
		this.durationMs = context.durationMs;
		this.theme = theme;
	}

	paint(text: string) {
		const tones: Record<Exclude<Phase, "running">, ThemeColor> = {
			done: "accent",
			failed: "error",
			stopped: "dim",
			refused: "dim",
		};
		if (this.phase === "running") return running(text, this.theme);
		if (this.phase === "stopped" && narrowScreen())
			return runStateMark("cancelled").paint(this.theme, text);
		return this.theme.fg(tones[this.phase], text);
	}

	word() {
		const t = this.theme;
		switch (this.phase) {
			case "running":
				return running("consulting…", t);
			case "failed":
				return t.fg("error", "failed");
			case "stopped":
				// Narrow, the Advisor says cancelled like a child stopped the same way (D-open-2).
				return narrowScreen()
					? runStateMark("cancelled").paint(t, "cancelled")
					: t.fg("dim", "stopped");
			case "refused":
				return t.fg("warning", "refused");
			default:
				return "";
		}
	}

	elapsed() {
		return this.phase === "running" || this.durationMs === undefined
			? undefined
			: childElapsed({ createdAt: 0, endedAt: this.durationMs }, 0);
	}

	head(width: number, narrow: boolean) {
		const t = this.theme;
		const word = this.word();
		const left = `${this.paint(glyph())} ${t.bold(t.fg("muted", "Advisor"))}${word ? ` ${word}` : ""}`;
		const elapsed = this.elapsed();
		if (narrow) return elapsed ? `${left} ${t.fg("dim", elapsed)}` : left;
		let model: string | undefined;
		if (this.model) {
			const suffix = this.thinking ? ` (${this.thinking})` : "";
			const room =
				width -
				visibleWidth(left) -
				2 -
				(elapsed ? visibleWidth(elapsed) + 3 : 0) -
				visibleWidth(suffix);
			model = `${middle(childModelLine({ model: this.model }), Math.max(minModel, room))}${suffix}`;
		}
		const meta = [elapsed, model].filter(Boolean).join(" · ");
		return meta ? `${left}  ${t.fg("dim", meta)}` : left;
	}

	expandable(inner: number) {
		return (
			this.phase === "done" &&
			preview(bodyLines(this.body, inner), false).more > 0
		);
	}

	hint(inner: number, pinned: boolean) {
		if (!this.expandable(inner)) return "";
		return pinned
			? affordance(this.theme)
			: expandHint(this.theme, this.expanded);
	}

	content(inner: number, unplacedHint: string, narrow: boolean) {
		const t = this.theme;
		const head =
			narrow && this.model
				? [
						t.fg(
							"dim",
							childModelLine({ model: this.model, thinking: this.thinking }),
						),
					]
				: [];
		if (this.phase === "running") return head;
		if (this.phase !== "done") {
			const tone = this.phase === "failed" ? "error" : "dim";
			return [
				...head,
				...wrapTextWithAnsi(this.text, inner).map((line) => t.fg(tone, line)),
			];
		}
		const { shown, more } = preview(bodyLines(this.body, inner), this.expanded);
		if (more === 0) return [...head, ...shown];
		if (narrow)
			return [
				...head,
				...shown,
				...wrapTextWithAnsi(t.fg("dim", this.tail(more)), inner),
			];
		const row = t.fg("dim", `… ${more} more lines`);
		return [...shown, unplacedHint ? `${row} ${unplacedHint}` : row];
	}

	tail(more: number) {
		const key = keyText("app.tools.expand");
		return `+${more} lines · tap${key ? ` or ${terminalSafeLine(key)}` : ""}`;
	}

	render(outer: number) {
		const narrow = narrowScreen();
		const pinned = narrow && !this.expanded;
		return paintCard(
			"advisor",
			outer,
			this.fallback,
			(width) =>
				frame(
					width,
					(room) => this.head(room, narrow),
					(inner) => this.hint(inner, pinned),
					(inner, unplacedHint) => this.content(inner, unplacedHint, narrow),
					// chrome-messages already insets every tool row by the assistant margin.
					0,
					pinned,
				),
			() => this.plain(),
		);
	}

	plain() {
		const head = plainHead(this.head(Number.POSITIVE_INFINITY, false), glyph());
		if (this.phase === "running" || !this.text) return head;
		if (this.phase !== "done") return `${head}\n${this.text}`;
		const { shown, more } = preview(this.text.split("\n"), this.expanded);
		return more === 0
			? `${head}\n${this.text}`
			: `${head}\n${shown.join("\n")}\n… ${more} more lines`;
	}

	invalidate() {
		this.body.invalidate();
	}
}

export const advisorRenderers = {
	renderShell: "self" as const,
	renderCall: () => hidden,
	renderResult: (
		result: Result,
		_options: unknown,
		theme: Theme,
		context: RenderContext,
	): Component => new AdvisorCard(result, context, theme),
};
