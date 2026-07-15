import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
	unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";

import { createAgentAssetFilesystem } from "./agent-asset-filesystem.ts";
import type { DelegationCheckpointPersistence } from "./delegation-checkpoints.ts";

export function createRuntimePrivateStatePersistence(
	root: string,
): DelegationCheckpointPersistence {
	const privateRoot = resolve(root);
	const lockPath = resolve(privateRoot, "mutation.lock");
	const durableFilesystem = createAgentAssetFilesystem({
		lockPath,
		allowedRoots: [privateRoot],
		primitives: {
			async read(path) {
				try {
					return await readFile(path, "utf8");
				} catch (error) {
					if (
						error &&
						typeof error === "object" &&
						(error as { code?: unknown }).code === "ENOENT"
					) {
						return undefined;
					}
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
			rename,
			unlink,
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

	return {
		capabilities: { atomicCompareAndSwap: true },
		async readFile(path) {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				if (
					error &&
					typeof error === "object" &&
					(error as { code?: unknown }).code === "ENOENT"
				) {
					return undefined;
				}
				throw error;
			}
		},
		async withMutation(operationId, run) {
			await mkdir(privateRoot, { recursive: true });
			const lock = await durableFilesystem.acquire(operationId);
			try {
				return await run();
			} finally {
				await durableFilesystem.release(lock);
			}
		},
		async writeFileAtomic(path, content, expectedDigest) {
			await mkdir(dirname(path), { recursive: true });
			const lockContent = await readFile(lockPath, "utf8");
			const lock = {
				token: (JSON.parse(lockContent) as { token: string }).token,
				path: lockPath,
			};
			const receipt = await durableFilesystem.writeFileDurableConditional(
				lock,
				path,
				content,
				expectedDigest,
			);
			if (receipt.status !== "applied" || receipt.durability !== "durable") {
				const error = new Error(
					`Durable private-state write was refused (${receipt.mutation}/${receipt.durability}).`,
				);
				Object.assign(error, {
					mutation: receipt.mutation,
					durability: receipt.durability,
				});
				throw error;
			}
		},
	};
}
