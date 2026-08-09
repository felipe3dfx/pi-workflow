import type {
	AgentAssetApplyOptions,
	AgentAssetApplyResult,
	AgentAssetDecisionDescriptor,
	AgentAssetInspection,
	AgentAssetPlan,
	AgentAssetPreviewOptions,
	AgentAssetRecoveryOptions,
} from "./agent-asset-sync.ts";
import {
	agentAssetApplyDecision,
	agentAssetRecoveryDecision,
} from "./agent-asset-sync.ts";
import type {
	DecisionBlocker,
	ExecutionLease,
	ExecutionManifestBinding,
} from "./interactive-decisions.ts";

interface AgentAssetSyncCommandApi {
	inspect(options?: AgentAssetPreviewOptions): Promise<AgentAssetInspection>;
	plan(options?: AgentAssetPreviewOptions): Promise<AgentAssetPlan>;
	apply(
		plan: AgentAssetPlan,
		options: AgentAssetApplyOptions,
	): Promise<AgentAssetApplyResult>;
	resume(
		operationId: string,
		options: AgentAssetRecoveryOptions,
	): Promise<AgentAssetApplyResult>;
	rollback(
		operationId: string,
		options: AgentAssetRecoveryOptions,
	): Promise<AgentAssetApplyResult>;
}

type SyncDecisionOutcome =
	| {
			readonly kind: "authorized";
			readonly lease: ExecutionLease;
			readonly manifest?: ExecutionManifestBinding;
	  }
	| { readonly kind: "cancelled" }
	| { readonly kind: "blocked"; readonly blocker: DecisionBlocker };

export interface SyncCommandAdapters {
	sync: AgentAssetSyncCommandApi;
	write: (text: string) => void;
	decide?: (
		descriptor: AgentAssetDecisionDescriptor,
	) => Promise<SyncDecisionOutcome>;
	project?: string;
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
		let result: AgentAssetApplyResult | AgentAssetInspection | AgentAssetPlan;
		if (command === "apply") {
			const plan = await adapters.sync.plan({ signal: adapters.signal });
			if (plan.status !== "ready") result = plan;
			else {
				const decision = adapters.decide
					? await adapters.decide(
							agentAssetApplyDecision(adapters.project ?? "pi-workflow", plan),
						)
					: {
							kind: "blocked" as const,
							blocker: {
								code: "PI_WORKFLOW_DECISION_STORE_UNAVAILABLE" as const,
								message:
									"Shared interactive decision transport is unavailable; no files were changed.",
							},
						};
				result =
					decision.kind === "authorized"
						? await adapters.sync.apply(plan, {
								signal: adapters.signal,
								lease: decision.lease,
								manifest: decision.manifest,
							})
						: decision.kind === "cancelled"
							? {
									status: "canceled",
									mutation: "none",
									durability: "durable",
									readiness: "blocked",
									assets: [],
									diagnostics: [],
									operationId: null,
									digest: "",
								}
							: {
									status: "blocked",
									mutation: "none",
									durability: "durable",
									readiness: "blocked",
									assets: [],
									diagnostics: [decision.blocker.message],
									operationId: null,
									digest: "",
								};
			}
		} else if (command === "resume" || command === "rollback") {
			const decision = adapters.decide
				? await adapters.decide(
						agentAssetRecoveryDecision(
							adapters.project ?? "pi-workflow",
							operationId as string,
							command,
						),
					)
				: {
						kind: "blocked" as const,
						blocker: {
							code: "PI_WORKFLOW_DECISION_STORE_UNAVAILABLE" as const,
							message:
								"Shared interactive decision transport is unavailable; no files were changed.",
						},
					};
			result =
				decision.kind === "authorized"
					? await adapters.sync[command](operationId as string, {
							lease: decision.lease,
							manifest: decision.manifest,
						})
					: decision.kind === "cancelled"
						? ({
								status: "canceled",
								mutation: "none",
							} as AgentAssetApplyResult)
						: ({
								status: "blocked",
								mutation: "none",
								diagnostics: [decision.blocker.message],
							} as AgentAssetApplyResult);
		} else result = await adapters.sync[command]({ signal: adapters.signal });
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
