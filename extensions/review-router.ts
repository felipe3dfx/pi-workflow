import {
	digestCanonicalValue,
	type ArtifactSchema,
	type ReviewLens,
	type VerifiedArtifactRef,
	type WorkflowRisk,
} from "./workflow-contracts.ts";

type ReviewSeverity = "warning" | "critical";
type ReviewArtifactRef = VerifiedArtifactRef;

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

export interface ReviewPlanRef {
	requestId: string;
	subjectDigest: string;
	snapshotDigest: string;
	planDigest: string;
}

export interface ReviewReceiptV1 {
	schema: "review-receipt";
	schemaVersion: 1;
	status: "completed" | "blocked";
	planRef: ReviewPlanRef;
	lens: ReviewLens;
	digest: string;
}

export interface ReviewPlan {
	mode: "normal";
	decision: "stop" | "proceed";
	signals: readonly ReviewSignal[];
	ref: ReviewPlanRef;
	launches: readonly {
		intent: "review";
		lens: ReviewLens;
		riskId: string;
		planRef: ReviewPlanRef;
	}[];
}

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
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
	)
		fail(
			"PI_WORKFLOW_REVIEW_SNAPSHOT_INVALID",
			"review-snapshot/v1 requires a verified subject and non-empty artifact manifest.",
		);
	const unsigned = {
		schema: "review-snapshot" as const,
		schemaVersion: 1 as const,
		payload: structuredClone(input),
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function validateSnapshot(snapshot: ReviewSnapshotV1): void {
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
		if (!candidate || typeof candidate !== "object")
			fail(
				"PI_WORKFLOW_REVIEW_RISK_INVALID",
				"Every risk must use the approved discriminated union.",
			);
		const risk = candidate as Partial<WorkflowRisk>;
		if (
			!nonEmpty(risk.id) ||
			ids.has(risk.id) ||
			!nonEmpty(risk.summary) ||
			!(["warning", "critical"] as const).includes(
				risk.severity as ReviewSeverity,
			) ||
			!(["workflow", "review"] as const).includes(
				risk.kind as "workflow" | "review",
			)
		)
			fail(
				"PI_WORKFLOW_REVIEW_RISK_INVALID",
				"Risk IDs must be unique and every risk field must be valid.",
			);
		ids.add(risk.id);
		if (risk.kind === "workflow") {
			if (
				Object.hasOwn(risk, "lens") ||
				(Object.hasOwn(risk, "evidence") && !validArtifactRef(risk.evidence))
			)
				fail(
					"PI_WORKFLOW_REVIEW_RISK_INVALID",
					"Workflow risks may only carry optional verified evidence and cannot select a lens.",
				);
		}
		if (risk.kind === "review") {
			if (
				!lenses.includes(risk.lens as ReviewLens) ||
				!validArtifactRef(risk.evidence)
			)
				fail(
					"PI_WORKFLOW_REVIEW_RISK_INVALID",
					"Review risks require exactly one approved lens and verified evidence.",
				);
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

function validateReceipt(receipt: ReviewReceiptV1): void {
	const { digest, ...unsigned } = receipt;
	if (
		receipt.schema !== "review-receipt" ||
		receipt.schemaVersion !== 1 ||
		!(receipt.status === "completed" || receipt.status === "blocked") ||
		!lenses.includes(receipt.lens) ||
		!nonEmpty(receipt.planRef?.requestId) ||
		!nonEmpty(receipt.planRef?.subjectDigest) ||
		!nonEmpty(receipt.planRef?.snapshotDigest) ||
		!nonEmpty(receipt.planRef?.planDigest) ||
		digest !== digestCanonicalValue(unsigned)
	)
		fail(
			"PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
			"Only valid terminal review receipts can consume review budget.",
		);
}

const severityOrder: Record<ReviewSeverity, number> = {
	critical: 0,
	warning: 1,
};
const lensOrder = new Map(lenses.map((lens, index) => [lens, index]));

export function createReviewRouter() {
	function plan(context: {
		requestId: string;
		snapshot: ReviewSnapshotV1;
		receipts: readonly ReviewReceiptV1[];
	}): ReviewPlan {
		if (!nonEmpty(context.requestId))
			fail(
				"PI_WORKFLOW_REVIEW_PLAN_INVALID",
				"A review request ID is required.",
			);
		validateSnapshot(context.snapshot);
		const signals = signalsFrom(context.snapshot.payload.risks);
		const decision = context.snapshot.payload.risks.some(
			(risk) => risk.kind === "workflow" && risk.severity === "critical",
		)
			? "stop"
			: "proceed";
		for (const receipt of context.receipts) validateReceipt(receipt);
		const ordered = signals.toSorted(
			(left, right) =>
				severityOrder[left.severity] - severityOrder[right.severity] ||
				(lensOrder.get(left.lens) ?? 99) - (lensOrder.get(right.lens) ?? 99) ||
				left.riskId.localeCompare(right.riskId),
		);
		const planIdentity = {
			requestId: context.requestId,
			subjectDigest: context.snapshot.payload.subject.digest,
			snapshotDigest: context.snapshot.digest,
			mode: "normal" as const,
			selected: ordered[0]?.riskId ?? null,
		};
		const ref: ReviewPlanRef = {
			requestId: context.requestId,
			subjectDigest: planIdentity.subjectDigest,
			snapshotDigest: context.snapshot.digest,
			planDigest: digestCanonicalValue(planIdentity),
		};
		const receiptsForSnapshot = context.receipts.filter(
			(receipt) =>
				receipt.planRef.subjectDigest === ref.subjectDigest &&
				receipt.planRef.snapshotDigest === ref.snapshotDigest,
		);
		const selectedSignal = ordered[0];
		if (receiptsForSnapshot.length > 1)
			fail(
				"PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
				"A normal review plan can have at most one terminal receipt.",
			);
		if (
			receiptsForSnapshot.some(
				(receipt) =>
					receipt.planRef.requestId !== ref.requestId ||
					receipt.planRef.planDigest !== ref.planDigest ||
					receipt.lens !== selectedSignal?.lens,
			)
		)
			fail(
				"PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
				"A review receipt must bind the exact canonical plan and selected lens.",
			);
		const selected =
			decision === "proceed" && receiptsForSnapshot.length === 0
				? selectedSignal
				: undefined;
		return {
			mode: "normal",
			decision,
			signals,
			ref,
			launches: selected
				? [
						{
							intent: "review",
							lens: selected.lens,
							riskId: selected.riskId,
							planRef: ref,
						},
					]
				: [],
		};
	}
	return { plan };
}
