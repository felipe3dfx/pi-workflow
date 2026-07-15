import {
	createBlocker,
	type DigestedRef,
	type PrepareLaunchValidation,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

interface AppliedAgentAsset {
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
	readResearchAsset(): Promise<AppliedAgentAsset> | AppliedAgentAsset;
	readTicketGraphAsset?(): Promise<AppliedAgentAsset> | AppliedAgentAsset;
	readExplorationAsset?(): Promise<AppliedAgentAsset> | AppliedAgentAsset;
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

const requiredTicketGraphTools = [
	"read",
	"grep",
	"find",
	"ls",
	"workflow_artifact_session",
];

const requiredExplorationTools = [
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"bash",
	"workflow_artifact_session",
];

const forbiddenExplorationCapabilities = [
	"linear",
	"public-skill",
	"fan-out",
	"private-namespace",
	"agent-launch",
];

async function validateExactLaunch(input: {
	asset: AppliedAgentAsset;
	profileMatches: boolean;
	profileError: string;
	availabilityError: string;
	deniedCapabilities: readonly string[];
	readModelAvailability: AgentValidatorDependencies["readModelAvailability"];
}): Promise<AgentValidation> {
	if (!input.profileMatches) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
				input.profileError,
			),
		};
	}
	const availability = await input.readModelAvailability(
		input.asset.provider,
		input.asset.model,
		input.asset.effort,
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
				input.availabilityError,
			),
		};
	}
	return {
		ok: true,
		value: {
			assetVersion: input.asset.version,
			assetDigest: input.asset.digest,
			allowedTools: [...input.asset.allowedTools],
			deniedCapabilities: [...input.deniedCapabilities],
		},
	};
}

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
		const profileMatches =
			asset.capabilityProfile === "research-reader" &&
			asset.provider === "openai-codex" &&
			asset.model === "gpt-5.6-terra" &&
			asset.effort === "medium" &&
			asset.inheritContext === false &&
			asset.promptMode === "replace";
		if (!profileMatches) {
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
		return validateExactLaunch({
			asset,
			profileMatches,
			profileError:
				"The research agent asset no longer matches the approved exact launch profile.",
			availabilityError:
				"The exact provider, model, or effort is unavailable for the research launch.",
			deniedCapabilities: forbiddenCapabilities,
			readModelAvailability: dependencies.readModelAvailability,
		});
	}

	async function validateExplorationLaunch(_input: {
		intent: "prototype" | "design-alternative";
		skillRefs: readonly DigestedRef[];
		standardRefs: readonly DigestedRef[];
		artifactTopic: string;
	}): Promise<AgentValidation> {
		if (!dependencies.readExplorationAsset) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_AGENT_ASSET_NOT_READY",
					"The applied prototype agent asset is unavailable for exact launch validation.",
				),
			};
		}
		const asset = await dependencies.readExplorationAsset();
		if (asset.name !== "prototype" || asset.version < 1 || !asset.digest) {
			return {
				ok: false,
				blocker: createBlocker(
					"PI_WORKFLOW_AGENT_ASSET_NOT_READY",
					"The applied prototype agent asset is not ready for exact launch validation.",
				),
			};
		}
		const profileMatches = !(
			asset.capabilityProfile !== "isolated-prototype" ||
			asset.provider !== "openai-codex" ||
			asset.model !== "gpt-5.6-terra" ||
			asset.effort !== "medium" ||
			asset.inheritContext !== false ||
			asset.promptMode !== "replace" ||
			asset.extensions.length > 0 ||
			asset.skills.length > 0 ||
			!asset.supportsScopedArtifacts ||
			asset.allowedTools.length !== requiredExplorationTools.length ||
			requiredExplorationTools.some(
				(tool, index) => asset.allowedTools[index] !== tool,
			) ||
			forbiddenExplorationCapabilities.some((capability) =>
				asset.allowedTools.includes(capability),
			)
		);
		return validateExactLaunch({
			asset,
			profileMatches,
			profileError:
				"The prototype agent asset no longer matches the approved exact isolated launch profile.",
			availabilityError:
				"The exact provider, model, or effort is unavailable for the prototype launch.",
			deniedCapabilities: forbiddenExplorationCapabilities,
			readModelAvailability: dependencies.readModelAvailability,
		});
	}

	async function validateTicketGraphLaunch(_input: {
		skillRefs: readonly DigestedRef[];
		standardRefs: readonly DigestedRef[];
		artifactTopic: string;
	}): Promise<AgentValidation> {
		if (!dependencies.readTicketGraphAsset) {
			return { ok: false, blocker: createBlocker("PI_WORKFLOW_AGENT_ASSET_NOT_READY", "The applied to-tickets agent asset is unavailable.") };
		}
		const asset = await dependencies.readTicketGraphAsset();
		const profileMatches = asset.name === "to-tickets" && asset.version >= 1 && !!asset.digest &&
			asset.capabilityProfile === "artifact-reader" && asset.provider === "openai-codex" &&
			asset.model === "gpt-5.6-terra" && asset.effort === "medium" &&
			asset.inheritContext === false && asset.promptMode === "replace" &&
			asset.extensions.length === 0 && asset.skills.length === 0 && asset.supportsScopedArtifacts &&
			asset.allowedTools.length === requiredTicketGraphTools.length &&
			requiredTicketGraphTools.every((tool, index) => asset.allowedTools[index] === tool) &&
			!forbiddenCapabilities.some((capability) => asset.allowedTools.includes(capability));
		return validateExactLaunch({
			asset,
			profileMatches,
			profileError: "The to-tickets agent asset must use the exact read-only artifact-reader profile.",
			availabilityError: "The exact provider, model, or effort is unavailable for the to-tickets launch.",
			deniedCapabilities: forbiddenCapabilities,
			readModelAvailability: dependencies.readModelAvailability,
		});
	}

	return { validateResearchLaunch, validateExplorationLaunch, validateTicketGraphLaunch };
}
