import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createWorkflowArtifactInterface,
	validateResearchEvidenceEnvelope,
} from "../extensions/workflow-artifacts.ts";
import { createResearchEvidenceEnvelope } from "../extensions/workflow-contracts.ts";

function createStore() {
	const revisions = new Map();
	let counter = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		async readCurrent(project, topic) {
			const bucket = revisions.get(`${project}:${topic}`) ?? [];
			return bucket.at(-1);
		},
		async write(project, topic, content, expectedRevision) {
			const key = `${project}:${topic}`;
			const bucket = revisions.get(key) ?? [];
			const currentRevision = bucket.at(-1)?.revision;
			if (currentRevision !== expectedRevision) {
				const error = new Error("compare-and-swap conflict");
				error.code = "revision-conflict";
				throw error;
			}
			counter += 1;
			bucket.push({ revision: `r${counter}`, content });
			revisions.set(key, bucket);
			return { revision: `r${counter}` };
		},
		async readRevision(project, topic, revision) {
			const bucket = revisions.get(`${project}:${topic}`) ?? [];
			return bucket.find((entry) => entry.revision === revision)?.content;
		},
	};
}

function validEnvelope(
	artifactTopic = "workflow/define-product/definition-1/research/request-1",
) {
	return createResearchEvidenceEnvelope({
		assignmentId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "grilling",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
		findings: [
			{
				claim: "Use primary sources.",
				evidence: [
					{
						uri: "https://example.com",
						title: "Example",
						retrievedAt: "2026-07-11T00:00:00.000Z",
					},
				],
			},
		],
		limitations: ["No live API access"],
		skillRefs: [],
		standardRefs: [],
		launchProvenance: {
			agentName: "research",
			assetVersion: 1,
			assetDigest: "asset-digest",
			capabilityProfile: "research-reader",
			provider: "openai-codex",
			model: "gpt-5.6-terra",
			effort: "medium",
			inheritContext: false,
			promptMode: "replace",
			skillRefs: [],
			standardRefs: [],
			allowedTools: ["read"],
			deniedCapabilities: ["bash"],
			artifactTopic,
		},
	});
}

test("research artifact validation rejects route binding drift", () => {
	const envelope = validEnvelope();
	const validation = validateResearchEvidenceEnvelope(envelope, {
		assignmentId: envelope.payload.assignmentId,
		definitionId: envelope.payload.definitionId,
		recommendationDigest: envelope.payload.recommendationDigest,
		route: "wayfinder",
		question: envelope.payload.question,
		domainAnchorDigest: envelope.payload.domainAnchorDigest,
		artifactTopic: envelope.payload.launchProvenance.artifactTopic,
	});
	assert.equal(validation.ok, false);
});

test("workflow artifact session writes and verifies Engram read-back", async () => {
	const store = createStore();
	const session = createWorkflowArtifactInterface(store).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/define-product/definition-1/research/request-1",
			schema: "research-evidence",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		},
		{
			assignmentId: "request-1",
			definitionId: "definition-1",
			recommendationDigest: "recommendation-1",
			route: "grilling",
			question: "What should we research?",
			domainAnchorDigest: "anchor-digest",
		},
	);
	const ref = await session.writeSnapshot(validEnvelope());
	assert.deepEqual(ref, {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/define-product/definition-1/research/request-1",
		revision: "r1",
		schema: "research-evidence",
		schemaVersion: 1,
		digest: validEnvelope().digest,
	});
});

test("workflow artifact sessions refuse writes when CAS capability metadata is absent", async () => {
	const store = createStore();
	delete store.capabilities;
	const session = createWorkflowArtifactInterface(store).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/define-product/definition-1/research/request-1",
			schema: "research-evidence",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		},
		{
			assignmentId: "request-1",
			definitionId: "definition-1",
			recommendationDigest: "recommendation-1",
			route: "grilling",
			question: "What should we research?",
			domainAnchorDigest: "anchor-digest",
		},
	);
	await assert.rejects(() => session.writeSnapshot(validEnvelope()), /compare-and-swap/i);
});

test("workflow artifact session rejects invalid artifact content", async () => {
	const session = createWorkflowArtifactInterface(createStore()).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/define-product/definition-1/research/request-1",
			schema: "research-evidence",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		},
		{
			assignmentId: "request-1",
			definitionId: "definition-1",
			recommendationDigest: "recommendation-1",
			route: "grilling",
			question: "What should we research?",
			domainAnchorDigest: "anchor-digest",
		},
	);
	const valid = validEnvelope();
	const invalid = createResearchEvidenceEnvelope({
		...valid.payload,
		findings: [],
	});
	await assert.rejects(() => session.writeSnapshot(invalid), /required evidence/i);
});

test("workflow artifact session binds writes to the confirmed request", async () => {
	const session = createWorkflowArtifactInterface(createStore()).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/define-product/definition-1/research/request-1",
			schema: "research-evidence",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		},
		{
			assignmentId: "request-1",
			definitionId: "definition-1",
			recommendationDigest: "recommendation-1",
			route: "grilling",
			question: "What should we research?",
			domainAnchorDigest: "anchor-digest",
		},
	);
	const valid = validEnvelope();
	const rebound = createResearchEvidenceEnvelope({
		...valid.payload,
		question: "A different request entirely",
	});
	await assert.rejects(() => session.writeSnapshot(rebound), /binding/i);
});

test("workflow artifact grants expose only named readable aliases and one writable topic", async () => {
	const store = createStore();
	const source = createWorkflowArtifactInterface(store).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/source",
			schema: "research-evidence",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		},
		{
			assignmentId: "request-1",
			definitionId: "definition-1",
			recommendationDigest: "recommendation-1",
			route: "grilling",
			question: "What should we research?",
			domainAnchorDigest: "anchor-digest",
		},
	);
	const sourceRef = await source.writeSnapshot(validEnvelope("workflow/source"));
	const session = createWorkflowArtifactInterface(store).openSession({
		project: { name: "pi-workflow", root: "/repo" },
		topic: "workflow/target",
		schema: "workflow-progress",
		schemaVersion: 1,
		strategy: "merge-progress",
		aliases: [{ alias: "research", ref: sourceRef }],
	});
	assert.equal((await session.read("research")).revision, "r1");
	await assert.rejects(() => session.read("history"), /alias is not granted/i);
	assert.deepEqual(Object.keys(session).sort(), [
		"hasVerifiedArtifact",
		"mergeProgress",
		"read",
		"readCurrent",
		"verifyDiscoveredPaths",
		"writeDeliveryTicketGraph",
		"writeExplorationSnapshot",
		"writeSnapshot",
	]);
});

test("authorized alias reads reject corrupted and stale artifact bytes", async () => {
	const envelope = validEnvelope("workflow/source");
	const ref = {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/source",
		revision: "r1",
		schema: "research-evidence",
		schemaVersion: 1,
		digest: envelope.digest,
	};
	for (const content of [
		`${JSON.stringify({ ...envelope, digest: "corrupted" })}\n`,
		`${JSON.stringify(validEnvelope("workflow/other"))}\n`,
	]) {
		const store = {
			capabilities: { atomicCompareAndSwap: true },
			readCurrent: async () => undefined,
			write: async () => ({ revision: "unused" }),
			readRevision: async () => content,
		};
		const session = createWorkflowArtifactInterface(store).openSession({
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/target",
			schema: "workflow-progress",
			schemaVersion: 1,
			strategy: "merge-progress",
			aliases: [{ alias: "research", ref }],
		});
		await assert.rejects(() => session.read("research"), /invalid|binding|digest/i);
	}
});

test("design exploration snapshots are request-bound, comparable, and exclude private checkpoints", async () => {
	const store = createStore();
	const sourceRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/research",
		revision: "research-r1",
		schema: "research-evidence",
		schemaVersion: 1,
		digest: "research-digest",
	};
	const session = createWorkflowArtifactInterface(store).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic: "workflow/prototype",
			schema: "design-exploration",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [{ alias: "research", ref: sourceRef }],
		},
		{
			kind: "design-exploration",
			assignmentId: "request-1",
			definitionId: "definition-1",
			intent: "prototype",
			focus: "Compare onboarding directions",
			domainAnchorDigest: "anchor-digest",
			sourceArtifacts: [sourceRef],
			skillRefs: [],
			standardRefs: [],
			launchProvenance: {
				agentName: "prototype",
				assetVersion: 1,
				assetDigest: "prototype-asset",
				capabilityProfile: "isolated-prototype",
				provider: "openai-codex",
				model: "gpt-5.6-terra",
				effort: "medium",
				inheritContext: false,
				promptMode: "replace",
				skillRefs: [],
				standardRefs: [],
				allowedTools: ["read", "write", "workflow_artifact_session"],
				deniedCapabilities: ["linear", "private-namespace"],
				artifactTopic: "workflow/prototype",
			},
		},
	);
	const ref = await session.writeExplorationSnapshot({
		summary: "An interactive prototype makes the onboarding trade-off visible.",
		comparison: [
			{
				criterion: "Time to first value",
				assessment: "The guided direction shortens the first successful path.",
			},
		],
		changedPaths: ["prototype/index.html"],
		limitations: ["The disposable prototype was not user-tested."],
	});
	assert.equal(ref.schema, "design-exploration");
	const current = JSON.parse((await session.readCurrent()).content);
	assert.deepEqual(current.payload.comparison, [
		{
			criterion: "Time to first value",
			assessment: "The guided direction shortens the first successful path.",
		},
	]);
	assert.deepEqual(current.payload.sourceArtifacts, [sourceRef]);
	assert.equal("checkpoint" in current.payload, false);
	assert.equal("sessionId" in current.payload, false);
});

test("discovered paths require canonical project-contained existing claims in a verified terminal artifact", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-paths-"));
	try {
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "verified.ts"), "export {};\n");
		const store = createStore();
		const topic = "workflow/prototype";
		const session = createWorkflowArtifactInterface(store).openSession(
			{
				project: { name: "pi-workflow", root },
				topic,
				schema: "design-exploration",
				schemaVersion: 1,
				strategy: "snapshot",
				aliases: [],
			},
			{
				kind: "design-exploration",
				assignmentId: "request-1",
				definitionId: "definition-1",
				intent: "prototype",
				focus: "Validate paths",
				domainAnchorDigest: "anchor",
				sourceArtifacts: [],
				skillRefs: [],
				standardRefs: [],
				launchProvenance: {
					agentName: "prototype", assetVersion: 1, assetDigest: "asset", capabilityProfile: "isolated-prototype", provider: "openai-codex", model: "gpt-5.6-terra", effort: "medium", inheritContext: false, promptMode: "replace", skillRefs: [], standardRefs: [], allowedTools: [], deniedCapabilities: [], artifactTopic: topic,
				},
			},
		);
		const terminal = await session.writeExplorationSnapshot({
			summary: "Verified path",
			comparison: [{ criterion: "Path", assessment: "Exists" }],
			changedPaths: ["src/verified.ts", "src/missing.ts", "/etc/hosts"],
			limitations: [],
		});
		assert.deepEqual(
			await session.verifyDiscoveredPaths(["src/verified.ts"], [terminal]),
			["src/verified.ts"],
		);
		for (const path of ["/etc/hosts", "src/missing.ts", "src/unclaimed.ts"]) {
			await assert.rejects(
				() => session.verifyDiscoveredPaths([path], [terminal]),
				/not present|outside|ENOENT/i,
			);
		}
		await assert.rejects(
			() => session.verifyDiscoveredPaths(["src/verified.ts"], [{ ...terminal, digest: "agent-only" }]),
			/not present/i,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("workflow artifact snapshots require compare-and-swap against the current revision", async () => {
	const store = createStore();
	const artifactInterface = createWorkflowArtifactInterface(store);
	const grant = {
		project: { name: "pi-workflow", root: "/repo" },
		topic: "workflow/define-product/definition-1/research/request-1",
		schema: "research-evidence",
		schemaVersion: 1,
		strategy: "snapshot",
		aliases: [],
	};
	const binding = {
		assignmentId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "grilling",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
	};
	await artifactInterface.openSession(grant, binding).writeSnapshot(validEnvelope());
	await assert.rejects(
		() => artifactInterface.openSession(grant, binding).writeSnapshot(validEnvelope()),
		/compare-and-swap conflict/i,
	);
});

test("design exploration session persists immutable progress before its terminal snapshot", async () => {
	const store = createStore();
	const sourceRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/research",
		revision: "research-r1",
		schema: "research-evidence",
		schemaVersion: 1,
		digest: "research-digest",
	};
	const topic = "workflow/design-exploration";
	const session = createWorkflowArtifactInterface(store).openSession(
		{
			project: { name: "pi-workflow", root: "/repo" },
			topic,
			schema: "design-exploration",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [{ alias: "research", ref: sourceRef }],
		},
		{
			kind: "design-exploration",
			assignmentId: "request-1",
			definitionId: "definition-1",
			intent: "prototype",
			focus: "Compare onboarding",
			domainAnchorDigest: "anchor-digest",
			sourceArtifacts: [sourceRef],
			skillRefs: [],
			standardRefs: [],
			launchProvenance: {
				agentName: "prototype",
				assetVersion: 1,
				assetDigest: "asset-digest",
				capabilityProfile: "isolated-prototype",
				provider: "openai-codex",
				model: "gpt-5.6-terra",
				effort: "medium",
				inheritContext: false,
				promptMode: "replace",
				skillRefs: [],
				standardRefs: [],
				allowedTools: ["workflow_artifact_session"],
				deniedCapabilities: ["private-namespace"],
				artifactTopic: topic,
			},
		},
	);
	const first = await session.mergeProgress({
		batchKey: "comparison-1",
		payload: { completed: ["first-run"] },
	});
	assert.equal(first.schema, "workflow-progress");
	await session.mergeProgress({
		batchKey: "comparison-2",
		supersedes: "comparison-1",
		payload: { completed: ["first-run", "recovery"] },
	});
	const terminal = await session.writeExplorationSnapshot({
		summary: "The alternatives are comparable.",
		comparison: [{ criterion: "Recovery", assessment: "Option B is clearer." }],
		changedPaths: ["prototype/index.html"],
		limitations: [],
	});
	assert.equal(terminal.schema, "design-exploration");
	const current = JSON.parse((await session.readCurrent()).content);
	assert.deepEqual(
		current.payload.progressBatches.map(({ batchKey, supersedes }) => ({
			batchKey,
			supersedes,
		})),
		[
			{ batchKey: "comparison-1", supersedes: undefined },
			{ batchKey: "comparison-2", supersedes: "comparison-1" },
		],
	);
});

test("merge-progress keeps immutable idempotent batches and explicit supersedes history", async () => {
	const store = createStore();
	const session = createWorkflowArtifactInterface(store).openSession({
		project: { name: "pi-workflow", root: "/repo" },
		topic: "workflow/progress",
		schema: "workflow-progress",
		schemaVersion: 1,
		strategy: "merge-progress",
		aliases: [],
	});
	const first = await session.mergeProgress({
		batchKey: "paths-1",
		payload: { paths: ["src/a.ts"] },
	});
	const duplicate = await session.mergeProgress({
		batchKey: "paths-1",
		payload: { paths: ["src/a.ts"] },
	});
	assert.deepEqual(duplicate, first);
	const corrected = await session.mergeProgress({
		batchKey: "paths-2",
		supersedes: "paths-1",
		payload: { paths: ["src/a.ts", "src/b.ts"] },
	});
	const current = JSON.parse((await session.readCurrent()).content);
	assert.equal(corrected.revision, "r2");
	assert.deepEqual(
		current.payload.batches.map(({ batchKey, supersedes }) => ({ batchKey, supersedes })),
		[
			{ batchKey: "paths-1", supersedes: undefined },
			{ batchKey: "paths-2", supersedes: "paths-1" },
		],
	);
	await assert.rejects(
		() => session.mergeProgress({ batchKey: "paths-1", payload: { paths: [] } }),
		/batch key conflict/i,
	);
	await assert.rejects(
		() => session.mergeProgress({
			batchKey: "paths-3",
			supersedes: "missing",
			payload: { paths: [] },
		}),
		/supersedes an unknown batch/i,
	);
});
