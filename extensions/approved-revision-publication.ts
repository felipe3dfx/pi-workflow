import type { OwnerAuthority } from "./workflow-contracts.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";
import type { createApprovedRevisionPublicationManifestStore } from "./approved-revision-publication-manifest.ts";

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

export interface LinearApprovedRevisionIssueSnapshot {
	id: string;
	description: string;
	updatedAt: string;
	workflow?: unknown;
}

export interface LinearApprovedRevisionGateway {
	getIssue(input: { id: string }): Promise<LinearApprovedRevisionIssueSnapshot | undefined>;
	listComments(input: { issueId: string }): Promise<readonly { id: string; body: string }[]>;
	saveComment(input: { issueId: string; body: string }): Promise<{ id: string; body: string }>;
	saveIssue(input: { id: string; description: string }): Promise<LinearApprovedRevisionIssueSnapshot>;
}

type Dependencies = {
	definitionId: string;
	digest: string;
	currentActor(): Promise<OwnerAuthority | undefined>;
	readApprovedRevision(definitionId: string, digest: string): Promise<ApprovedRevisionPublicationArtifact | undefined>;
	manifest: ReturnType<typeof createApprovedRevisionPublicationManifestStore>;
	gateway: LinearApprovedRevisionGateway;
};

type Outcome =
	| { status: "revision-published"; definitionId: string; digest: string }
	| { status: "blocked"; blocker: { code: string; message: string } };

const blocked = (code: string, message: string): Outcome => ({ status: "blocked", blocker: { code, message } });
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const exact = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const reference = (kind: string, digest: string) => `Referencia de flujo: ${kind}:${digest}`;

function digestApprovedRevision(value: ApprovedRevisionPublicationArtifact): string {
	const { digest: approvedDigest, ...payload } = value;
	return digestCanonicalValue({
		schema: "approved-revision",
		schemaVersion: 1,
		payload: {
			...payload,
			sourceComment: { ...payload.sourceComment, body: payload.sourceComment.body.replaceAll(approvedDigest, "placeholder") },
			...(payload.decisionGap ? { decisionGap: { ...payload.decisionGap, body: payload.decisionGap.body.replaceAll(approvedDigest, "placeholder") } } : {}),
		},
	});
}

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
			const recoverableDescriptionStage = manifest.stage === "describing";
			const recordedAsUpdated = manifest.descriptions.includes(issue.id);
			const alreadyUpdated = (recordedAsUpdated || recoverableDescriptionStage) && snapshot.description === issue.nextDescription;
			if (snapshot.description !== issue.previousDescription && !alreadyUpdated) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} description changed before approved revision publication.`);
			if (!alreadyUpdated && snapshot.updatedAt !== issue.previousRevision) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} revision changed before approved revision publication.`);
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
					if (commentStates.get(key) !== "present") await dependencies.gateway.saveComment({ issueId: plan.issueId, body: plan.body });
					recorded = [...recorded, { issueId: plan.issueId, kind: plan.kind }];
					manifest = await dependencies.manifest.record(manifest.operationId, "commenting", { comments: recorded });
				}
			}
			manifest = await dependencies.manifest.advance(manifest.operationId, "commenting", "describing");
		}

		if (manifest.stage === "describing") {
			let descriptions = [...manifest.descriptions];
			for (const issue of revision.affectedIssues) {
				if (descriptions.includes(issue.id)) continue;
				const current = snapshots.get(issue.id)?.description === issue.nextDescription ? snapshots.get(issue.id) : await dependencies.gateway.getIssue({ id: issue.id });
				if (!current || (current.description !== issue.previousDescription && current.description !== issue.nextDescription)) return blocked("PI_WORKFLOW_REVISION_STALE", `Issue ${issue.id} changed during approved revision recovery.`);
				if (current.description !== issue.nextDescription) {
					const updated = await dependencies.gateway.saveIssue({ id: issue.id, description: issue.nextDescription });
					if (updated.description !== issue.nextDescription) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} did not read back the approved description.`);
				}
				descriptions = [...descriptions, issue.id];
				manifest = await dependencies.manifest.record(manifest.operationId, "describing", { descriptions });
			}
			manifest = await dependencies.manifest.advance(manifest.operationId, "describing", "verifying");
		}

		for (const issue of revision.affectedIssues) {
			const current = await dependencies.gateway.getIssue({ id: issue.id });
			if (current?.description !== issue.nextDescription) return blocked("PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", `Issue ${issue.id} does not match the approved revision.`);
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
