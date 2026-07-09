import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const guardPath = resolve("scripts/forbid-focused-tests.mjs");

async function createFixture(source) {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-focused-tests-"));
	await mkdir(join(root, "test"), { recursive: true });
	await writeFile(join(root, "test", "sample.test.mjs"), source, "utf8");
	return root;
}

async function runGuard(root) {
	try {
		const result = await execFileAsync(process.execPath, [guardPath], { cwd: root });
		return { code: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		return {
			code: error.code ?? 1,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	}
}

test("passes when test files do not contain focused markers", async () => {
	const root = await createFixture([
		'import test from "node:test";',
		'test("regular", () => {});',
		"",
	].join("\n"));
	try {
		const result = await runGuard(root);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /No focused tests found/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fails when test files contain Node focused markers", async () => {
	const focusedCalls = ["test", "describe", "suite"]
		.map((name) => `${name}.${["only"][0]}('focused', () => {});`)
		.join("\n");
	const root = await createFixture(focusedCalls);
	try {
		const result = await runGuard(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /Focused tests are not allowed/);
		assert.match(result.stderr, /test\.only\(/);
		assert.match(result.stderr, /describe\.only\(/);
		assert.match(result.stderr, /suite\.only\(/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
