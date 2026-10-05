import test from "node:test";
import assert from "node:assert/strict";

import { validateCommandSurface, validatePiPackage } from "../scripts/validate-pi-package.mjs";

test("the workspace package matches the thin harness contract", async () => {
	assert.deepEqual(await validatePiPackage(), []);
});

test("the command validator requires subagents and rejects obsolete configure/settings registrations", () => {
	assert.deepEqual(
		validateCommandSurface(
			[
				"workflow:status",
				"workflow:doctor",
				"workflow:config",
				"workflow:models",
				"workflow:subagents",
				"workflow:delegation-check",
			]
				.map((command) => `pi.registerCommand("${command}", {});`)
				.join(" "),
		),
		[],
	);
	assert.ok(
		validateCommandSurface(
			'pi.registerCommand("workflow:configure", {}); pi.registerCommand("workflow:settings", {});',
		).length >= 3,
	);
});
