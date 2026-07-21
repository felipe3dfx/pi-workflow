import { canonicalJson, digestCanonicalValue, type AuthenticatedAuthority } from "./workflow-contracts.ts";
import { isProductReviewDraft, type ProductReviewDraft, type ProductReviewDraftReader, type ProductReviewResult } from "./product-review-draft-store.ts";

export interface LinearProductReviewIssueSnapshot {
	readonly id: string; readonly identifier: string; readonly title: string; readonly description: string;
	readonly updatedAt: string; readonly state: unknown; readonly assignee: unknown; readonly cycle: unknown;
	readonly labels: unknown; readonly estimate: unknown; readonly relations: unknown; readonly parent?: unknown;
}
export interface LinearProductReviewGateway {
	getIssue(input: { readonly id: string }): Promise<LinearProductReviewIssueSnapshot | undefined>;
	listComments(input: { readonly issueId: string; readonly cursor?: string }): Promise<unknown>;
	createComment(input: { readonly issueId: string; readonly body: string }): Promise<unknown>;
}
export interface ProductReviewArtifact {
	readonly schema: "product-review"; readonly schemaVersion: 1; readonly language: "es";
	readonly payload: ProductReviewDraft & {
		readonly issue: { readonly id: string; readonly revision: string; readonly body: string };
		readonly authority: { readonly actorId: string; readonly role: "Owner"; readonly authorityRevision: string };
		readonly result: ProductReviewResult;
	};
	readonly digest: string; readonly body: string;
}
export interface ProductReviewArtifactStore {
	read(issueId: string): Promise<ProductReviewArtifact | undefined>;
	save(artifact: ProductReviewArtifact): Promise<ProductReviewArtifact>;
}
interface Blocker { readonly code: string; readonly message: string }
type Blocked = { readonly status: "blocked"; readonly blocker: Blocker };
type OwnerAuthority = AuthenticatedAuthority & { readonly role: "Owner" };
type Comment = { readonly id: string; readonly body: string };
const blocked = (code: string, message: string): Blocked => ({ status: "blocked", blocker: { code, message } });
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.trim();
const linearIssueId = (value: unknown): value is string => text(value) && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exact(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
	const actual = Object.keys(value);
	return required.every((key) => actual.includes(key)) && actual.every((key) => required.includes(key) || optional.includes(key));
}
function owner(value: unknown): value is OwnerAuthority {
	return record(value) && exact(value, ["actorId", "role", "authorityRevision"]) && value.role === "Owner" && text(value.actorId) && text(value.authorityRevision);
}
function immutable<T>(value: T): T {
	const clone = structuredClone(value);
	const freeze = (candidate: unknown): void => {
		if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
		for (const child of Object.values(candidate)) freeze(child);
		Object.freeze(candidate);
	};
	freeze(clone);
	return clone;
}
function render(payload: ProductReviewArtifact["payload"], digest: string): string {
	const sections = [
		`# Revisión de producto — ${payload.issue.id}`,
		`## Resultado\n\n**Resultado:** ${payload.result}`,
		`## Alcance\n\n${payload.scope}`,
		`## Historias y criterios de aceptación\n\n${payload.stories.flatMap((story) => [`### ${story.id} — ${story.description}`, ...story.acceptanceCriteria.map((criterion) => `- **${criterion.id} (${criterion.result}):** ${criterion.description}${criterion.evidence.length ? `\n  - Evidencia: ${criterion.evidence.map((item) => `\`${item}\``).join("; ")}` : ""}`)]).join("\n")}`,
	];
	if (payload.evidence.length) sections.push(`## Evidencia\n\n${payload.evidence.map((item) => `- ${item.url ? `[${item.description}](${item.url})` : item.description} (\`${item.ref}\`)`).join("\n")}`);
	if (payload.findings.length) sections.push(`## Hallazgos\n\n${payload.findings.map((item) => `- ${item}`).join("\n")}`);
	if (payload.requiredChanges.length) sections.push(`## Cambios requeridos\n\n${payload.requiredChanges.map((item) => `- ${item}`).join("\n")}`);
	if (payload.parentImpact) sections.push(`## Impacto en el parent\n\n${payload.parentImpact}`);
	if (payload.siblingImpact?.length) sections.push(`## Impacto en issues siblings\n\n${payload.siblingImpact.map((item) => `- ${item}`).join("\n")}`);
	sections.push(`Referencia de flujo: product-review:${digest}`);
	return `${sections.join("\n\n")}\n`;
}
function createArtifact(issue: LinearProductReviewIssueSnapshot, authority: OwnerAuthority, source: ProductReviewDraft, result: ProductReviewResult): ProductReviewArtifact {
	const draft = structuredClone(source);
	const { parentImpact, siblingImpact, ...required } = draft;
	const payload: ProductReviewArtifact["payload"] = {
		...required,
		...(parentImpact ? { parentImpact } : {}),
		...(siblingImpact?.length ? { siblingImpact } : {}),
		issue: { id: issue.id, revision: issue.updatedAt, body: issue.description },
		authority: { actorId: authority.actorId, role: "Owner", authorityRevision: authority.authorityRevision },
		result,
	};
	const unsigned = { schema: "product-review" as const, schemaVersion: 1 as const, language: "es" as const, payload };
	const digest = digestCanonicalValue(unsigned);
	return { ...unsigned, digest, body: render(payload, digest) };
}
export function isProductReviewArtifact(value: unknown, expectedIssueId: string): value is ProductReviewArtifact {
	if (!linearIssueId(expectedIssueId) || !record(value) || !exact(value, ["schema", "schemaVersion", "language", "payload", "digest", "body"]) ||
		value.schema !== "product-review" || value.schemaVersion !== 1 || value.language !== "es" || !record(value.payload) ||
		!exact(value.payload, ["scope", "stories", "evidence", "findings", "requiredChanges", "recommendation", "issue", "authority", "result"], ["parentImpact", "siblingImpact"]) ||
		!record(value.payload.issue) || !exact(value.payload.issue, ["id", "revision", "body"]) ||
		typeof value.payload.issue.id !== "string" || value.payload.issue.id !== expectedIssueId ||
		typeof value.payload.issue.revision !== "string" || !text(value.payload.issue.revision) ||
		typeof value.payload.issue.body !== "string" || !owner(value.payload.authority) ||
		(value.payload.result !== "Aceptado" && value.payload.result !== "Cambios requeridos")) return false;
	const issue = { id: value.payload.issue.id, revision: value.payload.issue.revision, body: value.payload.issue.body };
	const authority = value.payload.authority;
	const result = value.payload.result;
	const { issue: _issue, authority: _authority, result: _result, ...draft } = value.payload;
	if (!isProductReviewDraft(draft)) return false;
	const payload: ProductReviewArtifact["payload"] = { ...draft, issue, authority, result };
	const digest = digestCanonicalValue({ schema: value.schema, schemaVersion: value.schemaVersion, language: value.language, payload });
	return typeof value.digest === "string" && value.digest === digest && typeof value.body === "string" && value.body === render(payload, digest);
}
function errorCode(error: unknown, fallback: string): string {
	return record(error) && typeof error.code === "string" && error.code.length > 0 ? error.code : fallback;
}
function exactMarker(body: string, marker: string): boolean { return body.split(/\r\n|\n|\r/).some((line) => line === marker); }
function parseCommentPage(value: unknown): { comments: Comment[]; nextCursor?: string } {
	if (!record(value) || !exact(value, ["comments"], ["nextCursor"]) || !Array.isArray(value.comments))
		throw Object.assign(new Error("Linear returned a malformed comment page."), { code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" });
	const comments: Comment[] = [];
	for (const item of value.comments) {
		if (!record(item) || !exact(item, ["id", "body"]) || !text(item.id) || typeof item.body !== "string")
			throw Object.assign(new Error("Linear returned a malformed comment page."), { code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" });
		comments.push({ id: item.id, body: item.body });
	}
	if (value.nextCursor !== undefined && !text(value.nextCursor))
		throw Object.assign(new Error("Linear returned a malformed comment cursor."), { code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" });
	return value.nextCursor === undefined ? { comments } : { comments, nextCursor: value.nextCursor };
}
async function allComments(gateway: LinearProductReviewGateway, id: string): Promise<Comment[]> {
	const comments: Comment[] = []; let cursor: string | undefined; const seen = new Set<string>();
	do {
		const page = parseCommentPage(await gateway.listComments({ issueId: id, ...(cursor ? { cursor } : {}) }));
		comments.push(...page.comments); cursor = page.nextCursor;
		if (cursor && seen.has(cursor)) throw Object.assign(new Error("Linear repeated a comment cursor."), { code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" });
		if (cursor) seen.add(cursor);
	} while (cursor);
	return comments;
}
function parseCreated(value: unknown, body: string): Comment | undefined {
	return record(value) && exact(value, ["id", "body"]) && text(value.id) && value.body === body ? { id: value.id, body } : undefined;
}
export function createProductReviewWorkflow(deps: {
	readonly gateway: LinearProductReviewGateway; readonly artifacts: ProductReviewArtifactStore;
	readonly drafts: ProductReviewDraftReader; readonly currentOwner: () => Promise<AuthenticatedAuthority | undefined>;
}) {
	let prepared: { issue: LinearProductReviewIssueSnapshot; authority: OwnerAuthority; choices: Record<ProductReviewResult, ProductReviewArtifact> } | undefined;
	let approved: { issueId: string; result: ProductReviewResult; digest: string } | undefined;
	return {
		async prepare(id: string) {
			prepared = undefined; approved = undefined;
			try {
				if (!linearIssueId(id)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_ISSUE_MISMATCH", "A single issue ID is required.");
				const [issue, draft, authority] = await Promise.all([deps.gateway.getIssue({ id }), deps.drafts.read(id), deps.currentOwner()]);
				if (!issue || issue.id !== id || !text(issue.updatedAt) || typeof issue.description !== "string") return blocked("PI_WORKFLOW_PRODUCT_REVIEW_ISSUE_MISMATCH", "Issue unavailable or mismatched.");
				if (!owner(authority)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH", "Exact Owner authority is required.");
				if (!isProductReviewDraft(draft)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_INVALID", "A valid review draft is required.");
				const choices = { Aceptado: createArtifact(issue, authority, draft, "Aceptado"), "Cambios requeridos": createArtifact(issue, authority, draft, "Cambios requeridos") };
				prepared = { issue: structuredClone(issue), authority: structuredClone(authority), choices };
				return { status: "prepared" as const, recommendation: draft.recommendation, choices: { Aceptado: { digest: choices.Aceptado.digest }, "Cambios requeridos": { digest: choices["Cambios requeridos"].digest } } };
			} catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PREPARATION_FAILED"), error instanceof Error ? error.message : "Preparation failed."); }
		},
		async approve(input: unknown) {
			try {
				if (!record(input) || !exact(input, ["issueId", "result", "digest"]) || !linearIssueId(input.issueId) ||
					(input.result !== "Aceptado" && input.result !== "Cambios requeridos") || !text(input.digest))
					return blocked("PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID", "Approval requires exact issue, result, and digest.");
				const current = prepared;
				if (!current || input.issueId !== current.issue.id) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_RESULT_MISMATCH", "Approval does not match the active review.");
				const chosen = current.choices[input.result];
				if (input.digest !== chosen.digest) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "The chosen digest does not match.");
				const [issue, authority] = await Promise.all([deps.gateway.getIssue({ id: input.issueId }), deps.currentOwner()]);
				if (!issue || canonicalJson(issue) !== canonicalJson(current.issue)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "Issue state, body, or relations changed before approval.");
				if (!owner(authority) || canonicalJson(authority) !== canonicalJson(current.authority)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH", "Owner authority changed before approval.");
				const existing = await deps.artifacts.read(input.issueId);
				if (existing && (!isProductReviewArtifact(existing, input.issueId) || existing.digest !== chosen.digest)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_ARTIFACT_CONFLICT", "A different create-only review exists.");
				const saved = existing ?? await deps.artifacts.save(chosen);
				const readBack = await deps.artifacts.read(input.issueId);
				if (!readBack || !isProductReviewArtifact(readBack, input.issueId) || canonicalJson(readBack) !== canonicalJson(saved)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_READBACK_MISMATCH", "Artifact read-back mismatch.");
				approved = { issueId: input.issueId, result: input.result, digest: input.digest };
				return immutable({ status: "approved" as const, ...approved, artifact: readBack });
			} catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_APPROVAL_FAILED"), error instanceof Error ? error.message : "Approval failed."); }
		},
		async publish(input: unknown) {
			try {
				if (!record(input) || !exact(input, ["issueId"]) || !linearIssueId(input.issueId)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID", "Publication accepts only the approved issue ID.");
				const authorization = approved;
				if (!authorization || authorization.issueId !== input.issueId) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "Approved review does not match the active publication.");
				const [artifact, issueBefore, authority] = await Promise.all([deps.artifacts.read(input.issueId), deps.gateway.getIssue({ id: input.issueId }), deps.currentOwner()]);
				if (!artifact || !isProductReviewArtifact(artifact, input.issueId) || artifact.digest !== authorization.digest || artifact.payload.result !== authorization.result) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "Approved digest or result changed.");
				if (!issueBefore || !prepared || canonicalJson(issueBefore) !== canonicalJson(prepared.issue)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "Full issue state, body, or relations changed.");
				if (issueBefore.id !== artifact.payload.issue.id || issueBefore.updatedAt !== artifact.payload.issue.revision || issueBefore.description !== artifact.payload.issue.body) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "Issue binding changed.");
				if (!owner(authority) || canonicalJson(authority) !== canonicalJson(artifact.payload.authority) || canonicalJson(authority) !== canonicalJson(prepared.authority)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH", "Owner authority changed.");
				const marker = `Referencia de flujo: product-review:${artifact.digest}`;
				const before = await allComments(deps.gateway, input.issueId);
				const matching = before.filter((comment) => exactMarker(comment.body, marker));
				if (matching.some((comment) => comment.body !== artifact.body)) return blocked("PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT", "Reference exists with another body.");
				let comment = matching.find((candidate) => candidate.body === artifact.body);
				if (!comment) {
					const [issueImmediatelyBefore, authorityImmediatelyBefore] = await Promise.all([
						deps.gateway.getIssue({ id: input.issueId }),
						deps.currentOwner(),
					]);
					if (!issueImmediatelyBefore || canonicalJson(issueImmediatelyBefore) !== canonicalJson(issueBefore))
						return blocked("PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH", "Full issue state changed immediately before publication.");
					if (!owner(authorityImmediatelyBefore) || canonicalJson(authorityImmediatelyBefore) !== canonicalJson(authority))
						return blocked("PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH", "Owner authority changed immediately before publication.");
					comment = parseCreated(await deps.gateway.createComment({ issueId: input.issueId, body: artifact.body }), artifact.body);
					if (!comment) return blocked("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE", "Linear returned a malformed comment creation response.");
				}
				const [after, issueAfter] = await Promise.all([allComments(deps.gateway, input.issueId), deps.gateway.getIssue({ id: input.issueId })]);
				const readBack = after.find((candidate) => candidate.id === comment.id && candidate.body === artifact.body);
				if (!readBack || !issueAfter || canonicalJson(issueAfter) !== canonicalJson(issueBefore)) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_READBACK_MISMATCH", "Comment or full issue read-back mismatch.");
				return immutable({ status: "published" as const, artifact, comment: readBack });
			} catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PUBLICATION_FAILED"), error instanceof Error ? error.message : "Publication failed."); }
		},
	};
}
