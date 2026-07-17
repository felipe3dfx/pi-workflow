import assert from "node:assert/strict";
import test from "node:test";

import { publishApprovedRevision } from "../extensions/approved-revision-publication.ts";
import { createApprovedRevisionPublicationManifestStore } from "../extensions/approved-revision-publication-manifest.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

const actor = { actorId: "owner-1", role: "Owner", authorityRevision: "owner-r1" };

function approvedRevision(overrides = {}) {
	const payload = {
		definitionId: "definition-1",
		kind: "product-revision",
		authority: actor,
		affectedIssues: [
			{ id: "ILA-2296", previousDescription: "Spec anterior", previousRevision: "rev-parent-1", nextDescription: "Spec vigente revisado" },
			{ id: "ILA-2317", previousDescription: "Ticket anterior", previousRevision: "rev-ticket-1", nextDescription: "Ticket vigente revisado" },
		],
		sourceComment: {
			kind: "product-revision",
			body: "Revisión aprobada para el flujo.\n\nReferencia de flujo: product-revision:DIGEST",
		},
		decisionGap: {
			issueId: "ILA-2317",
			body: "Brecha de decisión documentada.\n\nReferencia de flujo: decision-gap:DIGEST",
		},
		...overrides,
	};
	const digest = digestCanonicalValue({ schema: "approved-revision", schemaVersion: 1, payload: { ...payload, sourceComment: { ...payload.sourceComment, body: payload.sourceComment.body.replaceAll("DIGEST", "placeholder") }, decisionGap: payload.decisionGap ? { ...payload.decisionGap, body: payload.decisionGap.body.replaceAll("DIGEST", "placeholder") } : undefined } });
	return {
		...payload,
		digest,
		sourceComment: { ...payload.sourceComment, body: payload.sourceComment.body.replaceAll("DIGEST", digest) },
		decisionGap: payload.decisionGap ? { ...payload.decisionGap, body: payload.decisionGap.body.replaceAll("DIGEST", digest) } : undefined,
	};
}

function memory() {
	let current;
	return {
		value: () => current?.value,
		read: async () => current,
		create: async (value) => (current = { revision: "r1", value: structuredClone(value) }),
		compareAndSwap: async (revision, value) => {
			assert.equal(revision, current.revision);
			current = { revision: `r${Number(current.revision.slice(1)) + 1}`, value: structuredClone(value) };
			return current;
		},
	};
}

function linear(overrides = {}) {
	const issues = new Map([
		["ILA-2296", { id: "ILA-2296", description: "Spec anterior", updatedAt: "rev-parent-1", workflow: { state: "In Progress", assignee: "owner-1", cycle: "cycle-1", labels: ["Felipe Gonzalez"], project: "Pi Workflow harness" } }],
		["ILA-2317", { id: "ILA-2317", description: "Ticket anterior", updatedAt: "rev-ticket-1", workflow: { state: "In Progress", assignee: "owner-1", cycle: "cycle-1", labels: ["Felipe Gonzalez"], project: "Pi Workflow harness" } }],
	]);
	const comments = new Map();
	const calls = [];
	return {
		calls,
		issues,
		comments,
		gateway: {
			getIssue: async ({ id }) => structuredClone(issues.get(id)),
			listComments: async ({ issueId }) => structuredClone(comments.get(issueId) ?? []),
			saveComment: async (input) => {
				assert.deepEqual(Object.keys(input).sort(), ["body", "issueId"], "comments must not carry workflow mutation fields");
				calls.push({ op: "saveComment", issueId: input.issueId, body: input.body });
				if (overrides.failCommentOnce && !overrides.failedComment) {
					overrides.failedComment = true;
					throw new Error("interrupted comment");
				}
				const entry = { id: `comment-${(comments.get(input.issueId) ?? []).length + 1}`, body: input.body };
				comments.set(input.issueId, [...(comments.get(input.issueId) ?? []), entry]);
				return structuredClone(entry);
			},
			saveIssue: async (input) => {
				assert.deepEqual(Object.keys(input).sort(), ["description", "id"], "issue updates must only send explicit description fields");
				calls.push({ op: "saveIssue", id: input.id, description: input.description });
				if (overrides.failIssueOnce && !overrides.failedIssue) {
					overrides.failedIssue = true;
					throw new Error("interrupted issue");
				}
				const current = issues.get(input.id);
				const updated = { ...current, description: input.description, updatedAt: `${current.updatedAt}:updated` };
				issues.set(input.id, updated);
				return structuredClone(updated);
			},
		},
	};
}

function deps({ revision = approvedRevision(), persistence = memory(), linearFake = linear(), currentActor = actor } = {}) {
	return {
		definitionId: revision.definitionId,
		digest: revision.digest,
		currentActor: async () => currentActor,
		readApprovedRevision: async (definitionId, digest) => definitionId === revision.definitionId && digest === revision.digest ? structuredClone(revision) : undefined,
		manifest: createApprovedRevisionPublicationManifestStore({ persistence }),
		gateway: linearFake.gateway,
		linearFake,
		persistence,
	};
}

test("publishes an approved Spanish multi-issue revision after validating every previous description", async () => {
	const subject = deps();
	const result = await publishApprovedRevision(subject);

	assert.deepEqual(result, { status: "revision-published", definitionId: "definition-1", digest: subject.digest });
	assert.deepEqual(subject.linearFake.calls.map((call) => call.op), ["saveComment", "saveComment", "saveComment", "saveIssue", "saveIssue"]);
	assert.equal(subject.linearFake.issues.get("ILA-2296").description, "Spec vigente revisado");
	assert.equal(subject.linearFake.issues.get("ILA-2317").description, "Ticket vigente revisado");
	assert.equal(subject.persistence.value().stage, "verified");
});

test("blocks stale revisions before comments or description mutations", async () => {
	const subject = deps();
	subject.linearFake.issues.get("ILA-2317").description = "Cambio humano no aprobado";
	const result = await publishApprovedRevision(subject);

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_REVISION_STALE");
	assert.deepEqual(subject.linearFake.calls, []);
});

test("is idempotent and treats same reference with different body as conflict", async () => {
	const subject = deps();
	assert.equal((await publishApprovedRevision(subject)).status, "revision-published");
	const retry = await publishApprovedRevision(subject);
	assert.equal(retry.status, "revision-published");
	assert.equal(subject.linearFake.calls.filter((call) => call.op === "saveComment").length, 3);
	assert.equal(subject.linearFake.calls.filter((call) => call.op === "saveIssue").length, 2);

	const conflicting = deps();
	conflicting.linearFake.comments.set("ILA-2296", [{ id: "comment-1", body: `Otro cuerpo.\n\nReferencia de flujo: product-revision:${conflicting.digest}` }]);
	const conflict = await publishApprovedRevision(conflicting);
	assert.equal(conflict.status, "blocked");
	assert.equal(conflict.blocker.code, "PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT");
	assert.deepEqual(conflicting.linearFake.calls, []);
});

test("recovers staged publication without duplicating comments or issue updates", async () => {
	const persistence = memory();
	const linearFake = linear({ failIssueOnce: true });
	const first = deps({ persistence, linearFake });
	assert.equal((await publishApprovedRevision(first)).status, "blocked");
	assert.equal(linearFake.calls.filter((call) => call.op === "saveComment").length, 3);
	assert.equal(linearFake.calls.filter((call) => call.op === "saveIssue").length, 1);

	const retry = deps({ persistence, linearFake, revision: await first.readApprovedRevision(first.definitionId, first.digest) });
	assert.equal((await publishApprovedRevision(retry)).status, "revision-published");
	assert.equal(linearFake.calls.filter((call) => call.op === "saveComment").length, 3);
	assert.equal(linearFake.calls.filter((call) => call.op === "saveIssue").length, 3);
	assert.equal(persistence.value().stage, "verified");
});

test("blocks approval drift because current Owner actor is bound to the digest", async () => {
	const subject = deps({ currentActor: { ...actor, authorityRevision: "owner-r2" } });
	const result = await publishApprovedRevision(subject);

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_REVISION_APPROVAL_MISMATCH");
	assert.deepEqual(subject.linearFake.calls, []);
});

test("rejects content forged under a caller-chosen approved digest", async () => {
	const revision = approvedRevision();
	const forged = { ...revision, affectedIssues: revision.affectedIssues.map((issue, index) => index === 0 ? { ...issue, nextDescription: "Descripción no aprobada" } : issue) };
	const subject = deps({ revision: forged });

	const result = await publishApprovedRevision(subject);

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_REVISION_ARTIFACT_INVALID");
	assert.deepEqual(subject.linearFake.calls, []);
});

test("does not treat an externally matching next description as recorded recovery", async () => {
	const linearFake = linear();
	linearFake.issues.set("ILA-2296", { ...linearFake.issues.get("ILA-2296"), description: "Spec vigente revisado", updatedAt: "unapproved-revision" });
	const subject = deps({ linearFake });

	const result = await publishApprovedRevision(subject);

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_REVISION_STALE");
	assert.deepEqual(linearFake.calls, []);
});
