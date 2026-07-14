import type {
	PreparedLaunch,
	SubagentResult,
	WorkflowBlocker,
} from "./workflow-contracts.ts";

interface SubagentLauncherDependencies {
	launch(preparedLaunch: PreparedLaunch): Promise<SubagentResult>;
}

export type LaunchAttempt =
	| { ok: true; value: SubagentResult }
	| { ok: false; blocker: WorkflowBlocker };

export function createSubagentLauncher(
	dependencies: SubagentLauncherDependencies,
) {
	async function launch(preparedLaunch: PreparedLaunch): Promise<LaunchAttempt> {
		try {
			return { ok: true, value: await dependencies.launch(preparedLaunch) };
		} catch (error) {
			return {
				ok: false,
				blocker: {
					code: "PI_WORKFLOW_AGENT_ASSET_NOT_READY",
					message:
						error instanceof Error
							? error.message
							: "The research launch failed before a terminal result was produced.",
				},
			};
		}
	}

	return { launch };
}
