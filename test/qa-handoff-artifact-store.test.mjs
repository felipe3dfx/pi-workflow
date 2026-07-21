import assert from "node:assert/strict";
import test from "node:test";

import { createQaHandoffArtifactStore } from "../extensions/qa-handoff-artifact-store.ts";
import {
	createQaHandoffWorkflow,
	isQaHandoffArtifact,
} from "../extensions/qa-handoff-workflow.ts";
import { canonicalJson } from "../extensions/workflow-contracts.ts";

async function artifactFixture() {
	let current;
	const workflow = createQaHandoffWorkflow({
		gateway: {
			getIssue: async () => ({
				id: "ILA-2321",
				identifier: "ILA-2321",
				title: "QA handoff",
				description: "Descripción",
				updatedAt: "issue-r1",
				state: {},
				assignee: {},
				cycle: {},
				labels: [],
				estimate: 5,
				relations: {},
			}),
			listComments: async () => ({ comments: [] }),
			createComment: async ({ body }) => ({ id: "opaque", body }),
		},
		artifacts: {
			read: async () => structuredClone(current),
			save: async (value) => {
				current = structuredClone(value);
				return structuredClone(value);
			},
		},
		drafts: {
			read: async () => ({
				outcome: {
					status: "ready-for-qa",
					summary: "La entrega está lista para validación.",
				},
				pullRequest: { ref: "pr:1", label: "PR #1" },
				build: { ref: "build:1", label: "Build 1" },
				qaEnvironment: { name: "QA", url: "https://qa.example.test" },
				acceptanceCriteria: [
					{
						id: "AC-1",
						description: "Publica un comentario.",
						evidence: [{ ref: "test:1", label: "Prueba" }],
					},
				],
				testGuidance: ["Validar el comentario."],
				risksAndConstraints: ["El estado cambia manualmente."],
			}),
		},
		currentDeveloper: async () => ({
			actorId: "developer-1",
			role: "Developer",
			authorityRevision: "developer-r1",
		}),
	});
	const result = await workflow.authorizeInvocation("ILA-2321");
	assert.equal(result.status, "authorized");
	return result.artifact;
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
				const value = { revision: `artifact-r${writes}`, content };
				values.set(topic, value);
				return { revision: value.revision };
			},
			readRevision: async (_project, topic, revision) => {
				const value = values.get(topic);
				return value?.revision === revision ? value.content : undefined;
			},
		},
	};
}

test("narrows unknown values only when the complete QA handoff artifact is valid", async () => {
	const artifact = await artifactFixture();
	const parsed = JSON.parse(JSON.stringify(artifact));

	assert.equal(isQaHandoffArtifact(parsed, "ILA-2321"), true);
	assert.equal(isQaHandoffArtifact(null, "ILA-2321"), false);
	assert.equal(isQaHandoffArtifact([], "ILA-2321"), false);
	assert.equal(isQaHandoffArtifact({ ...parsed, unexpected: true }, "ILA-2321"), false);
	assert.equal(isQaHandoffArtifact(parsed, "ILA-9999"), false);
});

test("persists qa-handoff/v1 as a create-only artifact and reads back the exact bytes", async () => {
	const artifact = await artifactFixture();
	const persistence = backend();
	const store = createQaHandoffArtifactStore({
		store: persistence.store,
		project: "pi-workflow",
	});

	assert.deepEqual(await store.save(artifact), artifact);
	assert.deepEqual(await store.read("ILA-2321"), artifact);
	assert.deepEqual(await store.save(artifact), artifact);
	assert.equal(persistence.writes, 1);
	assert.equal(
		persistence.values.has("workflow/qa-handoff/ILA-2321"),
		true,
	);
});

test("rejects conflicting or malformed durable QA handoff artifacts", async () => {
	const artifact = await artifactFixture();
	const persistence = backend();
	const store = createQaHandoffArtifactStore({
		store: persistence.store,
		project: "pi-workflow",
	});
	await store.save(artifact);

	await assert.rejects(
		store.save({ ...artifact, body: `${artifact.body}\nCambio` }),
		/invalid or corrupt/,
	);
	persistence.values.get("workflow/qa-handoff/ILA-2321").content = "not-json";
	await assert.rejects(store.read("ILA-2321"), /not valid JSON/);
});

test("rejects parse-valid persisted bytes that are not the exact canonical artifact", async () => {
	const artifact = await artifactFixture();
	const reordered = {
		body: artifact.body,
		digest: artifact.digest,
		payload: artifact.payload,
		language: artifact.language,
		schemaVersion: artifact.schemaVersion,
		schema: artifact.schema,
	};
	const variants = [
		{ name: "reordered", content: `${JSON.stringify(reordered)}\n` },
		{ name: "pretty", content: `${JSON.stringify(artifact, null, 2)}\n` },
		{
			name: "extra-field",
			content: `${canonicalJson({ ...artifact, unexpected: true })}\n`,
		},
	];

	for (const variant of variants) {
		const persistence = backend();
		const topic = "workflow/qa-handoff/ILA-2321";
		persistence.values.set(topic, {
			revision: `persisted-${variant.name}`,
			content: variant.content,
		});
		const store = createQaHandoffArtifactStore({
			store: persistence.store,
			project: "pi-workflow",
		});

		await assert.rejects(store.read("ILA-2321"), /canonical|invalid or corrupt/, variant.name);
		await assert.rejects(store.save(artifact), /canonical|invalid or corrupt/, variant.name);
		assert.equal(persistence.writes, 0, variant.name);
	}
});
