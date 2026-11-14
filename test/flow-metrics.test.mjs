import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { withAgentDirectory } from "./support/agent-directory.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("scripts/flow-metrics.mjs");

function sized(bytes) {
	return [{ type: "text", text: "x".repeat(bytes - 27) }];
}

function chars(bytes) {
	return "r".repeat(bytes - 2);
}

function call(name, args = {}) {
	return {
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", name, arguments: args }],
		},
	};
}

function result(toolName, content) {
	return {
		type: "message",
		message: { role: "toolResult", toolName, content },
	};
}

function custom(customType, content) {
	return { type: "custom_message", customType, content };
}

function notices(count) {
	return Array.from({ length: count }, () =>
		custom("pi-workflow-exploration-budget", "budget"),
	);
}

function writeSession(dir, id, date, entries) {
	const folder = join(dir, "sessions", "--repo--");
	mkdirSync(folder, { recursive: true });
	const lines = [
		{ type: "session", id, timestamp: `${date}T10:00:00.000Z` },
		...entries,
	].map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
	writeFileSync(join(folder, `${date}_${id}.jsonl`), `${lines.join("\n")}\n`);
}

function auditLine(header, payload) {
	return `00000000\t${JSON.stringify(header)}\t${payload}`;
}

function writeAudit(dir, parent, child, launch, split = false) {
	const folder = join(dir, "pi-workflow-audit", parent);
	mkdirSync(folder, { recursive: true });
	const payload = JSON.stringify({
		child,
		role: "explore",
		task: "t",
		...launch,
	});
	const middle = Math.floor(payload.length / 2);
	const lines = split
		? [
				auditLine(
					{ v: 1, ordinal: 0, part: 0, meta: { child } },
					payload.slice(0, middle),
				),
				auditLine(
					{ v: 1, ordinal: 0, part: 1, parts: 2 },
					payload.slice(middle),
				),
			]
		: [auditLine({ v: 1, ordinal: 0, part: 0, parts: 1 }, payload)];
	lines.push(
		auditLine(
			{ v: 1, ordinal: 1, part: 0, parts: 1 },
			JSON.stringify({ kind: "execution", state: "completed" }),
		),
	);
	writeFileSync(join(folder, `${child}.jsonl`), `${lines.join("\n")}\n`);
}

async function runScript(args, env = process.env) {
	const { stdout } = await execFileAsync(
		process.execPath,
		[scriptPath, ...args],
		{ env },
	);
	return stdout;
}

async function run(dir, args = []) {
	return runScript([
		"--sessions",
		join(dir, "sessions"),
		"--audit",
		join(dir, "pi-workflow-audit"),
		...args,
	]);
}

async function report(dir, args = []) {
	return JSON.parse(await run(dir, [...args, "--json"]));
}

async function failure(args, env = process.env) {
	try {
		await runScript(args, env);
	} catch (error) {
		return { code: error.code, stderr: error.stderr };
	}
	assert.fail("The script exited with code 0.");
}

function isolatedEnv(overrides) {
	const env = { ...process.env, ...overrides };
	for (const name of ["PI_CODING_AGENT_DIR", "PI_AGENT_HOME"]) {
		if (!(name in overrides)) delete env[name];
	}
	return env;
}

function assertSummary(actual, expected) {
	assert.equal(actual.n, expected.n);
	for (const key of ["median", "p90", "pooled"]) {
		assert.ok(
			Math.abs(actual[key] - expected[key]) < 1e-9,
			`${key}: ${actual[key]} is not ${expected[key]}`,
		);
	}
}

function fixture(dir) {
	const user = {
		type: "message",
		message: { role: "user", content: sized(100) },
	};
	writeSession(dir, "parent-a", "2026-11-01", [
		user,
		call("spawn_child"),
		...[
			"spawn_child",
			"continue_child",
			"reply_child",
			"child_status",
			"list_children",
			"cancel_child",
		].map((tool) => result(tool, sized(50))),
		result("child_result", sized(100)),
		{ type: "message", message: { role: "system", content: sized(500) } },
		result("read", sized(300)),
		result("codemode", sized(20480)),
		result("codemode", sized(20481)),
		custom("pi-workflow-child-result", chars(400)),
		custom("pi-workflow-child-question", chars(100)),
		...notices(1),
	]);
	writeSession(dir, "parent-b", "2026-11-05", [
		call("codemode", { code: "await spawn_child()" }),
		result("codemode", sized(200)),
		custom("pi-workflow-child-result", chars(1000)),
		...notices(2),
	]);
	writeSession(dir, "parent-c", "2026-11-03", [
		call("spawn_child"),
		result("codemode", sized(20481)),
		result("codemode", sized(20481)),
		result("codemode", sized(20481)),
		result("codemode", sized(1000)),
		custom("pi-workflow-child-result", chars(3000)),
		...notices(6),
	]);
	writeSession(dir, "parent-e", "2026-11-04", [
		user,
		call("spawn_child"),
		result("read", sized(243)),
	]);
	writeSession(dir, "solo", "2026-11-02", [
		user,
		call("codemode", { code: "await read('a')" }),
		result("codemode", sized(5000)),
	]);
	writeAudit(dir, "parent-a", "c1", { references: ["AGENTS.md"] }, true);
	writeAudit(dir, "parent-a", "c2", { references: [] });
	writeAudit(dir, "parent-a", "c3", { references: [], continuedFrom: "c2" });
	writeAudit(dir, "parent-b", "c4", { references: [] });
	for (const child of ["c5", "c6", "c7", "c8"])
		writeAudit(dir, "parent-c", child, { references: ["AGENTS.md"] });
	writeAudit(dir, "parent-c", "c9", { references: [] });
	writeAudit(dir, "ghost", "c10", { references: [] });
	return dir;
}

test("reports every metric for delegating parent sessions only", async (t) => {
	const dir = fixture(withAgentDirectory(t));
	const { sessions, metrics, delegatingSessionsWithoutAudit, allFiles } =
		await report(dir);

	assert.equal(sessions, 4);
	const ownA = (100 * 41261) / 42326;
	const ownC = (100 * 62443) / 65548;
	assertSummary(metrics.ownResultShare, {
		n: 4,
		median: (60.75 + ownC) / 2,
		p90: ownC + 0.7 * (ownA - ownC),
		pooled: (100 * 104147) / 109572,
	});
	assertSummary(metrics.largeCodemodeResults, {
		n: 3,
		median: 50,
		p90: 70,
		pooled: 400 / 7,
	});
	assertSummary(metrics.launchesWithReferences, {
		n: 3,
		median: 50,
		p90: 74,
		pooled: 62.5,
	});
	assertSummary(metrics.childMessageBytes, {
		n: 4,
		median: 800,
		p90: 2400,
		pooled: 4600,
	});
	assertSummary(metrics.explorationBudgetNotices, {
		n: 4,
		median: 1.5,
		p90: 4.8,
		pooled: 9,
	});
	assert.equal(delegatingSessionsWithoutAudit, 1);
	assert.deepEqual(allFiles, {
		auditGroupsWithoutSession: 1,
		unparseableSessionFiles: 0,
		unparseableSessionLines: 0,
		unparseableAuditFiles: 0,
	});
});

test("filters sessions by inclusive since and until dates", async (t) => {
	const dir = fixture(withAgentDirectory(t));
	assert.equal((await report(dir, ["--since", "2026-11-02"])).sessions, 3);
	assert.equal((await report(dir, ["--until", "2026-11-04"])).sessions, 3);
	assert.equal(
		(await report(dir, ["--since", "2026-11-03", "--until", "2026-11-04"]))
			.sessions,
		2,
	);
	const late = await report(dir, ["--since", "2026-11-06"]);
	assert.equal(late.sessions, 0);
	assert.equal(late.delegatingSessionsWithoutAudit, 0);
	assert.deepEqual(late.metrics.ownResultShare, {
		n: 0,
		median: null,
		p90: null,
		pooled: null,
	});
});

test("prints a Markdown table by default", async (t) => {
	const dir = fixture(withAgentDirectory(t));
	const output = await run(dir);
	assert.match(
		output,
		/^Delegating parent sessions: 4 \(since start, until now\)$/m,
	);
	assert.match(
		output,
		/^\| Metric \| n \| Median \| p90 \| Pooled or total \|$/m,
	);
	assert.match(
		output,
		/^\| Own tool results, % of conversation bytes \| 4 \| 78\.0 \| 96\.8 \| 95\.0 \|$/m,
	);
	assert.match(
		output,
		/^\| Codemode results over 20 KiB, % \| 3 \| 50 \| 70(\.0)? \| 57\.1 \|$/m,
	);
	assert.match(
		output,
		/^\| spawn_child launches with references, % \| 3 \| 50 \| 74(\.0)? \| 62\.5 \|$/m,
	);
	assert.match(
		output,
		/^\| Child message bytes delivered \| 4 \| 800 \| 2400(\.0)? \| 4600 \|$/m,
	);
	assert.match(
		output,
		/^\| Exploration budget notices \| 4 \| 1\.5 \| 4\.8 \| 9 \|$/m,
	);
	assert.match(output, /^Delegating sessions without audit records: 1\.$/m);
	assert.match(
		output,
		/^All files, not date-filtered: 1 audit groups without a parent session; unparseable 0 session files, 0 session lines, 0 audit files\.$/m,
	);
	assert.match(
		await run(dir, ["--since", "2026-11-02"]),
		/^Delegating parent sessions: 3 \(since 2026-11-02, until now\)$/m,
	);
});

test("counts unparseable and unreadable records instead of dropping them silently", async (t) => {
	const dir = fixture(withAgentDirectory(t));
	writeSession(dir, "parent-x", "2026-11-02", [
		"{not json",
		call("spawn_child"),
		"also broken",
	]);
	writeFileSync(
		join(dir, "sessions", "--repo--", "headless.jsonl"),
		`${JSON.stringify(call("spawn_child"))}\n`,
	);
	mkdirSync(join(dir, "sessions", "--repo--", "unreadable.jsonl"));
	writeFileSync(
		join(dir, "pi-workflow-audit", "parent-b", "torn.jsonl"),
		auditLine({ v: 1, ordinal: 0, part: 0 }, "{"),
	);
	mkdirSync(join(dir, "pi-workflow-audit", "parent-b", "unreadable.jsonl"));

	const expected = {
		auditGroupsWithoutSession: 1,
		unparseableSessionFiles: 2,
		unparseableSessionLines: 2,
		unparseableAuditFiles: 2,
	};
	const { sessions, allFiles } = await report(dir);
	assert.equal(sessions, 5);
	assert.deepEqual(allFiles, expected);
	assert.deepEqual(
		(await report(dir, ["--since", "2026-11-06"])).allFiles,
		expected,
	);
	assert.match(
		await run(dir),
		/unparseable 2 session files, 2 session lines, 2 audit files\./,
	);
});

test("reads the agent directory from the environment by default", async (t) => {
	const home = withAgentDirectory(t);
	fixture(join(home, ".pi", "agent"));
	const fromHome = JSON.parse(
		await runScript(["--json"], isolatedEnv({ HOME: home })),
	);
	assert.equal(fromHome.sessions, 4);

	const agent = fixture(withAgentDirectory(t));
	const fromEnv = JSON.parse(
		await runScript(
			["--json"],
			isolatedEnv({ HOME: home, PI_CODING_AGENT_DIR: agent }),
		),
	);
	assert.equal(fromEnv.sessions, 4);
	assert.equal(fromEnv.allFiles.auditGroupsWithoutSession, 1);
});

test("fails with one clear line when a source directory is missing", async (t) => {
	const dir = fixture(withAgentDirectory(t));
	const missing = join(dir, "missing");
	const sessions = await failure([
		"--sessions",
		missing,
		"--audit",
		join(dir, "pi-workflow-audit"),
	]);
	assert.equal(sessions.code, 1);
	assert.equal(sessions.stderr, `Sessions directory not found: ${missing}\n`);
	const audit = await failure([
		"--sessions",
		join(dir, "sessions"),
		"--audit",
		missing,
	]);
	assert.equal(audit.code, 1);
	assert.equal(audit.stderr, `Audit directory not found: ${missing}\n`);

	const empty = withAgentDirectory(t);
	const byDefault = await failure(
		[],
		isolatedEnv({ HOME: empty, PI_CODING_AGENT_DIR: empty }),
	);
	assert.equal(byDefault.code, 1);
	assert.match(byDefault.stderr, /^Sessions directory not found: .+\n$/);
});

test("rejects impossible or reversed dates and documents the UTC session start", async (t) => {
	const dir = fixture(withAgentDirectory(t));
	const paths = [
		"--sessions",
		join(dir, "sessions"),
		"--audit",
		join(dir, "pi-workflow-audit"),
	];
	for (const date of ["2026-1-1", "2026-02-30", "2026-99-99"]) {
		const rejected = await failure([...paths, "--since", date]);
		assert.equal(rejected.code, 1);
		assert.equal(
			rejected.stderr,
			"--since must be a real date in YYYY-MM-DD form.\n",
		);
	}
	const reversed = await failure([
		...paths,
		"--since",
		"2026-11-05",
		"--until",
		"2026-11-01",
	]);
	assert.equal(reversed.code, 1);
	assert.equal(reversed.stderr, "--since must not be after --until.\n");
	assert.match(await runScript(["--help"]), /UTC date of each session's start/);
});
