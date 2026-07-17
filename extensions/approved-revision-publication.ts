import type { OwnerAuthority } from "./workflow-contracts.ts";
import { canonicalJson, digestCanonicalValue, type VerifiedArtifactRef } from "./workflow-contracts.ts";
import type { createApprovedRevisionPublicationManifestStore } from "./approved-revision-publication-manifest.ts";
import { digestApprovedRevision, digestApprovedRevisionDraft, type ApprovedRevisionDraftArtifact, type ApprovedRevisionStore } from "./approved-revision-store.ts";

interface ApprovedRevisionIssueChange {
	id: string;
	previousDescription: string;
	previousRevision: string;
	nextDescription: string;
}

interface ApprovedRevisionComment {
	kind: string;
	body: string;
}

interface ApprovedRevisionDecisionGap {
	issueId: string;
	body: string;
}

export interface ApprovedRevisionPublicationArtifact {
	definitionId: string;
	digest: string;
	kind: string;
	authority: OwnerAuthority;
	affectedIssues: readonly ApprovedRevisionIssueChange[];
	sourceComment: ApprovedRevisionComment;
	decisionGap?: ApprovedRevisionDecisionGap;
}

interface LinearApprovedRevisionWorkflowSnapshot {
	state: unknown;
	assignee: unknown;
	cycle: unknown;
	labels: unknown;
	project: unknown;
}

export interface LinearApprovedRevisionIssueSnapshot {
	id: string;
	description: string;
	updatedAt: string;
	workflow: LinearApprovedRevisionWorkflowSnapshot;
}

export interface LinearApprovedRevisionGateway {
	getIssue(input: { id: string }): Promise<LinearApprovedRevisionIssueSnapshot | undefined>;
	listComments(input: { issueId: string }): Promise<readonly { id: string; body: string }[]>;
	saveComment(input: { issueId: string; body: string }): Promise<{ id: string; body: string }>;
	saveIssue(input: { id: string; description: string }): Promise<LinearApprovedRevisionIssueSnapshot>;
}

interface ApprovedRevisionProposal {
	id: string;
	nextDescription: string;
}

export interface DraftApprovedRevisionInput {
	definitionId: string;
	revisionKind: string;
	affectedIssues: readonly ApprovedRevisionProposal[];
	sourceCommentKind: string;
	sourceCommentBody: string;
	decisionGap?: { issueId: string; body: string };
}

type Dependencies = {
	definitionId: string;
	digest: string;
	currentActor(): Promise<OwnerAuthority | undefined>;
	readApprovedRevision(definitionId: string, digest: string): Promise<ApprovedRevisionPublicationArtifact | undefined>;
	manifest: ReturnType<typeof createApprovedRevisionPublicationManifestStore>;
	gateway: LinearApprovedRevisionGateway;
};

type DraftOutcome =
	| { status: "revision-ready"; revision: ApprovedRevisionDraftArtifact; revisionRef: VerifiedArtifactRef }
	| { status: "blocked"; blocker: { code: string; message: string } };

type ApprovalOutcome =
	| { status: "revision-approved"; revision: ApprovedRevisionPublicationArtifact; revisionRef: VerifiedArtifactRef }
	| { status: "blocked"; blocker: { code: string; message: string } };

type Outcome =
	| { status: "revision-published"; definitionId: string; digest: string }
	| { status: "blocked"; blocker: { code: string; message: string } };

const blocked = (code: string, message: string): Outcome => ({ status: "blocked", blocker: { code, message } });
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const exact = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const reference = (kind: string, digest: string) => `Referencia de flujo: ${kind}:${digest}`;

function validateArtifact(value: ApprovedRevisionPublicationArtifact | undefined, definitionId: string, digest: string): string | undefined {
	if (!value || value.definitionId !== definitionId || value.digest !== digest || digestApprovedRevision(value) !== digest) return "Approved revision artifact is missing, mismatched, or has an invalid canonical digest.";
	if (!text(value.kind) || !text(value.sourceComment?.kind) || !text(value.sourceComment?.body)) return "Approved revision source comment is invalid.";
	if (!value.sourceComment.body.includes(reference(value.sourceComment.kind, digest))) return "Approved revision source comment is missing its visible flow reference.";
	if (value.decisionGap && (!text(value.decisionGap.issueId) || !text(value.decisionGap.body) || !value.decisionGap.body.includes(reference("decision-gap", digest)))) return "Approved revision decision-gap comment is invalid.";
	if (!Array.isArray(value.affectedIssues) || value.affectedIssues.length === 0) return "Approved revision must affect at least one issue.";
	const ids = new Set<string>();
	for (const issue of value.affectedIssues) {
		if (!text(issue.id) || !text(issue.previousRevision) || typeof issue.previousDescription !== "string" || typeof issue.nextDescription !== "string" || !issue.nextDescription.trim()) return "Approved revision issue change is invalid.";
		if (ids.has(issue.id)) return "Approved revision affected issues must be unique.";
		ids.add(issue.id);
	}
	if (value.decisionGap && !ids.has(value.decisionGap.issueId)) return "Decision-gap must be attached to an affected issue.";
	return undefined;
}

async function validateComments(gateway: LinearApprovedRevisionGateway, issueId: string, expected: ApprovedRevisionComment & { digest: string }): Promise<"missing" | "present" | "conflict"> {
	const comments = await gateway.listComments({ issueId });
	const marker = reference(expected.kind, expected.digest);
	const matching = comments.filter((comment) => comment.body.includes(marker));
	if (matching.some((comment) => comment.body !== expected.body)) return "conflict";
	return matching.some((comment) => comment.body === expected.body) ? "present" : "missing";
}

function workflowDigest(issue: LinearApprovedRevisionIssueSnapshot): string {
	return digestCanonicalValue(issue.workflow);
}

function sameWorkflow(left: LinearApprovedRevisionIssueSnapshot, right: LinearApprovedRevisionIssueSnapshot): boolean {
	return workflowDigest(left) === workflowDigest(right);
}

function unchangedAfterComment(before: LinearApprovedRevisionIssueSnapshot, after: LinearApprovedRevisionIssueSnapshot | undefined): boolean {
	return !!after && after.id === before.id && after.description === before.description && after.updatedAt === before.updatedAt && sameWorkflow(before, after);
}

function withDigest(value: string, digest: string): string {
	return value.replaceAll("{{digest}}", digest).replaceAll("DIGEST", digest);
}

function validateDraftInput(input: DraftApprovedRevisionInput): string | undefined {
	if (!text(input.definitionId) || !text(input.revisionKind) || !text(input.sourceCommentKind) || !text(input.sourceCommentBody)) return "Approved revision draft input is invalid.";
	if (!Array.isArray(input.affectedIssues) || input.affectedIssues.length === 0) return "Approved revision requires affected issues.";
	const ids = new Set<string>();
	for (const issue of input.affectedIssues) {
		if (!text(issue.id) || ids.has(issue.id) || !text(issue.nextDescription)) return "Approved revision affected issues are invalid.";
		ids.add(issue.id);
	}
	if (input.decisionGap && (!ids.has(input.decisionGap.issueId) || !text(input.decisionGap.body))) return "Approved revision decision-gap is invalid.";
}

export async function draftApprovedRevision(dependencies: { input: DraftApprovedRevisionInput; gateway: LinearApprovedRevisionGateway; store: Pick<ApprovedRevisionStore, "saveDraft"> }): Promise<DraftOutcome> {
	try {
		const invalid = validateDraftInput(dependencies.input);
		if (invalid) return blocked("PI_WORKFLOW_REVISION_ARTIFACT_INVALID", invalid) as DraftOutcome;
		const affectedIssues = [];
		for (const proposal of dependencies.input.affectedIssues) {
			const snapshot = await dependencies.gateway.getIssue({ id: proposal.id });
			if (!snapshot || snapshot.id !== proposal.id) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${proposal.id} could not be read before drafting.`) as DraftOutcome;
			affectedIssues.push({ id: proposal.id, previousDescription: snapshot.description, previousRevision: snapshot.updatedAt, nextDescription: proposal.nextDescription });
		}
		const unsigned = {
			definitionId: dependencies.input.definitionId,
			kind: dependencies.input.revisionKind,
			affectedIssues,
			sourceComment: { kind: dependencies.input.sourceCommentKind, body: dependencies.input.sourceCommentBody },
			...(dependencies.input.decisionGap ? { decisionGap: dependencies.input.decisionGap } : {}),
		};
		const placeholderDigest = digestApprovedRevisionDraft({ ...unsigned, digest: "placeholder" });
		const revision: ApprovedRevisionDraftArtifact = {
			...unsigned,
			digest: placeholderDigest,
			sourceComment: { ...unsigned.sourceComment, body: withDigest(unsigned.sourceComment.body, placeholderDigest) },
			...(unsigned.decisionGap ? { decisionGap: { ...unsigned.decisionGap, body: withDigest(unsigned.decisionGap.body, placeholderDigest) } } : {}),
		};
		const digest = digestApprovedRevisionDraft(revision);
		const normalized: ApprovedRevisionDraftArtifact = digest === revision.digest ? revision : { ...revision, digest, sourceComment: { ...revision.sourceComment, body: withDigest(unsigned.sourceComment.body, digest) }, ...(unsigned.decisionGap ? { decisionGap: { ...unsigned.decisionGap, body: withDigest(unsigned.decisionGap.body, digest) } } : {}) };
		const revisionRef = await dependencies.store.saveDraft(normalized);
		if (revisionRef.digest !== normalized.digest || revisionRef.schema !== "approved-revision-draft") return blocked("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "Approved revision draft could not be persisted with its exact identity.") as DraftOutcome;
		return { status: "revision-ready", revision: structuredClone(normalized), revisionRef };
	} catch (error) {
		return blocked(error && typeof error === "object" && "code" in error ? String(error.code) : "PI_WORKFLOW_PUBLICATION_FAILED", error instanceof Error ? error.message : "Approved revision draft failed.") as DraftOutcome;
	}
}

export async function approveDraftedRevision(dependencies: { definitionId: string; digest: string; currentActor(): Promise<OwnerAuthority | undefined>; gateway: LinearApprovedRevisionGateway; store: Pick<ApprovedRevisionStore, "readDraft" | "saveApproved"> }): Promise<ApprovalOutcome> {
	try {
		const draft = await dependencies.store.readDraft(dependencies.definitionId, dependencies.digest);
		if (!draft || draft.digest !== dependencies.digest || draft.definitionId !== dependencies.definitionId || digestApprovedRevisionDraft(draft) !== dependencies.digest) return blocked("PI_WORKFLOW_REVISION_ARTIFACT_INVALID", "Approved revision draft is missing or invalid.") as ApprovalOutcome;
		const actor = await dependencies.currentActor();
		if (actor?.role !== "Owner") return blocked("PI_WORKFLOW_REVISION_APPROVAL_MISMATCH", "Approved revision approval requires current Owner authority.") as ApprovalOutcome;
		for (const issue of draft.affectedIssues) {
			const snapshot = await dependencies.gateway.getIssue({ id: issue.id });
			if (!snapshot || snapshot.description !== issue.previousDescription || snapshot.updatedAt !== issue.previousRevision) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} changed before approved revision approval.`) as ApprovalOutcome;
		}
		const authority = { actorId: actor.actorId, role: "Owner" as const, authorityRevision: actor.authorityRevision };
		const provisional: ApprovedRevisionPublicationArtifact = {
			...draft,
			digest: "placeholder",
			authority,
			sourceComment: { ...draft.sourceComment, body: draft.sourceComment.body.replaceAll(draft.digest, "placeholder") },
			...(draft.decisionGap ? { decisionGap: { ...draft.decisionGap, body: draft.decisionGap.body.replaceAll(draft.digest, "placeholder") } } : {}),
		};
		const approvedDigest = digestApprovedRevision(provisional);
		const revision: ApprovedRevisionPublicationArtifact = {
			...provisional,
			digest: approvedDigest,
			sourceComment: { ...draft.sourceComment, body: withDigest(draft.sourceComment.body.replaceAll(draft.digest, "{{digest}}"), approvedDigest) },
			...(draft.decisionGap ? { decisionGap: { ...draft.decisionGap, body: withDigest(draft.decisionGap.body.replaceAll(draft.digest, "{{digest}}"), approvedDigest) } } : {}),
		};
		if (digestApprovedRevision(revision) !== approvedDigest) return blocked("PI_WORKFLOW_REVISION_ARTIFACT_INVALID", "Approved revision digest changed during approval.") as ApprovalOutcome;
		const revisionRef = await dependencies.store.saveApproved(revision);
		if (revisionRef.digest !== revision.digest || revisionRef.schema !== "approved-revision") return blocked("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "Approved revision could not be persisted with its exact identity.") as ApprovalOutcome;
		return { status: "revision-approved", revision: structuredClone(revision), revisionRef };
	} catch (error) {
		return blocked(error && typeof error === "object" && "code" in error ? String(error.code) : "PI_WORKFLOW_PUBLICATION_FAILED", error instanceof Error ? error.message : "Approved revision approval failed.") as ApprovalOutcome;
	}
}

export async function publishApprovedRevision(dependencies: Dependencies): Promise<Outcome> {
	try {
		const revision = await dependencies.readApprovedRevision(dependencies.definitionId, dependencies.digest);
		const invalid = validateArtifact(revision, dependencies.definitionId, dependencies.digest);
		if (invalid || !revision) return blocked("PI_WORKFLOW_REVISION_ARTIFACT_INVALID", invalid ?? "Approved revision artifact is invalid.");
		const actor = await dependencies.currentActor();
		if (!actor || !exact(actor, revision.authority) || actor.role !== "Owner") return blocked("PI_WORKFLOW_REVISION_APPROVAL_MISMATCH", "Approved revision publication requires the current exact Owner authority.");

		let manifest = await dependencies.manifest.prepare({ definitionId: revision.definitionId, digest: revision.digest, affectedIssueIds: revision.affectedIssues.map(({ id }) => id) });
		if (manifest.stage === "verified") return { status: "revision-published", definitionId: revision.definitionId, digest: revision.digest };

		const snapshots = new Map<string, LinearApprovedRevisionIssueSnapshot>();
		for (const issue of revision.affectedIssues) {
			const snapshot = await dependencies.gateway.getIssue({ id: issue.id });
			if (!snapshot || snapshot.id !== issue.id) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} could not be read before publication.`);
			const claim = manifest.descriptionClaims.find((entry) => entry.issueId === issue.id);
			const recordedAsUpdated = manifest.descriptions.includes(issue.id);
			const alreadyUpdated = (recordedAsUpdated || claim?.previousRevision === issue.previousRevision) && snapshot.description === issue.nextDescription;
			if (snapshot.description !== issue.previousDescription && !alreadyUpdated) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} description changed before approved revision publication.`);
			if (!alreadyUpdated && snapshot.updatedAt !== issue.previousRevision) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} revision changed before approved revision publication.`);
			if (alreadyUpdated && (!claim?.workflowDigest || claim.workflowDigest !== workflowDigest(snapshot))) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} workflow differs from its durable pre-write baseline.`);
			snapshots.set(issue.id, snapshot);
		}

		const commentPlans = [
			...revision.affectedIssues.map((issue) => ({ issueId: issue.id, kind: revision.sourceComment.kind, body: revision.sourceComment.body })),
			...(revision.decisionGap ? [{ issueId: revision.decisionGap.issueId, kind: "decision-gap", body: revision.decisionGap.body }] : []),
		];
		const commentStates = new Map<string, "missing" | "present" | "conflict">();
		for (const plan of commentPlans) {
			const state = await validateComments(dependencies.gateway, plan.issueId, { kind: plan.kind, body: plan.body, digest: revision.digest });
			if (state === "conflict") return blocked("PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT", `Issue ${plan.issueId} already has a different comment for ${reference(plan.kind, revision.digest)}.`);
			commentStates.set(`${plan.issueId}:${plan.kind}`, state);
		}

		if (manifest.stage === "prepared") manifest = await dependencies.manifest.advance(manifest.operationId, "prepared", "commenting");
		if (manifest.stage === "commenting") {
			let recorded = [...manifest.comments];
			for (const plan of commentPlans) {
				const key = `${plan.issueId}:${plan.kind}`;
				if (!recorded.some((entry) => `${entry.issueId}:${entry.kind}` === key)) {
					if (commentStates.get(key) !== "present") {
						await dependencies.gateway.saveComment({ issueId: plan.issueId, body: plan.body });
						const afterComment = await dependencies.gateway.getIssue({ id: plan.issueId });
						const beforeComment = snapshots.get(plan.issueId);
						if (!beforeComment || !unchangedAfterComment(beforeComment, afterComment)) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${plan.issueId} workflow changed while writing an approved comment.`);
						if (await validateComments(dependencies.gateway, plan.issueId, { kind: plan.kind, body: plan.body, digest: revision.digest }) !== "present") return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${plan.issueId} did not read back the approved flow reference comment.`);
					}
					recorded = [...recorded, { issueId: plan.issueId, kind: plan.kind }];
					manifest = await dependencies.manifest.record(manifest.operationId, "commenting", { comments: recorded });
				}
			}
			manifest = await dependencies.manifest.advance(manifest.operationId, "commenting", "describing");
		}

		if (manifest.stage === "describing") {
			let descriptions = [...manifest.descriptions];
			let descriptionClaims = [...manifest.descriptionClaims];
			for (const issue of revision.affectedIssues) {
				if (descriptions.includes(issue.id)) continue;
				let claim = descriptionClaims.find((entry) => entry.issueId === issue.id);
				const current = snapshots.get(issue.id)?.description === issue.nextDescription ? snapshots.get(issue.id) : await dependencies.gateway.getIssue({ id: issue.id });
				if (!current || (current.description !== issue.previousDescription && !(claim && current.description === issue.nextDescription))) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} changed during approved revision recovery.`);
				if (!claim) {
					claim = { issueId: issue.id, previousRevision: issue.previousRevision, workflowDigest: workflowDigest(current) };
					descriptionClaims = [...descriptionClaims, claim];
					manifest = await dependencies.manifest.record(manifest.operationId, "describing", { descriptionClaims });
				} else if (!claim.workflowDigest) {
					if (current.description === issue.nextDescription) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} has a legacy claim without a durable workflow baseline.`);
					claim = { ...claim, workflowDigest: workflowDigest(current) };
					descriptionClaims = descriptionClaims.map((entry) => entry.issueId === issue.id ? claim as typeof entry : entry);
					manifest = await dependencies.manifest.record(manifest.operationId, "describing", { descriptionClaims });
				}
				if (current.description !== issue.nextDescription) {
					const baseline = snapshots.get(issue.id);
					const updated = await dependencies.gateway.saveIssue({ id: issue.id, description: issue.nextDescription });
					if (!baseline || updated.id !== issue.id || updated.description !== issue.nextDescription || !sameWorkflow(baseline, updated)) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} did not return the approved description without workflow mutation.`);
					const readBack = await dependencies.gateway.getIssue({ id: issue.id });
					if (!readBack || readBack.description !== issue.nextDescription || !sameWorkflow(baseline, readBack)) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} did not read back the approved description without workflow mutation.`);
				}
				descriptions = [...descriptions, issue.id];
				manifest = await dependencies.manifest.record(manifest.operationId, "describing", { descriptions });
			}
			manifest = await dependencies.manifest.advance(manifest.operationId, "describing", "verifying");
		}

		for (const issue of revision.affectedIssues) {
			const current = await dependencies.gateway.getIssue({ id: issue.id });
			const baseline = snapshots.get(issue.id);
			if (!current || current.description !== issue.nextDescription || !baseline || !sameWorkflow(baseline, current)) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} does not match the approved revision without workflow mutation.`);
		}
		for (const plan of commentPlans) {
			if (await validateComments(dependencies.gateway, plan.issueId, { kind: plan.kind, body: plan.body, digest: revision.digest }) !== "present") return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${plan.issueId} does not contain the approved flow reference comment.`);
		}
		if (manifest.stage === "verifying") await dependencies.manifest.advance(manifest.operationId, "verifying", "verified", { verification: { digest: revision.digest, issueIds: revision.affectedIssues.map(({ id }) => id) } });
		return { status: "revision-published", definitionId: revision.definitionId, digest: revision.digest };
	} catch (error) {
		return blocked(error && typeof error === "object" && "code" in error ? String(error.code) : "PI_WORKFLOW_PUBLICATION_FAILED", error instanceof Error ? error.message : "Approved revision publication failed.");
	}
}
