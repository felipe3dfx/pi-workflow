import assert from "node:assert/strict";
import test from "node:test";

import { createQaHandoffPublicationRecoveryStore } from "../extensions/qa-handoff-publication-recovery.ts";

function persistence() {
	const values = new Map();
	let revision = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		async readCurrent(_project, topic) {
			return values.get(topic);
		},
		async readRevision(_project, topic, expectedRevision) {
			const current = values.get(topic);
			return current?.revision === expectedRevision ? current.content : undefined;
		},
		async write(_project, topic, content, expectedRevision) {
			const current = values.get(topic);
			assert.equal(current?.revision, expectedRevision);
			revision += 1;
			const saved = { revision: `recovery-${revision}`, content };
			values.set(topic, saved);
			return { revision: saved.revision };
		},
	};
}

const artifact = {
	digest: "a".repeat(64),
	payload: { issue: { id: "ILA-2410" } },
};

test("durable QA recovery transitions released claims back to uncertain", async () => {
	const store = createQaHandoffPublicationRecoveryStore({
		store: persistence(),
		project: "pi-workflow",
	});

	await store.claim(artifact);
	assert.deepEqual(await store.read("ILA-2410"), { digest: artifact.digest });
	await store.release(artifact);
	assert.equal(await store.read("ILA-2410"), undefined);
	await store.claim(artifact);
	assert.deepEqual(await store.read("ILA-2410"), { digest: artifact.digest });
});
