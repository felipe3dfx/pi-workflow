import assert from "node:assert/strict";
import test from "node:test";

import {
	companionInstallOperationId,
	createCompanionInstallManifestStore,
	createInMemoryCompanionInstallManifestStore,
} from "../extensions/companion-install-manifest.ts";

const identity = {
	packages: [{ package: "alpha", spec: "npm:alpha" }],
	mcp: { path: "/tmp/mcp.json", catalogDigest: "a".repeat(64) },
};
const lease = {
	decisionId: `decision:${"b".repeat(64)}`,
	operationDigest: "b".repeat(64),
	executionId: "execution-1",
	generation: 1,
	actorId: "operator-1",
	authorityRevision: "operator-1/v1",
	action: { id: "companions.install", input: { planDigest: "c".repeat(64) } },
};

test("companion install manifests bind one joint operation before recording package and MCP effects", async () => {
	const store = createInMemoryCompanionInstallManifestStore();
	let current = await store.open(identity, "c".repeat(64), lease, 1);

	assert.equal(current.value.operationId, companionInstallOperationId(identity));
	assert.equal(current.value.executionBinding.executionId, lease.executionId);
	assert.deepEqual(current.value.completedPackages, []);
	assert.equal(current.value.mcpConfigured, false);

	current = await store.update(current, {
		pendingEffect: { kind: "package", package: "alpha" },
	});
	current = await store.update(current, {
		completedPackages: ["alpha"],
		pendingEffect: undefined,
	});
	current = await store.update(current, {
		pendingEffect: { kind: "mcp", path: identity.mcp.path },
		failures: [
			{ kind: "package", package: "alpha", message: "package failed" },
			{ kind: "mcp", path: identity.mcp.path, message: "MCP failed" },
		],
	});
	current = await store.update(current, {
		stage: "completed",
		mcpConfigured: true,
		pendingEffect: undefined,
	});

	assert.equal(current.value.stage, "completed");
	assert.deepEqual(current.value.completedPackages, ["alpha"]);
	assert.equal(current.value.mcpConfigured, true);
	assert.deepEqual(current.value.failures, [
		{ kind: "package", package: "alpha", message: "package failed" },
		{ kind: "mcp", path: identity.mcp.path, message: "MCP failed" },
	]);
	assert.equal((await store.read(current.value.operationId))?.revision, current.revision);
});

test("companion install manifests resume partial work only under a new execution binding", async () => {
	const store = createInMemoryCompanionInstallManifestStore();
	let current = await store.open(identity, "c".repeat(64), lease, 1);
	current = await store.update(current, {
		stage: "partial",
		failures: [{ kind: "package", package: "alpha", message: "network down" }],
	});

	const resumed = await store.open(
		identity,
		"d".repeat(64),
		{ ...lease, executionId: "execution-2", generation: 2 },
		2,
	);
	assert.equal(resumed.value.stage, "executing");
	assert.equal(resumed.value.executionBinding.executionId, "execution-2");
	assert.equal(resumed.value.attempt, 2);
	assert.deepEqual(resumed.value.failures, current.value.failures);

	await assert.rejects(
		() =>
			store.open(
				identity,
				"e".repeat(64),
				{ ...lease, executionId: "execution-3", generation: 3 },
				3,
			),
		/active execution/i,
	);
});

test("companion install manifests fail closed for CAS loss, corrupt bytes, and missing CAS support", async () => {
	const bytes = new Map();
	const backend = {
		capabilities: { atomicCompareAndSwap: true },
		readCurrent: async (_project, topic) => bytes.get(topic)?.at(-1),
		write: async (_project, topic, content, expectedRevision) => {
			const entries = bytes.get(topic) ?? [];
			if (entries.at(-1)?.revision !== expectedRevision)
				throw new Error("compare-and-swap conflict");
			const revision = `r${entries.length + 1}`;
			entries.push({ revision, content });
			bytes.set(topic, entries);
			return { revision };
		},
		readRevision: async (_project, topic, revision) =>
			bytes.get(topic)?.find((entry) => entry.revision === revision)?.content,
	};
	const store = createCompanionInstallManifestStore({
		store: backend,
		project: "pi-workflow",
	});
	const first = await store.open(identity, "c".repeat(64), lease, 1);
	await assert.rejects(
		() => store.update(first, { failures: [{ package: "$mcp", message: "legacy" }] }),
		/malformed/i,
	);
	await store.update(first, { stage: "waiting" });
	await assert.rejects(
		() => store.update(first, { stage: "cancelled" }),
		/compare-and-swap conflict/i,
	);

	const topic = `workflow/companion-install/${first.value.operationId}`;
	bytes.get(topic).push({ revision: "corrupt", content: "not-json" });
	await assert.rejects(() => store.read(first.value.operationId), /not valid JSON/i);

	assert.throws(
		() =>
			createCompanionInstallManifestStore({
				store: { ...backend, capabilities: { atomicCompareAndSwap: false } },
				project: "pi-workflow",
			}),
		/atomic compare-and-swap/i,
	);
});
