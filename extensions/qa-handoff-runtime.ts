import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";

interface QaHandoffRuntimeWorkflow {
	authorizeInvocation(issueId: string): Promise<unknown>;
	publish(input: unknown): Promise<unknown>;
}

interface RuntimeOutcome {
	readonly status: string;
	readonly blocker?: { readonly code: string; readonly message: string };
}

const publicEntryPattern = /^\/(?:skill:)?qa-handoff(?:\s|$)/;
const inputPattern =
	/^\/(?:skill:)?qa-handoff\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;
const continuationPattern = /^\s*([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;

const blocked = (code: string, message: string): RuntimeOutcome => ({
	status: "blocked",
	blocker: { code, message },
});

function errorCode(error: unknown, fallback: string): string {
	if (!error || typeof error !== "object" || !("code" in error) ||
		typeof error.code !== "string" || error.code.length === 0) return fallback;
	return error.code;
}

export function createUnavailableQaHandoffWorkflow(): QaHandoffRuntimeWorkflow {
	const unavailable = () => Promise.resolve(blocked(
		"PI_WORKFLOW_QA_HANDOFF_CONFIGURATION_REQUIRED",
		"The QA handoff artifact, Developer authority, and Linear adapters are not configured.",
	));
	return {
		authorizeInvocation: unavailable,
		publish: unavailable,
	};
}

export function createQaHandoffRuntime(options: {
	readonly workflow: QaHandoffRuntimeWorkflow;
}) {
	const toolName = "workflow_qa_handoff";
	let activeIssueId: string | undefined;
	let authorization: Promise<unknown> | undefined;
	let awaitingAnchor = false;

	function clearAuthorization(): void {
		activeIssueId = undefined;
		authorization = undefined;
	}

	function clearActiveTurn(): void {
		clearAuthorization();
		awaitingAnchor = false;
	}

	function authorize(issueId: string): void {
		awaitingAnchor = false;
		activeIssueId = issueId;
		authorization = options.workflow.authorizeInvocation(issueId);
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
		if (!awaitingAnchor || event.source !== "interactive" ||
			event.streamingBehavior !== undefined) return;
		const continuation = event.text.match(continuationPattern);
		if (continuation?.[1]) authorize(continuation[1]);
	}

	function shouldContinue(event: InputEvent): boolean {
		if (!awaitingAnchor) return false;
		const accepted = event.source === "interactive" &&
			event.streamingBehavior === undefined &&
			continuationPattern.test(event.text);
		if (!accepted && event.source === "interactive" &&
			event.streamingBehavior === undefined) awaitingAnchor = false;
		return accepted;
	}

	function hasPendingAnchorContinuation(): boolean {
		return awaitingAnchor;
	}

	function handleSettled(): void {
		clearAuthorization();
	}

	function hasActiveTurn(): boolean {
		return activeIssueId !== undefined && authorization !== undefined;
	}

	async function execute(value: unknown): Promise<unknown> {
		const issueId = activeIssueId;
		const pendingAuthorization = authorization;
		clearActiveTurn();
		if (!value || typeof value !== "object" || Array.isArray(value) ||
			Object.keys(value).length !== 1 || !("issueId" in value) ||
			typeof value.issueId !== "string" || value.issueId !== issueId ||
			!pendingAuthorization)
			return blocked(
				"PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID",
				"QA handoff accepts only the Linear issue ID bound to the active public turn.",
			);
		let authorized: unknown;
		try {
			authorized = await pendingAuthorization;
		} catch (error) {
			return blocked(
				errorCode(error, "PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED"),
				error instanceof Error ? error.message : "QA handoff preparation failed.",
			);
		}
		if (!authorized || typeof authorized !== "object" ||
			(authorized as { status?: unknown }).status !== "authorized") return authorized;
		let publication: unknown;
		try {
			publication = await options.workflow.publish({ issueId });
		} catch (error) {
			return blocked(
				errorCode(error, "PI_WORKFLOW_QA_HANDOFF_PUBLICATION_FAILED"),
				error instanceof Error ? error.message : "QA handoff publication failed.",
			);
		}
		if (!publication || typeof publication !== "object" ||
			(publication as { status?: unknown }).status !== "published") return publication;
		const commentId = (publication as { comment?: { id?: unknown } }).comment?.id;
		return {
			status: "published",
			issueId,
			...(typeof commentId === "string" ? { commentId } : {}),
		};
	}

	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", () => {
			if (!hasActiveTurn()) return undefined;
			return {
				systemPrompt: [
					"You are executing the implemented QA handoff workflow for an explicitly admitted Developer turn.",
					`Call ${toolName} exactly once with issueId="${activeIssueId}".`,
					"Do not provide a body, digest, authority, revision, workflow mutation, or any other field.",
					"Report the returned publication or blocker exactly.",
				].join(" "),
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
					content: [{ type: "text", text: JSON.stringify(await execute(input)) }],
					details: {},
				};
			},
		});
	}

	return {
		toolName,
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
