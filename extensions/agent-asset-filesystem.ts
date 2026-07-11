import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type FilesystemMutationReceipt = {
	status: "applied" | "blocked";
	mutation: "applied" | "none";
	durability: "durable" | "uncertain";
};

interface AgentAssetFileHandle {
	write(content: string): Promise<void>;
	sync(): Promise<void>;
	close(): Promise<void>;
}

export interface AgentAssetFilesystemPrimitives {
	read(path: string): Promise<string | undefined>;
	open(path: string, flag: "wx"): Promise<AgentAssetFileHandle>;
	rename(from: string, to: string): Promise<void>;
	unlink(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	syncDirectory(path: string): Promise<void>;
	canonicalPath?(path: string): Promise<string>;
	digest(content: string | undefined): string | null;
	randomToken(): string;
	owner(): { pid: number; hostname: string; startedAt: string };
}

export interface AgentAssetLock {
	token: string;
	path: string;
}

function receipt(
	status: FilesystemMutationReceipt["status"],
	mutation: FilesystemMutationReceipt["mutation"],
	durability: FilesystemMutationReceipt["durability"],
): FilesystemMutationReceipt {
	return { status, mutation, durability };
}

export function createAgentAssetFilesystem({
	lockPath,
	primitives,
	allowedRoots = [],
}: {
	lockPath: string;
	primitives: AgentAssetFilesystemPrimitives;
	allowedRoots?: string[];
}) {
	function contained(root: string, path: string): boolean {
		const segment = relative(resolve(root), resolve(path));
		return segment === "" || (!segment.startsWith("..") && !isAbsolute(segment));
	}
	async function authorized(path: string): Promise<boolean> {
		if (allowedRoots.length === 0) return true;
		if (!primitives.canonicalPath || !allowedRoots.some((root) => contained(root, path)))
			return false;
		try {
			const parent = await primitives.canonicalPath(dirname(path));
			for (const root of allowedRoots) {
				const canonicalRoot = await primitives.canonicalPath(root);
				if (contained(canonicalRoot, parent)) return true;
			}
		} catch {}
		return false;
	}
	async function owns(lock: AgentAssetLock): Promise<boolean> {
		if (lock.path !== lockPath) return false;
		try {
			return (
				JSON.parse((await primitives.read(lockPath)) ?? "").token === lock.token
			);
		} catch {
			return false;
		}
	}
	async function acquire(operationId: string): Promise<AgentAssetLock> {
		if (!(await authorized(lockPath)))
			throw new Error(`Cooperative mutation lock is unavailable at ${lockPath}`);
		const token = primitives.randomToken();
		let handle: AgentAssetFileHandle | undefined;
		let published = false;
		try {
			handle = await primitives.open(lockPath, "wx");
			published = true;
			await handle.write(
				JSON.stringify({ token, operationId, ...primitives.owner() }),
			);
			await handle.sync();
			await handle.close();
			await primitives.syncDirectory(dirname(lockPath));
			return { token, path: lockPath };
		} catch {
			let cleanupFailed = false;
			try {
				await handle?.close();
				if (published) {
					await primitives.remove(lockPath);
					await primitives.syncDirectory(dirname(lockPath));
				}
			} catch {
				cleanupFailed = true;
			}
			const error = new Error(
				`Cooperative mutation lock is unavailable at ${lockPath}`,
			);
			if (cleanupFailed)
				Object.assign(error, { mutation: "applied", durability: "uncertain" });
			throw error;
		}
	}
	async function release(lock: AgentAssetLock): Promise<void> {
		if (!(await authorized(lockPath))) throw new Error("Lock path is not authorized");
		if (!(await owns(lock))) throw new Error("Lock owner token does not match");
		await primitives.unlink(lockPath);
		await primitives.syncDirectory(dirname(lockPath));
	}
	async function writeFileDurableConditional(
		lock: AgentAssetLock,
		path: string,
		content: string,
		expectedDigest: string | null,
	): Promise<FilesystemMutationReceipt> {
		if (!(await authorized(path)) || !(await owns(lock)))
			return receipt("blocked", "none", "durable");
		if (expectedDigest === null) {
			let handle: AgentAssetFileHandle | undefined;
			let published = false;
			try {
				handle = await primitives.open(path, "wx");
				published = true;
				await handle.write(content);
				await handle.sync();
				await handle.close();
				await primitives.syncDirectory(dirname(path));
				return receipt("applied", "applied", "durable");
			} catch {
				let cleanupFailed = false;
				try {
					await handle?.close();
					if (published) {
						await primitives.remove(path);
						await primitives.syncDirectory(dirname(path));
					}
				} catch {
					cleanupFailed = true;
				}
				return cleanupFailed
					? receipt("blocked", "applied", "uncertain")
					: receipt("blocked", "none", "durable");
			}
		}
		const temporaryPath = join(
			dirname(path),
			`.${basename(path)}.${lock.token}.tmp`,
		);
		let published = false;
		try {
			const handle = await primitives.open(temporaryPath, "wx");
			await handle.write(content);
			await handle.sync();
			await handle.close();
			if (primitives.digest(await primitives.read(path)) !== expectedDigest)
				return receipt("blocked", "none", "durable");
			await primitives.rename(temporaryPath, path);
			published = true;
			try {
				await primitives.syncDirectory(dirname(path));
				return receipt("applied", "applied", "durable");
			} catch {
				return receipt("blocked", "applied", "uncertain");
			}
		} catch {
			return receipt("blocked", "none", "durable");
		} finally {
			if (!published)
				try {
					await primitives.remove(temporaryPath);
				} catch {}
		}
	}
	async function removeFileDurableConditional(
		lock: AgentAssetLock,
		path: string,
		expectedDigest: string,
	): Promise<FilesystemMutationReceipt> {
		if (
			!(await authorized(path)) ||
			!(await owns(lock)) ||
			primitives.digest(await primitives.read(path)) !== expectedDigest
		)
			return receipt("blocked", "none", "durable");
		try {
			await primitives.unlink(path);
		} catch {
			return receipt("blocked", "none", "durable");
		}
		try {
			await primitives.syncDirectory(dirname(path));
			return receipt("applied", "applied", "durable");
		} catch {
			return receipt("blocked", "applied", "uncertain");
		}
	}
	return {
		acquire,
		release,
		writeFileDurableConditional,
		removeFileDurableConditional,
	};
}
