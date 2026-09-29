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
	renderChildRow,
	spread,
} from "./children-box.ts";
import { sanitizeMultilineText } from "./todo-header.ts";

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
type Segment = { action: Action; start: number; end: number };

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
	let layout = { ids: [] as string[], footer: -1, segments: [] as Segment[] };
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

	function footer(width: number, working: boolean) {
		const keys: [string, Action][] = confirming
			? [
					["y yes", "yes"],
					["n no", "no"],
				]
			: detail
				? [
						["Esc back", "back"],
						["q close", "close"],
						...(working ? [["s/c cancel", "cancel"] as [string, Action]] : []),
						[`${thinkingKey} thinking`, "thinking"],
					]
				: [
						["j/k move", "down"],
						["Enter detail", "open"],
						["s/c cancel", "cancel"],
						["q close", "close"],
					];
		let column = 1;
		layout.segments = keys.map(([label, action]) => {
			const segment = { action, start: column, end: column + label.length };
			column = segment.end + 3;
			return segment;
		});
		const text = ` ${keys.map(([label]) => label).join(" · ")}`;
		return truncateToWidth(theme.fg("dim", text), width);
	}

	function status() {
		const pending =
			confirming === undefined ? undefined : sessions.get(confirming);
		if (pending) {
			return theme.fg("warning", ` Cancel ${childName(pending)}? y/n`);
		}
		return theme.fg("dim", ` ${notice}`);
	}

	function renderList(width: number, body: number) {
		const { list, index } = children();
		const now = Date.now();
		const first = Math.max(0, index - body + 1);
		const painted = list.slice(first, first + body);
		layout.ids = painted.map((child) => child.id);
		const top = spread(
			`${theme.fg("dim", "·")} ${theme.bold("Subagents")} ${list.length}`,
			theme.fg("dim", "/pi-workflow-children · alt+a"),
			width,
		);
		const rows = painted.map((child, i) =>
			renderChildRow(
				theme,
				child,
				child.state === "queued"
					? "queued"
					: `${child.state} · ${childMeta(child, now)}`,
				first + i === index,
				width,
			),
		);
		if (list.length === 0) {
			rows.push(theme.fg("dim", " No children in this session."));
		}
		return { top, rows, working: true };
	}

	function renderDetail(child: ChildRecord, width: number, body: number) {
		layout.ids = [];
		const model = child.model.slice(child.model.indexOf("/") + 1);
		const top = spread(
			`${theme.fg("accent", childName(child))} · ${model} (${child.thinking})`,
			`${childGlyph(theme, child)} ${theme.fg("dim", `${child.state} · ${childElapsed(child, Date.now())}`)}`,
			width,
		);
		const content = sessions.thread(child.id);
		const lines = content ? thread.lines(content, child.state, width) : [];
		return {
			top,
			rows: lines.slice(-body),
			working: isWorking(child.state),
		};
	}

	return {
		render(width: number) {
			if (!host.focused()) {
				close();
				return [];
			}
			const height = Math.max(4, tui.terminal.rows);
			const body = height - 3;
			const child = detail === undefined ? undefined : sessions.get(detail);
			if (detail !== undefined && !child) detail = undefined;
			const view = child
				? renderDetail(child, width, body)
				: renderList(width, body);
			const lines = [view.top, ...view.rows];
			while (lines.length < height - 2) lines.push("");
			lines.push(status(), footer(width, view.working));
			layout.footer = height - 1;
			return lines.map((line) => truncateToWidth(line, width));
		},
		invalidate() {},
		handleInput(data: string) {
			const action = actionFor(data);
			if (action) press(action);
		},
		handleMouse(event: TuiMouseEvent) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			if (event.y === layout.footer) {
				const segment = layout.segments.find(
					(item) => event.x >= item.start && event.x < item.end,
				);
				if (!segment) return undefined;
				press(segment.action);
				return { handled: true };
			}
			const id = layout.ids[event.y - 1];
			if (detail || confirming || !id || !sessions.get(id)) return undefined;
			selected = id;
			if ((event.clickCount ?? 1) >= 2) press("open");
			else tui.requestRender();
			return { handled: true };
		},
		dispose: cleanup,
	};
}
