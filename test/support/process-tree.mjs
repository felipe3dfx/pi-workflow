import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { eventually } from "./eventually.mjs";

export function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function descendants(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-tree-"));
	const file = join(dir, "pids");
	process.env.FAKE_PI_TREE = file;
	t.after(async () => {
		delete process.env.FAKE_PI_TREE;
		await rm(dir, { recursive: true, force: true });
	});
	return () =>
		eventually(
			() => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(Number) : []),
			(pids) => pids.length === 3,
		);
}

const parentScript = fileURLToPath(new URL("./child-parent.mjs", import.meta.url));

export async function parent(t, launch) {
	const { ending } = launch;
	const child = spawn(process.execPath, [parentScript, JSON.stringify(launch)], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	t.after(() => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	});
	const exited = new Promise((resolve) => child.once("exit", () => resolve(Date.now())));
	let output = "";
	child.stdout.setEncoding("utf8");
	await new Promise((resolve, reject) => {
		child.stdout.on("data", (chunk) => {
			output += chunk;
			if (output.includes("\n")) resolve();
		});
		child.once("exit", (code) => reject(new Error(`The parent exited with ${code} before its child answered.`)));
	});
	const end = () => (ending === "SIGKILL" ? child.kill("SIGKILL") : child.stdin.write("exit\n"));
	return { answer: output.trim(), end, exited };
}

export async function gone(pids, since) {
	await eventually(() => pids.filter(alive), (left) => left.length === 0);
	return Date.now() - since;
}
