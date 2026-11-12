import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { withAgentDirectory } from "./support/agent-directory.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("scripts/flow-metrics.mjs");

function bytes(value) {
	return Buffer.byteLength(JSON.stringify(value));
}

function text(size) {
	return [{ type: "text", text: "x".repeat(size) }];
}

function call(name, args = {}) {
	return { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name, arguments: args }] } };
}

function result(toolName, content) {
	return { type: "message", message: { role: "toolResult", toolName, content } };
}

function custom(customType, content) {
	return { type: "custom_message", customType, content };
}

function writeSession(dir, id, date, entries) {
	const folder = join(dir, "sessions", "--repo--");
	mkdirSync(folder, { recursive: true });
	const lines = [{ type: "session", id, timestamp: `${date}T10:00:00.000Z` }, ...entries].map((entry) =>
		typeof entry === "string" ? entry : JSON.stringify(entry),
	);
	writeFileSync(join(folder, `${date}_${id}.jsonl`), `${lines.join("\n")}\n`);
}

function auditLine(header, payload) {
	return `00000000\t${JSON.stringify(header)}\t${payload}`;
}

function writeAudit(dir, parent, child, launch, split = false) {
	const folder = join(dir, "pi-workflow-audit", parent);
	mkdirSync(folder, { recursive: true });
	const payload = JSON.stringify({ child, role: "explore", task: "t", ...launch });
	const middle = Math.floor(payload.length / 2);
	const lines = split
		? [
				auditLine({ v: 1, ordinal: 0, part: 0, meta: { child } }, payload.slice(0, middle)),
				auditLine({ v: 1, ordinal: 0, part: 1, parts: 2 }, payload.slice(middle)),
			]
		: [auditLine({ v: 1, ordinal: 0, part: 0, parts: 1 }, payload)];
	lines.push(auditLine({ v: 1, ordinal: 1, part: 0, parts: 1 }, JSON.stringify({ kind: "execution", state: "completed" })));
	writeFileSync(join(folder, `${child}.jsonl`), `${lines.join("\n")}\n`);
}

async function run(dir, args = []) {
	const { stdout } = await execFileAsync(process.execPath, [
		scriptPath,
		"--sessions",
		join(dir, "sessions"),
		"--audit",
		join(dir, "pi-workflow-audit"),
		...args,
	]);
	return stdout;
}

async function report(dir, args = []) {
	return JSON.parse(await run(dir, [...args, "--json"]));
}

function fixture(t) {
	const dir = withAgentDirectory(t);
	const user = { type: "message", message: { role: "user", content: text(100) } };
	writeSession(dir, "parent-a", "2026-11-01", [
		user,
		call("spawn_child", { role: "explore", task: "t" }),
		result("spawn_child", text(50)),
		result("read", text(300)),
		result("codemode", text(25 * 1024)),
		result("codemode", text(1000)),
		custom("pi-workflow-child-result", "r".repeat(400)),
		custom("pi-workflow-child-question", "q".repeat(100)),
		custom("pi-workflow-exploration-budget", "budget"),
	]);
	writeSession(dir, "parent-b", "2026-11-05", [
		call("codemode", { code: "await spawn_child({ role: 'worker', task: 't' })" }),
		result("codemode", text(200)),
		custom("pi-workflow-child-result", "r".repeat(1000)),
		custom("pi-workflow-exploration-budget", "budget"),
		custom("pi-workflow-exploration-budget", "budget"),
	]);
	writeSession(dir, "solo", "2026-11-03", [user, call("read", { path: "a" }), result("read", text(5000))]);
	writeAudit(dir, "parent-a", "c1", { references: ["AGENTS.md"] }, true);
	writeAudit(dir, "parent-a", "c2", { references: [] });
	writeAudit(dir, "parent-a", "c3", { references: [], continuedFrom: "c2" });
	writeAudit(dir, "parent-b", "c4", { references: [] });
	return dir;
}

function conversationOfA() {
	return (
		bytes(text(100)) +
		bytes([{ type: "toolCall", name: "spawn_child", arguments: { role: "explore", task: "t" } }]) +
		bytes(text(50)) +
		bytes(text(300)) +
		bytes(text(25 * 1024)) +
		bytes(text(1000)) +
		bytes("r".repeat(400)) +
		bytes("q".repeat(100)) +
		bytes("budget")
	);
}

test("reports every metric for delegating parent sessions only", async (t) => {
	const dir = fixture(t);
	const { sessions, metrics, unparseable } = await report(dir);
	const ownBytesA = bytes(text(300)) + bytes(text(25 * 1024)) + bytes(text(1000));
	const ownA = (100 * ownBytesA) / conversationOfA();
	const conversationOfB =
		bytes([{ type: "toolCall", name: "codemode", arguments: { code: "await spawn_child({ role: 'worker', task: 't' })" } }]) +
		bytes(text(200)) +
		bytes("r".repeat(1000)) +
		2 * bytes("budget");
	const ownB = (100 * bytes(text(200))) / conversationOfB;

	assert.equal(sessions, 2);
	assert.equal(metrics.ownResultShare.n, 2);
	assert.ok(Math.abs(metrics.ownResultShare.median - (ownA + ownB) / 2) < 1e-9);
	const pooledOwn = (100 * (ownBytesA + bytes(text(200)))) / (conversationOfA() + conversationOfB);
	assert.ok(Math.abs(metrics.ownResultShare.pooled - pooledOwn) < 1e-9);
	assert.deepEqual(metrics.largeCodemodeResults, { n: 2, median: 25, p90: 45, pooled: 100 / 3 });
	assert.deepEqual(metrics.launchesWithReferences, { n: 2, median: 25, p90: 45, pooled: 100 / 3 });
	const childA = bytes("r".repeat(400)) + bytes("q".repeat(100));
	const childB = bytes("r".repeat(1000));
	assert.equal(metrics.childMessageBytes.median, (childA + childB) / 2);
	assert.equal(metrics.childMessageBytes.p90, childA + 0.9 * (childB - childA));
	assert.equal(metrics.childMessageBytes.pooled, childA + childB);
	assert.deepEqual(metrics.explorationBudgetNotices, { n: 2, median: 1.5, p90: 1.9, pooled: 3 });
	assert.deepEqual(unparseable, { sessionFiles: 0, sessionLines: 0, auditFiles: 0 });
});

test("filters sessions by inclusive since and until dates", async (t) => {
	const dir = fixture(t);
	assert.equal((await report(dir, ["--since", "2026-11-02"])).sessions, 1);
	assert.equal((await report(dir, ["--until", "2026-11-04"])).sessions, 1);
	assert.equal((await report(dir, ["--since", "2026-11-01", "--until", "2026-11-05"])).sessions, 2);
	const late = await report(dir, ["--since", "2026-11-06"]);
	assert.equal(late.sessions, 0);
	assert.deepEqual(late.metrics.ownResultShare, { n: 0, median: null, p90: null, pooled: null });
});

test("prints a Markdown table by default", async (t) => {
	const dir = fixture(t);
	const output = await run(dir, ["--until", "2026-11-04"]);
	assert.match(output, /Delegating parent sessions: 1 \(since start, until 2026-11-04\)/);
	assert.match(output, /^\| Metric \| n \| Median \| p90 \| Pooled or total \|$/m);
	assert.match(output, /^\| Codemode results over 20 KB, % \| 1 \| 50 \| 50 \| 50 \|$/m);
	assert.match(output, /^\| spawn_child launches with references, % \| 1 \| 50 \| 50 \| 50 \|$/m);
	assert.match(output, /^\| Exploration budget notices \| 1 \| 1 \| 1 \| 1 \|$/m);
	assert.match(output, /Unparseable: 0 session files, 0 session lines, 0 audit files\./);
});

test("counts unparseable records instead of dropping them silently", async (t) => {
	const dir = fixture(t);
	writeSession(dir, "parent-c", "2026-11-02", ["{not json", call("spawn_child"), "also broken"]);
	writeFileSync(join(dir, "sessions", "--repo--", "headless.jsonl"), `${JSON.stringify(call("spawn_child"))}\n`);
	mkdirSync(join(dir, "pi-workflow-audit", "parent-b"), { recursive: true });
	writeFileSync(join(dir, "pi-workflow-audit", "parent-b", "torn.jsonl"), auditLine({ v: 1, ordinal: 0, part: 0 }, "{"));

	const { sessions, unparseable } = await report(dir);
	assert.equal(sessions, 3);
	assert.deepEqual(unparseable, { sessionFiles: 1, sessionLines: 2, auditFiles: 1 });
	assert.match(await run(dir), /Unparseable: 1 session files, 2 session lines, 1 audit files\./);
});
