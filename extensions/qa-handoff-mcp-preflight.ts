interface Blocker {
	readonly status: "blocked";
	readonly blocker: { readonly code: string; readonly message: string };
}

interface AuthorizedPreflight {
	readonly status: "authorized";
	readonly issueId: string;
	readonly actorId: string;
	readonly issueRevision: string;
}

type Stage = "idle" | "current-user" | "current-user-result" | "issue" | "issue-result" | "ready" | "blocked";

const CURRENT_USER_TOOL = "linear_get_user";
const ISSUE_TOOL = "linear_get_issue";

const blocked = (code: string, message: string): Blocker => ({
	status: "blocked",
	blocker: { code, message },
});

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactInput(value: unknown, expected: Record<string, string>): boolean {
	return record(value) && Object.keys(value).length === Object.keys(expected).length &&
		Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function toolPayload(event: unknown): unknown {
	if (!record(event) || !Array.isArray(event.content)) return undefined;
	const texts = event.content.filter(record).filter((item) => item.type === "text").map((item) => item.text);
	if (texts.length !== 1 || !nonEmpty(texts[0])) return undefined;
	try {
		return JSON.parse(texts[0]);
	} catch {
		return undefined;
	}
}

export function createQaHandoffMcpPreflight() {
	let stage: Stage = "idle";
	let issueId: string | undefined;
	let actorId: string | undefined;
	let actorName: string | undefined;
	let issueRevision: string | undefined;
	let pendingToolCallId: string | undefined;
	let terminalBlocker: Blocker | undefined;
	let mcpAvailable: boolean | undefined;

	function fail(code: string, message: string): Blocker {
		terminalBlocker = blocked(code, message);
		stage = "blocked";
		pendingToolCallId = undefined;
		return terminalBlocker;
	}

	function setMcpAvailable(available: boolean): void {
		mcpAvailable = available;
		if (!available && stage !== "idle" && stage !== "blocked") {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE", "Authenticated compatible Linear MCP tools are required for QA handoff preflight.");
		}
	}

	function start(id: string): void {
		issueId = id;
		actorId = undefined;
		actorName = undefined;
		issueRevision = undefined;
		pendingToolCallId = undefined;
		terminalBlocker = undefined;
		stage = "current-user";
		if (mcpAvailable === false) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE", "Authenticated compatible Linear MCP tools are required for QA handoff preflight.");
		}
	}

	function clear(): void {
		stage = "idle";
		issueId = undefined;
		actorId = undefined;
		actorName = undefined;
		issueRevision = undefined;
		pendingToolCallId = undefined;
		terminalBlocker = undefined;
	}

	function hasActiveTurn(): boolean {
		return stage !== "idle";
	}

	function expectedCall(): { readonly toolName: string; readonly input: Record<string, string> } | undefined {
		if (stage === "current-user") return { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
		if (stage === "issue" && issueId) return { toolName: ISSUE_TOOL, input: { id: issueId } };
		if (stage === "ready" && issueId) return { toolName: "workflow_qa_handoff", input: { issueId } };
		return undefined;
	}

	function handleToolCall(event: { readonly toolName: string; readonly toolCallId?: string; readonly input?: unknown }): { block: true; reason: string } | undefined {
		if (!hasActiveTurn()) return undefined;
		if (event.toolName === "read" && stage === "current-user" && record(event.input) &&
			Object.keys(event.input).length === 1 && nonEmpty(event.input.path) &&
			event.input.path.endsWith("/skills/qa-handoff/SKILL.md")) return undefined;
		const expected = expectedCall();
		if (!expected || event.toolName !== expected.toolName || !exactInput(event.input, expected.input)) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID", "QA handoff MCP tool, input, issue, or stage did not match the active read-only plan.");
			return { block: true, reason: terminalBlocker?.blocker.code ?? "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID" };
		}
		if (event.toolName === CURRENT_USER_TOOL || event.toolName === ISSUE_TOOL) {
			if (!nonEmpty(event.toolCallId)) {
				fail("PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE", "Linear MCP did not provide a stable tool call identity.");
				return { block: true, reason: terminalBlocker?.blocker.code ?? "PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE" };
			}
			pendingToolCallId = event.toolCallId;
			stage = event.toolName === CURRENT_USER_TOOL ? "current-user-result" : "issue-result";
		}
		return undefined;
	}

	function handleToolResult(event: { readonly toolName: string; readonly toolCallId?: string; readonly content?: unknown; readonly isError?: boolean }): void {
		if (!hasActiveTurn() || (event.toolName !== CURRENT_USER_TOOL && event.toolName !== ISSUE_TOOL)) return;
		const expectedStage = event.toolName === CURRENT_USER_TOOL ? "current-user-result" : "issue-result";
		if (stage !== expectedStage || event.toolCallId !== pendingToolCallId || event.isError === true) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE", "Linear MCP returned an out-of-order, failed, or incompatible result.");
			return;
		}
		const payload = toolPayload(event);
		if (!record(payload)) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE", "Linear MCP returned a partial or malformed response.");
			return;
		}
		pendingToolCallId = undefined;
		if (event.toolName === CURRENT_USER_TOOL) {
			if (!nonEmpty(payload.id) || !nonEmpty(payload.name) || payload.isActive !== true || payload.isGuest !== false) {
				fail("PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH", "The authenticated Linear actor does not have verifiable Developer authority.");
				return;
			}
			actorId = payload.id;
			actorName = payload.name;
			stage = "issue";
			return;
		}
		const assignee = payload.assignee;
		const labels = Array.isArray(payload.labels)
			? payload.labels.map((label) => typeof label === "string" ? label : record(label) ? label.name : undefined)
			: [];
		if ((payload.id !== issueId && payload.identifier !== issueId) || !nonEmpty(payload.updatedAt)) {
			fail("PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH", "Linear MCP returned a different or unrevisioned issue.");
			return;
		}
		if (!record(assignee) || assignee.id !== actorId || !actorName ||
			!labels.includes(`Assign To / ${actorName}`)) {
			fail("PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH", "The authenticated actor is not both the assigned and labeled Developer for the issue.");
			return;
		}
		issueRevision = payload.updatedAt;
		stage = "ready";
	}

	function complete(input: unknown): AuthorizedPreflight | Blocker {
		if (terminalBlocker) return terminalBlocker;
		if (stage !== "ready" || !issueId || !actorId || !issueRevision || !exactInput(input, { issueId })) {
			return fail("PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID", "QA handoff preflight is incomplete or does not match the active issue.");
		}
		const result: AuthorizedPreflight = { status: "authorized", issueId, actorId, issueRevision };
		clear();
		return result;
	}

	return {
		allowedTools: [CURRENT_USER_TOOL, ISSUE_TOOL, "workflow_qa_handoff"] as const,
		start,
		setMcpAvailable,
		clear,
		hasActiveTurn,
		expectedCall,
		handleToolCall,
		handleToolResult,
		complete,
	};
}
