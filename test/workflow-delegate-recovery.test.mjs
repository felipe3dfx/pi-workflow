import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createWorkflowDelegate } from "../extensions/workflow-delegate.ts";
import { createInMemoryDelegationCheckpointStore } from "../extensions/delegation-checkpoints.ts";

const researchRef = {
	kind: "engram",
	project: "pi-workflow",
	topic: "workflow/research",
	revision: "research-r1",
	schema: "research-evidence",
	schemaVersion: 1,
	digest: "research-digest",
};

function explorationRef(kind, revision = "exploration-r1") {
	return {
		kind: "engram",
		project: "pi-workflow",
		topic: `workflow/define-product/definition-1/${kind}/request-1`,
		revision,
		schema: "design-exploration",
		schemaVersion: 1,
		digest: `${kind}-digest-${revision}`,
	};
}

function intent(kind, overrides = {}) {
	return {
		kind,
		requestId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		focus: "Compare an onboarding direction",
		domainAnchorDigest: "anchor-digest",
		project: { name: "pi-workflow", root: "/repo" },
		targetTopic: `workflow/define-product/definition-1/${kind}/request-1`,
		requiredSkills: [{ name: kind === "prototype" ? "prototype" : "codebase-design" }],
		affectedPaths: ["src/known.ts"],
		readableArtifacts: [{ alias: "research", ref: researchRef }],
		...overrides,
	};
}

function completed(launch, artifact, metadata = {}) {
	return {
		ok: true,
		value: {
			status: "completed",
			executiveSummary: "Comparable exploration artifact ready.",
			artifacts: [artifact],
			nextRecommended: {
				kind: "compare-exploration",
				intent: launch.intent.kind,
			},
			risks: [],
			launchProvenance: launch.launchProvenance,
		},
		sessionId: "session-1",
		...metadata,
	};
}

function dependencies(overrides = {}) {
	const launches = [];
	const resolvedPaths = [];
	const interventions = [];
	const checkpointStore =
		overrides.checkpointStore ?? createInMemoryDelegationCheckpointStore();
	const deps = {
		skillResolver: {
			resolve: async (requirements) => ({
				ok: true,
				value: requirements.map(({ name }) => ({
					kind: "skill",
					name,
					path: `/skills/${name}/SKILL.md`,
					digest: `${name}-digest`,
				})),
			}),
		},
		standardsResolver: {
			resolve: async ({ affectedPaths }) => {
				resolvedPaths.push([...affectedPaths]);
				return {
					ok: true,
					value: {
						standardRefs: [{
							kind: "standard",
							name: "AGENTS",
							path: "/repo/AGENTS.md",
							digest: `standards-${affectedPaths.join("+")}`,
						}],
						requiredSkills: [],
					},
				};
			},
		},
		agentValidator: {
			validateExplorationLaunch: async () => ({
				ok: true,
				value: {
					assetVersion: 1,
					assetDigest: "prototype-asset-digest",
					allowedTools: ["read", "write"],
					deniedCapabilities: ["linear", "fan-out", "private-namespace"],
				},
			}),
		},
		artifactInterface: {
			openSession: (grant) => ({
				read: async () => ({ revision: researchRef.revision, content: "research" }),
				readCurrent: async () => undefined,
				writeSnapshot: async () => explorationRef(grant.topic.split("/").at(-2)),
				mergeProgress: async () => explorationRef(grant.topic.split("/").at(-2)),
				verifyDiscoveredPaths: async (paths) => paths,
				hasVerifiedArtifact: (artifact) =>
					artifact.topic === grant.topic && artifact.schema === grant.schema,
			}),
		},
		subagentLauncher: {
			launch: async (launch, options) => {
				launches.push({ launch, options });
				return completed(launch, explorationRef(launch.intent.kind));
			},
			intervene: async (sessionId, intervention) => {
				interventions.push({ sessionId, intervention });
			},
		},
		checkpointStore,
		now: () => 1_000,
		...overrides,
	};
	return { deps, launches, resolvedPaths, interventions, checkpointStore };
}

test("workflow delegate returns comparable artifacts for prototype and design-alternative", async () => {
	for (const kind of ["prototype", "design-alternative"]) {
		const fixture = dependencies();
		const result = await createWorkflowDelegate(fixture.deps).delegate(intent(kind));
		assert.equal(result.status, "completed");
		assert.equal(result.artifacts[0].schema, "design-exploration");
		assert.equal(result.nextRecommended.kind, "compare-exploration");
		assert.equal(fixture.launches.length, 1);
		const prepared = fixture.launches[0].launch;
		assert.equal(prepared.launchProvenance.agentName, "prototype");
		assert.equal(prepared.launchProvenance.capabilityProfile, "isolated-prototype");
		assert.deepEqual(prepared.artifactGrant.aliases, [
			{ alias: "research", ref: researchRef },
		]);
		assert.equal(prepared.artifactGrant.topic, intent(kind).targetTopic);
		assert.equal("checkpointStore" in prepared, false);
	}
});

test("workflow delegate resumes from a durable private checkpoint after delegate recreation", async () => {
	const checkpointModule = await import("../extensions/delegation-checkpoints.ts");
	const files = new Map();
	const persistence = {
		async readFile(path) {
			return files.get(path);
		},
		async withMutation(_operationId, run) {
			return run();
		},
		async writeFileAtomic(path, content, expectedDigest) {
			const current = files.get(path);
			const currentDigest =
				current === undefined
					? null
					: createHash("sha256").update(current).digest("hex");
			if (currentDigest !== expectedDigest) throw new Error("stale durable write");
			files.set(path, content);
		},
	};
	const firstStore = checkpointModule.createDurableDelegationCheckpointStore({
		directory: "/private/checkpoints",
		persistence,
	});
	const first = dependencies({ checkpointStore: firstStore });
	first.deps.subagentLauncher.launch = async (launch, options) => {
		first.launches.push({ launch, options });
		return {
			ok: false,
			interrupted: true,
			sessionId: "durable-session",
			verifiedArtifacts: [explorationRef("prototype", "durable-progress-r1")],
			blocker: {
				code: "PI_WORKFLOW_DELEGATION_INTERRUPTED",
				message: "interrupted",
			},
		};
	};
	const interrupted = await createWorkflowDelegate(first.deps).delegate(
		intent("prototype"),
	);
	assert.equal(interrupted.blocker.code, "PI_WORKFLOW_DELEGATION_INTERRUPTED");

	const secondStore = checkpointModule.createDurableDelegationCheckpointStore({
		directory: "/private/checkpoints",
		persistence,
	});
	const second = dependencies({ checkpointStore: secondStore });
	const completedResult = await createWorkflowDelegate(second.deps).delegate(
		intent("prototype"),
	);
	assert.equal(completedResult.status, "completed");
	assert.equal(second.launches[0].options.resumeSessionId, "durable-session");
	assert.deepEqual(second.launches[0].options.verifiedArtifacts, [
		explorationRef("prototype", "durable-progress-r1"),
	]);
	assert.equal(
		[...files.keys()].every((path) => path.startsWith("/private/checkpoints/")),
		true,
	);
});

test("workflow delegate resumes only compatible sessions and otherwise starts from verified progress", async () => {
	let call = 0;
	const verifiedProgress = explorationRef("prototype", "progress-r1");
	const fixture = dependencies();
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		call += 1;
		if (call === 1) {
			return {
				ok: false,
				interrupted: true,
				sessionId: "session-compatible",
				verifiedArtifacts: [verifiedProgress],
				partialOutput: { untrusted: "discard me" },
				blocker: {
					code: "PI_WORKFLOW_DELEGATION_INTERRUPTED",
					message: "interrupted",
				},
			};
		}
		return completed(launch, explorationRef("prototype", `r${call}`), {
			sessionId: `session-${call}`,
		});
	};
	const delegate = createWorkflowDelegate(fixture.deps);
	const interrupted = await delegate.delegate(intent("prototype"));
	assert.equal(interrupted.blocker.code, "PI_WORKFLOW_DELEGATION_INTERRUPTED");
	const resumed = await delegate.delegate(intent("prototype"));
	assert.equal(resumed.status, "completed");
	assert.equal(fixture.launches[1].options.resumeSessionId, "session-compatible");
	assert.deepEqual(fixture.launches[1].options.verifiedArtifacts, [verifiedProgress]);
	assert.equal("partialOutput" in fixture.launches[1].options, false);

	const changed = await delegate.delegate(
		intent("prototype", { affectedPaths: ["src/known.ts", "src/changed.ts"] }),
	);
	assert.equal(changed.status, "completed");
	assert.equal(fixture.launches[2].options.resumeSessionId, undefined);
	assert.deepEqual(fixture.launches[2].options.verifiedArtifacts, []);
	assert.equal("partialOutput" in fixture.launches[2].options, false);
});

test("workflow delegate starts fresh when resolved standards make a stored session incompatible", async () => {
	const fixture = dependencies();
	let standardsRevision = "v1";
	fixture.deps.standardsResolver.resolve = async ({ affectedPaths }) => ({
		ok: true,
		value: {
			standardRefs: [{
				kind: "standard",
				name: "AGENTS",
				path: "/repo/AGENTS.md",
				digest: `${standardsRevision}-${affectedPaths.join("+")}`,
			}],
			requiredSkills: [],
		},
	});
	let call = 0;
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		call += 1;
		if (call === 1) {
			return {
				ok: false,
				interrupted: true,
				sessionId: "stale-session",
				verifiedArtifacts: [explorationRef("prototype", "progress-r1")],
				blocker: { code: "PI_WORKFLOW_DELEGATION_INTERRUPTED", message: "interrupted" },
			};
		}
		return completed(launch, explorationRef("prototype", "fresh-r2"));
	};
	const delegate = createWorkflowDelegate(fixture.deps);
	await delegate.delegate(intent("prototype"));
	standardsRevision = "v2";
	const result = await delegate.delegate(intent("prototype"));
	assert.equal(result.status, "completed");
	assert.equal(fixture.launches[1].options.resumeSessionId, undefined);
	assert.deepEqual(fixture.launches[1].options.verifiedArtifacts, []);
});

test("workflow delegate persists intervention before forwarding cancellation and discards late output", async () => {
	let finishLaunch;
	const events = [];
	const fixture = dependencies();
	fixture.deps.checkpointStore = {
		load: (...args) => fixture.checkpointStore.load(...args),
		async save(checkpoint, expectedRevision) {
			events.push(`save:${checkpoint.state}:${checkpoint.interventions.length}`);
			return fixture.checkpointStore.save(checkpoint, expectedRevision);
		},
	};
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		return new Promise((resolve) => {
			finishLaunch = () => resolve(completed(launch, explorationRef("prototype")));
		});
	};
	fixture.deps.subagentLauncher.intervene = async (_sessionId, intervention) => {
		events.push(`forward:${intervention.kind}`);
	};
	const delegate = createWorkflowDelegate(fixture.deps);
	const running = delegate.delegate(intent("prototype"));
	await new Promise((resolve) => setImmediate(resolve));
	const intervention = await delegate.intervene(intent("prototype"), {
		kind: "cancel",
		reason: "Owner changed direction",
	});
	assert.equal(intervention, undefined);
	finishLaunch();
	const result = await running;
	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_DELEGATION_CANCELLED");
	assert.deepEqual(result.artifacts, []);
	assert.deepEqual(events.slice(-2), ["save:cancelled:1", "forward:cancel"]);
});

test("workflow delegate accepts bounded steering but rejects scope-changing intervention", async () => {
	let finishLaunch;
	const fixture = dependencies();
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		return new Promise((resolve) => {
			finishLaunch = () => resolve(completed(launch, explorationRef("prototype")));
		});
	};
	const delegate = createWorkflowDelegate(fixture.deps);
	const running = delegate.delegate(intent("prototype"));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		await delegate.intervene(intent("prototype"), {
			kind: "steer",
			guidance: "Narrow the comparison to first-run onboarding.",
		}),
		undefined,
	);
	const rejected = await delegate.intervene(intent("prototype"), {
		kind: "steer",
		guidance: "Change scope.",
		affectedPaths: ["src/not-authorized.ts"],
	});
	assert.equal(rejected.code, "PI_WORKFLOW_INTERVENTION_INVALID");
	assert.equal(fixture.interventions.length, 1);
	await delegate.intervene(intent("prototype"), {
		kind: "cancel",
		reason: "test cleanup",
	});
	finishLaunch();
	await running;
});

test("expanded paths re-resolve standards and skills with exactly one corrective retry", async () => {
	const fixture = dependencies();
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		if (fixture.launches.length === 1) {
			return completed(launch, explorationRef("design-alternative", "partial-r1"), {
				discoveredPaths: ["src/discovered.ts"],
				partialOutput: { raw: "must not be trusted" },
			});
		}
		return completed(launch, explorationRef("design-alternative", "final-r2"));
	};
	const result = await createWorkflowDelegate(fixture.deps).delegate(
		intent("design-alternative"),
	);
	assert.equal(result.status, "completed");
	assert.deepEqual(fixture.resolvedPaths, [
		["src/known.ts"],
		["src/known.ts", "src/discovered.ts"],
	]);
	assert.equal(fixture.launches.length, 2);
	assert.equal(fixture.launches[1].options.attempt, 2);
	assert.deepEqual(fixture.launches[1].options.verifiedArtifacts, []);
});

test("unverified discovered-path metadata blocks without consuming a corrective retry", async () => {
	const fixture = dependencies();
	fixture.deps.artifactInterface.openSession = (grant) => ({
		read: async () => ({ revision: researchRef.revision, content: "research" }),
		readCurrent: async () => undefined,
		writeSnapshot: async () => explorationRef("prototype"),
		writeExplorationSnapshot: async () => explorationRef("prototype"),
		mergeProgress: async () => explorationRef("prototype"),
		hasVerifiedArtifact: (artifact) => artifact.topic === grant.topic,
		verifyDiscoveredPaths: async () => {
			throw new Error("Discovered path is not present in verified exploration output.");
		},
	});
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		return completed(launch, explorationRef("prototype"), {
			discoveredPaths: ["../outside.ts"],
		});
	};
	const result = await createWorkflowDelegate(fixture.deps).delegate(intent("prototype"));
	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_DISCOVERED_PATH_INVALID");
	assert.equal(fixture.launches.length, 1);
});

test("workflow delegate never performs a second corrective retry", async () => {
	const fixture = dependencies();
	fixture.deps.subagentLauncher.launch = async (launch, options) => {
		fixture.launches.push({ launch, options });
		return completed(launch, explorationRef("prototype", `r${fixture.launches.length}`), {
			discoveredPaths: [`src/discovered-${fixture.launches.length}.ts`],
		});
	};
	const result = await createWorkflowDelegate(fixture.deps).delegate(intent("prototype"));
	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_RETRY_EXHAUSTED");
	assert.equal(fixture.launches.length, 2);
});
