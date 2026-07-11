#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { parse as parseYaml } from "yaml";
import { publicWorkflowCatalog } from "./public-workflow-catalog.mjs";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const companionsPath = path.join(root, "assets", "companions.json");
const mcpServersPath = path.join(root, "assets", "mcp-servers.json");
const errors = [];
const publicEntryNames = publicWorkflowCatalog
	.map((workflow) => workflow.name)
	.sort();
let packageJson;
let companions;
let mcpServers;

const companionWorkflowPath = path.join(
	root,
	"extensions",
	"companion-workflow.ts",
);

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
		if (kind === "skills" || kind === "prompts") {
			check(
				info.isDirectory(),
				`pi.${kind} path must be a directory: ${relativePath}`,
			);
		}
	} catch {
		errors.push(`missing pi.${kind} path: ${relativePath}`);
	}
}

function parseFrontmatterDocument(source) {
	const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---\n")) {
		throw new Error("frontmatter must start with ---");
	}
	const closingMatch = /^---$/m.exec(normalized.slice(4));
	if (!closingMatch) {
		throw new Error("frontmatter must end with a delimiter-only --- line");
	}
	const endIndex = 4 + closingMatch.index;
	const parsed = parseYaml(normalized.slice(4, endIndex));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("frontmatter must be a YAML mapping");
	}
	return {
		frontmatter: parsed,
		body: normalized.slice(endIndex + 4),
	};
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

const semverIshPattern =
	/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function isLocalPath(value) {
	return (
		typeof value === "string" &&
		(value.includes("node_modules") ||
			value.startsWith("file:") ||
			value.startsWith("./") ||
			value.startsWith("/"))
	);
}

function collectStrings(value, out = []) {
	if (typeof value === "string") {
		out.push(value);
	} else if (Array.isArray(value)) {
		for (const entry of value) collectStrings(entry, out);
	} else if (isPlainRecord(value)) {
		for (const entry of Object.values(value)) collectStrings(entry, out);
	}
	return out;
}

async function loadCodeGraphPackageName() {
	let source;
	try {
		source = await readFile(companionWorkflowPath, "utf8");
	} catch (error) {
		errors.push(
			`failed to read extensions/companion-workflow.ts for the codeGraph cross-consistency check: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
	// Assumes a double-quoted declaration (biome enforces quoteStyle double); fails closed if the declaration style changes.
	const match = source.match(/codeGraphPackageName\s*=\s*"([^"]+)"/);
	if (!match) {
		errors.push(
			"could not locate codeGraphPackageName in extensions/companion-workflow.ts",
		);
		return undefined;
	}
	return match[1];
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
	packageJson.files?.includes("skills/"),
	"package files must include skills/",
);
check(
	packageJson.files?.includes("prompts/"),
	"package files must include prompts/",
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
	packageJson.scripts?.["check:generated"] ===
		"node scripts/generate-public-workflows.mjs --check",
	"scripts.check:generated must check generated public workflow resources",
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
	packageJson.scripts?.check?.includes("npm run check:generated"),
	"scripts.check must verify generated public workflow resources",
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
assertNoNodeModulesPath(packageJson.pi?.prompts ?? [], "prompts");
check(
	Array.isArray(packageJson.pi?.skills) &&
		packageJson.pi.skills.length === 1 &&
		packageJson.pi.skills[0] === "./skills",
	'pi.skills must be ["./skills"]',
);
check(
	Array.isArray(packageJson.pi?.prompts) &&
		packageJson.pi.prompts.length === 1 &&
		packageJson.pi.prompts[0] === "./prompts",
	'pi.prompts must be ["./prompts"]',
);

for (const extensionPath of extensionPaths) {
	await assertPathExists(extensionPath, "extensions");
}

for (const skillsPath of packageJson.pi?.skills ?? []) {
	await assertPathExists(skillsPath, "skills");
}

for (const promptsPath of packageJson.pi?.prompts ?? []) {
	await assertPathExists(promptsPath, "prompts");
}

try {
	const skillNames = (await readdir(path.join(root, "skills"), { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	check(
		skillNames.join(",") === publicEntryNames.join(","),
		`public skills must be exactly ${publicEntryNames.join(", ")}; found ${skillNames.join(", ") || "none"}`,
	);
	for (const name of publicEntryNames) {
		const relativeSkillPath = `./skills/${name}/SKILL.md`;
		const skillExists = await pathExists(relativeSkillPath);
		check(skillExists, `missing public skill file: ${name}/SKILL.md`);
		if (!skillExists) continue;
		try {
			const { frontmatter } = parseFrontmatterDocument(
				await readFile(path.join(root, relativeSkillPath), "utf8"),
			);
			check(
				typeof frontmatter.name === "string" && frontmatter.name.trim() !== "",
				`${name} frontmatter must define name`,
			);
			check(
				typeof frontmatter.name !== "string" || frontmatter.name === name,
				`${name} frontmatter name must match its directory`,
			);
			check(
				typeof frontmatter.description === "string" &&
					frontmatter.description.trim() !== "",
				`${name} frontmatter must define description`,
			);
		} catch (error) {
			errors.push(
				`invalid public skill ${name} frontmatter: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const loadedSkills = loadSkillsFromDir({
		dir: path.join(root, "skills"),
		source: "package-validation",
	});
	for (const diagnostic of loadedSkills.diagnostics) {
		errors.push(
			`Pi rejected public skill ${path.relative(root, diagnostic.path ?? "skills")}: ${diagnostic.message}`,
		);
	}
	check(
		loadedSkills.skills.length === publicEntryNames.length,
		`Pi must discover exactly ${publicEntryNames.length} public skills; found ${loadedSkills.skills.length}`,
	);
} catch (error) {
	errors.push(
		`failed to inspect public skills: ${error instanceof Error ? error.message : String(error)}`,
	);
}

try {
	const promptNames = (await readdir(path.join(root, "prompts"), { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name.replace(/\.md$/, ""))
		.sort();
	check(
		promptNames.join(",") === publicEntryNames.join(","),
		`public prompts must be exactly ${publicEntryNames.join(", ")}; found ${promptNames.join(", ") || "none"}`,
	);
	for (const name of publicEntryNames) {
		try {
			const { frontmatter, body } = parseFrontmatterDocument(
				await readFile(path.join(root, "prompts", `${name}.md`), "utf8"),
			);
			check(
				typeof frontmatter.description === "string" &&
					frontmatter.description.trim() !== "",
				`${name} prompt frontmatter description must be a non-empty string`,
			);
			check(
				frontmatter["argument-hint"] === undefined ||
					(typeof frontmatter["argument-hint"] === "string" &&
						frontmatter["argument-hint"].trim() !== ""),
				`${name} prompt frontmatter argument-hint must be a non-empty string when present`,
			);
			check(
				body ===
					`Load and follow the \`${name}\` skill.\n\nArguments: $ARGUMENTS\n`,
				`public prompt ${name} must contain only its exact skill invocation and argument forwarding`,
			);
		} catch (error) {
			errors.push(
				`invalid public prompt ${name} frontmatter: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
} catch (error) {
	errors.push(
		`failed to inspect public prompts: ${error instanceof Error ? error.message : String(error)}`,
	);
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
		if (typeof companion?.package === "string") {
			check(
				!isLocalPath(companion.package),
				`companion metadata entry ${index} package must not be a local path: ${companion.package}`,
			);
		}
		if (typeof companion?.version === "string") {
			check(
				!isLocalPath(companion.version),
				`companion metadata entry ${index} version must not be a local path: ${companion.version}`,
			);
			check(
				semverIshPattern.test(companion.version),
				`companion metadata entry ${index} version must look like a semver version: ${companion.version}`,
			);
		}
	}
	check(
		companionEntries.length > 0,
		"companion metadata companions[] must not be empty",
	);
	const actualPackages = companionEntries
		.filter(
			(companion) =>
				companion && typeof companion === "object" && !Array.isArray(companion),
		)
		.map((companion) => companion.package)
		.filter((packageName) => typeof packageName === "string");
	const duplicatePackages = actualPackages.filter(
		(packageName, index) => actualPackages.indexOf(packageName) !== index,
	);
	check(
		duplicatePackages.length === 0,
		`companion metadata must not list duplicate companion package(s): ${[...new Set(duplicatePackages)].join(", ")}`,
	);

	const codeGraphPackageName = await loadCodeGraphPackageName();
	if (codeGraphPackageName) {
		check(
			actualPackages.includes(codeGraphPackageName),
			`companion metadata must include ${codeGraphPackageName} (required by extensions/companion-workflow.ts codeGraphPackageName)`,
		);
	}
}

if (mcpServers !== undefined) {
	check(
		isPlainRecord(mcpServers),
		"MCP server catalog top-level value must be an object",
	);
	const actualCatalog = isPlainRecord(mcpServers) ? mcpServers : {};
	const actualCatalogKeys = Object.keys(actualCatalog).sort();
	check(
		actualCatalogKeys.join(",") === "mcpServers,schemaVersion",
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
	const actualMcpServerNames = Object.keys(actualMcpServers);
	check(
		actualMcpServerNames.length > 0,
		"MCP server catalog mcpServers must not be empty",
	);
	for (const name of actualMcpServerNames) {
		const definition = actualMcpServers[name];
		check(
			isPlainRecord(definition),
			`assets/mcp-servers.json entry ${name} must be an object`,
		);
		if (isPlainRecord(definition)) {
			for (const value of collectStrings(definition)) {
				check(
					!isLocalPath(value),
					`assets/mcp-servers.json entry ${name} must not point at a local path: ${value}`,
				);
			}
		}
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
