import type {
	AuthenticatedDecisionActor,
	DecisionRequest,
	ExecutionLease,
	TypedDecisionAction,
} from "./interactive-decisions.ts";
import type { PiInteractiveDecisions } from "./pi-decision-adapter.ts";
import {
	canonicalJson,
	digestCanonicalValue,
} from "./workflow-contracts.ts";

export interface DeliveryPullRequestSnapshot {
	branch: string;
	headCommit: string;
	treeDigest: string;
	diffDigest: string;
	clean: boolean;
}

export interface DeliveryPullRequestDraft {
	ticketId: string;
	head: string;
	target: string;
	title: string;
	description: string;
	link: string;
	evidence: {
		headCommit: string;
		treeDigest: string;
		diffDigest: string;
	};
}

interface DeliveryPublishedPullRequest {
	readonly url: string;
	readonly draft: DeliveryPullRequestDraft;
}

export interface DeliveryPullRequestGateway {
	inspect(): Promise<DeliveryPullRequestSnapshot>;
	compareLink(input: { head: string; target: string }): string;
	find(input: {
		head: string;
		target: string;
	}): Promise<readonly DeliveryPublishedPullRequest[]>;
	publish(input: {
		draft: DeliveryPullRequestDraft;
		expectedSnapshot: DeliveryPullRequestSnapshot;
		executionId: string;
	}): Promise<{ url: string }>;
}

export interface DeliveryDeveloperAuthority extends AuthenticatedDecisionActor {
	readonly role: "Developer";
}

type DeliveryPullRequestExecutionBinding = Pick<
	ExecutionLease,
	"decisionId" | "operationDigest" | "executionId" | "generation"
>;

interface DeliveryPullRequestManifestIdentity {
	readonly ticket: {
		readonly id: string;
		readonly title: string;
		readonly state: "In Progress";
	};
	readonly snapshot: DeliveryPullRequestSnapshot;
	readonly target: string;
	readonly draft: DeliveryPullRequestDraft;
}

type DeliveryPullRequestManifestStage =
	| "prepared"
	| "reviewed"
	| "review-rejected"
	| "review-drifted"
	| "publishing"
	| "publication-uncertain"
	| "publication-rejected"
	| "publication-drifted"
	| "published";

interface DeliveryPullRequestManifest
	extends DeliveryPullRequestManifestIdentity {
	readonly schemaVersion: 1;
	readonly operationId: string;
	readonly stage: DeliveryPullRequestManifestStage;
	readonly reviewExecution?: DeliveryPullRequestExecutionBinding;
	readonly publicationExecution?: DeliveryPullRequestExecutionBinding;
	readonly pullRequest?: { readonly url: string };
}

interface DeliveryPullRequestManifestPersistence {
	read(operationId: string): Promise<
		| {
				revision: string;
				value: DeliveryPullRequestManifest;
		  }
		| undefined
	>;
	create(value: DeliveryPullRequestManifest): Promise<{
		revision: string;
		value: DeliveryPullRequestManifest;
	}>;
	compareAndSwap(
		revision: string,
		value: DeliveryPullRequestManifest,
	): Promise<{ revision: string; value: DeliveryPullRequestManifest }>;
}

const manifestStages: readonly DeliveryPullRequestManifestStage[] = [
	"prepared",
	"reviewed",
	"review-rejected",
	"review-drifted",
	"publishing",
	"publication-uncertain",
	"publication-rejected",
	"publication-drifted",
	"published",
];

function deliveryPullRequestOperationId(
	identity: DeliveryPullRequestManifestIdentity,
): string {
	return digestCanonicalValue({
		ticket: identity.ticket,
		snapshot: identity.snapshot,
		target: identity.target,
		draft: identity.draft,
	});
}

function validExecutionBinding(
	binding: DeliveryPullRequestExecutionBinding | undefined,
): boolean {
	return (
		binding !== undefined &&
		!!binding.decisionId &&
		!!binding.operationDigest &&
		!!binding.executionId &&
		Number.isSafeInteger(binding.generation) &&
		binding.generation > 0
	);
}

function validateManifest(value: DeliveryPullRequestManifest): void {
	if (
		value.schemaVersion !== 1 ||
		!manifestStages.includes(value.stage) ||
		value.operationId !== deliveryPullRequestOperationId(value) ||
		!value.ticket.id.trim() ||
		!value.ticket.title.trim() ||
		value.ticket.state !== "In Progress" ||
		!value.target.trim() ||
		value.target !== value.target.trim() ||
		value.draft.ticketId !== value.ticket.id ||
		value.draft.head !== value.ticket.id ||
		value.draft.target !== value.target ||
		canonicalJson(value.draft.evidence) !==
			canonicalJson({
				headCommit: value.snapshot.headCommit,
				treeDigest: value.snapshot.treeDigest,
				diffDigest: value.snapshot.diffDigest,
			})
	)
		throw new Error("Delivery pull request manifest identity is invalid.");
	if (
		value.reviewExecution !== undefined &&
		!validExecutionBinding(value.reviewExecution)
	)
		throw new Error("Delivery pull request review binding is invalid.");
	if (
		value.publicationExecution !== undefined &&
		!validExecutionBinding(value.publicationExecution)
	)
		throw new Error("Delivery pull request publication binding is invalid.");
	if (value.stage !== "prepared" && !value.reviewExecution)
		throw new Error(
			"Delivery pull request manifest requires review execution evidence.",
		);
	if (
		[
			"publishing",
			"publication-uncertain",
			"publication-rejected",
			"publication-drifted",
			"published",
		].includes(value.stage) &&
		!value.publicationExecution
	)
		throw new Error(
			"Delivery pull request manifest requires publication execution evidence.",
		);
	if (
		value.stage === "published" ? !value.pullRequest?.url.trim() : value.pullRequest
	)
		throw new Error("Delivery pull request publication read-back is invalid.");
}

export function createDeliveryPullRequestManifestStore({
	persistence,
}: {
	persistence: DeliveryPullRequestManifestPersistence;
}) {
	async function read(
		operationId: string,
	): Promise<DeliveryPullRequestManifest | undefined> {
		const stored = await persistence.read(operationId);
		if (!stored) return undefined;
		validateManifest(stored.value);
		return structuredClone(stored.value);
	}

	async function prepare(
		identity: DeliveryPullRequestManifestIdentity,
	): Promise<DeliveryPullRequestManifest> {
		const operationId = deliveryPullRequestOperationId(identity);
		const existing = await read(operationId);
		if (existing) {
			if (
				canonicalJson(identity) !==
				canonicalJson({
					ticket: existing.ticket,
					snapshot: existing.snapshot,
					target: existing.target,
					draft: existing.draft,
				})
			)
				throw new Error("Delivery pull request manifest identity conflicts.");
			return existing;
		}
		const value: DeliveryPullRequestManifest = {
			...structuredClone(identity),
			schemaVersion: 1,
			operationId,
			stage: "prepared",
		};
		validateManifest(value);
		const created = await persistence.create(value);
		if (canonicalJson(created.value) !== canonicalJson(value))
			throw new Error(
				"Delivery pull request manifest create read-back mismatch.",
			);
		return structuredClone(created.value);
	}

	async function update(
		operationId: string,
		mutate: (
			current: DeliveryPullRequestManifest,
		) => DeliveryPullRequestManifest,
	): Promise<DeliveryPullRequestManifest> {
		const stored = await persistence.read(operationId);
		if (!stored) throw new Error("Delivery pull request manifest is missing.");
		validateManifest(stored.value);
		const next = mutate(structuredClone(stored.value));
		validateManifest(next);
		const saved = await persistence.compareAndSwap(stored.revision, next);
		if (canonicalJson(saved.value) !== canonicalJson(next))
			throw new Error("Delivery pull request manifest save read-back mismatch.");
		return structuredClone(saved.value);
	}

	async function bindReview(
		operationId: string,
		execution: DeliveryPullRequestExecutionBinding,
	): Promise<DeliveryPullRequestManifest> {
		return update(operationId, (current) => {
			if (current.reviewExecution) {
				if (canonicalJson(current.reviewExecution) !== canonicalJson(execution))
					throw new Error("Delivery pull request review execution conflicts.");
				return current;
			}
			if (current.stage !== "prepared")
				throw new Error("Delivery pull request review is no longer executable.");
			return { ...current, reviewExecution: structuredClone(execution) };
		});
	}

	async function finishReview(
		operationId: string,
		stage: "reviewed" | "review-rejected" | "review-drifted",
	): Promise<DeliveryPullRequestManifest> {
		return update(operationId, (current) => {
			if (current.stage === stage) return current;
			if (current.stage !== "prepared" || !current.reviewExecution)
				throw new Error("Delivery pull request review transition conflicts.");
			return { ...current, stage };
		});
	}

	async function bindPublication(
		operationId: string,
		execution: DeliveryPullRequestExecutionBinding,
	): Promise<DeliveryPullRequestManifest> {
		return update(operationId, (current) => {
			if (current.publicationExecution) {
				if (
					canonicalJson(current.publicationExecution) !== canonicalJson(execution)
				)
					throw new Error(
						"Delivery pull request publication execution conflicts.",
					);
				return current;
			}
			if (current.stage !== "reviewed")
				throw new Error("Only a reviewed pull request draft can be published.");
			return { ...current, publicationExecution: structuredClone(execution) };
		});
	}

	async function finishPublication(
		operationId: string,
		stage:
			| "publishing"
			| "publication-uncertain"
			| "publication-rejected"
			| "publication-drifted"
			| "published",
		pullRequest?: { readonly url: string },
	): Promise<DeliveryPullRequestManifest> {
		return update(operationId, (current) => {
			if (
				current.stage === stage &&
				canonicalJson(current.pullRequest) === canonicalJson(pullRequest)
			)
				return current;
			const allowed =
				stage === "publishing"
					? current.stage === "reviewed" ||
						current.stage === "publication-uncertain"
					: stage === "published"
						? current.stage === "publishing" ||
							current.stage === "publication-uncertain"
						: current.stage === "reviewed" ||
							current.stage === "publishing" ||
							current.stage === "publication-uncertain";
			if (!allowed || !current.publicationExecution)
				throw new Error(
					"Delivery pull request publication transition conflicts.",
				);
			return {
				...current,
				stage,
				...(stage === "published"
					? { pullRequest: structuredClone(pullRequest) }
					: {}),
			};
		});
	}

	return {
		read,
		prepare,
		bindReview,
		finishReview,
		bindPublication,
		finishPublication,
	};
}

type DeliveryPullRequestManifestStore = ReturnType<
	typeof createDeliveryPullRequestManifestStore
>;

interface DecisionDescriptor {
	readonly request: DecisionRequest;
	readonly actions: {
		readonly approve: TypedDecisionAction;
		readonly reject: TypedDecisionAction;
		readonly cancel: TypedDecisionAction;
	};
}

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

function exact(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function actor(developer: DeliveryDeveloperAuthority): AuthenticatedDecisionActor {
	if (
		developer?.role !== "Developer" ||
		!developer.actorId?.trim() ||
		!developer.authorityRevision?.trim() ||
		developer.active !== true ||
		developer.guest !== false
	)
		fail(
			"PI_WORKFLOW_DEVELOPER_AUTHORITY_REQUIRED",
			"Delivery pull request decisions require active authenticated Developer authority.",
		);
	return {
		actorId: developer.actorId,
		authorityRevision: developer.authorityRevision,
		active: true,
		guest: false,
	};
}

function validateSnapshot(
	snapshot: DeliveryPullRequestSnapshot,
	ticketId: string,
): void {
	if (
		!snapshot.clean ||
		snapshot.branch !== ticketId ||
		![snapshot.headCommit, snapshot.treeDigest, snapshot.diffDigest].every(
			(value) => typeof value === "string" && value.trim().length > 0,
		)
	)
		fail(
			"PI_WORKFLOW_REVIEW_DIFF_SNAPSHOT_INVALID",
			"review-diff requires the clean, exact Delivery ticket snapshot.",
		);
}

function executionBinding(lease: ExecutionLease) {
	return {
		decisionId: lease.decisionId,
		operationDigest: lease.operationDigest,
		executionId: lease.executionId,
		generation: lease.generation,
	};
}

function manifestBinding(operationId: string, lease: ExecutionLease) {
	return {
		ref: `workflow://delivery-pull-request/${operationId}`,
		...executionBinding(lease),
	};
}

export function deliveryReviewDecision(
	project: string,
	operationId: string,
	snapshot: DeliveryPullRequestSnapshot,
	draft: DeliveryPullRequestDraft,
): DecisionDescriptor {
	const input = {
		operationId,
		snapshotDigest: digestCanonicalValue(snapshot),
		draftDigest: digestCanonicalValue(draft),
	};
	const actions = {
		approve: { id: "delivery.review.approve", input },
		reject: { id: "delivery.review.reject", input },
		cancel: { id: "decision.cancel", input: null },
	} satisfies DecisionDescriptor["actions"];
	return {
		actions,
		request: {
			scope: { project, workflow: "delivery", subject: `${operationId}:review` },
			operation: {
				kind: "delivery.review-diff",
				phase: "diff-review",
				input,
				artifacts: [{ snapshotDigest: input.snapshotDigest }],
				targets: [{ head: draft.head, target: draft.target }],
				evidence: [{ draftDigest: input.draftDigest }],
			},
			presentation: {
				locale: "es",
				summary: `¿Aprobar el diff revisado para ${draft.ticketId}?`,
				details: [
					`Commit: ${snapshot.headCommit}`,
					`Árbol: ${snapshot.treeDigest}`,
					`Diff: ${snapshot.diffDigest}`,
				],
				consequences: ["La aprobación habilita la confirmación separada del pull request."],
				risks: ["Cualquier cambio en el repositorio invalida esta revisión."],
				choices: [
					{
						id: actions.approve.id,
						mode: "execute",
						action: actions.approve,
						label: "Aprobar diff",
						description: "Vincular esta evidencia revisada al borrador del PR.",
					},
					{
						id: actions.reject.id,
						mode: "execute",
						action: actions.reject,
						label: "Rechazar diff",
						description: "Cerrar esta revisión sin habilitar publicación.",
					},
					{
						id: actions.cancel.id,
						mode: "cancel",
						action: actions.cancel,
						label: "Cancelar",
						description: "Salir sin revisar ni publicar.",
					},
				],
			},
		},
	};
}

export function deliveryPublicationDecision(
	project: string,
	operationId: string,
	draft: DeliveryPullRequestDraft,
): DecisionDescriptor {
	const input = { operationId, draftDigest: digestCanonicalValue(draft) };
	const actions = {
		approve: { id: "delivery.pr.confirm", input },
		reject: { id: "delivery.pr.reject", input },
		cancel: { id: "decision.cancel", input: null },
	} satisfies DecisionDescriptor["actions"];
	return {
		actions,
		request: {
			scope: {
				project,
				workflow: "delivery",
				subject: `${operationId}:publication`,
			},
			operation: {
				kind: "delivery.publish-pr",
				phase: "pr-confirmation",
				input,
				artifacts: [{ draftDigest: input.draftDigest }],
				targets: [{ head: draft.head, target: draft.target }],
				evidence: [draft.evidence],
			},
			presentation: {
				locale: "es",
				summary: `¿Publicar el pull request de ${draft.ticketId}?`,
				details: [draft.title, draft.link],
				consequences: ["GitHub recibirá exactamente el borrador revisado."],
				risks: ["El repositorio o los PR existentes pueden cambiar antes de publicar."],
				choices: [
					{
						id: actions.approve.id,
						mode: "execute",
						action: actions.approve,
						label: "Publicar PR",
						description: "Crear o reconciliar el PR exacto.",
					},
					{
						id: actions.reject.id,
						mode: "execute",
						action: actions.reject,
						label: "Rechazar publicación",
						description: "Cerrar esta publicación sin crear el PR.",
					},
					{
						id: actions.cancel.id,
						mode: "cancel",
						action: actions.cancel,
						label: "Cancelar",
						description: "Salir sin publicar.",
					},
				],
			},
		},
	};
}

export function createDeliveryPullRequestWorkflow(dependencies: {
	git: DeliveryPullRequestGateway;
	sourceBranch: string;
	project: string;
	interactiveDecisions: PiInteractiveDecisions;
	manifests: DeliveryPullRequestManifestStore;
}) {
	async function terminalize(
		descriptor: DecisionDescriptor,
		lease: ExecutionLease,
		state: string,
	): Promise<void> {
		const outcome = await dependencies.interactiveDecisions.recover(
			descriptor.request.scope,
			{
				actorId: lease.actorId,
				authorityRevision: lease.authorityRevision,
				active: true,
				guest: false,
			},
			{ kind: "terminal", state },
		);
		if (outcome.kind !== "terminal" || outcome.state !== state)
			fail(
				"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
				`Delivery decision could not be finalized as ${state}.`,
			);
	}

	async function authorize(
		descriptor: DecisionDescriptor,
		developer: DeliveryDeveloperAuthority,
		action: TypedDecisionAction | undefined,
	): Promise<
		| { readonly kind: "awaiting"; readonly presentation: Awaited<ReturnType<PiInteractiveDecisions["prepare"]>> }
		| { readonly kind: "cancelled" }
		| { readonly kind: "terminal"; readonly state: string }
		| { readonly kind: "authorized"; readonly lease: ExecutionLease }
	> {
		const authority = actor(developer);
		const recovered = await dependencies.interactiveDecisions.recover(
			descriptor.request.scope,
			authority,
		);
		if (recovered.kind === "terminal")
			return { kind: "terminal", state: recovered.state };
		if (recovered.kind === "cancelled" || recovered.kind === "superseded")
			return { kind: "cancelled" };
		if (recovered.kind === "blocked")
			fail(recovered.blocker.code, recovered.blocker.message);
		if (recovered.kind === "active" || recovered.kind === "drift" || recovered.kind === "reapproval")
			fail(
				"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
				"Delivery decision recovery requires explicit shared-authority resolution.",
			);
		if (recovered.kind === "authorized") {
			if (action && !exact(recovered.lease.action, action))
				fail(
					"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					"Requested Delivery action conflicts with the recovered execution lease.",
				);
			return { kind: "authorized", lease: recovered.lease };
		}
		if (!action) {
			const presentation = await dependencies.interactiveDecisions.prepare(
				descriptor.request,
				authority,
			);
			return { kind: "awaiting", presentation };
		}
		if (recovered.kind !== "prepared")
			fail(
				"PI_WORKFLOW_DECISION_CLAIM_MISSING",
				"Delivery action requires a prepared shared decision.",
			);
		const outcome = await dependencies.interactiveDecisions.authorize(
			recovered.decisionId,
			action,
			authority,
		);
		if (outcome.kind === "blocked") fail(outcome.blocker.code, outcome.blocker.message);
		return outcome.kind === "cancelled"
			? { kind: "cancelled" }
			: { kind: "authorized", lease: outcome.lease };
	}

	async function bindSharedManifest(
		operationId: string,
		lease: ExecutionLease,
	): Promise<void> {
		const expected = manifestBinding(operationId, lease);
		const current = await dependencies.interactiveDecisions.authorizeEffect(lease);
		if (current.kind === "authorized") {
			if (!exact(current.manifest, expected))
				fail(
					"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
					"Recovered Delivery execution manifest conflicts with durable evidence.",
				);
			return;
		}
		const bound = await dependencies.interactiveDecisions.bindExecutionManifest(
			lease,
			expected,
		);
		if (bound.kind === "blocked") fail(bound.blocker.code, bound.blocker.message);
	}

	async function authorizeGitEffect(lease: ExecutionLease): Promise<void> {
		const outcome = await dependencies.interactiveDecisions.authorizeEffect(lease);
		if (outcome.kind === "blocked") fail(outcome.blocker.code, outcome.blocker.message);
	}

	async function reviewDiff(input: {
		ticket: { id: string; title: string; state: "In Progress" };
		developer: DeliveryDeveloperAuthority;
		snapshot: DeliveryPullRequestSnapshot;
		targetBranch?: string;
		action?: TypedDecisionAction;
	}) {
		const request = structuredClone(input);
		actor(request.developer);
		if (
			!request.ticket.id.trim() ||
			!request.ticket.title.trim() ||
			request.ticket.state !== "In Progress"
		)
			fail(
				"PI_WORKFLOW_PR_TICKET_INVALID",
				"An In Progress Delivery ticket ID and title are required.",
			);
		validateSnapshot(request.snapshot, request.ticket.id);
		const target = request.targetBranch ?? dependencies.sourceBranch;
		if (!target.trim() || target !== target.trim())
			fail(
				"PI_WORKFLOW_TARGET_BRANCH_INVALID",
				"The PR target must be explicit, canonical, and non-empty.",
			);
		const draft: DeliveryPullRequestDraft = {
			ticketId: request.ticket.id,
			head: request.ticket.id,
			target,
			title: `${request.ticket.id} — ${request.ticket.title}`,
			description: [
				"## Ticket",
				request.ticket.id,
				"",
				"## Evidencia revisada",
				`- Commit: ${request.snapshot.headCommit}`,
				`- Digest del árbol: ${request.snapshot.treeDigest}`,
				`- Digest del diff: ${request.snapshot.diffDigest}`,
			].join("\n"),
			link: dependencies.git.compareLink({ head: request.ticket.id, target }),
			evidence: {
				headCommit: request.snapshot.headCommit,
				treeDigest: request.snapshot.treeDigest,
				diffDigest: request.snapshot.diffDigest,
			},
		};
		let manifest = await dependencies.manifests.prepare({
			ticket: request.ticket,
			snapshot: request.snapshot,
			target,
			draft,
		});
		const descriptor = deliveryReviewDecision(
			dependencies.project,
			manifest.operationId,
			request.snapshot,
			draft,
		);
		const decision = await authorize(descriptor, request.developer, request.action);
		if (decision.kind === "awaiting")
			return {
				status: "awaiting-review-decision" as const,
				operationId: manifest.operationId,
				draft,
				actions: descriptor.actions,
				presentation: decision.presentation,
			};
		if (decision.kind === "cancelled") return { status: "review-cancelled" as const };
		if (decision.kind === "terminal") {
			if (decision.state === "reviewed" && manifest.stage === "reviewed")
				return {
					status: "awaiting-confirmation" as const,
					operationId: manifest.operationId,
					draft,
				};
			return { status: decision.state as "review-rejected" | "review-drifted" };
		}
		manifest = await dependencies.manifests.bindReview(
			manifest.operationId,
			executionBinding(decision.lease),
		);
		await bindSharedManifest(manifest.operationId, decision.lease);
		if (decision.lease.action.id === descriptor.actions.reject.id) {
			await dependencies.manifests.finishReview(manifest.operationId, "review-rejected");
			await terminalize(descriptor, decision.lease, "review-rejected");
			return { status: "review-rejected" as const };
		}
		if (!exact(decision.lease.action, descriptor.actions.approve))
			fail(
				"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
				"Shared review lease does not authorize approval.",
			);
		await authorizeGitEffect(decision.lease);
		const actual = await dependencies.git.inspect();
		if (!exact(actual, request.snapshot)) {
			await dependencies.manifests.finishReview(manifest.operationId, "review-drifted");
			await terminalize(descriptor, decision.lease, "review-drifted");
			fail(
				"PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
				"The repository no longer matches the snapshot presented at review-diff.",
			);
		}
		await dependencies.manifests.finishReview(manifest.operationId, "reviewed");
		await terminalize(descriptor, decision.lease, "reviewed");
		return {
			status: "awaiting-confirmation" as const,
			operationId: manifest.operationId,
			draft,
		};
	}

	async function confirmPr(input: {
		operationId: string;
		draft: DeliveryPullRequestDraft;
		developer: DeliveryDeveloperAuthority;
		action?: TypedDecisionAction;
	}) {
		const request = structuredClone(input);
		actor(request.developer);
		let manifest = await dependencies.manifests.read(request.operationId);
		if (!manifest || !exact(manifest.draft, request.draft))
			fail(
				"PI_WORKFLOW_PR_CONFIRMATION_INVALID",
				"confirm-pr requires the exact durable draft produced by an approved review-diff gate.",
			);
		if (manifest.stage === "published")
			return { status: "pr-published" as const, pullRequest: manifest.pullRequest };
		if (!["reviewed", "publishing", "publication-uncertain"].includes(manifest.stage))
			fail(
				"PI_WORKFLOW_PR_CONFIRMATION_INVALID",
				"The durable review manifest does not authorize PR confirmation.",
			);
		const descriptor = deliveryPublicationDecision(
			dependencies.project,
			manifest.operationId,
			manifest.draft,
		);
		const decision = await authorize(descriptor, request.developer, request.action);
		if (decision.kind === "awaiting")
			return {
				status: "awaiting-pr-decision" as const,
				operationId: manifest.operationId,
				draft: manifest.draft,
				actions: descriptor.actions,
				presentation: decision.presentation,
			};
		if (decision.kind === "cancelled")
			return { status: "confirmation-cancelled" as const };
		if (decision.kind === "terminal") {
			return {
				status: decision.state as
					| "publication-rejected"
					| "publication-drifted",
			};
		}
		const publicationManifest = await dependencies.manifests.bindPublication(
			manifest.operationId,
			executionBinding(decision.lease),
		);
		manifest = publicationManifest;
		await bindSharedManifest(publicationManifest.operationId, decision.lease);
		if (decision.lease.action.id === descriptor.actions.reject.id) {
			await dependencies.manifests.finishPublication(
				manifest.operationId,
				"publication-rejected",
			);
			await terminalize(descriptor, decision.lease, "publication-rejected");
			return { status: "publication-rejected" as const };
		}
		if (!exact(decision.lease.action, descriptor.actions.approve))
			fail(
				"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
				"Shared publication lease does not authorize confirmation.",
			);

		await authorizeGitEffect(decision.lease);
		let actual = await dependencies.git.inspect();
		if (!exact(actual, manifest.snapshot)) {
			await dependencies.manifests.finishPublication(
				manifest.operationId,
				"publication-drifted",
			);
			await terminalize(descriptor, decision.lease, "publication-drifted");
			fail(
				"PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
				"The repository changed after review-diff; review the new snapshot before publishing.",
			);
		}
		await authorizeGitEffect(decision.lease);
		let existing = await dependencies.git.find({
			head: manifest.draft.head,
			target: manifest.draft.target,
		});
		const exactExisting = existing.filter((entry) =>
			exact(entry.draft, publicationManifest.draft),
		);
		if (existing.length > 0) {
			if (existing.length !== 1 || exactExisting.length !== 1)
				fail(
					"PI_WORKFLOW_PR_CONFLICT",
					"An existing pull request conflicts with the reviewed draft.",
				);
			await dependencies.manifests.finishPublication(
				manifest.operationId,
				"published",
				{ url: exactExisting[0].url },
			);
			await terminalize(descriptor, decision.lease, "published");
			return {
				status: "pr-published" as const,
				pullRequest: { url: exactExisting[0].url },
			};
		}

		manifest = await dependencies.manifests.finishPublication(
			manifest.operationId,
			"publishing",
		);
		try {
			await authorizeGitEffect(decision.lease);
			actual = await dependencies.git.inspect();
			if (!exact(actual, manifest.snapshot))
				throw Object.assign(new Error("Repository drifted immediately before publication."), {
					code: "PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
				});
			await authorizeGitEffect(decision.lease);
			existing = await dependencies.git.find({
				head: manifest.draft.head,
				target: manifest.draft.target,
			});
			if (existing.length > 0)
				throw Object.assign(new Error("Pull request state changed immediately before publication."), {
					code: "PI_WORKFLOW_PR_CONFLICT",
				});
			await authorizeGitEffect(decision.lease);
			await dependencies.git.publish({
				draft: manifest.draft,
				expectedSnapshot: manifest.snapshot,
				executionId: decision.lease.executionId,
			});
			await authorizeGitEffect(decision.lease);
			const readBack = await dependencies.git.find({
				head: manifest.draft.head,
				target: manifest.draft.target,
			});
			if (readBack.length !== 1 || !exact(readBack[0].draft, manifest.draft))
				throw Object.assign(new Error("Published pull request read-back is missing or conflicting."), {
					code: "PI_WORKFLOW_PR_READBACK_MISMATCH",
				});
			await dependencies.manifests.finishPublication(
				manifest.operationId,
				"published",
				{ url: readBack[0].url },
			);
			await terminalize(descriptor, decision.lease, "published");
			return { status: "pr-published" as const, pullRequest: { url: readBack[0].url } };
		} catch (error) {
			await dependencies.manifests.finishPublication(
				manifest.operationId,
				"publication-uncertain",
			);
			fail(
				(error as { code?: string }).code ?? "PI_WORKFLOW_PR_PUBLICATION_UNCERTAIN",
				`${error instanceof Error ? error.message : String(error)} Publication remains recoverable and was not replayed blindly.`,
			);
		}
	}

	return { reviewDiff, confirmPr };
}

export function createFakeDeliveryPullRequestGateways(input: {
	repository: DeliveryPullRequestSnapshot;
	sourceBranch: string;
}) {
	let repository = structuredClone(input.repository);
	const events: string[] = [];
	const publications: DeliveryPublishedPullRequest[] = [];
	const git: DeliveryPullRequestGateway = {
		async inspect() {
			events.push("git:inspect");
			return structuredClone(repository);
		},
		compareLink({ head, target }) {
			return `https://github.test/compare/${target}...${head}`;
		},
		async find({ head, target }) {
			events.push("git:find");
			return structuredClone(
				publications.filter(
					(publication) =>
						publication.draft.head === head && publication.draft.target === target,
				),
			);
		},
		async publish({ draft, expectedSnapshot, executionId }) {
			events.push(`git:publish:${executionId}`);
			if (!exact(repository, expectedSnapshot))
				throw new Error("repository changed at publication gateway");
			if (
				publications.some(
					(publication) =>
						publication.draft.head === draft.head &&
						publication.draft.target === draft.target,
				)
			)
				throw new Error("pull request already exists at publication gateway");
			const created = {
				url: `https://github.test/pull/${publications.length + 1}`,
				draft: structuredClone(draft),
			};
			publications.push(created);
			return { url: created.url };
		},
	};
	return {
		gateways: { git, sourceBranch: input.sourceBranch },
		events,
		publications,
		setRepository(next: DeliveryPullRequestSnapshot) {
			repository = structuredClone(next);
		},
	};
}
