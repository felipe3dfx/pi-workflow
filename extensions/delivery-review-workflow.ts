import {
	createReviewRouter,
	validateReviewAuthorization,
	validateReviewReceipt,
	type AuthorizedRole,
	type ExtraordinaryPlanProposal,
	type ExtraordinaryReviewPlanRef,
	type OrchestratorAuthority,
	type OrchestratorAuthorityCapability,
	type ReviewAuthorizationV1,
	type ReviewPlanRef,
	type ReviewReceiptV1,
	type ReviewSnapshotV1,
} from "./review-router.ts";
import { digestCanonicalValue } from "./workflow-contracts.ts";

export interface DeliveryReviewLaunch {
	kind: "review-lens";
	lens: "risk" | "resilience" | "reliability" | "readability";
	riskId: string;
	reviewPlanRef: ReviewPlanRef;
	signal?: AbortSignal;
}
interface JudgmentFinding {
	id: string;
	summary: string;
	actionable: boolean;
}
export interface JudgmentResult {
	judgeId: string;
	provenance: { provider: string; model: string; runId: string };
	findings: readonly JudgmentFinding[];
}
export interface FixResult {
	changedPaths: readonly string[];
}
export interface RereviewResult {
	status: "completed" | "blocked";
	scope: readonly string[];
}
interface ExtraordinaryRequestBase {
	actorId: string;
	role: AuthorizedRole;
	reviewPlanRef: ExtraordinaryReviewPlanRef;
	authorization: ReviewAuthorizationV1;
	signal?: AbortSignal;
}
interface JudgmentLaunchRequest extends ExtraordinaryRequestBase {
	kind: "judgment-day-judge";
	judgeId: string;
}
interface FixLaunchRequest extends ExtraordinaryRequestBase {
	kind: "judgment-day-fix";
	findings: readonly JudgmentFinding[];
}
interface ScopedRereviewLaunchRequest extends ExtraordinaryRequestBase {
	kind: "judgment-day-scoped-rereview";
	scope: readonly string[];
}
interface OrchestratorAdapter {
	judge(request: JudgmentLaunchRequest): Promise<unknown>;
	fix(request: FixLaunchRequest): Promise<unknown>;
	rereview(request: ScopedRereviewLaunchRequest): Promise<unknown>;
}
export interface OrchestratorBundle extends OrchestratorAuthority {
	adapter: OrchestratorAdapter;
}

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}
function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
function canceled(signal?: AbortSignal): boolean {
	return signal?.aborted === true;
}
function isAbort(error: unknown, signal?: AbortSignal): boolean {
	return (
		canceled(signal) || (error instanceof Error && error.name === "AbortError")
	);
}
function validateJudgment(value: unknown, judgeId: string): JudgmentResult {
	const result = value as Partial<JudgmentResult>;
	if (
		!result ||
		result.judgeId !== judgeId ||
		!result.provenance ||
		![
			result.provenance.provider,
			result.provenance.model,
			result.provenance.runId,
		].every(nonEmpty) ||
		!Array.isArray(result.findings) ||
		result.findings.some(
			(finding) =>
				!finding ||
				!nonEmpty(finding.id) ||
				!nonEmpty(finding.summary) ||
				typeof finding.actionable !== "boolean",
		) ||
		new Set(result.findings.map((finding) => finding.id)).size !==
			result.findings.length
	) {
		fail(
			"PI_WORKFLOW_JUDGMENT_OUTCOME_INVALID",
			"A judge returned a malformed or wrongly attributed outcome.",
		);
	}
	return structuredClone(result as JudgmentResult);
}
function validateFix(value: unknown): FixResult {
	const result = value as Partial<FixResult>;
	if (
		!result ||
		!Array.isArray(result.changedPaths) ||
		result.changedPaths.some((path) => !nonEmpty(path)) ||
		new Set(result.changedPaths).size !== result.changedPaths.length
	) {
		fail(
			"PI_WORKFLOW_FIX_OUTCOME_INVALID",
			"The fix adapter returned an invalid changed-path set.",
		);
	}
	return structuredClone(result as FixResult);
}
function validateRereview(
	value: unknown,
	scope: readonly string[],
): RereviewResult {
	const result = value as Partial<RereviewResult>;
	if (
		!result ||
		!["completed", "blocked"].includes(result.status as string) ||
		!Array.isArray(result.scope) ||
		digestCanonicalValue(result.scope) !== digestCanonicalValue(scope)
	) {
		fail(
			"PI_WORKFLOW_REREVIEW_OUTCOME_INVALID",
			"The scoped re-review returned an invalid terminal outcome.",
		);
	}
	return structuredClone(result as RereviewResult);
}
function extraordinaryRef(
	proposal: ExtraordinaryPlanProposal,
): ExtraordinaryReviewPlanRef {
	return {
		mode: proposal.mode,
		actorId: proposal.actorId,
		role: proposal.role,
		requestId: proposal.requestId,
		subjectDigest: proposal.subjectDigest,
		snapshotDigest: proposal.snapshotDigest,
		planDigest: proposal.planDigest,
	};
}

export interface Full4RExecutionInput {
	capability: OrchestratorAuthorityCapability;
	actorId: string;
	role: AuthorizedRole;
	requestId: string;
	snapshot: ReviewSnapshotV1;
	proposal: ExtraordinaryPlanProposal;
	authorization: ReviewAuthorizationV1;
	receipts: readonly ReviewReceiptV1[];
	signal?: AbortSignal;
}

export interface JudgmentDayExecutionInput {
	capability: OrchestratorAuthorityCapability;
	actorId: string;
	role: AuthorizedRole;
	requestId: string;
	snapshot: ReviewSnapshotV1;
	judgeIds: readonly string[];
	proposal: ExtraordinaryPlanProposal;
	authorization: ReviewAuthorizationV1;
	signal?: AbortSignal;
}

function executionDigest(
	input: Omit<JudgmentDayExecutionInput, "signal" | "capability"> | Omit<Full4RExecutionInput, "signal" | "capability">,
): string {
	return digestCanonicalValue(input);
}

export function createDeliveryReviewWorkflow(dependencies: {
	launch(request: DeliveryReviewLaunch): Promise<unknown>;
	orchestrator?: OrchestratorBundle;
}) {
	const router = createReviewRouter(dependencies.orchestrator);
	async function run(input: {
		requestId: string;
		snapshot: ReviewSnapshotV1;
		receipts: readonly ReviewReceiptV1[];
	}) {
		const plan = router.plan(input);
		const outcomes: unknown[] = [];
		for (const launch of plan.launches) {
			outcomes.push(await dependencies.launch(launch));
		}
		return { plan, outcomes };
	}
	function proposeFull4R(input: {
		capability: OrchestratorAuthorityCapability;
		actorId: string;
		role: AuthorizedRole;
		requestId: string;
		snapshot: ReviewSnapshotV1;
	}) {
		return router.proposeFull4R(input);
	}
	function authorize(
		capability: OrchestratorAuthorityCapability,
		proposal: ExtraordinaryPlanProposal,
	): ReviewAuthorizationV1 {
		return router.authorize(capability, proposal);
	}
	function proposeJudgmentDay(input: {
		capability: OrchestratorAuthorityCapability;
		actorId: string;
		role: AuthorizedRole;
		requestId: string;
		snapshot: ReviewSnapshotV1;
		judgeIds: readonly string[];
	}): ExtraordinaryPlanProposal {
		if (
			input.judgeIds.length < 1 ||
			input.judgeIds.length > 2 ||
			new Set(input.judgeIds).size !== input.judgeIds.length ||
			input.judgeIds.some((id) => !nonEmpty(id))
		) {
			fail(
				"PI_WORKFLOW_JUDGMENT_BUDGET_INVALID",
				"Judgment Day requires one or two distinct blind judges.",
			);
		}
		const base = router.proposeFull4R(input);
		const identity = {
			mode: "judgment-day" as const,
			actorId: input.actorId,
			role: input.role,
			requestId: input.requestId,
			subjectDigest: base.subjectDigest,
			snapshotDigest: base.snapshotDigest,
			plan: {
				judgeIds: [...input.judgeIds],
				budget: {
					judges: input.judgeIds.length,
					fixPasses: 1,
					scopedRereviews: 1,
				},
			},
		};
		return { ...identity, planDigest: digestCanonicalValue(identity) };
	}
	function exactJudgment(input: {
		capability: OrchestratorAuthorityCapability;
		actorId: string;
		role: AuthorizedRole;
		requestId: string;
		snapshot: ReviewSnapshotV1;
		judgeIds: readonly string[];
		proposal: ExtraordinaryPlanProposal;
		authorization: ReviewAuthorizationV1;
	}) {
		const exact = proposeJudgmentDay(input);
		if (digestCanonicalValue(exact) !== digestCanonicalValue(input.proposal)) {
			fail(
				"PI_WORKFLOW_REVIEW_AUTHORIZATION_MISMATCH",
				"Judgment Day inputs no longer match the authorized plan.",
			);
		}
		validateReviewAuthorization(input.authorization, exact);
		router.verifyExtraordinary(input.capability, exact, input.authorization);
		return exact;
	}
	async function runFull4R(input: Full4RExecutionInput) {
		const canonicalExecution = executionDigest({
			actorId: input.actorId,
			role: input.role,
			requestId: input.requestId,
			snapshot: input.snapshot,
			proposal: input.proposal,
			authorization: input.authorization,
			receipts: input.receipts,
		});
		const revalidate = () => {
			if (
				executionDigest({
					actorId: input.actorId,
					role: input.role,
					requestId: input.requestId,
					snapshot: input.snapshot,
					proposal: input.proposal,
					authorization: input.authorization,
					receipts: input.receipts,
				}) !== canonicalExecution
			) {
				fail(
					"PI_WORKFLOW_REVIEW_EXECUTION_DRIFT",
					"Full 4R execution inputs changed during an extraordinary operation.",
				);
			}
			router.verifyExtraordinary(
				input.capability,
				structuredClone(input.proposal),
				structuredClone(input.authorization),
			);
		};
		if (
			input.actorId !== input.proposal.actorId ||
			input.role !== input.proposal.role ||
			input.actorId !== input.authorization.actorId ||
			input.role !== input.authorization.role
		) {
			fail(
				"PI_WORKFLOW_REVIEW_ACTOR_ROLE_DRIFT",
				"Full 4R execution actor and role must match the proposal and authorization.",
			);
		}
		const full4R = {
			capability: input.capability,
			proposal: input.proposal,
			authorization: input.authorization,
		};
		let plan = router.plan({
			requestId: input.requestId,
			snapshot: input.snapshot,
			receipts: input.receipts,
			full4R,
		});
		const receipts = [...input.receipts];
		if (canceled(input.signal)) {
			return {
				status: "canceled" as const,
				plan,
				receipts: structuredClone(receipts),
			};
		}
		for (const launch of plan.launches) {
			plan = router.plan({
				requestId: input.requestId,
				snapshot: input.snapshot,
				receipts,
				full4R,
			});
			if (canceled(input.signal)) {
				return {
					status: "canceled" as const,
					plan,
					receipts: structuredClone(receipts),
				};
			}
			const current = plan.launches.find((item) => item.lens === launch.lens);
			if (!current) continue;
			try {
				const outcome = await dependencies.launch({
					...current,
					signal: input.signal,
				});
				revalidate();
				validateReviewReceipt(
					outcome as ReviewReceiptV1,
					current.reviewPlanRef,
				);
				receipts.push(structuredClone(outcome as ReviewReceiptV1));
			} catch (error) {
				if (isAbort(error, input.signal)) {
					return {
						status: "canceled" as const,
						plan,
						receipts: structuredClone(receipts),
					};
				}
				throw error;
			}
		}
		revalidate();
		return { status: "completed" as const, plan, receipts };
	}
	async function runJudgmentDay(input: JudgmentDayExecutionInput) {
		const canonicalExecution = executionDigest({
			actorId: input.actorId,
			role: input.role,
			requestId: input.requestId,
			snapshot: input.snapshot,
			judgeIds: input.judgeIds,
			proposal: input.proposal,
			authorization: input.authorization,
		});
		const bundle = dependencies.orchestrator;
		if (!bundle) {
			fail(
				"PI_WORKFLOW_ORCHESTRATOR_AUTHORITY_REQUIRED",
				"Judgment Day requires the injected Orchestrator authority.",
			);
		}
		const revalidate = () => {
			if (
				executionDigest({
					actorId: input.actorId,
					role: input.role,
					requestId: input.requestId,
					snapshot: input.snapshot,
					judgeIds: input.judgeIds,
					proposal: input.proposal,
					authorization: input.authorization,
				}) !== canonicalExecution
			) {
				fail(
					"PI_WORKFLOW_REVIEW_EXECUTION_DRIFT",
					"Judgment Day execution inputs changed during an extraordinary operation.",
				);
			}
			return exactJudgment(input);
		};
		let exact = revalidate();
		if (canceled(input.signal)) {
			return { status: "canceled" as const, judgments: [] as JudgmentResult[] };
		}
		const judgments: JudgmentResult[] = [];
		for (const judgeId of input.judgeIds) {
			exact = exactJudgment(input);
			if (canceled(input.signal)) {
				return { status: "canceled" as const, judgments };
			}
			const reviewPlanRef = extraordinaryRef(exact);
			try {
				const outcome = await bundle.adapter.judge({
					kind: "judgment-day-judge",
					judgeId,
					actorId: input.actorId,
					role: input.role,
					reviewPlanRef,
					authorization: structuredClone(input.authorization),
					signal: input.signal,
				});
				exact = revalidate();
				judgments.push(validateJudgment(outcome, judgeId));
			} catch (error) {
				if (isAbort(error, input.signal)) {
					return { status: "canceled" as const, judgments };
				}
				throw error;
			}
		}
		if (
			new Set(judgments.map((judgment) => judgment.judgeId)).size !==
				judgments.length ||
			new Set(
				judgments.map((judgment) => digestCanonicalValue(judgment.provenance)),
			).size !== judgments.length
		) {
			fail(
				"PI_WORKFLOW_JUDGMENT_INDEPENDENCE_INVALID",
				"Judges must have distinct identities and provenance.",
			);
		}
		const findings = judgments
			.flatMap((judgment) => judgment.findings)
			.filter((finding) => finding.actionable);
		if (findings.length === 0) {
			revalidate();
			return {
				status: "completed" as const,
				judgments,
				fix: null,
				rereview: null,
			};
		}
		exact = exactJudgment(input);
		if (canceled(input.signal)) {
			return { status: "canceled" as const, judgments };
		}
		const reviewPlanRef = extraordinaryRef(exact);
		let fix: FixResult;
		try {
			const outcome = await bundle.adapter.fix({
				kind: "judgment-day-fix",
				actorId: input.actorId,
				role: input.role,
				reviewPlanRef,
				authorization: structuredClone(input.authorization),
				findings,
				signal: input.signal,
			});
			exact = revalidate();
			fix = validateFix(outcome);
		} catch (error) {
			if (isAbort(error, input.signal)) {
				return { status: "canceled" as const, judgments };
			}
			throw error;
		}
		if (canceled(input.signal)) {
			return { status: "canceled" as const, judgments, fix };
		}
		if (fix.changedPaths.length === 0) {
			revalidate();
			return {
				status: "completed" as const,
				judgments,
				fix,
				rereview: null,
			};
		}
		exact = exactJudgment(input);
		if (canceled(input.signal)) {
			return { status: "canceled" as const, judgments };
		}
		const scope = [...fix.changedPaths].toSorted();
		let rereview: RereviewResult;
		try {
			const outcome = await bundle.adapter.rereview({
				kind: "judgment-day-scoped-rereview",
				actorId: input.actorId,
				role: input.role,
				reviewPlanRef: extraordinaryRef(exact),
				authorization: structuredClone(input.authorization),
				scope,
				signal: input.signal,
			});
			revalidate();
			rereview = validateRereview(outcome, scope);
		} catch (error) {
			if (isAbort(error, input.signal)) {
				return { status: "canceled" as const, judgments };
			}
			throw error;
		}
		revalidate();
		return rereview.status === "blocked"
			? {
					status: "blocked" as const,
					requiresHumanAction: true as const,
					reason: "blocking-rereview" as const,
					judgments,
					fix,
					rereview,
				}
			: { status: "completed" as const, judgments, fix, rereview };
	}
	return {
		run,
		proposeFull4R,
		proposeJudgmentDay,
		authorize,
		runFull4R,
		runJudgmentDay,
	};
}
