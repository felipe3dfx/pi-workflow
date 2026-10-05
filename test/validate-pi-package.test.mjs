import test from "node:test";
import assert from "node:assert/strict";

import { commands, validateCommandSurface, validatePiPackage } from "../scripts/validate-pi-package.mjs";

test("the workspace package matches the thin harness contract", async () => {
	assert.deepEqual(await validatePiPackage(), []);
});

test("the command validator requires subagents and rejects obsolete configure/settings registrations", () => {
	assert.deepEqual(
		validateCommandSurface(
			commands
				.map((command) => `pi.registerCommand("${command}", {});`)
				.join(" "),
		),
		[],
	);
	for (const obsolete of ["workflow:configure", "workflow:settings"]) {
		const extension = [...commands, obsolete]
			.map((command) => `pi.registerCommand("${command}", {});`)
			.join(" ");
		assert.deepEqual(validateCommandSurface(extension), [
			`extension must not register obsolete ${obsolete}`,
		]);
	}
});
