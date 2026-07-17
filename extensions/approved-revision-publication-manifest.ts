import { digestCanonicalValue } from "./workflow-contracts.ts";

export type ApprovedRevisionPublicationStage = "prepared" | "commenting" | "describing" | "verifying" | "verified";

export interface ApprovedRevisionPublicationIdentity {
	definitionId: string;
	digest: string;
	affectedIssueIds: readonly string[];
}

export interface ApprovedRevisionPublicationManifest extends ApprovedRevisionPublicationIdentity {
	schemaVersion: 1;
	operationId: string;
	stage: ApprovedRevisionPublicationStage;
	comments: readonly { issueId: string; kind: string }[];
	descriptionClaims: readonly { issueId: string; previousRevision: string; workflowDigest?: string }[];
	descriptions: readonly string[];
	verification?: { digest: string; issueIds: readonly string[] };
}

type LegacyApprovedRevisionPublicationManifest = Omit<ApprovedRevisionPublicationManifest, "descriptionClaims"> & { descriptionClaims?: undefined };

export interface ApprovedRevisionPublicationManifestPersistence {
	read(operationId: string): Promise<{ revision: string; value: ApprovedRevisionPublicationManifest | LegacyApprovedRevisionPublicationManifest } | undefined>;
	create(value: ApprovedRevisionPublicationManifest): Promise<{ revision: string; value: ApprovedRevisionPublicationManifest }>;
	compareAndSwap(revision: string, value: ApprovedRevisionPublicationManifest): Promise<{ revision: string; value: ApprovedRevisionPublicationManifest }>;
}

const stages: ApprovedRevisionPublicationStage[] = ["prepared", "commenting", "describing", "verifying", "verified"];

function createApprovedRevisionPublicationOperationId(identity: ApprovedRevisionPublicationIdentity): string {
	return digestCanonicalValue({ definitionId: identity.definitionId, digest: identity.digest, affectedIssueIds: [...identity.affectedIssueIds].sort() });
}

function sameIdentity(value: ApprovedRevisionPublicationManifest, identity: ApprovedRevisionPublicationIdentity): boolean {
	return value.definitionId === identity.definitionId && value.digest === identity.digest && JSON.stringify([...value.affectedIssueIds].sort()) === JSON.stringify([...identity.affectedIssueIds].sort());
}

function validShape(value: ApprovedRevisionPublicationManifest): string | undefined {
	if (value.schemaVersion !== 1 || !stages.includes(value.stage)) return "approved revision manifest shape is invalid";
	if (!value.definitionId || !/^[a-f0-9]{64}$/.test(value.digest) || !/^[a-f0-9]{64}$/.test(value.operationId)) return "approved revision manifest identity is invalid";
	if (!Array.isArray(value.affectedIssueIds) || value.affectedIssueIds.length === 0 || value.affectedIssueIds.some((id) => typeof id !== "string" || !id.trim())) return "approved revision manifest issue list is invalid";
	if (!Array.isArray(value.comments) || value.comments.some((entry) => !entry.issueId?.trim() || !entry.kind?.trim())) return "approved revision manifest comments are invalid";
	if (!Array.isArray(value.descriptionClaims) || value.descriptionClaims.some((entry) => !entry.issueId?.trim() || !entry.previousRevision?.trim() || (entry.workflowDigest !== undefined && !/^[a-f0-9]{64}$/.test(entry.workflowDigest)))) return "approved revision manifest description claims are invalid";
	if (!Array.isArray(value.descriptions) || value.descriptions.some((id) => typeof id !== "string" || !id.trim())) return "approved revision manifest descriptions are invalid";
	if (value.stage === "prepared" && (value.comments.length || value.descriptionClaims.length || value.descriptions.length || value.verification)) return "prepared approved revision manifest must be empty";
	if (value.stage === "commenting" && (value.descriptionClaims.length || value.descriptions.length || value.verification)) return "commenting approved revision manifest shape is invalid";
	if (value.stage === "describing" && value.verification) return "describing approved revision manifest shape is invalid";
	if (value.stage === "verifying" && value.verification) return "verifying approved revision manifest shape is invalid";
	if (value.stage === "verified" && (!value.verification || value.verification.digest !== value.digest || JSON.stringify([...value.verification.issueIds].sort()) !== JSON.stringify([...value.affectedIssueIds].sort()))) return "verified approved revision manifest requires matching read-back";
}

export function createApprovedRevisionPublicationManifestStore({ persistence }: { persistence: ApprovedRevisionPublicationManifestPersistence }) {
	function normalize(value: ApprovedRevisionPublicationManifest | LegacyApprovedRevisionPublicationManifest): ApprovedRevisionPublicationManifest {
		return value.schemaVersion === 1 && value.descriptionClaims === undefined
			? { ...value, descriptionClaims: [] }
			: value as ApprovedRevisionPublicationManifest;
	}

	async function read(operationId: string): Promise<ApprovedRevisionPublicationManifest | undefined> {
		const stored = await persistence.read(operationId);
		return stored ? normalize(stored.value) : undefined;
	}

	async function prepare(identity: ApprovedRevisionPublicationIdentity): Promise<ApprovedRevisionPublicationManifest> {
		const operationId = createApprovedRevisionPublicationOperationId(identity);
		const existing = await read(operationId);
		if (existing) {
			const invalid = validShape(existing);
			if (invalid) throw new Error(invalid);
			if (!sameIdentity(existing, identity)) throw new Error("approved revision manifest conflicts with publication identity");
			return existing;
		}
		const value: ApprovedRevisionPublicationManifest = { ...identity, affectedIssueIds: [...identity.affectedIssueIds].sort(), schemaVersion: 1, operationId, stage: "prepared", comments: [], descriptionClaims: [], descriptions: [], verification: undefined };
		const invalid = validShape(value);
		if (invalid) throw new Error(invalid);
		const created = await persistence.create(value);
		if (JSON.stringify(created.value) !== JSON.stringify(value)) throw new Error("approved revision manifest create read-back mismatch");
		return created.value;
	}

	async function save(value: ApprovedRevisionPublicationManifest): Promise<ApprovedRevisionPublicationManifest> {
		const current = await persistence.read(value.operationId);
		if (!current) throw new Error("approved revision manifest compare-and-swap conflict");
		const invalid = validShape(value);
		if (invalid) throw new Error(invalid);
		const saved = await persistence.compareAndSwap(current.revision, value);
		if (JSON.stringify(saved.value) !== JSON.stringify(value)) throw new Error("approved revision manifest save read-back mismatch");
		return saved.value;
	}

	async function advance(operationId: string, expected: ApprovedRevisionPublicationStage, next: ApprovedRevisionPublicationStage, changes: Pick<Partial<ApprovedRevisionPublicationManifest>, "verification"> = {}): Promise<ApprovedRevisionPublicationManifest> {
		const current = await persistence.read(operationId);
		if (!current || normalize(current.value).stage !== expected) throw new Error("approved revision manifest compare-and-swap conflict");
		if (stages.indexOf(next) !== stages.indexOf(expected) + 1) throw new Error("illegal approved revision manifest transition");
		return save({ ...normalize(current.value), ...changes, stage: next });
	}

	async function record(operationId: string, stage: "commenting" | "describing", changes: Pick<Partial<ApprovedRevisionPublicationManifest>, "comments" | "descriptionClaims" | "descriptions">): Promise<ApprovedRevisionPublicationManifest> {
		const current = await persistence.read(operationId);
		if (!current || normalize(current.value).stage !== stage) throw new Error("approved revision manifest compare-and-swap conflict");
		return save({ ...normalize(current.value), ...changes });
	}

	return { read, prepare, advance, record };
}
