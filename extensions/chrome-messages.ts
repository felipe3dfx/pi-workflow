// Replicates the logic of Pi 1.0.0 (AssistantMessageComponent.updateContent, UserMessageComponent.rebuild, createMarkdownTransform).
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
	MouseRegion,
	Spacer,
	sliceByColumn,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { markThought, patchChat, restoreChat } from "./chrome-groups.ts";
import {
	createPatchSet,
	type PatchMethod,
	type PatchTarget,
} from "./chrome-patch.ts";
import { sanitizeTaskText } from "./todo-header.ts";
import { theme } from "./visual-language.ts";

const SHARED = Symbol.for("pi-workflow:chrome-messages:shared");
const piDefaultHiddenLabel = "Thinking...";
const thinkingTimeType = "pi-workflow-thinking-time";
const minTitleWidth = 4;
const stampGap = 2;
const minTextWidth = 20;
export const assistantInset = 3;
const userMargin = 1;
const userInset = 2;
const imageLine = new RegExp(`${String.fromCharCode(27)}(?:_G|\\]1337;File=)`);
const foregroundCodes = new RegExp(
	`${String.fromCharCode(27)}\\[(?:3[0-79]|9[0-7]|38[;:][\\d;:]+)m`,
	"g",
);

type Method = PatchMethod;
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

export function edgeFor(edge: number, outer: number) {
	return Math.min(edge, Math.max(0, Math.floor((outer - minTextWidth) / 2)));
}

class Framed implements Component {
	child: Component;
	frame: () => Frame;
	edge: number;

	constructor(child: Component, frame: () => Frame, edge = 0) {
		this.child = child;
		this.frame = frame;
		this.edge = edge;
	}

	render(outer: number) {
		const edge = edgeFor(this.edge, outer);
		const margin = " ".repeat(edge);
		return this.renderInside(outer - edge * 2).map((line) => margin + line);
	}

	renderInside(width: number) {
		const { first, rest, stamp = "", trail = 0 } = this.frame();
		const prefix = visibleWidth(first);
		const reserve = stamp ? stampGap + visibleWidth(stamp) + trail : 0;
		const stamped = reserve > 0 && width - prefix - reserve >= minTextWidth;
		if (width - prefix < 1)
			return this.child
				.render(width)
				.map((line) => truncateToWidth(line, width));
		const inner = width - prefix - (stamped ? reserve : 0);
		const lines = this.child
			.render(inner)
			.map((line, i) => (i === 0 ? first : rest) + line);
		if (stamped && lines.length > 0) {
			const pad = Math.max(0, prefix + inner - visibleWidth(lines[0]));
			lines[0] += `${" ".repeat(pad + stampGap)}${stamp}${" ".repeat(trail)}`;
		}
		return lines.map((line) => truncateToWidth(line, width));
	}

	invalidate() {
		this.child.invalidate?.();
	}
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

function thoughtDuration(ms: number) {
	const seconds = Math.max(0, ms) / 1_000;
	const tenths = Math.round(seconds * 10);
	if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}m${whole % 60}s`;
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
		shared.saveThinkingTime?.({ timestamp, runIndex, ms: time.end - time.start });
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
	const label = sanitizeTaskText(parts.label);
	const duration = parts.duration?.();
	const meta =
		duration === undefined ? "" : ` for ${thoughtDuration(duration)}`;
	let used = visibleWidth(`◆ ${label}${meta}`);
	let line = `${t.fg("dim", "◆")} ${t.bold(t.fg("muted", label))}${meta ? t.fg("dim", meta) : ""}`;
	const room = width - used - 3;
	if (parts.title && room >= minTitleWidth) {
		const full = sanitizeTaskText(parts.title);
		const title =
			visibleWidth(full) > room
				? `${sliceByColumn(full, 0, room - 1, true)}…`
				: full;
		line += t.fg("dim", ` · ${title}`);
		used += 3 + visibleWidth(title);
	}
	const key = parts.hint?.() ? keyText("app.thinking.toggle") : "";
	const hint = key ? `  (${sanitizeTaskText(key)} to expand)` : "";
	if (hint && used + visibleWidth(hint) <= width) line += t.fg("dim", hint);
	return line;
}

class ThinkingHeader implements Component {
	parts: HeaderParts;
	edge: number;

	constructor(parts: HeaderParts, edge: number) {
		this.parts = parts;
		this.edge = edge;
	}

	render(outer: number) {
		const edge = edgeFor(this.edge, outer);
		const width = Math.max(0, outer - edge * 2);
		const line = `${" ".repeat(edge)}${truncateToWidth(thinkingHeader(this.parts, width), width)}`;
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
	isStreaming: boolean,
	transformers: readonly MarkdownTransformer[],
) {
	return (markdown: string, availableWidth: number) => {
		let transformed = markdown;
		for (const transformer of transformers) {
			try {
				const next = transformer(transformed, {
					messageType,
					isStreaming,
					availableWidth,
				});
				if (typeof next === "string") transformed = next;
			} catch {}
		}
		return transformed;
	};
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
		new Markdown(
			blocks.join("\n\n"),
			0,
			0,
			state.markdownTheme,
			{ color: (text: string) => theme().fg("thinkingText", text) },
			{
				transform: markdownTransform(
					"assistant-thinking",
					state.isStreaming,
					state.markdownTransformers,
				),
			},
		),
	);
	return new Framed(
		body,
		() => {
			const bar = `${theme().fg("borderMuted", "┃")} `;
			return { first: bar, rest: bar };
		},
		state.outputPad * assistantInset,
	);
}

function notice(text: string, inset: number) {
	return new Framed(
		new Text(theme().fg("muted", text), 0, 0),
		() => ({ first: `${theme().fg("error", "◆")} `, rest: "  " }),
		inset,
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
	if (shared.latestCollapsed?.owner === this) shared.latestCollapsed = undefined;
	this.contentContainer.clear();
	if (message.content.some(hasVisibleText)) {
		this.contentContainer.addChild(new Spacer(1));
	}
	let thinkingRunIndex = 0;
	for (let i = 0; i < message.content.length; i++) {
		const content = message.content[i];
		if (content.type === "text" && content.text.trim()) {
			const markdown = new Markdown(
				content.text.trim(),
				0,
				0,
				withLinkColor(this.markdownTheme),
				{ color: (content: string) => theme().fg("text", content) },
				{
					transform: markdownTransform(
						"assistant",
						this.isStreaming,
						this.markdownTransformers,
					),
				},
			);
			this.contentContainer.addChild(
				new Framed(
					markdown,
					() => ({ first: "", rest: "", stamp: stamp(message.timestamp) }),
					inset,
				),
			);
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
				shared.latestCollapsed = { owner: this, runIndex, at: message.timestamp };
			const owner = this;
			const thinkingComponent = hidden
				? new ThinkingHeader(
						{
							...header,
							hint: () =>
								shared.latestCollapsed?.owner === owner &&
								shared.latestCollapsed.runIndex === runIndex,
						},
						inset,
					)
				: expandedThinking(
						this,
						thinkingBlocks,
						new ThinkingHeader(header, 0),
					);
			const region = new MouseRegion(thinkingComponent, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
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
			this.contentContainer.addChild(notice(abortMessage, inset));
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
	const contentBox = new Box(this.outputPad * userInset, 1, (content: string) =>
		theme().bg("userMessageBg", content),
	);
	contentBox.addChild(
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

function foldChat(mode: unknown) {
	const chat = (mode as { chatContainer?: Container }).chatContainer;
	if (chat) patchChat(chat, (width) => edgeFor(assistantInset, width));
	return chat;
}

function wrapRenderSessionEntries(original: Method) {
	return function (this: unknown, ...args: unknown[]) {
		if (foldChat(this)?.children.length === 0)
			shared.latestCollapsed = undefined;
		return (original as (...args: unknown[]) => unknown).apply(this, args);
	} as Method;
}

function wrapAddMessageToChat(original: Method) {
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
	} as Method;
}

function guarded(replacement: Method) {
	return (original: Method) =>
		function (this: unknown, ...args: never[]) {
			try {
				return replacement.apply(this, args);
			} catch {
				return original.apply(this, args);
			}
		} as Method;
}

type MouseEvent = { x: number; width: number };
function wrapRowRender(original: Method) {
	return function (this: unknown, outer: number) {
		const edge = edgeFor(assistantInset, outer);
		const lines = (original as (width: number) => string[]).call(
			this,
			outer - edge * 2,
		);
		if (edge === 0) return lines;
		const margin = " ".repeat(edge);
		return lines.map((line) =>
			imageLine.test(line) || line === ""
				? line
				: truncateToWidth(margin + line, outer),
		);
	} as Method;
}

function wrapRowMouse(original: Method) {
	return function (this: unknown, event: MouseEvent) {
		const edge = edgeFor(assistantInset, event.width);
		if (edge === 0)
			return (original as (event: MouseEvent) => unknown).call(this, event);
		const x = event.x - edge;
		if (x < 0 || x >= event.width - edge * 2) return undefined;
		return (original as (event: MouseEvent) => unknown).call(this, {
			...event,
			x,
			width: event.width - edge * 2,
		});
	} as Method;
}

const targets: PatchTarget[] = [
	{
		proto: AssistantMessageComponent.prototype,
		name: "updateContent",
		create: guarded(updateContent as Method),
		replaces: true,
	},
	{
		proto: UserMessageComponent.prototype,
		name: "rebuild",
		create: guarded(rebuild as Method),
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
