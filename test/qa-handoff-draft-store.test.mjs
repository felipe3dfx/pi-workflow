import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultQaHandoffWorkflow } from "../extensions/default-qa-handoff.ts";
import {
	createQaHandoffDraftStore,
	isQaHandoffDraftArtifact,
} from "../extensions/qa-handoff-draft-store.ts";
import {
	canonicalJson,
	digestCanonicalValue,
} from "../extensions/workflow-contracts.ts";

const issueId = "ILA-2321";
const draft = {
	outcome: {
		status: "ready-for-qa",
		summary: "La entrega está lista para validación en QA.",
	},
	pullRequest: { ref: "pr:2321", label: "PR #2321" },
	build: { ref: "build:2321", label: "Build 2321" },
	qaEnvironment: { name: "QA", url: "https://qa.example.test" },
	acceptanceCriteria: [
		{
			id: "AC-1",
			description: "Publica el handoff canónico.",
			evidence: [{ ref: "test:2321", label: "Prueba automatizada" }],
		},
	],
	testGuidance: ["Validar el comentario publicado."],
	risksAndConstraints: [],
};

function draftArtifact(id = issueId, value = draft) {
	const unsigned = {
		schema: "qa-handoff-draft",
		schemaVersion: 1,
		payload: {
			issue: { id },
			draft: value,
		},
	};
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function backend() {
	const values = new Map();
	let writes = 0;
	return {
		values,
		get writes() {
			return writes;
		},
		store: {
			capabilities: { atomicCompareAndSwap: true },
			readCurrent: async (_project, topic) => values.get(topic),
			write: async (_project, topic, content, expectedRevision) => {
				assert.equal(expectedRevision, undefined);
				writes += 1;
				const stored = { revision: `draft-r${writes}`, content };
				values.set(topic, stored);
				return { revision: stored.revision };
			},
			readRevision: async (_project, topic, revision) => {
				const stored = values.get(topic);
				return stored?.revision === revision ? stored.content : undefined;
			},
		},
	};
}

test("persists canonical qa-handoff-draft/v1 as a create-only producer artifact", async () => {
	const persistence = backend();
	const store = createQaHandoffDraftStore({
		store: persistence.store,
		project: "pi-workflow",
	});

	const first = await store.save({ issueId, draft });
	const second = await store.save({ issueId, draft });

	assert.equal(isQaHandoffDraftArtifact(first, issueId), true);
	assert.equal(
		first.digest,
		digestCanonicalValue({
			schema: first.schema,
			schemaVersion: first.schemaVersion,
			payload: first.payload,
		}),
	);
	assert.deepEqual(second, first);
	assert.deepEqual(await store.read(issueId), draft);
	assert.equal(persistence.writes, 1);
	assert.equal(
		persistence.values.get(`workflow/qa-handoff-draft/${issueId}`).content,
		`${canonicalJson(draftArtifact())}\n`,
	);
});

test("rejects conflicting create-only QA handoff draft content", async () => {
	const persistence = backend();
	const store = createQaHandoffDraftStore({
		store: persistence.store,
		project: "pi-workflow",
	});
	await store.save({ issueId, draft });

	await assert.rejects(
		store.save({
			issueId,
			draft: {
				...draft,
				testGuidance: ["Una guía diferente."],
			},
		}),
		(error) => error.code === "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_INVALID",
	);
	assert.equal(persistence.writes, 1);
});

test("rejects a valid recomputed digest when recovery content conflicts with the requested draft", async () => {
	const persistence = backend();
	const divergentDraft = {
		...draft,
		testGuidance: ["Una guía persistida diferente."],
	};
	persistence.values.set(`workflow/qa-handoff-draft/${issueId}`, {
		revision: "persisted-divergent",
		content: `${canonicalJson(draftArtifact(issueId, divergentDraft))}\n`,
	});
	const store = createQaHandoffDraftStore({
		store: persistence.store,
		project: "pi-workflow",
	});

	assert.deepEqual(await store.read(issueId), divergentDraft);
	await assert.rejects(
		store.save({ issueId, draft }),
		(error) => error.code === "PI_WORKFLOW_QA_HANDOFF_ARTIFACT_INVALID" &&
			/conflicts with its create-only artifact/.test(error.message),
	);
	assert.equal(persistence.writes, 0);
});

test("default runtime fails closed for malformed, noncanonical, digest-forged, and issue-mismatched drafts", async () => {
	const validArtifact = draftArtifact();
	const variants = [
		{
			name: "malformed schema",
			content: `${canonicalJson(draft)}\n`,
		},
		{
			name: "noncanonical bytes",
			content: `${JSON.stringify(draftArtifact(), null, 2)}\n`,
		},
		{
			name: "forged digest",
			content: `${canonicalJson({ ...validArtifact, digest: "0".repeat(64) })}\n`,
		},
		{
			name: "tampered payload with stale digest",
			content: `${canonicalJson({
				...validArtifact,
				payload: {
					...validArtifact.payload,
					draft: {
						...draft,
						testGuidance: ["Contenido alterado."],
					},
				},
			})}\n`,
		},
		{
			name: "mismatched issue with recomputed digest",
			content: `${canonicalJson(draftArtifact("ILA-9999"))}\n`,
		},
	];

	for (const variant of variants) {
		const persistence = backend();
		persistence.values.set(`workflow/qa-handoff-draft/${issueId}`, {
			revision: `persisted-${variant.name}`,
			content: variant.content,
		});
		const workflow = createDefaultQaHandoffWorkflow(
			() => undefined,
			{
				artifactStore: persistence.store,
				project: "pi-workflow",
				gateway: {
					getIssue: async () => ({
						id: issueId,
						identifier: issueId,
						title: "QA handoff",
						description: "Descripción",
						updatedAt: "issue-r1",
						state: {},
						assignee: {},
						cycle: {},
						labels: [],
						estimate: 3,
						relations: {},
					}),
					listComments: async () => ({ comments: [] }),
					createComment: async () => {
						throw new Error("must not publish");
					},
				},
				authenticatedAuthority: {
					current: async () => ({
						actorId: "developer-2321",
						role: "Developer",
						authorityRevision: "developer-r1",
					}),
				},
			},
		);

		const outcome = await workflow.authorizeInvocation(issueId);

		assert.equal(outcome.status, "blocked", variant.name);
		assert.equal(
			outcome.blocker.code,
			"PI_WORKFLOW_QA_HANDOFF_ARTIFACT_INVALID",
			variant.name,
		);
		assert.equal(persistence.writes, 0, variant.name);
	}
});
