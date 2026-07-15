import assert from "node:assert/strict";
import test from "node:test";

import { createDurablePublicationManifest } from "../extensions/publication-manifest.ts";

function manifestInput(definitionId = "definition-1") {
	return {
		schemaVersion: 1,
		definitionId,
		specDigest: `digest-${definitionId}`,
		specRevision: "spec-r1",
		sourceRevision: "engram-r1",
		stage: "prepared",
		publicationKey: "c".repeat(64),
		reservationId: "reservation-1",
	};
}

function memoryPersistence() {
	const contents = new Map();
	return {
		contents,
		persistence: {
			withMutation: async (_id, run) => run(),
			readFile: async (path) => contents.get(path),
			writeFileAtomic: async (path, content) => contents.set(path, content),
		},
	};
}

test("publication manifest persists self-validated state with compare-and-swap", async () => {
	const { contents, persistence } = memoryPersistence();
	const store = createDurablePublicationManifest({
		directory: "/state/publications",
		persistence,
	});
	const value = store.create(manifestInput());

	const revision = await store.save(value);

	assert.deepEqual(await store.load("definition-1"), { revision, value });
	await assert.rejects(
		() => store.save(value, "stale-revision"),
		(error) => error.code === "PI_WORKFLOW_PUBLICATION_CONFLICT",
	);
	const [path, content] = [...contents.entries()][0];
	contents.set(path, content.replace(value.digest, "0".repeat(64)));
	await assert.rejects(() => store.load("definition-1"), /identity is invalid/);
});

test("publication manifests isolate compare-and-swap state per definition", async () => {
	const { contents, persistence } = memoryPersistence();
	const store = createDurablePublicationManifest({
		directory: "/state/publications",
		persistence,
	});
	const first = store.create(manifestInput("definition-1"));
	const second = store.create({
		...manifestInput("definition-2"),
		publicationKey: "d".repeat(64),
		reservationId: "reservation-2",
	});

	await store.save(first);
	await store.save(second);

	assert.deepEqual((await store.load("definition-1")).value, first);
	assert.deepEqual((await store.load("definition-2")).value, second);
	assert.equal(contents.size, 2);
});

test("publication manifest refuses mismatched durable read-back", async () => {
	let content;
	const store = createDurablePublicationManifest({
		directory: "/state/publications",
		persistence: {
			withMutation: async (_id, run) => run(),
			readFile: async () => content,
			writeFileAtomic: async (_path, next) => {
				content = `${next}corrupt`;
			},
		},
	});

	await assert.rejects(
		() => store.save(store.create(manifestInput())),
		/publication manifest durable read-back mismatch/i,
	);
});
