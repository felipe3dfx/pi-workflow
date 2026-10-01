// Relies on Pi 1.0.0 chat container internals (InteractiveMode.chatContainer, ToolExecutionComponent fields).
import {
	AssistantMessageComponent,
	CustomMessageComponent,
	type Theme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Container,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
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
	kind: Kind;
};

type Span = { start: number; claimed: Set<number>; members: number[] };
type Shared = {
	thoughts: WeakMap<object, { open: boolean; running: boolean }>;
	cards: WeakMap<object, { open: boolean; failed: boolean }>;
	expandedGroups: WeakSet<object>;
};

const SHARED = Symbol.for("pi-workflow:chrome-groups:shared");
const slots = globalThis as Record<symbol, Shared | undefined>;
slots[SHARED] ??= {
	thoughts: new WeakMap(),
	cards: new WeakMap(),
	expandedGroups: new WeakSet(),
};
const { thoughts, cards, expandedGroups } = slots[SHARED];
const patched = new Set<Container>();

function theme() {
	const current = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
	if (!current)
		throw new Error("Theme not initialized. Call initTheme() first.");
	return current;
}

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

export function markCard(
	card: object,
	state: { open: boolean; failed: boolean },
) {
	cards.set(card, state);
}

type MouseLayout = {
	width: number;
	children: { component: Component; height: number }[];
};

function rowOf(child: Component) {
	if (child instanceof ToolExecutionComponent) {
		const tool = child as unknown as ToolState;
		return {
			role: "tool" as const,
			open: tool.expanded,
			running: tool.isPartial,
			failed: tool.result?.isError === true,
			kind: toolKind(tool.toolName, tool.args),
		};
	}
	if (child instanceof CustomMessageComponent) {
		const card = cards.get(
			(child as unknown as { customComponent?: object }).customComponent ?? {},
		);
		if (card)
			return { role: "card" as const, kind: "subagent" as Kind, ...card };
	}
	return undefined;
}

function segments(child: Component, lines: string[]): Seg[] {
	const base = {
		child,
		open: false,
		running: false,
		failed: false,
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
		const layout = (content as unknown as { mouseLayout?: MouseLayout })
			.mouseLayout;
		const total = layout?.children.reduce((sum, c) => sum + c.height, 0);
		if (layout && total === lines.length) {
			const out: Seg[] = [];
			let at = 0;
			for (const { component, height } of layout.children) {
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
					});
				}
				at += height;
			}
			return out;
		}
	}
	return [{ ...base, from: 0, to: lines.length, role: "block" }];
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
	const buckets: { kind: Kind; count: number }[] = [];
	let running = false;
	let failed = 0;
	for (const seg of members) {
		if (seg.role !== "tool" && seg.role !== "card") continue;
		const bucket = buckets.find((b) => b.kind === seg.kind);
		if (bucket) bucket.count++;
		else buckets.push({ kind: seg.kind, count: 1 });
		running ||= seg.running;
		if (seg.failed) failed++;
	}
	const label =
		buckets
			.map(({ kind, count }) => {
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

function header(
	members: Seg[],
	key: object,
	indent: (width: number) => number,
): Component {
	return {
		render(width: number) {
			const edge = indent(width);
			return [
				`${" ".repeat(edge)}${groupLabel(members, Math.max(1, width - edge * 2))}`,
			];
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
	indent: (width: number) => number,
) {
	const rendered = new Map<Component, string[]>();
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
	const mouse: MouseLayout["children"] = [];
	let carry = "";
	let last: { child: Component; next: number } | undefined;
	const emit = (seg: Seg) => {
		const all = rendered.get(seg.child) ?? [];
		const part = all.slice(seg.from, seg.to);
		part[0] = carry + part[0];
		carry = "";
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
		const head = headers.get(seg);
		if (head) {
			lines.push(carry + head.render(width)[0]);
			carry = "";
			mouse.push({ component: head, height: 1 });
			last = undefined;
		}
		if (!hidden.has(seg)) emit(seg);
	});
	if (carry && lines.length > 0) lines[lines.length - 1] += carry;
	return { lines, mouse };
}

export function patchChat(
	container: Container,
	indent: (width: number) => number,
) {
	if (patched.has(container)) return;
	patched.add(container);
	const target = container as unknown as {
		render(width: number): string[];
		mouseLayout?: MouseLayout;
		children: Component[];
	};
	target.render = (width: number) => {
		try {
			const { lines, mouse } = renderChat(target.children, width, indent);
			target.mouseLayout = { width, children: mouse };
			return lines;
		} catch {
			delete (target as Partial<typeof target>).render;
			patched.delete(container);
			return target.render(width);
		}
	};
}

export function restoreChat() {
	for (const container of patched)
		delete (container as Partial<{ render: unknown }>).render;
	patched.clear();
}
