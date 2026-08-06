import assert from "node:assert/strict";
import test from "node:test";

import {
	createEngramDecisionStore,
	createInMemoryDecisionStore,
} from "../extensions/interactive-decisions.ts";

function artifactStore() {
	const values = new Map();
	const revisions = new Map();
	let next = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		async readCurrent(project, topic) {
			const value = values.get(`${project}:${topic}`);
			return value && structuredClone(value);
		},
		async write(project, topic, content, expectedRevision) {
			const key = `${project}:${topic}`;
			const current = values.get(key);
			if (current?.revision !== expectedRevision)
				throw Object.assign(new Error("Engram conditional write failed."), {
					code: "PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_FAILED",
				});
			next += 1;
			const value = { revision: `engram-${next}`, content };
			values.set(key, value);
			revisions.set(`${key}:${value.revision}`, content);
			return { revision: value.revision };
		},
		async readRevision(project, topic, revision) {
			return revisions.get(`${project}:${topic}:${revision}`);
		},
	};
}

async function conforms(name, createStore) {
	await test(`${name} implements create-only and revision-bound CAS`, async () => {
		const store = createStore();
		assert.equal(await store.read("scope-a"), undefined);
		const created = await store.compareAndSwap("scope-a", null, "first\n");
		assert.deepEqual(await store.read("scope-a"), {
			revision: created.revision,
			content: "first\n",
		});
		assert.equal(
			await store.readRevision("scope-a", created.revision),
			"first\n",
		);
		for (const attempt of [
			() => store.compareAndSwap("scope-a", null, "duplicate\n"),
			() => store.compareAndSwap("scope-a", "stale", "stale\n"),
		]) {
			await assert.rejects(attempt, (error) => {
				assert.equal(error.code, "PI_WORKFLOW_DECISION_CAS_CONFLICT");
				return true;
			});
		}
		const updated = await store.compareAndSwap(
			"scope-a",
			created.revision,
			"second\n",
		);
		assert.deepEqual(await store.read("scope-a"), {
			revision: updated.revision,
			content: "second\n",
		});
		assert.equal(
			await store.readRevision("scope-a", created.revision),
			"first\n",
		);
		assert.equal(
			await store.readRevision("scope-a", updated.revision),
			"second\n",
		);
	});
}

await conforms("in-memory DecisionStore", () => createInMemoryDecisionStore());
await conforms("Engram DecisionStore", () =>
	createEngramDecisionStore({ store: artifactStore(), project: "pi-workflow" }),
);

test("Engram DecisionStore rejects persistence without atomic CAS", () => {
	assert.throws(
		() =>
			createEngramDecisionStore({
				store: {
					...artifactStore(),
					capabilities: { atomicCompareAndSwap: false },
				},
				project: "pi-workflow",
			}),
		/atomic compare-and-swap/,
	);
});
