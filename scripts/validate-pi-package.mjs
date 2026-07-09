#!/usr/bin/env node

import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const companionsPath = path.join(root, "assets", "companions.json");
const mcpServersPath = path.join(root, "assets", "mcp-servers.json");
const errors = [];
let packageJson;
let companions;
let mcpServers;

const requiredCompanionPackages = [
	"gentle-engram",
	"pi-mcp-adapter",
	"@tintinweb/pi-subagents",
	"pi-web-access",
	"@vndv/pi-codegraph",
];

const requiredMcpServerCatalog = {
	schemaVersion: 1,
	mcpServers: {
		context7: {
			command: "npx",
			args: [
				"-y",
				"--package=@upstash/context7-mcp@2.2.5",
				"--",
				"context7-mcp",
			],
			directTools: true,
		},
		sentry: {
			url: "https://mcp.sentry.dev/mcp",
		},
		linear: {
			url: "https://mcp.linear.app/mcp",
			directTools: true,
		},
	},
};

try {
	packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
} catch (error) {
	process.stderr.write(
		`Failed to read or parse package.json: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
}

try {
	companions = JSON.parse(await readFile(companionsPath, "utf8"));
} catch (error) {
	errors.push(
		`failed to read or parse companion metadata at assets/companions.json: ${error instanceof Error ? error.message : String(error)}`,
	);
}

try {
	mcpServers = JSON.parse(await readFile(mcpServersPath, "utf8"));
} catch (error) {
	errors.push(
		`failed to read or parse MCP server catalog at assets/mcp-servers.json: ${error instanceof Error ? error.message : String(error)}`,
	);
}

function check(condition, message) {
	if (!condition) errors.push(message);
}

async function pathExists(relativePath) {
	try {
		await access(path.resolve(root, relativePath));
		return true;
	} catch {
		return false;
	}
}

async function assertPathExists(relativePath, kind) {
	const absolutePath = path.resolve(root, relativePath);
	try {
		await access(absolutePath);
		const info = await stat(absolutePath);
		if (kind === "extensions") {
			check(
				info.isFile(),
				`pi.extensions path must be a file: ${relativePath}`,
			);
			check(
				relativePath.startsWith("./extensions/"),
				`pi.extensions path must point at a local extension: ${relativePath}`,
			);
		}
		if (kind === "skills") {
			check(
				info.isDirectory(),
				`pi.skills path must be a directory: ${relativePath}`,
			);
		}
	} catch {
		errors.push(`missing pi.${kind} path: ${relativePath}`);
	}
}

function assertNoNodeModulesPath(paths, manifestKey) {
	for (const manifestPath of paths ?? []) {
		check(
			!manifestPath.includes("node_modules"),
			`pi.${manifestKey} path must not point into node_modules: ${manifestPath}`,
		);
	}
}

function isPlainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value) {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	}
	if (isPlainRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

check(
	packageJson.name === "@felipe.3dfx/pi-workflow",
	"package name must be @felipe.3dfx/pi-workflow",
);
check(
	packageJson.keywords?.includes("pi-package"),
	"keywords must include pi-package",
);
check(
	packageJson.publishConfig?.access === "public",
	"publishConfig.access must be public",
);
check(
	packageJson.pi && typeof packageJson.pi === "object",
	"package.json must define a pi manifest",
);
check(
	packageJson.files?.includes("extensions/"),
	"package files must include extensions/",
);
check(
	packageJson.files?.includes("assets/"),
	"package files must include assets/",
);
check(
	packageJson.files?.includes("scripts/**/*.mjs"),
	"package files must include scripts/**/*.mjs",
);
check(
	packageJson.files?.includes("README.md"),
	"package files must include README.md",
);
check(
	packageJson.files?.includes("LICENSE"),
	"package files must include LICENSE",
);
check(
	packageJson.scripts?.["check:publish"] ===
		"node scripts/validate-pi-package.mjs",
	"scripts.check:publish must run scripts/validate-pi-package.mjs",
);
check(Boolean(packageJson.scripts?.check), "scripts.check must be present");
check(Boolean(packageJson.scripts?.lint), "scripts.lint must be present");
check(Boolean(packageJson.scripts?.format), "scripts.format must be present");
check(
	packageJson.scripts?.["check:biome"] ===
		"biome check --formatter-enabled=false .",
	"scripts.check:biome must run biome check with formatter checks disabled",
);
check(
	packageJson.scripts?.["check:typecheck"] === "tsc --noEmit",
	"scripts.check:typecheck must run tsc --noEmit",
);
check(
	packageJson.scripts?.["check:focused-tests"] ===
		"node scripts/forbid-focused-tests.mjs",
	"scripts.check:focused-tests must run scripts/forbid-focused-tests.mjs",
);
check(
	packageJson.scripts?.check?.includes("npm run check:biome"),
	"scripts.check must include Biome checks",
);
check(
	packageJson.scripts?.check?.includes("npm run check:typecheck"),
	"scripts.check must include TypeScript type checking",
);
check(
	packageJson.scripts?.check?.includes("npm run check:focused-tests"),
	"scripts.check must include focused test guard",
);
check(
	packageJson.scripts?.prepublishOnly === "npm run check",
	"scripts.prepublishOnly must run the full check suite",
);
check(
	!Object.hasOwn(packageJson, "bundledDependencies") &&
		!Object.hasOwn(packageJson, "bundleDependencies"),
	"package must not define bundledDependencies or bundleDependencies",
);
check(
	packageJson.engines?.node === ">=22.19",
	"engines.node must be >=22.19",
);

const extensionPaths = packageJson.pi?.extensions ?? [];
check(
	Array.isArray(extensionPaths) && extensionPaths.length === 1,
	"pi.extensions must expose only the local pi-workflow extension",
);
check(
	extensionPaths[0] === "./extensions/pi-workflow.ts",
	'pi.extensions must be ["./extensions/pi-workflow.ts"]',
);
assertNoNodeModulesPath(extensionPaths, "extensions");
assertNoNodeModulesPath(packageJson.pi?.skills ?? [], "skills");
check(
	!packageJson.pi?.skills || packageJson.pi.skills.length === 0,
	"pi.skills must be omitted or empty until this package owns skills",
);

for (const extensionPath of extensionPaths) {
	await assertPathExists(extensionPath, "extensions");
}

for (const skillsPath of packageJson.pi?.skills ?? []) {
	await assertPathExists(skillsPath, "skills");
}

if (companions) {
	check(
		companions.schemaVersion === 1,
		"companion metadata schemaVersion must be 1",
	);
	check(
		Array.isArray(companions.companions),
		"companion metadata must define companions[]",
	);
	const companionEntries = Array.isArray(companions.companions)
		? companions.companions
		: [];
	for (const [index, companion] of companionEntries.entries()) {
		check(
			companion && typeof companion === "object" && !Array.isArray(companion),
			`companion metadata entry ${index} must be an object`,
		);
		check(
			typeof companion?.package === "string" && companion.package.length > 0,
			`companion metadata entry ${index} must define package`,
		);
		check(
			typeof companion?.version === "string" && companion.version.length > 0,
			`companion metadata entry ${index} must define version`,
		);
		check(
			companion.description === undefined ||
				typeof companion.description === "string",
			`companion metadata entry ${index} description must be a string when present`,
		);
	}
	const actualPackages = companionEntries
		.filter(
			(companion) =>
				companion && typeof companion === "object" && !Array.isArray(companion),
		)
		.map((companion) => companion.package);
	for (const packageName of requiredCompanionPackages) {
		check(
			actualPackages.includes(packageName),
			`companion metadata must include ${packageName}`,
		);
	}
	check(
		actualPackages.length === requiredCompanionPackages.length,
		`companion metadata must include exactly ${requiredCompanionPackages.length} companion packages`,
	);
}

if (mcpServers !== undefined) {
	check(
		isPlainRecord(mcpServers),
		"MCP server catalog top-level value must be an object",
	);
	const actualCatalog = isPlainRecord(mcpServers) ? mcpServers : {};
	const actualCatalogKeys = Object.keys(actualCatalog).sort();
	const expectedCatalogKeys = ["mcpServers", "schemaVersion"];
	check(
		canonicalJson(actualCatalogKeys) === canonicalJson(expectedCatalogKeys),
		`assets/mcp-servers.json must only define schemaVersion and mcpServers; found ${actualCatalogKeys.join(", ") || "none"}`,
	);
	check(
		actualCatalog.schemaVersion === 1,
		"MCP server catalog schemaVersion must be 1",
	);
	check(
		isPlainRecord(actualCatalog.mcpServers),
		"MCP server catalog must define mcpServers as an object",
	);
	const actualMcpServers = isPlainRecord(actualCatalog.mcpServers)
		? actualCatalog.mcpServers
		: {};
	const actualMcpServerNames = Object.keys(actualMcpServers).sort();
	const expectedMcpServerNames = Object.keys(
		requiredMcpServerCatalog.mcpServers,
	).sort();
	check(
		canonicalJson(actualMcpServerNames) ===
			canonicalJson(expectedMcpServerNames),
		`assets/mcp-servers.json must define exactly context7, sentry, and linear; found ${actualMcpServerNames.join(", ") || "none"}`,
	);
	for (const [name, expectedDefinition] of Object.entries(
		requiredMcpServerCatalog.mcpServers,
	)) {
		check(
			Object.hasOwn(actualMcpServers, name),
			`assets/mcp-servers.json must include ${name}`,
		);
		const actualDefinition = actualMcpServers[name];
		check(
			isPlainRecord(actualDefinition),
			`assets/mcp-servers.json entry ${name} must be an object`,
		);
		check(
			canonicalJson(actualDefinition) === canonicalJson(expectedDefinition),
			`assets/mcp-servers.json entry ${name} must exactly match the supported definition. Actual: ${JSON.stringify(actualDefinition)}. Expected: ${JSON.stringify(expectedDefinition)}`,
		);
	}
}

for (const obsoleteShimPath of [
	"extensions/gentle-engram.ts",
	"extensions/pi-mcp-adapter.ts",
	"extensions/pi-subagents.ts",
	"extensions/pi-web-access.ts",
]) {
	check(
		!(await pathExists(obsoleteShimPath)),
		`obsolete third-party extension shim must be removed: ${obsoleteShimPath}`,
	);
}

if (errors.length > 0) {
	process.stderr.write("pi-workflow package validation failed:\n\n");
	for (const error of errors) process.stderr.write(`- ${error}\n`);
	process.exit(1);
}

process.stdout.write("pi-workflow package validation passed.\n");
