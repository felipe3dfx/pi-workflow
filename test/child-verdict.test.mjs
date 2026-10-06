import test from "node:test";
import assert from "node:assert/strict";

import { childOutcome, needsNoReason } from "../extensions/child-projection.ts";
import { recordingCore } from "./support/fake-children.mjs";

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

async function delivered(role, end, result) {
	const delivery = recordingCore();
	const { child } = await delivery.launch(role);
	if (result) child.spec.report(result);
	end(child);
	await new Promise((resolve) => setImmediate(resolve));
	delivery.core.atBoundary();
	return delivery.sent[0].details;
}

const completes = (text) => (child) => child.result.resolve(text);

test("the parent receives Run state, the reported Verdict, its reason and fields, then the child's text", async () => {
	const blocked = record("worker", "Changed it.", blockedWorker);
	assert.equal(
		childOutcome(blocked),
		"Child child-1 completed. Verdict: blocked.\nReason: Database access is missing\nfiles_changed:\n- a.ts: fixed\nvalidation:\n- none\nleft_undone:\n- Run the migration\n\nChanged it.",
	);
	const details = await delivered(
		"worker",
		completes("Changed it."),
		blockedWorker,
	);
	assert.equal(details.state, "completed");
	assert.equal(details.verdict, "blocked");
	assert.deepEqual(details.result, blockedWorker);
});

test("a child that never reported has an absent Verdict, never inferred from its text", async () => {
	for (const [role, text] of [
		["worker", "status: done\nfiles_changed:\n- a.ts"],
		["verify", "verdict: pass"],
	]) {
		const bare = record(role, text);
		assert.equal(
			childOutcome(bare),
			`Child child-1 completed. Verdict: absent.\n\n${text}`,
		);
		assert.equal((await delivered(role, completes(text))).verdict, undefined);
	}
});

test("an explorer has no Verdict", async () => {
	const found = record("explore", "src/a.ts:3");
	assert.equal(childOutcome(found), "Child child-1 completed.\n\nsrc/a.ts:3");
	assert.equal(
		(await delivered("explore", completes("src/a.ts:3"))).verdict,
		undefined,
	);
});

test("a reported Verdict counts only for a completed child", async () => {
	const failed = {
		...record("worker", "provider overloaded", blockedWorker),
		state: "failed",
	};
	assert.equal(childOutcome(failed), "Child child-1 failed: provider overloaded");
	const details = await delivered(
		"worker",
		(child) => child.result.reject(new Error("provider overloaded")),
		blockedWorker,
	);
	assert.equal(details.state, "failed");
	assert.equal(details.verdict, undefined);
});

test("only a completed child with done, pass, or no Verdict needs no reason", () => {
	const quiet = ["completed/absent", "completed/done", "completed/pass"];
	for (const state of [
		"queued",
		"running",
		"waiting",
		"completed",
		"failed",
		"cancelled",
		"timed out",
	]) {
		for (const verdict of [
			undefined,
			"done",
			"pass",
			"partial",
			"blocked",
			"fail",
		]) {
			assert.equal(
				needsNoReason(state, verdict),
				quiet.includes(`${state}/${verdict ?? "absent"}`),
				`${state} with ${verdict ?? "no"} Verdict`,
			);
		}
	}
});
