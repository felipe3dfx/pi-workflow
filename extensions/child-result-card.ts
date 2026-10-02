import {
	type ExtensionAPI,
	getMarkdownTheme,
	keyText,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	Markdown,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { ChildDetails, ChildRecord } from "./child-sessions.ts";
import { childElapsed, spread } from "./children-box.ts";
import { markCard } from "./chrome-groups.ts";
import { assistantInset, edgeFor } from "./chrome-messages.ts";
import { claim, paint } from "./configure.ts";
import { childModelLine } from "./child-projection.ts";
import { paintMessageStream } from "./shell.ts";
import { sanitizeMultilineText, sanitizeTaskText } from "./todo-header.ts";

const childStream = claim("child-session", "message-stream");

const RESULT_TYPE = "pi-workflow-child-result";
const QUESTION_TYPE = "pi-workflow-child-question";

const OPENED = Symbol.for("pi-workflow:child-result-card:opened");
const slots = globalThis as Record<symbol, Map<string, boolean> | undefined>;
slots[OPENED] ??= new Map();
const opened = slots[OPENED];
const indent = 2;

type Card = Partial<ChildDetails> & { id: string; text: string };
type Message = { customType: string; content: unknown; details?: unknown };

function contentText(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function parse(message: Message): Card {
	const details = (message.details ?? {}) as Partial<ChildDetails>;
	const id = details.id ?? "";
	if (typeof details.role === "string")
		return { ...details, id, text: details.text ?? "" };
	const content = contentText(message.content);
	const asked = content.match(
		/^Child (\S+) asks \(question (\d+)\):\n\n([\s\S]*)\n\nAnswer with reply_child/,
	);
	if (asked)
		return {
			...details,
			id: asked[1],
			state: "waiting",
			question: Number(asked[2]),
			text: asked[3],
		};
	const outcome = content.match(
		/^Child (\S+) (completed|failed|timed out|cancelled)(?::\n\n|: |\.)([\s\S]*)$/,
	);
	if (outcome)
		return {
			...details,
			id: outcome[1],
			state: outcome[2] as ChildRecord["state"],
			text: outcome[2] === "cancelled" ? "" : outcome[3],
		};
	return { ...details, id, text: content };
}

function tone(card: Card, question: boolean): ThemeColor {
	if (question) return "warning";
	if (card.state === "failed" || card.state === "timed out") return "error";
	if (card.state === "cancelled") return "dim";
	return "toolTitle";
}

function verdictTone(verdict: string): ThemeColor {
	if (verdict === "fail") return "error";
	if (verdict === "blocked") return "warning";
	return "success";
}

function reason(card: Card) {
	if (
		card.state !== "failed" &&
		card.state !== "timed out" &&
		card.verdict !== "fail" &&
		card.verdict !== "blocked"
	)
		return undefined;
	const lines = card.text.split("\n").map((line) => line.trim());
	const undone = lines.findIndex((line) => /^left_undone:\s*$/i.test(line));
	const item = lines[undone + 1]?.match(/^-\s*(.+)$/)?.[1];
	if (undone >= 0 && item) return item;
	const verdict = lines.findLastIndex((line) =>
		/^verdict:\s*(fail|blocked)\s*$/i.test(line),
	);
	if (verdict >= 0) {
		const near =
			lines.slice(verdict + 1).find(Boolean) ??
			lines.slice(0, verdict).findLast(Boolean);
		if (near) return near;
	}
	return lines.find((line) => line && !/^(verdict|status):/i.test(line));
}

function header(theme: Theme, card: Card, question: boolean, open: boolean) {
	const name = [card.role, card.id.slice(0, 4)].filter(Boolean).join(" ");
	let line = `${theme.fg(tone(card, question), "◆")} ${theme.bold(theme.fg("muted", "Subagent"))} ${name}`;
	if (question)
		return `${line} ${theme.fg("warning", `asks · question ${card.question ?? "?"}`)}`;
	if (card.state && card.state !== "completed")
		line += ` ${theme.fg(tone(card, question), card.state)}`;
	if (card.verdict)
		line += ` ${theme.fg(verdictTone(card.verdict), card.verdict)}`;
	const meta = [
		open &&
			card.model &&
			childModelLine({
				model: card.model,
				thinking: card.thinking,
			}),
		card.elapsedMs !== undefined &&
			childElapsed({ createdAt: 0, endedAt: card.elapsedMs } as ChildRecord, 0),
	].filter(Boolean);
	return meta.length > 0
		? `${line}  ${theme.fg("dim", meta.join(" · "))}`
		: line;
}

class ResultCard implements Component {
	card: Card;
	key: string;
	question: boolean;
	expanded: boolean;
	theme: Theme;
	body: Markdown;
	state: { open: boolean; failed: boolean };

	constructor(message: Message, expanded: boolean, theme: Theme) {
		this.card = parse(message);
		this.question = message.customType === QUESTION_TYPE;
		this.key = this.question
			? `${this.card.id}#${this.card.question}`
			: this.card.id;
		this.expanded = expanded;
		this.theme = theme;
		this.body = new Markdown(
			sanitizeMultilineText(this.card.text.trim()).replaceAll("\t", "   "),
			0,
			0,
			getMarkdownTheme(),
		);
		this.state = {
			open: this.open(),
			failed: this.card.state === "failed" || this.card.state === "timed out",
		};
		if (!this.question) markCard(this, this.state);
	}

	open() {
		return this.expanded || opened.get(this.key) === true;
	}

	render(outer: number) {
		paint(childStream, (width) => this.cardLines(width));
		return paintMessageStream(outer);
	}

	cardLines(outer: number) {
		const t = this.theme;
		const edge = edgeFor(assistantInset, outer);
		const width = Math.max(1, outer - edge * 2);
		const open = this.open();
		const key = keyText("app.tools.expand");
		const head = header(t, this.card, this.question, open);
		const hint = key
			? t.fg(
					"dim",
					`(${sanitizeTaskText(key)} to ${this.expanded ? "collapse" : "expand"})`,
				)
			: "";
		const top =
			hint && visibleWidth(head) + visibleWidth(hint) + 2 <= width
				? spread(head, hint, width)
				: truncateToWidth(head, width);
		const inner = Math.max(1, width - indent);
		const lines: string[] = [];
		if (open && this.card.task)
			lines.push(t.fg("dim", `Task ${sanitizeTaskText(this.card.task)}`));
		if (open || this.question) {
			const body = this.body.render(inner).map((line) => line.trimEnd());
			while (body.length > 0 && body.at(-1) === "") body.pop();
			lines.push(...body);
		} else {
			const why = reason(this.card);
			if (why) lines.push(t.fg("dim", sanitizeTaskText(why)));
		}
		if (open) lines.push(t.fg("dim", "alt+a  open in subagents view"));
		const margin = " ".repeat(edge);
		const pad = " ".repeat(indent);
		return [
			margin + top,
			...lines.map((line) => margin + pad + truncateToWidth(line, inner)),
		];
	}

	invalidate() {
		this.body.invalidate();
	}

	handleMouse(event: TuiMouseEvent) {
		if (event.type !== "click" || event.button !== "left") return undefined;
		opened.set(this.key, !this.open());
		this.state.open = this.open();
		return { handled: true };
	}
}

function resultCards(message: Message, expanded: boolean, theme: Theme) {
	const { results } = (message.details ?? {}) as { results?: ChildDetails[] };
	if (!Array.isArray(results)) return new ResultCard(message, expanded, theme);
	const batch = new Container();
	const cards = results.map(
		(details) =>
			new ResultCard({ ...message, content: "", details }, expanded, theme),
	);
	for (const card of cards) batch.addChild(card);
	markCard(batch, {
		get open() {
			return cards.every((card) => card.state.open);
		},
		get failed() {
			return cards.some((card) => card.state.failed);
		},
	});
	return batch;
}

export function registerChildResultCards(pi: ExtensionAPI) {
	for (const type of [RESULT_TYPE, QUESTION_TYPE])
		pi.registerMessageRenderer(type, (message, { expanded }, theme) =>
			resultCards(message, expanded, theme),
		);
	pi.on("session_shutdown", async () => {
		opened.clear();
	});
}
