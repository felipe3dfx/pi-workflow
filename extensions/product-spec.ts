import {
	canonicalJson,
	createBlocker,
	digestCanonicalValue,
	uniqueVerifiedArtifactRefs,
	type OwnerAuthority,
	type ProductSpecApprovalEnvelope,
	type ProductSpecEnvelope,
	type ProductSpecInput,
	type ProductSpecTarget,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

export class ProductSpecContractError extends Error {
	readonly code: "PI_WORKFLOW_SPEC_ARTIFACT_INVALID";

	constructor(code: "PI_WORKFLOW_SPEC_ARTIFACT_INVALID", message: string) {
		super(message);
		this.name = "ProductSpecContractError";
		this.code = code;
	}
}

const productSpecSectionHeadings = [
	"## 1. Problema",
	"## 2. Solución",
	"## 3. Historias de usuario",
	"## 4. Decisiones resueltas",
	"## 5. Pruebas",
	"## 6. Fuera de alcance",
] as const;

function numbered(items: readonly string[]): string {
	return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return (
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProductSpecTarget(value: unknown): value is ProductSpecTarget {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["kind", "teamId", "title"]) &&
		value.kind === "linear-parent-description" &&
		typeof value.teamId === "string" &&
		typeof value.title === "string"
	);
}

function isSupportArtifactRef(value: unknown, exact: boolean): boolean {
	return (
		isRecord(value) &&
		(!exact ||
			hasExactKeys(value, [
				"kind",
				"project",
				"topic",
				"revision",
				"schema",
				"schemaVersion",
				"digest",
			])) &&
		value.kind === "engram" &&
		typeof value.project === "string" &&
		value.project.trim().length > 0 &&
		typeof value.topic === "string" &&
		value.topic.trim().length > 0 &&
		typeof value.revision === "string" &&
		value.revision.trim().length > 0 &&
		(value.schema === "research-evidence" ||
			value.schema === "design-exploration") &&
		value.schemaVersion === 1 &&
		typeof value.digest === "string" &&
		value.digest.trim().length > 0
	);
}

function isProductSpecEnvelope(value: unknown): value is ProductSpecEnvelope {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["schema", "schemaVersion", "payload", "digest"]) ||
		value.schema !== "product-spec" ||
		value.schemaVersion !== 1 ||
		typeof value.digest !== "string" ||
		!isRecord(value.payload)
	) {
		return false;
	}
	const payload = value.payload;
	return (
		hasExactKeys(payload, [
			"definitionId",
			"target",
			"revision",
			"language",
			"body",
			"decisions",
			"supportArtifacts",
		]) &&
		typeof payload.definitionId === "string" &&
		payload.definitionId.trim().length > 0 &&
		isProductSpecTarget(payload.target) &&
		payload.target.teamId.trim().length > 0 &&
		payload.target.title.trim().length > 0 &&
		typeof payload.revision === "string" &&
		payload.revision.trim().length > 0 &&
		payload.language === "es" &&
		typeof payload.body === "string" &&
		Array.isArray(payload.decisions) &&
		payload.decisions.every(
			(decision) =>
				isRecord(decision) &&
				hasExactKeys(decision, ["id", "text"]) &&
				typeof decision.id === "string" &&
				decision.id.trim().length > 0 &&
				typeof decision.text === "string" &&
				decision.text.trim().length > 0,
		) &&
		Array.isArray(payload.supportArtifacts) &&
		payload.supportArtifacts.every((ref) => isSupportArtifactRef(ref, true))
	);
}

function isProductSpecApprovalEnvelope(
	value: unknown,
): value is ProductSpecApprovalEnvelope {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["schema", "schemaVersion", "payload", "digest"]) ||
		value.schema !== "product-spec-approval" ||
		value.schemaVersion !== 1 ||
		typeof value.digest !== "string" ||
		!isRecord(value.payload)
	) {
		return false;
	}
	return (
		hasExactKeys(value.payload, ["actor", "target", "revision", "specDigest"]) &&
		isExactOwnerAuthority(value.payload.actor) &&
		isProductSpecTarget(value.payload.target) &&
		typeof value.payload.revision === "string" &&
		typeof value.payload.specDigest === "string"
	);
}

function isProductSpecInput(value: unknown): value is ProductSpecInput {
	if (!isRecord(value) || !isProductSpecTarget(value.target)) return false;
	if (
		typeof value.definitionId !== "string" ||
		typeof value.definitionId !== "string" ||
		typeof value.revision !== "string" ||
		typeof value.problem !== "string" ||
		typeof value.solution !== "string" ||
		!isStringArray(value.userStories) ||
		!isStringArray(value.tests) ||
		!isStringArray(value.outOfScope) ||
		!Array.isArray(value.decisions) ||
		!Array.isArray(value.supportArtifacts)
	) {
		return false;
	}
	for (const decision of value.decisions) {
		if (
			!isRecord(decision) ||
			!hasExactKeys(decision, ["id", "status", "pertinent", "text"]) ||
			typeof decision.id !== "string" ||
			decision.id.trim().length === 0 ||
			(decision.status !== "open" && decision.status !== "resolved") ||
			typeof decision.pertinent !== "boolean" ||
			typeof decision.text !== "string"
		) {
			return false;
		}
	}
	for (const candidate of value.supportArtifacts) {
		if (!isSupportArtifactRef(candidate, true)) return false;
	}
	return true;
}

function isExactOwnerAuthority(value: unknown): value is OwnerAuthority {
	if (!value || typeof value !== "object") return false;
	const authority = value as Record<string, unknown>;
	return (
		typeof authority.actorId === "string" &&
		authority.actorId.length > 0 &&
		authority.actorId === authority.actorId.trim() &&
		authority.role === "Owner" &&
		typeof authority.authorityRevision === "string" &&
		authority.authorityRevision.length > 0 &&
		authority.authorityRevision === authority.authorityRevision.trim()
	);
}

function containsActiveMarkdown(text: string): boolean {
	return (
		/[\r\n]/u.test(text) ||
		/!\[|\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])|^\s*\[[^\]]+\]:/imu.test(
			text,
		) ||
		/<\/?[A-Za-z][^>]*>|<!--|<\?|<!|<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*>/iu.test(
			text,
		) ||
		/&(?:#\d{1,7}|#x[\da-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/iu.test(
			text,
		) ||
		/(?:https?:\/\/|javascript:|data:|vbscript:|file:|mailto:)/iu.test(text) ||
		/(?:^|[^\p{Letter}\p{Number}_])www\.(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:[/?#][^\s]*)?/iu.test(
			text,
		) ||
		/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/iu.test(
			text,
		) ||
		/`|(?:^|\s)[*_~]{1,3}\S|\S[*_~]{1,3}(?:\s|$)/u.test(text) ||
		/(?:^|\s)(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s)/u.test(text) ||
		/^\s*\[[ xX]\](?:\s|$)/u.test(text) ||
		/^\s{0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,}|(?:-\s*){3,})$/u.test(text) ||
		/(?:^|\s)@[A-Za-z0-9]/u.test(text)
	);
}


function productSpecBodyProse(body: string): string[] {
	return body
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("## "))
		.map((line) => line.replace(/^#\s+/, "").replace(/^\d+\.\s+/, ""));
}

function isSafeProductSpecBody(body: string): boolean {
	return productSpecBodyProse(body).every(
		(line) => !containsActiveMarkdown(line),
	);
}

export function isValidProductSpecSnapshot(
	value: unknown,
): value is ProductSpecEnvelope {
	if (!isProductSpecEnvelope(value)) return false;
	const unsigned = {
		schema: value.schema,
		schemaVersion: value.schemaVersion,
		payload: value.payload,
	};
	return (
		value.digest.trim().length > 0 &&
		value.digest === digestCanonicalValue(unsigned) &&
		isSafeProductSpecBody(value.payload.body) &&
		productSpecSectionHeadings.every((section) =>
			value.payload.body.includes(section),
		)
	);
}

export function createProductSpecEnvelope(
	input: ProductSpecInput,
): ProductSpecEnvelope {
	if (!isProductSpecInput(input)) {
		throw new ProductSpecContractError(
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
			"The product Spec input shape is invalid.",
		);
	}
	const decisions = input.decisions
		.filter((decision) => decision.status === "resolved" && decision.pertinent)
		.map((decision) => ({ id: decision.id.trim(), text: decision.text.trim() }));
	const supportArtifacts = uniqueVerifiedArtifactRefs(
		input.supportArtifacts.map((ref) => ({
			kind: ref.kind,
			project: ref.project,
			topic: ref.topic,
			revision: ref.revision,
			schema: ref.schema,
			schemaVersion: ref.schemaVersion,
			digest: ref.digest,
		})),
	);
	const target = {
		kind: input.target.kind,
		teamId: input.target.teamId.trim(),
		title: input.target.title.trim(),
	} as const;
	const problem = input.problem.trim();
	const solution = input.solution.trim();
	const userStories = input.userStories.map((item) => item.trim());
	const tests = input.tests.map((item) => item.trim());
	const outOfScope = input.outOfScope.map((item) => item.trim());
	const selectedProse = [
		target.title,
		problem,
		solution,
		...userStories,
		...decisions.map(({ text }) => text),
		...tests,
		...outOfScope,
	];
	if (
		!input.definitionId.trim() ||
		!target.teamId ||
		!target.title ||
		!input.revision.trim() ||
		selectedProse.some((text) => !text) ||
		userStories.length === 0 ||
		decisions.length === 0 ||
		tests.length === 0 ||
		outOfScope.length === 0
	) {
		throw new ProductSpecContractError(
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
			"The product Spec is missing required exact content or identity fields.",
		);
	}
	if (selectedProse.some(containsActiveMarkdown)) {
		throw new ProductSpecContractError(
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
			"The Linear-facing Spec content must be plain text without active Markdown or links.",
		);
	}
	const body = [
		`# ${target.title}`,
		"",
		productSpecSectionHeadings[0],
		"",
		problem,
		"",
		productSpecSectionHeadings[1],
		"",
		solution,
		"",
		productSpecSectionHeadings[2],
		"",
		numbered(userStories),
		"",
		productSpecSectionHeadings[3],
		"",
		numbered(decisions.map(({ text }) => text)),
		"",
		productSpecSectionHeadings[4],
		"",
		numbered(tests),
		"",
		productSpecSectionHeadings[5],
		"",
		numbered(outOfScope),
		"",
	].join("\n");
	const unsigned = {
		schema: "product-spec" as const,
		schemaVersion: 1 as const,
		payload: {
			definitionId: input.definitionId.trim(),
			target,
			revision: input.revision.trim(),
			language: "es" as const,
			body,
			decisions,
			supportArtifacts,
		},
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

export function createProductSpecApprovalEnvelope(input: {
	spec: ProductSpecEnvelope;
	actor: OwnerAuthority;
}): ProductSpecApprovalEnvelope {
	if (!isExactOwnerAuthority(input.actor)) {
		throw new ProductSpecContractError(
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
			"The Spec approval authority is incomplete or invalid.",
		);
	}
	const unsigned = {
		schema: "product-spec-approval" as const,
		schemaVersion: 1 as const,
		payload: {
			actor: {
				actorId: input.actor.actorId.trim(),
				role: input.actor.role,
				authorityRevision: input.actor.authorityRevision.trim(),
			},
			target: input.spec.payload.target,
			revision: input.spec.payload.revision,
			specDigest: input.spec.digest,
		},
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

export type ProductSpecApprovalValidation =
	| { ok: true }
	| { ok: false; blocker: WorkflowBlocker };

export function validateProductSpecApproval(
	input: unknown,
): ProductSpecApprovalValidation {
	if (
		!isRecord(input) ||
		!["spec", "approval", "actor", "target", "revision"].every((key) =>
			Object.hasOwn(input, key),
		)
	) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
				"The product Spec schema, language, body, revision, or digest is invalid.",
			),
		};
	}
	if (!isExactOwnerAuthority(input.actor)) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
				"Publication requires trusted, non-empty current Owner authority.",
			),
		};
	}
	if (
		!isValidProductSpecSnapshot(input.spec) ||
		!isProductSpecTarget(input.target) ||
		typeof input.revision !== "string" ||
		input.revision.trim().length === 0
	) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
				"The product Spec schema, language, body, revision, or digest is invalid.",
			),
		};
	}
	if (!isProductSpecApprovalEnvelope(input.approval)) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_SPEC_APPROVAL_MISMATCH",
				"Spec approval does not match the current actor, authority, target, revision, and exact body digest.",
			),
		};
	}
	const approvalUnsigned = {
		schema: input.approval.schema,
		schemaVersion: input.approval.schemaVersion,
		payload: input.approval.payload,
	};
	const expectedBinding = {
		actor: input.actor,
		target: input.target,
		revision: input.revision,
		specDigest: input.spec.digest,
	};
	if (
		input.approval.schema !== "product-spec-approval" ||
		input.approval.schemaVersion !== 1 ||
		input.approval.digest !== digestCanonicalValue(approvalUnsigned) ||
		canonicalJson(input.approval.payload) !== canonicalJson(expectedBinding) ||
		canonicalJson(input.spec.payload.target) !== canonicalJson(input.target) ||
		input.spec.payload.revision !== input.revision
	) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_SPEC_APPROVAL_MISMATCH",
				"Spec approval does not match the current actor, authority, target, revision, and exact body digest.",
			),
		};
	}
	return { ok: true };
}
