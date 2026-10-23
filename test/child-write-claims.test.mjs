import test from "node:test";
import assert from "node:assert/strict";

import { recordingCore } from "./support/fake-children.mjs";

function plan(role, surfaces, worktree = "/tmp") {
	return {
		role,
		contract: { prompt: "Contract", tools: [] },
		task: "Edit",
		worktree,
		model: "p/m",
		thinking: "medium",
		chosenBy: "parent",
		references: [],
		...(surfaces ? { surfaces } : {}),
	};
}

const launch = (background = true) => ({
	background,
	modelRegistry: {},
	project: () => ({ cwd: "/tmp", trusted: false }),
	shell: () => ({}),
});

test("writers with disjoint surfaces both run and an overlapping third is refused with the conflict until one ends", async () => {
	const { core } = recordingCore();
	const first = await core.start(plan("worker", ["src/a.ts"]), launch());
	const second = await core.start(plan("worker", ["docs"]), launch());
	assert.equal(first.status, "queued");
	assert.equal(second.status, "queued");
	const refused = await core.start(plan("worker", ["SRC/*.ts"]), launch());
	assert.equal(refused.status, "refused");
	assert.match(refused.reason, new RegExp(`child ${first.id} \\(\`SRC/\\*\\.ts\` overlaps \`src/a\\.ts\`\\)`));
	core.cancel(first.id, false);
	assert.equal((await core.start(plan("worker", ["SRC/*.ts"]), launch())).status, "queued");
});

test("a writer without surfaces conflicts with any other writer", async () => {
	const { core } = recordingCore();
	await core.start(plan("worker", ["src/a.ts"]), launch());
	assert.equal((await core.start(plan("worker"), launch())).status, "refused");
});

test("read-only roles claim nothing and are never refused", async () => {
	const { core } = recordingCore();
	await core.start(plan("worker"), launch());
	assert.equal((await core.start(plan("explore"), launch())).status, "queued");
	assert.equal((await core.start(plan("verify"), launch())).status, "queued");
	await core.start(plan("explore"), launch());
	assert.equal((await core.start(plan("worker", [], "/other"), launch())).status, "queued");
});

test("a queued writer holds its claim before it runs", async () => {
	const { core } = recordingCore();
	const ids = [];
	for (let index = 0; index < 5; index++) {
		ids.push((await core.start(plan("explore"), launch())).id);
	}
	const queued = await core.start(plan("worker", ["src"]), launch());
	assert.equal(core.get(queued.id).state, "queued");
	assert.equal((await core.start(plan("worker", ["src"]), launch())).status, "refused");
});

test("failure, cancellation and completion release the claim", async () => {
	for (const end of ["cancel", "complete", "fail"]) {
		const children = recordingCore();
		const { core } = children;
		const { id, child } = await children.launch("worker");
		assert.equal((await core.start(plan("worker"), launch())).status, "refused", end);
		if (end === "cancel") core.cancel(id, false);
		if (end === "complete") child.result.resolve("done");
		if (end === "fail") child.result.reject(new Error("boom"));
		await new Promise((resolve) => setImmediate(resolve));
		assert.notEqual(core.get(id).state, "running", end);
		assert.equal((await core.start(plan("worker"), launch())).status, "queued", end);
	}
});

test("a foreground writer holds its claim while it runs and releases it when it ends", async () => {
	const children = recordingCore();
	const { core } = children;
	const running = core.start(plan("worker"), launch(false));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal((await core.start(plan("worker"), launch())).status, "refused");
	children.children.created[0].result.resolve("done");
	assert.equal((await running).status, "completed");
	assert.equal((await core.start(plan("worker"), launch())).status, "queued");
});

test("continue_child claims again and is refused on overlap", async () => {
	const children = recordingCore();
	const { core } = children;
	const { id, child } = await children.launch("worker");
	child.result.resolve("done");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(core.get(id).state, "completed");
	const other = await core.start(plan("worker"), launch());
	assert.equal(other.status, "queued");
	const refused = await core.resume(id, "again", launch());
	assert.equal(refused.status, "refused");
	assert.match(refused.reason, /overlap/);
});
