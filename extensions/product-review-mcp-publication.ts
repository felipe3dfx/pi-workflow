import { randomUUID } from "node:crypto";

import {
	isProductReviewDraft,
	type ProductReviewDraftReader,
	type ProductReviewResult,
} from "./product-review-draft-store.ts";
import type { ProductReviewPublicationRecoveryStore } from "./product-review-publication-recovery.ts";
import {
	createProductReviewArtifact,
	hasProductReviewProtectedDigest,
	isProductReviewArtifact,
	productReviewProtectedIssueDigest,
	type LinearProductReviewIssueSnapshot,
	type ProductReviewArtifact,
	type ProtectedProductReviewArtifact,
	type ProductReviewArtifactStore,
} from "./product-review-workflow.ts";
import { createSingleUserAuthoritySession } from "./single-user-authority.ts";
import { canonicalJson } from "./workflow-contracts.ts";
import type {
	AuthenticatedDecisionActor,
	DecisionBlocker,
	DecisionRequest,
	ExecutionLease,
	ExecutionManifestBinding,
	TypedDecisionAction,
} from "./interactive-decisions.ts";
import type { PiInteractiveDecisions } from "./pi-decision-adapter.ts";

export namespace ProductReviewMcpPublication {
	export interface Blocker {
		readonly status: "blocked";
		readonly blocker: { readonly code: string; readonly message: string };
	}

	export interface PublishedReview {
		readonly status: "published";
		readonly issueId: string;
		readonly commentId: string;
	}

	export interface ContinuingReview {
		readonly status: "continuing";
	}

	export interface CancelledReview {
		readonly status: "cancelled";
		readonly issueId: string;
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

export interface ProductReviewMcpPublicationDependencies {
	readonly drafts: ProductReviewDraftReader;
	readonly artifacts: ProductReviewArtifactStore;
	readonly recovery: ProductReviewPublicationRecoveryStore;
	readonly project: string;
	readonly interactiveDecisions: PiInteractiveDecisions;
	/** Explicit compatibility policy. Default single-user execution derives authority from Linear. */
	readonly owner?: {
		readonly actorId: string;
		readonly authorityRevision: string;
	};
}

export interface ProductReviewMcpPublication {
	readonly allowedTools: readonly [
		"linear_get_user",
		"linear_get_issue",
		"linear_list_comments",
		"linear_save_comment",
		"workflow_product_review",
	];
	start(issueId: string): void;
	setMcpAvailable(available: boolean): void;
	clear(): void;
	hasActiveTurn(): boolean;
	hasPendingOwnerSelection(): boolean;
	expectedModelCall(): ProductReviewMcpPublication.ExpectedCall | undefined;
	nextCallInstruction(): string | undefined;
	handleToolCall(
		event: ProductReviewMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined>;
	handleToolResult(
		event: ProductReviewMcpPublication.ToolResultEvent,
	): Promise<boolean>;
	complete(
		input: unknown,
	): Promise<
		| ProductReviewMcpPublication.PublishedReview
			| ProductReviewMcpPublication.ContinuingReview
			| ProductReviewMcpPublication.CancelledReview
		| ProductReviewMcpPublication.Blocker
	>;
}

const CURRENT_USER_TOOL = "linear_get_user";
const ISSUE_TOOL = "linear_get_issue";
const LIST_COMMENTS_TOOL = "linear_list_comments";
const SAVE_COMMENT_TOOL = "linear_save_comment";
const WORKFLOW_TOOL = "workflow_product_review";
const CANONICAL_BODY_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_PRODUCT_REVIEW_BODY";
const MCP_TOOLS = new Set([
	CURRENT_USER_TOOL,
	ISSUE_TOOL,
	LIST_COMMENTS_TOOL,
	SAVE_COMMENT_TOOL,
	WORKFLOW_TOOL,
]);
const MAX_RESERVED_TOOL_IDENTITIES = 16_384;
const allowedTools = [
	CURRENT_USER_TOOL,
	ISSUE_TOOL,
	LIST_COMMENTS_TOOL,
	SAVE_COMMENT_TOOL,
	WORKFLOW_TOOL,
] as const;

const blocked = (
	code: string,
	message: string,
): ProductReviewMcpPublication.Blocker => ({
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
	return (
		record(value) &&
		Object.keys(value).length === Object.keys(expected).length &&
		Object.entries(expected).every(
			([key, expectedValue]) => value[key] === expectedValue,
		)
	);
}

function selectedResult(value: unknown): ProductReviewResult | undefined {
	if (
		!record(value) ||
		!exactInput(value, {
			action: "select_result",
			result: value.result,
		}) ||
		(value.result !== "Aceptado" && value.result !== "Cambios requeridos")
	)
		return undefined;
	return value.result;
}

function cancellationSelected(value: unknown): boolean {
	return exactInput(value, { action: "cancel_decision" });
}

function nonEmpty(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value === value.trim()
	);
}

function toolPayload(event: ProductReviewMcpPublication.ToolResultEvent): unknown {
	if (!Array.isArray(event.content) || event.content.length !== 1)
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

type McpErrorClassification =
	| "unauthenticated"
	| "permission-denied"
	| "rate-limited"
	| "transport-failed"
	| "incompatible";

function classifyMcpError(
	event: ProductReviewMcpPublication.ToolResultEvent,
): McpErrorClassification {
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

function resultFailure(
	event: ProductReviewMcpPublication.ToolResultEvent,
): ProductReviewMcpPublication.Blocker["blocker"] {
	const failures: Record<
		McpErrorClassification,
		ProductReviewMcpPublication.Blocker["blocker"]
	> = {
		unauthenticated: {
			code: "PI_WORKFLOW_PRODUCT_REVIEW_MCP_UNAUTHENTICATED",
			message: "Linear MCP is present but not authenticated.",
		},
		"permission-denied": {
			code: "PI_WORKFLOW_PRODUCT_REVIEW_MCP_PERMISSION_DENIED",
			message:
				"Linear MCP denied permission for the planned product review operation.",
		},
		"rate-limited": {
			code: "PI_WORKFLOW_PRODUCT_REVIEW_MCP_RATE_LIMITED",
			message:
				"Linear MCP rate-limited the planned product review operation; retry later.",
		},
		"transport-failed": {
			code: "PI_WORKFLOW_PRODUCT_REVIEW_MCP_TRANSPORT_FAILED",
			message:
				"Linear MCP transport failed before a verifiable result was returned.",
		},
		incompatible: {
			code: "PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
			message:
				"Linear MCP returned an out-of-order, failed, or incompatible result.",
		},
	};
	return failures[classifyMcpError(event)];
}

interface AuthenticatedLinearActor {
	readonly id: string;
	readonly name: string;
	readonly isActive: boolean;
	readonly isGuest: boolean;
}

interface LinearIssueEvidence {
	/** Every successful JSON-compatible top-level MCP field except updatedAt. */
	readonly protectedFields: Readonly<Record<string, unknown>>;
	readonly id: string;
	readonly identifier: string;
	readonly title: string;
	readonly description: string;
	readonly updatedAt: string;
	readonly status: { readonly name: string; readonly type: string };
	readonly assignee: { readonly id: string; readonly name: string } | null;
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

interface PreparedContext {
	readonly issueId: string;
	readonly actor: AuthenticatedLinearActor;
	readonly issue: LinearIssueEvidence;
	readonly choices: Readonly<
		Record<ProductReviewResult, ProtectedProductReviewArtifact>
	>;
	readonly decision: {
		readonly decisionId: string;
		readonly actions: Readonly<Record<ProductReviewResult, TypedDecisionAction>>;
	};
}

interface ApprovedContext extends PreparedContext {
	readonly result: ProductReviewResult;
	readonly artifact: ProtectedProductReviewArtifact;
	readonly executionLease: ExecutionLease;
}

interface PublicationContext extends ApprovedContext {
	readonly recoveryStage?: "uncertain" | "verified";
}

interface LinearComment {
	readonly id: string;
	readonly body: string;
	readonly isRoot: boolean;
}

interface SelectedCommentContext extends PublicationContext {
	readonly comment: LinearComment;
}

interface CompletedContext extends SelectedCommentContext {
	readonly publication: ProductReviewMcpPublication.PublishedReview;
}

interface CommentRead {
	readonly comments: readonly LinearComment[];
	readonly cursor?: string;
	readonly seenCursors: ReadonlySet<string>;
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

function linearIssueIdentifier(value: unknown): value is string {
	return nonEmpty(value) && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(value);
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
		!jsonCompatible(value) ||
		!nonEmpty(value.id) ||
		(value.identifier !== undefined && !nonEmpty(value.identifier)) ||
		!nonEmpty(value.title) ||
		typeof value.description !== "string" ||
		!linearRevision(value.updatedAt) ||
		!nonEmpty(value.status) ||
		!nonEmpty(value.statusType) ||
		(!((value.assignee === undefined || value.assignee === null) &&
			(value.assigneeId === undefined || value.assigneeId === null)) &&
			!(nonEmpty(value.assignee) && nonEmpty(value.assigneeId))) ||
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
	const identifier =
		value.identifier === undefined ? value.id : value.identifier;
	if (
		!linearIssueIdentifier(identifier) ||
		(linearIssueIdentifier(value.id) && value.id !== identifier)
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
	const attachments: {
		id: string;
		title: string;
		url: string;
		value: Readonly<Record<string, unknown>>;
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
			value: structuredClone(attachment),
		});
	}
	attachments.sort((left, right) =>
		canonicalJson(left.value).localeCompare(canonicalJson(right.value)),
	);
	const { updatedAt: _updatedAt, ...protectedFields } = structuredClone(value);
	protectedFields.labels = [...value.labels].sort();
	protectedFields.relations = {
		...structuredClone(value.relations),
		blockedBy,
		blocks,
		relatedTo,
		duplicateOf:
			duplicateOf === undefined || duplicateOf === null
				? null
				: structuredClone(duplicateOf),
	};
	protectedFields.attachments = attachments.map(
		(attachment) => attachment.value,
	);
	return {
		protectedFields,
		id: value.id,
		identifier,
		title: value.title,
		description: value.description,
		updatedAt: value.updatedAt,
		status: { name: value.status, type: value.statusType },
		assignee:
			value.assignee === undefined || value.assignee === null
				? null
				: { id: value.assigneeId as string, name: value.assignee },
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
		attachments: attachments.map(({ id, title, url }) => ({ id, title, url })),
	};
}

function commentPage(value: unknown):
	| { readonly comments: readonly LinearComment[]; readonly nextCursor?: string }
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

function exactMarker(body: string, marker: string): boolean {
	return body.split(/\r\n|\n|\r/).some((line) => line === marker);
}

function inspectRootReferences(
	comments: readonly LinearComment[],
	artifact: ProductReviewArtifact,
):
	| { readonly status: "none" }
	| { readonly status: "exact"; readonly comment: LinearComment }
	| { readonly status: "conflict" } {
	const marker = `Referencia de flujo: product-review:${artifact.digest}`;
	const matching = comments.filter(
		(comment) => comment.isRoot && exactMarker(comment.body, marker),
	);
	if (
		matching.length > 1 ||
		matching.some((comment) => comment.body !== artifact.body)
	)
		return { status: "conflict" };
	return matching.length === 1
		? { status: "exact", comment: matching[0] }
		: { status: "none" };
}

function emptyCommentRead(): CommentRead {
	return { comments: [], seenCursors: new Set() };
}

function productIssueSnapshot(
	issue: LinearIssueEvidence,
): LinearProductReviewIssueSnapshot {
	return {
		id: issue.identifier,
		identifier: issue.identifier,
		linearId: issue.id,
		title: issue.title,
		description: issue.description,
		updatedAt: issue.updatedAt,
		state: structuredClone(issue.status),
		assignee: structuredClone(issue.assignee),
		cycle: structuredClone(issue.cycle),
		labels: structuredClone(issue.labels),
		estimate: structuredClone(issue.estimate),
		relations: structuredClone(issue.relations),
		...(issue.parent ? { parent: structuredClone(issue.parent) } : {}),
		attachments: structuredClone(issue.attachments),
		mcpEvidence: structuredClone(issue.protectedFields),
	};
}

function productReviewDecisionActor(
	actorId: string,
	authorityRevision: string,
): AuthenticatedDecisionActor {
	return {
		actorId,
		authorityRevision,
		active: true,
		guest: false,
	};
}

export function productReviewDecisionRequest(
	project: string,
	issueId: string,
	issue: LinearIssueEvidence,
	choices: Readonly<Record<ProductReviewResult, ProtectedProductReviewArtifact>>,
): {
	readonly request: DecisionRequest;
	readonly actions: Readonly<Record<ProductReviewResult, TypedDecisionAction>>;
} {
	const actions = {
		Aceptado: {
			id: "product-review.publish.accepted",
			input: {
				issueId,
				result: "Aceptado",
				digest: choices.Aceptado.digest,
				protectedDigest: choices.Aceptado.payload.issue.protectedDigest,
			},
		},
		"Cambios requeridos": {
			id: "product-review.publish.changes-required",
			input: {
				issueId,
				result: "Cambios requeridos",
				digest: choices["Cambios requeridos"].digest,
				protectedDigest:
					choices["Cambios requeridos"].payload.issue.protectedDigest,
			},
		},
	} satisfies Record<ProductReviewResult, TypedDecisionAction>;
	return {
		actions,
		request: {
			scope: { project, workflow: "product-review", subject: issueId },
			operation: {
				kind: "product-review.publication",
				phase: "result-selection",
				input: {
					issueId,
					issueRevision: issue.updatedAt,
					protectedDigest:
						choices.Aceptado.payload.issue.protectedDigest,
				},
				artifacts: [
					{ result: "Aceptado", digest: choices.Aceptado.digest },
					{
						result: "Cambios requeridos",
						digest: choices["Cambios requeridos"].digest,
					},
				],
				targets: [{ kind: "linear-root-comment", issueId }],
				evidence: [],
			},
			presentation: {
				locale: "es",
				summary: `Seleccione el resultado de la revisión de producto para ${issueId}.`,
				details: [],
				consequences: [
					"El resultado seleccionado se publicará como comentario raíz canónico en Linear.",
				],
				risks: [
					"La publicación se detendrá si cambian el issue, la autoridad o la evidencia aprobada.",
				],
				choices: [
					{
						id: "product-review.accepted",
						mode: "execute",
						action: actions.Aceptado,
						label: "Aceptado",
						description: "Aprobar y publicar la revisión de producto.",
					},
					{
						id: "product-review.changes-required",
						mode: "execute",
						action: actions["Cambios requeridos"],
						label: "Cambios requeridos",
						description: "Publicar los cambios requeridos de la revisión.",
					},
					{
						id: "product-review.cancel",
						mode: "cancel",
						action: { id: "decision.cancel", input: null },
						label: "Cancelar",
						description: "Cerrar esta decisión sin publicar en Linear.",
					},
				],
			},
		},
	};
}

function decisionFailure(blocker: DecisionBlocker): ProductReviewMcpPublication.Blocker {
	return blocked(blocker.code, blocker.message);
}

type State =
	| { readonly phase: "idle" }
	| { readonly phase: "current-user"; readonly issueId: string }
	| {
			readonly phase: "current-user-result";
			readonly issueId: string;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue";
			readonly issueId: string;
			readonly actor: AuthenticatedLinearActor;
	  }
	| {
			readonly phase: "issue-result";
			readonly issueId: string;
			readonly actor: AuthenticatedLinearActor;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue-verify";
			readonly issueId: string;
			readonly actor: AuthenticatedLinearActor;
			readonly issue: LinearIssueEvidence;
	  }
	| {
			readonly phase: "issue-verify-result";
			readonly issueId: string;
			readonly actor: AuthenticatedLinearActor;
			readonly issue: LinearIssueEvidence;
			readonly toolCallId: string;
	  }
	| { readonly phase: "prepared"; readonly context: PreparedContext }
	| { readonly phase: "public-selection-result"; readonly context: ApprovedContext; readonly toolCallId: string }
	| {
			readonly phase: "cancelled";
			readonly issueId: string;
			readonly toolCallId: string;
	  }
	| { readonly phase: "issue-after-approval"; readonly context: ApprovedContext }
	| { readonly phase: "issue-after-approval-result"; readonly context: ApprovedContext; readonly toolCallId: string }
	| { readonly phase: "comments-before"; readonly context: PublicationContext; readonly read: CommentRead }
	| { readonly phase: "comments-before-result"; readonly context: PublicationContext; readonly read: CommentRead; readonly toolCallId: string }
	| { readonly phase: "issue-before-mutation"; readonly context: PublicationContext }
	| { readonly phase: "issue-before-mutation-result"; readonly context: PublicationContext; readonly toolCallId: string }
	| { readonly phase: "comment-create"; readonly context: PublicationContext }
	| { readonly phase: "comment-create-result"; readonly context: PublicationContext; readonly toolCallId: string }
	| { readonly phase: "comments-readback"; readonly context: SelectedCommentContext; readonly read: CommentRead }
	| { readonly phase: "comments-readback-result"; readonly context: SelectedCommentContext; readonly read: CommentRead; readonly toolCallId: string }
	| { readonly phase: "issue-final"; readonly context: CompletedContext }
	| { readonly phase: "issue-final-result"; readonly context: CompletedContext; readonly toolCallId: string }
	| { readonly phase: "ready"; readonly context: CompletedContext }
	| {
			readonly phase: "blocked";
			readonly blocker: ProductReviewMcpPublication.Blocker["blocker"];
	  };

export function createProductReviewMcpPublication(
	options: ProductReviewMcpPublicationDependencies,
): ProductReviewMcpPublication {
	let state: State = { phase: "idle" };
	const authoritySession = createSingleUserAuthoritySession({
		...(options.owner
			? { authority: { ...options.owner, role: "Owner" as const } }
			: {}),
	});
	let mcpAvailable: boolean | undefined;
	let turnGeneration = 0;
	let recoveryOwnerId = randomUUID();
	// Reserve accepted MCP identities for the lifetime of this runtime. A late
	// result from an earlier Pi session must never satisfy a later publication.
	const reservedToolIdentities = new Map<string, number>();
	const mutationAuthorizedGenerations = new Set<number>();
	const processedResults = new Map<string, string>();
	let toolResultQueue: Promise<void> = Promise.resolve();

	const toolIdentity = (toolName: string, toolCallId: string) =>
		`${toolName}\u0000${toolCallId}`;
	const isCurrent = (generation: number, active: State) =>
		turnGeneration === generation && state === active;
	const staleCallBlock = () => ({
		block: true as const,
		reason: "PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID",
	});

	function fail(code: string, message: string): void {
		if (state.phase !== "blocked")
			state = { phase: "blocked", blocker: { code, message } };
	}

	function currentDecisionActor(): AuthenticatedDecisionActor | undefined {
		const authority = authoritySession.current("Owner");
		return authority?.role === "Owner"
			? productReviewDecisionActor(
					authority.actorId,
					authority.authorityRevision,
				)
			: undefined;
	}

	async function authorizeEffect(
		context: ApprovedContext,
	): Promise<ProductReviewMcpPublication.Blocker | undefined> {
		const outcome = await options.interactiveDecisions.authorizeEffect(
			context.executionLease,
		);
		return outcome.kind === "blocked"
			? decisionFailure(outcome.blocker)
			: undefined;
	}

	async function bindExecution(
		context: Omit<ApprovedContext, "executionLease">,
		lease: ExecutionLease,
		boundManifest?: ExecutionManifestBinding,
	): Promise<ApprovedContext | ProductReviewMcpPublication.Blocker> {
		try {
			const manifest = await options.recovery.bindExecution(context.artifact, lease);
			if (
				boundManifest &&
				canonicalJson(boundManifest) !== canonicalJson(manifest)
			)
				return blocked(
					"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
					"Recovered product-review decision manifest does not match durable publication recovery.",
				);
			if (!boundManifest) {
				const bound =
					await options.interactiveDecisions.bindExecutionManifest(lease, manifest);
				if (bound.kind === "blocked") return decisionFailure(bound.blocker);
			}
			const approved = { ...context, executionLease: lease };
			const effectFailure = await authorizeEffect(approved);
			return effectFailure ?? approved;
		} catch (error) {
			return blocked(
				"PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PERSISTENCE_FAILED",
				error instanceof Error
					? error.message
					: "Product review execution binding failed.",
			);
		}
	}

	function resultForAction(
		actions: Readonly<Record<ProductReviewResult, TypedDecisionAction>>,
		action: TypedDecisionAction,
	): ProductReviewResult | undefined {
		return (Object.entries(actions) as [ProductReviewResult, TypedDecisionAction][])
			.find(([, candidate]) => canonicalJson(candidate) === canonicalJson(action))
			?.[0];
	}

	async function restoreOrPrepareDecision(input: {
		readonly issueId: string;
		readonly actor: AuthenticatedLinearActor;
		readonly issue: LinearIssueEvidence;
		readonly choices: Readonly<
			Record<ProductReviewResult, ProtectedProductReviewArtifact>
		>;
		readonly decisionActor: AuthenticatedDecisionActor;
	}): Promise<State | ProductReviewMcpPublication.Blocker> {
		const decision = productReviewDecisionRequest(
			options.project,
			input.issueId,
			input.issue,
			input.choices,
		);
		let recovery = await options.interactiveDecisions.recover(
			decision.request.scope,
			input.decisionActor,
		);
		if (recovery.kind === "active")
			recovery = await options.interactiveDecisions.recover(
				decision.request.scope,
				input.decisionActor,
				{ kind: "resume", request: decision.request },
			);
		if (recovery.kind === "authorized") {
			const result = resultForAction(decision.actions, recovery.lease.action);
			if (!result) {
				recovery = await options.interactiveDecisions.recover(
					decision.request.scope,
					input.decisionActor,
					{
						kind: "drift",
						request: decision.request,
						diff: {
							summary: "The product-review publication evidence changed.",
							details: [
								"The issue revision, protected digest, review result, or canonical artifact no longer matches the prior lease.",
							],
						},
					},
				);
			} else {
				const approved = await bindExecution(
					{
						...input,
						decision: {
							decisionId: recovery.lease.decisionId,
							actions: decision.actions,
						},
						result,
						artifact: input.choices[result],
					},
					recovery.lease,
					recovery.manifest,
				);
				return "status" in approved
					? approved
					: { phase: "issue-after-approval", context: approved };
			}
		}
		if (recovery.kind === "none") {
			const presentation = await options.interactiveDecisions.prepare(
				decision.request,
				input.decisionActor,
			);
			return {
				phase: "prepared",
				context: {
					issueId: input.issueId,
					actor: input.actor,
					issue: input.issue,
					choices: input.choices,
					decision: {
						decisionId: presentation.decisionId,
						actions: decision.actions,
					},
				},
			};
		}
		if (
			recovery.kind === "prepared" ||
			recovery.kind === "reapproval" ||
			recovery.kind === "drift"
		) {
			const decisionId =
				recovery.kind === "prepared"
					? recovery.decisionId
					: recovery.presentation.decisionId;
			return {
				phase: "prepared",
				context: {
					issueId: input.issueId,
					actor: input.actor,
					issue: input.issue,
					choices: input.choices,
					decision: { decisionId, actions: decision.actions },
				},
			};
		}
		if (recovery.kind === "blocked") return decisionFailure(recovery.blocker);
		return blocked(
			"PI_WORKFLOW_DECISION_REPLAY",
			`Product review decision is already ${recovery.kind}.`,
		);
	}

	function start(issueId: string): void {
		turnGeneration += 1;
		recoveryOwnerId = randomUUID();
		authoritySession.clear();
		state = { phase: "current-user", issueId };
		if (mcpAvailable === false)
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for product review publication.",
			);
	}

	function setMcpAvailable(available: boolean): void {
		mcpAvailable = available;
		if (!available && state.phase !== "idle" && state.phase !== "blocked")
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for product review publication.",
			);
	}

	function clear(): void {
		turnGeneration += 1;
		recoveryOwnerId = randomUUID();
		state = { phase: "idle" };
	}

	function expectedModelCall():
		| ProductReviewMcpPublication.ExpectedCall
		| undefined {
		if (state.phase === "current-user")
			return { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
		if (state.phase === "issue" || state.phase === "issue-verify")
			return {
				toolName: ISSUE_TOOL,
				input: { id: state.issueId, includeRelations: true },
			};
		if (
			state.phase === "issue-after-approval" ||
			state.phase === "issue-before-mutation" ||
			state.phase === "issue-final"
		)
			return {
				toolName: ISSUE_TOOL,
				input: { id: state.context.issueId, includeRelations: true },
			};
		if (
			state.phase === "comments-before" ||
			state.phase === "comments-readback"
		)
			return {
				toolName: LIST_COMMENTS_TOOL,
				input: {
					issueId: state.context.issueId,
					...(state.read.cursor ? { cursor: state.read.cursor } : {}),
				},
			};
		if (state.phase === "comment-create")
			return {
				toolName: SAVE_COMMENT_TOOL,
				input: {
					issueId: state.context.issueId,
					body: CANONICAL_BODY_PLACEHOLDER,
				},
			};
		if (state.phase === "ready")
			return { toolName: WORKFLOW_TOOL, input: {} };
		return undefined;
	}

	async function handleToolCall(
		event: ProductReviewMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined> {
		if (state.phase === "idle") return undefined;
		const active = state;
		const typedSelection =
			active.phase === "prepared" && event.toolName === WORKFLOW_TOOL
				? selectedResult(event.input)
				: undefined;
		const typedCancellation =
			active.phase === "prepared" &&
			event.toolName === WORKFLOW_TOOL &&
			cancellationSelected(event.input);
		const expected = expectedModelCall();
		const generation = turnGeneration;
		const ownerId = recoveryOwnerId;
		if (active.phase === "blocked" && event.toolName === WORKFLOW_TOOL)
			return undefined;
		if (
			!typedSelection &&
			!typedCancellation &&
			(!expected ||
				event.toolName !== expected.toolName ||
				!exactInput(event.input, expected.input))
		) {
			const code = "PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID";
			fail(
				code,
				"Product review MCP tool, input, issue, body, or stage did not match the active publication plan.",
			);
			return { block: true, reason: code };
		}
		if (active.phase === "ready") return undefined;
		if (!nonEmpty(event.toolCallId)) {
			const code = "PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE";
			fail(code, "Linear MCP did not provide a stable tool call identity.");
			return { block: true, reason: code };
		}
		const identity = toolIdentity(event.toolName, event.toolCallId);
		if (reservedToolIdentities.has(identity)) return staleCallBlock();
		if (reservedToolIdentities.size >= MAX_RESERVED_TOOL_IDENTITIES) {
			const code = "PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID";
			fail(
				code,
				`The product review extension exhausted its bounded ${MAX_RESERVED_TOOL_IDENTITIES} tool identity reservation capacity; reload the extension before starting another review.`,
			);
			return { block: true, reason: code };
		}
		if (active.phase === "prepared") {
			const actor = currentDecisionActor();
			if (!actor) {
				const code = "PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH";
				fail(code, "Authenticated single-user Owner authority is unavailable.");
				return { block: true, reason: code };
			}
			const action = typedCancellation
				? { id: "decision.cancel", input: null }
				: active.context.decision.actions[typedSelection as ProductReviewResult];
			const authorization = await options.interactiveDecisions.authorize(
				active.context.decision.decisionId,
				action,
				actor,
			);
			if (authorization.kind === "blocked") {
				fail(authorization.blocker.code, authorization.blocker.message);
				return { block: true, reason: authorization.blocker.code };
			}
			if (typedCancellation) {
				if (authorization.kind !== "cancelled") {
					const code = "PI_WORKFLOW_DECISION_ACTION_MISMATCH";
					fail(code, "The shared product-review decision did not authorize cancellation.");
					return { block: true, reason: code };
				}
				state = {
					phase: "cancelled",
					issueId: active.context.issueId,
					toolCallId: event.toolCallId,
				};
				reservedToolIdentities.set(identity, generation);
				return undefined;
			}
			if (authorization.kind !== "authorized" || !typedSelection) {
				const code = "PI_WORKFLOW_DECISION_ACTION_MISMATCH";
				fail(code, "The shared product-review decision did not authorize publication.");
				return { block: true, reason: code };
			}
			const artifact = active.context.choices[typedSelection];
			const approved = await bindExecution(
				{ ...active.context, result: typedSelection, artifact },
				authorization.lease,
				undefined,
			);
			if ("status" in approved) {
				fail(approved.blocker.code, approved.blocker.message);
				return { block: true, reason: approved.blocker.code };
			}
			state = {
				phase: "public-selection-result",
				context: approved,
				toolCallId: event.toolCallId,
			};
			reservedToolIdentities.set(identity, generation);
			return undefined;
		}
		if (active.phase === "comment-create") {
			try {
				const effectFailure = await authorizeEffect(active.context);
				if (effectFailure) {
					fail(effectFailure.blocker.code, effectFailure.blocker.message);
					return { block: true, reason: effectFailure.blocker.code };
				}
				// This durable uncertain claim is the final local operation before
				// authorizing the external mutation. A crash after this point is
				// recovered by lookup only; the mutation is never retried blindly.
				await options.recovery.claim(active.context.artifact, ownerId);
				if (!isCurrent(generation, active)) {
					// A concurrent accepted call in this generation may already have
					// escaped to Linear. Never release its uncertainty from a stale peer.
					if (!mutationAuthorizedGenerations.has(generation)) {
						try {
							await options.recovery.release(active.context.artifact, ownerId);
						} catch {
							// A failed stale release remains fail-closed for later lookup.
						}
					}
					return staleCallBlock();
				}
			} catch (error) {
				if (!isCurrent(generation, active)) return staleCallBlock();
				const code = "PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PERSISTENCE_FAILED";
				fail(
					code,
					error instanceof Error
						? error.message
						: "Product review recovery claim persistence failed.",
				);
				return { block: true, reason: code };
			}
		}
		switch (active.phase) {
			case "current-user":
				state = {
					phase: "current-user-result",
					issueId: active.issueId,
					toolCallId: event.toolCallId,
				};
				break;
			case "issue":
				state = {
					phase: "issue-result",
					issueId: active.issueId,
					actor: active.actor,
					toolCallId: event.toolCallId,
				};
				break;
			case "issue-verify":
				state = {
					phase: "issue-verify-result",
					issueId: active.issueId,
					actor: active.actor,
					issue: active.issue,
					toolCallId: event.toolCallId,
				};
				break;
			case "issue-after-approval":
				state = {
					phase: "issue-after-approval-result",
					context: active.context,
					toolCallId: event.toolCallId,
				};
				break;
			case "comments-before":
				state = {
					phase: "comments-before-result",
					context: active.context,
					read: active.read,
					toolCallId: event.toolCallId,
				};
				break;
			case "issue-before-mutation":
				state = {
					phase: "issue-before-mutation-result",
					context: active.context,
					toolCallId: event.toolCallId,
				};
				break;
			case "comment-create":
				state = {
					phase: "comment-create-result",
					context: active.context,
					toolCallId: event.toolCallId,
				};
				break;
			case "comments-readback":
				state = {
					phase: "comments-readback-result",
					context: active.context,
					read: active.read,
					toolCallId: event.toolCallId,
				};
				break;
			case "issue-final":
				state = {
					phase: "issue-final-result",
					context: active.context,
					toolCallId: event.toolCallId,
				};
				break;
			default: {
				const code = "PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID";
				fail(code, "Product review MCP protocol reached an invalid stage.");
				return { block: true, reason: code };
			}
		}
		reservedToolIdentities.set(identity, generation);
		if (active.phase === "comment-create") {
			mutationAuthorizedGenerations.add(generation);
			if (record(event.input)) event.input.body = active.context.artifact.body;
		}
		return undefined;
	}

	function validOwnerActor(payload: unknown): payload is AuthenticatedLinearActor {
		return (
			actorEvidence(payload) &&
			payload.isActive === true &&
			payload.isGuest === false &&
			(options.owner === undefined || payload.id === options.owner.actorId)
		);
	}

	async function persistApprovedArtifact(
		context: ApprovedContext,
		stillActive: () => boolean,
	): Promise<ProtectedProductReviewArtifact | undefined> {
		const existing = await options.artifacts.read(context.issueId);
		if (!stillActive()) return undefined;
		if (
			existing &&
			(!isProductReviewArtifact(existing, context.issueId) ||
				!hasProductReviewProtectedDigest(existing) ||
				canonicalJson(existing) !== canonicalJson(context.artifact))
		) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT",
				"A different create-only product review artifact already exists.",
			);
			return undefined;
		}
		if (!existing) {
			const effectFailure = await authorizeEffect(context);
			if (effectFailure) {
				fail(effectFailure.blocker.code, effectFailure.blocker.message);
				return undefined;
			}
		}
		const saved = existing ?? (await options.artifacts.save(context.artifact));
		if (!stillActive()) return undefined;
		const readBack = await options.artifacts.read(context.issueId);
		if (!stillActive()) return undefined;
		if (
			!readBack ||
			!isProductReviewArtifact(readBack, context.issueId) ||
			!hasProductReviewProtectedDigest(readBack) ||
			canonicalJson(readBack) !== canonicalJson(saved) ||
			canonicalJson(readBack) !== canonicalJson(context.artifact)
		) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_READBACK_MISMATCH",
				"Product review artifact read-back did not match the approved digest.",
			);
			return undefined;
		}
		return readBack;
	}

	function exactIssue(
		context: { readonly issueId: string; readonly issue: LinearIssueEvidence },
		payload: unknown,
	): LinearIssueEvidence | undefined {
		const issue = issueEvidence(payload);
		if (!issue) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE",
				"Linear MCP returned partial or malformed protected issue evidence.",
			);
			return undefined;
		}
		if (issue.identifier !== context.issueId) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_ISSUE_MISMATCH",
				"Linear MCP returned a different issue identifier.",
			);
			return undefined;
		}
		return issue;
	}

	function nextCommentRead(
		read: CommentRead,
		payload: unknown,
	): { readonly complete: boolean; readonly read: CommentRead } | undefined {
		const page = commentPage(payload);
		if (!page) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE",
				"Linear MCP returned a malformed comment page.",
			);
			return undefined;
		}
		const comments = [...read.comments, ...page.comments];
		if (!page.nextCursor)
			return { complete: true, read: { comments, seenCursors: read.seenCursors } };
		if (read.seenCursors.has(page.nextCursor)) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE",
				"Linear MCP repeated a comment cursor.",
			);
			return undefined;
		}
		return {
			complete: false,
			read: {
				comments,
				cursor: page.nextCursor,
				seenCursors: new Set([...read.seenCursors, page.nextCursor]),
			},
		};
	}

	async function handleToolResultSerial(
		event: ProductReviewMcpPublication.ToolResultEvent,
		generation: number,
		ownerId: string,
	): Promise<boolean> {
		const active = state;
		const resultPhases = new Set([
			"current-user-result",
			"public-selection-result",
			"issue-result",
			"issue-verify-result",
			"issue-after-approval-result",
			"comments-before-result",
			"issue-before-mutation-result",
			"comment-create-result",
			"comments-readback-result",
			"issue-final-result",
		]);
		if (!resultPhases.has(active.phase) || !("toolCallId" in active)) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
				"Linear MCP returned a result without a matching active publication stage.",
			);
			return true;
		}
		const expectedTool =
			active.phase === "public-selection-result"
				? WORKFLOW_TOOL
				: active.phase === "current-user-result"
					? CURRENT_USER_TOOL
				: active.phase === "comments-before-result" ||
					active.phase === "comments-readback-result"
					? LIST_COMMENTS_TOOL
					: active.phase === "comment-create-result"
						? SAVE_COMMENT_TOOL
						: ISSUE_TOOL;
		if (
			event.toolName !== expectedTool ||
			event.toolCallId !== active.toolCallId
		) {
			fail(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
				"Linear MCP returned an out-of-order or mismatched result.",
			);
			return true;
		}
		if (event.isError === true) {
			const failure = resultFailure(event);
			if (
				active.phase === "comment-create-result" &&
				classifyMcpError(event) === "permission-denied"
			) {
				try {
					const effectFailure = await authorizeEffect(active.context);
					if (effectFailure) {
						fail(effectFailure.blocker.code, effectFailure.blocker.message);
						return true;
					}
					await options.recovery.release(
						active.context.artifact,
						ownerId,
					);
					if (!isCurrent(generation, active)) return false;
				} catch (error) {
					if (!isCurrent(generation, active)) return false;
					fail(
						"PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PERSISTENCE_FAILED",
						error instanceof Error
							? error.message
							: "Product review recovery release persistence failed.",
					);
					return true;
				}
			}
			fail(failure.code, failure.message);
			return true;
		}
		const payload = toolPayload(event);
		if (active.phase === "public-selection-result") {
			if (!exactInput(payload, { status: "continuing" }))
				fail(
					"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
					"The public product review continuation result did not match the exact Owner selection.",
				);
			else
				state = {
					phase: "issue-after-approval",
					context: active.context,
				};
			return true;
		}
		if (active.phase === "current-user-result") {
			if (!actorEvidence(payload))
				fail("PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE", "Linear MCP returned partial or malformed actor evidence.");
			else if (!validOwnerActor(payload) || !authoritySession.authenticate(payload).ok)
				fail("PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH", "An active non-guest authenticated Linear user is required.");
			else
				state = { phase: "issue", issueId: active.issueId, actor: structuredClone(payload) };
			return true;
		}
		if (active.phase === "issue-result") {
			const issue = issueEvidence(payload);
			if (!issue)
				fail("PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE", "Linear MCP returned partial or malformed protected issue evidence.");
			else if (issue.identifier !== active.issueId)
				fail("PI_WORKFLOW_PRODUCT_REVIEW_ISSUE_MISMATCH", "Linear MCP returned a different issue identifier.");
			else
				state = { phase: "issue-verify", issueId: active.issueId, actor: active.actor, issue };
			return true;
		}
		if (active.phase === "issue-verify-result") {
			const issue = exactIssue(active, payload);
			if (!issue) return true;
			if (canonicalJson(issue) !== canonicalJson(active.issue)) {
				fail("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "The complete protected Linear issue snapshot changed during preparation.");
				return true;
			}
			try {
				const draft = await options.drafts.read(active.issueId);
				if (!isCurrent(generation, active)) return false;
				if (!isProductReviewDraft(draft)) {
					fail("PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_INVALID", "A valid canonical product review draft is required.");
					return true;
				}
				const authority = authoritySession.current("Owner");
				if (authority?.role !== "Owner") {
					fail("PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH", "Authenticated single-user Owner authority is unavailable.");
					return true;
				}
				const ownerAuthority = {
					actorId: authority.actorId,
					role: "Owner" as const,
					authorityRevision: authority.authorityRevision,
				};
				let snapshot = productIssueSnapshot(issue);
				const existing = await options.artifacts.read(active.issueId);
				if (!isCurrent(generation, active)) return false;
				if (existing) {
					if (
						!isProductReviewArtifact(existing, active.issueId) ||
						!hasProductReviewProtectedDigest(existing)
					) {
						fail("PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT", "The create-only product review artifact is malformed or is a legacy direct-workflow artifact without MCP protected evidence.");
						return true;
					}
					if (existing.payload.issue.protectedDigest !== productReviewProtectedIssueDigest(snapshot)) {
						fail("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "Protected Linear issue fields changed since the persisted product review approval.");
						return true;
					}
					snapshot = { ...snapshot, updatedAt: existing.payload.issue.revision };
				}
				const choices = {
					Aceptado: createProductReviewArtifact(snapshot, ownerAuthority, draft, "Aceptado"),
					"Cambios requeridos": createProductReviewArtifact(snapshot, ownerAuthority, draft, "Cambios requeridos"),
				};
				if (existing) {
					const historical = createProductReviewArtifact(
						snapshot,
						existing.payload.authority,
						draft,
						existing.payload.result,
					);
					if (canonicalJson(existing) !== canonicalJson(historical)) {
						fail("PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT", "The create-only product review artifact does not match the canonical approved content.");
						return true;
					}
					choices[existing.payload.result] = existing as ProtectedProductReviewArtifact;
				}
				const decisionActor = currentDecisionActor();
				if (!decisionActor) {
					fail(
						"PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH",
						"Authenticated single-user Owner authority is unavailable.",
					);
					return true;
				}
				const next = await restoreOrPrepareDecision({
					issueId: active.issueId,
					actor: active.actor,
					issue,
					choices,
					decisionActor,
				});
				if (!isCurrent(generation, active)) return false;
				if ("status" in next) fail(next.blocker.code, next.blocker.message);
				else state = next;
			} catch (error) {
				if (!isCurrent(generation, active)) return false;
				fail(record(error) && nonEmpty(error.code) ? error.code : "PI_WORKFLOW_PRODUCT_REVIEW_PREPARATION_FAILED", error instanceof Error ? error.message : "Product review preparation failed.");
			}
			return true;
		}
		if (active.phase === "issue-after-approval-result") {
			const issue = exactIssue(active.context, payload);
			if (!issue) return true;
			if (canonicalJson(issue) !== canonicalJson(active.context.issue)) {
				fail("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "The complete protected Linear issue snapshot changed after approval.");
				return true;
			}
			try {
				const artifact = await persistApprovedArtifact(
					active.context,
					() => isCurrent(generation, active),
				);
				if (!isCurrent(generation, active)) return false;
				if (!artifact) return true;
				const recovery = await options.recovery.read(active.context.issueId);
				if (!isCurrent(generation, active)) return false;
				if (recovery && recovery.digest !== artifact.digest) {
					fail("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "The pending product review recovery digest changed.");
					return true;
				}
				state = {
					phase: "comments-before",
					context: { ...active.context, artifact, ...(recovery ? { recoveryStage: recovery.stage } : {}) },
					read: emptyCommentRead(),
				};
			} catch (error) {
				if (!isCurrent(generation, active)) return false;
				fail("PI_WORKFLOW_PRODUCT_REVIEW_PREPARATION_FAILED", error instanceof Error ? error.message : "Product review artifact persistence failed.");
			}
			return true;
		}
		if (active.phase === "comments-before-result") {
			const advanced = nextCommentRead(active.read, payload);
			if (!advanced) return true;
			if (!advanced.complete) {
				state = { phase: "comments-before", context: active.context, read: advanced.read };
				return true;
			}
			const inspection = inspectRootReferences(
				advanced.read.comments,
				active.context.artifact,
			);
			if (inspection.status === "conflict") {
				fail("PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT", "The product review root reference is conflicting or duplicated.");
				return true;
			}
			if (inspection.status === "exact") {
				state = {
					phase: "comments-readback",
					context: { ...active.context, comment: inspection.comment },
					read: emptyCommentRead(),
				};
				return true;
			}
			if (active.context.recoveryStage) {
				fail(active.context.recoveryStage === "verified" ? "PI_WORKFLOW_PRODUCT_REVIEW_ALREADY_VERIFIED" : "PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PENDING", active.context.recoveryStage === "verified" ? "The verified product review comment is no longer visible; refusing a duplicate mutation." : "A prior product review comment creation is uncertain; retry lookup later without repeating the mutation.");
				return true;
			}
			if (active.context.artifact.payload.issue.revision !== active.context.issue.updatedAt) {
				fail("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "The Linear issue revision advanced without the exact approved product review comment; refusing a new mutation.");
				return true;
			}
			state = { phase: "issue-before-mutation", context: active.context };
			return true;
		}
		if (active.phase === "issue-before-mutation-result") {
			const issue = exactIssue(active.context, payload);
			if (!issue) return true;
			if (canonicalJson(issue) !== canonicalJson(active.context.issue))
				fail("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "The complete protected Linear issue snapshot changed immediately before publication.");
			else state = { phase: "comment-create", context: active.context };
			return true;
		}
		if (active.phase === "comment-create-result") {
			const comment = commentResult(payload);
			if (!comment || comment.body !== active.context.artifact.body)
				fail("PI_WORKFLOW_PRODUCT_REVIEW_MCP_MALFORMED_RESPONSE", "Linear MCP returned a malformed comment creation response.");
			else state = { phase: "comments-readback", context: { ...active.context, comment }, read: emptyCommentRead() };
			return true;
		}
		if (active.phase === "comments-readback-result") {
			const advanced = nextCommentRead(active.read, payload);
			if (!advanced) return true;
			if (!advanced.complete) {
				state = { phase: "comments-readback", context: active.context, read: advanced.read };
				return true;
			}
			const inspection = inspectRootReferences(
				advanced.read.comments,
				active.context.artifact,
			);
			if (
				inspection.status !== "exact" ||
				inspection.comment.id !== active.context.comment.id ||
				inspection.comment.body !== active.context.artifact.body
			) {
				fail("PI_WORKFLOW_PRODUCT_REVIEW_READBACK_MISMATCH", "The product review read-back did not contain exactly one canonical root comment with the selected ID and body.");
				return true;
			}
			state = { phase: "issue-final", context: { ...active.context, publication: { status: "published", issueId: active.context.issueId, commentId: inspection.comment.id } } };
			return true;
		}
		if (active.phase === "issue-final-result") {
			const issue = exactIssue(active.context, payload);
			if (!issue) return true;
			const { updatedAt: _current, ...currentProtected } = issue;
			const { updatedAt: _approved, ...approvedProtected } = active.context.issue;
			if (Date.parse(issue.updatedAt) < Date.parse(active.context.issue.updatedAt) || canonicalJson(currentProtected) !== canonicalJson(approvedProtected)) {
				fail("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "Protected Linear issue fields changed during product review publication.");
				return true;
			}
			try {
				const effectFailure = await authorizeEffect(active.context);
				if (effectFailure) {
					fail(effectFailure.blocker.code, effectFailure.blocker.message);
					return true;
				}
				await options.recovery.finalizeVerified(active.context.artifact);
				if (!isCurrent(generation, active)) return false;
				const actor = currentDecisionActor();
				if (!actor) {
					fail(
						"PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH",
						"Authenticated single-user Owner authority is unavailable.",
					);
					return true;
				}
				const terminalEffectFailure = await authorizeEffect(active.context);
				if (terminalEffectFailure) {
					fail(
						terminalEffectFailure.blocker.code,
						terminalEffectFailure.blocker.message,
					);
					return true;
				}
				const terminal = await options.interactiveDecisions.recover(
					{
						project: options.project,
						workflow: "product-review",
						subject: active.context.issueId,
					},
					actor,
					{ kind: "terminal", state: "published" },
				);
				if (terminal.kind !== "terminal") {
					const blocker =
						terminal.kind === "blocked"
							? terminal.blocker
							: {
									code: "PI_WORKFLOW_DECISION_MANIFEST_CONFLICT" as const,
									message:
										"Product review publication could not persist terminal decision state.",
								};
					fail(blocker.code, blocker.message);
					return true;
				}
				if (!isCurrent(generation, active)) return false;
				state = { phase: "ready", context: active.context };
			} catch (error) {
				if (!isCurrent(generation, active)) return false;
				fail("PI_WORKFLOW_PRODUCT_REVIEW_RECOVERY_PERSISTENCE_FAILED", error instanceof Error ? error.message : "Product review verified recovery persistence failed.");
			}
			return true;
		}
		return false;
	}

	async function handleToolResult(
		event: ProductReviewMcpPublication.ToolResultEvent,
	): Promise<boolean> {
		if (state.phase === "idle" || !MCP_TOOLS.has(event.toolName)) return false;
		const queuedGeneration = turnGeneration;
		const queuedOwnerId = recoveryOwnerId;
		const preceding = toolResultQueue;
		let releaseQueue: () => void = () => {};
		toolResultQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			if (turnGeneration !== queuedGeneration) return false;
			if (!nonEmpty(event.toolCallId)) {
				fail(
					"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
					"Linear MCP returned a result without a stable tool call identity.",
				);
				return true;
			}
			const identity = toolIdentity(event.toolName, event.toolCallId);
			const reservation = reservedToolIdentities.get(identity);
			if (reservation !== queuedGeneration) {
				if (reservation === undefined) {
					fail(
						"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
						"Linear MCP returned a result without a currently issued tool identity.",
					);
					return true;
				}
				return false;
			}
			const fingerprint = canonicalJson({
				toolName: event.toolName,
				toolCallId: event.toolCallId,
				content: event.content ?? null,
				isError: event.isError === true,
			});
			const settledFingerprint = processedResults.get(identity);
			if (settledFingerprint !== undefined) {
				if (settledFingerprint === fingerprint) return false;
				fail(
					"PI_WORKFLOW_PRODUCT_REVIEW_MCP_INCOMPATIBLE",
					"Linear MCP returned conflicting payloads for one tool call identity.",
				);
				return true;
			}
			processedResults.set(identity, fingerprint);
			return await handleToolResultSerial(
				event,
				queuedGeneration,
				queuedOwnerId,
			);
		} finally {
			releaseQueue();
		}
	}

	async function complete(
		input: unknown,
	): Promise<
		| ProductReviewMcpPublication.PublishedReview
		| ProductReviewMcpPublication.ContinuingReview
		| ProductReviewMcpPublication.CancelledReview
		| ProductReviewMcpPublication.Blocker
	> {
		if (state.phase === "blocked")
			return { status: "blocked", blocker: state.blocker };
		if (
			state.phase === "cancelled" &&
			exactInput(input, { action: "cancel_decision" })
		) {
			const issueId = state.issueId;
			clear();
			return { status: "cancelled", issueId };
		}
		if (
			state.phase === "public-selection-result" &&
			exactInput(input, {
				action: "select_result",
				result: state.context.result,
			})
		)
			return { status: "continuing" };
		if (state.phase !== "ready" || !exactInput(input, {}))
			return blocked(
				"PI_WORKFLOW_PRODUCT_REVIEW_MCP_PROTOCOL_INVALID",
				"Product review publication is incomplete or does not match the approved issue, result, and digest.",
			);
		const publication = state.context.publication;
		clear();
		return publication;
	}

	function nextCallInstruction(): string | undefined {
		const expected = expectedModelCall();
		if (expected)
			return `Product review protocol: call ${expected.toolName} exactly once now with ${JSON.stringify(expected.input)}. This is the only permitted next action; do not add fields or call tools in parallel.`;
		if (state.phase === "prepared") {
			const recommendation =
				state.context.choices.Aceptado.payload.recommendation;
			return `Agent recommendation: ${recommendation}. The shared decision descriptor is the only authorization surface. After it records a choice, call ${WORKFLOW_TOOL} with exactly {"action":"select_result","result":"Aceptado"}, {"action":"select_result","result":"Cambios requeridos"}, or {"action":"cancel_decision"} to match that choice. Never infer approval from prose. Do not display or request hashes or workflow metadata.`;
		}
		return undefined;
	}

	return {
		allowedTools,
		start,
		setMcpAvailable,
		clear,
		hasActiveTurn: () => state.phase !== "idle",
		hasPendingOwnerSelection: () => state.phase === "prepared",
		expectedModelCall,
		nextCallInstruction,
		handleToolCall,
		handleToolResult,
		complete,
	};
}
