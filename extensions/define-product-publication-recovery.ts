import { canonicalJson, sha256Hex } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface DefineProductPublicationIdentity {
	readonly definitionId: string;
	readonly publicationDigest: string;
}

interface RecoveryState extends DefineProductPublicationIdentity {
	readonly stage: "uncertain" | "created" | "released" | "verified";
	readonly ownerId?: string;
	readonly issueId?: string;
}

export interface DefineProductPublicationRecoveryStore {
	read(definitionId: string): Promise<
		| {
				readonly publicationDigest: string;
				readonly stage: "uncertain" | "created" | "verified";
				readonly issueId?: string;
		  }
		| undefined
	>;
	claim(identity: DefineProductPublicationIdentity, ownerId: string): Promise<void>;
	recordCreated(
		identity: DefineProductPublicationIdentity,
		ownerId: string,
		issueId: string,
	): Promise<void>;
	release(identity: DefineProductPublicationIdentity, ownerId: string): Promise<void>;
	finalizeVerified(
		identity: DefineProductPublicationIdentity,
		issueId: string,
	): Promise<void>;
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function parseRecoveryState(content: string, definitionId: string): RecoveryState {
	const value: unknown = JSON.parse(content);
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!("definitionId" in value) ||
		value.definitionId !== definitionId ||
		!("publicationDigest" in value) ||
		typeof value.publicationDigest !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.publicationDigest) ||
		!("stage" in value) ||
		(value.stage !== "uncertain" &&
			value.stage !== "created" &&
			value.stage !== "released" &&
			value.stage !== "verified") ||
		("ownerId" in value && !nonEmpty(value.ownerId)) ||
		("issueId" in value && !nonEmpty(value.issueId)) ||
		(value.stage === "uncertain" &&
			(!("ownerId" in value) || "issueId" in value)) ||
		(value.stage === "created" &&
			(!("ownerId" in value) || !("issueId" in value))) ||
		(value.stage === "released" &&
			(!("ownerId" in value) || "issueId" in value)) ||
		(value.stage === "verified" &&
			("ownerId" in value || !("issueId" in value))) ||
		!Object.keys(value).every((key) =>
			["definitionId", "publicationDigest", "stage", "ownerId", "issueId"].includes(
				key,
			),
		) ||
		(value.stage !== "created" && content !== `${canonicalJson(value)}\n`)
	)
		throw new Error("Define-product publication recovery state is invalid.");
	return value as RecoveryState;
}

export function createDefineProductPublicationRecoveryStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topic?: string;
}): DefineProductPublicationRecoveryStore {
	const prefix = options.topic ?? "workflow/define-product-publication-recovery";
	const currentProject = () =>
		typeof options.project === "function" ? options.project() : options.project;
	const destination = (definitionId: string) =>
		`${prefix}/${sha256Hex(definitionId)}`;
	const contentFor = (
		identity: DefineProductPublicationIdentity,
		stage: RecoveryState["stage"],
		ownerId?: string,
		issueId?: string,
	) =>
		`${canonicalJson({
			definitionId: identity.definitionId,
			publicationDigest: identity.publicationDigest,
			stage,
			...(ownerId ? { ownerId } : {}),
			...(issueId ? { issueId } : {}),
		})}\n`;

	async function verify(
		project: string,
		topic: string,
		revision: string,
		expectedContent: string,
	): Promise<void> {
		const [revisionContent, current] = await Promise.all([
			options.store.readRevision(project, topic, revision),
			options.store.readCurrent(project, topic),
		]);
		if (revisionContent !== expectedContent)
			throw new Error("Define-product publication recovery read-back mismatch.");
		if (current?.revision !== revision || current.content !== expectedContent)
			throw new Error(
				"Define-product publication recovery current revision mismatch.",
			);
	}

	async function write(
		project: string,
		identity: DefineProductPublicationIdentity,
		stage: RecoveryState["stage"],
		expectedRevision: string | undefined,
		ownerId?: string,
		issueId?: string,
	): Promise<void> {
		const topic = destination(identity.definitionId);
		const content = contentFor(identity, stage, ownerId, issueId);
		const saved = await options.store.write(
			project,
			topic,
			content,
			expectedRevision,
		);
		await verify(project, topic, saved.revision, content);
	}

	function assertIdentity(
		state: RecoveryState,
		identity: DefineProductPublicationIdentity,
	): void {
		if (state.publicationDigest !== identity.publicationDigest)
			throw new Error("Define-product publication recovery state conflicts.");
	}

	return {
		async read(definitionId) {
			const project = currentProject();
			const topic = destination(definitionId);
			const current = await options.store.readCurrent(project, topic);
			if (!current) return undefined;
			await verify(project, topic, current.revision, current.content);
			const state = parseRecoveryState(current.content, definitionId);
			return state.stage === "uncertain" ||
				state.stage === "created" ||
				state.stage === "verified"
				? {
						publicationDigest: state.publicationDigest,
						stage: state.stage,
						...(state.issueId ? { issueId: state.issueId } : {}),
					}
				: undefined;
		},
		async claim(identity, ownerId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for define-product publication recovery.",
				);
			const project = currentProject();
			const topic = destination(identity.definitionId);
			const current = await options.store.readCurrent(project, topic);
			if (current) {
				const state = parseRecoveryState(current.content, identity.definitionId);
				assertIdentity(state, identity);
				if (state.stage === "verified")
					throw new Error("Define-product publication is already verified.");
				if (state.stage === "uncertain" || state.stage === "created") {
					if (state.ownerId !== ownerId)
						throw new Error(
							"Define-product publication recovery claim is already owned.",
						);
					await verify(project, topic, current.revision, current.content);
					return;
				}
			}
			await write(
				project,
				identity,
				"uncertain",
				current?.revision,
				ownerId,
			);
		},
		async recordCreated(identity, ownerId, issueId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for define-product publication recovery.",
				);
			const project = currentProject();
			const topic = destination(identity.definitionId);
			const current = await options.store.readCurrent(project, topic);
			if (!current)
				throw new Error("Define-product publication recovery state conflicts.");
			const state = parseRecoveryState(current.content, identity.definitionId);
			assertIdentity(state, identity);
			if (state.ownerId !== ownerId)
				throw new Error("Define-product publication recovery state conflicts.");
			if (state.stage === "created") {
				if (state.issueId !== issueId)
					throw new Error(
						"Define-product created publication identity conflicts.",
					);
				await verify(project, topic, current.revision, current.content);
				return;
			}
			if (state.stage !== "uncertain")
				throw new Error("Define-product publication recovery state conflicts.");
			await write(
				project,
				identity,
				"created",
				current.revision,
				ownerId,
				issueId,
			);
		},
		async release(identity, ownerId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for define-product publication recovery.",
				);
			const project = currentProject();
			const topic = destination(identity.definitionId);
			const current = await options.store.readCurrent(project, topic);
			if (!current) return;
			const state = parseRecoveryState(current.content, identity.definitionId);
			assertIdentity(state, identity);
			if (
				state.stage === "verified" ||
				state.stage === "created" ||
				state.ownerId !== ownerId
			)
				throw new Error("Define-product publication recovery state conflicts.");
			if (state.stage === "released") {
				await verify(project, topic, current.revision, current.content);
				return;
			}
			await write(
				project,
				identity,
				"released",
				current.revision,
				ownerId,
			);
		},
		async finalizeVerified(identity, issueId) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw new Error(
					"Atomic compare-and-swap is required for define-product publication recovery.",
				);
			const project = currentProject();
			const topic = destination(identity.definitionId);
			const content = contentFor(identity, "verified", undefined, issueId);
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const current = await options.store.readCurrent(project, topic);
				if (current) {
					const state = parseRecoveryState(current.content, identity.definitionId);
					assertIdentity(state, identity);
					if (state.stage === "verified") {
						if (state.issueId !== issueId)
							throw new Error(
								"Define-product verified publication identity conflicts.",
							);
						await verify(project, topic, current.revision, current.content);
						return;
					}
					if (state.stage !== "uncertain" && state.stage !== "created")
						throw new Error(
							"Define-product publication recovery is not pending verification.",
						);
					if (state.stage === "created" && state.issueId !== issueId)
						throw new Error(
							"Define-product created publication identity conflicts.",
						);
				}
				try {
					const saved = await options.store.write(
						project,
						topic,
						content,
						current?.revision,
					);
					await verify(project, topic, saved.revision, content);
					return;
				} catch (error) {
					if (attempt === 2) throw error;
				}
			}
		},
	};
}
