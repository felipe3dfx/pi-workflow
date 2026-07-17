import type {
	Full4RExecutionInput,
	JudgmentDayExecutionInput,
	createDeliveryReviewWorkflow,
} from "./delivery-review-workflow.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";

export interface DeliveryRepositorySnapshot {
	branch: string;
	headCommit: string;
	treeDigest: string;
	clean: boolean;
}

type DeliveryAgent =
	| "sdd-design"
	| "sdd-tasks"
	| "sdd-apply"
	| "sdd-verify"
	| "prepare-commit";

interface DeliveryLaunchProvenance {
	agent: DeliveryAgent;
	provider: "openai-codex";
	model: "gpt-5.6-sol" | "gpt-5.6-terra";
	effort: "high" | "medium";
	capabilityProfile: "artifact-reader" | "code-writer" | "verifier";
}

interface DeliveryContext {
	ticket: {
		id: string;
		revision: string;
		parentId: string;
		state: string;
		comments: readonly string[];
	};
	parent: {
		id: string;
		revision: string;
		proposalSpecSatisfied: boolean;
		comments: readonly string[];
	};
	blockers: readonly string[];
	relations: readonly string[];
	capabilities: readonly string[];
	standards: readonly { path: string; digest: string }[];
	priorArtifacts: readonly unknown[];
	affectedPaths: readonly string[];
}

interface ArtifactRef {
	topic: string;
	revision: string;
	digest: string;
	schema: string;
	schemaVersion: number;
}

interface DeliveryBinding {
	ticketId: string;
	ticketRevision: string;
	parentId: string;
	parentRevision: string;
	repositoryDigest: string;
	standardsDigest: string;
}

interface PlanningArtifact {
	schema: "sdd-design" | "sdd-tasks";
	schemaVersion: 1;
	payload: Record<string, unknown>;
	digest: string;
	ref: ArtifactRef;
	binding: DeliveryBinding & { designDigest?: string };
}

export interface DeliveryPlanningResult {
	status: "planned";
	design: PlanningArtifact;
	tasks: PlanningArtifact;
	repository: DeliveryRepositorySnapshot;
	standards: readonly { path: string; digest: string }[];
}

interface TddCycle {
	behaviorId: string;
	red: {
		command: string;
		testIds: readonly string[];
		exitCode: number;
		outputDigest: string;
	};
	green: {
		command: string;
		testIds: readonly string[];
		exitCode: number;
		outputDigest: string;
	};
	refactor: {
		performed: boolean;
		command: string;
		exitCode: number;
		outputDigest: string;
		summary: string;
	};
}

interface ApplyBatch {
	batchKey: string;
	behaviorIds: readonly string[];
	changedPaths: readonly string[];
	repositoryBefore: DeliveryRepositorySnapshot;
	repositoryAfter: DeliveryRepositorySnapshot;
	cycles: readonly TddCycle[];
	digest?: string;
}

interface Checkpoint {
	ticketId: string;
	planningDigest: string;
	state: "running" | "interrupted" | "completed" | "cancelled";
	verifiedBatches: readonly (ApplyBatch & {
		digest: string;
		artifact: ArtifactRef;
	})[];
	repository: DeliveryRepositorySnapshot;
	sessionId?: string;
	cancellationReason?: string;
	commitReady?: {
		status: "commit-ready";
		verification: ArtifactRef;
		preparation: ArtifactRef;
		repository: DeliveryRepositorySnapshot;
		simplifyOffered: boolean;
	};
}

interface Dependencies {
	context: { read(ticketId: string): Promise<DeliveryContext> };
	repository: {
		inspect(): Promise<DeliveryRepositorySnapshot>;
		verifyCycle(cycle: TddCycle): Promise<boolean>;
		acceptSnapshot(snapshot: DeliveryRepositorySnapshot): Promise<void>;
		requiredEvidence?(
			snapshot: DeliveryRepositorySnapshot,
		): Promise<readonly { id: string; command: string }[]>;
		executeEvidence?(
			snapshot: DeliveryRepositorySnapshot,
			required: readonly { id: string; command: string }[],
		): Promise<{
			repositoryBefore: DeliveryRepositorySnapshot;
			repositoryAfter: DeliveryRepositorySnapshot;
			results: readonly {
				id: string;
				command: string;
				exitCode: number;
				outputDigest: string;
			}[];
		}>;
	};
	artifacts: {
		write(
			topic: string,
			envelope: Record<string, unknown>,
		): Promise<ArtifactRef>;
		read(ref: ArtifactRef): Promise<unknown>;
	};
	agents: {
		launch(launch: Record<string, unknown>): Promise<Record<string, unknown>>;
		cancel?(sessionId: string): Promise<void>;
	};
	checkpoints: {
		load(ticketId: string): Promise<Checkpoint | undefined>;
		save(checkpoint: Checkpoint): Promise<void>;
	};
	review?: Pick<
		ReturnType<typeof createDeliveryReviewWorkflow>,
		"runFull4R" | "runJudgmentDay"
	>;
}

export type DeliveryExtraordinaryReviewRequest =
	| { mode: "full-4r"; input: Full4RExecutionInput }
	| { mode: "judgment-day"; input: JudgmentDayExecutionInput };

const expectedProvenance: Record<DeliveryAgent, DeliveryLaunchProvenance> = {
	"sdd-design": {
		agent: "sdd-design",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		effort: "high",
		capabilityProfile: "artifact-reader",
	},
	"sdd-tasks": {
		agent: "sdd-tasks",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		capabilityProfile: "artifact-reader",
	},
	"sdd-apply": {
		agent: "sdd-apply",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		capabilityProfile: "code-writer",
	},
	"sdd-verify": {
		agent: "sdd-verify",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		effort: "medium",
		capabilityProfile: "verifier",
	},
	"prepare-commit": {
		agent: "prepare-commit",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		capabilityProfile: "verifier",
	},
};

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

function same(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function signedEnvelope<const Schema extends string>(
	schema: Schema,
	payload: Record<string, unknown>,
) {
	const unsigned = { schema, schemaVersion: 1 as const, payload };
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function validateProvenance(agent: DeliveryAgent, actual: unknown): void {
	if (!same(actual, expectedProvenance[agent]))
		fail(
			"PI_WORKFLOW_LAUNCH_PROVENANCE_MISMATCH",
			`The ${agent} launch provenance is incompatible.`,
		);
}

function validateRepository(
	actual: DeliveryRepositorySnapshot,
	expected: DeliveryRepositorySnapshot,
): void {
	if (!expected.clean || !same(actual, expected))
		fail(
			"PI_WORKFLOW_REPOSITORY_SNAPSHOT_MISMATCH",
			"The verified repository snapshot no longer matches the worktree.",
		);
}

async function persistVerified(
	dependencies: Dependencies,
	topic: string,
	envelope: ReturnType<typeof signedEnvelope>,
): Promise<ArtifactRef> {
	const ref = await dependencies.artifacts.write(topic, envelope);
	const readBack = await dependencies.artifacts.read(ref);
	if (
		!same(readBack, envelope) ||
		ref.digest !== envelope.digest ||
		ref.schema !== envelope.schema ||
		ref.schemaVersion !== 1
	) {
		fail(
			"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
			"The delivery artifact failed exact read-back verification.",
		);
	}
	return ref;
}

const readOnlyTools = [
	"read",
	"grep",
	"find",
	"ls",
	"workflow_artifact_session",
] as const;
const verificationTools = [
	...readOnlyTools,
	"verification_evidence",
] as const;
const applyTools = [
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"bash",
	"workflow_artifact_session",
] as const;
const denied = [
	"linear",
	"linear-publisher",
	"public-skill",
	"fan-out",
	"agent-launch",
	"private-namespace",
] as const;

function hasExactStandardResults(
	value: unknown,
	standards: readonly { path: string; digest: string }[],
	requirePass: boolean,
): boolean {
	return (
		Array.isArray(value) &&
		value.length === standards.length &&
		value.every((entry, index) => {
			if (!entry || typeof entry !== "object") return false;
			const result = entry as {
				path?: unknown;
				digest?: unknown;
				result?: unknown;
			};
			return (
				result.path === standards[index]?.path &&
				result.digest === standards[index]?.digest &&
				typeof result.result === "string" &&
				Boolean(result.result.trim()) &&
				(!requirePass || result.result === "passed")
			);
		})
	);
}

export function createDeliveryWorkflow(dependencies: Dependencies) {
	async function plan(input: {
		ticketId: string;
		repository: DeliveryRepositorySnapshot;
	}): Promise<DeliveryPlanningResult> {
		const actualRepository = await dependencies.repository.inspect();
		validateRepository(actualRepository, input.repository);
		const context = await dependencies.context.read(input.ticketId);
		const requiredCapabilities = ["comments", "relations", "blockers"];
		if (
			context.ticket.id !== input.ticketId ||
			context.ticket.state !== "In Progress" ||
			context.ticket.parentId !== context.parent.id ||
			!context.parent.proposalSpecSatisfied ||
			context.ticket.comments.length === 0 ||
			context.parent.comments.length === 0 ||
			requiredCapabilities.some(
				(capability) => !context.capabilities.includes(capability),
			) ||
			context.blockers.length > 0 ||
			context.standards.length === 0
		)
			fail(
				"PI_WORKFLOW_DELIVERY_CONTEXT_INCOMPLETE",
				"Complete verified parent, ticket, comments, blockers, relations, standards, and repository context is required.",
			);

		const binding = {
			ticketId: context.ticket.id,
			ticketRevision: context.ticket.revision,
			parentId: context.parent.id,
			parentRevision: context.parent.revision,
			repositoryDigest: digestCanonicalValue(input.repository),
			standardsDigest: digestCanonicalValue(context.standards),
		};
		const designLaunch = {
			agent: "sdd-design" as const,
			provenance: expectedProvenance["sdd-design"],
			tools: readOnlyTools,
			extensions: [],
			skills: [],
			deniedCapabilities: denied,
			context,
			standardRefs: context.standards,
		};
		const designResult = await dependencies.agents.launch(designLaunch);
		validateProvenance("sdd-design", designResult.provenance);
		if (!hasExactStandardResults(designResult.standards, context.standards, true))
			fail(
				"PI_WORKFLOW_PROJECT_STANDARDS_MISMATCH",
				"sdd-design must report passing compliance for every exact bound project standard.",
			);
		const designEnvelope = signedEnvelope("sdd-design", {
			binding,
			design: designResult.payload,
			standards: designResult.standards,
		});
		const designRef = await persistVerified(
			dependencies,
			`workflow/deliver-ticket/${input.ticketId}/design`,
			designEnvelope,
		);

		const tasksLaunch = {
			agent: "sdd-tasks" as const,
			provenance: expectedProvenance["sdd-tasks"],
			tools: readOnlyTools,
			extensions: [],
			skills: [],
			deniedCapabilities: denied,
			context,
			design: designRef,
			standardRefs: context.standards,
		};
		const tasksResult = await dependencies.agents.launch(tasksLaunch);
		validateProvenance("sdd-tasks", tasksResult.provenance);
		if (!hasExactStandardResults(tasksResult.standards, context.standards, true))
			fail(
				"PI_WORKFLOW_PROJECT_STANDARDS_MISMATCH",
				"sdd-tasks must report passing compliance for every exact bound project standard.",
			);
		const tasksBinding = { ...binding, designDigest: designEnvelope.digest };
		const tasksEnvelope = signedEnvelope("sdd-tasks", {
			binding: tasksBinding,
			tasks: tasksResult.payload,
			standards: tasksResult.standards,
		});
		const tasksRef = await persistVerified(
			dependencies,
			`workflow/deliver-ticket/${input.ticketId}/tasks`,
			tasksEnvelope,
		);
		return {
			status: "planned" as const,
			design: { ...designEnvelope, ref: designRef, binding },
			tasks: { ...tasksEnvelope, ref: tasksRef, binding: tasksBinding },
			repository: input.repository,
			standards: structuredClone(context.standards),
		};
	}

	function validatePlanning(
		input: unknown,
		ticketId: string,
	): asserts input is DeliveryPlanningResult {
		if (!input || typeof input !== "object")
			fail(
				"PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
				"A verified planning result is required.",
			);
		const planning = input as Partial<DeliveryPlanningResult>;
		const design = planning.design;
		const tasks = planning.tasks;
		if (
			planning.status !== "planned" ||
			!design ||
			!tasks ||
			!planning.repository ||
			!Array.isArray(planning.standards) ||
			planning.standards.length === 0 ||
			planning.standards.some(
				(standard) => !standard.path?.trim() || !standard.digest?.trim(),
			) ||
			design.schema !== "sdd-design" ||
			design.schemaVersion !== 1 ||
			tasks.schema !== "sdd-tasks" ||
			tasks.schemaVersion !== 1 ||
			design.binding.ticketId !== ticketId ||
			tasks.binding.ticketId !== ticketId ||
			tasks.binding.designDigest !== design.digest ||
			!same(design.binding, { ...tasks.binding, designDigest: undefined }) ||
			design.binding.repositoryDigest !==
				digestCanonicalValue(planning.repository) ||
			design.binding.standardsDigest !==
				digestCanonicalValue(planning.standards)
		)
			fail(
				"PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
				"Only a compatible verified design/tasks pair may be applied.",
			);
		for (const envelope of [design, tasks]) {
			const { digest, ref: _ref, binding: _binding, ...unsigned } = envelope;
			if (
				digestCanonicalValue(unsigned) !== digest ||
				envelope.ref.digest !== digest ||
				envelope.ref.schema !== envelope.schema ||
				envelope.ref.schemaVersion !== 1
			)
				fail(
					"PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
					"The planning artifact digest or reference is invalid.",
				);
		}
	}

	async function verifyPlanningReadBack(
		planning: DeliveryPlanningResult,
	): Promise<void> {
		for (const artifact of [planning.design, planning.tasks]) {
			const { ref: _ref, binding: _binding, ...envelope } = artifact;
			if (!same(await dependencies.artifacts.read(artifact.ref), envelope))
				fail(
					"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
					"The planning artifact no longer matches its verified read-back.",
				);
		}
	}

	function plannedBehaviorIds(
		planning: DeliveryPlanningResult,
	): readonly string[] {
		const taskResult = planning.tasks.payload.tasks;
		if (
			!taskResult ||
			typeof taskResult !== "object" ||
			!Array.isArray((taskResult as { tasks?: unknown }).tasks)
		)
			fail(
				"PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
				"The tasks artifact must contain an ordered task list.",
			);
		const ids = (taskResult as { tasks: unknown[] }).tasks.flatMap((task) =>
			task &&
			typeof task === "object" &&
			Array.isArray((task as { behaviorIds?: unknown }).behaviorIds)
				? (task as { behaviorIds: unknown[] }).behaviorIds
				: [],
		);
		if (
			ids.length === 0 ||
			ids.some((id) => typeof id !== "string" || !id.trim()) ||
			new Set(ids).size !== ids.length
		)
			fail(
				"PI_WORKFLOW_DELIVERY_ARTIFACT_MISMATCH",
				"Planned behavior IDs must be unique and non-empty.",
			);
		return ids as string[];
	}

	async function apply(input: {
		ticketId: string;
		planning: unknown;
		repository: DeliveryRepositorySnapshot;
	}) {
		validatePlanning(input.planning, input.ticketId);
		await verifyPlanningReadBack(input.planning);
		const expectedBehaviorIds = plannedBehaviorIds(input.planning);
		const planningDigest = digestCanonicalValue({
			design: input.planning.design.digest,
			tasks: input.planning.tasks.digest,
		});
		const previous = await dependencies.checkpoints.load(input.ticketId);
		if (
			previous?.planningDigest === planningDigest &&
			previous.state === "cancelled"
		)
			fail(
				"PI_WORKFLOW_DELIVERY_CANCELLED",
				"A cancelled delivery cannot be resumed implicitly.",
			);
		if (
			previous?.planningDigest === planningDigest &&
			previous.state === "completed"
		) {
			validateRepository(
				await dependencies.repository.inspect(),
				previous.repository,
			);
			return {
				status: "completed" as const,
				verifiedBatches: previous.verifiedBatches,
				repository: previous.repository,
			};
		}
		const resumable =
			previous &&
			previous.planningDigest === planningDigest &&
			(previous.state === "interrupted" || previous.state === "running");
		const expectedRepository = resumable
			? previous.repository
			: input.repository;
		const actualRepository = await dependencies.repository.inspect();
		validateRepository(actualRepository, expectedRepository);
		if (!resumable && !same(input.repository, input.planning.repository))
			fail(
				"PI_WORKFLOW_REPOSITORY_SNAPSHOT_MISMATCH",
				"Apply must start from the repository snapshot bound to planning.",
			);
		let verifiedBatches = resumable ? [...previous.verifiedBatches] : [];
		let currentRepository = expectedRepository;
		const sessionId =
			resumable && previous.sessionId
				? previous.sessionId
				: `delivery-${input.ticketId}-${planningDigest.slice(0, 16)}`;
		await dependencies.checkpoints.save({
			ticketId: input.ticketId,
			planningDigest,
			state: "running",
			verifiedBatches,
			repository: currentRepository,
			sessionId,
		});
		const launch = {
			agent: "sdd-apply" as const,
			provenance: expectedProvenance["sdd-apply"],
			tools: applyTools,
			extensions: [],
			skills: [],
			deniedCapabilities: denied,
			bashPolicy: {
				allowedPrefixes: [
					"git status",
					"git diff",
					"npm test",
					"npm run check",
					"node --test",
					"npx tsc",
				],
			},
			design: input.planning.design.ref,
			tasks: input.planning.tasks.ref,
			repository: currentRepository,
			verifiedBatches: verifiedBatches.map(({ artifact }) => artifact),
			standardRefs: input.planning.standards,
			sessionId,
			resumeSessionId: resumable ? previous.sessionId : undefined,
		};
		const result = (await dependencies.agents.launch(launch)) as {
			provenance?: unknown;
			batches?: readonly ApplyBatch[];
			completed?: boolean;
			standards?: unknown;
			sessionId?: string;
		};
		validateProvenance("sdd-apply", result.provenance);
		if (!hasExactStandardResults(result.standards, input.planning.standards, true))
			fail(
				"PI_WORKFLOW_PROJECT_STANDARDS_MISMATCH",
				"sdd-apply must report passing compliance for every exact bound project standard.",
			);
		const afterLaunch = await dependencies.checkpoints.load(input.ticketId);
		if (afterLaunch?.state === "cancelled")
			return {
				status: "cancelled" as const,
				verifiedBatches: afterLaunch.verifiedBatches,
				repository: afterLaunch.repository,
			};
		for (const candidate of result.batches ?? []) {
			const unsignedBatch = { ...candidate, digest: undefined };
			const digest = digestCanonicalValue(unsignedBatch);
			const existing = verifiedBatches.find(
				(batch) => batch.batchKey === candidate.batchKey,
			);
			if (existing) {
				if (existing.digest !== digest)
					fail(
						"PI_WORKFLOW_APPLY_BATCH_CONFLICT",
						"A verified apply batch cannot change during resume.",
					);
				continue;
			}
			if (
				!candidate.batchKey?.trim() ||
				!same(candidate.repositoryBefore, currentRepository) ||
				candidate.behaviorIds.length === 0 ||
				new Set(candidate.behaviorIds).size !== candidate.behaviorIds.length ||
				candidate.cycles.length !== candidate.behaviorIds.length ||
				new Set(candidate.cycles.map((cycle) => cycle.behaviorId)).size !==
					candidate.cycles.length ||
				candidate.changedPaths.length === 0 ||
				candidate.changedPaths.some((path) => !path.trim())
			)
				fail(
					"PI_WORKFLOW_TDD_EVIDENCE_INVALID",
					"Each apply batch must bind the current repository and every behavior to one TDD cycle.",
				);
			for (const behaviorId of candidate.behaviorIds) {
				const cycle = candidate.cycles.find(
					(entry) => entry.behaviorId === behaviorId,
				);
				if (
					!cycle ||
					!cycle.red.command.trim() ||
					!cycle.green.command.trim() ||
					!cycle.refactor.command.trim() ||
					!cycle.red.outputDigest.trim() ||
					!cycle.green.outputDigest.trim() ||
					!cycle.refactor.outputDigest.trim() ||
					!cycle.refactor.summary.trim() ||
					cycle.red.exitCode === 0 ||
					cycle.green.exitCode !== 0 ||
					cycle.refactor.exitCode !== 0 ||
					!cycle.red.testIds.includes(behaviorId) ||
					!cycle.green.testIds.includes(behaviorId) ||
					!(await dependencies.repository.verifyCycle(cycle))
				)
					fail(
						"PI_WORKFLOW_TDD_EVIDENCE_INVALID",
						"Red, green, and refactor evidence must be repository-verified for every behavior change.",
					);
			}
			await dependencies.repository.acceptSnapshot(candidate.repositoryAfter);
			validateRepository(
				await dependencies.repository.inspect(),
				candidate.repositoryAfter,
			);
			const batchEnvelope = signedEnvelope("sdd-apply", {
				ticketId: input.ticketId,
				planningDigest,
				batch: { ...unsignedBatch, digest },
				standards: result.standards,
			});
			const artifact = await persistVerified(
				dependencies,
				`workflow/deliver-ticket/${input.ticketId}/apply/${candidate.batchKey}`,
				batchEnvelope,
			);
			verifiedBatches = [
				...verifiedBatches,
				{ ...candidate, digest, artifact },
			];
			currentRepository = candidate.repositoryAfter;
			await dependencies.checkpoints.save({
				ticketId: input.ticketId,
				planningDigest,
				state: "running",
				verifiedBatches,
				repository: currentRepository,
				sessionId,
			});
		}
		const coveredBehaviorIds = new Set(
			verifiedBatches.flatMap((batch) => batch.behaviorIds),
		);
		const fullyCovered =
			expectedBehaviorIds.every((behaviorId) =>
				coveredBehaviorIds.has(behaviorId),
			) && coveredBehaviorIds.size === expectedBehaviorIds.length;
		const state =
			result.completed === true && fullyCovered ? "completed" : "interrupted";
		await dependencies.checkpoints.save({
			ticketId: input.ticketId,
			planningDigest,
			state,
			verifiedBatches,
			repository: currentRepository,
			sessionId,
		});
		return { status: state, verifiedBatches, repository: currentRepository };
	}

	async function prepare(input: {
		ticketId: string;
		planning: unknown;
		applied?: unknown;
		developerRequestedSimplify?: boolean;
	}) {
		const planning = input.planning;
		validatePlanning(planning, input.ticketId);
		await verifyPlanningReadBack(planning);
		const planningDigest = digestCanonicalValue({
			design: planning.design.digest,
			tasks: planning.tasks.digest,
		});
		const checkpoint = await dependencies.checkpoints.load(input.ticketId);
		if (
			!checkpoint ||
			checkpoint.state !== "completed" ||
			checkpoint.planningDigest !== planningDigest
		)
			fail(
				"PI_WORKFLOW_DELIVERY_APPLY_REQUIRED",
				"Prepare requires the valid completed apply bound to this planning result.",
			);
		const supplied = input.applied as
			| { status?: unknown; repository?: DeliveryRepositorySnapshot }
			| undefined;
		if (
			supplied &&
			(supplied.status !== "completed" ||
				!supplied.repository ||
				!same(supplied.repository, checkpoint.repository))
		)
			fail(
				"PI_WORKFLOW_DELIVERY_APPLY_REQUIRED",
				"The supplied apply result does not match the completed apply checkpoint.",
			);
		validateRepository(
			await dependencies.repository.inspect(),
			checkpoint.repository,
		);
		if (checkpoint.commitReady) {
			for (const ref of [
				checkpoint.commitReady.verification,
				checkpoint.commitReady.preparation,
			]) {
				const envelope = await dependencies.artifacts.read(ref);
				if (!envelope || typeof envelope !== "object")
					fail(
						"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
						"Commit-ready recovery requires both exact verified artifacts.",
					);
				const { digest, ...unsigned } = envelope as Record<string, unknown>;
				if (digest !== ref.digest || digestCanonicalValue(unsigned) !== digest)
					fail(
						"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
						"Commit-ready recovery requires both exact verified artifacts.",
					);
			}
			return checkpoint.commitReady;
		}
		const applied = {
			status: "completed" as const,
			repository: checkpoint.repository,
		};
		const required = await dependencies.repository.requiredEvidence?.(
			applied.repository,
		);
		if (
			!required ||
			required.length === 0 ||
			required.some(
				(entry) =>
					!entry ||
					typeof entry.id !== "string" ||
					!entry.id.trim() ||
					typeof entry.command !== "string" ||
					!entry.command.trim(),
			) ||
			new Set(required.map(({ id }) => id)).size !== required.length
		)
			fail(
				"PI_WORKFLOW_DELIVERY_EVIDENCE_INVALID",
				"Evidence requirements must contain unique non-empty IDs and commands.",
			);
		const result = await dependencies.agents.launch({
			agent: "sdd-verify",
			provenance: expectedProvenance["sdd-verify"],
			tools: verificationTools,
			extensions: [],
			skills: [],
			deniedCapabilities: denied,
			repository: applied.repository,
			requiredEvidence: required,
			executeEvidence: () =>
				dependencies.repository.executeEvidence?.(applied.repository, required),
			standardRefs: planning.standards,
		});
		validateProvenance("sdd-verify", result.provenance);
		const evidence = result.evidence as
			| {
					repositoryBefore: DeliveryRepositorySnapshot;
					repositoryAfter: DeliveryRepositorySnapshot;
					results: readonly {
						id: string;
						command: string;
						exitCode: number;
						outputDigest: string;
					}[];
			  }
			| undefined;
		if (
			!evidence ||
			!same(evidence.repositoryBefore, applied.repository) ||
			!same(evidence.repositoryAfter, applied.repository) ||
			!Array.isArray(evidence.results) ||
			evidence.results.length !== required.length ||
			evidence.results.some((entry, index) => {
				const expected = required[index];
				return (
					!entry ||
					!expected ||
					entry.id !== expected.id ||
					entry.command !== expected.command ||
					entry.exitCode !== 0 ||
					typeof entry.outputDigest !== "string" ||
					!entry.outputDigest.trim()
				);
			})
		)
			fail(
				"PI_WORKFLOW_DELIVERY_EVIDENCE_INVALID",
				"sdd-verify must execute and return exact evidence against one stable applied snapshot.",
			);
		validateRepository(
			await dependencies.repository.inspect(),
			applied.repository,
		);
		if (!hasExactStandardResults(result.standards, planning.standards, result.verified === true))
			fail(
				"PI_WORKFLOW_PROJECT_STANDARDS_MISMATCH",
				"sdd-verify must report one result for every exact bound project standard.",
			);
		const envelope = signedEnvelope("sdd-verify", {
			ticketId: input.ticketId,
			repository: applied.repository,
			requiredEvidence: required,
			evidence,
			result,
		});
		const artifact = await persistVerified(
			dependencies,
			`workflow/deliver-ticket/${input.ticketId}/verify`,
			envelope,
		);
		if (result.verified !== true)
			return {
				status: "verification-failed" as const,
				verification: artifact,
				simplifyOffered: false,
			};
		const prepareResult = await dependencies.agents.launch({
			agent: "prepare-commit",
			provenance: expectedProvenance["prepare-commit"],
			tools: readOnlyTools,
			extensions: [],
			skills: [],
			deniedCapabilities: denied,
			repository: applied.repository,
			verification: artifact,
			standardRefs: planning.standards,
		});
		validateProvenance("prepare-commit", prepareResult.provenance);
		const prepareEnvelope = signedEnvelope("prepare-commit", {
			ticketId: input.ticketId,
			repository: applied.repository,
			verification: artifact,
			standards: planning.standards,
			result: prepareResult,
		});
		const prepareArtifact = await persistVerified(
			dependencies,
			`workflow/deliver-ticket/${input.ticketId}/prepare-commit`,
			prepareEnvelope,
		);
		const standardResults = Array.isArray(prepareResult.standards)
			? prepareResult.standards
			: [];
		if (!hasExactStandardResults(standardResults, planning.standards, false))
			fail(
				"PI_WORKFLOW_PREPARE_COMMIT_INVALID",
				"Prepare-commit must return one exact result per bound project standard.",
			);
		const allStandardsPassed = standardResults.every(
			(entry) => (entry as { result: string }).result === "passed",
		);
		if (prepareResult.status === "refused") {
			if (
				!Array.isArray(prepareResult.reasons) ||
				prepareResult.reasons.length === 0 ||
				prepareResult.reasons.some(
					(reason) => typeof reason !== "string" || !reason.trim(),
				)
			)
				fail(
					"PI_WORKFLOW_PREPARE_COMMIT_INVALID",
					"A prepare-commit refusal requires concrete auditable reasons.",
				);
			return {
				status: "prepare-refused" as const,
				verification: artifact,
				preparation: prepareArtifact,
				simplifyOffered: false,
			};
		}
		if (
			prepareResult.status !== "passed" ||
			prepareResult.code !== "passed" ||
			prepareResult.architecture !== "passed" ||
			prepareResult.tests !== "passed" ||
			!allStandardsPassed
		)
			fail(
				"PI_WORKFLOW_PREPARE_COMMIT_INVALID",
				"Prepare-commit must pass code, architecture, tests, and every exact bound project standard.",
			);
		validateRepository(
			await dependencies.repository.inspect(),
			applied.repository,
		);
		const validatedClarityFinding =
			Array.isArray(result.findings) &&
			result.findings.some(
				(finding) =>
					finding !== null &&
					typeof finding === "object" &&
					(finding as { kind?: unknown }).kind === "clarity" &&
					(finding as { validated?: unknown }).validated === true &&
					typeof (finding as { detail?: unknown }).detail === "string" &&
					Boolean((finding as { detail: string }).detail.trim()),
			);
		const commitReady = {
			status: "commit-ready" as const,
			verification: artifact,
			preparation: prepareArtifact,
			repository: applied.repository,
			simplifyOffered:
				input.developerRequestedSimplify === true || validatedClarityFinding,
		};
		await dependencies.checkpoints.save({ ...checkpoint, commitReady });
		return commitReady;
	}

	async function runExtraordinaryReview(
		request: DeliveryExtraordinaryReviewRequest,
	) {
		if (!dependencies.review) {
			fail(
				"PI_WORKFLOW_DELIVERY_REVIEW_UNAVAILABLE",
				"Extraordinary review is not configured for this delivery runtime.",
			);
		}
		return request.mode === "full-4r"
			? dependencies.review.runFull4R(request.input)
			: dependencies.review.runJudgmentDay(request.input);
	}

	async function cancel(input: { ticketId: string; reason: string }) {
		const checkpoint = await dependencies.checkpoints.load(input.ticketId);
		if (!checkpoint)
			fail(
				"PI_WORKFLOW_DELIVERY_PLAN_REQUIRED",
				"No active delivery can be cancelled.",
			);
		await dependencies.checkpoints.save({
			...checkpoint,
			state: "cancelled",
			cancellationReason: input.reason.trim() || "Cancelled by the Developer.",
		});
		if (checkpoint.sessionId)
			await dependencies.agents.cancel?.(checkpoint.sessionId);
		return {
			status: "cancelled" as const,
			verifiedBatches: checkpoint.verifiedBatches,
			repository: checkpoint.repository,
		};
	}

	return { plan, apply, prepare, runExtraordinaryReview, cancel };
}
