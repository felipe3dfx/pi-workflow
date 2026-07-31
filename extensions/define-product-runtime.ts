import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InputEvent } from "@earendil-works/pi-coding-agent";
import {
	createBlocker,
	type Assessment,
	type ProductSpecInput,
	type Route,
	type RouteRecommendation,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";
import type {
	DefineProductCommand,
	DefineProductOutcome,
	DefineProductRecovery,
} from "./define-product-workflow.ts";
import type { DefineProductMcpPublication } from "./define-product-mcp-publication.ts";
import { isReadOnlyEngramCall } from "./public-entry-guard.ts";

const toolName = "workflow_define_product";

const assessmentProperty = {
	type: "object",
	additionalProperties: false,
	properties: {
		clarity: { type: "string", enum: ["clear", "unclear"] },
		breadth: { type: "string", enum: ["narrow", "broad"] },
		reasons: { type: "array", items: { type: "string" } },
	},
	required: ["clarity", "breadth", "reasons"],
} as const;

const semanticSpecProperties = {
	teamId: { type: "string" },
	title: { type: "string" },
	problem: { type: "string" },
	solution: { type: "string" },
	userStories: { type: "array", items: { type: "string" } },
	decisions: {
		type: "array",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				id: { type: "string" },
				status: { type: "string", enum: ["open", "resolved"] },
				pertinent: { type: "boolean" },
				text: { type: "string" },
			},
			required: ["id", "status", "pertinent", "text"],
		},
	},
	tests: { type: "array", items: { type: "string" } },
	outOfScope: { type: "array", items: { type: "string" } },
} as const;

const affectedIssuesProperty = {
	type: "array",
	items: {
		type: "object",
		additionalProperties: false,
		properties: {
			id: { type: "string" },
			nextDescription: { type: "string" },
		},
		required: ["id", "nextDescription"],
	},
} as const;

const decisionGapProperty = {
	type: "object",
	additionalProperties: false,
	properties: {
		issueId: { type: "string" },
		body: { type: "string" },
	},
	required: ["issueId", "body"],
} as const;

const defineProductActions = [
	"recommend_route",
	"confirm_route",
	"request_exploration",
	"to_spec",
	"approve_spec",
	"publish_spec",
	"to_tickets",
	"approve_tickets",
	"publish_tickets",
	"to_approved_revision",
	"approve_approved_revision",
	"publish_approved_revision",
] as const;

const defineProductParameters = {
	type: "object",
	properties: {
		action: { type: "string", enum: defineProductActions },
		domainAnchor: { type: "string" },
		assessment: assessmentProperty,
		researchQuestion: { type: "string" },
		intent: { type: "string", enum: ["prototype", "design-alternative"] },
		focus: { type: "string" },
		...semanticSpecProperties,
		revisionKind: { type: "string" },
		affectedIssues: affectedIssuesProperty,
		sourceCommentKind: { type: "string" },
		sourceCommentBody: { type: "string" },
		decisionGap: decisionGapProperty,
	},
	required: ["action"],
	oneOf: [
		{
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ["recommend_route", "confirm_route", "request_exploration"],
				},
				domainAnchor: { type: "string" },
				assessment: assessmentProperty,
				researchQuestion: { type: "string" },
				intent: {
					type: "string",
					enum: ["prototype", "design-alternative"],
				},
				focus: { type: "string" },
			},
			required: ["action"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				action: { const: "to_spec" },
				...semanticSpecProperties,
			},
			required: [
				"action",
				"title",
				"problem",
				"solution",
				"userStories",
				"decisions",
				"tests",
				"outOfScope",
			],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: [
					"approve_spec",
					"publish_spec",
					"to_tickets",
					"approve_tickets",
					"publish_tickets",
					"approve_approved_revision",
					"publish_approved_revision",
				],
				},
			},
			required: ["action"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: {
				action: { const: "to_approved_revision" },
				revisionKind: { type: "string" },
				affectedIssues: affectedIssuesProperty,
				sourceCommentKind: { type: "string" },
				sourceCommentBody: { type: "string" },
				decisionGap: decisionGapProperty,
			},
			required: [
				"action",
				"revisionKind",
				"affectedIssues",
				"sourceCommentKind",
				"sourceCommentBody",
			],
		},
	],
} as const;

function collectPrivateStrings(value: unknown, target: Set<string>): void {
	if (typeof value === "string") {
		if (value.length > 0) target.add(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) collectPrivateStrings(entry, target);
		return;
	}
	if (isRecord(value))
		for (const entry of Object.values(value)) collectPrivateStrings(entry, target);
}

function redactPrivateStrings(
	value: string,
	privateStrings: ReadonlySet<string>,
): string {
	let redacted = value;
	for (const privateValue of [...privateStrings].sort(
		(left, right) => right.length - left.length,
	)) redacted = redacted.replaceAll(privateValue, "[detalle interno]");
	return redacted;
}

function redactPrivateValues(
	value: unknown,
	privateStrings: ReadonlySet<string>,
): unknown {
	if (typeof value === "string")
		return redactPrivateStrings(value, privateStrings);
	if (Array.isArray(value))
		return value.map((entry) => redactPrivateValues(entry, privateStrings));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			redactPrivateValues(entry, privateStrings),
		]),
	);
}

function publicSpec(
	spec: Extract<DefineProductOutcome, { status: "spec-ready" }>["spec"],
) {
	return {
		target: structuredClone(spec.payload.target),
		language: spec.payload.language,
		body: spec.payload.body,
		decisions: structuredClone(spec.payload.decisions),
	};
}

function publicParent(
	parent: Extract<DefineProductOutcome, { status: "spec-published" }>["parent"],
) {
	return {
		id: parent.id,
		teamId: parent.teamId,
		title: parent.title,
		description: parent.description,
		state: parent.state,
		cycleId: parent.cycleId,
		assigneeId: parent.assigneeId,
	};
}

function publicGraph(
	graph: Extract<DefineProductOutcome, { status: "tickets-ready" }>["graph"],
) {
	return {
		parent: {
			id: graph.payload.parent.id,
			teamId: graph.payload.parent.teamId,
		},
		coverage: structuredClone(graph.payload.coverage),
		language: graph.payload.language,
		tickets: structuredClone(graph.payload.tickets),
	};
}

function stripFlowReference(body: string): string {
	return body
		.replace(/(?:^|\n)\s*Referencia de flujo:\s*[^\r\n]*/gu, "")
		.replace(/^\n|\n$/gu, "");
}

function publicRevision(
	revision:
		| Extract<DefineProductOutcome, { status: "revision-ready" }>["revision"]
		| Extract<DefineProductOutcome, { status: "revision-approved" }>["revision"],
) {
	return {
		kind: revision.kind,
		affectedIssues: revision.affectedIssues.map((issue) => ({
			id: issue.id,
			previousDescription: issue.previousDescription,
			nextDescription: issue.nextDescription,
		})),
		sourceComment: {
			kind: revision.sourceComment.kind,
			body: stripFlowReference(revision.sourceComment.body),
		},
		...(revision.decisionGap
			? {
					decisionGap: {
						issueId: revision.decisionGap.issueId,
						body: stripFlowReference(revision.decisionGap.body),
					},
				}
			: {}),
	};
}

function publicOutcome(outcome: DefineProductOutcome): unknown {
	if (outcome.status === "awaiting-confirmation")
		return {
			status: outcome.status,
			recommendation: {
				assessment: outcome.recommendation.assessment,
				recommendedRoute: outcome.recommendation.recommendedRoute,
			},
		};
	if (outcome.status === "completed") {
		const privateStrings = new Set<string>();
		collectPrivateStrings(outcome.result.artifacts, privateStrings);
		collectPrivateStrings(outcome.result.launchProvenance, privateStrings);
		for (const risk of outcome.result.risks)
			collectPrivateStrings(risk.id, privateStrings);
		return {
			status: outcome.status,
			result: {
				status: outcome.result.status,
				executiveSummary: redactPrivateValues(
					outcome.result.executiveSummary,
					privateStrings,
				),
				nextRecommended: redactPrivateValues(
					outcome.result.nextRecommended,
					privateStrings,
				),
				risks: outcome.result.risks.map(({ id: _id, ...risk }) =>
					redactPrivateValues(risk, privateStrings),
				),
				...(outcome.result.status === "blocked"
					? {
							blocker: redactPrivateValues(
								outcome.result.blocker,
								privateStrings,
							),
						}
					: {}),
			},
		};
	}
	if (outcome.status === "spec-ready")
		return { status: outcome.status, spec: publicSpec(outcome.spec) };
	if (outcome.status === "spec-approved")
		return {
			status: outcome.status,
			spec: publicSpec(outcome.spec),
			approval: {
				status: "approved",
				target: structuredClone(outcome.approval.payload.target),
			},
		};
	if (outcome.status === "spec-published")
		return { status: outcome.status, parent: publicParent(outcome.parent) };
	if (outcome.status === "tickets-ready")
		return { status: outcome.status, graph: publicGraph(outcome.graph) };
	if (outcome.status === "tickets-approved")
		return {
			status: outcome.status,
			graph: publicGraph(outcome.graph),
			approval: {
				status: "approved",
				parent: {
					id: outcome.approval.payload.parent.id,
					teamId: outcome.approval.payload.parent.teamId,
				},
			},
		};
	if (outcome.status === "tickets-published") return { status: outcome.status };
	if (outcome.status === "revision-ready")
		return { status: outcome.status, revision: publicRevision(outcome.revision) };
	if (outcome.status === "revision-approved")
		return { status: outcome.status, revision: publicRevision(outcome.revision) };
	if (outcome.status === "revision-published") return { status: outcome.status };
	return outcome;
}

interface DefineProductToolParams {
	action:
		| "recommend_route"
		| "confirm_route"
		| "request_exploration"
		| "to_spec"
		| "approve_spec"
		| "publish_spec"
		| "to_tickets"
		| "approve_tickets"
		| "publish_tickets"
		| "to_approved_revision"
		| "approve_approved_revision"
		| "publish_approved_revision";
	domainAnchor?: string;
	assessment?: Assessment;
	researchQuestion?: string;
	intent?: "prototype" | "design-alternative";
	focus?: string;
	teamId?: string;
	title?: string;
	problem?: string;
	solution?: string;
	userStories?: ProductSpecInput["userStories"];
	decisions?: ProductSpecInput["decisions"];
	tests?: ProductSpecInput["tests"];
	outOfScope?: ProductSpecInput["outOfScope"];
	revisionKind?: string;
	affectedIssues?: unknown;
	sourceCommentKind?: string;
	sourceCommentBody?: string;
	decisionGap?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toolResultPayload(event: { content?: unknown }): unknown {
	if (!Array.isArray(event.content) || event.content.length !== 1) return undefined;
	const [item] = event.content;
	if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string")
		return undefined;
	try {
		return JSON.parse(item.text);
	} catch {
		return undefined;
	}
}

function linearTeamOptions(
	value: unknown,
): ReadonlyMap<string, string> | undefined {
	const teams = Array.isArray(value)
		? value
		: isRecord(value) && Array.isArray(value.teams)
			? value.teams
			: undefined;
	if (!teams) return undefined;
	if (
		isRecord(value) &&
		(value.hasNextPage === true ||
			(typeof value.cursor === "string" && value.cursor.length > 0))
	)
		return undefined;
	const options = new Map<string, string>();
	const names = new Set<string>();
	for (const team of teams) {
		if (
			!isRecord(team) ||
			typeof team.id !== "string" ||
			!team.id.trim() ||
			team.id !== team.id.trim() ||
			typeof team.name !== "string" ||
			!team.name.trim()
		)
			return undefined;
		const normalizedName = team.name
			.normalize("NFKC")
			.trim()
			.toLocaleLowerCase("en-US");
		if (options.has(team.id) || names.has(normalizedName)) return undefined;
		options.set(team.id, team.name.trim());
		names.add(normalizedName);
	}
	return options.size > 0 ? options : undefined;
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
	return (
		isRecord(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => key in value)
	);
}

function stringArray(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

function parseToSpecCommand(
	params: DefineProductToolParams,
	definitionId: string,
	boundTeamId?: string,
): DefineProductCommand | undefined {
	const expectedKeys = [
		"action",
		...(params.teamId === undefined ? [] : ["teamId"]),
		"title",
		"problem",
		"solution",
		"userStories",
		"decisions",
		"tests",
		"outOfScope",
	];
	const teamId = boundTeamId ?? params.teamId;
	const userStories = stringArray(params.userStories);
	const tests = stringArray(params.tests);
	const outOfScope = stringArray(params.outOfScope);
	if (
		!hasExactKeys(params, expectedKeys) ||
		typeof teamId !== "string" ||
		(boundTeamId !== undefined && params.teamId !== undefined && params.teamId !== boundTeamId) ||
		typeof params.title !== "string" ||
		typeof params.problem !== "string" ||
		typeof params.solution !== "string" ||
		!userStories ||
		!tests ||
		!outOfScope ||
		!Array.isArray(params.decisions)
	) {
		return undefined;
	}
	const decisions: ProductSpecInput["decisions"][number][] =
		params.decisions.flatMap((decision) => {
			if (
				!isRecord(decision) ||
				typeof decision.id !== "string" ||
				(decision.status !== "open" && decision.status !== "resolved") ||
				typeof decision.pertinent !== "boolean" ||
				typeof decision.text !== "string"
			) {
				return [];
			}
			return [
				{
					id: decision.id,
					status: decision.status === "open" ? "open" : "resolved",
					pertinent: decision.pertinent,
					text: decision.text,
				},
			];
		});
	if (decisions.length !== params.decisions.length) return undefined;
	return {
		kind: "to-spec",
		definitionId,
		teamId,
		title: params.title,
		problem: params.problem,
		solution: params.solution,
		userStories,
		decisions,
		tests,
		outOfScope,
	};
}

function parseApprovedRevisionDraftCommand(params: DefineProductToolParams, definitionId: string): DefineProductCommand | undefined {
	const expectedKeys = [
		"action",
		"revisionKind",
		"affectedIssues",
		"sourceCommentKind",
		"sourceCommentBody",
		...(params.decisionGap === undefined ? [] : ["decisionGap"]),
	];
	if (
		!hasExactKeys(params, expectedKeys) ||
		typeof params.revisionKind !== "string" ||
		typeof params.sourceCommentKind !== "string" ||
		typeof params.sourceCommentBody !== "string" ||
		!Array.isArray(params.affectedIssues)
	) return undefined;
	const affectedIssues = params.affectedIssues.flatMap((issue) => {
		if (!isRecord(issue) || typeof issue.id !== "string" || typeof issue.nextDescription !== "string") return [];
		return [{ id: issue.id, nextDescription: issue.nextDescription }];
	});
	if (affectedIssues.length !== params.affectedIssues.length) return undefined;
	let decisionGap: { issueId: string; body: string } | undefined;
	if (params.decisionGap !== undefined) {
		if (!isRecord(params.decisionGap) || typeof params.decisionGap.issueId !== "string" || typeof params.decisionGap.body !== "string") return undefined;
		decisionGap = { issueId: params.decisionGap.issueId, body: params.decisionGap.body };
	}
	return { kind: "to-approved-revision", definitionId, revisionKind: params.revisionKind, affectedIssues, sourceCommentKind: params.sourceCommentKind, sourceCommentBody: params.sourceCommentBody, ...(decisionGap ? { decisionGap } : {}) };
}

export interface DefineProductRuntimeDependencies {
	workflow: {
		advance(command: DefineProductCommand): Promise<DefineProductOutcome>;
		pendingRecommendation(): RouteRecommendation | undefined;
		reset(): void;
		restoreRecovery?(): Promise<DefineProductRecovery | undefined>;
	};
	createDefinitionId(): string;
	mcpPublication?: DefineProductMcpPublication;
}

export function createDefineProductRuntime(
	dependencies: DefineProductRuntimeDependencies,
) {
	type ApproveSpecCommand = Extract<
		DefineProductCommand,
		{ kind: "approve-spec" }
	>;
	type ApproveTicketsCommand = Extract<
		DefineProductCommand,
		{ kind: "approve-tickets" }
	>;
	type ApprovedRevisionCommand = Extract<
		DefineProductCommand,
		{ kind: "approve-approved-revision" | "publish-approved-revision" }
	>;

	let activeDefinitionId: string | undefined;
	let activeWorkflowStateId: string | undefined;
	let activeDomainAnchor: string | undefined;
	let activeSpecTeamId: string | undefined;
	let approveSpecCommand: ApproveSpecCommand | undefined;
	let approvedSpecRef: VerifiedArtifactRef | undefined;
	let publishedParentRef: VerifiedArtifactRef | undefined;
	let approveTicketsCommand: ApproveTicketsCommand | undefined;
	let approvedRevisionCommand: ApprovedRevisionCommand | undefined;
	let awaitingDomainAnchor = false;
	let awaitingConfirmation = false;
	let routeConfirmationAuthorized = false;
	let explorationAvailable = false;
	let awaitingSpecInput = false;
	let specInputAuthorized = false;
	let awaitingSpecApproval = false;
	let awaitingPublication = false;
	let awaitingTicketGeneration = false;
	let awaitingTicketApproval = false;
	let awaitingTicketPublication = false;
	let awaitingApprovedRevisionApproval = false;
	let awaitingApprovedRevisionPublication = false;
	let approvalConfirmation: "spec" | "tickets" | "revision" | undefined;
	const readOnlyEngramToolCallIds = new Set<string>();
	let teamListToolCallId: string | undefined;
	let availableTeams: ReadonlyMap<string, string> | undefined;

	function beginDefinition(domainAnchor: string): void {
		activeDefinitionId = dependencies.createDefinitionId();
		activeWorkflowStateId = randomBytes(32).toString("base64url");
		activeDomainAnchor = domainAnchor;
		awaitingDomainAnchor = false;
	}

	function handlePublicEntry(event: InputEvent): void {
		if (awaitingDomainAnchor) {
			const domainAnchor = event.text.trim();
			if (
				event.source === "interactive" &&
				event.streamingBehavior === undefined &&
				domainAnchor &&
				!domainAnchor.startsWith("/")
			)
				beginDefinition(domainAnchor);
			return;
		}
		const freshInteractiveResponse =
			event.source === "interactive" &&
			event.streamingBehavior === undefined &&
			event.text.trim().length > 0 &&
			!event.text.trim().startsWith("/");
		if (freshInteractiveResponse && awaitingConfirmation) {
			routeConfirmationAuthorized = true;
			return;
		}
		if (
			freshInteractiveResponse &&
			(awaitingSpecApproval ||
				awaitingTicketApproval ||
				awaitingApprovedRevisionApproval)
		) {
			approvalConfirmation = awaitingSpecApproval
				? "spec"
				: awaitingTicketApproval
					? "tickets"
					: "revision";
			if (awaitingSpecApproval) specInputAuthorized = true;
			return;
		}
		if (
			awaitingSpecInput &&
			event.source === "interactive" &&
			event.streamingBehavior === undefined &&
			event.text.trim() &&
			!event.text.trim().startsWith("/")
		) {
			specInputAuthorized = true;
			return;
		}
		const match = event.text.match(/^\/(?:skill:)?define-product(?:\s+(.*))?$/s);
		if (
			!match ||
			event.source !== "interactive" ||
			event.streamingBehavior !== undefined
		)
			return;
		clearActiveTurn();
		const domainAnchor = match[1]?.trim();
		if (domainAnchor) beginDefinition(domainAnchor);
		else awaitingDomainAnchor = true;
	}

	function clearActiveTurn(): void {
		activeDefinitionId = undefined;
		activeWorkflowStateId = undefined;
		activeDomainAnchor = undefined;
		activeSpecTeamId = undefined;
		approveSpecCommand = undefined;
		approvedSpecRef = undefined;
		publishedParentRef = undefined;
		approveTicketsCommand = undefined;
		approvedRevisionCommand = undefined;
		awaitingDomainAnchor = false;
		awaitingConfirmation = false;
		routeConfirmationAuthorized = false;
		explorationAvailable = false;
		awaitingSpecInput = false;
		specInputAuthorized = false;
		awaitingSpecApproval = false;
		awaitingPublication = false;
		awaitingTicketGeneration = false;
		awaitingTicketApproval = false;
		awaitingTicketPublication = false;
		awaitingApprovedRevisionApproval = false;
		awaitingApprovedRevisionPublication = false;
		approvalConfirmation = undefined;
		readOnlyEngramToolCallIds.clear();
		teamListToolCallId = undefined;
		availableTeams = undefined;
		dependencies.mcpPublication?.clear();
		dependencies.workflow.reset();
	}

	function hasActiveTurn(): boolean {
		return (
			activeDefinitionId !== undefined ||
			awaitingDomainAnchor ||
			awaitingConfirmation ||
			explorationAvailable ||
			awaitingSpecInput ||
			awaitingSpecApproval ||
			awaitingPublication ||
			awaitingTicketGeneration ||
			awaitingTicketApproval
			|| awaitingTicketPublication
			|| awaitingApprovedRevisionApproval
			|| awaitingApprovedRevisionPublication
			|| dependencies.mcpPublication?.hasActiveTurn() === true
		);
	}

	function shouldContinue(event: InputEvent): boolean {
		if (event.source !== "interactive" || event.streamingBehavior !== undefined)
			return false;
		if (awaitingSpecApproval)
			return event.text.trim().length > 0 && !event.text.trim().startsWith("/");
		if (awaitingTicketApproval || awaitingApprovedRevisionApproval)
			return event.text.trim().length > 0 && !event.text.trim().startsWith("/");
		return awaitingDomainAnchor || awaitingConfirmation || explorationAvailable || awaitingSpecInput || awaitingPublication || awaitingTicketGeneration || awaitingTicketPublication || awaitingApprovedRevisionPublication;
	}

	function systemPrompt(): string {
		if (awaitingDomainAnchor)
			return "Ask exactly: What product idea or problem should define the domain scope? Do not call tools.";
		const pending = dependencies.workflow.pendingRecommendation();
		if (awaitingApprovedRevisionPublication)
			return [
				"The durable Owner-approved revision is ready for publication.",
				`Call ${toolName} with only action="publish_approved_revision".`,
			].join(" ");
		if (awaitingApprovedRevisionApproval)
			return [
				"An exact approved-revision draft is ready for Owner review.",
				`After the Owner approves it naturally, call ${toolName} with only action="approve_approved_revision".`,
			].join(" ");
		if (awaitingTicketPublication) {
			return [
				"The exact durable Owner-approved ticket graph is ready for native publication.",
				`Call ${toolName} with only action="publish_tickets".`,
			].join(" ");
		}
		if (awaitingTicketApproval) {
			return [
				"The exact verified ticket graph is ready for Owner review.",
				`After the Owner approves it naturally, call ${toolName} with only action="approve_tickets".`,
				"Do not publish tickets yet.",
			].join(" ");
		}
		if (awaitingTicketGeneration) {
			return [
				"The exact published Delivery parent is ready for ticket-graph generation.",
				`Call ${toolName} with only action="to_tickets".`,
			].join(" ");
		}
		if (awaitingPublication) {
			const expected = dependencies.mcpPublication?.expectedModelCall();
			if (expected)
				return [
					"Continue the exact authenticated Linear MCP Delivery-parent publication.",
					`Call ${expected.toolName} exactly once with ${JSON.stringify(expected.input)}.`,
					"Do not add fields, reuse earlier calls, call tools in parallel, or expose protocol metadata.",
				].join(" ");
			return [
				"The exact product Spec is approved and ready for canonical publication.",
				`Call ${toolName} with only action="publish_spec"; the workflow reads the approved body from its private binding.`,
				"Treat any blocker as unsuccessful and recoverable; do not claim publication without verified Linear read-back.",
			].join(" ");
		}
		if (awaitingSpecApproval) {
			return [
				"An exact Spanish product Spec is ready for Owner review.",
				"Present the returned spec.body verbatim and in full before asking for approval; never summarize, paraphrase, or replace it with only the title.",
				"Interpret the Owner's natural-language response yourself; the runtime does not classify its wording.",
				`If the Owner approves, call ${toolName} with only action="approve_spec".`,
				`Treat an Agent-interpreted change request as feedback on the ready Spec: call ${toolName} with action="to_spec" and the revised semantic Spec fields, preserving unaffected content; reuse the exact privately retained Linear team, derive the title from the product task, and omit teamId.`,
				"Use professional neutral Spanish. If the response is ambiguous, ask a follow-up and do not call the workflow tool.",
				`If approve_spec returns status="spec-approved", immediately call ${toolName} once more with only action="publish_spec" in the same turn; do not ask for another human confirmation.`,
				"Do not claim publication until publish_spec returns verified success; report any blocker exactly.",
			].join(" ");
		}
		if (awaitingSpecInput && !specInputAuthorized) {
			return [
				"Verified research or exploration is complete for the active define-product session.",
				"Call linear_list_teams exactly once with limit=50 and orderBy=updatedAt. From its authenticated Linear MCP result, retain each immutable team ID privately, present the available team names as concise numbered options without internal IDs, ask the Owner to select one, then stop and wait for a fresh reply. Never require the Owner to type or recall a team name without first showing these options. Derive a concise Delivery-parent title yourself from the product task; never ask the Owner to provide a title.",
				`Do not call ${toolName} with action="to_spec" in the same turn that research or exploration completed.`,
				"When a later to_spec call returns spec-ready, present the returned spec.body verbatim and in full before asking for approval; never summarize, paraphrase, or replace it with only the title.",
				`If the Owner instead requests a prototype or design alternative and provides a focused comparison question, call ${toolName} with action="request_exploration" only; after it completes and the team is not already known, call linear_list_teams exactly once and present its team names as numbered options, then stop without calling to_spec in that same turn.`,
				"Use professional neutral Spanish in all Owner-facing wording.",
				"Report any blocker code and message exactly, stop, and never present a model-written fallback or unofficial Spec.",
			].join(" ");
		}
		if (awaitingSpecInput && specInputAuthorized) {
			return [
				activeSpecTeamId
					? "The Owner provided feedback on the ready Spec. Reuse the exact privately retained Linear team; do not ask the Owner to repeat or reconfirm it."
					: "A fresh interactive Owner reply identifies one of the authenticated Linear team options. Map the Owner's natural-language choice to that option's immutable ID; do not infer or invent an ID.",
				`Derive the title from the product task, then call ${toolName} exactly once with action="to_spec", that concise title, and the semantic Spanish Spec fields. Include teamId only when the runtime has not already retained the team from a ready Spec.`,
				"Use professional neutral Spanish in the Spec and all Owner-facing wording; avoid regional forms such as “aprobás” or “confirmás”.",
				"When revising a ready Spec, incorporate the Owner feedback and preserve all unaffected content.",
				"If the call returns spec-ready, present the returned spec.body verbatim and in full before asking the Owner for approval; never summarize, paraphrase, or replace it with only the title.",
				"Do not provide a definition ID, revision, target object, support artifact aliases, support artifact references, or any other workflow metadata; the runtime binds those privately.",
				`If the Owner instead requests a prototype or design alternative and provides a focused comparison question, call ${toolName} with action="request_exploration" only; after it completes and the team is not already known, call linear_list_teams exactly once and present its team names as numbered options, then stop without calling to_spec in that same turn.`,
				"Report any blocker code and message exactly, stop, and never present a model-written fallback or unofficial Spec.",
			].join(" ");
		}
		if (explorationAvailable) {
			return [
				"A recoverable define-product exploration is available.",
				`Call ${toolName} with action="request_exploration" and the exact intent and focus needed to resume it.`,
				"Report any blocker code and message exactly, stop, and never present a model-written fallback or unofficial Spec.",
			].join(" ");
		}
		if (!pending || !awaitingConfirmation) {
			return [
				"You are executing the implemented define-product workflow.",
				`Call ${toolName} exactly once with action="recommend_route" after you derive a structured assessment from the provided product idea.`,
				"Recommend wayfinder when clarity is unclear or breadth is broad; otherwise recommend grilling.",
				"After the tool returns, explain the recommendation briefly and ask the Owner to confirm naturally and provide the research question. Never show or request tokens, digests, IDs, revisions, schemas, or artifact references.",
				"Do not start research in the same turn.",
			].join(" ");
		}
		return [
			"You are resuming define-product after a route recommendation.",
			`The privately bound recommended route is ${pending.recommendedRoute}.`,
			`Call ${toolName} with action="confirm_route" and the researchQuestion only after the Owner explicitly confirms that route in natural language.`,
			"When research completes, call linear_list_teams exactly once with limit=50 and orderBy=updatedAt. Present the authenticated Linear MCP team names as concise numbered options without internal IDs, ask the Owner to select one, then stop; derive the Delivery-parent title yourself and never call to_spec in that same turn.",
			"Use professional neutral Spanish in all Owner-facing wording.",
			"Never show or request tokens, digests, IDs, revisions, schemas, or artifact references. If confirmation or the research question is missing, explain the requirement and stop.",
			"Report any blocker code and message exactly, stop, and never present a model-written fallback or unofficial Spec.",
		].join(" ");
	}

	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", () => {
			if (!hasActiveTurn()) return undefined;
			if (
				(awaitingSpecApproval || awaitingPublication) &&
				dependencies.mcpPublication
			) {
				const getActiveTools = (
					pi as { getActiveTools?: () => readonly string[] }
				).getActiveTools;
				const available = new Set(getActiveTools?.call(pi) ?? []);
				dependencies.mcpPublication.setMcpAvailable(
					dependencies.mcpPublication.allowedTools
						.filter((name) => name !== toolName)
						.every((name) => available.has(name)),
				);
			}
			return { systemPrompt: systemPrompt() };
		});
		pi.on("tool_call", (event) => {
			if (
				awaitingSpecInput &&
				activeSpecTeamId === undefined &&
				event.toolName === "linear_list_teams" &&
				hasExactKeys(event.input, ["limit", "orderBy"]) &&
				isRecord(event.input) &&
				event.input.limit === 50 &&
				event.input.orderBy === "updatedAt" &&
				typeof event.toolCallId === "string"
			) {
				teamListToolCallId = event.toolCallId;
				availableTeams = undefined;
			}
			if (isReadOnlyEngramCall(event)) {
				if (typeof event.toolCallId === "string")
					readOnlyEngramToolCallIds.add(event.toolCallId);
				return undefined;
			}
			return dependencies.mcpPublication?.handleToolCall(event);
		});
		pi.on("tool_result", async (event) => {
			if (
				event.toolName === "linear_list_teams" &&
				typeof event.toolCallId === "string" &&
				event.toolCallId === teamListToolCallId
			) {
				teamListToolCallId = undefined;
				availableTeams = linearTeamOptions(toolResultPayload(event));
				return undefined;
			}
			if (
				typeof event.toolCallId === "string" &&
				readOnlyEngramToolCallIds.delete(event.toolCallId)
			)
				return undefined;
			const publication = dependencies.mcpPublication;
			if (!publication) return undefined;
			const processed = await publication.handleToolResult(event);
			if (!processed) return undefined;
			const instruction = publication.nextCallInstruction();
			if (!instruction) return undefined;
			return {
				content: [
					...event.content,
					{ type: "text" as const, text: instruction },
				],
			};
		});
		pi.on("session_start", async () => {
			clearActiveTurn();
			const recovery = await dependencies.workflow.restoreRecovery?.();
			if (!recovery) return;
			activeDefinitionId = recovery.definitionId;
			explorationAvailable = recovery.phase === "exploration";
			awaitingSpecApproval = recovery.phase === "spec-approval";
			awaitingPublication = recovery.phase === "publication";
			awaitingTicketApproval = recovery.phase === "ticket-approval";
			awaitingTicketPublication = recovery.phase === "ticket-publication";
			awaitingApprovedRevisionApproval =
				recovery.phase === "approved-revision-approval";
			awaitingApprovedRevisionPublication =
				recovery.phase === "approved-revision-publication";
			if (recovery.phase === "spec-approval") {
				approveSpecCommand = structuredClone(recovery.command);
				activeSpecTeamId = recovery.command.target.teamId;
			}
			if (recovery.phase === "publication")
				approvedSpecRef = structuredClone(recovery.approvedSpecRef);
			if (recovery.phase === "ticket-approval")
				approveTicketsCommand = structuredClone(recovery.command);
			if (
				recovery.phase === "approved-revision-approval" ||
				recovery.phase === "approved-revision-publication"
			) {
				approvedRevisionCommand = {
					kind:
						recovery.phase === "approved-revision-approval"
							? "approve-approved-revision"
							: "publish-approved-revision",
					definitionId: recovery.definitionId,
					digest: recovery.digest,
				};
			}
		});
		pi.on("session_shutdown", clearActiveTurn);
		const registerTool = (pi as { registerTool?: (tool: unknown) => void })
			.registerTool;
		registerTool?.({
			name: toolName,
			label: "Define Product Workflow",
			description:
				"Execute package-owned define-product routing, exploration, exact Spanish Spec generation, or Owner approval.",
			parameters: defineProductParameters as never,
			async execute(toolCallId: string, params: DefineProductToolParams) {
				if (
					params.action === "recommend_route" &&
					activeDefinitionId === undefined
				) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
							`${toolName} is available only during an active define-product turn.`,
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				const suppliedDefinitionId = isRecord(params)
					? params.definitionId
					: undefined;
				if (
					params.action === "recommend_route" &&
					suppliedDefinitionId !== undefined &&
					suppliedDefinitionId !== activeDefinitionId
				) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_DEFINITION_ID_MISMATCH",
							"The supplied definition ID does not match the active define-product session.",
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				if (
					params.action === "to_spec" &&
					activeDefinitionId === undefined
				) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
							"Spec generation requires an active define-product session.",
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				if (
					params.action === "to_spec" &&
					((!explorationAvailable && activeSpecTeamId === undefined) ||
						(!awaitingSpecInput && !awaitingSpecApproval) ||
						!specInputAuthorized)
				) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
							"Spec generation requires a fresh interactive non-streaming Owner reply confirming the Linear team after research, or Owner feedback on the ready Spec.",
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				if (
					params.action === "approve_spec" &&
					!awaitingSpecApproval &&
					approvalConfirmation === "spec" &&
					activeDefinitionId !== undefined
				) {
					const recovery = await dependencies.workflow.restoreRecovery?.();
					if (
						recovery?.phase === "spec-approval" &&
						recovery.definitionId === activeDefinitionId
					) {
						approveSpecCommand = structuredClone(recovery.command);
						activeSpecTeamId = recovery.command.target.teamId;
						awaitingSpecInput = false;
						specInputAuthorized = false;
						awaitingSpecApproval = true;
					}
				}
				if (params.action === "approve_spec" && !awaitingSpecApproval) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
							"Spec approval requires the active exact Spec generated in this session.",
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				if (params.action === "publish_spec" && !awaitingPublication) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
							"Publication requires the approved Spec from the active define-product session.",
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				if (params.action === "to_tickets" && !awaitingTicketGeneration) {
					const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_PARENT_STALE", "Ticket generation requires the current published Delivery parent.") };
					return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
				}
				if (params.action === "approve_tickets" && !awaitingTicketApproval) {
					const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket approval requires the active exact verified ticket graph.") };
					return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
				}
				if (params.action === "publish_tickets" && !awaitingTicketPublication) {
					const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket publication requires the current durable Owner-approved graph.") };
					return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
				}
				if (params.action === "approve_approved_revision" && !awaitingApprovedRevisionApproval) {
					const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_APPROVAL_REQUIRED", "Approved revision approval requires the active durable draft.") };
					return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
				}
				if (params.action === "publish_approved_revision" && !awaitingApprovedRevisionPublication) {
					const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_APPROVAL_REQUIRED", "Approved revision publication requires the active durable approval.") };
					return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
				}
				if (params.action === "request_exploration" && !explorationAvailable) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
							"Exploration requires verified research from the active define-product session.",
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				if (
					params.action === "confirm_route" &&
					(!awaitingConfirmation || !routeConfirmationAuthorized)
				) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
							`${toolName} can confirm a route only after an active recommendation turn.`,
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				const definitionId = activeDefinitionId;
				if (params.action === "recommend_route" && definitionId === undefined) {
					const outcome: DefineProductOutcome = {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
							`${toolName} is missing the active define-product definition context.`,
						),
					};
					return {
						content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
						details: outcome,
					};
				}
				let command: DefineProductCommand;
				if (params.action === "recommend_route") {
					command = {
						kind: "recommend-route",
						definitionId: definitionId as string,
						domainAnchor: activeDomainAnchor ?? "",
						assessment: params.assessment as Assessment,
						workflowStateId: activeWorkflowStateId ?? "",
					};
				} else if (params.action === "confirm_route") {
					routeConfirmationAuthorized = false;
					const pending = dependencies.workflow.pendingRecommendation();
					command = {
						kind: "confirm-route",
						recommendationRef: pending?.digest ?? "",
						confirmationToken: pending?.confirmationToken ?? "",
						confirmedRoute: pending?.recommendedRoute as Route,
						researchQuestion: params.researchQuestion ?? "",
						workflowStateId: activeWorkflowStateId ?? "",
					};
				} else if (params.action === "request_exploration") {
					specInputAuthorized = false;
					command = {
						kind: "request-exploration",
						definitionId: activeDefinitionId ?? "",
						intent: params.intent ?? "prototype",
						focus: params.focus ?? "",
					};
				} else if (params.action === "to_spec") {
					specInputAuthorized = false;
					approvalConfirmation = undefined;
					if (
						dependencies.mcpPublication &&
						activeSpecTeamId === undefined &&
						(typeof params.teamId !== "string" ||
							!availableTeams?.has(params.teamId))
					) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
								"Spec generation requires an exact immutable Linear team ID from the authenticated options presented in this active turn.",
							),
						};
						return {
							content: [
								{ type: "text", text: JSON.stringify(outcome, null, 2) },
							],
							details: outcome,
						};
					}
					const parsed = parseToSpecCommand(
						params,
						activeDefinitionId ?? "",
						activeSpecTeamId,
					);
					if (!parsed) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
								"The Spec generation input shape is invalid.",
							),
						};
						return {
							content: [
								{ type: "text", text: JSON.stringify(outcome, null, 2) },
							],
							details: outcome,
						};
					}
					command = parsed;
				} else if (params.action === "approve_spec") {
					const confirmation = approvalConfirmation;
					approvalConfirmation = undefined;
					if (
						!hasExactKeys(params, ["action"]) ||
						!approveSpecCommand ||
						confirmation !== "spec"
					) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
								"Spec approval requires the exact private binding for the active Spec.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = structuredClone(approveSpecCommand);
				} else if (params.action === "publish_spec") {
					if (!hasExactKeys(params, ["action"]) || !activeDefinitionId) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
								"Spec publication requires the active workflow-owned approval.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					if (dependencies.mcpPublication) {
						const outcome = dependencies.mcpPublication.hasActiveTurn()
							? await dependencies.mcpPublication.complete(params)
							: await dependencies.mcpPublication.begin(
									activeDefinitionId,
									toolCallId,
									params,
								);
						if (outcome.status === "spec-published") {
							awaitingPublication = false;
							publishedParentRef = structuredClone(outcome.parentRef);
							if (approvedSpecRef) awaitingTicketGeneration = true;
							else clearActiveTurn();
						}
						const exposedOutcome = publicOutcome(outcome as DefineProductOutcome);
						return {
							content: [
								{ type: "text", text: JSON.stringify(exposedOutcome, null, 2) },
							],
							details: exposedOutcome,
						};
					}
					command = { kind: "publish-spec", definitionId: activeDefinitionId };
				} else if (params.action === "to_tickets") {
					if (
						!hasExactKeys(params, ["action"]) ||
						!activeDefinitionId ||
						!approvedSpecRef ||
						!publishedParentRef
					) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_TICKET_PARENT_STALE",
								"Ticket generation requires the exact private approved-Spec and published-parent bindings.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = {
						kind: "to-tickets",
						definitionId: activeDefinitionId,
						approvedSpecRef: structuredClone(approvedSpecRef),
						parentRef: structuredClone(publishedParentRef),
					};
				} else if (params.action === "approve_tickets") {
					const confirmation = approvalConfirmation;
					approvalConfirmation = undefined;
					if (
						!hasExactKeys(params, ["action"]) ||
						!approveTicketsCommand ||
						confirmation !== "tickets"
					) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_TICKET_APPROVAL_MISMATCH",
								"Ticket approval requires the exact private verified-graph binding.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = structuredClone(approveTicketsCommand);
				} else if (params.action === "publish_tickets") {
					if (!hasExactKeys(params, ["action"]) || !activeDefinitionId) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_TICKET_APPROVAL_MISMATCH",
								"Ticket publication requires the active workflow-owned approval.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = { kind: "publish-tickets", definitionId: activeDefinitionId };
				} else if (params.action === "to_approved_revision") {
					const parsed = activeDefinitionId
						? parseApprovedRevisionDraftCommand(params, activeDefinitionId)
						: undefined;
					if (!parsed) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
								"Approved revision drafting requires the active private definition binding and valid domain input.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = parsed;
				} else if (params.action === "approve_approved_revision") {
					const confirmation = approvalConfirmation;
					approvalConfirmation = undefined;
					if (
						!hasExactKeys(params, ["action"]) ||
						approvedRevisionCommand?.kind !== "approve-approved-revision" ||
						confirmation !== "revision"
					) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
								"Approved revision approval requires the exact private draft binding.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = structuredClone(approvedRevisionCommand);
				} else {
					if (
						!hasExactKeys(params, ["action"]) ||
						approvedRevisionCommand?.kind !== "publish-approved-revision"
					) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
								"Approved revision publication requires the exact private approved binding.",
							),
						};
						return {
							content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
							details: outcome,
						};
					}
					command = structuredClone(approvedRevisionCommand);
				}
				const outcome = await dependencies.workflow.advance(command);
				if (outcome.status === "awaiting-confirmation") {
					awaitingConfirmation = true;
					routeConfirmationAuthorized = false;
				} else if (
					command.kind === "confirm-route" &&
					outcome.status === "completed" &&
					outcome.result.status === "completed"
				) {
					awaitingConfirmation = false;
					routeConfirmationAuthorized = false;
					explorationAvailable = true;
					awaitingSpecInput = true;
					specInputAuthorized = false;
				} else if (
					command.kind === "request-exploration" &&
					outcome.status === "completed" &&
					outcome.result.status === "completed"
				) {
					explorationAvailable = true;
					awaitingSpecInput = true;
					specInputAuthorized = false;
				} else if (
					command.kind === "to-spec" &&
					outcome.status === "spec-ready"
				) {
					activeSpecTeamId = outcome.spec.payload.target.teamId;
					approveSpecCommand = {
						kind: "approve-spec",
						target: structuredClone(outcome.spec.payload.target),
						revision: outcome.spec.payload.revision,
						digest: outcome.spec.digest,
					};
					explorationAvailable = false;
					awaitingSpecInput = false;
					specInputAuthorized = false;
					approvalConfirmation = undefined;
					awaitingSpecApproval = true;
				} else if (
					command.kind === "approve-spec" &&
					outcome.status === "spec-approved"
				) {
					approveSpecCommand = undefined;
					approvedSpecRef = structuredClone(outcome.approvedSpecRef);
					awaitingSpecApproval = false;
					awaitingPublication = true;
				} else if (
					command.kind === "publish-spec" &&
					outcome.status === "spec-published"
				) {
					awaitingPublication = false;
					publishedParentRef = structuredClone(outcome.parentRef);
					if (approvedSpecRef) awaitingTicketGeneration = true;
					else clearActiveTurn();
				} else if (
					command.kind === "to-tickets" &&
					outcome.status === "tickets-ready"
				) {
					approveTicketsCommand = {
						kind: "approve-tickets",
						definitionId: command.definitionId,
						parentRef: structuredClone(command.parentRef),
						graphRef: structuredClone(outcome.graphRef),
						digest: outcome.graph.digest,
					};
					awaitingTicketGeneration = false;
					awaitingTicketApproval = true;
				} else if (
					command.kind === "approve-tickets" &&
					outcome.status === "tickets-approved"
				) {
					approveTicketsCommand = undefined;
					awaitingTicketApproval = false;
					awaitingTicketPublication = true;
				} else if (
					command.kind === "publish-tickets" &&
					outcome.status === "tickets-published"
				) {
					clearActiveTurn();
				} else if (
					command.kind === "to-approved-revision" &&
					outcome.status === "revision-ready"
				) {
					if (
						outcome.revision.definitionId !== command.definitionId ||
						!outcome.revision.digest
					) clearActiveTurn();
					else {
						approvedRevisionCommand = {
							kind: "approve-approved-revision",
							definitionId: outcome.revision.definitionId,
							digest: outcome.revision.digest,
						};
						explorationAvailable = false;
						awaitingApprovedRevisionApproval = true;
					}
				} else if (
					command.kind === "approve-approved-revision" &&
					outcome.status === "revision-approved"
				) {
					if (
						outcome.revision.definitionId !== command.definitionId ||
						!outcome.revision.digest
					) clearActiveTurn();
					else {
						approvedRevisionCommand = {
							kind: "publish-approved-revision",
							definitionId: outcome.revision.definitionId,
							digest: outcome.revision.digest,
						};
						awaitingApprovedRevisionApproval = false;
						awaitingApprovedRevisionPublication = true;
					}
				} else if (
					command.kind === "publish-approved-revision" &&
					outcome.status === "revision-published"
				) {
					clearActiveTurn();
				} else if (
					command.kind !== "request-exploration" &&
					command.kind !== "to-spec" &&
					command.kind !== "approve-spec" &&
					command.kind !== "publish-spec" &&
					command.kind !== "to-tickets" &&
					command.kind !== "approve-tickets" &&
					command.kind !== "to-approved-revision" &&
					command.kind !== "approve-approved-revision" &&
					command.kind !== "publish-tickets" &&
					command.kind !== "publish-approved-revision"
				) {
					clearActiveTurn();
				}
				const exposedOutcome = publicOutcome(outcome);
				return {
					content: [{ type: "text", text: JSON.stringify(exposedOutcome, null, 2) }],
					details: exposedOutcome,
				};
			},
		} as never);
	}

	return {
		toolName,
		allowedTools: dependencies.mcpPublication?.allowedTools ?? [toolName],
		handlePublicEntry,
		register,
		shouldContinue,
		hasActiveTurn,
	};
}
