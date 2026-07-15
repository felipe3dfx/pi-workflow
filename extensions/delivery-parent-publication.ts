import type { ApprovedProductSpecRead } from "./engram-approved-spec-reader.ts";
import type {
	LinearDeliveryParent,
	LinearDeliveryParentCreate,
	LinearPublicationPreflight,
} from "./linear-delivery-parent-gateway.ts";
import { validateProductSpecApproval } from "./product-spec.ts";
import {
	createPublicationStateMachine,
	type PublicationClaim,
} from "./publication-state-machine.ts";
import {
	canonicalJson,
	digestCanonicalValue,
	type AuthenticatedAuthority,
} from "./workflow-contracts.ts";

type Outcome =
	| { status: "spec-published"; parent: LinearDeliveryParent }
	| { status: "blocked"; blocker: { code: string; message: string } };

export interface DeliveryParentPublicationDependencies {
	approvedSpecReader: {
		read(id: string): Promise<ApprovedProductSpecRead>;
		save?(
			id: string,
			artifact: Omit<ApprovedProductSpecRead, "sourceRevision">,
		): Promise<ApprovedProductSpecRead>;
	};
	authenticatedAuthority: { current(): Promise<AuthenticatedAuthority> };
	state: ReturnType<typeof createPublicationStateMachine>;
	linear: {
		preflight(teamId: string): Promise<LinearPublicationPreflight>;
		create(input: LinearDeliveryParentCreate): Promise<LinearDeliveryParent>;
		findByPublicationKey(
			teamId: string,
			key: string,
			revision: string,
		): Promise<readonly LinearDeliveryParent[]>;
		read(
			id: string,
			revision: string,
			key: string,
		): Promise<LinearDeliveryParent | undefined>;
	};
}

function blocked(code: string, message: string): Outcome {
	return { status: "blocked", blocker: { code, message } };
}

function code(error: unknown): string {
	return error && typeof error === "object" && "code" in error
		? String(error.code)
		: "PI_WORKFLOW_PUBLICATION_FAILED";
}

function publicationKey(approved: ApprovedProductSpecRead): string {
	return digestCanonicalValue({
		schema: "delivery-parent-publication",
		definitionId: approved.spec.payload.definitionId,
		specDigest: approved.spec.digest,
		target: approved.spec.payload.target,
	});
}

function exact(
	parent: LinearDeliveryParent | undefined,
	approved: ApprovedProductSpecRead,
	key: string,
	id: string,
): parent is LinearDeliveryParent {
	const { target, revision, body } = approved.spec.payload;
	return (
		!!parent &&
		canonicalJson(parent) ===
			canonicalJson({
				id,
				teamId: target.teamId,
				title: target.title,
				description: body,
				descriptionRevision: revision,
				state: "Backlog",
				cycleId: null,
				assigneeId: null,
				publicationKey: key,
			})
	);
}

function approval(
	approved: ApprovedProductSpecRead,
	actor: AuthenticatedAuthority,
) {
	return validateProductSpecApproval({
		spec: approved.spec,
		approval: approved.approval,
		actor,
		target: approved.spec.payload.target,
		revision: approved.spec.payload.revision,
	});
}

export async function publishApprovedSpec(
	dependencies: DeliveryParentPublicationDependencies,
	definitionId: string,
): Promise<Outcome> {
	let claim: PublicationClaim | undefined;
	let createAttempted = false;
	const fail = async (error: unknown): Promise<Outcome> => {
		if (claim && !createAttempted) {
			const released = await dependencies.state.releasePreCreateClaim(claim);
			if (released.status === "blocked") return released;
		}
		return blocked(
			code(error),
			error instanceof Error
				? error.message
				: "Delivery parent publication failed.",
		);
	};
	try {
		const approved = await dependencies.approvedSpecReader.read(definitionId);
		const actor = await dependencies.authenticatedAuthority.current();
		const validated = approval(approved, actor);
		if (!validated.ok) return { status: "blocked", blocker: validated.blocker };
		if (approved.spec.payload.definitionId !== definitionId)
			return blocked(
				"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
				"Approved Spec identity mismatch.",
			);
		const key = publicationKey(approved);
		const identity = {
			definitionId,
			specDigest: approved.spec.digest,
			specRevision: approved.spec.payload.revision,
			sourceRevision: approved.sourceRevision,
			publicationKey: key,
		};
		let state = await dependencies.state.prepare(identity);
		if (state.status === "blocked") return state;
		let parent: LinearDeliveryParent | undefined;
		if (
			state.status === "verified" ||
			(state.status === "recovery-required" && state.stage === "created")
		) {
			const id = state.parentId;
			parent = id
				? await dependencies.linear.read(id, identity.specRevision, key)
				: undefined;
			if (!id || !exact(parent, approved, key, id))
				return blocked(
					"PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
					"Delivery parent read-back mismatch.",
				);
			if (state.status === "verified")
				return { status: "spec-published", parent };
		} else {
			if (state.status === "prepared")
				state = await dependencies.state.claim(identity);
			if (state.status === "blocked") return state;
			if (state.status === "verified")
				return blocked(
					"PI_WORKFLOW_PUBLICATION_CONFLICT",
					"Publication state changed before claim.",
				);
			if (state.status === "claimed") claim = state.claim;
			const preflight = await dependencies.linear.preflight(
				approved.spec.payload.target.teamId,
			);
			const matches = await dependencies.linear.findByPublicationKey(
				approved.spec.payload.target.teamId,
				key,
				identity.specRevision,
			);
			if (matches.length > 1)
				return fail(
					Object.assign(new Error("Duplicate publication key."), {
						code: "PI_WORKFLOW_PUBLICATION_DUPLICATE",
					}),
				);
			if (matches.length === 1) parent = matches[0];
			if (parent && !exact(parent, approved, key, parent.id))
				return fail(
					Object.assign(new Error("Recovered Delivery parent mismatch."), {
						code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
					}),
				);
			const [currentApproved, currentActor] = await Promise.all([
				dependencies.approvedSpecReader.read(definitionId),
				dependencies.authenticatedAuthority.current(),
			]);
			if (
				canonicalJson(currentApproved) !== canonicalJson(approved) ||
				!approval(approved, currentActor).ok
			)
				return fail(
					Object.assign(
						new Error("Approved Spec or Owner authority changed."),
						{ code: "PI_WORKFLOW_PUBLICATION_STALE" },
					),
				);
			if (!parent) {
				if (!claim)
					return blocked(
						"PI_WORKFLOW_PUBLICATION_CONFLICT",
						"Publication claim is not owned.",
					);
				createAttempted = true;
				parent = await dependencies.linear.create({
					teamId: approved.spec.payload.target.teamId,
					title: approved.spec.payload.target.title,
					description: approved.spec.payload.body,
					descriptionRevision: identity.specRevision,
					state: "Backlog",
					cycleId: null,
					assigneeId: null,
					publicationKey: key,
					expected: {
						accessRevision: preflight.accessRevision,
						capabilityRevision: preflight.capabilityRevision,
						stateRevision: preflight.stateRevision,
					},
				});
			}
			const recorded = claim
				? await dependencies.state.recordCreated(claim, parent.id)
				: await dependencies.state.recoverCreated(definitionId, parent.id);
			if (recorded.status === "blocked") return recorded;
		}
		const readBack = await dependencies.linear.read(
			parent.id,
			identity.specRevision,
			key,
		);
		if (!exact(readBack, approved, key, parent.id))
			return blocked(
				"PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH",
				"Delivery parent read-back mismatch.",
			);
		const verified = await dependencies.state.recordVerified(
			definitionId,
			parent.id,
		);
		if (verified.status === "verified")
			return { status: "spec-published", parent: readBack };
		return verified.status === "blocked"
			? verified
			: blocked(
					"PI_WORKFLOW_PUBLICATION_CONFLICT",
					"Publication verification state changed.",
				);
	} catch (error) {
		return fail(error);
	}
}
