import test from "node:test";
import assert from "node:assert/strict";

import { childOutcome, childVerdict } from "../extensions/child-projection.ts";
import { childDetails } from "../extensions/child-sessions.ts";

const workerBlock = (word) =>
	`Changed it.\n\nstatus: ${word}\nfiles_changed:\n- a.ts: fixed\nvalidation:\n- npm test: ok\nleft_undone:\n- none`;

test("a worker Verdict is done, partial, or blocked and is read from its status line", () => {
	for (const word of ["done", "partial", "blocked"]) {
		assert.equal(childVerdict("worker", workerBlock(word)), word);
	}
});

test("a verifier Verdict is pass, fail, or blocked", () => {
	for (const word of ["pass", "fail", "blocked"]) {
		assert.equal(childVerdict("verify", `Checked.\n\nverdict: ${word}`), word);
	}
});

test("an absent or invalid Verdict is reported as absent and never inferred", () => {
	assert.equal(childVerdict("worker", "All tests pass."), undefined);
	assert.equal(childVerdict("worker", workerBlock("completed")), undefined);
	assert.equal(childVerdict("verify", "verdict: maybe"), undefined);
	assert.equal(childVerdict("verify", workerBlock("done")), undefined);
});

test("the Verdict is the last status or verdict line, and an invalid last line leaves it absent", () => {
	assert.equal(
		childVerdict("verify", "verdict: pass\nRechecked.\nverdict: fail"),
		"fail",
	);
	assert.equal(
		childVerdict("verify", "verdict: pass\nRechecked.\nverdict: maybe"),
		undefined,
	);
	assert.equal(
		childVerdict("worker", "status: done\nstatus: finished"),
		undefined,
	);
	assert.equal(childVerdict("verify", "verdict: pass\nverdict:\npass"), undefined);
	assert.equal(childVerdict("worker", "status: done\nstatus:\ndone"), undefined);
});

test("an explorer emits no Verdict", () => {
	assert.equal(childVerdict("explore", "verdict: pass\nstatus: done"), undefined);
});

test("the parent receives Run state and Verdict separately", () => {
	const record = (role, text) => ({
		id: "child-1",
		role,
		state: "completed",
		model: "p/m",
		thinking: "medium",
		task: "t",
		createdAt: 0,
		text,
	});
	const blocked = record("worker", workerBlock("blocked"));
	assert.match(childOutcome(blocked), /^Child child-1 completed\. Verdict: blocked\./);
	assert.equal(childDetails(blocked).state, "completed");
	assert.equal(childDetails(blocked).verdict, "blocked");

	const bare = record("verify", "looks fine");
	assert.match(childOutcome(bare), /^Child child-1 completed\. Verdict: absent\./);
	assert.equal(childDetails(bare).verdict, undefined);

	const found = record("explore", "src/a.ts:3");
	assert.match(childOutcome(found), /^Child child-1 completed\.\n\nsrc\/a\.ts:3/);
	assert.equal(childDetails(found).verdict, undefined);
});
