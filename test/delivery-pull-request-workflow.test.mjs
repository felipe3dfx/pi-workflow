import assert from "node:assert/strict";
import test from "node:test";

import {
	createDeliveryPullRequestManifestStore,
	createDeliveryPullRequestWorkflow,
	createFakeDeliveryPullRequestGateways,
} from "../extensions/delivery-pull-request-workflow.ts";
import {
	createInMemoryDecisionStore,
	createInteractiveDecisions,
} from "../extensions/interactive-decisions.ts";

const developer = {
	actorId: "developer-1",
	role: "Developer",
	authorityRevision: "developer-r1",
	active: true,
	guest: false,
};

const snapshot = {
	branch: "ILA-2322",
	headCommit: "abc123",
	treeDigest: "tree-1",
	diffDigest: "diff-1",
	clean: true,
};

const ticket = {
	id: "ILA-2322",
	title: "Preparar PR",
	state: "In Progress",
};

function manifestPersistence() {
	const entries = new Map();
	let revision = 0;
	return {
		entries,
		persistence: {
			async read(operationId) {
				return structuredClone(entries.get(operationId));
			},
			async create(value) {
				if (entries.has(value.operationId)) throw new Error("manifest exists");
				const stored = { revision: `r${++revision}`, value: structuredClone(value) };
				entries.set(value.operationId, stored);
				return structuredClone(stored);
			},
			async compareAndSwap(expectedRevision, value) {
				const current = entries.get(value.operationId);
				if (!current || current.revision !== expectedRevision)
					throw new Error("manifest CAS conflict");
				const stored = { revision: `r${++revision}`, value: structuredClone(value) };
				entries.set(value.operationId, stored);
				return structuredClone(stored);
			},
		},
	};
}

function setup(options = {}) {
	const fakes =
		options.fakes ??
		createFakeDeliveryPullRequestGateways({
			repository: snapshot,
			sourceBranch: "main",
		});
	const decisionsStore = options.decisionsStore ?? createInMemoryDecisionStore();
	const manifestBacking = options.manifestBacking ?? manifestPersistence();
	const manifests = createDeliveryPullRequestManifestStore({
		persistence: manifestBacking.persistence,
	});
	const sequence = options.sequence ?? { value: 0 };
	const service = createInteractiveDecisions({
		store: decisionsStore,
		claimSource: { consume: async () => true },
		createExecutionId: () => `execution-${++sequence.value}`,
	});
	const decisions = {
		prepare: (request) => service.prepare(request),
		authorize: (...args) => service.authorize(...args),
		bindExecutionManifest: (...args) => service.bindExecutionManifest(...args),
		authorizeEffect: (...args) => service.authorizeEffect(...args),
		recover: (...args) => service.recover(...args),
		hasActiveDecision: () => false,
	};
	const workflow = createDeliveryPullRequestWorkflow({
		...fakes.gateways,
		git: options.git ?? fakes.gateways.git,
		project: "pi-workflow",
		interactiveDecisions: decisions,
		manifests,
	});
	return {
		decisionsStore,
		fakes,
		manifestBacking,
		manifests,
		sequence,
		workflow,
	};
}

async function review(harness, overrides = {}) {
	const input = { ticket, developer, snapshot, ...overrides };
	const prepared = await harness.workflow.reviewDiff(input);
	assert.equal(prepared.status, "awaiting-review-decision");
	const reviewed = await harness.workflow.reviewDiff({
		...input,
		action: prepared.actions.approve,
	});
	assert.equal(reviewed.status, "awaiting-confirmation");
	return reviewed;
}

test("review approval binds durable shared authority before inspecting Git", async () => {
	const harness = setup();
	const prepared = await harness.workflow.reviewDiff({ ticket, developer, snapshot });

	assert.equal(prepared.status, "awaiting-review-decision");
	assert.deepEqual(
		Object.values(prepared.actions).map(({ id }) => id),
		["delivery.review.approve", "delivery.review.reject", "decision.cancel"],
	);
	assert.deepEqual(harness.fakes.events, []);

	const reviewed = await harness.workflow.reviewDiff({
		ticket,
		developer,
		snapshot,
		action: prepared.actions.approve,
	});
	assert.equal(reviewed.status, "awaiting-confirmation");
	assert.deepEqual(harness.fakes.events, ["git:inspect"]);
	const manifest = await harness.manifests.read(reviewed.operationId);
	assert.equal(manifest.stage, "reviewed");
	assert.equal(manifest.reviewExecution.executionId, "execution-1");
	assert.deepEqual(harness.fakes.publications, []);
});

test("review rejection and cancellation are distinct shared actions with no Git effects", async () => {
	for (const [selection, expected] of [
		["reject", "review-rejected"],
		["cancel", "review-cancelled"],
	]) {
		const harness = setup();
		const prepared = await harness.workflow.reviewDiff({ ticket, developer, snapshot });
		const result = await harness.workflow.reviewDiff({
			ticket,
			developer,
			snapshot,
			action: prepared.actions[selection],
		});
		assert.equal(result.status, expected);
		assert.deepEqual(harness.fakes.events, []);
		assert.deepEqual(harness.fakes.publications, []);
	}
});

test("PR confirmation fences every Git call and publishes the exact durable draft", async () => {
	const harness = setup();
	const reviewed = await review(harness);
	const prepared = await harness.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
	});
	assert.equal(prepared.status, "awaiting-pr-decision");
	assert.deepEqual(
		Object.values(prepared.actions).map(({ id }) => id),
		["delivery.pr.confirm", "delivery.pr.reject", "decision.cancel"],
	);

	const published = await harness.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
		action: prepared.actions.approve,
	});
	assert.deepEqual(published, {
		status: "pr-published",
		pullRequest: { url: "https://github.test/pull/1" },
	});
	assert.deepEqual(harness.fakes.events, [
		"git:inspect",
		"git:inspect",
		"git:find",
		"git:inspect",
		"git:find",
		"git:publish:execution-2",
		"git:find",
	]);
	assert.deepEqual(harness.fakes.publications[0].draft, reviewed.draft);
	const manifest = await harness.manifests.read(reviewed.operationId);
	assert.equal(manifest.stage, "published");
	assert.equal(manifest.publicationExecution.executionId, "execution-2");
});

test("publication rejection and cancellation never inspect or publish", async () => {
	for (const [selection, expected] of [
		["reject", "publication-rejected"],
		["cancel", "confirmation-cancelled"],
	]) {
		const harness = setup();
		const reviewed = await review(harness);
		const prepared = await harness.workflow.confirmPr({
			operationId: reviewed.operationId,
			draft: reviewed.draft,
			developer,
		});
		const eventCount = harness.fakes.events.length;
		const result = await harness.workflow.confirmPr({
			operationId: reviewed.operationId,
			draft: reviewed.draft,
			developer,
			action: prepared.actions[selection],
		});
		assert.equal(result.status, expected);
		assert.equal(harness.fakes.events.length, eventCount);
		assert.deepEqual(harness.fakes.publications, []);
	}
});

test("repository drift immediately before publication closes the lease without publishing", async () => {
	const harness = setup();
	const reviewed = await review(harness);
	const prepared = await harness.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
	});
	harness.fakes.setRepository({ ...snapshot, headCommit: "changed", diffDigest: "diff-2" });

	await assert.rejects(
		() =>
			harness.workflow.confirmPr({
				operationId: reviewed.operationId,
				draft: reviewed.draft,
				developer,
				action: prepared.actions.approve,
			}),
		(error) => error.code === "PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
	);
	assert.deepEqual(harness.fakes.publications, []);
	assert.equal((await harness.manifests.read(reviewed.operationId)).stage, "publication-drifted");
});

test("restart reconciles an uncertain successful publication without replaying it", async () => {
	const base = setup();
	const reviewed = await review(base);
	const prepared = await base.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
	});
	let failAfterPublish = true;
	const uncertainGit = {
		...base.fakes.gateways.git,
		async publish(input) {
			const result = await base.fakes.gateways.git.publish(input);
			if (failAfterPublish) {
				failAfterPublish = false;
				throw new Error("connection lost after publish");
			}
			return result;
		},
	};
	const first = setup({
		fakes: base.fakes,
		git: uncertainGit,
		decisionsStore: base.decisionsStore,
		manifestBacking: base.manifestBacking,
		sequence: base.sequence,
	});
	await assert.rejects(
		() =>
			first.workflow.confirmPr({
				operationId: reviewed.operationId,
				draft: reviewed.draft,
				developer,
				action: prepared.actions.approve,
			}),
		/Publication remains recoverable/,
	);
	assert.equal(base.fakes.publications.length, 1);
	assert.equal((await first.manifests.read(reviewed.operationId)).stage, "publication-uncertain");

	const restarted = setup({
		fakes: base.fakes,
		decisionsStore: base.decisionsStore,
		manifestBacking: base.manifestBacking,
		sequence: base.sequence,
	});
	const recovered = await restarted.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
	});
	assert.deepEqual(recovered, {
		status: "pr-published",
		pullRequest: { url: "https://github.test/pull/1" },
	});
	assert.equal(base.fakes.publications.length, 1);
});

test("changed Developer authority cannot resume an active publication lease", async () => {
	const base = setup();
	const reviewed = await review(base);
	const prepared = await base.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
	});
	const interrupted = setup({
		fakes: base.fakes,
		git: {
			...base.fakes.gateways.git,
			async publish() {
				throw new Error("publication interrupted before mutation");
			},
		},
		decisionsStore: base.decisionsStore,
		manifestBacking: base.manifestBacking,
		sequence: base.sequence,
	});
	await assert.rejects(() =>
		interrupted.workflow.confirmPr({
			operationId: reviewed.operationId,
			draft: reviewed.draft,
			developer,
			action: prepared.actions.approve,
		}),
	);
	assert.equal(
		(await interrupted.manifests.read(reviewed.operationId)).stage,
		"publication-uncertain",
	);
	const restarted = setup({
		fakes: base.fakes,
		decisionsStore: base.decisionsStore,
		manifestBacking: base.manifestBacking,
		sequence: base.sequence,
	});

	await assert.rejects(
		() =>
			restarted.workflow.confirmPr({
				operationId: reviewed.operationId,
				draft: reviewed.draft,
				developer: { ...developer, authorityRevision: "developer-r2" },
			}),
		(error) => error.code === "PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
	);
	assert.deepEqual(base.fakes.publications, []);
});

test("tampered drafts and concurrent confirmations cannot publish twice", async () => {
	const harness = setup();
	const reviewed = await review(harness);
	await assert.rejects(
		() =>
			harness.workflow.confirmPr({
				operationId: reviewed.operationId,
				draft: { ...reviewed.draft, target: "attacker" },
				developer,
			}),
		(error) => error.code === "PI_WORKFLOW_PR_CONFIRMATION_INVALID",
	);
	const prepared = await harness.workflow.confirmPr({
		operationId: reviewed.operationId,
		draft: reviewed.draft,
		developer,
	});
	const outcomes = await Promise.allSettled([
		harness.workflow.confirmPr({
			operationId: reviewed.operationId,
			draft: reviewed.draft,
			developer,
			action: prepared.actions.approve,
		}),
		harness.workflow.confirmPr({
			operationId: reviewed.operationId,
			draft: reviewed.draft,
			developer,
			action: prepared.actions.approve,
		}),
	]);
	assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
	assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
	assert.equal(harness.fakes.publications.length, 1);
});
