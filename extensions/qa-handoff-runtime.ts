import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import type { QaHandoffMcpPublication } from "./qa-handoff-mcp-publication.ts";
import { isReadOnlyEngramCall } from "./public-entry-guard.ts";

type QaHandoffRuntimeOutcome =
	| QaHandoffMcpPublication.PublishedHandoff
	| QaHandoffMcpPublication.ContinuingHandoff
	| QaHandoffMcpPublication.CancelledHandoff
	| QaHandoffMcpPublication.Blocker;

export interface QaHandoffRuntimeOptions {
	readonly mcpPublication: QaHandoffMcpPublication;
}

export interface QaHandoffRuntime {
	readonly toolName: "workflow_qa_handoff";
	readonly allowedTools: readonly string[];
	clearActiveTurn(): void;
	handlePublicEntry(event: InputEvent): void;
	handleSettled(): void;
	hasActiveTurn(): boolean;
	hasPendingAnchorContinuation(): boolean;
	hasPendingSelection(): boolean;
	shouldContinue(event: InputEvent): boolean;
	execute(value: unknown): Promise<QaHandoffRuntimeOutcome>;
	register(pi: ExtensionAPI): void;
}

const publicEntryPattern = /^\/(?:skill:)?qa-handoff(?:\s|$)/;
const inputPattern =
	/^\/(?:skill:)?qa-handoff\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;
const continuationPattern = /^\s*([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;

function status(value: unknown): string | undefined {
	return value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		"status" in value &&
		typeof value.status === "string"
		? value.status
		: undefined;
}

export function createQaHandoffRuntime(
	options: QaHandoffRuntimeOptions,
): QaHandoffRuntime {
	const toolName = "workflow_qa_handoff" as const;
	const mcpPublication = options.mcpPublication;
	let activeIssueId: string | undefined;
	let awaitingAnchor = false;
	let awaitingSelection = false;
	const readOnlyEngramToolCallIds = new Set<string>();

	function clearActiveTurn(): void {
		activeIssueId = undefined;
		awaitingAnchor = false;
		awaitingSelection = false;
		readOnlyEngramToolCallIds.clear();
		mcpPublication.clear();
	}

	function start(issueId: string): void {
		awaitingAnchor = false;
		activeIssueId = issueId;
		mcpPublication.start(issueId);
	}

	function handlePublicEntry(event: InputEvent): void {
		if (publicEntryPattern.test(event.text)) {
			clearActiveTurn();
			const match = event.text.match(inputPattern);
			if (match?.[1]) start(match[1]);
			else awaitingAnchor = true;
			return;
		}
		if (
			!awaitingAnchor ||
			event.source !== "interactive" ||
			event.streamingBehavior !== undefined
		)
			return;
		const continuation = event.text.match(continuationPattern);
		if (continuation?.[1]) start(continuation[1]);
	}

	function shouldContinue(event: InputEvent): boolean {
		if (!awaitingAnchor) return false;
		const accepted =
			event.source === "interactive" &&
			event.streamingBehavior === undefined &&
			continuationPattern.test(event.text);
		if (
			!accepted &&
			event.source === "interactive" &&
			event.streamingBehavior === undefined
		)
			awaitingAnchor = false;
		return accepted;
	}

	async function execute(value: unknown): Promise<QaHandoffRuntimeOutcome> {
		const outcome = await mcpPublication.complete(value);
		if (status(outcome) !== "continuing") activeIssueId = undefined;
		return outcome;
	}

	function handleSettled(): void {
		awaitingSelection = mcpPublication.hasPendingDeveloperSelection();
	}

	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", () => {
			if (!activeIssueId) return undefined;
			const getActiveTools = (
				pi as { getActiveTools?: () => readonly string[] }
			).getActiveTools;
			const available = new Set(getActiveTools?.call(pi) ?? []);
			mcpPublication.setMcpAvailable(
				mcpPublication.allowedTools
					.filter((name) => name !== toolName)
					.every((name) => available.has(name)),
			);
			const expected = mcpPublication.expectedModelCall();
			return {
				systemPrompt: expected
					? `You are executing the artifact-backed Linear MCP QA handoff for an explicitly admitted Developer turn. Call ${expected.toolName} exactly once with ${JSON.stringify(expected.input)}. Do not call tools in parallel or provide additional fields. Follow only the next exact call exposed after each result.`
					: mcpPublication.hasPendingDeveloperSelection()
						? `Wait for the shared QA handoff decision descriptor. After it records a choice, call ${toolName} with exactly action="publish_handoff" or action="cancel_decision" to match that claim. Never infer approval from prose.`
						: "Report the active QA handoff blocker exactly. Communicate in the language used by the user.",
			};
		});
		pi.on("tool_call", (event) => {
			if (isReadOnlyEngramCall(event)) {
				if (typeof event.toolCallId === "string")
					readOnlyEngramToolCallIds.add(event.toolCallId);
				return undefined;
			}
			return mcpPublication.handleToolCall(event);
		});
		pi.on("tool_result", async (event) => {
			if (
				typeof event.toolCallId === "string" &&
				readOnlyEngramToolCallIds.delete(event.toolCallId)
			)
				return undefined;
			const processed = await mcpPublication.handleToolResult(event);
			if (!processed) return undefined;
			const instruction = mcpPublication.nextCallInstruction();
			if (!instruction) return undefined;
			return {
				content: [
					...event.content,
					{ type: "text" as const, text: instruction },
				],
			};
		});
		pi.on("agent_settled", handleSettled);
		pi.on("session_start", clearActiveTurn);
		pi.on("session_shutdown", clearActiveTurn);
		pi.registerTool?.({
			name: toolName,
			label: "QA Handoff Workflow",
			description:
				"Publish a Developer-approved artifact-backed QA handoff bound to the active turn.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["action"],
				properties: {
					action: {
						type: "string",
						enum: ["publish_handoff", "cancel_decision"],
					},
				},
			},
			async execute(_toolCallId: string, input: unknown) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(await execute(input)),
						},
					],
					details: {},
				};
			},
		});
	}

	return {
		toolName,
		allowedTools: mcpPublication.allowedTools,
		clearActiveTurn,
		handlePublicEntry,
		handleSettled,
		hasActiveTurn: () => mcpPublication.hasActiveTurn(),
		hasPendingAnchorContinuation: () => awaitingAnchor,
		hasPendingSelection: () => awaitingSelection,
		shouldContinue,
		execute,
		register,
	};
}
