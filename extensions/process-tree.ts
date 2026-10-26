import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const treeDeadline = 2_000;

const script = fileURLToPath(new URL("./process-tree.sh", import.meta.url));
const variable = "PI_WORKFLOW_PROCESS_TREE";
const groupsVariable = "PI_WORKFLOW_PROCESS_GROUPS";
// One watchdog per parent process, kept across /reload, so its lifetime pipe closes only when the parent dies.
const WATCHDOG = Symbol.for("pi-workflow:process-tree:watchdog");
const slots = globalThis as Record<symbol, Watchdog | undefined>;

type Watchdog = { token: string; groups: string };

function parentWatchdog() {
	const existing = slots[WATCHDOG];
	if (existing) return existing;
	const token = randomUUID();
	const groups = mkdtempSync(join(tmpdir(), "pi-workflow-process-groups-"));
	const watchdog = spawn("/bin/sh", [script, `${token}/`, String(treeDeadline), groups, "watch"], {
		stdio: ["pipe", "ignore", "ignore"],
		detached: true,
	});
	watchdog.on("error", () => {});
	watchdog.stdin.on("error", () => {});
	watchdog.unref();
	// Pi 1.4.0 runs on Bun, whose child stdin pipe has no unref.
	(watchdog.stdin as Partial<Socket>).unref?.();
	const created = { token, groups };
	slots[WATCHDOG] = created;
	return created;
}

export function treeEnvironment(id: string) {
	const { token, groups } = parentWatchdog();
	mkdirSync(join(groups, id), { recursive: true });
	return { [variable]: `${token}/${id}/`, [groupsVariable]: join(groups, id) };
}

function runScript(id: string, ...mode: string[]) {
	return new Promise<void>((resolve) => {
		const { token, groups } = parentWatchdog();
		const run = spawn("/bin/sh", [script, `${token}/${id}/`, String(treeDeadline), groups, ...mode], {
			stdio: "ignore",
		});
		run.once("error", () => resolve());
		run.once("close", () => resolve());
	});
}

// The child Pi leads its own group, and on macOS its environment is unreadable once it sets its title, so its pid
// seeds the record. The watchdog keeps recording every 500 ms there.
export function recordTree(id: string, pid?: number) {
	return runScript(id, "record", ...(pid === undefined ? [] : [String(pid)]));
}

export function stopTree(id: string) {
	return runScript(id);
}
