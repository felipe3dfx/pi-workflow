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
type MessageEntry = {
	type: "message";
	message: string;
	role: string;
	content: unknown;
	usage?: unknown;
	stopReason?: string;
	errorMessage?: string;
	segment?: SegmentCursor;
	earlier?: number;
	final: boolean;
};
type ToolEntry = {
	type: "tool";
	call: string;
	parent?: string;
	name: string;
	args?: unknown;
	partial?: unknown;
	result?: unknown;
	error?: boolean;
	argsSegment?: SegmentCursor;
	resultSegment?: SegmentCursor;
	earlier?: number;
	final: boolean;
};
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
			question?: number;
			segment?: SegmentCursor;
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
	load?:
		| { slot: string; cursor: SegmentCursor; toward: "before" | "after" }
		| { earlier: number };
};

export type Render = (
	item: Item,
	width: number,
	slot: (name: string) => Slot | undefined,
) => Block[];

type Entry = {
	key: string;
	first: number;
	last: number;
	held: Observation[];
	range?: { from: number; to?: number };
	floor?: number;
	ceiling?: number;
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

const residentItems = windowSize * 3;
const residentObservations = windowSize * 3;
const partialChars = 32 * 1024;
const pieceChars = 1024;
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
	const entries = new Map<string, Entry>();
	const gone = new Map<string, number>();
	let lo = 1;
	let tail: { cursor: WindowCursor; more: boolean } | undefined;
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
	let toward = 0;
	let overshoot = 0;
	let core = options.live !== undefined;
	const slots = new Map<string, Slot>();
	const marked = new Set<string>();
	const loading = new Set<string>();
	const cache = new Map<string, Block[]>();
	const attached = new Map<
		string,
		{ observations: Observation[]; tried: Set<number>; next?: number }
	>();

	const atStart = () => core || entries.size === 0 || lo <= 1;
	const atEnd = () => core || entries.size === 0 || !tail?.more;

	function fold(read: Opened, below?: number) {
		const tailed = read.next.from >= (read.health.written ?? Number.POSITIVE_INFINITY);
		const front = below !== undefined || following || tailed;
		const kept = (ordinal: number) => below === undefined || ordinal < below;
		const spans = new Map<string, [number, number]>();
		for (const observation of read.observations) {
			if (!kept(observation.ordinal)) continue;
			const key = keyOf(observation);
			if (key === undefined) continue;
			const { ordinal } = observation;
			const last = gone.get(key);
			if (last !== undefined && below === undefined) {
				gone.set(key, Math.max(last, ordinal));
				continue;
			}
			const known = entries.get(key);
			const span =
				spans.get(key) ?? (known ? [known.first, known.last] : [ordinal, ordinal - 1]);
			spans.set(key, span);
			if (ordinal >= span[0] && ordinal <= span[1]) continue;
			const entry = known ?? { key, first: ordinal, last: ordinal, held: [] };
			entries.set(key, entry);
			entry.first = Math.min(entry.first, ordinal);
			entry.last = Math.max(entry.last, ordinal);
			merge(entry, observation, front);
		}
		for (const range of read.unavailable) {
			if (!kept(range.from)) continue;
			const key = `gap:${range.from}`;
			entries.set(key, { key, first: range.from, last: range.to ?? range.from, held: [], range });
			for (const entry of entries.values()) {
				entry.held = entry.held.filter(
					(held) => held.ordinal < range.from || held.ordinal > (range.to ?? Number.POSITIVE_INFINITY),
				);
			}
		}
	}

	function merge(entry: Entry, delivered: Observation, front: boolean) {
		let observation = delivered;
		const kind = kindOf(observation);
		const phase = phaseOf(observation);
		if (kind !== "message" && kind !== "tool") {
			entry.held = [observation];
			return;
		}
		if (entry.held.some(isFinal)) {
			if (kind === "tool" && phase === "start") entry.held.unshift(observation);
			return;
		}
		if (isFinal(observation)) {
			const capped = entry.floor !== undefined || marked.has(entry.key);
			if (capped && anchor?.key === entry.key) pinFromEnd();
			entry.held =
				kind === "tool"
					? [...entry.held.filter((held) => phaseOf(held) === "start"), observation]
					: [observation];
			return;
		}
		const { ordinal } = observation;
		if (kind === "message") {
			if (entry.floor !== undefined && ordinal < entry.floor) return;
			if (phase === "update" && entry.ceiling !== undefined && ordinal >= entry.ceiling) {
				if (!front) return;
				entry.held = [];
				entry.floor = ordinal;
				entry.ceiling = undefined;
			}
		}
		let chars = entry.held.reduce((sum, held) => sum + deltaOf(held).length, 0);
		if (kind === "message" && !front && chars + deltaOf(observation).length > partialChars) {
			if (chars >= partialChars) {
				entry.ceiling = ordinal;
				return;
			}
			observation = clip(observation, partialChars - chars, false);
			entry.ceiling = ordinal;
		}
		if (kind === "message" && front && deltaOf(observation).length > partialChars) {
			observation = clip(observation, partialChars, true);
			entry.held = entry.held.filter((held) => held.ordinal > ordinal);
			entry.floor = ordinal;
			chars = entry.held.reduce((sum, held) => sum + deltaOf(held).length, 0);
		}
		chars += deltaOf(observation).length;
		const at = entry.held.findIndex((held) => held.ordinal > ordinal);
		const index = at < 0 ? entry.held.length : at;
		entry.held.splice(index, 0, observation);
		if (kind === "tool") {
			const latest = entry.held.findLast((held) => phaseOf(held) === "update");
			entry.held = entry.held.filter((held) => phaseOf(held) !== "update" || held === latest);
			return;
		}
		coalesce(entry.held, index);
		while (chars > partialChars && entry.held.length > 1) {
			chars -= deltaOf(entry.held.shift() as Observation).length;
			entry.floor = entry.held[0].ordinal;
		}
	}

	function ordered() {
		return [...entries.values()].sort((a, b) => a.first - b.first);
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
		overshoot = 0;
		gone.clear();
		entries.clear();
		tail = undefined;
		opened = false;
		slots.clear();
		attached.clear();
		cache.clear();
	}

	async function open() {
		const first = await fetch();
		if (options.live && identity?.parent === undefined) return;
		core = false;
		if (!first) return;
		const start = { child, generation: first.next.generation, from: 1 };
		const total = first.health.received ?? first.health.written ?? 0;
		const from = Math.max(1, total - windowSize);
		let cursor = start;
		let read: Opened | undefined = first;
		if (from > first.next.from) {
			cursor = { ...start, from };
			read = await fetch(cursor);
		}
		lo = cursor.from;
		while (read && read.observations.length === 0 && read.unavailable.length === 0 && advanced(cursor, read.next)) {
			cursor = read.next;
			read = await fetch(cursor);
		}
		if (!read) return;
		fold(read);
		tail = { cursor: read.next, more: advanced(cursor, read.next) };
	}

	async function forward() {
		if (!tail) return;
		const { cursor } = tail;
		const read = await fetch(cursor);
		if (!read) return;
		fold(read);
		tail = { cursor: read.next, more: advanced(cursor, read.next) };
	}

	async function backward() {
		if (!tail) return;
		const boundary = lo;
		let cursor: WindowCursor = {
			child,
			generation: tail.cursor.generation,
			from: Math.max(1, boundary - windowSize),
		};
		const from = cursor.from;
		const pages: Opened[] = [];
		while (cursor.from < boundary) {
			const read = await fetch(cursor);
			if (!read) return;
			pages.push(read);
			if (!advanced(cursor, read.next)) break;
			cursor = read.next;
		}
		const range = pages.at(-1);
		if (range) {
			pinFromEnd();
			fold(
				{
					...range,
					observations: pages.flatMap((page) => page.observations),
					unavailable: pages.flatMap((page) => page.unavailable),
				},
				boundary,
			);
		}
		lo = from;
		const back = [...gone.keys()].filter((key) => entries.has(key));
		const dropped = new Set(back);
		const reach = Math.max(0, ...back.map((key) => gone.get(key) as number));
		for (const key of back) gone.delete(key);
		cursor = { child, generation: cursor.generation, from: boundary };
		while (cursor.from <= reach) {
			const read = await fetch(cursor);
			if (!read) return;
			const observations = read.observations.filter((observation) => {
				const key = keyOf(observation);
				return key !== undefined && dropped.has(key);
			});
			fold({ ...read, observations, unavailable: [] }, Number.POSITIVE_INFINITY);
			if (!advanced(cursor, read.next)) break;
			cursor = read.next;
		}
	}

	function pinFromEnd() {
		if (!anchor || following) return;
		const at = locate(anchor);
		const block = blocks[at.index];
		if (block?.key !== anchor.key || block.sub !== anchor.sub) return;
		const next = blocks[at.index + 1];
		const first = blocks[at.index - 1]?.key !== block.key;
		if (marked.has(block.key) && first && next?.key === block.key) {
			const fromEnd = next.rows.length + block.rows.length - at.row;
			anchor = { key: next.key, sub: next.sub, row: 0, fromEnd };
			return;
		}
		anchor = { ...anchor, fromEnd: block.rows.length - at.row };
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

	async function attach(key: string, from: number) {
		if (!tail) return;
		const held = attached.get(key) ?? { observations: [], tried: new Set() };
		held.tried.add(from);
		attached.set(key, held);
		const read = await fetch({ child, generation: tail.cursor.generation, from });
		if (!read) return;
		const boundary = retainedFrom(key);
		held.observations.push(
			...read.observations.filter(
				(observation) => observation.ordinal <= boundary && keyOf(observation) === key,
			),
		);
		held.observations.splice(0, held.observations.length - residentObservations);
		held.next = read.next.from;
	}

	function pump() {
		if (busy || disposed) {
			wanted = undefined;
			return;
		}
		let load: (() => Promise<void>) | undefined;
		if (!opened) {
			opened = true;
			load = open;
		} else if (stale && !core && (following || atEnd())) {
			stale = false;
			load = forward;
		} else load = wanted;
		wanted = undefined;
		if (!load) return;
		busy = true;
		void load()
			.catch(() => {})
			.finally(() => {
				busy = false;
				if (disposed) return;
				options.changed();
			});
	}

	function retainedFrom(key: string) {
		return entries.get(key)?.held[0]?.ordinal ?? lo;
	}

	function evict(start: At, height: number) {
		if (!tail || entries.size <= residentItems) return;
		const extent = new Map<string, { top: number; bottom: number }>();
		let row = 0;
		for (const block of blocks) {
			const seen = extent.get(block.key) ?? { top: row, bottom: row };
			seen.bottom = row + block.rows.length;
			extent.set(block.key, seen);
			row += block.rows.length;
		}
		const at = rowsBetween({ index: 0, row: 0 }, start);
		const above = at - height;
		const below = at + 2 * height;
		const list = ordered();
		let edge = 0;
		for (const entry of list) {
			const seen = extent.get(entry.key);
			if (seen) edge = seen.bottom;
			else extent.set(entry.key, { top: edge, bottom: edge });
		}
		let head = 0;
		let foot = list.length - 1;
		const spanning: Entry[] = [];
		while (entries.size > residentItems && head < foot) {
			const top = extent.get(list[head].key) as { top: number; bottom: number };
			const bottom = extent.get(list[foot].key) as { top: number; bottom: number };
			const topFree = top.bottom <= above;
			const bottomFree = bottom.top >= below;
			if (!topFree && !bottomFree) break;
			const fromTop = topFree && (!bottomFree || above - top.bottom >= bottom.top - below);
			if (fromTop) {
				spanning.push(list[head++]);
				lo = Math.max(lo, list[head].first);
				for (const entry of spanning.splice(0)) {
					if (entry.last >= lo) spanning.push(entry);
					else {
						entries.delete(entry.key);
						const kind = kindOf(entry.held[0]);
						if ((kind === "message" || kind === "tool") && !entry.held.some(isFinal)) gone.set(entry.key, entry.last);
					}
				}
			} else {
				const hi = list[foot].first;
				while (foot > head && list[foot].first >= hi) entries.delete(list[foot--].key);
				tail = { cursor: { child, generation: tail.cursor.generation, from: hi }, more: true };
			}
		}
		for (const entry of list.slice(head + 1, foot)) {
			if (entries.size <= residentItems) return;
			const seen = extent.get(entry.key);
			if (entry.first >= lo && seen?.top === seen?.bottom && entry.held.some(isFinal)) entries.delete(entry.key);
		}
		for (const entry of list) {
			if (entries.size <= residentItems) return;
			if (entry.first < lo && entries.delete(entry.key)) gone.set(entry.key, entry.last);
		}
	}

	function items() {
		if (core) return options.live?.() ?? [];
		const merged = new Map<string, Item>();
		for (const entry of ordered()) {
			if (entry.first < lo) continue;
			if (entry.range) {
				merged.set(entry.key, { key: entry.key, kind: "unavailable", ...entry.range });
				continue;
			}
			const { key } = entry;
			const held = attached.get(key);
			const boundary = retainedFrom(key);
			const gap =
				kindOf(entry.held[0]) === "message" && held?.next !== undefined && held.next <= boundary;
			for (const early of held?.observations ?? []) {
				if (early.ordinal >= boundary) continue;
				project(merged, gap ? earlierKey(key) : key, early);
			}
			const whole = gap ? undefined : held?.observations.find((early) => early.ordinal === boundary);
			for (const observation of entry.held) {
				const clipped =
					whole !== undefined &&
					observation.ordinal === boundary &&
					deltaOf(whole).endsWith(deltaOf(observation));
				project(merged, key, clipped ? whole : observation);
			}
			const item = merged.get(key);
			if (!gap || item?.kind !== "message" || !held) continue;
			if (item.entry.final) merged.delete(earlierKey(key));
			else item.entry.earlier = held.next;
		}
		return [...merged.values()];
	}

	function place(list: Item[], width: number, style: string, render: Render) {
		const placed: Placed[] = [];
		const kept = new Set<string>();
		marked.clear();
		for (const item of list) {
			if (item.kind === "message" && item.entry.earlier !== undefined) marked.add(item.key);
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
		if (row < 0) return move({ index, row: 0 }, row);
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
			if (overshoot < 0 && !following) {
				const to = move(start, overshoot);
				overshoot += rowsBetween(to, start);
				start = to;
			}
			if (atStart()) overshoot = 0;
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
				if (block.load && "earlier" in block.load && !wanted) {
					const { key } = block;
					const { earlier } = block.load;
					if (!key.endsWith(earlierKey("")) && !attached.get(key)?.tried.has(earlier)) {
						wanted = () => attach(key, earlier);
					}
				} else if (block.load && "slot" in block.load && !wanted) {
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
			if (
				!following &&
				toward > 0 &&
				!wanted &&
				loading.size === 0 &&
				atEnd() &&
				rowsBetween(start, end) < height
			) {
				following = true;
			}
			if (opened && entries.size > 0) {
				if (!busy) evict(start, height);
				if (!wanted) {
					const below = rowsBetween(start, end) + 1 - rows.length;
					if (below < height && !atEnd()) wanted = forward;
					else if (rowsBetween({ index: 0, row: 0 }, start) < height && !atStart()) {
						wanted = backward;
					}
				}
			}
			for (const name of slots.keys()) {
				if (!shown.has(name.slice(0, name.indexOf("\n")))) slots.delete(name);
			}
			for (const key of attached.keys()) {
				if (!shown.has(key) && !shown.has(earlierKey(key))) attached.delete(key);
			}
			pump();
			return rows;
		},
		scroll(delta: number) {
			if (delta === 0 || blocks.length === 0) return;
			following = false;
			toward = Math.sign(delta);
			const from = locate(anchor);
			const to = move(from, delta);
			anchor = anchorAt(to);
			overshoot = delta < 0 ? overshoot + delta + rowsBetween(to, from) : 0;
		},
		follow() {
			following = true;
			overshoot = 0;
			stale = true;
		},
		get following() {
			return following;
		},
		get pending() {
			return busy;
		},
		changed() {
			stale = true;
		},
		invalidate() {
			cache.clear();
		},
		collapse() {
			attached.clear();
		},
		info() {
			const observations = [...entries.values()].reduce(
				(sum, entry) => sum + entry.held.length,
				0,
			);
			const retained = { items: entries.size, observations };
			return { identity, health, warning, missing, retained };
		},
		dispose() {
			disposed = true;
			epoch += 1;
			entries.clear();
			tail = undefined;
			blocks = [];
			slots.clear();
			attached.clear();
			cache.clear();
		},
	};
}

function advanced(cursor: WindowCursor, next: WindowCursor) {
	return next.from > cursor.from || (next.offset ?? 0) > (cursor.offset ?? 0);
}

function earlierKey(key: string) {
	return `${key}:earlier`;
}

function isSettled(item: Item) {
	if (item.kind === "message" || item.kind === "tool") {
		return item.entry.final && item.entry.earlier === undefined;
	}
	return true;
}

function kindOf(observation: Observation | undefined) {
	if (!observation) return undefined;
	if (observation.large) return (observation.large.meta as { kind?: string }).kind;
	return observation.kind;
}

function deltaOf(observation: Observation) {
	return observation.kind === "message" && observation.phase === "update" ? observation.delta : "";
}

function coalesce(held: Observation[], index: number) {
	const previous = held[index - 1];
	const current = held[index];
	if (
		!previous ||
		!current ||
		previous.kind !== "message" ||
		current.kind !== "message" ||
		previous.phase !== "update" ||
		current.phase !== "update" ||
		previous.block !== current.block ||
		previous.part !== current.part ||
		previous.delta.length >= pieceChars
	) {
		return;
	}
	held.splice(index - 1, 2, { ...previous, delta: previous.delta + current.delta });
}

function clip(observation: Observation, keep: number, fromEnd: boolean): Observation {
	if (observation.kind !== "message" || observation.phase !== "update") return observation;
	const { delta } = observation;
	let at = fromEnd ? delta.length - keep : keep;
	const code = delta.charCodeAt(at);
	if (code >= 0xdc00 && code <= 0xdfff) at += fromEnd ? 1 : -1;
	return { ...observation, delta: fromEnd ? delta.slice(at) : delta.slice(0, at) };
}

function isFinal(observation: Observation) {
	return phaseOf(observation) === "end" && !observation.large?.partial;
}

function phaseOf(observation: Observation) {
	if (observation.large) return (observation.large.meta as { phase?: string }).phase;
	return "phase" in observation ? observation.phase : undefined;
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
		if (meta.kind === "input") return `input:${observation.ordinal}`;
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
			start?: number;
			source?: string;
			delivery?: string;
			question?: number;
		};
		const { segment, partial } = observation.large;
		if (meta.kind === "input") {
			items.set(key, {
				key,
				kind: "input",
				source: meta.source ?? "user",
				delivery: meta.delivery ?? "delivered",
				text: "",
				...(meta.question === undefined ? {} : { question: meta.question }),
				segment,
			});
			return;
		}
		if (partial) {
			if (known?.kind === "message" && !known.entry.final) {
				items.set(key, { key, kind: "message", entry: { ...known.entry, segment } });
				return;
			}
			if (known?.kind === "tool" && !known.entry.final) {
				const slot = meta.phase === "start" ? "argsSegment" : "resultSegment";
				items.set(key, { key, kind: "tool", entry: { ...known.entry, [slot]: segment } });
				return;
			}
			if (known) return;
		}
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
					final: !partial,
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
					...(meta.phase === "start" || meta.start === undefined
						? {}
						: { earlier: meta.start }),
					final: false,
				};
		if (meta.phase === "start") entry.argsSegment = segment;
		else {
			delete entry.partial;
			entry.resultSegment = segment;
			if (meta.error !== undefined) entry.error = meta.error;
			entry.final = !partial;
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
			...(observation.question === undefined
				? {}
				: { question: observation.question }),
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
			...(observation.phase === "update" && observation.start !== undefined
				? { earlier: observation.start }
				: {}),
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
					...(observation.phase === "start" || observation.start === undefined
						? {}
						: { earlier: observation.start }),
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
