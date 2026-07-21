import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const validatorPath = resolve("scripts/validate-pi-package.mjs");

function loadJsonFixture(relativePath) {
	return JSON.parse(
		readFileSync(new URL(relativePath, import.meta.url), "utf8"),
	);
}

const mcpServerCatalog = loadJsonFixture("../assets/mcp-servers.json");
const publicEntryNames = [
	"define-product",
	"deliver-ticket",
	"product-review",
	"qa-handoff",
];
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
			"skills/",
			"prompts/",
		],
		scripts: {
			"check:publish": "node scripts/validate-pi-package.mjs",
			"check:release": "node scripts/validate-release.mjs",
			"check:acceptance": "node scripts/check-acceptance.mjs",
			"check:typecheck": "tsc --noEmit",
			"check:focused-tests": "node scripts/forbid-focused-tests.mjs",
			"check:generated": "node scripts/generate-public-workflows.mjs --check",
			lint: "biome lint .",
			format: "biome format --write .",
			"check:biome": "biome check --formatter-enabled=false .",
			check:
				"npm run check:biome && npm run check:typecheck && npm run check:focused-tests && npm run check:generated && npm run check:publish && npm run check:release && node --test test/*.test.mjs && npm run pack:dry-run && npm run check:acceptance",
			prepublishOnly: "npm run check",
		},
		pi: {
			extensions: ["./extensions/pi-workflow.ts"],
			skills: ["./skills"],
			prompts: ["./prompts"],
		},
		engines: {
			node: ">=22.19",
		},
		devDependencies: {
			tooling: "^1.0.0",
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
	publicWorkflows = publicEntryNames,
} = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-validator-"));
	await mkdir(join(root, "assets"), { recursive: true });
	await mkdir(join(root, "extensions"), { recursive: true });
	for (const name of publicWorkflows) {
		await mkdir(join(root, "skills", name), { recursive: true });
		await writeFile(
			join(root, "skills", name, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${name} fixture\n---\n\n# ${name}\n`,
		);
		await mkdir(join(root, "prompts"), { recursive: true });
		await writeFile(
			join(root, "prompts", `${name}.md`),
			`---\ndescription: ${name} fixture\n---\nLoad and follow the \`${name}\` skill.\n\nArguments: $ARGUMENTS\n`,
		);
	}
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

async function runValidator(root, scriptPath = validatorPath) {
	try {
		const result = await execFileAsync(process.execPath, [scriptPath], {
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

test("rejects a public skill directory without SKILL.md", async () => {
	const root = await createFixture();
	try {
		await rm(join(root, "skills", "define-product", "SKILL.md"));
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/missing public skill file: define-product\/SKILL\.md/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects public skill frontmatter missing a name", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "skills", "define-product", "SKILL.md"),
			"---\ndescription: Define product fixture\n---\n\n# Define product\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /define-product frontmatter must define name/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects public skill frontmatter missing a description", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "skills", "define-product", "SKILL.md"),
			"---\nname: define-product\n---\n\n# Define product\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/define-product frontmatter must define description/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects a frontmatter closing delimiter with trailing text", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "skills", "define-product", "SKILL.md"),
			"---\nname: define-product\ndescription: Define product fixture\n---oops\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/frontmatter must end with a delimiter-only --- line/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects malformed public skill frontmatter", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "skills", "define-product", "SKILL.md"),
			"---\nname: [define-product\ndescription: malformed fixture\n---\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/invalid public skill define-product frontmatter/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects public skill frontmatter whose name mismatches its directory", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "skills", "define-product", "SKILL.md"),
			"---\nname: deliver-ticket\ndescription: Define product fixture\n---\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/define-product frontmatter name must match its directory/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("validator follows the production catalog and still rejects unauthorized resources", async () => {
	const scriptRoot = await mkdtemp(resolve(".validator-catalog-test-"));
	const catalogNames = [...publicEntryNames, "catalog-fixture"];
	const root = await createFixture({ publicWorkflows: catalogNames });
	try {
		const scriptPath = join(scriptRoot, "validate-pi-package.mjs");
		await copyFile(validatorPath, scriptPath);
		await writeFile(
			join(scriptRoot, "public-workflow-catalog.mjs"),
			`export const publicWorkflowCatalog = ${JSON.stringify(catalogNames.map((name) => ({ name })))};\n`,
		);

		const catalogResult = await runValidator(root, scriptPath);
		assert.equal(catalogResult.code, 0, catalogResult.stderr);

		await mkdir(join(root, "skills", "unauthorized-workflow"), {
			recursive: true,
		});
		await writeFile(
			join(root, "skills", "unauthorized-workflow", "SKILL.md"),
			"---\nname: unauthorized-workflow\ndescription: Must not be public\n---\n",
		);
		const unauthorizedResult = await runValidator(root, scriptPath);
		assert.notEqual(unauthorizedResult.code, 0);
		assert.match(unauthorizedResult.stderr, /public skills must be exactly/);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(scriptRoot, { recursive: true, force: true });
	}
});

test("rejects an unexpected public skill entry", async () => {
	const root = await createFixture();
	try {
		await mkdir(join(root, "skills", "unexpected-workflow"), {
			recursive: true,
		});
		await writeFile(
			join(root, "skills", "unexpected-workflow", "SKILL.md"),
			"---\nname: unexpected-workflow\ndescription: Must not be public\n---\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /public skills must be exactly/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects malformed YAML in public prompt frontmatter", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "prompts", "define-product.md"),
			"---\ndescription: [broken\n---\nLoad and follow the `define-product` skill.\n\nArguments: $ARGUMENTS\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/invalid public prompt define-product frontmatter/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("schema-checks public prompt YAML frontmatter", async (t) => {
	for (const [label, frontmatter, diagnostic] of [
		["non-object", "- description", /frontmatter must be a YAML mapping/],
		[
			"invalid description",
			"description: 42",
			/description must be a non-empty string/,
		],
		[
			"invalid argument hint",
			"description: fixture\nargument-hint: []",
			/argument-hint must be a non-empty string/,
		],
	]) {
		await t.test(label, async () => {
			const root = await createFixture();
			try {
				await writeFile(
					join(root, "prompts", "define-product.md"),
					`---\n${frontmatter}\n---\nLoad and follow the \`define-product\` skill.\n\nArguments: $ARGUMENTS\n`,
				);
				const result = await runValidator(root);
				assert.notEqual(result.code, 0);
				assert.match(result.stderr, diagnostic);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	}
});

test("prompt manifest diagnostics identify prompts rather than skills", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			pi: {
				extensions: ["./extensions/pi-workflow.ts"],
				skills: ["./skills"],
				prompts: ["./missing-prompts"],
			},
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/missing pi\.prompts path: \.\/missing-prompts/,
		);
		assert.doesNotMatch(
			result.stderr,
			/missing pi\.skills path: \.\/missing-prompts/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects workflow prose duplicated in a public template", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "prompts", "define-product.md"),
			"---\ndescription: fixture\n---\nLoad and follow the `define-product` skill.\n\nArguments: $ARGUMENTS\n\nThen publish the workflow.\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /must contain only its exact skill invocation/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects an unexpected public prompt entry", async () => {
	const root = await createFixture();
	try {
		await writeFile(
			join(root, "prompts", "unexpected-workflow.md"),
			"This workflow must not be public.\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /public prompts must be exactly/);
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
		assert.match(
			result.stderr,
			/assets\/mcp-servers\.json|MCP server catalog/i,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects an eld runtime dependency", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			dependencies: { eld: "2.0.3" },
		}),
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /must not define runtime dependencies/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects bundled runtime dependencies", async (t) => {
	for (const key of ["bundledDependencies", "bundleDependencies"]) {
		await t.test(key, async () => {
			const root = await createFixture({
				packageJson: baselinePackageJson({ [key]: ["eld"] }),
			});
			try {
				const result = await runValidator(root);
				assert.notEqual(result.code, 0);
				assert.match(result.stderr, /must not bundle runtime dependencies/);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	}
});

test("rejects an extra assets/language file", async () => {
	const root = await createFixture();
	try {
		await mkdir(join(root, "assets", "language"), { recursive: true });
		await writeFile(
			join(root, "assets", "language", "eld-extrasmall-profile.json"),
			"{}\n",
		);
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/removed language resource path must not exist: assets\/language/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects removed language resource modules and generators", async (t) => {
	for (const relativePath of [
		"extensions/language-resources.ts",
		"scripts/generate-language-resources.mjs",
	]) {
		await t.test(relativePath, async () => {
			const root = await createFixture();
			try {
				await mkdir(join(root, relativePath, ".."), { recursive: true });
				await writeFile(join(root, relativePath), "export {};\n");
				const result = await runValidator(root);
				assert.notEqual(result.code, 0);
				assert.match(
					result.stderr,
					new RegExp(
						`removed language resource path must not exist: ${relativePath.replaceAll(".", "\\.")}`,
					),
				);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
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
