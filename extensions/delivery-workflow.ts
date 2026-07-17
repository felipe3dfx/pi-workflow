import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";

export interface DeliveryRepositorySnapshot {
	branch: string;
	headCommit: string;
	treeDigest: string;
	clean: boolean;
}

type DeliveryAgent = "sdd-design" | "sdd-tasks" | "sdd-apply";

interface DeliveryLaunchProvenance {
	agent: DeliveryAgent;
	provider: "openai-codex";
	model: "gpt-5.6-sol" | "gpt-5.6-terra";
	effort: "high" | "medium";
	capabilityProfile: "artifact-reader" | "code-writer";
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
}

interface Dependencies {
	context: { read(ticketId: string): Promise<DeliveryContext> };
	repository: {
		inspect(): Promise<DeliveryRepositorySnapshot>;
		verifyCycle(cycle: TddCycle): Promise<boolean>;
		acceptSnapshot(snapshot: DeliveryRepositorySnapshot): Promise<void>;
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
}

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
		const designEnvelope = signedEnvelope("sdd-design", {
			binding,
			design: designResult.payload,
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
		const tasksBinding = { ...binding, designDigest: designEnvelope.digest };
		const tasksEnvelope = signedEnvelope("sdd-tasks", {
			binding: tasksBinding,
			tasks: tasksResult.payload,
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
			design.schema !== "sdd-design" ||
			design.schemaVersion !== 1 ||
			tasks.schema !== "sdd-tasks" ||
			tasks.schemaVersion !== 1 ||
			design.binding.ticketId !== ticketId ||
			tasks.binding.ticketId !== ticketId ||
			tasks.binding.designDigest !== design.digest ||
			!same(design.binding, { ...tasks.binding, designDigest: undefined }) ||
			design.binding.repositoryDigest !==
				digestCanonicalValue(planning.repository)
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
			sessionId,
			resumeSessionId: resumable ? previous.sessionId : undefined,
		};
		const result = (await dependencies.agents.launch(launch)) as {
			provenance?: unknown;
			batches?: readonly ApplyBatch[];
			completed?: boolean;
			sessionId?: string;
		};
		validateProvenance("sdd-apply", result.provenance);
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

	return { plan, apply, cancel };
}
