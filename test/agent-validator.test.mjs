import test from "node:test";
import assert from "node:assert/strict";

import { createAgentValidator } from "../extensions/agent-validator.ts";

function validAsset(overrides = {}) {
	return {
		name: "research",
		version: 1,
		digest: "asset-digest",
		capabilityProfile: "research-reader",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		inheritContext: false,
		promptMode: "replace",
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
		extensions: [],
		skills: [],
		supportsScopedArtifacts: true,
		...overrides,
	};
}

test("agent validator accepts exact read-only research launch inputs", async () => {
	const validator = createAgentValidator({
		readResearchAsset: () => validAsset(),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: true,
		}),
	});
	const result = await validator.validateResearchLaunch({
		skillRefs: [],
		standardRefs: [],
		artifactTopic: "workflow/define-product/definition-1/research/request-1",
	});
	assert.equal(result.ok, true);
	assert.equal(result.value.assetVersion, 1);
	assert.deepEqual(result.value.deniedCapabilities, [
		"bash",
		"edit",
		"write",
		"linear",
		"public-skill",
		"fan-out",
		"private-namespace",
		"agent-launch",
	]);
});

test("agent validator accepts the exact isolated prototype profile for both exploration intents", async () => {
	for (const intent of ["prototype", "design-alternative"]) {
		const validator = createAgentValidator({
			readResearchAsset: () => validAsset(),
			readExplorationAsset: () =>
				validAsset({
					name: "prototype",
					capabilityProfile: "isolated-prototype",
					allowedTools: [
						"read",
						"grep",
						"find",
						"ls",
						"edit",
						"write",
						"bash",
						"workflow_artifact_session",
					],
				}),
			readModelAvailability: () => ({
				authenticated: true,
				supportsToolCalling: true,
				exact: true,
			}),
		});
		const result = await validator.validateExplorationLaunch({
			intent,
			skillRefs: [],
			standardRefs: [],
			artifactTopic: `workflow/${intent}`,
		});
		assert.equal(result.ok, true);
		assert.equal(result.value.assetDigest, "asset-digest");
		assert.deepEqual(result.value.allowedTools, [
			"read",
			"grep",
			"find",
			"ls",
			"edit",
			"write",
			"bash",
			"workflow_artifact_session",
		]);
		assert.deepEqual(result.value.deniedCapabilities, [
			"linear",
			"public-skill",
			"fan-out",
			"private-namespace",
			"agent-launch",
		]);
	}
});

test("agent validator blocks exploration profile drift before launch", async () => {
	const validator = createAgentValidator({
		readResearchAsset: () => validAsset(),
		readExplorationAsset: () =>
			validAsset({
				name: "prototype",
				capabilityProfile: "isolated-prototype",
				allowedTools: [
					"read",
					"grep",
					"find",
					"ls",
					"edit",
					"write",
					"bash",
					"workflow_artifact_session",
					"linear",
				],
			}),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: true,
		}),
	});
	const result = await validator.validateExplorationLaunch({
		intent: "prototype",
		skillRefs: [],
		standardRefs: [],
		artifactTopic: "workflow/prototype",
	});
	assert.equal(result.ok, false);
	assert.equal(result.blocker.code, "PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH");
});

test("agent validator blocks forbidden capabilities, extra tools, and exact-model drift", async () => {
	const forbidden = await createAgentValidator({
		readResearchAsset: () => validAsset({ allowedTools: [...validAsset().allowedTools, "bash"] }),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: true,
		}),
	}).validateResearchLaunch({ skillRefs: [], standardRefs: [], artifactTopic: "topic" });
	assert.equal(forbidden.ok, false);
	assert.equal(
		forbidden.blocker.code,
		"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
	);

	const extraTool = await createAgentValidator({
		readResearchAsset: () =>
			validAsset({ allowedTools: [...validAsset().allowedTools, "mcp" ] }),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: true,
		}),
	}).validateResearchLaunch({ skillRefs: [], standardRefs: [], artifactTopic: "topic" });
	assert.equal(extraTool.ok, false);
	assert.equal(extraTool.blocker.code, "PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH");

	const exactModel = await createAgentValidator({
		readResearchAsset: () => validAsset(),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: false,
		}),
	}).validateResearchLaunch({ skillRefs: [], standardRefs: [], artifactTopic: "topic" });
	assert.equal(exactModel.ok, false);
	assert.equal(exactModel.blocker.code, "PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE");
});
