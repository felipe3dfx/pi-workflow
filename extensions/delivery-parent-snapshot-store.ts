import type { LinearDeliveryParent } from "./linear-delivery-parent-gateway.ts";
import {
	digestCanonicalValue,
	type DeliveryParentSnapshot,
	type ProjectRef,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import { createWorkflowArtifactInterface } from "./workflow-artifacts.ts";

export interface DeliveryParentSnapshotStore {
	persist(input: {
		definitionId: string;
		parent: LinearDeliveryParent;
		specDigest: string;
	}): Promise<VerifiedArtifactRef>;
}

function snapshot(input: {
	parent: LinearDeliveryParent;
	specDigest: string;
}): DeliveryParentSnapshot {
	const unsigned = {
		schema: "delivery-parent" as const,
		schemaVersion: 1 as const,
		payload: {
			id: input.parent.id,
			teamId: input.parent.teamId,
			revision: input.parent.descriptionRevision,
			specDigest: input.specDigest,
		},
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

export function createDeliveryParentSnapshotStore(input: {
	project: ProjectRef;
	artifactStore: WorkflowArtifactStore;
}): DeliveryParentSnapshotStore {
	const artifactInterface = createWorkflowArtifactInterface(input.artifactStore);
	return {
		persist: ({ definitionId, parent, specDigest }) =>
			artifactInterface.openSession({
				project: input.project,
				topic: `workflow/define-product/${definitionId}/published-parent`,
				schema: "delivery-parent",
				schemaVersion: 1,
				strategy: "snapshot",
				aliases: [],
			}).writeDeliveryParentSnapshot(snapshot({ parent, specDigest })),
	};
}

export async function readDeliveryParentSnapshot(input: {
	store: WorkflowArtifactStore;
	ref: VerifiedArtifactRef;
}): Promise<DeliveryParentSnapshot["payload"] | undefined> {
	if (input.ref.schema !== "delivery-parent" || input.ref.schemaVersion !== 1)
		return undefined;
	const content = await input.store.readRevision(
		input.ref.project,
		input.ref.topic,
		input.ref.revision,
	);
	try {
		const parsed = JSON.parse(content ?? "") as DeliveryParentSnapshot;
		if (
			parsed.schema !== "delivery-parent" ||
			parsed.schemaVersion !== 1 ||
			parsed.digest !== input.ref.digest ||
			parsed.digest !== digestCanonicalValue({ schema: parsed.schema, schemaVersion: parsed.schemaVersion, payload: parsed.payload })
		) return undefined;
		return parsed.payload;
	} catch {
		return undefined;
	}
}
