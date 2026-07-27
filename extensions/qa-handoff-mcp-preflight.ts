import { produceQaHandoffDraft } from "./qa-handoff-draft-producer.ts";
import type { QaHandoffDraftStore } from "./qa-handoff-draft-store.ts";
import { canonicalJson } from "./workflow-contracts.ts";

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

interface AuthenticatedLinearActor {
	readonly id: string;
	readonly name: string;
	readonly isActive: boolean;
	readonly isGuest: boolean;
}

interface LinearIssueEvidence {
	readonly id: string;
	readonly identifier?: string;
	readonly updatedAt: string;
	readonly assignee: { readonly id: string };
	readonly labels: readonly string[];
	readonly description: string;
	readonly attachments: readonly { readonly id: string; readonly title: string; readonly url: string }[];
}

type Stage = "idle" | "current-user" | "current-user-result" | "issue" | "issue-result" | "ready" | "blocked";
type McpErrorClassification = "unauthenticated" | "incompatible";

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
	if (!record(event) || !Array.isArray(event.content) || event.content.length !== 1) return undefined;
	const [content] = event.content;
	if (!record(content) || Object.keys(content).length !== 2 ||
		content.type !== "text" || !nonEmpty(content.text)) return undefined;
	try {
		return JSON.parse(content.text);
	} catch {
		return undefined;
	}
}

function classifyMcpError(event: unknown): McpErrorClassification {
	const payload = toolPayload(event);
	return record(payload) && Object.keys(payload).length === 1 &&
		payload.code === "UNAUTHENTICATED"
		? "unauthenticated"
		: "incompatible";
}

function actorEvidence(value: unknown): value is AuthenticatedLinearActor {
	return record(value) && nonEmpty(value.id) && nonEmpty(value.name) &&
		typeof value.isActive === "boolean" && typeof value.isGuest === "boolean";
}

function linearRevision(value: unknown): value is string {
	return nonEmpty(value) &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
		!Number.isNaN(Date.parse(value));
}

function issueEvidence(value: unknown): LinearIssueEvidence | undefined {
	if (!record(value) || !nonEmpty(value.id) ||
		(value.identifier !== undefined && !nonEmpty(value.identifier)) ||
		!linearRevision(value.updatedAt) || !record(value.assignee) ||
		!nonEmpty(value.assignee.id) || !Array.isArray(value.labels) ||
		!nonEmpty(value.description) || !Array.isArray(value.attachments)) return undefined;
	const labels: string[] = [];
	for (const label of value.labels) {
		if (typeof label === "string" && nonEmpty(label)) {
			labels.push(label);
			continue;
		}
		if (!record(label) || !nonEmpty(label.name)) return undefined;
		labels.push(label.name);
	}
	const attachments: { id: string; title: string; url: string }[] = [];
	for (const attachment of value.attachments) {
		if (!record(attachment) || !nonEmpty(attachment.id) ||
			!nonEmpty(attachment.title) || !nonEmpty(attachment.url)) return undefined;
		attachments.push({ id: attachment.id, title: attachment.title, url: attachment.url });
	}
	return {
		id: value.id,
		...(value.identifier === undefined ? {} : { identifier: value.identifier }),
		updatedAt: value.updatedAt,
		assignee: { id: value.assignee.id },
		labels,
		description: value.description,
		attachments,
	};
}

export function createQaHandoffMcpPreflight(options: { readonly drafts: QaHandoffDraftStore }) {
	let stage: Stage = "idle";
	let issueId: string | undefined;
	let actorId: string | undefined;
	let actorName: string | undefined;
	let issueRevision: string | undefined;
	let verifiedIssue: LinearIssueEvidence | undefined;
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
		verifiedIssue = undefined;
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
		verifiedIssue = undefined;
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
		if (stage !== expectedStage || event.toolCallId !== pendingToolCallId) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE", "Linear MCP returned an out-of-order, failed, or incompatible result.");
			return;
		}
		if (event.isError === true) {
			const classification = classifyMcpError(event);
			fail(
				classification === "unauthenticated"
					? "PI_WORKFLOW_QA_HANDOFF_MCP_UNAUTHENTICATED"
					: "PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
				classification === "unauthenticated"
					? "Linear MCP is present but not authenticated."
					: "Linear MCP returned an out-of-order, failed, or incompatible result.",
			);
			return;
		}
		const payload = toolPayload(event);
		if (!record(payload)) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE", "Linear MCP returned a partial or malformed response.");
			return;
		}
		if (classifyMcpError(event) === "unauthenticated") {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE", "Linear MCP returned an incomplete or ambiguous authentication signal.");
			return;
		}
		pendingToolCallId = undefined;
		if (event.toolName === CURRENT_USER_TOOL) {
			if (!actorEvidence(payload)) {
				fail("PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE", "Linear MCP returned partial or malformed actor evidence.");
				return;
			}
			if (payload.isActive !== true || payload.isGuest !== false) {
				fail("PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH", "The authenticated Linear actor does not have verifiable Developer authority.");
				return;
			}
			actorId = payload.id;
			actorName = payload.name;
			stage = "issue";
			return;
		}
		const issue = issueEvidence(payload);
		if (!issue) {
			fail("PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE", "Linear MCP returned partial or malformed issue evidence.");
			return;
		}
		const exactIdentifier = issue.identifier ?? issue.id;
		if (exactIdentifier !== issueId) {
			fail("PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH", "Linear MCP returned a different issue identifier.");
			return;
		}
		if (issue.assignee.id !== actorId || !actorName ||
			!issue.labels.includes(`Assign To / ${actorName}`)) {
			fail("PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH", "The authenticated actor is not both the assigned and labeled Developer for the issue.");
			return;
		}
		issueRevision = issue.updatedAt;
		verifiedIssue = issue;
		stage = "ready";
	}

	async function complete(input: unknown): Promise<(AuthorizedPreflight & { readonly draftDigest: string }) | Blocker> {
		if (terminalBlocker) return terminalBlocker;
		if (stage !== "ready" || !issueId || !actorId || !issueRevision ||
			!verifiedIssue || !exactInput(input, { issueId })) {
			return fail("PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID", "QA handoff preflight is incomplete or does not match the active issue.");
		}
		const authorized = { issueId, actorId, issueRevision, issue: verifiedIssue };
		const produced = produceQaHandoffDraft(authorized.issue);
		if (produced.status === "blocked") return fail(produced.blocker.code, produced.blocker.message);
		try {
			const artifact = await options.drafts.save({ issueId: authorized.issueId, draft: produced.draft });
			const readBack = await options.drafts.read(authorized.issueId);
			if (!readBack || canonicalJson(readBack) !== canonicalJson(produced.draft))
				return fail("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "The persisted QA handoff draft read-back did not match.");
			const result = {
				status: "authorized" as const,
				issueId: authorized.issueId,
				actorId: authorized.actorId,
				issueRevision: authorized.issueRevision,
				draftDigest: artifact.digest,
			};
			clear();
			return result;
		} catch (error) {
			const code = record(error) && nonEmpty(error.code)
				? error.code
				: "PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED";
			return fail(
				code,
				error instanceof Error ? error.message : "QA handoff draft persistence failed.",
			);
		}
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
