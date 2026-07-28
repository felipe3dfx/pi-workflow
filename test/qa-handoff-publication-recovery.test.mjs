import assert from "node:assert/strict";
import test from "node:test";

import { createQaHandoffPublicationRecoveryStore } from "../extensions/qa-handoff-publication-recovery.ts";

function persistence() {
	const values = new Map();
	let revision = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		async readCurrent(project, topic) {
			return values.get(`${project}:${topic}`);
		},
		async readRevision(project, topic, expectedRevision) {
			const current = values.get(`${project}:${topic}`);
			return current?.revision === expectedRevision ? current.content : undefined;
		},
		async write(project, topic, content, expectedRevision) {
			const key = `${project}:${topic}`;
			const current = values.get(key);
			assert.equal(current?.revision, expectedRevision);
			revision += 1;
			const saved = { revision: `recovery-${revision}`, content };
			values.set(key, saved);
			return { revision: saved.revision };
		},
	};
}

const artifact = {
	digest: "a".repeat(64),
	payload: { issue: { id: "ILA-2410" } },
};

test("durable QA recovery resolves its active project lazily", async () => {
	let project = "project-a";
	const store = createQaHandoffPublicationRecoveryStore({
		store: persistence(),
		project: () => project,
	});
	await store.claim(artifact);
	project = "project-b";
	assert.equal(await store.read("ILA-2410"), undefined);
	project = "project-a";
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
	});
});

test("durable QA recovery adopts pre-existing verified publication", async () => {
	const store = createQaHandoffPublicationRecoveryStore({
		store: persistence(),
		project: "pi-workflow",
	});
	await store.finalizeVerified(artifact);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "verified",
	});
	await store.finalizeVerified(artifact);
});

test("durable QA recovery transitions released claims back to uncertain", async () => {
	const store = createQaHandoffPublicationRecoveryStore({
		store: persistence(),
		project: "pi-workflow",
	});

	await store.claim(artifact);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
	});
	await store.release(artifact);
	assert.equal(await store.read("ILA-2410"), undefined);
	await store.claim(artifact);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
	});
	await store.finalizeVerified(artifact);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "verified",
	});
	await assert.rejects(store.claim(artifact), /already verified/);
	await assert.rejects(store.release(artifact), /conflicts/);
	const drifted = {
		...artifact,
		digest: "b".repeat(64),
	};
	await assert.rejects(store.claim(drifted), /already verified/);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "verified",
	});
});
