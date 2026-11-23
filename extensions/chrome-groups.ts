// Relies on Pi 1.6.0 chat container internals (InteractiveMode.chatContainer, ToolExecutionComponent fields).
import {
	AssistantMessageComponent,
	CustomMessageComponent,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Container,
	Spacer,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { Margin } from "./chrome-messages.ts";
import { narrowScreen, theme } from "./visual-language.ts";

const maxVisible = 10;

type Kind =
	| "file"
	| "skill"
	| "search"
	| "dir"
	| "mcpSearch"
	| "subagent"
	| "command"
	| "edit"
	| "mcp"
	| "question"
	| "script"
	| "tool";

const words: Record<Kind, [string, string, string, string]> = {
	file: ["Read", "Reading", "file", "files"],
	skill: ["Read", "Reading", "skill", "skills"],
	search: ["Searched", "Searching", "pattern", "patterns"],
	dir: ["Listed", "Listing", "dir", "dirs"],
	mcpSearch: ["Searched", "Searching", "MCP tool", "MCP tools"],
	subagent: ["Ran", "Running", "subagent", "subagents"],
	command: ["Ran", "Running", "command", "commands"],
	edit: ["Edited", "Editing", "file", "files"],
	mcp: ["Called", "Calling", "MCP tool", "MCP tools"],
	question: ["Asked", "Asking", "question", "questions"],
	script: ["Ran", "Running", "script", "scripts"],
	tool: ["Ran", "Running", "tool", "tools"],
};

const folding = new Set<Kind>([
	"file",
	"skill",
	"search",
	"dir",
	"mcpSearch",
	"subagent",
]);

type ToolState = {
	toolName: string;
	args: unknown;
	expanded: boolean;
	isPartial: boolean;
	result?: { isError?: boolean };
};

type Seg = {
	child: Component;
	from: number;
	to: number;
	role: "gap" | "tool" | "card" | "thought" | "block";
	open: boolean;
	running: boolean;
	failed: boolean;
	clickable: boolean;
	kind: Kind;
};

type Span = { start: number; claimed: Set<number>; members: number[] };
type Shared = {
	thoughts: WeakMap<object, { open: boolean; running: boolean }>;
	cards: WeakMap<object, { open: boolean; failed: boolean }>;
	toggles: WeakSet<object>;
	expandedGroups: WeakSet<object>;
};

const SHARED = Symbol.for("pi-workflow:chrome-groups:shared");
const slots = globalThis as Record<symbol, Shared | undefined>;
slots[SHARED] ??= {
	thoughts: new WeakMap(),
	cards: new WeakMap(),
	toggles: new WeakSet(),
	expandedGroups: new WeakSet(),
};
slots[SHARED].toggles ??= new WeakSet();
const { thoughts, cards, toggles, expandedGroups } = slots[SHARED];
const patched = new Set<Container>();
const hovered = new WeakMap<Container, number>();

export function toolKind(name: string, args: unknown): Kind {
	if (name.startsWith("mcp__")) return "mcp";
	if (name.startsWith("ask_user_")) return "question";
	switch (name) {
		case "read": {
			const path = (args as { path?: unknown } | undefined)?.path;
			return typeof path === "string" && /(^|\/)SKILL\.md$/.test(path)
				? "skill"
				: "file";
		}
		case "grep":
		case "find":
			return "search";
		case "ls":
			return "dir";
		case "tool_search":
			return "mcpSearch";
		case "spawn_child":
		case "continue_child":
			return "subagent";
		case "bash":
			return "command";
		case "codemode":
			return "script";
		case "edit":
		case "write":
			return "edit";
		default:
			return "tool";
	}
}

export function markThought(
	region: object,
	state: { open: boolean; running: boolean },
) {
	thoughts.set(region, state);
}

export function markToggle(component: object) {
	toggles.add(component);
}

export function markCard(
	card: object,
	state: { open: boolean; failed: boolean },
) {
	cards.set(card, state);
}

type Target = { component: Component; height: number };

type ChildLines = {
	width: number;
	children: readonly Component[];
	parts: readonly (readonly string[])[];
	lines: readonly string[];
};

type Indent = (width: number) => Margin;
// A selectable head: a row or a group label, the `ordinal`-th selectable
// segment of `component`, rendered at `row`.
type Head = {
	row: number;
	component: Component;
	ordinal: number;
	kind: "row" | "group";
};
type View = {
	width: number;
	margin: Margin;
	heads: Head[];
	targets: Target[];
	total: number;
};
export type Viewport = {
	reveal(line: number, total: number): void;
	restore(): void;
};

const views = new WeakMap<Container, View>();
const cursors = new WeakMap<Container, Head>();
const viewports = new WeakMap<Container, Viewport>();
let current: Container | undefined;
const cursorListeners = new Set<() => void>();

function rowOf(child: Component) {
	if (child instanceof ToolExecutionComponent) {
		const tool = child as unknown as ToolState;
		return {
			role: "tool" as const,
			open: tool.expanded,
			running: tool.isPartial,
			failed: tool.result?.isError === true,
			clickable: tool.result !== undefined,
			kind: toolKind(tool.toolName, tool.args),
		};
	}
	if (child instanceof CustomMessageComponent) {
		const card = cards.get(
			(child as unknown as { customComponent?: object }).customComponent ?? {},
		);
		if (card)
			return {
				role: "card" as const,
				kind: "subagent" as Kind,
				clickable: true,
				...card,
			};
	}
	return undefined;
}

function segments(child: Component, lines: readonly string[]): Seg[] {
	const base = {
		child,
		open: false,
		running: false,
		failed: false,
		clickable: false,
		kind: "tool" as Kind,
	};
	if (lines.length === 0) return [];
	if (child instanceof Spacer)
		return [{ ...base, from: 0, to: lines.length, role: "gap" }];
	const row = rowOf(child);
	if (row) {
		const seg: Seg = { ...base, ...row, from: 0, to: lines.length };
		if (lines.length > 1 && visibleWidth(lines[0]) === 0)
			return [
				{ ...base, from: 0, to: 1, role: "gap" },
				{ ...seg, from: 1 },
			];
		return [seg];
	}
	if (child instanceof AssistantMessageComponent) {
		const content = (child as unknown as { contentContainer: Container })
			.contentContainer;
		const layout = (content as unknown as { childLines?: ChildLines })
			.childLines;
		if (layout?.lines.length === lines.length) {
			const out: Seg[] = [];
			let at = 0;
			for (const [index, component] of layout.children.entries()) {
				const height = layout.parts[index].length;
				if (height > 0) {
					const thought = thoughts.get(component);
					out.push({
						...base,
						from: at,
						to: at + height,
						role: thought
							? "thought"
							: component instanceof Spacer
								? "gap"
								: "block",
						open: thought?.open ?? false,
						running: thought?.running ?? false,
						clickable: thought !== undefined,
					});
				}
				at += height;
			}
			return out;
		}
	}
	const toggle =
		child instanceof CustomMessageComponent &&
		toggles.has(
			(child as unknown as { customComponent?: object }).customComponent ?? {},
		);
	if (toggle && lines.length > 1 && visibleWidth(lines[0]) === 0)
		return [
			{ ...base, from: 0, to: 1, role: "gap" },
			{ ...base, from: 1, to: lines.length, role: "block", clickable: true },
		];
	return [
		{ ...base, from: 0, to: lines.length, role: "block", clickable: toggle },
	];
}

type Step = "member" | "thought" | "transparent" | "break";

function step(seg: Seg): Step {
	if (seg.role === "tool" && folding.has(seg.kind))
		return seg.open ? "transparent" : "member";
	if (seg.role === "thought")
		return seg.open || seg.running ? "transparent" : "thought";
	return "break";
}

function participates(seg: Seg) {
	return (
		(seg.role === "tool" && !seg.open) ||
		(seg.role === "thought" && !seg.open && !seg.running)
	);
}

function compact(seg: Seg) {
	return (
		(seg.role === "tool" || seg.role === "card" || seg.role === "thought") &&
		!seg.open
	);
}

function spans(items: Seg[]) {
	const found: Span[] = [];
	const claimed = new Set<number>();
	let i = 0;
	while (i < items.length) {
		if (step(items[i]) === "break") {
			i++;
			continue;
		}
		const run = new Set<number>();
		let members = 0;
		let j = i;
		for (; j < items.length; j++) {
			const s = step(items[j]);
			if (s === "break") break;
			if (s === "member") members++;
			if (s !== "transparent") run.add(j);
		}
		if (members > 0) {
			const all = Array.from({ length: j - i }, (_, k) => i + k);
			found.push({ start: i, claimed: run, members: all });
			for (const k of run) claimed.add(k);
		}
		i = Math.max(j, i + 1);
	}
	i = 0;
	while (i < items.length) {
		if (claimed.has(i) || !participates(items[i])) {
			i++;
			continue;
		}
		let j = i;
		while (j < items.length && !claimed.has(j) && participates(items[j])) j++;
		if (j - i > maxVisible + 1) {
			const hide = j - i - maxVisible;
			const members = new Set<number>();
			for (let k = i; k < i + hide; k++) members.add(k);
			found.push({ start: i, claimed: members, members: [...members] });
		}
		i = j;
	}
	i = 0;
	while (i < items.length) {
		let j = i;
		while (j < items.length && items[j].role === "card") j++;
		const run = Array.from({ length: j - i }, (_, k) => i + k);
		const closed = run.filter((k) => !items[k].open);
		if (run.length > 1 && closed.length > 0)
			found.push({ start: i, claimed: new Set(closed), members: run });
		i = Math.max(j, i + 1);
	}
	return found;
}

function groupLabel(members: Seg[], width: number) {
	const t = theme();
	const buckets: { kind: Kind; count: number; running: boolean }[] = [];
	let failed = 0;
	for (const seg of members) {
		if (seg.role !== "tool" && seg.role !== "card") continue;
		const bucket = buckets.find((b) => b.kind === seg.kind);
		if (bucket) {
			bucket.count++;
			bucket.running ||= seg.running;
		} else buckets.push({ kind: seg.kind, count: 1, running: seg.running });
		if (seg.failed) failed++;
	}
	const label =
		buckets
			.map(({ kind, count, running }) => {
				const [past, present, one, many] = words[kind];
				return `${running ? present : past} ${count} ${count === 1 ? one : many}`;
			})
			.join(", ") || `${members.length} more`;
	const suffix = failed > 0 ? t.fg("error", ` · ${failed} failed`) : "";
	return truncateToWidth(
		`${t.fg("dim", "◈")} ${t.bold(t.fg("muted", label))}${suffix}`,
		width,
	);
}

function header(members: Seg[], key: object, indent: Indent): Component {
	return {
		render(width: number) {
			const { left, width: room } = indent(width);
			return [`${" ".repeat(left)}${groupLabel(members, Math.max(1, room))}`];
		},
		invalidate() {},
		handleMouse(event) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			if (expandedGroups.has(key)) expandedGroups.delete(key);
			else expandedGroups.add(key);
			return { handled: true };
		},
	};
}

function shifted(child: Component, from: number, height: number): Component {
	return {
		render: (width: number) => child.render(width).slice(from),
		invalidate: () => child.invalidate(),
		handleMouse: (event) =>
			child.handleMouse?.({ ...event, y: event.y + from, height }),
	};
}

function renderChat(
	children: readonly Component[],
	width: number,
	indent: Indent,
) {
	const rendered = new Map<Component, readonly string[]>();
	const segs: Seg[] = [];
	for (const child of children) {
		const lines = child.render(width);
		rendered.set(child, lines);
		segs.push(...segments(child, lines));
	}
	const items = segs.filter((seg) => seg.role !== "gap");
	const hidden = new Set<Seg>();
	const headers = new Map<Seg, Component>();
	for (const span of spans(items)) {
		const first = items[span.start];
		headers.set(
			first,
			header(
				span.members.map((k) => items[k]),
				first.child,
				indent,
			),
		);
		if (!expandedGroups.has(first.child))
			for (const k of span.claimed) hidden.add(items[k]);
	}
	const before: (boolean | undefined)[] = [];
	const after: (boolean | undefined)[] = [];
	const drops: boolean[] = [];
	let state: boolean | undefined;
	segs.forEach((seg, k) => {
		before[k] = state;
		if (seg.role === "gap") return;
		if (headers.has(seg) && hidden.has(seg)) state = true;
		else if (!hidden.has(seg)) state = compact(seg);
	});
	state = undefined;
	let vanishing = false;
	for (let k = segs.length - 1; k >= 0; k--) {
		const seg = segs[k];
		after[k] = state;
		drops[k] = vanishing;
		if (seg.role === "gap") continue;
		vanishing = hidden.has(seg) && !headers.has(seg);
		if (headers.has(seg)) state = true;
		else if (!hidden.has(seg)) state = compact(seg);
	}
	const lines: string[] = [];
	const mouse: Target[] = [];
	const heads = new Map<number, Head>();
	const head = (seg: Seg, kind: Head["kind"]) =>
		heads.set(lines.length, {
			row: lines.length,
			component: seg.child,
			ordinal: ordinals.get(seg) ?? 0,
			kind,
		});
	const ordinals = new Map<Seg, number>();
	const counts = new Map<Component, number>();
	for (const seg of segs)
		if (seg.clickable) {
			const count = counts.get(seg.child) ?? 0;
			ordinals.set(seg, count);
			counts.set(seg.child, count + 1);
		}
	const bodies = new Set<number>();
	let carry = "";
	let last: { child: Component; next: number } | undefined;
	const emit = (seg: Seg) => {
		const all = rendered.get(seg.child) ?? [];
		const part = all.slice(seg.from, seg.to);
		part[0] = carry + part[0];
		carry = "";
		if (seg.clickable) {
			head(seg, "row");
			if (seg.open && seg.role === "tool")
				for (let i = 1; i < part.length; i++) bodies.add(lines.length + i);
		}
		lines.push(...part);
		const entry = mouse.at(-1);
		if (entry && last?.child === seg.child && last.next === seg.from)
			entry.height += part.length;
		else
			mouse.push({
				component:
					seg.from === 0 ? seg.child : shifted(seg.child, seg.from, all.length),
				height: part.length,
			});
		last = { child: seg.child, next: seg.to };
	};
	segs.forEach((seg, k) => {
		if (seg.role === "gap" && (drops[k] || (before[k] && after[k]))) {
			carry += (rendered.get(seg.child) ?? []).slice(seg.from, seg.to).join("");
			return;
		}
		const label = headers.get(seg);
		if (label) {
			head(seg, "group");
			lines.push(carry + label.render(width)[0]);
			carry = "";
			mouse.push({ component: label, height: 1 });
			last = undefined;
		}
		if (!hidden.has(seg)) emit(seg);
	});
	if (carry && lines.length > 0) lines[lines.length - 1] += carry;
	return { lines, mouse, heads, bodies };
}

function pointAt(line: string) {
	const at = line.search(/[◆◇◈]/);
	if (at < 0) return line;
	return `${line.slice(0, at)}${theme().fg("accent", "▸")}${line.slice(at + 1)}`;
}

function rows(
	container: Container,
	chat: ReturnType<typeof renderChat>,
	width: number,
	margin: Margin,
): Target[] {
	const { lines, mouse, heads, bodies } = chat;
	const owners: { component: Component; y: number; height: number }[] = [];
	for (const { component, height } of mouse)
		for (let y = 0; y < height; y++) owners.push({ component, y, height });
	if (owners.length !== lines.length)
		return mouse.map(({ component, height }) => ({ component, height }));
	const target = (line: number) =>
		visibleWidth(lines[line] ?? "") === 0 && heads.has(line + 1)
			? line + 1
			: line;
	return owners.map((_, line) => ({
		height: 1,
		component: {
			render: () => [],
			invalidate() {},
			handleMouse(event: TuiMouseEvent) {
				const at = target(line);
				if (event.type === "move") {
					const next = heads.has(at) ? at : undefined;
					if (hovered.get(container) === next) return undefined;
					if (next === undefined) hovered.delete(container);
					else hovered.set(container, next);
					return { handled: true, render: true };
				}
				if (bodies.has(at) && event.type !== "wheel") return undefined;
				if (
					narrowScreen() &&
					event.type !== "wheel" &&
					!margin.mouse({ ...event, width })
				)
					return undefined;
				const owner = owners[at];
				return owner.component.handleMouse?.({
					...event,
					x: Math.min(
						Math.max(event.x, margin.left),
						margin.left + Math.max(0, margin.width - 1),
					),
					y: owner.y,
					height: owner.height,
				});
			},
		},
	}));
}

function cursorAt(container: Container) {
	const cursor = cursors.get(container);
	const view = views.get(container);
	if (!cursor || !view) return -1;
	return view.heads.findIndex(
		(head) =>
			head.component === cursor.component &&
			head.ordinal === cursor.ordinal &&
			head.kind === cursor.kind,
	);
}

function selected(line: string, width: number) {
	const fitted =
		visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
	const pad = " ".repeat(Math.max(0, width - visibleWidth(fitted)));
	return theme().bg("selectedBg", fitted + pad);
}

export const transcriptCursor = {
	active() {
		return current !== undefined && cursors.has(current);
	},
	move(delta: -1 | 1) {
		const view = current && views.get(current);
		if (!current || !view || view.heads.length === 0) return false;
		const at = cursorAt(current);
		const next =
			at < 0
				? view.heads.length - 1
				: Math.min(view.heads.length - 1, Math.max(0, at + delta));
		const head = view.heads[next];
		const entering = !cursors.has(current);
		cursors.set(current, head);
		viewports.get(current)?.reveal(head.row, view.total);
		if (entering) for (const listener of cursorListeners) listener();
		return true;
	},
	toggle() {
		const view = current && views.get(current);
		if (!current || !view) return false;
		const line = view.heads[cursorAt(current)]?.row;
		if (line === undefined) return false;
		const result = view.targets[line]?.component.handleMouse?.({
			type: "click",
			button: "left",
			x: view.margin.left,
			y: 0,
			width: view.width,
			height: 1,
			screenX: view.margin.left,
			screenY: 0,
			shift: false,
			alt: false,
			ctrl: false,
		});
		return result !== undefined;
	},
	leave() {
		if (!current || !cursors.has(current)) return;
		cursors.delete(current);
		viewports.get(current)?.restore();
		for (const listener of cursorListeners) listener();
	},
	subscribe(listener: () => void) {
		cursorListeners.add(listener);
		return () => {
			cursorListeners.delete(listener);
		};
	},
};

export function patchChat(
	container: Container,
	indent: Indent,
	viewport?: Viewport,
) {
	if (viewport && !viewports.has(container)) viewports.set(container, viewport);
	if (patched.has(container)) return;
	patched.add(container);
	const target = container as unknown as {
		render(width: number): readonly string[];
		childLines?: ChildLines;
		children: Component[];
	};
	target.render = (width: number) => {
		try {
			const chat = renderChat(target.children, width, indent);
			const margin = indent(width);
			const targets = rows(container, chat, width, margin);
			let at = 0;
			target.childLines = {
				width,
				children: targets.map(({ component }) => component),
				parts: targets.map(({ height }) => {
					at += height;
					return chat.lines.slice(at - height, at);
				}),
				lines: chat.lines,
			};
			current = container;
			const heads = [...chat.heads.values()];
			views.set(container, {
				width,
				margin,
				heads,
				targets,
				total: chat.lines.length,
			});
			const point = hovered.get(container);
			const cursor = heads[cursorAt(container)]?.row;
			const paint = narrowScreen() ? margin.left + margin.width : width;
			return chat.lines.map((line, i) => {
				if (i === cursor) return selected(pointAt(line), paint);
				return i === point && chat.heads.has(point) ? pointAt(line) : line;
			});
		} catch {
			delete (target as Partial<typeof target>).render;
			patched.delete(container);
			return target.render(width);
		}
	};
}

export function restoreChat() {
	for (const container of patched) {
		delete (container as Partial<{ render: unknown }>).render;
		cursors.delete(container);
	}
	patched.clear();
	current = undefined;
}
