import {
	canonicalJson,
	digestCanonicalValue,
} from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface QaHandoffEvidenceReference {
	readonly ref: string;
	readonly label: string;
	readonly url?: string;
}

export interface QaHandoffDraft {
	readonly outcome: {
		readonly status: "ready-for-qa";
		readonly summary: string;
	};
	readonly pullRequest: QaHandoffEvidenceReference;
	readonly build: QaHandoffEvidenceReference;
	readonly qaEnvironment: {
		readonly name: string;
		readonly url: string;
		readonly revision?: string;
	};
	readonly acceptanceCriteria: readonly {
		readonly id: string;
		readonly description: string;
		readonly evidence: readonly QaHandoffEvidenceReference[];
	}[];
	readonly testGuidance: readonly string[];
	readonly risksAndConstraints: readonly string[];
	readonly outOfScope?: readonly string[];
}

export interface QaHandoffDraftArtifact {
	readonly schema: "qa-handoff-draft";
	readonly schemaVersion: 1;
	readonly payload: {
		readonly issue: { readonly id: string };
		readonly draft: QaHandoffDraft;
	};
	readonly digest: string;
}

export interface QaHandoffDraftReader {
	read(issueId: string): Promise<QaHandoffDraft | undefined>;
}

export interface QaHandoffDraftStore extends QaHandoffDraftReader {
	save(input: {
		readonly issueId: string;
		readonly draft: QaHandoffDraft;
	}): Promise<QaHandoffDraftArtifact>;
}

const text = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value === value.trim();
const linearIssueId = (value: unknown): value is string =>
	text(value) && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(value);

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
	value: object,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const keys = Object.keys(value);
	return required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key));
}

function validEvidence(value: unknown): value is QaHandoffEvidenceReference {
	if (!record(value) || !hasExactKeys(value, ["ref", "label"], ["url"]))
		return false;
	return text(value.ref) && text(value.label) &&
		(value.url === undefined || text(value.url));
}

export function isQaHandoffDraft(value: unknown): value is QaHandoffDraft {
	if (!record(value) || !hasExactKeys(
		value,
		[
			"outcome",
			"pullRequest",
			"build",
			"qaEnvironment",
			"acceptanceCriteria",
			"testGuidance",
			"risksAndConstraints",
		],
		["outOfScope"],
	)) return false;
	const draft = value as Partial<QaHandoffDraft>;
	return record(draft.outcome) &&
		hasExactKeys(draft.outcome, ["status", "summary"]) &&
		draft.outcome.status === "ready-for-qa" && text(draft.outcome.summary) &&
		validEvidence(draft.pullRequest) && validEvidence(draft.build) &&
		record(draft.qaEnvironment) &&
		hasExactKeys(draft.qaEnvironment, ["name", "url"], ["revision"]) &&
		text(draft.qaEnvironment.name) && text(draft.qaEnvironment.url) &&
		(draft.qaEnvironment.revision === undefined || text(draft.qaEnvironment.revision)) &&
		Array.isArray(draft.acceptanceCriteria) && draft.acceptanceCriteria.length > 0 &&
		draft.acceptanceCriteria.every((criterion) =>
			record(criterion) && hasExactKeys(criterion, ["id", "description", "evidence"]) &&
			text(criterion.id) && text(criterion.description) &&
			Array.isArray(criterion.evidence) && criterion.evidence.length > 0 &&
			criterion.evidence.every(validEvidence)) &&
		Array.isArray(draft.testGuidance) && draft.testGuidance.length > 0 &&
		draft.testGuidance.every(text) &&
		Array.isArray(draft.risksAndConstraints) && draft.risksAndConstraints.every(text) &&
		(draft.outOfScope === undefined ||
			(Array.isArray(draft.outOfScope) && draft.outOfScope.every(text)));
}

export function isQaHandoffDraftArtifact(
	value: unknown,
	issueId: string,
): value is QaHandoffDraftArtifact {
	if (!linearIssueId(issueId) || !record(value) ||
		!hasExactKeys(value, ["schema", "schemaVersion", "payload", "digest"]) ||
		value.schema !== "qa-handoff-draft" || value.schemaVersion !== 1 ||
		!record(value.payload) ||
		!hasExactKeys(value.payload, ["issue", "draft"]) ||
		!record(value.payload.issue) ||
		!hasExactKeys(value.payload.issue, ["id"]) ||
		value.payload.issue.id !== issueId ||
		!isQaHandoffDraft(value.payload.draft)) return false;
	return value.digest === digestCanonicalValue({
		schema: value.schema,
		schemaVersion: value.schemaVersion,
		payload: value.payload,
	});
}

function invalid(message: string): Error {
	return Object.assign(new Error(message), {
		code: "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_INVALID",
	});
}

function parse(content: string, issueId: string): QaHandoffDraftArtifact {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw invalid("The QA handoff draft is not valid JSON.");
	}
	if (!isQaHandoffDraftArtifact(value, issueId))
		throw invalid("The qa-handoff-draft/v1 artifact is invalid or issue-mismatched.");
	if (content !== `${canonicalJson(value)}\n`)
		throw invalid("The qa-handoff-draft/v1 artifact bytes are not canonical JSON plus newline.");
	return value;
}

/**
 * Creates the supported create-only producer/reader boundary for qa-handoff-draft/v1.
 * The public QA handoff tool never receives this artifact or its payload.
 */
export function createQaHandoffDraftStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string;
	readonly topic?: string;
}): QaHandoffDraftStore {
	const prefix = options.topic ?? "workflow/qa-handoff-draft";
	const destination = (issueId: string) => `${prefix}/${issueId}`;

	return {
		async read(issueId) {
			if (!linearIssueId(issueId))
				throw invalid("A valid Linear issue ID is required for the QA handoff draft.");
			const topic = destination(issueId);
			const current = await options.store.readCurrent(options.project, topic);
			if (!current) return undefined;
			const readBack = await options.store.readRevision(
				options.project,
				topic,
				current.revision,
			);
			if (readBack !== current.content)
				throw invalid("The QA handoff draft read-back did not match.");
			return structuredClone(parse(current.content, issueId).payload.draft);
		},
		async save({ issueId, draft }) {
			if (options.store.capabilities?.atomicCompareAndSwap !== true)
				throw invalid("Atomic compare-and-swap is required for QA handoff drafts.");
			if (!linearIssueId(issueId) || !isQaHandoffDraft(draft))
				throw invalid("The qa-handoff-draft/v1 producer input is invalid.");
			const unsigned = {
				schema: "qa-handoff-draft" as const,
				schemaVersion: 1 as const,
				payload: {
					issue: { id: issueId },
					draft: structuredClone(draft),
				},
			};
			const artifact: QaHandoffDraftArtifact = {
				...unsigned,
				digest: digestCanonicalValue(unsigned),
			};
			const topic = destination(issueId);
			const content = `${canonicalJson(artifact)}\n`;
			const current = await options.store.readCurrent(options.project, topic);
			if (current) {
				parse(current.content, issueId);
				if (current.content !== content)
					throw invalid("The QA handoff draft conflicts with its create-only artifact.");
				const readBack = await options.store.readRevision(
					options.project,
					topic,
					current.revision,
				);
				if (readBack !== content)
					throw invalid("The QA handoff draft read-back did not match.");
				return structuredClone(artifact);
			}
			const { revision } = await options.store.write(
				options.project,
				topic,
				content,
				undefined,
			);
			const readBack = await options.store.readRevision(
				options.project,
				topic,
				revision,
			);
			if (readBack !== content)
				throw invalid("The QA handoff draft read-back did not match.");
			return structuredClone(parse(content, issueId));
		},
	};
}
