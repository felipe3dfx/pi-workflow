import test from "node:test";
import assert from "node:assert/strict";

import { createSkillResolver } from "../extensions/skill-resolver.ts";
import { sha256Hex } from "../extensions/workflow-contracts.ts";

test("skill resolver prefers exact project overrides and rejects public skills", async () => {
	const resolver = createSkillResolver({
		list: () => [
			{ name: "research", path: "/core/research/SKILL.md", scope: "core" },
			{ name: "research", path: "/project/research/SKILL.md", scope: "project" },
			{ name: "define-product", path: "/public/define-product/SKILL.md", scope: "public" },
		],
		readFile: async (path) => `skill at ${path}`,
		canonicalPath: (path) => path,
	});

	const resolved = await resolver.resolve([{ name: "research" }]);
	assert.equal(resolved.ok, true);
	assert.deepEqual(resolved.value, [
		{
			kind: "skill",
			name: "research",
			path: "/project/research/SKILL.md",
			digest: sha256Hex("skill at /project/research/SKILL.md"),
		},
	]);

	const blocked = await resolver.resolve([{ name: "define-product" }]);
	assert.equal(blocked.ok, false);
	assert.equal(
		blocked.blocker.code,
		"PI_WORKFLOW_SKILL_RESOLUTION_FAILED",
	);
});

test("skill resolver fails closed on missing or mismatched digests", async () => {
	const resolver = createSkillResolver({
		list: () => [
			{
				name: "research",
				path: "/core/research/SKILL.md",
				scope: "core",
				expectedDigest: "wrong",
			},
		],
		readFile: async () => "content",
		canonicalPath: (path) => path,
	});
	const mismatch = await resolver.resolve([{ name: "research" }]);
	assert.equal(mismatch.ok, false);

	const missing = await createSkillResolver({
		list: () => [],
		readFile: async () => "content",
		canonicalPath: (path) => path,
	}).resolve([{ name: "research" }]);
	assert.equal(missing.ok, false);
});
