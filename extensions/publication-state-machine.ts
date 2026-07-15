import type { PublicationManifest } from "./publication-manifest.ts";

export interface PublicationIdentity {
	definitionId: string;
	specDigest: string;
	specRevision: string;
	sourceRevision: string;
	publicationKey: string;
}

interface ManifestStore {
	create(value: Omit<PublicationManifest, "digest">): PublicationManifest;
	load(
		definitionId: string,
	): Promise<{ revision: string; value: PublicationManifest } | undefined>;
	save(value: PublicationManifest, expectedRevision?: string): Promise<string>;
}

export interface PublicationClaim {
	definitionId: string;
	reservationId: string;
}

type PublicationState =
	| { status: "claimed"; claim: PublicationClaim }
	| {
			status: "recovery-required";
			stage: "creating" | "created";
			parentId?: string;
	  }
	| { status: "verified"; parentId: string }
	| { status: "prepared" }
	| { status: "blocked"; blocker: { code: string; message: string } };

function blocked(error: unknown): PublicationState {
	return {
		status: "blocked",
		blocker: {
			code:
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "PI_WORKFLOW_PUBLICATION_FAILED",
			message:
				error instanceof Error
					? error.message
					: "Publication transition failed.",
		},
	};
}

function matches(
	value: PublicationManifest,
	identity: PublicationIdentity,
): boolean {
	return (
		value.definitionId === identity.definitionId &&
		value.specDigest === identity.specDigest &&
		value.specRevision === identity.specRevision &&
		value.sourceRevision === identity.sourceRevision &&
		value.publicationKey === identity.publicationKey
	);
}

function next(
	store: ManifestStore,
	current: PublicationManifest,
	stage: PublicationManifest["stage"],
	changes: Partial<
		Pick<PublicationManifest, "reservationId" | "parentId">
	> = {},
): PublicationManifest {
	const { digest: _digest, ...unsigned } = current;
	return store.create({ ...unsigned, ...changes, stage });
}

export function createPublicationStateMachine(options: {
	store: ManifestStore;
	createReservationId(): string;
}) {
	async function prepare(
		identity: PublicationIdentity,
	): Promise<PublicationState> {
		try {
			const stored = await options.store.load(identity.definitionId);
			if (stored) {
				if (!matches(stored.value, identity)) {
					return blocked(
						Object.assign(new Error("The publication manifest is stale."), {
							code: "PI_WORKFLOW_PUBLICATION_STALE",
						}),
					);
				}
				if (stored.value.stage === "verified" && stored.value.parentId)
					return { status: "verified", parentId: stored.value.parentId };
				if (stored.value.stage === "created")
					return {
						status: "recovery-required",
						stage: "created",
						parentId: stored.value.parentId,
					};
				if (stored.value.stage === "creating")
					return { status: "recovery-required", stage: "creating" };
				return { status: "prepared" };
			}
			const value = options.store.create({
				...identity,
				schemaVersion: 1,
				stage: "prepared",
				reservationId: options.createReservationId(),
			});
			await options.store.save(value);
			return { status: "prepared" };
		} catch (error) {
			return blocked(error);
		}
	}

	async function claim(
		identity: PublicationIdentity,
	): Promise<PublicationState> {
		const prepared = await prepare(identity);
		if (prepared.status !== "prepared") return prepared;
		try {
			const stored = await options.store.load(identity.definitionId);
			if (
				stored?.value.stage !== "prepared" ||
				!matches(stored.value, identity)
			)
				return blocked(
					Object.assign(new Error("Publication claim changed."), {
						code: "PI_WORKFLOW_PUBLICATION_CONFLICT",
					}),
				);
			const reservationId = options.createReservationId();
			await options.store.save(
				next(options.store, stored.value, "creating", { reservationId }),
				stored.revision,
			);
			return {
				status: "claimed",
				claim: { definitionId: identity.definitionId, reservationId },
			};
		} catch (error) {
			return blocked(error);
		}
	}

	async function transitionClaim(
		claim: PublicationClaim,
		stage: "prepared" | "created",
		parentId?: string,
	): Promise<PublicationState> {
		try {
			const stored = await options.store.load(claim.definitionId);
			if (
				stored?.value.stage !== "creating" ||
				stored.value.reservationId !== claim.reservationId
			) {
				return blocked(
					Object.assign(
						new Error("Publication claim is not owned by this publisher."),
						{ code: "PI_WORKFLOW_PUBLICATION_CONFLICT" },
					),
				);
			}
			await options.store.save(
				next(options.store, stored.value, stage, parentId ? { parentId } : {}),
				stored.revision,
			);
			return stage === "prepared"
				? { status: "prepared" }
				: { status: "recovery-required", stage: "created", parentId };
		} catch (error) {
			return blocked(error);
		}
	}

	async function recordVerified(
		definitionId: string,
		parentId: string,
	): Promise<PublicationState> {
		try {
			const stored = await options.store.load(definitionId);
			if (
				stored?.value.stage !== "created" ||
				stored.value.parentId !== parentId
			)
				return blocked(
					Object.assign(new Error("Created publication identity changed."), {
						code: "PI_WORKFLOW_PUBLICATION_CONFLICT",
					}),
				);
			await options.store.save(
				next(options.store, stored.value, "verified"),
				stored.revision,
			);
			return { status: "verified", parentId };
		} catch (error) {
			return blocked(error);
		}
	}

	return {
		prepare,
		claim,
		releasePreCreateClaim: (claim: PublicationClaim) =>
			transitionClaim(claim, "prepared"),
		recordCreated: (claim: PublicationClaim, parentId: string) =>
			transitionClaim(claim, "created", parentId),
		recordVerified,
	};
}
