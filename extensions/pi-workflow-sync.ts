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
	resume(operationId: string): Promise<AgentAssetApplyResult>;
	rollback(operationId: string): Promise<AgentAssetApplyResult>;
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
	const operationId = args[1];
	const usage =
		"Usage: pi-workflow-sync <inspect|plan|apply|resume <operationId>|rollback <operationId>>";
	const isPreview =
		(command === "inspect" || command === "plan" || command === "apply") &&
		args.length === 1;
	const isRecovery =
		(command === "resume" || command === "rollback") &&
		args.length === 2 &&
		typeof operationId === "string" &&
		/^[a-f0-9]{64}$/.test(operationId);
	if (!isPreview && !isRecovery) {
		adapters.write(usage);
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
				: command === "resume" || command === "rollback"
					? await adapters.sync[command](operationId as string)
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
