import { createReadStream, createWriteStream } from "node:fs";
import type { Readable, Writable } from "node:stream";

import {
	getCurrentSystemMessage,
	getSystemMessageText,
} from "@earendil-works/pi-ai";
import {
	createCodemodeExtension,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import {
	type ActionAuthorization,
	type AuthorizationQuestion,
	installActionAuthorization,
} from "./action-authorization.ts";
import {
	type ChildShell,
	createChildBashTool,
	createConfiguredBashTool,
} from "./child-bash.ts";
import {
	type Checkpoint,
	type CheckpointGrant,
	createCheckpointTool,
} from "./child-checkpoint.ts";
import { createChildCodeGraphTool } from "./codegraph-tool.ts";
import {
	type ChildResult,
	reportsResult,
	resultParameters,
	verdictNeedsNoReason,
} from "./child-projection.ts";

export const askParentTool = "ask_parent";
export const reportResultTool = "report_result";
export const childRuntimeFlag = "pi-workflow-child";
export const channelDescriptor = 3;

export type ChildRuntimeConfig = {
	role: string;
	cwd: string;
	shell: ChildShell;
	checkpoint?: CheckpointGrant;
	codegraph?: boolean;
	contextual?: { active: readonly string[] };
};

export type PolicyMethod = "authority" | "classify" | "decision";

type ChildRequest =
	| { type: "ask"; question: string }
	| { type: "report"; result: ChildResult }
	| { type: "checkpoint"; checkpoint: Checkpoint }
	| { type: "policy"; method: PolicyMethod; value?: unknown };

export type ChildFrame =
	| { type: "ready"; tools: string[] }
	| { type: "withdraw"; id: number }
	| (ChildRequest & { id: number });

export type ParentReply = { id: number; answer?: string; error?: string };

const askParentParameters = Type.Object({
	question: Type.String({ description: "One question for the parent." }),
});

export function consultation(question: AuthorizationQuestion) {
	return `Resolve only within your authority; otherwise consult the user. Reply with the same id, call and proposal plus kind (resolved/deny/pending), answer and optional confirmedActions identifying the explicitly confirmed actual action and target. Scope alone is not impact confirmation. No receipt or running state is consent.\n${JSON.stringify(question)}`;
}

export function createAskParentTool(
	ask: (question: string, signal?: AbortSignal) => Promise<string>,
	contextual = false,
) {
	return {
		name: askParentTool,
		label: "Ask Parent",
		description: contextual
			? "Ask the parent about missing facts or authority. A failed consultation leaves the action held, not permitted; continue only independent authorized work."
			: "Ask the parent session one question and wait for its answer. Use it only when you are blocked and the answer changes your next step; a command reserved for the parent is not a reason to ask. An error result means no answer will come; continue without one.",
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

export function createReportResultTool(
	role: string,
	report: (result: ChildResult) => unknown,
) {
	return {
		name: reportResultTool,
		label: "Report Result",
		description:
			"Report your Verdict and result to the parent before your final answer. Call it again to correct it; the last call counts.",
		parameters:
			role === "verify" ? resultParameters.verify : resultParameters.worker,
		async execute(_toolCallId: string, params: ChildResult) {
			if (!params.reason && !verdictNeedsNoReason(params.verdict)) {
				throw new Error(`A ${params.verdict} Verdict needs a reason.`);
			}
			await report(params);
			return {
				content: [{ type: "text" as const, text: "Result recorded." }],
				details: {},
			};
		},
	};
}

export function readRecords<Frame>(
	stream: Readable,
	valid: (record: Record<string, unknown>) => boolean,
	onRecord: (record: Frame) => void,
	{
		limit = Number.POSITIVE_INFINITY,
		onInvalid,
	}: { limit?: number; onInvalid?: (error: Error) => void } = {},
) {
	let buffer = "";
	const refuse = () =>
		stream.destroy(new Error(`A channel frame over ${limit} bytes was refused.`));
	stream.setEncoding("utf8");
	stream.on("data", (chunk: string) => {
		buffer += chunk;
		for (
			let newline = buffer.indexOf("\n");
			newline >= 0;
			newline = buffer.indexOf("\n")
		) {
			const line = buffer.slice(0, newline).replace(/\r$/, "");
			buffer = buffer.slice(newline + 1);
			if (line.length > limit) return refuse();
			if (!line) continue;
			let record: unknown;
			try {
				record = JSON.parse(line);
			} catch {
				continue;
			}
			if (
				typeof record !== "object" ||
				record === null ||
				Array.isArray(record) ||
				!valid(record as Record<string, unknown>)
			) {
				onInvalid?.(new Error(`A malformed record was refused: ${line.slice(0, 200)}`));
				continue;
			}
			onRecord(record as Frame);
		}
		if (buffer.length > limit) refuse();
	});
}

export function parentChannel(input: Readable, output: Writable) {
	let next = 0;
	let closed: Error | undefined;
	const waiting = new Map<
		number,
		{ resolve(answer: string): void; reject(error: Error): void }
	>();
	const send = (frame: ChildFrame) => {
		output.write(`${JSON.stringify(frame)}\n`);
	};
	const close = () => {
		closed ??= new Error("The parent channel closed; no answer will come.");
		for (const pending of waiting.values()) pending.reject(closed);
		waiting.clear();
	};
	readRecords<ParentReply>(
		input,
		(reply) => typeof reply.id === "number",
		(reply) => {
			const pending = waiting.get(reply.id);
			if (!pending) return;
			waiting.delete(reply.id);
			if (reply.error === undefined) pending.resolve(reply.answer ?? "");
			else pending.reject(new Error(reply.error));
		},
	);
	input.once("end", close);
	input.once("error", close);
	output.once("error", close);
	return {
		ready: (tools: string[]) => send({ type: "ready", tools }),
		request(frame: ChildRequest, signal?: AbortSignal) {
			if (closed) return Promise.reject(closed);
			if (signal?.aborted) return Promise.reject(new Error("The call was aborted."));
			const id = ++next;
			return new Promise<string>((resolve, reject) => {
				const withdraw = () => {
					waiting.delete(id);
					send({ type: "withdraw", id });
					reject(new Error("The call was aborted."));
				};
				signal?.addEventListener("abort", withdraw, { once: true });
				waiting.set(id, {
					resolve(answer) {
						signal?.removeEventListener("abort", withdraw);
						resolve(answer);
					},
					reject(error) {
						signal?.removeEventListener("abort", withdraw);
						reject(error);
					},
				});
				send({ ...frame, id });
			});
		},
	};
}

function installContextual(
	pi: ExtensionAPI,
	config: ChildRuntimeConfig,
	channel: ReturnType<typeof parentChannel>,
	ctx: ExtensionContext,
	ask: (question: string, signal?: AbortSignal) => Promise<string>,
	checkpointed: (checkpoint: Checkpoint) => Promise<unknown>,
) {
	pi.setActiveTools([
		...new Set([...pi.getActiveTools(), ...(config.contextual?.active ?? [])]),
	]);
	let instructions: { systemPrompt: string; basePrompt: string } | undefined;
	pi.on("context_with_system", (event, context) => {
		const system = getCurrentSystemMessage(event.messages);
		instructions = system && {
			systemPrompt: getSystemMessageText(system),
			basePrompt: context.getSystemPrompt(),
		};
	});
	const policy = async (
		method: PolicyMethod,
		value: unknown,
		signal?: AbortSignal,
	) =>
		JSON.parse(
			await channel.request({ type: "policy", method, value }, signal),
		) as never;
	const starting: unknown[] = [];
	const authorization: ActionAuthorization = {
		authority: (context) => policy("authority", undefined, context.signal),
		classify: (proposal, signal) => policy("classify", proposal, signal),
		consult: async (question, signal) =>
			JSON.parse(await ask(consultation(question), signal)),
		onDecision: (decision) => policy("decision", decision),
		sessionInstructions: () => instructions,
	};
	// Pi does not call a session_start handler registered while session_start runs.
	const on = pi.on.bind(pi) as (
		event: string,
		handler: ExtensionHandler<unknown>,
	) => void;
	installActionAuthorization(
		{
			...pi,
			on: (event: string, handler: ExtensionHandler<unknown>) =>
				event === "session_start"
					? void starting.push(handler({ type: event }, ctx))
					: on(event, handler),
		} as ExtensionAPI,
		authorization,
		checkpointed,
	);
	return Promise.all(starting);
}

export async function installChildRuntime(
	pi: ExtensionAPI,
	config: ChildRuntimeConfig,
	channel: ReturnType<typeof parentChannel>,
	ctx: ExtensionContext,
) {
	const ask = (question: string, signal?: AbortSignal) =>
		channel.request({ type: "ask", question }, signal);
	const checkpointed = (checkpoint: Checkpoint) =>
		channel.request({ type: "checkpoint", checkpoint });
	const contextual = config.contextual !== undefined;
	pi.registerTool(
		contextual
			? createConfiguredBashTool(config.cwd, config.shell)
			: createChildBashTool(config.cwd, config.shell, config.checkpoint !== undefined),
	);
	if (config.codegraph) pi.registerTool(createChildCodeGraphTool(config.cwd));
	pi.registerTool(createAskParentTool(ask, contextual));
	if (contextual || reportsResult(config.role)) {
		pi.registerTool(
			createReportResultTool(config.role, (result) =>
				channel.request({ type: "report", result }),
			),
		);
	}
	if (contextual) {
		pi.registerTool(createCheckpointTool(config.cwd, () => {}));
	} else if (config.checkpoint) {
		pi.registerTool(createCheckpointTool(config.checkpoint, checkpointed));
	}
	if (contextual) {
		await installContextual(pi, config, channel, ctx, ask, checkpointed);
	}
	// ADR 0017: a child loads context files after its role contract, but never APPEND_SYSTEM.
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.appendSystemPrompt = "";
	});
	channel.ready(pi.getActiveTools());
}

export default function childRuntime(pi: ExtensionAPI) {
	createCodemodeExtension({ models: false })(pi);
	pi.registerFlag(childRuntimeFlag, {
		type: "string",
		description: "The launch of a pi-workflow child session.",
	});
	pi.on("session_start", async (_event, ctx) => {
		const config = JSON.parse(
			String(pi.getFlag(childRuntimeFlag)),
		) as ChildRuntimeConfig;
		await installChildRuntime(
			pi,
			config,
			parentChannel(
				createReadStream("", { fd: channelDescriptor, autoClose: false }),
				createWriteStream("", { fd: channelDescriptor, autoClose: false }),
			),
			ctx,
		);
	});
}
