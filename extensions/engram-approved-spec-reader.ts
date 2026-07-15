import {
	canonicalJson,
	type ProductSpecApprovalEnvelope,
	type ProductSpecEnvelope,
} from "./workflow-contracts.ts";

export interface ApprovedProductSpecRead {
	spec: ProductSpecEnvelope;
	approval: ProductSpecApprovalEnvelope;
	sourceRevision: string;
}

interface EngramApprovedSpecStore {
	readCurrent(
		project: string,
		topic: string,
	): Promise<{ revision: string; content: string } | undefined>;
	write?(
		project: string,
		topic: string,
		content: string,
		expectedRevision?: string,
	): Promise<{ revision: string }>;
	readRevision?(
		project: string,
		topic: string,
		revision: string,
	): Promise<string | undefined>;
}

export function createEngramApprovedSpecReader(options: {
	project: string;
	store: EngramApprovedSpecStore;
}) {
	function topic(definitionId: string): string {
		if (!definitionId.trim())
			throw new Error("The approved Spec definition identity is required.");
		return `workflow/define-product/${definitionId}/approved-spec`;
	}

	return {
		async save(
			definitionId: string,
			artifact: Omit<ApprovedProductSpecRead, "sourceRevision">,
		): Promise<ApprovedProductSpecRead> {
			if (!options.store.write || !options.store.readRevision) {
				throw new Error("The Engram approved Spec adapter is not writable.");
			}
			const artifactTopic = topic(definitionId);
			const content = canonicalJson(artifact);
			const current = await options.store.readCurrent(
				options.project,
				artifactTopic,
			);
			if (current) {
				if (current.content !== content) {
					throw Object.assign(
						new Error("The approved Engram Spec already exists with different content."),
						{ code: "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH" },
					);
				}
				return { ...structuredClone(artifact), sourceRevision: current.revision };
			}
			const written = await options.store.write(
				options.project,
				artifactTopic,
				content,
				undefined,
			);
			const readBack = await options.store.readRevision(
				options.project,
				artifactTopic,
				written.revision,
			);
			if (readBack !== content) {
				throw new Error("The approved Engram Spec read-back does not match the persisted artifact.");
			}
			return { ...structuredClone(artifact), sourceRevision: written.revision };
		},
		async read(definitionId: string): Promise<ApprovedProductSpecRead> {
			const artifactTopic = topic(definitionId);
			const stored = await options.store.readCurrent(options.project, artifactTopic);
			if (!stored)
				throw new Error(`The approved Spec is unavailable at ${artifactTopic}.`);
			let parsed: unknown;
			try {
				parsed = JSON.parse(stored.content);
			} catch {
				throw new Error("The approved Engram Spec is malformed JSON.");
			}
			if (
				!parsed ||
				typeof parsed !== "object" ||
				!("spec" in parsed) ||
				!("approval" in parsed)
			) {
				throw new Error("The approved Engram Spec envelope is invalid.");
			}
			const artifact = parsed as Pick<
				ApprovedProductSpecRead,
				"spec" | "approval"
			>;
			return {
				spec: artifact.spec,
				approval: artifact.approval,
				sourceRevision: stored.revision,
			};
		},
	};
}
