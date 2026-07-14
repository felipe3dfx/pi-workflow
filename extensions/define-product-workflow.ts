import {
	createBlocker,
	createRouteRecommendation,
	type Assessment,
	type Route,
	type RouteRecommendation,
	type SubagentResult,
} from "./workflow-contracts.ts";

/** Interactive confirmation tokens expire after five minutes. */
const routeConfirmationTokenTtlMs = 5 * 60 * 1_000;

export type DefineProductCommand =
	| {
			kind: "recommend-route";
			definitionId: string;
			domainAnchor: string;
			assessment: Assessment;
			workflowStateId: string;
	  }
	| {
			kind: "confirm-route";
			recommendationRef: string;
			confirmedRoute: Route;
			researchQuestion: string;
			confirmationToken: string;
			workflowStateId: string;
	  };

export type DefineProductOutcome =
	| {
			status: "awaiting-confirmation";
			recommendation: RouteRecommendation;
	  }
	| {
			status: "completed";
			result: SubagentResult;
	  }
	| {
			status: "blocked";
			blocker: { code: string; message: string };
	  };

export interface DefineProductWorkflowDependencies {
	delegate: {
		delegate(intent: {
			kind: "research";
			requestId: string;
			definitionId: string;
			recommendationDigest: string;
			route: Route;
			question: string;
			domainAnchorDigest: string;
			project: { name: string; root: string };
			targetTopic: string;
			requiredSkills: readonly { name: string }[];
			affectedPaths: readonly string[];
		}): Promise<SubagentResult>;
	};
	createRequestId(): string;
	project: { name: string; root: string };
	requiredSkills?: readonly { name: string }[];
	affectedPaths?: readonly string[];
	now?: () => number;
}

function isConfirmationToken(value: string): boolean {
	return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function createDefineProductWorkflow(
	dependencies: DefineProductWorkflowDependencies,
) {
	let activeRecommendation: RouteRecommendation | undefined;
	let activeWorkflowStateId: string | undefined;

	function reset(): void {
		activeRecommendation = undefined;
		activeWorkflowStateId = undefined;
	}

	async function advance(
		command: DefineProductCommand,
	): Promise<DefineProductOutcome> {
		if (command.kind === "recommend-route") {
			activeWorkflowStateId = command.workflowStateId;
			activeRecommendation = createRouteRecommendation({
				definitionId: command.definitionId,
				domainAnchor: command.domainAnchor,
				assessment: command.assessment,
				issuedAt: (dependencies.now ?? Date.now)(),
			});
			return {
				status: "awaiting-confirmation",
				recommendation: activeRecommendation,
			};
		}
		if (!activeRecommendation) {
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
					"The Owner must confirm a define-product route recommendation before research can start.",
				),
			};
		}
		if (
			(dependencies.now ?? Date.now)() - activeRecommendation.issuedAt >=
			routeConfirmationTokenTtlMs
		) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_EXPIRED",
					"The route confirmation token has expired. Request a new recommendation.",
				),
			};
		}
		if (
			command.recommendationRef !== activeRecommendation.digest ||
			command.confirmedRoute !== activeRecommendation.recommendedRoute
		) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_MISMATCH",
					"The confirmed route does not match the current define-product recommendation.",
				),
			};
		}
		if (
			!isConfirmationToken(command.confirmationToken) ||
			command.confirmationToken !== activeRecommendation.confirmationToken ||
			command.workflowStateId !== activeWorkflowStateId
		) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_TOKEN_INVALID",
					"The Owner must provide the current one-time route confirmation token.",
				),
			};
		}
		const researchQuestion = command.researchQuestion.trim();
		if (researchQuestion.length === 0) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
					"The Owner must provide a non-empty research question before research can start.",
				),
			};
		}
		const recommendation = activeRecommendation;
		reset();
		const result = await dependencies.delegate.delegate({
			kind: "research",
			requestId: dependencies.createRequestId(),
			definitionId: recommendation.definitionId,
			recommendationDigest: recommendation.digest,
			route: recommendation.recommendedRoute,
			question: researchQuestion,
			domainAnchorDigest: recommendation.domainAnchorDigest,
			project: dependencies.project,
			targetTopic: `workflow/define-product/${recommendation.definitionId}/research/${recommendation.digest}`,
			requiredSkills: dependencies.requiredSkills ?? [{ name: "research" }],
			affectedPaths: dependencies.affectedPaths ?? [
				"skills/define-product/SKILL.md",
			],
		});
		return { status: "completed", result };
	}

	function pendingRecommendation(): RouteRecommendation | undefined {
		return activeRecommendation;
	}

	return { advance, pendingRecommendation, reset };
}
