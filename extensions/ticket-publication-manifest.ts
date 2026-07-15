import { createHash } from "node:crypto";

export type TicketPublicationStage = "prepared" | "children" | "relations" | "verifying" | "verified";

export interface TicketPublicationIdentity {
	definitionId: string;
	graphDigest: string;
	parent: { id: string; revision: string };
}

export interface TicketPublicationManifest extends TicketPublicationIdentity {
	schemaVersion: 1;
	operationId: string;
	stage: TicketPublicationStage;
	children: readonly { stableKey: string; linearId: string }[];
	relations: readonly { blockedStableKey: string; blockingStableKey: string }[];
	verification?: { graphDigest: string; parentId: string };
}

export interface TicketPublicationManifestPersistence {
	read(operationId: string): Promise<{ revision: string; value: TicketPublicationManifest } | undefined>;
	create(value: TicketPublicationManifest): Promise<{ revision: string; value: TicketPublicationManifest }>;
	compareAndSwap(revision: string, value: TicketPublicationManifest): Promise<{ revision: string; value: TicketPublicationManifest }>;
}

const stages: TicketPublicationStage[] = ["prepared", "children", "relations", "verifying", "verified"];
const canonicalJson = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

export function createTicketPublicationOperationId(identity: TicketPublicationIdentity): string {
	return digest({ definitionId: identity.definitionId, graphDigest: identity.graphDigest, parent: identity.parent });
}

function validShape(value: TicketPublicationManifest): string | undefined {
	if (value.schemaVersion !== 1 || !stages.includes(value.stage) || !Array.isArray(value.children) || !Array.isArray(value.relations)) return "manifest shape is invalid";
	if (!value.children.every((entry) => typeof entry?.stableKey === "string" && !!entry.stableKey && typeof entry.linearId === "string" && !!entry.linearId) || !value.relations.every((entry) => typeof entry?.blockedStableKey === "string" && !!entry.blockedStableKey && typeof entry.blockingStableKey === "string" && !!entry.blockingStableKey)) return "manifest shape is invalid";
	if (
		typeof value.definitionId !== "string" ||
		!value.definitionId ||
		typeof value.parent?.id !== "string" ||
		!value.parent.id ||
		typeof value.parent?.revision !== "string" ||
		!value.parent.revision ||
		!/^[a-f0-9]{64}$/.test(value.operationId) ||
		!/^[a-f0-9]{64}$/.test(value.graphDigest)
	)
		return "manifest identity is invalid";
	if (value.stage === "prepared" && (value.children.length || value.relations.length || value.verification)) return "prepared stage must be empty";
	if (value.stage === "children" && (!value.children.length || value.relations.length || value.verification)) return "children stage requires published children";
	if (["relations", "verifying"].includes(value.stage) && (!value.children.length || value.verification)) return `${value.stage} stage shape is invalid`;
	if (value.stage === "verified" && (!value.children.length || !value.verification || value.verification.graphDigest !== value.graphDigest || value.verification.parentId !== value.parent.id)) return "verified stage requires matching read-back";
}

export function createTicketPublicationManifestStore({ persistence }: { persistence: TicketPublicationManifestPersistence }) {
	async function read(operationId: string): Promise<TicketPublicationManifest | undefined> {
		return (await persistence.read(operationId))?.value;
	}
	async function prepare(identity: TicketPublicationIdentity): Promise<TicketPublicationManifest> {
		const operationId = createTicketPublicationOperationId(identity);
		const existing = await read(operationId);
		if (existing) {
			const invalid = validShape(existing);
			if (invalid) throw new Error(invalid);
			if (existing.operationId !== operationId || existing.definitionId !== identity.definitionId || existing.graphDigest !== identity.graphDigest || canonicalJson(existing.parent) !== canonicalJson(identity.parent)) throw new Error("create-only manifest conflicts with publication identity");
			return existing;
		}
		const value: TicketPublicationManifest = { ...identity, schemaVersion: 1, operationId, stage: "prepared", children: [], relations: [], verification: undefined };
		const invalid = validShape(value);
		if (invalid) throw new Error(invalid);
		const created = await persistence.create(value);
		if (JSON.stringify(created.value) !== JSON.stringify(value)) throw new Error("manifest create read-back mismatch");
		return created.value;
	}
	async function advance(operationId: string, expected: TicketPublicationStage, next: TicketPublicationStage, changes: Pick<Partial<TicketPublicationManifest>, "children" | "relations" | "verification">): Promise<TicketPublicationManifest> {
		const current = await persistence.read(operationId);
		if (!current || current.value.stage !== expected) throw new Error("manifest compare-and-swap conflict");
		if (stages.indexOf(next) !== stages.indexOf(expected) + 1) throw new Error("illegal manifest transition");
		if (
			(expected !== "prepared" && "children" in changes) ||
			(["relations", "verifying", "verified"].includes(expected) && "relations" in changes)
		)
			throw new Error("manifest stage-owned fields are immutable");
		const value = { ...current.value, ...changes, stage: next } as TicketPublicationManifest;
		const invalid = validShape(value);
		if (invalid) throw new Error(invalid);
		const saved = await persistence.compareAndSwap(current.revision, value);
		if (JSON.stringify(saved.value) !== JSON.stringify(value)) throw new Error("manifest transition read-back mismatch");
		return saved.value;
	}
	return { read, prepare, advance };
}
