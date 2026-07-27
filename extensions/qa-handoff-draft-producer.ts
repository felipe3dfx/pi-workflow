import {
	isQaHandoffDraft,
	type QaHandoffDraft,
	type QaHandoffEvidenceReference,
} from "./qa-handoff-draft-store.ts";

interface AttachmentEvidence {
	readonly id: string;
	readonly title: string;
	readonly url: string;
}

interface ProducerEvidence {
	readonly description: string;
	readonly attachments: readonly AttachmentEvidence[];
}

type ProducerOutcome =
	| { readonly status: "produced"; readonly draft: QaHandoffDraft }
	| { readonly status: "blocked"; readonly blocker: { readonly code: string; readonly message: string } };

const blockPattern = /```qa-handoff-evidence\n([^\r\n]+)\n```/g;
const text = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value === value.trim();
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const httpsUrl = (value: string): boolean => {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
};
const pullRequestUrl = (value: string): boolean => {
	if (!httpsUrl(value)) return false;
	const { hostname, pathname } = new URL(value);
	return (hostname === "github.com" && /^\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*\/?$/.test(pathname)) ||
		(hostname === "gitlab.com" && /^\/(?:[^/]+\/)+[^/]+\/-\/merge_requests\/[1-9][0-9]*\/?$/.test(pathname)) ||
		(hostname === "bitbucket.org" && /^\/[^/]+\/[^/]+\/pull-requests\/[1-9][0-9]*\/?$/.test(pathname));
};
const exactKeys = (value: object, required: readonly string[]): boolean => {
	const keys = Object.keys(value);
	return keys.length === required.length && required.every((key) => keys.includes(key));
};

function blocked(code: string, message: string): ProducerOutcome {
	return { status: "blocked", blocker: { code, message } };
}

function parseManifest(description: string): Record<string, unknown> | undefined {
	const matches = [...description.matchAll(blockPattern)];
	if (matches.length !== 1 || !matches[0]?.[1]) return undefined;
	try {
		const value: unknown = JSON.parse(matches[0][1]);
		return record(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function reference(attachment: AttachmentEvidence): QaHandoffEvidenceReference {
	return {
		ref: `linear-attachment:${attachment.id}`,
		label: attachment.title,
		url: attachment.url,
	};
}

export function produceQaHandoffDraft(evidence: ProducerEvidence): ProducerOutcome {
	if (!text(evidence.description) || !Array.isArray(evidence.attachments) ||
		evidence.attachments.some((item) => !record(item) ||
			!exactKeys(item, ["id", "title", "url"]) ||
			!text(item.id) || !text(item.title) || !text(item.url) || !httpsUrl(item.url))) {
		return blocked("PI_WORKFLOW_QA_HANDOFF_EVIDENCE_INVALID", "Linear returned malformed QA handoff evidence.");
	}
	const manifest = parseManifest(evidence.description);
	const manifestKeys = [
		"schema",
		"schemaVersion",
		"pullRequestAttachmentId",
		"buildAttachmentId",
		"qaEnvironmentAttachmentId",
		"acceptanceCriteria",
	] as const;
	if (!manifest || Object.keys(manifest).some((key) => !manifestKeys.includes(key as typeof manifestKeys[number])) ||
		manifest.schema !== "qa-handoff-evidence" || manifest.schemaVersion !== 1) {
		return blocked("PI_WORKFLOW_QA_HANDOFF_EVIDENCE_INVALID", "Add one closed qa-handoff-evidence/v1 block to the Linear issue description.");
	}
	if (!text(manifest.pullRequestAttachmentId))
		return blocked("PI_WORKFLOW_QA_HANDOFF_PR_EVIDENCE_MISSING", "Reference one attached pull request in qa-handoff-evidence/v1.");
	if (!text(manifest.buildAttachmentId))
		return blocked("PI_WORKFLOW_QA_HANDOFF_BUILD_EVIDENCE_MISSING", "Reference one attached verified build in qa-handoff-evidence/v1.");
	if (!text(manifest.qaEnvironmentAttachmentId))
		return blocked("PI_WORKFLOW_QA_HANDOFF_QA_ENVIRONMENT_MISSING", "Reference one attached QA environment in qa-handoff-evidence/v1.");
	if (!Array.isArray(manifest.acceptanceCriteria) || manifest.acceptanceCriteria.length === 0)
		return blocked("PI_WORKFLOW_QA_HANDOFF_ACCEPTANCE_EVIDENCE_MISSING", "Provide at least one acceptance criterion with attached evidence.");
	const byId = new Map<string, AttachmentEvidence>();
	for (const attachment of evidence.attachments) {
		if (byId.has(attachment.id))
			return blocked("PI_WORKFLOW_QA_HANDOFF_EVIDENCE_INVALID", "Linear returned duplicate attachment evidence.");
		byId.set(attachment.id, attachment);
	}
	if (new Set([
		manifest.pullRequestAttachmentId,
		manifest.buildAttachmentId,
		manifest.qaEnvironmentAttachmentId,
	]).size !== 3)
		return blocked("PI_WORKFLOW_QA_HANDOFF_EVIDENCE_INVALID", "PR, build, and QA environment must use distinct Linear attachments.");
	const pullRequest = byId.get(manifest.pullRequestAttachmentId);
	if (!pullRequest || !pullRequestUrl(pullRequest.url))
		return blocked("PI_WORKFLOW_QA_HANDOFF_PR_EVIDENCE_MISSING", "Attach a recognized GitHub, GitLab, or Bitbucket pull request to the Linear issue.");
	const build = byId.get(manifest.buildAttachmentId);
	if (!build)
		return blocked("PI_WORKFLOW_QA_HANDOFF_BUILD_EVIDENCE_MISSING", "Attach the referenced verified build to the Linear issue.");
	const environment = byId.get(manifest.qaEnvironmentAttachmentId);
	if (!environment)
		return blocked("PI_WORKFLOW_QA_HANDOFF_QA_ENVIRONMENT_MISSING", "Attach the referenced QA environment to the Linear issue.");

	const ids = new Set<string>();
	const acceptanceCriteria: QaHandoffDraft["acceptanceCriteria"][number][] = [];
	for (const value of manifest.acceptanceCriteria) {
		if (!record(value) || !exactKeys(value, ["id", "description", "evidenceAttachmentIds"]) ||
			!text(value.id) || !/^AC-[1-9][0-9]*$/.test(value.id) || ids.has(value.id) ||
			!text(value.description) || !Array.isArray(value.evidenceAttachmentIds) ||
			value.evidenceAttachmentIds.length === 0 ||
			value.evidenceAttachmentIds.some((id) => !text(id)) ||
			new Set(value.evidenceAttachmentIds).size !== value.evidenceAttachmentIds.length) {
			return blocked("PI_WORKFLOW_QA_HANDOFF_ACCEPTANCE_EVIDENCE_MISSING", "Provide unique acceptance criteria with referenced Linear attachments.");
		}
		ids.add(value.id);
		const references = value.evidenceAttachmentIds.map((id) => byId.get(id));
		if (references.some((item) => item === undefined))
			return blocked("PI_WORKFLOW_QA_HANDOFF_ACCEPTANCE_EVIDENCE_MISSING", `Attach all evidence referenced by ${value.id}.`);
		acceptanceCriteria.push({
			id: value.id,
			description: value.description,
			evidence: (references as AttachmentEvidence[]).map(reference),
		});
	}
	const count = acceptanceCriteria.length;
	const draft: QaHandoffDraft = {
		outcome: {
			status: "ready-for-qa",
			summary: `La entrega cuenta con evidencia verificable para ${count} ${count === 1 ? "criterio" : "criterios"} de aceptación.`,
		},
		pullRequest: reference(pullRequest),
		build: reference(build),
		qaEnvironment: { name: environment.title, url: environment.url },
		acceptanceCriteria,
		testGuidance: acceptanceCriteria.map(({ id }) => `Validar ${id} con la evidencia referenciada.`),
		risksAndConstraints: [],
	};
	return isQaHandoffDraft(draft)
		? { status: "produced", draft }
		: blocked("PI_WORKFLOW_QA_HANDOFF_EVIDENCE_INVALID", "The verified evidence could not produce qa-handoff-draft/v1.");
}
