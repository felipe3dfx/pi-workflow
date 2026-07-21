import { canonicalJson } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";
import {
	isProductReviewArtifact,
	type ProductReviewArtifact,
	type ProductReviewArtifactStore,
} from "./product-review-workflow.ts";
const invalid = (message: string) =>
	Object.assign(new Error(message), {
		code: "PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_INVALID",
	});
export function createProductReviewArtifactStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string;
	readonly topic?: string;
}): ProductReviewArtifactStore {
	const topic = (id: string) =>
		`${options.topic ?? "workflow/product-review"}/${id}`;
	const parse = (content: string, id: string): ProductReviewArtifact => {
		let value: unknown;
		try {
			value = JSON.parse(content);
		} catch {
			throw invalid("The product review artifact is not valid JSON.");
		}
		if (
			!isProductReviewArtifact(value, id) ||
			content !== `${canonicalJson(value)}\n`
		)
			throw invalid(
				"The product review artifact is invalid, corrupt, or noncanonical.",
			);
		return value;
	};
	return {
		async read(id) {
			const current = await options.store.readCurrent(
				options.project,
				topic(id),
			);
			if (!current) return undefined;
			if (
				(await options.store.readRevision(
					options.project,
					topic(id),
					current.revision,
				)) !== current.content
			)
				throw invalid("Product review artifact read-back mismatch.");
			return structuredClone(parse(current.content, id));
		},
		async save(artifact) {
			if (
				options.store.capabilities?.atomicCompareAndSwap !== true ||
				!isProductReviewArtifact(artifact, artifact.payload.issue.id)
			)
				throw invalid(
					"Atomic CAS and a valid product review artifact are required.",
				);
			const id = artifact.payload.issue.id,
				content = `${canonicalJson(artifact)}\n`,
				current = await options.store.readCurrent(options.project, topic(id));
			if (current) {
				parse(current.content, id);
				if (current.content !== content)
					throw Object.assign(
						new Error(
							"The product review artifact conflicts with its create-only snapshot.",
						),
						{ code: "PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT" },
					);
				if (
					(await options.store.readRevision(
						options.project,
						topic(id),
						current.revision,
					)) !== content
				)
					throw invalid("Product review artifact read-back mismatch.");
				return structuredClone(parse(content, id));
			}
			const written = await options.store.write(
				options.project,
				topic(id),
				content,
				undefined,
			);
			if (
				(await options.store.readRevision(
					options.project,
					topic(id),
					written.revision,
				)) !== content
			)
				throw invalid("Product review artifact read-back mismatch.");
			return structuredClone(parse(content, id));
		},
	};
}
