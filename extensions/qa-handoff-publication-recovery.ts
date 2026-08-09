import {
	createDurablePublicationRecoveryStore,
	type RecoveryExecutionBinding,
} from "./durable-publication-recovery.ts";
import type {
	ExecutionLease,
	ExecutionManifestBinding,
} from "./interactive-decisions.ts";
import type { QaHandoffArtifact } from "./qa-handoff-workflow.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface QaHandoffPublicationRecoveryStore {
	read(issueId: string): Promise<
		| {
				readonly digest: string;
				readonly stage: "uncertain" | "verified";
				readonly executionBinding?: RecoveryExecutionBinding;
		  }
		| undefined
	>;
	bindExecution(
		artifact: QaHandoffArtifact,
		lease: ExecutionLease,
	): Promise<ExecutionManifestBinding>;
	claim(artifact: QaHandoffArtifact, ownerId: string): Promise<void>;
	release(artifact: QaHandoffArtifact, ownerId: string): Promise<void>;
	finalizeVerified(artifact: QaHandoffArtifact): Promise<void>;
}

export function createQaHandoffPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	/**
	 * Recovery remains project-scoped because the current authenticated Linear MCP
	 * evidence exposes no trusted, stable workspace identity. A constant pseudo-global
	 * project key would be unsafe because issue identifiers can collide across Linear
	 * workspaces; use a real workspace-global key only when trusted evidence provides it.
	 */
	readonly project: string | (() => string);
	readonly topic?: string;
}): QaHandoffPublicationRecoveryStore {
	return createDurablePublicationRecoveryStore({
		...options,
		topic: options.topic ?? "workflow/qa-handoff-publication-recovery",
		publicationName: "QA handoff",
		recoveryName: "QA handoff",
		raceRecovery: "write-failure-only",
		artifactIdentity: (artifact) => ({
			issueId: artifact.payload.issue.id,
			digest: artifact.digest,
		}),
		manifestRef: ({ issueId, digest }) =>
			`workflow://qa-handoff/${issueId}/publication/${digest}`,
	});
}
