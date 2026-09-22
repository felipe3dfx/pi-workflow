#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const required = [
	"package.json",
	"README.md",
	"LICENSE",
	"extensions/pi-workflow.ts",
	"extensions/companion-workflow.ts",
	"extensions/mcp-config.ts",
	"assets/companions.json",
	"assets/mcp-servers.json",
	"tools/pi-sandbox.mjs",
];
const forbiddenPrefixes = ["skills/", "prompts/", "assets/agents/", "assets/acceptance/"];
const forbiddenFiles = [
	"extensions/define-product-workflow.ts",
	"extensions/qa-handoff-workflow.ts",
	"extensions/interactive-decisions.ts",
	"scripts/pi-workflow-sync.mjs",
];

async function filesUnder(root, directory = root) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
		else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
	}
	return files.sort();
}

export function validatePackedFiles(files) {
	const errors = [];
	const fileSet = new Set(files);
	for (const path of required) {
		if (!fileSet.has(path)) errors.push(`packed distribution is missing ${path}`);
	}
	for (const path of files) {
		if (forbiddenPrefixes.some((prefix) => path.startsWith(prefix))) {
			errors.push(`packed distribution must not include ${path}`);
		}
		if (forbiddenFiles.includes(path)) {
			errors.push(`packed distribution must not include ${path}`);
		}
	}
	return errors;
}

async function extract(tarball, destination) {
	await mkdir(destination, { recursive: true });
	await execFileAsync("tar", ["-xzf", tarball, "-C", destination]);
	return join(destination, "package");
}

async function npmPack(root, destination) {
	const { stdout } = await execFileAsync(
		"npm",
		["pack", "--json", "--pack-destination", destination, "--ignore-scripts"],
		{ cwd: root },
	);
	const result = JSON.parse(stdout);
	if (!Array.isArray(result) || !result[0]?.filename) {
		throw new Error("npm pack did not report a tarball");
	}
	return join(destination, result[0].filename);
}

async function main() {
	const workspace = await mkdtemp(join(tmpdir(), "pi-workflow-distribution-"));
	try {
		const packed = await npmPack(process.cwd(), workspace);
		const packageRoot = await extract(packed, join(workspace, "extract"));
		const errors = validatePackedFiles(await filesUnder(packageRoot));
		if (errors.length > 0) throw new Error(errors.join("\n"));
		process.stdout.write("Packed distribution validation passed.\n");
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
