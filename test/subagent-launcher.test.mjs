import test from "node:test";
import assert from "node:assert/strict";

import { createSubagentLauncher } from "../extensions/subagent-launcher.ts";

test("subagent launcher returns blockers on launch failures", async () => {
	const launcher = createSubagentLauncher({
		launch: async () => {
			throw new Error("launch failed");
		},
	});
	const result = await launcher.launch({});
	assert.equal(result.ok, false);
	assert.equal(result.blocker.code, "PI_WORKFLOW_AGENT_ASSET_NOT_READY");
});
