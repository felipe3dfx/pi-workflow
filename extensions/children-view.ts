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

import {
	type ChildRecord,
	type createChildSessions,
	isWorking,
} from "./child-sessions.ts";
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
	| "no"
	| "type"
	| "send"
	| "leave";

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

function usage({ tokens, cost }: { tokens: number; cost: number }) {
	return [
		...(tokens > 0 ? [`${count(tokens)} tok`] : []),
		...(cost > 0 ? [`$${cost.toFixed(2)}`] : []),
	];
}

function runState(child: ChildRecord, now: number) {
	return child.state === "queued"
		? "queued"
		: `${child.state} · ${childElapsed(child, now)}`;
}

function fleetOrder(records: ChildRecord[]) {
	const groups = new Set(records.flatMap((child) => child.group ?? []));
	const sorted = [...records].sort(byState);
	const direct = sorted.filter((child) => child.group === undefined);
	return [
		...direct.filter((child) => isWorking(child.state)),
		...[...groups].flatMap((group) =>
			sorted.filter((child) => child.group === group),
		),
		...direct.filter((child) => !isWorking(child.state)),
	];
}

function groupLabel(group: string) {
	return `script ${[...terminalSafeLine(group)].slice(-4).join("")}`;
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
	let typing = false;
	let answering: number | undefined;
	const input = new Input({ prompt: "❯ " });
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
		const list = fleetOrder(sessions.list());
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
		leave();
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

	function refusal(child: ChildRecord) {
		if (child.state === "waiting" && child.question !== undefined)
			return undefined;
		return `${childName(child)} is ${child.state}; it has no question to answer.`;
	}

	function leave() {
		typing = false;
		answering = undefined;
		input.setValue("");
	}

	function send(child: ChildRecord | undefined) {
		const text = input.getValue().trim();
		const number = answering;
		if (!child || !text || number === undefined) return;
		leave();
		try {
			sessions.reply(child.id, number, text, "operator");
			notice = `Answer sent to ${childName(child)}.`;
		} catch (error) {
			notice = error instanceof Error ? error.message : String(error);
		}
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
		} else if (action === "type" && child) {
			selected = child.id;
			focus = "detail";
			const reason = refusal(child);
			if (reason) notice = reason;
			else {
				typing = true;
				answering = child.question;
			}
		} else if (action === "send") {
			send(child);
		} else if (action === "leave") {
			leave();
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

	function footer(
		split: boolean,
		detail: boolean,
		child: ChildRecord | undefined,
	) {
		if (typing)
			return [
				[["Enter", "send"], "send"],
				[["Esc", "stop typing"], "leave"],
			] as [Hint, Action][];
		const working = child ? isWorking(child.state) : true;
		const inputHint: [Hint, Action] = [
			["Enter", child?.state === "waiting" ? "answer" : "input"],
			"type",
		];
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
				inputHint,
				...scroll,
				...cancelHint,
				thinking,
				[["q", "close"], "close"],
			] as [Hint, Action][];
		if (detail)
			return [
				[["Esc", "back"], "back"],
				inputHint,
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
		let section: string | undefined;
		list.forEach((child, i) => {
			const { group } = child;
			const name =
				group === undefined
					? isWorking(child.state)
						? "Active"
						: "Finished"
					: `group ${group}`;
			if (name !== section) {
				section = name;
				if (group === undefined) {
					lines.push(rule(name, width, false));
					ids.push(undefined);
				} else {
					const members = list.filter((item) => item.group === group);
					const done = members.filter((item) => !isWorking(item.state));
					const tokens = members.reduce(
						(sum, item) => sum + spent(sessions.thread(item.id)).tokens,
						0,
					);
					lines.push(
						rule(groupLabel(group), width, false),
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
			}
			const active = i === index;
			const mark = active
				? focused
					? theme.bold(theme.fg("accent", "▸ "))
					: theme.fg("dim", "▸ ")
				: "  ";
			const step = terminalSafeLine(childStep(child));
			const color = child.state === "waiting" ? "warning" : "dim";
			const head = `${mark}${childGlyph(theme, child)} ${theme.fg("accent", child.role)} ${theme.fg("dim", child.id.slice(0, 4))}`;
			const state = runState(child, now);
			const spend = usage(spent(sessions.thread(child.id)));
			const shown = two
				? [
						spread(head, theme.fg("dim", state), width),
						spread(
							`    ${theme.fg(color, step)}`,
							theme.fg("dim", spend.join(" · ")),
							width,
						),
					]
				: [
						spread(
							spend.length > 0 ? head : `${head} ${theme.fg(color, step)}`,
							theme.fg(
								"dim",
								spend.length > 0
									? spend.join(" · ")
									: child.state === "queued"
										? "queued"
										: childElapsed(child, now),
							),
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
		const at = ids.indexOf(list[index]?.id);
		if (!listFree && at >= 0) {
			let start = at;
			while (start > 0 && ids[start - 1] === undefined) start -= 1;
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
		const state = runState(child, Date.now());
		const meta = [
			childModelLine(child),
			...usage(spent(content)),
			`wt: ${basename(child.worktree)}`,
		].join(" · ");
		return [
			spread(
				`${childGlyph(theme, child)} ${theme.bold(theme.fg(focused ? "accent" : "text", childName(child)))}`,
				theme.fg("dim", state),
				width,
			),
			theme.fg("dim", truncateToWidth(terminalSafeLine(meta), width, "…")),
			theme.fg(
				"muted",
				truncateToWidth(
					terminalSafeLine(child.task.trim().split("\n")[0]),
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
		const files = sessions.changedFiles(child.id);
		if (files.length > 0) {
			lines.push("", rule("Changed files", width, focused));
			for (const file of files) {
				lines.push(
					theme.fg("text", truncateToWidth(terminalSafeLine(file), width, "…")),
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
		detailRoom = Math.max(1, rows - top.length - 1);
		const body = detailBody(child, content, width, focused);
		detailMax = Math.max(0, body.length - detailRoom);
		detailTop = follow ? detailMax : Math.min(detailTop, detailMax);
		const shown = body.slice(detailTop, detailTop + detailRoom);
		const empty = Array.from(
			{ length: detailRoom - shown.length },
			() => "",
		);
		return [...top, ...shown, ...empty, inputLine(child, width)].slice(
			0,
			rows,
		);
	}

	function inputLine(child: ChildRecord, width: number) {
		if (typing) return input.render(width)[0];
		const hint =
			child.state === "waiting" && child.question !== undefined
				? `Enter to answer question ${child.question}`
				: "";
		return truncateToWidth(
			`${theme.fg("accent", "❯ ")}${theme.fg("dim", hint)}`,
			width,
			"…",
		);
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
			const keys = footer(split, detail, child);
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
			const total = list
				.map((item) => spent(sessions.thread(item.id)))
				.reduce(
					(sum, item) => ({
						tokens: sum.tokens + item.tokens,
						cost: sum.cost + item.cost,
					}),
					{ tokens: 0, cost: 0 },
				);
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
		invalidate() {},
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
