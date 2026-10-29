import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { piSkip as skip } from "./support/installed-pi.mjs";

const host = new URL(
	"../tools/contextual-authorization-evaluation/parent-host.mjs",
	import.meta.url,
);
const run = (scenario) =>
	JSON.parse(
		execFileSync(process.execPath, [host.pathname, "--scripted", scenario], {
			encoding: "utf8",
			timeout: 45000,
		}),
	);

test("the SDK parent receives and answers a real RPC child question before its scratch effect", {
	skip,
	timeout: 50000,
}, () => {
	const result = run("release");
	assert.equal(result.effect.count, 1);
	assert.equal(result.status, "completed");
	assert.equal(result.questions.length, 1);
	assert.equal(result.questions[0].markerWhileHeld, false);
	assert.equal(result.replies.length, 1);
	assert.equal(result.replies[0].child, result.questions[0].child);
	assert.equal(result.replies[0].question, result.questions[0].number);
	assert.equal(result.terminalResults.length, 1);
	assert.equal(result.terminalResults[0].child, result.questions[0].child);
	assert.equal(result.finalText, "FINISHED");
	assert.equal(result.childWriteResults.filter((e) => !e.isError).length, 1);
	assert.equal(result.provenance.parentModel, "scripted");
	assert.equal(result.provenance.childTransport, "installed Pi RPC");
	assert.equal(result.scratchRemoved, true);
});

for (const scenario of ["pending", "deny"])
	test(`the SDK parent ${scenario} reply preserves zero effects in the RPC child`, {
		skip,
		timeout: 50000,
	}, () => {
		const result = run(scenario);
		assert.equal(result.status, "completed");
		assert.deepEqual(result.effect, { count: 0, content: null });
		assert.equal(result.questions.length, 1);
		assert.equal(result.questions[0].markerWhileHeld, false);
		assert.equal(result.replies[0].answer.kind, scenario);
		assert.equal(result.replies[0].child, result.questions[0].child);
		assert.equal(
			result.replies[0].answer.call,
			result.questions[0].question.call,
		);
		assert.equal(result.childWriteResults.length, 1);
		assert.equal(result.childWriteResults[0].isError, true);
		assert.equal(result.terminalResults.length, 1);
		assert.equal(result.finalText, "FINISHED");
		assert.equal(result.scratchRemoved, true);
	});
