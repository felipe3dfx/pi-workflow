#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { createAgentAssetSync } from "../extensions/agent-asset-sync.ts";
import { createAgentAssetFilesystem } from "../extensions/agent-asset-filesystem.ts";
import {
	createEngramDecisionStore,
	createInteractiveDecisions,
} from "../extensions/interactive-decisions.ts";
import { createPiDecisionAdapter } from "../extensions/pi-decision-adapter.ts";
import { runSyncCommand } from "../extensions/pi-workflow-sync.ts";
import { createRuntimeEngramArtifactStore } from "../extensions/runtime-engram-store.ts";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const agentHome = resolve(
	process.env.PI_CODING_AGENT_DIR ??
		process.env.PI_AGENT_HOME ??
		resolve(process.env.HOME ?? homedir(), ".pi", "agent"),
);
const lockPath = resolve(agentHome, ".pi-workflow", "sync.lock");
let activeLock;
const durableFilesystem = createAgentAssetFilesystem({
	lockPath,
	allowedRoots: [agentHome],
	primitives: {
		async read(path) {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				if (error && typeof error === "object" && error.code === "ENOENT")
					return undefined;
				throw error;
			}
		},
		async open(path, flag) {
			const handle = await open(path, flag);
			return {
				write: (content) => handle.writeFile(content, "utf8"),
				sync: () => handle.sync(),
				close: () => handle.close(),
			};
		},
		rename: (from, to) =>
			import("node:fs/promises").then(({ rename }) => rename(from, to)),
		unlink: (path) =>
			import("node:fs/promises").then(({ unlink }) => unlink(path)),
		remove: (path) => rm(path, { force: true }),
		async syncDirectory(path) {
			const handle = await open(path, "r");
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
		},
		canonicalPath: realpath,
		digest: (content) =>
			content === undefined
				? null
				: createHash("sha256").update(content).digest("hex"),
		randomToken: randomUUID,
		owner: () => ({
			pid: process.pid,
			hostname: hostname(),
			startedAt: new Date().toISOString(),
		}),
	},
});
function refuseReceipt(path, receipt) {
	const error = new Error(
		`Durable mutation refused at ${path} (${receipt.mutation}/${receipt.durability})`,
	);
	error.mutation = receipt.mutation;
	error.durability = receipt.durability;
	throw error;
}
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
	async withMutation(operationId, run) {
		await mkdir(dirname(lockPath), { recursive: true });
		activeLock = await durableFilesystem.acquire(operationId);
		let operationResult;
		let operationError;
		try {
			operationResult = await run();
		} catch (error) {
			operationError = error;
		}
		const lock = activeLock;
		activeLock = undefined;
		try {
			await durableFilesystem.release(lock);
		} catch (releaseError) {
			if (operationError && typeof operationError === "object")
				operationError.releaseDiagnostic = `Cooperative lock release failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`;
			else {
				const error =
					releaseError instanceof Error
						? releaseError
						: new Error(String(releaseError));
				error.operationResult = operationResult;
				error.mutation = operationResult?.mutation ?? "none";
				error.durability = "uncertain";
				throw error;
			}
		}
		if (operationError) throw operationError;
		return operationResult;
	},
	async writeFileAtomic(path, content, expectedDigest) {
		if (!activeLock)
			throw new Error("Cooperative mutation boundary is not held");
		await mkdir(dirname(path), { recursive: true });
		const receipt = await durableFilesystem.writeFileDurableConditional(
			activeLock,
			path,
			content,
			expectedDigest,
		);
		if (receipt.status === "blocked") refuseReceipt(path, receipt);
	},
	async removeFileAtomic(path, expectedDigest) {
		if (!activeLock)
			throw new Error("Cooperative mutation boundary is not held");
		const receipt = await durableFilesystem.removeFileDurableConditional(
			activeLock,
			path,
			expectedDigest,
		);
		if (receipt.status === "blocked") refuseReceipt(path, receipt);
	},
};
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
const decisionAdapter = createPiDecisionAdapter();
const interactiveDecisions = createInteractiveDecisions({
	store: createEngramDecisionStore({
		store: createRuntimeEngramArtifactStore({
			directory: () => agentHome,
			sessionId: () => `pi-workflow-sync-${process.pid}`,
		}),
		project: "pi-workflow",
	}),
	claimSource: decisionAdapter.claimSource,
});
const localUser = userInfo();
const actor = {
	actorId: `local:${localUser.uid ?? localUser.username}@${hostname()}`,
	authorityRevision: "local-os/v1",
	active: true,
	guest: false,
};
let decisionSequence = 0;

async function decide(descriptor) {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		return {
			kind: "blocked",
			blocker: {
				code: "PI_WORKFLOW_DECISION_STORE_UNAVAILABLE",
				message:
					"Interactive sync decisions require a terminal; no files were changed.",
			},
		};
	let recovery = await interactiveDecisions.recover(
		descriptor.request.scope,
		actor,
	);
	if (recovery.kind === "active")
		recovery = await interactiveDecisions.recover(
			descriptor.request.scope,
			actor,
			{ kind: "resume", request: descriptor.request },
		);
	if (recovery.kind === "authorized") {
		if (
			JSON.stringify(recovery.lease.action) !==
			JSON.stringify(descriptor.action)
		)
			return {
				kind: "blocked",
				blocker: {
					code: "PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					message:
						"Recovered sync authority does not match the requested operation.",
				},
			};
		return {
			kind: "authorized",
			lease: recovery.lease,
			manifest: recovery.manifest,
		};
	}
	if (
		recovery.kind === "cancelled" ||
		recovery.kind === "superseded" ||
		recovery.kind === "terminal"
	)
		return {
			kind: "blocked",
			blocker: {
				code: "PI_WORKFLOW_DECISION_REPLAY",
				message: `Sync decision is already ${recovery.kind}.`,
			},
		};
	if (recovery.kind === "blocked")
		return { kind: "blocked", blocker: recovery.blocker };
	const presentation =
		recovery.kind === "reapproval" || recovery.kind === "drift"
			? recovery.presentation
			: await interactiveDecisions.prepare(descriptor.request);
	const claimBinding = await interactiveDecisions.claimBinding(
		presentation.decisionId,
	);
	if (!claimBinding)
		return {
			kind: "blocked",
			blocker: {
				code: "PI_WORKFLOW_DECISION_CLAIM_MISSING",
				message:
					"The sync decision could not establish a fresh presentation claim.",
			},
		};
	decisionSequence += 1;
	const correlation = {
		sessionId: `pi-workflow-sync-${process.pid}`,
		runId: randomUUID(),
		sequence: decisionSequence,
	};
	const prompt = decisionAdapter.present({
		...correlation,
		actor,
		claimBinding,
		presentation,
		capability: { hasUI: false, activeTools: [] },
	});
	process.stdout.write(`${prompt.text}\n`);
	const input = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		let answer;
		try {
			answer = await input.question("Selection: ");
		} catch (error) {
			if (controller.signal.aborted) return { kind: "cancelled" };
			throw error;
		}
		const claimed = decisionAdapter.handleFallbackResponse({
			...correlation,
			text: answer,
		});
		if (claimed !== "claimed")
			return claimed === "cancelled"
				? { kind: "cancelled" }
				: {
						kind: "blocked",
						blocker: {
							code: "PI_WORKFLOW_DECISION_CLAIM_MISSING",
							message:
								"The numbered response did not select a presented sync action.",
						},
					};
		const choice = presentation.choices[Number(answer.trim()) - 1];
		if (!choice)
			return {
				kind: "blocked",
				blocker: {
					code: "PI_WORKFLOW_DECISION_ACTION_MISMATCH",
					message: "The selected sync action is unavailable.",
				},
			};
		const authorization = await interactiveDecisions.authorize(
			presentation.decisionId,
			choice.actionId === descriptor.action.id
				? descriptor.action
				: { id: "decision.cancel", input: null },
			actor,
		);
		if (authorization.kind === "authorized") return authorization;
		if (authorization.kind === "cancelled") return { kind: "cancelled" };
		return { kind: "blocked", blocker: authorization.blocker };
	} finally {
		input.close();
		decisionAdapter.resetSession(correlation.sessionId);
	}
}

function writeCanceled() {
	process.stdout.write(
		`${JSON.stringify({ status: "canceled", mutation: "none", diagnostics: [] }, null, 2)}\n`,
	);
	process.exitCode = 130;
}

try {
	let catalog;
	let migrations;
	try {
		if (controller.signal.aborted) {
			writeCanceled();
		} else {
			const catalogContent = await readFile(
				new URL("../assets/agent-assets.json", import.meta.url),
				"utf8",
			);
			if (controller.signal.aborted) writeCanceled();
			else {
				catalog = JSON.parse(catalogContent);
				const migrationsContent = await readFile(
					new URL("../assets/agent-asset-migrations.json", import.meta.url),
					"utf8",
				);
				migrations = JSON.parse(migrationsContent).migrations;
			}
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
				migrations,
				filesystem,
				packageDirectory,
				agentDirectory: resolve(agentHome, "agents"),
				manifestPath: resolve(agentHome, ".pi-workflow", "agent-assets.json"),
				operationDirectory: resolve(
					agentHome,
					".pi-workflow",
					"sync-operations",
				),
				interactiveDecisions,
			}),
			write: (text) => process.stdout.write(`${text}\n`),
			decide,
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
