import type {
	Intervention,
	PreparedLaunch,
	SubagentResult,
	VerifiedArtifactRef,
	WorkflowBlocker,
} from "./workflow-contracts.ts";

export interface LaunchOptions {
	attempt: 1 | 2;
	sessionId: string;
	resumeSessionId?: string;
	verifiedArtifacts: readonly VerifiedArtifactRef[];
}

interface RuntimeLaunchResult {
	result: SubagentResult;
	sessionId: string;
	discoveredPaths?: readonly string[];
}

interface InterruptedLaunchError extends Error {
	code: "PI_WORKFLOW_DELEGATION_INTERRUPTED";
	interrupted: true;
	sessionId: string;
	verifiedArtifacts: readonly VerifiedArtifactRef[];
}

interface SubagentLauncherDependencies {
	launch(
		preparedLaunch: PreparedLaunch,
		options?: LaunchOptions,
	): Promise<SubagentResult | RuntimeLaunchResult>;
	intervene?(sessionId: string, intervention: Intervention): Promise<void>;
}

export type LaunchAttempt =
	| {
			ok: true;
			value: SubagentResult;
			sessionId?: string;
			discoveredPaths?: readonly string[];
	  }
	| {
			ok: false;
			blocker: WorkflowBlocker;
			interrupted?: boolean;
			sessionId?: string;
			verifiedArtifacts?: readonly VerifiedArtifactRef[];
	  };

function isInterruptedLaunchError(error: unknown): error is InterruptedLaunchError {
	if (!(error instanceof Error)) return false;
	const candidate = error as Partial<InterruptedLaunchError>;
	return (
		candidate.code === "PI_WORKFLOW_DELEGATION_INTERRUPTED" &&
		candidate.interrupted === true &&
		typeof candidate.sessionId === "string" &&
		Array.isArray(candidate.verifiedArtifacts)
	);
}

export function createSubagentLauncher(
	dependencies: SubagentLauncherDependencies,
) {
	async function launch(
		preparedLaunch: PreparedLaunch,
		options?: LaunchOptions,
	): Promise<LaunchAttempt> {
		try {
			const launched = await dependencies.launch(preparedLaunch, options);
			if ("result" in launched) {
				return {
					ok: true,
					value: launched.result,
					sessionId: launched.sessionId,
					...(launched.discoveredPaths
						? { discoveredPaths: [...launched.discoveredPaths] }
						: {}),
				};
			}
			return {
				ok: true,
				value: launched,
				sessionId: options?.sessionId,
			};
		} catch (error) {
			if (isInterruptedLaunchError(error)) {
				return {
					ok: false,
					interrupted: true,
					blocker: {
						code: "PI_WORKFLOW_DELEGATION_INTERRUPTED",
						message: error.message,
					},
					sessionId: error.sessionId,
					verifiedArtifacts: [...error.verifiedArtifacts],
				};
			}
			return {
				ok: false,
				blocker: {
					code: "PI_WORKFLOW_AGENT_ASSET_NOT_READY",
					message:
						error instanceof Error
							? error.message
							: "The launch failed before a terminal result was produced.",
				},
				sessionId: options?.sessionId,
			};
		}
	}

	async function intervene(
		sessionId: string,
		intervention: Intervention,
	): Promise<void> {
		await dependencies.intervene?.(sessionId, intervention);
	}

	return { launch, intervene };
}
