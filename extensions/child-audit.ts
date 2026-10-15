import { appendFile, mkdir, open, writeFile } from "node:fs/promises";
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

type Pending = { ordinal: number; line: string; bytes: number };

interface Capture {
	identity: AuditIdentity;
	path?: string;
	identityWritten: boolean;
	pending: Pending[];
	offsets: number[];
	queued: { steer: string[]; "follow-up": string[] };
	next: number;
	seen: Set<string>;
	finals: Set<string>;
	updates: Map<string, number>;
	state?: string;
	messages: { count: number; open?: string; ids: WeakMap<object, string> };
	draining: boolean;
	disabled: boolean;
	lost: number;
	warning?: string;
}

const defaultLimits = { bytes: 4 * 1024 * 1024, entries: 256, window: 128 };

const unrecoverable =
	"Durable recovery of this child's history is not guaranteed.";

export function createChildAudit(options: {
	root: string;
	parent: () => string | undefined;
	limits?: Partial<typeof defaultLimits>;
}) {
	const limits = { ...defaultLimits, ...options.limits };
	const records = new Map<string, Capture>();
	let admittedBytes = 0;
	let admittedEntries = 0;

	function fail(record: Capture, reason: string) {
		if (record.disabled) return;
		record.disabled = true;
		record.warning = `${reason} ${unrecoverable}`;
	}

	function release(item: Pending) {
		admittedBytes -= item.bytes;
		admittedEntries -= 1;
	}

	function admit(record: Capture, evidence?: Evidence) {
		const ordinal = record.next++;
		if (record.disabled) {
			record.lost += 1;
			return false;
		}
		const line = `${JSON.stringify(evidence ? { ordinal, ...evidence } : record.identity)}\n`;
		const bytes = Buffer.byteLength(line);
		if (
			admittedBytes + bytes > limits.bytes ||
			admittedEntries + 1 > limits.entries
		) {
			record.lost += 1;
			fail(record, "The audit capture budget is exhausted.");
			return false;
		}
		admittedBytes += bytes;
		admittedEntries += 1;
		record.pending.push({ ordinal, line, bytes });
		if (!record.draining) {
			record.draining = true;
			queueMicrotask(() => void drain(record));
		}
		return true;
	}

	async function drain(record: Capture) {
		try {
			const path = record.path as string;
			while (record.pending.length > 0) {
				const item = record.pending[0];
				if (item.ordinal === 0) {
					await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
					await writeFile(path, item.line, { flag: "wx", mode: 0o600 });
				} else {
					await appendFile(path, item.line);
				}
				record.pending.shift();
				release(item);
				const start = record.offsets.at(-1) ?? 0;
				record.offsets.push(start + item.bytes);
				if (item.ordinal === 0) record.identityWritten = true;
			}
		} catch (error) {
			fail(record, `Audit capture failed: ${errorMessage(error)}.`);
			record.lost += record.pending.length;
			for (const item of record.pending) release(item);
			record.pending = [];
		} finally {
			record.draining = false;
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
			identity,
			identityWritten: false,
			pending: [],
			offsets: [],
			queued: { steer: [], "follow-up": [] },
			next: 0,
			seen: new Set(),
			finals: new Set(),
			updates: new Map(),
			messages: { count: 0, ids: new WeakMap() },
			draining: false,
			disabled: false,
			lost: 0,
		};
		records.set(identity.child, record);
		const capture = {
			event: (value: AgentSessionEvent) => event(record, value),
			reported: (result: unknown) => admit(record, { kind: "report", result }),
			answered: (question: number, text: string) =>
				admit(record, {
					kind: "input",
					source: "answer",
					delivery: "queued",
					question,
					text,
				}),
		};
		try {
			const parent = options.parent();
			if (!parent) throw new Error("the parent session has no identity");
			record.identity = { ...record.identity, parent };
			record.path = join(options.root, parent, `${identity.child}.jsonl`);
		} catch (error) {
			record.warning = `No parent session identity: ${errorMessage(error)}. ${unrecoverable}`;
			record.disabled = true;
			admit(record);
			return capture;
		}
		admit(record);
		return capture;
	}

	async function written(
		record: Capture,
		from: number,
		to: number,
	): Promise<Observation[]> {
		if (!record.path || from >= to) return [];
		const start = record.offsets[from - 1];
		const buffer = Buffer.alloc(record.offsets[to - 1] - start);
		const file = await open(record.path, "r");
		try {
			await file.read(buffer, 0, buffer.length, start);
		} finally {
			await file.close();
		}
		return buffer
			.toString("utf8")
			.split("\n")
			.slice(0, to - from)
			.map((line) => ({ ...(JSON.parse(line) as Evidence & { ordinal: number }), written: true }));
	}

	async function read(child: string, from = 1) {
		const record = records.get(child);
		if (!record) return undefined;
		const to = from + limits.window;
		const durable = Math.min(to, record.offsets.length);
		const identity = { ...record.identity, written: record.identityWritten };
		const health = {
			complete: !record.disabled && record.lost === 0,
			lost: record.lost,
			...(record.warning ? { warning: record.warning } : {}),
		};
		const live = record.pending
			.filter((item) => item.ordinal >= from && item.ordinal < to)
			.map((item) => ({ ...JSON.parse(item.line), written: false }));
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
		admit(record, {
			kind: "execution",
			state,
			...(verdict === undefined ? {} : { verdict }),
		});
	}

	return { begin, execution, read };
}

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

function contentText(content: Content) {
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("");
}

export type ChildAudit = ReturnType<typeof createChildAudit>;
export type ChildCapture = ReturnType<ChildAudit["begin"]>;
