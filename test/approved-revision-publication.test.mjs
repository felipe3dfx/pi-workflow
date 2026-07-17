import assert from "node:assert/strict";
import test from "node:test";

import { approveDraftedRevision, draftApprovedRevision, publishApprovedRevision } from "../extensions/approved-revision-publication.ts";
import { createApprovedRevisionStore } from "../extensions/approved-revision-store.ts";
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
				if (overrides.mutateWorkflowOn === "comment") issues.get(input.issueId).workflow.state = "Done";
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
				const updated = { ...current, description: input.description, updatedAt: `${current.updatedAt}:updated`, workflow: structuredClone(current.workflow) };
				if (overrides.mutateWorkflowOn === "issue" || (overrides.mutateAndInterruptIssueOnce && !overrides.interruptedIssue)) updated.workflow.cycle = "cycle-2";
				issues.set(input.id, updated);
				if (overrides.mutateAndInterruptIssueOnce && !overrides.interruptedIssue) {
					overrides.interruptedIssue = true;
					throw new Error("interrupted after issue mutation");
				}
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

function artifactMemory() {
	let revision = 0;
	const bytes = new Map();
	return {
		capabilities: { atomicCompareAndSwap: true },
		bytes,
		readCurrent: async (_project, topic) => bytes.get(topic)?.at(-1),
		write: async (_project, topic, content, expectedRevision) => {
			const versions = bytes.get(topic) ?? [];
			if (versions.at(-1)?.revision !== expectedRevision) throw new Error("compare-and-swap conflict");
			revision += 1;
			versions.push({ revision: `artifact-r${revision}`, content });
			bytes.set(topic, versions);
			return { revision: `artifact-r${revision}` };
		},
		readRevision: async (_project, topic, target) => bytes.get(topic)?.find((entry) => entry.revision === target)?.content,
	};
}

test("normalizes legacy schema-v1 manifests that predate description claims", async () => {
	const revision = approvedRevision();
	const identity = { definitionId: revision.definitionId, digest: revision.digest, affectedIssueIds: revision.affectedIssues.map(({ id }) => id).sort() };
	const operationId = digestCanonicalValue(identity);
	let current = { revision: "r1", value: { ...identity, schemaVersion: 1, operationId, stage: "commenting", comments: [], descriptions: [] } };
	const store = createApprovedRevisionPublicationManifestStore({ persistence: {
		read: async () => structuredClone(current),
		create: async () => { throw new Error("unexpected create"); },
		compareAndSwap: async (_revision, value) => (current = { revision: "r2", value: structuredClone(value) }),
	} });

	const recovered = await store.prepare(identity);
	assert.deepEqual(recovered.descriptionClaims, []);
	assert.deepEqual((await store.read(operationId)).descriptionClaims, []);
});

test("publishes an approved Spanish multi-issue revision after validating every previous description", async () => {
	const subject = deps();
	const result = await publishApprovedRevision(subject);

	assert.deepEqual(result, { status: "revision-published", definitionId: "definition-1", digest: subject.digest });
	assert.deepEqual(subject.linearFake.calls.map((call) => call.op), ["saveComment", "saveComment", "saveComment", "saveIssue", "saveIssue"]);
	assert.equal(subject.linearFake.issues.get("ILA-2296").description, "Spec vigente revisado");
	assert.equal(subject.linearFake.issues.get("ILA-2317").description, "Ticket vigente revisado");
	assert.equal(subject.persistence.value().stage, "verified");
});

test("blocks when comment or description writes mutate workflow fields", async () => {
	for (const mutation of ["comment", "issue"]) {
		const subject = deps({ linearFake: linear({ mutateWorkflowOn: mutation }) });
		const result = await publishApprovedRevision(subject);
		assert.equal(result.status, "blocked", mutation);
		assert.equal(result.blocker.code, "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH", mutation);
		assert.notEqual(subject.persistence.value().stage, "verified", mutation);
	}
});

test("recovery compares workflow to the durable pre-write claim after mutation and interruption", async () => {
	const subject = deps({ linearFake: linear({ mutateAndInterruptIssueOnce: true }) });
	assert.equal((await publishApprovedRevision(subject)).status, "blocked");
	const claim = subject.persistence.value().descriptionClaims[0];
	assert.equal(claim.workflowDigest, digestCanonicalValue({ state: "In Progress", assignee: "owner-1", cycle: "cycle-1", labels: ["Felipe Gonzalez"], project: "Pi Workflow harness" }));

	const recovered = await publishApprovedRevision(subject);
	assert.equal(recovered.status, "blocked");
	assert.equal(recovered.blocker.code, "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH");
	assert.notEqual(subject.persistence.value().stage, "verified");
});

test("upgrades a legacy description claim with a workflow digest before retrying its write", async () => {
	const subject = deps({ linearFake: linear({ failIssueOnce: true }) });
	assert.equal((await publishApprovedRevision(subject)).status, "blocked");
	delete subject.persistence.value().descriptionClaims[0].workflowDigest;

	const recovered = await publishApprovedRevision(subject);
	assert.equal(recovered.status, "revision-published", JSON.stringify(recovered));
	assert.match(subject.persistence.value().descriptionClaims[0].workflowDigest, /^[a-f0-9]{64}$/);
	assert.equal(subject.linearFake.issues.get("ILA-2296").description, "Spec vigente revisado");
});

test("fails closed for a legacy description claim when the description already changed", async () => {
	const subject = deps({ linearFake: linear({ failIssueOnce: true }) });
	assert.equal((await publishApprovedRevision(subject)).status, "blocked");
	delete subject.persistence.value().descriptionClaims[0].workflowDigest;
	const current = subject.linearFake.issues.get("ILA-2296");
	subject.linearFake.issues.set("ILA-2296", { ...current, description: "Spec vigente revisado", updatedAt: `${current.updatedAt}:external` });

	const recovered = await publishApprovedRevision(subject);
	assert.equal(recovered.status, "blocked");
	assert.equal(recovered.blocker.code, "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH");
	assert.equal(subject.persistence.value().descriptionClaims[0].workflowDigest, undefined);
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

test("drafts an approved revision by reading current Linear descriptions before persisting Engram draft", async () => {
	const linearFake = linear();
	const store = createApprovedRevisionStore({ store: artifactMemory(), project: "pi-workflow", topic: "workflow/define-product" });

	const result = await draftApprovedRevision({
		gateway: linearFake.gateway,
		store,
		input: {
			definitionId: "definition-1",
			revisionKind: "product-revision",
			affectedIssues: [
				{ id: "ILA-2296", nextDescription: "Spec vigente revisado" },
				{ id: "ILA-2317", nextDescription: "Ticket vigente revisado" },
			],
			sourceCommentKind: "product-revision",
			sourceCommentBody: "Revisión aprobada para el flujo.\n\nReferencia de flujo: product-revision:{{digest}}",
			decisionGap: { issueId: "ILA-2317", body: "Brecha de decisión documentada.\n\nReferencia de flujo: decision-gap:{{digest}}" },
		},
	});

	assert.equal(result.status, "revision-ready");
	assert.equal(result.revisionRef.schema, "approved-revision-draft");
	assert.deepEqual(result.revision.affectedIssues.map(({ id, previousDescription, previousRevision, nextDescription }) => ({ id, previousDescription, previousRevision, nextDescription })), [
		{ id: "ILA-2296", previousDescription: "Spec anterior", previousRevision: "rev-parent-1", nextDescription: "Spec vigente revisado" },
		{ id: "ILA-2317", previousDescription: "Ticket anterior", previousRevision: "rev-ticket-1", nextDescription: "Ticket vigente revisado" },
	]);
	assert.match(result.revision.sourceComment.body, new RegExp(`Referencia de flujo: product-revision:${result.revision.digest}`));
	assert.equal(linearFake.calls.length, 0);
});

test("approves a drafted revision with the current Owner and rejects stale draft snapshots", async () => {
	const linearFake = linear();
	const store = createApprovedRevisionStore({ store: artifactMemory(), project: "pi-workflow", topic: "workflow/define-product" });
	const ready = await draftApprovedRevision({
		gateway: linearFake.gateway,
		store,
		input: { definitionId: "definition-1", revisionKind: "product-revision", affectedIssues: [{ id: "ILA-2296", nextDescription: "Spec vigente revisado" }], sourceCommentKind: "product-revision", sourceCommentBody: "Revisión aprobada.\n\nReferencia de flujo: product-revision:{{digest}}" },
	});
	assert.equal(ready.status, "revision-ready");

	const approved = await approveDraftedRevision({ definitionId: "definition-1", digest: ready.revision.digest, currentActor: async () => actor, gateway: linearFake.gateway, store });
	assert.equal(approved.status, "revision-approved", JSON.stringify(approved));
	assert.equal(approved.revisionRef.schema, "approved-revision");
	assert.deepEqual(approved.revision.authority, actor);
	assert.equal((await store.readApproved("definition-1", approved.revision.digest)).authority.actorId, "owner-1");

	const staleStore = createApprovedRevisionStore({ store: artifactMemory(), project: "pi-workflow", topic: "workflow/define-product" });
	const staleReady = await draftApprovedRevision({ gateway: linearFake.gateway, store: staleStore, input: { definitionId: "definition-1", revisionKind: "product-revision", affectedIssues: [{ id: "ILA-2296", nextDescription: "Spec vigente revisado" }], sourceCommentKind: "product-revision", sourceCommentBody: "Revisión aprobada.\n\nReferencia de flujo: product-revision:{{digest}}" } });
	assert.equal(staleReady.status, "revision-ready");
	linearFake.issues.get("ILA-2296").description = "Cambio humano";
	const stale = await approveDraftedRevision({ definitionId: "definition-1", digest: staleReady.revision.digest, currentActor: async () => actor, gateway: linearFake.gateway, store: staleStore });
	assert.equal(stale.status, "blocked");
	assert.equal(stale.blocker.code, "PI_WORKFLOW_REVISION_STALE");
});

test("recovers an issue update only after durable per-issue intent is recorded", async () => {
	const persistence = memory();
	let failedCompletionRecord = false;
	const guardedPersistence = {
		...persistence,
		compareAndSwap: async (revision, value) => {
			if (value.stage === "describing" && value.descriptions.includes("ILA-2296") && !failedCompletionRecord) {
				failedCompletionRecord = true;
				throw new Error("record interrupted after issue update");
			}
			return persistence.compareAndSwap(revision, value);
		},
	};
	const linearFake = linear();
	const subject = deps({ persistence: guardedPersistence, linearFake });
	assert.equal((await publishApprovedRevision(subject)).status, "blocked");
	assert.equal(linearFake.issues.get("ILA-2296").description, "Spec vigente revisado");
	assert.equal(persistence.value().descriptionClaims.some((claim) => claim.issueId === "ILA-2296"), true);
	assert.equal(persistence.value().descriptions.includes("ILA-2296"), false);

	const retry = deps({ persistence: guardedPersistence, linearFake, revision: await subject.readApprovedRevision(subject.definitionId, subject.digest) });
	assert.equal((await publishApprovedRevision(retry)).status, "revision-published");
	assert.equal(linearFake.calls.filter((call) => call.op === "saveIssue" && call.id === "ILA-2296").length, 1);
});

test("blocks an external identical edit for an unclaimed issue during staged recovery", async () => {
	const persistence = memory();
	const linearFake = linear();
	const subject = deps({ persistence, linearFake });
	let manifest = await subject.manifest.prepare({ definitionId: subject.definitionId, digest: subject.digest, affectedIssueIds: ["ILA-2296", "ILA-2317"] });
	manifest = await subject.manifest.advance(manifest.operationId, "prepared", "commenting");
	manifest = await subject.manifest.advance(manifest.operationId, "commenting", "describing");
	await subject.manifest.record(manifest.operationId, "describing", { descriptionClaims: [{ issueId: "ILA-2296", previousRevision: "rev-parent-1" }] });
	linearFake.issues.set("ILA-2317", { ...linearFake.issues.get("ILA-2317"), description: "Ticket vigente revisado", updatedAt: "external-edit" });

	const result = await publishApprovedRevision(subject);

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_REVISION_STALE");
	assert.deepEqual(linearFake.calls, []);
});
