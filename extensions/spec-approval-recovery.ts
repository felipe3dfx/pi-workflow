import {
	canonicalJson,
	digestCanonicalValue,
	sha256Hex,
} from "./workflow-contracts.ts";
import type {
	SpecApprovalRecoveryState,
	SpecApprovalRecoveryStore,
} from "./define-product-workflow.ts";
import type { DelegationCheckpointPersistence } from "./delegation-checkpoints.ts";

interface RecoveryEnvelope {
	schemaVersion: 1;
	state: SpecApprovalRecoveryState;
	digest: string;
}

export function createDurableSpecApprovalRecoveryStore(options: {
	path: string;
	persistence: DelegationCheckpointPersistence;
}): SpecApprovalRecoveryStore {
	function parse(content: string): SpecApprovalRecoveryState {
		const parsed = JSON.parse(content) as RecoveryEnvelope;
		if (
			parsed.schemaVersion !== 1 ||
			!parsed.state ||
			parsed.digest !==
				digestCanonicalValue({
					schemaVersion: parsed.schemaVersion,
					state: parsed.state,
				})
		) {
			throw new Error("The durable Spec approval recovery identity is invalid.");
		}
		return parsed.state;
	}

	return {
		async load() {
			const content = await options.persistence.readFile(options.path);
			return content === undefined || content.trim() === "null"
				? undefined
				: parse(content);
		},
		async save(state) {
			await options.persistence.withMutation(
				"spec-approval-recovery",
				async () => {
					const current = await options.persistence.readFile(options.path);
					const unsigned = { schemaVersion: 1 as const, state };
					const content = `${canonicalJson({
						...unsigned,
						digest: digestCanonicalValue(unsigned),
					})}\n`;
					await options.persistence.writeFileAtomic(
						options.path,
						content,
						current === undefined ? null : sha256Hex(current),
					);
				},
			);
		},
		async clear() {
			await options.persistence.withMutation(
				"spec-approval-recovery",
				async () => {
					const current = await options.persistence.readFile(options.path);
					if (current === undefined) return;
					await options.persistence.writeFileAtomic(
						options.path,
						"null\n",
						sha256Hex(current),
					);
				},
			);
		},
	};
}
