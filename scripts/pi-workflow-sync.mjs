#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { createAgentAssetSync } from "../extensions/agent-asset-sync.ts";
import { runSyncCommand } from "../extensions/pi-workflow-sync.ts";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const agentHome = resolve(
	process.env.PI_CODING_AGENT_DIR ??
		process.env.PI_AGENT_HOME ??
		resolve(process.env.HOME ?? homedir(), ".pi", "agent"),
);
const filesystem = {
	async readFile(path) {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			if (error && typeof error === "object" && error.code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	},
	async writeFileAtomic(path, content, expectedDigest) {
		await mkdir(dirname(path), { recursive: true });
		const temporaryPath = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
			let current;
			try {
				current = await readFile(path, "utf8");
			} catch (error) {
				if (!error || typeof error !== "object" || error.code !== "ENOENT")
					throw error;
			}
			const currentDigest =
				current === undefined
					? null
					: createHash("sha256").update(current).digest("hex");
			if (currentDigest !== expectedDigest)
				throw new Error(`Concurrent change detected at ${path}`);
			await rename(temporaryPath, path);
		} finally {
			await rm(temporaryPath, { force: true });
		}
	},
};
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());

function writeCanceled() {
	process.stdout.write(
		`${JSON.stringify({ status: "canceled", mutation: "none", diagnostics: [] }, null, 2)}\n`,
	);
	process.exitCode = 130;
}

try {
	let catalog;
	try {
		if (controller.signal.aborted) {
			writeCanceled();
		} else {
			const catalogContent = await readFile(
				new URL("../assets/agent-assets.json", import.meta.url),
				"utf8",
			);
			if (controller.signal.aborted) writeCanceled();
			else catalog = JSON.parse(catalogContent);
		}
	} catch (error) {
		const result = {
			status: "blocked",
			mutation: "none",
			diagnostics: [
				`Unable to read or parse the packaged agent catalog: ${error instanceof Error ? error.message : String(error)}. Reinstall @felipe.3dfx/pi-workflow and retry; no files were changed.`,
			],
		};
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		process.exitCode = 1;
	}
	if (catalog !== undefined)
		process.exitCode = await runSyncCommand(process.argv.slice(2), {
			sync: createAgentAssetSync({
				catalog,
				filesystem,
				packageDirectory,
				agentDirectory: resolve(agentHome, "agents"),
				manifestPath: resolve(agentHome, ".pi-workflow", "agent-assets.json"),
			}),
			write: (text) => process.stdout.write(`${text}\n`),
			confirm: async (plan) => {
				if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
				const prompt = createInterface({
					input: process.stdin,
					output: process.stdout,
				});
				try {
					const answer = await prompt.question(
						`Apply ${plan.actions.length} package-owned agent asset change(s) from plan ${plan.digest}? [y/N] `,
					);
					return answer.trim().toLowerCase() === "y";
				} finally {
					prompt.close();
				}
			},
			signal: controller.signal,
		});
} catch (error) {
	process.stdout.write(
		`${JSON.stringify(
			{
				status: "blocked",
				mutation: "none",
				diagnostics: [
					`Unable to start pi-workflow-sync: ${error instanceof Error ? error.message : String(error)}. Resolve the error and retry; no files were changed.`,
				],
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = 1;
}
