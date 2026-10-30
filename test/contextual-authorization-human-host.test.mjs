import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
	companionMetadataPath,
	loadCompanionsFromPath,
} from "../extensions/companion-workflow.ts";
import { readSelection } from "../extensions/configure.ts";
import { modelEndpoint } from "./support/model-endpoint.mjs";

const host = new URL(
	"../tools/contextual-authorization-evaluation/human-host.mjs",
	import.meta.url,
).pathname;

test("the interactive host composes an operator-capable contextual parent without inference", {
	timeout: 60_000,
}, async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi293-human-test-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const agentDir = join(dir, "agent");
	const output = join(dir, "evidence");
	execFileSync("mkdir", [agentDir]);
	const packages = loadCompanionsFromPath(companionMetadataPath).companions.map(
		(entry) => entry.package,
	);
	writeFileSync(
		join(agentDir, "pi-workflow-selection.json"),
		JSON.stringify(readSelection(undefined, packages).selection),
	);
	const endpoint = await modelEndpoint(agentDir);
	t.after(() => endpoint.close());
	const { stdout } = await promisify(execFile)(
		process.execPath,
		[host, output, "--check", "--model", endpoint.model],
		{
			env: {
				PATH: process.env.PATH,
				HOME: dir,
				TMPDIR: dir,
				PI_CODING_AGENT_DIR: agentDir,
				PI_OFFLINE: "1",
			},
			timeout: 50_000,
		},
	);
	const result = JSON.parse(stdout);
	assert.equal(result.ready, true);
	for (const tool of [
		"spawn_child",
		"reply_child",
		"ask_user_question",
		"ask_user_choice",
		"codemode",
	])
		assert.ok(result.tools.includes(tool), tool);
	assert.equal(endpoint.requests.length, 0);
	assert.equal(statSync(output).mode & 0o777, 0o700);
	assert.equal(statSync(join(output, "events.jsonl")).mode & 0o777, 0o600);
	const events = readFileSync(join(output, "events.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const start = events.find((event) => event.type === "start");
	const finish = events.find((event) => event.type === "finish");
	assert.deepEqual(start.initial, {
		notes: "Status: pending\n",
		archive: ["old-1.txt", "old-2.txt"],
	});
	assert.equal(finish.classifications, 0);
	assert.equal(existsSync(start.root), false);
});
