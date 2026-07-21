import assert from "node:assert/strict";
import test from "node:test";

import {
	createDeliveryReentryWorkflow,
	createFakeDeliveryReentryGateways,
} from "../extensions/delivery-reentry-workflow.ts";

const phases = ["design", "tasks", "apply", "verify", "prepare-commit"];
const ticket = {
	id: "ILA-2318",
	state: "In Progress",
	siblingIds: ["ILA-2317"],
};

function artifact(phase, snapshotDigest = "snapshot-2") {
	return {
		phase,
		revision: `${phase}-r1`,
		digest: `${phase}-digest`,
		snapshotDigest,
		verified: true,
	};
}

function feedback(overrides = {}) {
	return {
		id: "feedback-2",
		issueId: "ILA-2318",
		createdAt: "2026-07-18T10:00:00.000Z",
		kind: "delivery-rework",
		targetPhase: "apply",
		affectedIssueIds: ["ILA-2318"],
		snapshotDigest: "snapshot-2",
		...overrides,
	};
}

function setup(overrides = {}) {
	const fakes = createFakeDeliveryReentryGateways({
		ticket,
		artifacts: phases.map((phase) => artifact(phase)),
		comments: [feedback()],
		reviewedSnapshotDigests: [],
		...overrides,
	});
	return { fakes, workflow: createDeliveryReentryWorkflow(fakes.gateways) };
}

test("structured feedback resumes from each earliest affected phase after loading verified artifacts and current local comments", async () => {
	for (const targetPhase of phases) {
		const { workflow, fakes } = setup({ comments: [feedback({ targetPhase })] });
		const result = await workflow.classify({ ticketId: ticket.id, humanRestart: true });
		assert.equal(result.status, "resume");
		assert.equal(result.phase, targetPhase);
		assert.deepEqual(fakes.events.slice(0, 3), [
			"linear:read-ticket:ILA-2318",
			"engram:read-verified:ILA-2318",
			"linear:read-comments:ILA-2318",
		]);
		assert.equal(fakes.events.at(-1), `review:request:ILA-2318:snapshot-2`);
	}
});

test("free prose never routes reentry", async () => {
	const { workflow } = setup({
		comments: [{ id: "comment-1", issueId: ticket.id, createdAt: "2026-07-18T10:00:00.000Z", kind: "comment", body: "Please redo design" }],
	});
	await assert.rejects(
		() => workflow.classify({ ticketId: ticket.id, humanRestart: true }),
		(error) => error.code === "PI_WORKFLOW_STRUCTURED_FEEDBACK_REQUIRED",
	);
});

test("stale feedback is ignored in favor of the latest feedback bound to the current snapshot", async () => {
	const { workflow } = setup({
		comments: [
			feedback({ id: "stale", createdAt: "2026-07-18T11:00:00.000Z", targetPhase: "design", snapshotDigest: "snapshot-1" }),
			feedback({ id: "current", createdAt: "2026-07-18T10:00:00.000Z", targetPhase: "verify" }),
		],
	});
	const result = await workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(result.phase, "verify");
	assert.equal(result.feedbackId, "current");
});

test("supersedes removes older feedback from classification", async () => {
	const { workflow } = setup({
		comments: [
			feedback({ id: "old", targetPhase: "design", createdAt: "2026-07-18T09:00:00.000Z" }),
			feedback({ id: "new", targetPhase: "tasks", supersedes: "old" }),
		],
	});
	const result = await workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(result.phase, "tasks");
	assert.equal(result.feedbackId, "new");
});

test("multi-issue feedback requires an approved T11 review and leaves sibling descriptions intact", async () => {
	const multiIssue = feedback({ affectedIssueIds: ["ILA-2318", "ILA-2317"], multiIssueReviewId: "review-t11" });
	const descriptions = {
		"ILA-2318": "Current ticket description",
		"ILA-2317": "Sibling description",
	};
	const blocked = setup({ comments: [multiIssue], initialDescriptions: descriptions });
	await assert.rejects(
		() => blocked.workflow.classify({ ticketId: ticket.id, humanRestart: true }),
		(error) => error.code === "PI_WORKFLOW_MULTI_ISSUE_REVIEW_REQUIRED",
	);
	assert.deepEqual(blocked.fakes.descriptionWrites, []);

	const approved = setup({
		comments: [multiIssue],
		approvedMultiIssueReviewIds: ["review-t11"],
		initialDescriptions: descriptions,
	});
	const result = await approved.workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.deepEqual(result.affectedIssueIds, ["ILA-2318", "ILA-2317"]);
	assert.deepEqual(approved.fakes.descriptionWrites, []);
	assert.equal(approved.fakes.description("ILA-2318"), descriptions["ILA-2318"]);
	assert.equal(approved.fakes.description("ILA-2317"), descriptions["ILA-2317"]);
});

test("Canceled and Duplicate block only after loading current evidence", async () => {
	for (const state of ["Canceled", "Duplicate"]) {
		const { workflow, fakes } = setup({ ticket: { ...ticket, state } });
		await assert.rejects(
			() => workflow.classify({ ticketId: ticket.id, humanRestart: true }),
			(error) => error.code === "PI_WORKFLOW_DELIVERY_REENTRY_TERMINAL",
		);
		assert.deepEqual(fakes.events, [
			"linear:read-ticket:ILA-2318",
			"engram:read-verified:ILA-2318",
			"linear:read-comments:ILA-2318",
		]);
	}
});

test("Stop requires an explicit human restart and never transitions Linear automatically", async () => {
	const { workflow, fakes } = setup({ ticket: { ...ticket, state: "Stop" } });
	await assert.rejects(
		() => workflow.classify({ ticketId: ticket.id }),
		(error) => error.code === "PI_WORKFLOW_HUMAN_RESTART_REQUIRED",
	);
	const result = await workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(result.status, "resume");
	assert.deepEqual(fakes.stateWrites, []);
});

test("stale or foreign supersedes markers cannot suppress current local feedback", async () => {
	const { workflow } = setup({
		comments: [
			feedback({ id: "current", targetPhase: "tasks" }),
			feedback({ id: "foreign", issueId: "ILA-9999", supersedes: "current" }),
			feedback({ id: "stale", snapshotDigest: "snapshot-1", supersedes: "current" }),
		],
	});
	const result = await workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(result.feedbackId, "current");
});

test("a new review is requested only when the reentry snapshot changed", async () => {
	const unchanged = setup({ reviewedSnapshotDigests: ["snapshot-2"] });
	const first = await unchanged.workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(first.review, "reused");
	assert.equal(unchanged.fakes.events.some((event) => event.startsWith("review:request")), false);

	const changed = setup({ reviewedSnapshotDigests: ["snapshot-1"] });
	const second = await changed.workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(second.review, "requested");
	assert.equal(changed.fakes.events.at(-1), "review:request:ILA-2318:snapshot-2");
});

test("malformed comment timestamps cannot outrank current structured feedback", async () => {
	const { workflow } = setup({
		comments: [
			feedback({ id: "current", targetPhase: "verify" }),
			feedback({ id: "malformed", createdAt: "not-a-date", targetPhase: "design" }),
		],
	});
	const result = await workflow.classify({ ticketId: ticket.id, humanRestart: true });
	assert.equal(result.feedbackId, "current");
});

test("unverified or cross-snapshot Engram artifacts fail closed", async () => {
	const { workflow } = setup({ artifacts: [artifact("apply"), { ...artifact("verify"), verified: false }] });
	await assert.rejects(
		() => workflow.classify({ ticketId: ticket.id, humanRestart: true }),
		(error) => error.code === "PI_WORKFLOW_REENTRY_ARTIFACT_INVALID",
	);
	const crossSnapshot = setup({
		artifacts: [artifact("apply"), artifact("verify", "snapshot-3")],
	});
	await assert.rejects(
		() => crossSnapshot.workflow.classify({ ticketId: ticket.id, humanRestart: true }),
		(error) => error.code === "PI_WORKFLOW_REENTRY_ARTIFACT_INVALID",
	);
});
