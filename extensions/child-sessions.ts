import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
	AssistantMessage,
	ClassifierResult,
	ModelThinkingLevel,
	UserMessage,
} from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	createAgentSession,
	createCodemodeExtension,
	createMcpExtension,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionFactory,
	type ExtensionHandler,
	getAgentDir,
	type ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { type ChildShell, createChildBashTool } from "./child-bash.ts";
import type { createChildLauncher } from "./child-launcher.ts";
import { createChildCodeGraphTool } from "./codegraph-tool.ts";
import { answerCard } from "./child-result-card.ts";
import { hidden, outputText } from "./compact-tools.ts";
import { type Schedule, scheduleTimer } from "./clock.ts";
import { seated } from "./shell.ts";
import { errorMessage } from "./error-message.ts";
import {
	explorerWeb,
	type ParentProject,
	webAccessTools,
} from "./web-access.ts";
import {
	type ChildResult,
	childOutcome,
	needsNoReason,
	projectChild,
	reportsResult,
	resultParameters,
	verdictNeedsNoReason,
} from "./child-projection.ts";
import { shellOptions } from "./shell-settings.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";
import type { TodoClaim } from "./todo-extension.ts";
import type { TaskState } from "./todo-list.ts";

const packageVersion = (
	JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string }
).version;

interface ChildSpec {
	cwd: string;
	project: ParentProject;
	role: string;
	model: string;
	thinking: ModelThinkingLevel;
	prompt: string;
	tools: string[];
	modelRegistry: ExtensionContext["modelRegistry"];
	shell: ChildShell;
	onEvent(event: AgentSessionEvent): void;
	notify(message: string): void;
	ask(question: string, signal?: AbortSignal): Promise<string>;
	report(result: ChildResult): void;
	entries?: SessionEntry[];
	parentSession?: string;
}

interface Conversation {
	sessionId: string;
	entries: SessionEntry[];
}

interface ChildHandle {
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
}

export type ChildSessionFactory = (spec: ChildSpec) => Promise<ChildHandle>;

type Plan = {
	role: string;
	contract: { prompt: string; tools: string[] };
	task: string;
	worktree: string;
	model: string;
	thinking: ModelThinkingLevel;
	chosenBy: "parent" | "jev";
	references: string[];
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
	todo?: { id: number; text: string };
	step?: string;
	question?: number;
	steering?: string[];
	undelivered?: string[];
}

export type Answerer = "parent" | "operator";

interface Child {
	record: ChildRecord;
	plan: Plan;
	handle: ChildHandle;
	watch: ReturnType<typeof createWatch>;
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
	question?: {
		number: number;
		resolve(answer: string): void;
		reject(error: Error): void;
	};
}

export interface ChildTrace {
	id: string;
	role: string;
	chosenBy: "parent" | "jev";
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
	};
}

export type ChildDetails = ReturnType<typeof childDetails> & {
	question?: number;
};

function parentRuntime(
	registry: ExtensionContext["modelRegistry"],
): ModelRuntime | undefined {
	// Extensions only see the ModelRegistry facade; its private runtime carries the
	// parent's extension-registered providers and runtime API keys.
	const runtime = (registry as unknown as { runtime?: Partial<ModelRuntime> })
		.runtime;
	return typeof runtime?.getModel === "function"
		? (runtime as ModelRuntime)
		: undefined;
}

function parentProject(ctx: ExtensionContext): ParentProject {
	return { cwd: ctx.cwd, trusted: ctx.isProjectTrusted() };
}

const askParentTool = "ask_parent";
const reportResultTool = "report_result";

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
	];
}

const askParentParameters = Type.Object({
	question: Type.String({ description: "One question for the parent." }),
});

export function createAskParentTool(
	ask: (question: string, signal?: AbortSignal) => Promise<string>,
) {
	return {
		name: askParentTool,
		label: "Ask Parent",
		description:
			"Ask the parent session one question and wait for its answer. Use it only when you are blocked and the answer changes your next step; a command reserved for the parent is not a reason to ask. An error result means no answer will come; continue without one.",
		parameters: askParentParameters,
		async execute(
			_toolCallId: string,
			params: Static<typeof askParentParameters>,
			signal?: AbortSignal,
		) {
			return {
				content: [
					{ type: "text" as const, text: await ask(params.question, signal) },
				],
				details: {},
			};
		},
	};
}

function parentMcp(project: ParentProject): ExtensionFactory {
	const mcp = createMcpExtension();
	// Pi does not export its MCP config loader, and its default loader reads the session's cwd,
	// which for a child is the worktree.
	const atParentProject = (ctx: ExtensionContext): ExtensionContext =>
		Object.create(ctx, { cwd: { value: project.cwd } });
	return (pi) =>
		mcp({
			...pi,
			on: (event: string, handler: ExtensionHandler<unknown>) =>
				pi.on(
					event as "session_start",
					event === "session_start"
						? (payload, ctx) => handler(payload, atParentProject(ctx))
						: handler,
				),
		} as ExtensionAPI);
}

export const createPiChildSession: ChildSessionFactory = async (spec) => {
	const runtime = parentRuntime(spec.modelRegistry);
	if (!runtime) {
		throw new Error("The session's model runtime is not available.");
	}
	const slash = spec.model.indexOf("/");
	const settingsManager = SettingsManager.inMemory(
		{},
		{ projectTrusted: spec.project.trusted },
	);
	const agentDir = getAgentDir();
	const web =
		spec.role === "explore"
			? await explorerWeb(agentDir, spec.project)
			: { factories: [], problem: undefined };
	const resourceLoader = new DefaultResourceLoader({
		cwd: spec.cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		extensionFactories: [
			createCodemodeExtension({ models: false }),
			parentMcp(spec.project),
			...web.factories,
		],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: spec.role === "explore",
		systemPromptOverride: () => spec.prompt,
		appendSystemPromptOverride: () => [],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: spec.cwd,
		modelRuntime: runtime,
		model: runtime.getModel(
			spec.model.slice(0, slash),
			spec.model.slice(slash + 1),
		),
		thinkingLevel: spec.thinking,
		tools: spec.tools,
		customTools: [
			createChildBashTool(spec.cwd, spec.shell),
			createChildCodeGraphTool(spec.cwd),
			createAskParentTool(spec.ask),
			...(reportsResult(spec.role)
				? [
						{
							name: reportResultTool,
							label: "Report Result",
							description:
								"Report your Verdict and result to the parent before your final answer. Call it again to correct it; the last call counts.",
							parameters: resultParameters[spec.role],
							async execute(_toolCallId: string, params: ChildResult) {
								if (
									!params.reason &&
									!verdictNeedsNoReason(params.verdict)
								) {
									throw new Error(
										`A ${params.verdict} Verdict needs a reason.`,
									);
								}
								spec.report(params);
								return {
									content: [
										{ type: "text" as const, text: "Result recorded." },
									],
									details: {},
								};
							},
						},
					]
				: []),
		],
		resourceLoader,
		sessionManager: SessionManager.inMemory(
			spec.cwd,
			{ parentSession: spec.parentSession },
			spec.entries,
		),
		settingsManager,
	});
	session.subscribe((event) => spec.onEvent(event));
	let stopped = false;
	const stream = session.agent.streamFunction;
	// abort() and dispose() do not cancel a prompt still preparing its run, so the
	// run it later starts must be stopped before its provider request.
	session.agent.streamFunction = (...args) => {
		if (stopped) throw new Error("The child session was stopped.");
		return stream(...args);
	};
	return {
		sessionId: session.sessionId,
		entries: () => session.sessionManager.getEntries(),
		model: session.model && `${session.model.provider}/${session.model.id}`,
		thinking: session.thinkingLevel,
		tools: session.getActiveToolNames(),
		async run(task) {
			if (web.problem) spec.notify(web.problem);
			await session.bindExtensions({
				uiContext: {
					...session.extensionRunner.getUIContext(),
					notify: (message) => spec.notify(message),
				},
			});
			await session.prompt(task);
			const last = session.messages.at(-1);
			if (
				last?.role === "assistant" &&
				(last.stopReason === "error" || last.stopReason === "aborted")
			) {
				throw new Error(
					last.errorMessage ?? `The child run ${last.stopReason}.`,
				);
			}
			return session.getLastAssistantText() ?? "";
		},
		async steer(text) {
			await session.steer(text);
		},
		clearQueue: () => session.clearQueue().steering,
		abort: () => {
			stopped = true;
			return session.abort();
		},
		async dispose() {
			stopped = true;
			try {
				const runner = session.extensionRunner;
				if (runner.hasHandlers("session_shutdown")) {
					await runner.emit({ type: "session_shutdown", reason: "quit" });
				}
			} finally {
				session.dispose();
			}
		},
	};
};

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

function finalTaskState(child: {
	state: string;
	role: string;
	result?: ChildResult;
}): TaskState {
	if (child.state === "cancelled") return "pending";
	if (child.state !== "completed") return "blocked";
	if (!reportsResult(child.role)) return "done";
	return child.result?.verdict === "done" || child.result?.verdict === "pass"
		? "done"
		: "blocked";
}

function appliedNote(id: number, state: TaskState) {
	return `Task #${id} is now ${state}.`;
}

function withNote(outcome: string, note: string | undefined) {
	return note ? `${outcome}\n\n${note}` : outcome;
}

type TodoLink = {
	has(id: number): boolean;
	set(id: number, state: TaskState): boolean;
};

export function createChildSessions(options: {
	create?: ChildSessionFactory;
	send: (message: ChildMessage) => void;
	idle: () => boolean;
	trace: (entry: ChildTrace) => void;
	report: (message: string) => void;
	schedule?: Schedule;
	todo?: TodoLink;
}) {
	const create = options.create ?? createPiChildSession;
	const schedule = options.schedule ?? scheduleTimer;
	const children = new Map<string, Child>();
	const queue: Child[] = [];
	const consumed = new Set<string>();
	let pending: ChildRecord[] = [];
	const listeners = new Set<() => void>();
	let generation = 0;
	let reserved = 0;

	function warn(message: string) {
		try {
			options.report(message);
		} catch {}
	}

	function shutDown(handle: ChildHandle, id?: string) {
		return handle
			.dispose()
			.catch((error: unknown) =>
				warn(id ? `Child ${id}: ${errorMessage(error)}` : errorMessage(error)),
			);
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
		void child.handle.run(child.plan.task).then(
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
		child.watch.stop();
		record.state = state;
		record.text = text;
		record.endedAt = Date.now();
		record.step = undefined;
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
		void shutDown(child.handle, record.id);
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
			const withdraw = () => {
				if (child.question?.number !== number) return;
				child.withdrawn.add(number);
				answer(child, new Error("The call was aborted."));
			};
			signal?.addEventListener("abort", withdraw, { once: true });
			child.question = {
				number,
				resolve(reply) {
					signal?.removeEventListener("abort", withdraw);
					resolve(reply);
				},
				reject(error) {
					signal?.removeEventListener("abort", withdraw);
					reject(error);
				},
			};
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

	async function start(
		plan: Plan,
		launch: {
			background: boolean;
			signal?: AbortSignal;
			modelRegistry: ExtensionContext["modelRegistry"];
			project: () => ParentProject;
			shell: () => ChildShell;
			onLaunch?: () => void;
			group?: string;
			todo?: { id: number; text: string };
		},
		from?: { id: string; conversation: Conversation },
	) {
		if (launch.signal?.aborted) return abortedBeforeLaunch;
		let stall = (_reason: string) => {};
		let asked = (_question: string, _signal?: AbortSignal) =>
			Promise.reject<string>(new Error("The child is not running."));
		let observe = (_event: AgentSessionEvent) => {};
		let reported = (_result: ChildResult) => {};
		let noticed = (_message: string) => {};
		const watch = createWatch(schedule, (reason) => stall(reason));
		const launchedIn = generation;
		let handle: ChildHandle;
		try {
			handle = await create({
				cwd: plan.worktree,
				project: launch.project(),
				role: plan.role,
				model: plan.model,
				thinking: plan.thinking,
				prompt: plan.contract.prompt,
				tools: childTools(plan),
				modelRegistry: launch.modelRegistry,
				shell: launch.shell(),
				onEvent: (event) => {
					watch.event(event);
					observe(event);
				},
				notify: (message) => noticed(message),
				ask: (question, signal) => asked(question, signal),
				report: (result) => reported(result),
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
		const missing = plan.contract.tools.filter(
			(tool) => !handle.tools.includes(tool),
		);
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
		if (!launch.background) {
			const id = randomUUID();
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
			asked = () =>
				Promise.reject<string>(
					new Error(
						"The parent cannot answer: it is waiting for this child in the foreground. Continue without an answer.",
					),
				);
			let result: ChildResult | undefined;
			reported = (value) => {
				result = value;
			};
			noticed = (message) =>
				traceRun(id, plan, "running", undefined, message);
			watch.start();
			launch.onLaunch?.();
			traceRun(id, plan, "running");
			try {
				const text = await Promise.race([
					handle.run(plan.task),
					stopped.promise,
				]);
				traceRun(id, plan, "completed", result);
				return { status: "completed" as const, text, result };
			} catch (error) {
				traceRun(id, plan, ended);
				throw error;
			} finally {
				watch.stop();
				launch.signal?.removeEventListener("abort", abort);
				void shutDown(handle, id);
			}
		}
		const child: Child = {
			record: {
				id: randomUUID(),
				role: plan.role,
				task: plan.task,
				worktree: plan.worktree,
				model: plan.model,
				thinking: plan.thinking,
				state: "queued",
				createdAt: Date.now(),
				continuedFrom: from?.id,
				...(launch.group === undefined ? {} : { group: launch.group }),
				...(launch.todo === undefined ? {} : { todo: launch.todo }),
			},
			plan,
			handle,
			watch,
			tools: new Map(),
			writes: new Map(),
			changed: new Set(),
			followers: new Set(),
			asked: 0,
			answers: new Map(),
			withdrawn: new Set(),
		};
		stall = (reason) => finish(child, "timed out", reason);
		asked = (question, signal) => ask(child, question, signal);
		reported = (result) => {
			if (isWorking(child.record.state)) child.record.result = result;
		};
		observe = (event) => track(child, event);
		noticed = (message) =>
			traceRun(child.record.id, plan, child.record.state, undefined, message);
		children.set(child.record.id, child);
		queue.push(child);
		launch.onLaunch?.();
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
			modelRegistry: ExtensionContext["modelRegistry"];
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
				{
					...launch,
					background: true,
					...(todo
						? {
								todo,
								onLaunch: () => options.todo?.set(todo.id, "in progress"),
							}
						: {}),
				},
				{ id, conversation: child.conversation },
			);
			if (started.status === "queued") consume(id);
			return started;
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

	function settlement(record: ChildRecord) {
		const { todo } = record;
		if (!todo || consumed.has(record.id)) return undefined;
		const latest = [...children.values()].findLast(
			(child) => child.record.todo?.id === todo.id,
		);
		if (latest?.record.id !== record.id) {
			return {
				note: `Task #${todo.id} is linked to a later child, so no Task state was applied.`,
			};
		}
		if (!options.todo?.has(todo.id)) {
			return {
				note: `Task #${todo.id} no longer exists, so no Task state was applied.`,
			};
		}
		const state = finalTaskState(record);
		return {
			note: appliedNote(todo.id, state),
			apply: () => options.todo?.set(todo.id, state),
		};
	}

	function consume(id: string) {
		const child = children.get(id);
		const settled = child && settlement(child.record);
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
		try {
			options.send({
				customType: "pi-workflow-child-result",
				content: results
					.map((record) =>
						withNote(childOutcome(record), settlement(record)?.note),
					)
					.join("\n\n"),
				display: true,
				details:
					results.length === 1
						? childDetails(results[0])
						: { results: results.map((child) => childDetails(child)) },
			});
			for (const child of results) consume(child.id);
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
		queue.length = 0;
		pending = [];
		for (const child of working) {
			child.watch.stop();
			answer(child, new Error("The session ended."));
		}
		changed();
		await Promise.all(
			working.map((child) => shutDown(child.handle, child.record.id)),
		);
		return working.length;
	}

	return {
		start,
		resume,
		reserve,
		reply,
		steer,
		cancel,
		consume,
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
				"explore, worker, or verify. When Jev routing is off, the role you pass decides and omitting it does not choose worker. When on, it is a suggestion and Jev selects the specialist.",
		}),
	),
	worktree: Type.Optional(
		Type.String({
			description:
				"An existing Git root for the child to work in. Defaults to the current Git root.",
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
	todo: { claim(id: number): TodoClaim } & Pick<TodoLink, "set">,
): ToolDefinition<typeof spawnChildParameters, Record<string, unknown>> {
	return {
		name: "spawn_child",
		label: "Spawn Child",
		description:
			"Delegate a bounded task to a child session that runs under a harness contract. When Jev routing is on, the harness decides whether the work leaves this session. The active profile picks the model for the role. In an interactive session the call returns the child id at once and the result arrives later as a message; in print and json modes the result returns in the same call.",
		promptSnippet: "Delegate a bounded task to a child session",
		promptGuidelines: [
			"Pass the task and the role (explore, worker, or verify). When Jev routing is on, the role is a suggestion and Jev selects the specialist; otherwise the role determines the contract. Explore reads and queries CodeGraph without editing or commands; verify independently checks completed work and may run checks and tests without editing; worker implements and runs commands.",
			"Children communicate only with the parent, never directly with the user.",
			"Do not delegate mutating git or gh commands or publication: they are reserved for the parent and stay with it. Do not ask the child for intermediate progress reports. Copy evidence you already have into the task; references accept only paths inside the cwd. There is no channel to a running child; use reply_child only when the child asks.",
			"A refusal or a queued id is not a completed result and is not retried. After a background child is queued, end your turn: its result wakes you. Do not poll with sleep, list_children, child_status, or child_result.",
			`One codemode script can launch several children: each spawn_child call returns at once without awaiting the child. Their results arrive in one message when every child is done, or earlier when a result needs you. In print and json modes each call waits for its child instead. At most ${launchLimit} children can be queued, running, or waiting at once; a launch beyond that is refused.`,
			"Do not declare work done without a worker Verdict of done and its files_changed, validation, and left_undone fields. Do not declare work verified without a verifier Verdict of pass and its findings and unverified fields; partial, fail, and blocked are not success.",
			"When Jev routing is on, the parent asks once per user turn before read, grep, find, ls, edit, write, bash, powershell, or codegraph query and explore. A block that names a role means call spawn_child and use that role. A block that says to ask the user one question means ask that one question and wait. Reads of AGENTS.md, GLOSSARY.md, and one docs/agents markdown file stay available, and so does codegraph init.",
		],
		parameters: spawnChildParameters,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const unseated = unseatedChild();
			if (unseated) return unseated;
			const claim = params.todo === undefined ? undefined : todo.claim(params.todo);
			if (claim && "reason" in claim) {
				return notLaunched("refused", {
					warning: "Launch refused. No child was launched.",
					reason: claim.reason,
				});
			}
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
						references: params.references,
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
						modelRegistry: ctx.modelRegistry,
						project: () => parentProject(ctx),
						shell: () => shellOptions(ctx),
						onLaunch: () => {
							launcher.recordLaunch(userRequest?.id);
							claim?.start();
						},
						group: /^([\s\S]+)\/\d+$/.exec(toolCallId)?.[1],
						...(claim
							? { todo: { id: claim.task.id, text: claim.task.text } }
							: {}),
					})
					.catch((error: unknown) => {
						if (claim)
							todo.set(claim.task.id, signal?.aborted ? "pending" : "blocked");
						throw error;
					});
				const state =
					claim && started.status === "completed"
						? finalTaskState({
								state: "completed",
								role: plan.role,
								result: started.result,
							})
						: undefined;
				const note =
					claim && state && todo.set(claim.task.id, state)
						? appliedNote(claim.task.id, state)
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
	const selectionLine = selection
		? selection.jev
			? `Jev selected ${selection.role}.`
			: `Launched as ${selection.role}.`
		: undefined;
	if (started.status === "completed") {
		const outcome = selection
			? childOutcome({
					...selection,
					state: "completed",
					text: started.text,
					result: started.result,
				})
			: started.text;
		return report([...warnings, withNote(outcome, note)], {
			status: "completed",
			...(selection
				? { verdict: started.result?.verdict, result: started.result }
				: {}),
			...selected,
		});
	}
	return report(
		[
			...warnings,
			`Child ${started.id} is queued in the background. Its result arrives later as a message. End your turn and do not poll; the result wakes you.`,
			...(selectionLine ? [selectionLine] : []),
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
			return launched(
				await sessions.resume(params.id, params.task, {
					signal,
					modelRegistry: ctx.modelRegistry,
					project: () => parentProject(ctx),
					shell: () => shellOptions(ctx),
				}),
				[],
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
