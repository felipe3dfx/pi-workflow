import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

export const treeDeadline = 2_000;

const script = fileURLToPath(new URL("./process-tree.sh", import.meta.url));
const variable = "PI_WORKFLOW_PROCESS_TREE";
// One watchdog per parent process, kept across /reload, so its lifetime pipe closes only when the parent dies.
const WATCHDOG = Symbol.for("pi-workflow:process-tree:token");
const slots = globalThis as Record<symbol, string | undefined>;

function parentToken() {
	const existing = slots[WATCHDOG];
	if (existing) return existing;
	const token = randomUUID();
	const watchdog = spawn("/bin/sh", [script, `${token}/`, String(treeDeadline), "watch"], {
		stdio: ["pipe", "ignore", "ignore"],
		detached: true,
	});
	watchdog.on("error", () => {});
	watchdog.stdin.on("error", () => {});
	watchdog.unref();
	// Pi 1.4.0 runs on Bun, whose child stdin pipe has no unref.
	(watchdog.stdin as Partial<Socket>).unref?.();
	slots[WATCHDOG] = token;
	return token;
}

export function treeEnvironment(id: string) {
	return { [variable]: `${parentToken()}/${id}/` };
}

export function stopTree(id: string) {
	return new Promise<void>((resolve) => {
		const sweep = spawn("/bin/sh", [script, `${parentToken()}/${id}/`, String(treeDeadline)], {
			stdio: "ignore",
		});
		sweep.once("error", () => resolve());
		sweep.once("close", () => resolve());
	});
}
