import { randomUUID } from "node:crypto";

import type {
	AssistantMessage,
	ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	getAgentDir,
	type ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import type { createChildLauncher } from "./child-launcher.ts";
import { sanitizeTaskText } from "./todo-header.ts";

interface ChildSpec {
	cwd: string;
	model: string;
	thinking: ModelThinkingLevel;
	prompt: string;
	tools: string[];
	modelRegistry: ExtensionContext["modelRegistry"];
	onEvent(event: AgentSessionEvent): void;
	ask(question: string): Promise<string>;
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
	abort(): Promise<void>;
	dispose(): void;
}

export type ChildSessionFactory = (spec: ChildSpec) => Promise<ChildHandle>;

type Plan = {
	role: string;
	contract: { prompt: string; tools: string[] };
	task: string;
	worktree: string;
	model: string;
	thinking: ModelThinkingLevel;
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
	continuedFrom?: string;
	step?: string;
}

interface Child {
	record: ChildRecord;
	plan: Plan;
	handle: ChildHandle;
	watch: ReturnType<typeof createWatch>;
	conversation?: Conversation;
	entries?: SessionEntry[];
	streaming?: AssistantMessage;
	tools: Map<string, string>;
	followers: Set<() => void>;
	asked: number;
	question?: {
		number: number;
		resolve(answer: string): void;
		reject(error: Error): void;
	};
}

export type Schedule = (run: () => void, ms: number) => () => void;

const runningLimit = 5;
const stallMs = 4 * 60_000;
const toolStallMs = 30 * 60_000;

export const scheduleTimer: Schedule = (run, ms) => {
	const timer = setTimeout(run, ms);
	timer.unref();
	return () => clearTimeout(timer);
};

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

export function describeTool(name: string, args: unknown) {
	const detail = Object.values(args ?? {}).find(
		(value) => typeof value === "string",
	);
	return sanitizeTaskText(
		detail === undefined ? name : `${name} ${detail.split("\n")[0]}`,
	);
}

export function isWorking(state: ChildState) {
	return state === "queued" || state === "running" || state === "waiting";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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

const askParentParameters = Type.Object({
	question: Type.String({ description: "One question for the parent." }),
});

const createPiChildSession: ChildSessionFactory = async (spec) => {
	const runtime = parentRuntime(spec.modelRegistry);
	if (!runtime) {
		throw new Error("The session's model runtime is not available.");
	}
	const slash = spec.model.indexOf("/");
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: spec.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
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
		tools: [...spec.tools, "ask_parent"],
		customTools: [
			{
				name: "ask_parent",
				label: "Ask Parent",
				description:
					"Ask the parent session one question and wait for its answer. Use it only when the task cannot continue without a decision the parent owns. An error result means no answer will come; continue without one.",
				parameters: askParentParameters,
				async execute(_toolCallId, params: Static<typeof askParentParameters>) {
					return {
						content: [{ type: "text", text: await spec.ask(params.question) }],
						details: {},
					};
				},
			},
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
		abort: () => {
			stopped = true;
			return session.abort();
		},
		dispose: () => {
			stopped = true;
			session.dispose();
		},
	};
};

const abortedBeforeLaunch = {
	status: "refused" as const,
	warning: "Launch refused. No child was launched.",
	reason: "The call was aborted before the child launched.",
};

export function createChildSessions(options: {
	create?: ChildSessionFactory;
	deliver: (record: ChildRecord) => void;
	ask: (record: ChildRecord, question: string, number: number) => void;
	report: (message: string) => void;
	schedule?: Schedule;
}) {
	const create = options.create ?? createPiChildSession;
	const schedule = options.schedule ?? scheduleTimer;
	const children = new Map<string, Child>();
	const queue: Child[] = [];
	const listeners = new Set<() => void>();
	let generation = 0;

	function warn(message: string) {
		try {
			options.report(message);
		} catch {}
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
		} else if (event.type === "tool_execution_end") {
			child.tools.delete(event.toolCallId);
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
		child.streaming = undefined;
		answer(
			child,
			new Error(
				state === "cancelled"
					? "The child was cancelled."
					: `The child ${state}.`,
			),
		);
		try {
			child.entries = child.handle.entries();
			if (state === "completed") {
				child.conversation = {
					sessionId: child.handle.sessionId,
					entries: child.entries,
				};
			}
			child.handle.dispose();
		} catch (error) {
			warn(`Child ${record.id}: ${errorMessage(error)}`);
		}
		pump();
		changed();
		if (!deliver) return;
		try {
			options.deliver({ ...record });
		} catch (error) {
			warn(`Child ${record.id}: ${errorMessage(error)}`);
		}
	}

	function answer(child: Child, reply: string | Error) {
		const { question } = child;
		if (!question) return;
		child.question = undefined;
		if (child.record.state === "waiting") {
			child.record.state = "running";
			child.record.step = undefined;
			changed();
		}
		if (reply instanceof Error) question.reject(reply);
		else question.resolve(reply);
	}

	function ask(child: Child, question: string) {
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
			child.question = { number, resolve, reject };
			child.record.state = "waiting";
			child.record.step = `asks question ${number}`;
			changed();
			try {
				options.ask({ ...child.record }, question, number);
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
		},
		from?: { id: string; conversation: Conversation },
	) {
		if (launch.signal?.aborted) return abortedBeforeLaunch;
		let stall = (_reason: string) => {};
		let asked = (_question: string) =>
			Promise.reject<string>(new Error("The child is not running."));
		let observe = (_event: AgentSessionEvent) => {};
		const watch = createWatch(schedule, (reason) => stall(reason));
		const launchedIn = generation;
		let handle: ChildHandle;
		try {
			handle = await create({
				cwd: plan.worktree,
				model: plan.model,
				thinking: plan.thinking,
				prompt: plan.contract.prompt,
				tools: plan.contract.tools,
				modelRegistry: launch.modelRegistry,
				onEvent: (event) => {
					watch.event(event);
					observe(event);
				},
				ask: (question) => asked(question),
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
			handle.dispose();
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
			handle.dispose();
			return {
				status: "refused" as const,
				warning: "Launch refused. No child was launched.",
				reason: `The child session lacks the contract tools ${missing.join(", ")}.`,
			};
		}
		if (launch.signal?.aborted) {
			handle.dispose();
			return abortedBeforeLaunch;
		}
		if (launchedIn !== generation) {
			handle.dispose();
			return {
				status: "refused" as const,
				warning: "Launch refused. No child was launched.",
				reason: "The session ended before the child launched.",
			};
		}
		if (!launch.background) {
			const stopped = Promise.withResolvers<never>();
			const stop = (error: Error) => {
				stopped.reject(error);
				void handle.abort().catch(() => {});
			};
			const abort = () =>
				stop(new Error("The call was aborted and the child was stopped."));
			launch.signal?.addEventListener("abort", abort, { once: true });
			stall = (reason) => stop(new Error(`The child timed out: ${reason}`));
			asked = () =>
				Promise.reject<string>(
					new Error(
						"The parent cannot answer: it is waiting for this child in the foreground. Continue without an answer.",
					),
				);
			watch.start();
			try {
				const text = await Promise.race([
					handle.run(plan.task),
					stopped.promise,
				]);
				return { status: "completed" as const, text };
			} finally {
				watch.stop();
				launch.signal?.removeEventListener("abort", abort);
				handle.dispose();
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
			},
			plan,
			handle,
			watch,
			tools: new Map(),
			followers: new Set(),
			asked: 0,
		};
		stall = (reason) => finish(child, "timed out", reason);
		asked = (question) => ask(child, question);
		observe = (event) => track(child, event);
		children.set(child.record.id, child);
		queue.push(child);
		changed();
		queueMicrotask(pump);
		return { status: "queued" as const, id: child.record.id };
	}

	function resume(
		id: string,
		task: string,
		launch: {
			signal?: AbortSignal;
			modelRegistry: ExtensionContext["modelRegistry"];
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
		return start(
			{ ...child.plan, task },
			{ ...launch, background: true },
			{ id, conversation: child.conversation },
		);
	}

	function reply(id: string, number: number, text: string) {
		const child = children.get(id);
		if (!child) return `No child ${id} in this session.`;
		if (!isWorking(child.record.state)) {
			return `Child ${id} is ${child.record.state}; question ${number} can no longer be answered.`;
		}
		if (child.question?.number !== number) {
			return `Question ${number} of child ${id} is not waiting for a reply.`;
		}
		answer(child, text);
		return `Reply sent to child ${id}.`;
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

	function get(id: string): ChildRecord | undefined {
		const child = children.get(id);
		return child && { ...child.record };
	}

	function list(): ChildRecord[] {
		return [...children.values()].map((child) => ({ ...child.record }));
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

	function disposeAll() {
		generation += 1;
		const working = [...children.values()].filter((child) =>
			isWorking(child.record.state),
		);
		children.clear();
		queue.length = 0;
		for (const child of working) {
			child.watch.stop();
			answer(child, new Error("The session ended."));
			try {
				child.handle.dispose();
			} catch {}
		}
		changed();
	}

	return {
		start,
		resume,
		reply,
		cancel,
		get,
		list,
		subscribe,
		follow,
		thread,
		disposeAll,
	};
}

const spawnChildParameters = Type.Object({
	task: Type.String({ description: "The bounded task the child completes." }),
	role: Type.Optional(
		Type.String({
			description:
				"The child contract: explore, worker, or verify. Omit it to use worker.",
		}),
	),
	worktree: Type.Optional(
		Type.String({
			description:
				"An existing Git root for the child to work in. Defaults to the current Git root.",
		}),
	),
	background: Type.Optional(
		Type.Literal(true, {
			description:
				"Ask for a background child. Sessions that can receive a later result always run children in the background; print and json modes refuse it.",
		}),
	),
});

type Outcome = { warning: string; reason: string; warnings?: string[] };

function report(lines: string[], details: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details,
	};
}

function notLaunched(status: string, outcome: Outcome) {
	return report(
		[...(outcome.warnings ?? []), outcome.warning, `Reason: ${outcome.reason}`],
		{ status, reason: outcome.reason },
	);
}

export function createSpawnChildTool(
	launcher: ReturnType<typeof createChildLauncher>,
	sessions: ReturnType<typeof createChildSessions>,
): ToolDefinition<typeof spawnChildParameters, Record<string, unknown>> {
	return {
		name: "spawn_child",
		label: "Spawn Child",
		description:
			"Delegate a bounded task to a child session that runs under a harness contract. The harness decides whether the work leaves this session and which model runs it. In an interactive session the call returns the child id at once and the result arrives later as a message; in print and json modes the result returns in the same call.",
		promptSnippet: "Delegate a bounded task to a child session",
		promptGuidelines: [
			"Pass only the role and the task to spawn_child; the harness owns the child's prompt, tools, and model.",
			"A spawn_child refusal or pending result has no child id and is not retried.",
		],
		parameters: spawnChildParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const background = ctx.mode === "tui" || ctx.mode === "rpc";
			if (params.background && !background) {
				return notLaunched("refused", {
					warning: "Launch refused. No child was launched.",
					reason: `${ctx.mode} mode runs the child in the foreground and cannot run it in the background.`,
				});
			}
			const plan = await launcher.decide(
				{
					role: params.role ?? undefined,
					task: params.task,
					worktree: params.worktree,
				},
				ctx,
			);
			if (plan.status !== "launch") return notLaunched(plan.status, plan);
			const started = await sessions.start(plan, {
				background,
				signal,
				modelRegistry: ctx.modelRegistry,
			});
			return launched(started, plan.warnings);
		},
	};
}

function launched(
	started: Awaited<ReturnType<ReturnType<typeof createChildSessions>["start"]>>,
	warnings: string[],
) {
	if (started.status === "refused" || started.status === "pending") {
		return notLaunched(started.status, { ...started, warnings });
	}
	if (started.status === "completed") {
		return report([...warnings, started.text], { status: "completed" });
	}
	return report(
		[
			...warnings,
			`Child ${started.id} is queued in the background. Its result arrives later as a message.`,
		],
		{ status: started.status, id: started.id },
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
			return launched(
				await sessions.resume(params.id, params.task, {
					signal,
					modelRegistry: ctx.modelRegistry,
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
			const child = sessions.get(params.id);
			if (!child) return unknownChild(params.id);
			if (child.text === undefined) {
				return report(
					[`Child ${child.id} is ${child.state} and has no result yet.`],
					{ id: child.id, state: child.state },
				);
			}
			return report([child.text], { id: child.id, state: child.state });
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
			const { message } = sessions.cancel(params.id, false);
			const child = sessions.get(params.id);
			return report([message], { id: params.id, state: child?.state });
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
			return report(
				[sessions.reply(params.id, params.question, params.answer)],
				{ id: params.id, question: params.question },
			);
		},
	};
	return [listChildren, childStatus, childResult, cancelChild, replyChild];
}
