import { stripVTControlCharacters } from "node:util";

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
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { ChildDetails, ChildRecord } from "./child-sessions.ts";
import { markCard } from "./chrome-groups.ts";
import type { Capability } from "./configure.ts";
import { assistantInset, blockMargin } from "./chrome-messages.ts";
import {
	childElapsed,
	childModelLine,
	needsNoReason,
	resultFieldLines,
} from "./child-projection.ts";
import { seated } from "./shell.ts";
import { terminalSafeBlock, terminalSafeLine } from "./terminal-safe-text.ts";
import {
	affordance,
	legacyDurationWidth,
	narrowScreen,
	pinRight,
	runStateMark,
	spread,
} from "./visual-language.ts";

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

// Narrow, an ended card's glyph and state word take the shared scale's tone.
function paintTone(theme: Theme, card: Card, question: boolean, text: string) {
	const state = question ? undefined : card.state;
	if (
		narrowScreen() &&
		(state === "failed" || state === "timed out" || state === "cancelled")
	)
		return runStateMark(state).paint(theme, text);
	return theme.fg(tone(card, question), text);
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
	if (needsNoReason(card.state, card.verdict)) return undefined;
	return card.result?.reason;
}

function header(
	theme: Theme,
	card: Card,
	question: boolean,
	open: boolean,
	width = Number.POSITIVE_INFINITY,
) {
	const glyph = paintTone(theme, card, question, "◆");
	const label = (text: string) => theme.bold(theme.fg("muted", text));
	let rest = [card.role, card.id.slice(0, 4)].filter(Boolean).join(" ");
	if (question)
		return `${glyph} ${label("Subagent")} ${rest} ${theme.fg("warning", `asks · question ${card.question ?? "?"}`)}`;
	if (card.state && card.state !== "completed")
		rest += ` ${paintTone(theme, card, question, card.state)}`;
	// Narrow, a collapsed completed card without a Verdict still reads its state (owner, #417).
	else if (
		card.state === "completed" &&
		!card.verdict &&
		!open &&
		narrowScreen()
	)
		rest += ` ${runStateMark("completed").paint(theme, "completed")}`;
	if (card.verdict)
		rest += ` ${theme.fg(verdictTone(card.verdict), card.verdict)}`;
	const line = `${glyph} ${label("Subagent")} ${rest}`;
	const model =
		open &&
		card.model &&
		childModelLine({
			model: card.model,
			thinking: card.thinking,
		});
	const time =
		card.elapsedMs !== undefined &&
		childElapsed({ createdAt: 0, endedAt: card.elapsedMs } as ChildRecord, 0);
	const meta = [model, time].filter(Boolean).join(" · ");
	if (!meta) return line;
	const full = `${line}  ${theme.fg("dim", meta)}`;
	if (!time || visibleWidth(full) <= width) return full;
	// Wide rows keep the base's layout unless the base's whole seconds fit where the new time does not.
	const legacy =
		visibleWidth(full) -
		visibleWidth(time) +
		legacyDurationWidth(card.elapsedMs ?? 0);
	if (!narrowScreen() && legacy > width) return full;
	// Overflow keeps the whole time: one space before the metadata, then a shorter model, then none,
	// then a shorter Subagent label, then none; the role, id and state stay whole.
	const cut = narrowScreen() ? "…" : "...";
	const dim = (text: string) => theme.fg("dim", text);
	const tight = `${line} ${dim(meta)}`;
	if (visibleWidth(tight) <= width) return tight;
	const room = width - visibleWidth(line) - 1 - visibleWidth(` · ${time}`);
	const short = model && room > 1 && truncateToWidth(model, room, cut);
	if (short) return `${line} ${dim(`${short} · ${time}`)}`;
	const timed = `${line} ${dim(time)}`;
	const labelRoom = width - visibleWidth(`${glyph}  ${rest} ${time}`);
	if (visibleWidth(timed) <= width) return timed;
	if (labelRoom <= visibleWidth(cut)) {
		// No readable label fits: drop Subagent and its space before clipping the time.
		const bare = `${glyph} ${rest} ${dim(time)}`;
		return visibleWidth(bare) <= width ? bare : timed;
	}
	return `${glyph} ${label(truncateToWidth("Subagent", labelRoom, cut))} ${rest} ${dim(time)}`;
}

// Narrow, the reason takes up to 2 lines, the second cut with … (NS-21); wide keeps one.
function reasonLines(why: string, inner: number, narrow: boolean) {
	if (!narrow) return [why];
	const [first = "", ...rest] = wrapTextWithAnsi(why, inner);
	return rest.length === 0
		? [first]
		: [first, truncateToWidth(rest.join(" "), inner, "…")];
}

export function clean(text: string) {
	return terminalSafeBlock(text.trim());
}

export function markdownBody(text: string) {
	return new Markdown(text, 0, 0, getMarkdownTheme());
}

export function bodyLines(body: Markdown, inner: number) {
	const lines = body.render(inner).map((line) => line.trimEnd());
	while (lines.length > 0 && lines.at(-1) === "") lines.pop();
	return lines;
}

export class Fallback extends Text {
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

export function plainHead(head: string, glyph: string) {
	const text = terminalSafeLine(stripVTControlCharacters(head));
	return text.startsWith(`${glyph} `) ? text.slice(glyph.length + 1) : text;
}

export function expandHint(theme: Theme, expanded: boolean) {
	const key = keyText("app.tools.expand");
	return key
		? theme.fg(
				"dim",
				`(${terminalSafeLine(key)} to ${expanded ? "collapse" : "expand"})`,
			)
		: "";
}

export function paintCard(
	capability: Capability,
	outer: number,
	fallback: Fallback,
	lines: (width: number) => string[],
	plain: () => string,
) {
	if (seated(capability, "message-stream")) return lines(outer);
	fallback.update(plain());
	return fallback.render(outer);
}

export function frame(
	outer: number,
	head: string | ((width: number) => string),
	hint: string | ((inner: number) => string),
	content: (inner: number, unplacedHint: string) => string[],
	inset = assistantInset,
	pinned = false,
) {
	const { left, width: room } = blockMargin(
		inset,
		outer,
		inset === 0 ? 0 : undefined,
	);
	const width = Math.max(1, room);
	const inner = Math.max(1, width - indent);
	const top = typeof head === "string" ? head : head(width);
	const tail = typeof hint === "string" ? hint : hint(inner);
	const placed =
		tail && (pinned || visibleWidth(top) + visibleWidth(tail) + 2 <= width);
	const narrow = narrowScreen();
	const ellipsis = narrow ? "…" : "...";
	const margin = " ".repeat(left);
	const pad = " ".repeat(indent);
	const lines = [
		margin +
			(pinned && tail
				? pinRight(top, tail, width)
				: placed
					? spread(top, tail, width)
					: truncateToWidth(top, width, ellipsis)),
		...content(inner, placed ? "" : tail).map(
			(line) => margin + pad + truncateToWidth(line, inner, ellipsis),
		),
	];
	return narrow
		? lines.map((line) => truncateToWidth(line, room, ellipsis))
		: lines;
}

class ResultCard implements Component {
	card: Card;
	key: string;
	question: boolean;
	expanded: boolean;
	theme: Theme;
	text: string;
	body: Markdown;
	readonly fallback = new Fallback();
	state: { open: boolean; failed: boolean };

	constructor(message: Message, expanded: boolean, theme: Theme) {
		this.card = parse(message);
		this.question = message.customType === QUESTION_TYPE;
		this.key = this.question
			? `${this.card.id}#${this.card.question}`
			: this.card.id;
		this.expanded = expanded;
		this.theme = theme;
		this.text = clean(this.card.text);
		this.body = markdownBody(this.text);
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
		return paintCard(
			"child-session",
			outer,
			this.fallback,
			(width) => this.cardLines(width),
			() => this.plain(),
		);
	}

	plain() {
		const open = this.open();
		const head = plainHead(
			header(this.theme, this.card, this.question, open),
			"◆",
		);
		if (open || this.question) return `${head}\n${this.text}`;
		const why = reason(this.card);
		return why ? `${head}\n${terminalSafeLine(why)}` : head;
	}

	cardLines(outer: number) {
		const t = this.theme;
		const open = this.open();
		const narrow = narrowScreen();
		const pinned = !open && narrow;
		const hint = pinned ? affordance(t) : expandHint(t, this.expanded);
		const instruction = (text: string, inner: number) =>
			narrow ? wrapTextWithAnsi(t.fg("dim", text), inner) : [t.fg("dim", text)];
		return frame(
			outer,
			// A pinned › takes the row's last cell and the space before it.
			(width) =>
				header(t, this.card, this.question, open, pinned ? width - 2 : width),
			hint,
			(inner) => {
				const lines: string[] = [];
				if (open && this.card.task)
					lines.push(
						...instruction(`Task ${terminalSafeLine(this.card.task)}`, inner),
					);
				if (open && this.card.result)
					for (const line of resultFieldLines(this.card.result))
						lines.push(t.fg("dim", terminalSafeLine(line)));
				if (open || this.question) lines.push(...bodyLines(this.body, inner));
				else {
					const why = reason(this.card);
					if (why)
						lines.push(
							...reasonLines(terminalSafeLine(why), inner, narrow).map((line) =>
								t.fg("dim", line),
							),
						);
				}
				if (open)
					lines.push(...instruction("alt+a  open in subagents view", inner));
				return lines;
			},
			assistantInset,
			pinned,
		);
	}

	invalidate() {
		this.body.invalidate();
	}

	handleMouse(event: TuiMouseEvent) {
		if (event.type !== "click" || event.button !== "left") return undefined;
		if (this.open() && event.y > 0) return undefined;
		opened.set(this.key, !this.open());
		this.state.open = this.open();
		return { handled: true };
	}
}

class AnswerCard implements Component {
	readonly id: string | undefined;
	readonly question: number | undefined;
	readonly answer: string | undefined;
	readonly text: string;
	readonly body: Markdown;
	readonly theme: Theme;
	readonly rejection: string | undefined;
	readonly rejectionText: string | undefined;
	readonly fallback = new Fallback();
	private cachedHead: string | undefined;

	constructor(
		id: string | undefined,
		question: number | undefined,
		answer: string | undefined,
		theme: Theme,
		rejection?: string,
	) {
		this.id = id;
		this.question = question;
		this.answer = answer;
		this.theme = theme;
		this.rejection = rejection;
		this.rejectionText = rejection === undefined ? undefined : clean(rejection);
		this.text = clean(answer ?? "");
		this.body = markdownBody(this.text);
	}

	get head() {
		if (this.cachedHead !== undefined) return this.cachedHead;
		const color = this.rejection === undefined ? "toolTitle" : "error";
		const status = `· answer ${this.question ?? "?"}${this.rejection === undefined ? "" : " rejected"}`;
		this.cachedHead = `${this.theme.fg(color, "◆")} ${this.theme.bold(this.theme.fg("muted", "Parent"))} → ${terminalSafeLine(this.id ?? "").slice(0, 4)} ${this.theme.fg(color, status)}`;
		return this.cachedHead;
	}

	render(outer: number) {
		const rejectionText = this.rejectionText;
		return paintCard(
			"child-session",
			outer,
			this.fallback,
			(width) =>
				frame(width, this.head, "", (inner) =>
					rejectionText === undefined
						? bodyLines(this.body, inner)
						: wrapTextWithAnsi(rejectionText, inner).map((line) =>
								this.theme.fg("error", line),
							),
				),
			() =>
				rejectionText === undefined
					? `${plainHead(this.head, "◆")}\n${this.text}`
					: `${this.head}\n${this.theme.fg("error", rejectionText)}`,
		);
	}

	invalidate() {
		this.cachedHead = undefined;
		this.body.invalidate();
	}
}

export function answerCard(
	args: Partial<{ id: string; question: number; answer: string }>,
	theme: Theme,
	previous?: unknown,
	rejection?: string,
) {
	if (
		previous instanceof AnswerCard &&
		previous.rejection === rejection &&
		previous.id === args.id &&
		previous.question === args.question &&
		previous.answer === args.answer &&
		previous.theme === theme
	)
		return previous;
	return new AnswerCard(args.id, args.question, args.answer, theme, rejection);
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
