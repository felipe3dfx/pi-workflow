import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import type { QaHandoffMcpPublication } from "./qa-handoff-mcp-publication.ts";
import type {
	QaHandoffAuthorizationOutcome,
	QaHandoffPublicationOutcome,
} from "./qa-handoff-workflow.ts";

export interface QaHandoffRuntimeWorkflow {
	authorizeInvocation(issueId: string): Promise<QaHandoffAuthorizationOutcome>;
	publish(input: unknown): Promise<QaHandoffPublicationOutcome>;
}

type QaHandoffRuntimeOutcome =
	| QaHandoffMcpPublication.PublishedHandoff
	| QaHandoffMcpPublication.Blocker;

export type QaHandoffRuntimeOptions =
	| {
			readonly workflow: QaHandoffRuntimeWorkflow;
			readonly mcpPublication?: never;
	  }
	| {
			readonly workflow?: never;
			readonly mcpPublication: QaHandoffMcpPublication;
	  };

export interface QaHandoffRuntime {
	readonly toolName: "workflow_qa_handoff";
	readonly allowedTools: readonly string[];
	clearActiveTurn(): void;
	handlePublicEntry(event: InputEvent): void;
	handleSettled(): void;
	hasActiveTurn(): boolean;
	hasPendingAnchorContinuation(): boolean;
	shouldContinue(event: InputEvent): boolean;
	execute(value: unknown): Promise<QaHandoffRuntimeOutcome>;
	register(pi: ExtensionAPI): void;
}

const publicEntryPattern = /^\/(?:skill:)?qa-handoff(?:\s|$)/;
const inputPattern =
	/^\/(?:skill:)?qa-handoff\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;
const continuationPattern = /^\s*([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;

const blocked = (
	code: string,
	message: string,
): QaHandoffMcpPublication.Blocker => ({
	status: "blocked",
	blocker: { code, message },
});

function errorCode(error: unknown, fallback: string): string {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		typeof error.code !== "string" ||
		error.code.length === 0
	)
		return fallback;
	return error.code;
}

export function createUnavailableQaHandoffWorkflow(): QaHandoffRuntimeWorkflow {
	const unavailable = () =>
		Promise.resolve(
			blocked(
				"PI_WORKFLOW_QA_HANDOFF_CONFIGURATION_REQUIRED",
				"The QA handoff artifact, Developer authority, and Linear adapters are not configured.",
			),
		);
	return {
		authorizeInvocation: unavailable,
		publish: unavailable,
	};
}

export function createQaHandoffRuntime(
	options: QaHandoffRuntimeOptions,
): QaHandoffRuntime {
	const toolName = "workflow_qa_handoff" as const;
	const workflow = "workflow" in options ? options.workflow : undefined;
	const mcpPublication =
		"mcpPublication" in options ? options.mcpPublication : undefined;
	let activeIssueId: string | undefined;
	let authorization: Promise<QaHandoffAuthorizationOutcome> | undefined;
	let awaitingAnchor = false;

	function clearAuthorization(): void {
		activeIssueId = undefined;
		authorization = undefined;
	}

	function clearActiveTurn(): void {
		clearAuthorization();
		mcpPublication?.clear();
		awaitingAnchor = false;
	}

	function authorize(issueId: string): void {
		awaitingAnchor = false;
		activeIssueId = issueId;
		if (mcpPublication) {
			mcpPublication.start(issueId);
			return;
		}
		authorization = workflow?.authorizeInvocation(issueId);
	}

	function handlePublicEntry(event: InputEvent): void {
		const publicEntry = publicEntryPattern.test(event.text);
		if (publicEntry) {
			clearActiveTurn();
			const match = event.text.match(inputPattern);
			if (match?.[1]) authorize(match[1]);
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
		if (continuation?.[1]) authorize(continuation[1]);
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

	function hasPendingAnchorContinuation(): boolean {
		return awaitingAnchor;
	}

	function handleSettled(): void {
		clearAuthorization();
		mcpPublication?.clear();
	}

	function hasActiveTurn(): boolean {
		return (
			activeIssueId !== undefined &&
			(mcpPublication !== undefined || authorization !== undefined)
		);
	}

	async function execute(value: unknown): Promise<QaHandoffRuntimeOutcome> {
		if (mcpPublication) {
			const outcome = mcpPublication.complete(value);
			clearAuthorization();
			return outcome;
		}
		const issueId = activeIssueId;
		const pendingAuthorization = authorization;
		clearActiveTurn();
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			Object.keys(value).length !== 1 ||
			!("issueId" in value) ||
			typeof value.issueId !== "string" ||
			value.issueId !== issueId ||
			!pendingAuthorization
		)
			return blocked(
				"PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID",
				"QA handoff accepts only the Linear issue ID bound to the active public turn.",
			);
		let authorized: QaHandoffAuthorizationOutcome;
		try {
			authorized = await pendingAuthorization;
		} catch (error) {
			return blocked(
				errorCode(error, "PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED"),
				error instanceof Error
					? error.message
					: "QA handoff preparation failed.",
			);
		}
		if (authorized.status !== "authorized") return authorized;
		if (!workflow)
			return blocked(
				"PI_WORKFLOW_QA_HANDOFF_CONFIGURATION_REQUIRED",
				"The QA handoff workflow is not configured.",
			);
		let publication: QaHandoffPublicationOutcome;
		try {
			publication = await workflow.publish({ issueId });
		} catch (error) {
			return blocked(
				errorCode(error, "PI_WORKFLOW_QA_HANDOFF_PUBLICATION_FAILED"),
				error instanceof Error
					? error.message
					: "QA handoff publication failed.",
			);
		}
		if (publication.status !== "published") return publication;
		return {
			status: "published",
			issueId,
			commentId: publication.comment.id,
		};
	}

	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", () => {
			if (!hasActiveTurn()) return undefined;
			const getAllTools = (
				pi as { getAllTools?: () => readonly { name: string }[] }
			).getAllTools;
			if (mcpPublication) {
				const available = new Set(
					getAllTools?.call(pi).map((tool) => tool.name) ?? [],
				);
				mcpPublication.setMcpAvailable(
					mcpPublication.allowedTools
						.filter((name) => name !== toolName)
						.every((name) => available.has(name)),
				);
			}
			const expected = mcpPublication?.expectedModelCall();
			return {
				systemPrompt: expected
					? [
							"You are executing the artifact-backed Linear MCP QA handoff for an explicitly admitted Developer turn.",
							`Call ${expected.toolName} exactly once with ${JSON.stringify(expected.input)}.`,
							"Do not call tools in parallel or provide additional fields. Follow only the next exact call exposed after each result.",
							"The exact root comment body is owned by the persisted artifact; do not alter it. Report the returned publication or blocker exactly.",
						].join(" ")
					: [
							"You are executing the implemented QA handoff workflow for an explicitly admitted Developer turn.",
							`Call ${toolName} exactly once with issueId="${activeIssueId}".`,
							"Do not provide a body, digest, authority, revision, workflow mutation, or any other field.",
							"Report the returned publication or blocker exactly.",
						].join(" "),
			};
		});
		pi.on("tool_call", (event) => mcpPublication?.handleToolCall(event));
		pi.on("tool_result", async (event) => {
			if (!mcpPublication) return undefined;
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
		const registerTool = (pi as { registerTool?: (tool: unknown) => void })
			.registerTool;
		registerTool?.({
			name: toolName,
			label: "QA Handoff Workflow",
			description:
				"Publish the exact artifact-backed QA handoff for the Linear issue bound to the active Developer turn.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["issueId"],
				properties: {
					issueId: {
						type: "string",
						pattern: "^[A-Z][A-Z0-9]*-[1-9][0-9]*$",
					},
				},
			},
			async execute(_toolCallId: string, input: unknown) {
				return {
					content: [
						{ type: "text", text: JSON.stringify(await execute(input)) },
					],
					details: {},
				};
			},
		});
	}

	return {
		toolName,
		allowedTools: mcpPublication?.allowedTools ?? [toolName],
		clearActiveTurn,
		handlePublicEntry,
		handleSettled,
		hasActiveTurn,
		hasPendingAnchorContinuation,
		shouldContinue,
		execute,
		register,
	};
}
