import test from "node:test";
import assert from "node:assert/strict";
import {
	readFileSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessProposal } from "../tools/contextual-authorization-evaluation/assess.ts";

const rules = JSON.parse(
	readFileSync(
		new URL(
			"../tools/contextual-authorization-evaluation/cases.json",
			import.meta.url,
		),
		"utf8",
	),
).cases[0].modelInput.rules;
const proposal = {
	authority: {
		assignment: "Correct the assigned file",
		instructions: ["Do not publish"],
	},
	action: {
		tool: "write",
		input: { path: "a.txt", content: "hello" },
		cwd: "/synthetic",
	},
	context: { systemPrompt: "System instructions" },
	tool: { description: "Write a file", parameters: { type: "object" } },
	rules,
};
const ordinary = {
	scope: "within",
	effects: "ordinary",
	ownership: "assigned",
	prohibited: false,
	confirmed: false,
	commit: false,
	reason: "Assigned correction",
};

test("assesses an ordinary assigned action without executing it", async () => {
	let received;
	const result = await assessProposal(proposal, async (p) => {
		received = p;
		return ordinary;
	});
	assert.deepEqual(received, proposal);
	assert.match(received.rules, /^Assess the active assignment/);
	assert.equal(result.assessment.kind, "allow");
	assert.equal(result.finalGate, undefined);
	assert.deepEqual(result.classification, ordinary);
	assert.equal(result.stage, "initial");
	assert.equal(result.initialGate, null);
});

test("prohibition and uncertainty remain distinct", async () => {
	const denied = await assessProposal(proposal, async () => ({
		...ordinary,
		prohibited: true,
		reason: "Explicit prohibition",
	}));
	const held = await assessProposal(proposal, async () => ({
		...ordinary,
		ownership: "unknown",
		reason: "Ownership unknown",
	}));
	assert.equal(denied.assessment.kind, "deny");
	assert.match(denied.finalGate.reason, /^Action prohibited:/);
	assert.equal(held.assessment.kind, "held");
	assert.match(held.finalGate.reason, /^Authorization held;/);
});

test("consultation confirmation must identify the exact action", async () => {
	const high = { ...ordinary, effects: "high-impact", confirmed: true };
	for (const [confirmation, expected] of [
		[{ ...proposal.action, input: { path: "other" } }, "held"],
		[proposal.action, "allow"],
	]) {
		const sample = {
			...proposal,
			consultation: {
				answer: "I confirm this action",
				confirmedActions: [confirmation],
			},
		};
		let calls = 0;
		const result = await assessProposal(sample, async (p) => {
			calls++;
			assert.deepEqual(p, sample);
			return high;
		});
		assert.equal(calls, 1);
		assert.equal(result.assessment.kind, expected);
		assert.equal(result.stage, "resumed");
		assert.equal(result.initialGate, "scripted-held");
	}
});

test("commit assessment is not commit preflight or execution", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "assessment-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, "marker"), "untouched");
	const sample = {
		...proposal,
		action: { tool: "bash", input: { command: "git commit" }, cwd: dir },
		authority: {
			...proposal.authority,
			commit: { paths: ["a.txt"], context: "isolated" },
		},
	};
	const result = await assessProposal(sample, async () => ({
		...ordinary,
		commit: { paths: ["a.txt"] },
	}));
	assert.equal(result.assessment.kind, "allow");
	assert.equal(result.finalGate.block, true);
	assert.match(result.finalGate.reason, /Commit task authority/);
	assert.deepEqual(readdirSync(dir), ["marker"]);
	assert.equal(readFileSync(join(dir, "marker"), "utf8"), "untouched");
});

test("classifier failure, malformed results, policy drift and cancellation are failures", async () => {
	await assert.rejects(
		assessProposal(proposal, async () => {
			throw new Error("classifier offline");
		}),
		/classifier offline/,
	);
	for (const invalid of [
		undefined,
		{},
		{ ...ordinary, commit: {} },
		{ ...ordinary, reason: "" },
	]) {
		await assert.rejects(
			assessProposal(proposal, async () => invalid),
			/Malformed classification/,
		);
	}
	await assert.rejects(
		assessProposal(
			{ ...proposal, rules: "stale policy" },
			async () => ordinary,
		),
		/differs from input/,
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		assessProposal(proposal, async () => ordinary, controller.signal),
		/cancelled/,
	);
});
