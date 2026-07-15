import {
	canonicalJson,
	digestCanonicalValue,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";
import type { TicketGraphApproval } from "./delivery-ticket-graph.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface ApprovedTicketPublication {
	definitionId: string;
	approvedSpecRef: VerifiedArtifactRef;
	parentRef: VerifiedArtifactRef;
	graphRef: VerifiedArtifactRef;
	graphParent: TicketGraphApproval["payload"]["parent"];
	approval: TicketGraphApproval;
}

interface PublicationEnvelope {
	schema: "approved-ticket-publication";
	schemaVersion: 1;
	payload: ApprovedTicketPublication;
	digest: string;
}

const text = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

const parent = (value: unknown): value is TicketGraphApproval["payload"]["parent"] =>
	!!value && typeof value === "object" && !Array.isArray(value) && ["id", "teamId", "revision", "specDigest"].every((key) => text((value as Record<string, unknown>)[key]));

const owner = (value: unknown): boolean =>
	!!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).role === "Owner" && text((value as Record<string, unknown>).actorId) && text((value as Record<string, unknown>).authorityRevision);

function isRef(value: unknown, schema: string): value is VerifiedArtifactRef {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const ref = value as Record<string, unknown>;
	return ref.kind === "engram" && text(ref.project) && text(ref.topic) && text(ref.revision) && ref.schema === schema && ref.schemaVersion === 1 && text(ref.digest);
}

function valid(value: unknown, project: string): value is ApprovedTicketPublication {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const publication = value as Record<string, unknown>;
	const approval = publication.approval as TicketGraphApproval | undefined;
	const payload = approval?.payload;
	return text(publication.definitionId) && isRef(publication.approvedSpecRef, "approved-spec") && isRef(publication.parentRef, "delivery-parent") && isRef(publication.graphRef, "delivery-ticket-graph") && publication.approvedSpecRef.project === project && publication.parentRef.project === project && publication.graphRef.project === project && !!approval && !!payload && approval.schema === "delivery-ticket-graph-approval" && approval.schemaVersion === 1 && text(approval.digest) && approval.digest === digestCanonicalValue({ schema: approval.schema, schemaVersion: approval.schemaVersion, payload }) && owner(payload.actor) && parent(publication.graphParent) && publication.approvedSpecRef.digest === publication.graphParent.specDigest && canonicalJson(payload.parent) === canonicalJson(publication.graphParent) && payload.graphDigest === publication.graphRef.digest;
}

function parse(content: string, project: string): PublicationEnvelope {
	try {
		const envelope = JSON.parse(content) as PublicationEnvelope;
		if (envelope.schema !== "approved-ticket-publication" || envelope.schemaVersion !== 1 || !valid(envelope.payload, project) || envelope.digest !== digestCanonicalValue({ schema: envelope.schema, schemaVersion: envelope.schemaVersion, payload: envelope.payload })) throw new Error();
		return envelope;
	} catch {
		throw new Error("Approved ticket publication is invalid or corrupt.");
	}
}

export function createApprovedTicketPublicationStore({ store, project, topic }: { store: WorkflowArtifactStore; project: string; topic: string }) {
	function snapshotTopic(definitionId: string): string {
		return `${topic}/${definitionId}`;
	}

	async function read(definitionId: string): Promise<ApprovedTicketPublication | undefined> {
		const current = await store.readCurrent(project, snapshotTopic(definitionId));
		if (!current) return undefined;
		const content = await store.readRevision(project, snapshotTopic(definitionId), current.revision);
		if (content !== current.content) throw new Error("Approved ticket publication read-back mismatch.");
		const envelope = parse(content, project);
		if (envelope.payload.definitionId !== definitionId) throw new Error("Approved ticket publication definition mismatch.");
		return structuredClone(envelope.payload);
	}

	async function save(publication: ApprovedTicketPublication): Promise<VerifiedArtifactRef> {
		if (store.capabilities?.atomicCompareAndSwap !== true) throw new Error("Atomic compare-and-swap is required for approved ticket publication.");
		if (!valid(publication, project)) throw new Error("Approved ticket publication is invalid or corrupt.");
		const unsigned = { schema: "approved-ticket-publication" as const, schemaVersion: 1 as const, payload: publication };
		const content = `${canonicalJson({ ...unsigned, digest: digestCanonicalValue(unsigned) })}\n`;
		const destination = snapshotTopic(publication.definitionId);
		const current = await store.readCurrent(project, destination);
		if (current) {
			if (current.content !== content) throw new Error("Approved ticket publication conflicts with its create-only snapshot.");
			const readBack = await store.readRevision(project, destination, current.revision);
			if (readBack !== content) throw new Error("Approved ticket publication read-back mismatch.");
			return { kind: "engram", project, topic: destination, revision: current.revision, schema: "approved-ticket-publication", schemaVersion: 1, digest: digestCanonicalValue(unsigned) };
		}
		const { revision } = await store.write(project, destination, content, undefined);
		const readBack = await store.readRevision(project, destination, revision);
		if (readBack !== content) throw new Error("Approved ticket publication read-back mismatch.");
		parse(readBack, project);
		return { kind: "engram", project, topic: destination, revision, schema: "approved-ticket-publication", schemaVersion: 1, digest: digestCanonicalValue(unsigned) };
	}

	return { read, save };
}
