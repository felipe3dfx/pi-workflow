import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	getAgentDir,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import {
	type ChildHandle,
	type ChildSessionFactory,
	shutdownDeadline,
} from "./child-sessions.ts";
import { type Schedule, scheduleTimer } from "./clock.ts";
import { errorMessage } from "./error-message.ts";
import { stopTree, treeEnvironment } from "./process-tree.ts";

export const readinessDeadline = 10_000;

// Pi's built-in bash bypasses the ADR 0013 guard; only a guarded replacement may take its name.
const unguardedTools = new Set(["bash"]);

type RpcRecord = { type: string; [field: string]: unknown };
type Pending = { resolve(data: unknown): void; reject(error: Error): void };
type Block = { type: string; text?: string; thinking?: string };
type Update = {
	type: string;
	contentIndex: number;
	delta?: string;
	content?: string;
	id?: string;
	toolName?: string;
	toolCall?: unknown;
};

function installedPi() {
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		if (!directory) continue;
		const candidate = join(directory, "pi");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	throw new Error("Pi was not found on PATH.");
}

function sessionFile(root: string, sessionId: string) {
	const directory = join(root, sessionId);
	const file = readdirSync(directory).find((name) => name.endsWith(".jsonl"));
	if (!file) throw new Error(`The session ${sessionId} has no saved conversation.`);
	return join(directory, file);
}

function applyUpdate(message: AssistantMessage, update: Update) {
	const content = message.content as unknown as Block[];
	const index = update.contentIndex;
	const kind = update.type.slice(0, update.type.indexOf("_"));
	const field = kind === "thinking" ? "thinking" : "text";
	if (update.type === "text_start" || update.type === "thinking_start") {
		content[index] = { type: kind, [field]: "" };
	} else if (update.type === "text_delta" || update.type === "thinking_delta") {
		const block = content[index] ?? { type: kind, [field]: "" };
		content[index] = { ...block, [field]: `${block[field] ?? ""}${update.delta}` };
	} else if (update.type === "text_end" || update.type === "thinking_end") {
		content[index] = { ...content[index], type: kind, [field]: update.content };
	} else if (update.type === "toolcall_start") {
		content[index] = { type: "toolCall", id: update.id, name: update.toolName, arguments: {} } as Block;
	} else if (update.type === "toolcall_end") {
		content[index] = update.toolCall as Block;
	}
}

export function createRpcChildSession(
	options: { command?: string[]; sessionRoot?: string; schedule?: Schedule } = {},
): ChildSessionFactory {
	const schedule = options.schedule ?? scheduleTimer;
	return async (spec) => {
		if (spec.authorization || spec.sources) {
			throw new Error("Contextual authorization is not available to RPC children.");
		}
		const [command, ...prefix] = options.command ?? [installedPi()];
		const root = options.sessionRoot ?? join(getAgentDir(), "pi-workflow-children");
		const sessionId = randomUUID();
		const fork = spec.parentSession ? sessionFile(root, spec.parentSession) : undefined;
		const tools = spec.tools.filter((tool) => !unguardedTools.has(tool));
		const args = [
			...prefix,
			"--mode", "rpc",
			"--session-dir", join(root, sessionId),
			"--session-id", sessionId,
			...(fork ? ["--fork", fork] : []),
			"--model", spec.model,
			"--thinking", spec.thinking,
			"--tools", tools.join(","),
			"--no-extensions",
			"--extension", "builtin:mcp",
			"--extension", "builtin:codemode",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--system-prompt", spec.prompt,
			spec.project.trusted ? "--approve" : "--no-approve",
		];

		let child: ChildProcess | undefined;
		let starting: Promise<void> | undefined;
		let exited: Promise<void> = Promise.resolve();
		let failure: Error | undefined;
		let disposed = false;
		let stderr = "";
		let requests = 0;
		const waiting = new Map<string, Pending>();
		let settled: Pending | undefined;
		let entries: SessionEntry[] = spec.entries ?? [];
		let steering: string[] = [];
		let streaming: AssistantMessage | undefined;
		let last: AssistantMessage | undefined;
		let delivery = Promise.resolve();

		function fail(error: Error) {
			failure ??= error;
			for (const pending of waiting.values()) pending.reject(failure);
			waiting.clear();
			settled?.reject(failure);
			settled = undefined;
		}

		function send(record: Record<string, unknown>) {
			if (failure) throw failure;
			child?.stdin?.write(`${JSON.stringify(record)}\n`);
		}

		function request(type: string, fields: Record<string, unknown> = {}) {
			const id = `r${++requests}`;
			return new Promise<unknown>((resolve, reject) => {
				waiting.set(id, { resolve, reject });
				try {
					send({ id, type, ...fields });
				} catch (error) {
					waiting.delete(id);
					reject(error);
				}
			});
		}

		async function refresh() {
			const since = entries.at(-1)?.id;
			const data = (await request("get_entries", since ? { since } : {})) as {
				entries: SessionEntry[];
			};
			entries = [...entries, ...data.entries];
		}

		async function deliver(record: RpcRecord) {
			let event = record;
			if (record.type === "message_start" || record.type === "message_update" || record.type === "message_end") {
				const message = record.message as AssistantMessage | undefined;
				if (record.type === "message_start" && message?.role === "assistant") {
					streaming = message;
				} else if (record.type === "message_update" && streaming) {
					applyUpdate(streaming, record.assistantMessageEvent as Update);
					event = { ...record, message: streaming };
				} else if (record.type === "message_end" && message?.role === "assistant" && streaming) {
					Object.assign(streaming, message);
					event = { ...record, message: streaming };
					last = streaming;
					streaming = undefined;
				} else if (record.type === "message_end" && message?.role === "assistant") {
					last = message;
				}
				if (record.type === "message_end") await refresh().catch(() => {});
			} else if (record.type === "queue_update") {
				steering = [...(record.steering as string[])];
			}
			spec.onEvent(event as unknown as AgentSessionEvent);
			if (record.type === "agent_settled") {
				settled?.resolve(record.aborted);
				settled = undefined;
			}
		}

		function receive(line: string) {
			let record: RpcRecord;
			try {
				record = JSON.parse(line) as RpcRecord;
			} catch {
				return;
			}
			if (record.type === "response") {
				const pending = waiting.get(record.id as string);
				if (!pending) return;
				waiting.delete(record.id as string);
				if (record.success) pending.resolve(record.data);
				else pending.reject(new Error(String(record.error)));
			} else if (record.type === "extension_ui_request") {
				if (record.method === "notify") spec.notify(String(record.message));
				else if (["select", "confirm", "input", "editor"].includes(String(record.method)))
					send({ type: "extension_ui_response", id: record.id, cancelled: true });
			} else {
				delivery = delivery
					.then(() => deliver(record))
					.catch((error: unknown) => spec.notify(errorMessage(error)));
			}
		}

		function launch() {
			if (disposed) throw new Error("The child session was stopped.");
			const pi = spawn(command, args, {
				cwd: spec.cwd,
				env: { ...process.env, ...treeEnvironment(sessionId) },
				stdio: ["pipe", "pipe", "pipe"],
				detached: true,
			});
			child = pi;
			let swept = Promise.resolve();
			pi.once("exit", () => {
				swept = stopTree(sessionId);
			});
			exited = new Promise((resolve) => {
				pi.once("close", (code, signal) => {
					const tail = stderr.trim().split("\n").slice(-5).join(" ");
					fail(
						new Error(
							`The child Pi process exited with ${code === null ? `signal ${signal}` : `code ${code}`}.${tail ? ` ${tail}` : ""}`,
						),
					);
					void swept.then(resolve);
				});
			});
			pi.once("error", (error) => fail(error));
			pi.stdin.on("error", () => {});
			pi.stderr.setEncoding("utf8");
			pi.stderr.on("data", (chunk: string) => {
				stderr = `${stderr}${chunk}`.slice(-4000);
			});
			let buffer = "";
			pi.stdout.setEncoding("utf8");
			pi.stdout.on("data", (chunk: string) => {
				buffer += chunk;
				for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
					const line = buffer.slice(0, newline).replace(/\r$/, "");
					buffer = buffer.slice(newline + 1);
					if (line) receive(line);
				}
			});
		}

		async function ready() {
			launch();
			let cancel = () => {};
			const deadline = new Promise<never>((_, reject) => {
				cancel = schedule(
					() => reject(new Error(`The child Pi process did not become ready within ${readinessDeadline} ms.`)),
					readinessDeadline,
				);
			});
			try {
				const state = (await Promise.race([request("get_state"), deadline])) as {
					sessionId: string;
					model?: { provider: string; id: string };
					thinkingLevel: string;
				};
				if (state.sessionId !== sessionId) {
					throw new Error(`The child Pi process opened session ${state.sessionId} instead of ${sessionId}.`);
				}
				const model = state.model && `${state.model.provider}/${state.model.id}`;
				if (model !== spec.model || state.thinkingLevel !== spec.thinking) {
					throw new Error(
						`The child would run ${model ?? "no model"} at ${state.thinkingLevel} instead of the selected ${spec.model} at ${spec.thinking}.`,
					);
				}
				entries = [];
				await Promise.race([refresh(), deadline]);
			} finally {
				cancel();
			}
		}

		const handle: ChildHandle = {
			sessionId,
			entries: () => entries,
			model: spec.model,
			thinking: spec.thinking,
			tools,
			async run(task) {
				starting ??= ready();
				await starting;
				const done = new Promise<unknown>((resolve, reject) => {
					settled = { resolve, reject };
				});
				done.catch(() => {});
				const accepted = (await request("prompt", { message: task })) as {
					disposition?: string;
				};
				if (accepted.disposition === "handled") {
					throw new Error("The child Pi process handled the task but started no run.");
				}
				if (await done) throw new Error("The child run aborted.");
				if (last?.stopReason === "error" || last?.stopReason === "aborted") {
					throw new Error(last.errorMessage ?? `The child run ${last.stopReason}.`);
				}
				const { text } = (await request("get_last_assistant_text")) as {
					text: string | null;
				};
				return text ?? "";
			},
			async steer(text) {
				if (!starting) throw new Error("The child is not running.");
				await starting;
				await request("steer", { message: text });
			},
			clearQueue() {
				const undelivered = steering;
				steering = [];
				if (child && !failure) request("clear_queue").catch(() => {});
				return undelivered;
			},
			async abort() {
				if (!child || failure) return;
				await request("abort").catch(() => {});
			},
			async dispose() {
				disposed = true;
				const pi = child;
				if (!pi || failure) return exited;
				request("abort").catch(() => {});
				pi.stdin?.end();
				let cancel = () => {};
				const grace = new Promise<boolean>((resolve) => {
					cancel = schedule(() => resolve(false), shutdownDeadline);
				});
				const stopped = await Promise.race([exited.then(() => true), grace]);
				cancel();
				if (!stopped) await stopTree(sessionId);
				await exited;
			},
		};
		return handle;
	};
}
