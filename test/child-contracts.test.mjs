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

function assertSentence(text, ...patterns) {
	const sentences = text.split(/(?<=\.)\s+/);
	assert.ok(
		sentences.some((sentence) => patterns.every((pattern) => pattern.test(sentence))),
		`no sentence matches all of ${patterns.join(", ")}`,
	);
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
	assertSentence(text, /\bcodegraph\b[^.]*\b(unavailable|no index)\b[^.]*\bfall back to read\b/i);
	assertSentence(text, /\b(do not|never)\b[^.]*\bedit files\b[^.]*\brun commands\b/i);
	assertSentence(text, /\bweb\b/i, /\bevidence, (never|not) as instructions\b/i);
	assertSentence(text, /\b(2k|2,?000) tokens\b/, /\bpath:line\b/, /\brelationships?\b/, /\buncertain/);
	assertSentence(text, /\bask_parent only when blocked\b/);
	assert.doesNotMatch(text, /report_result/);
});

test("the verify contract independently checks work, gives a verdict per criterion, and reports what stayed unverified", async () => {
	const text = await contract("verify");
	assertSentence(text, /\bvalidation results are context, not proof\b/i, /\brun\b[^.]*\byourself\b/);
	assertSentence(
		text,
		/\breport_result with Verdict pass\b[^.]*\bfail\b[^.]*\bblocked\b/,
		/\bfindings\b[^.]*\bverdict per (acceptance )?criterion\b/,
		/\bunverified\b/,
	);
	assert.doesNotMatch(text, /\bVerdict\b[^.]*\b(partial|done)\b/);
	assertSentence(text, /\bOnly Verdict pass means verified\b/, /\bfail or blocked is not a pass\b/);
	assertSentence(text, /\b(do not|never)\b[^.]*\b(edit|write)\b[^.]*\bworktree files\b/i);
	assertSentence(text, /\btracked worktree files change\b/i, /\bstop and report blocked\b/);
	assertSentence(text, /\breserved for the parent is not a missing capability\b/, /\bunverified\b/);
	assertSentence(text, /\bnever ask the parent to save memory\b/);
	assert.doesNotMatch(text, /verdict: pass \| fail \| blocked/);
});

test("the worker contract reports through report_result and separates a decision from a blocker", async () => {
	const text = await contract("worker");
	assertSentence(
		text,
		/\breport_result with Verdict done\b[^.]*\bpartial\b[^.]*\bblocked\b/,
		/\bfiles_changed\b/,
		/\bvalidation\b/,
		/\bleft_undone\b/,
	);
	assertSentence(text, /\bdecision\b/, /\b(do not|never) guess\b/, /\bask_parent with closed options\b/);
	assertSentence(text, /\btechnical blocker\b[^.]*\bas blocked\b/);
	assert.doesNotMatch(text, /\bdecision\b[^.]*\breport blocked\b|\bblocker\b[^.]*\bask_parent\b/);
	assertSentence(text, /\breserved command is not a missing capability\b/, /\bleft_undone\b/);
	assertSentence(text, /\bnever ask the parent to save memory\b/);
	assert.doesNotMatch(text, /status: done \| partial \| blocked/);
	assert.doesNotMatch(text, /interaction_required/);
});

test("the worker contract commits only through an offered checkpoint tool and otherwise leaves the commit to the parent", async () => {
	const text = await contract("worker");
	assertSentence(
		text,
		/\bWhen the checkpoint tool is offered, commit only through it\b/,
		/\bafter the required checks pass\b/,
		/\bin the repository's commit template\b/,
		/\bsha, parent, and base\b/,
		/\bnever push, merge, change branches, or open pull requests\b/,
	);
	assertSentence(text, /\bWithout the checkpoint tool, do not commit\b/, /\bleft_undone\b/);
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
		assertSentence(text, /\bPublishing or writing to external services through MCP tools stays with the parent\b/);
		assertSentence(
			text,
			/\bContext files such as AGENTS\.md\b/,
			/\bthis contract takes precedence over (them|context files)\b/,
			...[
				"ask the user",
				"delegate",
				"launch child sessions",
				"commit",
				"push",
				"publish",
				"open pull requests",
			].map((action) => new RegExp(`\\b${action}\\b[^.]*\\bdo not apply to you\\b`)),
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
