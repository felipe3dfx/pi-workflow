import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowDelegate } from "../extensions/workflow-delegate.ts";
import { createResearchEvidenceEnvelope } from "../extensions/workflow-contracts.ts";

function createPreparedArtifact(topic, overrides = {}) {
	const envelope = createResearchEvidenceEnvelope({
		assignmentId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
		findings: [
			{
				claim: "One",
				evidence: [
					{
						uri: "https://example.com",
						title: "Example",
						retrievedAt: "2026-07-11T00:00:00.000Z",
					},
				],
			},
		],
		limitations: [],
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
			allowedTools: [
				"read",
				"grep",
				"find",
				"ls",
				"web_search",
				"fetch_content",
				"get_search_content",
				"workflow_artifact_session",
			],
			deniedCapabilities: ["bash"],
			artifactTopic: topic,
		},
	});
	return {
		kind: "engram",
		project: "pi-workflow",
		topic,
		revision: "r1",
		schema: "research-evidence",
		schemaVersion: 1,
		digest: envelope.digest,
		...overrides,
	};
}

function createArtifactSession(verifiedArtifact) {
	return {
		readCurrent: async () => undefined,
		writeSnapshot: async () => verifiedArtifact,
		hasVerifiedArtifact: (artifact) =>
			artifact.revision === verifiedArtifact.revision &&
			artifact.digest === verifiedArtifact.digest &&
			artifact.topic === verifiedArtifact.topic,
	};
}

test("workflow delegate launches one exact read-only research assignment", async () => {
	let preparedLaunch;
	const verifiedArtifact = createPreparedArtifact(
		"workflow/define-product/definition-1/research/request-1",
	);
	const delegate = createWorkflowDelegate({
		skillResolver: {
			resolve: async () => ({
				ok: true,
				value: [
					{
						kind: "skill",
						name: "research",
						path: "/skills/research/SKILL.md",
						digest: "skill-digest",
					},
				],
			}),
		},
		standardsResolver: {
			resolve: async () => ({ ok: true, value: { standardRefs: [], requiredSkills: [] } }),
		},
		agentValidator: {
			validateResearchLaunch: async () => ({
				ok: true,
				value: {
					assetVersion: 1,
					assetDigest: "asset-digest",
					allowedTools: [
						"read",
						"grep",
						"find",
						"ls",
						"web_search",
						"fetch_content",
						"get_search_content",
						"workflow_artifact_session",
					],
					deniedCapabilities: ["bash"],
				},
			}),
		},
		artifactInterface: {
			openSession: () => createArtifactSession(verifiedArtifact),
		},
		subagentLauncher: {
			launch: async (launch) => {
				preparedLaunch = launch;
				return {
					ok: true,
					value: {
						status: "completed",
						executiveSummary: "done",
						artifacts: [verifiedArtifact],
						nextRecommended: { kind: "confirmed-route", route: "wayfinder" },
						risks: [],
						launchProvenance: launch.launchProvenance,
					},
				};
			},
		},
	});

	const result = await delegate.delegate({
		kind: "research",
		requestId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
		project: { name: "pi-workflow", root: "/repo" },
		targetTopic: "workflow/define-product/definition-1/research/request-1",
		requiredSkills: [{ name: "research" }],
		affectedPaths: ["skills/define-product/SKILL.md"],
	});
	assert.equal(result.status, "completed");
	assert.equal(preparedLaunch.launchProvenance.provider, "openai-codex");
	assert.equal(preparedLaunch.launchProvenance.model, "gpt-5.6-terra");
	assert.equal(preparedLaunch.launchProvenance.effort, "medium");
	assert.equal(preparedLaunch.launchProvenance.capabilityProfile, "research-reader");
	assert.equal(preparedLaunch.launchProvenance.inheritContext, false);
});

test("workflow delegate blocks capability drift and invalid completed artifacts", async () => {
	const capabilityBlocked = await createWorkflowDelegate({
		skillResolver: { resolve: async () => ({ ok: true, value: [] }) },
		standardsResolver: {
			resolve: async () => ({ ok: true, value: { standardRefs: [], requiredSkills: [] } }),
		},
		agentValidator: {
			validateResearchLaunch: async () => ({
				ok: false,
				blocker: {
					code: "PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					message: "forbidden tool",
				},
			}),
		},
		artifactInterface: {
			openSession: () => createArtifactSession(createPreparedArtifact("topic")),
		},
		subagentLauncher: {
			launch: async () => {
				throw new Error("should not launch");
			},
		},
	}).delegate({
		kind: "research",
		requestId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
		project: { name: "pi-workflow", root: "/repo" },
		targetTopic: "workflow/define-product/definition-1/research/request-1",
		requiredSkills: [{ name: "research" }],
		affectedPaths: [],
	});
	assert.equal(capabilityBlocked.status, "blocked");
	assert.equal(capabilityBlocked.blocker.code, "PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH");

	const invalidArtifact = await createWorkflowDelegate({
		skillResolver: { resolve: async () => ({ ok: true, value: [] }) },
		standardsResolver: {
			resolve: async () => ({ ok: true, value: { standardRefs: [], requiredSkills: [] } }),
		},
		agentValidator: {
			validateResearchLaunch: async () => ({
				ok: true,
				value: {
					assetVersion: 1,
					assetDigest: "asset-digest",
					allowedTools: [
						"read",
						"grep",
						"find",
						"ls",
						"web_search",
						"fetch_content",
						"get_search_content",
						"workflow_artifact_session",
					],
					deniedCapabilities: ["bash"],
				},
			}),
		},
		artifactInterface: {
			openSession: () =>
				createArtifactSession(
					createPreparedArtifact(
						"workflow/define-product/definition-1/research/request-1",
					),
				),
		},
		subagentLauncher: {
			launch: async (launch) => ({
				ok: true,
				value: {
					status: "completed",
					executiveSummary: "done",
					artifacts: [
						createPreparedArtifact(launch.artifactGrant.topic, {
							revision: "r2",
							digest: "forged-digest",
						}),
					],
					nextRecommended: { kind: "confirmed-route", route: "wayfinder" },
					risks: [],
					launchProvenance: launch.launchProvenance,
				},
			}),
		},
	}).delegate({
		kind: "research",
		requestId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
		project: { name: "pi-workflow", root: "/repo" },
		targetTopic: "workflow/define-product/definition-1/research/request-1",
		requiredSkills: [{ name: "research" }],
		affectedPaths: [],
	});
	assert.equal(invalidArtifact.status, "blocked");
	assert.equal(invalidArtifact.blocker.code, "PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID");
});

test("workflow delegate requires matching launch provenance on terminal launches", async () => {
	const result = await createWorkflowDelegate({
		skillResolver: { resolve: async () => ({ ok: true, value: [] }) },
		standardsResolver: {
			resolve: async () => ({ ok: true, value: { standardRefs: [], requiredSkills: [] } }),
		},
		agentValidator: {
			validateResearchLaunch: async () => ({
				ok: true,
				value: {
					assetVersion: 1,
					assetDigest: "asset-digest",
					allowedTools: [
						"read",
						"grep",
						"find",
						"ls",
						"web_search",
						"fetch_content",
						"get_search_content",
						"workflow_artifact_session",
					],
					deniedCapabilities: ["bash"],
				},
			}),
		},
		artifactInterface: {
			openSession: () =>
				createArtifactSession(
					createPreparedArtifact(
						"workflow/define-product/definition-1/research/request-1",
					),
				),
		},
		subagentLauncher: {
			launch: async () => ({
				ok: true,
				value: {
					status: "blocked",
					executiveSummary: "no provenance",
					artifacts: [],
					nextRecommended: { kind: "owner-action" },
					risks: [],
					blocker: {
						code: "PI_WORKFLOW_AGENT_ASSET_NOT_READY",
						message: "launch returned no provenance",
					},
				},
			}),
		},
	}).delegate({
		kind: "research",
		requestId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		question: "What should we research?",
		domainAnchorDigest: "anchor-digest",
		project: { name: "pi-workflow", root: "/repo" },
		targetTopic: "workflow/define-product/definition-1/research/request-1",
		requiredSkills: [{ name: "research" }],
		affectedPaths: [],
	});
	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH");
});
