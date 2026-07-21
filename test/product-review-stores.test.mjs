import assert from "node:assert/strict";
import test from "node:test";
import { createProductReviewArtifactStore } from "../extensions/product-review-artifact-store.ts";
import {
	createProductReviewDraftStore,
	isProductReviewDraftArtifact,
} from "../extensions/product-review-draft-store.ts";
import { createProductReviewWorkflow } from "../extensions/product-review-workflow.ts";
import { canonicalJson } from "../extensions/workflow-contracts.ts";

const issueId = "ILA-2324";
const draft = {
	scope: "Validar el resultado de producto.",
	stories: [{
		id: "US-1",
		description: "El Owner decide el resultado.",
		acceptanceCriteria: [{
			id: "AC-1",
			description: "El resultado es coherente.",
			result: "cumple",
			evidence: ["test:review"],
		}],
	}],
	evidence: [{ ref: "test:review", description: "Prueba automatizada" }],
	findings: ["El resultado es verificable."],
	requiredChanges: [],
	recommendation: "Aceptado",
};
function backend() {
	const values = new Map();
	let writes = 0;
	return {
		values,
		get writes() { return writes; },
		store: {
			capabilities: { atomicCompareAndSwap: true },
			readCurrent: async (_project, topic) => values.get(topic),
			write: async (_project, topic, content, expectedRevision) => {
				assert.equal(expectedRevision, undefined);
				writes += 1;
				const stored = { revision: `r${writes}`, content };
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
async function artifactFixture() {
	let stored;
	const workflow = createProductReviewWorkflow({
		gateway: {
			getIssue: async () => ({ id: issueId, identifier: issueId, title: "Review", description: "Descripción", updatedAt: "issue-r1", state: {}, assignee: {}, cycle: {}, labels: [], estimate: 3, relations: {} }),
			listComments: async () => ({ comments: [] }),
			createComment: async ({ body }) => ({ id: "comment", body }),
		},
		drafts: { read: async () => structuredClone(draft) },
		artifacts: {
			read: async () => structuredClone(stored),
			save: async (value) => { stored = structuredClone(value); return structuredClone(value); },
		},
		currentOwner: async () => ({ actorId: "owner-1", role: "Owner", authorityRevision: "owner-r1" }),
	});
	const prepared = await workflow.prepare(issueId);
	assert.equal(prepared.status, "prepared");
	const approved = await workflow.approve({ issueId, result: "Aceptado", digest: prepared.choices.Aceptado.digest });
	assert.equal(approved.status, "approved");
	return stored;
}

test("draft store enforces canonical create-only CAS and read-back", async () => {
	const persistence = backend();
	const store = createProductReviewDraftStore({ store: persistence.store, project: "pi-workflow" });
	const first = await store.save({ issueId, draft });
	assert.equal(isProductReviewDraftArtifact(first, issueId), true);
	assert.deepEqual(await store.read(issueId), draft);
	assert.deepEqual(await store.save({ issueId, draft }), first);
	assert.equal(persistence.writes, 1);
	assert.equal(persistence.values.get(`workflow/product-review-draft/${issueId}`).content, `${canonicalJson(first)}\n`);
	await assert.rejects(store.save({ issueId, draft: { ...draft, findings: ["Otro hallazgo."] } }), /conflicts/);
	persistence.values.get(`workflow/product-review-draft/${issueId}`).content = "not-json";
	await assert.rejects(store.read(issueId), /read-back|valid JSON/);
});

test("artifact store enforces canonical bytes, conflicts, CAS, and read-back", async () => {
	const artifact = await artifactFixture();
	const persistence = backend();
	const store = createProductReviewArtifactStore({ store: persistence.store, project: "pi-workflow" });
	assert.deepEqual(await store.save(artifact), artifact);
	assert.deepEqual(await store.read(issueId), artifact);
	assert.deepEqual(await store.save(artifact), artifact);
	assert.equal(persistence.writes, 1);
	await assert.rejects(store.save({ ...artifact, body: `${artifact.body}alterado` }), /valid product review artifact/);
	const topic = `workflow/product-review/${issueId}`;
	persistence.values.get(topic).content = `${JSON.stringify(artifact, null, 2)}\n`;
	await assert.rejects(store.read(issueId), /read-back|noncanonical/);
});

test("both stores reject operation without atomic compare-and-swap", async () => {
	const persistence = backend();
	persistence.store.capabilities.atomicCompareAndSwap = false;
	await assert.rejects(
		createProductReviewDraftStore({ store: persistence.store, project: "pi-workflow" }).save({ issueId, draft }),
		/store capability/,
	);
	await assert.rejects(
		createProductReviewArtifactStore({ store: persistence.store, project: "pi-workflow" }).save(await artifactFixture()),
		/Atomic CAS/,
	);
});
