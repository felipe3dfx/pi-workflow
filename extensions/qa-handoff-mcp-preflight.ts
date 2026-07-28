import { produceQaHandoffDraft } from "./qa-handoff-draft-producer.ts";
import type { QaHandoffDraftStore } from "./qa-handoff-draft-store.ts";
import {
	createQaHandoffArtifact,
	isQaHandoffArtifact,
	type QaHandoffArtifact,
	type QaHandoffArtifactStore,
} from "./qa-handoff-workflow.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";

interface Blocker {
	readonly status: "blocked";
	readonly blocker: { readonly code: string; readonly message: string };
}

interface PublishedHandoff {
	readonly status: "published";
	readonly issueId: string;
	readonly commentId: string;
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

type Stage =
	| "idle"
	| "current-user"
	| "current-user-result"
	| "current-user-before-mutation"
	| "current-user-before-mutation-result"
	| "issue"
	| "issue-before-mutation"
	| "issue-before-mutation-result"
	| "issue-final"
	| "issue-final-result"
	| "issue-result"
	| "issue-verify"
	| "issue-verify-result"
	| "comments-before"
	| "comments-before-result"
	| "comment-create"
	| "comment-create-result"
	| "comments-readback"
	| "comments-readback-result"
	| "ready"
	| "blocked";
type McpErrorClassification = "unauthenticated" | "incompatible";

const CURRENT_USER_TOOL = "linear_get_user";
const ISSUE_TOOL = "linear_get_issue";
const LIST_COMMENTS_TOOL = "linear_list_comments";
const SAVE_COMMENT_TOOL = "linear_save_comment";
const WORKFLOW_TOOL = "workflow_qa_handoff";
const CANONICAL_BODY_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_QA_HANDOFF_BODY";

const blocked = (code: string, message: string): Blocker => ({
	status: "blocked",
	blocker: { code, message },
});

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactInput(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	return record(value) &&
		Object.keys(value).length === Object.keys(expected).length &&
		Object.entries(expected).every(
			([key, expectedValue]) => value[key] === expectedValue,
		);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function toolPayload(event: unknown): unknown {
	if (!record(event) || !Array.isArray(event.content) || event.content.length !== 1)
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
	return record(payload) &&
		Object.keys(payload).length === 1 &&
		payload.code === "UNAUTHENTICATED"
		? "unauthenticated"
		: "incompatible";
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
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	)
		return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(jsonCompatible);
	return record(value) && Object.values(value).every(jsonCompatible);
}

function relationList(value: unknown): Readonly<Record<string, unknown>>[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const relations: Readonly<Record<string, unknown>>[] = [];
	for (const relation of value) {
		if (!record(relation) || !nonEmpty(relation.id) || !jsonCompatible(relation))
			return undefined;
		relations.push(structuredClone(relation));
	}
	return relations.sort((left, right) =>
		canonicalJson(left).localeCompare(canonicalJson(right))
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
		!(value.cycleId === undefined || value.cycleId === null || nonEmpty(value.cycleId)) ||
		!Array.isArray(value.labels) ||
		value.labels.some((label) => !nonEmpty(label)) ||
		!jsonCompatible(value.estimate ?? null) ||
		!record(value.relations) ||
		!(value.parentId === undefined || value.parentId === null || nonEmpty(value.parentId)) ||
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
		!(duplicateOf === undefined ||
			duplicateOf === null ||
			(record(duplicateOf) && nonEmpty(duplicateOf.id) && jsonCompatible(duplicateOf)))
	)
		return undefined;
	const attachments: {
		id: string;
		title: string;
		url: string;
	}[] = [];
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
		cycle: value.cycleId === undefined || value.cycleId === null
			? null
			: { id: value.cycleId },
		labels: [...value.labels].sort(),
		estimate: structuredClone(value.estimate ?? null),
		relations: {
			blockedBy,
			blocks,
			relatedTo,
			duplicateOf: duplicateOf === undefined || duplicateOf === null
				? null
				: structuredClone(duplicateOf),
		},
		parent: value.parentId === undefined || value.parentId === null
			? null
			: { id: value.parentId },
		attachments: attachments.sort((left, right) => left.id.localeCompare(right.id)),
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
		...(value.hasNextPage === true ? { nextCursor: value.cursor as string } : {}),
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

function hasExactVisibleReferenceLine(body: string, reference: string): boolean {
	return body.split(/\r\n|\n|\r/).some((line) => line === reference);
}

export function createQaHandoffMcpPreflight(options: {
	readonly drafts: QaHandoffDraftStore;
	readonly artifacts: QaHandoffArtifactStore;
}) {
	let stage: Stage = "idle";
	let issueId: string | undefined;
	let actor: AuthenticatedLinearActor | undefined;
	let issueRevision: string | undefined;
	let verifiedIssue: LinearIssueEvidence | undefined;
	let preparedArtifact: QaHandoffArtifact | undefined;
	let preparedPublication: PublishedHandoff | undefined;
	let pendingToolCallId: string | undefined;
	let terminalBlocker: Blocker | undefined;
	let mcpAvailable: boolean | undefined;
	let commentCursor: string | undefined;
	let comments: LinearComment[] = [];
	let createdComment: LinearComment | undefined;
	const seenCommentCursors = new Set<string>();

	function fail(code: string, message: string): Blocker {
		terminalBlocker = blocked(code, message);
		stage = "blocked";
		pendingToolCallId = undefined;
		return terminalBlocker;
	}

	function setMcpAvailable(available: boolean): void {
		mcpAvailable = available;
		if (!available && stage !== "idle" && stage !== "blocked") {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for QA handoff publication.",
			);
		}
	}

	function resetCommentRead(): void {
		commentCursor = undefined;
		comments = [];
		seenCommentCursors.clear();
	}

	function resetPublicationState(): void {
		actor = undefined;
		issueRevision = undefined;
		verifiedIssue = undefined;
		preparedArtifact = undefined;
		preparedPublication = undefined;
		pendingToolCallId = undefined;
		terminalBlocker = undefined;
		createdComment = undefined;
		resetCommentRead();
	}

	function start(id: string): void {
		resetPublicationState();
		issueId = id;
		stage = "current-user";
		if (mcpAvailable === false) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for QA handoff publication.",
			);
		}
	}

	function clear(): void {
		resetPublicationState();
		issueId = undefined;
		stage = "idle";
	}

	function hasActiveTurn(): boolean {
		return stage !== "idle";
	}

	function expectedCall():
		| { readonly toolName: string; readonly input: Readonly<Record<string, unknown>> }
		| undefined {
		if (stage === "current-user" || stage === "current-user-before-mutation")
			return { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
		if (
			(stage === "issue" ||
				stage === "issue-verify" ||
				stage === "issue-before-mutation" ||
				stage === "issue-final") &&
			issueId
		)
			return { toolName: ISSUE_TOOL, input: { id: issueId, includeRelations: true } };
		if (
			(stage === "comments-before" || stage === "comments-readback") &&
			issueId
		) {
			return {
				toolName: LIST_COMMENTS_TOOL,
				input: {
					issueId,
					...(commentCursor ? { cursor: commentCursor } : {}),
				},
			};
		}
		if (stage === "comment-create" && issueId && preparedArtifact) {
			return {
				toolName: SAVE_COMMENT_TOOL,
				input: { issueId, body: preparedArtifact.body },
			};
		}
		if (stage === "ready" && issueId)
			return { toolName: WORKFLOW_TOOL, input: { issueId } };
		return undefined;
	}

	function expectedModelCall():
		| { readonly toolName: string; readonly input: Readonly<Record<string, unknown>> }
		| undefined {
		const expected = expectedCall();
		if (expected?.toolName !== SAVE_COMMENT_TOOL || !issueId) return expected;
		return {
			toolName: SAVE_COMMENT_TOOL,
			input: { issueId, body: CANONICAL_BODY_PLACEHOLDER },
		};
	}

	function nextCallInstruction(): string | undefined {
		const expected = expectedModelCall();
		return expected
			? `QA handoff protocol: call ${expected.toolName} exactly once with ${JSON.stringify(expected.input)}. Do not add fields or call tools in parallel.`
			: undefined;
	}

	function handleToolCall(event: {
		readonly toolName: string;
		readonly toolCallId?: string;
		input?: unknown;
	}): { block: true; reason: string } | undefined {
		if (!hasActiveTurn()) return undefined;
		if (
			event.toolName === "read" &&
			stage === "current-user" &&
			record(event.input) &&
			Object.keys(event.input).length === 1 &&
			nonEmpty(event.input.path) &&
			event.input.path.endsWith("/skills/qa-handoff/SKILL.md")
		)
			return undefined;
		const expected = expectedModelCall();
		if (
			!expected ||
			event.toolName !== expected.toolName ||
			!exactInput(event.input, expected.input)
		) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
				"QA handoff MCP tool, input, issue, body, or stage did not match the active publication plan.",
			);
			return {
				block: true,
				reason:
					terminalBlocker?.blocker.code ??
					"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
			};
		}
		if (
			event.toolName === SAVE_COMMENT_TOOL &&
			preparedArtifact &&
			record(event.input)
		) {
			event.input.body = preparedArtifact.body;
		}
		if (event.toolName === WORKFLOW_TOOL) return undefined;
		if (!nonEmpty(event.toolCallId)) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
				"Linear MCP did not provide a stable tool call identity.",
			);
			return {
				block: true,
				reason:
					terminalBlocker?.blocker.code ??
					"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
			};
		}
		pendingToolCallId = event.toolCallId;
		if (event.toolName === CURRENT_USER_TOOL) {
			stage = stage === "current-user-before-mutation"
				? "current-user-before-mutation-result"
				: "current-user-result";
		} else if (event.toolName === ISSUE_TOOL) {
			stage = stage === "issue-verify"
				? "issue-verify-result"
				: stage === "issue-before-mutation"
					? "issue-before-mutation-result"
					: stage === "issue-final"
						? "issue-final-result"
						: "issue-result";
		} else if (event.toolName === LIST_COMMENTS_TOOL) {
			stage = stage === "comments-readback"
				? "comments-readback-result"
				: "comments-before-result";
		} else if (event.toolName === SAVE_COMMENT_TOOL) stage = "comment-create-result";
		return undefined;
	}

	async function persistFinalArtifact(draft: Parameters<QaHandoffDraftStore["save"]>[0]["draft"]): Promise<boolean> {
		if (!issueId || !issueRevision || !actor) return false;
		const authority = {
			actorId: actor.id,
			role: "Developer" as const,
			authorityRevision: digestCanonicalValue(actor),
		};
		const candidate = createQaHandoffArtifact(
			{ id: issueId, updatedAt: issueRevision },
			authority,
			draft,
		);
		const existing = await options.artifacts.read(issueId);
		if (
			existing &&
			(!isQaHandoffArtifact(existing, issueId) || existing.digest !== candidate.digest)
		) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT",
				"The issue already has a different QA handoff artifact.",
			);
			return false;
		}
		const saved = existing ?? (await options.artifacts.save(candidate));
		const readBack = await options.artifacts.read(issueId);
		if (
			!readBack ||
			!isQaHandoffArtifact(readBack, issueId) ||
			canonicalJson(readBack) !== canonicalJson(saved) ||
			canonicalJson(readBack) !== canonicalJson(candidate)
		) {
			fail(
				"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
				"The QA handoff artifact read-back did not match.",
			);
			return false;
		}
		preparedArtifact = readBack;
		return true;
	}

	function finishCommentPage(page: {
		readonly comments: readonly LinearComment[];
		readonly nextCursor?: string;
	}): boolean {
		comments.push(...page.comments);
		if (!page.nextCursor) {
			commentCursor = undefined;
			return true;
		}
		if (seenCommentCursors.has(page.nextCursor)) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
				"Linear MCP repeated a comment cursor.",
			);
			return false;
		}
		seenCommentCursors.add(page.nextCursor);
		commentCursor = page.nextCursor;
		return false;
	}

	function handleCommentsBefore(): void {
		if (!preparedArtifact) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED",
				"The canonical QA handoff artifact is unavailable.",
			);
			return;
		}
		const marker = `Referencia de flujo: qa-handoff:${preparedArtifact.digest}`;
		const matching = comments.filter(
			(comment) =>
				comment.isRoot && hasExactVisibleReferenceLine(comment.body, marker),
		);
		if (matching.some((comment) => comment.body !== preparedArtifact?.body)) {
			fail(
				"PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT",
				"The QA handoff reference already exists with a different body.",
			);
			return;
		}
		const exact = matching.filter(
			(comment) => comment.body === preparedArtifact?.body,
		);
		if (exact.length > 1) {
			fail(
				"PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT",
				"The exact QA handoff reference exists more than once.",
			);
			return;
		}
		if (exact[0]) {
			createdComment = exact[0];
			resetCommentRead();
			stage = "comments-readback";
			return;
		}
		stage = "current-user-before-mutation";
	}

	async function handleToolResult(event: {
		readonly toolName: string;
		readonly toolCallId?: string;
		readonly content?: unknown;
		readonly isError?: boolean;
	}): Promise<void> {
		const mcpTools = new Set([
			CURRENT_USER_TOOL,
			ISSUE_TOOL,
			LIST_COMMENTS_TOOL,
			SAVE_COMMENT_TOOL,
		]);
		if (!hasActiveTurn() || !mcpTools.has(event.toolName)) return;
		const expectedResultStage =
			(event.toolName === CURRENT_USER_TOOL &&
				(stage === "current-user-result" ||
					stage === "current-user-before-mutation-result")) ||
			(event.toolName === ISSUE_TOOL &&
				(stage === "issue-result" ||
					stage === "issue-verify-result" ||
					stage === "issue-before-mutation-result" ||
					stage === "issue-final-result")) ||
			(event.toolName === LIST_COMMENTS_TOOL &&
				(stage === "comments-before-result" ||
					stage === "comments-readback-result")) ||
			(event.toolName === SAVE_COMMENT_TOOL && stage === "comment-create-result");
		if (!expectedResultStage || event.toolCallId !== pendingToolCallId) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
				"Linear MCP returned an out-of-order, failed, or incompatible result.",
			);
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
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
				"Linear MCP returned a partial or malformed response.",
			);
			return;
		}
		if (classifyMcpError(event) === "unauthenticated") {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_INCOMPATIBLE",
				"Linear MCP returned an incomplete or ambiguous authentication signal.",
			);
			return;
		}
		pendingToolCallId = undefined;
		if (event.toolName === CURRENT_USER_TOOL) {
			const revalidating = stage === "current-user-before-mutation-result";
			if (!actorEvidence(payload)) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
					"Linear MCP returned partial or malformed actor evidence.",
				);
				return;
			}
			if (payload.isActive !== true || payload.isGuest !== false) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
					"The authenticated Linear actor does not have verifiable Developer authority.",
				);
				return;
			}
			const currentActor = {
				id: payload.id,
				name: payload.name,
				isActive: payload.isActive,
				isGuest: payload.isGuest,
			};
			if (revalidating && canonicalJson(currentActor) !== canonicalJson(actor)) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
					"The authenticated Developer actor changed before QA handoff publication.",
				);
				return;
			}
			actor = currentActor;
			stage = revalidating ? "issue-before-mutation" : "issue";
			return;
		}
		if (event.toolName === ISSUE_TOOL) {
			const verifying = stage === "issue-verify-result";
			const beforeMutation = stage === "issue-before-mutation-result";
			const finalVerification = stage === "issue-final-result";
			const issue = issueEvidence(payload);
			if (!issue) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
					"Linear MCP returned partial or malformed issue evidence.",
				);
				return;
			}
			const exactIdentifier = issue.identifier ?? issue.id;
			if (exactIdentifier !== issueId) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH",
					"Linear MCP returned a different issue identifier.",
				);
				return;
			}
			if (
				issue.assignee.id !== actor?.id ||
				!actor ||
				!issue.labels.includes(`Assign To / ${actor.name}`)
			) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
					"The authenticated actor is not both the assigned and labeled Developer for the issue.",
				);
				return;
			}
			const matchesVerifiedSnapshot = verifiedIssue !== undefined &&
				issueRevision !== undefined &&
				issue.updatedAt === issueRevision &&
				canonicalJson(issue) === canonicalJson(verifiedIssue);
			if (finalVerification) {
				if (!matchesVerifiedSnapshot) {
					fail(
						"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
						"The complete Linear issue snapshot changed during QA handoff publication.",
					);
					return;
				}
				stage = "ready";
				return;
			}
			if (beforeMutation) {
				if (!matchesVerifiedSnapshot) {
					fail(
						"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
						"The complete Linear issue snapshot changed before QA handoff mutation.",
					);
					return;
				}
				stage = "comment-create";
				return;
			}
			if (verifying) {
				if (
					!verifiedIssue ||
					canonicalJson(issue) !== canonicalJson(verifiedIssue) ||
					!issueId ||
					!issueRevision
				) {
					fail(
						"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
						"Linear issue evidence changed before QA handoff artifact persistence.",
					);
					return;
				}
				const produced = produceQaHandoffDraft(issue);
				if (produced.status === "blocked") {
					fail(produced.blocker.code, produced.blocker.message);
					return;
				}
				try {
					await options.drafts.save({ issueId, draft: produced.draft });
					const draftReadBack = await options.drafts.read(issueId);
					if (
						!draftReadBack ||
						canonicalJson(draftReadBack) !== canonicalJson(produced.draft)
					) {
						fail(
							"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
							"The persisted QA handoff draft read-back did not match.",
						);
						return;
					}
					if (!(await persistFinalArtifact(draftReadBack))) return;
					resetCommentRead();
					stage = "comments-before";
				} catch (error) {
					const code =
						record(error) && nonEmpty(error.code)
							? error.code
							: "PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED";
					fail(
						code,
						error instanceof Error
							? error.message
							: "QA handoff artifact persistence failed.",
					);
				}
				return;
			}
			issueRevision = issue.updatedAt;
			verifiedIssue = issue;
			stage = "issue-verify";
			return;
		}
		if (event.toolName === LIST_COMMENTS_TOOL) {
			const readingBack = stage === "comments-readback-result";
			const page = commentPage(payload);
			if (!page) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
					"Linear MCP returned a malformed comment page.",
				);
				return;
			}
			const complete = finishCommentPage(page);
			if (stage === "blocked") return;
			if (!complete) {
				stage = readingBack ? "comments-readback" : "comments-before";
				return;
			}
			if (!readingBack) {
				handleCommentsBefore();
				return;
			}
			if (!createdComment || !preparedArtifact || !issueId) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH",
					"The QA handoff comment creation was not available for read-back.",
				);
				return;
			}
			const readBack = comments.filter(
				(comment) =>
					comment.isRoot &&
					comment.id === createdComment?.id &&
					comment.body === preparedArtifact?.body,
			);
			if (readBack.length !== 1) {
				fail(
					"PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH",
					"The QA handoff comment read-back did not match its exact ID and body.",
				);
				return;
			}
			preparedPublication = {
				status: "published",
				issueId,
				commentId: readBack[0].id,
			};
			stage = "issue-final";
			return;
		}
		const created = commentResult(payload);
		if (!created || !preparedArtifact || created.body !== preparedArtifact.body) {
			fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_MALFORMED_RESPONSE",
				"Linear MCP returned a malformed comment creation response.",
			);
			return;
		}
		createdComment = created;
		resetCommentRead();
		stage = "comments-readback";
	}

	async function complete(input: unknown): Promise<PublishedHandoff | Blocker> {
		if (terminalBlocker) return terminalBlocker;
		if (
			stage !== "ready" ||
			!issueId ||
			!preparedPublication ||
			!exactInput(input, { issueId })
		) {
			return fail(
				"PI_WORKFLOW_QA_HANDOFF_MCP_PROTOCOL_INVALID",
				"QA handoff publication is incomplete or does not match the active issue.",
			);
		}
		const result = preparedPublication;
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
		expectedCall,
		expectedModelCall,
		nextCallInstruction,
		handleToolCall,
		handleToolResult,
		complete,
	};
}
