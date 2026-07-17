import {
	canonicalJson,
	digestCanonicalValue,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import type { ApprovedRevisionPublicationArtifact } from "./approved-revision-publication.ts";

interface ApprovedRevisionIssueDraft {
	id: string;
	previousDescription: string;
	previousRevision: string;
	nextDescription: string;
}

export interface ApprovedRevisionDraftArtifact {
	definitionId: string;
	digest: string;
	kind: string;
	affectedIssues: readonly ApprovedRevisionIssueDraft[];
	sourceComment: { kind: string; body: string };
	decisionGap?: { issueId: string; body: string };
}

type DraftEnvelope = {
	schema: "approved-revision-draft";
	schemaVersion: 1;
	payload: ApprovedRevisionDraftArtifact;
	digest: string;
};

type ApprovedEnvelope = {
	schema: "approved-revision";
	schemaVersion: 1;
	payload: ApprovedRevisionPublicationArtifact;
	digest: string;
};

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const reference = (kind: string, digest: string) => `Referencia de flujo: ${kind}:${digest}`;
const withPlaceholder = (body: string, digest: string) => body.replaceAll(digest, "placeholder").replaceAll("{{digest}}", "placeholder");

export function digestApprovedRevisionDraft(value: Omit<ApprovedRevisionDraftArtifact, "digest"> | ApprovedRevisionDraftArtifact): string {
	const draft = value as ApprovedRevisionDraftArtifact;
	return digestCanonicalValue({
		schema: "approved-revision-draft",
		schemaVersion: 1,
		payload: {
			definitionId: draft.definitionId,
			kind: draft.kind,
			affectedIssues: draft.affectedIssues,
			sourceComment: { ...draft.sourceComment, body: withPlaceholder(draft.sourceComment.body, draft.digest ?? "") },
			...(draft.decisionGap ? { decisionGap: { ...draft.decisionGap, body: withPlaceholder(draft.decisionGap.body, draft.digest ?? "") } } : {}),
		},
	});
}

export function digestApprovedRevision(value: ApprovedRevisionPublicationArtifact): string {
	return digestCanonicalValue({
		schema: "approved-revision",
		schemaVersion: 1,
		payload: {
			definitionId: value.definitionId,
			kind: value.kind,
			authority: value.authority,
			affectedIssues: value.affectedIssues,
			sourceComment: { ...value.sourceComment, body: withPlaceholder(value.sourceComment.body, value.digest) },
			...(value.decisionGap ? { decisionGap: { ...value.decisionGap, body: withPlaceholder(value.decisionGap.body, value.digest) } } : {}),
		},
	});
}

function validateDraft(value: unknown, definitionId: string, digest: string): value is ApprovedRevisionDraftArtifact {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const draft = value as ApprovedRevisionDraftArtifact;
	if (draft.definitionId !== definitionId || draft.digest !== digest || digestApprovedRevisionDraft(draft) !== digest || !text(draft.kind) || !text(draft.sourceComment?.kind) || !draft.sourceComment.body.includes(reference(draft.sourceComment.kind, digest))) return false;
	if (!Array.isArray(draft.affectedIssues) || draft.affectedIssues.length === 0) return false;
	const ids = new Set<string>();
	for (const issue of draft.affectedIssues) {
		if (!text(issue.id) || ids.has(issue.id) || typeof issue.previousDescription !== "string" || !text(issue.previousRevision) || !text(issue.nextDescription)) return false;
		ids.add(issue.id);
	}
	return !draft.decisionGap || (ids.has(draft.decisionGap.issueId) && draft.decisionGap.body.includes(reference("decision-gap", digest)));
}

function validateApproved(value: unknown, definitionId: string, digest: string): value is ApprovedRevisionPublicationArtifact {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const approved = value as ApprovedRevisionPublicationArtifact;
	if (approved.definitionId !== definitionId || approved.digest !== digest || digestApprovedRevision(approved) !== digest || approved.authority?.role !== "Owner" || !text(approved.authority.actorId) || !text(approved.authority.authorityRevision) || !text(approved.kind) || !text(approved.sourceComment?.kind) || !approved.sourceComment.body.includes(reference(approved.sourceComment.kind, digest))) return false;
	if (!Array.isArray(approved.affectedIssues) || approved.affectedIssues.length === 0) return false;
	const ids = new Set<string>();
	for (const issue of approved.affectedIssues) {
		if (!text(issue.id) || ids.has(issue.id) || typeof issue.previousDescription !== "string" || !text(issue.previousRevision) || !text(issue.nextDescription)) return false;
		ids.add(issue.id);
	}
	return !approved.decisionGap || (ids.has(approved.decisionGap.issueId) && approved.decisionGap.body.includes(reference("decision-gap", digest)));
}

function parseDraft(content: string, definitionId: string, digest: string): ApprovedRevisionDraftArtifact {
	const envelope = JSON.parse(content) as DraftEnvelope;
	if (envelope.schema !== "approved-revision-draft" || envelope.schemaVersion !== 1 || envelope.digest !== digest || !validateDraft(envelope.payload, definitionId, digest)) throw new Error("Approved revision draft is invalid or corrupt.");
	return envelope.payload;
}

function parseApproved(content: string, definitionId: string, digest: string): ApprovedRevisionPublicationArtifact {
	const envelope = JSON.parse(content) as ApprovedEnvelope;
	if (envelope.schema !== "approved-revision" || envelope.schemaVersion !== 1 || envelope.digest !== digest || !validateApproved(envelope.payload, definitionId, digest)) throw new Error("Approved revision is invalid or corrupt.");
	return envelope.payload;
}

export function createApprovedRevisionStore({ store, project, topic }: { store: WorkflowArtifactStore; project: string; topic: string }) {
	const draftTopic = (definitionId: string, digest: string) => `${topic}/${definitionId}/approved-revision-draft/${digest}`;
	const approvedTopic = (definitionId: string, digest: string) => `${topic}/${definitionId}/approved-revision/${digest}`;

	async function saveSnapshot<T extends ApprovedRevisionDraftArtifact | ApprovedRevisionPublicationArtifact>(input: { schema: "approved-revision-draft" | "approved-revision"; value: T; destination: string; digest: string }): Promise<VerifiedArtifactRef> {
		if (store.capabilities?.atomicCompareAndSwap !== true) throw new Error("Atomic compare-and-swap is required for approved revision artifacts.");
		const unsigned = { schema: input.schema, schemaVersion: 1 as const, payload: input.value };
		const content = `${canonicalJson({ ...unsigned, digest: input.digest })}\n`;
		const current = await store.readCurrent(project, input.destination);
		if (current) {
			if (current.content !== content) throw new Error("Approved revision artifact conflicts with its create-only snapshot.");
			const readBack = await store.readRevision(project, input.destination, current.revision);
			if (readBack !== content) throw new Error("Approved revision artifact read-back mismatch.");
			return { kind: "engram", project, topic: input.destination, revision: current.revision, schema: input.schema, schemaVersion: 1, digest: input.digest };
		}
		const { revision } = await store.write(project, input.destination, content, undefined);
		const readBack = await store.readRevision(project, input.destination, revision);
		if (readBack !== content) throw new Error("Approved revision artifact read-back mismatch.");
		return { kind: "engram", project, topic: input.destination, revision, schema: input.schema, schemaVersion: 1, digest: input.digest };
	}

	return {
		async saveDraft(value: ApprovedRevisionDraftArtifact): Promise<VerifiedArtifactRef> {
			if (!validateDraft(value, value.definitionId, value.digest)) throw new Error("Approved revision draft is invalid or corrupt.");
			return saveSnapshot({ schema: "approved-revision-draft", value, destination: draftTopic(value.definitionId, value.digest), digest: value.digest });
		},
		async readDraft(definitionId: string, digest: string): Promise<ApprovedRevisionDraftArtifact | undefined> {
			const current = await store.readCurrent(project, draftTopic(definitionId, digest));
			if (!current) return undefined;
			const readBack = await store.readRevision(project, draftTopic(definitionId, digest), current.revision);
			if (readBack !== current.content) throw new Error("Approved revision draft read-back mismatch.");
			return structuredClone(parseDraft(current.content, definitionId, digest));
		},
		async saveApproved(value: ApprovedRevisionPublicationArtifact): Promise<VerifiedArtifactRef> {
			if (!validateApproved(value, value.definitionId, value.digest)) throw new Error("Approved revision is invalid or corrupt.");
			return saveSnapshot({ schema: "approved-revision", value, destination: approvedTopic(value.definitionId, value.digest), digest: value.digest });
		},
		async readApproved(definitionId: string, digest: string): Promise<ApprovedRevisionPublicationArtifact | undefined> {
			const current = await store.readCurrent(project, approvedTopic(definitionId, digest));
			if (!current) return undefined;
			const readBack = await store.readRevision(project, approvedTopic(definitionId, digest), current.revision);
			if (readBack !== current.content) throw new Error("Approved revision read-back mismatch.");
			return structuredClone(parseApproved(current.content, definitionId, digest));
		},
	};
}

export type ApprovedRevisionStore = ReturnType<typeof createApprovedRevisionStore>;
