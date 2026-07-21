#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { validateAcceptanceEvidence } from "./acceptance-evidence.mjs";

const execFileAsync = promisify(execFile);

async function pack(root, destination) {
	const { stdout } = await execFileAsync(
		"npm",
		["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
		{ cwd: root },
	);
	const result = JSON.parse(stdout);
	if (!Array.isArray(result) || typeof result[0]?.filename !== "string") {
		throw new Error("npm pack did not report exactly one tarball");
	}
	return join(destination, result[0].filename);
}

async function main() {
	const suppliedIndex = process.argv.indexOf("--tarball");
	const supplied =
		suppliedIndex === -1 ? undefined : process.argv[suppliedIndex + 1];
	if (suppliedIndex !== -1 && !supplied)
		throw new Error("--tarball requires a path");
	const workspace = await mkdtemp(join(tmpdir(), "pi-workflow-acceptance-"));
	try {
		const tarball = supplied
			? resolve(supplied)
			: await pack(process.cwd(), workspace);
		const origin = supplied ? "supplied" : "created";
		const digest = createHash("sha256")
			.update(await readFile(tarball))
			.digest("hex");
		await execFileAsync(process.execPath, [
			resolve("scripts/validate-packed-distribution.mjs"),
			"--tarball",
			tarball,
		]);
		const extraction = join(workspace, "extract");
		await mkdir(extraction);
		await execFileAsync("tar", ["-xzf", tarball, "-C", extraction]);
		const extractedPackage = join(extraction, "package");
		await symlink(resolve("node_modules"), join(extractedPackage, "node_modules"), "dir");
		const { stdout } = await execFileAsync(process.execPath, [
			join(extractedPackage, "scripts", "run-packed-acceptance.mjs"),
			"--tarball-sha256",
			digest,
			"--tarball-origin",
			origin,
		]);
		const report = validateAcceptanceEvidence(JSON.parse(stdout), {
			digest,
			origin,
		});
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

main().catch((error) => {
	process.stderr.write(
		`pi-workflow acceptance failed:\n\n${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
