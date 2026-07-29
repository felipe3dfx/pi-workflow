import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runPackedSubprocess } from "./support/packed-subprocess.mjs";
import {
	createSandboxPlan,
	parseSandboxArguments,
} from "../tools/pi-sandbox.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

test("disposable Pi owns config, sessions, home, package loading, and startup networking", () => {
	const parsed = parseSandboxArguments([
		"--keep",
		"--",
		"--mode",
		"rpc",
		"--no-session",
	]);
	assert.deepEqual(parsed, {
		keep: true,
		dryRun: false,
		piArguments: ["--mode", "rpc", "--no-session"],
	});
	const plan = createSandboxPlan({
		root,
		sandboxRoot: "/tmp/pi-workflow-sandbox-test",
		piArguments: parsed.piArguments,
		environment: {
			HOME: "/home/current",
			PI_CODING_AGENT_DIR: "/home/current/.pi/agent",
			PI_PACKAGE_DIR: "/home/current/.local/share/pi",
			PI_TELEMETRY: "1",
		},
	});
	assert.equal(plan.executable, join(root, "node_modules", ".bin", "pi"));
	assert.deepEqual(plan.arguments, [
		"-e",
		root,
		"--approve",
		"--mode",
		"rpc",
		"--no-session",
	]);
	assert.equal(plan.environment.HOME, "/tmp/pi-workflow-sandbox-test/home");
	assert.equal(
		plan.environment.PI_CODING_AGENT_DIR,
		"/tmp/pi-workflow-sandbox-test/agent",
	);
	assert.equal(
		plan.environment.PI_CODING_AGENT_SESSION_DIR,
		"/tmp/pi-workflow-sandbox-test/sessions",
	);
	assert.equal(
		plan.environment.PI_AGENT_HOME,
		"/tmp/pi-workflow-sandbox-test/agent",
	);
	assert.equal(plan.environment.PI_OFFLINE, "1");
	assert.equal(plan.environment.PI_SKIP_VERSION_CHECK, "1");
	assert.equal(plan.environment.PI_TELEMETRY, "0");
	assert.equal(plan.environment.PI_PACKAGE_DIR, undefined);
});

test("disposable Pi rejects arguments that can escape launcher-owned resource isolation", () => {
	for (const argument of [
		"--session-dir=/home/current/.pi/agent/sessions",
		"--mcp-config=/home/current/.pi/agent/mcp.json",
		"-e",
		"--extension",
		"--session-dir",
		"--session",
		"--fork",
		"--export",
		"--skill",
		"--prompt-template",
		"--theme",
		"--mcp-config",
		"--approve",
		"--no-approve",
	]) {
		assert.throws(
			() => parseSandboxArguments(["--", argument, "value"]),
			/new resource, session, export, or trust controls are not allowed/i,
		);
	}
});

test("dry-run reports the isolated local executable and removes its temporary sandbox", async () => {
	const { stdout } = await runPackedSubprocess(
		process.execPath,
		[join(root, "tools", "pi-sandbox.mjs"), "--dry-run", "--", "--version"],
		{ cwd: root },
	);
	const report = JSON.parse(stdout);
	assert.equal(report.executable, join(root, "node_modules", ".bin", "pi"));
	assert.deepEqual(report.arguments, ["-e", root, "--approve", "--version"]);
	assert.match(report.sandboxRoot, /^\/tmp\/pi-workflow-sandbox-/);
	await assert.rejects(() => access(report.sandboxRoot));
});

test("keep preserves only the disposable sandbox selected by the launcher", async () => {
	const { stderr } = await runPackedSubprocess(
		process.execPath,
		[join(root, "tools", "pi-sandbox.mjs"), "--keep", "--", "--version"],
		{ cwd: root },
	);
	const sandboxRoot = stderr.match(
		/Preserved disposable Pi sandbox: (.+)/,
	)?.[1];
	assert.ok(sandboxRoot);
	await access(join(sandboxRoot, "agent"));
	await rm(sandboxRoot, { recursive: true, force: true });
});

test("real launcher uses the project-local pinned Pi and cleans up after exit", async () => {
	const { stdout, stderr } = await runPackedSubprocess(
		process.execPath,
		[join(root, "tools", "pi-sandbox.mjs"), "--", "--version"],
		{ cwd: root },
	);
	assert.match(stdout, /0\.80\.6/);
	const sandboxRoot = stderr.match(/Disposable Pi sandbox: (.+)/)?.[1];
	assert.ok(sandboxRoot);
	await assert.rejects(() =>
		readFile(join(sandboxRoot, "agent", "settings.json")),
	);
	await assert.rejects(() => access(sandboxRoot));
});
