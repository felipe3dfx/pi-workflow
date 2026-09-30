#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const commands = [
	"workflow:status",
	"workflow:doctor",
	"workflow:configure",
	"workflow:models",
	"workflow:delegation-check",
];

const themeSchemaPath = path.join(
	root,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"modes",
	"interactive",
	"theme",
	"theme-schema.json",
);

export async function validateTheme(packageRoot, name = "pi-workflow") {
	const errors = [];
	const schema = JSON.parse(await readFile(themeSchemaPath, "utf8"));
	let theme;
	try {
		theme = JSON.parse(
			await readFile(path.join(packageRoot, "themes", `${name}.json`), "utf8"),
		);
	} catch (error) {
		return [`themes/${name}.json must exist and parse as JSON: ${error.message}`];
	}
	if (theme.name !== name) errors.push(`themes/${name}.json name must equal ${name}`);
	for (const token of schema.properties.colors.required) {
		if (theme.colors?.[token] === undefined) {
			errors.push(`themes/${name}.json is missing required color token ${token}`);
		}
	}
	return errors;
}

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
	const settings = JSON.parse(
		await readFile(path.join(packageRoot, "assets", "settings.json"), "utf8"),
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
	check(
		JSON.stringify(packageJson.pi?.themes) === JSON.stringify(["./themes/pi-workflow.json"]),
		"pi.themes must expose only ./themes/pi-workflow.json",
	);
	check(packageJson.files?.includes("themes/"), "package files must ship themes/");
	errors.push(...(await validateTheme(packageRoot)));
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
	check(
		settings.schemaVersion === 1 &&
			settings.settings &&
			typeof settings.settings === "object" &&
			!Array.isArray(settings.settings),
		"settings catalog must be a schemaVersion 1 settings object",
	);
	for (const command of commands) {
		check(extension.includes(`"${command}"`), `extension must register ${command}`);
	}
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
