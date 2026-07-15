import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
	canonicalJson,
	createBlocker,
	digestCanonicalValue,
	type ApprovedProductSpecSnapshot,
	type ArtifactBinding,
	type ArtifactGrant,
	type DesignExplorationBinding,
	type DesignExplorationEnvelope,
	type DesignExplorationSnapshot,
	type DeliveryParentSnapshot,
	type ProgressBatch,
	type ResearchEvidenceEnvelope,
	type ResearchFinding,
	type StoredArtifactRead,
	type StoredProgressBatch,
	type VerifiedArtifactRef,
	type WorkflowBlocker,
	type WorkflowProgressEnvelope,
} from "./workflow-contracts.ts";
import {
	isValidProductSpecSnapshot,
	validateProductSpecApproval,
} from "./product-spec.ts";
import {
	parseApprovedTicketGraph,
} from "./approved-ticket-graph-store.ts";
import type { DeliveryTicketGraph } from "./delivery-ticket-graph.ts";

export interface WorkflowArtifactStore {
	readonly capabilities?: { readonly atomicCompareAndSwap: boolean };
	readCurrent(project: string, topic: string): Promise<StoredArtifactRead | undefined>;
	write(
		project: string,
		topic: string,
		content: string,
		expectedRevision: string | undefined,
	): Promise<{ revision: string }>;
	readRevision(
		project: string,
		topic: string,
		revision: string,
	): Promise<string | undefined>;
}

export type ArtifactValidation =
	| { ok: true }
	| { ok: false; blocker: WorkflowBlocker };

function validEvidence(findings: readonly ResearchFinding[]): boolean {
	return findings.length > 0 && findings.every((finding) => {
		return (
			typeof finding.claim === "string" &&
			finding.claim.length > 0 &&
			finding.evidence.length > 0 &&
			finding.evidence.every(
				(item) => !!item.uri && !!item.title && !!item.retrievedAt,
			)
		);
	});
}

export function validateResearchEvidenceEnvelope(
	envelope: ResearchEvidenceEnvelope,
	expected: {
		assignmentId: string;
		definitionId: string;
		recommendationDigest: string;
		route: string;
		question: string;
		domainAnchorDigest: string;
		artifactTopic: string;
	},
): ArtifactValidation {
	if (envelope.schema !== "research-evidence" || envelope.schemaVersion !== 1) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID",
				"The research artifact schema or version is invalid.",
			),
		};
	}
	const digest = digestCanonicalValue({
		schema: envelope.schema,
		schemaVersion: envelope.schemaVersion,
		payload: envelope.payload,
	});
	if (envelope.digest !== digest) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID",
				"The research artifact digest is invalid.",
			),
		};
	}
	if (
		envelope.payload.assignmentId !== expected.assignmentId ||
		envelope.payload.definitionId !== expected.definitionId ||
		envelope.payload.recommendationDigest !== expected.recommendationDigest ||
		envelope.payload.route !== expected.route ||
		envelope.payload.question !== expected.question ||
		envelope.payload.domainAnchorDigest !== expected.domainAnchorDigest
	) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID",
				"The research artifact binding does not match the confirmed define-product request.",
			),
		};
	}
	if (
		envelope.payload.launchProvenance.artifactTopic !== expected.artifactTopic ||
		!validEvidence(envelope.payload.findings)
	) {
		return {
			ok: false,
			blocker: createBlocker(
				"PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID",
				"The research artifact is missing required evidence or provenance.",
			),
		};
	}
	return { ok: true };
}

function designExplorationEnvelope(
	binding: DesignExplorationBinding,
	snapshot: DesignExplorationSnapshot,
	progressBatches: readonly StoredProgressBatch[],
): DesignExplorationEnvelope {
	const summary = snapshot.summary.trim();
	if (!summary) throw new Error("Design exploration summary must be non-empty.");
	if (
		snapshot.comparison.length === 0 ||
		snapshot.comparison.some(
			(entry) => !entry.criterion.trim() || !entry.assessment.trim(),
		)
	) {
		throw new Error(
			"Design exploration comparison entries must be non-empty.",
		);
	}
	if (
		snapshot.changedPaths.some((path) => !path.trim()) ||
		snapshot.limitations.some((limitation) => !limitation.trim())
	) {
		throw new Error("Design exploration paths and limitations must be non-empty.");
	}
	const unsigned = {
		schema: "design-exploration" as const,
		schemaVersion: 1 as const,
		payload: {
			assignmentId: binding.assignmentId,
			definitionId: binding.definitionId,
			intent: binding.intent,
			focus: binding.focus,
			domainAnchorDigest: binding.domainAnchorDigest,
			sourceArtifacts: binding.sourceArtifacts,
			skillRefs: binding.skillRefs,
			standardRefs: binding.standardRefs,
			launchProvenance: binding.launchProvenance,
			summary,
			comparison: snapshot.comparison.map((entry) => ({
				criterion: entry.criterion.trim(),
				assessment: entry.assessment.trim(),
			})),
			changedPaths: snapshot.changedPaths.map((path) => path.trim()),
			limitations: snapshot.limitations.map((limitation) => limitation.trim()),
			progressBatches,
		},
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function progressBatch(batch: ProgressBatch): StoredProgressBatch {
	const unsigned = {
		batchKey: batch.batchKey,
		payload: batch.payload,
		...(batch.supersedes === undefined ? {} : { supersedes: batch.supersedes }),
	};
	const digest = digestCanonicalValue(unsigned);
	if (batch.digest !== undefined && batch.digest !== digest) {
		throw new Error("The progress batch digest is invalid.");
	}
	return { ...unsigned, digest };
}

function progressEnvelope(
	batches: readonly StoredProgressBatch[],
): WorkflowProgressEnvelope {
	const unsigned = {
		schema: "workflow-progress" as const,
		schemaVersion: 1 as const,
		payload: { batches },
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function parseProgress(content: string): WorkflowProgressEnvelope {
	const parsed = JSON.parse(content) as WorkflowProgressEnvelope;
	if (
		parsed.schema !== "workflow-progress" ||
		parsed.schemaVersion !== 1 ||
		!Array.isArray(parsed.payload?.batches) ||
		parsed.digest !==
			digestCanonicalValue({
				schema: parsed.schema,
				schemaVersion: parsed.schemaVersion,
				payload: parsed.payload,
			})
	) {
		throw new Error("The current workflow progress artifact is invalid.");
	}
	return parsed;
}

function parseStoredProgress(content: string): readonly StoredProgressBatch[] {
	const parsed = JSON.parse(content) as
		| WorkflowProgressEnvelope
		| DesignExplorationEnvelope;
	if (parsed.schema === "workflow-progress") {
		return parseProgress(content).payload.batches;
	}
	if (
		parsed.schema !== "design-exploration" ||
		parsed.schemaVersion !== 1 ||
		!Array.isArray(parsed.payload?.progressBatches) ||
		parsed.digest !==
			digestCanonicalValue({
				schema: parsed.schema,
				schemaVersion: parsed.schemaVersion,
				payload: parsed.payload,
			})
	) {
		throw new Error("The current design exploration artifact is invalid.");
	}
	return parsed.payload.progressBatches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSignedArtifact(
	ref: VerifiedArtifactRef,
	parsed: Record<string, unknown>,
): void {
	if (
		parsed.schema !== ref.schema ||
		parsed.schemaVersion !== ref.schemaVersion ||
		parsed.digest !== ref.digest ||
		parsed.digest !==
			digestCanonicalValue({
				schema: parsed.schema,
				schemaVersion: parsed.schemaVersion,
				payload: parsed.payload,
			})
	) {
		throw new Error("The authorized artifact schema, version, or digest is invalid.");
	}
}

function validateApprovedProductSpecRead(
	ref: VerifiedArtifactRef,
	parsed: unknown,
): void {
	if (!isRecord(parsed) || !isRecord(parsed.spec) || !isRecord(parsed.approval)) {
		throw new Error("The approved product Spec envelope is invalid.");
	}
	const snapshot = parsed as unknown as ApprovedProductSpecSnapshot;
	if (
		!ref.revision.trim() ||
		!isValidProductSpecSnapshot(snapshot.spec) ||
		ref.digest !== snapshot.spec.digest ||
		!validateProductSpecApproval({
			spec: snapshot.spec,
			approval: snapshot.approval,
			actor: snapshot.approval.payload.actor,
			target: snapshot.spec.payload.target,
			revision: snapshot.spec.payload.revision,
		}).ok
	) {
		throw new Error("The approved product Spec identity or digest is invalid.");
	}
}

function validateDeliveryParentRead(
	ref: VerifiedArtifactRef,
	parsed: unknown,
): void {
	if (!isRecord(parsed) || !isRecord(parsed.payload)) {
		throw new Error("The Delivery parent snapshot is invalid.");
	}
	const snapshot = parsed as unknown as DeliveryParentSnapshot;
	const payload = snapshot.payload;
	if (
		!ref.revision.trim() ||
		snapshot.schema !== "delivery-parent" ||
		snapshot.schemaVersion !== 1 ||
		snapshot.digest !== ref.digest ||
		snapshot.digest !==
			digestCanonicalValue({
				schema: snapshot.schema,
				schemaVersion: snapshot.schemaVersion,
				payload,
			}) ||
		![payload.id, payload.teamId, payload.revision, payload.specDigest].every(
			(value) => typeof value === "string" && value.trim().length > 0,
		)
	) {
		throw new Error("The Delivery parent identity, revision, or digest is invalid.");
	}
}

function parseDeliveryParentSnapshot(content: string): DeliveryParentSnapshot {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("The Delivery parent snapshot contains invalid JSON.");
	}
	if (!isRecord(parsed) || !isRecord(parsed.payload)) {
		throw new Error("The Delivery parent snapshot is invalid.");
	}
	const snapshot = parsed as unknown as DeliveryParentSnapshot;
	const payload = snapshot.payload;
	if (
		snapshot.schema !== "delivery-parent" ||
		snapshot.schemaVersion !== 1 ||
		snapshot.digest !== digestCanonicalValue({
			schema: snapshot.schema,
			schemaVersion: snapshot.schemaVersion,
			payload,
		}) ||
		![payload.id, payload.teamId, payload.revision, payload.specDigest].every(
			(value) => typeof value === "string" && value.trim().length > 0,
		)
	) {
		throw new Error("The Delivery parent identity, revision, or digest is invalid.");
	}
	return snapshot;
}

function validateAuthorizedRefSchema(
	ref: VerifiedArtifactRef,
	expectedSchema: "approved-spec" | "product-spec" | "delivery-parent",
): void {
	if (ref.schema !== expectedSchema || ref.schemaVersion !== 1) {
		throw new Error("The authorized artifact schema, version, or digest is invalid.");
	}
}

function validateAuthorizedArtifactRead(ref: VerifiedArtifactRef, content: string): void {
	if (ref.schema === "approved-spec" || ref.schema === "product-spec") {
		validateAuthorizedRefSchema(ref, ref.schema);
	} else if (ref.schema === "delivery-parent") {
		validateAuthorizedRefSchema(ref, "delivery-parent");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("The authorized artifact contains invalid JSON.");
	}
	if (ref.schema === "approved-spec" || ref.schema === "product-spec") {
		validateApprovedProductSpecRead(ref, parsed);
		return;
	}
	if (ref.schema === "delivery-parent") {
		validateDeliveryParentRead(ref, parsed);
		return;
	}
	if (!isRecord(parsed)) {
		throw new Error("The authorized artifact envelope is invalid.");
	}
	validateSignedArtifact(ref, parsed);
	if (ref.schema === "research-evidence") {
		const envelope = parsed as unknown as ResearchEvidenceEnvelope;
		const validation = validateResearchEvidenceEnvelope(envelope, {
			assignmentId: envelope.payload.assignmentId,
			definitionId: envelope.payload.definitionId,
			recommendationDigest: envelope.payload.recommendationDigest,
			route: envelope.payload.route,
			question: envelope.payload.question,
			domainAnchorDigest: envelope.payload.domainAnchorDigest,
			artifactTopic: ref.topic,
		});
		if (!validation.ok) throw new Error(validation.blocker.message);
		return;
	}
	if (ref.schema === "design-exploration") {
		const envelope = parsed as unknown as DesignExplorationEnvelope;
		if (
			envelope.payload.launchProvenance?.artifactTopic !== ref.topic ||
			!envelope.payload.assignmentId ||
			!envelope.payload.definitionId ||
			!Array.isArray(envelope.payload.changedPaths) ||
			!Array.isArray(envelope.payload.progressBatches)
		) {
			throw new Error("The authorized design exploration binding is invalid.");
		}
		return;
	}
	if (ref.schema === "workflow-progress") {
		parseProgress(content);
		return;
	}
	throw new Error(`The authorized artifact schema is unsupported: ${ref.schema}.`);
}

function collectArtifactPathClaims(value: unknown, claims: Set<string>): void {
	if (typeof value === "string") {
		claims.add(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) collectArtifactPathClaims(entry, claims);
		return;
	}
	if (value && typeof value === "object") {
		for (const entry of Object.values(value)) collectArtifactPathClaims(entry, claims);
	}
}

function artifactRef(
	grant: ArtifactGrant,
	revision: string,
	digest: string,
	schema = grant.schema,
): VerifiedArtifactRef {
	return {
		kind: "engram",
		project: grant.project.name,
		topic: grant.topic,
		revision,
		schema,
		schemaVersion: grant.schemaVersion,
		digest,
	};
}

export function createWorkflowArtifactInterface(store: WorkflowArtifactStore) {
	function openSession(
		grant: ArtifactGrant,
		expected?: ArtifactBinding,
	) {
		const verifiedArtifacts = new Set<string>();
		const aliases = new Map(grant.aliases.map((entry) => [entry.alias, entry.ref]));
		if (aliases.size !== grant.aliases.length || grant.aliases.some((entry) => !entry.alias)) {
			throw new Error("Artifact grant aliases must be unique and non-empty.");
		}

		async function persist(
			content: string,
			digest: string,
			expectedRevision: string | undefined,
		): Promise<VerifiedArtifactRef> {
			if (store.capabilities?.atomicCompareAndSwap !== true) {
				throw new Error(
					"The workflow artifact store does not support atomic compare-and-swap writes.",
				);
			}
			let revision: string;
			try {
				({ revision } = await store.write(
					grant.project.name,
					grant.topic,
					content,
					expectedRevision,
				));
			} catch (error) {
				if (
					error instanceof Error &&
					((error as Error & { code?: string }).code === "revision-conflict" ||
						error.message.toLowerCase().includes("compare-and-swap"))
				) {
					throw new Error("Artifact compare-and-swap conflict.");
				}
				throw new Error("The workflow artifact could not be written to Engram.");
			}
			const readBack = await store.readRevision(
				grant.project.name,
				grant.topic,
				revision,
			);
			if (readBack === undefined) {
				throw new Error("The workflow artifact read-back is missing.");
			}
			if (readBack !== content) {
				throw new Error("The workflow artifact read-back does not match the written content.");
			}
			const ref = artifactRef(grant, revision, digest);
			verifiedArtifacts.add(canonicalJson(ref));
			return ref;
		}

		return {
			async read(alias: string): Promise<StoredArtifactRead> {
				const ref = aliases.get(alias);
				if (!ref) throw new Error(`Artifact alias is not granted: ${alias}.`);
				const content = await store.readRevision(ref.project, ref.topic, ref.revision);
				if (content === undefined) {
					throw new Error(`The artifact granted as ${alias} is missing.`);
				}
				validateAuthorizedArtifactRead(ref, content);
				return { revision: ref.revision, content };
			},
				readCurrent: () => store.readCurrent(grant.project.name, grant.topic),
				async writeDeliveryTicketGraph(
					graph: DeliveryTicketGraph,
					expectedRevision?: string,
				): Promise<VerifiedArtifactRef> {
					if (
						grant.strategy !== "snapshot" ||
						grant.schema !== "delivery-ticket-graph"
					) {
						throw new Error("Artifact grant does not allow delivery ticket graph writes.");
					}
					const canonical = parseApprovedTicketGraph(canonicalJson(graph));
					const current = await store.readCurrent(grant.project.name, grant.topic);
					if (current) {
						parseApprovedTicketGraph(current.content);
						throw new Error("Approved ticket graph is immutable and already recorded.");
					}
					return persist(
						`${canonicalJson(canonical)}\n`,
						canonical.digest,
						expectedRevision,
					);
				},
				async writeDeliveryParentSnapshot(
					snapshot: DeliveryParentSnapshot,
					expectedRevision?: string,
				): Promise<VerifiedArtifactRef> {
					if (grant.strategy !== "snapshot" || grant.schema !== "delivery-parent") {
						throw new Error("Artifact grant does not allow Delivery parent snapshot writes.");
					}
					const canonical = parseDeliveryParentSnapshot(canonicalJson(snapshot));
					const content = `${canonicalJson(canonical)}\n`;
					const current = await store.readCurrent(grant.project.name, grant.topic);
					if (current) {
						const recorded = parseDeliveryParentSnapshot(current.content);
						if (canonicalJson(recorded) !== canonicalJson(canonical)) {
							throw new Error("Delivery parent snapshot is immutable and already recorded.");
						}
						const ref = artifactRef(grant, current.revision, recorded.digest);
						verifiedArtifacts.add(canonicalJson(ref));
						return ref;
					}
					return persist(content, canonical.digest, expectedRevision);
				},
				async writeSnapshot(
				envelope: ResearchEvidenceEnvelope,
				expectedRevision?: string,
			): Promise<VerifiedArtifactRef> {
				if (grant.strategy !== "snapshot" || grant.schema !== "research-evidence") {
					throw new Error("Artifact grant does not allow research snapshot writes.");
				}
				if (!expected || "kind" in expected) {
					throw new Error("Research snapshot binding is required for this artifact schema.");
				}
				const validation = validateResearchEvidenceEnvelope(envelope, {
					...expected,
					artifactTopic: grant.topic,
				});
				if (!validation.ok) throw new Error(validation.blocker.message);
				const content = `${canonicalJson(envelope)}\n`;
				return persist(content, envelope.digest, expectedRevision);
			},
			async writeExplorationSnapshot(
				snapshot: DesignExplorationSnapshot,
				expectedRevision?: string,
			): Promise<VerifiedArtifactRef> {
				if (
					grant.strategy !== "snapshot" ||
					grant.schema !== "design-exploration" ||
					!expected ||
					!("kind" in expected) ||
					expected.kind !== "design-exploration"
				) {
					throw new Error(
						"Artifact grant does not allow design exploration snapshot writes.",
					);
				}
				const current = await store.readCurrent(
					grant.project.name,
					grant.topic,
				);
				const progressBatches = current
					? parseStoredProgress(current.content)
					: [];
				const envelope = designExplorationEnvelope(
					expected,
					snapshot,
					progressBatches,
				);
				return persist(
					`${canonicalJson(envelope)}\n`,
					envelope.digest,
					expectedRevision ?? current?.revision,
				);
			},
			async mergeProgress(batch: ProgressBatch): Promise<VerifiedArtifactRef> {
				if (
					!((
						grant.strategy === "merge-progress" &&
						grant.schema === "workflow-progress"
					) || (
						grant.strategy === "snapshot" &&
						grant.schema === "design-exploration"
					))
				) {
					throw new Error("Artifact grant does not allow merge-progress writes.");
				}
				if (!batch.batchKey.trim()) {
					throw new Error("Progress batch key must be non-empty.");
				}
				const current = await store.readCurrent(grant.project.name, grant.topic);
				const batches = current ? [...parseStoredProgress(current.content)] : [];
				const incoming = progressBatch(batch);
				const existing = batches.find((entry) => entry.batchKey === incoming.batchKey);
				if (existing) {
					if (canonicalJson(existing) !== canonicalJson(incoming)) {
						throw new Error(`Progress batch key conflict: ${incoming.batchKey}.`);
					}
					const currentEnvelope = parseProgress(current?.content ?? "");
					return artifactRef(
						grant,
						current?.revision ?? "",
						currentEnvelope.digest,
						"workflow-progress",
					);
				}
				if (incoming.supersedes !== undefined) {
					if (!batches.some((entry) => entry.batchKey === incoming.supersedes)) {
						throw new Error(
							`Progress batch ${incoming.batchKey} supersedes an unknown batch: ${incoming.supersedes}.`,
						);
					}
					if (batches.some((entry) => entry.supersedes === incoming.supersedes)) {
						throw new Error(
							`Progress batch ${incoming.supersedes} already has an explicit correction.`,
						);
					}
				}
				const envelope = progressEnvelope([...batches, incoming]);
				const ref = await persist(
					`${canonicalJson(envelope)}\n`,
					envelope.digest,
					current?.revision,
				);
				return { ...ref, schema: "workflow-progress" };
			},
			async verifyDiscoveredPaths(
				paths: readonly string[],
				artifacts: readonly VerifiedArtifactRef[],
			): Promise<readonly string[]> {
				const claims = new Set<string>();
				for (const artifact of artifacts) {
					if (!verifiedArtifacts.has(canonicalJson(artifact))) continue;
					const content = await store.readRevision(
						artifact.project,
						artifact.topic,
						artifact.revision,
					);
					if (content === undefined) continue;
					validateAuthorizedArtifactRead(artifact, content);
					const parsed = JSON.parse(content) as
						| DesignExplorationEnvelope
						| WorkflowProgressEnvelope;
					if (parsed.schema === "design-exploration") {
						collectArtifactPathClaims(parsed.payload.changedPaths, claims);
						collectArtifactPathClaims(parsed.payload.progressBatches, claims);
					} else if (parsed.schema === "workflow-progress") {
						collectArtifactPathClaims(parsed.payload.batches, claims);
					}
				}
				const projectRoot = await realpath(grant.project.root);
				const verified: string[] = [];
				for (const candidate of paths) {
					const trimmed = candidate.trim();
					if (!trimmed || !claims.has(trimmed)) {
						throw new Error(
							"Discovered path is not present in verified exploration output.",
						);
					}
					const canonical = await realpath(resolve(projectRoot, trimmed));
					const projectRelative = relative(projectRoot, canonical);
					if (
						!projectRelative ||
						projectRelative === ".." ||
						projectRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
						isAbsolute(projectRelative)
					) {
						throw new Error("Discovered path is outside the project root.");
					}
					if (!verified.includes(projectRelative)) verified.push(projectRelative);
				}
				return verified;
			},
			hasVerifiedArtifact(artifact: VerifiedArtifactRef): boolean {
				return verifiedArtifacts.has(canonicalJson(artifact));
			},
		};
	}

	return {
		openSession,
		writeCapabilityBlocker(): WorkflowBlocker | undefined {
			return store.capabilities?.atomicCompareAndSwap === false
				? createBlocker(
						"PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_UNSUPPORTED",
						"Atomic conditional writes are unsupported by the configured Engram HTTP adapter.",
					)
				: undefined;
		},
	};
}
