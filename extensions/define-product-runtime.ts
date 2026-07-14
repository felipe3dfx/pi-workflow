import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InputEvent } from "@earendil-works/pi-coding-agent";
import {
	createBlocker,
	type Assessment,
	type Route,
	type RouteRecommendation,
} from "./workflow-contracts.ts";
import type {
	DefineProductCommand,
	DefineProductOutcome,
} from "./define-product-workflow.ts";

const toolName = "workflow_define_product";

const defineProductParameters = {
	type: "object",
	additionalProperties: false,
	properties: {
		action: { type: "string", enum: ["recommend_route", "confirm_route"] },
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
	},
	required: ["action"],
} as const;

interface DefineProductToolParams {
	action: "recommend_route" | "confirm_route";
	definitionId?: string;
	domainAnchor?: string;
	assessment?: Assessment;
	recommendationRef?: string;
	confirmationToken?: string;
	confirmedRoute?: Route;
	researchQuestion?: string;
}

export interface DefineProductRuntimeDependencies {
	workflow: {
		advance(command: DefineProductCommand): Promise<DefineProductOutcome>;
		pendingRecommendation(): RouteRecommendation | undefined;
		reset(): void;
	};
	createDefinitionId(): string;
}

export function createDefineProductRuntime(
	dependencies: DefineProductRuntimeDependencies,
) {
	let activeDefinitionId: string | undefined;
	let activeWorkflowStateId: string | undefined;
	let awaitingConfirmation = false;

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
		dependencies.workflow.reset();
	}

	function hasActiveTurn(): boolean {
		return activeDefinitionId !== undefined || awaitingConfirmation;
	}

	function shouldContinue(event: InputEvent): boolean {
		return (
			awaitingConfirmation &&
			event.source === "interactive" &&
			event.streamingBehavior === undefined
		);
	}

	function systemPrompt(): string {
		const pending = dependencies.workflow.pendingRecommendation();
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
		pi.on("session_start", clearActiveTurn);
		pi.on("session_shutdown", clearActiveTurn);
		const registerTool = (pi as { registerTool?: (tool: unknown) => void })
			.registerTool;
		registerTool?.({
			name: toolName,
			label: "Define Product Workflow",
			description:
				"Execute the package-owned define-product workflow recommendation or confirmation step.",
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
				} else {
					command = {
						kind: "confirm-route",
						recommendationRef: params.recommendationRef ?? "",
						confirmationToken: params.confirmationToken ?? "",
						confirmedRoute: params.confirmedRoute as Route,
						researchQuestion: params.researchQuestion ?? "",
						workflowStateId: activeWorkflowStateId ?? "",
					};
				}
				const outcome = await dependencies.workflow.advance(command);
				if (outcome.status === "awaiting-confirmation") {
					awaitingConfirmation = true;
				} else {
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
