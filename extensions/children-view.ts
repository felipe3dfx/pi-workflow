import type {
	AssistantMessage,
	ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionContext,
	getMarkdownTheme,
	type KeybindingsManager,
	type SessionEntry,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	type OverlayHandle,
	type TuiMouseEvent,
	truncateToWidth,
} from "@earendil-works/pi-tui";

import {
	type ChildRecord,
	type createChildSessions,
	describeTool,
	isWorking,
} from "./child-sessions.ts";
import {
	byState,
	type ChildTheme,
	childElapsed,
	childGlyph,
	childMeta,
	childName,
} from "./children-box.ts";
import { marginFor } from "./chrome-editor.ts";
import {
	closeSpan,
	framePad,
	type Hint,
	type HintSpan,
	hintRows,
	menuRow,
	modalFrame,
	sectionRule,
} from "./chrome-menus.ts";
import { sanitizeMultilineText, sanitizeTaskText } from "./todo-header.ts";

const minModalRows = 8;

type Sessions = ReturnType<typeof createChildSessions>;
type Action =
	| "down"
	| "up"
	| "open"
	| "cancel"
	| "close"
	| "back"
	| "thinking"
	| "yes"
	| "no";

function userText(content: string | { type: string; text?: string }[]) {
	return sanitizeMultilineText(
		typeof content === "string"
			? content
			: content.map((part) => part.text ?? "").join("\n"),
	);
}

function cleanMessage(message: AssistantMessage): AssistantMessage {
	return {
		...message,
		errorMessage:
			message.errorMessage && sanitizeMultilineText(message.errorMessage),
		content: message.content.map((part) =>
			part.type === "text"
				? { ...part, text: sanitizeMultilineText(part.text) }
				: part.type === "thinking"
					? { ...part, thinking: sanitizeMultilineText(part.thinking) }
					: part,
		),
	};
}

function createThread(theme: ChildTheme) {
	const markdown = getMarkdownTheme();
	const cache = new Map<string, Component>();
	const live = new AssistantMessageComponent(undefined, false, markdown);
	let hideThinking = false;

	function toolLines(
		message: AssistantMessage,
		results: Map<string, ToolResultMessage>,
		state: ChildRecord["state"],
		width: number,
	) {
		return message.content.flatMap((part) => {
			if (part.type !== "toolCall") return [];
			const result = results.get(part.id);
			const status = result
				? result.isError
					? "Error"
					: "Complete"
				: isWorking(state)
					? "Running"
					: state[0].toUpperCase() + state.slice(1);
			const line = ` ◆ ${describeTool(part.name, part.arguments)} · ${status}`;
			return [truncateToWidth(theme.fg("muted", line), width)];
		});
	}

	return {
		toggleThinking() {
			hideThinking = !hideThinking;
			live.setHideThinkingBlock(hideThinking);
			for (const component of cache.values()) {
				if (component instanceof AssistantMessageComponent) {
					component.setHideThinkingBlock(hideThinking);
				}
			}
		},
		lines(
			thread: { entries: SessionEntry[]; streaming?: AssistantMessage },
			state: ChildRecord["state"],
			width: number,
		) {
			const results = new Map<string, ToolResultMessage>();
			for (const entry of thread.entries) {
				if (entry.type === "message" && entry.message.role === "toolResult") {
					results.set(entry.message.toolCallId, entry.message);
				}
			}
			const lines: string[] = [];
			for (const entry of thread.entries) {
				if (entry.type !== "message") continue;
				const { message } = entry;
				if (message.role === "user") {
					let component = cache.get(entry.id);
					if (!component) {
						component = new UserMessageComponent(
							userText(message.content),
							markdown,
						);
						cache.set(entry.id, component);
					}
					lines.push("", ...component.render(width));
				} else if (message.role === "assistant") {
					let component = cache.get(entry.id);
					if (!component) {
						component = new AssistantMessageComponent(
							cleanMessage(message),
							hideThinking,
							markdown,
						);
						cache.set(entry.id, component);
					}
					lines.push(...component.render(width));
					lines.push(...toolLines(message, results, state, width));
				}
			}
			if (thread.streaming) {
				live.updateContent(cleanMessage(thread.streaming), true);
				lines.push(...live.render(width));
				lines.push(...toolLines(thread.streaming, results, state, width));
			}
			return lines;
		},
	};
}

export function createChildrenViews(sessions: Sessions) {
	const open = new Set<() => void>();
	return {
		async open(ctx: ExtensionContext) {
			let handle: OverlayHandle | undefined;
			await ctx.ui.custom<void>(
				(tui, theme, keybindings, done) =>
					createChildrenView(sessions, tui, theme, keybindings, {
						done,
						open,
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
		close() {
			for (const close of [...open]) close();
		},
	};
}

function createChildrenView(
	sessions: Sessions,
	tui: { requestRender(): void; terminal: { rows: number } },
	theme: ChildTheme,
	keybindings: KeybindingsManager,
	host: { done(): void; open: Set<() => void>; focused(): boolean },
) {
	let selected: string | undefined;
	let detail: string | undefined;
	let confirming: string | undefined;
	let notice = "";
	let thread = createThread(theme);
	let unfollow: (() => void) | undefined;
	let layout = {
		width: 0,
		edge: 0,
		left: 0,
		ids: new Map<number, string>(),
		hints: [] as (HintSpan & { y: number; action: Action })[],
	};
	const unsubscribe = sessions.subscribe(() => tui.requestRender());
	const thinkingKey = keybindings.getKeys("app.thinking.toggle").join("/");
	host.open.add(close);

	function children() {
		const list = sessions.list().sort(byState);
		const index = Math.max(
			0,
			list.findIndex((child) => child.id === selected),
		);
		return { list, index };
	}

	function cleanup() {
		host.open.delete(close);
		unsubscribe();
		unfollow?.();
		unfollow = undefined;
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

	function press(action: Action) {
		const { list, index } = children();
		const target = detail ?? list[index]?.id;
		const child = target === undefined ? undefined : sessions.get(target);
		const name = child ? childName(child) : "";
		notice = "";
		if (action === "yes" && confirming) {
			const pending = sessions.get(confirming);
			cancel(confirming, pending ? childName(pending) : confirming);
			confirming = undefined;
		} else if (action === "no") {
			confirming = undefined;
		} else if (action === "down" || action === "up") {
			const next = Math.min(
				list.length - 1,
				Math.max(0, index + (action === "down" ? 1 : -1)),
			);
			selected = list[next]?.id;
		} else if (action === "open" && child) {
			detail = child.id;
			thread = createThread(theme);
			unfollow = sessions.follow(child.id, () => tui.requestRender());
		} else if (action === "back") {
			unfollow?.();
			unfollow = undefined;
			detail = undefined;
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
		if (detail) {
			if (matchesKey(data, Key.escape)) return "back";
			if (keybindings.matches(data, "app.thinking.toggle")) return "thinking";
			return undefined;
		}
		if (matchesKey(data, Key.escape)) return "close";
		if (matchesKey(data, Key.enter)) return "open";
		if (data === "j" || keybindings.matches(data, "tui.select.down")) {
			return "down";
		}
		if (data === "k" || keybindings.matches(data, "tui.select.up")) {
			return "up";
		}
		return undefined;
	}

	function footer(working: boolean): [Hint, Action][] {
		if (confirming)
			return [
				[["y", "yes"], "yes"],
				[["n", "no"], "no"],
			];
		if (detail)
			return [
				[["Esc", "back"], "back"],
				[["q", "close"], "close"],
				...(working ? [[["s/c", "cancel"], "cancel"] as [Hint, Action]] : []),
				[[thinkingKey, "thinking"], "thinking"],
			];
		return [
			[["j/k", "move"], "down"],
			[["Enter", "detail"], "open"],
			[["s/c", "cancel"], "cancel"],
			[["q", "close"], "close"],
		];
	}

	function status() {
		const pending =
			confirming === undefined ? undefined : sessions.get(confirming);
		if (pending) {
			return theme.fg("warning", `Cancel ${childName(pending)}? y/n`);
		}
		return theme.fg("dim", notice);
	}

	function renderList(width: number, body: number) {
		const { list, index } = children();
		const now = Date.now();
		const lines: string[] = [];
		const ids: (string | undefined)[] = [];
		let section = "";
		list.forEach((child, i) => {
			const name = isWorking(child.state) ? "Active" : "Finished";
			if (name !== section) {
				section = name;
				lines.push(sectionRule(theme, name, width));
				ids.push(undefined);
			}
			const step = sanitizeTaskText(
				child.step ?? child.task.trim().split("\n")[0],
			);
			const meta =
				child.state === "queued"
					? "queued"
					: `${child.state} · ${childMeta(child, now)}`;
			lines.push(
				menuRow(
					theme,
					`${childGlyph(theme, child)} ${theme.fg("accent", child.role)} ${child.id.slice(0, 4)} ${step}`,
					theme.fg("dim", meta),
					i === index,
					width,
					true,
				),
			);
			ids.push(child.id);
		});
		if (list.length === 0) {
			lines.push(theme.fg("dim", "No children in this session."));
		}
		const first = Math.max(0, ids.indexOf(list[index]?.id) - body + 1);
		return {
			title: `Subagents ${list.length}`,
			rows: lines.slice(first, first + body),
			ids: ids.slice(first, first + body),
			working: true,
			compact: list.length === 0,
		};
	}

	function renderDetail(child: ChildRecord, width: number, body: number) {
		const model = child.model.slice(child.model.indexOf("/") + 1);
		const state = `${childGlyph(theme, child)} ${theme.fg("dim", `${child.state} · ${childElapsed(child, Date.now())}`)}`;
		const content = sessions.thread(child.id);
		const lines = content ? thread.lines(content, child.state, width) : [];
		return {
			title: `${childName(child)} · ${model} (${child.thinking})`,
			rows: [state, ...lines.slice(-(body - 1))].slice(0, body),
			ids: [],
			working: isWorking(child.state),
			compact: false,
		};
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
			const pad = framePad(width);
			const inner = Math.max(1, width - 2 - pad * 2);
			const child = detail === undefined ? undefined : sessions.get(detail);
			if (detail !== undefined && !child) detail = undefined;
			const keys = footer(child ? isWorking(child.state) : true);
			const hints = hintRows(
				theme,
				keys.map(([hint]) => hint),
				inner,
			);
			const shownHints = Math.min(hints.lines.length, Math.max(0, height - 3));
			const body = Math.max(0, height - 3 - shownHints);
			const view = child
				? renderDetail(child, inner, body)
				: renderList(inner, body);
			const size = view.compact
				? Math.min(body, Math.max(view.rows.length, minModalRows - 3 - shownHints))
				: body;
			const rows = view.rows.slice(0, size);
			while (rows.length < size) rows.push("");
			const hintTop = 2 + size;
			layout = {
				width,
				edge,
				left: edge + 1 + pad,
				ids: new Map(
					view.ids.flatMap((id, i) =>
						id === undefined || i >= size
							? []
							: [[i + 1, id] as [number, string]],
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
			const margin = " ".repeat(edge);
			return modalFrame(
				theme,
				view.title,
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
			if (event.type !== "click" || event.button !== "left") return undefined;
			const shut = closeSpan(layout.width);
			if (
				event.y === 0 &&
				shut &&
				event.x - layout.edge >= shut.start &&
				event.x - layout.edge < shut.end
			) {
				close();
				return { handled: true };
			}
			const x = event.x - layout.left;
			const hint = layout.hints.find(
				(span) => span.y === event.y && x >= span.start && x < span.end,
			);
			if (hint) {
				press(hint.action);
				return { handled: true };
			}
			const id = layout.ids.get(event.y);
			if (detail || confirming || !id || !sessions.get(id)) return undefined;
			selected = id;
			if ((event.clickCount ?? 1) >= 2) press("open");
			else tui.requestRender();
			return { handled: true };
		},
		dispose: cleanup,
	};
}
