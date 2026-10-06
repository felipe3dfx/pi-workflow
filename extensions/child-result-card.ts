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
	Text,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { ChildDetails, ChildRecord } from "./child-sessions.ts";
import { childElapsed, spread } from "./children-box.ts";
import { markCard } from "./chrome-groups.ts";
import { assistantInset, edgeFor } from "./chrome-messages.ts";
import { claim, held, paint } from "./configure.ts";
import { childModelLine, resultFieldLines } from "./child-projection.ts";
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

function parse(message: Message): Card {
	const details = (message.details ?? {}) as Partial<ChildDetails>;
	return { ...details, id: details.id ?? "", text: details.text ?? "" };
}

function tone(card: Card, question: boolean): ThemeColor {
	if (question) return "warning";
	if (card.state === "failed" || card.state === "timed out") return "error";
	if (card.state === "cancelled") return "dim";
	return "toolTitle";
}

function verdictTone(verdict: string): ThemeColor {
	if (verdict === "fail") return "error";
	if (verdict === "blocked" || verdict === "partial") return "warning";
	return "success";
}

function reason(card: Card) {
	if (card.state === "failed" || card.state === "timed out")
		return card.text
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
	if (card.verdict === "done" || card.verdict === "pass") return undefined;
	return card.result?.reason;
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

function markdownBody(text: string) {
	return new Markdown(
		sanitizeMultilineText(text.trim()).replaceAll("\t", "   "),
		0,
		0,
		getMarkdownTheme(),
	);
}

function bodyLines(body: Markdown, inner: number) {
	const lines = body.render(inner).map((line) => line.trimEnd());
	while (lines.length > 0 && lines.at(-1) === "") lines.pop();
	return lines;
}

function frame(
	outer: number,
	head: string,
	hint: string,
	content: (inner: number) => string[],
) {
	const edge = edgeFor(assistantInset, outer);
	const width = Math.max(1, outer - edge * 2);
	const top =
		hint && visibleWidth(head) + visibleWidth(hint) + 2 <= width
			? spread(head, hint, width)
			: truncateToWidth(head, width);
	const inner = Math.max(1, width - indent);
	const margin = " ".repeat(edge);
	const pad = " ".repeat(indent);
	return [
		margin + top,
		...content(inner).map((line) => margin + pad + truncateToWidth(line, inner)),
	];
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
		this.body = markdownBody(this.card.text);
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
		const key = keyText("app.tools.expand");
		const hint = key
			? t.fg(
					"dim",
					`(${sanitizeTaskText(key)} to ${this.expanded ? "collapse" : "expand"})`,
				)
			: "";
		const open = this.open();
		return frame(
			outer,
			header(t, this.card, this.question, open),
			hint,
			(inner) => {
				const lines: string[] = [];
				if (open && this.card.task)
					lines.push(t.fg("dim", `Task ${sanitizeTaskText(this.card.task)}`));
				if (open && this.card.result)
					for (const line of resultFieldLines(this.card.result))
						lines.push(t.fg("dim", sanitizeTaskText(line)));
				if (open || this.question) lines.push(...bodyLines(this.body, inner));
				else {
					const why = reason(this.card);
					if (why) lines.push(t.fg("dim", sanitizeTaskText(why)));
				}
				if (open) lines.push(t.fg("dim", "alt+a  open in subagents view"));
				return lines;
			},
		);
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

class AnswerCard implements Component {
	readonly id: string | undefined;
	readonly question: number | undefined;
	readonly answer: string | undefined;
	readonly body: Markdown;
	readonly theme: Theme;

	constructor(
		id: string | undefined,
		question: number | undefined,
		answer: string | undefined,
		theme: Theme,
	) {
		this.id = id;
		this.question = question;
		this.answer = answer;
		this.theme = theme;
		this.body = markdownBody(answer ?? "");
	}

	get head() {
		return `${this.theme.fg("toolTitle", "◆")} ${this.theme.bold(this.theme.fg("muted", "Parent"))} → ${sanitizeTaskText(this.id ?? "").slice(0, 4)} ${this.theme.fg("toolTitle", `· answer ${this.question ?? "?"}`)}`;
	}

	render(outer: number) {
		if (!held(childStream)) {
			const plain = `Parent → ${sanitizeTaskText(this.id ?? "").slice(0, 4)} · answer ${this.question ?? "?"}`;
			return new Text(
				`${plain}\n${sanitizeMultilineText((this.answer ?? "").trim()).replaceAll("\t", "   ")}`,
				0,
				0,
			).render(outer);
		}
		paint(childStream, (width) =>
			frame(width, this.head, "", (inner) => bodyLines(this.body, inner)),
		);
		return paintMessageStream(outer);
	}

	invalidate() {
		this.body.invalidate();
	}
}

export function answerCard(
	args: Partial<{ id: string; question: number; answer: string }>,
	theme: Theme,
) {
	return new AnswerCard(args.id, args.question, args.answer, theme);
}

function resultCards(message: Message, expanded: boolean, theme: Theme) {
	const { results, role } = (message.details ?? {}) as {
		results?: ChildDetails[];
		role?: string;
	};
	if (!Array.isArray(results))
		return role ? new ResultCard(message, expanded, theme) : undefined;
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
