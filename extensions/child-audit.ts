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
	| { kind: "loadout"; thinking: string };

type Pending = { ordinal: number; line: string; bytes: number; evidence?: Evidence };

interface Capture {
	identity: AuditIdentity;
	path?: string;
	identityWritten: boolean;
	pending: Pending[];
	offsets: number[];
	queued: { steer: string[]; "follow-up": string[] };
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
		if (record.disabled) {
			record.lost += 1;
			return;
		}
		const ordinal = record.offsets.length + record.pending.length;
		const line = `${JSON.stringify(evidence ? { ordinal, ...evidence } : record.identity)}\n`;
		const bytes = Buffer.byteLength(line);
		if (
			admittedBytes + bytes > limits.bytes ||
			admittedEntries + 1 > limits.entries
		) {
			record.lost += 1;
			fail(record, "The audit capture budget is exhausted.");
			return;
		}
		admittedBytes += bytes;
		admittedEntries += 1;
		record.pending.push({
			ordinal,
			line,
			bytes,
			evidence,
		});
		if (!record.draining) {
			record.draining = true;
			queueMicrotask(() => void drain(record));
		}
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
	}

	function begin(identity: Omit<AuditIdentity, "parent">) {
		const record: Capture = {
			identity,
			identityWritten: false,
			pending: [],
			offsets: [],
			queued: { steer: [], "follow-up": [] },
			draining: false,
			disabled: false,
			lost: 0,
		};
		records.set(identity.child, record);
		const capture = {
			event: (value: AgentSessionEvent) => event(record, value),
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
			return capture;
		}
		admit(record);
		return capture;
	}

	async function written(record: Capture, from: number, to: number) {
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
			.map((line) => ({ ...(JSON.parse(line) as object), written: true }));
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
			.filter((item) => item.ordinal >= from && item.ordinal < to && item.evidence)
			.map((item) => ({ ordinal: item.ordinal, ...item.evidence, written: false }));
		const observations = [...(await written(record, from, durable)), ...live];
		return { identity, observations, health };
	}

	return { begin, read };
}

type Content = string | readonly { type: string; text?: string }[];

function contentText(content: Content) {
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("");
}

export type ChildAudit = ReturnType<typeof createChildAudit>;
export type ChildCapture = ReturnType<ChildAudit["begin"]>;
