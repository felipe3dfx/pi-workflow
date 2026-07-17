import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryWorkflow } from "../extensions/delivery-workflow.ts";
import { createDeliveryRuntime } from "../extensions/delivery-runtime.ts";

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
				launches.push(structuredClone(launch));
				const p = provenance[launch.agent];
				if (launch.agent === "sdd-design")
					return {
						provenance: overrides.designProvenance ?? p,
						payload: { summary: "design", affectedPaths: ["extensions/"] },
					};
				if (launch.agent === "sdd-tasks")
					return {
						provenance: overrides.tasksProvenance ?? p,
						payload: { tasks: [{ id: "task-1", behaviorIds: ["behavior-1"] }] },
					};
				if (overrides.onApplyLaunch)
					await overrides.onApplyLaunch({ workflow, launch });
				return {
					provenance: overrides.applyProvenance ?? p,
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

test("thin runtime delegates plan/apply and rejects invented planning references", async () => {
	const { workflow } = setup();
	const registrations = [];
	const runtime = createDeliveryRuntime({ workflow });
	runtime.register({
		registerTool(tool) {
			registrations.push(tool);
		},
	});
	assert.equal(registrations[0].name, runtime.toolName);
	await runtime.execute({ action: "plan", ticketId: "ILA-2316", repository });
	const applied = await runtime.execute({
		action: "apply",
		ticketId: "ILA-2316",
		repository,
	});
	assert.equal(applied.status, "completed");
	const other = createDeliveryRuntime({ workflow: setup().workflow });
	await assert.rejects(
		() => other.execute({ action: "apply", ticketId: "ILA-2316", repository }),
		(error) => error.code === "PI_WORKFLOW_DELIVERY_PLAN_REQUIRED",
	);
});
