import {
	createBlocker,
	type DigestedRef,
	type PrepareLaunchValidation,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

interface AppliedResearchAsset {
	name: string;
	version: number;
	digest: string;
	capabilityProfile: string;
	provider: string;
	model: string;
	effort: string;
	inheritContext: boolean;
	promptMode: string;
	allowedTools: readonly string[];
	extensions: readonly string[];
	skills: readonly string[];
	supportsScopedArtifacts: boolean;
}

interface ModelAvailability {
	authenticated: boolean;
	supportsToolCalling: boolean;
	exact: boolean;
}

export interface AgentValidatorDependencies {
	readResearchAsset(): Promise<AppliedResearchAsset> | AppliedResearchAsset;
	readModelAvailability(
		provider: string,
		model: string,
		effort: string,
	): Promise<ModelAvailability> | ModelAvailability;
}

export type AgentValidation =
	| { ok: true; value: PrepareLaunchValidation }
	| { ok: false; blocker: WorkflowBlocker };

const requiredTools = [
	"read",
	"grep",
	"find",
	"ls",
	"web_search",
	"fetch_content",
	"get_search_content",
	"workflow_artifact_session",
];

const forbiddenCapabilities = [
	"bash",
	"edit",
	"write",
	"linear",
	"public-skill",
	"fan-out",
	"private-namespace",
	"agent-launch",
];

export function createAgentValidator(
	dependencies: AgentValidatorDependencies,
) {
	async function validateResearchLaunch(_input: {
		skillRefs: readonly DigestedRef[];
		standardRefs: readonly DigestedRef[];
		artifactTopic: string;
	}): Promise<AgentValidation> {
		const asset = await dependencies.readResearchAsset();
		if (asset.name !== "research" || asset.version < 1 || !asset.digest) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_AGENT_ASSET_NOT_READY",
					"The applied research agent asset is not ready for exact launch validation.",
				),
			};
		}
		if (
			asset.capabilityProfile !== "research-reader" ||
			asset.provider !== "openai-codex" ||
			asset.model !== "gpt-5.6-terra" ||
			asset.effort !== "medium" ||
			asset.inheritContext !== false ||
			asset.promptMode !== "replace"
		) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					"The research agent asset no longer matches the approved exact launch profile.",
				),
			};
		}
		if (asset.extensions.length > 0 || asset.skills.length > 0) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					"The research agent asset exposes forbidden extensions or public skill bindings.",
				),
			};
		}
		if (!asset.supportsScopedArtifacts) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					"The research agent asset does not expose the scoped workflow artifact capability.",
				),
			};
		}
		if (
			asset.allowedTools.length !== requiredTools.length ||
			requiredTools.some((tool, index) => asset.allowedTools[index] !== tool)
		) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					"The research agent asset must expose exactly the approved read-only tool allowlist.",
				),
			};
		}
		if (forbiddenCapabilities.some((tool) => asset.allowedTools.includes(tool))) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					"The research agent asset allows a forbidden mutation or orchestration capability.",
				),
			};
		}
		const availability = await dependencies.readModelAvailability(
			asset.provider,
			asset.model,
			asset.effort,
		);
		if (
			availability.authenticated !== true ||
			availability.supportsToolCalling !== true ||
			availability.exact !== true
		) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE",
					"The exact provider, model, or effort is unavailable for the research launch.",
				),
			};
		}
		return {
			ok: true,
			value: {
				assetVersion: asset.version,
				assetDigest: asset.digest,
				allowedTools: [...asset.allowedTools],
				deniedCapabilities: [...forbiddenCapabilities],
			},
		};
	}

	return { validateResearchLaunch };
}
