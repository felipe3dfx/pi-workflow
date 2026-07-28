import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import type { QaHandoffArtifact } from "./qa-handoff-workflow.ts";

interface RecoveryState {
	readonly issueId: string;
	readonly digest: string;
	readonly stage: "uncertain" | "released" | "verified";
}

export interface QaHandoffPublicationRecoveryStore {
	read(issueId: string): Promise<
		| { readonly digest: string; readonly stage: "uncertain" | "verified" }
		| undefined
	>;
	claim(artifact: QaHandoffArtifact): Promise<void>;
	release(artifact: QaHandoffArtifact): Promise<void>;
	markVerified(artifact: QaHandoffArtifact): Promise<void>;
}

function parseRecoveryState(content: string, issueId: string): RecoveryState {
	const value: unknown = JSON.parse(content);
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
		(value.stage !== "uncertain" &&
			value.stage !== "released" &&
			value.stage !== "verified") ||
		content !== `${canonicalJson(value)}\n`
	)
		throw new Error("QA handoff publication recovery state is invalid.");
	return {
		issueId: value.issueId,
		digest: value.digest,
		stage: value.stage,
	};
}

export function createQaHandoffPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string;
	readonly topic?: string;
}): QaHandoffPublicationRecoveryStore {
	const prefix = options.topic ?? "workflow/qa-handoff-publication-recovery";
	const destination = (issueId: string) => `${prefix}/${issueId}`;
	const contentFor = (
		artifact: QaHandoffArtifact,
		stage: RecoveryState["stage"],
	) =>
		`${canonicalJson({
			issueId: artifact.payload.issue.id,
			digest: artifact.digest,
			stage,
		})}\n`;

	async function writeAndVerify(
		artifact: QaHandoffArtifact,
		stage: RecoveryState["stage"],
		expectedRevision: string | undefined,
	): Promise<void> {
		const topic = destination(artifact.payload.issue.id);
		const content = contentFor(artifact, stage);
		const saved = await options.store.write(
			options.project,
			topic,
			content,
			expectedRevision,
		);
		const readBack = await options.store.readRevision(
			options.project,
			topic,
			saved.revision,
		);
		if (readBack !== content)
			throw new Error("QA handoff publication recovery read-back mismatch.");
	}

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
			const state = parseRecoveryState(current.content, issueId);
			return state.stage === "uncertain" || state.stage === "verified"
				? { digest: state.digest, stage: state.stage }
				: undefined;
		},
		async claim(artifact) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for QA handoff recovery.");
			const issueId = artifact.payload.issue.id;
			const current = await options.store.readCurrent(
				options.project,
				destination(issueId),
			);
			if (current) {
				const state = parseRecoveryState(current.content, issueId);
				if (state.stage === "uncertain" && state.digest !== artifact.digest)
					throw new Error("QA handoff publication recovery state conflicts.");
				if (state.stage === "uncertain") return;
				if (state.stage === "verified" && state.digest === artifact.digest)
					throw new Error("QA handoff publication is already verified.");
			}
			await writeAndVerify(artifact, "uncertain", current?.revision);
		},
		async release(artifact) {
			const issueId = artifact.payload.issue.id;
			const current = await options.store.readCurrent(
				options.project,
				destination(issueId),
			);
			if (!current) return;
			const state = parseRecoveryState(current.content, issueId);
			if (state.digest !== artifact.digest || state.stage === "verified")
				throw new Error("QA handoff publication recovery state conflicts.");
			if (state.stage === "released") return;
			await writeAndVerify(artifact, "released", current.revision);
		},
		async markVerified(artifact) {
			const issueId = artifact.payload.issue.id;
			const current = await options.store.readCurrent(
				options.project,
				destination(issueId),
			);
			if (!current)
				throw new Error("QA handoff publication recovery state is missing.");
			const state = parseRecoveryState(current.content, issueId);
			if (state.stage !== "uncertain" || state.digest !== artifact.digest)
				throw new Error("QA handoff publication recovery state conflicts.");
			await writeAndVerify(artifact, "verified", current.revision);
		},
	};
}
