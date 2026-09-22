#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const commands = [
	"pi-workflow-status",
	"pi-workflow-doctor",
	"pi-workflow-install-companions",
];

export async function validatePiPackage(packageRoot = root) {
	const errors = [];
	const packageJson = JSON.parse(
		await readFile(path.join(packageRoot, "package.json"), "utf8"),
	);
	const companions = JSON.parse(
		await readFile(path.join(packageRoot, "assets", "companions.json"), "utf8"),
	);
	const mcpServers = JSON.parse(
		await readFile(path.join(packageRoot, "assets", "mcp-servers.json"), "utf8"),
	);
	const extension = await readFile(
		path.join(packageRoot, "extensions", "pi-workflow.ts"),
		"utf8",
	);
	const companionWorkflow = await readFile(
		path.join(packageRoot, "extensions", "companion-workflow.ts"),
		"utf8",
	);

	const check = (condition, message) => {
		if (!condition) errors.push(message);
	};

	check(packageJson.name === "@felipe.3dfx/pi-workflow", "package name must stay @felipe.3dfx/pi-workflow");
	check(packageJson.engines?.node === ">=22.19", "engines.node must remain >=22.19");
	check(
		JSON.stringify(packageJson.pi?.extensions) === JSON.stringify(["./extensions/pi-workflow.ts"]),
		"pi.extensions must expose only ./extensions/pi-workflow.ts",
	);
	check(packageJson.pi?.skills === undefined, "pi.skills must not bundle workflow skills");
	check(packageJson.pi?.prompts === undefined, "pi.prompts must not bundle workflow prompts");
	check(packageJson.bin === undefined, "package must not expose a workflow sync binary");
	check(
		!packageJson.files?.some((entry) => entry === "skills/" || entry === "prompts/"),
		"package files must not ship workflow skills or prompts",
	);
	check(
		companions.schemaVersion === 1 &&
			Array.isArray(companions.companions) &&
			companions.companions.length > 0 &&
			companions.companions.every(
				(entry) => typeof entry?.package === "string" && entry.package.length > 0,
			),
		"companion catalog must be a non-empty schemaVersion 1 package list",
	);
	check(
		mcpServers.schemaVersion === 1 &&
			mcpServers.mcpServers &&
			typeof mcpServers.mcpServers === "object" &&
			!Array.isArray(mcpServers.mcpServers),
		"MCP catalog must be a schemaVersion 1 mcpServers object",
	);
	for (const command of commands) {
		check(extension.includes(`"${command}"`), `extension must register ${command}`);
	}
	check(extension.includes('"--apply"'), "install command must require explicit --apply");
	check(
		!/define-product|qa-handoff|product-review|interactive-decisions|publication-recovery/.test(
			extension,
		),
		"extension must not encode the retired product workflow",
	);
	check(
		!companionWorkflow.includes("continuePending"),
		"companion install must not keep a publication recovery continuation",
	);

	return errors;
}

async function main() {
	const errors = await validatePiPackage();
	if (errors.length > 0) {
		process.stderr.write(`${errors.join("\n")}\n`);
		process.exit(1);
	}
	process.stdout.write("Pi package validation passed.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
