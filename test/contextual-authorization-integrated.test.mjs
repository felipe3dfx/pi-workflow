import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
	new URL(
		"../tools/contextual-authorization-evaluation/integrated.mjs",
		import.meta.url,
	),
);

function capture(scenario, env = process.env) {
	return JSON.parse(
		execFileSync(process.execPath, [cli, "--scripted", scenario], {
			encoding: "utf8",
			timeout: 45_000,
			env,
		}),
	);
}

test("the scripted real RPC child performs the ordinary assigned write", {
	timeout: 50_000,
}, () => {
	const result = capture("allow");
	assert.equal(result.effect.count, 1);
	assert.equal(result.effect.content, "ASSIGNED");
	assert.equal(result.status, "completed");
	assert.equal(result.provenance.classification, "scripted");
	assert.match(result.provenance.pi.version, /\d+\.\d+\.\d+/);
	assert.match(result.provenance.pi.sha256, /^[a-f0-9]{64}$/);
	assert.match(result.childSessionId, /^[a-f0-9-]{36}$/);
	assert.equal(result.scratchRemoved, true);
	assert.equal(result.childResult, "DONE");
	assert.deepEqual(
		result.toolOutcomes.map(({ event }) => [event.toolName, event.isError]),
		[["write", false]],
	);
	assert.equal(result.decisions.at(-1).decision.kind, "allow");
	assert.equal(result.questions.length, 0);
});

test("a pending consultation preserves the correlated hold without a marker", {
	timeout: 50_000,
}, () => {
	const result = capture("pending");
	assert.equal(result.status, "completed");
	assert.equal(result.effect.count, 0);
	assert.equal(result.effect.content, null);
	assert.equal(result.questions.length, 1);
	const { question, answer, markerCountWhileHeld } = result.questions[0];
	assert.equal(markerCountWhileHeld, 0);
	assert.equal(answer.kind, "pending");
	assert.equal(answer.id, question.id);
	assert.equal(answer.call, question.call);
	assert.equal(result.pending.length, 1);
	assert.equal(result.pending[0].call, question.call);
	assert.equal(result.pending[0].kind, "held");
	assert.deepEqual(
		result.toolOutcomes.map(({ event }) => [event.toolName, event.isError]),
		[["write", true]],
	);
});

test("scripted confirmation of the exact action releases one write", {
	timeout: 50_000,
}, () => {
	const result = capture("release");
	assert.equal(result.status, "completed");
	assert.equal(result.questions.length, 1);
	const { question, answer, markerCountWhileHeld } = result.questions[0];
	assert.equal(markerCountWhileHeld, 0);
	assert.equal(answer.kind, "resolved");
	assert.deepEqual(answer.confirmedActions, [question.proposal.action]);
	assert.equal(answer.call, question.call);
	assert.equal(result.decisions.at(-1).decision.call, question.call);
	assert.equal(result.decisions.at(-1).decision.kind, "allow");
	assert.deepEqual(result.pending, []);
	assert.deepEqual(
		result.toolOutcomes.map(({ event }) => [event.toolName, event.isError]),
		[["write", false]],
	);
	assert.deepEqual(result.effect, { count: 1, content: "ASSIGNED" });
});

test("a failed scripted endpoint retains an incomplete capture and cleans its scratch directory", {
	timeout: 50_000,
}, () => {
	const scratch = mkdtempSync(join(tmpdir(), "pi-auth-test-"));
	try {
		const result = capture("endpoint-failure", {
			...process.env,
			TMPDIR: scratch,
		});
		assert.equal(result.status, "incomplete");
		assert.match(result.error, /Connection error|abort|disposed/i);
		assert.equal(result.effect.count, 0);
		assert.deepEqual(result.toolOutcomes, []);
		assert.equal(result.scratchRemoved, true);
		assert.deepEqual(readdirSync(scratch), []);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
