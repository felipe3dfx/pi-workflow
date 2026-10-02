import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const contracts = fileURLToPath(new URL("../assets/contracts/", import.meta.url));

async function contract(role) {
	return readFile(join(contracts, `${role}.md`), "utf8");
}

const unobserved =
	"Never claim a command ran or a check passed unless that output is in this result.";

test("child contracts forbid unobserved command and check claims", async () => {
	for (const role of ["explore", "worker", "verify"]) {
		assert.match(await contract(role), new RegExp(unobserved));
	}
});

test("the explore contract keeps paths, line numbers, and unconfirmed work", async () => {
	const text = await contract("explore");
	assert.match(text, /file paths and line numbers/);
	assert.match(text, /what you could not confirm/);
	assert.match(text, /Do not change any file/);
});

test("the verify contract asks for a pass, fail, or blocked Verdict through report_result and names what stayed unverified", async () => {
	const text = await contract("verify");
	assert.match(text, /report_result/);
	assert.match(text, /pass, fail, or blocked/);
	assert.match(text, /Use blocked, with the reason/);
	assert.match(text, /Do not change any file/);
	assert.match(text, /what remained unverified/);
	assert.doesNotMatch(text, /verdict: pass \| fail \| blocked/);
});

test("the worker contract asks for its result through report_result and keeps ask_parent as the question channel", async () => {
	const text = await contract("worker");
	assert.match(text, /report_result/);
	assert.match(text, /done, partial, or blocked/);
	assert.match(text, /exact command/);
	assert.match(text, /observed result/);
	assert.match(text, /Use done only when those commands ran and their output is in this result/);
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
		assert.match(text, /Do not simulate the result/);
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
