import { mkdir, open, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { askParentTool } from "./child-sessions.ts";
import { errorMessage } from "./error-message.ts";

export interface AuditIdentity {
	parent?: string;
	child: string;
	sdkSession?: string;
	role: string;
	task: string;
	references: string[];
	instructions: string;
	tools: string[];
	model: string;
	thinking: string;
	worktree: string;
	createdAt: number;
	group?: string;
	continuedFrom?: string;
}

type Evidence =
	| {
			kind: "input";
			source: "user" | "steer" | "follow-up" | "answer";
			delivery: "queued" | "delivered";
			text: string;
			question?: number;
			error?: true;
	  }
	| { kind: "loadout"; thinking: string }
	| { kind: "execution"; state: string; verdict?: string }
	| { kind: "report"; result: unknown }
	| ({ kind: "message"; event: string; message: string } & (
			| { phase: "start"; role: string }
			| {
					phase: "update";
					block: number;
					part: "text" | "thinking" | "arguments";
					delta: string;
			  }
			| {
					phase: "end";
					role: string;
					content: unknown;
					usage?: unknown;
					stopReason?: string;
					errorMessage?: string;
			  }
	  ))
	| ({
			kind: "tool";
			event: string;
			call: string;
			parent?: string;
			name: string;
	  } & (
			| { phase: "start"; args: unknown }
			| { phase: "update"; partial: unknown }
			| { phase: "end"; result: unknown; error: boolean }
	  ));

type Large = {
	bytes?: number;
	segment: SegmentCursor;
	meta: Record<string, unknown>;
};

type Observation =
	| (Evidence & {
			ordinal: number;
			written: boolean;
			large?: undefined;
			unsupported?: undefined;
	  })
	| {
			ordinal: number;
			written: true;
			large: Large;
			kind?: undefined;
			unsupported?: undefined;
	  }
	| {
			ordinal: number;
			written: true;
			unsupported: true;
			kind?: undefined;
			large?: undefined;
	  };

export interface WindowCursor {
	child?: string;
	generation?: number;
	from: number;
	offset?: number;
}

export interface SegmentCursor {
	child: string;
	generation: number;
	ordinal: number;
	offset: number;
}

type Extent = [number, number] | [number, number, 0];

type Range = { from: number; to?: number };

type Header = {
	v: unknown;
	ordinal: number;
	part: number;
	parts?: number;
	field?: string;
	meta?: Record<string, unknown>;
	loss?: unknown;
	close?: unknown;
};

type Line =
	| { header: Header; payload: string }
	| { unsupported: number | undefined };

type Pending = { ordinal: number; value: unknown; bytes: number };

interface AuditFile {
	write(
		buffer: Uint8Array,
		offset: number,
		length: number,
	): Promise<{ bytesWritten: number }>;
	read(
		buffer: Uint8Array,
		offset: number,
		length: number,
		position: number,
	): Promise<{ bytesRead: number }>;
	close(): Promise<void>;
}

interface AuditFiles {
	mkdir(
		path: string,
		options: { recursive: true; mode: number },
	): Promise<unknown>;
	open(path: string, flags: string, mode?: number): Promise<AuditFile>;
	rename(from: string, to: string): Promise<void>;
	readdir(path: string): Promise<string[]>;
	stat(path: string): Promise<{ size: number }>;
}

type Page = { n: number; entries: (Extent | null)[]; dirty: boolean };

interface Capture {
	identity: AuditIdentity;
	path?: string;
	created: boolean;
	pending: Pending[];
	size: number;
	written: number;
	committed: number;
	end: number;
	generation: number;
	page: Page;
	index?: string;
	repaired: boolean;
	tail?: number;
	admitted: number;
	held: { bytes: number; entries: number };
	queued: { steer: string[]; "follow-up": string[] };
	next: number;
	seen: Set<string>;
	updates: Map<string, number>;
	state?: string;
	verdict?: string;
	messages: { count: number; open?: string; ids: WeakMap<object, string> };
	draining: boolean;
	work: Promise<void>;
	slot: boolean;
	closed: boolean;
	fenced: boolean;
	durable?: Health;
	cause?: string;
	lost: number;
	lostFrom?: number;
	uncertain?: number;
	marker?: "written" | "failed";
}

export const windowSize = 128;

const defaultLimits = {
	bytes: 4 * 1024 * 1024,
	entries: 256,
	window: windowSize,
	windowBytes: 256 * 1024,
	chunk: 64 * 1024,
	cacheBytes: 16 * 1024 * 1024,
	cacheEntries: 512,
	catalog: 32,
	drain: 1000,
};

const version = 1;
// A line adds a checksum, a header of at most this size and separators to its chunk; the loss marker is written outside the payload budget.
const headerAllowance = 512;
const metaAllowance = 256;
const fieldAllowance = 128;
const markerAllowance = 1024;

class Uncertain extends Error {}

class Refused extends Error {}

class Fenced extends Error {}

const foreign = "The journal does not belong to this record.";
const damaged = "Some recorded evidence failed verification and is unavailable.";
const unindexed =
	"The audit index is missing or damaged; this window was verified directly from the record.";
const unsupportedEvidence =
	"Some recorded evidence uses an unsupported format and is not interpreted.";

type Window = {
	observations: Observation[];
	unavailable: Range[];
	issues: Set<string>;
	from: number;
	offset?: number;
};

const unrecoverable =
	"Durable recovery of this child's history is not guaranteed.";
const unclosed =
	"The record was not closed; evidence after its last verified line may be missing.";
const closedIncomplete = "The capture was incomplete when the record closed.";
const unverified = "The record's identity could not be verified.";
const expired = "The audit drain expired before the record closed.";

type Health = {
	complete: boolean;
	closed?: boolean;
	received?: number;
	admitted?: number;
	written?: number;
	lost?: number;
	lostFrom?: number;
	uncertain?: number;
	marker?: "written" | "failed";
	warning?: string;
};

export function createChildAudit(options: {
	root: string;
	parent: () => string | undefined;
	limits?: Partial<typeof defaultLimits>;
	files?: AuditFiles;
	schedule?: (task: () => void) => void;
	timer?: (task: () => void, ms: number) => () => void;
}) {
	const limits = { ...defaultLimits, ...options.limits };
	const files: AuditFiles = options.files ?? {
		mkdir,
		open,
		rename,
		readdir,
		stat,
	};
	const schedule = options.schedule ?? setImmediate;
	const timer =
		options.timer ??
		((task: () => void, ms: number) => {
			const timeout = setTimeout(task, ms);
			return () => clearTimeout(timeout);
		});
	const maxLine = limits.chunk + headerAllowance;
	const size = limits.window;
	const cache = new Map<string, { entries: (Extent | null)[]; bytes: number }>();
	let cached = 0;
	const slice = Math.max(2, Math.floor((limits.chunk - 2) / 6));
	const records = new Map<string, Capture>();
	const recovered = new Map<string, Capture>();
	// Each live record keeps a minimum share no sibling may borrow, and a borrower also leaves one share free so a child that starts later can still admit its identity.
	const share = {
		bytes: Math.floor(limits.bytes / 16),
		entries: Math.max(1, Math.floor(limits.entries / 16)),
	};
	const live = new Set<Capture>();
	let admittedBytes = 0;
	let admittedEntries = 0;

	function lose(record: Capture, ordinal: number) {
		record.lost += 1;
		record.lostFrom = Math.min(record.lostFrom ?? ordinal, ordinal);
	}

	function fail(record: Capture, cause: string) {
		if (record.cause) return;
		record.cause = cause;
		live.delete(record);
		if (record.draining || !record.path) return;
		record.draining = true;
		record.work = mark(record).finally(() => {
			record.draining = false;
		});
	}

	function start(record: Capture) {
		record.draining = true;
		record.slot = true;
		admittedBytes += maxLine;
		record.held.bytes += maxLine;
		record.work = new Promise((resolve) =>
			schedule(() => void drain(record).finally(resolve)),
		);
	}

	function release(record: Capture, item: Pending) {
		admittedBytes -= item.bytes;
		admittedEntries -= 1;
		record.held.bytes -= item.bytes;
		record.held.entries -= 1;
	}

	function fits(record: Capture, bytes: number) {
		let spareBytes = 0;
		let spareEntries = 0;
		for (const other of live) {
			if (other === record) continue;
			spareBytes += Math.max(0, share.bytes - other.held.bytes);
			spareEntries += Math.max(0, share.entries - other.held.entries);
		}
		if (record.held.bytes + bytes > share.bytes) spareBytes += share.bytes;
		if (record.held.entries + 1 > share.entries) spareEntries += share.entries;
		return (
			admittedBytes + bytes + spareBytes <= limits.bytes &&
			admittedEntries + 1 + spareEntries <= limits.entries
		);
	}

	function admit(record: Capture, evidence?: Evidence) {
		if (record.closed) return false;
		const ordinal = record.next++;
		if (record.cause) {
			lose(record, ordinal);
			return false;
		}
		const whole = limits.bytes - maxLine - share.bytes;
		let taken: { value: unknown; bytes: number };
		try {
			taken = snapshot(
				evidence ? { ordinal, ...evidence } : record.identity,
				whole,
			);
		} catch (error) {
			lose(record, ordinal);
			fail(record, `Audit capture failed: ${errorMessage(error)}.`);
			return false;
		}
		if (taken.bytes > whole) {
			lose(record, ordinal);
			fail(
				record,
				`An observation exceeds the whole audit capture budget of ${limits.bytes} bytes.`,
			);
			return false;
		}
		if (!fits(record, taken.bytes + (record.draining ? 0 : maxLine))) {
			lose(record, ordinal);
			fail(record, "The audit capture budget is exhausted.");
			return false;
		}
		admittedBytes += taken.bytes;
		admittedEntries += 1;
		record.held.bytes += taken.bytes;
		record.held.entries += 1;
		record.admitted += 1;
		record.pending.push({ ordinal, ...taken });
		if (!record.draining) start(record);
		return true;
	}

	async function drain(record: Capture) {
		let file: AuditFile | undefined;
		try {
			while (record.pending.length > 0) {
				const item = record.pending[0];
				if (!file) {
					await files.mkdir(join(record.path as string, ".."), {
						recursive: true,
						mode: 0o700,
					});
					file = await files.open(
						record.path as string,
						record.created ? "a" : "wx",
						0o600,
					);
					record.created = true;
				}
				const start = record.size;
				await store(record, file, item);
				if (record.fenced) return;
				record.pending.shift();
				release(record, item);
				await commit(record, item.ordinal, start);
				if (record.fenced) return;
			}
		} catch (error) {
			if (record.fenced) return;
			const item = record.pending.shift() as Pending;
			release(record, item);
			if (error instanceof Uncertain) record.uncertain = item.ordinal;
			else lose(record, item.ordinal);
			fail(
				record,
				(error as { code?: unknown }).code === "EEXIST"
					? "Another capture already owns this audit record."
					: `Audit capture failed: ${errorMessage(error)}.`,
			);
		} finally {
			void file?.close().catch(() => {});
		}
		if (record.fenced) return;
		for (const item of record.pending) {
			release(record, item);
			lose(record, item.ordinal);
		}
		record.pending = [];
		if (record.cause && !record.marker) await mark(record);
		admittedBytes -= maxLine;
		record.held.bytes -= maxLine;
		record.slot = false;
		record.draining = false;
	}

	async function store(record: Capture, file: AuditFile, item: Pending) {
		let texts: string[] = [];
		let size = 0;
		let part = 0;
		let field: string | undefined;
		const append = async (final: boolean) => {
			const header = {
				v: version,
				ordinal: item.ordinal,
				part,
				...(final ? { parts: part + 1 } : {}),
				...(field === undefined ? {} : { field }),
				...(part === 0 && !final ? { meta: meta(item.value) } : {}),
			};
			await new Promise<void>((resolve) => schedule(resolve));
			if (record.fenced) throw new Fenced();
			await writeAll(file, Buffer.from(line(header, texts.join(""))), (n) => {
				record.size += n;
			});
			part += 1;
		};
		// A large string's interior gets parts of its own, so each can be decoded as text without the rest of the event.
		for (const piece of encode(item.value, slice)) {
			const bytes = Buffer.byteLength(piece.text);
			if (
				texts.length > 0 &&
				(size + bytes > limits.chunk || piece.field !== field)
			) {
				await append(false);
				texts = [];
				size = 0;
			}
			if (texts.length === 0) field = piece.field;
			texts.push(piece.text);
			size += bytes;
		}
		await append(true);
	}

	async function writeAll(
		file: AuditFile,
		buffer: Buffer,
		progress: (written: number) => void = () => {},
	) {
		let offset = 0;
		while (offset < buffer.length) {
			let written: number;
			try {
				({ bytesWritten: written } = await file.write(
					buffer,
					offset,
					buffer.length - offset,
				));
			} catch (error) {
				throw new Uncertain(errorMessage(error), { cause: error });
			}
			if (written === 0) throw new Error("the storage accepted no bytes");
			offset += written;
			progress(written);
		}
	}

	async function commit(record: Capture, ordinal: number, start: number) {
		record.written += 1;
		record.committed = ordinal + 1;
		record.end = record.size;
		const n = Math.floor(ordinal / size);
		const previous = record.page;
		if (previous.n !== n) record.page = { n, entries: [], dirty: false };
		record.page.entries[ordinal - n * size] = [start, record.end];
		record.page.dirty = true;
		if (previous !== record.page && previous.dirty) {
			await flushIndex(record, previous);
		}
		if (ordinal - n * size === size - 1 || record.pending.length === 0) {
			await flushIndex(record, record.page);
		}
	}

	async function flushIndex(record: Capture, page: Page) {
		page.dirty = false;
		if (record.index || record.repaired || record.fenced) return;
		const path = record.path as string;
		try {
			await files.mkdir(indexOf(path), { recursive: true, mode: 0o700 });
			await replace(pageOf(path, record.generation, page.n), {
				...binding(record),
				page: page.n,
				entries: page.entries,
			});
			await replace(join(indexOf(path), "head.json"), {
				...binding(record),
				committed: record.committed,
				extent: record.end,
			});
		} catch (error) {
			record.index = `The audit index could not be written: ${errorMessage(error)}.`;
		}
	}

	function binding(record: Capture) {
		return {
			v: version,
			parent: record.identity.parent,
			child: record.identity.child,
			generation: record.generation,
		};
	}

	async function replace(path: string, value: unknown) {
		const temporary = `${path}.tmp`;
		const file = await files.open(temporary, "w", 0o600);
		try {
			await writeAll(file, Buffer.from(JSON.stringify(value)));
		} finally {
			await file.close();
		}
		await files.rename(temporary, path);
	}

	async function mark(record: Capture) {
		if (!record.created) {
			record.marker = "failed";
			return;
		}
		if (record.fenced) return;
		const loss = {
			loss: {
				...(record.lostFrom === undefined ? {} : { from: record.lostFrom }),
				...(record.uncertain === undefined
					? {}
					: { uncertain: record.uncertain }),
				cause: (record.cause as string).slice(0, markerAllowance / 2),
			},
		};
		record.marker = (await appendMarker(record, loss)) ? "written" : "failed";
	}

	async function appendMarker(record: Capture, marker: object) {
		let file: AuditFile | undefined;
		try {
			file = await files.open(record.path as string, "a");
			await writeAll(
				file,
				Buffer.from(`\n${line({ v: version, ...marker }, "")}`),
				(n) => {
					record.size += n;
				},
			);
			return true;
		} catch {
			return false;
		} finally {
			await file?.close().catch(() => {});
		}
	}

	async function seal(record: Capture) {
		if (!record.path || !record.created || record.fenced) return;
		await appendMarker(record, {
			close: {
				committed: record.committed,
				written: record.written,
				complete: !record.cause && record.written === record.admitted,
				...(record.state === undefined ? {} : { state: record.state }),
				...(record.verdict === undefined ? {} : { verdict: record.verdict }),
			},
		});
	}

	function abandon(record: Capture) {
		record.fenced = true;
		for (const item of record.pending) {
			release(record, item);
			lose(record, item.ordinal);
		}
		record.pending = [];
		if (record.slot) {
			admittedBytes -= maxLine;
			record.held.bytes -= maxLine;
			record.slot = false;
		}
		record.cause ??= expired;
	}

	async function close() {
		const closing = [...records.values()];
		records.clear();
		for (const record of closing) {
			record.closed = true;
			live.delete(record);
		}
		let late = false;
		let cancel = () => {};
		const deadline = new Promise<void>((resolve) => {
			cancel = timer(() => {
				late = true;
				resolve();
			}, limits.drain);
		});
		const sealed = new Set<Capture>();
		await Promise.race([
			Promise.all(
				closing.map(async (record) => {
					while (record.draining && !late) await record.work;
					if (late) return;
					await seal(record);
					if (!late) sealed.add(record);
				}),
			),
			deadline,
		]);
		cancel();
		for (const record of closing) {
			if (!sealed.has(record)) abandon(record);
			record.seen.clear();
			record.updates.clear();
			record.queued = { steer: [], "follow-up": [] };
		}
		return { closed: sealed.size, expired: closing.length - sealed.size };
	}

	function enqueued(
		record: Capture,
		source: "steer" | "follow-up",
		texts: readonly string[],
	) {
		const awaiting = [...record.queued[source]];
		for (const text of texts) {
			const index = awaiting.indexOf(text);
			if (index >= 0) {
				awaiting.splice(index, 1);
				continue;
			}
			record.queued[source].push(text);
			admit(record, { kind: "input", source, delivery: "queued", text });
		}
	}

	function delivered(record: Capture, text: string) {
		for (const source of ["steer", "follow-up"] as const) {
			const index = record.queued[source].indexOf(text);
			if (index < 0) continue;
			record.queued[source].splice(index, 1);
			admit(record, { kind: "input", source, delivery: "delivered", text });
			return;
		}
		admit(record, { kind: "input", source: "user", delivery: "delivered", text });
	}

	function tool(record: Capture, event: ToolEvent) {
		const identity = `tool:${event.toolCallId}`;
		const fields = {
			kind: "tool" as const,
			call: event.toolCallId,
			...(event.parentToolCallId ? { parent: event.parentToolCallId } : {}),
			name: event.toolName,
		};
		if (event.type === "tool_execution_update") {
			const update = (record.updates.get(identity) ?? 0) + 1;
			record.updates.set(identity, update);
			admit(record, {
				...fields,
				event: `${identity}:update:${update}`,
				phase: "update",
				partial: event.partialResult,
			});
			return;
		}
		const phase = event.type === "tool_execution_start" ? "start" : "end";
		const id = `${identity}:${phase}`;
		if (record.seen.has(id)) return;
		record.seen.add(id);
		if (event.type === "tool_execution_start") {
			admit(record, { ...fields, event: id, phase: "start", args: event.args });
		} else {
			admit(record, {
				...fields,
				event: id,
				phase: "end",
				result: event.result,
				error: event.isError,
			});
		}
	}

	function message(record: Capture, event: MessageEvent) {
		const messages = record.messages;
		const source = event.message as object;
		let id = messages.ids.get(source);
		if (event.type === "message_start") {
			if (id) return;
			id = `m${++messages.count}`;
			messages.ids.set(source, id);
			messages.open = id;
			admit(record, {
				kind: "message",
				event: `${id}:start`,
				message: id,
				phase: "start",
				role: event.message.role,
			});
			return;
		}
		if (!id) {
			id = messages.open ?? `m${++messages.count}`;
			messages.ids.set(source, id);
			messages.open = id;
		}
		if (event.type === "message_update") {
			const update = event.assistantMessageEvent;
			const part = deltaParts[update.type];
			if (!part || !("delta" in update)) return;
			const count = (record.updates.get(id) ?? 0) + 1;
			record.updates.set(id, count);
			admit(record, {
				kind: "message",
				event: `${id}:update:${count}`,
				message: id,
				phase: "update",
				block: update.contentIndex,
				part,
				delta: update.delta,
			});
			return;
		}
		const end = `${id}:end`;
		if (record.seen.has(end)) return;
		record.seen.add(end);
		if (messages.open === id) messages.open = undefined;
		const final = event.message as {
			role: string;
			content: unknown;
			usage?: unknown;
			stopReason?: string;
			errorMessage?: string;
		};
		admit(record, {
			kind: "message",
			event: end,
			message: id,
			phase: "end",
			role: final.role,
			content: final.content,
			...(final.usage === undefined ? {} : { usage: final.usage }),
			...(final.stopReason === undefined
				? {}
				: { stopReason: final.stopReason }),
			...(final.errorMessage === undefined
				? {}
				: { errorMessage: final.errorMessage }),
		});
	}

	function event(record: Capture, event: AgentSessionEvent) {
		if (event.type === "queue_update") {
			enqueued(record, "steer", event.steering);
			enqueued(record, "follow-up", event.followUp);
		} else if (event.type === "message_start" && event.message.role === "user") {
			delivered(record, contentText(event.message.content));
		} else if (
			event.type === "tool_execution_end" &&
			event.toolName === askParentTool
		) {
			admit(record, {
				kind: "input",
				source: "answer",
				delivery: "delivered",
				text: contentText(
					(event.result as { content?: Content } | undefined)?.content ?? [],
				),
				...(event.isError ? { error: true as const } : {}),
			});
		} else if (event.type === "thinking_level_changed") {
			admit(record, { kind: "loadout", thinking: event.level });
		}
		if (
			(event.type === "message_start" ||
				event.type === "message_update" ||
				event.type === "message_end") &&
			event.message.role !== "user" &&
			event.message.role !== "toolResult"
		) {
			message(record, event);
		} else if (
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_update" ||
			event.type === "tool_execution_end"
		) {
			tool(record, event);
		}
	}

	function blank(identity: AuditIdentity): Capture {
		return {
			identity,
			created: false,
			pending: [],
			size: 0,
			written: 0,
			committed: 0,
			end: 0,
			generation: 0,
			page: { n: -1, entries: [], dirty: false },
			repaired: false,
			admitted: 0,
			held: { bytes: 0, entries: 0 },
			queued: { steer: [], "follow-up": [] },
			next: 0,
			seen: new Set(),
			updates: new Map(),
			messages: { count: 0, ids: new WeakMap() },
			draining: false,
			work: Promise.resolve(),
			slot: false,
			closed: false,
			fenced: false,
			lost: 0,
		};
	}

	function begin(identity: Omit<AuditIdentity, "parent">) {
		const record = blank(
			snapshot(identity, Number.POSITIVE_INFINITY).value as AuditIdentity,
		);
		records.set(identity.child, record);
		const guarded =
			<A extends unknown[]>(observe: (...args: A) => unknown) =>
			(...args: A) => {
				try {
					observe(...args);
				} catch (error) {
					fail(record, `Audit capture failed: ${errorMessage(error)}.`);
				}
			};
		const capture = {
			event: guarded((value: AgentSessionEvent) => event(record, value)),
			reported: guarded((result: unknown) =>
				admit(record, { kind: "report", result }),
			),
			answered: guarded((question: number, text: string) =>
				admit(record, {
					kind: "input",
					source: "answer",
					delivery: "queued",
					question,
					text,
				}),
			),
		};
		try {
			const parent = options.parent();
			if (!parent) throw new Error("the parent session has no identity");
			record.identity = { ...record.identity, parent };
			record.path = join(options.root, parent, `${identity.child}.jsonl`);
		} catch (error) {
			record.cause = `No parent session identity: ${errorMessage(error)}.`;
			admit(record);
			return capture;
		}
		live.add(record);
		admit(record);
		return capture;
	}

	async function readAt(path: string, position: number, length: number) {
		const buffer = Buffer.alloc(Math.max(0, length));
		const file = await files.open(path, "r");
		let offset = 0;
		try {
			while (offset < buffer.length) {
				const { bytesRead } = await file.read(
					buffer,
					offset,
					buffer.length - offset,
					position + offset,
				);
				if (bytesRead === 0) break;
				offset += bytesRead;
			}
		} finally {
			await file.close();
		}
		return buffer.subarray(0, offset);
	}

	async function pageEntries(record: Capture, n: number) {
		if (record.page.n === n) return record.page.entries;
		const key = pageOf(record.path as string, record.generation, n);
		const hit = cache.get(key);
		if (hit) {
			cache.delete(key);
			cache.set(key, hit);
			return hit.entries;
		}
		const bound = headerAllowance + 48 * size;
		let page: { entries?: unknown } & Record<string, unknown>;
		let buffer: Buffer;
		try {
			buffer = await readAt(key, 0, bound);
			if (buffer.length >= bound) return undefined;
			page = JSON.parse(buffer.toString("utf8"));
		} catch {
			return undefined;
		}
		const expected: Record<string, unknown> = { ...binding(record), page: n };
		const entries = page?.entries;
		if (
			Object.entries(expected).some(([key, value]) => page[key] !== value) ||
			!Array.isArray(entries) ||
			entries.length > size ||
			!entries.every(
				(entry) =>
					entry === null ||
					(Array.isArray(entry) &&
						(entry.length === 2 || (entry.length === 3 && entry[2] === 0)) &&
						Number.isSafeInteger(entry[0]) &&
						Number.isSafeInteger(entry[1]) &&
						0 <= entry[0] &&
						entry[0] < entry[1] &&
						entry[1] <= record.end),
			)
		) {
			return undefined;
		}
		cache.set(key, { entries, bytes: buffer.length });
		cached += buffer.length;
		for (const [old, value] of cache) {
			if (cache.size <= limits.cacheEntries && cached <= limits.cacheBytes) {
				break;
			}
			cache.delete(old);
			cached -= value.bytes;
		}
		return entries as (Extent | null)[];
	}

	async function extentOf(record: Capture, ordinal: number) {
		const n = Math.floor(ordinal / size);
		const entries = await pageEntries(record, n);
		if (!entries) return undefined;
		return entries[ordinal - n * size] ?? null;
	}

	function placeholder(
		record: Capture,
		ordinal: number,
		offset: number,
		header: Header | undefined,
		bytes?: number,
	): Observation {
		return {
			ordinal,
			written: true,
			large: {
				...(bytes === undefined ? {} : { bytes }),
				meta: header?.meta ?? {},
				segment: {
					child: record.identity.child,
					generation: record.generation,
					ordinal,
					offset,
				},
			},
		};
	}

	function assemble(
		buffer: Buffer,
		ordinal: number,
	): Observation | undefined {
		const texts: string[] = [];
		let start = 0;
		for (let part = 0; ; part++) {
			const end = buffer.indexOf(10, start);
			if (end < 0) return undefined;
			const parsed = parse(buffer.toString("utf8", start, end));
			if (
				!parsed ||
				!("header" in parsed) ||
				parsed.header.ordinal !== ordinal ||
				parsed.header.part !== part
			) {
				return undefined;
			}
			texts.push(parsed.payload);
			start = end + 1;
			if (parsed.header.parts === undefined) continue;
			if (start !== buffer.length) return undefined;
			try {
				return { ...JSON.parse(texts.join("")), ordinal, written: true };
			} catch {
				return undefined;
			}
		}
	}

	async function indexed(record: Capture, from: number, offset?: number) {
		const window: Window = {
			observations: [],
			unavailable: [],
			issues: new Set(),
			from,
			offset,
		};
		const spans: { ordinal: number; start: number; end: number }[] = [];
		let bytes = 0;
		const resolve = async () => {
			if (spans.length === 0) return;
			const first = spans[0].start;
			const buffer = await readAt(
				record.path as string,
				first,
				(spans.at(-1) as { end: number }).end - first,
			);
			for (const span of spans) {
				const observation = assemble(
					buffer.subarray(span.start - first, span.end - first),
					span.ordinal,
				);
				if (observation) window.observations.push(observation);
				else {
					gap(window.unavailable, span.ordinal, span.ordinal);
					window.issues.add(damaged);
				}
			}
			spans.length = 0;
		};
		while (
			window.from < record.committed &&
			window.observations.length + spans.length < size
		) {
			const ordinal = window.from;
			const extent = await extentOf(record, ordinal);
			if (extent === undefined) {
				await resolve();
				if (record.index) window.issues.add(record.index);
				window.issues.add(unindexed);
				if (window.observations.length > 0 || window.unavailable.length > 0) {
					return window;
				}
				return scan(record, window);
			}
			if (extent === null) {
				gap(window.unavailable, ordinal, ordinal);
				window.from += 1;
				continue;
			}
			const [start, end] = extent;
			const large = extent[2] === 0 || end - start > limits.windowBytes;
			const cost = large ? maxLine : end - start;
			if (bytes + cost > limits.windowBytes && bytes > 0) break;
			bytes += cost;
			if (spans.length > 0 && (large || spans.at(-1)?.end !== start)) {
				await resolve();
			}
			if (extent[2] === 0) {
				window.observations.push({ ordinal, written: true, unsupported: true });
				window.issues.add(unsupportedEvidence);
			} else if (large) {
				const first = await readAt(record.path as string, start, maxLine);
				const newline = first.indexOf(10);
				const parsed =
					newline < 0 ? undefined : parse(first.toString("utf8", 0, newline));
				if (parsed && "header" in parsed && parsed.header.ordinal === ordinal) {
					window.observations.push(
						placeholder(record, ordinal, start, parsed.header, end - start),
					);
				} else {
					gap(window.unavailable, ordinal, ordinal);
					window.issues.add(damaged);
				}
			} else spans.push({ ordinal, start, end });
			window.from += 1;
			window.offset = end;
		}
		await resolve();
		if (
			record.durable &&
			!record.repaired &&
			bytes === 0 &&
			window.from >= record.committed &&
			(window.offset ?? record.end) < record.size
		) {
			if (record.index) window.issues.add(record.index);
			window.offset ??= record.end;
			return scan(record, window);
		}
		if (record.tail !== undefined && window.from >= record.committed) {
			window.unavailable.push({ from: record.tail });
		}
		return window;
	}

	async function scan(record: Capture, window: Window) {
		const start = window.offset ?? 0;
		const buffer = await readAt(
			record.path as string,
			start,
			Math.min(limits.windowBytes, record.size - start),
		);
		let current:
			| { ordinal: number; part: number; start: number; header: Header; texts: string[] }
			| undefined;
		let consumed = 0;
		let last: number | undefined;
		for (let at = 0; window.observations.length < size; ) {
			const end = buffer.indexOf(10, at);
			if (end < 0) break;
			const parsed = end === at ? "blank" : parse(buffer.toString("utf8", at, end));
			const offset = start + at;
			at = end + 1;
			consumed = at;
			if (
				parsed === "blank" ||
				(parsed &&
					"header" in parsed &&
					(parsed.header.loss || parsed.header.close))
			) {
				continue;
			}
			if (!parsed) {
				window.issues.add(damaged);
				current = undefined;
				continue;
			}
			if ("unsupported" in parsed) {
				current = undefined;
				window.issues.add(unsupportedEvidence);
				if (parsed.unsupported !== undefined && parsed.unsupported >= window.from) {
					window.observations.push({
						ordinal: parsed.unsupported,
						written: true,
						unsupported: true,
					});
					last = parsed.unsupported;
				}
				continue;
			}
			const { header, payload } = parsed;
			if (header.part === 0) {
				current = { ordinal: header.ordinal, part: 0, start: offset, header, texts: [] };
			} else if (current?.ordinal !== header.ordinal || current.part !== header.part) {
				if (current) window.issues.add(damaged);
				current = undefined;
				continue;
			}
			current.texts.push(payload);
			current.part += 1;
			if (header.parts === undefined) continue;
			const { ordinal, texts } = current;
			current = undefined;
			if (ordinal < window.from) continue;
			if (last !== undefined && ordinal > last + 1) {
				gap(window.unavailable, last + 1, ordinal - 1);
			}
			last = ordinal;
			try {
				window.observations.push({
					...JSON.parse(texts.join("")),
					ordinal,
					written: true,
				});
			} catch {
				gap(window.unavailable, ordinal, ordinal);
				window.issues.add(damaged);
			}
		}
		if (current && current.ordinal >= window.from) {
			if (current.start === start) {
				window.observations.push(
					placeholder(record, current.ordinal, current.start, current.header),
				);
			} else consumed = current.start - start;
		}
		window.offset = start + consumed;
		if (last !== undefined) window.from = last + 1;
		return window;
	}

	function currentParent() {
		try {
			return options.parent();
		} catch {
			return undefined;
		}
	}

	async function lookup(child: string) {
		const parent = currentParent();
		const record = records.get(child);
		if (record && record.identity.parent === parent) return record;
		if (!parent || !/^[\w-]+$/.test(child)) return undefined;
		const path = join(options.root, parent, `${child}.jsonl`);
		const hit = recovered.get(path);
		if (hit) {
			recovered.delete(path);
			recovered.set(path, hit);
			return hit;
		}
		const opened = await reopen(parent, child, path);
		if (!opened) return undefined;
		recovered.set(path, opened);
		for (const old of recovered.keys()) {
			if (recovered.size <= limits.catalog) break;
			recovered.delete(old);
		}
		return opened;
	}

	async function reopen(parent: string, child: string, path: string) {
		let size: number;
		try {
			size = (await files.stat(path)).size;
		} catch {
			return undefined;
		}
		const owner = await identityOf(path, parent, child);
		const head = await headOf(path, parent, child, size);
		const facts = await tailOf(path, size);
		const record = blank(owner ?? ({ parent, child } as AuditIdentity));
		record.path = path;
		record.created = true;
		record.closed = true;
		record.size = size;
		record.written = owner ? 1 : 0;
		if (head) {
			record.generation = head.generation;
			record.committed = head.committed;
			record.end = head.extent;
		} else record.index = unindexed;
		record.state = facts.state;
		record.verdict = facts.verdict;
		const warnings = [
			...(facts.cause ? [facts.cause] : []),
			...(facts.closed ? [] : [unclosed]),
			...(facts.closed && !facts.complete && !facts.loss ? [closedIncomplete] : []),
			...(owner ? [] : [unverified]),
		];
		record.durable = {
			complete: facts.complete && !!owner,
			closed: facts.closed,
			...(facts.written === undefined ? {} : { written: facts.written }),
			...(facts.lostFrom === undefined ? {} : { lostFrom: facts.lostFrom }),
			...(facts.uncertain === undefined ? {} : { uncertain: facts.uncertain }),
			...(facts.loss ? { marker: "written" as const } : {}),
			...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
		};
		return record;
	}

	async function identityOf(path: string, parent: string, child: string) {
		const texts: string[] = [];
		let bytes = 0;
		let part = 0;
		let position = 0;
		let carry = Buffer.alloc(0);
		for (;;) {
			const chunk = await readAt(path, position, limits.windowBytes);
			if (chunk.length === 0) return undefined;
			position += chunk.length;
			const buffer = Buffer.concat([carry, chunk]);
			let at = 0;
			for (let end = buffer.indexOf(10); end >= 0; end = buffer.indexOf(10, at)) {
				const parsed = parse(buffer.toString("utf8", at, end));
				at = end + 1;
				if (
					!parsed ||
					!("header" in parsed) ||
					parsed.header.ordinal !== 0 ||
					parsed.header.part !== part
				) {
					return undefined;
				}
				bytes += parsed.payload.length;
				if (bytes > limits.bytes) return undefined;
				texts.push(parsed.payload);
				part += 1;
				if (parsed.header.parts === undefined) continue;
				try {
					const value = JSON.parse(texts.join("")) as AuditIdentity;
					return value?.child === child && value.parent === parent
						? value
						: undefined;
				} catch {
					return undefined;
				}
			}
			carry = buffer.subarray(at);
			if (carry.length > maxLine) return undefined;
		}
	}

	async function headOf(path: string, parent: string, child: string, size: number) {
		try {
			const buffer = await readAt(
				join(indexOf(path), "head.json"),
				0,
				headerAllowance,
			);
			if (buffer.length >= headerAllowance) return undefined;
			const head = JSON.parse(buffer.toString("utf8"));
			const counts = [head?.generation, head?.committed, head?.extent];
			if (
				head?.v !== version ||
				head.parent !== parent ||
				head.child !== child ||
				!counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
				head.extent > size
			) {
				return undefined;
			}
			return head as { generation: number; committed: number; extent: number };
		} catch {
			return undefined;
		}
	}

	async function tailOf(path: string, size: number) {
		const start = Math.max(0, size - Math.max(limits.windowBytes, 2 * maxLine));
		const buffer = await readAt(path, start, size - start);
		let at = start === 0 ? 0 : buffer.indexOf(10) + 1;
		let close: Record<string, unknown> | undefined;
		let last: Header | undefined;
		let loss: Record<string, unknown> | undefined;
		let execution: { state?: unknown; verdict?: unknown } | undefined;
		for (let end = buffer.indexOf(10, at); end >= 0; end = buffer.indexOf(10, at)) {
			const text = buffer.toString("utf8", at, end);
			at = end + 1;
			if (text === "") continue;
			const parsed = parse(text);
			if (parsed && "header" in parsed && parsed.header.close !== undefined) {
				const value = parsed.header.close as Record<string, unknown>;
				close =
					last?.parts !== undefined && value?.committed === last.ordinal + 1
						? value
						: undefined;
				continue;
			}
			close = undefined;
			if (!parsed || !("header" in parsed)) continue;
			const { header, payload } = parsed;
			if (header.loss !== undefined) {
				loss = header.loss as Record<string, unknown>;
				continue;
			}
			last = header;
			if (header.part !== 0 || header.parts !== 1) continue;
			try {
				const value = JSON.parse(payload);
				if (value?.kind === "execution") execution = value;
			} catch {}
		}
		if (at < buffer.length) close = undefined;
		const count = (value: unknown) =>
			Number.isSafeInteger(value) ? (value as number) : undefined;
		return {
			closed: close !== undefined,
			complete: close?.complete === true && loss === undefined,
			written: count(close?.written),
			loss: loss !== undefined,
			cause: typeof loss?.cause === "string" ? loss.cause : undefined,
			lostFrom: count(loss?.from),
			uncertain: count(loss?.uncertain),
			...(typeof close?.state === "string"
				? {
						state: close.state,
						verdict:
							typeof close.verdict === "string" ? close.verdict : undefined,
					}
				: {
						state:
							typeof execution?.state === "string" ? execution.state : undefined,
						verdict:
							typeof execution?.verdict === "string"
								? execution.verdict
								: undefined,
					}),
		};
	}

	function healthOf(record: Capture): Health {
		if (record.durable) return record.durable;
		const identityWritten = record.written > 0;
		return {
			complete: !record.cause,
			received: record.next,
			admitted: record.admitted,
			written: record.written,
			lost: record.lost,
			...(record.lostFrom === undefined ? {} : { lostFrom: record.lostFrom }),
			...(record.uncertain === undefined
				? {}
				: { uncertain: record.uncertain }),
			...(record.marker ? { marker: record.marker } : {}),
			...(record.cause
				? {
						warning: identityWritten
							? record.cause
							: `${record.cause} ${unrecoverable}`,
					}
				: {}),
		};
	}

	function summary(record: Capture) {
		const interrupted =
			record.durable !== undefined &&
			(record.state === undefined || working.has(record.state));
		return {
			child: record.identity.child,
			identity: { ...record.identity, written: record.written > 0 },
			section:
				record.durable ||
				(record.state !== undefined && !working.has(record.state))
					? ("history" as const)
					: ("working" as const),
			...(record.state === undefined ? {} : { state: record.state }),
			...(record.verdict === undefined ? {} : { verdict: record.verdict }),
			...(interrupted ? { interrupted: true as const } : {}),
			health: healthOf(record),
		};
	}

	async function list(after?: string) {
		const parent = currentParent();
		const names = new Set<string>();
		for (const record of records.values()) {
			if (record.identity.parent === parent) names.add(record.identity.child);
		}
		if (parent) {
			try {
				for (const name of await files.readdir(join(options.root, parent))) {
					if (name.endsWith(".jsonl")) names.add(name.slice(0, -".jsonl".length));
				}
			} catch {}
		}
		const sorted = [...names].sort();
		const from =
			after === undefined ? 0 : sorted.filter((name) => name <= after).length;
		const page = sorted.slice(from, from + limits.catalog);
		const listed: ReturnType<typeof summary>[] = [];
		for (const child of page) {
			const record = await lookup(child);
			if (record) listed.push(summary(record));
		}
		return {
			records: listed,
			...(from + page.length < sorted.length ? { next: page.at(-1) } : {}),
		};
	}

	async function read(child: string, cursor?: WindowCursor) {
		const record = await lookup(child);
		if (!record) return undefined;
		const identity = { ...record.identity, written: record.written > 0 };
		const health = healthOf(record);
		if (
			cursor?.generation !== undefined &&
			(cursor.generation !== record.generation || cursor.child !== child)
		) {
			return { refresh: true as const, identity, health };
		}
		const from = Math.max(1, cursor?.from ?? 1);
		const pending = [...record.pending];
		const committed = record.committed;
		const window = record.path
			? await indexed(record, from, cursor?.offset)
			: ({
					observations: [],
					unavailable: [],
					issues: new Set(),
					from,
				} as Window);
		const observations = window.observations;
		if (window.from >= committed) {
			for (const item of pending) {
				if (item.ordinal < window.from || item.ordinal >= from + size) continue;
				observations.push({
					...(item.value as Evidence & { ordinal: number }),
					written: false,
				});
			}
		}
		return {
			identity,
			observations,
			health,
			unavailable: window.unavailable,
			...(window.issues.size > 0
				? { warning: [...window.issues].join(" ") }
				: {}),
			next: {
				child,
				generation: record.generation,
				from: window.from,
				...(window.offset === undefined ? {} : { offset: window.offset }),
			},
		};
	}

	async function segment(child: string, cursor: SegmentCursor) {
		const record = await lookup(child);
		if (!record?.path) return undefined;
		if (cursor.child !== child || cursor.generation !== record.generation) {
			return { refresh: true as const };
		}
		const at = (offset: number): SegmentCursor => ({ ...cursor, offset });
		const buffer = await readAt(
			record.path,
			cursor.offset,
			Math.min(maxLine, record.size - cursor.offset),
		);
		const newline = buffer.indexOf(10);
		const parsed =
			newline < 0 ? undefined : parse(buffer.toString("utf8", 0, newline));
		if (!parsed || !("header" in parsed) || parsed.header.ordinal !== cursor.ordinal) {
			return { unavailable: true as const };
		}
		const { header, payload } = parsed;
		let text = payload;
		if (header.field !== undefined) {
			try {
				text = JSON.parse(`"${payload}"`);
			} catch {
				return { unavailable: true as const };
			}
		}
		let previous: number | undefined;
		if (header.part > 0) {
			const base = Math.max(0, cursor.offset - 1 - maxLine);
			const before = await readAt(record.path, base, cursor.offset - 1 - base);
			previous = base + before.lastIndexOf(10) + 1;
		}
		return {
			ordinal: cursor.ordinal,
			part: header.part,
			final: header.parts !== undefined,
			...(header.field === undefined ? {} : { field: header.field }),
			text,
			...(header.parts === undefined ? { next: at(cursor.offset + newline + 1) } : {}),
			...(previous === undefined ? {} : { previous: at(previous) }),
		};
	}

	async function repair(child: string, signal?: AbortSignal) {
		const record = await lookup(child);
		if (!record) return undefined;
		if (live.has(record) || record.draining || record.pending.length > 0) {
			return { refused: "The record is still being captured." };
		}
		if (!record.path || !record.created) {
			return { refused: "The record has no durable journal to repair." };
		}
		const path = record.path;
		const generation = record.generation + 1;
		const rebuilt = { ...record, generation };
		const unavailable: Range[] = [];
		const unsupportedOrdinals: number[] = [];
		let page: Page = { n: 0, entries: [], dirty: false };
		let current:
			| { ordinal: number; part: number; start: number; texts?: string[]; bytes: number }
			| undefined;
		let last = -1;
		let extent = 0;
		let recovered = 0;
		let unresolved = false;
		let verified = false;
		let loss: unknown;
		const place = async (ordinal: number, entry: Extent) => {
			if (ordinal > last + 1) gap(unavailable, last + 1, ordinal - 1);
			const n = Math.floor(ordinal / size);
			while (page.n < n) {
				await replace(pageOf(path, generation, page.n), {
					...binding(rebuilt),
					page: page.n,
					entries: page.entries,
				});
				page = { n: page.n + 1, entries: [], dirty: false };
			}
			page.entries[ordinal - n * size] = entry;
			unresolved = false;
			last = ordinal;
			extent = entry[1];
		};
		const take = async (start: number, end: number, text: string) => {
			if (text === "") return;
			const parsed = parse(text);
			if (!parsed) {
				unresolved = true;
				current = undefined;
				return;
			}
			if ("unsupported" in parsed) {
				current = undefined;
				if (parsed.unsupported === undefined || parsed.unsupported <= last) {
					unresolved = true;
					return;
				}
				unsupportedOrdinals.push(parsed.unsupported);
				await place(parsed.unsupported, [start, end, 0]);
				return;
			}
			const { header, payload } = parsed;
			if (header.loss !== undefined) {
				loss = header.loss;
				return;
			}
			if (header.close !== undefined) return;
			if (header.part === 0 && header.ordinal > last) {
				current = {
					ordinal: header.ordinal,
					part: 0,
					start,
					...(header.ordinal === 0 ? { texts: [] } : {}),
					bytes: 0,
				};
			}
			if (current?.ordinal !== header.ordinal || current.part !== header.part) {
				unresolved = true;
				current = undefined;
				return;
			}
			current.part += 1;
			if (current.texts) {
				current.bytes += payload.length;
				if (current.bytes > limits.bytes) {
					throw new Refused("The record's identity exceeds the audit capture budget.");
				}
				current.texts.push(payload);
			}
			if (header.parts === undefined) return;
			if (current.texts) {
				let owner: Partial<AuditIdentity> | undefined;
				try {
					owner = JSON.parse(current.texts.join(""));
				} catch {}
				if (
					owner?.child !== record.identity.child ||
					owner?.parent !== record.identity.parent
				) {
					throw new Refused(foreign);
				}
				verified = true;
			}
			const ordinal = current.ordinal;
			const begin = current.start;
			current = undefined;
			recovered += 1;
			await place(ordinal, [begin, end]);
		};
		const scanned = Math.max(limits.windowBytes, 2 * maxLine);
		let file: AuditFile | undefined;
		try {
			file = await files.open(path, "r");
			let position = 0;
			let carry = Buffer.alloc(0);
			let skipping = false;
			for (;;) {
				if (signal?.aborted) return { cancelled: true as const };
				const chunk = Buffer.alloc(scanned);
				const { bytesRead } = await file.read(chunk, 0, scanned, position);
				if (bytesRead === 0) break;
				const buffer = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
				const base = position - carry.length;
				position += bytesRead;
				let at = 0;
				for (;;) {
					const end = buffer.indexOf(10, at);
					if (end < 0) break;
					if (skipping) skipping = false;
					else await take(base + at, base + end + 1, buffer.toString("utf8", at, end));
					at = end + 1;
				}
				carry = buffer.subarray(at);
				// A line longer than any the writer produces is damage; its bytes are skipped, never buffered.
				if (carry.length > maxLine) {
					carry = Buffer.alloc(0);
					skipping = true;
					unresolved = true;
					current = undefined;
				}
			}
			if (carry.length > 0 || skipping) unresolved = true;
			if (signal?.aborted) return { cancelled: true as const };
			await files.mkdir(indexOf(path), { recursive: true, mode: 0o700 });
			await replace(pageOf(path, generation, page.n), {
				...binding(rebuilt),
				page: page.n,
				entries: page.entries,
			});
			await replace(join(indexOf(path), "head.json"), {
				...binding(rebuilt),
				committed: last + 1,
				extent,
			});
		} catch (error) {
			if (error instanceof Refused) return { refused: error.message };
			return {
				refused: `The audit index could not be rebuilt: ${errorMessage(error)}.`,
			};
		} finally {
			await file?.close().catch(() => {});
		}
		const tail =
			current !== undefined ||
			unresolved ||
			loss !== undefined ||
			last + 1 < record.committed;
		if (tail) unavailable.push({ from: last + 1 });
		record.generation = generation;
		record.repaired = true;
		record.committed = last + 1;
		record.end = extent;
		record.page = { n: -1, entries: [], dirty: false };
		record.tail = tail ? last + 1 : undefined;
		return {
			generation,
			recovered,
			unavailable,
			unsupported: unsupportedOrdinals,
			...(verified ? {} : { warning: "The record's identity could not be verified." }),
			...(loss === undefined ? {} : { loss }),
		};
	}

	function execution(child: string, state: string, verdict?: string) {
		const record = records.get(child);
		if (!record || (record.state === state && verdict === undefined)) return;
		record.state = state;
		record.verdict = verdict;
		if (!working.has(state)) live.delete(record);
		admit(record, {
			kind: "execution",
			state,
			...(verdict === undefined ? {} : { verdict }),
		});
	}

	return { begin, execution, list, read, segment, repair, close };
}

const working = new Set(["queued", "running", "waiting"]);

const deltaParts: Record<string, "text" | "thinking" | "arguments"> = {
	text_delta: "text",
	thinking_delta: "thinking",
	toolcall_delta: "arguments",
};

type MessageEvent = Extract<
	AgentSessionEvent,
	{ type: "message_start" | "message_update" | "message_end" }
>;

type ToolEvent = Extract<
	AgentSessionEvent,
	{
		type:
			| "tool_execution_start"
			| "tool_execution_update"
			| "tool_execution_end";
	}
>;

type Content = string | readonly { type: string; text?: string }[];

function snapshot(value: unknown, bound: number) {
	let bytes = 0;
	const ancestors = new Set<object>();
	function copy(value: unknown): unknown {
		if (bytes > bound) return undefined;
		if (typeof value === "string") {
			bytes += 2 * value.length;
			return value;
		}
		if (
			value === undefined ||
			typeof value === "function" ||
			typeof value === "symbol"
		) {
			return undefined;
		}
		bytes += 8;
		if (value === null || typeof value !== "object") {
			if (typeof value === "bigint") {
				throw new TypeError("a BigInt cannot be recorded");
			}
			return typeof value === "number" && !Number.isFinite(value)
				? null
				: value;
		}
		const json = (value as { toJSON?: () => unknown }).toJSON;
		if (typeof json === "function") return copy(json.call(value));
		if (ancestors.has(value)) {
			throw new TypeError("a circular structure cannot be recorded");
		}
		ancestors.add(value);
		bytes += 8;
		let copied: unknown;
		if (Array.isArray(value)) {
			copied = value.map((item) => {
				const kept = copy(item);
				return kept === undefined ? null : kept;
			});
		} else {
			const fields: Record<string, unknown> = {};
			for (const [key, field] of Object.entries(value)) {
				const kept = copy(field);
				if (kept === undefined) continue;
				bytes += 2 * key.length + 8;
				fields[key] = kept;
			}
			copied = fields;
		}
		ancestors.delete(value);
		return copied;
	}
	const copied = copy(value);
	return { value: copied, bytes };
}

type Piece = { text: string; field?: string };

function* encode(value: unknown, slice: number, path = ""): Generator<Piece> {
	if (typeof value === "string") {
		if (value.length <= slice) {
			yield { text: JSON.stringify(value) };
			return;
		}
		const field =
			Buffer.byteLength(path) <= fieldAllowance ? path : undefined;
		yield { text: '"' };
		for (let start = 0; start < value.length; ) {
			let end = Math.min(start + slice, value.length);
			const last = value.charCodeAt(end - 1);
			if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
			yield { text: JSON.stringify(value.slice(start, end)).slice(1, -1), field };
			start = end;
		}
		yield { text: '"' };
	} else if (Array.isArray(value)) {
		yield { text: "[" };
		for (const [index, item] of value.entries()) {
			if (index > 0) yield { text: "," };
			yield* encode(item, slice, path ? `${path}.${index}` : `${index}`);
		}
		yield { text: "]" };
	} else if (value !== null && typeof value === "object") {
		yield { text: "{" };
		let first = true;
		for (const [key, field] of Object.entries(value)) {
			if (!first) yield { text: "," };
			first = false;
			yield* encode(key, slice, path);
			yield { text: ":" };
			yield* encode(field, slice, path ? `${path}.${key}` : key);
		}
		yield { text: "}" };
	} else {
		yield { text: JSON.stringify(value) };
	}
}

function line(header: object, payload: string) {
	const body = `${JSON.stringify(header)}\t${payload}`;
	return `${checksum(body)}\t${body}\n`;
}

function checksum(body: string) {
	return crc32(body).toString(16).padStart(8, "0");
}

function parse(text: string): Line | undefined {
	if (text.charCodeAt(8) !== 9 || checksum(text.slice(9)) !== text.slice(0, 8)) {
		return undefined;
	}
	const split = text.indexOf("\t", 9);
	if (split < 0) return undefined;
	let header: Header;
	try {
		header = JSON.parse(text.slice(9, split));
	} catch {
		return undefined;
	}
	if (header === null || typeof header !== "object") return undefined;
	if (header.v !== version) {
		return {
			unsupported: Number.isSafeInteger(header.ordinal)
				? header.ordinal
				: undefined,
		};
	}
	if (header.loss !== undefined || header.close !== undefined) {
		return { header, payload: "" };
	}
	if (
		!Number.isSafeInteger(header.ordinal) ||
		header.ordinal < 0 ||
		!Number.isSafeInteger(header.part) ||
		header.part < 0 ||
		(header.parts !== undefined && header.parts !== header.part + 1)
	) {
		return undefined;
	}
	return { header, payload: text.slice(split + 1) };
}

function meta(value: unknown) {
	const kept: Record<string, unknown> = {};
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return kept;
	}
	let bytes = 0;
	for (const [key, field] of Object.entries(value)) {
		if (key === "ordinal" || field === null || typeof field === "object") {
			continue;
		}
		const cost = Buffer.byteLength(JSON.stringify({ [key]: field }));
		if (bytes + cost > metaAllowance) continue;
		bytes += cost;
		kept[key] = field;
	}
	return kept;
}

function gap(ranges: Range[], from: number, to: number) {
	const last = ranges.at(-1);
	if (last?.to !== undefined && last.to + 1 === from) last.to = to;
	else ranges.push({ from, to });
}

function indexOf(journal: string) {
	return journal.replace(/\.jsonl$/, ".index");
}

function pageOf(journal: string, generation: number, page: number) {
	return join(indexOf(journal), `${generation}-${page}.json`);
}

function contentText(content: Content) {
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("");
}

export type ChildAudit = ReturnType<typeof createChildAudit>;
export type ChildCapture = ReturnType<ChildAudit["begin"]>;
