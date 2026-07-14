import test from "node:test";
import assert from "node:assert/strict";

import { createSubagentLauncher } from "../extensions/subagent-launcher.ts";

test("subagent launcher preserves concrete runtime session and verified discovered paths", async () => {
	const options = {
		attempt: 2,
		sessionId: "session-2",
		resumeSessionId: "session-1",
		verifiedArtifacts: [{ revision: "progress-r1" }],
	};
	const terminal = { status: "completed", artifacts: [] };
	const launcher = createSubagentLauncher({
		launch: async (_prepared, receivedOptions) => {
			assert.deepEqual(receivedOptions, options);
			return {
				result: terminal,
				sessionId: "session-1",
				discoveredPaths: ["src/discovered.ts"],
				partialOutput: { ignored: true },
			};
		},
	});
	assert.deepEqual(await launcher.launch({}, options), {
		ok: true,
		value: terminal,
		sessionId: "session-1",
		discoveredPaths: ["src/discovered.ts"],
	});
});

test("subagent launcher preserves interruption progress but discards partial output", async () => {
	const verifiedArtifact = { revision: "progress-r1" };
	const launcher = createSubagentLauncher({
		launch: async () => {
			throw Object.assign(new Error("runtime interrupted"), {
				code: "PI_WORKFLOW_DELEGATION_INTERRUPTED",
				interrupted: true,
				sessionId: "session-resumable",
				verifiedArtifacts: [verifiedArtifact],
				partialOutput: "untrusted",
			});
		},
	});
	assert.deepEqual(await launcher.launch({}, {
		attempt: 1,
		sessionId: "session-requested",
		verifiedArtifacts: [],
	}), {
		ok: false,
		interrupted: true,
		sessionId: "session-resumable",
		verifiedArtifacts: [verifiedArtifact],
		blocker: {
			code: "PI_WORKFLOW_DELEGATION_INTERRUPTED",
			message: "runtime interrupted",
		},
	});
});

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
