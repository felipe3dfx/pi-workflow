import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowDelegate } from "../extensions/workflow-delegate.ts";
import {
	canonicalJson,
	createResearchEvidenceEnvelope,
	digestCanonicalValue,
} from "../extensions/workflow-contracts.ts";
import { createWorkflowArtifactInterface } from "../extensions/workflow-artifacts.ts";
import {
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
} from "../extensions/product-spec.ts";
import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
} from "../extensions/delivery-ticket-graph.ts";

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

function createTicketGraph() {
	return createDeliveryTicketGraph({
		parent: { id: "parent-1", teamId: "team-1", revision: "r1", specDigest: "spec-1" },
		coverage: createSpecCoverageIndex({
			stories: [{ id: "story-1", contextId: "delivery", acceptanceCriteria: ["ac-1"] }],
			decisions: ["decision-1"],
			tests: ["test-1"],
		}),
		language: "es",
		tickets: [{
			stableKey: "T01",
			title: "Crear flujo estable",
			outcome: "El Owner recibe un grafo verificable",
			acceptanceCriteria: ["Cumple uno", "Cumple dos", "Cumple tres", "Cumple cuatro"],
			estimate: { points: 1, rationale: "Alcance pequeño" },
			blockers: [],
			refs: [{ kind: "story", id: "story-1" }, { kind: "decision", id: "decision-1" }, { kind: "test", id: "test-1" }],
			deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "delivery" }],
		}],
	});
}

function createTicketGraphStore(initialEntries = []) {
	const entries = new Map();
	let revision = 0;
	for (const entry of initialEntries) {
		const versions = entries.get(entry.topic) ?? [];
		versions.push({ revision: entry.revision, content: entry.content });
		entries.set(entry.topic, versions);
	}
	return {
		capabilities: { atomicCompareAndSwap: true },
		readCurrent: async (_project, topic) => entries.get(topic)?.at(-1),
		write: async (_project, topic, content, expectedRevision) => {
			const versions = entries.get(topic) ?? [];
			assert.equal(versions.at(-1)?.revision, expectedRevision);
			revision += 1;
			versions.push({ revision: `r${revision}`, content });
			entries.set(topic, versions);
			return { revision: `r${revision}` };
		},
		readRevision: async (_project, topic, target) => entries.get(topic)?.find((entry) => entry.revision === target)?.content,
	};
}

function createApprovedSpecSnapshot() {
	const spec = createProductSpecEnvelope({
		definitionId: "definition-1",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Entrega verificable",
		},
		revision: "spec-r1",
		problem: "El equipo necesita una entrega verificable.",
		solution: "El sistema conserva evidencia verificable.",
		userStories: ["Como Owner, quiero revisar la entrega."],
		decisions: [{ id: "D1", status: "resolved", pertinent: true, text: "Usar evidencia inmutable." }],
		tests: ["La lectura valida identidad y digest."],
		outOfScope: ["No crear tickets en Linear."],
		supportArtifacts: [],
	});
	return {
		spec,
		approval: createProductSpecApprovalEnvelope({
			spec,
			actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" },
		}),
	};
}

function createDeliveryParentSnapshot() {
	const unsigned = {
		schema: "delivery-parent",
		schemaVersion: 1,
		payload: { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: "spec-digest" },
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function openReadOnlyTicketSession(aliases, entries) {
	return createWorkflowArtifactInterface(createTicketGraphStore(entries)).openSession({
		project: { name: "pi-workflow", root: "/repo" },
		topic: "workflow/define-product/definition-1/tickets/request-1",
		schema: "delivery-ticket-graph",
		schemaVersion: 1,
		strategy: "snapshot",
		aliases,
	});
}

test("workflow delegate grants only verified to-tickets inputs and persists one canonical graph through its artifact session", async () => {
	const topic = "workflow/define-product/definition-1/tickets/request-1";
	let preparedLaunch;
	const approvedSpec = createApprovedSpecSnapshot();
	const deliveryParent = createDeliveryParentSnapshot();
	const approvedSpecTopic = "workflow/define-product/definition-1/spec";
	const deliveryParentTopic = "workflow/define-product/definition-1/published-parent";
	const approvedSpecContent = `${canonicalJson(approvedSpec)}\n`;
	const deliveryParentContent = `${canonicalJson(deliveryParent)}\n`;
	const artifactInterface = createWorkflowArtifactInterface(createTicketGraphStore([
		{ topic: approvedSpecTopic, revision: "spec-r1", content: approvedSpecContent },
		{ topic: deliveryParentTopic, revision: "parent-r1", content: deliveryParentContent },
	]));
	const result = await createWorkflowDelegate({
		skillResolver: { resolve: async () => ({ ok: true, value: [] }) },
		standardsResolver: {
			resolve: async () => ({ ok: true, value: { standardRefs: [], requiredSkills: [] } }),
		},
		agentValidator: {
			validateTicketGraphLaunch: async () => ({
				ok: true,
				value: {
					assetVersion: 1,
					assetDigest: "to-tickets-digest",
					allowedTools: ["read", "grep", "find", "ls", "workflow_artifact_session"],
					deniedCapabilities: ["bash", "edit", "write", "linear", "public-skill", "fan-out", "private-namespace", "agent-launch"],
				},
			}),
		},
		artifactInterface: {
			openSession: artifactInterface.openSession,
		},
		subagentLauncher: {
			launch: async (launch) => {
				preparedLaunch = launch;
				const readSpec = await launch.artifactSession.read("approved-spec");
				const readParent = await launch.artifactSession.read("delivery-parent");
				assert.deepEqual(readSpec, { revision: "spec-r1", content: approvedSpecContent });
				assert.deepEqual(readParent, { revision: "parent-r1", content: deliveryParentContent });
				const artifact = await launch.artifactSession.writeDeliveryTicketGraph(createTicketGraph());
				return {
					ok: true,
					value: {
						status: "completed",
						executiveSummary: "graph created",
						artifacts: [artifact],
						nextRecommended: { kind: "owner-action" },
						risks: [],
						launchProvenance: launch.launchProvenance,
					},
				};
			},
		},
	}).delegate({
		kind: "to-tickets",
		requestId: "request-1",
		definitionId: "definition-1",
		recommendationDigest: "recommendation-1",
		route: "wayfinder",
		domainAnchorDigest: "anchor-digest",
		project: { name: "pi-workflow", root: "/repo" },
		targetTopic: topic,
		approvedSpec: {
			kind: "engram", project: "pi-workflow", topic: approvedSpecTopic, revision: "spec-r1", schema: "product-spec", schemaVersion: 1, digest: approvedSpec.spec.digest,
		},
		deliveryParent: {
			kind: "engram", project: "pi-workflow", topic: deliveryParentTopic, revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: deliveryParent.digest,
		},
		requiredSkills: [{ name: "to-tickets" }],
		affectedPaths: ["assets/agents/to-tickets.md"],
	});
	assert.equal(result.status, "completed");
	assert.equal(preparedLaunch.artifactGrant.schema, "delivery-ticket-graph");
	assert.equal(preparedLaunch.launchProvenance.agentName, "to-tickets");
	assert.equal(preparedLaunch.launchProvenance.capabilityProfile, "artifact-reader");
	assert.deepEqual(preparedLaunch.artifactGrant.aliases, [
		{ alias: "approved-spec", ref: preparedLaunch.intent.approvedSpec },
		{ alias: "delivery-parent", ref: preparedLaunch.intent.deliveryParent },
	]);
	assert.deepEqual(preparedLaunch.launchProvenance.deniedCapabilities, ["bash", "edit", "write", "linear", "public-skill", "fan-out", "private-namespace", "agent-launch"]);
});

test("to-tickets artifact reads fail closed for invalid or unauthorized aliases", async () => {
	const approvedSpec = createApprovedSpecSnapshot();
	const deliveryParent = createDeliveryParentSnapshot();
	const approvedSpecContent = `${canonicalJson(approvedSpec)}\n`;
	const deliveryParentContent = `${canonicalJson(deliveryParent)}\n`;
	const approvedSpecRef = {
		kind: "engram", project: "pi-workflow", topic: "approved-spec", revision: "spec-r1", schema: "product-spec", schemaVersion: 1, digest: approvedSpec.spec.digest,
	};
	const deliveryParentRef = {
		kind: "engram", project: "pi-workflow", topic: "delivery-parent", revision: "parent-r1", schema: "delivery-parent", schemaVersion: 1, digest: deliveryParent.digest,
	};
	const session = openReadOnlyTicketSession([
		{ alias: "approved-spec", ref: approvedSpecRef },
		{ alias: "delivery-parent", ref: deliveryParentRef },
		{ alias: "wrong-digest", ref: { ...approvedSpecRef, topic: "wrong-digest", digest: "wrong" } },
		{ alias: "missing-revision", ref: { ...approvedSpecRef, topic: "missing-revision", revision: "" } },
		{ alias: "corrupt-bytes", ref: { ...approvedSpecRef, topic: "corrupt-bytes" } },
		{ alias: "corrupt-envelope", ref: { ...approvedSpecRef, topic: "corrupt-envelope" } },
		{ alias: "unknown-schema", ref: { ...approvedSpecRef, topic: "unknown-schema", schema: "unknown-schema" } },
		{ alias: "approved-spec-v2", ref: { ...approvedSpecRef, topic: "approved-spec-v2", schemaVersion: 2 } },
		{ alias: "delivery-parent-v2", ref: { ...deliveryParentRef, topic: "delivery-parent-v2", schemaVersion: 2 } },
	], [
		{ topic: "approved-spec", revision: "spec-r1", content: approvedSpecContent },
		{ topic: "delivery-parent", revision: "parent-r1", content: deliveryParentContent },
		{ topic: "wrong-digest", revision: "spec-r1", content: approvedSpecContent },
		{ topic: "missing-revision", revision: "", content: approvedSpecContent },
		{ topic: "corrupt-bytes", revision: "spec-r1", content: "not JSON" },
		{ topic: "corrupt-envelope", revision: "spec-r1", content: "{}" },
		{ topic: "unknown-schema", revision: "spec-r1", content: approvedSpecContent },
		{ topic: "approved-spec-v2", revision: "spec-r1", content: approvedSpecContent },
		{ topic: "delivery-parent-v2", revision: "parent-r1", content: deliveryParentContent },
	]);

	await assert.rejects(() => session.read("wrong-digest"), /invalid/i);
	await assert.rejects(() => session.read("missing-revision"), /invalid/i);
	await assert.rejects(() => session.read("corrupt-bytes"), /invalid JSON/i);
	await assert.rejects(() => session.read("corrupt-envelope"), /invalid/i);
	await assert.rejects(() => session.read("unknown-schema"), /invalid|unsupported/i);
	await assert.rejects(() => session.read("approved-spec-v2"), /schema, version, or digest is invalid/);
	await assert.rejects(() => session.read("delivery-parent-v2"), /schema, version, or digest is invalid/);
	await assert.rejects(() => session.read("not-granted"), /not granted/i);
});
