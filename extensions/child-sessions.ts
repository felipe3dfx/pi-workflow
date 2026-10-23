import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
	AssistantMessage,
	ClassifierResult,
	ModelThinkingLevel,
	UserMessage,
} from "@earendil-works/pi-ai";
import type {
	AgentSessionEvent,
	ExtensionContext,
	SessionEntry,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildAudit, ChildCapture } from "./child-audit.ts";
import type {
	ActionAuthorization,
	AuthorizationDecision,
} from "./action-authorization.ts";
import type { ChildShell } from "./child-bash.ts";
import {
	type Checkpoint,
	type CheckpointGrant,
	checkpointTool,
} from "./child-checkpoint.ts";
import type { createChildLauncher } from "./child-launcher.ts";
import { answerCard } from "./child-result-card.ts";
import { hidden, outputText } from "./compact-tools.ts";
import { type Schedule, scheduleTimer } from "./clock.ts";
import { seated } from "./shell.ts";
import { errorMessage } from "./error-message.ts";
import { type ParentProject, webAccessTools } from "./web-access.ts";
import {
	type ChildResult,
	checkpointLines,
	childOutcome,
	needsNoReason,
	projectChild,
	reportsResult,
	verdictSucceeded,
} from "./child-projection.ts";
import { shellOptions } from "./shell-settings.ts";
import type { CommonToolSources } from "./tool-sources.ts";
import { createRpcChildSession } from "./rpc-child.ts";
import { askParentTool, reportResultTool } from "./child-runtime.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";
import type { TodoClaim } from "./todo-extension.ts";
import type { TaskState } from "./todo-list.ts";
import { conflictReason, createWriteClaims } from "./write-claims.ts";

const packageVersion = (
	JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string }
).version;

interface ChildSpec {
	authorization?: ActionAuthorization;
	sources?: CommonToolSources;
	cwd: string;
	project: ParentProject;
	role: string;
	model: string;
	thinking: ModelThinkingLevel;
	prompt: string;
	tools: string[];
	shell: ChildShell;
	onEvent(event: AgentSessionEvent): void;
	notify(message: string): void;
	ask(question: string, signal?: AbortSignal): Promise<string>;
	report(result: ChildResult): void;
	checkpoint?: CheckpointGrant;
	checkpointed(checkpoint: Checkpoint): void;
	entries?: SessionEntry[];
	parentSession?: string;
}

interface Conversation {
	sessionId: string;
	entries: SessionEntry[];
}

export interface ChildHandle {
	sessionId: string;
	entries(): SessionEntry[];
	model: string | undefined;
	thinking: string;
	tools: string[];
	run(task: string): Promise<string>;
	steer(text: string): Promise<void>;
	clearQueue(): string[];
	abort(): Promise<void>;
	dispose(): Promise<void>;
	pendingAuthorizations?(): AuthorizationDecision[];
}

export type ChildSessionFactory = (spec: ChildSpec) => Promise<ChildHandle>;

type Plan = {
	role: string;
	contract: { prompt: string; tools: string[] };
	task: string;
	worktree: string;
	model: string;
	thinking: ModelThinkingLevel;
	chosenBy: "parent";
	references: string[];
	surfaces?: string[];
	checkpoint?: CheckpointGrant;
};

type ChildState =
	| "queued"
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "cancelled"
	| "timed out";

export interface ChildRecord {
	id: string;
	role: string;
	task: string;
	worktree: string;
	model: string;
	thinking: ModelThinkingLevel;
	state: ChildState;
	createdAt: number;
	startedAt?: number;
	endedAt?: number;
	text?: string;
	result?: ChildResult;
	continuedFrom?: string;
	group?: string;
	todo?: number;
	step?: string;
	question?: number;
	steering?: string[];
	undelivered?: string[];
	checkpoints?: Checkpoint[];
	pendingAuthorizations?: AuthorizationDecision[];
}

export type Answerer = "parent" | "operator";

interface Port {
	event(event: AgentSessionEvent): void;
	ask(question: string, signal?: AbortSignal): Promise<string>;
	report(result: ChildResult): void;
	notify(message: string): void;
	checkpointed(checkpoint: Checkpoint): void;
}

interface Question {
	number: number;
	signal?: AbortSignal;
	resolve(answer: string): void;
	reject(error: Error): void;
	release?(): void;
}

interface Child {
	record: ChildRecord;
	plan: Plan;
	handle: ChildHandle;
	port: Port;
	running?: Promise<string>;
	watch: ReturnType<typeof createWatch>;
	capture: ChildCapture;
	conversation?: Conversation;
	entries?: SessionEntry[];
	streaming?: AssistantMessage;
	tools: Map<string, string>;
	writes: Map<string, string>;
	changed: Set<string>;
	followers: Set<() => void>;
	asked: number;
	answers: Map<number, { by: Answerer; text: string }>;
	withdrawn: Set<number>;
	question?: Question;
}

export interface ChildTrace {
	id: string;
	role: string;
	chosenBy: "parent";
	tools: string[];
	references: string[];
	state: ChildState;
	verdict?: string;
	reason?: string;
	notice?: string;
	version: string;
}

const runningLimit = 5;
const launchLimit = 10;
export const shutdownDeadline = 1000;
const stallMs = 4 * 60_000;
const toolStallMs = 30 * 60_000;

function createWatch(schedule: Schedule, onStall: (reason: string) => void) {
	const tools = new Map<string, string>();
	let cancel: (() => void) | undefined;
	function arm() {
		cancel?.();
		const tool: string | undefined = tools.values().next().value;
		const ms = tool === undefined ? stallMs : toolStallMs;
		const reason =
			tool === undefined
				? `no activity for ${ms / 60_000} minutes.`
				: `the tool ${tool} ran for ${ms / 60_000} minutes without finishing.`;
		cancel = schedule(() => {
			cancel = undefined;
			onStall(reason);
		}, ms);
	}
	return {
		start: arm,
		event(event: AgentSessionEvent) {
			if (event.type === "tool_execution_start") {
				tools.set(event.toolCallId, event.toolName);
			} else if (event.type === "tool_execution_end") {
				tools.delete(event.toolCallId);
			}
			if (cancel) arm();
		},
		stop() {
			cancel?.();
			cancel = undefined;
		},
	};
}

function describeTool(name: string, args: unknown) {
	const detail = Object.values(args ?? {}).find(
		(value) => typeof value === "string",
	);
	return terminalSafeLine(
		detail === undefined ? name : `${name} ${detail.split("\n")[0]}`,
	);
}

function changedPath(worktree: string, path: string) {
	const file = resolve(worktree, path);
	const inside = relative(worktree, file);
	return inside === "" ||
		inside === ".." ||
		inside.startsWith(`..${sep}`) ||
		isAbsolute(inside)
		? file
		: inside;
}

export function isWorking(state: ChildState) {
	return state === "queued" || state === "running" || state === "waiting";
}

type Replay = (port: Port) => void;

function hold(port: Port) {
	const held: Replay[] = [];
	port.event = (event) => held.push((next) => next.event(event));
	port.report = (result) => held.push((next) => next.report(result));
	port.notify = (message) => held.push((next) => next.notify(message));
	port.checkpointed = (checkpoint) =>
		held.push((next) => next.checkpointed(checkpoint));
	port.ask = (question, signal) =>
		new Promise<string>((resolve, reject) => {
			held.push((next) => void next.ask(question, signal).then(resolve, reject));
		});
	return held;
}

export interface ResidentChildren {
	children: { child: Child; held: Replay[] }[];
	queue: string[];
	consumed: Set<string>;
	linked: Map<number, string>;
	pending: ChildRecord[];
}

function childDetails(record: ChildRecord, now = Date.now()) {
	const projected = projectChild(record, now);
	return {
		id: projected.id,
		state: projected.state,
		role: projected.role,
		model: projected.model,
		thinking: projected.thinking,
		task: projected.task,
		elapsedMs: projected.elapsedMs,
		text: projected.text,
		result: record.result,
		verdict: record.state === "completed" ? record.result?.verdict : undefined,
		...(record.checkpoints ? { checkpoints: record.checkpoints } : {}),
		...(record.pendingAuthorizations
			? { pendingAuthorizations: record.pendingAuthorizations }
			: {}),
	};
}

export type ChildDetails = ReturnType<typeof childDetails> & {
	question?: number;
};

function parentProject(ctx: ExtensionContext): ParentProject {
	return { cwd: ctx.cwd, trusted: ctx.isProjectTrusted() };
}

const mcpTools = [
	"mcp__*",
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
];

function childTools(plan: Plan) {
	return [
		...plan.contract.tools,
		...mcpTools,
		...(plan.role === "explore" ? webAccessTools : []),
		askParentTool,
		...(reportsResult(plan.role) ? [reportResultTool] : []),
		...(plan.checkpoint ? [checkpointTool] : []),
	];
}

const abortedBeforeLaunch = {
	status: "refused" as const,
	warning: "Launch refused. No child was launched.",
	reason: "The call was aborted before the child launched.",
};

interface ChildMessage {
	customType: "pi-workflow-child-result" | "pi-workflow-child-question";
	content: string;
	display: true;
	details: unknown;
}

type TaskRun = Pick<ChildRecord, "state" | "role" | "result">;

function finalTaskState({ state, role, result }: TaskRun): TaskState {
	if (state === "cancelled") return "pending";
	if (state !== "completed") return "blocked";
	return verdictSucceeded(result?.verdict) || role === "explore"
		? "done"
		: "blocked";
}

function taskChange(todo: TodoLink, id: number, state: TaskState) {
	if (!todo.has(id)) {
		return {
			note: `Task #${id} no longer exists, so no Task state was applied.`,
		};
	}
	return {
		note: `Task #${id} is now ${state}.`,
		apply: () => todo.set(id, state),
	};
}

function withNote(outcome: string, note: string | undefined) {
	return note ? `${outcome}\n\n${note}` : outcome;
}

type TodoLink = {
	has(id: number): boolean;
	set(id: number, state: TaskState): void;
};

export function createChildSessions(options: {
	authorization?: ActionAuthorization;
	sources?: CommonToolSources;
	create?: ChildSessionFactory;
	send: (message: ChildMessage) => void;
	idle: () => boolean;
	trace: (entry: ChildTrace) => void;
	report: (message: string) => void;
	schedule?: Schedule;
	todo?: TodoLink;
	audit: ChildAudit;
}) {
	const create = options.create ?? createRpcChildSession({ schedule: options.schedule });
	const schedule = options.schedule ?? scheduleTimer;
	const children = new Map<string, Child>();
	const queue: Child[] = [];
	const consumed = new Set<string>();
	const linked = new Map<number, string>();
	let pending: ChildRecord[] = [];
	const listeners = new Set<() => void>();
	let generation = 0;
	let reserved = 0;
	const disposing = new Set<Promise<void>>();
	const claims = createWriteClaims();

	function warn(message: string) {
		try {
			options.report(message);
		} catch {}
	}

	function shutDown(handle: ChildHandle, id?: string, capture?: ChildCapture) {
		const done = handle
			.dispose()
			.catch((error: unknown) =>
				warn(id ? `Child ${id}: ${errorMessage(error)}` : errorMessage(error)),
			)
			.finally(() => {
				capture?.disposed();
				disposing.delete(done);
			});
		disposing.add(done);
		return done;
	}

	async function within(work: Promise<unknown>) {
		let cancel = () => {};
		await Promise.race([
			work,
			new Promise<void>((resolve) => {
				cancel = schedule(resolve, shutdownDeadline);
			}),
		]);
		cancel();
	}

	function trace(child: Child) {
		const { record, plan } = child;
		traceRun(record.id, plan, record.state, record.result);
	}

	function traceRun(
		id: string,
		plan: Plan,
		state: ChildState,
		result?: ChildResult,
		notice?: string,
	) {
		const completed = state === "completed" ? result : undefined;
		if (!notice) options.audit.execution(id, state, completed?.verdict);
		try {
			options.trace({
				id,
				role: plan.role,
				chosenBy: plan.chosenBy,
				tools: childTools(plan),
				references: plan.references,
				state,
				...(completed ? { verdict: completed.verdict } : {}),
				...(completed?.reason ? { reason: completed.reason } : {}),
				...(notice ? { notice } : {}),
				version: packageVersion,
			});
		} catch (error) {
			warn(`Child ${id}: ${errorMessage(error)}`);
		}
	}

	function changed() {
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch (error) {
				warn(errorMessage(error));
			}
		}
	}

	function track(child: Child, event: AgentSessionEvent) {
		if (children.get(child.record.id) !== child) return;
		if (event.type === "queue_update" && isWorking(child.record.state)) {
			child.record.steering = [...event.steering];
			changed();
		}
		if (event.type === "message_start" || event.type === "message_update") {
			if (event.message.role === "assistant") child.streaming = event.message;
		} else if (event.type === "message_end") {
			child.streaming = undefined;
		}
		let step: string | undefined | null = null;
		if (event.type === "tool_execution_start") {
			child.tools.set(
				event.toolCallId,
				describeTool(event.toolName, event.args),
			);
			step = [...child.tools.values()].at(-1);
			const path = (event.args as { path?: unknown } | undefined)?.path;
			if (
				(event.toolName === "edit" || event.toolName === "write") &&
				typeof path === "string"
			)
				child.writes.set(
					event.toolCallId,
					changedPath(child.record.worktree, path),
				);
		} else if (event.type === "tool_execution_end") {
			child.tools.delete(event.toolCallId);
			const path = child.writes.get(event.toolCallId);
			child.writes.delete(event.toolCallId);
			if (path !== undefined && !event.isError) child.changed.add(path);
			step = [...child.tools.values()].at(-1);
		} else if (event.type === "message_update" && child.tools.size === 0) {
			const kind = event.assistantMessageEvent.type;
			if (kind.startsWith("thinking")) step = "thinking";
			else if (kind.startsWith("text")) step = "writing";
		}
		for (const follower of [...child.followers]) {
			try {
				follower();
			} catch (error) {
				warn(errorMessage(error));
			}
		}
		if (
			step !== null &&
			step !== child.record.step &&
			child.record.state === "running"
		) {
			child.record.step = step;
			changed();
		}
	}

	function pump() {
		let running = [...children.values()].filter(
			(child) =>
				child.record.state === "running" || child.record.state === "waiting",
		).length;
		while (running < runningLimit && queue.length > 0) {
			const child = queue.shift() as Child;
			running += 1;
			run(child);
		}
	}

	function run(child: Child) {
		child.record.state = "running";
		child.record.startedAt = Date.now();
		trace(child);
		child.watch.start();
		changed();
		child.running = child.handle.run(child.plan.task);
		settleOn(child);
	}

	function settleOn(child: Child) {
		void child.running?.then(
			(text) => finish(child, "completed", text),
			(error: unknown) => finish(child, "failed", errorMessage(error)),
		);
	}

	function finish(
		child: Child,
		state: ChildState,
		text: string,
		deliver = true,
	) {
		const { record } = child;
		if (!isWorking(record.state) || children.get(record.id) !== child) return;
		const queued = queue.indexOf(child);
		if (queued >= 0) queue.splice(queued, 1);
		claims.release(record.id);
		child.watch.stop();
		record.state = state;
		record.text = text;
		record.endedAt = Date.now();
		record.step = undefined;
		const unresolved = child.handle.pendingAuthorizations?.() ?? [];
		if (unresolved.length > 0) record.pendingAuthorizations = unresolved;
		trace(child);
		child.streaming = undefined;
		answer(
			child,
			new Error(
				state === "cancelled"
					? "The child was cancelled."
					: `The child ${state}.`,
			),
		);
		record.steering = undefined;
		try {
			const undelivered = child.handle.clearQueue();
			if (undelivered.length > 0) record.undelivered = undelivered;
		} catch (error) {
			warn(`Child ${record.id}: ${errorMessage(error)}`);
		}
		try {
			child.entries = child.handle.entries();
			if (state === "completed") {
				child.conversation = {
					sessionId: child.handle.sessionId,
					entries: child.entries,
				};
			}
		} catch (error) {
			warn(`Child ${record.id}: ${errorMessage(error)}`);
		}
		void shutDown(child.handle, record.id, child.capture);
		pump();
		changed();
		if (!deliver || consumed.has(record.id)) return;
		pending.push({ ...record });
		try {
			if (options.idle()) queueMicrotask(atBoundary);
		} catch (error) {
			warn(`Child ${record.id}: ${errorMessage(error)}`);
		}
	}

	function answer(child: Child, reply: string | Error) {
		const { question } = child;
		if (!question) return;
		question.release?.();
		child.question = undefined;
		child.record.question = undefined;
		if (child.record.state === "waiting") {
			child.record.state = "running";
			child.record.step = undefined;
			trace(child);
			changed();
		}
		if (reply instanceof Error) question.reject(reply);
		else question.resolve(reply);
	}

	function ask(child: Child, question: string, signal?: AbortSignal) {
		if (signal?.aborted) {
			return Promise.reject(new Error("The call was aborted."));
		}
		if (child.question) {
			return Promise.reject(
				new Error("A question is already waiting for the parent's reply."),
			);
		}
		if (
			children.get(child.record.id) !== child ||
			child.record.state !== "running"
		) {
			return Promise.reject(new Error("The child is not running."));
		}
		child.asked += 1;
		const number = child.asked;
		return new Promise<string>((resolve, reject) => {
			pose(child, { number, signal, resolve, reject });
			child.record.question = number;
			child.record.state = "waiting";
			child.record.step = `asks question ${number}`;
			trace(child);
			changed();
			try {
				flush();
				options.send({
					customType: "pi-workflow-child-question",
					content: `Child ${child.record.id} asks (question ${number}):\n\n${question}\n\nAnswer with reply_child with question ${number}.`,
					display: true,
					details: {
						...childDetails(child.record),
						question: number,
						text: question,
					},
				});
			} catch (error) {
				answer(
					child,
					new Error(
						`The question could not reach the parent: ${errorMessage(error)}`,
					),
				);
			}
		});
	}

	function pose(child: Child, question: Question) {
		const { number, signal } = question;
		const withdraw = () => {
			if (child.question?.number !== number) return;
			child.withdrawn.add(number);
			answer(child, new Error("The call was aborted."));
		};
		child.question = {
			...question,
			release: () => signal?.removeEventListener("abort", withdraw),
		};
		signal?.addEventListener("abort", withdraw, { once: true });
		if (signal?.aborted) withdraw();
	}

	function bind(child: Child) {
		const { port } = child;
		port.event = (event) => {
			child.capture.event(event);
			child.watch.event(event);
			track(child, event);
		};
		port.ask = (question, signal) => ask(child, question, signal);
		port.report = (result) => {
			child.capture.reported(result);
			if (isWorking(child.record.state)) child.record.result = result;
		};
		port.notify = (message) =>
			traceRun(child.record.id, child.plan, child.record.state, undefined, message);
		port.checkpointed = (checkpoint) => {
			child.record.checkpoints = [...(child.record.checkpoints ?? []), checkpoint];
		};
	}

	async function start(
		plan: Plan,
		launch: Parameters<typeof begin>[2],
		from?: { id: string; conversation: Conversation },
	) {
		const id = randomUUID();
		if (plan.role === "worker") {
			const surfaces = plan.surfaces ?? [];
			const found = claims.conflicts(plan.worktree, surfaces);
			if (found.length > 0) {
				return {
					status: "refused" as const,
					warning: "Launch refused. No child was launched.",
					reason: conflictReason(found),
				};
			}
			claims.claim(id, plan.worktree, surfaces);
		}
		let queued = false;
		try {
			const started = await begin(id, plan, launch, from);
			queued = started.status === "queued";
			return started;
		} finally {
			if (!queued) claims.release(id);
		}
	}

	async function begin(
		id: string,
		plan: Plan,
		launch: {
			background: boolean;
			signal?: AbortSignal;
			project: () => ParentProject;
			shell: () => ChildShell;
			onLaunch?: (id: string) => void;
			group?: string;
			todo?: number;
		},
		from?: { id: string; conversation: Conversation },
	) {
		const onLaunch = (id: string) => {
			launch.onLaunch?.(id);
			if (!launch.todo) return;
			linked.set(launch.todo, id);
			options.todo?.set(launch.todo, "in progress");
		};
		if (launch.signal?.aborted) return abortedBeforeLaunch;
		let stall = (_reason: string) => {};
		const watch = createWatch(schedule, (reason) => stall(reason));
		const port: Port = {
			event: (event) => watch.event(event),
			ask: () => Promise.reject<string>(new Error("The child is not running.")),
			report: () => {},
			notify: () => {},
			checkpointed: () => {},
		};
		const launchedIn = generation;
		let handle: ChildHandle;
		try {
			handle = await create({
				authorization: options.authorization,
				sources: options.sources,
				cwd: plan.worktree,
				project: launch.project(),
				role: plan.role,
				model: plan.model,
				thinking: plan.thinking,
				prompt: plan.contract.prompt,
				tools: childTools(plan),
				shell: launch.shell(),
				onEvent: (event) => port.event(event),
				notify: (message) => port.notify(message),
				ask: (question, signal) => port.ask(question, signal),
				report: (result) => port.report(result),
				...(plan.checkpoint ? { checkpoint: plan.checkpoint } : {}),
				checkpointed: (checkpoint) => port.checkpointed(checkpoint),
				entries: from?.conversation.entries,
				parentSession: from?.conversation.sessionId,
			});
		} catch (error) {
			return {
				status: "refused" as const,
				warning: "Launch refused. No child was launched.",
				reason: `The child session could not be created: ${errorMessage(error)}`,
			};
		}
		if (handle.model !== plan.model || handle.thinking !== plan.thinking) {
			void shutDown(handle);
			return {
				status: "pending" as const,
				warning: "The work stays pending. No child was launched.",
				reason: `The child would run ${handle.model ?? "no model"} at ${handle.thinking} instead of the selected ${plan.model} at ${plan.thinking}.`,
			};
		}
		const missing = options.authorization
			? []
			: plan.contract.tools.filter((tool) => !handle.tools.includes(tool));
		if (missing.length > 0) {
			void shutDown(handle);
			return {
				status: "refused" as const,
				warning: "Launch refused. No child was launched.",
				reason: `The child session lacks the contract tools ${missing.join(", ")}.`,
			};
		}
		if (launch.signal?.aborted) {
			void shutDown(handle);
			return abortedBeforeLaunch;
		}
		if (launchedIn !== generation) {
			void shutDown(handle);
			return {
				status: "refused" as const,
				warning: "Launch refused. No child was launched.",
				reason: "The session ended before the child launched.",
			};
		}
		const createdAt = Date.now();
		const capture = options.audit.begin({
			child: id,
			sdkSession: handle.sessionId,
			role: plan.role,
			task: plan.task,
			references: plan.references,
			instructions: plan.contract.prompt,
			tools: handle.tools,
			model: plan.model,
			thinking: plan.thinking,
			worktree: plan.worktree,
			createdAt,
			...(launch.group === undefined ? {} : { group: launch.group }),
			...(from ? { continuedFrom: from.id } : {}),
		});
		if (!launch.background) {
			let ended: ChildState = "failed";
			const stopped = Promise.withResolvers<never>();
			const stop = (state: ChildState, error: Error) => {
				ended = state;
				stopped.reject(error);
				void handle.abort().catch(() => {});
			};
			const abort = () =>
				stop(
					"cancelled",
					new Error("The call was aborted and the child was stopped."),
				);
			launch.signal?.addEventListener("abort", abort, { once: true });
			stall = (reason) =>
				stop("timed out", new Error(`The child timed out: ${reason}`));
			let result: ChildResult | undefined;
			const checkpoints: Checkpoint[] = [];
			port.event = (event) => {
				capture.event(event);
				watch.event(event);
			};
			port.ask = () =>
				Promise.reject<string>(
					new Error(
						"The parent cannot answer: it is waiting for this child in the foreground. Continue without an answer.",
					),
				);
			port.report = (value) => {
				capture.reported(value);
				result = value;
			};
			port.checkpointed = (checkpoint) => {
				checkpoints.push(checkpoint);
			};
			port.notify = (message) =>
				traceRun(id, plan, "running", undefined, message);
			watch.start();
			onLaunch(id);
			traceRun(id, plan, "running");
			try {
				const text = await Promise.race([
					handle.run(plan.task),
					stopped.promise,
				]);
				traceRun(id, plan, "completed", result);
				const unresolved = handle.pendingAuthorizations?.() ?? [];
				if (unresolved.length > 0)
					return {
						status: "pending" as const,
						launched: true as const,
						text, result, checkpoints,
						pendingAuthorizations: unresolved,
						warning: "The foreground child returned unresolved authority. No held action executed; consult the parent/user, then explicitly re-propose in a fresh authorized run. continue_child does not recover this foreground session.",
						reason: "Authorization consultation remains pending.",
					};
				return { status: "completed" as const, text, result, checkpoints };
			} catch (error) {
				traceRun(id, plan, ended);
				const unresolved = handle.pendingAuthorizations?.() ?? [];
				if (checkpoints.length === 0 && unresolved.length === 0) throw error;
				const pending = unresolved.length === 0
					? ""
					: `\n\nUnresolved authorization proposals (no held action executed):\n${JSON.stringify(unresolved)}`;
				throw new Error(`${errorMessage(error)}${checkpointLines(checkpoints)}${pending}`, {
					cause: error,
				});
			} finally {
				watch.stop();
				launch.signal?.removeEventListener("abort", abort);
				void shutDown(handle, id, capture);
			}
		}
		const child: Child = {
			record: {
				id,
				role: plan.role,
				task: plan.task,
				worktree: plan.worktree,
				model: plan.model,
				thinking: plan.thinking,
				state: "queued",
				createdAt,
				continuedFrom: from?.id,
				...(launch.group === undefined ? {} : { group: launch.group }),
				...(launch.todo === undefined ? {} : { todo: launch.todo }),
			},
			plan,
			handle,
			port,
			watch,
			capture,
			tools: new Map(),
			writes: new Map(),
			changed: new Set(),
			followers: new Set(),
			asked: 0,
			answers: new Map(),
			withdrawn: new Set(),
		};
		stall = (reason) => finish(child, "timed out", reason);
		bind(child);
		children.set(child.record.id, child);
		queue.push(child);
		onLaunch(child.record.id);
		trace(child);
		changed();
		queueMicrotask(pump);
		return { status: "queued" as const, id: child.record.id };
	}

	async function resume(
		id: string,
		task: string,
		launch: {
			signal?: AbortSignal;
			project: () => ParentProject;
			shell: () => ChildShell;
		},
	) {
		const child = children.get(id);
		const refuse = (reason: string) => ({
			status: "refused" as const,
			warning: "Continue refused. No child was launched.",
			reason,
		});
		if (!child) return refuse(`No child ${id} in this session.`);
		if (!child.conversation) {
			return refuse(
				`Child ${id} is ${child.record.state}; only a completed child can be continued.`,
			);
		}
		const release = reserve();
		if (!release) return refuse(launchLimitReason);
		try {
			const { todo } = child.record;
			const started = await start(
				{ ...child.plan, task },
				{ ...launch, background: true, ...(todo === undefined ? {} : { todo }) },
				{ id, conversation: child.conversation },
			);
			if (started.status !== "queued") return started;
			consume(id);
			if (todo === undefined || !options.todo) return started;
			return {
				...started,
				note: taskChange(options.todo, todo, "in progress").note,
			};
		} finally {
			release();
		}
	}

	function reserve() {
		if (working() + reserved >= launchLimit) return undefined;
		reserved += 1;
		return () => {
			reserved -= 1;
		};
	}

	function reply(id: string, number: number, text: string, by: Answerer) {
		const child = children.get(id);
		if (!child) throw new Error(`No child ${id} in this session.`);
		const first = child.answers.get(number);
		if (first) {
			throw new Error(
				`Question ${number} of child ${id} was already answered by the ${first.by}: ${first.text}`,
			);
		}
		if (child.withdrawn.has(number)) {
			throw new Error(
				`Question ${number} of child ${id} was withdrawn: the call that asked it ended.`,
			);
		}
		if (!isWorking(child.record.state)) {
			throw new Error(
				`Child ${id} is ${child.record.state}; question ${number} can no longer be answered.`,
			);
		}
		if (child.question?.number !== number) {
			throw new Error(
				`Question ${number} of child ${id} is not waiting for a reply.`,
			);
		}
		child.answers.set(number, { by, text });
		child.capture.answered(number, text);
		answer(child, text);
	}

	async function steer(id: string, text: string) {
		const child = children.get(id);
		if (!child) throw new Error(`No child ${id} in this session.`);
		if (child.record.state !== "running") {
			throw new Error(
				`Child ${id} is ${child.record.state}; only a running child can be steered.`,
			);
		}
		if (text.trim().startsWith("/")) {
			throw new Error("A Steer cannot begin with /.");
		}
		await child.handle.steer(text);
	}

	function cancel(id: string, deliver: boolean) {
		const child = children.get(id);
		if (!child)
			return { cancelled: false, message: `No child ${id} in this session.` };
		if (!isWorking(child.record.state)) {
			return {
				cancelled: false,
				message: `Child ${id} is ${child.record.state}; only a queued, running, or waiting child can be cancelled.`,
			};
		}
		finish(child, "cancelled", "The child was cancelled.", deliver);
		return { cancelled: true, message: `Child ${id} cancelled.` };
	}

	function linkedSettlement(task: number, id: string, run: TaskRun) {
		if (!options.todo) return undefined;
		if (linked.get(task) !== id) {
			return {
				note: `Task #${task} is linked to a later child, so no Task state was applied.`,
			};
		}
		return taskChange(options.todo, task, finalTaskState(run));
	}

	function settlement(id: string) {
		const record = children.get(id)?.record;
		if (record?.todo === undefined || consumed.has(id)) return undefined;
		return linkedSettlement(record.todo, id, record);
	}

	function settle(task: number, id: string, run: TaskRun) {
		const settled = linkedSettlement(task, id, run);
		settled?.apply?.();
		return settled?.note;
	}

	function consume(id: string, settled = settlement(id)) {
		consumed.add(id);
		pending = pending.filter((record) => record.id !== id);
		settled?.apply?.();
		return settled?.note;
	}

	function atBoundary() {
		if (
			pending.some(
				(record) => !needsNoReason(record.state, record.result?.verdict),
			) ||
			![...children.values()].some((child) => isWorking(child.record.state))
		)
			flush();
	}

	function flush() {
		const results = [...pending];
		if (results.length === 0) return;
		const settled = results.map((record) => settlement(record.id));
		try {
			options.send({
				customType: "pi-workflow-child-result",
				content: results
					.map((record, index) =>
						withNote(childOutcome(record), settled[index]?.note),
					)
					.join("\n\n"),
				display: true,
				details:
					results.length === 1
						? childDetails(results[0])
						: { results: results.map((child) => childDetails(child)) },
			});
			for (const [index, child] of results.entries()) {
				consume(child.id, settled[index]);
			}
		} catch (error) {
			warn(`Child results could not be delivered: ${errorMessage(error)}`);
		}
	}

	function get(id: string): ChildRecord | undefined {
		const child = children.get(id);
		return child && { ...child.record };
	}

	function list(): ChildRecord[] {
		return [...children.values()].map((child) => ({ ...child.record }));
	}

	function changedFiles(id: string) {
		return [...(children.get(id)?.changed ?? [])];
	}

	function working() {
		return [...children.values()].filter((child) =>
			isWorking(child.record.state),
		).length;
	}

	function waiting() {
		return [...children.values()].some(
			(child) => child.record.state === "waiting",
		);
	}

	function subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function follow(id: string, listener: () => void) {
		const followers = children.get(id)?.followers;
		followers?.add(listener);
		return () => {
			followers?.delete(listener);
		};
	}

	function thread(id: string) {
		const child = children.get(id);
		if (!child) return undefined;
		if (child.entries) return { entries: child.entries };
		return { entries: child.handle.entries(), streaming: child.streaming };
	}

	async function disposeAll() {
		generation += 1;
		const working = [...children.values()].filter((child) =>
			isWorking(child.record.state),
		);
		children.clear();
		claims.rebuild([]);
		linked.clear();
		queue.length = 0;
		pending = [];
		for (const child of working) {
			child.watch.stop();
			answer(child, new Error("The session ended."));
		}
		changed();
		const finishing = Promise.all(disposing);
		await Promise.all(
			working.map((child) =>
				shutDown(child.handle, child.record.id, child.capture),
			),
		);
		await within(finishing);
		return working.length;
	}

	async function detach(): Promise<ResidentChildren> {
		generation += 1;
		const resident = {
			children: [...children.values()].map((child) => {
				child.watch.stop();
				child.question?.release?.();
				return { child, held: hold(child.port) };
			}),
			queue: queue.map((child) => child.record.id),
			consumed: new Set(consumed),
			linked: new Map(linked),
			pending,
		};
		children.clear();
		claims.rebuild([]);
		linked.clear();
		consumed.clear();
		queue.length = 0;
		pending = [];
		changed();
		await within(Promise.all(disposing));
		return resident;
	}

	function adopt(resident: ResidentChildren) {
		for (const { child: kept, held } of resident.children) {
			const child: Child = {
				...kept,
				watch: createWatch(schedule, (reason) =>
					finish(child, "timed out", reason),
				),
				capture: options.audit.resume(kept.record.id),
				followers: new Set(),
				question: undefined,
			};
			children.set(child.record.id, child);
			bind(child);
			if (kept.question) pose(child, kept.question);
			if (child.record.state === "running" || child.record.state === "waiting") {
				child.watch.start();
				settleOn(child);
			}
			for (const replay of held) replay(child.port);
		}
		for (const id of resident.queue) queue.push(children.get(id) as Child);
		for (const id of resident.consumed) consumed.add(id);
		for (const [task, id] of resident.linked) linked.set(task, id);
		pending = [...resident.pending];
		claims.rebuild(
			[...children.values()]
				.filter(({ plan, record }) => plan.role === "worker" && isWorking(record.state))
				.map(({ plan, record }) => ({
					owner: record.id,
					root: plan.worktree,
					surfaces: plan.surfaces ?? [],
				})),
		);
		changed();
		queueMicrotask(pump);
		if (pending.length > 0 && options.idle()) queueMicrotask(atBoundary);
	}

	return {
		start,
		resume,
		reserve,
		reply,
		steer,
		cancel,
		consume,
		settle,
		latestLinked: (task: number) => linked.get(task),
		atBoundary,
		get,
		list,
		changedFiles,
		working,
		waiting,
		subscribe,
		follow,
		thread,
		disposeAll,
		detach,
		adopt,
	};
}

const spawnChildParameters = Type.Object({
	task: Type.String({
		description:
			"The bounded task. For implementation or verification, include relevant available acceptance criteria and changed-file/diff context; include known validation commands/results as context, never as a substitute for a verifier's independent checks. Exploration may discover context directly from the worktree.",
	}),
	role: Type.Optional(
		Type.String({
			description:
				"explore, worker, or verify. When Jev routing is off, the role you pass decides and omitting it does not choose worker. When on, the role is still required and the parent chooses it; Jev does not.",
		}),
	),
	worktree: Type.Optional(
		Type.String({
			description:
				"An existing Git root for the child to work in. Defaults to the current Git root.",
		}),
	),
	checkpoint: Type.Optional(
		Type.String({
			description:
				"Name the assigned checkpoint branch. This context descriptor is not commit authority. The active session policy determines availability and context requirements; task authorization, signing, scope and protection of others' work still apply.",
		}),
	),
	surfaces: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Worker only: the repository-relative paths or globs the worker may edit. A worker whose surfaces overlap those of a working worker in the same worktree is refused. Omitted, the worker claims the whole checkout. Other roles claim nothing.",
		}),
	),
	references: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Paths under the current directory the child must read. The launch is refused when one does not exist or resolves outside it.",
		}),
	),
	todo: Type.Optional(
		Type.Integer({
			description:
				"The id of the Todo task this child executes. The task becomes in progress when the launch is accepted. The launch is refused when the task does not exist, is done, or the Todo is not seated.",
		}),
	),
	background: Type.Optional(
		Type.Literal(true, {
			description:
				"Ask for a background child. Sessions that can receive a later result always run children in the background; print and json modes refuse it.",
		}),
	),
});

type Outcome = {
	warning: string;
	reason: string;
	warnings?: string[];
	jev?: ClassifierResult;
};

const launchLimitReason = `The parent already has ${launchLimit} working children (queued, running, or waiting). Launch more after some of them end.`;

const unseatedMessage = "Child session is not seated. Run /workflow:config.";

function unseatedChild() {
	if (seated("child-session", "overlay")) return undefined;
	return report([unseatedMessage], { status: "refused" });
}

function report(lines: string[], details: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details,
	};
}

function notLaunched(status: string, outcome: Outcome) {
	return report(
		[...(outcome.warnings ?? []), outcome.warning, `Reason: ${outcome.reason}`],
		{
			status,
			reason: outcome.reason,
			...(outcome.jev ? { jev: outcome.jev } : {}),
		},
	);
}

function userText(content: UserMessage["content"]): string {
	if (typeof content === "string") return content.trim();
	return content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n")
		.trim();
}

export function latestUserRequest(
	entries: readonly SessionEntry[] | undefined,
): { id: string; text: string } | undefined {
	if (!entries) return undefined;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "user") continue;
		const text = userText(entry.message.content);
		if (text.length > 0) return { id: entry.id, text };
	}
	return undefined;
}

function sessionBranch(ctx: {
	sessionManager?: Pick<ExtensionContext["sessionManager"], "getBranch">;
}): readonly SessionEntry[] | undefined {
	return ctx.sessionManager?.getBranch();
}

export function createSpawnChildTool(
	launcher: ReturnType<typeof createChildLauncher>,
	sessions: ReturnType<typeof createChildSessions>,
	todo: { claim(id: number): TodoClaim },
	contextual = false,
): ToolDefinition<typeof spawnChildParameters, Record<string, unknown>> {
	return {
		name: "spawn_child",
		label: "Spawn Child",
		description:
			"Delegate a bounded task to a child session that runs under a harness contract. When Jev routing is on, the harness decides whether the work leaves this session. The active profile picks the model for the role. In an interactive session the call returns the child id at once and the result arrives later as a message; in print and json modes the result returns in the same call.",
		promptSnippet: "Delegate a bounded task to a child session",
		promptGuidelines: contextual
			? [
					"Pass the bounded task and role (explore, worker, verify). Roles guide work and Verdicts, not tool permission. Use common sources/configuration with local instantiation and task authority; Jev chooses only destination.",
					"Discover mandatory procedures and track owners, prerequisites, evidence and remaining obligations before dependent work. Preserve signing, scope, others' work and applicable confirmations. Any role may make a task-authorized signed scoped commit in its assigned authorized context. Tool availability or a checkpoint descriptor is not authority; preserve isolation where interference is possible and consult on uncertainty. Commit does not authorize publication.",
					"Scope expansion, undelegated choices, unknown effects/ownership and high-impact actions require applicable consultation/confirmation. Held actions cannot execute; tool availability, replies and Run state do not grant authority. A failure is not consent.",
					"Reconcile each child's evidence and remaining obligations. End the turn after background launch and receive its result rather than polling. Independent review stays independent. Child session limits and actual delivery semantics remain unchanged.",
				]
			: [
					"Pass the task and the role (explore, worker, or verify). The parent chooses the role and it determines the contract; Jev decides only the destination. Choose the role whose tools cover the task; a role named by a skill is a hint. Fixed tools per role (explore: read, grep, find, ls, codegraph, codemode; worker: read, bash, edit, write, grep, find, ls, codemode; verify: read, bash, grep, find, ls, codegraph, codemode), plus MCP and web tools added at runtime. Explore reads and queries CodeGraph and cannot run commands; verify independently checks completed work and may run checks and tests without editing; worker implements and runs commands. Give a brief with the scope, acceptance criteria, and edit surface; assign any reading needed before a write to the worker.",
					"Children communicate only with the parent, never directly with the user.",
					"Before dependent work, learn the obligations of any mandatory procedure: read it when routing and delegation mode allow, otherwise delegate its discovery. Track each obligation with an owner and a state (pending, satisfied with evidence, or blocked with reason) across child questions, scope changes, and background results. An unmet mandatory prerequisite stops dependent work; do not continue it as qualified partial work.",
					"Do not delegate mutating git or gh commands or publication: they are reserved for the parent and stay with it; when a procedure requires them, such as worktree setup, the parent runs them itself before dependent child work; if routing blocks them, delegate discovery first and run them after its result arrives. The one exception: you may grant checkpoint, with the branch of an isolated worktree you created, to a worker, which then commits its own signed checkpoints on that branch. Before integrating, verify that each returned SHA is on that branch, descends from the base, and contains the expected change; integration, integration checks, push, pull requests, and tracker effects stay with you. Without the grant, the worker hands over a verified tree and lists the commit for you. Do not ask the child for intermediate progress reports. Copy evidence you already have into the task; references accept only paths inside the cwd. There is no channel to a running child; use reply_child only when the child asks.",
					"A refusal or a queued id is not a completed result and is not retried. After a background child is queued, end your turn: its result wakes you. Do not poll with sleep, list_children, child_status, or child_result.",
					`One codemode script can launch several children: each spawn_child call returns at once without awaiting the child. Their results arrive in one message when every child is done, or earlier when a result needs you. In print and json modes each call waits for its child instead. At most ${launchLimit} children can be queued, running, or waiting at once; a launch beyond that is refused.`,
					"Do not declare work done without a worker Verdict of done and its files_changed, validation, and left_undone fields. Do not declare work verified without a verifier Verdict of pass and its findings and unverified fields; partial, fail, and blocked are not success. A child's done or pass covers only its task: reconcile left_undone and unverified against the remaining obligations, then continue or report an explicit blocker.",
					"When Jev routing is on, the parent asks once per user turn before read, grep, find, ls, edit, write, bash, powershell, or codegraph query and explore. A block that says to delegate means call spawn_child with the role you choose. A block that says to ask the user one question means ask that one question and wait. Reads of AGENTS.md, GLOSSARY.md, and docs/agents/*.md stay available, and so does codegraph init.",
				],
		parameters: spawnChildParameters,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const claim =
				params.todo === undefined ? undefined : todo.claim(params.todo);
			if (claim && "reason" in claim) {
				return notLaunched("refused", {
					warning: "Launch refused. No child was launched.",
					reason: claim.reason,
				});
			}
			let child: string | undefined;
			const settle = (run: TaskRun) =>
				claim && child
					? sessions.settle(claim.task.id, child, run)
					: undefined;
			const background = ctx.mode === "tui" || ctx.mode === "rpc";
			if (params.background && !background) {
				return notLaunched("refused", {
					warning: "Launch refused. No child was launched.",
					reason: `${ctx.mode} mode runs the child in the foreground and cannot run it in the background.`,
				});
			}
			const release = background ? sessions.reserve() : () => {};
			if (!release) {
				return notLaunched("refused", {
					warning: "Launch refused. No child was launched.",
					reason: launchLimitReason,
				});
			}
			try {
				const userRequest = latestUserRequest(sessionBranch(ctx));
				const plan = await launcher.prepareLaunch(
					{
						role: params.role ?? undefined,
						task: params.task,
						worktree: params.worktree,
						checkpoint: params.checkpoint,
						references: params.references,
						surfaces: params.surfaces,
						...(userRequest
							? { userRequest: userRequest.text, userMessageId: userRequest.id }
							: {}),
					},
					ctx,
				);
				if (plan.kind !== "ready") return notLaunched("refused", plan);
				const started = await sessions
					.start(plan, {
						background,
						signal,
						project: () => parentProject(ctx),
						shell: () => shellOptions(ctx),
						onLaunch: (id) => {
							child = id;
							launcher.recordLaunch(userRequest?.id);
						},
						group: /^([\s\S]+)\/\d+$/.exec(toolCallId)?.[1],
						...(claim ? { todo: claim.task.id } : {}),
					})
					.catch((error: unknown) => {
						const note = settle({
							state: signal?.aborted ? "cancelled" : "failed",
							role: plan.role,
						});
						if (!note) throw error;
						throw new Error(withNote(errorMessage(error), note), {
							cause: error,
						});
					});
				const note =
					started.status === "completed"
						? settle({
								state: "completed",
								role: plan.role,
								result: started.result,
							})
						: undefined;
				return launched(
					started,
					plan.warnings,
					{
						role: plan.role,
						...(plan.jev ? { jev: plan.jev } : {}),
					},
					note,
				);
			} finally {
				release();
			}
		},
	};
}

function launched(
	started: Awaited<ReturnType<ReturnType<typeof createChildSessions>["start"]>>,
	warnings: string[],
	selection?: { role: string; jev?: ClassifierResult },
	note?: string,
) {
	if (started.status === "pending" && "pendingAuthorizations" in started) {
		return report(
			[...warnings, started.warning, JSON.stringify(started.pendingAuthorizations)],
			{ ...started, warnings },
		);
	}
	if (started.status === "refused" || started.status === "pending") {
		return notLaunched(started.status, {
			...started,
			warnings,
			...(selection?.jev ? { jev: selection.jev } : {}),
		});
	}
	const selected = selection
		? {
				role: selection.role,
				...(selection.jev ? { jev: selection.jev } : {}),
			}
		: {};
	const selectionLine = selection ? `Launched as ${selection.role}.` : undefined;
	if (started.status === "completed") {
		const outcome = selection
			? childOutcome({
					...selection,
					state: "completed",
					text: started.text,
					result: started.result,
					checkpoints: started.checkpoints,
				})
			: started.text;
		return report([...warnings, withNote(outcome, note)], {
			status: "completed",
			...(selection
				? { verdict: started.result?.verdict, result: started.result }
				: {}),
			...(started.checkpoints.length > 0
				? { checkpoints: started.checkpoints }
				: {}),
			...selected,
		});
	}
	return report(
		[
			...warnings,
			`Child ${started.id} is queued in the background. Its result arrives later as a message. End your turn and do not poll; the result wakes you.`,
			...(selectionLine ? [selectionLine] : []),
			...(note ? [note] : []),
		],
		{ status: started.status, id: started.id, ...selected },
	);
}

const continueChildParameters = Type.Object({
	id: Type.String({ description: "The id of a completed child." }),
	task: Type.String({
		description: "The follow-up task for the child's saved conversation.",
	}),
});

export function createContinueChildTool(
	sessions: ReturnType<typeof createChildSessions>,
): ToolDefinition<typeof continueChildParameters, Record<string, unknown>> {
	return {
		name: "continue_child",
		label: "Continue Child",
		description:
			"Start a new background child from the saved conversation of a completed child, with a follow-up task. The completed child keeps its record; the new child has its own id and runs on the same contract, model, and thinking.",
		promptGuidelines: [
			"continue_child accepts only a completed child; failed, cancelled, and timed-out children are not continued.",
		],
		parameters: continueChildParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const started = await sessions.resume(params.id, params.task, {
				signal,
				project: () => parentProject(ctx),
				shell: () => shellOptions(ctx),
			});
			return launched(
				started,
				[],
				undefined,
				"note" in started ? started.note : undefined,
			);
		},
	};
}

function describeChild(child: ChildRecord) {
	const times = [
		`created ${new Date(child.createdAt).toISOString()}`,
		child.startedAt && `started ${new Date(child.startedAt).toISOString()}`,
		child.endedAt && `ended ${new Date(child.endedAt).toISOString()}`,
	].filter(Boolean);
	return [
		child.id,
		child.role,
		child.state,
		`${child.model} ${child.thinking}`,
		...times,
	].join(" · ");
}

function describeChildren(children: ChildRecord[]) {
	return children.length > 0
		? children.map(describeChild)
		: ["No children in this session."];
}

const childIdParameters = Type.Object({
	id: Type.String({ description: "The child id that spawn_child returned." }),
});

const replyChildParameters = Type.Object({
	id: Type.String({ description: "The id of the child waiting for a reply." }),
	question: Type.Integer({
		description: "The question number from the child's question message.",
	}),
	answer: Type.String({ description: "The answer to the child's question." }),
});

function unknownChild(id: string) {
	return report([`No child ${id} in this session.`], { id });
}

export function createChildQueryTools(
	sessions: ReturnType<typeof createChildSessions>,
) {
	const listChildren: ToolDefinition<
		ReturnType<typeof Type.Object>,
		Record<string, unknown>
	> = {
		name: "list_children",
		label: "List Children",
		description:
			"List the child sessions of this session with their role, state, model, and times.",
		parameters: Type.Object({}),
		async execute() {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const children = sessions.list();
			return report(describeChildren(children), { children });
		},
	};
	const childStatus: ToolDefinition<
		typeof childIdParameters,
		Record<string, unknown>
	> = {
		name: "child_status",
		label: "Child Status",
		description: "Show the state of one child session.",
		parameters: childIdParameters,
		async execute(_toolCallId, params) {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const child = sessions.get(params.id);
			if (!child) return unknownChild(params.id);
			return report([describeChild(child)], { child });
		},
	};
	const childResult: ToolDefinition<
		typeof childIdParameters,
		Record<string, unknown>
	> = {
		name: "child_result",
		label: "Child Result",
		description:
			"Return the final text of a child session that has ended: its answer, or why it did not complete.",
		parameters: childIdParameters,
		async execute(_toolCallId, params) {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const child = sessions.get(params.id);
			if (!child) return unknownChild(params.id);
			if (child.text === undefined) {
				return report(
					[`Child ${child.id} is ${child.state} and has no result yet.`],
					{ id: child.id, state: child.state },
				);
			}
			const outcome = childOutcome(child);
			return report([withNote(outcome, sessions.consume(child.id))], {
				id: child.id,
				state: child.state,
			});
		},
	};
	const cancelChild: ToolDefinition<
		typeof childIdParameters,
		Record<string, unknown>
	> = {
		name: "cancel_child",
		label: "Cancel Child",
		description: "Cancel a queued, running, or waiting child session.",
		parameters: childIdParameters,
		async execute(_toolCallId, params) {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const { cancelled, message } = sessions.cancel(params.id, false);
			const note = cancelled ? sessions.consume(params.id) : undefined;
			const child = sessions.get(params.id);
			return report([withNote(message, note)], {
				id: params.id,
				state: child?.state,
			});
		},
	};
	const replyChild: ToolDefinition<
		typeof replyChildParameters,
		Record<string, unknown>
	> = {
		name: "reply_child",
		label: "Reply Child",
		description:
			"Answer the question a child session is waiting on, naming the question number from its message. A reply to a question that is not waiting is refused.",
		parameters: replyChildParameters,
		async execute(_toolCallId, params) {
			sessions.reply(params.id, params.question, params.answer, "parent");
			return report([`Reply sent to child ${params.id}.`], {
				id: params.id,
				question: params.question,
			});
		},
		renderShell: "self",
		renderCall: () => hidden,
		renderResult: (result, _options, theme, context) =>
			answerCard(
				context.args,
				theme,
				context.lastComponent,
				context.isError ? outputText(result) : undefined,
			),
	};
	return [listChildren, childStatus, childResult, cancelChild, replyChild];
}
