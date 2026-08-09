import assert from "node:assert/strict";
import test from "node:test";

import { createQaHandoffPublicationRecoveryStore } from "../extensions/qa-handoff-publication-recovery.ts";

assert.deepEqual(Object.keys(createQaHandoffPublicationRecoveryStore), []);

function persistence() {
	const values = new Map();
	let revision = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		values,
		seed(project, topic, content) {
			revision += 1;
			values.set(`${project}:${topic}`, {
				revision: `recovery-${revision}`,
				content,
			});
		},
		async readCurrent(project, topic) {
			return values.get(`${project}:${topic}`);
		},
		async readRevision(project, topic, expectedRevision) {
			const current = values.get(`${project}:${topic}`);
			return current?.revision === expectedRevision
				? current.content
				: undefined;
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

test("durable QA recovery rejects malformed state and unavailable CAS", async () => {
	const backing = persistence();
	backing.seed(
		"pi-workflow",
		"workflow/qa-handoff-publication-recovery/ILA-2410",
		'{"digest":"invalid","issueId":"ILA-2410","stage":"uncertain"}\n',
	);
	const malformed = createQaHandoffPublicationRecoveryStore({
		store: backing,
		project: "pi-workflow",
	});
	await assert.rejects(malformed.read("ILA-2410"), {
		message: "QA handoff publication recovery state is invalid.",
	});

	const unavailable = createQaHandoffPublicationRecoveryStore({
		store: { ...persistence(), capabilities: { atomicCompareAndSwap: false } },
		project: "pi-workflow",
	});
	await assert.rejects(
		unavailable.claim(artifact, "owner-a"),
		{
			message:
				"Atomic compare-and-swap is required for QA handoff recovery.",
		},
	);
	await assert.rejects(
		unavailable.release(artifact, "owner-a"),
		/Atomic compare-and-swap/,
	);
	await assert.rejects(
		unavailable.finalizeVerified(artifact),
		/Atomic compare-and-swap/,
	);
});

test("durable QA recovery detects persistence read-back mismatch", async () => {
	const backing = persistence();
	const store = createQaHandoffPublicationRecoveryStore({
		store: { ...backing, readRevision: async () => undefined },
		project: "pi-workflow",
	});
	await assert.rejects(store.claim(artifact, "owner-a"), /read-back mismatch/);
});

test("durable QA recovery rejects a saved revision that is not current", async () => {
	for (const currentAfterWrite of ["missing", "superseded"]) {
		const revisions = new Map();
		let current;
		const store = createQaHandoffPublicationRecoveryStore({
			project: "pi-workflow",
			store: {
				capabilities: { atomicCompareAndSwap: true },
				readCurrent: async () => current,
				readRevision: async (_project, _topic, revision) =>
					revisions.get(revision),
				write: async (_project, _topic, content) => {
					revisions.set("saved-r1", content);
					current =
						currentAfterWrite === "superseded"
							? { revision: "rival-r2", content }
							: undefined;
					if (current) revisions.set(current.revision, current.content);
					return { revision: "saved-r1" };
				},
			},
		});

		await assert.rejects(
			store.claim(artifact, "owner-a"),
			/current revision mismatch/,
			currentAfterWrite,
		);
	}
});

test("durable QA recovery requires the saved release and finalize revision to remain current", async () => {
	for (const operation of ["release", "finalizeVerified"]) {
		const revisions = new Map();
		let current;
		let revision = 0;
		let supersedeWrites = false;
		const store = createQaHandoffPublicationRecoveryStore({
			project: "pi-workflow",
			store: {
				capabilities: { atomicCompareAndSwap: true },
				readCurrent: async () => current,
				readRevision: async (_project, _topic, expectedRevision) =>
					revisions.get(expectedRevision),
				write: async (_project, _topic, content, expectedRevision) => {
					assert.equal(current?.revision, expectedRevision);
					revision += 1;
					const saved = { revision: `saved-${revision}`, content };
					revisions.set(saved.revision, saved.content);
					current = saved;
					if (supersedeWrites) {
						const rival = { revision: `rival-${revision}`, content };
						revisions.set(rival.revision, rival.content);
						current = rival;
					}
					return { revision: saved.revision };
				},
			},
		});
		await store.claim(artifact, "owner-a");
		supersedeWrites = true;

		await assert.rejects(
			operation === "release"
				? store.release(artifact, "owner-a")
				: store.finalizeVerified(artifact),
			/current revision mismatch/,
			operation,
		);
	}
});

test("durable QA recovery verifies immutable read-back on an idempotent release", async () => {
	const backing = persistence();
	let corruptReadBack = false;
	const store = createQaHandoffPublicationRecoveryStore({
		store: {
			...backing,
			readRevision: async (...args) =>
				corruptReadBack ? undefined : backing.readRevision(...args),
		},
		project: "pi-workflow",
	});
	await store.claim(artifact, "owner-a");
	await store.release(artifact, "owner-a");
	corruptReadBack = true;
	await assert.rejects(
		store.release(artifact, "owner-a"),
		/read-back mismatch/,
	);
});

test("durable QA recovery remains project-scoped without trusted workspace identity", async () => {
	let project = "project-a";
	const store = createQaHandoffPublicationRecoveryStore({
		store: persistence(),
		project: () => project,
	});
	await store.claim(artifact, "owner-a");
	project = "project-b";
	assert.equal(await store.read("ILA-2410"), undefined);
	await store.claim(artifact, "owner-b");
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
	});
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

	await store.claim(artifact, "owner-a");
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
	});
	await assert.rejects(store.claim(artifact, "owner-b"), /already owned/);
	await assert.rejects(store.release(artifact, "owner-b"), /already owned/);
	await store.release(artifact, "owner-a");
	assert.equal(await store.read("ILA-2410"), undefined);
	await store.claim(artifact, "owner-b");
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
	});
	await store.finalizeVerified(artifact);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "verified",
	});
	await assert.rejects(store.claim(artifact, "owner-a"), /already verified/);
	await assert.rejects(store.release(artifact, "owner-a"), /conflicts/);
	const drifted = {
		...artifact,
		digest: "b".repeat(64),
	};
	await assert.rejects(store.claim(drifted, "owner-b"), /already verified/);
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "verified",
	});
});

test("durable QA recovery preserves and fences the shared execution binding", async () => {
	const backing = persistence();
	const store = createQaHandoffPublicationRecoveryStore({
		store: backing,
		project: "pi-workflow",
	});
	const lease = {
		decisionId: "decision.qa-handoff",
		operationDigest: "operation-digest",
		executionId: "execution-1",
		generation: 1,
		actorId: "owner-a",
		authorityRevision: "owner-r1",
		action: {
			id: "qa-handoff.publish",
			input: { issueId: "ILA-2410", digest: artifact.digest },
		},
	};

	assert.deepEqual(await store.bindExecution(artifact, lease), {
		decisionId: lease.decisionId,
		operationDigest: lease.operationDigest,
		executionId: lease.executionId,
		generation: lease.generation,
		ref: `workflow://qa-handoff/ILA-2410/publication/${artifact.digest}`,
	});
	const recoveryTopic =
		"workflow/qa-handoff-publication-recovery/ILA-2410";
	assert.equal(
		backing.values.get(`pi-workflow:${recoveryTopic}`).content,
		`{"digest":"${artifact.digest}","executionBinding":{"decisionId":"decision.qa-handoff","executionId":"execution-1","generation":1,"operationDigest":"operation-digest"},"issueId":"ILA-2410","stage":"released"}\n`,
	);
	await store.claim(artifact, "runtime-1");
	assert.deepEqual(await store.read("ILA-2410"), {
		digest: artifact.digest,
		stage: "uncertain",
		executionBinding: {
			decisionId: lease.decisionId,
			operationDigest: lease.operationDigest,
			executionId: lease.executionId,
			generation: lease.generation,
		},
	});
	await assert.rejects(
		store.bindExecution(artifact, { ...lease, executionId: "execution-2" }),
		/execution binding conflicts/,
	);
	await store.finalizeVerified(artifact);
	assert.equal(
		(await store.read("ILA-2410")).executionBinding.executionId,
		"execution-1",
	);
});
