import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import type { ProductReviewArtifact } from "./product-review-workflow.ts";
import type {
	ExecutionLease,
	ExecutionManifestBinding,
} from "./interactive-decisions.ts";

interface RecoveryExecutionBinding {
	readonly decisionId: string;
	readonly operationDigest: string;
	readonly executionId: string;
	readonly generation: number;
}

interface RecoveryState {
	readonly issueId: string;
	readonly digest: string;
	readonly stage: "uncertain" | "released" | "verified";
	readonly ownerId?: string;
	readonly executionBinding?: RecoveryExecutionBinding;
}

export interface ProductReviewPublicationRecoveryStore {
	read(
		issueId: string,
	): Promise<
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

function parseRecoveryState(content: string, issueId: string): RecoveryState {
	const value: unknown = JSON.parse(content);
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).length < 3 ||
		Object.keys(value).length > 5 ||
		!Object.keys(value).every((key) =>
			[
				"issueId",
				"digest",
				"stage",
				"ownerId",
				"executionBinding",
			].includes(key),
		) ||
		!("issueId" in value) ||
		value.issueId !== issueId ||
		!("digest" in value) ||
		typeof value.digest !== "string" ||
		!/^([a-f0-9]{64})$/.test(value.digest) ||
		("ownerId" in value &&
			(typeof value.ownerId !== "string" || !value.ownerId.trim())) ||
		!("stage" in value) ||
		(value.stage !== "uncertain" &&
			value.stage !== "released" &&
			value.stage !== "verified") ||
		(value.stage === "verified" && "ownerId" in value) ||
		("executionBinding" in value &&
			(!value.executionBinding ||
				typeof value.executionBinding !== "object" ||
				Array.isArray(value.executionBinding) ||
				Object.keys(value.executionBinding).length !== 4 ||
				!("decisionId" in value.executionBinding) ||
				typeof value.executionBinding.decisionId !== "string" ||
				!value.executionBinding.decisionId ||
				!("operationDigest" in value.executionBinding) ||
				typeof value.executionBinding.operationDigest !== "string" ||
				!value.executionBinding.operationDigest ||
				!("executionId" in value.executionBinding) ||
				typeof value.executionBinding.executionId !== "string" ||
				!value.executionBinding.executionId ||
				!("generation" in value.executionBinding) ||
				!Number.isSafeInteger(value.executionBinding.generation) ||
				(value.executionBinding.generation as number) < 1)) ||
		content !== `${canonicalJson(value)}\n`
	)
		throw new Error("Product review publication recovery state is invalid.");
	return {
		issueId: value.issueId,
		digest: value.digest,
		stage: value.stage,
		...("ownerId" in value && typeof value.ownerId === "string"
			? { ownerId: value.ownerId }
			: {}),
		...("executionBinding" in value && value.executionBinding
			? {
					executionBinding:
						value.executionBinding as unknown as RecoveryExecutionBinding,
				}
			: {}),
	};
}

export function createProductReviewPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topic?: string;
}): ProductReviewPublicationRecoveryStore {
	const prefix =
		options.topic ?? "workflow/product-review-publication-recovery";
	const destination = (issueId: string) => `${prefix}/${issueId}`;
	const currentProject = () =>
		typeof options.project === "function" ? options.project() : options.project;
	const contentFor = (
		artifact: ProductReviewArtifact,
		stage: RecoveryState["stage"],
		ownerId?: string,
		executionBinding?: RecoveryExecutionBinding,
	) =>
		`${canonicalJson({
			issueId: artifact.payload.issue.id,
			digest: artifact.digest,
			stage,
			...(ownerId ? { ownerId } : {}),
			...(executionBinding ? { executionBinding } : {}),
		})}\n`;

	async function verifyRevision(
		project: string,
		topic: string,
		revision: string,
		expectedContent: string,
	): Promise<void> {
		const [readBack, current] = await Promise.all([
			options.store.readRevision(project, topic, revision),
			options.store.readCurrent(project, topic),
		]);
		if (readBack !== expectedContent)
			throw new Error("Product review publication recovery read-back mismatch.");
		if (current?.revision !== revision || current.content !== expectedContent)
			throw new Error(
				"Product review publication recovery current revision mismatch.",
			);
	}

	async function writeAndVerify(
		project: string,
		artifact: ProductReviewArtifact,
		stage: RecoveryState["stage"],
		expectedRevision: string | undefined,
		ownerId?: string,
		executionBinding?: RecoveryExecutionBinding,
	): Promise<void> {
		const topic = destination(artifact.payload.issue.id);
		const content = contentFor(artifact, stage, ownerId, executionBinding);
		const saved = await options.store.write(
			project,
			topic,
			content,
			expectedRevision,
		);
		await verifyRevision(project, topic, saved.revision, content);
	}

	return {
		async read(issueId) {
			const project = currentProject();
			const topic = destination(issueId);
			const current = await options.store.readCurrent(project, topic);
			if (!current) return undefined;
			await verifyRevision(project, topic, current.revision, current.content);
			const state = parseRecoveryState(current.content, issueId);
			return state.stage === "uncertain" || state.stage === "verified"
				? {
						digest: state.digest,
						stage: state.stage,
						...(state.executionBinding
							? { executionBinding: state.executionBinding }
							: {}),
					}
				: undefined;
		},
		async bindExecution(artifact, lease) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for product review recovery.",
				);
			const project = currentProject();
			const issueId = artifact.payload.issue.id;
			const topic = destination(issueId);
			const executionBinding: RecoveryExecutionBinding = {
				decisionId: lease.decisionId,
				operationDigest: lease.operationDigest,
				executionId: lease.executionId,
				generation: lease.generation,
			};
			const manifest: ExecutionManifestBinding = {
				...executionBinding,
				ref: `workflow://product-review/${issueId}/publication/${artifact.digest}`,
			};
			const current = await options.store.readCurrent(project, topic);
			if (current) {
				const state = parseRecoveryState(current.content, issueId);
				if (
					state.stage === "released" &&
					(state.digest !== artifact.digest ||
						(state.executionBinding &&
							canonicalJson(state.executionBinding) !==
								canonicalJson(executionBinding)))
				) {
					await writeAndVerify(
						project,
						artifact,
						"released",
						current.revision,
						state.ownerId,
						executionBinding,
					);
					return manifest;
				}
				if (state.digest !== artifact.digest)
					throw new Error("Product review publication recovery state conflicts.");
				if (state.executionBinding) {
					if (
						canonicalJson(state.executionBinding) !==
						canonicalJson(executionBinding)
					)
						throw new Error(
							"Product review publication execution binding conflicts.",
						);
					await verifyRevision(project, topic, current.revision, current.content);
					return manifest;
				}
				await writeAndVerify(
					project,
					artifact,
					state.stage,
					current.revision,
					state.ownerId,
					executionBinding,
				);
				return manifest;
			}
			await writeAndVerify(
				project,
				artifact,
				"released",
				undefined,
				undefined,
				executionBinding,
			);
			return manifest;
		},
		async claim(artifact, ownerId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for product review recovery.",
				);
			const project = currentProject();
			const issueId = artifact.payload.issue.id;
			const topic = destination(issueId);
			const current = await options.store.readCurrent(project, topic);
			if (current) {
				const state = parseRecoveryState(current.content, issueId);
				if (state.stage === "uncertain" && state.digest !== artifact.digest)
					throw new Error("Product review publication recovery state conflicts.");
				if (state.stage === "uncertain" && state.ownerId === ownerId) {
					await verifyRevision(project, topic, current.revision, current.content);
					return;
				}
				if (state.stage === "uncertain")
					throw new Error(
						"Product review publication recovery claim is already owned.",
					);
				if (state.stage === "verified")
					throw new Error("Product review publication is already verified.");
			}
			const content = contentFor(
				artifact,
				"uncertain",
				ownerId,
				current ? parseRecoveryState(current.content, issueId).executionBinding : undefined,
			);
			try {
				const saved = await options.store.write(
					project,
					topic,
					content,
					current?.revision,
				);
				await verifyRevision(project, topic, saved.revision, content);
			} catch (error) {
				const latest = await options.store.readCurrent(project, topic);
				if (latest) {
					const state = parseRecoveryState(latest.content, issueId);
					if (state.digest !== artifact.digest)
						throw new Error(
							"Product review publication recovery state conflicts.",
						);
					if (state.stage === "uncertain" && state.ownerId === ownerId) {
						await verifyRevision(
							project,
							topic,
							latest.revision,
							latest.content,
						);
						return;
					}
					if (state.stage === "uncertain")
						throw new Error(
							"Product review publication recovery claim is already owned.",
						);
				}
				throw error;
			}
		},
		async release(artifact, ownerId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for product review recovery.",
				);
			const project = currentProject();
			const issueId = artifact.payload.issue.id;
			const topic = destination(issueId);
			const current = await options.store.readCurrent(project, topic);
			if (!current) return;
			const state = parseRecoveryState(current.content, issueId);
			if (state.digest !== artifact.digest || state.stage === "verified")
				throw new Error("Product review publication recovery state conflicts.");
			if (state.ownerId !== ownerId)
				throw new Error(
					"Product review publication recovery claim is already owned.",
				);
			if (state.stage === "released") {
				await verifyRevision(project, topic, current.revision, current.content);
				return;
			}
			await writeAndVerify(
				project,
				artifact,
				"released",
				current.revision,
				ownerId,
				state.executionBinding,
			);
		},
		async finalizeVerified(artifact) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for product review recovery.",
				);
			const project = currentProject();
			const issueId = artifact.payload.issue.id;
			const topic = destination(issueId);
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const current = await options.store.readCurrent(project, topic);
				const currentState = current
					? parseRecoveryState(current.content, issueId)
					: undefined;
				const content = contentFor(
					artifact,
					"verified",
					undefined,
					currentState?.executionBinding,
				);
				if (current) {
					const state = currentState as RecoveryState;
					if (state.digest !== artifact.digest)
						throw new Error(
							"Product review publication recovery state conflicts.",
						);
					if (state.stage === "verified") {
						await verifyRevision(
							project,
							topic,
							current.revision,
							current.content,
						);
						return;
					}
				}
				try {
					const saved = await options.store.write(
						project,
						topic,
						content,
						current?.revision,
					);
					await verifyRevision(project, topic, saved.revision, content);
					return;
				} catch (error) {
					const latest = await options.store.readCurrent(project, topic);
					if (latest) {
						const state = parseRecoveryState(latest.content, issueId);
						if (state.digest !== artifact.digest)
							throw new Error(
								"Product review publication recovery state conflicts.",
							);
						if (state.stage === "verified") {
							await verifyRevision(
								project,
								topic,
								latest.revision,
								latest.content,
							);
							return;
						}
					}
					if (attempt === 2) throw error;
				}
			}
		},
	};
}
