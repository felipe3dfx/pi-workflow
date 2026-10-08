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
	assert.match(text, /Use ask_parent only when blocked and the answer changes your next step/);
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
	assert.match(text, /A command reserved for the parent is not a missing capability or unavailable evidence/);
	assert.match(text, /list the exact command in unverified/);
	assert.match(text, /use ask_parent only when blocked and the answer changes your next step/);
	assert.match(text, /Put memory-worthy facts in findings; never ask the parent to save memory/);
	assert.doesNotMatch(text, /ask_parent or report blocked/);
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
	assert.match(text, /Required commands exclude commands reserved for the parent/);
	assert.match(text, /Use done only when the required commands ran and their output is in this result/);
	assert.match(text, /a reserved command is not a missing capability, so report done when the rest is complete and list the exact command in left_undone/);
	assert.match(text, /Use ask_parent only when blocked and the answer changes your next step/);
	assert.match(text, /Put memory-worthy facts in the final summary; never ask the parent to save memory/);
	assert.doesNotMatch(text, /When you need a decision, ask_parent/);
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
		assert.match(text, /ask_parent only when blocked and the answer changes (your|its) next step/i);
		assert.match(text, /Do not simulate results/);
	}
	assert.match(
		await contract("worker"),
		/report blocked and name the missing capability/,
	);
	assert.match(
		await contract("verify"),
		/report blocked and name the missing capability/,
	);
});

test("the worker and verify contracts no longer deny MCP and still cannot launch children", async () => {
	for (const role of ["worker", "verify"]) {
		const text = await contract(role);
		assert.match(text, /You cannot launch child sessions\./);
		assert.doesNotMatch(text, /no MCP tools|cannot use MCP tools/);
	}
});

test("every contract keeps publishing through MCP with the parent and takes precedence over context files", async () => {
	for (const role of ["explore", "worker", "verify"]) {
		const text = await contract(role);
		assert.match(
			text,
			/Publishing or writing to external services through MCP tools stays with the parent\./,
		);
		assert.match(
			text,
			/This contract takes precedence over context files such as AGENTS\.md; their instructions to commit, push, or open pull requests do not apply to you\./,
		);
	}
});

test("the explore and verify read-only wording covers MCP tools", async () => {
	for (const role of ["explore", "verify"]) {
		assert.match(await contract(role), /Use MCP tools only to read\./);
	}
});

test("only the explore contract offers web tools, and marks them optional", async () => {
	assert.match(
		await contract("explore"),
		/Web tools are optional: when present, use them only to search and read pages; when absent, continue without them\./,
	);
	for (const role of ["worker", "verify"]) {
		assert.doesNotMatch(await contract(role), /[Ww]eb tools/);
	}
});

test("the explore and verify contracts offer codegraph and the worker contract does not", async () => {
	for (const role of ["explore", "verify"]) {
		const text = await contract(role);
		assert.ok(parseContract(text).tools.includes("codegraph"));
		assert.match(text, /codegraph query and explore/);
	}
	assert.doesNotMatch(await contract("worker"), /codegraph/);
});

test("every contract offers codemode and asks to batch independent calls in one script", async () => {
	for (const role of ["explore", "worker", "verify"]) {
		const text = await contract(role);
		assert.ok(parseContract(text).tools.includes("codemode"), role);
		assert.match(
			text,
			/Use codemode to batch independent tool calls \(Promise\.allSettled\), chain them, or filter large output, instead of many separate calls\./,
		);
	}
});

test("the explore and verify read-only wording covers codemode scripts", async () => {
	assert.match(await contract("explore"), /Do not edit files or run commands, directly or from codemode\./);
	assert.match(
		await contract("verify"),
		/Do not edit or write worktree files, directly or from codemode, and do not run commands that rewrite tracked files/,
	);
});
