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

test("the verify contract keeps a pass or fail verdict and names what stayed unverified", async () => {
	const text = await contract("verify");
	assert.match(text, /verdict: pass or fail/);
	assert.match(text, /Do not change any file/);
	assert.match(text, /what remained unverified/);
});

test("the worker contract asks for the return block and keeps ask_parent as the question channel", async () => {
	const text = await contract("worker");
	assert.match(text, /status: completed \| partial \| blocked/);
	assert.match(text, /files_changed:/);
	assert.match(text, /validation:/);
	assert.match(text, /left_undone:/);
	assert.match(text, /exact command/);
	assert.match(text, /observed result/);
	assert.match(text, /Use completed only when those commands ran and their output is in this result/);
	assert.match(text, /ask_parent/);
	assert.doesNotMatch(text, /interaction_required/);
});
