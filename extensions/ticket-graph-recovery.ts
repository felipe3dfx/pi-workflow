import { canonicalJson, type VerifiedArtifactRef } from "./workflow-contracts.ts";
import { parseApprovedTicketGraph } from "./approved-ticket-graph-store.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export async function recoverApprovedTicketGraph(
	store: WorkflowArtifactStore,
	ref: VerifiedArtifactRef,
) {
	if (store.capabilities?.atomicCompareAndSwap !== true) {
		throw new Error("Atomic compare-and-swap is required for approved ticket graph recovery.");
	}
	if (ref.schema !== "delivery-ticket-graph" || ref.schemaVersion !== 1)
		throw new Error("Approved ticket graph recovery reference is invalid.");
	const content = await store.readRevision(ref.project, ref.topic, ref.revision);
	if (content === undefined) throw new Error("Approved ticket graph recovery state is missing.");
	const graph = parseApprovedTicketGraph(content);
	if (graph.digest !== ref.digest || canonicalJson(graph) !== content.trim())
		throw new Error("Approved ticket graph recovery read-back mismatch.");
	return graph;
}
