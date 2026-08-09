import type {
	ExecutionLease,
	ExecutionManifestBinding,
} from "./interactive-decisions.ts";
import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface RecoveryExecutionBinding {
	readonly decisionId: string;
	readonly operationDigest: string;
	readonly executionId: string;
	readonly generation: number;
}

interface ArtifactIdentity {
	readonly issueId: string;
	readonly digest: string;
}

interface RecoveryState extends ArtifactIdentity {
	readonly stage: "uncertain" | "released" | "verified";
	readonly ownerId?: string;
	readonly executionBinding?: RecoveryExecutionBinding;
}

const executionEvidencePolicy = Object.freeze({
	executionId: (value: unknown): value is string =>
		typeof value === "string" && value.length > 0,
	generation: (value: unknown): value is number =>
		Number.isSafeInteger(value) && (value as number) >= 1,
});

export interface DurablePublicationRecoveryStore<Artifact> {
	read(issueId: string): Promise<
		| {
				readonly digest: string;
				readonly stage: "uncertain" | "verified";
				readonly executionBinding?: RecoveryExecutionBinding;
		  }
		| undefined
	>;
	bindExecution(
		artifact: Artifact,
		lease: ExecutionLease,
	): Promise<ExecutionManifestBinding>;
	claim(artifact: Artifact, ownerId: string): Promise<void>;
	release(artifact: Artifact, ownerId: string): Promise<void>;
	finalizeVerified(artifact: Artifact): Promise<void>;
}

interface DurablePublicationRecoveryOptions<Artifact> {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topic: string;
	readonly publicationName: string;
	readonly recoveryName: string;
	readonly raceRecovery:
		| "write-or-read-back-failure"
		| "write-failure-only";
	readonly artifactIdentity: (artifact: Artifact) => ArtifactIdentity;
	readonly manifestRef: (identity: ArtifactIdentity) => string;
}

function createMessages(options: {
	readonly publicationName: string;
	readonly recoveryName: string;
}) {
	return {
		invalid: `${options.publicationName} publication recovery state is invalid.`,
		readBack: `${options.publicationName} publication recovery read-back mismatch.`,
		currentRevision: `${options.publicationName} publication recovery current revision mismatch.`,
		casRequired: `Atomic compare-and-swap is required for ${options.recoveryName} recovery.`,
		stateConflict: `${options.publicationName} publication recovery state conflicts.`,
		executionConflict: `${options.publicationName} publication execution binding conflicts.`,
		claimOwned: `${options.publicationName} publication recovery claim is already owned.`,
		alreadyVerified: `${options.publicationName} publication is already verified.`,
	};
}

function parseRecoveryState(
	content: string,
	issueId: string,
	invalidMessage: string,
): RecoveryState {
	const value: unknown = JSON.parse(content);
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).length < 3 ||
		Object.keys(value).length > 5 ||
		!Object.keys(value).every((key) =>
			["issueId", "digest", "stage", "ownerId", "executionBinding"].includes(
				key,
			),
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
				!executionEvidencePolicy.executionId(
					value.executionBinding.executionId,
				) ||
				!("generation" in value.executionBinding) ||
				!executionEvidencePolicy.generation(
					value.executionBinding.generation,
				))) ||
		content !== `${canonicalJson(value)}\n`
	)
		throw new Error(invalidMessage);
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

export function createDurablePublicationRecoveryStore<Artifact>(
	options: DurablePublicationRecoveryOptions<Artifact>,
): DurablePublicationRecoveryStore<Artifact> {
	const messages = createMessages(options);
	const destination = (issueId: string) => `${options.topic}/${issueId}`;
	const currentProject = () =>
		typeof options.project === "function" ? options.project() : options.project;
	const contentFor = (
		identity: ArtifactIdentity,
		stage: RecoveryState["stage"],
		ownerId?: string,
		executionBinding?: RecoveryExecutionBinding,
	) =>
		`${canonicalJson({
			issueId: identity.issueId,
			digest: identity.digest,
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
		if (readBack !== expectedContent) throw new Error(messages.readBack);
		if (current?.revision !== revision || current.content !== expectedContent)
			throw new Error(messages.currentRevision);
	}

	async function writeAndVerify(
		project: string,
		identity: ArtifactIdentity,
		stage: RecoveryState["stage"],
		expectedRevision: string | undefined,
		ownerId?: string,
		executionBinding?: RecoveryExecutionBinding,
	): Promise<void> {
		const topic = destination(identity.issueId);
		const content = contentFor(identity, stage, ownerId, executionBinding);
		const saved = await options.store.write(
			project,
			topic,
			content,
			expectedRevision,
		);
		await verifyRevision(project, topic, saved.revision, content);
	}

	function requireCas(): void {
		if (options.store.capabilities?.atomicCompareAndSwap !== true)
			throw new Error(messages.casRequired);
	}

	return {
		async read(issueId) {
			const project = currentProject();
			const topic = destination(issueId);
			const current = await options.store.readCurrent(project, topic);
			if (!current) return undefined;
			await verifyRevision(project, topic, current.revision, current.content);
			const state = parseRecoveryState(current.content, issueId, messages.invalid);
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
			requireCas();
			const project = currentProject();
			const identity = options.artifactIdentity(artifact);
			const topic = destination(identity.issueId);
			const executionBinding: RecoveryExecutionBinding = {
				decisionId: lease.decisionId,
				operationDigest: lease.operationDigest,
				executionId: lease.executionId,
				generation: lease.generation,
			};
			const manifest: ExecutionManifestBinding = {
				...executionBinding,
				ref: options.manifestRef(identity),
			};
			const current = await options.store.readCurrent(project, topic);
			if (current) {
				const state = parseRecoveryState(
					current.content,
					identity.issueId,
					messages.invalid,
				);
				if (
					state.stage === "released" &&
					(state.digest !== identity.digest ||
						(state.executionBinding &&
							canonicalJson(state.executionBinding) !==
								canonicalJson(executionBinding)))
				) {
					await writeAndVerify(
						project,
						identity,
						"released",
						current.revision,
						state.ownerId,
						executionBinding,
					);
					return manifest;
				}
				if (state.digest !== identity.digest)
					throw new Error(messages.stateConflict);
				if (state.executionBinding) {
					if (
						canonicalJson(state.executionBinding) !==
						canonicalJson(executionBinding)
					)
						throw new Error(messages.executionConflict);
					await verifyRevision(project, topic, current.revision, current.content);
					return manifest;
				}
				await writeAndVerify(
					project,
					identity,
					state.stage,
					current.revision,
					state.ownerId,
					executionBinding,
				);
				return manifest;
			}
			await writeAndVerify(
				project,
				identity,
				"released",
				undefined,
				undefined,
				executionBinding,
			);
			return manifest;
		},
		async claim(artifact, ownerId) {
			requireCas();
			const project = currentProject();
			const identity = options.artifactIdentity(artifact);
			const topic = destination(identity.issueId);
			const current = await options.store.readCurrent(project, topic);
			let currentState: RecoveryState | undefined;
			if (current) {
				currentState = parseRecoveryState(
					current.content,
					identity.issueId,
					messages.invalid,
				);
				if (
					currentState.stage === "uncertain" &&
					currentState.digest !== identity.digest
				)
					throw new Error(messages.stateConflict);
				if (
					currentState.stage === "uncertain" &&
					currentState.ownerId === ownerId
				) {
					await verifyRevision(project, topic, current.revision, current.content);
					return;
				}
				if (currentState.stage === "uncertain")
					throw new Error(messages.claimOwned);
				if (currentState.stage === "verified")
					throw new Error(messages.alreadyVerified);
			}
			const content = contentFor(
				identity,
				"uncertain",
				ownerId,
				currentState?.executionBinding,
			);
			const writeClaim = () =>
				options.store.write(
					project,
					topic,
					content,
					current?.revision,
				);
			async function recoverClaimRace(error: unknown): Promise<void> {
				const latest = await options.store.readCurrent(project, topic);
				if (latest) {
					const state = parseRecoveryState(
						latest.content,
						identity.issueId,
						messages.invalid,
					);
					if (state.digest !== identity.digest)
						throw new Error(messages.stateConflict);
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
						throw new Error(messages.claimOwned);
				}
				throw error;
			}
			if (options.raceRecovery === "write-or-read-back-failure") {
				try {
					const saved = await writeClaim();
					await verifyRevision(project, topic, saved.revision, content);
				} catch (error) {
					await recoverClaimRace(error);
				}
				return;
			}
			let saved: { readonly revision: string };
			try {
				saved = await writeClaim();
			} catch (error) {
				await recoverClaimRace(error);
				return;
			}
			await verifyRevision(project, topic, saved.revision, content);
		},
		async release(artifact, ownerId) {
			requireCas();
			const project = currentProject();
			const identity = options.artifactIdentity(artifact);
			const topic = destination(identity.issueId);
			const current = await options.store.readCurrent(project, topic);
			if (!current) return;
			const state = parseRecoveryState(
				current.content,
				identity.issueId,
				messages.invalid,
			);
			if (state.digest !== identity.digest || state.stage === "verified")
				throw new Error(messages.stateConflict);
			if (state.ownerId !== ownerId) throw new Error(messages.claimOwned);
			if (state.stage === "released") {
				await verifyRevision(project, topic, current.revision, current.content);
				return;
			}
			await writeAndVerify(
				project,
				identity,
				"released",
				current.revision,
				ownerId,
				state.executionBinding,
			);
		},
		async finalizeVerified(artifact) {
			requireCas();
			const project = currentProject();
			const identity = options.artifactIdentity(artifact);
			const topic = destination(identity.issueId);
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const current = await options.store.readCurrent(project, topic);
				const currentState = current
					? parseRecoveryState(
							current.content,
							identity.issueId,
							messages.invalid,
						)
					: undefined;
				const content = contentFor(
					identity,
					"verified",
					undefined,
					currentState?.executionBinding,
				);
				if (current) {
					const state = currentState as RecoveryState;
					if (state.digest !== identity.digest)
						throw new Error(messages.stateConflict);
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
				const writeVerified = () =>
					options.store.write(
						project,
						topic,
						content,
						current?.revision,
					);
				async function recoverFinalRace(error: unknown): Promise<boolean> {
					const latest = await options.store.readCurrent(project, topic);
					if (latest) {
						const state = parseRecoveryState(
							latest.content,
							identity.issueId,
							messages.invalid,
						);
						if (state.digest !== identity.digest)
							throw new Error(messages.stateConflict);
						if (state.stage === "verified") {
							await verifyRevision(
								project,
								topic,
								latest.revision,
								latest.content,
							);
							return true;
						}
					}
					if (attempt === 2) throw error;
					return false;
				}
				if (options.raceRecovery === "write-or-read-back-failure") {
					try {
						const saved = await writeVerified();
						await verifyRevision(project, topic, saved.revision, content);
						return;
					} catch (error) {
						if (await recoverFinalRace(error)) return;
					}
					continue;
				}
				let saved: { readonly revision: string };
				try {
					saved = await writeVerified();
				} catch (error) {
					if (await recoverFinalRace(error)) return;
					continue;
				}
				await verifyRevision(project, topic, saved.revision, content);
				return;
			}
		},
	};
}
