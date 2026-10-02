import test from "node:test";
import assert from "node:assert/strict";

import { childOutcome } from "../extensions/child-projection.ts";
import { childDetails } from "../extensions/child-sessions.ts";

const record = (role, text, result) => ({
	id: "child-1",
	role,
	state: "completed",
	model: "p/m",
	thinking: "medium",
	task: "t",
	createdAt: 0,
	text,
	...(result ? { result } : {}),
});

const blockedWorker = {
	verdict: "blocked",
	reason: "Database access is missing",
	files_changed: ["a.ts: fixed"],
	validation: [],
	left_undone: ["Run the migration"],
};

test("the parent receives Run state, the reported Verdict, its reason and fields, then the child's text", () => {
	const blocked = record("worker", "Changed it.", blockedWorker);
	assert.equal(
		childOutcome(blocked),
		"Child child-1 completed. Verdict: blocked.\nReason: Database access is missing\nfiles_changed:\n- a.ts: fixed\nvalidation:\n- none\nleft_undone:\n- Run the migration\n\nChanged it.",
	);
	assert.equal(childDetails(blocked).state, "completed");
	assert.equal(childDetails(blocked).verdict, "blocked");
	assert.deepEqual(childDetails(blocked).result, blockedWorker);
});

test("a child that never reported has an absent Verdict, never inferred from its text", () => {
	for (const [role, text] of [
		["worker", "status: done\nfiles_changed:\n- a.ts"],
		["verify", "verdict: pass"],
	]) {
		const bare = record(role, text);
		assert.equal(
			childOutcome(bare),
			`Child child-1 completed. Verdict: absent.\n\n${text}`,
		);
		assert.equal(childDetails(bare).verdict, undefined);
	}
});

test("an explorer has no Verdict", () => {
	const found = record("explore", "src/a.ts:3");
	assert.equal(childOutcome(found), "Child child-1 completed.\n\nsrc/a.ts:3");
	assert.equal(childDetails(found).verdict, undefined);
});

test("a reported Verdict counts only for a completed child", () => {
	const failed = {
		...record("worker", "provider overloaded", blockedWorker),
		state: "failed",
	};
	assert.equal(childOutcome(failed), "Child child-1 failed: provider overloaded");
	assert.equal(childDetails(failed).verdict, undefined);
});
