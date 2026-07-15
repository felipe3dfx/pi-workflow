import {
	canonicalJson,
	digestCanonicalValue,
	sha256Hex,
} from "./workflow-contracts.ts";
import type { TicketApprovalRecoveryState, TicketApprovalRecoveryStore } from "./define-product-workflow.ts";
import type { DelegationCheckpointPersistence } from "./delegation-checkpoints.ts";

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
