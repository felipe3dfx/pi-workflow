import {
	canonicalJson,
	createBlocker,
	digestCanonicalValue,
	type ArtifactGrant,
	type ResearchArtifactBinding,
	type ResearchEvidenceEnvelope,
	type ResearchFinding,
	type StoredArtifactRead,
	type VerifiedArtifactRef,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

export interface WorkflowArtifactStore {
	readCurrent(project: string, topic: string): Promise<StoredArtifactRead | undefined>;
	write(project: string, topic: string, content: string): Promise<{ revision: string }>;
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

export function createWorkflowArtifactInterface(store: WorkflowArtifactStore) {
	function openSession(
		grant: ArtifactGrant,
		expected: ResearchArtifactBinding,
	) {
		const verifiedArtifacts = new Set<string>();
		return {
			readCurrent: () => store.readCurrent(grant.project.name, grant.topic),
			async writeSnapshot(
				envelope: ResearchEvidenceEnvelope,
			): Promise<VerifiedArtifactRef> {
				const validation = validateResearchEvidenceEnvelope(envelope, {
					...expected,
					artifactTopic: grant.topic,
				});
				if (!validation.ok) throw new Error(validation.blocker.message);
				const content = `${canonicalJson(envelope)}\n`;
				let revision: string;
				try {
					({ revision } = await store.write(
						grant.project.name,
						grant.topic,
						content,
					));
				} catch {
					throw new Error("The research artifact could not be written to Engram.");
				}
				const readBack = await store.readRevision(
					grant.project.name,
					grant.topic,
					revision,
				);
				if (readBack === undefined) {
					throw new Error("The research artifact read-back is missing.");
				}
				const parsed = JSON.parse(readBack) as ResearchEvidenceEnvelope;
				const readBackValidation = validateResearchEvidenceEnvelope(parsed, {
					...expected,
					artifactTopic: grant.topic,
				});
				if (!readBackValidation.ok || parsed.digest !== envelope.digest) {
					throw new Error("The research artifact read-back does not match the written snapshot.");
				}
				const ref = {
					kind: "engram" as const,
					project: grant.project.name,
					topic: grant.topic,
					revision,
					schema: grant.schema,
					schemaVersion: grant.schemaVersion,
					digest: parsed.digest,
				};
				verifiedArtifacts.add(canonicalJson(ref));
				return ref;
			},
			hasVerifiedArtifact(artifact: VerifiedArtifactRef): boolean {
				return verifiedArtifacts.has(canonicalJson(artifact));
			},
		};
	}

	return { openSession };
}
