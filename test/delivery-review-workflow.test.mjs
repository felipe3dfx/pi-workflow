import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryReviewWorkflow } from "../extensions/delivery-review-workflow.ts";
import { createReviewSnapshot } from "../extensions/review-router.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const evidence = {
	kind: "engram",
	project: "pi-workflow",
	topic: "evidence/risk-1",
	revision: "revision-1",
	schema: "review-evidence",
	schemaVersion: 1,
	digest: "evidence-digest",
};
function snapshot(risks = []) {
	return createReviewSnapshot({
		subject: {
			kind: "delivery-ticket",
			id: "ILA-2315",
			digest: "subject-digest",
		},
		manifest: [
			{ ...evidence, topic: "manifest/verify", digest: "verify-digest" },
		],
		risks,
	});
}
function receipt(planRef, lens, status = "completed") {
	const unsigned = {
		schema: "review-receipt",
		schemaVersion: 1,
		status,
		planRef,
		lens,
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}
function judgment(judgeId, runId, findings = []) {
	return {
		judgeId,
		provenance: { provider: "openai", model: `model-${judgeId}`, runId },
		findings,
	};
}
function judgmentSetup({
	adapter: adapterOverrides = {},
	judgeIds = ["judge-a", "judge-b"],
} = {}) {
	const calls = [];
	const capability = {};
	const authorityProof = "opaque-authority-proof";
	const adapter = {
		judge: async (request) => {
			calls.push(["judge", request]);
			return judgment(request.judgeId, `run-${request.judgeId}`, [
				{ id: `f-${request.judgeId}`, summary: "fix", actionable: true },
			]);
		},
		fix: async (request) => {
			calls.push(["fix", request]);
			return { changedPaths: ["extensions/a.ts"] };
		},
		rereview: async (request) => {
			calls.push(["rereview", request]);
			return { status: "completed", scope: request.scope };
		},
		...adapterOverrides,
	};
	const orchestrator = {
		capability,
		authorize(proposal) {
			const unsigned = {
				schema: "review-authorization",
				schemaVersion: 1,
				mode: proposal.mode,
				actorId: proposal.actorId,
				role: proposal.role,
				requestId: proposal.requestId,
				subjectDigest: proposal.subjectDigest,
				snapshotDigest: proposal.snapshotDigest,
				planDigest: proposal.planDigest,
				authorityProof,
			};
			return { ...unsigned, digest: digestCanonicalValue(unsigned) };
		},
		verify(authorization) {
			return authorization.authorityProof === authorityProof;
		},
		adapter,
	};
	const workflow = createDeliveryReviewWorkflow({
		launch: async () => undefined,
		orchestrator,
	});
	const snap = snapshot();
	const proposal = workflow.proposeJudgmentDay({
		capability,
		actorId: "actor-1",
		role: "Owner",
		requestId: "request-1",
		snapshot: snap,
		judgeIds,
	});
	const authorization = workflow.authorize(capability, proposal);
	return {
		calls,
		capability,
		workflow,
		snap,
		proposal,
		input: {
			capability,
			actorId: "actor-1",
			role: "Owner",
			requestId: "request-1",
			snapshot: snap,
			judgeIds,
			proposal,
			authorization,
		},
	};
}

test("normal delivery behavior remains proportional", async () => {
	const launches = [];
	const workflow = createDeliveryReviewWorkflow({
		launch: async (request) => {
			launches.push(request);
			return { status: "completed" };
		},
	});
	const result = await workflow.run({
		requestId: "request-1",
		snapshot: snapshot([
			{
				kind: "review",
				id: "risk-1",
				severity: "critical",
				summary: "Risk",
				lens: "risk",
				evidence,
			},
		]),
		receipts: [],
	});
	assert.equal(launches.length, 1);
	assert.deepEqual(launches[0].reviewPlanRef, result.plan.ref);
	assert.equal(launches[0].kind, "review-lens");
});

test("full 4R requires authority and launches uncovered exact refs", async () => {
	const setup = judgmentSetup();
	const launches = [];
	const authorizedWorkflow = createDeliveryReviewWorkflow({
		launch: async (request) => {
			launches.push(request);
			return receipt(request.reviewPlanRef, request.lens);
		},
		orchestrator: {
			capability: setup.capability,
			authorize: (proposal) =>
				setup.workflow.authorize(setup.capability, proposal),
			verify: (authorization) =>
				authorization.authorityProof === "opaque-authority-proof",
			adapter: {
				judge: async () => undefined,
				fix: async () => undefined,
				rereview: async () => undefined,
			},
		},
	});
	const snap = snapshot();
	const proposal = authorizedWorkflow.proposeFull4R({
		capability: setup.capability,
		actorId: "dev-1",
		role: "Developer",
		requestId: "request-1",
		snapshot: snap,
	});
	const authorization = authorizedWorkflow.authorize(
		setup.capability,
		proposal,
	);
	const initial = await authorizedWorkflow.runFull4R({
		capability: setup.capability,
		actorId: "dev-1",
		role: "Developer",
		requestId: "request-1",
		snapshot: snap,
		proposal,
		authorization,
		receipts: [],
	});
	const planRef = initial.plan.ref;
	launches.length = 0;
	const partial = await authorizedWorkflow.runFull4R({
		capability: setup.capability,
		actorId: "dev-1",
		role: "Developer",
		requestId: "request-1",
		snapshot: snap,
		proposal,
		authorization,
		receipts: [receipt(planRef, "risk")],
	});
	assert.deepEqual(
		launches.map((request) => request.lens),
		["resilience", "reliability", "readability"],
	);
	assert.ok(
		launches.every(
			(request) =>
				digestCanonicalValue(request.reviewPlanRef) ===
				digestCanonicalValue(planRef),
		),
	);
	assert.equal(partial.receipts.length, 4);
});

test("full 4R rejects supplied actor and role drift", async () => {
	const setup = judgmentSetup();
	const fullProposal = setup.workflow.proposeFull4R({
		capability: setup.capability,
		actorId: "actor-1",
		role: "Owner",
		requestId: "request-1",
		snapshot: setup.snap,
	});
	const authorization = setup.workflow.authorize(
		setup.capability,
		fullProposal,
	);
	for (const changed of [{ actorId: "actor-2" }, { role: "Developer" }]) {
		await assert.rejects(
			setup.workflow.runFull4R({
				capability: setup.capability,
				actorId: "actor-1",
				role: "Owner",
				requestId: "request-1",
				snapshot: setup.snap,
				proposal: fullProposal,
				authorization,
				receipts: [],
				...changed,
			}),
			(error) => error.code === "PI_WORKFLOW_REVIEW_ACTOR_ROLE_DRIFT",
		);
	}
});

test("caller-forged capability and authorization are rejected", async () => {
	const setup = judgmentSetup();
	assert.throws(
		() =>
			setup.workflow.proposeJudgmentDay({
				...setup.input,
				capability: {},
			}),
		(error) => error.code === "PI_WORKFLOW_ORCHESTRATOR_AUTHORITY_REQUIRED",
	);
	const unsigned = {
		...setup.input.authorization,
		authorityProof: "caller-forged",
	};
	delete unsigned.digest;
	const forged = { ...unsigned, digest: digestCanonicalValue(unsigned) };
	await assert.rejects(
		setup.workflow.runJudgmentDay({
			...setup.input,
			authorization: forged,
		}),
		(error) => error.code === "PI_WORKFLOW_REVIEW_AUTHORIZATION_FORGED",
	);
});

test("Judgment authorization binds exact execution identity and plan", async () => {
	const setup = judgmentSetup();
	for (const changed of [
		{ actorId: "actor-2" },
		{ role: "Developer" },
		{ requestId: "request-2" },
		{ snapshot: { ...setup.snap, digest: "bad" } },
		{ proposal: { ...setup.proposal, planDigest: "bad" } },
	]) {
		await assert.rejects(
			setup.workflow.runJudgmentDay({ ...setup.input, ...changed }),
			(error) =>
				[
					"PI_WORKFLOW_REVIEW_AUTHORIZATION_MISMATCH",
					"PI_WORKFLOW_REVIEW_SNAPSHOT_INVALID",
				].includes(error.code),
		);
	}
});

test("Judgment Day supports one or two blind independent judges", async () => {
	for (const judgeIds of [["judge-a"], ["judge-a", "judge-b"]]) {
		const setup = judgmentSetup({ judgeIds });
		const result = await setup.workflow.runJudgmentDay(setup.input);
		assert.equal(result.status, "completed");
		const judgeCalls = setup.calls.filter(([kind]) => kind === "judge");
		assert.equal(judgeCalls.length, judgeIds.length);
		assert.ok(judgeCalls.every(([, request]) => !("peerResults" in request)));
	}
	const setup = judgmentSetup();
	assert.throws(
		() =>
			setup.workflow.proposeJudgmentDay({
				...setup.input,
				judgeIds: ["a", "b", "c"],
			}),
		(error) => error.code === "PI_WORKFLOW_JUDGMENT_BUDGET_INVALID",
	);
	assert.throws(
		() =>
			setup.workflow.proposeJudgmentDay({
				...setup.input,
				judgeIds: ["a", "a"],
			}),
		(error) => error.code === "PI_WORKFLOW_JUDGMENT_BUDGET_INVALID",
	);
});

test("extraordinary adapter requests carry exact refs and no recursive escape fields", async () => {
	const setup = judgmentSetup();
	await setup.workflow.runJudgmentDay(setup.input);
	for (const [, request] of setup.calls) {
		assert.equal(
			digestCanonicalValue(request.reviewPlanRef),
			digestCanonicalValue({
				mode: setup.proposal.mode,
				actorId: setup.proposal.actorId,
				role: setup.proposal.role,
				requestId: setup.proposal.requestId,
				subjectDigest: setup.proposal.subjectDigest,
				snapshotDigest: setup.proposal.snapshotDigest,
				planDigest: setup.proposal.planDigest,
			}),
		);
		assert.equal(
			request.authorization.digest,
			setup.input.authorization.digest,
		);
		for (const forbidden of [
			"intent",
			"agent",
			"subagent",
			"piSubagents",
			"recursive",
			"recurse",
		]) {
			assert.equal(Object.hasOwn(request, forbidden), false);
		}
	}
});

test("no actionable findings performs no fix or rereview", async () => {
	const setup = judgmentSetup({
		adapter: {
			judge: async (request) =>
				judgment(request.judgeId, `run-${request.judgeId}`, [
					{ id: "note", summary: "note", actionable: false },
				]),
		},
	});
	const result = await setup.workflow.runJudgmentDay(setup.input);
	assert.equal(result.status, "completed");
	assert.equal(result.fix, null);
	assert.equal(
		setup.calls.some(([kind]) => kind === "fix"),
		false,
	);
});

test("actionable findings allow one fix and one scoped rereview only", async () => {
	const setup = judgmentSetup();
	const result = await setup.workflow.runJudgmentDay(setup.input);
	assert.equal(result.status, "completed");
	assert.equal(setup.calls.filter(([kind]) => kind === "fix").length, 1);
	assert.equal(setup.calls.filter(([kind]) => kind === "rereview").length, 1);
	assert.deepEqual(setup.calls.find(([kind]) => kind === "rereview")[1].scope, [
		"extensions/a.ts",
	]);
});

test("blocking scoped rereview returns terminal blocked requiring human action", async () => {
	const setup = judgmentSetup({
		adapter: {
			rereview: async (request) => {
				setup.calls.push(["rereview", request]);
				return { status: "blocked", scope: request.scope };
			},
		},
	});
	const result = await setup.workflow.runJudgmentDay(setup.input);
	assert.equal(result.status, "blocked");
	assert.equal(result.requiresHumanAction, true);
	assert.equal(setup.calls.filter(([kind]) => kind === "fix").length, 1);
	assert.equal(setup.calls.filter(([kind]) => kind === "rereview").length, 1);
});

test("cancellation after a resolved fix preserves validated mutation evidence", async () => {
	const controller = new AbortController();
	const setup = judgmentSetup({
		adapter: {
			fix: async () => {
				controller.abort();
				return { changedPaths: ["extensions/mutated.ts"] };
			},
		},
	});
	const result = await setup.workflow.runJudgmentDay({
		...setup.input,
		signal: controller.signal,
	});
	assert.equal(result.status, "canceled");
	assert.deepEqual(result.fix, { changedPaths: ["extensions/mutated.ts"] });
});

test("final Full 4R await fails closed on actor drift", async () => {
	const setup = judgmentSetup();
	let execution;
	let launches = 0;
	const workflow = createDeliveryReviewWorkflow({
		launch: async (request) => {
			launches += 1;
			if (launches === 4) execution.actorId = "drifted-actor";
			return receipt(request.reviewPlanRef, request.lens);
		},
		orchestrator: {
			capability: setup.capability,
			authorize: (proposal) => setup.workflow.authorize(setup.capability, proposal),
			verify: (authorization) => authorization.authorityProof === "opaque-authority-proof",
			adapter: { judge: async () => undefined, fix: async () => undefined, rereview: async () => undefined },
		},
	});
	const proposal = workflow.proposeFull4R({
		capability: setup.capability,
		actorId: "actor-1",
		role: "Owner",
		requestId: "request-1",
		snapshot: setup.snap,
	});
	execution = {
		capability: setup.capability,
		actorId: "actor-1",
		role: "Owner",
		requestId: "request-1",
		snapshot: setup.snap,
		proposal,
		authorization: workflow.authorize(setup.capability, proposal),
		receipts: [],
	};
	await assert.rejects(
		workflow.runFull4R(execution),
		(error) => error.code === "PI_WORKFLOW_REVIEW_EXECUTION_DRIFT",
	);
});

test("Judgment Day final awaits fail closed on mutable execution drift", async () => {
	for (const scenario of [
		{
			name: "last judge/no findings request drift",
			overrides(target) {
				return {
					judge: async (request) => {
						if (request.judgeId === "judge-b") target.input.requestId = "request-drift";
						return judgment(request.judgeId, `run-${request.judgeId}`, []);
					},
				};
			},
		},
		{
			name: "fix/no-scope snapshot drift",
			overrides(target) {
				return {
					fix: async () => {
						target.input.snapshot.payload.subject.digest = "snapshot-drift";
						return { changedPaths: [] };
					},
				};
			},
		},
		{
			name: "rereview proposal drift",
			overrides(target) {
				return {
					rereview: async (request) => {
						target.input.proposal.planDigest = "proposal-drift";
						return { status: "completed", scope: request.scope };
					},
				};
			},
		},
	]) {
		const target = {};
		const setup = judgmentSetup({ adapter: scenario.overrides(target) });
		target.input = setup.input;
		await assert.rejects(
			setup.workflow.runJudgmentDay(setup.input),
			(error) => error.code === "PI_WORKFLOW_REVIEW_EXECUTION_DRIFT",
			scenario.name,
		);
	}
});

test("malformed adapter outcomes fail with stable codes", async () => {
	for (const [adapter, code] of [
		[{ judge: async () => ({}) }, "PI_WORKFLOW_JUDGMENT_OUTCOME_INVALID"],
		[
			{ fix: async () => ({ changedPaths: [""] }) },
			"PI_WORKFLOW_FIX_OUTCOME_INVALID",
		],
		[
			{ rereview: async () => ({ status: "running", scope: [] }) },
			"PI_WORKFLOW_REREVIEW_OUTCOME_INVALID",
		],
	]) {
		const setup = judgmentSetup({ adapter });
		await assert.rejects(
			setup.workflow.runJudgmentDay(setup.input),
			(error) => error.code === code,
		);
	}
});

test("cancellation returns only validated terminal full 4R receipts", async () => {
	const setup = judgmentSetup();
	const controller = new AbortController();
	let calls = 0;
	const workflow = createDeliveryReviewWorkflow({
		launch: async (request) => {
			calls += 1;
			controller.abort();
			return receipt(request.reviewPlanRef, request.lens);
		},
		orchestrator: {
			capability: setup.capability,
			authorize: (proposal) =>
				setup.workflow.authorize(setup.capability, proposal),
			verify: (authorization) =>
				authorization.authorityProof === "opaque-authority-proof",
			adapter: {
				judge: async () => undefined,
				fix: async () => undefined,
				rereview: async () => undefined,
			},
		},
	});
	const snap = snapshot();
	const proposal = workflow.proposeFull4R({
		capability: setup.capability,
		actorId: "owner-1",
		role: "Owner",
		requestId: "request-1",
		snapshot: snap,
	});
	const result = await workflow.runFull4R({
		capability: setup.capability,
		actorId: "owner-1",
		role: "Owner",
		requestId: "request-1",
		snapshot: snap,
		proposal,
		authorization: workflow.authorize(setup.capability, proposal),
		receipts: [],
		signal: controller.signal,
	});
	assert.equal(result.status, "canceled");
	assert.equal(calls, 1);
	assert.equal(result.receipts.length, 1);
});
