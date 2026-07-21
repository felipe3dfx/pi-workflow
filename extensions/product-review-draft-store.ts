import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export type ProductReviewResult = "Aceptado" | "Cambios requeridos";
type AcceptanceCriterionResult = "cumple" | "no cumple" | "parcial";
export interface ProductReviewDraft {
	readonly scope: string;
	readonly stories: readonly {
		readonly id: string;
		readonly description: string;
		readonly acceptanceCriteria: readonly {
			readonly id: string;
			readonly description: string;
			readonly result: AcceptanceCriterionResult;
			readonly evidence: readonly string[];
		}[];
	}[];
	readonly evidence: readonly {
		readonly ref: string;
		readonly description: string;
		readonly url?: string;
	}[];
	readonly findings: readonly string[];
	readonly requiredChanges: readonly string[];
	readonly parentImpact?: string;
	readonly siblingImpact?: readonly string[];
	readonly recommendation: ProductReviewResult;
}
export interface ProductReviewDraftArtifact {
	readonly schema: "product-review-draft";
	readonly schemaVersion: 1;
	readonly payload: {
		readonly issue: { readonly id: string };
		readonly draft: ProductReviewDraft;
	};
	readonly digest: string;
}
export interface ProductReviewDraftReader {
	read(issueId: string): Promise<ProductReviewDraft | undefined>;
}
export interface ProductReviewDraftStore extends ProductReviewDraftReader {
	save(input: { readonly issueId: string; readonly draft: ProductReviewDraft }): Promise<ProductReviewDraftArtifact>;
}
const text = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value === value.trim();
const issueId = (value: unknown): value is string =>
	text(value) && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
function exact(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
	const actual = Object.keys(value);
	return required.every((key) => actual.includes(key)) &&
		actual.every((key) => required.includes(key) || optional.includes(key));
}
const stringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(text);

export function isProductReviewDraft(value: unknown): value is ProductReviewDraft {
	if (!record(value) || !exact(value, ["scope", "stories", "evidence", "findings", "requiredChanges", "recommendation"], ["parentImpact", "siblingImpact"])) return false;
	return text(value.scope) &&
		(value.recommendation === "Aceptado" || value.recommendation === "Cambios requeridos") &&
		Array.isArray(value.stories) && value.stories.length > 0 && value.stories.every((story) =>
			record(story) && exact(story, ["id", "description", "acceptanceCriteria"]) &&
			text(story.id) && text(story.description) && Array.isArray(story.acceptanceCriteria) &&
			story.acceptanceCriteria.length > 0 && story.acceptanceCriteria.every((criterion) =>
				record(criterion) && exact(criterion, ["id", "description", "result", "evidence"]) &&
				text(criterion.id) && text(criterion.description) &&
				(criterion.result === "cumple" || criterion.result === "no cumple" || criterion.result === "parcial") &&
				stringArray(criterion.evidence))) &&
		Array.isArray(value.evidence) && value.evidence.every((item) =>
			record(item) && exact(item, ["ref", "description"], ["url"]) && text(item.ref) &&
			text(item.description) && (item.url === undefined || text(item.url))) &&
		stringArray(value.findings) && stringArray(value.requiredChanges) &&
		(value.parentImpact === undefined || text(value.parentImpact)) &&
		(value.siblingImpact === undefined || stringArray(value.siblingImpact));
}

export function isProductReviewDraftArtifact(value: unknown, expectedIssueId: string): value is ProductReviewDraftArtifact {
	if (!issueId(expectedIssueId) || !record(value) || !exact(value, ["schema", "schemaVersion", "payload", "digest"]) ||
		value.schema !== "product-review-draft" || value.schemaVersion !== 1 || !record(value.payload) ||
		!exact(value.payload, ["issue", "draft"]) || !record(value.payload.issue) ||
		!exact(value.payload.issue, ["id"]) || value.payload.issue.id !== expectedIssueId ||
		!isProductReviewDraft(value.payload.draft)) return false;
	return value.digest === digestCanonicalValue({ schema: value.schema, schemaVersion: value.schemaVersion, payload: value.payload });
}
function failure(message: string): Error {
	return Object.assign(new Error(message), { code: "PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_INVALID" });
}
function parse(content: string, expectedIssueId: string): ProductReviewDraftArtifact {
	let value: unknown;
	try { value = JSON.parse(content); } catch { throw failure("The product review draft is not valid JSON."); }
	if (!isProductReviewDraftArtifact(value, expectedIssueId) || content !== `${canonicalJson(value)}\n`)
		throw failure("The product-review-draft/v1 artifact is invalid or noncanonical.");
	return value;
}
export function createProductReviewDraftStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string;
	readonly topic?: string;
}): ProductReviewDraftStore {
	const destination = (id: string) => `${options.topic ?? "workflow/product-review-draft"}/${id}`;
	return {
		async read(id) {
			if (!issueId(id)) throw failure("A valid issue ID is required.");
			const current = await options.store.readCurrent(options.project, destination(id));
			if (!current) return undefined;
			if (await options.store.readRevision(options.project, destination(id), current.revision) !== current.content)
				throw failure("Product review draft read-back mismatch.");
			return structuredClone(parse(current.content, id).payload.draft);
		},
		async save({ issueId: id, draft }) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true || !issueId(id) || !isProductReviewDraft(draft))
				throw failure("Invalid product review draft input or store capability.");
			const unsigned = { schema: "product-review-draft" as const, schemaVersion: 1 as const, payload: { issue: { id }, draft: structuredClone(draft) } };
			const artifact: ProductReviewDraftArtifact = { ...unsigned, digest: digestCanonicalValue(unsigned) };
			const content = `${canonicalJson(artifact)}\n`;
			const current = await options.store.readCurrent(options.project, destination(id));
			if (current) {
				parse(current.content, id);
				if (current.content !== content) throw failure("The product review draft conflicts with its create-only artifact.");
				if (await options.store.readRevision(options.project, destination(id), current.revision) !== content)
					throw failure("Product review draft read-back mismatch.");
				return structuredClone(artifact);
			}
			const written = await options.store.write(options.project, destination(id), content, undefined);
			if (await options.store.readRevision(options.project, destination(id), written.revision) !== content)
				throw failure("Product review draft read-back mismatch.");
			return structuredClone(parse(content, id));
		},
	};
}
