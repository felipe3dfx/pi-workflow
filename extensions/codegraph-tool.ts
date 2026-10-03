import { spawn } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { join } from "node:path";

import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionContext,
	truncateHead,
} from "@earendil-works/pi-coding-agent";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { claim, held } from "./configure.ts";
import { offerTool } from "./tool-offer.ts";
import { gitEnvironment } from "./git-environment.ts";

const codegraphStream = claim("codegraph", "message-stream");

type CodeGraphOperation = "init" | "query" | "explore";

interface CodeGraphParameters {
	operation: CodeGraphOperation;
	query?: string;
}

interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface CodeGraphAdapters {
	run?: (
		command: string,
		args: string[],
		options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal },
	) => Promise<RunResult>;
}

const fallback = "Use read, grep, and find instead.";

function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			signal: options.signal,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

function isMissing(error: unknown) {
	return (error as { code?: unknown } | undefined)?.code === "ENOENT";
}

function truncate(output: string) {
	const truncation = truncateHead(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	return truncation.truncated
		? `${truncation.content}\n\n[CodeGraph output truncated to ${truncation.outputLines} of ${truncation.totalLines} lines.]`
		: truncation.content;
}

function outcome(status: "ok" | "unavailable" | "failed", text: string) {
	return { content: [{ type: "text" as const, text }], details: { status } };
}

function commandArguments(params: CodeGraphParameters, root: string) {
	if (params.operation === "init") return ["init", root];
	if (!params.query?.trim()) {
		throw new Error(`CodeGraph ${params.operation} requires a query.`);
	}
	return [params.operation, "--path", root, "--", params.query];
}

function codegraphRunner(adapters: CodeGraphAdapters) {
	const run = adapters.run ?? runCommand;

	async function assertGitRoot(workspace: string, signal?: AbortSignal) {
		const notRoot = new Error(
			"CodeGraph runs only when the current workspace is the real Git root. The command did not run.",
		);
		let result: RunResult;
		try {
			result = await run("git", ["rev-parse", "--show-toplevel"], {
				cwd: workspace,
				env: gitEnvironment(),
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw notRoot;
		}
		if (result.code !== 0 || realpathSync(result.stdout.trim()) !== workspace)
			throw notRoot;
	}

	function assertIndexDirectory(root: string, required: boolean) {
		let index: Stats;
		try {
			index = lstatSync(join(root, ".codegraph"));
		} catch (error) {
			if (!isMissing(error)) throw error;
			if (required) {
				throw new Error(`This worktree has no .codegraph index. ${fallback}`);
			}
			return;
		}
		if (index.isSymbolicLink() || !index.isDirectory()) {
			throw new Error(
				"CodeGraph requires .codegraph to be a real directory, not a link or a file. The command did not run.",
			);
		}
	}

	return async function runIn(
		cwd: string,
		params: CodeGraphParameters,
		signal: AbortSignal | undefined,
		indexRequired: boolean,
	) {
		const root = realpathSync(cwd);
		await assertGitRoot(root, signal);
		assertIndexDirectory(root, indexRequired);
		const args = commandArguments(params, root);
		let result: RunResult;
		try {
			result = await run("codegraph", args, {
				cwd: root,
				env: gitEnvironment(),
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			if (isMissing(error)) {
				return outcome(
					"unavailable",
					`CodeGraph is unavailable because the codegraph binary was not found. ${fallback}`,
				);
			}
			return outcome(
				"failed",
				`CodeGraph failed to run: ${(error as Error).message}. ${fallback}`,
			);
		}
		const output = truncate(
			[result.stdout, result.stderr].filter(Boolean).join("\n"),
		);
		if (result.code !== 0) {
			return outcome(
				"failed",
				`CodeGraph failed with exit code ${result.code}. ${fallback}\n\n${output}`,
			);
		}
		return outcome("ok", output || "CodeGraph completed without output.");
	};
}

const codegraphParameters = {
	type: "object",
	additionalProperties: false,
	required: ["operation"],
	properties: {
		operation: { type: "string", enum: ["init", "query", "explore"] },
		query: { type: "string", minLength: 1 },
	},
} as const;

export function createCodeGraphTool(adapters: CodeGraphAdapters = {}) {
	const runIn = codegraphRunner(adapters);
	return {
		name: "codegraph",
		label: "CodeGraph",
		description:
			"Initialize, search, or explore the CodeGraph index of the current Git root. It accepts no path and no shell command.",
		promptSnippet:
			"Initialize, search, or explore the CodeGraph index of the current Git root",
		promptGuidelines: [
			"Use codegraph init when the current Git root has no .codegraph index, then codegraph query for symbols or codegraph explore for source and call paths.",
		],
		parameters: codegraphParameters,
		executionMode: "sequential" as const,
		async execute(
			_toolCallId: string,
			params: CodeGraphParameters,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: Pick<ExtensionContext, "cwd">,
		) {
			if (!held(codegraphStream)) {
				return {
					content: [
						{
							type: "text" as const,
							text: "CodeGraph access is not seated. Run /workflow:configure.",
						},
					],
					details: { status: "refused" },
				};
			}
			return runIn(ctx.cwd, params, signal, false);
		},
	};
}

export function createChildCodeGraphTool(
	cwd: string,
	adapters?: CodeGraphAdapters,
) {
	const runIn = codegraphRunner(adapters ?? {});
	return {
		name: "codegraph",
		label: "CodeGraph",
		executionMode: "sequential" as const,
		description:
			"Search or explore the CodeGraph index of this worktree. It is read-only, accepts no path and no shell command.",
		promptSnippet: "Search or explore the CodeGraph index of this worktree",
		promptGuidelines: [
			"Use codegraph query for symbols or codegraph explore for source and call paths before reading files one by one.",
		],
		parameters: {
			...codegraphParameters,
			properties: {
				...codegraphParameters.properties,
				operation: { type: "string", enum: ["query", "explore"] },
			},
		} as const,
		async execute(
			_toolCallId: string,
			params: CodeGraphParameters,
			signal?: AbortSignal,
		) {
			if (params.operation !== "query" && params.operation !== "explore") {
				throw new Error("CodeGraph here accepts only query or explore.");
			}
			if (!held(codegraphStream)) {
				throw new Error(
					`CodeGraph is not available to this child. ${fallback}`,
				);
			}
			return runIn(cwd, params, signal, true);
		},
	};
}

export function syncCodeGraphTool(
	pi: ExtensionAPI,
	adapters?: CodeGraphAdapters,
) {
	offerTool(pi, createCodeGraphTool(adapters), held(codegraphStream));
}
