// Replicates the logic of Pi 0.99.1 (AssistantMessageComponent.updateContent, UserMessageComponent.rebuild, createMarkdownTransform).
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	BashExecutionComponent,
	InteractiveMode,
	type MarkdownTransformContext,
	type MarkdownTransformer,
	type Theme,
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
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const ORIGINAL = Symbol.for("pi-workflow:chrome-messages:original");
const INHERITED = Symbol.for("pi-workflow:chrome-messages:inherited");
const piDefaultHiddenLabel = "Thinking...";
const stampGap = 2;
const minTextWidth = 20;
const assistantInset = 3;
const userMargin = 1;
const userInset = 2;
const imageLine = new RegExp(`${String.fromCharCode(27)}(?:_G|\\]1337;File=)`);
const foregroundCodes = new RegExp(
	`${String.fromCharCode(27)}\\[(?:3[0-79]|9[0-7]|38[;:][\\d;:]+)m`,
	"g",
);

type Method = ((...args: never[]) => unknown) & {
	[ORIGINAL]?: Method;
	[INHERITED]?: boolean;
};
type Frame = { first: string; rest: string; stamp?: string; trail?: number };

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

const userStamps = new WeakMap<object, number | undefined>();
const thinkingTimes = new Map<string, { start: number; end?: number }>();
let pendingUserStamp: number | undefined;

function theme() {
	const current = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
	if (!current)
		throw new Error("Theme not initialized. Call initTheme() first.");
	return current;
}

function edgeFor(edge: number, outer: number) {
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
	time.end ??= Date.now();
	return time.end - time.start;
}

function thinkingHeader(label: string, duration: number | undefined) {
	const t = theme();
	const detail =
		duration === undefined
			? ""
			: t.fg("dim", ` for ${thoughtDuration(duration)}`);
	return `${t.fg("dim", "◆")} ${t.bold(t.fg("muted", label))}${detail}`;
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
	header: string,
) {
	const body = new Container();
	body.addChild(new Text(header, 0, 0));
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

function updateContent(
	this: AssistantState,
	message: AssistantMessage,
	isStreaming = this.isStreaming,
) {
	const inset = this.outputPad * assistantInset;
	this.lastMessage = message;
	this.isStreaming = isStreaming;
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
			const duration = thinkingDuration(message.timestamp, runIndex, running);
			const label = running ? "Thinking…" : "Thought";
			const custom = this.hiddenThinkingLabel !== piDefaultHiddenLabel;
			const thinkingComponent = hidden
				? new Text(
						custom
							? thinkingHeader(this.hiddenThinkingLabel, undefined)
							: thinkingHeader(label, duration),
						inset,
						0,
					)
				: expandedThinking(
						this,
						thinkingBlocks,
						thinkingHeader(label, duration),
					);
			this.contentContainer.addChild(
				new MouseRegion(thinkingComponent, (event) => {
					if (event.type !== "click" || event.button !== "left")
						return undefined;
					this.thinkingVisibilityOverrides.set(runIndex, !hidden);
					if (this.lastMessage) this.updateContent(this.lastMessage);
					return { handled: true };
				}),
			);
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
			new Text(
				theme().fg("error", "Response was truncated before completion."),
				inset,
				0,
			),
		);
	} else if (!hasToolCalls) {
		if (message.stopReason === "aborted") {
			const abortMessage =
				message.errorMessage && message.errorMessage !== "Request was aborted"
					? message.errorMessage
					: "Operation aborted";
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme().fg("error", abortMessage), inset, 0),
			);
		} else if (message.stopReason === "error") {
			const errorMsg = message.errorMessage || "Unknown error";
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme().fg("error", `Error: ${errorMsg}`), inset, 0),
			);
		}
	}
}

function rebuild(this: UserState) {
	if (!userStamps.has(this)) userStamps.set(this, pendingUserStamp);
	const timestamp = userStamps.get(this);
	this.clear();
	const contentBox = new Box(this.outputPad * userInset, 1, (content: string) =>
		theme().bg("userMessageBg", content),
	);
	const markdown = new Markdown(
		this.text,
		0,
		0,
		withLinkColor(this.markdownTheme),
		{ color: (content: string) => theme().fg("text", content) },
		{
			preserveOrderedListMarkers: true,
			preserveBackslashEscapes: true,
			transform: markdownTransform("user", false, this.markdownTransformers),
		},
	);
	contentBox.addChild(
		new Framed(markdown, () => ({
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

function wrapAddMessageToChat(original: Method) {
	return function (
		this: unknown,
		message: { role?: string; timestamp?: number },
		...rest: unknown[]
	) {
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

const targets: {
	proto: object;
	name: string;
	create: (original: Method) => Method;
	replaces: boolean;
}[] = [
	{
		proto: AssistantMessageComponent.prototype,
		name: "updateContent",
		create: () => updateContent as Method,
		replaces: true,
	},
	{
		proto: UserMessageComponent.prototype,
		name: "rebuild",
		create: () => rebuild as Method,
		replaces: true,
	},
	{
		proto: InteractiveMode.prototype,
		name: "addMessageToChat",
		create: wrapAddMessageToChat,
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

function slot(proto: object) {
	return proto as Record<string, Method | undefined>;
}

function pristine(method: Method, name: string) {
	return Function.prototype.toString.call(method).startsWith(`${name}(`);
}

export function patchMessages() {
	for (const { proto, name, create, replaces } of targets) {
		const current = slot(proto)[name];
		if (!current) continue;
		const original = current[ORIGINAL] ?? current;
		if (replaces && !pristine(original, name)) continue;
		const inherited = current[ORIGINAL]
			? current[INHERITED]
			: !Object.hasOwn(proto, name);
		const patched = create(original);
		patched[ORIGINAL] = original;
		patched[INHERITED] = inherited;
		slot(proto)[name] = patched;
	}
}

export function restoreMessages() {
	for (const { proto, name } of targets) {
		const current = slot(proto)[name];
		if (!current?.[ORIGINAL]) continue;
		if (current[INHERITED]) delete slot(proto)[name];
		else slot(proto)[name] = current[ORIGINAL];
	}
	thinkingTimes.clear();
}
