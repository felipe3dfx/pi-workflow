import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const validatorPath = resolve("scripts/validate-pi-package.mjs");

const companionEntries = [
	"gentle-engram",
	"pi-mcp-adapter",
	"@tintinweb/pi-subagents",
	"pi-web-access",
].map((packageName, index) => ({
	package: packageName,
	version: `1.0.${index}`,
	description: `${packageName} fixture`,
}));

function baselinePackageJson(overrides = {}) {
	return {
		name: "@felipe3dfx/pi-workflow",
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
			lint: "biome lint .",
			format: "biome format --write .",
			"check:biome": "biome check --formatter-enabled=false .",
			check:
				"npm run check:biome && npm run check:publish && node --test test/*.test.mjs && npm run pack:dry-run",
			prepublishOnly: "npm run check",
		},
		pi: {
			extensions: ["./extensions/pi-workflow.ts"],
		},
		...overrides,
	};
}

async function createFixture({
	packageJson = baselinePackageJson(),
	companions = { schemaVersion: 1, companions: companionEntries },
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
		`${JSON.stringify(companions, null, 2)}\n`,
	);
	await writeFile(
		join(root, "extensions", "pi-workflow.ts"),
		"export default function piWorkflowExtension() {}\n",
	);
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

test("rejects companion metadata that omits a required companion package", async () => {
	const root = await createFixture({
		companions: {
			schemaVersion: 1,
			companions: companionEntries.filter(
				(companion) => companion.package !== "pi-web-access",
			),
		},
	});
	try {
		const result = await runValidator(root);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/companion metadata must include pi-web-access/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("requires prepublishOnly to run the full check suite", async () => {
	const root = await createFixture({
		packageJson: baselinePackageJson({
			scripts: {
				"check:publish": "node scripts/validate-pi-package.mjs",
				lint: "biome lint .",
				format: "biome format --write .",
				"check:biome": "biome check --formatter-enabled=false .",
				check:
					"npm run check:biome && npm run check:publish && node --test test/*.test.mjs && npm run pack:dry-run",
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
