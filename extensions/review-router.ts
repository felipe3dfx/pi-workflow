import type {
	ArtifactSchema,
	ReviewLens,
	VerifiedArtifactRef,
	WorkflowRisk,
} from "./workflow-contracts.ts";
import { digestCanonicalValue } from "./workflow-contracts.ts";

type ReviewSeverity = "warning" | "critical";
type ReviewArtifactRef = VerifiedArtifactRef;
export type AuthorizedRole = "Owner" | "Developer";
export type ExtraordinaryMode = "full-4r" | "judgment-day";
export type OrchestratorAuthorityCapability = object;

export interface ReviewSignal {
	riskId: string;
	severity: ReviewSeverity;
	lens: ReviewLens;
	evidence: ReviewArtifactRef;
}
export interface ReviewSubject {
	kind: "delivery-ticket";
	id: string;
	digest: string;
}
export interface ReviewSnapshotV1 {
	schema: "review-snapshot";
	schemaVersion: 1;
	payload: {
		subject: ReviewSubject;
		manifest: readonly ReviewArtifactRef[];
		risks: readonly WorkflowRisk[];
	};
	digest: string;
}
interface NormalReviewPlanRef {
	mode: "normal";
	requestId: string;
	subjectDigest: string;
	snapshotDigest: string;
	planDigest: string;
}
export interface ExtraordinaryReviewPlanRef {
	mode: ExtraordinaryMode;
	actorId: string;
	role: AuthorizedRole;
	requestId: string;
	subjectDigest: string;
	snapshotDigest: string;
	planDigest: string;
}
export type ReviewPlanRef = NormalReviewPlanRef | ExtraordinaryReviewPlanRef;
export interface ExtraordinaryPlanProposal {
	mode: ExtraordinaryMode;
	actorId: string;
	role: AuthorizedRole;
	requestId: string;
	subjectDigest: string;
	snapshotDigest: string;
	plan: Readonly<Record<string, unknown>>;
	planDigest: string;
}
export interface ReviewAuthorizationV1 {
	schema: "review-authorization";
	schemaVersion: 1;
	mode: ExtraordinaryMode;
	actorId: string;
	role: AuthorizedRole;
	requestId: string;
	subjectDigest: string;
	snapshotDigest: string;
	planDigest: string;
	/** Opaque evidence issued and verified only by the injected authority. */
	authorityProof: string;
	digest: string;
}
export interface OrchestratorAuthority {
	readonly capability: OrchestratorAuthorityCapability;
	authorize(proposal: ExtraordinaryPlanProposal): ReviewAuthorizationV1;
	verify(
		authorization: ReviewAuthorizationV1,
		proposal: ExtraordinaryPlanProposal,
	): boolean;
}
export interface ReviewReceiptV1 {
	schema: "review-receipt";
	schemaVersion: 1;
	status: "completed" | "blocked";
	planRef: ReviewPlanRef;
	lens: ReviewLens;
	digest: string;
}
interface ReviewLaunch {
	kind: "review-lens";
	lens: ReviewLens;
	riskId: string;
	reviewPlanRef: ReviewPlanRef;
}
interface NormalReviewPlan {
	mode: "normal";
	decision: "stop" | "proceed";
	signals: readonly ReviewSignal[];
	ref: NormalReviewPlanRef;
	launches: readonly ReviewLaunch[];
}
interface Full4RReviewPlan {
	mode: "full-4r";
	decision: "stop" | "proceed";
	signals: readonly ReviewSignal[];
	ref: ExtraordinaryReviewPlanRef & { mode: "full-4r" };
	launches: readonly ReviewLaunch[];
}
export type ReviewPlan = NormalReviewPlan | Full4RReviewPlan;

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}
function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
function validRole(value: unknown): value is AuthorizedRole {
	return value === "Owner" || value === "Developer";
}
function requireCapability(
	authority: OrchestratorAuthority | undefined,
	capability: OrchestratorAuthorityCapability,
): OrchestratorAuthority {
	if (!authority || capability !== authority.capability) {
		fail(
			"PI_WORKFLOW_ORCHESTRATOR_AUTHORITY_REQUIRED",
			"Extraordinary review requires the injected Orchestrator authority capability.",
		);
	}
	return authority;
}
const artifactSchemas = new Set<ArtifactSchema>([
	"research-evidence",
	"design-exploration",
	"delivery-ticket-graph",
	"delivery-parent",
	"approved-spec",
	"approved-revision-draft",
	"approved-revision",
	"approved-ticket-publication",
	"product-spec",
	"workflow-progress",
	"review-snapshot",
	"review-receipt",
	"review-evidence",
]);
function validArtifactRef(value: unknown): value is ReviewArtifactRef {
	if (!value || typeof value !== "object") return false;
	const ref = value as Partial<ReviewArtifactRef>;
	return (
		ref.kind === "engram" &&
		[ref.project, ref.topic, ref.revision, ref.schema, ref.digest].every(
			nonEmpty,
		) &&
		artifactSchemas.has(ref.schema as ArtifactSchema) &&
		ref.schemaVersion === 1
	);
}
function validSubject(subject: ReviewSubject): boolean {
	return (
		subject.kind === "delivery-ticket" &&
		nonEmpty(subject.id) &&
		nonEmpty(subject.digest)
	);
}
export function createReviewSnapshot(input: {
	subject: ReviewSubject;
	manifest: readonly ReviewArtifactRef[];
	risks: readonly WorkflowRisk[];
}): ReviewSnapshotV1 {
	if (
		!validSubject(input.subject) ||
		input.manifest.length === 0 ||
		!input.manifest.every(validArtifactRef)
	) {
		fail(
			"PI_WORKFLOW_REVIEW_SNAPSHOT_INVALID",
			"review-snapshot/v1 requires a verified subject and non-empty artifact manifest.",
		);
	}
	const unsigned = {
		schema: "review-snapshot" as const,
		schemaVersion: 1 as const,
		payload: structuredClone(input),
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}
function validateReviewSnapshot(snapshot: ReviewSnapshotV1): void {
	if (
		snapshot.schema !== "review-snapshot" ||
		snapshot.schemaVersion !== 1 ||
		!validSubject(snapshot.payload?.subject) ||
		!Array.isArray(snapshot.payload?.manifest) ||
		snapshot.payload.manifest.length === 0 ||
		!snapshot.payload.manifest.every(validArtifactRef) ||
		!Array.isArray(snapshot.payload?.risks) ||
		snapshot.digest !==
			digestCanonicalValue({
				schema: snapshot.schema,
				schemaVersion: snapshot.schemaVersion,
				payload: snapshot.payload,
			})
	) {
		fail(
			"PI_WORKFLOW_REVIEW_SNAPSHOT_INVALID",
			"The immutable review-snapshot/v1 manifest or digest is invalid.",
		);
	}
}
const lenses: readonly ReviewLens[] = [
	"risk",
	"resilience",
	"reliability",
	"readability",
];
function signalsFrom(risks: readonly WorkflowRisk[]): ReviewSignal[] {
	const ids = new Set<string>();
	const signals: ReviewSignal[] = [];
	for (const candidate of risks as readonly unknown[]) {
		if (!candidate || typeof candidate !== "object") {
			fail(
				"PI_WORKFLOW_REVIEW_RISK_INVALID",
				"Every risk must use the approved discriminated union.",
			);
		}
		const risk = candidate as Partial<WorkflowRisk>;
		if (
			!nonEmpty(risk.id) ||
			ids.has(risk.id) ||
			!nonEmpty(risk.summary) ||
			!["warning", "critical"].includes(risk.severity as string) ||
			!["workflow", "review"].includes(risk.kind as string)
		) {
			fail(
				"PI_WORKFLOW_REVIEW_RISK_INVALID",
				"Risk IDs must be unique and every risk field must be valid.",
			);
		}
		ids.add(risk.id);
		if (
			risk.kind === "workflow" &&
			(Object.hasOwn(risk, "lens") ||
				(Object.hasOwn(risk, "evidence") && !validArtifactRef(risk.evidence)))
		) {
			fail(
				"PI_WORKFLOW_REVIEW_RISK_INVALID",
				"Workflow risks may only carry optional verified evidence and cannot select a lens.",
			);
		}
		if (risk.kind === "review") {
			if (
				!lenses.includes(risk.lens as ReviewLens) ||
				!validArtifactRef(risk.evidence)
			) {
				fail(
					"PI_WORKFLOW_REVIEW_RISK_INVALID",
					"Review risks require exactly one approved lens and verified evidence.",
				);
			}
			signals.push({
				riskId: risk.id,
				severity: risk.severity as ReviewSeverity,
				lens: risk.lens as ReviewLens,
				evidence: structuredClone(risk.evidence),
			});
		}
	}
	return signals;
}
export function validateReviewReceipt(
	receipt: ReviewReceiptV1,
	expected?: ReviewPlanRef,
): void {
	const { digest, ...unsigned } = receipt;
	if (
		receipt.schema !== "review-receipt" ||
		receipt.schemaVersion !== 1 ||
		!["completed", "blocked"].includes(receipt.status) ||
		!lenses.includes(receipt.lens) ||
		!receipt.planRef ||
		!nonEmpty(receipt.planRef.requestId) ||
		!nonEmpty(receipt.planRef.subjectDigest) ||
		!nonEmpty(receipt.planRef.snapshotDigest) ||
		!nonEmpty(receipt.planRef.planDigest) ||
		digest !== digestCanonicalValue(unsigned) ||
		(expected &&
			digestCanonicalValue(receipt.planRef) !== digestCanonicalValue(expected))
	) {
		fail(
			"PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
			"Only valid exact-plan terminal review receipts can consume review budget.",
		);
	}
}
export function validateReviewAuthorization(
	authorization: ReviewAuthorizationV1,
	proposal: ExtraordinaryPlanProposal,
): void {
	const { digest, ...unsigned } = authorization;
	if (
		authorization.schema !== "review-authorization" ||
		authorization.schemaVersion !== 1 ||
		!validRole(authorization.role) ||
		!nonEmpty(authorization.authorityProof) ||
		digest !== digestCanonicalValue(unsigned) ||
		authorization.mode !== proposal.mode ||
		authorization.actorId !== proposal.actorId ||
		authorization.role !== proposal.role ||
		authorization.requestId !== proposal.requestId ||
		authorization.subjectDigest !== proposal.subjectDigest ||
		authorization.snapshotDigest !== proposal.snapshotDigest ||
		authorization.planDigest !== proposal.planDigest
	) {
		fail(
			"PI_WORKFLOW_REVIEW_AUTHORIZATION_MISMATCH",
			"Authorization must bind the actor, role, request, subject, snapshot, and exact canonical plan digest.",
		);
	}
}
function buildProposal(input: {
	mode: ExtraordinaryMode;
	actorId: string;
	role: AuthorizedRole;
	requestId: string;
	snapshot: ReviewSnapshotV1;
	plan: Readonly<Record<string, unknown>>;
}): ExtraordinaryPlanProposal {
	if (
		!nonEmpty(input.actorId) ||
		!validRole(input.role) ||
		!nonEmpty(input.requestId)
	) {
		fail(
			"PI_WORKFLOW_REVIEW_AUTHORIZATION_INVALID",
			"An authorized role, actor, and request ID are required.",
		);
	}
	validateReviewSnapshot(input.snapshot);
	const identity = {
		mode: input.mode,
		actorId: input.actorId,
		role: input.role,
		requestId: input.requestId,
		subjectDigest: input.snapshot.payload.subject.digest,
		snapshotDigest: input.snapshot.digest,
		plan: structuredClone(input.plan),
	};
	return { ...identity, planDigest: digestCanonicalValue(identity) };
}
const severityOrder: Record<ReviewSeverity, number> = {
	critical: 0,
	warning: 1,
};
const lensOrder = new Map(lenses.map((lens, index) => [lens, index]));

export function createReviewRouter(authority?: OrchestratorAuthority) {
	function proposeFull4R(input: {
		capability: OrchestratorAuthorityCapability;
		actorId: string;
		role: AuthorizedRole;
		requestId: string;
		snapshot: ReviewSnapshotV1;
	}): ExtraordinaryPlanProposal {
		requireCapability(authority, input.capability);
		return buildProposal({ ...input, mode: "full-4r", plan: { lenses } });
	}
	function authorize(
		capability: OrchestratorAuthorityCapability,
		proposal: ExtraordinaryPlanProposal,
	): ReviewAuthorizationV1 {
		const trusted = requireCapability(authority, capability);
		const authorization = trusted.authorize(structuredClone(proposal));
		validateReviewAuthorization(authorization, proposal);
		if (!trusted.verify(authorization, proposal)) {
			fail(
				"PI_WORKFLOW_REVIEW_AUTHORIZATION_FORGED",
				"The injected Orchestrator authority rejected the authorization.",
			);
		}
		return structuredClone(authorization);
	}
	function verifyExtraordinary(
		capability: OrchestratorAuthorityCapability,
		proposal: ExtraordinaryPlanProposal,
		authorization: ReviewAuthorizationV1,
	): void {
		const trusted = requireCapability(authority, capability);
		validateReviewAuthorization(authorization, proposal);
		if (!trusted.verify(authorization, proposal)) {
			fail(
				"PI_WORKFLOW_REVIEW_AUTHORIZATION_FORGED",
				"The injected Orchestrator authority rejected the authorization.",
			);
		}
	}
	function plan(context: {
		requestId: string;
		snapshot: ReviewSnapshotV1;
		receipts: readonly ReviewReceiptV1[];
		full4R?: {
			capability: OrchestratorAuthorityCapability;
			proposal: ExtraordinaryPlanProposal;
			authorization: ReviewAuthorizationV1;
		};
	}): ReviewPlan {
		if (!nonEmpty(context.requestId)) {
			fail(
				"PI_WORKFLOW_REVIEW_PLAN_INVALID",
				"A review request ID is required.",
			);
		}
		validateReviewSnapshot(context.snapshot);
		const signals = signalsFrom(context.snapshot.payload.risks);
		const extraordinary = context.full4R;
		if (extraordinary) {
			const exact = proposeFull4R({
				capability: extraordinary.capability,
				actorId: extraordinary.proposal.actorId,
				role: extraordinary.proposal.role,
				requestId: context.requestId,
				snapshot: context.snapshot,
			});
			if (
				digestCanonicalValue(exact) !==
				digestCanonicalValue(extraordinary.proposal)
			) {
				fail(
					"PI_WORKFLOW_REVIEW_AUTHORIZATION_MISMATCH",
					"The Full 4R proposal no longer matches current inputs.",
				);
			}
			verifyExtraordinary(
				extraordinary.capability,
				exact,
				extraordinary.authorization,
			);
		}
		const decision = context.snapshot.payload.risks.some(
			(risk) => risk.kind === "workflow" && risk.severity === "critical",
		)
			? "stop"
			: "proceed";
		const ordered = signals.toSorted(
			(left, right) =>
				severityOrder[left.severity] - severityOrder[right.severity] ||
				(lensOrder.get(left.lens) ?? 99) - (lensOrder.get(right.lens) ?? 99) ||
				left.riskId.localeCompare(right.riskId),
		);
		const ref: ReviewPlanRef = extraordinary
			? {
					mode: "full-4r",
					actorId: extraordinary.proposal.actorId,
					role: extraordinary.proposal.role,
					requestId: context.requestId,
					subjectDigest: context.snapshot.payload.subject.digest,
					snapshotDigest: context.snapshot.digest,
					planDigest: extraordinary.proposal.planDigest,
				}
			: {
					mode: "normal",
					requestId: context.requestId,
					subjectDigest: context.snapshot.payload.subject.digest,
					snapshotDigest: context.snapshot.digest,
					planDigest: digestCanonicalValue({
						mode: "normal",
						requestId: context.requestId,
						subjectDigest: context.snapshot.payload.subject.digest,
						snapshotDigest: context.snapshot.digest,
						selected: ordered[0]?.riskId ?? null,
					}),
				};
		for (const receipt of context.receipts) validateReviewReceipt(receipt, ref);
		if (
			new Set(context.receipts.map((receipt) => receipt.lens)).size !==
				context.receipts.length ||
			(!extraordinary &&
				(context.receipts.length > 1 ||
					context.receipts.some(
						(receipt) => receipt.lens !== ordered[0]?.lens,
					)))
		) {
			fail(
				"PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
				"A receipt must uniquely bind the exact selected lens and canonical plan.",
			);
		}
		if (extraordinary) {
			const covered = new Set(context.receipts.map((receipt) => receipt.lens));
			return {
				mode: "full-4r",
				decision,
				signals,
				ref: ref as ExtraordinaryReviewPlanRef & { mode: "full-4r" },
				launches:
					decision === "proceed"
						? lenses
								.filter((lens) => !covered.has(lens))
								.map((lens) => ({
									kind: "review-lens" as const,
									lens,
									riskId: `full-4r:${lens}`,
									reviewPlanRef: ref,
								}))
						: [],
			};
		}
		const selected =
			decision === "proceed" && context.receipts.length === 0
				? ordered[0]
				: undefined;
		return {
			mode: "normal",
			decision,
			signals,
			ref: ref as NormalReviewPlanRef,
			launches: selected
				? [
						{
							kind: "review-lens",
							lens: selected.lens,
							riskId: selected.riskId,
							reviewPlanRef: ref,
						},
					]
				: [],
		};
	}
	return { plan, proposeFull4R, authorize, verifyExtraordinary };
}
