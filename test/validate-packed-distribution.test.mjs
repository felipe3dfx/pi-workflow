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
