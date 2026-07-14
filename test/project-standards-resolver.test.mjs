import test from "node:test";
import assert from "node:assert/strict";

import { createProjectStandardsResolver } from "../extensions/project-standards-resolver.ts";
import { sha256Hex } from "../extensions/workflow-contracts.ts";

const project = { name: "pi-workflow", root: "/repo" };

test("project standards resolver returns exact refs in deterministic order", async () => {
	const resolver = createProjectStandardsResolver({
		load: () => ({
			instructions: [
				{
					name: "CONTRIBUTING",
					path: "/repo/CONTRIBUTING.md",
					content: "rules",
				},
			],
			context: {
				name: "CONTEXT",
				path: "/repo/CONTEXT.md",
				content: "glossary",
			},
			overlays: [
				{
					name: "Define Product Overlay",
					path: "/repo/skills/define-product/overlay.md",
					content: "overlay",
					pathPrefixes: ["skills/define-product"],
				},
			],
			requiredSkills: [{ name: "research" }],
		}),
	});

	const resolved = await resolver.resolve({
		project,
		affectedPaths: ["skills/define-product/SKILL.md"],
	});
	assert.equal(resolved.ok, true);
	assert.deepEqual(
		resolved.value.standardRefs.map((entry) => ({ path: entry.path, digest: entry.digest })),
		[
			{ path: "/repo/CONTEXT.md", digest: sha256Hex("glossary") },
			{ path: "/repo/CONTRIBUTING.md", digest: sha256Hex("rules") },
			{
				path: "/repo/skills/define-product/overlay.md",
				digest: sha256Hex("overlay"),
			},
		],
	);
	assert.deepEqual(resolved.value.requiredSkills, [{ name: "research" }]);
});

test("project standards resolver fails closed for missing required content", async () => {
	const resolver = createProjectStandardsResolver({
		load: () => ({
			instructions: [
				{
					name: "Missing",
					path: "/repo/MISSING.md",
					content: "",
				},
			],
		}),
	});
	const resolved = await resolver.resolve({ project, affectedPaths: [] });
	assert.equal(resolved.ok, false);
	assert.equal(
		resolved.blocker.code,
		"PI_WORKFLOW_STANDARDS_RESOLUTION_FAILED",
	);
});
