import test from "node:test";
import assert from "node:assert/strict";

import {
	createReviewRouter,
	createReviewSnapshot,
} from "../extensions/review-router.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const artifact = (overrides = {}) => ({
	kind: "engram",
	project: "pi-workflow",
	topic: "workflow/deliver-ticket/ILA-2315/verify",
	revision: "revision-1",
	schema: "workflow-progress",
	schemaVersion: 1,
	digest: "artifact-digest",
	...overrides,
});

function reviewRisk(id, severity, lens, overrides = {}) {
	return {
		kind: "review",
		id,
		severity,
		summary: `${lens} concern`,
		lens,
		evidence: artifact({ topic: `evidence/${id}`, digest: `digest-${id}` }),
		...overrides,
	};
}

function context(risks, overrides = {}) {
	const snapshot = createReviewSnapshot({
		subject: {
			kind: "delivery-ticket",
			id: "ILA-2315",
			digest: "subject-digest",
		},
		manifest: [artifact()],
		risks,
	});
	return { requestId: "request-1", snapshot, receipts: [], ...overrides };
}

test("normal planning converts typed review risks one-to-one and ignores workflow risks", () => {
	const risks = [
		{
			kind: "workflow",
			id: "blocked-state",
			severity: "critical",
			summary: "Stop delivery.",
		},
		reviewRisk("readability-1", "warning", "readability"),
	];
	const plan = createReviewRouter().plan(context(risks));
	assert.deepEqual(
		plan.signals.map(({ riskId, lens }) => ({ riskId, lens })),
		[{ riskId: "readability-1", lens: "readability" }],
	);
	assert.equal(plan.decision, "stop");
	assert.equal(plan.launches.length, 0);
});

test("normal planning runs no lens without signals and at most one by approved precedence", () => {
	assert.deepEqual(createReviewRouter().plan(context([])).launches, []);
	const plan = createReviewRouter().plan(
		context([
			reviewRisk("warning-risk", "warning", "risk"),
			reviewRisk("critical-readability", "critical", "readability"),
			reviewRisk("critical-reliability", "critical", "reliability"),
			reviewRisk("critical-resilience", "critical", "resilience"),
			reviewRisk("critical-risk", "critical", "risk"),
		]),
	);
	assert.equal(plan.decision, "proceed");
	assert.equal(plan.launches.length, 1);
	assert.equal(plan.launches[0].riskId, "critical-risk");
	const stable = createReviewRouter().plan(
		context([
			reviewRisk("risk-z", "critical", "risk"),
			reviewRisk("risk-a", "critical", "risk"),
		]),
	);
	assert.equal(stable.launches[0].riskId, "risk-a");
});

test("duplicate risk IDs and malformed review risks fail closed", () => {
	for (const risks of [
		[
			reviewRisk("same", "warning", "risk"),
			reviewRisk("same", "critical", "resilience"),
		],
		[
			reviewRisk("missing-evidence", "warning", "risk", {
				evidence: undefined,
			}),
		],
		[reviewRisk("bad-lens", "warning", "unknown")],
		[
			{
				kind: "workflow",
				id: "hybrid",
				severity: "warning",
				summary: "Hybrid",
				lens: "risk",
			},
		],
	]) {
		assert.throws(
			() => createReviewRouter().plan(context(risks)),
			(error) => error.code === "PI_WORKFLOW_REVIEW_RISK_INVALID",
		);
	}
});

test("verified snapshot manifest and digest are mandatory", () => {
	const valid = context([reviewRisk("risk-1", "warning", "risk")]);
	assert.throws(
		() =>
			createReviewRouter().plan({
				...valid,
				snapshot: { ...valid.snapshot, digest: "tampered" },
			}),
		(error) => error.code === "PI_WORKFLOW_REVIEW_SNAPSHOT_INVALID",
	);
	assert.throws(
		() =>
			createReviewSnapshot({
				subject: {
					kind: "delivery-ticket",
					id: "ILA-2315",
					digest: "subject-digest",
				},
				manifest: [artifact({ revision: "" })],
				risks: [],
			}),
		(error) => error.code === "PI_WORKFLOW_REVIEW_SNAPSHOT_INVALID",
	);
});

test("terminal receipts and digest budget prevent reruns while invalid receipts fail closed", () => {
	const initial = createReviewRouter().plan(
		context([reviewRisk("risk-1", "critical", "risk")]),
	);
	const receipt = {
		schema: "review-receipt",
		schemaVersion: 1,
		status: "completed",
		planRef: initial.ref,
		lens: "risk",
	};
	const unsigned = { ...receipt };
	const signed = { ...receipt, digest: digestCanonicalValue(unsigned) };
	assert.deepEqual(
		createReviewRouter().plan(
			context([reviewRisk("risk-1", "critical", "risk")], {
				receipts: [signed],
			}),
		).launches,
		[],
	);
	const unrelated = {
		...signed,
		planRef: { ...signed.planRef, planDigest: "unrelated-plan" },
	};
	unrelated.digest = digestCanonicalValue({
		schema: unrelated.schema,
		schemaVersion: unrelated.schemaVersion,
		status: unrelated.status,
		planRef: unrelated.planRef,
		lens: unrelated.lens,
	});
	assert.throws(
		() =>
			createReviewRouter().plan(
				context([reviewRisk("risk-1", "critical", "risk")], {
					receipts: [unrelated],
				}),
			),
		(error) => error.code === "PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
	);
	assert.throws(
		() =>
			createReviewRouter().plan(
				context([reviewRisk("risk-1", "critical", "risk")], {
					receipts: [{ ...signed, status: "running" }],
				}),
			),
		(error) => error.code === "PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
	);
	assert.throws(
		() =>
			createReviewRouter().plan(
				context([reviewRisk("risk-1", "critical", "risk")], {
					receipts: [signed, structuredClone(signed)],
				}),
			),
		(error) => error.code === "PI_WORKFLOW_REVIEW_RECEIPT_INVALID",
	);
});

test("planner is deterministic and has no observable side effects", () => {
	const input = context([reviewRisk("risk-1", "warning", "reliability")]);
	const before = structuredClone(input);
	const router = createReviewRouter();
	assert.deepEqual(router.plan(input), router.plan(input));
	assert.deepEqual(input, before);
});
