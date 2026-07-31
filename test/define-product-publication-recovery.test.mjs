import assert from "node:assert/strict";
import test from "node:test";

import { createDefineProductPublicationRecoveryStore } from "../extensions/define-product-publication-recovery.ts";

function artifactStore() {
	const topics = new Map();
	const revisions = new Map();
	let sequence = 0;
	return {
		capabilities: { atomicCompareAndSwap: true },
		async readCurrent(project, topic) {
			return topics.get(`${project}:${topic}`);
		},
		async readRevision(project, topic, revision) {
			return revisions.get(`${project}:${topic}:${revision}`);
		},
		async write(project, topic, content, expectedRevision) {
			const key = `${project}:${topic}`;
			const current = topics.get(key);
			if (current?.revision !== expectedRevision) throw new Error("CAS conflict");
			sequence += 1;
			const stored = { revision: `r${sequence}`, content };
			topics.set(key, stored);
			revisions.set(`${key}:${stored.revision}`, content);
			return { revision: stored.revision };
		},
	};
}

const identity = {
	definitionId: "definition-1",
	publicationDigest: "a".repeat(64),
};

test("durably claims, releases, and verifies define-product publication uncertainty", async () => {
	const recovery = createDefineProductPublicationRecoveryStore({
		store: artifactStore(),
		project: "pi-workflow",
	});
	assert.equal(await recovery.read(identity.definitionId), undefined);
	await recovery.claim(identity, "owner-1");
	assert.deepEqual(await recovery.read(identity.definitionId), {
		publicationDigest: identity.publicationDigest,
		stage: "uncertain",
	});
	await recovery.release(identity, "owner-1");
	assert.equal(await recovery.read(identity.definitionId), undefined);
	await recovery.claim(identity, "owner-2");
	await recovery.recordCreated(identity, "owner-2", "linear-uuid-1");
	assert.deepEqual(await recovery.read(identity.definitionId), {
		publicationDigest: identity.publicationDigest,
		stage: "created",
		issueId: "linear-uuid-1",
	});
	await recovery.recordCreated(identity, "owner-2", "linear-uuid-1");
	await assert.rejects(
		recovery.recordCreated(identity, "owner-2", "linear-uuid-2"),
		/identity conflicts/,
	);
	await assert.rejects(recovery.release(identity, "owner-2"), /state conflicts/);
	await recovery.finalizeVerified(identity, "linear-uuid-1");
	assert.deepEqual(await recovery.read(identity.definitionId), {
		publicationDigest: identity.publicationDigest,
		stage: "verified",
		issueId: "linear-uuid-1",
	});
	await recovery.finalizeVerified(identity, "linear-uuid-1");
	await assert.rejects(
		recovery.finalizeVerified(identity, "linear-uuid-2"),
		/identity conflicts/,
	);
});

test("reads a migrated created checkpoint whose trailing LF was normalized by Engram", async () => {
	const content = `${JSON.stringify(
		{
			definitionId: identity.definitionId,
			issueId: "ILA-2436",
			ownerId: "owner-1",
			publicationDigest: identity.publicationDigest,
			stage: "created",
			migrationMetadata: { source: "memory-api" },
		},
		null,
		2,
	)}\r\n`;
	const current = { revision: "r1", content };
	const recovery = createDefineProductPublicationRecoveryStore({
		store: {
			capabilities: { atomicCompareAndSwap: true },
			readCurrent: async () => current,
			readRevision: async () => content,
			write: async () => ({ revision: "r2" }),
		},
		project: "pi-workflow",
	});
	assert.deepEqual(await recovery.read(identity.definitionId), {
		publicationDigest: identity.publicationDigest,
		stage: "created",
		issueId: "ILA-2436",
	});
});

test("rejects competing owners, digest drift, and non-atomic stores", async () => {
	const recovery = createDefineProductPublicationRecoveryStore({
		store: artifactStore(),
		project: "pi-workflow",
	});
	await recovery.claim(identity, "owner-1");
	await assert.rejects(recovery.claim(identity, "owner-2"), /already owned/);
	await assert.rejects(
		recovery.claim({ ...identity, publicationDigest: "b".repeat(64) }, "owner-1"),
		/state conflicts/,
	);
	const nonAtomic = createDefineProductPublicationRecoveryStore({
		store: {
			capabilities: { atomicCompareAndSwap: false },
			readCurrent: async () => undefined,
			readRevision: async () => undefined,
			write: async () => ({ revision: "r1" }),
		},
		project: "pi-workflow",
	});
	await assert.rejects(nonAtomic.claim(identity, "owner-1"), /compare-and-swap/);
});
