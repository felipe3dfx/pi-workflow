import { randomUUID } from "node:crypto";

import type { DeliveryParentSnapshotStore } from "./delivery-parent-snapshot-store.ts";
import type {
	DefineProductPublicationIdentity,
	DefineProductPublicationRecoveryStore,
} from "./define-product-publication-recovery.ts";
import type { ApprovedProductSpecRead } from "./engram-approved-spec-reader.ts";
import type { LinearDeliveryParent } from "./linear-delivery-parent-gateway.ts";
import { validateProductSpecApproval } from "./product-spec.ts";
import {
	createSingleUserAuthoritySession,
	type SingleUserAuthoritySession,
} from "./single-user-authority.ts";
import {
	canonicalJson,
	digestCanonicalValue,
	type AuthenticatedAuthority,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";

export namespace DefineProductMcpPublication {
	export interface Blocker {
		readonly status: "blocked";
		readonly blocker: { readonly code: string; readonly message: string };
	}

	export interface Continuing {
		readonly status: "continuing";
	}

	export interface Published {
		readonly status: "spec-published";
		readonly parent: LinearDeliveryParent;
		readonly parentRef: VerifiedArtifactRef;
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

export interface DefineProductMcpPublicationDependencies {
	readonly approvedSpecReader: {
		read(definitionId: string): Promise<ApprovedProductSpecRead>;
	};
	/** Explicit compatibility policy; omitted by the default single-user harness. */
	readonly owner?: AuthenticatedAuthority;
	readonly authenticatedAuthorityPolicy?: {
		current(): Promise<AuthenticatedAuthority | undefined>;
	};
	readonly authoritySession?: SingleUserAuthoritySession;
	readonly recovery: DefineProductPublicationRecoveryStore;
	readonly parentSnapshots: DeliveryParentSnapshotStore;
	readonly toolIdentityReservationCapacity?: number;
}

export interface DefineProductMcpPublication {
	readonly allowedTools: readonly [
		"linear_get_user",
		"linear_list_teams",
		"linear_list_issue_statuses",
		"linear_list_issues",
		"linear_save_issue",
		"linear_get_issue",
		"workflow_define_product",
	];
	setMcpAvailable(available: boolean): void;
	clear(): void;
	hasActiveTurn(): boolean;
	begin(
		definitionId: string,
		toolCallId: string,
		input: unknown,
	): Promise<
		| DefineProductMcpPublication.Continuing
		| DefineProductMcpPublication.Blocker
	>;
	expectedModelCall(): DefineProductMcpPublication.ExpectedCall | undefined;
	nextCallInstruction(): string | undefined;
	handleToolCall(
		event: DefineProductMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined>;
	handleToolResult(
		event: DefineProductMcpPublication.ToolResultEvent,
	): Promise<boolean>;
	complete(
		input: unknown,
	): Promise<
		| DefineProductMcpPublication.Published
		| DefineProductMcpPublication.Blocker
	>;
}

const CURRENT_USER_TOOL = "linear_get_user";
const LIST_TEAMS_TOOL = "linear_list_teams";
const LIST_STATUSES_TOOL = "linear_list_issue_statuses";
const LIST_ISSUES_TOOL = "linear_list_issues";
const SAVE_ISSUE_TOOL = "linear_save_issue";
const GET_ISSUE_TOOL = "linear_get_issue";
const WORKFLOW_TOOL = "workflow_define_product";
const TITLE_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_DELIVERY_PARENT_TITLE";
const BODY_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_DELIVERY_PARENT_DESCRIPTION";
const MAX_RESERVED_TOOL_IDENTITIES = 16_384;
const ISSUE_FIELDS = [
	"id",
	"title",
	"description",
	"status",
	"statusType",
	"assigneeId",
	"teamId",
	"cycleId",
] as const;
const allowedTools = [
	CURRENT_USER_TOOL,
	LIST_TEAMS_TOOL,
	LIST_STATUSES_TOOL,
	LIST_ISSUES_TOOL,
	SAVE_ISSUE_TOOL,
	GET_ISSUE_TOOL,
	WORKFLOW_TOOL,
] as const;
const MCP_TOOLS: ReadonlySet<string> = new Set(allowedTools);

interface LinearActor {
	readonly id: string;
	readonly name: string;
	readonly isActive: boolean;
	readonly isGuest: boolean;
}

interface LinearTeam {
	readonly id: string;
	readonly name: string;
}

interface LinearStatus {
	readonly id: string;
	readonly name: "Backlog";
	readonly type: "backlog";
}

interface LinearIssue {
	readonly id: string;
	readonly identifier?: string;
	readonly teamId?: string;
	readonly title: string;
	readonly description: string;
	readonly statusId?: string;
	readonly statusName: string;
	readonly statusType: string;
	readonly assigneeId: null;
	readonly cycleId: null;
}

interface PublicationContext {
	readonly definitionId: string;
	readonly approved: ApprovedProductSpecRead;
	readonly identity: DefineProductPublicationIdentity;
	readonly compatibilityAuthority?: AuthenticatedAuthority;
	readonly recovery?: {
		readonly publicationDigest: string;
		readonly stage: "uncertain" | "created" | "verified";
		readonly issueId?: string;
	};
	readonly actor?: LinearActor;
	readonly team?: LinearTeam;
	readonly backlog?: LinearStatus;
}

interface TeamRead {
	readonly teams: readonly LinearTeam[];
	readonly cursor?: string;
	readonly seenCursors: ReadonlySet<string>;
}

interface IssueRead {
	readonly exact: readonly LinearIssue[];
	readonly conflicts: number;
	readonly cursor?: string;
	readonly seenCursors: ReadonlySet<string>;
}

interface ReadyContext extends PublicationContext {
	readonly actor: LinearActor;
	readonly team: LinearTeam;
	readonly backlog: LinearStatus;
	readonly issue: LinearIssue;
	readonly publication: DefineProductMcpPublication.Published;
}

type State =
	| { readonly phase: "idle" }
	| {
			readonly phase: "start-result";
			readonly context: PublicationContext;
			readonly toolCallId: string;
	  }
	| { readonly phase: "current-user"; readonly context: PublicationContext }
	| {
			readonly phase: "current-user-result";
			readonly context: PublicationContext;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "teams";
			readonly context: PublicationContext & { readonly actor: LinearActor };
			readonly read: TeamRead;
	  }
	| {
			readonly phase: "teams-result";
			readonly context: PublicationContext & { readonly actor: LinearActor };
			readonly read: TeamRead;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "statuses";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
			};
	  }
	| {
			readonly phase: "statuses-result";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
			};
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "candidates-before" | "candidates-final";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
			readonly read: IssueRead;
			readonly expectedIssue?: LinearIssue;
	  }
	| {
			readonly phase: "candidates-before-result" | "candidates-final-result";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
			readonly read: IssueRead;
			readonly expectedIssue?: LinearIssue;
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "save";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
	  }
	| {
			readonly phase: "save-result";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
			readonly toolCallId: string;
	  }
	| {
			readonly phase: "issue-readback";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
			readonly issueId: string;
	  }
	| {
			readonly phase: "issue-readback-result";
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
			readonly issueId: string;
			readonly toolCallId: string;
	  }
	| { readonly phase: "ready"; readonly context: ReadyContext }
	| {
			readonly phase: "blocked";
			readonly blocker: DefineProductMcpPublication.Blocker["blocker"];
	  };

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function exactInput(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	return (
		record(value) &&
		Object.keys(value).length === Object.keys(expected).length &&
		Object.entries(expected).every(([key, expectedValue]) => {
			const actual = value[key];
			return Array.isArray(expectedValue)
				? canonicalJson(actual) === canonicalJson(expectedValue)
				: actual === expectedValue;
		})
	);
}

function blocked(
	code: string,
	message: string,
): DefineProductMcpPublication.Blocker {
	return { status: "blocked", blocker: { code, message } };
}

function toolPayload(event: DefineProductMcpPublication.ToolResultEvent): unknown {
	if (!Array.isArray(event.content) || event.content.length !== 1) return undefined;
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

function actorEvidence(value: unknown): value is LinearActor {
	return (
		record(value) &&
		nonEmpty(value.id) &&
		nonEmpty(value.name) &&
		typeof value.isActive === "boolean" &&
		typeof value.isGuest === "boolean"
	);
}

function pageCursor(value: Record<string, unknown>): string | undefined | null {
	if (value.hasNextPage === false) return undefined;
	if (value.hasNextPage === true && nonEmpty(value.cursor)) return value.cursor;
	return null;
}

function teamPage(value: unknown):
	| { readonly teams: readonly LinearTeam[]; readonly nextCursor?: string }
	| undefined {
	if (!record(value) || !Array.isArray(value.teams)) return undefined;
	const cursor = pageCursor(value);
	if (cursor === null) return undefined;
	const teams: LinearTeam[] = [];
	for (const team of value.teams) {
		if (!record(team) || !nonEmpty(team.id) || !nonEmpty(team.name)) return undefined;
		teams.push({ id: team.id, name: team.name });
	}
	return { teams, ...(cursor ? { nextCursor: cursor } : {}) };
}

function backlogStatus(value: unknown): LinearStatus | undefined {
	const statuses = Array.isArray(value)
		? value
		: record(value) && Array.isArray(value.statuses)
			? value.statuses
			: undefined;
	if (!statuses) return undefined;
	const matches = statuses.flatMap((status) =>
		record(status) &&
		nonEmpty(status.id) &&
		status.name === "Backlog" &&
		status.type === "backlog"
			? [{ id: status.id, name: "Backlog" as const, type: "backlog" as const }]
			: [],
	);
	return matches.length === 1 ? matches[0] : undefined;
}

function nullableIdentity(
	value: Record<string, unknown>,
	idKey: string,
	objectKey: string,
): null | undefined {
	const id = value[idKey];
	const object = value[objectKey];
	return (id === null || id === undefined) &&
		(object === null || object === undefined)
		? null
		: undefined;
}

function issueEvidence(
	value: unknown,
	requireTeam = true,
): LinearIssue | undefined {
	if (
		!record(value) ||
		!nonEmpty(value.id) ||
		(value.identifier !== undefined && !nonEmpty(value.identifier)) ||
		!nonEmpty(value.title) ||
		typeof value.description !== "string"
	)
		return undefined;
	const teamId = nonEmpty(value.teamId)
		? value.teamId
		: record(value.team) && nonEmpty(value.team.id)
			? value.team.id
			: undefined;
	const statusId = nonEmpty(value.statusId)
		? value.statusId
		: record(value.status) && nonEmpty(value.status.id)
			? value.status.id
			: undefined;
	const statusName = nonEmpty(value.status)
		? value.status
		: record(value.status) && nonEmpty(value.status.name)
			? value.status.name
			: undefined;
	const statusType = nonEmpty(value.statusType)
		? value.statusType
		: record(value.status) && nonEmpty(value.status.type)
			? value.status.type
			: undefined;
	if ((requireTeam && !teamId) || !statusName || !statusType) return undefined;
	if (
		nullableIdentity(value, "assigneeId", "assignee") !== null ||
		nullableIdentity(value, "cycleId", "cycle") !== null
	)
		return undefined;
	return {
		id: value.id,
		...(nonEmpty(value.identifier) ? { identifier: value.identifier } : {}),
		...(teamId ? { teamId } : {}),
		title: value.title,
		description: value.description,
		...(statusId ? { statusId } : {}),
		statusName,
		statusType,
		assigneeId: null,
		cycleId: null,
	};
}

function issuePage(value: unknown):
	| { readonly issues: readonly unknown[]; readonly nextCursor?: string }
	| undefined {
	if (!record(value) || !Array.isArray(value.issues)) return undefined;
	const cursor = pageCursor(value);
	if (cursor === null) return undefined;
	return {
		issues: value.issues,
		...(cursor ? { nextCursor: cursor } : {}),
	};
}

function linearOrderedListPadding(markdown: string): string {
	const lines = markdown.split("\n");
	for (let index = 0; index < lines.length; ) {
		if (!/^\d+\. /.test(lines[index])) {
			index += 1;
			continue;
		}
		const start = index;
		while (index < lines.length && /^\d+\. /.test(lines[index])) index += 1;
		const markers = lines.slice(start, index).map((line) => Number.parseInt(line, 10));
		if (markers.some((marker) => marker >= 10)) {
			for (let item = start; item < index; item += 1)
				lines[item] = lines[item].replace(/^([1-9])\. /, " $1. ");
		}
	}
	return lines.join("\n");
}

function exactLinearMarkdown(expected: string, actual: string): boolean {
	const withoutLegacyNewline = expected.endsWith("\n")
		? expected.slice(0, -1)
		: expected;
	return (
		actual === expected ||
		actual === withoutLegacyNewline ||
		actual === linearOrderedListPadding(expected) ||
		actual === linearOrderedListPadding(withoutLegacyNewline)
	);
}

function exactIssue(
	issue: LinearIssue,
	context: PublicationContext & { readonly team: LinearTeam; readonly backlog: LinearStatus },
): boolean {
	return (
		(issue.teamId === undefined || issue.teamId === context.team.id) &&
		issue.title === context.approved.spec.payload.target.title &&
		exactLinearMarkdown(
			context.approved.spec.payload.body,
			issue.description,
		) &&
		(issue.statusId === undefined || issue.statusId === context.backlog.id) &&
		issue.statusName === "Backlog" &&
		issue.statusType === "backlog" &&
		issue.assigneeId === null &&
		issue.cycleId === null
	);
}

function publicationIdentity(approved: ApprovedProductSpecRead): DefineProductPublicationIdentity {
	return {
		definitionId: approved.spec.payload.definitionId,
		publicationDigest: digestCanonicalValue({
			schema: "define-product-linear-mcp-publication",
			definitionId: approved.spec.payload.definitionId,
			specDigest: approved.spec.digest,
			sourceRevision: approved.sourceRevision,
		}),
	};
}

function validCompatibilityAuthority(
	value: unknown,
): value is AuthenticatedAuthority & { readonly role: "Owner" } {
	return (
		value !== undefined &&
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		nonEmpty((value as Record<string, unknown>).actorId) &&
		(value as Record<string, unknown>).role === "Owner" &&
		nonEmpty((value as Record<string, unknown>).authorityRevision)
	);
}

function approvedArtifact(
	value: ApprovedProductSpecRead,
	definitionId: string,
	owner?: AuthenticatedAuthority,
): boolean {
	const historicalActor = value.approval.payload.actor;
	return (
		value.spec.payload.definitionId === definitionId &&
		value.spec.payload.target.kind === "linear-parent-description" &&
		nonEmpty(value.spec.payload.target.teamId) &&
		nonEmpty(value.spec.payload.target.title) &&
		typeof value.spec.payload.body === "string" &&
		value.spec.payload.body.length > 0 &&
		validateProductSpecApproval({
			spec: value.spec,
			approval: value.approval,
			actor: historicalActor,
			target: value.spec.payload.target,
			revision: value.spec.payload.revision,
		}).ok &&
		(owner === undefined || canonicalJson(owner) === canonicalJson(historicalActor))
	);
}

function resultFailure(
	event: DefineProductMcpPublication.ToolResultEvent,
): DefineProductMcpPublication.Blocker["blocker"] {
	const payload = toolPayload(event);
	const code = record(payload) ? payload.code : undefined;
	if (code === "UNAUTHENTICATED")
		return {
			code: "PI_WORKFLOW_DEFINE_PRODUCT_MCP_UNAUTHENTICATED",
			message: "Linear MCP is present but not authenticated.",
		};
	if (code === "PERMISSION_DENIED")
		return {
			code: "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PERMISSION_DENIED",
			message: "Linear MCP denied the planned Delivery-parent operation.",
		};
	if (code === "RATE_LIMITED")
		return {
			code: "PI_WORKFLOW_DEFINE_PRODUCT_MCP_RATE_LIMITED",
			message:
				"Linear MCP rate-limited Delivery-parent publication; retry lookup later.",
		};
	if (code === "TRANSPORT_ERROR")
		return {
			code: "PI_WORKFLOW_DEFINE_PRODUCT_MCP_TRANSPORT_FAILED",
			message:
				"Linear MCP transport failed before a verifiable result was returned.",
		};
	return {
		code: "PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
		message: "Linear MCP returned a failed or incompatible result.",
	};
}

function emptyTeamRead(): TeamRead {
	return { teams: [], seenCursors: new Set() };
}

function emptyIssueRead(): IssueRead {
	return { exact: [], conflicts: 0, seenCursors: new Set() };
}

export function createDefineProductMcpPublication(
	options: DefineProductMcpPublicationDependencies,
): DefineProductMcpPublication {
	let state: State = { phase: "idle" };
	const authoritySession =
		options.authoritySession ??
		createSingleUserAuthoritySession({
			...(options.owner ? { authority: options.owner } : {}),
		});
	let mcpAvailable: boolean | undefined;
	let generation = 0;
	let beginning = false;
	let recoveryOwnerId = randomUUID();
	const capacity = Math.min(
		options.toolIdentityReservationCapacity ?? MAX_RESERVED_TOOL_IDENTITIES,
		MAX_RESERVED_TOOL_IDENTITIES,
	);
	const reservations = new Map<string, number>();
	const processedResults = new Map<string, string>();
	let callQueue: Promise<void> = Promise.resolve();
	let resultQueue: Promise<void> = Promise.resolve();

	const identityFor = (toolName: string, toolCallId: string) =>
		`${toolName}\u0000${toolCallId}`;
	const isCurrent = (queuedGeneration: number, active: State) =>
		generation === queuedGeneration && state === active;
	const staleBlock = () => ({
		block: true as const,
		reason: "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
	});

	function fail(code: string, message: string): void {
		if (state.phase !== "blocked")
			state = { phase: "blocked", blocker: { code, message } };
	}

	function clear(): void {
		generation += 1;
		beginning = false;
		recoveryOwnerId = randomUUID();
		state = { phase: "idle" };
	}

	function setMcpAvailable(available: boolean): void {
		mcpAvailable = available;
		if (!available && state.phase !== "idle" && state.phase !== "blocked")
			fail(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for Delivery-parent publication.",
			);
	}

	function candidateCall(
		context: PublicationContext & { readonly team: LinearTeam },
		cursor?: string,
	): DefineProductMcpPublication.ExpectedCall {
		return {
			toolName: LIST_ISSUES_TOOL,
			input: {
				team: context.team.id,
				query: context.approved.spec.payload.target.title,
				limit: 250,
				orderBy: "updatedAt",
				includeArchived: false,
				fields: ISSUE_FIELDS,
				...(cursor ? { cursor } : {}),
			},
		};
	}

	function expectedModelCall():
		| DefineProductMcpPublication.ExpectedCall
		| undefined {
		if (
			state.phase === "ready" ||
			state.phase === "blocked"
		)
			return { toolName: WORKFLOW_TOOL, input: { action: "publish_spec" } };
		if (state.phase === "current-user")
			return { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
		if (state.phase === "teams")
			return {
				toolName: LIST_TEAMS_TOOL,
				input: {
					limit: 250,
					orderBy: "updatedAt",
					includeArchived: false,
					...(state.read.cursor ? { cursor: state.read.cursor } : {}),
				},
			};
		if (state.phase === "statuses")
			return {
				toolName: LIST_STATUSES_TOOL,
				input: { team: state.context.team.id },
			};
		if (
			state.phase === "candidates-before" ||
			state.phase === "candidates-final"
		)
			return candidateCall(state.context, state.read.cursor);
		if (state.phase === "save")
			return {
				toolName: SAVE_ISSUE_TOOL,
				input: {
					team: state.context.team.id,
					title: TITLE_PLACEHOLDER,
					description: BODY_PLACEHOLDER,
					state: state.context.backlog.id,
				},
			};
		if (state.phase === "issue-readback")
			return {
				toolName: GET_ISSUE_TOOL,
				input: { id: state.issueId, includeRelations: true },
			};
		return undefined;
	}

	async function begin(
		definitionId: string,
		toolCallId: string,
		input: unknown,
	): Promise<
		| DefineProductMcpPublication.Continuing
		| DefineProductMcpPublication.Blocker
	> {
		if (
			state.phase !== "idle" ||
			beginning ||
			!nonEmpty(definitionId) ||
			!nonEmpty(toolCallId) ||
			!exactInput(input, { action: "publish_spec" })
		)
			return blocked(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
				"Delivery-parent publication requires the exact active action-only call.",
			);
		if (mcpAvailable === false)
			return blocked(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for Delivery-parent publication.",
			);
		beginning = true;
		generation += 1;
		if (!options.authoritySession) authoritySession.clear();
		const beginGeneration = generation;
		recoveryOwnerId = randomUUID();
		try {
			const injectedAuthority =
				await options.authenticatedAuthorityPolicy?.current();
			if (
				options.authenticatedAuthorityPolicy &&
				!validCompatibilityAuthority(injectedAuthority)
			)
				return blocked(
					"PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
					"The injected authenticated authority policy is unavailable or invalid.",
				);
			if (
				options.owner &&
				injectedAuthority &&
				canonicalJson(options.owner) !== canonicalJson(injectedAuthority)
			)
				return blocked(
					"PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
					"Injected authenticated authority policies conflict.",
				);
			const compatibilityAuthority = options.owner ?? injectedAuthority;
			const authenticated = authoritySession.user();
			if (
				compatibilityAuthority &&
				authenticated &&
				authenticated.id !== compatibilityAuthority.actorId
			)
				return blocked(
					"PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
					"The authenticated Linear user does not satisfy the injected compatibility policy.",
				);
			const approved = await options.approvedSpecReader.read(definitionId);
			if (generation !== beginGeneration || state.phase !== "idle")
				return blocked(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
					"Delivery-parent publication start was replaced before preparation completed.",
				);
			if (!approvedArtifact(approved, definitionId, compatibilityAuthority))
				return blocked(
					"PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT",
					"The approved Spec or Owner authority is invalid for publication.",
				);
			const identity = publicationIdentity(approved);
			const recovery = await options.recovery.read(definitionId);
			if (generation !== beginGeneration || state.phase !== "idle")
				return blocked(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
					"Delivery-parent publication start was replaced during recovery read.",
				);
			if (
				recovery &&
				recovery.publicationDigest !== identity.publicationDigest
			)
				return blocked(
					"PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT",
					"Durable publication recovery does not match the approved Spec.",
				);
			const toolIdentity = identityFor(WORKFLOW_TOOL, toolCallId);
			if (reservations.has(toolIdentity) || reservations.size >= capacity)
				return blocked(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
					"Delivery-parent publication exhausted or reused a tool identity.",
				);
			reservations.set(toolIdentity, generation);
			state = {
				phase: "start-result",
				context: {
					definitionId,
					approved,
					identity,
					...(compatibilityAuthority
						? {
								compatibilityAuthority: structuredClone(
									compatibilityAuthority,
								),
							}
						: {}),
					...(recovery ? { recovery } : {}),
				},
				toolCallId,
			};
			return { status: "continuing" };
		} catch (error) {
			return blocked(
				"PI_WORKFLOW_RECOVERY_FAILED",
				error instanceof Error
					? error.message
					: "Approved Spec publication recovery failed.",
			);
		} finally {
			if (generation === beginGeneration) beginning = false;
		}
	}

	async function revalidateArtifact(context: PublicationContext): Promise<boolean> {
		const current = await options.approvedSpecReader.read(context.definitionId);
		return (
			approvedArtifact(
				current,
				context.definitionId,
				context.compatibilityAuthority,
			) &&
			canonicalJson(current) === canonicalJson(context.approved)
		);
	}

	async function handleToolCallSerial(
		event: DefineProductMcpPublication.ToolCallEvent,
		queuedGeneration: number,
		ownerId: string,
		active: State,
	): Promise<{ readonly block: true; readonly reason: string } | undefined> {
		if (!isCurrent(queuedGeneration, active) || active.phase === "idle")
			return staleBlock();
		if (
			(active.phase === "ready" || active.phase === "blocked") &&
			event.toolName === WORKFLOW_TOOL &&
			exactInput(event.input, { action: "publish_spec" })
		)
			return undefined;
		const expected = expectedModelCall();
		if (
			!expected ||
			event.toolName !== expected.toolName ||
			!nonEmpty(event.toolCallId) ||
			!exactInput(event.input, expected.input)
		) {
			const code = "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID";
			fail(
				code,
				"Delivery-parent MCP tool, input, order, or stage did not match the active publication plan.",
			);
			return { block: true, reason: code };
		}
		const toolIdentity = identityFor(event.toolName, event.toolCallId);
		if (reservations.has(toolIdentity)) return staleBlock();
		if (reservations.size >= capacity) {
			const code = "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID";
			fail(code, "Delivery-parent MCP tool identity capacity was exhausted.");
			return { block: true, reason: code };
		}
		if (active.phase === "save") {
			try {
				if (!(await revalidateArtifact(active.context))) {
					fail(
						"PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT",
						"The exact approved Spec changed immediately before mutation.",
					);
					return { block: true, reason: "PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT" };
				}
				if (!isCurrent(queuedGeneration, active)) return staleBlock();
				await options.recovery.claim(active.context.identity, ownerId);
				if (!isCurrent(queuedGeneration, active)) {
					try {
						await options.recovery.release(active.context.identity, ownerId);
					} catch {}
					return staleBlock();
				}
			} catch (error) {
				if (!isCurrent(queuedGeneration, active)) return staleBlock();
				const code = "PI_WORKFLOW_DEFINE_PRODUCT_RECOVERY_PERSISTENCE_FAILED";
				fail(
					code,
					error instanceof Error
						? error.message
						: "Delivery-parent uncertainty could not be persisted.",
				);
				return { block: true, reason: code };
			}
		}
		const toolCallId = event.toolCallId;
		switch (active.phase) {
			case "current-user":
				state = { phase: "current-user-result", context: active.context, toolCallId };
				break;
			case "teams":
				state = { ...active, phase: "teams-result", toolCallId };
				break;
			case "statuses":
				state = { ...active, phase: "statuses-result", toolCallId };
				break;
			case "candidates-before":
				state = { ...active, phase: "candidates-before-result", toolCallId };
				break;
			case "save":
				state = { phase: "save-result", context: active.context, toolCallId };
				break;
			case "issue-readback":
				state = { ...active, phase: "issue-readback-result", toolCallId };
				break;
			case "candidates-final":
				state = { ...active, phase: "candidates-final-result", toolCallId };
				break;
			default: {
				const code = "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID";
				fail(code, "Delivery-parent MCP call reached an invalid stage.");
				return { block: true, reason: code };
			}
		}
		reservations.set(toolIdentity, queuedGeneration);
		if (active.phase === "save" && record(event.input)) {
			event.input.title = active.context.approved.spec.payload.target.title;
			event.input.description = active.context.approved.spec.payload.body;
		}
		return undefined;
	}

	async function handleToolCall(
		event: DefineProductMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined> {
		if (state.phase === "idle") return undefined;
		const queuedGeneration = generation;
		const ownerId = recoveryOwnerId;
		const active = state;
		const preceding = callQueue;
		let releaseQueue: () => void = () => {};
		callQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			return await handleToolCallSerial(
				event,
				queuedGeneration,
				ownerId,
				active,
			);
		} finally {
			releaseQueue();
		}
	}

	function validOwnerActor(
		payload: unknown,
		compatibilityAuthority?: AuthenticatedAuthority,
	): payload is LinearActor {
		return (
			actorEvidence(payload) &&
			payload.isActive &&
			!payload.isGuest &&
			(compatibilityAuthority === undefined ||
				payload.id === compatibilityAuthority.actorId)
		);
	}

	function advanceIssueRead(
		active: {
			readonly context: PublicationContext & {
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
			readonly read: IssueRead;
			readonly expectedIssue?: LinearIssue;
		},
		payload: unknown,
	):
		| {
				readonly complete: boolean;
				readonly read: IssueRead;
		  }
		| undefined {
		const page = issuePage(payload);
		if (!page) return undefined;
		let conflicts = active.read.conflicts;
		const exact = [...active.read.exact];
		for (const candidate of page.issues) {
			if (!record(candidate) || candidate.title !== active.context.approved.spec.payload.target.title)
				continue;
			if (
				active.expectedIssue &&
				candidate.id === active.expectedIssue.id
			) {
				exact.push(active.expectedIssue);
				continue;
			}
			const issue = issueEvidence(candidate);
			if (!issue || issue.teamId === undefined || !exactIssue(issue, active.context))
				conflicts += 1;
			else exact.push(issue);
		}
		if (!page.nextCursor)
			return {
				complete: true,
				read: { exact, conflicts, seenCursors: active.read.seenCursors },
			};
		if (active.read.seenCursors.has(page.nextCursor)) return undefined;
		return {
			complete: false,
			read: {
				exact,
				conflicts,
				cursor: page.nextCursor,
				seenCursors: new Set([...active.read.seenCursors, page.nextCursor]),
			},
		};
	}

	async function finalize(
		active: {
			readonly context: PublicationContext & {
				readonly actor: LinearActor;
				readonly team: LinearTeam;
				readonly backlog: LinearStatus;
			};
		},
		issue: LinearIssue,
	): Promise<void> {
		await options.recovery.finalizeVerified(active.context.identity, issue.id);
		const parent: LinearDeliveryParent = {
			id: issue.id,
			teamId: active.context.team.id,
			title: active.context.approved.spec.payload.target.title,
			description: active.context.approved.spec.payload.body,
			descriptionRevision: active.context.approved.spec.payload.revision,
			state: "Backlog",
			cycleId: null,
			assigneeId: null,
			publicationKey: active.context.identity.publicationDigest,
		};
		const parentRef = await options.parentSnapshots.persist({
			definitionId: active.context.definitionId,
			parent,
			specDigest: active.context.approved.spec.digest,
		});
		state = {
			phase: "ready",
			context: {
				...active.context,
				issue,
				publication: { status: "spec-published", parent, parentRef },
			},
		};
	}

	async function handleToolResultSerial(
		event: DefineProductMcpPublication.ToolResultEvent,
		queuedGeneration: number,
		ownerId: string,
		active: State,
	): Promise<boolean> {
		if (!isCurrent(queuedGeneration, active)) return false;
		if (!("toolCallId" in active)) {
			fail(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
				"Linear MCP returned a result without an active issued stage.",
			);
			return true;
		}
		const expectedTool =
			active.phase === "start-result"
				? WORKFLOW_TOOL
				: active.phase === "current-user-result"
					? CURRENT_USER_TOOL
					: active.phase === "teams-result"
						? LIST_TEAMS_TOOL
						: active.phase === "statuses-result"
							? LIST_STATUSES_TOOL
							: active.phase === "candidates-before-result" ||
									active.phase === "candidates-final-result"
								? LIST_ISSUES_TOOL
								: active.phase === "save-result"
									? SAVE_ISSUE_TOOL
									: GET_ISSUE_TOOL;
		if (event.toolName !== expectedTool || event.toolCallId !== active.toolCallId) {
			fail(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
				"Linear MCP returned an out-of-order or mismatched result.",
			);
			return true;
		}
		if (event.isError === true) {
			const failure = resultFailure(event);
			if (
				active.phase === "save-result" &&
				failure.code === "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PERMISSION_DENIED"
			) {
				try {
					await options.recovery.release(active.context.identity, ownerId);
					if (!isCurrent(queuedGeneration, active)) return false;
				} catch (error) {
					fail(
						"PI_WORKFLOW_DEFINE_PRODUCT_RECOVERY_PERSISTENCE_FAILED",
						error instanceof Error
							? error.message
							: "Delivery-parent recovery release failed.",
					);
					return true;
				}
			}
			fail(failure.code, failure.message);
			return true;
		}
		const payload = toolPayload(event);
		if (active.phase === "start-result") {
			if (!exactInput(payload, { status: "continuing" }))
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
					"The publication continuation result was incompatible.",
				);
			else {
				const authenticated = authoritySession.user();
				state = authenticated
					? {
							phase: "teams",
							context: { ...active.context, actor: authenticated },
							read: emptyTeamRead(),
						}
					: { phase: "current-user", context: active.context };
			}
			return true;
		}
		if (active.phase === "current-user-result") {
			if (
				!validOwnerActor(payload, active.context.compatibilityAuthority) ||
				!authoritySession.authenticate(payload).ok
			)
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
					"An active non-guest authenticated Linear user is required.",
				);
			else
				state = {
					phase: "teams",
					context: { ...active.context, actor: structuredClone(payload) },
					read: emptyTeamRead(),
				};
			return true;
		}
		if (active.phase === "teams-result") {
			const page = teamPage(payload);
			if (!page) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_MALFORMED_RESPONSE",
					"Linear MCP returned a malformed team page.",
				);
				return true;
			}
			const teams = [...active.read.teams, ...page.teams];
			if (page.nextCursor) {
				if (active.read.seenCursors.has(page.nextCursor)) {
					fail(
						"PI_WORKFLOW_DEFINE_PRODUCT_MCP_MALFORMED_RESPONSE",
						"Linear MCP repeated a team cursor.",
					);
					return true;
				}
				state = {
					phase: "teams",
					context: active.context,
					read: {
						teams,
						cursor: page.nextCursor,
						seenCursors: new Set([...active.read.seenCursors, page.nextCursor]),
					},
				};
				return true;
			}
			const matches = teams.filter(
				(team) => team.id === active.context.approved.spec.payload.target.teamId,
			);
			if (matches.length !== 1) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_TEAM_AMBIGUOUS",
					"The approved immutable Linear team ID did not resolve to exactly one active team.",
				);
				return true;
			}
			state = {
				phase: "statuses",
				context: { ...active.context, team: matches[0] },
			};
			return true;
		}
		if (active.phase === "statuses-result") {
			const backlog = backlogStatus(payload);
			if (!backlog) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_BACKLOG_AMBIGUOUS",
					"Linear MCP did not resolve exactly one Backlog state for the team.",
				);
				return true;
			}
			const context = { ...active.context, backlog };
			state =
				active.context.recovery?.issueId
					? {
							phase: "issue-readback",
							context,
							issueId: active.context.recovery.issueId,
						}
					: {
							phase: "candidates-before",
							context,
							read: emptyIssueRead(),
						};
			return true;
		}
		if (
			active.phase === "candidates-before-result" ||
			active.phase === "candidates-final-result"
		) {
			const advanced = advanceIssueRead(active, payload);
			if (!advanced) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_MALFORMED_RESPONSE",
					"Linear MCP returned a malformed or cyclic issue page.",
				);
				return true;
			}
			if (!advanced.complete) {
				state = {
					...active,
					phase:
						active.phase === "candidates-before-result"
							? "candidates-before"
							: "candidates-final",
					read: advanced.read,
				};
				return true;
			}
			if (advanced.read.conflicts > 0 || advanced.read.exact.length > 1) {
				fail(
					"PI_WORKFLOW_PUBLICATION_DUPLICATE",
					"Delivery-parent duplicate candidates are conflicting or ambiguous.",
				);
				return true;
			}
			if (active.phase === "candidates-final-result") {
				const expectedIssue = active.expectedIssue;
				const [issue] = advanced.read.exact;
				if (!expectedIssue || (issue && issue.id !== expectedIssue.id)) {
					fail(
						"PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
						"The final lookup found a different exact Delivery parent.",
					);
					return true;
				}
				try {
					await finalize(active, expectedIssue);
				} catch (error) {
					fail(
						"PI_WORKFLOW_DEFINE_PRODUCT_RECOVERY_PERSISTENCE_FAILED",
						error instanceof Error
							? error.message
							: "Verified Delivery-parent state could not be persisted.",
					);
				}
				return true;
			}
			const [issue] = advanced.read.exact;
			if (active.context.recovery) {
				if (!issue) {
					fail(
						active.context.recovery.stage === "verified"
							? "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH"
							: "PI_WORKFLOW_PUBLICATION_RECOVERY_PENDING",
						active.context.recovery.stage === "verified"
							? "The verified Delivery parent is no longer uniquely visible."
							: "A prior Delivery-parent creation is uncertain; lookup did not prove an exact candidate, so mutation will not be retried.",
					);
					return true;
				}
				if (
					active.context.recovery.issueId &&
					active.context.recovery.issueId !== issue.id
				) {
					fail(
						"PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
						"Durable publication recovery points to a different Delivery parent.",
					);
					return true;
				}
				state = {
					phase: "issue-readback",
					context: active.context,
					issueId: issue.id,
				};
				return true;
			}
			if (issue) {
				fail(
					"PI_WORKFLOW_PUBLICATION_DUPLICATE",
					"An exact Delivery-parent candidate already exists without durable publication recovery.",
				);
				return true;
			}
			state = { phase: "save", context: active.context };
			return true;
		}
		if (active.phase === "save-result") {
			if (!record(payload) || !nonEmpty(payload.id)) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_MALFORMED_RESPONSE",
					"Linear MCP returned a malformed issue creation identity.",
				);
				return true;
			}
			try {
				await options.recovery.recordCreated(
					active.context.identity,
					ownerId,
					payload.id,
				);
				if (!isCurrent(queuedGeneration, active)) return false;
			} catch (error) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_RECOVERY_PERSISTENCE_FAILED",
					error instanceof Error
						? error.message
						: "Created Delivery-parent identity could not be persisted.",
				);
				return true;
			}
			state = {
				phase: "issue-readback",
				context: active.context,
				issueId: payload.id,
			};
			return true;
		}
		if (active.phase === "issue-readback-result") {
			const issue = issueEvidence(payload, false);
			if (
				!issue ||
				issue.id !== active.issueId ||
				!exactIssue(issue, active.context)
			)
				fail(
					"PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
					"The Delivery parent exact read-back did not match the approved Spec.",
				);
			else
				state = {
					phase: "candidates-final",
					context: active.context,
					read: emptyIssueRead(),
					expectedIssue: issue,
				};
			return true;
		}
		return false;
	}

	async function handleToolResult(
		event: DefineProductMcpPublication.ToolResultEvent,
	): Promise<boolean> {
		if (state.phase === "idle" || !MCP_TOOLS.has(event.toolName)) return false;
		const queuedGeneration = generation;
		const ownerId = recoveryOwnerId;
		const active = state;
		const preceding = resultQueue;
		let releaseQueue: () => void = () => {};
		resultQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			if (!nonEmpty(event.toolCallId)) {
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
					"Linear MCP returned a result without a stable tool call identity.",
				);
				return true;
			}
			const toolIdentity = identityFor(event.toolName, event.toolCallId);
			if (reservations.get(toolIdentity) !== queuedGeneration) {
				if (isCurrent(queuedGeneration, active)) {
					fail(
						"PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
						"Linear MCP returned a result without a current issued identity.",
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
			const settled = processedResults.get(toolIdentity);
			if (settled !== undefined) {
				if (settled === fingerprint) return false;
				fail(
					"PI_WORKFLOW_DEFINE_PRODUCT_MCP_INCOMPATIBLE",
					"Linear MCP returned conflicting results for one tool identity.",
				);
				return true;
			}
			processedResults.set(toolIdentity, fingerprint);
			return await handleToolResultSerial(
				event,
				queuedGeneration,
				ownerId,
				active,
			);
		} finally {
			releaseQueue();
		}
	}

	async function complete(
		input: unknown,
	): Promise<
		| DefineProductMcpPublication.Published
		| DefineProductMcpPublication.Blocker
	> {
		if (!exactInput(input, { action: "publish_spec" }))
			return blocked(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
				"Delivery-parent completion requires only action=publish_spec.",
			);
		if (state.phase === "blocked") {
			const result = { status: "blocked" as const, blocker: state.blocker };
			clear();
			return result;
		}
		if (state.phase !== "ready")
			return blocked(
				"PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID",
				"Delivery-parent publication is not ready for completion.",
			);
		const result = state.context.publication;
		clear();
		return result;
	}

	function nextCallInstruction(): string | undefined {
		const expected = expectedModelCall();
		if (!expected) return undefined;
		return `Define-product publication protocol: call ${expected.toolName} exactly once now with ${JSON.stringify(expected.input)}. This is the only permitted next action; do not add fields, reuse an earlier call, or call tools in parallel.`;
	}

	return {
		allowedTools,
		setMcpAvailable,
		clear,
		hasActiveTurn: () => state.phase !== "idle",
		begin,
		expectedModelCall,
		nextCallInstruction,
		handleToolCall,
		handleToolResult,
		complete,
	};
}
