import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import type { QaHandoffArtifact } from "./qa-handoff-workflow.ts";

export interface QaHandoffPublicationRecoveryStore {
	read(issueId: string): Promise<{ readonly digest: string } | undefined>;
	claim(artifact: QaHandoffArtifact): Promise<void>;
	release(artifact: QaHandoffArtifact): Promise<void>;
}

export function createQaHandoffPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string;
	readonly topic?: string;
}): QaHandoffPublicationRecoveryStore {
	const prefix = options.topic ?? "workflow/qa-handoff-publication-recovery";
	const destination = (issueId: string) => `${prefix}/${issueId}`;

	return {
		async read(issueId) {
			const current = await options.store.readCurrent(
				options.project,
				destination(issueId),
			);
			if (!current) return undefined;
			const readBack = await options.store.readRevision(
				options.project,
				destination(issueId),
				current.revision,
			);
			if (readBack !== current.content)
				throw new Error("QA handoff publication recovery read-back mismatch.");
			const value: unknown = JSON.parse(current.content);
			if (
				!value ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				Object.keys(value).length !== 3 ||
				!("issueId" in value) ||
				value.issueId !== issueId ||
				!("digest" in value) ||
				typeof value.digest !== "string" ||
				!/^[a-f0-9]{64}$/.test(value.digest) ||
				!("stage" in value) ||
				(value.stage !== "uncertain" && value.stage !== "released") ||
				current.content !== `${canonicalJson(value)}\n`
			)
				throw new Error("QA handoff publication recovery state is invalid.");
			return value.stage === "uncertain" ? { digest: value.digest } : undefined;
		},
		async claim(artifact) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for QA handoff recovery.");
			const topic = destination(artifact.payload.issue.id);
			const content = `${canonicalJson({
				issueId: artifact.payload.issue.id,
				digest: artifact.digest,
				stage: "uncertain",
			})}\n`;
			const current = await options.store.readCurrent(options.project, topic);
			if (current?.content === content) return;
			if (current && !current.content.includes(`"digest":"${artifact.digest}"`))
				throw new Error("QA handoff publication recovery state conflicts.");
			const saved = await options.store.write(
				options.project,
				topic,
				content,
				current?.revision,
			);
			const readBack = await options.store.readRevision(
				options.project,
				topic,
				saved.revision,
			);
			if (readBack !== content)
				throw new Error("QA handoff publication recovery read-back mismatch.");
		},
		async release(artifact) {
			const topic = destination(artifact.payload.issue.id);
			const current = await options.store.readCurrent(options.project, topic);
			if (!current) return;
			const content = `${canonicalJson({
				issueId: artifact.payload.issue.id,
				digest: artifact.digest,
				stage: "released",
			})}\n`;
			const saved = await options.store.write(
				options.project,
				topic,
				content,
				current.revision,
			);
			const readBack = await options.store.readRevision(
				options.project,
				topic,
				saved.revision,
			);
			if (readBack !== content)
				throw new Error("QA handoff publication recovery read-back mismatch.");
		},
	};
}
