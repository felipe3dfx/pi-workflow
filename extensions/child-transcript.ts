import {
	type ChildAudit,
	type SegmentCursor,
	type WindowCursor,
	windowSize,
} from "./child-audit.ts";

type Opened = Exclude<
	NonNullable<Awaited<ReturnType<ChildAudit["read"]>>>,
	{ refresh: true }
>;
type Observation = Opened["observations"][number];
type Entry = Opened["transcript"][number];
type MessageEntry = Extract<Entry, { type: "message" }>;
type ToolEntry = Extract<Entry, { type: "tool" }>;
type Identity = Opened["identity"];
type Health = Opened["health"];
type Segment = Exclude<
	NonNullable<Awaited<ReturnType<ChildAudit["segment"]>>>,
	{ refresh: true } | { unavailable: true }
>;

export type Item =
	| {
			key: string;
			kind: "input";
			source: string;
			delivery: string;
			text: string;
			error?: true;
	  }
	| { key: string; kind: "execution"; state: string; verdict?: string }
	| { key: string; kind: "message"; entry: MessageEntry }
	| { key: string; kind: "tool"; entry: ToolEntry }
	| { key: string; kind: "unsupported"; ordinal: number }
	| { key: string; kind: "unavailable"; from: number; to?: number }
	| { key: string; kind: "static" };

export type Slot = { parts: Segment[]; unavailable?: true };

export type Block = {
	sub: string;
	rows: string[];
	lines?: number[];
	load?: { slot: string; cursor: SegmentCursor; toward: "before" | "after" };
};

export type Render = (
	item: Item,
	width: number,
	slot: (name: string) => Slot | undefined,
) => Block[];

type Window = {
	cursor: WindowCursor;
	next: WindowCursor;
	observations: Observation[];
	unavailable: { from: number; to?: number }[];
	more: boolean;
};

type Anchor = {
	key: string;
	sub: string;
	line?: number;
	row: number;
	fromEnd?: number;
};
type Placed = Block & { key: string };
type At = { index: number; row: number };

const residentObservations = windowSize * 3;
const residentParts = 4;

export function partSub(slot: string, part: number) {
	return `${slot}:${part}`;
}

export function createTranscript(options: {
	audit: Pick<ChildAudit, "read" | "segment">;
	child: string;
	changed: () => void;
	live?: () => Item[];
}) {
	const { audit, child } = options;
	let windows: Window[] = [];
	let identity: Identity | undefined;
	let health: Health | undefined;
	let warning: string | undefined;
	let missing = false;
	let opened = false;
	let following = true;
	let anchor: Anchor | undefined;
	let stale = false;
	let busy = false;
	let epoch = 0;
	let disposed = false;
	let wanted: (() => Promise<void>) | undefined;
	let blocks: Placed[] = [];
	let shownAt = 0;
	let core = options.live !== undefined;
	const slots = new Map<string, Slot>();
	const loading = new Set<string>();
	const cache = new Map<string, Block[]>();

	const atStart = () => core || windows.length === 0 || windows[0].cursor.from <= 1;
	const atEnd = () => core || windows.length === 0 || !windows.at(-1)?.more;

	function windowOf(cursor: WindowCursor, read: Opened, below?: number): Window {
		const kept = (ordinal: number) => below === undefined || ordinal < below;
		return {
			cursor,
			next: read.next,
			observations: read.observations.filter((item) => kept(item.ordinal)),
			unavailable: read.unavailable.filter((range) => kept(range.from)),
			more: read.next.from > cursor.from,
		};
	}

	async function fetch(cursor?: WindowCursor) {
		const at = epoch;
		const read = await audit.read(child, cursor);
		if (at !== epoch) return undefined;
		if (!read) {
			missing = true;
			return undefined;
		}
		identity = read.identity;
		health = read.health;
		if ("refresh" in read) {
			restart();
			return undefined;
		}
		warning = read.warning;
		return read;
	}

	function restart() {
		epoch += 1;
		windows = [];
		opened = false;
		slots.clear();
		cache.clear();
	}

	async function open() {
		const first = await fetch();
		if (options.live && identity?.parent === undefined) return;
		core = false;
		if (!first) return;
		const start = { child, generation: first.next.generation, from: 1 };
		const total = first.health.received ?? first.health.written ?? 0;
		const tail = Math.max(1, total - windowSize);
		if (tail <= first.next.from) {
			windows = [windowOf(start, first)];
			return;
		}
		const cursor = { ...start, from: tail };
		const last = await fetch(cursor);
		if (last) windows = [windowOf(cursor, last)];
	}

	async function forward() {
		const last = windows.at(-1);
		if (!last) return;
		const read = await fetch(last.next);
		if (!read) return;
		if (read.observations.length === 0 && read.unavailable.length === 0) {
			last.more = false;
			return;
		}
		windows.push(windowOf(last.next, read));
	}

	async function refresh() {
		const last = windows.at(-1);
		if (!last) return;
		const read = await fetch(last.cursor);
		if (read) windows[windows.length - 1] = windowOf(last.cursor, read);
	}

	async function backward() {
		const first = windows[0];
		if (!first) return;
		const boundary = first.cursor.from;
		const pieces: Window[] = [];
		let cursor: WindowCursor = {
			child,
			generation: first.next.generation,
			from: Math.max(1, boundary - windowSize),
		};
		while (cursor.from < boundary) {
			const read = await fetch(cursor);
			if (!read) return;
			pieces.push({ ...windowOf(cursor, read, boundary), more: true });
			if (read.next.from <= cursor.from) break;
			cursor = read.next;
		}
		pinFromEnd();
		windows = [...pieces, ...windows];
	}

	function pinFromEnd() {
		if (!anchor || following) return;
		const at = locate(anchor);
		const block = blocks[at.index];
		if (block?.key === anchor.key && block.sub === anchor.sub) {
			anchor = { ...anchor, fromEnd: block.rows.length - at.row };
		}
	}

	async function expand(
		key: string,
		slot: string,
		cursor: SegmentCursor,
		toward: "before" | "after",
	) {
		const name = `${key}\n${slot}`;
		const at = epoch;
		const read = await audit.segment(child, cursor);
		if (at !== epoch) return;
		const held = slots.get(name) ?? { parts: [] };
		if (!read || "unavailable" in read) {
			slots.set(name, { ...held, unavailable: true });
			return;
		}
		if ("refresh" in read) {
			restart();
			return;
		}
		const parts =
			toward === "after" ? [...held.parts, read] : [read, ...held.parts];
		if (parts.length > residentParts) {
			if (toward === "after") parts.shift();
			else parts.pop();
		}
		slots.set(name, { parts });
		if (toward === "before" && anchor?.key === key && anchor.sub === `${slot}:before`) {
			anchor = { key, sub: partSub(slot, read.part), row: Number.MAX_SAFE_INTEGER };
		}
	}

	function pump() {
		if (busy || disposed) return;
		let load: (() => Promise<void>) | undefined;
		if (!opened) {
			opened = true;
			load = open;
		} else if (stale && !core && (following || atEnd())) {
			stale = false;
			load = refresh;
		} else load = wanted;
		wanted = undefined;
		if (!load) return;
		busy = true;
		const at = epoch;
		void load()
			.catch(() => {})
			.finally(() => {
				busy = false;
				if (disposed) return;
				if (at === epoch) prune();
				options.changed();
			});
	}

	function prune() {
		let total = windows.reduce((sum, item) => sum + item.observations.length, 0);
		while (windows.length > 1 && total > residentObservations) {
			const held = windows.findIndex((window) =>
				window.observations.some((observation) => keyOf(observation) === anchor?.key),
			);
			const placed = blocks.findIndex((block) => block.key === anchor?.key);
			const top =
				following ||
				(held < 0
					? placed > blocks.length / 2
					: held > windows.length - 1 - held);
			if (top) pinFromEnd();
			const removed = top ? windows.shift() : windows.pop();
			total -= removed?.observations.length ?? 0;
			const last = windows.at(-1);
			if (!top && last) last.more = true;
		}
	}

	function items() {
		if (core) return options.live?.() ?? [];
		const merged = new Map<string, Item>();
		const seen = new Set<number>();
		const steps = windows
			.flatMap((window) => [
				...window.observations.map((observation) => ({
					at: observation.ordinal,
					observation,
				})),
				...window.unavailable.map((range) => ({ at: range.from, range })),
			])
			.sort((a, b) => a.at - b.at);
		for (const step of steps) {
			if ("range" in step) {
				const key = `gap:${step.range.from}`;
				merged.set(key, { key, kind: "unavailable", ...step.range });
				continue;
			}
			const { observation } = step;
			if (seen.has(observation.ordinal)) continue;
			seen.add(observation.ordinal);
			const key = keyOf(observation);
			if (key !== undefined) project(merged, key, observation);
		}
		return [...merged.values()];
	}

	function place(list: Item[], width: number, style: string, render: Render) {
		const placed: Placed[] = [];
		const kept = new Set<string>();
		for (const item of list) {
			const settled = item.kind === "static" ? false : isSettled(item);
			const id = `${item.key}\n${width}\n${style}`;
			let shown = settled ? cache.get(id) : undefined;
			if (!shown) {
				let sliced = false;
				shown = render(item, width, (name) => {
					sliced = true;
					return slots.get(`${item.key}\n${name}`);
				});
				if (settled && !sliced) cache.set(id, shown);
			}
			if (settled) kept.add(id);
			for (const block of shown) {
				if (block.rows.length > 0) placed.push({ ...block, key: item.key });
			}
		}
		for (const id of cache.keys()) if (!kept.has(id)) cache.delete(id);
		return placed;
	}

	function locate(at: Anchor | undefined): At {
		if (!at) return { index: 0, row: 0 };
		const index = blocks.findIndex(
			(block) => block.key === at.key && block.sub === at.sub,
		);
		if (index < 0) {
			const item = blocks.findIndex((block) => block.key === at.key);
			return {
				index: item >= 0 ? item : Math.max(0, Math.min(shownAt, blocks.length - 1)),
				row: 0,
			};
		}
		const { lines, rows } = blocks[index];
		const first = at.line === undefined ? -1 : (lines?.indexOf(at.line) ?? -1);
		const row =
			at.fromEnd !== undefined
				? rows.length - at.fromEnd
				: first >= 0
					? first + at.row
					: at.row;
		return { index, row: Math.max(0, Math.min(row, rows.length - 1)) };
	}

	function anchorAt({ index, row }: At): Anchor | undefined {
		const block = blocks[index];
		if (!block) return undefined;
		const line = block.lines?.[row];
		if (line === undefined || !block.lines) return { key: block.key, sub: block.sub, row };
		return {
			key: block.key,
			sub: block.sub,
			line,
			row: row - block.lines.indexOf(line),
		};
	}

	function move(from: At, delta: number): At {
		let { index, row } = from;
		row += delta;
		while (row < 0 && index > 0) {
			index -= 1;
			row += blocks[index].rows.length;
		}
		while (index < blocks.length - 1 && row >= blocks[index].rows.length) {
			row -= blocks[index].rows.length;
			index += 1;
		}
		const size = blocks[index]?.rows.length ?? 1;
		return { index, row: Math.max(0, Math.min(row, size - 1)) };
	}

	function rowsBetween(from: At, to: At) {
		if (to.index < from.index) return 0;
		if (to.index === from.index) return Math.max(0, to.row - from.row);
		let rows = blocks[from.index].rows.length - from.row;
		for (let i = from.index + 1; i < to.index; i++) rows += blocks[i].rows.length;
		return rows + to.row;
	}

	return {
		layout(
			width: number,
			height: number,
			style: string,
			render: Render,
			extra: { head: Item[]; tail: Item[] },
		) {
			const list = [
				...(atStart() ? extra.head : []),
				...items(),
				...(atEnd() ? extra.tail : []),
			];
			blocks = place(list, width, style, render);
			const end = {
				index: Math.max(0, blocks.length - 1),
				row: Math.max(0, (blocks.at(-1)?.rows.length ?? 1) - 1),
			};
			let start = following ? move(end, 1 - height) : locate(anchor);
			if (!following && atEnd() && rowsBetween(start, end) + 1 < height) {
				start = move(end, 1 - height);
			}
			anchor = anchorAt(start);
			shownAt = start.index;
			const rows: string[] = [];
			const shown = new Set<string>();
			let index = start.index;
			let row = start.row;
			while (rows.length < height && index < blocks.length) {
				const block = blocks[index];
				shown.add(block.key);
				if (block.load && !wanted) {
					const { slot, cursor, toward } = block.load;
					const key = block.key;
					const name = `${key}\n${slot}`;
					if (!loading.has(name)) {
						wanted = async () => {
							loading.add(name);
							try {
								await expand(key, slot, cursor, toward);
							} finally {
								loading.delete(name);
							}
						};
					}
				}
				rows.push(...block.rows.slice(row, row + height - rows.length));
				index += 1;
				row = 0;
			}
			if (opened && windows.length > 0 && !wanted) {
				if (index >= blocks.length && !atEnd()) wanted = forward;
				else if (rowsBetween({ index: 0, row: 0 }, start) < height && !atStart()) {
					wanted = backward;
				}
			}
			for (const name of slots.keys()) {
				if (!shown.has(name.slice(0, name.indexOf("\n")))) slots.delete(name);
			}
			pump();
			return rows;
		},
		scroll(delta: number) {
			if (delta === 0 || blocks.length === 0) return;
			following = false;
			anchor = anchorAt(move(locate(anchor), delta));
		},
		follow() {
			following = true;
			stale = true;
			pump();
		},
		get following() {
			return following;
		},
		changed() {
			stale = true;
			pump();
		},
		invalidate() {
			cache.clear();
		},
		info() {
			return { identity, health, warning, missing };
		},
		dispose() {
			disposed = true;
			epoch += 1;
			windows = [];
			blocks = [];
			slots.clear();
			cache.clear();
		},
	};
}

function isSettled(item: Item) {
	if (item.kind === "message" || item.kind === "tool") return item.entry.final;
	return true;
}

function keyOf(observation: Observation) {
	if (observation.unsupported) return `unsupported:${observation.ordinal}`;
	if (observation.large) {
		const meta = observation.large.meta as {
			kind?: string;
			message?: string;
			call?: string;
			phase?: string;
		};
		if (meta.kind === "tool" && meta.call && meta.phase !== "update") {
			return `tool:${meta.call}`;
		}
		if (meta.kind === "message" && meta.phase === "end" && meta.message) {
			return meta.message;
		}
		return undefined;
	}
	if (observation.kind === "input" || observation.kind === "execution") {
		return `${observation.kind}:${observation.ordinal}`;
	}
	if (observation.kind === "message") return observation.message;
	if (observation.kind === "tool") return `tool:${observation.call}`;
	return undefined;
}

function project(items: Map<string, Item>, key: string, observation: Observation) {
	const known = items.get(key);
	if (observation.unsupported) {
		items.set(key, { key, kind: "unsupported", ordinal: observation.ordinal });
		return;
	}
	if (observation.large) {
		const meta = observation.large.meta as {
			kind?: string;
			phase?: string;
			message?: string;
			role?: string;
			call?: string;
			parent?: string;
			name?: string;
			error?: boolean;
		};
		const { segment } = observation.large;
		if (meta.kind === "message") {
			items.set(key, {
				key,
				kind: "message",
				entry: {
					type: "message",
					message: meta.message ?? key,
					role: meta.role ?? "assistant",
					content: [],
					segment,
					final: true,
				},
			});
			return;
		}
		const before = known?.kind === "tool" ? known.entry : undefined;
		const entry: ToolEntry = before
			? { ...before }
			: {
					type: "tool",
					call: meta.call ?? key,
					...(meta.parent ? { parent: meta.parent } : {}),
					name: meta.name ?? "",
					final: false,
				};
		if (meta.phase === "start") entry.argsSegment = segment;
		else {
			delete entry.partial;
			entry.resultSegment = segment;
			if (meta.error !== undefined) entry.error = meta.error;
			entry.final = true;
		}
		items.set(key, { key, kind: "tool", entry });
		return;
	}
	if (observation.kind === "input") {
		items.set(key, {
			key,
			kind: "input",
			source: observation.source,
			delivery: observation.delivery,
			text: observation.text,
			...(observation.error ? { error: true as const } : {}),
		});
	} else if (observation.kind === "execution") {
		items.set(key, {
			key,
			kind: "execution",
			state: observation.state,
			...(observation.verdict === undefined ? {} : { verdict: observation.verdict }),
		});
	} else if (observation.kind === "message") {
		const before = known?.kind === "message" ? known.entry : undefined;
		if (observation.phase === "end") {
			items.set(key, {
				key,
				kind: "message",
				entry: {
					type: "message",
					message: observation.message,
					role: observation.role,
					content: observation.content,
					...(observation.usage === undefined ? {} : { usage: observation.usage }),
					...(observation.stopReason === undefined
						? {}
						: { stopReason: observation.stopReason }),
					...(observation.errorMessage === undefined
						? {}
						: { errorMessage: observation.errorMessage }),
					final: true,
				},
			});
			return;
		}
		if (before?.final) return;
		const entry: MessageEntry = before ?? {
			type: "message",
			message: observation.message,
			role: observation.phase === "start" ? observation.role : "assistant",
			content: [],
			final: false,
		};
		items.set(key, { key, kind: "message", entry });
		if (observation.phase !== "update") return;
		const blocks = entry.content as Record<string, string>[];
		const block = blocks[observation.block] ?? {
			type: observation.part === "arguments" ? "toolCall" : observation.part,
			[observation.part]: "",
		};
		block[observation.part] = (block[observation.part] ?? "") + observation.delta;
		blocks[observation.block] = block;
	} else if (observation.kind === "tool") {
		const before = known?.kind === "tool" ? known.entry : undefined;
		if (before?.final && observation.phase !== "end") {
			if (observation.phase === "start") {
				items.set(key, { key, kind: "tool", entry: { ...before, args: observation.args } });
			}
			return;
		}
		const entry: ToolEntry = before
			? { ...before }
			: {
					type: "tool",
					call: observation.call,
					...(observation.parent ? { parent: observation.parent } : {}),
					name: observation.name,
					final: false,
				};
		if (observation.phase === "start") entry.args = observation.args;
		else if (observation.phase === "update") entry.partial = observation.partial;
		else {
			delete entry.partial;
			entry.result = observation.result;
			entry.error = observation.error;
			entry.final = true;
		}
		items.set(key, { key, kind: "tool", entry });
	}
}
