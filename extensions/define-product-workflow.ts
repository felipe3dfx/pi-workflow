import {
	createBlocker,
	createRouteRecommendation,
	type Assessment,
	type Route,
	type RouteRecommendation,
	type SubagentResult,
	type WorkflowIntent,
	digestCanonicalValue,
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
	  }
	| {
			kind: "request-exploration";
			definitionId: string;
			intent: "prototype" | "design-alternative";
			focus: string;
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

export interface ExplorationRecoveryState {
	definitionId: string;
	intent: "prototype" | "design-alternative";
	focus: string;
	requestId: string;
	intentFingerprint: string;
	workflowIntent: Extract<WorkflowIntent, { kind: "prototype" | "design-alternative" }>;
}

export interface ExplorationRecoveryStore {
	load(): Promise<ExplorationRecoveryState | undefined>;
	save(state: ExplorationRecoveryState): Promise<void>;
	clear(): Promise<void>;
}

export interface DefineProductWorkflowDependencies {
	delegate: {
		delegate(intent: WorkflowIntent): Promise<SubagentResult>;
	};
	createRequestId(): string;
	project: { name: string; root: string };
	requiredSkills?: readonly { name: string }[];
	affectedPaths?: readonly string[];
	now?: () => number;
	explorationRecoveryStore?: ExplorationRecoveryStore;
}

function isConfirmationToken(value: string): boolean {
	return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function createDefineProductWorkflow(
	dependencies: DefineProductWorkflowDependencies,
) {
	let activeRecommendation: RouteRecommendation | undefined;
	let activeWorkflowStateId: string | undefined;
	let recoverableExploration:
		| {
				definitionId: string;
				intent: "prototype" | "design-alternative";
				focus: string;
				workflowIntent: Extract<
					WorkflowIntent,
					{ kind: "prototype" | "design-alternative" }
				>;
		  }
		| undefined;
	let explorationContext:
		| {
				definitionId: string;
				recommendation: RouteRecommendation;
				artifacts: SubagentResult["artifacts"];
		  }
		| undefined;

	function clearRecommendation(): void {
		activeRecommendation = undefined;
		activeWorkflowStateId = undefined;
	}

	function reset(): void {
		clearRecommendation();
		explorationContext = undefined;
		recoverableExploration = undefined;
	}

	async function restoreRecovery(): Promise<string | undefined> {
		reset();
		const stored = await dependencies.explorationRecoveryStore?.load();
		if (
			!stored ||
			stored.requestId !== stored.workflowIntent.requestId ||
			stored.definitionId !== stored.workflowIntent.definitionId ||
			stored.intent !== stored.workflowIntent.kind ||
			stored.focus !== stored.workflowIntent.focus ||
			stored.intentFingerprint !== digestCanonicalValue(stored.workflowIntent)
		) {
			if (stored) await dependencies.explorationRecoveryStore?.clear();
			return undefined;
		}
		recoverableExploration = {
			definitionId: stored.definitionId,
			intent: stored.intent,
			focus: stored.focus,
			workflowIntent: stored.workflowIntent,
		};
		return stored.definitionId;
	}

	async function advance(
		command: DefineProductCommand,
	): Promise<DefineProductOutcome> {
		if (command.kind === "recommend-route") {
			await dependencies.explorationRecoveryStore?.clear();
			explorationContext = undefined;
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
		if (command.kind === "request-exploration") {
			const focus = command.focus.trim();
			const compatibleRecovery =
				recoverableExploration?.definitionId === command.definitionId &&
				recoverableExploration.intent === command.intent &&
				recoverableExploration.focus === focus;
			if (
				(!explorationContext ||
					explorationContext.definitionId !== command.definitionId) &&
				!compatibleRecovery
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_DEFINITION_ID_MISMATCH",
						"Exploration requires compatible verified research from this definition session.",
					),
				};
			}
			if (!focus) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
						"The Owner must provide a non-empty exploration focus.",
					),
				};
			}
			const recoveredIntent = compatibleRecovery
				? recoverableExploration?.workflowIntent
				: undefined;
			const requestId =
				recoveredIntent?.requestId ?? dependencies.createRequestId();
			const workflowIntent: Extract<
				WorkflowIntent,
				{ kind: "prototype" | "design-alternative" }
			> = recoveredIntent ?? {
						kind: command.intent,
						requestId,
						definitionId: explorationContext?.definitionId ?? command.definitionId,
						recommendationDigest: explorationContext?.recommendation.digest ?? "",
						route: explorationContext?.recommendation.recommendedRoute ?? "wayfinder",
						focus,
						domainAnchorDigest:
							explorationContext?.recommendation.domainAnchorDigest ?? "",
						project: dependencies.project,
						targetTopic: `workflow/define-product/${explorationContext?.definitionId ?? command.definitionId}/${command.intent}/${requestId}`,
						requiredSkills: [
							{
								name:
									command.intent === "prototype"
										? "prototype"
										: "codebase-design",
							},
						],
						affectedPaths: dependencies.affectedPaths ?? [
							"skills/define-product/SKILL.md",
						],
						readableArtifacts: (explorationContext?.artifacts ?? []).map(
							(ref, index) => ({
								alias:
									index === 0 ? "research" : `supporting-${index + 1}`,
								ref,
							}),
						),
					};
			const result = await dependencies.delegate.delegate(workflowIntent);
			if (
				result.status === "blocked" &&
				result.blocker.code === "PI_WORKFLOW_DELEGATION_INTERRUPTED"
			) {
				recoverableExploration = {
					definitionId: command.definitionId,
					intent: command.intent,
					focus,
					workflowIntent,
				};
				await dependencies.explorationRecoveryStore?.save({
					definitionId: command.definitionId,
					intent: command.intent,
					focus,
					requestId: workflowIntent.requestId,
					intentFingerprint: digestCanonicalValue(workflowIntent),
					workflowIntent,
				});
			} else {
				recoverableExploration = undefined;
				await dependencies.explorationRecoveryStore?.clear();
			}
			return { status: "completed", result };
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
		clearRecommendation();
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
		if (result.status === "completed") {
			explorationContext = {
				definitionId: recommendation.definitionId,
				recommendation,
				artifacts: result.artifacts,
			};
		}
		return { status: "completed", result };
	}

	function pendingRecommendation(): RouteRecommendation | undefined {
		return activeRecommendation;
	}

	return { advance, pendingRecommendation, reset, restoreRecovery };
}
