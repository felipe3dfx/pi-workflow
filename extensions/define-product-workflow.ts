import {
	ProductSpecContractError,
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
	isValidProductSpecSnapshot,
} from "./product-spec.ts";
import {
	canonicalJson,
	createBlocker,
	createRouteRecommendation,
	digestCanonicalValue,
	type Assessment,
	type AuthenticatedAuthority,
	type OwnerAuthority,
	type ProductSpecApprovalEnvelope,
	type ProductSpecEnvelope,
	type ProductSpecInput,
	type Route,
	type RouteRecommendation,
	type SubagentResult,
	type VerifiedArtifactRef,
	type WorkflowIntent,
} from "./workflow-contracts.ts";
import {
	publishApprovedSpec,
	type DeliveryParentPublicationDependencies,
} from "./delivery-parent-publication.ts";
import type { LinearDeliveryParent } from "./linear-delivery-parent-gateway.ts";
import {
	createTicketGraphApproval,
	type DeliveryTicketGraph,
	type TicketGraphApproval,
} from "./delivery-ticket-graph.ts";
import type { ApprovedTicketPublication } from "./approved-ticket-publication.ts";
import type { publishApprovedRevision } from "./approved-revision-publication.ts";

/** Interactive confirmation tokens expire after five minutes. */
const routeConfirmationTokenTtlMs = 5 * 60 * 1_000;

export type DefineProductCommand =
	| {
			kind: "recommend-route";
			definitionId: string;
			domainAnchor: string;
			assessment: Assessment;
			workflowStateId: string;
	  }
	| {
			kind: "confirm-route";
			recommendationRef: string;
			confirmedRoute: Route;
			researchQuestion: string;
			confirmationToken: string;
			workflowStateId: string;
	  }
	| {
			kind: "request-exploration";
			definitionId: string;
			intent: "prototype" | "design-alternative";
			focus: string;
	  }
	| ({
			kind: "to-spec";
			supportArtifactAliases: readonly string[];
	  } & Omit<ProductSpecInput, "supportArtifacts">)
	| {
			kind: "approve-spec";
			target: ProductSpecInput["target"];
			revision: string;
			digest: string;
	  }
	| {
			kind: "publish-spec";
			definitionId: string;
	  }
	| {
			kind: "to-tickets";
			definitionId: string;
			approvedSpecRef: VerifiedArtifactRef;
			parentRef: VerifiedArtifactRef;
	  }
	| {
			kind: "approve-tickets";
			definitionId: string;
			parentRef: VerifiedArtifactRef;
			graphRef: VerifiedArtifactRef;
			digest: string;
		  }
	| { kind: "publish-tickets"; definitionId: string }
	| { kind: "publish-approved-revision"; definitionId: string; digest: string };

export type DefineProductOutcome =
	| {
			status: "awaiting-confirmation";
			recommendation: RouteRecommendation;
	  }
	| {
			status: "completed";
			result: SubagentResult;
	  }
	| {
			status: "blocked";
			blocker: { code: string; message: string };
	  }
	| {
			status: "spec-ready";
			spec: ProductSpecEnvelope;
	  }
	| {
			status: "spec-approved";
			spec: ProductSpecEnvelope;
			approval: ProductSpecApprovalEnvelope;
	  }
	| {
			status: "spec-published";
			parent: LinearDeliveryParent;
			parentRef: VerifiedArtifactRef;
	  }
	| { status: "tickets-ready"; graph: DeliveryTicketGraph; graphRef: VerifiedArtifactRef }
	| { status: "tickets-approved"; graph: DeliveryTicketGraph; graphRef: VerifiedArtifactRef; approval: TicketGraphApproval }
	| { status: "tickets-published"; definitionId: string }
	| { status: "revision-published"; definitionId: string; digest: string };

export interface ExplorationRecoveryState {
	definitionId: string;
	intent: "prototype" | "design-alternative";
	focus: string;
	requestId: string;
	intentFingerprint: string;
	workflowIntent: Extract<WorkflowIntent, { kind: "prototype" | "design-alternative" }>;
}

export interface ExplorationRecoveryStore {
	load(): Promise<ExplorationRecoveryState | undefined>;
	save(state: ExplorationRecoveryState): Promise<void>;
	clear(): Promise<void>;
}

export interface SpecApprovalRecoveryState {
	definitionId: string;
	spec: ProductSpecEnvelope;
}

export interface SpecApprovalRecoveryStore {
	load(): Promise<SpecApprovalRecoveryState | undefined>;
	save(state: SpecApprovalRecoveryState): Promise<void>;
	clear(): Promise<void>;
}

export interface TicketApprovalRecoveryState {
	definitionId: string;
	approvedSpecRef: VerifiedArtifactRef;
	parentRef: VerifiedArtifactRef;
	graphRef: VerifiedArtifactRef;
	digest: string;
	authority: OwnerAuthority;
}

export interface TicketApprovalRecoveryStore {
	load(): Promise<TicketApprovalRecoveryState | undefined>;
	save(state: TicketApprovalRecoveryState): Promise<void>;
	clear(): Promise<void>;
}

export type DefineProductRecovery =
	| { definitionId: string; phase: "exploration" }
	| { definitionId: string; phase: "spec-approval" | "publication" | "ticket-approval" | "ticket-publication" };

export interface DefineProductWorkflowDependencies {
	delegate: {
		delegate(intent: WorkflowIntent): Promise<SubagentResult>;
	};
	createRequestId(): string;
	project: { name: string; root: string };
	requiredSkills?: readonly { name: string }[];
	affectedPaths?: readonly string[];
	now?: () => number;
	explorationRecoveryStore?: ExplorationRecoveryStore;
	specApprovalRecoveryStore?: SpecApprovalRecoveryStore;
	ticketApprovalRecoveryStore?: TicketApprovalRecoveryStore;
	authenticatedAuthority?: {
		current(): Promise<AuthenticatedAuthority>;
	};
	approvedSpecStore?: DeliveryParentPublicationDependencies["approvedSpecReader"];
	publication?: DeliveryParentPublicationDependencies;
	readPublishedParent?(ref: VerifiedArtifactRef): Promise<
		{ id: string; teamId: string; revision: string; specDigest: string } | undefined
	>;
	recoverTicketGraph?(ref: VerifiedArtifactRef): Promise<DeliveryTicketGraph | undefined>;
	approvedTicketGraphs?: {
		save(definitionId: string, graph: DeliveryTicketGraph): Promise<VerifiedArtifactRef>;
	};
	approvedTicketPublication?: {
		save(publication: ApprovedTicketPublication): Promise<VerifiedArtifactRef>;
		read(definitionId: string): Promise<ApprovedTicketPublication | undefined>;
	};
	ticketPublication?: {
		publish(definitionId: string): Promise<Extract<DefineProductOutcome, { status: "tickets-published" | "blocked" }>>;
	};
	approvedRevisionPublication?: {
		publish(definitionId: string, digest: string): ReturnType<typeof publishApprovedRevision>;
	};
}

function isConfirmationToken(value: string): boolean {
	return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function immutableSnapshot<T>(value: T): T {
	const snapshot = structuredClone(value);
	const freeze = (candidate: unknown): void => {
		if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) {
			return;
		}
		for (const nested of Object.values(candidate)) freeze(nested);
		Object.freeze(candidate);
	};
	freeze(snapshot);
	return snapshot;
}

function cloneSnapshot<T>(value: T): T {
	return structuredClone(value);
}

function isExpectedApprovedTicketPublicationRef(
	value: unknown,
	publication: ApprovedTicketPublication,
	project: string,
): value is VerifiedArtifactRef {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const ref = value as Record<string, unknown>;
	return (
		ref.kind === "engram" &&
		ref.project === project &&
		ref.topic === `workflow/define-product/${publication.definitionId}/approved-ticket-publication/${publication.definitionId}` &&
		typeof ref.revision === "string" &&
		ref.revision.trim().length > 0 &&
		ref.schema === "approved-ticket-publication" &&
		ref.schemaVersion === 1 &&
		ref.digest === digestCanonicalValue({ schema: "approved-ticket-publication", schemaVersion: 1, payload: publication })
	);
}

function belongsToDefinition(input: {
	artifact: SubagentResult["artifacts"][number];
	definitionId: string;
	project: string;
	schema: "research-evidence" | "design-exploration";
}): boolean {
	return (
		input.artifact.project === input.project &&
		input.artifact.schema === input.schema &&
		input.artifact.topic.startsWith(
			`workflow/define-product/${input.definitionId}/`,
		)
	);
}

export function createDefineProductWorkflow(
	dependencies: DefineProductWorkflowDependencies,
) {
	let activeRecommendation: RouteRecommendation | undefined;
	let activeWorkflowStateId: string | undefined;
	let activeSpec: ProductSpecEnvelope | undefined;
	let recoverableExploration:
		| {
				definitionId: string;
				intent: "prototype" | "design-alternative";
				focus: string;
				workflowIntent: Extract<
					WorkflowIntent,
					{ kind: "prototype" | "design-alternative" }
				>;
		  }
		| undefined;
	let explorationContext:
		| {
				definitionId: string;
				recommendation: RouteRecommendation;
				artifacts: readonly {
					alias: string;
					ref: SubagentResult["artifacts"][number];
				}[];
		  }
			| undefined;
	let pendingTicketApproval: TicketApprovalRecoveryState | undefined;

	function clearRecommendation(): void {
		activeRecommendation = undefined;
		activeWorkflowStateId = undefined;
	}

	function reset(): void {
		clearRecommendation();
		activeSpec = undefined;
		explorationContext = undefined;
			recoverableExploration = undefined;
			pendingTicketApproval = undefined;
	}

	async function restoreRecovery(): Promise<DefineProductRecovery | undefined> {
		reset();
		try {
			const pendingSpec = await dependencies.specApprovalRecoveryStore?.load();
			if (pendingSpec) {
				if (
					pendingSpec.definitionId !== pendingSpec.spec.payload.definitionId ||
					!isValidProductSpecSnapshot(pendingSpec.spec)
				) {
					await dependencies.specApprovalRecoveryStore?.clear();
					return undefined;
				}
				activeSpec = immutableSnapshot(pendingSpec.spec);
				try {
					const approved = await dependencies.approvedSpecStore?.read(
						pendingSpec.definitionId,
					);
					if (
						approved?.spec.digest === pendingSpec.spec.digest &&
						approved.spec.payload.revision === pendingSpec.spec.payload.revision
					) {
						return { definitionId: pendingSpec.definitionId, phase: "publication" };
					}
				} catch {}
				return {
					definitionId: pendingSpec.definitionId,
					phase: "spec-approval",
				};
			}
			const pendingTickets = await dependencies.ticketApprovalRecoveryStore?.load();
			if (
				pendingTickets?.definitionId &&
				pendingTickets.approvedSpecRef.schema === "approved-spec" &&
				pendingTickets.approvedSpecRef.schemaVersion === 1 &&
				pendingTickets.approvedSpecRef.project === dependencies.project.name &&
				pendingTickets.parentRef.schema === "delivery-parent" &&
				pendingTickets.parentRef.schemaVersion === 1 &&
				pendingTickets.parentRef.project === dependencies.project.name &&
				pendingTickets.graphRef.schema === "delivery-ticket-graph" &&
				pendingTickets.graphRef.schemaVersion === 1 &&
				pendingTickets.graphRef.project === dependencies.project.name &&
				pendingTickets.graphRef.digest === pendingTickets.digest &&
				pendingTickets.authority.role === "Owner" &&
				pendingTickets.authority.actorId.trim() === pendingTickets.authority.actorId &&
				pendingTickets.authority.authorityRevision.trim() === pendingTickets.authority.authorityRevision
			) {
				const [approved, parent, graph, actor] = await Promise.all([
					dependencies.approvedSpecStore?.read(pendingTickets.definitionId),
					dependencies.readPublishedParent?.(pendingTickets.parentRef),
					dependencies.recoverTicketGraph?.(pendingTickets.graphRef),
					dependencies.authenticatedAuthority?.current(),
				]);
				if (
					approved?.sourceRevision === pendingTickets.approvedSpecRef.revision &&
					approved.spec.digest === pendingTickets.approvedSpecRef.digest &&
					parent?.specDigest === approved.spec.digest &&
					graph?.digest === pendingTickets.digest &&
					canonicalJson(graph.payload.parent) === canonicalJson(parent) &&
					canonicalJson(actor) === canonicalJson(pendingTickets.authority)
				) {
						const durable = await dependencies.approvedTicketPublication?.read(pendingTickets.definitionId);
						pendingTicketApproval = immutableSnapshot(pendingTickets);
						return {
							definitionId: pendingTickets.definitionId,
							phase: durable?.graphRef.digest === pendingTickets.digest ? "ticket-publication" : "ticket-approval",
						};
				}
				return undefined;
			}
		} catch {
			return undefined;
			}
			const stored = await dependencies.explorationRecoveryStore?.load();
		if (
			!stored ||
			stored.requestId !== stored.workflowIntent.requestId ||
			stored.definitionId !== stored.workflowIntent.definitionId ||
			stored.intent !== stored.workflowIntent.kind ||
			stored.focus !== stored.workflowIntent.focus ||
			stored.intentFingerprint !== digestCanonicalValue(stored.workflowIntent)
		) {
			if (stored) await dependencies.explorationRecoveryStore?.clear();
			return undefined;
		}
		recoverableExploration = {
			definitionId: stored.definitionId,
			intent: stored.intent,
			focus: stored.focus,
			workflowIntent: stored.workflowIntent,
		};
		return { definitionId: stored.definitionId, phase: "exploration" };
	}

	async function advance(
		command: DefineProductCommand,
	): Promise<DefineProductOutcome> {
		if (command.kind === "publish-approved-revision") {
			if (!dependencies.approvedRevisionPublication) {
				return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", "Approved revision publication is not configured.") };
			}
			return dependencies.approvedRevisionPublication.publish(command.definitionId, command.digest);
		}
		if (command.kind === "publish-tickets") {
			try {
				const publication = await dependencies.approvedTicketPublication?.read(command.definitionId);
				if (!publication || publication.definitionId !== command.definitionId) {
					return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket publication requires an exact durable Owner-approved graph.") };
				}
				if (!dependencies.ticketPublication) {
					return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", "Native ticket publication is not configured.") };
				}
					const outcome = await dependencies.ticketPublication.publish(command.definitionId);
					if (outcome.status === "tickets-published") await dependencies.ticketApprovalRecoveryStore?.clear();
					return outcome;
			} catch (error) {
				return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", error instanceof Error ? error.message : "Ticket publication could not be recovered safely.") };
			}
		}
		if (command.kind === "publish-spec") {
			if (!dependencies.publication) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_RECOVERY_FAILED",
						"Delivery parent publication is not configured.",
					),
				};
			}
			const outcome = await publishApprovedSpec(
				dependencies.publication,
				command.definitionId,
			);
			if (outcome.status === "spec-published") {
				await dependencies.specApprovalRecoveryStore?.clear();
				activeSpec = undefined;
			}
			return outcome;
		}
		if (command.kind === "to-tickets") {
			const refInvalid =
				command.approvedSpecRef.schema !== "approved-spec" ||
				command.approvedSpecRef.schemaVersion !== 1 ||
				command.parentRef.schema !== "delivery-parent" ||
				command.parentRef.schemaVersion !== 1 ||
				command.approvedSpecRef.project !== dependencies.project.name ||
				command.parentRef.project !== dependencies.project.name;
			if (refInvalid) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_SPEC_ARTIFACT_INVALID", "Ticket generation requires exact approved-Spec and Delivery-parent references.") };
			try {
				const approved = await dependencies.approvedSpecStore?.read(command.definitionId);
				const parent = await dependencies.readPublishedParent?.(command.parentRef);
				if (!approved || !parent || approved.sourceRevision !== command.approvedSpecRef.revision || approved.spec.digest !== command.approvedSpecRef.digest || parent.specDigest !== approved.spec.digest) {
					return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_PARENT_STALE", "Ticket generation requires the current approved Spec and verified Delivery parent.") };
				}
				const result = await dependencies.delegate.delegate({ kind: "to-tickets", requestId: dependencies.createRequestId(), definitionId: command.definitionId, recommendationDigest: approved.spec.digest, route: "wayfinder", domainAnchorDigest: approved.spec.digest, project: dependencies.project, targetTopic: `workflow/define-product/${command.definitionId}/to-tickets`, requiredSkills: [{ name: "to-tickets" }], affectedPaths: dependencies.affectedPaths ?? ["skills/define-product/SKILL.md"], approvedSpec: command.approvedSpecRef, deliveryParent: command.parentRef });
				if (result.status === "blocked") return { status: "blocked", blocker: result.blocker };
				const delegatedRef = result.artifacts.find((artifact) => artifact.schema === "delivery-ticket-graph");
				const graph = delegatedRef && await dependencies.recoverTicketGraph?.(delegatedRef);
				if (!graph || graph.digest !== delegatedRef.digest || canonicalJson(graph.payload.parent) !== canonicalJson(parent)) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "The delegated ticket graph could not be verified against its exact parent.") };
				const graphRef = await dependencies.approvedTicketGraphs?.save(command.definitionId, graph);
				if (graphRef?.schema !== "delivery-ticket-graph" || graphRef.digest !== graph.digest) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "The verified ticket graph could not be persisted and read back.") };
				const actor = await dependencies.authenticatedAuthority?.current();
				if (
					actor?.role !== "Owner" ||
					!actor.actorId.trim() ||
					actor.actorId !== actor.actorId.trim() ||
					!actor.authorityRevision.trim() ||
					actor.authorityRevision !== actor.authorityRevision.trim()
				) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket approval requires current exact Owner authority.") };
				pendingTicketApproval = { definitionId: command.definitionId, approvedSpecRef: command.approvedSpecRef, parentRef: command.parentRef, graphRef, digest: graph.digest, authority: { actorId: actor.actorId, role: "Owner", authorityRevision: actor.authorityRevision } };
				await dependencies.ticketApprovalRecoveryStore?.save(pendingTicketApproval);
				return { status: "tickets-ready", graph: cloneSnapshot(graph), graphRef };
			} catch (error) {
				return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", error instanceof Error ? error.message : "Ticket graph generation could not be recovered safely.") };
			}
		}
		if (command.kind === "approve-tickets") {
			const pending = pendingTicketApproval;
			if (!pending || pending.definitionId !== command.definitionId || canonicalJson(pending.parentRef) !== canonicalJson(command.parentRef) || canonicalJson(pending.graphRef) !== canonicalJson(command.graphRef) || pending.digest !== command.digest) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket approval must match the exact verified parent and graph.") };
			try {
				const [actor, approved, parent, graph] = await Promise.all([dependencies.authenticatedAuthority?.current(), dependencies.approvedSpecStore?.read(command.definitionId), dependencies.readPublishedParent?.(command.parentRef), dependencies.recoverTicketGraph?.(command.graphRef)]);
					if (!actor || canonicalJson(actor) !== canonicalJson(pending.authority) || approved?.sourceRevision !== pending.approvedSpecRef.revision || approved.spec.digest !== pending.approvedSpecRef.digest || !parent || parent.specDigest !== approved.spec.digest || !graph || graph.digest !== command.digest || canonicalJson(graph.payload.parent) !== canonicalJson(parent)) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket approval requires the current Owner and exact verified graph.") };
					const approval = createTicketGraphApproval({ graph, actor: { actorId: actor.actorId, role: "Owner", authorityRevision: actor.authorityRevision } });
					if (!dependencies.approvedTicketPublication) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", "Approved ticket publication persistence is not configured.") };
					const publication: ApprovedTicketPublication = {
						definitionId: command.definitionId,
						approvedSpecRef: pending.approvedSpecRef,
						parentRef: command.parentRef,
						graphRef: command.graphRef,
						graphParent: graph.payload.parent,
						approval,
					};
					const persisted = await dependencies.approvedTicketPublication.save(publication);
					if (!isExpectedApprovedTicketPublicationRef(persisted, publication, dependencies.project.name)) return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "The approved ticket publication could not be persisted with its exact durable identity.") };
				pendingTicketApproval = undefined;
				return { status: "tickets-approved", graph: cloneSnapshot(graph), graphRef: command.graphRef, approval: cloneSnapshot(approval) };
			} catch {
				return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", "Ticket approval recovery is incompatible.") };
			}
		}
		if (command.kind === "approve-spec") {
			const actor = await dependencies.authenticatedAuthority?.current();
			if (
				!actor ||
				typeof actor !== "object" ||
				typeof actor.actorId !== "string" ||
				typeof actor.role !== "string" ||
				typeof actor.authorityRevision !== "string" ||
				!command.target ||
				typeof command.target !== "object" ||
				command.target.kind !== "linear-parent-description" ||
				typeof command.target.teamId !== "string" ||
				typeof command.target.title !== "string" ||
				typeof command.revision !== "string" ||
				typeof command.digest !== "string"
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
						"The Spec approval input shape is invalid.",
					),
				};
			}
			if (
				!actor.actorId ||
				actor.actorId !== actor.actorId.trim() ||
				actor.role !== "Owner" ||
				!actor.authorityRevision ||
				actor.authorityRevision !== actor.authorityRevision.trim()
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
						"Spec approval requires an exact actor with current Owner authority.",
					),
				};
			}
			if (activeSpec) {
				const unsigned = {
					schema: activeSpec.schema,
					schemaVersion: activeSpec.schemaVersion,
					payload: activeSpec.payload,
				};
				if (activeSpec.digest !== digestCanonicalValue(unsigned)) {
					return {
						status: "blocked",
						blocker: createBlocker(
							"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
							"The active product Spec snapshot no longer matches its exact digest.",
						),
					};
				}
			}
			if (
				!activeSpec ||
				command.digest !== activeSpec.digest ||
				command.revision !== activeSpec.payload.revision ||
				canonicalJson(command.target) !== canonicalJson(activeSpec.payload.target)
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_SPEC_APPROVAL_MISMATCH",
						"Spec approval must match the active target, revision, and exact digest.",
					),
				};
			}
			const ownerActor: OwnerAuthority = {
				actorId: actor.actorId,
				role: "Owner",
				authorityRevision: actor.authorityRevision,
			};
			const approval = immutableSnapshot(
				createProductSpecApprovalEnvelope({ spec: activeSpec, actor: ownerActor }),
			);
			try {
				await dependencies.approvedSpecStore?.save?.(
					activeSpec.payload.definitionId,
					{ spec: activeSpec, approval },
				);
			} catch (error) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_RECOVERY_FAILED",
						error instanceof Error
							? error.message
							: "The approved Spec could not be persisted.",
					),
				};
			}
			return {
				status: "spec-approved",
				spec: cloneSnapshot(activeSpec),
				approval: cloneSnapshot(approval),
			};
		}
		if (command.kind === "to-spec") {
			if (
				!explorationContext ||
				explorationContext.definitionId !== command.definitionId ||
				!explorationContext.artifacts.some(
					({ ref }) => ref.schema === "research-evidence",
				)
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
						"Spec generation requires completed verified research from this definition session.",
					),
				};
			}
			const verifiedArtifacts = explorationContext.artifacts;
			const selectedArtifacts = command.supportArtifactAliases.map((alias) =>
				verifiedArtifacts.find((artifact) => artifact.alias === alias),
			);
			if (
				command.supportArtifactAliases.length === 0 ||
				selectedArtifacts.some((artifact) => artifact === undefined)
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
						"Spec support selections must use verified artifact aliases from this definition session.",
					),
				};
			}
			const { kind: _kind, supportArtifactAliases: _aliases, ...input } = command;
			try {
				const generated = createProductSpecEnvelope({
					...input,
					supportArtifacts: selectedArtifacts.flatMap((artifact) =>
						artifact ? [artifact.ref] : [],
					),
				});
				await dependencies.specApprovalRecoveryStore?.save({
					definitionId: generated.payload.definitionId,
					spec: generated,
				});
				await dependencies.explorationRecoveryStore?.clear();
				activeSpec = immutableSnapshot(generated);
				return { status: "spec-ready", spec: cloneSnapshot(activeSpec) };
			} catch (error) {
				if (error instanceof ProductSpecContractError) {
					return {
						status: "blocked",
						blocker: createBlocker(error.code, error.message),
					};
				}
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_RECOVERY_FAILED",
						"The exact pending Spec could not be persisted for recovery.",
					),
				};
			}
		}
		if (command.kind === "recommend-route") {
			await dependencies.explorationRecoveryStore?.clear();
			await dependencies.specApprovalRecoveryStore?.clear();
			explorationContext = undefined;
			activeWorkflowStateId = command.workflowStateId;
			activeRecommendation = createRouteRecommendation({
				definitionId: command.definitionId,
				domainAnchor: command.domainAnchor,
				assessment: command.assessment,
				issuedAt: (dependencies.now ?? Date.now)(),
			});
			return {
				status: "awaiting-confirmation",
				recommendation: activeRecommendation,
			};
		}
		if (command.kind === "request-exploration") {
			const focus = command.focus.trim();
			const compatibleRecovery =
				recoverableExploration?.definitionId === command.definitionId &&
				recoverableExploration.intent === command.intent &&
				recoverableExploration.focus === focus;
			if (
				(!explorationContext ||
					explorationContext.definitionId !== command.definitionId) &&
				!compatibleRecovery
			) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_DEFINITION_ID_MISMATCH",
						"Exploration requires compatible verified research from this definition session.",
					),
				};
			}
			if (!focus) {
				return {
					status: "blocked",
					blocker: createBlocker(
						"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
						"The Owner must provide a non-empty exploration focus.",
					),
				};
			}
			const recoveredIntent = compatibleRecovery
				? recoverableExploration?.workflowIntent
				: undefined;
			const requestId =
				recoveredIntent?.requestId ?? dependencies.createRequestId();
			const workflowIntent: Extract<
				WorkflowIntent,
				{ kind: "prototype" | "design-alternative" }
			> = recoveredIntent ?? {
						kind: command.intent,
						requestId,
						definitionId: explorationContext?.definitionId ?? command.definitionId,
						recommendationDigest: explorationContext?.recommendation.digest ?? "",
						route: explorationContext?.recommendation.recommendedRoute ?? "wayfinder",
						focus,
						domainAnchorDigest:
							explorationContext?.recommendation.domainAnchorDigest ?? "",
						project: dependencies.project,
						targetTopic: `workflow/define-product/${explorationContext?.definitionId ?? command.definitionId}/${command.intent}/${requestId}`,
						requiredSkills: [
							{
								name:
									command.intent === "prototype"
										? "prototype"
										: "codebase-design",
							},
						],
						affectedPaths: dependencies.affectedPaths ?? [
							"skills/define-product/SKILL.md",
						],
						readableArtifacts: (explorationContext?.artifacts ?? []).map(
							({ alias, ref }) => ({ alias, ref }),
						),
					};
			const result = await dependencies.delegate.delegate(workflowIntent);
			if (
				result.status === "blocked" &&
				result.blocker.code === "PI_WORKFLOW_DELEGATION_INTERRUPTED"
			) {
				recoverableExploration = {
					definitionId: command.definitionId,
					intent: command.intent,
					focus,
					workflowIntent,
				};
				await dependencies.explorationRecoveryStore?.save({
					definitionId: command.definitionId,
					intent: command.intent,
					focus,
					requestId: workflowIntent.requestId,
					intentFingerprint: digestCanonicalValue(workflowIntent),
					workflowIntent,
				});
			} else {
				recoverableExploration = undefined;
				await dependencies.explorationRecoveryStore?.clear();
				if (
					result.status === "completed" &&
					explorationContext?.definitionId === command.definitionId
				) {
					const retained = explorationContext.artifacts.filter(
						(artifact) => artifact.alias !== command.intent,
					);
					const verifiedExplorationArtifacts = result.artifacts.filter(
						(artifact) =>
							belongsToDefinition({
								artifact,
								definitionId: command.definitionId,
								project: dependencies.project.name,
								schema: "design-exploration",
							}),
					);
					explorationContext = {
						...explorationContext,
						artifacts: [
							...retained,
							...verifiedExplorationArtifacts.map((ref, index) => ({
								alias:
									index === 0
										? command.intent
										: `${command.intent}-${index + 1}`,
								ref,
							})),
						],
					};
				}
			}
			return { status: "completed", result };
		}
		if (!activeRecommendation) {
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
					"The Owner must confirm a define-product route recommendation before research can start.",
				),
			};
		}
		if (
			(dependencies.now ?? Date.now)() - activeRecommendation.issuedAt >=
			routeConfirmationTokenTtlMs
		) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_EXPIRED",
					"The route confirmation token has expired. Request a new recommendation.",
				),
			};
		}
		if (
			command.recommendationRef !== activeRecommendation.digest ||
			command.confirmedRoute !== activeRecommendation.recommendedRoute
		) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_MISMATCH",
					"The confirmed route does not match the current define-product recommendation.",
				),
			};
		}
		if (
			!isConfirmationToken(command.confirmationToken) ||
			command.confirmationToken !== activeRecommendation.confirmationToken ||
			command.workflowStateId !== activeWorkflowStateId
		) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_TOKEN_INVALID",
					"The Owner must provide the current one-time route confirmation token.",
				),
			};
		}
		const researchQuestion = command.researchQuestion.trim();
		if (researchQuestion.length === 0) {
			reset();
			return {
				status: "blocked",
				blocker: createBlocker(
					"PI_WORKFLOW_ROUTE_CONFIRMATION_REQUIRED",
					"The Owner must provide a non-empty research question before research can start.",
				),
			};
		}
		const recommendation = activeRecommendation;
		clearRecommendation();
		const result = await dependencies.delegate.delegate({
			kind: "research",
			requestId: dependencies.createRequestId(),
			definitionId: recommendation.definitionId,
			recommendationDigest: recommendation.digest,
			route: recommendation.recommendedRoute,
			question: researchQuestion,
			domainAnchorDigest: recommendation.domainAnchorDigest,
			project: dependencies.project,
			targetTopic: `workflow/define-product/${recommendation.definitionId}/research/${recommendation.digest}`,
			requiredSkills: dependencies.requiredSkills ?? [{ name: "research" }],
			affectedPaths: dependencies.affectedPaths ?? [
				"skills/define-product/SKILL.md",
			],
		});
		if (result.status === "completed") {
			const verifiedResearchArtifacts = result.artifacts.filter((artifact) =>
				belongsToDefinition({
					artifact,
					definitionId: recommendation.definitionId,
					project: dependencies.project.name,
					schema: "research-evidence",
				}),
			);
			explorationContext = {
				definitionId: recommendation.definitionId,
				recommendation,
				artifacts: verifiedResearchArtifacts.map((ref, index) => ({
					alias: index === 0 ? "research" : `research-${index + 1}`,
					ref,
				})),
			};
		}
		return { status: "completed", result };
	}

	function pendingRecommendation(): RouteRecommendation | undefined {
		return activeRecommendation;
	}

	return { advance, pendingRecommendation, reset, restoreRecovery };
}
