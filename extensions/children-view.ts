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
	Key,
	Markdown,
	matchesKey,
	type OverlayHandle,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
	type ChildRecord,
	type createChildSessions,
	childOverlay,
	isWorking,
	type Schedule,
	scheduleTimer,
} from "./child-sessions.ts";
import { childModelLine, childStep } from "./child-projection.ts";
import { held } from "./configure.ts";

import {
	byState,
	type ChildTheme,
	childElapsed,
	childGlyph,
	childName,
	spread,
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
import { sanitizeMultilineText, sanitizeTaskText } from "./todo-header.ts";

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
type Block = { kind: "text" | "row"; rows: string[] };
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
	| "yes"
	| "no";

function clean(text: string) {
	return sanitizeMultilineText(text).replaceAll("\t", "   ").trim();
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

function seconds(ms: number) {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function count(tokens: number) {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

function usage(thread: Thread | undefined) {
	let tokens = 0;
	let cost = 0;
	for (const entry of thread?.entries ?? []) {
		if (entry.type !== "message" || entry.message.role !== "assistant")
			continue;
		tokens += entry.message.usage?.totalTokens ?? 0;
		cost += entry.message.usage?.cost?.total ?? 0;
	}
	return [
		...(tokens > 0 ? [`${count(tokens)} tok`] : []),
		...(cost > 0 ? [`$${cost.toFixed(2)}`] : []),
	];
}

function pad(line: string, width: number) {
	const clipped = fit(line, width);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function createThread(theme: ChildTheme) {
	const markdown = getMarkdownTheme();
	const cache = new Map<string, Block[]>();
	const thoughts = new Map<string, { start: number; end?: number }>();
	let hideThinking = false;

	function row(color: ThemeColor, label: string, detail = "") {
		const head = `${theme.fg(color, "◆")} ${theme.bold(theme.fg("muted", sanitizeTaskText(label)))}`;
		const tail = sanitizeTaskText(detail);
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

	function assistant(
		id: string,
		message: AssistantMessage,
		results: Map<string, ToolResultMessage>,
		streaming: boolean,
		width: number,
		duplicate = "",
	) {
		const blocks: Block[] = [];
		message.content.forEach((part, index) => {
			if (part.type === "thinking") {
				const text = clean(part.thinking);
				if (!text) return;
				const running = streaming && index === message.content.length - 1;
				const ms = thought(`${id}:${message.timestamp}:${index}`, running);
				const head = running
					? row("dim", "Thinking…")
					: row("dim", "Thought", ms === undefined ? "" : `for ${seconds(ms)}`);
				const body = hideThinking
					? []
					: wrap(text, width - 2).map((line) => `  ${theme.fg("dim", line)}`);
				blocks.push({ kind: "row", rows: [head, ...body] });
			} else if (part.type === "text") {
				const text = clean(part.text);
				if (text && text !== duplicate) {
					blocks.push({
						kind: "text",
						rows: new Markdown(text, 0, 0, markdown).render(width),
					});
				}
			} else if (part.type === "toolCall") {
				const result = results.get(part.id);
				const color = result ? (result.isError ? "error" : "toolTitle") : "dim";
				const [label, detail] = toolLabel(part.name, part.arguments);
				blocks.push({ kind: "row", rows: [row(color, label, detail)] });
			}
		});
		const error = message.errorMessage && clean(message.errorMessage);
		if (error && error !== duplicate) {
			blocks.push({
				kind: "row",
				rows: wrap(error, width - 2).map(
					(line, i) =>
						`${i === 0 ? `${theme.fg("error", "◆")} ` : "  "}${theme.fg("muted", line)}`,
				),
			});
		}
		return blocks;
	}

	function user(text: string, width: number): Block[] {
		return [
			{
				kind: "text",
				rows: wrap(text, width - 2).map(
					(line, i) =>
						`${i === 0 ? theme.fg("accent", "❯ ") : "  "}${theme.fg("text", line)}`,
				),
			},
		];
	}

	return {
		toggleThinking() {
			hideThinking = !hideThinking;
		},
		forget() {
			cache.clear();
		},
		lines(thread: Thread, child: ChildRecord, width: number) {
			const finalText = isWorking(child.state) ? "" : clean(child.text ?? "");
			const results = new Map<string, ToolResultMessage>();
			for (const entry of thread.entries) {
				if (entry.type === "message" && entry.message.role === "toolResult") {
					results.set(entry.message.toolCallId, entry.message);
				}
			}
			const working = isWorking(child.state);
			const task = clean(child.task);
			const blocks: Block[] = [];
			const lastAssistant = thread.entries.findLast(
				(entry) =>
					entry.type === "message" && entry.message.role === "assistant",
			);
			for (const entry of thread.entries) {
				if (entry.type !== "message") continue;
				const { message } = entry;
				if (message.role !== "user" && message.role !== "assistant") continue;
				const duplicate = entry === lastAssistant ? finalText : "";
				const key = `${child.id}:${entry.id}:${width}:${hideThinking}:${duplicate}`;
				let shown = cache.get(key);
				if (!shown) {
					if (message.role === "user") {
						const text = userText(message.content);
						shown = text && text !== task ? user(text, width) : [];
						cache.set(key, shown);
					} else {
						shown = assistant(
							child.id,
							message,
							results,
							false,
							width,
							duplicate,
						);
						const settled = message.content.every(
							(part) => part.type !== "toolCall" || results.has(part.id),
						);
						if (settled || !working) cache.set(key, shown);
					}
				}
				blocks.push(...shown);
			}
			if (thread.streaming) {
				blocks.push(
					...assistant(child.id, thread.streaming, results, true, width),
				);
			}
			const lines: string[] = [];
			let last: Block["kind"] | undefined;
			for (const block of blocks) {
				if (last && (block.kind === "text" || last === "text")) lines.push("");
				lines.push(...block.rows);
				last = block.kind;
			}
			return lines;
		},
	};
}

export function createChildrenViews(
	sessions: Sessions,
	schedule: Schedule = scheduleTimer,
) {
	const open = new Set<() => void>();
	const close = () => {
		for (const closeOne of [...open]) closeOne();
	};
	closeSeatedView = close;
	return {
		async open(ctx: ExtensionContext) {
			if (!held(childOverlay)) {
				ctx.ui.notify(
					"Child session is not seated. Run /workflow:config.",
					"error",
				);
				return;
			}
			let handle: OverlayHandle | undefined;
			await ctx.ui.custom<void>(
				(tui, theme, keybindings, done) =>
					createChildrenView(sessions, tui, theme, keybindings, {
						done,
						open,
						schedule,
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
	tui: { requestRender(): void; terminal: { rows: number } },
	theme: ChildTheme,
	keybindings: KeybindingsManager,
	host: {
		done(): void;
		open: Set<() => void>;
		schedule: Schedule;
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
	let detailTop = 0;
	let detailMax = 0;
	let detailRoom = 1;
	let listRoom = 1;
	let follow = true;
	let promptOpen = false;
	let followed: string | undefined;
	let unfollow: (() => void) | undefined;
	let tick: (() => void) | undefined;
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
		tui.requestRender();
		arm();
	});
	const thinkingKey = displayKey(
		keybindings.getKeys("app.thinking.toggle").join("/"),
	);
	host.open.add(close);
	arm();

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
		const list = sessions.list().sort(byState);
		const found = list.findIndex((child) => child.id === selected);
		if (found === -1 && focus === "detail" && !layout.split) focus = "list";
		const index = Math.max(0, found);
		return { list, index, child: list[index] as ChildRecord | undefined };
	}

	function track(id: string | undefined) {
		if (id === followed) return;
		unfollow?.();
		followed = id;
		unfollow = id ? sessions.follow(id, () => tui.requestRender()) : undefined;
		follow = true;
		detailTop = 0;
		promptOpen = false;
		thread.forget();
	}

	function cleanup() {
		host.open.delete(close);
		unsubscribe();
		unfollow?.();
		tick?.();
		unfollow = tick = undefined;
	}

	function close() {
		if (!host.open.has(close)) return;
		cleanup();
		host.done();
	}

	function cancel(id: string, name: string) {
		const result = sessions.cancel(id, true);
		notice = result.cancelled ? `${name} cancelled.` : result.message;
	}

	function scrollDetail(delta: number) {
		detailTop = Math.max(0, Math.min(detailMax, detailTop + delta));
		follow = detailTop >= detailMax;
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
		const { list, index, child } = children();
		const name = child ? childName(child) : "";
		const single = !layout.split && focus === "detail";
		notice = "";
		if (action === "yes" && confirming) {
			const pending = sessions.get(confirming);
			cancel(confirming, pending ? childName(pending) : confirming);
			confirming = undefined;
		} else if (action === "no") {
			confirming = undefined;
		} else if ((action === "down" || action === "up") && single) {
			scrollDetail(action === "down" ? 1 : -1);
		} else if (action === "down" || action === "up") {
			const next = Math.min(
				list.length - 1,
				Math.max(0, index + (action === "down" ? 1 : -1)),
			);
			selected = list[next]?.id;
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
			follow = true;
		} else if (action === "prompt") {
			promptOpen = !promptOpen;
		} else if (action === "close") {
			close();
		} else if (action === "thinking") {
			thread.toggleThinking();
		} else if (action === "cancel" && child) {
			if (!isWorking(child.state)) {
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
		if (confirming) {
			if (data === "y") return "yes";
			if (data === "n" || matchesKey(data, Key.escape)) return "no";
			return undefined;
		}
		if (data === "q") return "close";
		if (data === "s" || data === "c") return "cancel";
		if (data === "f") return "follow";
		if (data === "p") return "prompt";
		if (keybindings.matches(data, "app.thinking.toggle")) return "thinking";
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
		if (matchesKey(data, Key.enter)) return "open";
		if (data === "j" || keybindings.matches(data, "tui.select.down")) {
			return "down";
		}
		if (data === "k" || keybindings.matches(data, "tui.select.up")) {
			return "up";
		}
		return undefined;
	}

	function footer(split: boolean, detail: boolean, working: boolean) {
		if (confirming)
			return [
				[["y", "yes"], "yes"],
				[["n", "no"], "no"],
			] as [Hint, Action][];
		const cancelHint: [Hint, Action][] = working
			? [[["s/c", "cancel"], "cancel"]]
			: [];
		const scroll: [Hint, Action][] = [
			[["Ctrl+J/K", "scroll"], "pageDown"],
			[["f", "follow"], "follow"],
		];
		const thinking: [Hint, Action] = [[thinkingKey, "thinking"], "thinking"];
		if (split)
			return [
				[["j/k", "move"], "down"],
				[["Tab", "focus"], "focus"],
				...scroll,
				...cancelHint,
				thinking,
				[["q", "close"], "close"],
			] as [Hint, Action][];
		if (detail)
			return [
				[["Esc", "back"], "back"],
				...scroll,
				...cancelHint,
				thinking,
				[["q", "close"], "close"],
			] as [Hint, Action][];
		return [
			[["j/k", "move"], "down"],
			[["Enter", "detail"], "open"],
			[["s/c", "cancel"], "cancel"],
			[["q", "close"], "close"],
		] as [Hint, Action][];
	}

	function status() {
		const pending =
			confirming === undefined ? undefined : sessions.get(confirming);
		if (pending) {
			return theme.fg("warning", `Cancel ${childName(pending)}? y/n`);
		}
		return theme.fg("dim", notice);
	}

	function rule(label: string, width: number, focused: boolean) {
		if (!focused) return sectionRule(theme, label, width);
		const title = truncateToWidth(` ${label} `, width, "");
		return (
			theme.bold(theme.fg("accent", title)) +
			theme.fg("accent", "─".repeat(Math.max(0, width - visibleWidth(title))))
		);
	}

	function renderList(
		list: ChildRecord[],
		index: number,
		width: number,
		rows: number,
		focused: boolean,
	) {
		const now = Date.now();
		const two = rows >= twoLineRows;
		const lines: string[] = [];
		const ids: (string | undefined)[] = [];
		let section = "";
		list.forEach((child, i) => {
			const name = isWorking(child.state) ? "Active" : "Finished";
			if (name !== section) {
				section = name;
				lines.push(rule(name, width, false));
				ids.push(undefined);
			}
			const active = i === index;
			const mark = active
				? focused
					? theme.bold(theme.fg("accent", "▸ "))
					: theme.fg("dim", "▸ ")
				: "  ";
			const step = sanitizeTaskText(childStep(child));
			const color = child.state === "waiting" ? "warning" : "dim";
			const head = `${mark}${childGlyph(theme, child)} ${theme.fg("accent", child.role)} ${theme.fg("dim", child.id.slice(0, 4))}`;
			const right = theme.fg(
				"dim",
				child.state === "queued" ? "queued" : childElapsed(child, now),
			);
			const shown = two
				? [
						spread(head, right, width),
						`    ${theme.fg(color, truncateToWidth(step, Math.max(0, width - 4), "…"))}`,
					]
				: [spread(`${head} ${theme.fg(color, step)}`, right, width)];
			for (const line of shown) {
				lines.push(active ? selectedRow(theme, line, width) : line);
				ids.push(child.id);
			}
		});
		if (list.length === 0) {
			lines.push(theme.fg("dim", "No children in this session."));
			ids.push(undefined);
		}
		const at = ids.indexOf(list[index]?.id);
		if (!listFree && at >= 0) {
			const start = at > 0 && ids[at - 1] === undefined ? at - 1 : at;
			const end = at + (two ? 2 : 1);
			if (start < listTop) listTop = start;
			if (end > listTop + rows) listTop = end - rows;
		}
		listTop = Math.max(0, Math.min(listTop, lines.length - rows));
		return {
			lines: lines.slice(listTop, listTop + rows),
			ids: ids.slice(listTop, listTop + rows),
		};
	}

	function header(
		child: ChildRecord,
		content: Thread | undefined,
		width: number,
		focused: boolean,
	) {
		const state =
			child.state === "queued"
				? "queued"
				: `${child.state} · ${childElapsed(child, Date.now())}`;
		const meta = [
			childModelLine(child),
			...usage(content),
			`wt: ${basename(child.worktree)}`,
		].join(" · ");
		return [
			spread(
				`${childGlyph(theme, child)} ${theme.bold(theme.fg(focused ? "accent" : "text", childName(child)))}`,
				theme.fg("dim", state),
				width,
			),
			theme.fg("dim", truncateToWidth(sanitizeTaskText(meta), width, "…")),
			theme.fg(
				"muted",
				truncateToWidth(
					sanitizeTaskText(child.task.trim().split("\n")[0]),
					width,
					"…",
				),
			),
		];
	}

	function detailBody(
		child: ChildRecord,
		content: Thread | undefined,
		width: number,
		focused: boolean,
	) {
		const lines = [rule("Prompt", width, focused)];
		const prompt = wrap(clean(child.task), width - 2);
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
		lines.push(rule("Thread", width, focused));
		const threadLines = content ? thread.lines(content, child, width) : [];
		lines.push(
			...(threadLines.length > 0
				? threadLines
				: [theme.fg("dim", "Waiting for the first event…")]),
		);
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
			}
		}
		return lines;
	}

	function renderDetail(
		child: ChildRecord,
		width: number,
		rows: number,
		focused: boolean,
	) {
		const content = sessions.thread(child.id);
		const top = header(child, content, width, focused).slice(0, rows);
		detailRoom = Math.max(1, rows - top.length);
		const body = detailBody(child, content, width, focused);
		detailMax = Math.max(0, body.length - detailRoom);
		detailTop = follow ? detailMax : Math.min(detailTop, detailMax);
		return [...top, ...body.slice(detailTop, detailTop + detailRoom)];
	}

	return {
		render(full: number) {
			if (!host.focused()) {
				close();
				return [];
			}
			const edge = marginFor(full);
			const width = full - edge * 2;
			const height = Math.max(4, tui.terminal.rows);
			const metrics = modalMetrics(width);
			const inner = Math.max(1, metrics.inner);
			const { list, index, child } = children();
			selected = child?.id;
			track(child?.id);
			const split = inner >= splitWidth && child !== undefined;
			const detail = child !== undefined && (split || focus === "detail");
			const keys = footer(split, detail, child ? isWorking(child.state) : true);
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
				detail && child
					? renderDetail(child, detailWidth, size, focus === "detail")
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
			const working = list.filter((item) => isWorking(item.state)).length;
			const title = `Subagents ${list.length}${working > 0 ? ` · ${working} active` : ""}`;
			const margin = " ".repeat(edge);
			return modalFrame(
				theme,
				title,
				[...rows, status(), ...hints.lines.slice(0, shownHints)],
				width,
			).map((line) => margin + line);
		},
		invalidate() {},
		handleInput(data: string) {
			const action = actionFor(data);
			if (action) press(action);
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
			if (!id || !sessions.get(id)) return undefined;
			selected = id;
			listFree = false;
			focus = (event.clickCount ?? 1) >= 2 ? "detail" : "list";
			tui.requestRender();
			return { handled: true };
		},
		dispose: cleanup,
	};
}
