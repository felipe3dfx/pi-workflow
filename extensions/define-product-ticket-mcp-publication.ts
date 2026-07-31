import type { ApprovedTicketPublication } from "./approved-ticket-publication.ts";
import type { DeliveryTicketGraph } from "./delivery-ticket-graph.ts";
import {
	orderDeliveryTickets,
	renderDeliveryTicketBody,
} from "./delivery-ticket-publication.ts";
import type { ApprovedProductSpecRead } from "./engram-approved-spec-reader.ts";
import {
	createSingleUserAuthoritySession,
	type SingleUserAuthoritySession,
} from "./single-user-authority.ts";
import type { createTicketPublicationManifestStore } from "./ticket-publication-manifest.ts";
import {
	canonicalJson,
	type AuthenticatedAuthority,
} from "./workflow-contracts.ts";

export namespace DefineProductTicketMcpPublication {
	export interface Blocker {
		readonly status: "blocked";
		readonly blocker: { readonly code: string; readonly message: string };
	}

	export interface Continuing {
		readonly status: "continuing";
	}

	export interface Published {
		readonly status: "tickets-published";
		readonly definitionId: string;
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

export interface DefineProductTicketMcpPublicationDependencies {
	readonly approvedPublications: {
		read(definitionId: string): Promise<ApprovedTicketPublication | undefined>;
	};
	readonly approvedSpecReader: {
		read(definitionId: string): Promise<ApprovedProductSpecRead>;
	};
	readonly recoverGraph: (
		publication: ApprovedTicketPublication,
	) => Promise<DeliveryTicketGraph | undefined>;
	readonly manifest: ReturnType<typeof createTicketPublicationManifestStore>;
	/** Explicit compatibility policy; omitted by the default single-user harness. */
	readonly owner?: AuthenticatedAuthority;
	readonly authenticatedAuthorityPolicy?: {
		current(): Promise<AuthenticatedAuthority | undefined>;
	};
	readonly authoritySession?: SingleUserAuthoritySession;
	readonly toolIdentityReservationCapacity?: number;
}

export interface DefineProductTicketMcpPublication {
	readonly allowedTools: readonly [
		"linear_get_user",
		"linear_get_issue",
		"linear_list_issue_statuses",
		"linear_list_issues",
		"linear_save_issue",
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
		| DefineProductTicketMcpPublication.Continuing
		| DefineProductTicketMcpPublication.Blocker
	>;
	expectedModelCall():
		| DefineProductTicketMcpPublication.ExpectedCall
		| undefined;
	nextCallInstruction(): string | undefined;
	handleToolCall(
		event: DefineProductTicketMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined>;
	handleToolResult(
		event: DefineProductTicketMcpPublication.ToolResultEvent,
	): Promise<boolean>;
	complete(
		input: unknown,
	): Promise<
		| DefineProductTicketMcpPublication.Published
		| DefineProductTicketMcpPublication.Blocker
	>;
}

const CURRENT_USER_TOOL = "linear_get_user";
const GET_ISSUE_TOOL = "linear_get_issue";
const LIST_STATUSES_TOOL = "linear_list_issue_statuses";
const LIST_ISSUES_TOOL = "linear_list_issues";
const SAVE_ISSUE_TOOL = "linear_save_issue";
const WORKFLOW_TOOL = "workflow_define_product";
const TITLE_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_DELIVERY_TICKET_TITLE";
const BODY_PLACEHOLDER = "PI_WORKFLOW_CANONICAL_DELIVERY_TICKET_BODY";
const MAX_RESERVED_TOOL_IDENTITIES = 4096;
const CANCELLED_GENERATION = Symbol("cancelled-ticket-publication-generation");
const ISSUE_FIELDS = [
	"id",
	"title",
	"description",
	"estimate",
	"status",
	"statusType",
	"assigneeId",
	"cycleId",
	"labels",
	"projectId",
	"parentId",
	"teamId",
] as const;
const allowedTools = [
	CURRENT_USER_TOOL,
	GET_ISSUE_TOOL,
	LIST_STATUSES_TOOL,
	LIST_ISSUES_TOOL,
	SAVE_ISSUE_TOOL,
	WORKFLOW_TOOL,
] as const;
const MCP_TOOLS: ReadonlySet<string> = new Set(allowedTools);

type Ticket = DeliveryTicketGraph["payload"]["tickets"][number];
type Relation = {
	readonly blockedStableKey: string;
	readonly blockingStableKey: string;
};
type Actor = {
	readonly id: string;
	readonly name: string;
	readonly isActive: boolean;
	readonly isGuest: boolean;
};
type Mutation =
	| { readonly kind: "child"; readonly ticket: Ticket }
	| { readonly kind: "relation"; readonly relation: Relation };
type Phase =
	| "idle"
	| "waiting"
	| "actor"
	| "parent"
	| "statuses"
	| "child-find"
	| "mutation-parent"
	| "child-save"
	| "child-readback"
	| "relation-read"
	| "relation-save"
	| "verify-parent"
	| "verify-children"
	| "verify-child"
	| "ready"
	| "blocked";
type IssuedPhase = Exclude<Phase, "idle" | "waiting" | "ready" | "blocked"> | "start";

interface Discovery {
	readonly ids: readonly string[];
	readonly conflicts: number;
	readonly seenCursors: ReadonlySet<string>;
	readonly cursor?: string;
}

interface Context {
	readonly definitionId: string;
	readonly publication: ApprovedTicketPublication;
	readonly graph: DeliveryTicketGraph;
	readonly approved: ApprovedProductSpecRead;
	readonly compatibilityAuthority?: AuthenticatedAuthority;
	readonly ordered: readonly Ticket[];
	readonly relations: readonly Relation[];
	manifest: Awaited<ReturnType<ReturnType<typeof createTicketPublicationManifestStore>["prepare"]>>;
	actor?: Actor;
	triageId?: string;
	mutation?: Mutation;
	mutationLinearId?: string;
	discovery?: Discovery;
	verifyIndex: number;
}

interface IssuedCall {
	readonly phase: IssuedPhase;
	readonly toolName: string;
	readonly toolCallId: string;
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function validCompatibilityAuthority(
	value: unknown,
): value is AuthenticatedAuthority & { readonly role: "Owner" } {
	return (
		record(value) &&
		text(value.actorId) &&
		value.role === "Owner" &&
		text(value.authorityRevision)
	);
}

function exactInput(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	if (!record(value)) return false;
	const supplied = Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	);
	if (Object.keys(supplied).some((key) => !Object.hasOwn(expected, key))) return false;
	return Object.entries(expected).every(([key, expectedValue]) => {
		if (!Object.hasOwn(supplied, key)) {
			if (expectedValue === null) return true;
			if (Array.isArray(expectedValue) && expectedValue.length === 0) return true;
		}
		if (
			expectedValue === null &&
			(supplied[key] === "null" || supplied[key] === "")
		) return true;
		return (
			Object.hasOwn(supplied, key) &&
			canonicalJson(supplied[key]) === canonicalJson(expectedValue)
		);
	});
}

function normalizePiNullableInput(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): void {
	if (!record(value)) return;
	for (const [key, expectedValue] of Object.entries(expected)) {
		if (
			expectedValue === null &&
			(value[key] === "null" || value[key] === "")
		) value[key] = null;
	}
}

function inputMismatch(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): string {
	if (!record(value)) return "input was not an object";
	const supplied = Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	);
	const unexpected = Object.keys(supplied).filter((key) => !Object.hasOwn(expected, key));
	const missing = Object.entries(expected).flatMap(([key, expectedValue]) =>
		!Object.hasOwn(supplied, key) &&
		expectedValue !== null &&
		!(Array.isArray(expectedValue) && expectedValue.length === 0)
			? [key]
			: [],
	);
	const changed = Object.entries(expected).flatMap(([key, expectedValue]) =>
		Object.hasOwn(supplied, key) &&
		canonicalJson(supplied[key]) !== canonicalJson(expectedValue)
			? [key]
			: [],
	);
	return [
		unexpected.length ? `unexpected=${unexpected.sort().join(",")}` : "",
		missing.length ? `missing=${missing.sort().join(",")}` : "",
		changed.length ? `changed=${changed.sort().join(",")}` : "",
	].filter(Boolean).join("; ") || "stage or tool identity mismatch";
}

function blocked(
	code: string,
	message: string,
): DefineProductTicketMcpPublication.Blocker {
	return { status: "blocked", blocker: { code, message } };
}

function title(ticket: Ticket): string {
	return ticket.title;
}

function toolPayload(
	event: DefineProductTicketMcpPublication.ToolResultEvent,
): unknown {
	if (!Array.isArray(event.content) || event.content.length !== 1) return undefined;
	const [entry] = event.content;
	if (
		!record(entry) ||
		Object.keys(entry).length !== 2 ||
		entry.type !== "text" ||
		!text(entry.text)
	)
		return undefined;
	try {
		return JSON.parse(entry.text);
	} catch {
		return undefined;
	}
}

function actorEvidence(value: unknown): Actor | undefined {
	if (
		!record(value) ||
		!text(value.id) ||
		!text(value.name) ||
		typeof value.isActive !== "boolean" ||
		typeof value.isGuest !== "boolean"
	)
		return undefined;
	return {
		id: value.id,
		name: value.name,
		isActive: value.isActive,
		isGuest: value.isGuest,
	};
}

function objectId(value: unknown): string | null | undefined {
	if (value === null) return null;
	return record(value) && text(value.id) ? value.id : undefined;
}

function directOrObjectId(
	value: Record<string, unknown>,
	direct: string,
	object: string,
): string | null | undefined {
	if (!Object.hasOwn(value, direct) && !Object.hasOwn(value, object)) return null;
	if (value[direct] === null) return null;
	if (text(value[direct])) return value[direct];
	return objectId(value[object]);
}

function statusEvidence(value: Record<string, unknown>): {
	readonly id?: string;
	readonly name: string;
	readonly type: string;
} | undefined {
	if (record(value.status)) {
		if (!text(value.status.name) || !text(value.status.type)) return undefined;
		return {
			...(text(value.status.id) ? { id: value.status.id } : {}),
			name: value.status.name,
			type: value.status.type,
		};
	}
	if (!text(value.status) || !text(value.statusType)) return undefined;
	return {
		...(text(value.statusId) ? { id: value.statusId } : {}),
		name: value.status,
		type: value.statusType,
	};
}

function relationIds(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids: string[] = [];
	for (const entry of value) {
		if (!record(entry)) return undefined;
		const id = text(entry.id)
			? entry.id
			: record(entry.relatedIssue) && text(entry.relatedIssue.id)
				? entry.relatedIssue.id
				: record(entry.issue) && text(entry.issue.id)
					? entry.issue.id
					: undefined;
		if (!id) return undefined;
		ids.push(id);
	}
	return ids;
}

function issueRelations(value: Record<string, unknown>): {
	readonly blockedBy: readonly string[];
	readonly blocks: readonly string[];
} | undefined {
	if (!record(value.relations)) return undefined;
	const blockedBy = relationIds(value.relations.blockedBy);
	const blocks = relationIds(value.relations.blocks);
	return blockedBy && blocks ? { blockedBy, blocks } : undefined;
}

function exactMarkdown(expected: string, actual: string): boolean {
	return actual === expected || (expected.endsWith("\n") && actual === expected.slice(0, -1));
}

function exactTicketMarkdown(expected: string, actual: string): boolean {
	return exactMarkdown(expected, actual) || exactMarkdown(expected.replace(/^- /gm, "* "), actual);
}

function estimatePoints(value: unknown): number | undefined {
	if (typeof value === "number") return value;
	return record(value) && typeof value.value === "number" ? value.value : undefined;
}

function exactParent(context: Context, value: unknown): boolean {
	if (!record(value)) return false;
	const teamId = directOrObjectId(value, "teamId", "team");
	const status = statusEvidence(value);
	return (
		value.id === context.publication.graphParent.id &&
		teamId === context.publication.graphParent.teamId &&
		value.title === context.approved.spec.payload.target.title &&
		typeof value.description === "string" &&
		exactMarkdown(context.approved.spec.payload.body, value.description) &&
		status?.type === "backlog" &&
		directOrObjectId(value, "assigneeId", "assignee") === null &&
		directOrObjectId(value, "cycleId", "cycle") === null
	);
}

function exactChild(
	context: Context,
	ticket: Ticket,
	value: unknown,
	requireRelations: boolean,
): value is Record<string, unknown> & { id: string } {
	if (!record(value) || !text(value.id)) return false;
	const status = statusEvidence(value);
	const labels = value.labels;
	const projectId = directOrObjectId(value, "projectId", "project");
	const exactBase =
		directOrObjectId(value, "teamId", "team") === context.publication.graphParent.teamId &&
		directOrObjectId(value, "parentId", "parent") === context.publication.graphParent.id &&
		value.title === title(ticket) &&
		typeof value.description === "string" &&
		exactTicketMarkdown(renderDeliveryTicketBody(ticket), value.description) &&
		estimatePoints(value.estimate) === ticket.estimate.points &&
		status !== undefined &&
		(status.id === undefined || status.id === context.triageId) &&
		status.name === "Triage" &&
		status.type === "triage" &&
		directOrObjectId(value, "assigneeId", "assignee") === null &&
		directOrObjectId(value, "cycleId", "cycle") === null &&
		Array.isArray(labels) &&
		labels.length === 0 &&
		projectId === null;
	if (!exactBase || !requireRelations) return exactBase;
	const relations = issueRelations(value);
	if (!relations) return false;
	const byKey = new Map(context.manifest.children.map((child) => [child.stableKey, child.linearId]));
	const expectedBlockedBy = ticket.blockers.map((key) => byKey.get(key));
	const expectedBlocks = context.graph.payload.tickets
		.filter((candidate) => candidate.blockers.includes(ticket.stableKey))
		.map((candidate) => byKey.get(candidate.stableKey));
	if (expectedBlockedBy.some((id) => !id) || expectedBlocks.some((id) => !id)) return false;
	return (
		canonicalJson([...relations.blockedBy].sort()) === canonicalJson([...expectedBlockedBy].sort()) &&
		canonicalJson([...relations.blocks].sort()) === canonicalJson([...expectedBlocks].sort())
	);
}

function statusList(value: unknown):
	| readonly (Record<string, unknown> & {
			readonly id: string;
			readonly name: string;
			readonly type: string;
	  })[]
	| undefined {
	const statuses = Array.isArray(value)
		? value
		: record(value) && Array.isArray(value.statuses)
			? value.statuses
			: undefined;
	return statuses?.every(
		(status) =>
			record(status) &&
			text(status.id) &&
			text(status.name) &&
			text(status.type),
	)
		? statuses as readonly (Record<string, unknown> & {
				readonly id: string;
				readonly name: string;
				readonly type: string;
		  })[]
		: undefined;
}

function issuePage(value: unknown): {
	readonly issues: readonly unknown[];
	readonly nextCursor?: string;
} | undefined {
	if (!record(value) || !Array.isArray(value.issues)) return undefined;
	if (value.hasNextPage === false) return { issues: value.issues };
	if (value.hasNextPage === true && text(value.cursor))
		return { issues: value.issues, nextCursor: value.cursor };
	return undefined;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function publicationMatches(
	definitionId: string,
	publication: ApprovedTicketPublication,
	graph: DeliveryTicketGraph,
	approved: ApprovedProductSpecRead,
	owner?: AuthenticatedAuthority,
): boolean {
	return (
		publication.definitionId === definitionId &&
		publication.graphRef.digest === graph.digest &&
		publication.approvedSpecRef.digest === approved.spec.digest &&
		graph.payload.language === "es" &&
		canonicalJson(graph.payload.parent) === canonicalJson(publication.graphParent) &&
		canonicalJson(publication.approval.payload.parent) === canonicalJson(publication.graphParent) &&
		publication.approval.payload.graphDigest === graph.digest &&
		publication.approval.payload.actor.role === "Owner" &&
		(owner === undefined ||
			canonicalJson(publication.approval.payload.actor) === canonicalJson(owner))
	);
}

function failureFor(
	event: DefineProductTicketMcpPublication.ToolResultEvent,
): DefineProductTicketMcpPublication.Blocker["blocker"] {
	const payload = toolPayload(event);
	const code = record(payload) ? payload.code : undefined;
	if (code === "UNAUTHENTICATED")
		return {
			code: "PI_WORKFLOW_TICKET_MCP_UNAUTHENTICATED",
			message: "Linear MCP is present but not authenticated.",
		};
	if (code === "PERMISSION_DENIED")
		return {
			code: "PI_WORKFLOW_PUBLICATION_PERMISSION_DENIED",
			message: "Linear MCP denied the planned ticket publication mutation.",
		};
	if (code === "RATE_LIMITED")
		return {
			code: "PI_WORKFLOW_TICKET_MCP_RATE_LIMITED",
			message: "Linear MCP rate-limited ticket publication.",
		};
	return {
		code: "PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
		message: "Linear MCP returned a failed or incompatible result.",
	};
}

export function createDefineProductTicketMcpPublication(
	options: DefineProductTicketMcpPublicationDependencies,
): DefineProductTicketMcpPublication {
	let phase: Phase = "idle";
	const authoritySession =
		options.authoritySession ??
		createSingleUserAuthoritySession({
			...(options.owner ? { authority: options.owner } : {}),
		});
	let context: Context | undefined;
	let issued: IssuedCall | undefined;
	let mcpAvailable: boolean | undefined;
	let generation = 0;
	let beginning = false;
	const capacity = Math.min(
		options.toolIdentityReservationCapacity ?? MAX_RESERVED_TOOL_IDENTITIES,
		MAX_RESERVED_TOOL_IDENTITIES,
	);
	if (!Number.isSafeInteger(capacity) || capacity < 1)
		throw new Error("Ticket MCP tool identity reservation capacity must be a positive integer.");
	const reservations = new Map<string, number>();
	const processed = new Map<string, string>();
	let callQueue: Promise<void> = Promise.resolve();
	let resultQueue: Promise<void> = Promise.resolve();

	const identityFor = (toolName: string, toolCallId: string) =>
		`${toolName}\u0000${toolCallId}`;
	const isCurrent = (
		queuedGeneration: number,
		activePhase: Phase,
		activeContext: Context | undefined,
		activeIssued: IssuedCall | undefined,
	) =>
		generation === queuedGeneration &&
		phase === activePhase &&
		context === activeContext &&
		issued === activeIssued;
	const staleBlock = () => ({
		block: true as const,
		reason: "PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
	});
	const ensureGenerationContext = (
		queuedGeneration: number,
		active: Context,
	): void => {
		if (generation !== queuedGeneration || context !== active)
			throw CANCELLED_GENERATION;
	};

	function fail(code: string, message: string): void {
		if (phase !== "blocked") {
			phase = "blocked";
			context = undefined;
			issued = undefined;
		}
		blockerState = { code, message };
	}
	let blockerState: DefineProductTicketMcpPublication.Blocker["blocker"] = {
		code: "PI_WORKFLOW_PUBLICATION_FAILED",
		message: "Ticket publication failed.",
	};

	function clear(): void {
		generation += 1;
		beginning = false;
		phase = "idle";
		context = undefined;
		issued = undefined;
		blockerState = {
			code: "PI_WORKFLOW_PUBLICATION_FAILED",
			message: "Ticket publication failed.",
		};
	}

	function setMcpAvailable(available: boolean): void {
		mcpAvailable = available;
		if (!available && phase !== "idle" && phase !== "blocked")
			fail(
				"PI_WORKFLOW_TICKET_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for ticket publication.",
			);
	}

	function childFindInput(active: Context, allChildren = false): Readonly<Record<string, unknown>> {
		const mutation = active.mutation;
		if (!allChildren && mutation?.kind !== "child") return {};
		return {
			team: active.publication.graphParent.teamId,
			parentId: active.publication.graphParent.id,
			...(!allChildren && mutation?.kind === "child"
				? { query: title(mutation.ticket) }
				: {}),
			limit: 250,
			orderBy: "updatedAt",
			includeArchived: false,
			fields: ISSUE_FIELDS,
			...(active.discovery?.cursor ? { cursor: active.discovery.cursor } : {}),
		};
	}

	function expectedModelCall():
		| DefineProductTicketMcpPublication.ExpectedCall
		| undefined {
		if (phase === "ready" || phase === "blocked")
			return { toolName: WORKFLOW_TOOL, input: { action: "publish_tickets" } };
		if (!context) return undefined;
		if (phase === "actor")
			return { toolName: CURRENT_USER_TOOL, input: { query: "me" } };
		if (phase === "parent" || phase === "mutation-parent" || phase === "verify-parent")
			return {
				toolName: GET_ISSUE_TOOL,
				input: { id: context.publication.graphParent.id, includeRelations: true },
			};
		if (phase === "statuses")
			return {
				toolName: LIST_STATUSES_TOOL,
				input: { team: context.publication.graphParent.teamId },
			};
		if (phase === "child-find" || phase === "verify-children")
			return { toolName: LIST_ISSUES_TOOL, input: childFindInput(context, phase === "verify-children") };
		if (phase === "child-save") {
			const mutation = context.mutation;
			if (mutation?.kind !== "child" || !context.triageId) return undefined;
			return {
				toolName: SAVE_ISSUE_TOOL,
				input: {
					team: context.publication.graphParent.teamId,
					parentId: context.publication.graphParent.id,
					title: TITLE_PLACEHOLDER,
					description: BODY_PLACEHOLDER,
					estimate: mutation.ticket.estimate.points,
					state: context.triageId,
					assignee: null,
					cycle: null,
					labels: [],
					project: null,
				},
			};
		}
		if (
			phase === "child-readback" ||
			phase === "relation-read" ||
			phase === "verify-child"
		) {
			const active = context;
			const mutation = active.mutation;
			const issueId = phase === "child-readback"
				? active.mutationLinearId
				: phase === "verify-child"
					? active.manifest.children.find(
						(child) => child.stableKey === active.ordered[active.verifyIndex]?.stableKey,
					)?.linearId
				: mutation?.kind === "relation"
					? active.manifest.children.find(
							(child) => child.stableKey === mutation.relation.blockedStableKey,
						)?.linearId
					: undefined;
			return issueId
				? { toolName: GET_ISSUE_TOOL, input: { id: issueId, includeRelations: true } }
				: undefined;
		}
		if (phase === "relation-save") {
			const mutation = context.mutation;
			if (mutation?.kind !== "relation") return undefined;
			const blocked = context.manifest.children.find(
				(child) => child.stableKey === mutation.relation.blockedStableKey,
			);
			const blocking = context.manifest.children.find(
				(child) => child.stableKey === mutation.relation.blockingStableKey,
			);
			return blocked && blocking
				? {
						toolName: SAVE_ISSUE_TOOL,
						input: { id: blocked.linearId, blockedBy: [blocking.linearId] },
					}
				: undefined;
		}
		return undefined;
	}

	async function loadCanonical(
		definitionId: string,
		compatibilityAuthority = options.owner,
	): Promise<{
		publication: ApprovedTicketPublication;
		graph: DeliveryTicketGraph;
		approved: ApprovedProductSpecRead;
	}> {
		const publication = await options.approvedPublications.read(definitionId);
		if (!publication)
			throw Object.assign(
				new Error("Ticket publication requires the exact durable approved graph."),
				{ code: "PI_WORKFLOW_TICKET_APPROVAL_MISMATCH" },
			);
		const [graph, approved] = await Promise.all([
			options.recoverGraph(publication),
			options.approvedSpecReader.read(definitionId),
		]);
		if (
			compatibilityAuthority &&
			(compatibilityAuthority.role !== "Owner" ||
				canonicalJson(publication.approval.payload.actor) !==
					canonicalJson(compatibilityAuthority))
		)
			throw Object.assign(
				new Error(
					"The ticket approval actor does not match the injected compatibility policy.",
				),
				{ code: "PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT" },
			);
		if (
			!graph ||
			!publicationMatches(
				definitionId,
				publication,
				graph,
				approved,
				compatibilityAuthority,
			)
		)
			throw Object.assign(
				new Error("The durable approved ticket publication is malformed or conflicting."),
				{ code: "PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT" },
			);
		return { publication, graph, approved };
	}

	async function revalidate(active: Context): Promise<void> {
		const current = await loadCanonical(
			active.definitionId,
			options.owner ?? active.compatibilityAuthority,
		);
		if (
			canonicalJson(current.publication) !== canonicalJson(active.publication) ||
			canonicalJson(current.graph) !== canonicalJson(active.graph) ||
			canonicalJson(current.approved) !== canonicalJson(active.approved)
		)
			throw Object.assign(
				new Error("The approved ticket graph changed immediately before mutation."),
				{ code: "PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT" },
			);
	}

	async function begin(
		definitionId: string,
		toolCallId: string,
		input: unknown,
	): Promise<
		| DefineProductTicketMcpPublication.Continuing
		| DefineProductTicketMcpPublication.Blocker
	> {
		if (
			phase !== "idle" ||
			beginning ||
			!text(definitionId) ||
			!text(toolCallId) ||
			!exactInput(input, { action: "publish_tickets" })
		)
			return blocked(
				"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
				"Ticket publication requires the exact active action-only call.",
			);
		if (mcpAvailable === false)
			return blocked(
				"PI_WORKFLOW_TICKET_MCP_UNAVAILABLE",
				"Authenticated compatible Linear MCP tools are required for ticket publication.",
			);
		beginning = true;
		generation += 1;
		if (!options.authoritySession) authoritySession.clear();
		const beginGeneration = generation;
		try {
			const injectedAuthority =
				await options.authenticatedAuthorityPolicy?.current();
			if (
				options.authenticatedAuthorityPolicy &&
				!validCompatibilityAuthority(injectedAuthority)
			)
				return blocked(
					"PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT",
					"The injected authenticated authority policy is unavailable or invalid.",
				);
			if (
				options.owner &&
				injectedAuthority &&
				canonicalJson(options.owner) !== canonicalJson(injectedAuthority)
			)
				return blocked(
					"PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT",
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
					"PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT",
					"The authenticated Linear user does not satisfy the injected compatibility policy.",
				);
			const canonical = await loadCanonical(
				definitionId,
				compatibilityAuthority,
			);
			if (generation !== beginGeneration || phase !== "idle")
				return blocked(
					"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
					"Ticket publication start was replaced before preparation completed.",
				);
			const ordered = orderDeliveryTickets(canonical.graph.payload.tickets);
			const relations = canonical.graph.payload.tickets
				.flatMap((ticket) =>
					ticket.blockers.map((blockingStableKey) => ({
						blockedStableKey: ticket.stableKey,
						blockingStableKey,
					})),
				)
				.sort((left, right) =>
					`${left.blockedStableKey}:${left.blockingStableKey}`.localeCompare(
						`${right.blockedStableKey}:${right.blockingStableKey}`,
					),
				);
			const manifest = await options.manifest.prepare({
				definitionId,
				graphDigest: canonical.graph.digest,
				parent: {
					id: canonical.publication.graphParent.id,
					revision: canonical.publication.graphParent.revision,
				},
			});
			if (generation !== beginGeneration || phase !== "idle")
				return blocked(
					"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
					"Ticket publication start was replaced during manifest recovery.",
				);
			const identity = identityFor(WORKFLOW_TOOL, toolCallId);
			if (reservations.has(identity) || reservations.size >= capacity)
				return blocked(
					"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
					"Ticket publication exhausted or reused a tool identity.",
				);
			context = {
				definitionId,
				...canonical,
				...(compatibilityAuthority
					? {
							compatibilityAuthority: structuredClone(
								compatibilityAuthority,
							),
						}
					: {}),
				ordered,
				relations,
				manifest,
				verifyIndex: 0,
			};
			reservations.set(identity, beginGeneration);
			issued = { phase: "start", toolName: WORKFLOW_TOOL, toolCallId };
			phase = "waiting";
			return { status: "continuing" };
		} catch (error) {
			return blocked(
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "PI_WORKFLOW_RECOVERY_FAILED",
				error instanceof Error ? error.message : "Ticket publication recovery failed.",
			);
		} finally {
			if (generation === beginGeneration) beginning = false;
		}
	}

	async function routeNext(
		active: Context,
		queuedGeneration: number,
	): Promise<void> {
		for (;;) {
			if (active.manifest.stage === "prepared") {
				active.manifest = await options.manifest.advance(
					active.manifest.operationId,
					"prepared",
					"creating",
					{},
				);
				ensureGenerationContext(queuedGeneration, active);
				continue;
			}
			if (active.manifest.stage === "creating") {
				const next = active.ordered.find(
					(ticket) =>
						!active.manifest.children.some(
							(child) => child.stableKey === ticket.stableKey,
						),
				);
				if (next) {
					if (
						active.manifest.pendingMutation &&
						(active.manifest.pendingMutation.kind !== "child" ||
							active.manifest.pendingMutation.stableKey !== next.stableKey)
					)
						throw Object.assign(
							new Error("Durable mutation receipt conflicts with the next child."),
							{ code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT" },
						);
					active.mutation = { kind: "child", ticket: next };
					active.discovery = {
						ids: [],
						conflicts: 0,
						seenCursors: new Set(),
					};
					phase = "child-find";
					return;
				}
				if (active.manifest.pendingMutation)
					throw Object.assign(new Error("Durable child receipt is orphaned."), {
						code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT",
					});
				active.manifest = await options.manifest.advance(
					active.manifest.operationId,
					"creating",
					"children",
					{},
				);
				ensureGenerationContext(queuedGeneration, active);
				continue;
			}
			if (active.manifest.stage === "children") {
				active.manifest = await options.manifest.advance(
					active.manifest.operationId,
					"children",
					"relations",
					{},
				);
				ensureGenerationContext(queuedGeneration, active);
				continue;
			}
			if (active.manifest.stage === "relations") {
				const next = active.relations.find(
					(relation) =>
						!active.manifest.relations.some(
							(recorded) => canonicalJson(recorded) === canonicalJson(relation),
						),
				);
				if (next) {
					if (
						active.manifest.pendingMutation &&
						(active.manifest.pendingMutation.kind !== "relation" ||
							active.manifest.pendingMutation.blockedStableKey !== next.blockedStableKey ||
							active.manifest.pendingMutation.blockingStableKey !== next.blockingStableKey)
					)
						throw Object.assign(
							new Error("Durable mutation receipt conflicts with the next blocker."),
							{ code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT" },
						);
					active.mutation = { kind: "relation", relation: next };
					phase = "relation-read";
					return;
				}
				if (active.manifest.pendingMutation)
					throw Object.assign(new Error("Durable blocker receipt is orphaned."), {
						code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT",
					});
				active.manifest = await options.manifest.advance(
					active.manifest.operationId,
					"relations",
					"verifying",
					{},
				);
				ensureGenerationContext(queuedGeneration, active);
				continue;
			}
			if (active.manifest.stage === "verifying" || active.manifest.stage === "verified") {
				active.verifyIndex = 0;
				phase = "verify-parent";
				return;
			}
			throw new Error("Ticket publication manifest reached an unknown stage.");
		}
	}

	async function handleToolCallSerial(
		event: DefineProductTicketMcpPublication.ToolCallEvent,
		queuedGeneration: number,
		activePhase: Phase,
		active: Context | undefined,
		activeIssued: IssuedCall | undefined,
	): Promise<{ readonly block: true; readonly reason: string } | undefined> {
		if (!isCurrent(queuedGeneration, activePhase, active, activeIssued))
			return staleBlock();
		if (
			(activePhase === "ready" || activePhase === "blocked") &&
			event.toolName === WORKFLOW_TOOL &&
			exactInput(event.input, { action: "publish_tickets" })
		)
			return undefined;
		const expected = expectedModelCall();
		if (
			!active ||
			!expected ||
			event.toolName !== expected.toolName ||
			!text(event.toolCallId) ||
			!exactInput(event.input, expected.input)
		) {
			const code = "PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID";
			const detail = expected
				? event.toolName !== expected.toolName
					? "tool mismatch"
					: inputMismatch(event.input, expected.input)
				: "no active expected call";
			fail(
				code,
				`Ticket MCP tool, input, order, or stage did not match the active publication plan (${detail}).`,
			);
			return { block: true, reason: `${code}: ${detail}` };
		}
		normalizePiNullableInput(event.input, expected.input);
		const identity = identityFor(event.toolName, event.toolCallId);
		if (reservations.has(identity)) return staleBlock();
		if (reservations.size >= capacity) {
			const code = "PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID";
			fail(code, "Ticket MCP tool identity capacity was exhausted.");
			return { block: true, reason: code };
		}
		try {
			if (activePhase === "child-save" || activePhase === "relation-save") {
				await revalidate(active);
				if (!isCurrent(queuedGeneration, activePhase, active, activeIssued))
					return staleBlock();
				if (active.manifest.pendingMutation)
					throw Object.assign(
						new Error("A durable pending mutation cannot be repeated."),
						{ code: "PI_WORKFLOW_PUBLICATION_RECOVERY_PENDING" },
					);
				if (activePhase === "child-save" && active.mutation?.kind === "child") {
					active.manifest = await options.manifest.beginMutation(
						active.manifest.operationId,
						"creating",
						{ kind: "child", stableKey: active.mutation.ticket.stableKey },
					);
					if (!isCurrent(queuedGeneration, activePhase, active, activeIssued))
						return staleBlock();
					if (record(event.input)) {
						event.input.title = title(active.mutation.ticket);
						event.input.description = renderDeliveryTicketBody(
							active.mutation.ticket,
						);
					}
				} else if (
					activePhase === "relation-save" &&
					active.mutation?.kind === "relation"
				) {
					active.manifest = await options.manifest.beginMutation(
						active.manifest.operationId,
						"relations",
						{ kind: "relation", ...active.mutation.relation },
					);
					if (!isCurrent(queuedGeneration, activePhase, active, activeIssued))
						return staleBlock();
				}
			}
		} catch (error) {
			if (!isCurrent(queuedGeneration, activePhase, active, activeIssued))
				return staleBlock();
			const code =
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "PI_WORKFLOW_TICKET_RECOVERY_PERSISTENCE_FAILED";
			fail(
				code,
				error instanceof Error
					? error.message
					: "Ticket mutation receipt could not be persisted.",
			);
			return { block: true, reason: code };
		}
		if (!isCurrent(queuedGeneration, activePhase, active, activeIssued))
			return staleBlock();
		issued = {
			phase: activePhase as IssuedPhase,
			toolName: event.toolName,
			toolCallId: event.toolCallId,
		};
		reservations.set(identity, queuedGeneration);
		phase = "waiting";
		return undefined;
	}

	async function handleToolCall(
		event: DefineProductTicketMcpPublication.ToolCallEvent,
	): Promise<{ readonly block: true; readonly reason: string } | undefined> {
		if (phase === "idle") return undefined;
		const queuedGeneration = generation;
		const activePhase = phase;
		const active = context;
		const activeIssued = issued;
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
				activePhase,
				active,
				activeIssued,
			);
		} finally {
			releaseQueue();
		}
	}

	async function recordChild(
		active: Context,
		ticket: Ticket,
		linearId: string,
		queuedGeneration: number,
	): Promise<void> {
		active.manifest = await options.manifest.record(
			active.manifest.operationId,
			"creating",
			{
				children: [...active.manifest.children, { stableKey: ticket.stableKey, linearId }],
				relations: active.manifest.relations,
			},
		);
		ensureGenerationContext(queuedGeneration, active);
		active.mutation = undefined;
		active.mutationLinearId = undefined;
		active.discovery = undefined;
		await routeNext(active, queuedGeneration);
	}

	async function recordRelation(
		active: Context,
		relation: Relation,
		queuedGeneration: number,
	): Promise<void> {
		active.manifest = await options.manifest.record(
			active.manifest.operationId,
			"relations",
			{
				children: active.manifest.children,
				relations: [...active.manifest.relations, relation],
			},
		);
		ensureGenerationContext(queuedGeneration, active);
		active.mutation = undefined;
		await routeNext(active, queuedGeneration);
	}

	async function dispatchResult(
		active: Context,
		issuedCall: IssuedCall,
		payload: unknown,
		queuedGeneration: number,
	): Promise<void> {
		if (issuedCall.phase === "start") {
			if (!exactInput(payload, { status: "continuing" }))
				throw Object.assign(new Error("Ticket publication continuation result was incompatible."), {
					code: "PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
				});
			const authenticated = authoritySession.user();
			if (authenticated) {
				active.actor = authenticated;
				phase = "parent";
			} else phase = "actor";
			return;
		}
		if (issuedCall.phase === "actor") {
			const actor = actorEvidence(payload);
			if (
				!actor?.isActive ||
				actor.isGuest ||
				(active.compatibilityAuthority !== undefined &&
					actor.id !== active.compatibilityAuthority.actorId) ||
				!authoritySession.authenticate(actor).ok
			)
				throw Object.assign(new Error("An active non-guest authenticated Linear user is required."), {
					code: "PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT",
				});
			active.actor = actor;
			phase = "parent";
			return;
		}
		if (issuedCall.phase === "parent" || issuedCall.phase === "mutation-parent" || issuedCall.phase === "verify-parent") {
			if (!exactParent(active, payload))
				throw Object.assign(new Error("The canonical Delivery parent changed or was malformed."), {
					code: issuedCall.phase === "verify-parent"
						? "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH"
						: "PI_WORKFLOW_PUBLICATION_PARENT_DRIFT",
				});
			if (issuedCall.phase === "parent") phase = "statuses";
			else if (issuedCall.phase === "mutation-parent")
				phase = active.mutation?.kind === "child" ? "child-save" : "relation-save";
			else {
				active.discovery = { ids: [], conflicts: 0, seenCursors: new Set() };
				phase = "verify-children";
			}
			return;
		}
		if (issuedCall.phase === "statuses") {
			const statuses = statusList(payload);
			if (!statuses)
				throw Object.assign(
					new Error("Linear MCP returned a malformed status entry."),
					{ code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" },
				);
			const matches = statuses.filter(
				(status) => status.name === "Triage" && status.type === "triage",
			);
			if (matches.length !== 1)
				throw Object.assign(
					new Error("Linear MCP did not resolve exactly one Triage state."),
					{ code: "PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN" },
				);
			active.triageId = matches[0].id;
			await routeNext(active, queuedGeneration);
			return;
		}
		if (issuedCall.phase === "child-find") {
			const mutation = active.mutation;
			const discovery = active.discovery;
			const page = issuePage(payload);
			if (mutation?.kind !== "child" || !discovery || !page)
				throw Object.assign(new Error("Linear MCP returned a malformed child lookup page."), {
					code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
				});
			const ids = [...discovery.ids];
			let conflicts = discovery.conflicts;
			for (const candidate of page.issues) {
				if (!record(candidate)) {
					conflicts += 1;
					continue;
				}
				if (candidate.title !== title(mutation.ticket)) continue;
				if (!exactChild(active, mutation.ticket, candidate, false)) {
					conflicts += 1;
					continue;
				}
				ids.push(candidate.id);
			}
			if (page.nextCursor) {
				if (discovery.seenCursors.has(page.nextCursor))
					throw Object.assign(new Error("Linear MCP repeated a child lookup cursor."), {
						code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
					});
				active.discovery = {
					ids,
					conflicts,
					cursor: page.nextCursor,
					seenCursors: new Set([...discovery.seenCursors, page.nextCursor]),
				};
				phase = "child-find";
				return;
			}
			if (conflicts || ids.length > 1 || new Set(ids).size !== ids.length)
				throw Object.assign(
					new Error("Ticket title discovery is ambiguous or conflicting."),
					{ code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT" },
				);
			if (ids.length === 1) {
				await recordChild(active, mutation.ticket, ids[0], queuedGeneration);
				return;
			}
			if (active.manifest.pendingMutation)
				throw Object.assign(new Error("A prior child mutation is uncertain and cannot be repeated."), {
					code: "PI_WORKFLOW_PUBLICATION_RECOVERY_PENDING",
				});
			phase = "mutation-parent";
			return;
		}
		if (issuedCall.phase === "verify-children") {
			const discovery = active.discovery;
			const page = issuePage(payload);
			if (!discovery || !page)
				throw Object.assign(new Error("Linear MCP returned a malformed final child page."), {
					code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
				});
			const ids = [...discovery.ids];
			let conflicts = discovery.conflicts;
			for (const candidate of page.issues) {
				if (!record(candidate)) {
					conflicts += 1;
					continue;
				}
				const matches = active.ordered.filter((ticket) =>
					exactChild(active, ticket, candidate, false),
				);
				const receipt = matches.length === 1
					? active.manifest.children.find(
							(child) => child.stableKey === matches[0].stableKey,
						)
					: undefined;
				if (!receipt || candidate.id !== receipt.linearId) conflicts += 1;
				else ids.push(candidate.id);
			}
			if (page.nextCursor) {
				if (discovery.seenCursors.has(page.nextCursor))
					throw Object.assign(new Error("Linear MCP repeated the final child cursor."), {
						code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
					});
				active.discovery = { ids, conflicts, cursor: page.nextCursor, seenCursors: new Set([...discovery.seenCursors, page.nextCursor]) };
				phase = "verify-children";
				return;
			}
			const expectedIds = active.manifest.children.map((child) => child.linearId);
			if (conflicts || ids.length !== expectedIds.length || new Set(ids).size !== ids.length || !sameIds(ids, expectedIds))
				throw Object.assign(new Error("Ticket publication child-set read-back did not match the approved graph."), {
					code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
				});
			active.discovery = undefined;
			phase = "verify-child";
			return;
		}
		if (issuedCall.phase === "child-save") {
			const mutation = active.mutation;
			if (mutation?.kind !== "child" || !record(payload) || !text(payload.id))
				throw Object.assign(
					new Error("Linear MCP returned a malformed child creation identity."),
					{ code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" },
				);
			active.mutationLinearId = payload.id;
			phase = "child-readback";
			return;
		}
		if (issuedCall.phase === "child-readback") {
			const mutation = active.mutation;
			if (
				mutation?.kind !== "child" ||
				!active.mutationLinearId ||
				!exactChild(active, mutation.ticket, payload, false) ||
				payload.id !== active.mutationLinearId
			)
				throw Object.assign(
					new Error("Ticket creation read-back did not prove the exact child."),
					{ code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH" },
				);
			await recordChild(
				active,
				mutation.ticket,
				active.mutationLinearId,
				queuedGeneration,
			);
			return;
		}
		if (issuedCall.phase === "relation-read") {
			const mutation = active.mutation;
			if (mutation?.kind !== "relation" || !record(payload) || !text(payload.id))
				throw Object.assign(new Error("Linear MCP returned a malformed blocker read."), {
					code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
				});
			const blocked = active.manifest.children.find(
				(child) => child.stableKey === mutation.relation.blockedStableKey,
			);
			const blocking = active.manifest.children.find(
				(child) => child.stableKey === mutation.relation.blockingStableKey,
			);
			const relations = issueRelations(payload);
			if (!blocked || !blocking || payload.id !== blocked.linearId || !relations)
				throw Object.assign(new Error("Linear MCP returned malformed native blocker evidence."), {
					code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
				});
			const matches = relations.blockedBy.filter((id) => id === blocking.linearId);
			if (matches.length > 1)
				throw Object.assign(new Error("Native blocker evidence is ambiguous."), {
					code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT",
				});
			if (matches.length === 1) {
				await recordRelation(active, mutation.relation, queuedGeneration);
				return;
			}
			if (active.manifest.pendingMutation)
				throw Object.assign(new Error("A prior blocker mutation is uncertain and cannot be repeated."), {
					code: "PI_WORKFLOW_PUBLICATION_RECOVERY_PENDING",
				});
			phase = "mutation-parent";
			return;
		}
		if (issuedCall.phase === "relation-save") {
			const mutation = active.mutation;
			const blocked = mutation?.kind === "relation"
				? active.manifest.children.find(
						(child) => child.stableKey === mutation.relation.blockedStableKey,
					)
				: undefined;
			if (
				mutation?.kind !== "relation" ||
				!blocked ||
				!record(payload) ||
				payload.id !== blocked.linearId
			)
				throw Object.assign(
					new Error("Linear MCP returned a malformed blocker mutation identity."),
					{ code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" },
				);
			phase = "relation-read";
			return;
		}
		if (issuedCall.phase === "verify-child") {
			const ticket = active.ordered[active.verifyIndex];
			const receipt = ticket && active.manifest.children.find(
				(child) => child.stableKey === ticket.stableKey,
			);
			if (!ticket || !receipt || !exactChild(active, ticket, payload, true) || payload.id !== receipt.linearId)
				throw Object.assign(new Error("Ticket publication exact read-back did not match the approved graph."), {
					code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
				});
			active.verifyIndex += 1;
			if (active.verifyIndex < active.ordered.length) {
				phase = "verify-child";
				return;
			}
			if (active.manifest.stage === "verifying") {
				active.manifest = await options.manifest.advance(
					active.manifest.operationId,
					"verifying",
					"verified",
					{
						verification: {
							graphDigest: active.graph.digest,
							parentId: active.publication.graphParent.id,
						},
					},
				);
				ensureGenerationContext(queuedGeneration, active);
			}
			phase = "ready";
			return;
		}
		throw Object.assign(new Error("Ticket MCP result reached an invalid stage."), {
			code: "PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
		});
	}

	async function handleToolResultSerial(
		event: DefineProductTicketMcpPublication.ToolResultEvent,
		queuedGeneration: number,
		activePhase: Phase,
		active: Context | undefined,
		issuedCall: IssuedCall | undefined,
	): Promise<boolean> {
		if (!isCurrent(queuedGeneration, activePhase, active, issuedCall))
			return false;
		if (!active || !issuedCall || !text(event.toolCallId)) {
			fail(
				"PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
				"Linear MCP returned a result without a current issued call.",
			);
			return true;
		}
		if (
			event.toolName !== issuedCall.toolName ||
			event.toolCallId !== issuedCall.toolCallId
		) {
			fail(
				"PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
				"Linear MCP returned an out-of-order or mismatched result.",
			);
			return true;
		}
		issued = undefined;
		if (event.isError === true) {
			const failure = failureFor(event);
			fail(failure.code, failure.message);
			return true;
		}
		try {
			await dispatchResult(
				active,
				issuedCall,
				toolPayload(event),
				queuedGeneration,
			);
			ensureGenerationContext(queuedGeneration, active);
		} catch (error) {
			if (error === CANCELLED_GENERATION) return false;
			if (generation !== queuedGeneration || context !== active) return false;
			fail(
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "PI_WORKFLOW_PUBLICATION_FAILED",
				error instanceof Error ? error.message : "Ticket publication failed.",
			);
		}
		return true;
	}

	async function handleToolResult(
		event: DefineProductTicketMcpPublication.ToolResultEvent,
	): Promise<boolean> {
		if (phase === "idle" || !MCP_TOOLS.has(event.toolName)) return false;
		const queuedGeneration = generation;
		const activePhase = phase;
		const active = context;
		const issuedCall = issued;
		const preceding = resultQueue;
		let releaseQueue: () => void = () => {};
		resultQueue = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		await preceding;
		try {
			if (!text(event.toolCallId)) {
				const current = isCurrent(
					queuedGeneration,
					activePhase,
					active,
					issuedCall,
				);
				if (current)
					fail(
						"PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
						"Linear MCP returned a result without a stable tool identity.",
					);
				return current;
			}
			const identity = identityFor(event.toolName, event.toolCallId);
			const reservationGeneration = reservations.get(identity);
			if (reservationGeneration !== queuedGeneration) {
				if (reservationGeneration !== undefined) return false;
				if (
					isCurrent(
						queuedGeneration,
						activePhase,
						active,
						issuedCall,
					)
				) {
					fail(
						"PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
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
			const previous = processed.get(identity);
			if (previous !== undefined) {
				if (previous === fingerprint) return false;
				if (generation === queuedGeneration) {
					fail(
						"PI_WORKFLOW_TICKET_MCP_INCOMPATIBLE",
						"Linear MCP returned conflicting results for one tool identity.",
					);
					return true;
				}
				return false;
			}
			if (processed.size >= capacity) {
				if (generation === queuedGeneration)
					fail(
						"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
						"Ticket MCP replay tracking capacity was exhausted.",
					);
				return generation === queuedGeneration;
			}
			processed.set(identity, fingerprint);
			return await handleToolResultSerial(
				event,
				queuedGeneration,
				activePhase,
				active,
				issuedCall,
			);
		} finally {
			releaseQueue();
		}
	}

	async function complete(
		input: unknown,
	): Promise<
		| DefineProductTicketMcpPublication.Published
		| DefineProductTicketMcpPublication.Blocker
	> {
		if (!exactInput(input, { action: "publish_tickets" }))
			return blocked(
				"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
				"Ticket publication completion requires only action=publish_tickets.",
			);
		if (phase === "blocked") {
			const outcome = { status: "blocked" as const, blocker: blockerState };
			clear();
			return outcome;
		}
		if (phase !== "ready" || !context)
			return blocked(
				"PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
				"Ticket publication is not ready for completion.",
			);
		const outcome = {
			status: "tickets-published" as const,
			definitionId: context.definitionId,
		};
		clear();
		return outcome;
	}

	function nextCallInstruction(): string | undefined {
		const expected = expectedModelCall();
		return expected
			? `Define-product ticket publication protocol: call ${expected.toolName} exactly once now with ${JSON.stringify(expected.input)}. This is the only permitted next action; do not add fields, reuse an earlier call, or call tools in parallel.`
			: undefined;
	}

	return {
		allowedTools,
		setMcpAvailable,
		clear,
		hasActiveTurn: () => phase !== "idle",
		begin,
		expectedModelCall,
		nextCallInstruction,
		handleToolCall,
		handleToolResult,
		complete,
	};
}
