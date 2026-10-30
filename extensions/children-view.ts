import { basename } from "node:path";
import type {
	AssistantMessage,
	ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
	type ExtensionContext,
	getMarkdownTheme,
	type KeybindingsManager,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	Input,
	Key,
	Markdown,
	matchesKey,
	type OverlayHandle,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { AuditIdentity, ChildAudit, SegmentCursor } from "./child-audit.ts";
import {
	type ChildRecord,
	type createChildSessions,
	isWorking,
} from "./child-sessions.ts";
import { consultationReply } from "./child-runtime.ts";
import {
	type Block,
	createTranscript,
	type Item,
	partSub,
	type Slot,
} from "./child-transcript.ts";
import { errorMessage } from "./error-message.ts";
import {
	childElapsed,
	childModelLine,
	childName,
	childStep,
	lastReportedResult,
} from "./child-projection.ts";
import { type Schedule, scheduleTimer } from "./clock.ts";
import { seated } from "./shell.ts";

import {
	byState,
	type ChildTheme,
	childGlyph,
} from "./children-box.ts";
import { marginFor } from "./chrome-editor.ts";
import { toolLabel } from "./compact-tools.ts";
import {
	displayKey,
	fit,
	type Hint,
	type HintSpan,
	hintRows,
	modalFrame,
	modalMetrics,
	sectionRule,
	selectedRow,
} from "./chrome-menus.ts";
import { terminalSafeBlock, terminalSafeLine } from "./terminal-safe-text.ts";
import { spread } from "./visual-language.ts";

let closeSeatedView: () => void = () => {};

export function closeChildrenView() {
	closeSeatedView();
}

const minModalRows = 8;
const splitWidth = 57;
const divider = " │ ";
const promptRows = 4;
const twoLineRows = 12;
const tickMs = 1000;

type Sessions = ReturnType<typeof createChildSessions>;
type Thread = NonNullable<ReturnType<Sessions["thread"]>>;
type Span = { x: number; width: number };
type Action =
	| "down"
	| "up"
	| "open"
	| "focus"
	| "back"
	| "pageDown"
	| "pageUp"
	| "follow"
	| "prompt"
	| "cancel"
	| "close"
	| "thinking"
	| "expand"
	| "yes"
	| "no"
	| "type"
	| "send"
	| "leave"
	| "repair"
	| "authorize"
	| "refuse"
	| "defer";

function clean(text: string) {
	return terminalSafeBlock(text).trim();
}

function userText(content: string | { type: string; text?: string }[]) {
	return clean(
		typeof content === "string"
			? content
			: content.map((part) => part.text ?? "").join("\n"),
	);
}

function wrap(text: string, width: number) {
	return text
		.split("\n")
		.flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
}

function steerMarks(child: ChildRecord) {
	const mark = (count: number, state: string) =>
		count === 0 ? [] : [`${count} ${count === 1 ? "steer" : "steers"} ${state}`];
	return [
		...mark(child.steering?.length ?? 0, "pending"),
		...mark(child.undelivered?.length ?? 0, "undelivered"),
	];
}

function seconds(ms: number) {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function count(tokens: number) {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

function spent(thread: Thread | undefined) {
	let tokens = 0;
	let cost = 0;
	for (const entry of thread?.entries ?? []) {
		if (entry.type !== "message") continue;
		const { message } = entry;
		if (message.role !== "assistant" && message.role !== "toolResult") continue;
		tokens += message.usage?.totalTokens ?? 0;
		cost += message.usage?.cost?.total ?? 0;
	}
	return { tokens, cost };
}

function replyKind(child: ChildRecord) {
	if (child.state === "waiting" && child.question !== undefined)
		return "answer";
	if (child.state === "running") return "steer";
	return undefined;
}

function usage({ tokens, cost }: { tokens: number; cost: number }) {
	return [
		...(tokens > 0 ? [`${count(tokens)} tok`] : []),
		...(cost > 0 ? [`$${cost.toFixed(2)}`] : []),
	];
}

function runTime(child: ChildRecord, now: number) {
	return child.state === "queued" ? "queued" : childElapsed(child, now);
}

function runState(child: ChildRecord, now: number) {
	const time = runTime(child, now);
	return child.state === "queued" ? time : `${child.state} · ${time}`;
}

function sectionOf(item: Shown) {
	return item.live && isWorking(item.child.state) ? "Working" : "History";
}

function fleetOrder(items: Shown[]) {
	const ordered = (section: Shown[]) => {
		const groups = new Set(section.flatMap((item) => item.child.group ?? []));
		return [
			...section.filter((item) => item.child.group === undefined),
			...[...groups].flatMap((group) =>
				section.filter((item) => item.child.group === group),
			),
		];
	};
	const working = items
		.filter((item) => sectionOf(item) === "Working")
		.sort((a, b) => byState(a.child, b.child));
	const history = items
		.filter((item) => sectionOf(item) === "History")
		.sort((a, b) => a.child.createdAt - b.child.createdAt);
	return [...ordered(working), ...ordered(history)];
}

function groupLabel(group: string) {
	return `script ${[...terminalSafeLine(group)].slice(-4).join("")}`;
}

function pad(line: string, width: number) {
	const clipped = fit(line, width);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

type Style = {
	child: string;
	task: string;
	duplicate: string;
	hideThinking: boolean;
	expanded: boolean;
	expandKey: string;
};

function wrapped(text: string, width: number) {
	const rows: string[] = [];
	const lines: number[] = [];
	text.split("\n").forEach((line, index) => {
		for (const row of wrapTextWithAnsi(line, Math.max(1, width))) {
			rows.push(row);
			lines.push(index);
		}
	});
	return { rows, lines };
}

function resultText(value: unknown) {
	const content = (value as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part && typeof part === "object" && part.type === "text"
				? String(part.text ?? "")
				: "",
		)
		.join("\n");
}

const previewRows = 3;

function coreItems(thread: Thread | undefined): Item[] {
	if (!thread) return [];
	const results = new Map<string, ToolResultMessage>();
	for (const entry of thread.entries) {
		if (entry.type === "message" && entry.message.role === "toolResult") {
			results.set(entry.message.toolCallId, entry.message);
		}
	}
	const items: Item[] = [];
	const keys = new Set<string>();
	const assistant = (message: AssistantMessage, final: boolean, id = "") => {
		let key = `assistant:${message.timestamp}`;
		if (keys.has(key)) key = `${key}:${id}`;
		keys.add(key);
		items.push({
			key,
			kind: "message",
			entry: {
				type: "message",
				message: key,
				role: "assistant",
				content: message.content,
				...(message.errorMessage === undefined
					? {}
					: { errorMessage: message.errorMessage }),
				final,
			},
		});
		if (!final) return;
		for (const part of message.content) {
			if (part.type !== "toolCall") continue;
			const result = results.get(part.id);
			items.push({
				key: `tool:${part.id}`,
				kind: "tool",
				entry: {
					type: "tool",
					call: part.id,
					name: part.name,
					args: part.arguments,
					...(result
						? { result: { content: result.content }, error: result.isError, final: true }
						: { final: false }),
				},
			});
		}
	};
	for (const entry of thread.entries) {
		if (entry.type !== "message") continue;
		const { message } = entry;
		if (message.role === "user") {
			items.push({
				key: entry.id,
				kind: "input",
				source: "user",
				delivery: "delivered",
				text: userText(message.content),
			});
		} else if (message.role === "assistant") assistant(message, true, entry.id);
	}
	if (thread.streaming) assistant(thread.streaming, false);
	return items;
}

function createThread(theme: ChildTheme) {
	const markdown = getMarkdownTheme();
	const thoughts = new Map<string, { start: number; end?: number }>();

	function row(color: ThemeColor, label: string, detail = "") {
		const head = `${theme.fg(color, "◆")} ${theme.bold(theme.fg("muted", terminalSafeLine(label)))}`;
		const tail = terminalSafeLine(detail);
		return tail ? `${head} ${theme.fg("dim", tail)}` : head;
	}

	function thought(key: string, running: boolean) {
		const time = thoughts.get(key);
		if (running) {
			if (!time) thoughts.set(key, { start: Date.now() });
			return undefined;
		}
		if (!time) return undefined;
		time.end ??= Date.now();
		return time.end - time.start;
	}

	function indented(text: string, width: number, color: ThemeColor, indent = "  ") {
		const { rows, lines } = wrapped(text, width - indent.length);
		return { rows: rows.map((line) => `${indent}${theme.fg(color, line)}`), lines };
	}

	function slotBlocks(
		name: string,
		start: SegmentCursor,
		slot: Slot | undefined,
		width: number,
		indent: string,
	): Block[] {
		const note = (sub: string, text: string, color: ThemeColor = "dim") => ({
			sub: `${name}:${sub}`,
			rows: [`${indent}${theme.fg(color, text)}`],
		});
		if (!slot) {
			return [
				{ ...note("start", "… loading"), load: { slot: name, cursor: start, toward: "after" } },
			];
		}
		if (slot.unavailable) {
			return [note("unavailable", "This part of the evidence is unavailable.", "warning")];
		}
		const blocks: Block[] = [];
		const first = slot.parts[0];
		if (first?.previous) {
			blocks.push({
				...note("before", "… earlier parts"),
				load: { slot: name, cursor: first.previous, toward: "before" },
			});
		}
		let field: string | undefined;
		for (const part of slot.parts) {
			const body = indented(clean(part.text), width, "text", indent);
			const label = part.field !== undefined && part.field !== field;
			field = part.field;
			blocks.push({
				sub: partSub(name, part.part),
				rows: label
					? [`${indent}${theme.fg("dim", terminalSafeLine(part.field as string))}`, ...body.rows]
					: body.rows,
				lines: label ? [-1, ...body.lines] : body.lines,
			});
		}
		const last = slot.parts.at(-1);
		if (last?.next) {
			blocks.push({
				...note("after", "… more parts"),
				load: { slot: name, cursor: last.next, toward: "after" },
			});
		}
		return blocks;
	}

	function earlier(start: number | undefined, style: Style, indent: string): Block[] {
		if (start === undefined) return [];
		return [
			{
				sub: "earlier",
				rows: [
					theme.fg(
						"dim",
						`${indent}… continues from earlier evidence · ${style.expandKey} to show its start`,
					),
				],
				...(style.expanded ? { load: { earlier: start } } : {}),
			},
		];
	}

	function assistant(
		item: Extract<Item, { kind: "message" }>,
		width: number,
		style: Style,
		slot: (name: string) => Slot | undefined,
	): Block[] {
		const { entry } = item;
		const blocks: Block[] = earlier(entry.earlier, style, "  ");
		const content = Array.isArray(entry.content)
			? (entry.content as Record<string, unknown>[])
			: [];
		content.forEach((part, index) => {
			const sub = `b${index}`;
			if (part?.type === "thinking") {
				const text = clean(String(part.thinking ?? ""));
				if (!text) return;
				const running = !entry.final && index === content.length - 1;
				const ms = thought(`${style.child}:${entry.message}:${index}`, running);
				const head = running
					? row("dim", "Thinking…")
					: row("dim", "Thought", ms === undefined ? "" : `for ${seconds(ms)}`);
				const body = style.hideThinking
					? { rows: [], lines: [] }
					: indented(text, width, "dim");
				blocks.push({ sub, rows: [head, ...body.rows], lines: [-1, ...body.lines] });
			} else if (part?.type === "text") {
				const text = clean(String(part.text ?? ""));
				if (text && !(entry.final && text === style.duplicate)) {
					blocks.push({ sub, rows: new Markdown(text, 0, 0, markdown).render(width) });
				}
			} else if (part?.type === "toolCall" && !entry.final) {
				const args = terminalSafeLine(
					typeof part.arguments === "string"
						? part.arguments
						: JSON.stringify(part.arguments ?? ""),
				);
				blocks.push({
					sub,
					rows: [truncateToWidth(row("dim", "Calling a tool", args), width, "…")],
				});
			}
		});
		if (entry.segment) {
			blocks.push({ sub: "large", rows: [row("dim", "Message", "retained in parts")] });
			blocks.push(
				...(style.expanded
					? slotBlocks("message", entry.segment, slot("message"), width, "  ")
					: [
							{
								sub: "collapsed",
								rows: [theme.fg("dim", `  … ${style.expandKey} to expand`)],
							},
						]),
			);
		}
		const error = entry.errorMessage && clean(entry.errorMessage);
		if (error && error !== style.duplicate) {
			const body = wrapped(error, width - 2);
			blocks.push({
				sub: "error",
				rows: body.rows.map(
					(line, i) =>
						`${i === 0 ? `${theme.fg("error", "◆")} ` : "  "}${theme.fg("muted", line)}`,
				),
				lines: body.lines,
			});
		}
		return blocks;
	}

	function tool(
		item: Extract<Item, { kind: "tool" }>,
		width: number,
		style: Style,
		slot: (name: string) => Slot | undefined,
	): Block[] {
		const { entry } = item;
		const indent = entry.parent ? "    " : "  ";
		const lead = entry.parent ? "  " : "";
		const color: ThemeColor = entry.error
			? "error"
			: entry.final
				? "toolTitle"
				: "dim";
		const [label, detail] = toolLabel(entry.name, entry.args);
		const blocks: Block[] = [
			{
				sub: "head",
				rows: [
					truncateToWidth(
						`${lead}${row(color, label, entry.argsSegment && !entry.args ? "large arguments" : detail)}`,
						width,
						"…",
					),
				],
			},
			...earlier(entry.earlier, style, indent),
		];
		if (entry.argsSegment && style.expanded) {
			blocks.push(...slotBlocks("args", entry.argsSegment, slot("args"), width, indent));
		} else if (entry.args !== undefined && style.expanded) {
			const body = indented(clean(JSON.stringify(entry.args, null, 2)), width, "dim", indent);
			blocks.push({ sub: "args", rows: body.rows, lines: body.lines });
		}
		if (entry.resultSegment) {
			blocks.push(
				...(style.expanded
					? slotBlocks("result", entry.resultSegment, slot("result"), width, indent)
					: [
							{
								sub: "collapsed",
								rows: [
									theme.fg("dim", `${indent}… large output · ${style.expandKey} to expand`),
								],
							},
						]),
			);
			return blocks;
		}
		const text = clean(resultText(entry.final ? entry.result : entry.partial));
		if (!text) return blocks;
		const body = indented(text, width, entry.error ? "error" : "dim", indent);
		if (style.expanded || body.rows.length <= previewRows) {
			blocks.push({ sub: "result", rows: body.rows, lines: body.lines });
			return blocks;
		}
		blocks.push({
			sub: "result",
			rows: [
				...body.rows.slice(0, previewRows),
				theme.fg(
					"dim",
					`${indent}… +${body.rows.length - previewRows} lines · ${style.expandKey} to expand`,
				),
			],
			lines: [...body.lines.slice(0, previewRows), -1],
		});
		return blocks;
	}

	function input(
		item: Extract<Item, { kind: "input" }>,
		width: number,
		style: Style,
		slot: (name: string) => Slot | undefined,
	): Block[] {
		const answer = item.question === undefined ? "Answer" : `Answer ${item.question}`;
		if (item.segment) {
			const label =
				item.source === "answer"
					? answer
					: item.source === "steer"
						? "Steer"
						: item.source === "follow-up"
							? "Follow-up"
							: "Message";
			const queued = item.delivery === "queued" ? " queued," : "";
			return [
				{
					sub: "input",
					rows: [
						truncateToWidth(
							`${theme.fg("accent", "❯ ")}${theme.fg("dim", `${label}${queued} retained in parts`)}`,
							width,
							"…",
						),
					],
				},
				...(style.expanded
					? slotBlocks("text", item.segment, slot("text"), width, "  ")
					: [{ sub: "collapsed", rows: [theme.fg("dim", `  … ${style.expandKey} to expand`)] }]),
			];
		}
		const text = clean(item.text);
		if (!text) return [];
		if (item.source === "user" && text === clean(style.task)) return [];
		if (item.delivery === "queued") {
			const label = item.source === "answer" ? `${answer} queued` : `${item.source === "steer" ? "Steer" : "Follow-up"} queued`;
			return [{ sub: "input", rows: [truncateToWidth(row("dim", label, text.split("\n")[0]), width, "…")] }];
		}
		const prefix = item.source === "answer" ? `${answer}: ` : "";
		const body = wrapped(`${prefix}${text}`, width - 2);
		return [
			{
				sub: "input",
				rows: body.rows.map(
					(line, i) =>
						`${i === 0 ? theme.fg("accent", "❯ ") : "  "}${theme.fg("text", line)}`,
				),
				lines: body.lines,
			},
		];
	}

	return {
		render(
			item: Item,
			width: number,
			style: Style,
			slot: (name: string) => Slot | undefined,
		): Block[] {
			if (item.kind === "message") return assistant(item, width, style, slot);
			if (item.kind === "tool") return tool(item, width, style, slot);
			if (item.kind === "input") return input(item, width, style, slot);
			if (item.kind === "execution") {
				const verdict = item.verdict ? ` · ${item.verdict}` : "";
				return [
					{
						sub: "state",
						rows: [truncateToWidth(theme.fg("dim", `→ ${terminalSafeLine(item.state)}${terminalSafeLine(verdict)}`), width, "…")],
					},
				];
			}
			if (item.kind === "unsupported") {
				return [
					{
						sub: "unsupported",
						rows: [row("warning", "Unsupported evidence", `#${item.ordinal} is not interpreted`)],
					},
				];
			}
			if (item.kind === "unavailable") {
				const range = item.to === undefined ? `from #${item.from}` : item.to === item.from ? `#${item.from}` : `#${item.from}–${item.to}`;
				return [{ sub: "gap", rows: [row("warning", "Evidence unavailable", range)] }];
			}
			return [];
		},
	};
}

type Audit = Pick<ChildAudit, "list" | "read" | "segment" | "repair" | "repairCatalog">;
type Listed = Awaited<ReturnType<ChildAudit["list"]>>["records"][number];
type Shown = { child: ChildRecord; live: boolean; listed?: Listed };

function historical(listed: Listed): ChildRecord {
	const identity = listed.identity as Partial<AuditIdentity>;
	return {
		id: listed.child,
		role: identity.role ?? "child",
		task: identity.task ?? "",
		worktree: identity.worktree ?? "",
		model: identity.model ?? "",
		thinking: (identity.thinking ?? "off") as ChildRecord["thinking"],
		state: (listed.state ?? "queued") as ChildRecord["state"],
		createdAt: identity.createdAt ?? 0,
		...(identity.group === undefined ? {} : { group: identity.group }),
	};
}

function captureLine(health: Listed["health"] | undefined, warning?: string) {
	if (!health) return undefined;
	const durable = health.closed !== undefined || health.marker === "written";
	const notes = [health.warning, warning].filter(
		(note): note is string => typeof note === "string" && note.length > 0,
	);
	if (health.complete && notes.length === 0) return undefined;
	const state = health.complete ? "capture warning" : "incomplete transcript";
	return `${state} (${durable ? "recorded" : "live"})${notes.length > 0 ? `: ${notes.join(" ")}` : ""}`;
}

export function createChildrenViews(
	sessions: Sessions,
	audit: Audit,
	todo: { text(id: number): string | undefined },
	schedule: Schedule = scheduleTimer,
) {
	const open = new Set<() => void>();
	const close = () => {
		for (const closeOne of [...open]) closeOne();
	};
	closeSeatedView = close;
	return {
		async open(ctx: ExtensionContext) {
			if (!seated("child-session", "overlay")) {
				ctx.ui.notify(
					"Child session is not seated. Run /workflow:config.",
					"error",
				);
				return;
			}
			let handle: OverlayHandle | undefined;
			await ctx.ui.custom<void>(
				(tui, theme, keybindings, done) =>
					createChildrenView(sessions, audit, tui, theme, keybindings, {
						done,
						open,
						schedule,
						todo,
						focused: () =>
							handle?.isFocused() !== false ||
							// pi-tui types isOverlayFocused as protected; it is public at runtime.
							(
								tui as unknown as { isOverlayFocused(): boolean }
							).isOverlayFocused(),
					}),
				{
					overlay: true,
					overlayOptions: {
						width: "100%",
						maxHeight: "100%",
						anchor: "center",
						margin: 0,
					},
					onHandle: (value) => {
						handle = value;
					},
				},
			);
		},
		close,
	};
}

function createChildrenView(
	sessions: Sessions,
	audit: Audit,
	tui: { requestRender(): void; terminal: { rows: number } },
	theme: ChildTheme,
	keybindings: KeybindingsManager,
	host: {
		done(): void;
		open: Set<() => void>;
		schedule: Schedule;
		todo: { text(id: number): string | undefined };
		focused(): boolean;
	},
) {
	let selected: string | undefined = sessions
		.list()
		.filter((child) => !isWorking(child.state))
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]?.id;
	let focus: "list" | "detail" = "list";
	let confirming: string | undefined;
	let notice = "";
	let listTop = 0;
	let listFree = false;
	let detailRoom = 1;
	let listRoom = 1;
	let promptOpen = false;
	let expanded = false;
	let hideThinking = false;
	let typing = false;
	let answering: number | undefined;
	let deciding:
		| { id: string; name: string; number: number; ref: string; text: string }
		| undefined;
	const input = new Input({ prompt: "❯ " });
	let followed: string | undefined;
	let unfollow: (() => void) | undefined;
	let transcript: ReturnType<typeof createTranscript> | undefined;
	let tick: (() => void) | undefined;
	let listed = new Map<string, Listed>();
	let pages = 1;
	let more: string | undefined;
	let listing = false;
	let relist = false;
	let repairing: { id?: string; controller: AbortController } | undefined;
	let uncatalogued: string | undefined;
	const thread = createThread(theme);
	let layout = {
		width: 0,
		edge: 0,
		left: 0,
		size: 0,
		split: false,
		list: undefined as Span | undefined,
		detail: undefined as Span | undefined,
		ids: new Map<number, string>(),
		hints: [] as (HintSpan & { y: number; action: Action })[],
	};
	const unsubscribe = sessions.subscribe(() => {
		transcript?.changed();
		void catalog();
		tui.requestRender();
		arm();
	});
	const thinkingKey = displayKey(
		keybindings.getKeys("app.thinking.toggle").join("/"),
	);
	const expandKey = displayKey(
		keybindings.getKeys("app.tools.expand").join("/") || "ctrl+o",
	);
	host.open.add(close);
	arm();
	void catalog();

	async function catalog() {
		if (listing) {
			relist = true;
			return;
		}
		listing = true;
		try {
			const found = new Map<string, Listed>();
			let after: string | undefined;
			let next: string | undefined;
			for (let page = 0; page < pages; page++) {
				const result = await audit.list(after);
				if (page === 0) uncatalogued = result.catalog;
				for (const record of result.records) found.set(record.child, record);
				next = result.next;
				if (next === undefined) break;
				after = next;
			}
			listed = found;
			more = next;
		} catch {
		} finally {
			listing = false;
			if (host.open.has(close)) {
				tui.requestRender();
				if (relist) {
					relist = false;
					void catalog();
				}
			}
		}
	}

	function arm() {
		if (tick || !host.open.has(close)) return;
		if (!sessions.list().some((child) => isWorking(child.state))) return;
		tick = host.schedule(() => {
			tick = undefined;
			tui.requestRender();
			arm();
		}, tickMs);
	}

	function children() {
		const live = sessions.list();
		const ids = new Set(live.map((child) => child.id));
		const list = fleetOrder([
			...live.map((child) => ({ child, live: true, listed: listed.get(child.id) })),
			...[...listed.values()]
				.filter((record) => !ids.has(record.child) && record.identity.parent !== undefined)
				.map((record) => ({ child: historical(record), live: false, listed: record })),
		]);
		const found = list.findIndex((item) => item.child.id === selected);
		if (found === -1 && focus === "detail" && !layout.split) focus = "list";
		const index = Math.max(0, found);
		return { list, index, item: list[index] as Shown | undefined };
	}

	function track(id: string | undefined, live: boolean) {
		if (id === followed) return;
		unfollow?.();
		transcript?.dispose();
		followed = id;
		transcript = id
			? createTranscript({
					audit,
					child: id,
					changed: () => tui.requestRender(),
					...(live ? { live: () => coreItems(sessions.thread(id)) } : {}),
				})
			: undefined;
		unfollow =
			id && live
				? sessions.follow(id, () => {
						transcript?.changed();
						tui.requestRender();
					})
				: undefined;
		promptOpen = false;
		leave();
	}

	function cleanup() {
		host.open.delete(close);
		unsubscribe();
		unfollow?.();
		transcript?.dispose();
		tick?.();
		unfollow = tick = transcript = undefined;
	}

	function close() {
		if (!host.open.has(close)) return;
		cleanup();
		host.done();
	}

	function repairable(item: Shown | undefined) {
		if (!item || (item.live && isWorking(item.child.state))) return false;
		return repairing?.id === item.child.id || item.listed?.index !== undefined;
	}

	function repairs(item: Shown | undefined): [Hint, Action][] {
		if (repairing) return [[["r", "cancel repair"], "repair"]];
		return repairable(item) || uncatalogued ? [[["r", "repair"], "repair"]] : [];
	}

	function repair(item: Shown | undefined) {
		if (repairing) {
			repairing.controller.abort();
			notice = "Cancelling the repair…";
			return;
		}
		const controller = new AbortController();
		const id = repairable(item) ? item?.child.id : undefined;
		const name = item && id ? childName(item.child) : "the catalog";
		const current = { id, controller };
		repairing = current;
		notice = `Repairing ${name}…`;
		const outcome = id
			? audit.repair(id, controller.signal).then((result) => {
					if (!result) return `${name} has no record to repair.`;
					if ("cancelled" in result) return `Repair of ${name} cancelled.`;
					if ("refused" in result) return `Repair of ${name} refused: ${result.refused}`;
					const lost = result.unavailable.length;
					return `Repaired ${name}: ${result.recovered} observations recovered${lost > 0 ? `, ${lost} unavailable ranges` : ""}.`;
				})
			: audit.repairCatalog(controller.signal).then((result) => {
					if ("cancelled" in result) return "Repair of the catalog cancelled.";
					if ("refused" in result) return `Repair of the catalog refused: ${result.refused}`;
					const added = `Catalog repaired: ${result.added} ${result.added === 1 ? "record" : "records"} added.`;
					return "warning" in result ? `${added} ${result.warning}` : added;
				});
		void outcome
			.then((text) => {
				notice = text;
			})
			.catch((error: unknown) => {
				notice = `Repair of ${name} failed: ${errorMessage(error)}`;
			})
			.finally(() => {
				if (repairing === current) repairing = undefined;
				if (!host.open.has(close)) return;
				transcript?.changed();
				void catalog();
				tui.requestRender();
			});
	}

	function cancel(id: string, name: string) {
		const result = sessions.cancel(id, true);
		notice = result.cancelled ? `${name} cancelled.` : result.message;
	}

	function spentBy(items: Shown[]) {
		let tokens = 0;
		let cost = 0;
		for (const { child } of items) {
			const item = spent(sessions.thread(child.id));
			tokens += item.tokens;
			cost += item.cost;
		}
		return { tokens, cost };
	}

	function refusal(item: Shown) {
		const { child } = item;
		if (!item.live) return `${childName(child)} is history; it is read-only.`;
		if (replyKind(child)) return undefined;
		if (child.state === "queued")
			return `${childName(child)} is queued; it takes a Steer once it runs.`;
		return `${childName(child)} is ${child.state}; an ended child takes no Steer or answer.`;
	}

	function leave() {
		typing = false;
		answering = undefined;
		input.setValue("");
	}

	function send(item: Shown | undefined) {
		const text = input.getValue().trim();
		const number = answering;
		if (!item?.live || !text) return;
		const { child } = item;
		leave();
		if (number === undefined) {
			notice = `Steer sent to ${childName(child)}.`;
			sessions.steer(child.id, text).catch((error: unknown) => {
				notice = errorMessage(error);
				tui.requestRender();
			});
			return;
		}
		if (child.consultation) {
			deciding = {
				id: child.id,
				name: childName(child),
				number,
				ref: child.consultation,
				text,
			};
			return;
		}
		answer(child.id, childName(child), number, text);
	}

	function answer(id: string, name: string, number: number, text: string) {
		try {
			sessions.reply(id, number, text, "operator");
			notice = `Answer sent to ${name}.`;
		} catch (error) {
			notice = errorMessage(error);
		}
	}

	function decide(kind: "resolved" | "deny" | "pending") {
		if (!deciding) return;
		const { id, name, number, ref, text } = deciding;
		deciding = undefined;
		answer(id, name, number, consultationReply(ref, kind, text));
	}

	function scrollDetail(delta: number) {
		transcript?.scroll(delta);
	}

	function scrollList(delta: number) {
		listTop = Math.max(0, listTop + delta);
		listFree = true;
	}

	function scrollFocused(sign: number) {
		if (focus === "list" && layout.split)
			scrollList(sign * Math.max(1, listRoom - 1));
		else scrollDetail(sign * Math.max(1, detailRoom - 1));
	}

	function press(action: Action) {
		const { list, index, item } = children();
		const child = item?.child;
		const name = child ? childName(child) : "";
		const single = !layout.split && focus === "detail";
		notice = "";
		if (action === "yes" && confirming) {
			const pending = sessions.get(confirming);
			cancel(confirming, pending ? childName(pending) : confirming);
			confirming = undefined;
		} else if (action === "no") {
			confirming = undefined;
		} else if (action === "authorize") {
			decide("resolved");
		} else if (action === "refuse") {
			decide("deny");
		} else if (action === "defer") {
			decide("pending");
		} else if (action === "leave" && deciding) {
			deciding = undefined;
		} else if ((action === "down" || action === "up") && single) {
			scrollDetail(action === "down" ? 1 : -1);
		} else if (action === "down" || action === "up") {
			const next = Math.min(
				list.length - 1,
				Math.max(0, index + (action === "down" ? 1 : -1)),
			);
			selected = list[next]?.child.id;
			listFree = false;
		} else if (action === "open" && child) {
			selected = child.id;
			focus = "detail";
		} else if (action === "focus" && child) {
			selected = child.id;
			focus = focus === "list" ? "detail" : "list";
		} else if (action === "back") {
			focus = "list";
		} else if (action === "pageDown" || action === "pageUp") {
			scrollFocused(action === "pageDown" ? 1 : -1);
		} else if (action === "follow") {
			transcript?.follow();
		} else if (action === "prompt") {
			promptOpen = !promptOpen;
		} else if (action === "close") {
			close();
		} else if (action === "thinking") {
			hideThinking = !hideThinking;
		} else if (action === "expand") {
			expanded = !expanded;
			if (!expanded) transcript?.collapse();
		} else if (action === "type" && item && child) {
			selected = child.id;
			focus = "detail";
			const reason = refusal(item);
			if (reason) notice = reason;
			else {
				typing = true;
				answering = child.question;
			}
		} else if (action === "send") {
			send(item);
		} else if (action === "leave") {
			leave();
		} else if (action === "repair" && repairs(item).length > 0) {
			repair(item);
		} else if (action === "cancel" && item && child) {
			if (!item.live) {
				notice = `${name} is history; it is read-only.`;
			} else if (!isWorking(child.state)) {
				notice = `${name} already ended; it cannot be cancelled.`;
			} else if (child.state === "queued") {
				cancel(child.id, name);
			} else {
				confirming = child.id;
			}
		}
		tui.requestRender();
	}

	function actionFor(data: string): Action | undefined {
		if (deciding) {
			if (data === "y") return "authorize";
			if (data === "n") return "refuse";
			if (data === "p") return "defer";
			if (matchesKey(data, Key.escape)) return "leave";
			return undefined;
		}
		if (typing) {
			if (matchesKey(data, Key.escape)) return "leave";
			if (matchesKey(data, Key.enter)) return "send";
			return undefined;
		}
		if (confirming) {
			if (data === "y") return "yes";
			if (data === "n" || matchesKey(data, Key.escape)) return "no";
			return undefined;
		}
		if (data === "q") return "close";
		if (data === "s" || data === "c") return "cancel";
		if (data === "f") return "follow";
		if (data === "p") return "prompt";
		if (data === "r") return "repair";
		if (keybindings.matches(data, "app.thinking.toggle")) return "thinking";
		if (keybindings.matches(data, "app.tools.expand")) return "expand";
		if (matchesKey(data, Key.ctrl("j")) || matchesKey(data, Key.pageDown)) {
			return "pageDown";
		}
		if (matchesKey(data, Key.ctrl("k")) || matchesKey(data, Key.pageUp)) {
			return "pageUp";
		}
		if (matchesKey(data, Key.tab)) return "focus";
		if (matchesKey(data, Key.escape)) {
			return focus === "detail" && !layout.split ? "back" : "close";
		}
		if (matchesKey(data, Key.enter))
			return focus === "detail" || layout.split ? "type" : "open";
		if (data === "j" || keybindings.matches(data, "tui.select.down")) {
			return "down";
		}
		if (data === "k" || keybindings.matches(data, "tui.select.up")) {
			return "up";
		}
		return undefined;
	}

	function footer(split: boolean, detail: boolean, item: Shown | undefined) {
		if (deciding)
			return [
				[["y", "confirm"], "authorize"],
				[["n", "deny"], "refuse"],
				[["p", "pending"], "defer"],
				[["Esc", "discard"], "leave"],
			] as [Hint, Action][];
		if (typing)
			return [
				[["Enter", "send"], "send"],
				[["Esc", "stop typing"], "leave"],
			] as [Hint, Action][];
		if (confirming)
			return [
				[["y", "yes"], "yes"],
				[["n", "no"], "no"],
			] as [Hint, Action][];
		const live = item?.live ?? true;
		const working = item ? live && isWorking(item.child.state) : true;
		const inputHint: [Hint, Action][] = live
			? [
					[
						["Enter", (item && replyKind(item.child)) ?? "input"],
						"type",
					],
				]
			: [];
		const cancelHint: [Hint, Action][] = working
			? [[["s/c", "cancel"], "cancel"]]
			: [];
		const scroll: [Hint, Action][] = [
			[["Ctrl+J/K", "scroll"], "pageDown"],
			[["f", "follow"], "follow"],
		];
		const views: [Hint, Action][] = [
			[[expandKey, "expand"], "expand"],
			[[thinkingKey, "thinking"], "thinking"],
			...repairs(item),
		];
		if (split)
			return [
				[["j/k", "move"], "down"],
				[["Tab", "focus"], "focus"],
				...inputHint,
				...scroll,
				...cancelHint,
				...views,
				[["q", "close"], "close"],
			] as [Hint, Action][];
		if (detail)
			return [
				[["Esc", "back"], "back"],
				...inputHint,
				...scroll,
				...cancelHint,
				...views,
				[["q", "close"], "close"],
			] as [Hint, Action][];
		return [
			[["j/k", "move"], "down"],
			[["Enter", "detail"], "open"],
			...(live ? ([[["s/c", "cancel"], "cancel"]] as [Hint, Action][]) : []),
			...repairs(item),
			[["q", "close"], "close"],
		] as [Hint, Action][];
	}

	function status() {
		const pending =
			confirming === undefined ? undefined : sessions.get(confirming);
		if (pending) {
			return theme.fg("warning", `Cancel ${childName(pending)}? y/n`);
		}
		if (deciding) {
			return theme.fg(
				"warning",
				`Authorization for ${deciding.name}: does your answer confirm this exact action?`,
			);
		}
		if (!notice && uncatalogued) {
			return theme.fg("warning", terminalSafeLine(uncatalogued));
		}
		return theme.fg("dim", terminalSafeLine(notice));
	}

	function rule(label: string, width: number, focused: boolean) {
		if (!focused) return sectionRule(theme, label, width);
		const title = truncateToWidth(` ${label} `, width, "");
		return (
			theme.bold(theme.fg("accent", title)) +
			theme.fg("accent", "─".repeat(Math.max(0, width - visibleWidth(title))))
		);
	}

	function glyph(item: Shown) {
		if (item.listed?.interrupted && !item.live) return theme.fg("warning", "⊘");
		return childGlyph(theme, item.child);
	}

	function stateOf(item: Shown, now: number) {
		if (item.live) return runState(item.child, now);
		const verdict = item.listed?.verdict ? ` · ${item.listed.verdict}` : "";
		if (item.listed?.interrupted) return "interrupted";
		return `${item.child.state}${verdict}`;
	}

	function timeOf(item: Shown, now: number) {
		return item.live ? runTime(item.child, now) : stateOf(item, now);
	}

	function renderList(
		list: Shown[],
		index: number,
		width: number,
		rows: number,
		focused: boolean,
	) {
		const now = Date.now();
		const two = rows >= twoLineRows;
		const lines: string[] = [];
		const ids: (string | undefined)[] = [];
		let section: string | undefined;
		let group: string | undefined;
		list.forEach((item, i) => {
			const { child } = item;
			const name = sectionOf(item);
			if (name !== section) {
				section = name;
				group = undefined;
				lines.push(rule(name, width, false));
				ids.push(undefined);
			}
			if (child.group !== undefined && child.group !== group) {
				const members = list.filter((other) => other.child.group === child.group);
				const done = members.filter((other) => sectionOf(other) === "History");
				const { tokens } = spentBy(members);
				lines.push(
					rule(groupLabel(child.group), width, false),
					theme.fg(
						"dim",
						spread(
							`${members.length} launched · ${done.length} done`,
							`${count(tokens)} tok`,
							width,
						),
					),
				);
				ids.push(undefined, undefined);
			}
			group = child.group;
			const active = i === index;
			const mark = active
				? focused
					? theme.bold(theme.fg("accent", "▸ "))
					: theme.fg("dim", "▸ ")
				: "  ";
			const step = terminalSafeLine(item.live ? childStep(child) : child.task.trim().split("\n")[0] ?? "");
			const color = child.state === "waiting" && item.live ? "warning" : "dim";
			const head = `${mark}${glyph(item)} ${theme.fg("accent", terminalSafeLine(child.role))} ${theme.fg("dim", terminalSafeLine(child.id.slice(0, 4)))}`;
			const task = child.todo === undefined ? undefined : host.todo.text(child.todo);
			const detail =
				child.todo !== undefined && task !== undefined
					? `${theme.fg("text", `#${child.todo} ${terminalSafeLine(task)}`)} ${theme.fg(color, step)}`
					: theme.fg(color, step);
			const state = stateOf(item, now);
			const spend = usage(spent(sessions.thread(child.id)));
			const marks = [
				...steerMarks(child),
				...(item.listed && !item.listed.health.complete ? ["incomplete transcript"] : []),
			];
			const right = (rest: string[]) =>
				[
					...(marks.length > 0 ? [theme.fg("warning", marks.join(" · "))] : []),
					...(rest.length > 0 ? [theme.fg("dim", rest.join(" · "))] : []),
				].join(theme.fg("dim", " · "));
			const tail =
				[[state, ...spend], [state], [timeOf(item, now)]]
					.map(right)
					.find((text) => visibleWidth(head) + 1 + visibleWidth(text) <= width) ??
				right([timeOf(item, now)]);
			const room = width - visibleWidth(head) - visibleWidth(tail) - 2;
			const shown = two
				? [
						spread(head, theme.fg("dim", state), width),
						spread(`    ${detail}`, right(spend), width),
					]
				: [
						spread(
							room > 1
								? `${head} ${truncateToWidth(detail, room, "…")}`
								: head,
							tail,
							width,
						),
					];
			for (const line of shown) {
				lines.push(active ? selectedRow(theme, line, width) : line);
				ids.push(child.id);
			}
		});
		if (list.length === 0) {
			lines.push(theme.fg("dim", "No children in this session."));
			ids.push(undefined);
		}
		const at = ids.indexOf(list[index]?.child.id);
		if (!listFree && at >= 0) {
			let start = at;
			while (start > 0 && ids[start - 1] === undefined) start -= 1;
			const end = at + (two ? 2 : 1);
			if (start < listTop) listTop = start;
			if (end > listTop + rows) listTop = end - rows;
		}
		listTop = Math.max(0, Math.min(listTop, lines.length - rows));
		if (more !== undefined && !listing && listTop + rows >= lines.length) {
			pages += 1;
			void catalog();
		}
		return {
			lines: lines.slice(listTop, listTop + rows),
			ids: ids.slice(listTop, listTop + rows),
		};
	}

	function header(item: Shown, width: number, focused: boolean) {
		const { child } = item;
		const state = stateOf(item, Date.now());
		const meta = [
			childModelLine(child),
			...usage(spent(sessions.thread(child.id))),
			...(child.worktree ? [`wt: ${basename(child.worktree)}`] : []),
		].join(" · ");
		const info = transcript?.info();
		const notes = new Set([info?.warning, item.listed?.index].filter((note) => note !== undefined));
		const capture = captureLine(
			info?.health ?? item.listed?.health,
			notes.size > 0 ? [...notes].join(" ") : undefined,
		);
		return [
			spread(
				`${glyph(item)} ${theme.bold(theme.fg(focused ? "accent" : "text", terminalSafeLine(childName(child))))}`,
				theme.fg("dim", terminalSafeLine(state)),
				width,
			),
			theme.fg("dim", truncateToWidth(terminalSafeLine(meta), width, "…")),
			theme.fg(
				"muted",
				truncateToWidth(
					terminalSafeLine(child.task.trim().split("\n")[0] ?? ""),
					width,
					"…",
				),
			),
			...(capture
				? [theme.fg("warning", truncateToWidth(terminalSafeLine(capture), width, "…"))]
				: []),
		];
	}

	function head(item: Shown, width: number, focused: boolean): Block[] {
		const lines = [rule("Prompt", width, focused)];
		const prompt = wrap(clean(item.child.task), width - 2);
		const shown = promptOpen ? prompt : prompt.slice(0, promptRows);
		lines.push(
			...shown.map(
				(line, i) =>
					`${i === 0 ? theme.fg("accent", "❯ ") : "  "}${theme.fg("text", line)}`,
			),
		);
		if (shown.length < prompt.length) {
			lines.push(
				theme.fg(
					"dim",
					`  … +${prompt.length - shown.length} lines · p expand`,
				),
			);
		}
		const instructions = clean(transcript?.info().identity?.instructions ?? "");
		if (instructions) {
			const contract = wrap(instructions, width - 2);
			lines.push(
				theme.fg(
					"dim",
					promptOpen
						? "  Contract"
						: `  Contract · ${contract.length} ${contract.length === 1 ? "line" : "lines"} · p expand`,
				),
			);
			if (promptOpen) lines.push(...contract.map((line) => `  ${theme.fg("dim", line)}`));
		}
		lines.push(rule("Thread", width, focused));
		return [{ sub: "prompt", rows: lines }];
	}

	function tail(item: Shown, width: number, focused: boolean): Block[] {
		const { child } = item;
		if (!item.live) return [];
		const lines: string[] = [];
		const files = sessions.changedFiles(child.id);
		if (files.length > 0) {
			lines.push("", rule("Changed files", width, focused));
			for (const file of files) {
				lines.push(
					theme.fg("text", truncateToWidth(terminalSafeLine(file), width, "…")),
				);
			}
		}
		const steers = [
			...(child.steering ?? []).map((text) => ["pending", text]),
			...(child.undelivered ?? []).map((text) => ["undelivered", text]),
		];
		if (steers.length > 0) {
			lines.push("", rule("Steers", width, focused));
			for (const [state, text] of steers) {
				lines.push(
					truncateToWidth(
						`${theme.fg("warning", state)} ${theme.fg("text", terminalSafeLine(text))}`,
						width,
						"…",
					),
				);
			}
		}
		if (!isWorking(child.state)) {
			const text = clean(child.text ?? "");
			lines.push("", rule("Result", width, focused));
			if (child.state === "completed") {
				lines.push(
					...new Markdown(text, 0, 0, getMarkdownTheme()).render(width),
				);
			} else {
				const color = child.state === "cancelled" ? "muted" : "error";
				lines.push(...wrap(text, width).map((line) => theme.fg(color, line)));
				if (child.state === "timed out" && child.result) {
					lines.push(
						"",
						...wrap(clean(lastReportedResult(child.result)), width).map(
							(line) => theme.fg("text", line),
						),
					);
				}
			}
		}
		return lines.length > 0 ? [{ sub: "tail", rows: lines }] : [];
	}

	function renderDetail(item: Shown, width: number, rows: number, focused: boolean) {
		const { child } = item;
		const top = header(item, width, focused).slice(0, rows);
		detailRoom = Math.max(1, rows - top.length - 1);
		const style = {
			child: child.id,
			task: child.task,
			duplicate: item.live && !isWorking(child.state) ? clean(child.text ?? "") : "",
			hideThinking,
			expanded,
			expandKey,
		};
		const statics = new Map([
			["head", head(item, width, focused)],
			["tail", tail(item, width, focused)],
		]);
		const shown =
			transcript?.layout(
				width,
				detailRoom,
				JSON.stringify([style.duplicate, hideThinking, expanded]),
				(entry, at, slot) =>
					entry.kind === "static"
						? (statics.get(entry.key) ?? [])
						: thread.render(entry, at, style, slot),
				{
					head: [{ key: "head", kind: "static" }],
					tail: [{ key: "tail", kind: "static" }],
				},
			) ?? [];
		const empty = Array.from({ length: detailRoom - shown.length }, () => "");
		return [...top, ...shown, ...empty, inputLine(item, width)].slice(0, rows);
	}

	function inputLine(item: Shown, width: number) {
		if (typing) return input.render(width)[0];
		const { child } = item;
		const hint = !item.live
			? "History is read-only"
			: replyKind(child) === "answer"
				? `Enter to answer question ${child.question}`
				: replyKind(child) === "steer"
					? "Enter to steer"
					: "";
		return truncateToWidth(
			`${theme.fg("accent", "❯ ")}${theme.fg("dim", hint)}`,
			width,
			"…",
		);
	}

	return {
		render(full: number) {
			if (!host.focused() || !seated("child-session", "overlay")) {
				close();
				return [];
			}
			const edge = marginFor(full);
			const width = full - edge * 2;
			const height = Math.max(4, tui.terminal.rows);
			const metrics = modalMetrics(width);
			const inner = Math.max(1, metrics.inner);
			const { list, index, item } = children();
			selected = item?.child.id;
			track(item?.child.id, item?.live ?? false);
			const split = inner >= splitWidth && item !== undefined;
			const detail = item !== undefined && (split || focus === "detail");
			const keys = footer(split, detail, item);
			const hints = hintRows(
				theme,
				keys.map(([hint]) => hint),
				inner,
			);
			const shownHints = Math.min(hints.lines.length, Math.max(0, height - 3));
			const body = Math.max(0, height - 3 - shownHints);
			const size =
				list.length === 0
					? Math.min(body, Math.max(1, minModalRows - 3 - shownHints))
					: body;
			const listWidth = split
				? Math.min(34, Math.max(22, Math.floor(inner * 0.32)))
				: inner;
			const detailWidth = split ? inner - listWidth - divider.length : inner;
			const listPane =
				split || !detail
					? renderList(list, index, listWidth, size, !split || focus === "list")
					: undefined;
			if (listPane) listRoom = size;
			const detailPane =
				detail && item
					? renderDetail(item, detailWidth, size, focus === "detail")
					: undefined;
			const rows = Array.from({ length: size }, (_, i) =>
				split
					? `${pad(listPane?.lines[i] ?? "", listWidth)}${theme.fg("border", divider)}${pad(detailPane?.[i] ?? "", detailWidth)}`
					: ((listPane?.lines ?? detailPane)?.[i] ?? ""),
			);
			const hintTop = 2 + size;
			const left = edge + metrics.inset;
			layout = {
				width,
				edge,
				left,
				size,
				split,
				list: listPane ? { x: 0, width: listWidth } : undefined,
				detail: detailPane
					? { x: split ? listWidth + divider.length : 0, width: detailWidth }
					: undefined,
				ids: new Map(
					(listPane?.ids ?? []).flatMap((id, i) =>
						id === undefined ? [] : [[i + 1, id] as [number, string]],
					),
				),
				hints: hints.spans
					.filter((span) => span.row < shownHints)
					.map((span) => ({
						...span,
						y: hintTop + span.row,
						action: keys[span.index][1],
					})),
			};
			const working = list.filter((entry) => sectionOf(entry) === "Working").length;
			const total = spentBy(list);
			const title = [
				`Fleet ${list.length}`,
				...(working > 0 ? [`${working} active`] : []),
				...usage(total),
			].join(" · ");
			const margin = " ".repeat(edge);
			return modalFrame(
				theme,
				title,
				[...rows, status(), ...hints.lines.slice(0, shownHints)],
				width,
			).map((line) => margin + line);
		},
		invalidate() {
			transcript?.invalidate();
		},
		handleInput(data: string) {
			const action = actionFor(data);
			if (action) press(action);
			else if (typing) {
				input.handleInput(data);
				const safe = terminalSafeLine(input.getValue());
				if (safe !== input.getValue()) input.setValue(safe);
				tui.requestRender();
			}
		},
		handleMouse(event: TuiMouseEvent) {
			const click = event.type === "click" && event.button === "left";
			const shut = modalMetrics(layout.width).close;
			if (
				click &&
				event.y === 0 &&
				shut &&
				event.x - layout.edge >= shut.start &&
				event.x - layout.edge < shut.end
			) {
				close();
				return { handled: true };
			}
			const x = event.x - layout.left;
			const hint = click
				? layout.hints.find(
						(span) => span.y === event.y && x >= span.start && x < span.end,
					)
				: undefined;
			if (hint) {
				press(hint.action);
				return { handled: true };
			}
			if (event.y < 1 || event.y > layout.size) return undefined;
			const inside = (span: Span | undefined) =>
				span !== undefined && x >= span.x && x < span.x + span.width;
			const pane = inside(layout.list)
				? "list"
				: inside(layout.detail)
					? "detail"
					: undefined;
			if (!pane) return undefined;
			if (event.type === "wheel") {
				const delta = event.wheelDelta ?? 0;
				if (delta === 0) return undefined;
				if (pane === "list") scrollList(delta);
				else scrollDetail(delta);
				tui.requestRender();
				return { handled: true };
			}
			if (!click || confirming) return undefined;
			if (pane === "detail") {
				if (!layout.split) return undefined;
				focus = "detail";
				tui.requestRender();
				return { handled: true };
			}
			const id = layout.ids.get(event.y);
			if (!id || !children().list.some((entry) => entry.child.id === id)) {
				return undefined;
			}
			if (id !== selected) leave();
			selected = id;
			listFree = false;
			focus = (event.clickCount ?? 1) >= 2 ? "detail" : "list";
			tui.requestRender();
			return { handled: true };
		},
		dispose: cleanup,
	};
}
