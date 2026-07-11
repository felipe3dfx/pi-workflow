import type {
	AgentAssetApplyOptions,
	AgentAssetApplyResult,
	AgentAssetInspection,
	AgentAssetPlan,
	AgentAssetPreviewOptions,
} from "./agent-asset-sync.ts";

interface AgentAssetSyncCommandApi {
	inspect(options?: AgentAssetPreviewOptions): Promise<AgentAssetInspection>;
	plan(options?: AgentAssetPreviewOptions): Promise<AgentAssetPlan>;
	apply(
		plan: AgentAssetPlan,
		options: AgentAssetApplyOptions,
	): Promise<AgentAssetApplyResult>;
}

export interface SyncCommandAdapters {
	sync: AgentAssetSyncCommandApi;
	write: (text: string) => void;
	confirm?: (plan: AgentAssetPlan) => Promise<boolean>;
	signal?: AbortSignal;
}

export async function runSyncCommand(
	args: string[],
	adapters: SyncCommandAdapters,
): Promise<number> {
	const command = args[0];
	if (command !== "inspect" && command !== "plan" && command !== "apply") {
		adapters.write("Usage: pi-workflow-sync <inspect|plan|apply>");
		return 2;
	}

	try {
		const result =
			command === "apply"
				? await adapters.sync.apply(
						await adapters.sync.plan({ signal: adapters.signal }),
						{
							signal: adapters.signal,
							confirm: adapters.confirm ?? (async () => false),
						},
					)
				: await adapters.sync[command]({ signal: adapters.signal });
		adapters.write(JSON.stringify(result, null, 2));
		if (result.status === "canceled") return 130;
		return result.status === "blocked" ? 1 : 0;
	} catch (error) {
		adapters.write(
			JSON.stringify(
				{
					status: "blocked",
					mutation: "none",
					diagnostics: [
						`Unable to complete ${command}: ${error instanceof Error ? error.message : String(error)}. Resolve the error and retry; no files were changed.`,
					],
				},
				null,
				2,
			),
		);
		return 1;
	}
}
