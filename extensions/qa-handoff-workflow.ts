import {
	isQaHandoffDraft,
	type QaHandoffDraft,
	type QaHandoffDraftReader,
	type QaHandoffEvidenceReference,
} from "./qa-handoff-draft-store.ts";
import {
	canonicalJson,
	digestCanonicalValue,
	type AuthenticatedAuthority,
} from "./workflow-contracts.ts";

export type { QaHandoffDraft } from "./qa-handoff-draft-store.ts";

export interface QaHandoffArtifact {
	readonly schema: "qa-handoff";
	readonly schemaVersion: 1;
	readonly language: "es";
	readonly payload: QaHandoffDraft & {
		readonly issue: { readonly id: string; readonly revision: string };
		readonly authority: {
			readonly actorId: string;
			readonly role: "Developer";
			readonly authorityRevision: string;
		};
	};
	readonly digest: string;
	readonly body: string;
}

export interface LinearQaHandoffIssueSnapshot {
	readonly id: string;
	readonly identifier: string;
	readonly title: string;
	readonly description: string;
	readonly updatedAt: string;
	readonly state: unknown;
	readonly assignee: unknown;
	readonly cycle: unknown;
	readonly labels: unknown;
	readonly estimate: unknown;
	readonly relations: unknown;
	readonly parent?: unknown;
}

export interface LinearQaHandoffGateway {
	getIssue(input: {
		readonly id: string;
	}): Promise<LinearQaHandoffIssueSnapshot | undefined>;
	listComments(input: {
		readonly issueId: string;
		readonly cursor?: string;
	}): Promise<{
		readonly comments: readonly { readonly id: string; readonly body: string }[];
		readonly nextCursor?: string;
	}>;
	createComment(input: {
		readonly issueId: string;
		readonly body: string;
	}): Promise<{ readonly id: string; readonly body: string }>;
}

export interface QaHandoffArtifactStore {
	read(issueId: string): Promise<QaHandoffArtifact | undefined>;
	save(artifact: QaHandoffArtifact): Promise<QaHandoffArtifact>;
}

interface Dependencies {
	readonly gateway: LinearQaHandoffGateway;
	readonly artifacts: QaHandoffArtifactStore;
	readonly drafts: QaHandoffDraftReader;
	readonly currentDeveloper: () => Promise<AuthenticatedAuthority | undefined>;
}

interface Blocker {
	readonly code: string;
	readonly message: string;
}

type AuthorizationOutcome =
	| { readonly status: "authorized"; readonly artifact: QaHandoffArtifact }
	| { readonly status: "blocked"; readonly blocker: Blocker };

type PublicationOutcome =
	| {
			readonly status: "published";
			readonly artifact: QaHandoffArtifact;
			readonly comment: { readonly id: string; readonly body: string };
	  }
	| { readonly status: "blocked"; readonly blocker: Blocker };

const blocked = (code: string, message: string): { status: "blocked"; blocker: Blocker } => ({
	status: "blocked",
	blocker: { code, message },
});

const text = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value === value.trim();
const linearIssueId = (value: unknown): value is string =>
	text(value) && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(value);

function hasExactKeys(
	value: object,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean {
	const keys = Object.keys(value);
	return required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key));
}

function immutableSnapshot<T>(value: T): T {
	const snapshot = structuredClone(value);
	const freeze = (candidate: unknown): void => {
		if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
		for (const child of Object.values(candidate)) freeze(child);
		Object.freeze(candidate);
	};
	freeze(snapshot);
	return snapshot;
}

function evidence(reference: QaHandoffEvidenceReference): string {
	const label = reference.url ? `[${reference.label}](${reference.url})` : reference.label;
	return `${label} (\`${reference.ref}\`)`;
}

function renderQaHandoffBody(
	payload: QaHandoffArtifact["payload"],
	digest: string,
): string {
	const sections = [
		`# Entrega para QA — ${payload.issue.id}`,
		[
			"## Resultado",
			"**Estado:** Listo para QA",
			payload.outcome.summary,
		].join("\n\n"),
		[
			"## Evidencia de PR y build",
			`- **PR:** ${evidence(payload.pullRequest)}`,
			`- **Build:** ${evidence(payload.build)}`,
		].join("\n\n").replace("\n\n- **Build", "\n- **Build"),
		[
			"## Entorno de QA",
			[
				`- **Entorno:** ${payload.qaEnvironment.name}`,
				`- **URL:** ${payload.qaEnvironment.url}`,
				...(payload.qaEnvironment.revision
					? [`- **Revisión:** \`${payload.qaEnvironment.revision}\``]
					: []),
			].join("\n"),
		].join("\n\n"),
		[
			"## Criterios de aceptación",
			payload.acceptanceCriteria.flatMap((criterion) => [
				`- [ ] **${criterion.id}:** ${criterion.description}`,
				`  - Evidencia: ${criterion.evidence.map(evidence).join("; ")}`,
			]).join("\n"),
		].join("\n\n"),
		[
			"## Guía de pruebas",
			payload.testGuidance.map((guidance, index) => `${index + 1}. ${guidance}`).join("\n"),
		].join("\n\n"),
		[
			"## Riesgos y restricciones",
			payload.risksAndConstraints.length > 0
				? payload.risksAndConstraints.map((risk) => `- ${risk}`).join("\n")
				: "Ninguno conocido.",
		].join("\n\n"),
	];
	if (payload.outOfScope?.length) {
		sections.push(
			[
				"## Fuera de alcance",
				payload.outOfScope.map((item) => `- ${item}`).join("\n"),
			].join("\n\n"),
		);
	}
	sections.push(`Referencia de flujo: qa-handoff:${digest}`);
	return `${sections.join("\n\n")}\n`;
}

function developer(
	value: unknown,
): value is AuthenticatedAuthority & { role: "Developer" } {
	return !!value && typeof value === "object" && !Array.isArray(value) &&
		"role" in value && value.role === "Developer" &&
		"actorId" in value && text(value.actorId) &&
		"authorityRevision" in value && text(value.authorityRevision);
}

function createArtifact(
	issue: LinearQaHandoffIssueSnapshot,
	authority: AuthenticatedAuthority & { role: "Developer" },
	draft: QaHandoffDraft,
): QaHandoffArtifact {
	const { outOfScope, ...requiredDraft } = draft;
	const payload: QaHandoffArtifact["payload"] = structuredClone({
		issue: { id: issue.id, revision: issue.updatedAt },
		authority: {
			actorId: authority.actorId,
			role: "Developer",
			authorityRevision: authority.authorityRevision,
		},
		...requiredDraft,
		...(outOfScope?.length ? { outOfScope } : {}),
	});
	const digest = digestCanonicalValue({
		schema: "qa-handoff",
		schemaVersion: 1,
		language: "es",
		payload,
	});
	return {
		schema: "qa-handoff",
		schemaVersion: 1,
		language: "es",
		payload,
		digest,
		body: renderQaHandoffBody(payload, digest),
	};
}

export function isQaHandoffArtifact(
	value: unknown,
	issueId: string,
): value is QaHandoffArtifact {
	if (!linearIssueId(issueId) || !value || typeof value !== "object" ||
		Array.isArray(value) ||
		!hasExactKeys(value, ["schema", "schemaVersion", "language", "payload", "digest", "body"]) ||
		!("schema" in value) || value.schema !== "qa-handoff" ||
		!("schemaVersion" in value) || value.schemaVersion !== 1 ||
		!("language" in value) || value.language !== "es" ||
		!("payload" in value) || !value.payload || typeof value.payload !== "object" ||
		Array.isArray(value.payload)) return false;
	const payload = value.payload;
	if (!hasExactKeys(
		payload,
		[
			"outcome",
			"pullRequest",
			"build",
			"qaEnvironment",
			"acceptanceCriteria",
			"testGuidance",
			"risksAndConstraints",
			"issue",
			"authority",
		],
		["outOfScope"],
	) || !("issue" in payload) || !payload.issue ||
		typeof payload.issue !== "object" || Array.isArray(payload.issue) ||
		!hasExactKeys(payload.issue, ["id", "revision"]) ||
		!("id" in payload.issue) || payload.issue.id !== issueId ||
		!("revision" in payload.issue) || !text(payload.issue.revision) ||
		!("authority" in payload) || !payload.authority ||
		typeof payload.authority !== "object" || Array.isArray(payload.authority) ||
		!hasExactKeys(payload.authority, ["actorId", "role", "authorityRevision"]) ||
		!developer(payload.authority)) return false;
	const { issue: _issue, authority: _authority, ...draft } = payload;
	if (!isQaHandoffDraft(draft)) return false;
	const typedPayload: QaHandoffArtifact["payload"] = {
		...draft,
		issue: { id: payload.issue.id, revision: payload.issue.revision },
		authority: payload.authority,
	};
	const digest = digestCanonicalValue({
		schema: value.schema,
		schemaVersion: value.schemaVersion,
		language: value.language,
		payload,
	});
	return "digest" in value && value.digest === digest &&
		"body" in value && value.body === renderQaHandoffBody(typedPayload, digest);
}

function hasExactVisibleReferenceLine(body: string, reference: string): boolean {
	return body.split(/\r\n|\n|\r/).some((line) => line === reference);
}

async function allComments(gateway: LinearQaHandoffGateway, issueId: string) {
	const comments: { id: string; body: string }[] = [];
	let cursor: string | undefined;
	const seen = new Set<string>();
	do {
		const page = await gateway.listComments({ issueId, cursor });
		for (const comment of page.comments) {
			if (!text(comment.id) || typeof comment.body !== "string")
				throw Object.assign(new Error("Linear returned a malformed comment page."), {
					code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
				});
			comments.push({ id: comment.id, body: comment.body });
		}
		if (page.nextCursor !== undefined && !text(page.nextCursor))
			throw Object.assign(new Error("Linear returned a malformed comment cursor."), {
				code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
			});
		cursor = page.nextCursor;
		if (cursor && seen.has(cursor))
			throw Object.assign(new Error("Linear repeated a comment cursor."), {
				code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
			});
		if (cursor) seen.add(cursor);
	} while (cursor);
	return comments;
}

export function createQaHandoffWorkflow(dependencies: Dependencies) {
	let activeAuthorization:
		| { issueId: string; issueRevision: string; digest: string; authorityRevision: string }
		| undefined;

	async function authorizeInvocation(issueId: string): Promise<AuthorizationOutcome> {
		activeAuthorization = undefined;
		try {
			if (!linearIssueId(issueId))
				return blocked("PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH", "A single Linear issue ID is required.");
			const [issue, draft, authority] = await Promise.all([
				dependencies.gateway.getIssue({ id: issueId }),
				dependencies.drafts.read(issueId),
				dependencies.currentDeveloper(),
			]);
			if (!issue || issue.id !== issueId || !text(issue.updatedAt))
				return blocked("PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH", "The QA handoff issue is unavailable or mismatched.");
			if (!developer(authority))
				return blocked("PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH", "Exact Developer authority is required.");
			if (!isQaHandoffDraft(draft))
				return blocked("PI_WORKFLOW_QA_HANDOFF_ARTIFACT_INVALID", "Complete structured QA handoff evidence is required.");
			const candidate = createArtifact(issue, authority, draft);
			const existing = await dependencies.artifacts.read(issueId);
			if (existing && (!isQaHandoffArtifact(existing, issueId) || existing.digest !== candidate.digest))
				return blocked("PI_WORKFLOW_QA_HANDOFF_ARTIFACT_CONFLICT", "The issue already has a different QA handoff artifact.");
			const saved = existing ?? await dependencies.artifacts.save(candidate);
			const readBack = await dependencies.artifacts.read(issueId);
			if (!readBack || canonicalJson(readBack) !== canonicalJson(saved) || !isQaHandoffArtifact(readBack, issueId))
				return blocked("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "The QA handoff artifact read-back did not match.");
			activeAuthorization = {
				issueId,
				issueRevision: readBack.payload.issue.revision,
				digest: readBack.digest,
				authorityRevision: readBack.payload.authority.authorityRevision,
			};
			return { status: "authorized", artifact: immutableSnapshot(readBack) };
		} catch (error) {
			return blocked(
				(error as { code?: string }).code ?? "PI_WORKFLOW_QA_HANDOFF_PREPARATION_FAILED",
				error instanceof Error ? error.message : "QA handoff preparation failed.",
			);
		}
	}

	async function publish(input: unknown): Promise<PublicationOutcome> {
		try {
			if (!input || typeof input !== "object" || Array.isArray(input) ||
				Object.keys(input).length !== 1 || !("issueId" in input) ||
				!linearIssueId((input as { issueId?: unknown }).issueId))
				return blocked("PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID", "Publication accepts exactly one Linear issue ID.");
			const publication = input as { issueId: string };
			const authorization = activeAuthorization;
			if (!authorization || publication.issueId !== authorization.issueId)
				return blocked("PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH", "Publication must match the explicitly authorized issue.");
			const [artifact, issueBefore, authority] = await Promise.all([
				dependencies.artifacts.read(publication.issueId),
				dependencies.gateway.getIssue({ id: publication.issueId }),
				dependencies.currentDeveloper(),
			]);
			if (!artifact || !isQaHandoffArtifact(artifact, publication.issueId) || artifact.digest !== authorization.digest)
				return blocked("PI_WORKFLOW_QA_HANDOFF_DIGEST_MISMATCH", "The authorized QA handoff digest changed before publication.");
			if (!issueBefore || issueBefore.id !== artifact.payload.issue.id ||
				issueBefore.updatedAt !== artifact.payload.issue.revision ||
				issueBefore.updatedAt !== authorization.issueRevision)
				return blocked("PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH", "The Linear issue revision changed before publication.");
			if (!developer(authority) || canonicalJson(authority) !== canonicalJson(artifact.payload.authority) ||
				authority.authorityRevision !== authorization.authorityRevision)
				return blocked("PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH", "Developer authority changed before publication.");

			const marker = `Referencia de flujo: qa-handoff:${artifact.digest}`;
			const beforeComments = await allComments(dependencies.gateway, publication.issueId);
			const matching = beforeComments.filter((comment) =>
				hasExactVisibleReferenceLine(comment.body, marker));
			if (matching.some((comment) => comment.body !== artifact.body))
				return blocked("PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT", "The QA handoff reference already exists with a different body.");
			let comment = matching.find((candidate) => candidate.body === artifact.body);
			if (!comment) {
				const created = await dependencies.gateway.createComment({
					issueId: publication.issueId,
					body: artifact.body,
				});
				if (!text(created.id) || created.body !== artifact.body)
					return blocked("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE", "Linear returned a malformed comment creation response.");
				comment = created;
			}
			const [commentsAfter, issueAfter] = await Promise.all([
				allComments(dependencies.gateway, publication.issueId),
				dependencies.gateway.getIssue({ id: publication.issueId }),
			]);
			const readBack = commentsAfter.find((candidate) =>
				candidate.id === comment?.id && candidate.body === artifact.body);
			if (!readBack || !issueAfter || canonicalJson(issueAfter) !== canonicalJson(issueBefore))
				return blocked("PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH", "The QA handoff comment or full issue snapshot changed during read-back.");
			return {
				status: "published",
				artifact: immutableSnapshot(artifact),
				comment: immutableSnapshot(readBack),
			};
		} catch (error) {
			return blocked(
				(error as { code?: string }).code ?? "PI_WORKFLOW_QA_HANDOFF_PUBLICATION_FAILED",
				error instanceof Error ? error.message : "QA handoff publication failed.",
			);
		}
	}

	return { authorizeInvocation, publish };
}
