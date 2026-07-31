import {
	canonicalJson,
	digestCanonicalValue,
	sha256Hex,
} from "./workflow-contracts.ts";
import type { TicketApprovalRecoveryState, TicketApprovalRecoveryStore } from "./define-product-workflow.ts";
import type { DelegationCheckpointPersistence } from "./delegation-checkpoints.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

interface RecoveryEnvelope {
	schemaVersion: 1;
	state: TicketApprovalRecoveryState;
	digest: string;
}

function text(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function artifactRef(value: unknown, schema: string): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const ref = value as Record<string, unknown>;
	return ref.kind === "engram" && text(ref.project) && text(ref.topic) && text(ref.revision) && ref.schema === schema && ref.schemaVersion === 1 && text(ref.digest);
}

function validState(value: unknown): value is TicketApprovalRecoveryState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const state = value as Record<string, unknown>;
	const authority = state.authority;
	return text(state.definitionId) && artifactRef(state.approvedSpecRef, "approved-spec") && artifactRef(state.parentRef, "delivery-parent") && artifactRef(state.graphRef, "delivery-ticket-graph") && text(state.digest) && !!authority && typeof authority === "object" && !Array.isArray(authority) && text((authority as Record<string, unknown>).actorId) && (authority as Record<string, unknown>).role === "Owner" && text((authority as Record<string, unknown>).authorityRevision);
}

const ENGRAM_RECOVERY_SCHEMA = "ticket-approval-recovery";
const TICKET_APPROVAL_RECOVERY_TOPIC =
	"workflow/define-product/ticket-approval-recovery";

interface EngramRecoveryEnvelope {
	schema: typeof ENGRAM_RECOVERY_SCHEMA;
	schemaVersion: 1;
	payload: TicketApprovalRecoveryState | null;
	digest: string;
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function exactArtifactRef(
	value: unknown,
	expected: {
		project: string;
		topic: string;
		schema: string;
		digest?: string;
	},
): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const ref = value as Record<string, unknown>;
	return (
		exactKeys(ref, [
			"kind",
			"project",
			"topic",
			"revision",
			"schema",
			"schemaVersion",
			"digest",
		]) &&
		ref.kind === "engram" &&
		ref.project === expected.project &&
		ref.topic === expected.topic &&
		text(ref.revision) &&
		ref.schema === expected.schema &&
		ref.schemaVersion === 1 &&
		text(ref.digest) &&
		(expected.digest === undefined || ref.digest === expected.digest)
	);
}

function validEngramState(
	value: unknown,
	project: string,
): value is TicketApprovalRecoveryState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const state = value as Record<string, unknown>;
	if (
		!exactKeys(state, [
			"definitionId",
			"approvedSpecRef",
			"parentRef",
			"graphRef",
			"digest",
			"authority",
		]) ||
		!text(state.definitionId) ||
		state.definitionId !== state.definitionId.trim() ||
		!text(state.digest) ||
		state.digest !== state.digest.trim()
	) {
		return false;
	}
	const prefix = `workflow/define-product/${state.definitionId}`;
	const authority = state.authority;
	if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
		return false;
	}
	const authorityRecord = authority as Record<string, unknown>;
	if (
		!exactKeys(authorityRecord, ["actorId", "role", "authorityRevision"]) ||
		!text(authorityRecord.actorId) ||
		authorityRecord.actorId !== authorityRecord.actorId.trim() ||
		authorityRecord.role !== "Owner" ||
		!text(authorityRecord.authorityRevision) ||
		authorityRecord.authorityRevision !== authorityRecord.authorityRevision.trim()
	) {
		return false;
	}
	return (
		exactArtifactRef(state.approvedSpecRef, {
			project,
			topic: `${prefix}/approved-spec`,
			schema: "approved-spec",
		}) &&
		exactArtifactRef(state.parentRef, {
			project,
			topic: `${prefix}/published-parent`,
			schema: "delivery-parent",
		}) &&
		exactArtifactRef(state.graphRef, {
			project,
			topic: `${prefix}/approved-ticket-graph/${state.digest}`,
			schema: "delivery-ticket-graph",
			digest: state.digest,
		})
	);
}

function engramEnvelope(
	payload: TicketApprovalRecoveryState | null,
): EngramRecoveryEnvelope {
	const unsigned: Omit<EngramRecoveryEnvelope, "digest"> = {
		schema: ENGRAM_RECOVERY_SCHEMA,
		schemaVersion: 1,
		payload,
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function parseEngramEnvelope(
	content: string,
	project: string,
): EngramRecoveryEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("The Engram ticket approval recovery identity is invalid.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("The Engram ticket approval recovery identity is invalid.");
	}
	const envelope = parsed as Record<string, unknown>;
	const unsigned = {
		schema: envelope.schema,
		schemaVersion: envelope.schemaVersion,
		payload: envelope.payload,
	};
	if (
		!exactKeys(envelope, ["schema", "schemaVersion", "payload", "digest"]) ||
		envelope.schema !== ENGRAM_RECOVERY_SCHEMA ||
		envelope.schemaVersion !== 1 ||
		(envelope.payload !== null && !validEngramState(envelope.payload, project)) ||
		envelope.digest !== digestCanonicalValue(unsigned) ||
		content !== `${canonicalJson(envelope)}\n`
	) {
		throw new Error("The Engram ticket approval recovery identity is invalid.");
	}
	return envelope as unknown as EngramRecoveryEnvelope;
}

/**
 * Stores the one active ticket-approval continuation at one exact project topic.
 * A different active payload is a deterministic conflict: callers must never
 * search for or adopt another definition through this selector-free interface.
 */
export function createEngramTicketApprovalRecoveryStore(options: {
	store: WorkflowArtifactStore;
	project: string;
	topic?: string;
}): TicketApprovalRecoveryStore {
	if (!text(options.project) || options.project !== options.project.trim()) {
		throw new Error("The ticket approval recovery project is invalid.");
	}
	const topic = options.topic ?? TICKET_APPROVAL_RECOVERY_TOPIC;
	if (!text(topic) || topic !== topic.trim()) {
		throw new Error("The ticket approval recovery topic is invalid.");
	}
	let boundState: TicketApprovalRecoveryState | undefined;
	let boundRevision: string | undefined;

	function requireCas(): void {
		if (options.store.capabilities?.atomicCompareAndSwap !== true) {
			throw new Error(
				"Atomic compare-and-swap is required for Engram ticket approval recovery.",
			);
		}
	}

	type VerifiedCurrent = {
		readonly revision: string;
		readonly envelope: EngramRecoveryEnvelope;
	};

	function sameState(
		left: TicketApprovalRecoveryState,
		right: TicketApprovalRecoveryState,
	): boolean {
		return canonicalJson(left) === canonicalJson(right);
	}

	function isCasConflict(error: unknown): boolean {
		return (
			error instanceof Error &&
			((error as Error & { code?: string }).code === "revision-conflict" ||
				error.message.toLowerCase().includes("compare-and-swap"))
		);
	}

	async function verifyRevision(
		revision: string,
		expectedContent: string,
	): Promise<void> {
		const revisionContent = await options.store.readRevision(
			options.project,
			topic,
			revision,
		);
		if (revisionContent !== expectedContent) {
			throw new Error("Ticket approval recovery read-back mismatch.");
		}
	}

	async function readVerifiedCurrent(): Promise<VerifiedCurrent | undefined> {
		const current = await options.store.readCurrent(options.project, topic);
		if (!current) return undefined;
		await verifyRevision(current.revision, current.content);
		return {
			revision: current.revision,
			envelope: parseEngramEnvelope(current.content, options.project),
		};
	}

	async function write(
		payload: TicketApprovalRecoveryState | null,
		expectedRevision: string | undefined,
	): Promise<string> {
		const content = `${canonicalJson(engramEnvelope(payload))}\n`;
		const stored = await options.store.write(
			options.project,
			topic,
			content,
			expectedRevision,
		);
		await verifyRevision(stored.revision, content);
		return stored.revision;
	}

	return {
		async load() {
			const current = await readVerifiedCurrent();
			if (!current || current.envelope.payload === null) {
				boundState = undefined;
				boundRevision = undefined;
				return undefined;
			}
			boundState = structuredClone(current.envelope.payload);
			boundRevision = current.revision;
			return structuredClone(boundState);
		},
		async save(state) {
			requireCas();
			if (!validEngramState(state, options.project)) {
				throw new Error("The Engram ticket approval recovery identity is invalid.");
			}
			const desired = structuredClone(state);
			const current = await readVerifiedCurrent();
			if (current && current.envelope.payload !== null) {
				if (!sameState(current.envelope.payload, desired)) {
					throw new Error(
						"Ticket approval recovery conflicts with another active continuation.",
					);
				}
				boundState = structuredClone(current.envelope.payload);
				boundRevision = current.revision;
				return;
			}
			try {
				boundRevision = await write(desired, current?.revision);
			} catch (error) {
				if (!isCasConflict(error)) throw error;
				const winner = await readVerifiedCurrent();
				if (winner && winner.envelope.payload !== null) {
					if (sameState(winner.envelope.payload, desired)) {
						boundState = structuredClone(winner.envelope.payload);
						boundRevision = winner.revision;
						return;
					}
					throw new Error(
						"Ticket approval recovery conflicts with another active continuation.",
					);
				}
				throw error;
			}
			boundState = structuredClone(desired);
		},
		async clear() {
			requireCas();
			const current = await readVerifiedCurrent();
			if (!current || current.envelope.payload === null) {
				boundState = undefined;
				boundRevision = undefined;
				return;
			}
			if (
				!boundState ||
				boundRevision !== current.revision ||
				!sameState(boundState, current.envelope.payload)
			) {
				throw new Error(
					"Ticket approval recovery does not match the bound active continuation.",
				);
			}
			try {
				await write(null, current.revision);
			} catch (error) {
				if (!isCasConflict(error)) throw error;
				const winner = await readVerifiedCurrent();
				if (winner && winner.envelope.payload !== null) {
					throw new Error(
						"Ticket approval recovery does not match the bound active continuation.",
					);
				}
				if (winner === undefined) throw error;
			}
			boundState = undefined;
			boundRevision = undefined;
		},
	};
}

export function createDurableTicketApprovalRecoveryStore(options: {
	path: string;
	persistence: DelegationCheckpointPersistence;
}): TicketApprovalRecoveryStore {
	function parse(content: string): TicketApprovalRecoveryState {
		let parsed: RecoveryEnvelope;
		try {
			parsed = JSON.parse(content) as RecoveryEnvelope;
		} catch {
			throw new Error("The durable ticket approval recovery identity is invalid.");
		}
		if (parsed.schemaVersion !== 1 || !validState(parsed.state) || parsed.digest !== digestCanonicalValue({ schemaVersion: parsed.schemaVersion, state: parsed.state })) {
			throw new Error("The durable ticket approval recovery identity is invalid.");
		}
		return parsed.state;
	}
	return {
		async load() {
			const content = await options.persistence.readFile(options.path);
			return content === undefined || content.trim() === "null" ? undefined : parse(content);
		},
		async save(state) {
			if (options.persistence.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for ticket approval recovery.");
			if (!validState(state))
				throw new Error("The durable ticket approval recovery identity is invalid.");
			await options.persistence.withMutation("ticket-approval-recovery", async () => {
				const current = await options.persistence.readFile(options.path);
				const unsigned = { schemaVersion: 1 as const, state };
				const content = `${canonicalJson({ ...unsigned, digest: digestCanonicalValue(unsigned) })}\n`;
				await options.persistence.writeFileAtomic(options.path, content, current === undefined ? null : sha256Hex(current));
				if (await options.persistence.readFile(options.path) !== content)
					throw new Error("Ticket approval recovery read-back mismatch.");
			});
		},
		async clear() {
			if (options.persistence.capabilities?.atomicCompareAndSwap !== true)
				throw new Error("Atomic compare-and-swap is required for ticket approval recovery.");
			await options.persistence.withMutation("ticket-approval-recovery", async () => {
				const current = await options.persistence.readFile(options.path);
				if (current !== undefined)
					await options.persistence.writeFileAtomic(options.path, "null\n", sha256Hex(current));
			});
		},
	};
}
