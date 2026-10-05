import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseContract } from "../extensions/child-launcher.ts";

const contracts = fileURLToPath(new URL("../assets/contracts/", import.meta.url));

async function contract(role) {
	return readFile(join(contracts, `${role}.md`), "utf8");
}

const unobserved =
	"Never claim a command ran or a check passed unless its output is in this result.";

test("child contracts forbid unobserved command and check claims", async () => {
	for (const role of ["explore", "worker", "verify"]) {
		assert.match(await contract(role), new RegExp(unobserved));
	}
});

test("child contracts limit communication to the parent without imposing consumer language policy", async () => {
	for (const role of ["explore", "worker", "verify"]) {
		const text = await contract(role);
		assert.match(text, /Communicate only with the parent, never directly with the user/);
	}
	const agents = await readFile(fileURLToPath(new URL("../AGENTS.md", import.meta.url)), "utf8");
	assert.match(agents, /Parent-child instructions, questions, findings, and results are always in English/);
});

test("the explore contract permits worktree discovery without supplied context or validation", async () => {
	const text = await contract("explore");
	assert.match(text, /Answer a clear, bounded task by reading the worktree/);
	assert.match(text, /Report findings with file paths and line numbers/);
	assert.match(text, /distinguish confirmed facts from open questions/);
	assert.match(text, /ask_parent/);
	assert.match(text, /ambiguous|unclear/i);
	assert.match(text, /Do not edit files/);
});

test("the verify contract independently checks work; parent results are context, and reports what stayed unverified", async () => {
	const text = await contract("verify");
	assert.match(text, /Independently inspect/);
	assert.match(text, /run the applicable checks and tests yourself/i);
	assert.match(text, /parent-supplied validation results are context, not proof/i);
	assert.match(text, /report_result/);
	assert.match(text, /pass, fail with the reason, or blocked with the reason/);
	assert.match(text, /Use blocked, with the reason/);
	assert.match(text, /may run the repository's checks and tests/i);
	assert.match(text, /Do not edit or write worktree files/);
	assert.match(text, /rewrite tracked files or dependencies/i);
	assert.match(text, /tracked worktree files change during verification, stop and report blocked naming the change/i);
	assert.match(text, /Only Verdict pass means verified/);
	assert.match(text, /fail or blocked is not a pass/);
	assert.match(text, /what remained unverified/);
	assert.doesNotMatch(text, /verdict: pass \| fail \| blocked/);
});

test("the worker contract asks for its result through report_result and keeps ask_parent as the question channel", async () => {
	const text = await contract("worker");
	assert.match(text, /report_result/);
	assert.match(text, /done, partial with the reason, or blocked with the reason/);
	assert.match(text, /exact command/);
	assert.match(text, /observed result/);
	assert.match(text, /Use done only when the required commands ran and their output is in this result/);
	assert.match(text, /partial or blocked is not done/);
	assert.match(text, /files_changed, validation, and left_undone/);
	assert.match(text, /After report_result, give the parent a short final summary/);
	assert.match(text, /ask_parent/);
	assert.doesNotMatch(text, /status: done \| partial \| blocked/);
	assert.doesNotMatch(text, /interaction_required/);
});

test("the explore contract reports no Verdict", async () => {
	assert.doesNotMatch(await contract("explore"), /report_result/);
});

test("every contract names the missing-capability response and forbids simulating the result", async () => {
	for (const role of ["explore", "worker", "verify"]) {
		const text = await contract(role);
		assert.match(text, /capability you do not have/);
		assert.match(text, /ask_parent/);
		assert.match(text, /Do not simulate results/);
	}
	for (const role of ["worker", "verify"])
		assert.match(
			await contract(role),
			/report blocked and name the missing capability/,
		);
});

test("the worker contract declares that children have no MCP and cannot launch children", async () => {
	assert.match(await contract("worker"), /no MCP tools and cannot launch child sessions/);
});

test("the explore and verify contracts offer codegraph and the worker contract does not", async () => {
	for (const role of ["explore", "verify"]) {
		const text = await contract(role);
		assert.ok(parseContract(text).tools.includes("codegraph"));
		assert.match(text, /codegraph query and explore/);
	}
	assert.doesNotMatch(await contract("worker"), /codegraph/);
});
