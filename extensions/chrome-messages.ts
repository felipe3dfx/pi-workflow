// Replicates the logic of Pi 1.6.0 (AssistantMessageComponent.updateContent, UserMessageComponent.rebuild, createMarkdownTransform, Markdown.renderList and the code case of Markdown.renderToken).
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	BashExecutionComponent,
	type ExtensionAPI,
	InteractiveMode,
	keyText,
	type MarkdownTransformContext,
	type MarkdownTransformer,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	type TuiMouseEvent,
	MouseRegion,
	Spacer,
	sliceByColumn,
	stripTerminalSequences,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
	markThought,
	patchChat,
	restoreChat,
	type Viewport,
} from "./chrome-groups.ts";
import {
	createPatchSet,
	type PatchMethod,
	type PatchTarget,
} from "./chrome-patch.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";
import {
	formatDuration,
	initializedTheme,
	minThoughtMs,
	narrowScreen,
	runStateMark,
	theme,
	themeVar,
} from "./visual-language.ts";

const SHARED = Symbol.for("pi-workflow:chrome-messages:shared");
const piDefaultHiddenLabel = "Thinking...";
const thinkingTimeType = "pi-workflow-thinking-time";
const minTitleWidth = 4;
const stampGap = 2;
const minTextWidth = 20;
export const assistantInset = 3;
const userMargin = 1;
const userInset = 2;
const narrowUserPadding = 1;
const userBand = 1;
const imageLine = new RegExp(`${String.fromCharCode(27)}(?:_G|\\]1337;File=)`);
const foregroundCodes = new RegExp(
	`${String.fromCharCode(27)}\\[(?:3[0-79]|9[0-7]|38[;:][\\d;:]+)m`,
	"g",
);

type Frame = { first: string; rest: string; stamp?: string; trail?: number };
type ThinkingTime = { timestamp: number; runIndex: number; ms: number };
type HeaderParts = {
	label: string;
	duration?: () => number | undefined;
	title?: string;
	hint?: () => boolean;
};

type AssistantState = {
	contentContainer: Container;
	hideThinkingBlock: boolean;
	markdownTheme: MarkdownTheme;
	hiddenThinkingLabel: string;
	outputPad: number;
	markdownTransformers: readonly MarkdownTransformer[];
	lastMessage?: AssistantMessage;
	hasToolCalls: boolean;
	isStreaming: boolean;
	thinkingVisibilityOverrides: Map<number, boolean>;
	messageId?: string;
	timestamp?: string;
	updateContent(message: AssistantMessage, isStreaming?: boolean): void;
};

type UserState = Container & {
	text: string;
	markdownTheme: MarkdownTheme;
	outputPad: number;
	markdownTransformers: readonly MarkdownTransformer[];
};

type Shared = {
	userStamps: WeakMap<object, number | undefined>;
	thinkingTimes: Map<string, { start: number; end?: number }>;
	latestCollapsed?: { owner: object; runIndex: number; at: number };
	saveThinkingTime?: (time: ThinkingTime) => void;
};

const slots = globalThis as Record<symbol, Shared | undefined>;
slots[SHARED] ??= { userStamps: new WeakMap(), thinkingTimes: new Map() };
const shared = slots[SHARED];
const { userStamps, thinkingTimes } = shared;
let pendingUserStamp: number | undefined;

function edgeFor(edge: number, outer: number) {
	return Math.min(edge, Math.max(0, Math.floor((outer - minTextWidth) / 2)));
}

type Pointer = { x: number; width: number };

export type Margin = {
	left: number;
	right: number;
	width: number;
	mouse<E extends Pointer>(event: E): E | undefined;
};

const blockRight = 1;

export function blockMargin(
	edge: number,
	outer: number,
	narrowRight = blockRight,
): Margin {
	const side = edgeFor(edge, outer);
	const narrow = narrowScreen();
	const left = narrow ? 0 : side;
	const right = narrow ? narrowRight : side;
	return {
		left,
		right,
		width: Math.max(0, outer - left - right),
		mouse(event) {
			const width = event.width - left - right;
			const x = event.x - left;
			if (x < 0 || x >= width) return undefined;
			return { ...event, x, width };
		},
	};
}

function lane() {
	return narrowScreen() ? "  " : "";
}

// Where the last narrow render floated the stamp: its row, its first column
// and whether that row is one of its own below the text.
type Placement = { width: number; row: number; x: number; ownRow: boolean };

// Below 60 columns a message's text blocks show one stamp, on the last block
// that renders text at this width, which its source alone cannot tell. The
// first block renders the whole group each frame and the rest reuse its rows.
class StampGroup {
	blocks: Framed[] = [];
	rows = new Map<Framed, readonly string[]>();
	width?: number;
	recipient?: Framed;

	take(block: Framed, width: number) {
		if (
			block === this.blocks[0] ||
			this.width !== width ||
			!this.rows.has(block)
		)
			this.prepare(width);
		const rows = this.rows.get(block) ?? [];
		this.rows.delete(block);
		return { rows, carries: this.recipient === block };
	}

	prepare(width: number) {
		this.width = width;
		this.rows.clear();
		for (const block of this.blocks)
			this.rows.set(block, block.child.render(block.geometry(width).inner));
		this.recipient = this.blocks.findLast((block) =>
			this.rows.get(block)?.some(visibleRow),
		);
	}
}

class Framed implements Component {
	child: Component;
	host = new Container();
	frame: () => Frame;
	edge: number;
	narrowRight: number;
	placement?: Placement;
	stampGroup?: StampGroup;

	constructor(child: Component, frame: () => Frame, edge = 0, narrowRight = 0) {
		this.child = child;
		this.host.addChild(child);
		this.frame = frame;
		this.edge = edge;
		this.narrowRight = narrowRight;
	}

	render(outer: number) {
		const { left, width } = blockMargin(this.edge, outer, this.narrowRight);
		const margin = " ".repeat(left);
		return this.renderInside(width).map((line) => margin + line);
	}

	// Rendering and clicks share this geometry: the content starts after the
	// prefix unless the width cannot hold it, and only wide screens reserve the
	// stamp's columns beside the first line.
	geometry(width: number) {
		const { first, rest, stamp = "", trail = 0 } = this.frame();
		const prefix = visibleWidth(first);
		const fits = width - prefix >= 1;
		const offset = fits ? prefix : 0;
		const reserve = stamp ? stampGap + visibleWidth(stamp) + trail : 0;
		const narrow = narrowScreen();
		const reserved =
			!narrow && reserve > 0 && width - prefix - reserve >= minTextWidth;
		const inner = width - offset - (reserved ? reserve : 0);
		return { first, rest, stamp, trail, fits, offset, inner, narrow, reserved };
	}

	renderInside(width: number) {
		const frame = this.geometry(width);
		const { first, rest, stamp, trail, fits, offset, inner } = frame;
		this.placement = undefined;
		const floats = frame.narrow && fits && stamp !== "";
		const { rows, carries } =
			floats && this.stampGroup
				? this.stampGroup.take(this, width)
				: { rows: this.child.render(inner), carries: true };
		const lines = rows.map((line, i) =>
			fits ? (i === 0 ? first : rest) + line : line,
		);
		const tail = `${stamp}${" ".repeat(trail)}`;
		if (frame.reserved && lines.length > 0) {
			const pad = Math.max(0, offset + inner - visibleWidth(lines[0]));
			lines[0] += `${" ".repeat(pad + stampGap)}${tail}`;
		} else if (floats && carries) {
			const x = width - visibleWidth(tail);
			if (x >= 0) this.placement = placeFloatingStamp(lines, tail, x, width);
		}
		return lines.map((line) => truncateToWidth(line, width));
	}

	handleMouse(event: TuiMouseEvent) {
		const inside = blockMargin(this.edge, event.width, this.narrowRight).mouse(
			event,
		);
		if (!inside) return undefined;
		const { width } = inside;
		const { offset, inner, narrow } = this.geometry(width);
		const x = inside.x - offset;
		if (x < 0 || x >= inner || event.y < 0 || event.y >= event.height)
			return undefined;
		const placement = this.placement;
		if (
			narrow &&
			placement?.width === width &&
			event.y === placement.row &&
			inside.x >= placement.x
		)
			return undefined;
		return this.host.handleMouse({ ...inside, x, width: inner });
	}

	invalidate() {
		this.child.invalidate?.();
	}
}

function visibleRow(line: string) {
	return stripTerminalSequences(line).trim() !== "";
}

function placeFloatingStamp(
	lines: string[],
	tail: string,
	x: number,
	width: number,
): Placement | undefined {
	const last = lines.findLastIndex(visibleRow);
	if (last < 0) return undefined;
	const text = lines[last].trimEnd();
	const used = visibleWidth(text);
	const ownRow = used + stampGap > x;
	const row = ownRow ? last + 1 : last;
	if (ownRow) lines.splice(row, 0, `${" ".repeat(x)}${tail}`);
	else lines[row] = `${text}${" ".repeat(x - used)}${tail}`;
	return { width, row, x, ownRow };
}

function clock(timestamp: number | undefined) {
	if (timestamp === undefined || !Number.isFinite(timestamp)) return "";
	const date = new Date(timestamp);
	const hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

function stamp(timestamp: number | undefined) {
	const text = clock(timestamp);
	return text ? theme().fg("dim", text) : "";
}

function thinkingDuration(
	timestamp: number | undefined,
	runIndex: number,
	running: boolean,
) {
	if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
	const key = `${timestamp}:${runIndex}`;
	const time = thinkingTimes.get(key);
	if (running) {
		if (!time) thinkingTimes.set(key, { start: Date.now() });
		return undefined;
	}
	if (!time) return undefined;
	if (time.end === undefined) {
		time.end = Date.now();
		shared.saveThinkingTime?.({
			timestamp,
			runIndex,
			ms: time.end - time.start,
		});
	}
	return time.end - time.start;
}

function headingText(line: string) {
	if (line.startsWith("#")) {
		let level = 0;
		while (line[level] === "#") level++;
		if (level > 6 || (line[level] !== " " && line[level] !== "\t"))
			return undefined;
		return line.slice(level).trim();
	}
	if (
		line.length > 4 &&
		line.startsWith("**") &&
		line.endsWith("**") &&
		!line.slice(2, -2).includes("**")
	)
		return line.slice(2, -2).trim();
	return undefined;
}

function firstSentence(line: string) {
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if ((c === "." || c === "?" || c === "!") && line[i + 1] === " ")
			return line.slice(0, c === "." ? i : i + 1);
	}
	return line;
}

export function thinkingSteps(blocks: string[]) {
	let count = 0;
	let title = "";
	let open = false;
	let headingOnly = false;
	for (const block of blocks) {
		if (!headingOnly) open = false;
		for (const raw of block.split("\n")) {
			const line = raw.trim();
			if (!line) {
				if (!headingOnly) open = false;
				continue;
			}
			const heading = headingText(line);
			if (heading !== undefined) {
				count++;
				title = heading;
				open = true;
				headingOnly = true;
				continue;
			}
			if (!open) {
				count++;
				title = firstSentence(line);
				open = true;
			}
			headingOnly = false;
		}
	}
	return { count, title };
}

function thinkingHeader(parts: HeaderParts, width: number) {
	const t = theme();
	const label = terminalSafeLine(parts.label);
	const duration = parts.duration?.();
	const meta =
		duration === undefined || duration < minThoughtMs
			? ""
			: ` for ${formatDuration(duration)}`;
	let used = visibleWidth(`◆ ${label}${meta}`);
	let line = `${t.fg("dim", "◆")} ${t.bold(t.fg("muted", label))}${meta ? t.fg("dim", meta) : ""}`;
	const room = width - used - 3;
	if (parts.title && room >= minTitleWidth) {
		const full = terminalSafeLine(parts.title);
		const title =
			visibleWidth(full) > room
				? `${sliceByColumn(full, 0, room - 1, true)}…`
				: full;
		line += t.fg("dim", ` · ${title}`);
		used += 3 + visibleWidth(title);
	}
	// Narrow, the row's tap is the expand affordance and the inline hint goes (NS-18).
	const key =
		parts.hint?.() && !narrowScreen() ? keyText("app.thinking.toggle") : "";
	const hint = key ? `  (${terminalSafeLine(key)} to expand)` : "";
	if (hint && used + visibleWidth(hint) <= width) line += t.fg("dim", hint);
	return line;
}

class ThinkingHeader implements Component {
	parts: HeaderParts;
	edge: number;
	narrowRight: number;

	constructor(parts: HeaderParts, edge = 0, narrowRight = 0) {
		this.parts = parts;
		this.edge = edge;
		this.narrowRight = narrowRight;
	}

	render(outer: number) {
		const { left, width } = blockMargin(this.edge, outer, this.narrowRight);
		const line = `${" ".repeat(left)}${truncateToWidth(thinkingHeader(this.parts, width), width)}`;
		return [`${line}${" ".repeat(Math.max(0, outer - visibleWidth(line)))}`];
	}

	invalidate() {}
}

function withLinkColor(base: MarkdownTheme): MarkdownTheme {
	return {
		...base,
		link: (text: string) => base.link(text.replace(foregroundCodes, "")),
	};
}

function markdownTransform(
	messageType: MarkdownTransformContext["messageType"],
	state: AssistantState,
) {
	return (markdown: string, availableWidth: number) => {
		let transformed = markdown;
		for (const transformer of state.markdownTransformers) {
			try {
				const next = transformer(transformed, {
					messageType,
					isStreaming: state.isStreaming,
					availableWidth,
					messageId: state.messageId,
					timestamp: state.timestamp,
				});
				if (typeof next === "string") transformed = next;
			} catch {}
		}
		return transformed;
	};
}

const COMPACT = Symbol.for("pi-workflow:chrome-messages:compact-markdown");

// The mark keeps the density of the last render, which Pi's render cache
// does not key on.
// tableShrink is the width the compact list prefixes save over Pi's around
// the item token being rendered; only its tables give it back.
type CompactMark = { narrow?: boolean; tableShrink?: number };

function compactMark(markdown: unknown) {
	return (markdown as Record<symbol, CompactMark> | undefined)?.[COMPACT];
}

function markCompactMarkdown(markdown: Markdown) {
	(markdown as unknown as Record<symbol, CompactMark>)[COMPACT] = {};
	return markdown;
}

function shouldCompactMarkdown(markdown: unknown) {
	return narrowScreen() && compactMark(markdown) !== undefined;
}

function hasVisibleText(content: AssistantMessage["content"][number]) {
	return (
		(content.type === "text" && content.text.trim() !== "") ||
		(content.type === "thinking" && content.thinking.trim() !== "")
	);
}

function expandedThinking(
	state: AssistantState,
	blocks: string[],
	header: Component,
) {
	const body = new Container();
	body.addChild(header);
	body.addChild(new Spacer(1));
	body.addChild(
		markCompactMarkdown(
			new Markdown(
				blocks.join("\n\n"),
				0,
				0,
				state.markdownTheme,
				{ color: (text: string) => theme().fg("thinkingText", text) },
				{
					transform: markdownTransform("assistant-thinking", state),
				},
			),
		),
	);
	return new Framed(
		body,
		() => {
			const bar = `${theme().fg("borderMuted", "┃")} `;
			return { first: bar, rest: bar };
		},
		state.outputPad * assistantInset,
		blockRight,
	);
}

// Narrow, red stays for errors: an abort shows the muted – of the shared scale (NS-19).
function notice(text: string, inset: number, aborted = false) {
	return new Framed(
		new Text(theme().fg("muted", text), 0, 0),
		() => ({
			first: `${aborted && narrowScreen() ? runStateMark("cancelled").paint(theme()) : theme().fg("error", "◆")} `,
			rest: "  ",
		}),
		inset,
		blockRight,
	);
}

function updateContent(
	this: AssistantState,
	message: AssistantMessage,
	isStreaming = this.isStreaming,
) {
	const inset = this.outputPad * assistantInset;
	this.lastMessage = message;
	this.isStreaming = isStreaming;
	if (shared.latestCollapsed?.owner === this)
		shared.latestCollapsed = undefined;
	this.contentContainer.clear();
	if (message.content.some(hasVisibleText)) {
		this.contentContainer.addChild(new Spacer(1));
	}
	let thinkingRunIndex = 0;
	const texts = new StampGroup();
	for (let i = 0; i < message.content.length; i++) {
		const content = message.content[i];
		if (content.type === "text" && content.text.trim()) {
			const markdown = markCompactMarkdown(
				new Markdown(
					content.text.trim(),
					0,
					0,
					withLinkColor(this.markdownTheme),
					{ color: (content: string) => theme().fg("text", content) },
					{
						transform: markdownTransform("assistant", this),
					},
				),
			);
			const block = new Framed(
				markdown,
				() => ({
					first: lane(),
					rest: lane(),
					stamp: stamp(message.timestamp),
				}),
				inset,
				blockRight,
			);
			block.stampGroup = texts;
			texts.blocks.push(block);
			this.contentContainer.addChild(block);
		} else if (content.type === "thinking") {
			const thinkingBlocks: string[] = [];
			for (; i < message.content.length; i++) {
				const thinkingContent = message.content[i];
				if (thinkingContent.type !== "thinking") break;
				const thinking = thinkingContent.thinking.trim();
				if (thinking) thinkingBlocks.push(thinking);
			}
			i--;
			if (thinkingBlocks.length === 0) continue;
			const after = message.content.slice(i + 1);
			const hasVisibleContentAfter = after.some(hasVisibleText);
			const runIndex = thinkingRunIndex++;
			const hidden =
				this.thinkingVisibilityOverrides.get(runIndex) ??
				this.hideThinkingBlock;
			const running = this.isStreaming && after.length === 0;
			thinkingDuration(message.timestamp, runIndex, running);
			const custom =
				hidden && this.hiddenThinkingLabel !== piDefaultHiddenLabel
					? this.hiddenThinkingLabel.trim().replace(/^◆\s*/, "")
					: "";
			const header = {
				label: custom || (running ? "Thinking…" : "Thought"),
				duration: running
					? undefined
					: () => thinkingDuration(message.timestamp, runIndex, false),
				title: running ? thinkingSteps(thinkingBlocks).title : undefined,
			};
			const latest = shared.latestCollapsed;
			if (hidden && (!latest || message.timestamp >= latest.at))
				shared.latestCollapsed = {
					owner: this,
					runIndex,
					at: message.timestamp,
				};
			const thinkingComponent = hidden
				? new ThinkingHeader(
						{
							...header,
							hint: () =>
								shared.latestCollapsed?.owner === this &&
								shared.latestCollapsed.runIndex === runIndex,
						},
						inset,
						blockRight,
					)
				: expandedThinking(this, thinkingBlocks, new ThinkingHeader(header));
			const region = new MouseRegion(thinkingComponent, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				if (!hidden && event.y > 0) return undefined;
				this.thinkingVisibilityOverrides.set(runIndex, !hidden);
				if (this.lastMessage) this.updateContent(this.lastMessage);
				return { handled: true };
			});
			markThought(region, { open: !hidden, running });
			this.contentContainer.addChild(region);
			if (hasVisibleContentAfter) {
				this.contentContainer.addChild(new Spacer(1));
			}
		}
	}
	const hasToolCalls = message.content.some((c) => c.type === "toolCall");
	this.hasToolCalls = hasToolCalls;
	if (message.stopReason === "length") {
		this.contentContainer.addChild(new Spacer(1));
		this.contentContainer.addChild(
			notice("Response was truncated before completion.", inset),
		);
	} else if (!hasToolCalls) {
		if (message.stopReason === "aborted") {
			const abortMessage =
				message.errorMessage && message.errorMessage !== "Request was aborted"
					? message.errorMessage
					: "Operation aborted";
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(notice(abortMessage, inset, true));
		} else if (message.stopReason === "error") {
			const errorMsg = message.errorMessage || "Unknown error";
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(notice(`Error: ${errorMsg}`, inset));
		}
	}
}

function promptLines(text: string, width: number) {
	const lines = text.replace(/\t/g, "   ").trimEnd().split("\n");
	const indents = lines
		.slice(1)
		.filter((line) => line.trim())
		.map((line) => line.length - line.trimStart().length);
	const cut = indents.length > 0 ? Math.min(...indents) : 0;
	return lines.flatMap((line, i) => {
		const body = i === 0 ? line : line.slice(cut);
		const content = body.trimStart();
		if (!content) return [""];
		const pad = " ".repeat(
			Math.max(0, Math.min(body.length - content.length, 8, width - 1)),
		);
		return wrapTextWithAnsi(content, Math.max(1, width - pad.length)).map(
			(part) => pad + theme().fg("text", part),
		);
	});
}

class DensityAwareBox extends Box {
	widePaddingX: number;
	appliedPaddingX: number;
	prompt: Framed;

	constructor(
		widePaddingX: number,
		bg: (text: string) => string,
		prompt: Framed,
	) {
		super(widePaddingX, userBand, bg);
		this.widePaddingX = widePaddingX;
		this.appliedPaddingX = widePaddingX;
		this.prompt = prompt;
		this.addChild(prompt);
	}

	render(width: number) {
		const pad = narrowScreen() ? narrowUserPadding : this.widePaddingX;
		if (pad !== this.appliedPaddingX) {
			this.appliedPaddingX = pad;
			this.setPaddingX(pad);
		}
		const lines = super.render(width);
		// A stamp on a row of its own takes the bottom background row's place.
		return this.prompt.placement?.ownRow
			? lines.slice(0, lines.length - userBand)
			: lines;
	}
}

class PromptText implements Component {
	text: string;

	constructor(text: string) {
		this.text = text;
	}

	render(width: number) {
		return promptLines(this.text, width);
	}

	invalidate() {}
}

function rebuild(this: UserState) {
	if (!userStamps.has(this)) userStamps.set(this, pendingUserStamp);
	const timestamp = userStamps.get(this);
	this.clear();
	const contentBox = new DensityAwareBox(
		this.outputPad * userInset,
		(content: string) => theme().bg("userMessageBg", content),
		new Framed(new PromptText(this.text), () => ({
			first: theme().bold(theme().fg("userMessageText", "❯ ")),
			rest: "  ",
			stamp: stamp(timestamp),
		})),
	);
	this.addChild(
		new Framed(
			contentBox,
			() => ({ first: "", rest: "" }),
			this.outputPad * userMargin,
		),
	);
}

type Scroll = {
	scrollTop: number;
	viewportHeight: number;
	isFollowingEnd: boolean;
	scrollTo(top: number, options?: { disableFollow?: boolean }): void;
	scrollToEnd(): void;
};

function transcriptViewport(mode: unknown): Viewport {
	let following: boolean | undefined;
	const view = () =>
		(mode as { transcriptScrollView?: Scroll }).transcriptScrollView;
	return {
		reveal(line, total) {
			const scroll = view();
			const content = (scroll as { contentHeight?: unknown } | undefined)
				?.contentHeight;
			if (!scroll || typeof content !== "number") return;
			const row = content - total + line;
			const top = scroll.scrollTop;
			const height = scroll.viewportHeight;
			if (row >= top && row < top + height) return;
			following ??= scroll.isFollowingEnd;
			scroll.scrollTo(Math.max(0, row - Math.floor(height / 3)), {
				disableFollow: true,
			});
		},
		restore() {
			if (following) view()?.scrollToEnd();
			following = undefined;
		},
	};
}

type Layout = {
	currentScrollTop: number;
	readonly isFollowingEnd: boolean;
	scrollTo(top: number, options: { disableFollow: true }): void;
	updateLayout(content: number, viewport: number, render?: () => void): void;
};

const anchoredViews = new Set<Layout>();

// A reflow across the density threshold must not turn follow-end on for a
// manual position, and a clamped position returns once the content is tall
// enough again (NS-02). Every other layout is Pi's own.
function holdAnchor(scroll: Layout) {
	if (anchoredViews.has(scroll) || typeof scroll.updateLayout !== "function")
		return;
	anchoredViews.add(scroll);
	const layout = scroll.updateLayout;
	let narrow = narrowScreen();
	let held: { top: number; shown: number } | undefined;
	scroll.updateLayout = function (this: Layout, content, viewport, render) {
		const crossed = narrow !== narrowScreen();
		narrow = narrowScreen();
		if (held?.shown !== this.currentScrollTop) held = undefined;
		if (this.isFollowingEnd || (!crossed && !held)) {
			held = undefined;
			return layout.call(this, content, viewport, render);
		}
		const top = held?.top ?? this.currentScrollTop;
		this.currentScrollTop = top;
		layout.call(this, content, viewport, render);
		held =
			this.currentScrollTop < top
				? { top, shown: this.currentScrollTop }
				: undefined;
		if (this.isFollowingEnd)
			this.scrollTo(this.currentScrollTop, { disableFollow: true });
	};
}

function releaseAnchors() {
	for (const scroll of anchoredViews)
		delete (scroll as Partial<Layout>).updateLayout;
	anchoredViews.clear();
}

function foldChat(mode: unknown) {
	const scroll = (mode as { transcriptScrollView?: Layout })
		.transcriptScrollView;
	if (scroll) holdAnchor(scroll);
	const chat = (mode as { chatContainer?: Container }).chatContainer;
	if (chat)
		patchChat(
			chat,
			(width) => blockMargin(assistantInset, width),
			transcriptViewport(mode),
		);
	return chat;
}

function wrapRenderSessionEntries(original: PatchMethod) {
	return function (this: unknown, ...args: unknown[]) {
		if (foldChat(this)?.children.length === 0)
			shared.latestCollapsed = undefined;
		return (original as (...args: unknown[]) => unknown).apply(this, args);
	} as PatchMethod;
}

function wrapAddMessageToChat(original: PatchMethod) {
	return function (
		this: unknown,
		message: { role?: string; timestamp?: number },
		...rest: unknown[]
	) {
		foldChat(this);
		pendingUserStamp = message.role === "user" ? message.timestamp : undefined;
		try {
			return (original as (...args: unknown[]) => unknown).call(
				this,
				message,
				...rest,
			);
		} finally {
			pendingUserStamp = undefined;
		}
	} as PatchMethod;
}

function guarded(replacement: PatchMethod) {
	return (original: PatchMethod) =>
		function (this: unknown, ...args: never[]) {
			try {
				return replacement.apply(this, args);
			} catch {
				return original.apply(this, args);
			}
		} as PatchMethod;
}

const headingColors = [
	themeVar("heading1", "mdHeading"),
	themeVar("blue", "mdHeading"),
	themeVar("heading3", "mdHeading"),
	themeVar("muted", "mdHeading"),
	themeVar("faint", "mdHeading"),
	themeVar("heading6", "mdHeading"),
];

type MarkdownToken = { type?: string; depth?: number };
type CodeToken = { text: string; lang?: string };
type ListItem = { task?: boolean; checked?: boolean; tokens: MarkdownToken[] };
type ListToken = {
	items: ListItem[];
	ordered?: boolean;
	start?: number | "";
	loose?: boolean;
};
type MarkdownSelf = {
	theme: MarkdownTheme;
	renderToken(
		token: MarkdownToken,
		width: number,
		nextTokenType?: string,
		styleContext?: unknown,
	): string[];
	renderList(
		token: ListToken,
		depth: number,
		width: number,
		styleContext?: unknown,
	): string[];
};

const codeRail = "▎";

// Pi draws the code rows, highlighted or not, without indent and without a
// successor; only its two fence rows are dropped.
function railedCode(
	self: MarkdownSelf,
	render: (...args: unknown[]) => unknown,
	token: CodeToken,
	width: number,
	nextTokenType: string | undefined,
	styleContext: unknown,
) {
	const saved = self.theme;
	let code: string[];
	try {
		self.theme = { ...saved, codeBlockIndent: "" };
		code = (
			render.call(self, token, width, undefined, styleContext) as string[]
		).slice(1, -1);
	} finally {
		self.theme = saved;
	}
	// Each code line drops the rail's space, then the rail, rather than leave
	// a double-width character on a row wider than the room beside it.
	const rails = [
		`${saved.codeBlockBorder(codeRail)} `,
		saved.codeBlockBorder(codeRail),
	];
	const lines = code.flatMap((line) => {
		for (const rail of rails) {
			const room = width - visibleWidth(rail);
			if (room < 1) continue;
			const rows = wrapTextWithAnsi(line, room);
			if (rows.every((row) => visibleWidth(row) <= room))
				return rows.map((row) => rail + row);
		}
		return wrapTextWithAnsi(line, Math.max(1, width));
	});
	if (nextTokenType && nextTokenType !== "space") lines.push("");
	return lines;
}

function compactList(
	this: MarkdownSelf,
	token: ListToken,
	depth: number,
	width: number,
	styleContext?: unknown,
) {
	// Only the assistant Markdown built here compacts, and it never asks Pi to
	// preserve the source list markers.
	const lines: string[] = [];
	const mark = compactMark(this) as CompactMark;
	const outerShrink = mark.tableShrink ?? 0;
	const indent = "  ".repeat(depth);
	const startNumber = typeof token.start === "number" ? token.start : 1;
	token.items.forEach((item, i) => {
		const bullet = token.ordered ? `${startNumber + i}. ` : "- ";
		const marker = bullet + (item.task ? `[${item.checked ? "x" : " "}] ` : "");
		const firstPrefix = indent + this.theme.listBullet(marker);
		const continuationPrefix = indent + " ".repeat(visibleWidth(marker));
		const itemWidth = Math.max(1, width - visibleWidth(firstPrefix));
		let renderedAnyLine = false;
		for (const itemToken of item.tokens) {
			if (itemToken.type === "list") {
				lines.push(
					...this.renderList(
						itemToken as unknown as ListToken,
						depth + 1,
						width,
						styleContext,
					),
				);
				renderedAnyLine = true;
				continue;
			}
			// Tables, quoted or not, keep the width Pi gives them at 4 columns
			// per level.
			let rendered: string[];
			mark.tableShrink = outerShrink + 2 * depth;
			try {
				rendered = this.renderToken(
					itemToken,
					itemWidth,
					undefined,
					styleContext,
				);
			} finally {
				mark.tableShrink = outerShrink;
			}
			for (const line of rendered)
				for (const wrapped of wrapTextWithAnsi(line, itemWidth)) {
					lines.push(
						(renderedAnyLine ? continuationPrefix : firstPrefix) + wrapped,
					);
					renderedAnyLine = true;
				}
		}
		if (!renderedAnyLine) lines.push(firstPrefix);
		if (token.loose && i < token.items.length - 1) lines.push("");
	});
	return lines;
}

function wrapMarkdownRender(original: PatchMethod) {
	const render = original as (this: Markdown, width: number) => string[];
	return function (this: Markdown, width: number) {
		const mark = compactMark(this);
		if (mark) {
			const narrow = narrowScreen();
			if (mark.narrow !== undefined && mark.narrow !== narrow)
				this.invalidate();
			mark.narrow = narrow;
		}
		return render.call(this, width);
	} as PatchMethod;
}

function wrapRenderList(original: PatchMethod) {
	return function (
		this: MarkdownSelf,
		...args: Parameters<typeof compactList>
	) {
		const render = shouldCompactMarkdown(this)
			? compactList
			: (original as unknown as typeof compactList);
		return render.apply(this, args);
	} as PatchMethod;
}

function wrapRenderToken(original: PatchMethod) {
	return function (
		this: MarkdownSelf,
		token: MarkdownToken,
		...rest: unknown[]
	) {
		const render = original as (...args: unknown[]) => unknown;
		if (token?.type === "code" && shouldCompactMarkdown(this))
			return railedCode(
				this,
				render,
				token as CodeToken,
				rest[0] as number,
				rest[1] as string | undefined,
				rest[2],
			);
		const shrink = compactMark(this)?.tableShrink;
		if (token?.type === "table" && shrink && shouldCompactMarkdown(this))
			return render.call(
				this,
				token,
				Math.max(1, (rest[0] as number) - shrink),
				...rest.slice(1),
			);
		const palette = initializedTheme();
		const saved = this.theme;
		if (
			token?.type !== "heading" ||
			!palette ||
			saved.heading("\0") !== palette.fg("mdHeading", "\0")
		)
			return render.call(this, token, ...rest);
		const color = headingColors[Math.min(Math.max(token.depth ?? 1, 1), 6) - 1];
		try {
			this.theme = { ...saved, heading: (text) => color(text, palette) };
			return render.call(this, token, ...rest);
		} finally {
			this.theme = saved;
		}
	} as PatchMethod;
}

type BashRow = {
	contentContainer: Container;
	outputPad: number;
};

// One part of a native Bash row without its padding: the command header keeps
// column 0 for its `$ ` glyph, the other parts sit after a lane that shrinks to
// leave them one cell. Rendering and clicks share this geometry.
class BashPart implements Component {
	host = new Container();
	part: Component;
	header: boolean;
	pad: number;

	constructor(part: Component, header: boolean, pad: number) {
		this.part = part;
		this.host.addChild(part);
		this.header = header;
		this.pad = pad;
	}

	geometry(width: number) {
		const lane = this.header ? 0 : Math.min(2, Math.max(0, width - 1));
		const room = width - lane;
		return { lane, room, padded: room + 2 * this.pad };
	}

	render(width: number) {
		const { lane, room, padded } = this.geometry(width);
		const indent = " ".repeat(lane);
		const pad = " ".repeat(this.pad);
		return this.host
			.render(padded)
			.map(
				(line) =>
					indent +
					truncateToWidth(
						line.startsWith(pad) ? line.slice(this.pad) : line,
						room,
						"",
					),
			);
	}

	handleMouse(event: TuiMouseEvent) {
		const { lane, room, padded } = this.geometry(event.width);
		const x = event.x - lane;
		if (x < 0 || x >= room) return undefined;
		return this.host.handleMouse({ ...event, x: x + this.pad, width: padded });
	}

	invalidate() {
		this.part.invalidate?.();
	}
}

const bashParts = new WeakMap<Component, BashPart>();

function narrowBash(row: unknown) {
	if (
		!narrowScreen() ||
		!(row instanceof BashExecutionComponent) ||
		!((row as unknown as BashRow).contentContainer instanceof Container)
	)
		return undefined;
	return row as unknown as BashRow;
}

// Pi lays out and dispatches the row itself, through its own Container, with
// the content parts seen through their BashPart for the call.
function inLane<T>(row: BashRow, run: () => T) {
	const content = row.contentContainer;
	const parts = content.children;
	const shown = parts.map((part, i) => {
		let shown = bashParts.get(part);
		if (!shown) {
			const pad = (part as { paddingX?: number }).paddingX ?? row.outputPad;
			shown = new BashPart(part, i === 0, pad);
			bashParts.set(part, shown);
		}
		return shown;
	});
	content.children = shown;
	try {
		return run();
	} finally {
		if (content.children === shown) content.children = parts;
	}
}

function wrapRowRender(original: PatchMethod) {
	const render = original as (this: unknown, width: number) => string[];
	return function (this: unknown, outer: number) {
		const { left, width } = blockMargin(assistantInset, outer);
		const bash = narrowBash(this);
		if (bash)
			return width === 0 ? [] : inLane(bash, () => render.call(this, width));
		const lines = render.call(this, width);
		if (left === 0) return lines;
		const margin = " ".repeat(left);
		return lines.map((line) =>
			imageLine.test(line) || line === ""
				? line
				: truncateToWidth(margin + line, outer),
		);
	} as PatchMethod;
}

function wrapRowMouse(original: PatchMethod) {
	const mouse = original as (this: unknown, event: Pointer) => unknown;
	return function (this: unknown, event: Pointer) {
		const margin = blockMargin(assistantInset, event.width);
		const inner =
			margin.left === 0 && margin.right === 0 ? event : margin.mouse(event);
		if (!inner) return undefined;
		const bash = narrowBash(this);
		return bash
			? inLane(bash, () => mouse.call(this, inner))
			: mouse.call(this, inner);
	} as PatchMethod;
}

const targets: PatchTarget[] = [
	{
		proto: AssistantMessageComponent.prototype,
		name: "updateContent",
		create: guarded(updateContent as PatchMethod),
		replaces: true,
	},
	{
		proto: UserMessageComponent.prototype,
		name: "rebuild",
		create: guarded(rebuild as PatchMethod),
		replaces: true,
	},
	{
		proto: InteractiveMode.prototype,
		name: "addMessageToChat",
		create: wrapAddMessageToChat,
		replaces: false,
	},
	{
		proto: InteractiveMode.prototype,
		name: "renderSessionEntries",
		create: wrapRenderSessionEntries,
		replaces: false,
	},
	{
		proto: Markdown.prototype,
		name: "renderToken",
		create: wrapRenderToken,
		replaces: false,
	},
	{
		proto: Markdown.prototype,
		name: "render",
		create: wrapMarkdownRender,
		replaces: false,
	},
	{
		proto: Markdown.prototype,
		name: "renderList",
		create: wrapRenderList,
		replaces: false,
	},
	...[ToolExecutionComponent, BashExecutionComponent].flatMap((row) => [
		{
			proto: row.prototype,
			name: "render",
			create: wrapRowRender,
			replaces: false,
		},
		{
			proto: row.prototype,
			name: "handleMouse",
			create: wrapRowMouse,
			replaces: false,
		},
	]),
];

const patchSet = createPatchSet("chrome-messages", targets);

export function patchMessages() {
	patchSet.patch();
}

export function restoreMessages() {
	patchSet.restore();
	restoreChat();
	releaseAnchors();
	thinkingTimes.clear();
	shared.latestCollapsed = undefined;
	shared.saveThinkingTime = undefined;
}

export function registerMessages(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		shared.saveThinkingTime = (time) => pi.appendEntry(thinkingTimeType, time);
		thinkingTimes.clear();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== thinkingTimeType)
				continue;
			const { timestamp, runIndex, ms } = (entry.data ??
				{}) as Partial<ThinkingTime>;
			if (
				!Number.isFinite(timestamp) ||
				!Number.isFinite(runIndex) ||
				!Number.isFinite(ms)
			)
				continue;
			thinkingTimes.set(`${timestamp}:${runIndex}`, { start: 0, end: ms });
		}
	});
	pi.on("session_shutdown", async () => {
		shared.saveThinkingTime = undefined;
	});
}
