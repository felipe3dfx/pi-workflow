import {
	canonicalJson,
	createBlocker,
	digestCanonicalValue,
	sameLaunchProvenance,
	uniqueVerifiedArtifactRefs,
	type ArtifactBinding,
	type ArtifactGrant,
	type DelegationCheckpoint,
	type DigestedRef,
	type ExactLaunchProvenance,
	type Intervention,
	type PreparedLaunch,
	type ProjectRef,
	type SkillRequirement,
	type SubagentResult,
	type WorkflowIntent,
} from "./workflow-contracts.ts";
import type { SkillResolution } from "./skill-resolver.ts";
import type { ProjectStandardsResolution } from "./project-standards-resolver.ts";
import type { AgentValidation } from "./agent-validator.ts";
import type { LaunchAttempt, LaunchOptions } from "./subagent-launcher.ts";
import {
	createInMemoryDelegationCheckpointStore,
	type DelegationCheckpointStore,
} from "./delegation-checkpoints.ts";

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
		validateResearchLaunch?(input: {
			skillRefs: readonly DigestedRef[];
			standardRefs: readonly DigestedRef[];
			artifactTopic: string;
		}): Promise<AgentValidation>;
		validateExplorationLaunch?(input: {
			intent: "prototype" | "design-alternative";
			skillRefs: readonly DigestedRef[];
			standardRefs: readonly DigestedRef[];
			artifactTopic: string;
		}): Promise<AgentValidation>;
	};
	artifactInterface: {
		writeCapabilityBlocker?(): ReturnType<typeof createBlocker> | undefined;
		openSession(
			grant: ArtifactGrant,
			expected?: ArtifactBinding,
		): PreparedLaunch["artifactSession"];
	};
	subagentLauncher: {
		launch(
			preparedLaunch: PreparedLaunch,
			options?: LaunchOptions,
		): Promise<LaunchAttempt>;
		intervene?(sessionId: string, intervention: Intervention): Promise<void>;
	};
	checkpointStore?: DelegationCheckpointStore;
	createSessionId?(): string;
	now?(): number;
}

function buildArtifactGrant(intent: WorkflowIntent): ArtifactGrant {
	if (intent.kind === "research") {
		return {
			project: intent.project,
			topic: intent.targetTopic,
			schema: "research-evidence",
			schemaVersion: 1,
			strategy: "snapshot",
			aliases: [],
		};
	}
	return {
		project: intent.project,
		topic: intent.targetTopic,
		schema: "design-exploration",
		schemaVersion: 1,
		strategy: "snapshot",
		aliases: intent.readableArtifacts,
	};
}

function buildArtifactBinding(
	intent: WorkflowIntent,
	launchProvenance: ExactLaunchProvenance,
	skillRefs: readonly DigestedRef[],
	standardRefs: readonly DigestedRef[],
): ArtifactBinding {
	if (intent.kind === "research") {
		return {
			assignmentId: intent.requestId,
			definitionId: intent.definitionId,
			recommendationDigest: intent.recommendationDigest,
			route: intent.route,
			question: intent.question,
			domainAnchorDigest: intent.domainAnchorDigest,
		};
	}
	return {
		kind: "design-exploration",
		assignmentId: intent.requestId,
		definitionId: intent.definitionId,
		intent: intent.kind,
		focus: intent.focus,
		domainAnchorDigest: intent.domainAnchorDigest,
		sourceArtifacts: intent.readableArtifacts.map(({ ref }) => ref),
		skillRefs,
		standardRefs,
		launchProvenance,
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

function identity(intent: WorkflowIntent): string {
	return digestCanonicalValue({
		kind: intent.kind,
		requestId: intent.requestId,
		definitionId: intent.definitionId,
		project: intent.project.name,
	});
}

function intentFingerprint(intent: WorkflowIntent): string {
	return digestCanonicalValue(intent);
}

function blocked(
	code: Parameters<typeof createBlocker>[0],
	message: string,
	launchProvenance?: ExactLaunchProvenance,
): SubagentResult {
	return {
		status: "blocked",
		executiveSummary: message,
		artifacts: [],
		nextRecommended: { kind: "owner-action" },
		risks: [],
		blocker: createBlocker(code, message),
		...(launchProvenance ? { launchProvenance } : {}),
	};
}

function expandedPaths(
	current: readonly string[],
	discovered: readonly string[] | undefined,
): readonly string[] | undefined {
	if (!discovered?.length) return undefined;
	const merged = [...current];
	for (const path of discovered) {
		if (!merged.includes(path)) merged.push(path);
	}
	return merged.length === current.length ? undefined : merged;
}

export function createWorkflowDelegate(
	dependencies: WorkflowDelegateDependencies,
) {
	const checkpointStore =
		dependencies.checkpointStore ?? createInMemoryDelegationCheckpointStore();
	const now = dependencies.now ?? Date.now;
	let lastPreparedLaunch: PreparedLaunch | undefined;
	let lastResult: SubagentResult | undefined;

	async function prepare(
		intent: WorkflowIntent,
		affectedPaths: readonly string[],
	): Promise<
		| { ok: true; value: PreparedLaunch }
		| { ok: false; result: SubagentResult }
	> {
		const capabilityBlocker =
			dependencies.artifactInterface.writeCapabilityBlocker?.();
		if (capabilityBlocker) {
			return {
				ok: false,
				result: blocked(capabilityBlocker.code, capabilityBlocker.message),
			};
		}
		const standards = await dependencies.standardsResolver.resolve({
			project: intent.project,
			affectedPaths,
		});
		if (!standards.ok) {
			return {
				ok: false,
				result: blocked(standards.blocker.code, standards.blocker.message),
			};
		}
		const skills = await dependencies.skillResolver.resolve(
			mergeSkillRequirements(
				intent.requiredSkills,
				standards.value.requiredSkills,
			),
		);
		if (!skills.ok) {
			return {
				ok: false,
				result: blocked(skills.blocker.code, skills.blocker.message),
			};
		}
		const artifactGrant = buildArtifactGrant(intent);
		const validationInput = {
			skillRefs: skills.value,
			standardRefs: standards.value.standardRefs,
			artifactTopic: artifactGrant.topic,
		};
		const agentValidation =
			intent.kind === "research"
				? await dependencies.agentValidator.validateResearchLaunch?.(
						validationInput,
					)
				: await dependencies.agentValidator.validateExplorationLaunch?.({
						...validationInput,
						intent: intent.kind,
					});
		if (!agentValidation?.ok) {
			const blockerValue = agentValidation?.blocker ??
				createBlocker(
					"PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
					`No exact validator is configured for ${intent.kind}.`,
				);
			return {
				ok: false,
				result: blocked(blockerValue.code, blockerValue.message),
			};
		}
		const launchProvenance: ExactLaunchProvenance = {
			agentName: intent.kind === "research" ? "research" : "prototype",
			assetVersion: agentValidation.value.assetVersion,
			assetDigest: agentValidation.value.assetDigest,
			capabilityProfile:
				intent.kind === "research" ? "research-reader" : "isolated-prototype",
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
		};
		const fingerprint = digestCanonicalValue({
			intent: { ...intent, affectedPaths },
			launchProvenance,
			artifactGrant,
		});
		return {
			ok: true,
			value: {
				intent: { ...intent, affectedPaths },
				prompt: buildPrompt(intent),
				skillRefs: skills.value,
				standardRefs: standards.value.standardRefs,
				artifactGrant,
				artifactSession: dependencies.artifactInterface.openSession(
					artifactGrant,
					buildArtifactBinding(
						intent,
						launchProvenance,
						skills.value,
						standards.value.standardRefs,
					),
				),
				launchProvenance,
				fingerprint,
			},
		};
	}

	async function delegate(intent: WorkflowIntent): Promise<SubagentResult> {
		if (
			intent.kind !== "research" &&
			intent.kind !== "prototype" &&
			intent.kind !== "design-alternative"
		) {
			return blocked(
				"PI_WORKFLOW_INTENT_UNSUPPORTED",
				`Workflow intent ${String((intent as { kind?: string }).kind ?? "unknown")} is unsupported.`,
			);
		}
		const delegationIdentity = identity(intent);
		const currentIntentFingerprint = intentFingerprint(intent);
		const stored = await checkpointStore.load(delegationIdentity);
		const compatibleIntent =
			stored?.checkpoint.intentFingerprint === currentIntentFingerprint &&
			stored.checkpoint.state === "interrupted";
		const carriedVerifiedArtifacts = stored?.checkpoint.verifiedArtifacts ?? [];
		let affectedPaths = [...intent.affectedPaths];
		let attempt: 1 | 2 = 1;
		let expectedCheckpointRevision = stored?.revision;
		let resumeSessionId: string | undefined;

		while (true) {
			const prepared = await prepare(intent, affectedPaths);
			if (!prepared.ok) return prepared.result;
			lastPreparedLaunch = prepared.value;
			resumeSessionId =
				attempt === 1 &&
				compatibleIntent &&
				stored.checkpoint.launchFingerprint === prepared.value.fingerprint
					? stored.checkpoint.sessionId
					: undefined;
			const sessionId =
				resumeSessionId ??
				dependencies.createSessionId?.() ??
				`${delegationIdentity}-attempt-${attempt}`;
			const running: DelegationCheckpoint = {
				identity: delegationIdentity,
				intentFingerprint: currentIntentFingerprint,
				launchFingerprint: prepared.value.fingerprint,
				sessionId,
				attempt,
				interventions: stored?.checkpoint.interventions ?? [],
				state: "running",
				verifiedArtifacts: carriedVerifiedArtifacts,
				updatedAt: now(),
			};
			const savedRunning = await checkpointStore.save(
				running,
				expectedCheckpointRevision,
			);
			expectedCheckpointRevision = savedRunning.revision;
			const launchOptions: LaunchOptions = {
				attempt,
				sessionId,
				...(resumeSessionId ? { resumeSessionId } : {}),
				verifiedArtifacts: carriedVerifiedArtifacts,
			};
			const launched = await dependencies.subagentLauncher.launch(
				prepared.value,
				launchOptions,
			);
			const afterLaunch = await checkpointStore.load(delegationIdentity);
			if (afterLaunch?.checkpoint.state === "cancelled") {
				lastResult = blocked(
					"PI_WORKFLOW_DELEGATION_CANCELLED",
					"The Owner cancelled this delegation; late or partial output was discarded.",
					prepared.value.launchProvenance,
				);
				return lastResult;
			}
			expectedCheckpointRevision = afterLaunch?.revision;
			if (!launched.ok) {
				const interrupted = launched.interrupted === true;
				const result = interrupted
					? blocked(
							"PI_WORKFLOW_DELEGATION_INTERRUPTED",
							launched.blocker.message,
							prepared.value.launchProvenance,
						)
					: blocked(
							launched.blocker.code,
							launched.blocker.message,
							prepared.value.launchProvenance,
						);
				await checkpointStore.save(
					{
						...running,
						sessionId: launched.sessionId ?? sessionId,
						state: interrupted ? "interrupted" : "blocked",
						verifiedArtifacts: uniqueVerifiedArtifactRefs([
							...carriedVerifiedArtifacts,
							...(launched.verifiedArtifacts ?? []),
						]),
						updatedAt: now(),
					},
					expectedCheckpointRevision,
				);
				lastResult = result;
				return result;
			}
			const result = validateTerminalResult(prepared.value, launched.value);
			if (result.status === "blocked") {
				lastResult = result;
				await checkpointStore.save(
					{ ...running, state: "blocked", updatedAt: now() },
					expectedCheckpointRevision,
				);
				return result;
			}
			let verifiedDiscoveredPaths: readonly string[] | undefined;
			if (launched.discoveredPaths?.length) {
				try {
					verifiedDiscoveredPaths =
						await prepared.value.artifactSession.verifyDiscoveredPaths(
							launched.discoveredPaths,
							result.artifacts,
						);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const invalid = blocked(
						"PI_WORKFLOW_DISCOVERED_PATH_INVALID",
						message,
						prepared.value.launchProvenance,
					);
					await checkpointStore.save(
						{ ...running, state: "blocked", updatedAt: now() },
						expectedCheckpointRevision,
					);
					lastResult = invalid;
					return invalid;
				}
			}
			const newlyExpanded = expandedPaths(
				affectedPaths,
				verifiedDiscoveredPaths,
			);
			if (newlyExpanded) {
				if (attempt === 2) {
					const result = blocked(
						"PI_WORKFLOW_RETRY_EXHAUSTED",
						"The corrective retry discovered additional uncovered paths and was stopped.",
						prepared.value.launchProvenance,
					);
					await checkpointStore.save(
						{ ...running, state: "blocked", updatedAt: now() },
						expectedCheckpointRevision,
					);
					return result;
				}
				affectedPaths = [...newlyExpanded];
				attempt = 2;
				resumeSessionId = undefined;
				continue;
			}
			lastResult = result;
			await checkpointStore.save(
				{
					...running,
					state: result.status === "completed" ? "completed" : "blocked",
					verifiedArtifacts: uniqueVerifiedArtifactRefs([
						...carriedVerifiedArtifacts,
						...(result.status === "completed" ? result.artifacts : []),
					]),
					updatedAt: now(),
				},
				expectedCheckpointRevision,
			);
			return result;
		}
	}

	function inspect() {
		return { lastPreparedLaunch, lastResult };
	}

	async function intervene(
		intent: WorkflowIntent,
		intervention: Intervention,
	): Promise<undefined | ReturnType<typeof createBlocker>> {
		const stored = await checkpointStore.load(identity(intent));
		if (stored?.checkpoint.state !== "running" || !stored.checkpoint.sessionId) {
			return createBlocker(
				"PI_WORKFLOW_INTERVENTION_INVALID",
				"Workflow intervention requires a currently running compatible delegation.",
			);
		}
		const interventionKeys = Object.keys(intervention).sort();
		const expectedInterventionKeys =
			intervention.kind === "steer"
				? ["guidance", "kind"]
				: ["kind", "reason"];
		if (
			canonicalJson(interventionKeys) !==
				canonicalJson(expectedInterventionKeys) ||
			(intervention.kind === "steer" && !intervention.guidance.trim()) ||
			(intervention.kind === "cancel" && !intervention.reason.trim())
		) {
			return createBlocker(
				"PI_WORKFLOW_INTERVENTION_INVALID",
				"Workflow intervention guidance or reason must be non-empty.",
			);
		}
		await checkpointStore.save(
			{
				...stored.checkpoint,
				interventions: [...stored.checkpoint.interventions, intervention],
				state:
					intervention.kind === "cancel"
						? "cancelled"
						: stored.checkpoint.state,
				updatedAt: now(),
			},
			stored.revision,
		);
		await dependencies.subagentLauncher.intervene?.(
			stored.checkpoint.sessionId,
			intervention,
		);
	}

	return { delegate, inspect, intervene };
}

function validateTerminalResult(
	preparedLaunch: PreparedLaunch,
	result: SubagentResult,
): SubagentResult {
	if (!sameLaunchProvenance(result.launchProvenance, preparedLaunch.launchProvenance)) {
		return blocked(
			"PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH",
			"The launch provenance did not match the approved exact launch.",
		);
	}
	if (result.status === "blocked") return result;
	const [artifact] = result.artifacts;
	if (
		result.artifacts.length !== 1 ||
		!artifact ||
		artifact.project !== preparedLaunch.artifactGrant.project.name ||
		artifact.topic !== preparedLaunch.artifactGrant.topic ||
		artifact.schema !== preparedLaunch.artifactGrant.schema ||
		artifact.schemaVersion !== preparedLaunch.artifactGrant.schemaVersion ||
		!preparedLaunch.artifactSession.hasVerifiedArtifact(artifact)
	) {
		return blocked(
			preparedLaunch.intent.kind === "research"
				? "PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID"
				: "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
			"The result did not include one verified Engram artifact for the granted topic.",
			preparedLaunch.launchProvenance,
		);
	}
	return result;
}

function buildPrompt(intent: WorkflowIntent): string {
	if (intent.kind === "research") {
		return [
			"Execute exactly one read-only research assignment.",
			`Confirmed route: ${intent.route}.`,
			`Research question: ${intent.question}`,
			"Use only the validated read-only tools and write exactly one verified research artifact.",
		].join(" ");
	}
	return [
		`Execute exactly one ${intent.kind} assignment.`,
		`Focus: ${intent.focus}`,
		"Read only granted artifact aliases; never expose raw workflow history.",
		"Return one comparable design-exploration artifact for the Owner.",
	].join(" ");
}
