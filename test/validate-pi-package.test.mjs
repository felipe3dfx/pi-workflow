import test from "node:test";
import assert from "node:assert/strict";

import { validatePiPackage } from "../scripts/validate-pi-package.mjs";

test("the workspace package matches the thin harness contract", async () => {
	assert.deepEqual(await validatePiPackage(), []);
});
