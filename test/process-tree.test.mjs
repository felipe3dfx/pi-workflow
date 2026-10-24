import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../extensions/process-tree.sh", import.meta.url));

async function sweepWithoutProc(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-sweep-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const sweep = join(dir, "process-tree.sh");
	await writeFile(sweep, readFileSync(script, "utf8").replace("/proc/self/environ", join(dir, "no-proc")));
	const bin = join(dir, "bin");
	await mkdir(bin);
	if (process.platform === "linux") {
		const ps = execFileSync("/bin/sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
		await writeFile(join(bin, "ps"), `#!/bin/sh\nexec ${ps} -A e -ww -o pid= -o command=\n`);
		await chmod(join(bin, "ps"), 0o755);
	}
	return { sweep, path: `${bin}${delimiter}${process.env.PATH}` };
}

test("the ps-based sweep kills the tree's members and ends without matching its own command line", async (t) => {
	const { sweep, path } = await sweepWithoutProc(t);
	const mark = `${randomUUID()}/`;
	const member = spawn("sleep", ["300"], {
		env: { ...process.env, PI_WORKFLOW_PROCESS_TREE: `${mark}child/` },
		stdio: "ignore",
	});
	t.after(() => member.kill("SIGKILL"));
	const exited = once(member, "exit");
	const started = Date.now();
	const swept = spawn("/bin/sh", [sweep, mark, "1000"], { env: { ...process.env, PATH: path }, stdio: "ignore" });
	const [code] = await once(swept, "close");
	assert.equal(code, 0);
	assert.ok(Date.now() - started < 1000, `the sweep took ${Date.now() - started} ms`);
	const [, signal] = await exited;
	assert.equal(signal, "SIGKILL");
});
