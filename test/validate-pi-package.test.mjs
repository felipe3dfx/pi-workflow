import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const validatorPath = resolve("scripts/validate-pi-package.mjs");

function loadJsonFixture(relativePath) {
	return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const mcpServerCatalog = loadJsonFixture("../assets/mcp-servers.json");
const companionEntries = [
	"gentle-engram",
	"pi-mcp-adapter",
	"@tintinweb/pi-subagents",
	"pi-web-access",
	"@vndv/pi-codegraph",
].map((packageName, index) => ({
	package: packageName,
	version: packageName === "@vndv/pi-codegraph" ? "0.1.10" : `1.0.${index}`,
	description: `${packageName} fixture`,
}));

function baselinePackageJson(overrides = {}) {
	return {
		name: "@felipe.3dfx/pi-workflow",
		version: "0.0.0-fixture",
		type: "module",
		keywords: ["pi-package"],
		publishConfig: { access: "public" },
		files: [
			"README.md",
			"scripts/**/*.mjs",
			"package.json",
			"LICENSE",
			"extensions/",
			"assets/",
		],
		scripts: {
			"check:publish": "node scripts/validate-pi-package.mjs",
			"check:typecheck": "tsc --noEmit",
			"check:focused-tests": "node scripts/forbid-focused-tests.mjs",
			lint: "biome lint .",
			format: "biome format --write .",
			"check:biome": "biome check --formatter-enabled=false .",
			check:
				"npm run check:biome && npm run check:typecheck && npm run check:focused-tests && npm run check:publish && node --test test/*.test.mjs && npm run pack:dry-run",
			prepublishOnly: "npm run check",
		},
		pi: {
			extensions: ["./extensions/pi-workflow.ts"],
		},
		engines: {
			node: ">=22.19",
		},
		...overrides,
	};
}

const codeGraphPackageName = "@vndv/pi-codegraph";

function companionWorkflowSource(packageName = codeGraphPackageName) {
	return `const codeGraphPackageName = "${packageName}";\nexport { codeGraphPackageName };\n`;
}

async function createFixture({
	packageJson = baselinePackageJson(),
	companions = { schemaVersion: 1, companions: companionEntries },
	mcpServers = mcpServerCatalog,
	companionsRaw,
	mcpServersRaw,
	companionWorkflow = companionWorkflowSource(),
} = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-validator-"));
	await mkdir(join(root, "assets"), { recursive: true });
	await mkdir(join(root, "extensions"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify(packageJson, null, 2)}\n`,
	);
	await writeFile(
		join(root, "assets", "companions.json"),
		companionsRaw ?? `${JSON.stringify(companions, null, 2)}\n`,
	);
	await writeFile(
		join(root, "assets", "mcp-servers.json"),
		mcpServersRaw ?? `${JSON.stringify(mcpServers, null, 2)}\n`,
	);
	await writeFile(
		join(root, "extensions", "pi-workflow.ts"),
		"export default function piWorkflowExtension() {}\n",
	);
	if (companionWorkflow !== null) {
		await writeFile(
			join(root, "extensions", "companion-workflow.ts"),
			companionWorkflow,
		);
	}
	return root;
}

async function runValidator(root) {
	try {
		const result = await execFileAsync(process.execPath, [validatorPath], {
			cwd: root,
		});
		return { code: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		return {
			code: error.code ?? 1,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	}
}

test("validates a baseline package fixture", async () => {
	const root = await createFixture();
	try {
		const result = await runValidator(root);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /validation passed/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects pi manifest paths that point into node_modules", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			pi: { extensions: ["./node_modules/some-package/extension.ts"] },
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/pi\.extensions path must not point into node_modules/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects companion metadata missing the codeGraph companion required by extensions/companion-workflow.ts", async () => {
	const root = await createFixture({
		companions: {
			schemaVersion: 1,
			companions: companionEntries.filter(
				(companion) => companion.package !== codeGraphPackageName,
			),
		},
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/companion metadata must include @vndv\/pi-codegraph/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fails loudly when codeGraphPackageName cannot be located in extensions/companion-workflow.ts", async () => {
	const root = await createFixture({
		companionWorkflow: "export default function noop() {}\n",
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /could not locate codeGraphPackageName/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects an empty companion list", async () => {
	const root = await createFixture({
		companions: { schemaVersion: 1, companions: [] },
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /companions\[\] must not be empty/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects duplicate companion package names", async () => {
	const root = await createFixture({
		companions: {
			schemaVersion: 1,
			companions: [...companionEntries, companionEntries[0]],
		},
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /duplicate companion package/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects companion entries pointing at local paths", async () => {
	const root = await createFixture({
		companions: {
			schemaVersion: 1,
			companions: [
				...companionEntries.filter((c) => c.package !== "pi-web-access"),
				{ package: "pi-web-access", version: "file:../pi-web-access" },
			],
		},
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /must not be a local path/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects malformed JSON in assets/companions.json", async () => {
	const root = await createFixture({ companionsRaw: "{ not json" });
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /failed to read or parse companion metadata/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects malformed JSON in assets/mcp-servers.json", async () => {
	const root = await createFixture({ mcpServersRaw: "{ not json" });
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /failed to read or parse MCP server catalog/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects an MCP catalog missing schemaVersion", async () => {
	const root = await createFixture({
		mcpServers: { mcpServers: mcpServerCatalog.mcpServers },
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /schemaVersion must be 1/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects an empty MCP server catalog", async () => {
	const root = await createFixture({
		mcpServers: { schemaVersion: 1, mcpServers: {} },
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /mcpServers must not be empty/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects MCP server definitions containing local file paths", async () => {
	const root = await createFixture({
		mcpServers: {
			schemaVersion: 1,
			mcpServers: {
				...mcpServerCatalog.mcpServers,
				local: { command: "./scripts/run-mcp.sh" },
			},
		},
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /must not point at a local path/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects falsey but valid MCP catalog JSON values", async () => {
	const root = await createFixture({
		mcpServers: false,
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /assets\/mcp-servers\.json|MCP server catalog/i);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects package metadata below the supported Node baseline", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			engines: { node: ">=22" },
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /engines\.node must be >=22\.19/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("requires prepublishOnly to run the full check suite", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			scripts: {
				"check:publish": "node scripts/validate-pi-package.mjs",
				"check:typecheck": "tsc --noEmit",
				"check:focused-tests": "node scripts/forbid-focused-tests.mjs",
				lint: "biome lint .",
				format: "biome format --write .",
				"check:biome": "biome check --formatter-enabled=false .",
				check:
					"npm run check:biome && npm run check:typecheck && npm run check:focused-tests && npm run check:publish && node --test test/*.test.mjs && npm run pack:dry-run",
				prepublishOnly: "npm run check:publish",
			},
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/scripts\.prepublishOnly must run the full check suite/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("requires the full check suite to run TypeScript type checking", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			scripts: {
				"check:publish": "node scripts/validate-pi-package.mjs",
				"check:typecheck": "tsc --noEmit",
				"check:focused-tests": "node scripts/forbid-focused-tests.mjs",
				lint: "biome lint .",
				format: "biome format --write .",
				"check:biome": "biome check --formatter-enabled=false .",
				check:
					"npm run check:biome && npm run check:focused-tests && npm run check:publish && node --test test/*.test.mjs && npm run pack:dry-run",
				prepublishOnly: "npm run check",
			},
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/scripts\.check must include TypeScript type checking/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("requires the full check suite to forbid focused tests", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			scripts: {
				"check:publish": "node scripts/validate-pi-package.mjs",
				"check:typecheck": "tsc --noEmit",
				"check:focused-tests": "node scripts/forbid-focused-tests.mjs",
				lint: "biome lint .",
				format: "biome format --write .",
				"check:biome": "biome check --formatter-enabled=false .",
				check:
					"npm run check:biome && npm run check:typecheck && npm run check:publish && node --test test/*.test.mjs && npm run pack:dry-run",
				prepublishOnly: "npm run check",
			},
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/scripts\.check must include focused test guard/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
