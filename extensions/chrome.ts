import { homedir } from "node:os";

import {
	type ExtensionAPI,
	type ExtensionContext,
	keyText,
	sessionEntryToContextMessages,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Keybinding,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createChromeEditor, marginFor } from "./chrome-editor.ts";
import { displayKey, patchMenus, restoreMenus } from "./chrome-menus.ts";
import {
	patchMessages,
	registerMessages,
	restoreMessages,
} from "./chrome-messages.ts";
import { type Schedule, scheduleTimer } from "./child-sessions.ts";
import { spinnerMs, spread, workingFrames } from "./children-box.ts";
import { fixHeader } from "./fixed-header.ts";
import { readHeader, watchHeader } from "./shell.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";

export type ChromeTheme = Pick<Theme, "fg" | "bold" | "bg">;
export type Hint = { key: string; action: string };
export type KeyResolver = (binding: Keybinding) => string;

const STATUS_WIDGET = "pi-workflow-status";
const phaseTimerMinWidth = 60;

function plainText(text: string) {
	return terminalSafeLine(stripTerminalSequences(text));
}

export function createFooterHints() {
	let panel: Hint[] | undefined;
	const listeners = new Set<() => void>();
	return {
		get: () => panel,
		set(hints: Hint[] | undefined) {
			if (JSON.stringify(hints) === JSON.stringify(panel)) return;
			panel = hints;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export type FooterHints = ReturnType<typeof createFooterHints>;

export function shortenPath(path: string, home: string) {
	const clean = terminalSafeLine(path);
	const inHome =
		home !== "" && (clean === home || clean.startsWith(`${home}/`));
	const rest = inHome ? clean.slice(home.length) : clean;
	const root = inHome ? "~" : rest.startsWith("/") ? "" : undefined;
	const parts = rest.split("/").filter(Boolean);
	const short = parts.map((part, i) =>
		i >= parts.length - 2 ? part : (part.match(/^\.*[^.]/)?.[0] ?? part),
	);
	if (root === undefined) return short.join("/");
	return [root, ...short].join("/") || "/";
}

export function formatContextTokens(tokens: number) {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}K`;
	if (tokens < 1_000_000) return `${Math.floor(tokens / 1_000)}K`;
	if (tokens < 10_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	return `${Math.floor(tokens / 1_000_000)}M`;
}

export function formatOutputTokens(tokens: number) {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 10_000) return `${(tokens / 1_000).toFixed(2)}k`;
	if (tokens < 100_000) return `${(tokens / 1_000).toFixed(1)}k`;
	if (tokens < 1_000_000) return `${Math.floor(tokens / 1_000)}k`;
	if (tokens < 10_000_000) return `${(tokens / 1_000_000).toFixed(2)}m`;
	return `${(tokens / 1_000_000).toFixed(1)}m`;
}

export function formatDuration(ms: number) {
	const seconds = Math.max(0, ms) / 1_000;
	if (seconds < 10) return `${seconds.toFixed(1)}s`;
	const whole = Math.floor(seconds);
	if (whole < 60) return `${whole}s`;
	const minutes = Math.floor(whole / 60);
	if (minutes < 60) return `${minutes}m${whole % 60}s`;
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

export interface HeaderData {
	branch: string | null | undefined;
	cwd: string;
	home: string;
	working: number;
	usage: { tokens: number | null; contextWindow: number } | undefined;
}

function usageColor(percent: number) {
	if (percent >= 95) return "error";
	if (percent >= 75) return "warning";
	return "text";
}

function indented(lines: string[], width: number, extra = 0) {
	const pad = " ".repeat(marginFor(width) + extra);
	return lines.map((line) => pad + line);
}

export function renderHeader(
	theme: ChromeTheme,
	data: HeaderData,
	width: number,
) {
	const room = width - marginFor(width) * 2;
	const right: string[] = [];
	if (data.working > 0) right.push(theme.fg("accent", `◆ ${data.working}`));
	const { tokens, contextWindow } = data.usage ?? {};
	if (tokens != null && contextWindow) {
		right.push(
			theme.fg(
				usageColor((tokens / contextWindow) * 100),
				`${formatContextTokens(tokens)} / ${formatContextTokens(contextWindow)}`,
			),
		);
	}
	const branch = data.branch ? terminalSafeLine(data.branch) : "";
	const location = [
		branch && theme.fg("dim", branch),
		theme.fg("text", shortenPath(data.cwd, data.home)),
	]
		.filter(Boolean)
		.join(" ");
	const rightText = right.join(theme.fg("borderAccent", " │ "));
	if (!rightText) return indented([truncateToWidth(location, room)], width);
	return indented([spread(location, rightText, room)], width);
}

export interface StatusData {
	frame: number;
	label: string;
	tool?: string;
	stepMs?: number;
	turnMs?: number;
	outputTokens?: number;
}

export function renderStatusRow(
	theme: ChromeTheme,
	data: StatusData,
	width: number,
) {
	const indent = marginFor(width) ? 2 : 0;
	const room = width - marginFor(width) * 2 - indent;
	const spinner = workingFrames[data.frame % workingFrames.length];
	const label = terminalSafeLine(data.label);
	const activity = data.tool
		? `${theme.fg("dim", "Run ")}${theme.fg("text", terminalSafeLine(data.tool))}`
		: theme.fg("text", label);
	const phase =
		data.stepMs !== undefined && room >= phaseTimerMinWidth
			? theme.fg("dim", ` ${formatDuration(data.stepMs)}`)
			: "";
	const totals = [
		data.turnMs !== undefined ? formatDuration(data.turnMs) : "",
		data.outputTokens ? `⇣${formatOutputTokens(data.outputTokens)}` : "",
	]
		.filter(Boolean)
		.join(" ");
	const left = `${theme.fg("text", spinner)} ${activity}${phase}`;
	if (!totals) return indented([truncateToWidth(left, room)], width, indent);
	return indented([spread(left, theme.fg("dim", totals), room)], width, indent);
}

const idleHints: [Keybinding, string][] = [
	["app.thinking.cycle", "thinking"],
	["app.model.cycleForward", "model"],
	["app.tools.expand", "expand"],
	["app.clear", "clear"],
];

const workingHints: [Keybinding, string][] = [
	["app.interrupt", "interrupt"],
	["tui.input.submit", "steer"],
	["app.message.followUp", "follow-up"],
	["app.tools.expand", "expand"],
];

export function footerHints(
	working: boolean,
	panel: Hint[] | undefined,
	keys: KeyResolver,
): Hint[] {
	if (panel) return panel;
	return (working ? workingHints : idleHints).flatMap(([binding, action]) => {
		const key = displayKey(keys(binding).split("/")[0] ?? "");
		return key ? [{ key, action }] : [];
	});
}

export function renderFooter(
	theme: ChromeTheme,
	hints: Hint[],
	width: number,
	statuses: string[] = [],
) {
	const room = width - marginFor(width) * 2;
	const separator = theme.fg("borderAccent", "  │  ");
	let line = "";
	let used = 0;
	for (const hint of hints) {
		const key = terminalSafeLine(hint.key);
		const action = terminalSafeLine(hint.action);
		const gap = line ? 5 : 0;
		const size = gap + visibleWidth(key) + 1 + visibleWidth(action);
		if (used + size > room) break;
		line += `${line ? separator : ""}${theme.bold(theme.fg("text", key))}${theme.fg("dim", `:${action}`)}`;
		used += size;
	}
	let right = "";
	let rightUsed = 0;
	for (const status of statuses) {
		const text = plainText(status);
		if (!text) continue;
		const size = (rightUsed ? 2 : 0) + visibleWidth(text);
		if (used + 2 + rightUsed + size > room) continue;
		right += `${rightUsed ? "  " : ""}${theme.fg("dim", text)}`;
		rightUsed += size;
	}
	if (!right) return indented([truncateToWidth(line, room)], width);
	return indented([spread(line, right, room)], width);
}

export function registerChrome(
	pi: ExtensionAPI,
	hints: FooterHints,
	schedule: Schedule = scheduleTimer,
) {
	let ctx: ExtensionContext | undefined;
	const renders = new Set<{ requestRender(): void }>();
	let branch: () => string | null | undefined = () => undefined;
	let working = false;
	let turnStart = 0;
	let stepStart = 0;
	let label = "Waiting for response…";
	let tool: string | undefined;
	const running = new Map<string, { name: string; start: number }>();
	let doneTokens = 0;
	let liveTokens = 0;
	let frame = 0;
	let stopTick: (() => void) | undefined;
	let unsubscribe: (() => void)[] = [];
	let fixed: ReturnType<typeof fixHeader> | undefined;
	registerMessages(pi);

	function requestRender() {
		for (const tui of renders) tui.requestRender();
	}

	function tick() {
		stopTick?.();
		stopTick = undefined;
		if (!ctx || !working) return;
		frame += 1;
		requestRender();
		stopTick = schedule(tick, spinnerMs);
	}

	function step(next: string, nextTool?: string) {
		label = next;
		tool = nextTool;
		stepStart = Date.now();
		requestRender();
	}

	function syncTool() {
		const latest = [...running.values()].at(-1);
		if (!latest) {
			step("Waiting for response…");
			return;
		}
		tool = latest.name;
		stepStart = latest.start;
		requestRender();
	}

	function statusData(): StatusData | undefined {
		const now = Date.now();
		if (!working) return undefined;
		return {
			frame,
			label,
			tool,
			stepMs: stepStart === turnStart ? undefined : now - stepStart,
			turnMs: now - turnStart,
			outputTokens: doneTokens + liveTokens,
		};
	}

	function stop() {
		stopTick?.();
		stopTick = undefined;
		for (const off of unsubscribe) off();
		unsubscribe = [];
		fixed?.stop();
		fixed = undefined;
		renders.clear();
		running.clear();
		working = false;
	}

	pi.on("session_start", async (_event, startCtx) => {
		stop();
		if (startCtx.mode !== "tui") return;
		ctx = startCtx;
		patchMessages();
		patchMenus();
		const ui = startCtx.ui;
		ui.setWorkingVisible(false);
		ui.setHeader((tui, theme) => {
			renders.add(tui);
			const header = {
				render: (width: number) =>
					renderHeader(
						theme,
						{
							branch: branch(),
							cwd: startCtx.cwd,
							home: homedir(),
							working: readHeader()?.count ?? 0,
							usage: startCtx.getContextUsage(),
						},
						width,
					),
				invalidate() {},
			};
			fixed?.stop();
			const slot = fixHeader(tui, header);
			fixed = slot;
			return {
				render: (width: number) => (slot.active() ? [] : header.render(width)),
				invalidate() {},
				dispose: () => slot.stop(),
			};
		});
		ui.setFooter((tui, theme, footerData) => {
			renders.add(tui);
			branch = () => footerData.getGitBranch();
			const offBranch = footerData.onBranchChange(() => tui.requestRender());
			return {
				render: (width: number) =>
					renderFooter(
						theme,
						footerHints(working, hints.get(), keyText),
						width,
						[...footerData.getExtensionStatuses().values()],
					),
				invalidate() {},
				dispose: offBranch,
			};
		});
		ui.setWidget(
			STATUS_WIDGET,
			(tui, theme) => {
				renders.add(tui);
				return {
					render: (width: number) => {
						const data = statusData();
						return data ? renderStatusRow(theme, data, width) : [];
					},
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);
		ui.setEditorComponent((tui, editorTheme, keybindings) => {
			renders.add(tui);
			const input = createChromeEditor(tui, editorTheme, keybindings, {
				theme: () => startCtx.ui.theme,
				label: () => modelLabel(startCtx, startCtx.ui.theme),
			});
			for (const text of userHistory(startCtx.sessionManager))
				input.addToHistory(text);
			return input;
		});
		unsubscribe = [watchHeader(requestRender), hints.subscribe(requestRender)];
	});

	pi.on("agent_start", async () => {
		working = true;
		running.clear();
		doneTokens = 0;
		liveTokens = 0;
		step("Waiting for response…");
		turnStart = stepStart;
		tick();
	});
	pi.on("message_update", async (event) => {
		const update = event.assistantMessageEvent;
		if (event.message.role === "assistant")
			liveTokens = event.message.usage?.output ?? 0;
		if (tool) return;
		if (update.type === "thinking_start") step("Thinking…");
		else if (update.type === "text_start") step("Responding…");
	});
	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		doneTokens += event.message.usage?.output ?? 0;
		liveTokens = 0;
	});
	pi.on("tool_execution_start", async (event) => {
		running.set(event.toolCallId, {
			name: event.toolName,
			start: Date.now(),
		});
		syncTool();
	});
	pi.on("tool_execution_end", async (event) => {
		running.delete(event.toolCallId);
		syncTool();
	});
	pi.on("agent_end", async () => {
		working = false;
		running.clear();
		tool = undefined;
		requestRender();
	});
	pi.on("model_select", async () => requestRender());
	pi.on("thinking_level_select", async () => requestRender());
	pi.on("session_shutdown", async (event) => {
		stop();
		if (event.reason === "quit") {
			restoreMessages();
			restoreMenus();
		}
		ctx?.ui.setWorkingVisible(true);
		ctx?.ui.setWorkingIndicator();
		ctx?.ui.setWorkingMessage();
		ctx = undefined;
	});
}

function userHistory(
	sessionManager: Pick<
		ExtensionContext["sessionManager"],
		"buildContextEntries"
	>,
) {
	return sessionManager
		.buildContextEntries()
		.flatMap(sessionEntryToContextMessages)
		.flatMap((message) => {
			if (message.role !== "user") return [];
			const text =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("");
			return text ? [text] : [];
		});
}

const thinkingTokens = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
} as const;

export function modelLabel(
	ctx: Pick<ExtensionContext, "model" | "thinkingLevel">,
	theme: ChromeTheme,
) {
	const model = ctx.model;
	if (!model) return "";
	const id = plainText(model.id);
	const level = ctx.thinkingLevel;
	if (!model.reasoning || !level) return theme.fg("dim", id);
	return theme.fg(thinkingTokens[level], id) + theme.fg("dim", ` (${level})`);
}
