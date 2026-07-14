import test from "node:test";
import assert from "node:assert/strict";

import {
	createWorkflowArtifactInterface,
	validateResearchEvidenceEnvelope,
} from "../extensions/workflow-artifacts.ts";
import { createResearchEvidenceEnvelope } from "../extensions/workflow-contracts.ts";

function createStore() {
	const revisions = new Map();
	let counter = 0;
	return {
		async readCurrent(project, topic) {
			const bucket = revisions.get(`${project}:${topic}`) ?? [];
			return bucket.at(-1);
		},
		async write(project, topic, content) {
			const key = `${project}:${topic}`;
			const bucket = revisions.get(key) ?? [];
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

function validEnvelope() {
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
			artifactTopic: "workflow/define-product/definition-1/research/request-1",
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
