import { randomUUID } from "node:crypto";

import { produceQaHandoffDraft } from "./qa-handoff-draft-producer.ts";
import type { QaHandoffPublicationRecoveryStore } from "./qa-handoff-publication-recovery.ts";
import type { QaHandoffDraftStore } from "./qa-handoff-draft-store.ts";
import {
	createQaHandoffArtifact,
	inspectQaHandoffReferences,
	isQaHandoffArtifact,
	type QaHandoffArtifact,
	type QaHandoffArtifactStore,
} from "./qa-handoff-workflow.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";

export namespace QaHandoffMcpPublication {
	export interface Blocker {
		readonly status: "blocked";
		readonly blocker: { readonly code: string; readonly message: string };
	}

	export interface PublishedHandoff {
		readonly status: "published";
		readonly issueId: string;
		readonly commentId: string;
	}

	export interface ExpectedCall {
		readonly toolName: string;
		readonly input: Readonly<Record<string, unknown>>;
	}

	export interface ToolCallEvent {
		readonly toolName: string;
		readonly toolCallId?: string;
		input?: unknown;
	}

	export interface ToolResultEvent {
		readonly toolName: string;
		readonly toolCallId?: string;
		readonly content?: unknown;
		readonly isError?: boolean;
	}
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
	readonly title: string;
	readonly description: string;
	readonly updatedAt: string;
	readonly status: {
		readonly name: string;
		readonly type: string;
	};
	readonly assignee: { readonly id: string; readonly name: string };
	readonly cycle: { readonly id: string } | null;
	readonly labels: readonly string[];
	readonly estimate: unknown;
	readonly relations: {
		readonly blockedBy: readonly Readonly<Record<string, unknown>>[];
		readonly blocks: readonly Readonly<Record<string, unknown>>[];
		readonly relatedTo: readonly Readonly<Record<string, unknown>>[];
		readonly duplicateOf: Readonly<Record<string, unknown>> | null;
	};
	readonly parent: { readonly id: string } | null;
	readonly attachments: readonly {
		readonly id: string;
		readonly title: string;
		readonly url: string;
	}[];
}

interface LinearComment {
	readonly id: string;
	readonly body: string;
	readonly isRoot: boolean;
}

interface IssueOnlyContext {
	readonly issueId: string;
}

interface AuthenticatedContext extends IssueOnlyContext {
	readonly actor: AuthenticatedLinearActor;
}

interface SnapshottedContext extends AuthenticatedContext {
	readonly issueRevision: string;
	readonly verifiedIssue: LinearIssueEvidence;
}

interface PreparedContext extends SnapshottedContext {
	readonly preparedArtifact: QaHandoffArtifact;
	readonly recoveryStage?: "uncertain" | "verified";
}

interface SelectedContext extends PreparedContext {
	readonly createdComment: LinearComment;
}

interface CompletedContext extends SelectedContext {
	readonly publication: QaHandoffMcpPublication.PublishedHandoff;
}

interface CommentRead {
	readonly comments: readonly LinearComment[];
	readonly cursor?: string;
	readonly seenCursors: ReadonlySet<string>;
}

type PublicationState =
	| { readonly phase: "idle" }
	| {
			readonly phase: "current-user";
			readonly context: IssueOnlyContext;
	  }
	| {
			readonly phase: "current-user-result";
			readonly context: IssueOnlyContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue";
			readonly context: AuthenticatedContext;
	  }
	| {
			readonly phase: "issue-result";
			readonly context: AuthenticatedContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue-verify";
			readonly context: SnapshottedContext;
	  }
	| {
			readonly phase: "issue-verify-result";
			readonly context: SnapshottedContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "comments-before";
			readonly context: PreparedContext;
			readonly read: CommentRead;
	  }
	| {
			readonly phase: "comments-before-result";
			readonly context: PreparedContext;
			readonly read: CommentRead;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "current-user-before-mutation";
			readonly context: PreparedContext;
	  }
	| {
			readonly phase: "current-user-before-mutation-result";
			readonly context: PreparedContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue-before-mutation";
			readonly context: PreparedContext;
	  }
	| {
			readonly phase: "issue-before-mutation-result";
			readonly context: PreparedContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "comment-create";
			readonly context: PreparedContext;
	  }
	| {
			readonly phase: "comment-create-result";
			readonly context: PreparedContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "comments-readback";
			readonly context: SelectedContext;
			readonly read: CommentRead;
	  }
	| {
			readonly phase: "comments-readback-result";
			readonly context: SelectedContext;
			readonly read: CommentRead;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue-final";
			readonly context: CompletedContext;
	  }
	| {
			readonly phase: "issue-final-result";
			readonly context: CompletedContext;
			readonly toolCallId: string;
	  }
	| { readonly phase: "ready"; readonly context: CompletedContext }
	| BlockerState;

interface BlockerState extends QaHandoffMcpPublication.Blocker {
	readonly phase: "blocked";
}

type McpErrorClassification =
	| "unauthenticated"
	| "permission-denied"
	| "rate-limited"
	| "transport-failed"
	| "incompatible";
type PublicationPhaseDispatch =
	| { readonly kind: "inactive" }
	| {
			readonly kind: "tool-call";
			readonly expectedCall: QaHandoffMcpPublication.ExpectedCall;
			readonly expectedModelCall: QaHandoffMcpPublication.ExpectedCall;
			readonly transition: (toolCallId: string) => PublicationState;
			readonly replacementBody?: string;
	  }
	| {
			readonly kind: "tool-result";
			readonly expectedTool: string;
			readonly toolCallId: string;
			readonly transition: (
				payload: Record<string, unknown>,
			) => PublicationState | Promise<PublicationState>;
	  }
	| {
			readonly kind: "completion";
			readonly expectedCall: QaHandoffMcpPublication.ExpectedCall;
			readonly transition: () => PublicationState;
	  };

export interface QaHandoffMcpPublicationDependencies {
	readonly drafts: QaHandoffDraftStore;
	readonly artifacts: QaHandoffArtifactStore;
	readonly recovery: QaHandoffPublicationRecoveryStore;
	/** Optional stricter fail-closed cap; it cannot exceed the runtime maximum. */
	readonly toolIdentityReservationCapacity?: number;
}

export interface QaHandoffMcpPublication {
	readonly allowedTools: readonly [
		"linear_get_user",
		"linear_get_issue",
		"linear_list_comments",
		"linear_save_comment",
		"workflow_qa_handoff",
	];
	start(issueId: string): void;
	setMcpAvailable(available: boolean): void;
	clear(): void;
	hasActiveTurn(): boolean;
	expectedCall(): QaHandoffMcpPublication.ExpectedCall | undefined;
	expectedModelCall(): QaHandoffMcpPublication.ExpectedCall | undefined;
	nextCallInstruction(): string | undefined;
	handleToolCall(
		event: QaHandoffMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined>;
	handleToolResult(
		event: QaHandoffMcpPublication.ToolResultEvent,
	): Promise<boolean>;
	complete(
		input: unknown,
	): Promise<
		QaHandoffMcpPublication.PublishedHandoff | QaHandoffMcpPublication.Blocker
	>;
}

const CURRENT_USER_TOOL = "linear_get_user";
const ISSUE_TOOL = "linear_get_issue";
const LIST_COMMENTS_TOOL = "linear_list_comments";
const SAVE_COMMENT_TOOL = "linear_save_comment";
const WORKFLOW_TOOL = "workflow_qa_handoff";
const CANONICAL_BODY_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY";
const MCP_TOOLS = new Set([
	CURRENT_USER_TOOL,
	ISSUE_TOOL,
	LIST_COMMENTS_TOOL,
	SAVE_COMMENT_TOOL,
]);

const blocked = (
	code: string,
	message: string,
): QaHandoffMcpPublication.Blocker => ({
	status: "blocked",
	blocker: { code, message },
});

const failed = (code: string, message: string): BlockerState => ({
	phase: "blocked",
	...blocked(code, message),
});

const CANCELLED_GENERATION = Symbol("cancelled QA handoff generation");
const MAX_RUNTIME_RESERVED_TOOL_IDENTITIES = 16_384;
type GenerationGuard = () => boolean;

function ensureGenerationActive(isActive: GenerationGuard): void {
	if (!isActive()) throw CANCELLED_GENERATION;
}

function assertNever(value: never): never {
	throw new Error(
		`Unhandled QA handoff publication state: ${JSON.stringify(value)}`,
	);
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactInput(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	return (
		record(value) &&
		Object.keys(value).length === Object.keys(expected).length &&
		Object.entries(expected).every(
			([key, expectedValue]) => value[key] === expectedValue,
		)
	);
}

function nonEmpty(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value === value.trim()
	);
}

function toolPayload(event: unknown): unknown {
	if (
		!record(event) ||
		!Array.isArray(event.content) ||
		event.content.length !== 1
	)
		return undefined;
	const [content] = event.content;
	if (
		!record(content) ||
		Object.keys(content).length !== 2 ||
		content.type !== "text" ||
		!nonEmpty(content.text)
	)
		return undefined;
	try {
		return JSON.parse(content.text);
	} catch {
		return undefined;
	}
}

function classifyMcpError(event: unknown): McpErrorClassification {
	const payload = toolPayload(event);
	if (!record(payload)) return "incompatible";
	const keys = Object.keys(payload);
	const validOperationalEnvelope =
		keys.every((key) => key === "code" || key === "message") &&
		(payload.message === undefined || nonEmpty(payload.message));
	switch (payload.code) {
		case "UNAUTHENTICATED":
			return keys.length === 1 ? "unauthenticated" : "incompatible";
		case "PERMISSION_DENIED":
			return validOperationalEnvelope ? "permission-denied" : "incompatible";
		case "RATE_LIMITED":
			return validOperationalEnvelope ? "rate-limited" : "incompatible";
		case "TRANSPORT_ERROR":
			return validOperationalEnvelope ? "transport-failed" : "incompatible";
		default:
			return "incompatible";
	}
}

function actorEvidence(value: unknown): value is AuthenticatedLinearActor {
	return (
		record(value) &&
		nonEmpty(value.id) &&
		nonEmpty(value.name) &&
		typeof value.isActive === "boolean" &&
		typeof value.isGuest === "boolean"
	);
}

function linearRevision(value: unknown): value is string {
	return (
		nonEmpty(value) &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
		!Number.isNaN(Date.parse(value))
	);
}

function jsonCompatible(value: unknown): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(jsonCompatible);
	return record(value) && Object.values(value).every(jsonCompatible);
}

function relationList(
	value: unknown,
): Readonly<Record<string, unknown>>[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const relations: Readonly<Record<string, unknown>>[] = [];
	for (const relation of value) {
		if (
			!record(relation) ||
			!nonEmpty(relation.id) ||
			!jsonCompatible(relation)
		)
			return undefined;
		relations.push(structuredClone(relation));
	}
	return relations.sort((left, right) =>
		canonicalJson(left).localeCompare(canonicalJson(right)),
	);
}

function issueEvidence(value: unknown): LinearIssueEvidence | undefined {
	if (
		!record(value) ||
		!nonEmpty(value.id) ||
		(value.identifier !== undefined && !nonEmpty(value.identifier)) ||
		!nonEmpty(value.title) ||
		!nonEmpty(value.description) ||
		!linearRevision(value.updatedAt) ||
		!nonEmpty(value.status) ||
		!nonEmpty(value.statusType) ||
		!nonEmpty(value.assignee) ||
		!nonEmpty(value.assigneeId) ||
		!(
			value.cycleId === undefined ||
			value.cycleId === null ||
			nonEmpty(value.cycleId)
		) ||
		!Array.isArray(value.labels) ||
		value.labels.some((label) => !nonEmpty(label)) ||
		!jsonCompatible(value.estimate ?? null) ||
		!record(value.relations) ||
		!(
			value.parentId === undefined ||
			value.parentId === null ||
			nonEmpty(value.parentId)
		) ||
		!Array.isArray(value.attachments)
	)
		return undefined;
	const blockedBy = relationList(value.relations.blockedBy);
	const blocks = relationList(value.relations.blocks);
	const relatedTo = relationList(value.relations.relatedTo);
	const duplicateOf = value.relations.duplicateOf;
	if (
		!blockedBy ||
		!blocks ||
		!relatedTo ||
		!(
			duplicateOf === undefined ||
			duplicateOf === null ||
			(record(duplicateOf) &&
				nonEmpty(duplicateOf.id) &&
				jsonCompatible(duplicateOf))
		)
	)
		return undefined;
	const attachments: { id: string; title: string; url: string }[] = [];
	for (const attachment of value.attachments) {
		if (
			!record(attachment) ||
			!nonEmpty(attachment.id) ||
			!nonEmpty(attachment.title) ||
			!nonEmpty(attachment.url)
		)
			return undefined;
		attachments.push({
			id: attachment.id,
			title: attachment.title,
			url: attachment.url,
		});
	}
	return {
		id: value.id,
		...(value.identifier === undefined ? {} : { identifier: value.identifier }),
		title: value.title,
		description: value.description,
		updatedAt: value.updatedAt,
		status: { name: value.status, type: value.statusType },
		assignee: { id: value.assigneeId, name: value.assignee },
		cycle:
			value.cycleId === undefined || value.cycleId === null
				? null
				: { id: value.cycleId },
		labels: [...value.labels].sort(),
		estimate: structuredClone(value.estimate ?? null),
		relations: {
			blockedBy,
			blocks,
			relatedTo,
			duplicateOf:
				duplicateOf === undefined || duplicateOf === null
					? null
					: structuredClone(duplicateOf),
		},
		parent:
			value.parentId === undefined || value.parentId === null
				? null
				: { id: value.parentId },
		attachments: attachments.sort((left, right) =>
			left.id.localeCompare(right.id),
		),
	};
}

function commentPage(value: unknown):
	| {
			readonly comments: readonly LinearComment[];
			readonly nextCursor?: string;
	  }
	| undefined {
	if (
		!record(value) ||
		!Array.isArray(value.comments) ||
		typeof value.hasNextPage !== "boolean"
	)
		return undefined;
	const comments: LinearComment[] = [];
	for (const comment of value.comments) {
		if (
			!record(comment) ||
			!nonEmpty(comment.id) ||
			typeof comment.body !== "string" ||
			(comment.quotedText !== undefined &&
				comment.quotedText !== null &&
				typeof comment.quotedText !== "string") ||
			(comment.parentId !== undefined &&
				comment.parentId !== null &&
				!nonEmpty(comment.parentId))
		)
			return undefined;
		comments.push({
			id: comment.id,
			body: comment.body,
			isRoot:
				(comment.quotedText === undefined || comment.quotedText === null) &&
				(comment.parentId === undefined || comment.parentId === null),
		});
	}
	if (value.hasNextPage === true && !nonEmpty(value.cursor)) return undefined;
	if (
		value.hasNextPage === false &&
		value.cursor !== undefined &&
		value.cursor !== null &&
		!nonEmpty(value.cursor)
	)
		return undefined;
	return {
		comments,
		...(value.hasNextPage === true
			? { nextCursor: value.cursor as string }
			: {}),
	};
}

function commentResult(value: unknown): LinearComment | undefined {
	return record(value) &&
		nonEmpty(value.id) &&
		typeof value.body === "string" &&
		(value.quotedText === undefined || value.quotedText === null) &&
		(value.parentId === undefined || value.parentId === null)
		? { id: value.id, body: value.body, isRoot: true }
		: undefined;
}

function emptyCommentRead(): CommentRead {
	return { comments: [], seenCursors: new Set() };
}

function issueCall(issueId: string): QaHandoffMcpPublication.ExpectedCall {
	return {
		toolName: ISSUE_TOOL,
		input: { id: issueId, includeRelations: true },
	};
}

function commentsCall(
	issueId: string,
	cursor?: string,
): QaHandoffMcpPublication.ExpectedCall {
	return {
		toolName: LIST_COMMENTS_TOOL,
		input: { issueId, ...(cursor ? { cursor } : {}) },
	};
}

function dispatchForPhase(
	options: QaHandoffMcpPublicationDependencies,
	state: PublicationState,
	isActive: GenerationGuard = () => true,
): PublicationPhaseDispatch {
	switch (state.phase) {
		case "idle":
			return { kind: "inactive" };
		case "current-user": {
			const call = { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "current-user-result",
					toolCallId,
				}),
			};
		}
		case "current-user-result":
			return {
				kind: "tool-result",
				expectedTool: CURRENT_USER_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					actorResultState(payload, (currentActor) => ({
						phase: "issue",
						context: { ...state.context, actor: currentActor },
					})),
			};
		case "issue": {
			const call = issueCall(state.context.issueId);
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "issue-result",
					toolCallId,
				}),
			};
		}
		case "issue-result":
			return {
				kind: "tool-result",
				expectedTool: ISSUE_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					issueResultState(state.context, payload, (issue) => ({
						phase: "issue-verify",
						context: {
							...state.context,
							issueRevision: issue.updatedAt,
							verifiedIssue: issue,
						},
					})),
			};
		case "issue-verify": {
			const call = issueCall(state.context.issueId);
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "issue-verify-result",
					toolCallId,
				}),
			};
		}
		case "issue-verify-result":
			return {
				kind: "tool-result",
				expectedTool: ISSUE_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					issueResultState(state.context, payload, (issue) =>
						verifiedIssueResultState(options, state, issue, isActive),
					),
			};
		case "comments-before": {
			const call = commentsCall(state.context.issueId, state.read.cursor);
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "comments-before-result",
					toolCallId,
				}),
			};
		}
		case "comments-before-result":
			return {
				kind: "tool-result",
				expectedTool: LIST_COMMENTS_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					commentsResultState(
						state.read,
						payload,
						(read) => ({
							phase: "comments-before",
							context: state.context,
							read,
						}),
						(comments) => commentsBeforeCompleteState(state.context, comments),
					),
			};
		case "current-user-before-mutation": {
			const call = { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "current-user-before-mutation-result",
					toolCallId,
				}),
			};
		}
		case "current-user-before-mutation-result":
			return {
				kind: "tool-result",
				expectedTool: CURRENT_USER_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					actorResultState(payload, (currentActor) => {
						if (
							canonicalJson(currentActor) !== canonicalJson(state.context.actor)
						)
							return failed(
								"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
								"The authenticated Developer actor changed before QA handoff publication.",
							);
						return {
							phase: "issue-before-mutation",
							context: state.context,
						};
					}),
			};
		case "issue-before-mutation": {
			const call = issueCall(state.context.issueId);
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "issue-before-mutation-result",
					toolCallId,
				}),
			};
		}
		case "issue-before-mutation-result":
			return {
				kind: "tool-result",
				expectedTool: ISSUE_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					issueResultState(state.context, payload, (issue) =>
						matchesVerifiedSnapshot(state.context, issue)
							? {
									phase: "comment-create",
									context: state.context,
								}
							: failed(
									"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
									"The complete Linear issue snapshot changed before QA handoff mutation.",
								),
					),
			};
		case "comment-create": {
			const expectedCall = {
				toolName: SAVE_COMMENT_TOOL,
				input: {
					issueId: state.context.issueId,
					body: state.context.preparedArtifact.body,
				},
			};
			return {
				kind: "tool-call",
				expectedCall,
				expectedModelCall: {
					toolName: SAVE_COMMENT_TOOL,
					input: {
						issueId: state.context.issueId,
						body: CANONICAL_BODY_PLACEHOLDER,
					},
				},
				transition: (toolCallId) => ({
					...state,
					phase: "comment-create-result",
					toolCallId,
				}),
				replacementBody: state.context.preparedArtifact.body,
			};
		}
		case "comment-create-result":
			return {
				kind: "tool-result",
				expectedTool: SAVE_COMMENT_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) => commentCreationResultState(state, payload),
			};
		case "comments-readback": {
			const call = commentsCall(state.context.issueId, state.read.cursor);
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "comments-readback-result",
					toolCallId,
				}),
			};
		}
		case "comments-readback-result":
			return {
				kind: "tool-result",
				expectedTool: LIST_COMMENTS_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					commentsResultState(
						state.read,
						payload,
						(read) => ({
							phase: "comments-readback",
							context: state.context,
							read,
						}),
						(comments) =>
							commentsReadbackCompleteState(state.context, comments),
					),
			};
		case "issue-final": {
			const call = issueCall(state.context.issueId);
			return {
				kind: "tool-call",
				expectedCall: call,
				expectedModelCall: call,
				transition: (toolCallId) => ({
					...state,
					phase: "issue-final-result",
					toolCallId,
				}),
			};
		}
		case "issue-final-result":
			return {
				kind: "tool-result",
				expectedTool: ISSUE_TOOL,
				toolCallId: state.toolCallId,
				transition: (payload) =>
					issueResultState(state.context, payload, (issue) =>
						matchesVerifiedSnapshot(state.context, issue)
							? { phase: "ready", context: state.context }
							: failed(
									"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
									"The complete Linear issue snapshot changed during QA handoff publication.",
								),
					),
			};
		case "ready":
			return {
				kind: "completion",
				expectedCall: {
					toolName: WORKFLOW_TOOL,
					input: { issueId: state.context.issueId },
				},
				transition: () => state,
			};
		case "blocked":
			return { kind: "inactive" };
		default:
			return assertNever(state);
	}
}

function expectedCall(
	dispatch: PublicationPhaseDispatch,
): QaHandoffMcpPublication.ExpectedCall | undefined {
	return dispatch.kind === "tool-call" || dispatch.kind === "completion"
		? dispatch.expectedCall
		: undefined;
}

function expectedModelCall(
	dispatch: PublicationPhaseDispatch,
): QaHandoffMcpPublication.ExpectedCall | undefined {
	if (dispatch.kind === "tool-call") return dispatch.expectedModelCall;
	return dispatch.kind === "completion" ? dispatch.expectedCall : undefined;
}

function transitionToolCall(
	dispatch: PublicationPhaseDispatch,
	event: QaHandoffMcpPublication.ToolCallEvent,
): {
	readonly state: PublicationState;
	readonly block?: { readonly block: true; readonly reason: string };
	readonly replacementBody?: string;
} {
	const expected = expectedModelCall(dispatch);
	if (
		(dispatch.kind !== "tool-call" && dispatch.kind !== "completion") ||
		!expected ||
		event.toolName !== expected.toolName ||
		!exactInput(event.input, expected.input)
	) {
		const next = failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
			"QA handoff MCP tool, input, issue, body, or stage did not match the active publication plan.",
		);
		return {
			state: next,
			block: { block: true, reason: next.blocker.code },
		};
	}
	if (dispatch.kind === "completion") return { state: dispatch.transition() };
	const replacement = dispatch.replacementBody
		? { replacementBody: dispatch.replacementBody }
		: {};
	if (!nonEmpty(event.toolCallId)) {
		const next = failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
			"Linear MCP did not provide a stable tool call identity.",
		);
		return {
			state: next,
			block: { block: true, reason: next.blocker.code },
			...replacement,
		};
	}
	return {
		state: dispatch.transition(event.toolCallId),
		...replacement,
	};
}

function actorResultState(
	payload: Record<string, unknown>,
	transition: (actor: AuthenticatedLinearActor) => PublicationState,
): PublicationState {
	if (!actorEvidence(payload))
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
			"Linear MCP returned partial or malformed actor evidence.",
		);
	if (payload.isActive !== true || payload.isGuest !== false)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
			"The authenticated Linear actor does not have verifiable Developer authority.",
		);
	return transition({
		id: payload.id,
		name: payload.name,
		isActive: payload.isActive,
		isGuest: payload.isGuest,
	});
}

function validatesIssueAuthority(
	context: AuthenticatedContext,
	issue: LinearIssueEvidence,
): boolean {
	return (
		issue.assignee.id === context.actor.id &&
		issue.labels.includes(`Assign To / ${context.actor.name}`)
	);
}

function matchesVerifiedSnapshot(
	context: SnapshottedContext,
	issue: LinearIssueEvidence,
): boolean {
	return (
		issue.updatedAt === context.issueRevision &&
		canonicalJson(issue) === canonicalJson(context.verifiedIssue)
	);
}

async function persistFinalArtifact(
	options: QaHandoffMcpPublicationDependencies,
	context: SnapshottedContext,
	draft: Parameters<QaHandoffDraftStore["save"]>[0]["draft"],
	isActive: GenerationGuard,
): Promise<QaHandoffArtifact | BlockerState> {
	const authority = {
		actorId: context.actor.id,
		role: "Developer" as const,
		authorityRevision: digestCanonicalValue(context.actor),
	};
	const candidate = createQaHandoffArtifact(
		{ id: context.issueId, updatedAt: context.issueRevision },
		authority,
		draft,
	);
	const existing = await options.artifacts.read(context.issueId);
	ensureGenerationActive(isActive);
	if (
		existing &&
		(!isQaHandoffArtifact(existing, context.issueId) ||
			existing.digest !== candidate.digest)
	)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT",
			"The issue already has a different QA handoff artifact.",
		);
	let saved = existing;
	if (!saved) {
		ensureGenerationActive(isActive);
		saved = await options.artifacts.save(candidate);
		ensureGenerationActive(isActive);
	}
	const readBack = await options.artifacts.read(context.issueId);
	ensureGenerationActive(isActive);
	if (
		!readBack ||
		!isQaHandoffArtifact(readBack, context.issueId) ||
		canonicalJson(readBack) !== canonicalJson(saved) ||
		canonicalJson(readBack) !== canonicalJson(candidate)
	)
		return failed(
			"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
			"The QA handoff artifact read-back did not match.",
		);
	return readBack;
}

async function verifiedIssueResultState(
	options: QaHandoffMcpPublicationDependencies,
	state: Extract<PublicationState, { phase: "issue-verify-result" }>,
	issue: LinearIssueEvidence,
	isActive: GenerationGuard,
): Promise<PublicationState> {
	if (!matchesVerifiedSnapshot(state.context, issue))
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
			"Linear issue evidence changed before QA handoff artifact persistence.",
		);
	const produced = produceQaHandoffDraft(issue);
	if (produced.status === "blocked")
		return failed(produced.blocker.code, produced.blocker.message);
	try {
		ensureGenerationActive(isActive);
		let draftReadBack = await options.drafts.read(state.context.issueId);
		ensureGenerationActive(isActive);
		if (
			draftReadBack &&
			canonicalJson(draftReadBack) !== canonicalJson(produced.draft)
		)
			return failed(
				"PI_WORKFLOW_QA_HANDOFF_DRAFT_STALE",
				"The persisted QA handoff draft does not match the freshly verified Linear evidence; replace the stale draft before publishing.",
			);
		if (!draftReadBack) {
			ensureGenerationActive(isActive);
			await options.drafts.save({
				issueId: state.context.issueId,
				draft: produced.draft,
			});
			ensureGenerationActive(isActive);
			draftReadBack = await options.drafts.read(state.context.issueId);
			ensureGenerationActive(isActive);
			if (
				!draftReadBack ||
				canonicalJson(draftReadBack) !== canonicalJson(produced.draft)
			)
				return failed(
					"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
					"The persisted QA handoff draft read-back did not match freshly verified Linear evidence.",
				);
		}
		const artifact = await persistFinalArtifact(
			options,
			state.context,
			draftReadBack,
			isActive,
		);
		if ("phase" in artifact) return artifact;
		let recovery: Awaited<
			ReturnType<QaHandoffPublicationRecoveryStore["read"]>
		>;
		try {
			recovery = await options.recovery.read(state.context.issueId);
			ensureGenerationActive(isActive);
		} catch (error) {
			if (error === CANCELLED_GENERATION) throw error;
			return failed(
				"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
				error instanceof Error
					? error.message
					: "QA handoff recovery persistence could not be read.",
			);
		}
		if (recovery && recovery.digest !== artifact.digest)
			return failed(
				"PI_WORKFLOW_QA_HANDOFF_DIGEST_MISMATCH",
				"The pending QA handoff recovery digest changed.",
			);
		return {
			phase: "comments-before",
			context: {
				...state.context,
				preparedArtifact: artifact,
				recoveryStage:
					recovery?.digest === artifact.digest ? recovery.stage : undefined,
			},
			read: emptyCommentRead(),
		};
	} catch (error) {
		if (error === CANCELLED_GENERATION) throw error;
		const code =
			record(error) && nonEmpty(error.code)
				? error.code
				: "PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED";
		return failed(
			code,
			error instanceof Error
				? error.message
				: "QA handoff artifact persistence failed.",
		);
	}
}

function issueResultState(
	context: AuthenticatedContext,
	payload: Record<string, unknown>,
	transition: (
		issue: LinearIssueEvidence,
	) => PublicationState | Promise<PublicationState>,
): PublicationState | Promise<PublicationState> {
	const issue = issueEvidence(payload);
	if (!issue)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
			"Linear MCP returned partial or malformed issue evidence.",
		);
	if ((issue.identifier ?? issue.id) !== context.issueId)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH",
			"Linear MCP returned a different issue identifier.",
		);
	if (!validatesIssueAuthority(context, issue))
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
			"The authenticated actor is not both the assigned and labeled Developer for the issue.",
		);
	return transition(issue);
}

function advanceCommentRead(
	read: CommentRead,
	page: {
		readonly comments: readonly LinearComment[];
		readonly nextCursor?: string;
	},
):
	| { readonly status: "complete"; readonly read: CommentRead }
	| { readonly status: "more"; readonly read: CommentRead }
	| { readonly status: "blocked"; readonly state: BlockerState } {
	const comments = [...read.comments, ...page.comments];
	if (!page.nextCursor)
		return {
			status: "complete",
			read: { comments, seenCursors: read.seenCursors },
		};
	if (read.seenCursors.has(page.nextCursor))
		return {
			status: "blocked",
			state: failed(
				"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
				"Linear MCP repeated a comment cursor.",
			),
		};
	return {
		status: "more",
		read: {
			comments,
			cursor: page.nextCursor,
			seenCursors: new Set([...read.seenCursors, page.nextCursor]),
		},
	};
}

function commentsBeforeCompleteState(
	context: PreparedContext,
	comments: readonly LinearComment[],
): PublicationState {
	const inspection = inspectQaHandoffReferences(
		context.preparedArtifact,
		comments,
	);
	if (inspection.status === "conflict")
		return failed(inspection.blocker.code, inspection.blocker.message);
	if (inspection.status === "exact" && inspection.comments.length > 1)
		return failed(
			"PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT",
			"The exact QA handoff reference exists more than once.",
		);
	if (inspection.status === "exact")
		return {
			phase: "comments-readback",
			context: { ...context, createdComment: inspection.comments[0] },
			read: emptyCommentRead(),
		};
	if (context.recoveryStage)
		return failed(
			context.recoveryStage === "verified"
				? "PI_WORKFLOW_QA_HANDOFF_ALREADY_VERIFIED"
				: "PI_WORKFLOW_QA_HANDOFF_RECOVERY_PENDING",
			context.recoveryStage === "verified"
				? "The verified QA handoff comment is no longer visible; refusing a duplicate mutation."
				: "A prior comment creation is uncertain; retry lookup later without repeating the mutation.",
		);
	return {
		phase: "current-user-before-mutation",
		context,
	};
}

function commentsResultState(
	read: CommentRead,
	payload: Record<string, unknown>,
	continueReading: (read: CommentRead) => PublicationState,
	completeReading: (comments: readonly LinearComment[]) => PublicationState,
): PublicationState {
	const page = commentPage(payload);
	if (!page)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
			"Linear MCP returned a malformed comment page.",
		);
	const advanced = advanceCommentRead(read, page);
	if (advanced.status === "blocked") return advanced.state;
	if (advanced.status === "more") return continueReading(advanced.read);
	return completeReading(advanced.read.comments);
}

function commentsReadbackCompleteState(
	context: SelectedContext,
	comments: readonly LinearComment[],
): PublicationState {
	const readBack = comments.filter(
		(comment) =>
			comment.isRoot &&
			comment.id === context.createdComment.id &&
			comment.body === context.preparedArtifact.body,
	);
	if (readBack.length !== 1)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH",
			"The QA handoff comment read-back did not match its exact ID and body.",
		);
	return {
		phase: "issue-final",
		context: {
			...context,
			publication: {
				status: "published",
				issueId: context.issueId,
				commentId: readBack[0].id,
			},
		},
	};
}

function commentCreationResultState(
	state: Extract<PublicationState, { phase: "comment-create-result" }>,
	payload: Record<string, unknown>,
): PublicationState {
	const created = commentResult(payload);
	if (!created || created.body !== state.context.preparedArtifact.body)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
			"Linear MCP returned a malformed comment creation response.",
		);
	return {
		phase: "comments-readback",
		context: { ...state.context, createdComment: created },
		read: emptyCommentRead(),
	};
}

async function transitionToolResult(
	dispatch: PublicationPhaseDispatch,
	event: QaHandoffMcpPublication.ToolResultEvent,
): Promise<PublicationState> {
	if (
		dispatch.kind !== "tool-result" ||
		event.toolName !== dispatch.expectedTool ||
		event.toolCallId !== dispatch.toolCallId
	)
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
			"Linear MCP returned an out-of-order, failed, or incompatible result.",
		);
	if (event.isError === true) {
		const classification = classifyMcpError(event);
		const failures: Record<
			McpErrorClassification,
			{ readonly code: string; readonly message: string }
		> = {
			unauthenticated: {
				code: "PI_WORKFLOW_QA_HANDOFF_MCP_UNAUTHENTICATED",
				message: "Linear MCP is present but not authenticated.",
			},
			"permission-denied": {
				code: "PI_WORKFLOW_QA_HANDOFF_MCP_PERMISSION_DENIED",
				message:
					"Linear MCP denied permission for the planned QA handoff operation.",
			},
			"rate-limited": {
				code: "PI_WORKFLOW_QA_HANDOFF_MCP_RATE_LIMITED",
				message:
					"Linear MCP rate-limited the planned QA handoff operation; retry later.",
			},
			"transport-failed": {
				code: "PI_WORKFLOW_QA_HANDOFF_MCP_TRANSPORT_FAILED",
				message:
					"Linear MCP transport failed before a verifiable result was returned.",
			},
			incompatible: {
				code: "PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
				message:
					"Linear MCP returned an out-of-order, failed, or incompatible result.",
			},
		};
		const failure = failures[classification];
		return failed(failure.code, failure.message);
	}
	const payload = toolPayload(event);
	if (!record(payload))
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
			"Linear MCP returned a partial or malformed response.",
		);
	if (classifyMcpError(event) === "unauthenticated")
		return failed(
			"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
			"Linear MCP returned an incomplete or ambiguous authentication signal.",
		);
	return dispatch.transition(payload);
}

export function createQaHandoffMcpPublication(
	options: QaHandoffMcpPublicationDependencies,
): QaHandoffMcpPublication {
	const toolIdentityReservationCapacity =
		options.toolIdentityReservationCapacity ??
		MAX_RUNTIME_RESERVED_TOOL_IDENTITIES;
	if (
		!Number.isSafeInteger(toolIdentityReservationCapacity) ||
		toolIdentityReservationCapacity < 1 ||
		toolIdentityReservationCapacity > MAX_RUNTIME_RESERVED_TOOL_IDENTITIES
	)
		throw new Error(
			`QA handoff tool identity reservation capacity must be an integer from 1 through ${MAX_RUNTIME_RESERVED_TOOL_IDENTITIES}.`,
		);
	let state: PublicationState = { phase: "idle" };
	let turnGeneration = 0;
	let recoveryOwnerId = randomUUID();
	let mcpAvailable: boolean | undefined;
	// Accepted tool-call identities are reserved for this extension/runtime instance,
	// across every Pi session it serves. They are never evicted, reassigned, or reset
	// by session_start: a late result from any earlier session could otherwise satisfy
	// a replacement call. The fixed fail-closed cap bounds runtime memory; exhausting
	// it requires an extension reload rather than unsafe identity reuse.
	const reservedToolIdentities = new Map<
		string,
		Readonly<{ generation: number }>
	>();
	const processedResults = new Map<number, Map<string, string>>();

	function currentGenerationResults(): Map<string, string> {
		let results = processedResults.get(turnGeneration);
		if (!results) {
			results = new Map();
			processedResults.set(turnGeneration, results);
		}
		while (processedResults.size > 4) {
			const oldest = processedResults.keys().next().value;
			if (oldest === undefined) break;
			processedResults.delete(oldest);
		}
		return results;
	}

	function toolCallIdentity(toolName: string, toolCallId: string): string {
		return `${toolName}\u0000${toolCallId}`;
	}

	function resultIdentity(
		event: QaHandoffMcpPublication.ToolResultEvent,
	): string {
		return toolCallIdentity(event.toolName, event.toolCallId ?? "");
	}

	function resultFingerprint(
		event: QaHandoffMcpPublication.ToolResultEvent,
	): string {
		return digestCanonicalValue({
			toolName: event.toolName,
			toolCallId: event.toolCallId ?? null,
			isError: event.isError === true,
			content: event.content ?? null,
		});
	}

	function start(issueId: string): void {
		turnGeneration += 1;
		recoveryOwnerId = randomUUID();
		currentGenerationResults();
		state = {
			phase: "current-user",
			context: { issueId },
		};
		if (mcpAvailable === false)
			state = failed(
				"PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for QA handoff publication.",
			);
	}

	function setMcpAvailable(available: boolean): void {
		mcpAvailable = available;
		if (!available && state.phase !== "idle" && state.phase !== "blocked")
			state = failed(
				"PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for QA handoff publication.",
			);
	}

	function clear(): void {
		turnGeneration += 1;
		recoveryOwnerId = randomUUID();
		currentGenerationResults();
		state = { phase: "idle" };
	}

	function isCurrentTurn(
		generation: number,
		expectedState: PublicationState,
	): boolean {
		return turnGeneration === generation && state === expectedState;
	}

	function staleToolCallBlock(): {
		readonly block: true;
		readonly reason: string;
	} {
		return {
			block: true,
			reason: "PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
		};
	}

	function hasActiveTurn(): boolean {
		return state.phase !== "idle";
	}

	function nextCallInstruction(): string | undefined {
		const expected = expectedModelCall(dispatchForPhase(options, state));
		return expected
			? `QA handoff protocol: call ${expected.toolName} exactly once with ${JSON.stringify(expected.input)}. Do not add fields or call tools in parallel.`
			: undefined;
	}

	async function handleToolCallSerial(
		event: QaHandoffMcpPublication.ToolCallEvent,
		generation: number,
		generationOwnerId: string,
		activeState: PublicationState,
	): Promise<{ block: true; reason: string } | undefined> {
		if (!isCurrentTurn(generation, activeState) || activeState.phase === "idle")
			return staleToolCallBlock();
		if (
			event.toolName === "read" &&
			activeState.phase === "current-user" &&
			record(event.input) &&
			Object.keys(event.input).length === 1 &&
			nonEmpty(event.input.path) &&
			event.input.path.endsWith("/skills/qa-handoff/SKILL.md")
		)
			return undefined;
		const dispatch = dispatchForPhase(options, activeState);
		const acceptedIdentity =
			dispatch.kind === "tool-call" &&
			event.toolName === dispatch.expectedModelCall.toolName &&
			nonEmpty(event.toolCallId) &&
			exactInput(event.input, dispatch.expectedModelCall.input)
				? toolCallIdentity(event.toolName, event.toolCallId)
				: undefined;
		const priorReservation = acceptedIdentity
			? reservedToolIdentities.get(acceptedIdentity)
			: undefined;
		if (priorReservation) return staleToolCallBlock();
		if (
			acceptedIdentity &&
			reservedToolIdentities.size >= toolIdentityReservationCapacity
		) {
			state = failed(
				"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
				`The QA handoff extension runtime exhausted its bounded ${toolIdentityReservationCapacity} tool identity reservation capacity; reload the extension before starting another handoff.`,
			);
			return { block: true, reason: state.blocker.code };
		}
		if (
			dispatch.kind === "tool-call" &&
			dispatch.expectedCall.toolName === SAVE_COMMENT_TOOL &&
			event.toolName === SAVE_COMMENT_TOOL &&
			nonEmpty(event.toolCallId) &&
			exactInput(event.input, dispatch.expectedModelCall.input) &&
			activeState.phase === "comment-create"
		) {
			try {
				ensureGenerationActive(() => isCurrentTurn(generation, activeState));
				// This durable claim is the last local step before authorizing the external
				// Linear mutation. Once tool authorization returns, a process crash cannot
				// be atomically coordinated with external execution, so the outcome is
				// intentionally uncertain. Recovery must remain lookup-only and fail closed;
				// do not add leases or mutation retries without definitive non-execution proof.
				await options.recovery.claim(
					activeState.context.preparedArtifact,
					generationOwnerId,
				);
				if (!isCurrentTurn(generation, activeState)) {
					try {
						await options.recovery.release(
							activeState.context.preparedArtifact,
							generationOwnerId,
						);
					} catch {
						// Replacement state cannot be mutated by a stale turn; a failed
						// durable release remains fail-closed for a later recovery lookup.
					}
					return staleToolCallBlock();
				}
			} catch (error) {
				if (!isCurrentTurn(generation, activeState))
					return staleToolCallBlock();
				state = failed(
					"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
					error instanceof Error
						? error.message
						: "QA handoff recovery claim persistence failed.",
				);
				return { block: true, reason: state.blocker.code };
			}
		}
		if (!isCurrentTurn(generation, activeState)) return staleToolCallBlock();
		const transition = transitionToolCall(dispatch, event);
		state = transition.state;
		if (!transition.block && acceptedIdentity)
			reservedToolIdentities.set(
				acceptedIdentity,
				Object.freeze({ generation }),
			);
		if (transition.replacementBody && record(event.input))
			event.input.body = transition.replacementBody;
		return transition.block;
	}

	let toolCallQueueGeneration = turnGeneration;
	let toolCallQueue: Promise<void> = Promise.resolve();
	async function handleToolCall(
		event: QaHandoffMcpPublication.ToolCallEvent,
	): Promise<{ block: true; reason: string } | undefined> {
		if (!hasActiveTurn()) return undefined;
		const queuedGeneration = turnGeneration;
		const queuedOwnerId = recoveryOwnerId;
		const queuedState = state;
		if (toolCallQueueGeneration !== queuedGeneration) {
			toolCallQueueGeneration = queuedGeneration;
			toolCallQueue = Promise.resolve();
		}
		const preceding = toolCallQueue;
		let releaseQueue: () => void = () => {};
		toolCallQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			if (!isCurrentTurn(queuedGeneration, queuedState))
				return staleToolCallBlock();
			return await handleToolCallSerial(
				event,
				queuedGeneration,
				queuedOwnerId,
				queuedState,
			);
		} finally {
			releaseQueue();
		}
	}

	let preparationQueueGeneration = turnGeneration;
	let preparationQueue: Promise<void> = Promise.resolve();
	async function transitionResultWithPreparationLock(
		event: QaHandoffMcpPublication.ToolResultEvent,
		generation: number,
		activeState: PublicationState,
	): Promise<PublicationState> {
		const transition = () =>
			transitionToolResult(
				dispatchForPhase(options, activeState, () =>
					isCurrentTurn(generation, activeState),
				),
				event,
			);
		if (activeState.phase !== "issue-verify-result") return transition();
		if (preparationQueueGeneration !== generation) {
			preparationQueueGeneration = generation;
			preparationQueue = Promise.resolve();
		}
		const preceding = preparationQueue;
		let releaseQueue: () => void = () => {};
		preparationQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			ensureGenerationActive(() => isCurrentTurn(generation, activeState));
			return await transition();
		} finally {
			releaseQueue();
		}
	}

	async function handleToolResultSerial(
		event: QaHandoffMcpPublication.ToolResultEvent,
		generation: number,
		generationOwnerId: string,
		activeState: PublicationState,
	): Promise<boolean> {
		if (
			!isCurrentTurn(generation, activeState) ||
			activeState.phase === "idle" ||
			!MCP_TOOLS.has(event.toolName)
		)
			return false;
		// Linear's PERMISSION_DENIED contract rejects authorization before mutation;
		// unlike transport and rate-limit failures, it is definitive non-mutation evidence.
		if (
			activeState.phase === "comment-create-result" &&
			event.toolName === SAVE_COMMENT_TOOL &&
			event.toolCallId === activeState.toolCallId &&
			event.isError === true &&
			classifyMcpError(event) === "permission-denied"
		) {
			try {
				ensureGenerationActive(() => isCurrentTurn(generation, activeState));
				await options.recovery.release(
					activeState.context.preparedArtifact,
					generationOwnerId,
				);
				if (!isCurrentTurn(generation, activeState)) return false;
			} catch (error) {
				if (!isCurrentTurn(generation, activeState)) return false;
				state = failed(
					"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
					error instanceof Error
						? error.message
						: "QA handoff recovery release persistence failed.",
				);
				return true;
			}
		}
		let transitioned: PublicationState;
		try {
			transitioned = await transitionResultWithPreparationLock(
				event,
				generation,
				activeState,
			);
		} catch (error) {
			if (error === CANCELLED_GENERATION) return false;
			throw error;
		}
		if (!isCurrentTurn(generation, activeState)) return false;
		if (
			activeState.phase === "issue-final-result" &&
			transitioned.phase === "ready"
		) {
			try {
				ensureGenerationActive(() => isCurrentTurn(generation, activeState));
				await options.recovery.finalizeVerified(
					activeState.context.preparedArtifact,
				);
				if (!isCurrentTurn(generation, activeState)) return false;
			} catch (error) {
				if (!isCurrentTurn(generation, activeState)) return false;
				state = failed(
					"PI_WORKFLOW_QA_HANDOFF_RECOVERY_PERSISTENCE_FAILED",
					error instanceof Error
						? error.message
						: "QA handoff verified recovery persistence failed.",
				);
				return true;
			}
		}
		state = transitioned;
		return true;
	}

	let toolResultQueueGeneration = turnGeneration;
	let toolResultQueue: Promise<void> = Promise.resolve();
	async function handleToolResult(
		event: QaHandoffMcpPublication.ToolResultEvent,
	): Promise<boolean> {
		if (!hasActiveTurn() || !MCP_TOOLS.has(event.toolName)) return false;
		const queuedGeneration = turnGeneration;
		const queuedOwnerId = recoveryOwnerId;
		const queuedState = state;
		if (toolResultQueueGeneration !== queuedGeneration) {
			toolResultQueueGeneration = queuedGeneration;
			toolResultQueue = Promise.resolve();
		}
		const preceding = toolResultQueue;
		let releaseQueue: () => void = () => {};
		toolResultQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			const identity = resultIdentity(event);
			const reservation = reservedToolIdentities.get(identity);
			if (reservation && reservation.generation !== queuedGeneration)
				return false;
			if (!reservation) {
				if (isCurrentTurn(queuedGeneration, queuedState)) {
					state = failed(
						"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
						"Linear MCP returned a result without a current issued tool identity.",
					);
					return true;
				}
				return false;
			}
			const fingerprint = resultFingerprint(event);
			const generationResults = processedResults.get(queuedGeneration);
			const settledFingerprint = generationResults?.get(identity);
			if (settledFingerprint !== undefined) {
				if (settledFingerprint === fingerprint) return false;
				if (turnGeneration === queuedGeneration && hasActiveTurn()) {
					state = failed(
						"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
						"Linear MCP returned conflicting payloads for the same tool call identity.",
					);
					return true;
				}
				return false;
			}
			if (!isCurrentTurn(queuedGeneration, queuedState)) return false;
			currentGenerationResults().set(identity, fingerprint);
			return await handleToolResultSerial(
				event,
				queuedGeneration,
				queuedOwnerId,
				queuedState,
			);
		} finally {
			releaseQueue();
		}
	}

	async function complete(
		input: unknown,
	): Promise<
		QaHandoffMcpPublication.PublishedHandoff | QaHandoffMcpPublication.Blocker
	> {
		if (state.phase === "blocked") {
			return { status: state.status, blocker: state.blocker };
		}
		if (
			state.phase !== "ready" ||
			!exactInput(input, { issueId: state.context.issueId })
		) {
			state = failed(
				"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
				"QA handoff publication is incomplete or does not match the active issue.",
			);
			return { status: state.status, blocker: state.blocker };
		}
		const result = state.context.publication;
		clear();
		return result;
	}

	return {
		allowedTools: [
			CURRENT_USER_TOOL,
			ISSUE_TOOL,
			LIST_COMMENTS_TOOL,
			SAVE_COMMENT_TOOL,
			WORKFLOW_TOOL,
		] as const,
		start,
		setMcpAvailable,
		clear,
		hasActiveTurn,
		expectedCall: () => expectedCall(dispatchForPhase(options, state)),
		expectedModelCall: () =>
			expectedModelCall(dispatchForPhase(options, state)),
		nextCallInstruction,
		handleToolCall,
		handleToolResult,
		complete,
	};
}
