import type {
	ToolExecutionStartEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import type { DelegationModeName } from "./workflow-settings.ts";

type Call = { toolName: string; parentToolCallId?: string };

type Result = Pick<
	ToolResultEvent,
	"toolCallId" | "toolName" | "input" | "content" | "isError" | "details"
>;

export type ExplorationFacts = { lookups: number; textBytes: number };

const discoveryTools = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"codegraph_query",
	"codegraph_explore",
	"mem_search",
	"mem_get_observation",
	"mem_context",
]);

const neutralCommand = /^(cd|pushd|popd|echo|printf|true|false|export|set)\b/;

const inspectionCommands = [
	/^git\s+(diff|show|log|blame|grep|status|ls-files|rev-parse)\b/,
	/^git\s+(branch|tag)(\s+(-a|-r|-l|-v|-vv|--all|--remotes|--list|--show-current))*$/,
	/^git\s+remote(\s+(-v|--verbose))?$/,
	/^git\s+(worktree|stash)\s+list\b/,
	/^git\s+config\s+(--get|--get-all|--get-regexp|-l|--list)\b/,
	/^gh\s+(pr|issue|repo|release)\s+(view|list|diff|status)\b/,
	/^(ls|cat|head|tail|grep|rg|wc|tree|stat|jq|diff)\b/,
	/^find\b(?!.*\s-(delete|exec|execdir|ok|okdir|fprint\w*|fls)\b)/,
	/^sed\b(?!.*\s(-[a-zA-Z]*i|--in-place)\b)/,
	/^sort\b(?!.*\s(-o|--output)\b)/,
];

const harmlessRedirects = /\s*(\d?>&\d|&?\d?>\s*\/dev\/null)/g;

function substitutionEnd(command: string, start: number): number {
	let depth = 1;
	let quote: string | undefined;
	for (let i = start; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) quote = undefined;
			else if (char === "\\" && quote === '"') i++;
		} else if (char === "\\") i++;
		else if (char === "'" || char === '"') quote = char;
		else if (char === "(") depth++;
		else if (char === ")" && --depth === 0) return i;
	}
	return -1;
}

function separates(command: string, i: number): boolean {
	const char = command[i];
	if (char === "&") return command[i - 1] !== ">" && command[i + 1] !== ">";
	return char === ";" || char === "|" || char === "\n";
}

function segments(command: string): string[] {
	const found: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote === "'") {
			current += char;
			if (char === "'") quote = undefined;
		} else if (char === "\\") {
			current += char + (command[i + 1] ?? "");
			i++;
		} else if (char === "$" && command[i + 1] === "(") {
			const end = substitutionEnd(command, i + 2);
			if (end < 0) return [...found, current + command.slice(i)];
			found.push(...segments(command.slice(i + 2, end)));
			current += "$_";
			i = end;
		} else if (quote === '"') {
			current += char;
			if (char === '"') quote = undefined;
		} else if (char === "'" || char === '"') {
			quote = char;
			current += char;
		} else if (separates(command, i)) {
			found.push(current);
			current = "";
			if ((char === "|" || char === "&") && command[i + 1] === char) i++;
		} else current += char;
	}
	found.push(current);
	return found;
}

function inspectsOnly(command: unknown): boolean {
	if (typeof command !== "string" || /`|[<>]\(/.test(command)) return false;
	const commands = segments(command)
		.map((segment) => segment.replace(harmlessRedirects, "").trim())
		.filter(Boolean)
		.map((segment) =>
			segment.replace(/^git\s+((-C|-c)\s+\S+\s+|--no-pager\s+)+/, "git "),
		)
		.filter((segment) => segment.includes(">") || !neutralCommand.test(segment));
	return (
		commands.length > 0 &&
		commands.every(
			(segment) =>
				!segment.includes(">") &&
				inspectionCommands.some((pattern) => pattern.test(segment)),
		)
	);
}

function isDiscovery({ toolName, input, details }: Result): boolean {
	if (toolName === "bash") return inspectsOnly(input.command);
	if (toolName === "codegraph")
		return (
			(input.operation === "query" || input.operation === "explore") &&
			(details as { status?: unknown } | undefined)?.status === "ok"
		);
	return discoveryTools.has(toolName.replace(/^mcp__.+?__/, ""));
}

export function createExplorationBudget() {
	let calls = new Map<string, Call>();
	let facts: ExplorationFacts | undefined;
	let notified = false;
	return {
		start() {
			calls = new Map();
			facts = { lookups: 0, textBytes: 0 };
			notified = false;
		},
		call(
			event: Pick<
				ToolExecutionStartEvent,
				"toolCallId" | "toolName" | "parentToolCallId"
			>,
		) {
			if (facts)
				calls.set(event.toolCallId, {
					toolName: event.toolName,
					parentToolCallId: event.parentToolCallId,
				});
		},
		result(event: Result, aborted: boolean): ExplorationFacts | undefined {
			const call = calls.get(event.toolCallId);
			if (!facts || !call || call.toolName !== event.toolName) return;
			calls.delete(event.toolCallId);
			if (aborted || event.isError) return;
			if (call.parentToolCallId !== undefined) {
				const parent = calls.get(call.parentToolCallId);
				if (
					!parent ||
					parent.parentToolCallId !== undefined ||
					parent.toolName !== "codemode"
				)
					return;
			}
			if (!isDiscovery(event)) return;
			facts.lookups++;
			for (const part of event.content)
				if (part.type === "text")
					facts.textBytes += Buffer.byteLength(part.text, "utf8");
			if (notified || (facts.lookups <= 3 && facts.textBytes <= 40_000))
				return;
			notified = true;
			return { ...facts };
		},
	};
}

export function explorationNotice(
	{ lookups, textBytes }: ExplorationFacts,
	mode: DelegationModeName,
): string {
	return `Exploration budget: ${lookups.toLocaleString("en-US")} tracked lookups and ${textBytes.toLocaleString("en-US")} UTF-8 text bytes (an approximate evidence budget). Ongoing discovery needs an explore child through spawn_child, even if read-only or initially small. ${mode === "orchestrator" ? "Reading that prepares a writer belongs in that writer's task." : "Preparation for an already-understood inline write remains exempt."} This is runtime context for the original task, not a new user request. This notice grants no mutation or guard bypass authority.`;
}
