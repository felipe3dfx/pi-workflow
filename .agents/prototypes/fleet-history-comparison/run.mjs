import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, cpus, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scratch = mkdtempSync(join(tmpdir(), "fleet-comparison-"));
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
process.env.PI_OFFLINE = "1";
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const executable = fileURLToPath(new URL("./case.mjs", import.meta.url));
const results = { environment: { node: process.version, platform: process.platform, release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, pi: "1.0.4" }, samples: [], recovery: [] };

async function run(mode, history, concurrency, crash) {
	const root = mkdtempSync(join(scratch, `${mode}-`));
	const child = spawn(process.execPath, [executable, mode, root, String(history), String(concurrency)], {
		env: { PATH: process.env.PATH, HOME: root, LANG: "C.UTF-8", PI_OFFLINE: "1", ...(crash ? { FLEET_CRASH: crash } : {}) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; });
	child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
	const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
	try {
		const exit = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) => resolve({ code, signal }));
		});
		if (!crash) {
			assert.equal(exit.code, 0, stderr);
			const sample = JSON.parse(stdout.trim());
			delete sample.cwd;
			return sample;
		}
		const checkpoint = JSON.parse(readFileSync(join(root, "checkpoint.json"), "utf8"));
		assert.equal(checkpoint.checkpoint, crash);
		const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
		assert.equal(manifest.state, "running");
		const entries = SessionManager.open(manifest.paths[0]).getEntries();
		const messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
		const assistants = messages.filter((message) => message.role === "assistant");
		assert.equal(assistants.length, crash === "stream" ? 0 : 1);
		const damaged = join(root, "damaged.jsonl");
		cpSync(manifest.paths[0], damaged);
		appendFileSync(damaged, '{"type":"message","id":"partial');
		const recovered = SessionManager.open(damaged).getEntries();
		assert.equal(recovered.length, entries.length);
		return { mode, checkpoint, exit, metadataState: manifest.state, projectedHistoryState: "interrupted", persistedRoles: messages.map((message) => message.role), assistantChars: assistants.flatMap((message) => message.content).reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0), malformedTrailingLineSkipped: true };
	} finally {
		clearTimeout(timer);
	}
}

try {
	for (const history of [0, 2000]) {
		for (let repeat = 0; repeat < 3; repeat++) {
			for (const mode of repeat % 2 ? ["rpc", "sdk"] : ["sdk", "rpc"]) {
				process.stderr.write(`Running ${mode} history=${history} repeat=${repeat}\n`);
				results.samples.push({ repeat, ...await run(mode, history, 4) });
			}
		}
	}
	for (const mode of ["sdk", "rpc"]) {
		for (const checkpoint of ["stream", "settled"]) results.recovery.push(await run(mode, 0, 1, checkpoint));
	}
	process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
