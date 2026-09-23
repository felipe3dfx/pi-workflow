import { spawn } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { join } from "node:path";

import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionContext,
	truncateHead,
} from "@earendil-works/pi-coding-agent";

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
		options: { cwd: string; signal?: AbortSignal },
	) => Promise<RunResult>;
}

const fallback = "Use read, grep, and find instead.";

function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; signal?: AbortSignal },
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
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

export function createCodeGraphTool(adapters: CodeGraphAdapters = {}) {
	const run = adapters.run ?? runCommand;

	async function assertGitRoot(workspace: string, signal?: AbortSignal) {
		const notRoot = new Error(
			"CodeGraph runs only when the current workspace is the real Git root. The command did not run.",
		);
		let result: RunResult;
		try {
			result = await run("git", ["rev-parse", "--show-toplevel"], {
				cwd: workspace,
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw notRoot;
		}
		if (result.code !== 0 || realpathSync(result.stdout.trim()) !== workspace)
			throw notRoot;
	}

	function assertIndexDirectory(root: string) {
		let index: Stats;
		try {
			index = lstatSync(join(root, ".codegraph"));
		} catch (error) {
			if (isMissing(error)) return;
			throw error;
		}
		if (index.isSymbolicLink() || !index.isDirectory()) {
			throw new Error(
				"CodeGraph requires .codegraph to be a real directory, not a link or a file. The command did not run.",
			);
		}
	}

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
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["operation"],
			properties: {
				operation: { type: "string", enum: ["init", "query", "explore"] },
				query: { type: "string", minLength: 1 },
			},
		} as const,
		executionMode: "sequential" as const,
		async execute(
			_toolCallId: string,
			params: CodeGraphParameters,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: Pick<ExtensionContext, "cwd">,
		) {
			const root = realpathSync(ctx.cwd);
			await assertGitRoot(root, signal);
			assertIndexDirectory(root);
			const args = commandArguments(params, root);
			let result: RunResult;
			try {
				result = await run("codegraph", args, { cwd: root, signal });
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
		},
	};
}
