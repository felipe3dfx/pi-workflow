import {
	chmodSync,
	existsSync,
	linkSync,
	mkdirSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function piAgentHome(): string {
	return process.env.PI_AGENT_HOME
		? resolve(process.env.PI_AGENT_HOME)
		: resolve(process.env.HOME ?? homedir(), ".pi", "agent");
}

export function resolveAgentDirectory(directory?: string): string {
	if (directory) return resolve(directory);
	return process.env.PI_CODING_AGENT_DIR
		? resolve(process.env.PI_CODING_AGENT_DIR)
		: piAgentHome();
}

export function writeJsonAtomically(
	path: string,
	value: Record<string, unknown>,
	{ replace = true } = {},
) {
	const existing = replace && existsSync(path);
	const target = existing ? realpathSync(path) : path;
	const mode = existing ? statSync(target).mode & 0o777 : undefined;
	const directory = dirname(target);
	mkdirSync(directory, { recursive: true });
	// ponytail: pid+timestamp assumes a single synchronous writer per process;
	// concurrent writers in the same process could collide on this name.
	const temporaryPath = `${target}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
			encoding: "utf8",
			mode,
		});
		if (mode !== undefined) chmodSync(temporaryPath, mode);
		if (replace) renameSync(temporaryPath, target);
		else linkSync(temporaryPath, path);
	} catch (error) {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// ignore cleanup failures; an orphaned "<path>.<pid>.<timestamp>.tmp"
			// file may remain on disk if this unlink also fails
		}
		throw error;
	}
	if (!replace) unlinkSync(temporaryPath);
}
