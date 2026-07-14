import {
	createBlocker,
	sameLaunchProvenance,
	type ArtifactGrant,
	type DigestedRef,
	type PreparedLaunch,
	type ProjectRef,
	type ResearchArtifactBinding,
	type ResearchIntent,
	type Route,
	type SkillRequirement,
	type SubagentResult,
	type WorkflowIntent,
} from "./workflow-contracts.ts";
import type { SkillResolution } from "./skill-resolver.ts";
import type { ProjectStandardsResolution } from "./project-standards-resolver.ts";
import type { AgentValidation } from "./agent-validator.ts";
import type { LaunchAttempt } from "./subagent-launcher.ts";

export interface WorkflowDelegateDependencies {
	skillResolver: {
		resolve(requirements: readonly SkillRequirement[]): Promise<SkillResolution>;
	};
	standardsResolver: {
		resolve(input: {
			project: ProjectRef;
			affectedPaths: readonly string[];
		}): Promise<ProjectStandardsResolution>;
	};
	agentValidator: {
		validateResearchLaunch(input: {
			skillRefs: readonly DigestedRef[];
			standardRefs: readonly DigestedRef[];
			artifactTopic: string;
		}): Promise<AgentValidation>;
	};
	artifactInterface: {
		openSession(
			grant: ArtifactGrant,
			expected: ResearchArtifactBinding,
		): PreparedLaunch["artifactSession"];
	};
	subagentLauncher: {
		launch(preparedLaunch: PreparedLaunch): Promise<LaunchAttempt>;
	};
}

function buildArtifactGrant(intent: ResearchIntent): ArtifactGrant {
	return {
		project: intent.project,
		topic: intent.targetTopic,
		schema: "research-evidence",
		schemaVersion: 1,
		strategy: "snapshot",
		aliases: [],
	};
}

function buildArtifactBinding(intent: ResearchIntent): ResearchArtifactBinding {
	return {
		assignmentId: intent.requestId,
		definitionId: intent.definitionId,
		recommendationDigest: intent.recommendationDigest,
		route: intent.route,
		question: intent.question,
		domainAnchorDigest: intent.domainAnchorDigest,
	};
}

function mergeSkillRequirements(
	left: readonly SkillRequirement[],
	right: readonly SkillRequirement[],
): readonly SkillRequirement[] {
	const seen = new Set<string>();
	const merged: SkillRequirement[] = [];
	for (const requirement of [...left, ...right]) {
		if (seen.has(requirement.name)) continue;
		seen.add(requirement.name);
		merged.push(requirement);
	}
	return merged;
}

export function createWorkflowDelegate(
	dependencies: WorkflowDelegateDependencies,
) {
	let lastPreparedLaunch: PreparedLaunch | undefined;
	let lastResult: SubagentResult | undefined;

	async function delegate(intent: WorkflowIntent): Promise<SubagentResult> {
		if (intent.kind !== "research") {
			return {
				status: "blocked",
				executiveSummary: "Unsupported workflow intent.",
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: createBlocker(
					"PI_WORKFLOW_INTENT_UNSUPPORTED",
					`Workflow intent ${String((intent as { kind?: string }).kind ?? "unknown")} is unsupported.`,
				),
			};
		}
		const standards = await dependencies.standardsResolver.resolve({
			project: intent.project,
			affectedPaths: intent.affectedPaths,
		});
		if (!standards.ok) {
			return {
				status: "blocked",
				executiveSummary: standards.blocker.message,
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: standards.blocker,
			};
		}
		const skills = await dependencies.skillResolver.resolve(
			mergeSkillRequirements(intent.requiredSkills, standards.value.requiredSkills),
		);
		if (!skills.ok) {
			return {
				status: "blocked",
				executiveSummary: skills.blocker.message,
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: skills.blocker,
			};
		}
		const artifactGrant = buildArtifactGrant(intent);
		const agentValidation = await dependencies.agentValidator.validateResearchLaunch({
			skillRefs: skills.value,
			standardRefs: standards.value.standardRefs,
			artifactTopic: artifactGrant.topic,
		});
		if (!agentValidation.ok) {
			return {
				status: "blocked",
				executiveSummary: agentValidation.blocker.message,
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: agentValidation.blocker,
			};
		}
		const preparedLaunch: PreparedLaunch = {
			intent,
			prompt: buildResearchPrompt(intent.route, intent.question),
			skillRefs: skills.value,
			standardRefs: standards.value.standardRefs,
			artifactGrant,
			artifactSession: dependencies.artifactInterface.openSession(
				artifactGrant,
				buildArtifactBinding(intent),
			),
			launchProvenance: {
				agentName: "research",
				assetVersion: agentValidation.value.assetVersion,
				assetDigest: agentValidation.value.assetDigest,
				capabilityProfile: "research-reader",
				provider: "openai-codex",
				model: "gpt-5.6-terra",
				effort: "medium",
				inheritContext: false,
				promptMode: "replace",
				skillRefs: skills.value,
				standardRefs: standards.value.standardRefs,
				allowedTools: agentValidation.value.allowedTools,
				deniedCapabilities: agentValidation.value.deniedCapabilities,
				artifactTopic: artifactGrant.topic,
			},
		};
		lastPreparedLaunch = preparedLaunch;
		const launched = await dependencies.subagentLauncher.launch(preparedLaunch);
		if (!launched.ok) {
			return {
				status: "blocked",
				executiveSummary: launched.blocker.message,
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: launched.blocker,
			};
		}
		lastResult = launched.value;
		if (
			!sameLaunchProvenance(
				launched.value.launchProvenance,
				preparedLaunch.launchProvenance,
			)
		) {
			return {
				status: "blocked",
				executiveSummary:
					"The research launch provenance did not match the approved exact launch.",
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: createBlocker(
					"PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH",
					"The research launch provenance did not match the approved exact launch.",
				),
			};
		}
		if (launched.value.status === "blocked") return launched.value;
		const [artifact] = launched.value.artifacts;
		if (
			launched.value.artifacts.length !== 1 ||
			!artifact ||
			artifact.project !== artifactGrant.project.name ||
			artifact.topic !== artifactGrant.topic ||
			artifact.schema !== artifactGrant.schema ||
			artifact.schemaVersion !== artifactGrant.schemaVersion ||
			!preparedLaunch.artifactSession.hasVerifiedArtifact(artifact)
		) {
			return {
				status: "blocked",
				executiveSummary:
					"The research result did not include one verified Engram artifact for the granted topic.",
				artifacts: [],
				nextRecommended: { kind: "owner-action" },
				risks: [],
				blocker: createBlocker(
					"PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID",
					"The research result did not include one verified Engram artifact for the granted topic.",
				),
			};
		}
		return launched.value;
	}

	function inspect() {
		return { lastPreparedLaunch, lastResult };
	}

	function intervene() {
		return createBlocker(
			"PI_WORKFLOW_INTERVENTION_UNSUPPORTED",
			"Workflow intervention is unsupported for this research assignment.",
		);
	}

	return { delegate, inspect, intervene };
}

function buildResearchPrompt(route: Route, question: string): string {
	return [
		"Execute exactly one read-only research assignment.",
		`Confirmed route: ${route}.`,
		`Research question: ${question}`,
		"Use only the validated read-only tools and write exactly one verified research artifact.",
	].join(" ");
}
