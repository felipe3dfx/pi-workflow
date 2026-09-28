import { randomUUID } from "node:crypto";

import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	getAgentDir,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { createChildLauncher } from "./child-launcher.ts";

interface ChildSpec {
	cwd: string;
	model: string;
	thinking: ModelThinkingLevel;
	prompt: string;
	tools: string[];
	modelRegistry: ExtensionContext["modelRegistry"];
}

interface ChildHandle {
	model: string | undefined;
	thinking: string;
	tools: string[];
	run(task: string): Promise<string>;
	abort(): Promise<void>;
	dispose(): void;
}

export type ChildSessionFactory = (spec: ChildSpec) => Promise<ChildHandle>;

type Plan = {
	contract: { prompt: string; tools: string[] };
	task: string;
	worktree: string;
	model: string;
	thinking: ModelThinkingLevel;
};

type Deliver = (id: string, text: string, failed: boolean) => void;

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
		tools: spec.tools,
		resourceLoader,
		sessionManager: SessionManager.inMemory(spec.cwd),
		settingsManager,
	});
	return {
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
		abort: () => session.abort(),
		dispose: () => session.dispose(),
	};
};

const abortedBeforeLaunch = {
	status: "refused" as const,
	warning: "Launch refused. No child was launched.",
	reason: "The call was aborted before the child launched.",
};

export function createChildSessions(options: {
	create?: ChildSessionFactory;
	deliver: Deliver;
	report: (message: string) => void;
}) {
	const create = options.create ?? createPiChildSession;
	const running = new Map<string, ChildHandle>();

	async function start(
		plan: Plan,
		launch: {
			background: boolean;
			signal?: AbortSignal;
			modelRegistry: ExtensionContext["modelRegistry"];
		},
	) {
		if (launch.signal?.aborted) return abortedBeforeLaunch;
		let handle: ChildHandle;
		try {
			handle = await create({
				cwd: plan.worktree,
				model: plan.model,
				thinking: plan.thinking,
				prompt: plan.contract.prompt,
				tools: plan.contract.tools,
				modelRegistry: launch.modelRegistry,
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
		if (!launch.background) {
			const abort = () => void handle.abort();
			launch.signal?.addEventListener("abort", abort, { once: true });
			try {
				return {
					status: "completed" as const,
					text: await handle.run(plan.task),
				};
			} finally {
				launch.signal?.removeEventListener("abort", abort);
				handle.dispose();
			}
		}
		const id = randomUUID();
		running.set(id, handle);
		void handle
			.run(plan.task)
			.then(
				(text) => ({ text, failed: false }),
				(error: unknown) => ({ text: errorMessage(error), failed: true }),
			)
			.then(({ text, failed }) => {
				if (!running.delete(id)) return;
				try {
					options.deliver(id, text, failed);
				} finally {
					handle.dispose();
				}
			})
			.catch((error: unknown) =>
				options.report(`Child ${id}: ${errorMessage(error)}`),
			)
			.catch(() => {});
		return { status: "started" as const, id };
	}

	function disposeAll() {
		const handles = [...running.values()];
		running.clear();
		for (const handle of handles) {
			try {
				handle.dispose();
			} catch {}
		}
	}

	return { start, disposeAll };
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
			if (started.status === "refused" || started.status === "pending") {
				return notLaunched(started.status, {
					...started,
					warnings: plan.warnings,
				});
			}
			if (started.status === "completed") {
				return report([...plan.warnings, started.text], {
					status: "completed",
				});
			}
			return report(
				[
					...plan.warnings,
					`Child ${started.id} started in the background. Its result arrives later as a message.`,
				],
				{ status: "started", id: started.id },
			);
		},
	};
}
