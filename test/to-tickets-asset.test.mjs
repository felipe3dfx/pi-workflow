import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("to-tickets package asset requires the exact Spanish graph contract without language heuristics", async () => {
	const asset = await readFile(new URL("../assets/agents/to-tickets.md", import.meta.url), "utf8");
	assert.match(asset, /workflow_artifact_session/);
	assert.match(asset, /language: "es"/);
	assert.match(asset, /professional-neutral Spanish/i);
	assert.match(asset, /stable identifiers/i);
	assert.doesNotMatch(asset, /dictionary|regionalism|foreign-word|NLP/i);
});
