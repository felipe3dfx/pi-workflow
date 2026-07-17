import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryReviewWorkflow } from "../extensions/delivery-review-workflow.ts";
import { createDeliveryWorkflow } from "../extensions/delivery-workflow.ts";
import { createDeliveryRuntime } from "../extensions/delivery-runtime.ts";
import { createReviewSnapshot } from "../extensions/review-router.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const provenance = {
	"sdd-design": {
		agent: "sdd-design",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		effort: "high",
		capabilityProfile: "artifact-reader",
	},
	"sdd-tasks": {
		agent: "sdd-tasks",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		capabilityProfile: "artifact-reader",
	},
	"sdd-apply": {
		agent: "sdd-apply",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		capabilityProfile: "code-writer",
	},
	"sdd-verify": {
		agent: "sdd-verify",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		effort: "medium",
		capabilityProfile: "verifier",
	},
	"prepare-commit": {
		agent: "prepare-commit",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		capabilityProfile: "verifier",
	},
};

const context = {
	ticket: {
		id: "ILA-2316",
		revision: "ticket-r1",
		parentId: "ILA-2296",
		state: "In Progress",
		comments: ["ticket context"],
	},
	parent: {
		id: "ILA-2296",
		revision: "parent-r1",
		proposalSpecSatisfied: true,
		comments: ["parent context"],
	},
	blockers: [],
	relations: ["blocks:ILA-2311"],
	capabilities: ["comments", "relations", "blockers"],
	standards: [{ path: "/repo/AGENTS.md", digest: "standard-1" }],
	priorArtifacts: [],
	affectedPaths: ["extensions/"],
};
const repository = {
	branch: "ILA-2316",
	headCommit: "abc",
	treeDigest: "tree-1",
	clean: true,
};

function setup(overrides = {}) {
	const records = new Map();
	const checkpoints = [];
	const launches = [];
	let repo = structuredClone(overrides.repository ?? repository);
	const batches = overrides.batches ?? [
		{
			batchKey: "task-1",
			behaviorIds: ["behavior-1"],
			changedPaths: ["extensions/x.ts"],
			repositoryBefore: repository,
			repositoryAfter: { ...repository, treeDigest: "tree-2" },
			cycles: [
				{
					behaviorId: "behavior-1",
					red: {
						command: "node --test test/x.test.mjs",
						testIds: ["behavior-1"],
						exitCode: 1,
						outputDigest: "red",
					},
					green: {
						command: "node --test test/x.test.mjs",
						testIds: ["behavior-1"],
						exitCode: 0,
						outputDigest: "green",
					},
					refactor: {
						performed: false,
						command: "node --test test/x.test.mjs",
						exitCode: 0,
						outputDigest: "refactor",
						summary: "No refactor needed.",
					},
				},
			],
		},
	];
	const requiredEvidence = overrides.requiredEvidence ?? [
		{ id: "focused", command: "node --test test/delivery-apply-workflow.test.mjs" },
		{ id: "typecheck", command: "npm run check:typecheck" },
	];
	const evidence = overrides.evidence ?? {
		repositoryBefore: { ...repository, treeDigest: "tree-2" },
		repositoryAfter: { ...repository, treeDigest: "tree-2" },
		results: requiredEvidence.map(({ id, command }) => ({
			id,
			command,
			exitCode: 0,
			outputDigest: `${id}-digest`,
		})),
	};
	let workflow;
	workflow = createDeliveryWorkflow({
		context: {
			async read() {
				return structuredClone(overrides.context ?? context);
			},
		},
		repository: {
			async inspect() {
				return structuredClone(repo);
			},
			async verifyCycle(cycle) {
				return (
					cycle.red.exitCode !== 0 &&
					cycle.green.exitCode === 0 &&
					cycle.refactor.exitCode === 0
				);
			},
			async acceptSnapshot(snapshot) {
				repo = structuredClone(snapshot);
			},
			async requiredEvidence() {
				return structuredClone(requiredEvidence);
			},
			async executeEvidence() {
				return structuredClone(evidence);
			},
		},
		artifacts: {
			async write(topic, envelope) {
				const revision = `r${records.size + 1}`;
				const content = structuredClone(envelope);
				records.set(`${topic}:${revision}`, content);
				return {
					topic,
					revision,
					digest: envelope.digest,
					schema: envelope.schema,
					schemaVersion: 1,
				};
			},
			async read(ref) {
				return structuredClone(records.get(`${ref.topic}:${ref.revision}`));
			},
		},
		agents: {
			async launch(launch) {
				const { executeEvidence, ...recordedLaunch } = launch;
				launches.push(structuredClone(recordedLaunch));
				const p = provenance[launch.agent];
				if (launch.agent === "sdd-design")
					return {
						provenance: overrides.designProvenance ?? p,
						payload: { summary: "design", affectedPaths: ["extensions/"] },
						standards: [{ path: "/repo/AGENTS.md", digest: "standard-1", result: "passed" }],
					};
				if (launch.agent === "sdd-tasks")
					return {
						provenance: overrides.tasksProvenance ?? p,
						payload: { tasks: [{ id: "task-1", behaviorIds: ["behavior-1"] }] },
						standards: [{ path: "/repo/AGENTS.md", digest: "standard-1", result: "passed" }],
					};
				if (launch.agent === "sdd-verify")
					return {
						provenance: overrides.verifyProvenance ?? p,
						verified: overrides.verifyPassed ?? true,
						findings: structuredClone(overrides.verifyFindings ?? []),
						standards: [{ path: "/repo/AGENTS.md", digest: "standard-1", result: "passed" }],
						evidence: await executeEvidence(),
					};
				if (launch.agent === "prepare-commit")
					return {
						provenance: overrides.prepareProvenance ?? p,
						status: overrides.prepareStatus ?? "passed",
						code: "passed",
						architecture: "passed",
						tests: "passed",
						standards: [{ path: "/repo/AGENTS.md", digest: "standard-1", result: "passed" }],
						reasons: structuredClone(overrides.prepareReasons ?? []),
					};
				if (overrides.onApplyLaunch)
					await overrides.onApplyLaunch({ workflow, launch });
				return {
					provenance: overrides.applyProvenance ?? p,
					standards: [{ path: "/repo/AGENTS.md", digest: "standard-1", result: "passed" }],
					batches: structuredClone(batches),
					completed: overrides.completed ?? true,
				};
			},
			async cancel(sessionId) {
				launches.push({ agent: "cancel", sessionId });
			},
		},
		checkpoints: {
			async load() {
				return checkpoints.at(-1);
			},
			async save(value) {
				checkpoints.push(structuredClone(value));
			},
		},
		review: overrides.review,
	});
	return {
		workflow,
		launches,
		checkpoints,
		records,
		setRepository(value) {
			repo = structuredClone(value);
		},
	};
}

test("delivery runtime reaches only explicitly authorized extraordinary review", async () => {
	const capability = {};
	const proof = "delivery-review-proof";
	const reviewLaunches = [];
	const authority = {
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
				authorityProof: proof,
			};
			return { ...unsigned, digest: digestCanonicalValue(unsigned) };
		},
		verify(authorization) {
			return authorization.authorityProof === proof;
		},
		adapter: { judge: async () => undefined, fix: async () => undefined, rereview: async () => undefined },
	};
	const review = createDeliveryReviewWorkflow({
		orchestrator: authority,
		launch: async (request) => {
			reviewLaunches.push(request);
			const unsigned = {
				schema: "review-receipt",
				schemaVersion: 1,
				status: "completed",
				planRef: request.reviewPlanRef,
				lens: request.lens,
			};
			return { ...unsigned, digest: digestCanonicalValue(unsigned) };
		},
	});
	const delivery = setup({ review });
	const runtime = createDeliveryRuntime({ workflow: delivery.workflow });
	await runtime.execute({ action: "plan", ticketId: "ILA-2316", repository });
	assert.equal(reviewLaunches.length, 0, "normal delivery must not fan out reviews");
	const snapshot = createReviewSnapshot({
		subject: { kind: "delivery-ticket", id: "ILA-2316", digest: "ticket-digest" },
		manifest: [{ kind: "engram", project: "pi-workflow", topic: "delivery/review", revision: "r1", schema: "review-evidence", schemaVersion: 1, digest: "evidence" }],
		risks: [],
	});
	const proposal = review.proposeFull4R({ capability, actorId: "developer-1", role: "Developer", requestId: "explicit-review", snapshot });
	const input = {
		capability,
		actorId: "developer-1",
		role: "Developer",
		requestId: "explicit-review",
		snapshot,
		proposal,
		authorization: review.authorize(capability, proposal),
		receipts: [],
	};
	const result = await runtime.runExtraordinaryReview({ mode: "full-4r", input });
	assert.equal(result.status, "completed");
	assert.equal(reviewLaunches.length, 4);
	await assert.rejects(
		runtime.runExtraordinaryReview({ mode: "full-4r", input: { ...input, capability: {} } }),
		(error) => error.code === "PI_WORKFLOW_ORCHESTRATOR_AUTHORITY_REQUIRED",
	);
	assert.equal(reviewLaunches.length, 4, "unauthorized review must not fan out");
});

test("plans from complete context and produces compatible read-back verified design/tasks", async () => {
	const { workflow, launches } = setup();
	const result = await workflow.plan({ ticketId: "ILA-2316", repository });
	assert.equal(result.status, "planned");
	assert.equal(result.tasks.binding.designDigest, result.design.digest);
	assert.deepEqual(
		launches.map((launch) => launch.agent),
		["sdd-design", "sdd-tasks"],
	);
	assert.equal(launches[0].context.ticket.comments[0], "ticket context");
	assert.equal(launches[0].context.parent.comments[0], "parent context");
	assert.equal(launches[1].standardRefs[0].digest, "standard-1");
	assert.deepEqual(result.standards, context.standards);
	assert.equal(result.design.binding.standardsDigest, result.tasks.binding.standardsDigest);
});

test("planning fails closed for incomplete context and provenance mismatch", async () => {
	const incomplete = setup({
		context: { ...context, capabilities: ["comments"] },
	});
	await assert.rejects(
		() => incomplete.workflow.plan({ ticketId: "ILA-2316", repository }),
		(error) => error.code === "PI_WORKFLOW_DELIVERY_CONTEXT_INCOMPLETE",
	);
	const badProvenance = setup({
		designProvenance: { ...provenance["sdd-design"], model: "gpt-5.6-terra" },
	});
	await assert.rejects(
		() => badProvenance.workflow.plan({ ticketId: "ILA-2316", repository }),
		(error) => error.code === "PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH",
	);
});

test("applies compatible tasks with strict TDD evidence and least-privilege code-writer", async () => {
	const { workflow, launches } = setup();
	const planned = await workflow.plan({ ticketId: "ILA-2316", repository });
	const result = await workflow.apply({
		ticketId: "ILA-2316",
		planning: planned,
		repository,
	});
	assert.equal(result.status, "completed");
	assert.deepEqual(
		result.verifiedBatches.map((batch) => batch.batchKey),
		["task-1"],
	);
	const launch = launches.at(-1);
	assert.equal(launch.agent, "sdd-apply");
	assert.deepEqual(launch.tools, [
		"read",
		"grep",
		"find",
		"ls",
		"edit",
		"write",
		"bash",
		"workflow_artifact_session",
	]);
	assert.deepEqual(launch.extensions, []);
	assert.deepEqual(launch.skills, []);
	assert.equal(launch.deniedCapabilities.includes("linear"), true);
	assert.equal(launch.deniedCapabilities.includes("fan-out"), true);
	assert.deepEqual(launch.bashPolicy.allowedPrefixes, [
		"git status",
		"git diff",
		"npm test",
		"npm run check",
		"node --test",
		"npx tsc",
	]);
});

test("rejects schema, compatibility, provenance, repository, and TDD evidence mismatches", async () => {
	const pair = setup();
	const planned = await pair.workflow.plan({
		ticketId: "ILA-2316",
		repository,
	});
	await assert.rejects(
		() =>
			pair.workflow.apply({
				ticketId: "ILA-2316",
				planning: { ...planned, tasks: { ...planned.tasks, schemaVersion: 2 } },
				repository,
			}),
		(error) => error.code === "PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
	);
	await assert.rejects(
		() =>
			pair.workflow.apply({
				ticketId: "ILA-2316",
				planning: {
					...planned,
					tasks: {
						...planned.tasks,
						binding: { ...planned.tasks.binding, designDigest: "wrong" },
					},
				},
				repository,
			}),
		(error) => error.code === "PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
	);
	pair.setRepository({ ...repository, treeDigest: "changed" });
	await assert.rejects(
		() =>
			pair.workflow.apply({
				ticketId: "ILA-2316",
				planning: planned,
				repository,
			}),
		(error) => error.code === "PI_WORKFLOW_REPOSITORY_SNAPSHOT_MISMATCH",
	);
	const badProvenance = setup({
		applyProvenance: {
			...provenance["sdd-apply"],
			capabilityProfile: "linear-publisher",
		},
	});
	const badPlan = await badProvenance.workflow.plan({
		ticketId: "ILA-2316",
		repository,
	});
	await assert.rejects(
		() =>
			badProvenance.workflow.apply({
				ticketId: "ILA-2316",
				planning: badPlan,
				repository,
			}),
		(error) => error.code === "PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH",
	);
	const noRed = setup({
		batches: [
			{
				batchKey: "task-1",
				behaviorIds: ["behavior-1"],
				changedPaths: [],
				repositoryBefore: repository,
				repositoryAfter: repository,
				cycles: [
					{
						behaviorId: "behavior-1",
						red: {
							command: "node --test",
							testIds: ["behavior-1"],
							exitCode: 0,
							outputDigest: "red",
						},
						green: {
							command: "node --test",
							testIds: ["behavior-1"],
							exitCode: 0,
							outputDigest: "green",
						},
						refactor: {
							performed: false,
							command: "node --test",
							exitCode: 0,
							outputDigest: "r",
							summary: "none",
						},
					},
				],
			},
		],
	});
	const noRedPlan = await noRed.workflow.plan({
		ticketId: "ILA-2316",
		repository,
	});
	await assert.rejects(
		() =>
			noRed.workflow.apply({
				ticketId: "ILA-2316",
				planning: noRedPlan,
				repository,
			}),
		(error) => error.code === "PI_WORKFLOW_TDD_EVIDENCE_INVALID",
	);
});

test("cancellation retains only verified batches and safe resume is idempotent", async () => {
	const first = setup({ completed: false });
	const planned = await first.workflow.plan({
		ticketId: "ILA-2316",
		repository,
	});
	const interrupted = await first.workflow.apply({
		ticketId: "ILA-2316",
		planning: planned,
		repository,
	});
	assert.equal(interrupted.status, "interrupted");
	assert.deepEqual(
		interrupted.verifiedBatches.map((batch) => batch.batchKey),
		["task-1"],
	);
	const resumed = await first.workflow.apply({
		ticketId: "ILA-2316",
		planning: planned,
		repository: interrupted.repository,
	});
	assert.deepEqual(
		resumed.verifiedBatches.map((batch) => batch.batchKey),
		["task-1"],
	);
	assert.equal(
		new Set(resumed.verifiedBatches.map((batch) => batch.digest)).size,
		1,
	);
});

test("completed output requires full behavior coverage and cancellation discards late output", async () => {
	const empty = setup({ batches: [] });
	const emptyPlan = await empty.workflow.plan({
		ticketId: "ILA-2316",
		repository,
	});
	const incomplete = await empty.workflow.apply({
		ticketId: "ILA-2316",
		planning: emptyPlan,
		repository,
	});
	assert.equal(incomplete.status, "interrupted");

	const cancelled = setup({
		onApplyLaunch: async ({ workflow }) => {
			await workflow.cancel({
				ticketId: "ILA-2316",
				reason: "Developer cancelled.",
			});
		},
	});
	const cancelledPlan = await cancelled.workflow.plan({
		ticketId: "ILA-2316",
		repository,
	});
	const result = await cancelled.workflow.apply({
		ticketId: "ILA-2316",
		planning: cancelledPlan,
		repository,
	});
	assert.equal(result.status, "cancelled");
	assert.deepEqual(result.verifiedBatches, []);
	assert.equal(
		cancelled.launches.some((launch) => launch.agent === "cancel"),
		true,
	);
	assert.equal(
		cancelled.checkpoints.at(-1).cancellationReason,
		"Developer cancelled.",
	);
});

test("prepare stops after an sdd-verify failure and persists auditable verification", async () => {
	const pair = setup({ verifyPassed: false, verifyFindings: ["Focused tests failed."] });
	const planned = await pair.workflow.plan({ ticketId: "ILA-2316", repository });
	const applied = await pair.workflow.apply({
		ticketId: "ILA-2316",
		planning: planned,
		repository,
	});
	const result = await pair.workflow.prepare({
		ticketId: "ILA-2316",
		planning: planned,
		applied,
	});
	assert.equal(result.status, "verification-failed");
	assert.deepEqual(
		pair.launches.slice(-1).map((launch) => launch.agent),
		["sdd-verify"],
	);
	const verifyLaunch = pair.launches.at(-1);
	assert.equal(verifyLaunch.tools.includes("bash"), false);
	assert.equal(verifyLaunch.tools.includes("edit"), false);
	assert.equal(verifyLaunch.tools.includes("write"), false);
	assert.deepEqual(verifyLaunch.extensions, []);
	assert.equal(verifyLaunch.deniedCapabilities.includes("linear"), true);
	assert.equal(verifyLaunch.deniedCapabilities.includes("fan-out"), true);
	assert.equal(
		[...pair.records.values()].some((artifact) => artifact.schema === "sdd-verify"),
		true,
	);
});

test("prepare rejects evidence with mismatched IDs, commands, snapshot, exits, digests, or extras", async () => {
	const mismatches = [
		{ results: [{ id: "wrong", command: "npm run check:typecheck", exitCode: 0, outputDigest: "digest" }] },
		{ results: [{ id: "focused", command: "wrong", exitCode: 0, outputDigest: "digest" }] },
		{ repositoryAfter: { ...repository, treeDigest: "changed" } },
		{ results: [{ id: "focused", command: "node --test test/delivery-apply-workflow.test.mjs", exitCode: 1, outputDigest: "digest" }] },
		{ results: [{ id: "focused", command: "node --test test/delivery-apply-workflow.test.mjs", exitCode: 0, outputDigest: "" }] },
		{ results: [{ id: "focused", command: "node --test test/delivery-apply-workflow.test.mjs", exitCode: 0, outputDigest: "digest" }, { id: "extra", command: "npm test", exitCode: 0, outputDigest: "extra" }] },
	];
	for (const mismatch of mismatches) {
		const requiredEvidence = [{ id: "focused", command: "node --test test/delivery-apply-workflow.test.mjs" }];
		const appliedRepository = { ...repository, treeDigest: "tree-2" };
		const pair = setup({
			requiredEvidence,
			evidence: {
				repositoryBefore: appliedRepository,
				repositoryAfter: appliedRepository,
				results: [{ ...requiredEvidence[0], exitCode: 0, outputDigest: "digest" }],
				...mismatch,
			},
		});
		const planned = await pair.workflow.plan({ ticketId: "ILA-2316", repository });
		const applied = await pair.workflow.apply({ ticketId: "ILA-2316", planning: planned, repository });
		await assert.rejects(
			() => pair.workflow.prepare({ ticketId: "ILA-2316", planning: planned, applied }),
			(error) => error.code === "PI_WORKFLOW_DELIVERY_EVIDENCE_INVALID",
		);
		assert.equal(pair.launches.at(-1).agent, "sdd-verify");
	}
});

test("prepare-commit launches only after verified evidence and persists an auditable refusal", async () => {
	const pair = setup({ prepareStatus: "refused", prepareReasons: ["Architecture boundary is unclear."] });
	const planned = await pair.workflow.plan({ ticketId: "ILA-2316", repository });
	const applied = await pair.workflow.apply({ ticketId: "ILA-2316", planning: planned, repository });
	const result = await pair.workflow.prepare({ ticketId: "ILA-2316", planning: planned, applied });
	assert.equal(result.status, "prepare-refused");
	assert.deepEqual(pair.launches.slice(-2).map((launch) => launch.agent), ["sdd-verify", "prepare-commit"]);
	assert.equal(
		[...pair.records.values()].some((artifact) => artifact.schema === "prepare-commit" && artifact.payload.result.status === "refused"),
		true,
	);
});

test("simplify is offered only on Developer request or a concrete validated clarity finding and is never launched", async () => {
	for (const scenario of [
		{ expected: false },
		{ developerRequestedSimplify: true, expected: true },
		{ verifyFindings: [{ kind: "clarity", validated: true, detail: "Duplicate branch obscures intent." }], expected: true },
		{ verifyFindings: [{ kind: "clarity", validated: false, detail: "Maybe simplify." }], expected: false },
	]) {
		const pair = setup({ verifyFindings: scenario.verifyFindings });
		const planned = await pair.workflow.plan({ ticketId: "ILA-2316", repository });
		const applied = await pair.workflow.apply({ ticketId: "ILA-2316", planning: planned, repository });
		const result = await pair.workflow.prepare({
			ticketId: "ILA-2316",
			planning: planned,
			applied,
			developerRequestedSimplify: scenario.developerRequestedSimplify,
		});
		assert.equal(result.status, "commit-ready");
		assert.equal(result.simplifyOffered, scenario.expected);
		assert.equal(pair.launches.some((launch) => launch.agent === "simplify"), false);
	}
});

test("prepare recovers from completed apply, retries failures/refusals, and returns commit-ready idempotently", async () => {
	const pair = setup();
	const planned = await pair.workflow.plan({ ticketId: "ILA-2316", repository });
	await pair.workflow.apply({ ticketId: "ILA-2316", planning: planned, repository });
	const recovered = await pair.workflow.prepare({ ticketId: "ILA-2316", planning: planned });
	assert.equal(recovered.status, "commit-ready");
	const launchesAfterReady = pair.launches.length;
	const repeated = await pair.workflow.prepare({ ticketId: "ILA-2316", planning: planned });
	assert.deepEqual(repeated, recovered);
	assert.equal(pair.launches.length, launchesAfterReady);
	await assert.rejects(
		() => pair.workflow.prepare({
			ticketId: "ILA-2316",
			planning: { ...planned, standards: [{ path: "/repo/AGENTS.md", digest: "changed" }] },
		}),
		(error) => error.code === "PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
	);

	for (const overrides of [
		{ verifyPassed: false },
		{ prepareStatus: "refused", prepareReasons: ["Retry after refusal."] },
	]) {
		const retry = setup(overrides);
		const retryPlan = await retry.workflow.plan({ ticketId: "ILA-2316", repository });
		const applied = await retry.workflow.apply({ ticketId: "ILA-2316", planning: retryPlan, repository });
		const first = await retry.workflow.prepare({ ticketId: "ILA-2316", planning: retryPlan, applied });
		assert.notEqual(first.status, "commit-ready");
		if (overrides.verifyPassed === false) overrides.verifyPassed = true;
		if (overrides.prepareStatus === "refused") overrides.prepareStatus = "passed";
		const second = await retry.workflow.prepare({ ticketId: "ILA-2316", planning: retryPlan });
		assert.equal(second.status, "commit-ready");
	}
});

test("thin runtime delegates plan/apply and rejects invented planning references", async () => {
	const { workflow } = setup();
	const registrations = [];
	const runtime = createDeliveryRuntime({
		workflow,
		developerRequestedSimplify: (ticketId) => ticketId === "ILA-2316",
	});
	runtime.register({
		registerTool(tool) {
			registrations.push(tool);
		},
	});
	assert.equal(registrations[0].name, runtime.toolName);
	assert.deepEqual(registrations[0].parameters.required, ["action", "ticketId"]);
	assert.deepEqual(registrations[0].parameters.properties.action.enum, [
		"plan",
		"apply",
		"prepare",
		"cancel",
	]);
	await runtime.execute({ action: "plan", ticketId: "ILA-2316", repository });
	const applied = await runtime.execute({
		action: "apply",
		ticketId: "ILA-2316",
		repository,
	});
	assert.equal(applied.status, "completed");
	const prepared = await runtime.execute({
		action: "prepare",
		ticketId: "ILA-2316",
	});
	assert.equal(prepared.status, "commit-ready");
	assert.equal(prepared.simplifyOffered, true);
	assert.equal(
		registrations[0].parameters.properties.developerRequestedSimplify,
		undefined,
	);
	const other = createDeliveryRuntime({ workflow: setup().workflow });
	await assert.rejects(
		() => other.execute({ action: "apply", ticketId: "ILA-2316", repository }),
		(error) => error.code === "PI_WORKFLOW_DELIVERY_PLAN_REQUIRED",
	);
});
