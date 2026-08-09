import {
	createDurablePublicationRecoveryStore,
	type RecoveryExecutionBinding,
} from "./durable-publication-recovery.ts";
import type {
	ExecutionLease,
	ExecutionManifestBinding,
} from "./interactive-decisions.ts";
import type { ProductReviewArtifact } from "./product-review-workflow.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface ProductReviewPublicationRecoveryStore {
	read(issueId: string): Promise<
		| {
				readonly digest: string;
				readonly stage: "uncertain" | "verified";
				readonly executionBinding?: RecoveryExecutionBinding;
		  }
		| undefined
	>;
	bindExecution(
		artifact: ProductReviewArtifact,
		lease: ExecutionLease,
	): Promise<ExecutionManifestBinding>;
	claim(artifact: ProductReviewArtifact, ownerId: string): Promise<void>;
	release(artifact: ProductReviewArtifact, ownerId: string): Promise<void>;
	finalizeVerified(artifact: ProductReviewArtifact): Promise<void>;
}

export function createProductReviewPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topic?: string;
}): ProductReviewPublicationRecoveryStore {
	return createDurablePublicationRecoveryStore({
		...options,
		topic: options.topic ?? "workflow/product-review-publication-recovery",
		publicationName: "Product review",
		recoveryName: "product review",
		raceRecovery: "write-or-read-back-failure",
		artifactIdentity: (artifact) => ({
			issueId: artifact.payload.issue.id,
			digest: artifact.digest,
		}),
		manifestRef: ({ issueId, digest }) =>
			`workflow://product-review/${issueId}/publication/${digest}`,
	});
}
