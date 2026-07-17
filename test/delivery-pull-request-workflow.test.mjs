import assert from "node:assert/strict";
import test from "node:test";

import {
	createDeliveryPullRequestWorkflow,
	createFakeDeliveryPullRequestGateways,
} from "../extensions/delivery-pull-request-workflow.ts";

const developer = { actorId: "developer-1", role: "Developer" };

const snapshot = {
	branch: "ILA-2322",
	headCommit: "abc123",
	treeDigest: "tree-1",
	diffDigest: "diff-1",
	clean: true,
};

function setup(overrides = {}) {
	const fakes = createFakeDeliveryPullRequestGateways({
		repository: snapshot,
		sourceBranch: "main",
		...overrides,
	});
	return {
		fakes,
		workflow: createDeliveryPullRequestWorkflow(fakes.gateways),
	};
}

test("review-diff prepares an exact PR draft without publishing it", async () => {
	const { workflow, fakes } = setup();
	const result = await workflow.reviewDiff({
		ticket: { id: "ILA-2322", title: "Revisar el diff y preparar el PR", state: "In Progress" },
		developer,
		snapshot,
		decision: "approved",
	});

	assert.equal(result.status, "awaiting-confirmation");
	assert.deepEqual(result.draft, {
		ticketId: "ILA-2322",
		head: "ILA-2322",
		target: "main",
		title: "ILA-2322 — Revisar el diff y preparar el PR",
		description: [
			"## Ticket",
			"ILA-2322",
			"",
			"## Evidencia revisada",
			"- Commit: abc123",
			"- Digest del árbol: tree-1",
			"- Digest del diff: diff-1",
		].join("\n"),
		link: "https://github.test/compare/main...ILA-2322",
		evidence: { headCommit: "abc123", treeDigest: "tree-1", diffDigest: "diff-1" },
	});
	assert.deepEqual(fakes.publications, []);
});

test("review-diff honors an explicit Developer target override", async () => {
	const { workflow } = setup();
	const result = await workflow.reviewDiff({
		ticket: { id: "ILA-2322", title: "Preparar PR", state: "In Progress" },
		developer,
		snapshot,
		targetBranch: "qa",
		decision: "approved",
	});
	assert.equal(result.draft.target, "qa");
	assert.equal(result.draft.link, "https://github.test/compare/qa...ILA-2322");
});

test("human rejection does not prepare or publish a PR", async () => {
	const { workflow, fakes } = setup();
	const result = await workflow.reviewDiff({
		ticket: { id: "ILA-2322", title: "Preparar PR", state: "In Progress" },
		developer,
		snapshot,
		decision: "rejected",
	});
	assert.deepEqual(result, { status: "review-rejected" });
	assert.deepEqual(fakes.events, []);
	assert.deepEqual(fakes.publications, []);
});

test("confirm-pr refuses publication when the reviewed snapshot changed", async () => {
	const { workflow, fakes } = setup();
	const reviewed = await workflow.reviewDiff({
		ticket: { id: "ILA-2322", title: "Preparar PR", state: "In Progress" },
		developer,
		snapshot,
		decision: "approved",
	});
	fakes.setRepository({ ...snapshot, headCommit: "def456", diffDigest: "diff-2" });

	await assert.rejects(
		() => workflow.confirmPr({ draft: reviewed.draft, developer, decision: "confirmed" }),
		(error) => error.code === "PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
	);
	assert.deepEqual(fakes.publications, []);
});

test("confirm-pr requires explicit confirmation and never changes Linear state", async () => {
	const { workflow, fakes } = setup();
	const ticket = { id: "ILA-2322", title: "Preparar PR", state: "In Progress" };
	const reviewed = await workflow.reviewDiff({
		ticket,
		developer,
		snapshot,
		decision: "approved",
	});
	assert.deepEqual(
		await workflow.confirmPr({ draft: reviewed.draft, developer, decision: "rejected" }),
		{ status: "confirmation-rejected" },
	);
	assert.deepEqual(fakes.publications, []);

	const published = await workflow.confirmPr({
		draft: reviewed.draft,
		developer,
		decision: "confirmed",
	});
	assert.equal(published.status, "pr-published");
	assert.equal(published.pullRequest.url, "https://github.test/pull/1");
	assert.equal(fakes.publications.length, 1);
	assert.equal(ticket.state, "In Progress");
});

test("both human gates reject missing decisions without side effects", async () => {
	const { workflow, fakes } = setup();
	const input = {
		ticket: { id: "ILA-2322", title: "Preparar PR", state: "In Progress" },
		developer,
		snapshot,
	};
	await assert.rejects(
		() => workflow.reviewDiff(input),
		(error) => error.code === "PI_WORKFLOW_REVIEW_DIFF_DECISION_REQUIRED",
	);
	assert.deepEqual(fakes.publications, []);

	const reviewed = await workflow.reviewDiff({ ...input, decision: "approved" });
	await assert.rejects(
		() => workflow.confirmPr({ draft: reviewed.draft, developer }),
		(error) => error.code === "PI_WORKFLOW_PR_CONFIRMATION_REQUIRED",
	);
	assert.deepEqual(fakes.publications, []);
});

test("awaited gateway calls cannot change the reviewed or published inputs", async () => {
	const { workflow, fakes } = setup();
	const ticket = { id: "ILA-2322", title: "Preparar PR", state: "In Progress" };
	const review = workflow.reviewDiff({ ticket, developer, snapshot, decision: "approved" });
	ticket.id = "ILA-9999";
	const reviewed = await review;
	assert.equal(reviewed.draft.ticketId, "ILA-2322");

	const confirmation = workflow.confirmPr({
		draft: reviewed.draft,
		developer,
		decision: "confirmed",
	});
	reviewed.draft.target = "attacker-target";
	await confirmation;
	assert.equal(fakes.publications[0].target, "main");
});

test("an approved draft can be published at most once", async () => {
	const { workflow, fakes } = setup();
	const reviewed = await workflow.reviewDiff({
		ticket: { id: "ILA-2322", title: "Preparar PR", state: "In Progress" },
		developer,
		snapshot,
		decision: "approved",
	});
	const outcomes = await Promise.allSettled([
		workflow.confirmPr({ draft: reviewed.draft, developer, decision: "confirmed" }),
		workflow.confirmPr({ draft: reviewed.draft, developer, decision: "confirmed" }),
	]);
	assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
	assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
	assert.equal(fakes.publications.length, 1);
});
