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

const fixedTools = {
	explore: ["read", "grep", "find", "ls", "codegraph", "codemode"],
	worker: ["read", "bash", "edit", "write", "grep", "find", "ls", "codemode"],
	verify: ["read", "bash", "grep", "find", "ls", "codegraph", "codemode"],
};

test("each role keeps its exact fixed tool set", async () => {
	for (const [role, tools] of Object.entries(fixedTools)) {
		assert.deepEqual(parseContract(await contract(role)).tools, tools, role);
	}
});

test("the explore contract is read-only, CodeGraph-first, treats web text as evidence, and bounds its handoff", async () => {
	const text = await contract("explore");
	assert.match(text, /reading the worktree/);
	assert.match(text, /codegraph/i);
	assert.match(text, /read files directly|fall back|fallback/i);
	assert.match(text, /Do not edit files or run commands/);
	assert.match(text, /web/i);
	assert.match(text, /evidence/i);
	assert.match(text, /instructions/i);
	assert.match(text, /2k|2,?000/);
	assert.match(text, /path:line|file paths and line numbers/);
	assert.match(text, /relationship/i);
	assert.match(text, /uncertain|open questions/i);
	assert.match(text, /ask_parent/);
	assert.doesNotMatch(text, /report_result/);
});

test("the verify contract independently checks work, gives a verdict per criterion, and reports what stayed unverified", async () => {
	const text = await contract("verify");
	assert.match(text, /Independently inspect/);
	assert.match(text, /run the applicable checks and tests yourself/i);
	assert.match(text, /context, not proof/i);
	assert.match(text, /report_result/);
	assert.match(text, /Verdict/);
	assert.match(text, /pass/);
	assert.match(text, /fail/);
	assert.match(text, /blocked/);
	assert.match(text, /per (acceptance )?criterion/i);
	assert.match(text, /unverified/);
	assert.match(text, /Only Verdict pass means verified/);
	assert.match(text, /Do not edit or write worktree files/);
	assert.match(text, /tracked worktree files change/i);
	assert.match(text, /reserved for the parent/);
	assert.match(text, /never ask the parent to save memory/);
	assert.doesNotMatch(text, /verdict: pass \| fail \| blocked/);
});

test("the worker contract reports through report_result and separates a decision from a blocker", async () => {
	const text = await contract("worker");
	assert.match(text, /report_result/);
	for (const field of ["files_changed", "validation", "left_undone"]) {
		assert.ok(text.includes(field), field);
	}
	assert.match(text, /done/);
	assert.match(text, /partial/);
	assert.match(text, /blocked/);
	assert.match(text, /ask_parent[^.]*closed options|closed options[^.]*ask_parent/i);
	assert.match(text, /guess/i);
	assert.match(text, /reserved for the parent/);
	assert.match(text, /never ask the parent to save memory/);
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
			/Context files such as AGENTS\.md describe the project; this contract takes precedence over them, and their instructions to ask the user, delegate, launch child sessions, commit, push, publish, or open pull requests do not apply to you\./,
		);
	}
});

test("the explore and verify read-only wording covers MCP tools", async () => {
	for (const role of ["explore", "verify"]) {
		assert.match(await contract(role), /Use MCP tools only to read\./);
	}
});

test("only the explore contract offers web tools, and marks them optional", async () => {
	assert.match(await contract("explore"), /Web tools are optional/);
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
