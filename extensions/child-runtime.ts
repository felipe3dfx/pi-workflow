import { createReadStream, createWriteStream } from "node:fs";
import type { Readable, Writable } from "node:stream";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { type ChildShell, createChildBashTool } from "./child-bash.ts";
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
	checkpoint: boolean;
};

export type ChildFrame =
	| { type: "ready" }
	| { type: "ask"; id: number; question: string }
	| { type: "withdraw"; id: number }
	| { type: "report"; id: number; result: ChildResult };

export type ParentReply = { id: number; answer?: string; error?: string };

const askParentParameters = Type.Object({
	question: Type.String({ description: "One question for the parent." }),
});

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

export function readLines(
	stream: Readable,
	onLine: (line: string) => void,
	limit = Number.POSITIVE_INFINITY,
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
			if (line) onLine(line);
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
	readLines(input, (line) => {
		let reply: ParentReply;
		try {
			reply = JSON.parse(line) as ParentReply;
		} catch {
			return;
		}
		const pending = waiting.get(reply.id);
		if (!pending) return;
		waiting.delete(reply.id);
		if (reply.error === undefined) pending.resolve(reply.answer ?? "");
		else pending.reject(new Error(reply.error));
	});
	input.once("end", close);
	input.once("error", close);
	output.once("error", close);
	return {
		ready: () => send({ type: "ready" }),
		request(
			frame: { type: "ask"; question: string } | { type: "report"; result: ChildResult },
			signal?: AbortSignal,
		) {
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

export function installChildRuntime(
	pi: ExtensionAPI,
	config: ChildRuntimeConfig,
	channel: ReturnType<typeof parentChannel>,
) {
	pi.registerTool(createChildBashTool(config.cwd, config.shell, config.checkpoint));
	pi.registerTool(
		createAskParentTool((question, signal) =>
			channel.request({ type: "ask", question }, signal),
		),
	);
	if (reportsResult(config.role)) {
		pi.registerTool(
			createReportResultTool(config.role, (result) =>
				channel.request({ type: "report", result }),
			),
		);
	}
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.appendSystemPrompt = "";
	});
	channel.ready();
}

export default function childRuntime(pi: ExtensionAPI) {
	pi.registerFlag(childRuntimeFlag, {
		type: "string",
		description: "The launch of a pi-workflow child session.",
	});
	pi.on("session_start", () => {
		const config = JSON.parse(
			String(pi.getFlag(childRuntimeFlag)),
		) as ChildRuntimeConfig;
		installChildRuntime(
			pi,
			config,
			parentChannel(
				createReadStream("", { fd: channelDescriptor, autoClose: false }),
				createWriteStream("", { fd: channelDescriptor, autoClose: false }),
			),
		);
	});
}
