import test from "node:test";
import assert from "node:assert/strict";
import { runPackedSubprocess } from "./support/packed-subprocess.mjs";

test("packed subprocess timeout failures preserve stderr", async () => {
	await assert.rejects(
		runPackedSubprocess(
			process.execPath,
			["-e", "process.stderr.write('still-running\\n'); setInterval(() => {}, 1000)"],
			{ timeout: 50 },
		),
		(error) => {
			assert.match(error.message, /still-running/);
			assert.match(error.message, /timed out|SIGTERM|timeout/i);
			return true;
		},
	);
});
