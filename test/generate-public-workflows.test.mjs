import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");

test("generated public workflow resources fail closed when an asset drifts", async () => {
	const fixture = await mkdtemp(join(tmpdir(), "pi-workflow-generation-"));
	try {
		await cp(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
		await cp(join(root, "skills"), join(fixture, "skills"), { recursive: true });
		await cp(join(root, "prompts"), join(fixture, "prompts"), { recursive: true });
		await writeFile(join(fixture, "prompts", "qa-handoff.md"), "drifted\n");
		await assert.rejects(
			execFileAsync(process.execPath, ["scripts/generate-public-workflows.mjs", "--check"], {
				cwd: fixture,
			}),
			(error) => {
				assert.match(error.stderr, /generated public workflow resource is stale: prompts\/qa-handoff\.md/);
				return true;
			},
		);
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
});
