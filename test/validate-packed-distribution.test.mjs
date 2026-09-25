import test from "node:test";
import assert from "node:assert/strict";

import { validatePackedFiles } from "../scripts/validate-packed-distribution.mjs";

test("packed file validation rejects retired workflow paths", () => {
	const errors = validatePackedFiles([
		"package.json",
		"skills/define-product/SKILL.md",
		"extensions/interactive-decisions.ts",
	]);
	assert.match(errors.join("\n"), /skills\/define-product\/SKILL.md/);
	assert.match(errors.join("\n"), /interactive-decisions.ts/);
	assert.match(errors.join("\n"), /missing README.md/);
});

test("packed file validation requires the child contracts and still rejects retired resources", () => {
	const missing = validatePackedFiles(["package.json"]).join("\n");
	for (const role of ["explore", "worker", "verify"]) {
		assert.match(missing, new RegExp(`missing assets/contracts/${role}.md`));
	}

	const retired = validatePackedFiles([
		"assets/contracts/worker.md",
		"skills/tdd/SKILL.md",
		"prompts/review.md",
		"assets/agents/worker.md",
	]).join("\n");
	assert.doesNotMatch(retired, /include assets\/contracts/);
	assert.match(retired, /include skills\/tdd\/SKILL.md/);
	assert.match(retired, /include prompts\/review.md/);
	assert.match(retired, /include assets\/agents\/worker.md/);
});
