import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { errorMessage } from "./error-message.ts";

export const askParentTool = "ask_parent";

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

type Observation = Evidence & { ordinal: number; written: boolean };

type Entry =
	| {
			type: "message";
			message: string;
			role: string;
			content: unknown;
			usage?: unknown;
			stopReason?: string;
			errorMessage?: string;
			final: boolean;
	  }
	| ToolEntry;

type ToolEntry = {
	type: "tool";
	call: string;
	parent?: string;
	name: string;
	args?: unknown;
	partial?: unknown;
	result?: unknown;
	error?: boolean;
	final: boolean;
};

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
}

interface Capture {
	identity: AuditIdentity;
	path?: string;
	created: boolean;
	pending: Pending[];
	extents: number[];
	size: number;
	admitted: number;
	held: { bytes: number; entries: number };
	queued: { steer: string[]; "follow-up": string[] };
	next: number;
	seen: Set<string>;
	finals: Set<string>;
	updates: Map<string, number>;
	state?: string;
	messages: { count: number; open?: string; ids: WeakMap<object, string> };
	draining: boolean;
	cause?: string;
	lost: number;
	lostFrom?: number;
	uncertain?: number;
	marker?: "written" | "failed";
}

const defaultLimits = {
	bytes: 4 * 1024 * 1024,
	entries: 256,
	window: 128,
	chunk: 64 * 1024,
};

// A part line adds a numeric header and a newline to its chunk; the loss marker is written outside the payload budget.
const partOverhead = 64;
const markerAllowance = 1024;

class Uncertain extends Error {}

const unrecoverable =
	"Durable recovery of this child's history is not guaranteed.";

export function createChildAudit(options: {
	root: string;
	parent: () => string | undefined;
	limits?: Partial<typeof defaultLimits>;
	files?: AuditFiles;
	schedule?: (task: () => void) => void;
}) {
	const limits = { ...defaultLimits, ...options.limits };
	const files: AuditFiles = options.files ?? { mkdir, open };
	const schedule = options.schedule ?? setImmediate;
	const writer = limits.chunk + partOverhead;
	const slice = Math.max(2, Math.floor((limits.chunk - 2) / 6));
	const records = new Map<string, Capture>();
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
		void mark(record).finally(() => {
			record.draining = false;
		});
	}

	function start(record: Capture) {
		record.draining = true;
		admittedBytes += writer;
		record.held.bytes += writer;
		schedule(() => void drain(record));
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
		const ordinal = record.next++;
		if (record.cause) {
			lose(record, ordinal);
			return false;
		}
		const whole = limits.bytes - writer - share.bytes;
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
		if (!fits(record, taken.bytes + (record.draining ? 0 : writer))) {
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
				await store(record, file, item);
				record.pending.shift();
				release(record, item);
				record.extents.push(record.size);
			}
		} catch (error) {
			const item = record.pending.shift() as Pending;
			release(record, item);
			if (error instanceof Uncertain) record.uncertain = item.ordinal;
			else lose(record, item.ordinal);
			fail(record, `Audit capture failed: ${errorMessage(error)}.`);
		}
		for (const item of record.pending) {
			release(record, item);
			lose(record, item.ordinal);
		}
		record.pending = [];
		void file?.close().catch(() => {});
		if (record.cause && !record.marker) await mark(record);
		admittedBytes -= writer;
		record.held.bytes -= writer;
		record.draining = false;
	}

	async function store(record: Capture, file: AuditFile, item: Pending) {
		let texts: string[] = [];
		let size = 0;
		let part = 0;
		for (const piece of encode(item.value, slice)) {
			const bytes = Buffer.byteLength(piece);
			if (size > 0 && size + bytes > limits.chunk) {
				await append(
					record,
					file,
					{ ordinal: item.ordinal, part: part++ },
					texts,
				);
				texts = [];
				size = 0;
			}
			texts.push(piece);
			size += bytes;
		}
		await append(
			record,
			file,
			{ ordinal: item.ordinal, part, parts: part + 1 },
			texts,
		);
	}

	async function append(
		record: Capture,
		file: AuditFile,
		header: object,
		texts: string[],
	) {
		await new Promise<void>((resolve) => schedule(resolve));
		await writeAll(
			record,
			file,
			Buffer.from(`${JSON.stringify(header)} ${texts.join("")}\n`),
		);
	}

	async function writeAll(record: Capture, file: AuditFile, buffer: Buffer) {
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
			record.size += written;
		}
	}

	async function mark(record: Capture) {
		if (!record.created) {
			record.marker = "failed";
			return;
		}
		const loss = {
			loss: {
				...(record.lostFrom === undefined ? {} : { from: record.lostFrom }),
				...(record.uncertain === undefined
					? {}
					: { uncertain: record.uncertain }),
				cause: (record.cause as string).slice(0, markerAllowance / 2),
			},
		};
		let file: AuditFile | undefined;
		try {
			file = await files.open(record.path as string, "a");
			await writeAll(record, file, Buffer.from(`\n${JSON.stringify(loss)}\n`));
			record.marker = "written";
		} catch {
			record.marker = "failed";
		} finally {
			await file?.close().catch(() => {});
		}
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
		} else if (
			admit(record, {
				...fields,
				event: id,
				phase: "end",
				result: event.result,
				error: event.isError,
			})
		) {
			record.finals.add(identity);
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
		if (
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
			})
		) {
			record.finals.add(id);
		}
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

	function begin(identity: Omit<AuditIdentity, "parent">) {
		const record: Capture = {
			identity: snapshot(identity, Number.POSITIVE_INFINITY)
				.value as AuditIdentity,
			created: false,
			pending: [],
			extents: [],
			size: 0,
			admitted: 0,
			held: { bytes: 0, entries: 0 },
			queued: { steer: [], "follow-up": [] },
			next: 0,
			seen: new Set(),
			finals: new Set(),
			updates: new Map(),
			messages: { count: 0, ids: new WeakMap() },
			draining: false,
			lost: 0,
		};
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

	async function written(
		record: Capture,
		from: number,
		to: number,
	): Promise<Observation[]> {
		if (!record.path || from >= to) return [];
		const start = record.extents[from - 1];
		const buffer = Buffer.alloc(record.extents[to - 1] - start);
		const file = await files.open(record.path, "r");
		try {
			let offset = 0;
			while (offset < buffer.length) {
				const { bytesRead } = await file.read(
					buffer,
					offset,
					buffer.length - offset,
					start + offset,
				);
				if (bytesRead === 0) break;
				offset += bytesRead;
			}
		} finally {
			await file.close();
		}
		const observations: Observation[] = [];
		let texts: string[] = [];
		for (const line of buffer.toString("utf8").split("\n")) {
			const space = line.indexOf(" ");
			if (space < 0) continue;
			const header = JSON.parse(line.slice(0, space)) as { parts?: number };
			texts.push(line.slice(space + 1));
			if (header.parts === undefined) continue;
			observations.push({ ...JSON.parse(texts.join("")), written: true });
			texts = [];
		}
		return observations;
	}

	async function read(child: string, from = 1) {
		const record = records.get(child);
		if (!record) return undefined;
		const to = from + limits.window;
		const durable = Math.min(to, record.extents.length);
		const identityWritten = record.extents.length > 0;
		const identity = { ...record.identity, written: identityWritten };
		const health = {
			complete: !record.cause,
			received: record.next,
			admitted: record.admitted,
			written: record.extents.length,
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
		const live = record.pending
			.filter((item) => item.ordinal >= from && item.ordinal < to)
			.map((item) => ({
				...(item.value as Evidence & { ordinal: number }),
				written: false,
			}));
		const observations = [...(await written(record, from, durable)), ...live];
		return {
			identity,
			observations,
			transcript: transcript(record, observations),
			health,
		};
	}

	function transcript(record: Capture, observations: Observation[]) {
		const entries = new Map<string, Entry>();
		for (const observation of observations) {
			if (observation.kind === "message") {
				project(record, entries, observation);
				continue;
			}
			if (observation.kind !== "tool") continue;
			const identity = `tool:${observation.call}`;
			if (observation.phase === "update" && record.finals.has(identity)) {
				continue;
			}
			const entry = (entries.get(identity) as ToolEntry | undefined) ?? {
				type: "tool",
				call: observation.call,
				...(observation.parent ? { parent: observation.parent } : {}),
				name: observation.name,
				final: false,
			};
			entries.set(identity, entry);
			if (observation.phase === "start") entry.args = observation.args;
			else if (observation.phase === "update") {
				if (!entry.final) entry.partial = observation.partial;
			} else {
				delete entry.partial;
				entry.result = observation.result;
				entry.error = observation.error;
				entry.final = true;
			}
		}
		return [...entries.values()];
	}

	function project(
		record: Capture,
		entries: Map<string, Entry>,
		observation: Extract<Observation, { kind: "message" }>,
	) {
		const id = observation.message;
		if (observation.phase === "end") {
			const {
				kind: _kind,
				event: _event,
				phase: _phase,
				ordinal: _ordinal,
				written: _written,
				...final
			} = observation;
			entries.set(id, { type: "message", ...final, final: true });
			return;
		}
		if (record.finals.has(id)) {
			if (!entries.has(id) && observation.phase === "start") {
				entries.set(id, {
					type: "message",
					message: id,
					role: observation.role,
					content: [],
					final: false,
				});
			}
			return;
		}
		const entry = (entries.get(id) as Extract<Entry, { type: "message" }>) ?? {
			type: "message",
			message: id,
			role: observation.phase === "start" ? observation.role : "assistant",
			content: [],
			final: false,
		};
		entries.set(id, entry);
		if (observation.phase !== "update") return;
		const blocks = entry.content as Record<string, string>[];
		const block = blocks[observation.block] ?? {
			type: observation.part === "arguments" ? "toolCall" : observation.part,
			[observation.part]: "",
		};
		block[observation.part] += observation.delta;
		blocks[observation.block] = block;
	}

	function execution(child: string, state: string, verdict?: string) {
		const record = records.get(child);
		if (!record || (record.state === state && verdict === undefined)) return;
		record.state = state;
		if (!working.has(state)) live.delete(record);
		admit(record, {
			kind: "execution",
			state,
			...(verdict === undefined ? {} : { verdict }),
		});
	}

	return { begin, execution, read };
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

function* encode(value: unknown, slice: number): Generator<string> {
	if (typeof value === "string") {
		if (value.length <= slice) {
			yield JSON.stringify(value);
			return;
		}
		yield '"';
		for (let start = 0; start < value.length; ) {
			let end = Math.min(start + slice, value.length);
			const last = value.charCodeAt(end - 1);
			if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
			yield JSON.stringify(value.slice(start, end)).slice(1, -1);
			start = end;
		}
		yield '"';
	} else if (Array.isArray(value)) {
		yield "[";
		for (const [index, item] of value.entries()) {
			if (index > 0) yield ",";
			yield* encode(item, slice);
		}
		yield "]";
	} else if (value !== null && typeof value === "object") {
		yield "{";
		let first = true;
		for (const [key, field] of Object.entries(value)) {
			if (!first) yield ",";
			first = false;
			yield* encode(key, slice);
			yield ":";
			yield* encode(field, slice);
		}
		yield "}";
	} else {
		yield JSON.stringify(value);
	}
}

function contentText(content: Content) {
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("");
}

export type ChildAudit = ReturnType<typeof createChildAudit>;
export type ChildCapture = ReturnType<ChildAudit["begin"]>;
