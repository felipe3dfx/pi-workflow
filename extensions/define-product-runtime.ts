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

const toolName = "workflow_define_product";

const artifactRefParameters = {
	type: "object",
	additionalProperties: false,
	properties: {
		kind: { type: "string", enum: ["engram"] },
		project: { type: "string" },
		topic: { type: "string" },
		revision: { type: "string" },
		schema: { type: "string", enum: ["approved-spec", "delivery-parent", "delivery-ticket-graph"] },
		schemaVersion: { type: "number", enum: [1] },
		digest: { type: "string" },
	},
	required: ["kind", "project", "topic", "revision", "schema", "schemaVersion", "digest"],
} as const;

const sharedActionProperties = {
	definitionId: { type: "string" },
	domainAnchor: { type: "string" },
	assessment: {
		type: "object",
		additionalProperties: false,
		properties: {
			clarity: { type: "string", enum: ["clear", "unclear"] },
			breadth: { type: "string", enum: ["narrow", "broad"] },
			reasons: { type: "array", items: { type: "string" } },
		},
		required: ["clarity", "breadth", "reasons"],
	},
	recommendationRef: { type: "string" },
	confirmationToken: { type: "string", minLength: 43, maxLength: 43 },
	confirmedRoute: { type: "string", enum: ["wayfinder", "grilling"] },
	researchQuestion: { type: "string" },
	intent: { type: "string", enum: ["prototype", "design-alternative"] },
	focus: { type: "string" },
	target: {
		type: "object",
		additionalProperties: false,
		properties: {
			kind: { type: "string", enum: ["linear-parent-description"] },
			teamId: { type: "string" },
			title: { type: "string" },
		},
		required: ["kind", "teamId", "title"],
	},
	revision: { type: "string" },
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
	supportArtifactAliases: { type: "array", items: { type: "string" } },
	digest: { type: "string" },
} as const;

const defineProductParameters = {
	type: "object",
	properties: {
		action: {
			type: "string",
			enum: [
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
			],
		},
		...sharedActionProperties,
		approvedSpecRef: artifactRefParameters,
		parentRef: artifactRefParameters,
		graphRef: artifactRefParameters,
	},
	required: ["action"],
	oneOf: [
		{
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string", enum: ["recommend_route", "confirm_route", "request_exploration", "to_spec", "approve_spec", "publish_spec"] },
				...sharedActionProperties,
			},
			required: ["action"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: { action: { const: "to_tickets" }, approvedSpecRef: artifactRefParameters, parentRef: artifactRefParameters },
			required: ["action", "approvedSpecRef", "parentRef"],
		},
			{
				type: "object",
				additionalProperties: false,
				properties: { action: { const: "approve_tickets" }, parentRef: artifactRefParameters, graphRef: artifactRefParameters, digest: { type: "string" } },
				required: ["action", "parentRef", "graphRef", "digest"],
			},
			{
				type: "object",
				additionalProperties: false,
				properties: { action: { const: "publish_tickets" }, definitionId: { type: "string" } },
				required: ["action", "definitionId"],
			},
			{
			type: "object",
			additionalProperties: false,
			properties: { action: { const: "to_approved_revision" }, definitionId: { type: "string" }, revisionKind: { type: "string" }, affectedIssues: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, nextDescription: { type: "string" } }, required: ["id", "nextDescription"] } }, sourceCommentKind: { type: "string" }, sourceCommentBody: { type: "string" }, decisionGap: { type: "object", additionalProperties: false, properties: { issueId: { type: "string" }, body: { type: "string" } }, required: ["issueId", "body"] } },
			required: ["action", "definitionId", "revisionKind", "affectedIssues", "sourceCommentKind", "sourceCommentBody"],
		},
		{
			type: "object",
			additionalProperties: false,
			properties: { action: { const: "approve_approved_revision" }, definitionId: { type: "string" }, digest: { type: "string" } },
			required: ["action", "definitionId", "digest"],
		},
		{
				type: "object",
				additionalProperties: false,
				properties: { action: { const: "publish_approved_revision" }, definitionId: { type: "string" }, digest: { type: "string" } },
				required: ["action", "definitionId", "digest"],
			},
	],
} as const;

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
	definitionId?: string;
	domainAnchor?: string;
	assessment?: Assessment;
	recommendationRef?: string;
	confirmationToken?: string;
	confirmedRoute?: Route;
	researchQuestion?: string;
	intent?: "prototype" | "design-alternative";
	focus?: string;
	target?: ProductSpecInput["target"];
	revision?: string;
	problem?: string;
	solution?: string;
	userStories?: ProductSpecInput["userStories"];
	decisions?: ProductSpecInput["decisions"];
	tests?: ProductSpecInput["tests"];
	outOfScope?: ProductSpecInput["outOfScope"];
	supportArtifactAliases?: readonly string[];
	digest?: string;
	approvedSpecRef?: unknown;
	parentRef?: unknown;
	graphRef?: unknown;
	revisionKind?: string;
	affectedIssues?: unknown;
	sourceCommentKind?: string;
	sourceCommentBody?: string;
	decisionGap?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
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
): DefineProductCommand | undefined {
	if (!isRecord(params.target)) return undefined;
	const target = params.target;
	const userStories = stringArray(params.userStories);
	const tests = stringArray(params.tests);
	const outOfScope = stringArray(params.outOfScope);
	const supportArtifactAliases = stringArray(params.supportArtifactAliases);
	if (
		target.kind !== "linear-parent-description" ||
		typeof target.teamId !== "string" ||
		typeof target.title !== "string" ||
		typeof params.revision !== "string" ||
		typeof params.problem !== "string" ||
		typeof params.solution !== "string" ||
		!userStories ||
		!tests ||
		!outOfScope ||
		!supportArtifactAliases ||
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
		target: {
			kind: "linear-parent-description",
			teamId: target.teamId,
			title: target.title,
		},
		revision: params.revision,
		problem: params.problem,
		solution: params.solution,
		userStories,
		decisions,
		tests,
		outOfScope,
		supportArtifactAliases,
	};
}

function parseApproveSpecCommand(
	params: DefineProductToolParams,
): DefineProductCommand | undefined {
	if (
		!isRecord(params.target) ||
		params.target.kind !== "linear-parent-description" ||
		typeof params.target.teamId !== "string" ||
		typeof params.target.title !== "string" ||
		typeof params.revision !== "string" ||
		typeof params.digest !== "string"
	) {
		return undefined;
	}
	return {
		kind: "approve-spec",
		target: {
			kind: "linear-parent-description",
			teamId: params.target.teamId,
			title: params.target.title,
		},
		revision: params.revision,
		digest: params.digest,
	};
}

function parseArtifactRef(value: unknown, schema: VerifiedArtifactRef["schema"]): VerifiedArtifactRef | undefined {
	const keys = ["kind", "project", "topic", "revision", "schema", "schemaVersion", "digest"];
	if (
		!isRecord(value) ||
		Object.keys(value).length !== keys.length ||
		!keys.every((key) => key in value) ||
		value.kind !== "engram" ||
		value.schema !== schema ||
		value.schemaVersion !== 1 ||
		typeof value.project !== "string" ||
		typeof value.topic !== "string" ||
		typeof value.revision !== "string" ||
		typeof value.digest !== "string"
	) return undefined;
	return value as unknown as VerifiedArtifactRef;
}

function parseToTicketsCommand(params: DefineProductToolParams, definitionId: string): DefineProductCommand | undefined {
	if (!hasExactKeys(params, ["action", "approvedSpecRef", "parentRef"])) return undefined;
	const approvedSpecRef = parseArtifactRef(params.approvedSpecRef, "approved-spec");
	const parentRef = parseArtifactRef(params.parentRef, "delivery-parent");
	return approvedSpecRef && parentRef
		? { kind: "to-tickets", definitionId, approvedSpecRef, parentRef }
		: undefined;
}

function parseApproveTicketsCommand(params: DefineProductToolParams, definitionId: string): DefineProductCommand | undefined {
	if (!hasExactKeys(params, ["action", "parentRef", "graphRef", "digest"])) return undefined;
	const parentRef = parseArtifactRef(params.parentRef, "delivery-parent");
	const graphRef = parseArtifactRef(params.graphRef, "delivery-ticket-graph");
	return parentRef && graphRef && typeof params.digest === "string"
		? { kind: "approve-tickets", definitionId, parentRef, graphRef, digest: params.digest }
		: undefined;
}

function parseApprovedRevisionDraftCommand(params: DefineProductToolParams, definitionId: string): DefineProductCommand | undefined {
	if (typeof params.revisionKind !== "string" || typeof params.sourceCommentKind !== "string" || typeof params.sourceCommentBody !== "string" || !Array.isArray(params.affectedIssues)) return undefined;
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
}

export function createDefineProductRuntime(
	dependencies: DefineProductRuntimeDependencies,
) {
	let activeDefinitionId: string | undefined;
	let activeWorkflowStateId: string | undefined;
	let awaitingConfirmation = false;
	let explorationAvailable = false;
	let awaitingSpecApproval = false;
	let awaitingPublication = false;
	let awaitingTicketGeneration = false;
	let awaitingTicketApproval = false;
	let awaitingTicketPublication = false;
	let awaitingApprovedRevisionApproval = false;
	let awaitingApprovedRevisionPublication = false;
	let recoveredApprovedRevisionDigest: string | undefined;

	function handlePublicEntry(event: InputEvent): void {
		if (!event.text.match(/^\/(?:skill:)?define-product(?:\s|$)/)) return;
		clearActiveTurn();
		activeDefinitionId = dependencies.createDefinitionId();
		activeWorkflowStateId = randomBytes(32).toString("base64url");
	}

	function clearActiveTurn(): void {
		activeDefinitionId = undefined;
		activeWorkflowStateId = undefined;
		awaitingConfirmation = false;
		explorationAvailable = false;
		awaitingSpecApproval = false;
		awaitingPublication = false;
		awaitingTicketGeneration = false;
		awaitingTicketApproval = false;
		awaitingTicketPublication = false;
		awaitingApprovedRevisionApproval = false;
		awaitingApprovedRevisionPublication = false;
		recoveredApprovedRevisionDigest = undefined;
		dependencies.workflow.reset();
	}

	function hasActiveTurn(): boolean {
		return (
			activeDefinitionId !== undefined ||
			awaitingConfirmation ||
			explorationAvailable ||
			awaitingSpecApproval ||
			awaitingPublication ||
			awaitingTicketGeneration ||
			awaitingTicketApproval
			|| awaitingTicketPublication
			|| awaitingApprovedRevisionApproval
			|| awaitingApprovedRevisionPublication
		);
	}

	function shouldContinue(event: InputEvent): boolean {
		return (
			(awaitingConfirmation || explorationAvailable || awaitingSpecApproval || awaitingPublication || awaitingTicketGeneration || awaitingTicketApproval || awaitingTicketPublication || awaitingApprovedRevisionApproval || awaitingApprovedRevisionPublication) &&
			event.source === "interactive" &&
			event.streamingBehavior === undefined
		);
	}

	function systemPrompt(): string {
		const pending = dependencies.workflow.pendingRecommendation();
		if (awaitingApprovedRevisionPublication) return `The durable Owner-approved revision is ready. Call ${toolName} with action="publish_approved_revision", definitionId="${activeDefinitionId}", and digest="${recoveredApprovedRevisionDigest}" exactly.`;
		if (awaitingApprovedRevisionApproval) return `The durable approved-revision draft is ready for Owner approval. Call ${toolName} with action="approve_approved_revision", definitionId="${activeDefinitionId}", and digest="${recoveredApprovedRevisionDigest}" exactly.`;
		if (awaitingTicketPublication) {
			return [
				"The exact durable Owner-approved ticket graph is ready for native publication.",
				`Call ${toolName} with action="publish_tickets" and only the recovered definitionId.`,
				"Do not supply ticket content, approval, authority, permissions, or digests.",
			].join(" ");
		}
		if (awaitingTicketApproval) {
			return [
				"The exact verified ticket graph is ready for Owner approval.",
				`Call ${toolName} with action="approve_tickets" only with the exact parentRef, graphRef, and digest returned by the current graph.`,
				"Do not publish tickets or reconstruct artifact references.",
			].join(" ");
		}
		if (awaitingTicketGeneration) {
			return [
				"The exact published Delivery parent is ready for ticket-graph generation.",
				`Call ${toolName} with action="to_tickets" only with the exact approvedSpecRef and parentRef returned by the workflow.`,
				"Do not reconstruct references or publish tickets.",
			].join(" ");
		}
		if (awaitingPublication) {
			return [
				"The exact product Spec is approved and ready for canonical publication.",
				`Call ${toolName} with action="publish_spec" without supplying Spec content; the workflow reads the approved body directly from Engram.`,
				"Treat any blocker as unsuccessful and recoverable; do not claim publication without verified Linear read-back.",
			].join(" ");
		}
		if (awaitingSpecApproval) {
			return [
				"An exact Spanish product Spec is ready for Owner approval.",
				`Call ${toolName} with action="approve_spec" only after the Owner approves the exact target, revision, and digest returned by the current Spec.`,
				"Do not publish or mutate Linear; publication belongs to the later publication workflow.",
			].join(" ");
		}
		if (explorationAvailable) {
			return [
				"Verified research is available for the active define-product session.",
				`Call ${toolName} with action="request_exploration" only when the Owner requests either a prototype or a design alternative and provides a focused comparison question; call action="to_spec" when the settled inputs are ready for the exact Spanish Spec.`,
				"Do not request or reveal internal runtime IDs, artifact topics, or raw workflow history.",
			].join(" ");
		}
		if (!pending || !awaitingConfirmation) {
			return [
				"You are executing the implemented define-product workflow.",
				`Call ${toolName} exactly once with action="recommend_route" after you derive a structured assessment from the provided product idea.`,
				"Recommend wayfinder when clarity is unclear or breadth is broad; otherwise recommend grilling.",
				"After the tool returns, explain the recommendation briefly and ask the Owner to confirm the exact route and provide the research question.",
				"Do not start research in the same turn.",
			].join(" ");
		}
		return [
			"You are resuming define-product after a route recommendation.",
			`Current recommendation digest: ${pending.digest}.`,
			`Recommended route: ${pending.recommendedRoute}.`,
			`Call ${toolName} with action="confirm_route" only after the Owner explicitly confirms that exact route, provides the research question, and supplies the confirmationToken from the current recommendation response.`,
			"If the confirmation is missing or mismatched, explain the requirement and stop.",
		].join(" ");
	}

	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", () => {
			if (!hasActiveTurn()) return undefined;
			return { systemPrompt: systemPrompt() };
		});
		pi.on("session_start", async () => {
			clearActiveTurn();
			const recovery = await dependencies.workflow.restoreRecovery?.();
			if (recovery) {
				activeDefinitionId = recovery.definitionId;
				explorationAvailable = recovery.phase === "exploration";
				awaitingSpecApproval = recovery.phase === "spec-approval";
				awaitingPublication = recovery.phase === "publication";
					awaitingTicketApproval = recovery.phase === "ticket-approval";
					awaitingTicketPublication = recovery.phase === "ticket-publication";
					awaitingApprovedRevisionApproval = recovery.phase === "approved-revision-approval";
					awaitingApprovedRevisionPublication = recovery.phase === "approved-revision-publication";
					recoveredApprovedRevisionDigest = recovery.phase === "approved-revision-approval" || recovery.phase === "approved-revision-publication" ? recovery.digest : undefined;
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
			async execute(_toolCallId: string, params: DefineProductToolParams) {
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
				if (
					params.action === "recommend_route" &&
					params.definitionId !== undefined &&
					params.definitionId !== activeDefinitionId
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
				if (params.action === "confirm_route" && !awaitingConfirmation) {
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
						domainAnchor: params.domainAnchor ?? "",
						assessment: params.assessment as Assessment,
						workflowStateId: activeWorkflowStateId ?? "",
					};
				} else if (params.action === "confirm_route") {
					command = {
						kind: "confirm-route",
						recommendationRef: params.recommendationRef ?? "",
						confirmationToken: params.confirmationToken ?? "",
						confirmedRoute: params.confirmedRoute as Route,
						researchQuestion: params.researchQuestion ?? "",
						workflowStateId: activeWorkflowStateId ?? "",
					};
				} else if (params.action === "request_exploration") {
					command = {
						kind: "request-exploration",
						definitionId: activeDefinitionId ?? "",
						intent: params.intent ?? "prototype",
						focus: params.focus ?? "",
					};
				} else if (params.action === "to_spec") {
					const parsed = parseToSpecCommand(
						params,
						activeDefinitionId ?? "",
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
					const parsed = parseApproveSpecCommand(params);
					if (!parsed) {
						const outcome: DefineProductOutcome = {
							status: "blocked",
							blocker: createBlocker(
								"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
								"The Spec approval input shape is invalid.",
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
					} else if (params.action === "to_tickets") {
						const parsed = parseToTicketsCommand(params, activeDefinitionId ?? "");
						if (!parsed) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_ARTIFACT_INVALID", "Ticket generation requires exact approved-Spec and Delivery-parent references.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						command = parsed;
					} else if (params.action === "approve_tickets") {
						const parsed = parseApproveTicketsCommand(params, activeDefinitionId ?? "");
						if (!parsed) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket approval requires exact parent and graph references.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						command = parsed;
					} else if (params.action === "publish_tickets") {
						if (!hasExactKeys(params, ["action", "definitionId"]) || params.definitionId !== activeDefinitionId) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket publication requires only the active recovered definition ID.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						command = { kind: "publish-tickets", definitionId: activeDefinitionId as string };
					} else if (params.action === "to_approved_revision") {
						if (params.definitionId !== activeDefinitionId) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_ARTIFACT_INVALID", "Approved revision drafting requires the active definition ID.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						const parsed = parseApprovedRevisionDraftCommand(params, activeDefinitionId ?? "");
						if (!parsed) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_ARTIFACT_INVALID", "Approved revision draft input is invalid.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						command = parsed;
					} else if (params.action === "approve_approved_revision") {
						if (!hasExactKeys(params, ["action", "definitionId", "digest"]) || typeof params.digest !== "string" || params.definitionId !== activeDefinitionId || (recoveredApprovedRevisionDigest !== undefined && params.digest !== recoveredApprovedRevisionDigest)) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_ARTIFACT_INVALID", "Approved revision approval requires only the active definition ID and exact digest.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						command = { kind: "approve-approved-revision", definitionId: activeDefinitionId as string, digest: params.digest };
					} else if (params.action === "publish_approved_revision") {
						if (!hasExactKeys(params, ["action", "definitionId", "digest"]) || typeof params.digest !== "string" || params.definitionId !== activeDefinitionId || (recoveredApprovedRevisionDigest !== undefined && params.digest !== recoveredApprovedRevisionDigest)) {
							const outcome: DefineProductOutcome = { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_ARTIFACT_INVALID", "Approved revision publication requires only the active definition ID and exact digest.") };
							return { content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }], details: outcome };
						}
						command = { kind: "publish-approved-revision", definitionId: activeDefinitionId as string, digest: params.digest };
					} else {
					command = { kind: "publish-spec", definitionId: activeDefinitionId ?? "" };
				}
				const outcome = await dependencies.workflow.advance(command);
				if (outcome.status === "awaiting-confirmation") {
					awaitingConfirmation = true;
				} else if (
					command.kind === "confirm-route" &&
					outcome.status === "completed" &&
					outcome.result.status === "completed"
				) {
					awaitingConfirmation = false;
					explorationAvailable = true;
				} else if (
					command.kind === "to-spec" &&
					outcome.status === "spec-ready"
				) {
					awaitingSpecApproval = true;
				} else if (
					command.kind === "approve-spec" &&
					outcome.status === "spec-approved"
				) {
					awaitingSpecApproval = false;
					awaitingPublication = true;
					} else if (command.kind === "publish-spec" && outcome.status === "spec-published") {
						awaitingPublication = false;
						awaitingTicketGeneration = true;
					} else if (command.kind === "to-tickets" && outcome.status === "tickets-ready") {
						awaitingTicketGeneration = false;
						awaitingTicketApproval = true;
					} else if (command.kind === "approve-tickets" && outcome.status === "tickets-approved") {
						awaitingTicketApproval = false;
						awaitingTicketPublication = true;
					} else if (command.kind === "publish-tickets" && outcome.status === "tickets-published") {
						clearActiveTurn();
					} else if (command.kind === "to-approved-revision" && outcome.status === "revision-ready") {
						awaitingApprovedRevisionApproval = true;
					} else if (command.kind === "approve-approved-revision" && outcome.status === "revision-approved") {
						awaitingApprovedRevisionApproval = false;
						awaitingApprovedRevisionPublication = true;
				} else if (command.kind === "publish-approved-revision" && outcome.status === "revision-published") {
						clearActiveTurn();
				} else if (
					command.kind !== "request-exploration" &&
					command.kind !== "to-spec" &&
					command.kind !== "approve-spec" &&
					command.kind !== "to-tickets" &&
					command.kind !== "approve-tickets"
					&& command.kind !== "to-approved-revision"
					&& command.kind !== "approve-approved-revision"
					&& command.kind !== "publish-tickets"
					&& command.kind !== "publish-approved-revision"
				) {
					clearActiveTurn();
				}
				return {
					content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
					details: outcome,
				};
			},
		} as never);
	}

	return {
		toolName,
		handlePublicEntry,
		register,
		shouldContinue,
		hasActiveTurn,
	};
}
