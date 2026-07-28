import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import type { QaHandoffArtifact } from "./qa-handoff-workflow.ts";

interface RecoveryState {
	readonly issueId: string;
	readonly digest: string;
	readonly stage: "uncertain" | "released" | "verified";
	readonly ownerId?: string;
}

export interface QaHandoffPublicationRecoveryStore {
	read(issueId: string): Promise<
		| { readonly digest: string; readonly stage: "uncertain" | "verified" }
		| undefined
	>;
	claim(artifact: QaHandoffArtifact, ownerId: string): Promise<void>;
	release(artifact: QaHandoffArtifact, ownerId: string): Promise<void>;
	finalizeVerified(artifact: QaHandoffArtifact): Promise<void>;
}

function parseRecoveryState(content: string, issueId: string): RecoveryState {
	const value: unknown = JSON.parse(content);
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.keys(value).length !== 3 && Object.keys(value).length !== 4) ||
		!Object.keys(value).every((key) =>
			["issueId", "digest", "stage", "ownerId"].includes(key),
		) ||
		!("issueId" in value) ||
		value.issueId !== issueId ||
		!("digest" in value) ||
		typeof value.digest !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.digest) ||
		("ownerId" in value &&
			(typeof value.ownerId !== "string" || !value.ownerId.trim())) ||
		!("stage" in value) ||
		(value.stage !== "uncertain" &&
			value.stage !== "released" &&
			value.stage !== "verified") ||
		(value.stage === "verified" && "ownerId" in value) ||
		content !== `${canonicalJson(value)}\n`
	)
		throw new Error("QA handoff publication recovery state is invalid.");
	return {
		issueId: value.issueId,
		digest: value.digest,
		stage: value.stage,
		...("ownerId" in value && typeof value.ownerId === "string"
			? { ownerId: value.ownerId }
			: {}),
	};
}

export function createQaHandoffPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topic?: string;
}): QaHandoffPublicationRecoveryStore {
	const prefix = options.topic ?? "workflow/qa-handoff-publication-recovery";
	const destination = (issueId: string) => `${prefix}/${issueId}`;
	const contentFor = (
		artifact: QaHandoffArtifact,
		stage: RecoveryState["stage"],
		ownerId?: string,
	) =>
		`${canonicalJson({
			issueId: artifact.payload.issue.id,
			digest: artifact.digest,
			stage,
			...(ownerId ? { ownerId } : {}),
		})}\n`;

	const currentProject = () =>
		typeof options.project === "function" ? options.project() : options.project;

	async function writeAndVerify(
		project: string,
		artifact: QaHandoffArtifact,
		stage: RecoveryState["stage"],
		expectedRevision: string | undefined,
		ownerId?: string,
	): Promise<void> {
		const topic = destination(artifact.payload.issue.id);
		const content = contentFor(artifact, stage, ownerId);
		const saved = await options.store.write(
			project,
			topic,
			content,
			expectedRevision,
		);
		const readBack = await options.store.readRevision(
			project,
			topic,
			saved.revision,
		);
		if (readBack !== content)
			throw new Error("QA handoff publication recovery read-back mismatch.");
	}

	return {
		async read(issueId) {
			const project = currentProject();
			const current = await options.store.readCurrent(
				project,
				destination(issueId),
			);
			if (!current) return undefined;
			const readBack = await options.store.readRevision(
				project,
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
		async claim(artifact, ownerId) {
			const project = currentProject();
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for QA handoff recovery.");
			const issueId = artifact.payload.issue.id;
			const current = await options.store.readCurrent(
				project,
				destination(issueId),
			);
			if (current) {
				const state = parseRecoveryState(current.content, issueId);
				if (state.stage === "uncertain" && state.digest !== artifact.digest)
					throw new Error("QA handoff publication recovery state conflicts.");
				if (state.stage === "uncertain" && state.ownerId === ownerId) {
					const readBack = await options.store.readRevision(
						project,
						destination(issueId),
						current.revision,
					);
					if (readBack !== current.content)
						throw new Error("QA handoff publication recovery read-back mismatch.");
					return;
				}
				if (state.stage === "uncertain")
					throw new Error("QA handoff publication recovery claim is already owned.");
				if (state.stage === "verified")
					throw new Error("QA handoff publication is already verified.");
			}
			const topic = destination(issueId);
			const content = contentFor(artifact, "uncertain", ownerId);
			let saved: { readonly revision: string };
			try {
				saved = await options.store.write(
					project,
					topic,
					content,
					current?.revision,
				);
			} catch (error) {
				const latest = await options.store.readCurrent(project, topic);
				if (latest) {
					const state = parseRecoveryState(latest.content, issueId);
					if (state.digest !== artifact.digest)
						throw new Error("QA handoff publication recovery state conflicts.");
					if (state.stage === "uncertain" && state.ownerId === ownerId) {
						const readBack = await options.store.readRevision(
							project,
							topic,
							latest.revision,
						);
						if (readBack !== latest.content)
							throw new Error("QA handoff publication recovery read-back mismatch.");
						return;
					}
					if (state.stage === "uncertain")
						throw new Error("QA handoff publication recovery claim is already owned.");
				}
				throw error;
			}
			const readBack = await options.store.readRevision(
				project,
				topic,
				saved.revision,
			);
			if (readBack !== content)
				throw new Error("QA handoff publication recovery read-back mismatch.");
		},
		async release(artifact, ownerId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for QA handoff recovery.");
			const project = currentProject();
			const issueId = artifact.payload.issue.id;
			const current = await options.store.readCurrent(
				project,
				destination(issueId),
			);
			if (!current) return;
			const state = parseRecoveryState(current.content, issueId);
			if (state.digest !== artifact.digest || state.stage === "verified")
				throw new Error("QA handoff publication recovery state conflicts.");
			if (state.ownerId !== ownerId)
				throw new Error("QA handoff publication recovery claim is already owned.");
			if (state.stage === "released") return;
			await writeAndVerify(
				project,
				artifact,
				"released",
				current.revision,
				ownerId,
			);
		},
		async finalizeVerified(artifact) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for QA handoff recovery.");
			const project = currentProject();
			const issueId = artifact.payload.issue.id;
			const topic = destination(issueId);
			const content = contentFor(artifact, "verified");
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const current = await options.store.readCurrent(project, topic);
				if (current) {
					const state = parseRecoveryState(current.content, issueId);
					if (state.digest !== artifact.digest)
						throw new Error("QA handoff publication recovery state conflicts.");
					if (state.stage === "verified") {
						const readBack = await options.store.readRevision(
							project,
							topic,
							current.revision,
						);
						if (readBack !== current.content)
							throw new Error("QA handoff publication recovery read-back mismatch.");
						return;
					}
				}
				let saved: { readonly revision: string };
				try {
					saved = await options.store.write(
						project,
						topic,
						content,
						current?.revision,
					);
				} catch (error) {
					const latest = await options.store.readCurrent(project, topic);
					if (latest) {
						const state = parseRecoveryState(latest.content, issueId);
						if (state.digest !== artifact.digest)
							throw new Error("QA handoff publication recovery state conflicts.");
						if (state.stage === "verified") {
							const readBack = await options.store.readRevision(
								project,
								topic,
								latest.revision,
							);
							if (readBack !== latest.content)
								throw new Error("QA handoff publication recovery read-back mismatch.");
							return;
						}
					}
					if (attempt < 2) continue;
					throw error;
				}
				const readBack = await options.store.readRevision(
					project,
					topic,
					saved.revision,
				);
				if (readBack !== content)
					throw new Error("QA handoff publication recovery read-back mismatch.");
				return;
			}
		},
	};
}
