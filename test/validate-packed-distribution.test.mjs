import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const validator = resolve("scripts/validate-packed-distribution.mjs");
const workflows = [
	"define-product",
	"deliver-ticket",
	"product-review",
	"qa-handoff",
];

async function fixtureTarball({ omit, extra = {}, catalogVersion = 1 } = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-packed-fixture-"));
	const packageRoot = join(root, "package");
	const files = {
		"README.md": "# Fixture\n",
		"RELEASE_NOTES.md": "# Notas de release — v0.0.0-fixture\n\n## Migraciones\n\nNinguna.\n\n## Sync requerido\n\nRevisar el plan.\n\n## Cambios de capacidades\n\nSin cambios.\n\n## Rollback\n\nRestaurar el predecesor.\n",
		"package.json": JSON.stringify({
			name: "@felipe.3dfx/pi-workflow",
			version: "0.0.0-fixture",
			engines: { node: ">=22.19" },
			bin: { "pi-workflow-sync": "./scripts/pi-workflow-sync.mjs" },
			pi: {
				extensions: ["./extensions/pi-workflow.ts"],
				skills: ["./skills"],
				prompts: ["./prompts"],
			},
		}),
		"scripts/pi-workflow-sync.mjs": "#!/usr/bin/env node\n",
		"scripts/acceptance-evidence.mjs": "export {};\n",
		"scripts/check-acceptance.mjs": "#!/usr/bin/env node\n",
		"scripts/run-packed-acceptance.mjs": "#!/usr/bin/env node\n",
		"scripts/validate-release.mjs": "#!/usr/bin/env node\n",
		"extensions/pi-workflow.ts": "export default function extension() {}\n",
		"extensions/agent-asset-migrations.ts": "export {};\n",
		"extensions/agent-validator.ts": "export {};\n",
		"assets/agents/Explore.md": "# Explore\n",
		"assets/acceptance/qa-handoff.golden.md": "# Entrega para QA\n",
		"assets/acceptance/product-review.golden.md": "# Revisión de producto\n",
		"assets/agent-asset-migrations.json": JSON.stringify({
			schemaVersion: 1,
			migrations: [],
		}),
		"assets/schemas/agent-assets.schema.json": JSON.stringify({
			$schema: "https://json-schema.org/draft/2020-12/schema",
		}),
		"assets/schemas/agent-asset-migrations.schema.json": JSON.stringify({
			$schema: "https://json-schema.org/draft/2020-12/schema",
		}),
		"assets/agent-assets.json": JSON.stringify({
			schemaVersion: catalogVersion,
			assets: [
				{
					kind: "agent",
					name: "Explore",
					version: 1,
					source: "assets/agents/Explore.md",
					digest: createHash("sha256").update("# Explore\n").digest("hex"),
				},
			],
		}),
		...Object.fromEntries(
			workflows.flatMap((name) => [
				[
					`skills/${name}/SKILL.md`,
					`---\nname: ${name}\ndescription: fixture\n---\n`,
				],
				[
					`prompts/${name}.md`,
					`---\ndescription: fixture\n---\nLoad and follow the \`${name}\` skill.\n\nArguments: $ARGUMENTS\n`,
				],
			]),
		),
		...extra,
	};
	for (const [relativePath, content] of Object.entries(files)) {
		if (relativePath === omit) continue;
		const target = join(packageRoot, relativePath);
		await mkdir(join(target, ".."), { recursive: true });
		await writeFile(target, content);
	}
	const tarball = join(root, "fixture.tgz");
	await execFileAsync("tar", ["-czf", tarball, "-C", root, "package"]);
	return { root, tarball };
}

async function validate(tarball) {
	try {
		const result = await execFileAsync(process.execPath, [
			validator,
			"--tarball",
			tarball,
		]);
		return { code: 0, ...result };
	} catch (error) {
		return {
			code: error.code ?? 1,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	}
}

test("accepts a supported packed distribution", async () => {
	const fixture = await fixtureTarball();
	try {
		const result = await validate(fixture.tarball);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /Packed distribution validation passed/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("rejects missing required packed resources", async () => {
	const fixture = await fixtureTarball({ omit: "prompts/qa-handoff.md" });
	try {
		const result = await validate(fixture.tarball);
		assert.notEqual(result.code, 0);
		assert.match(
			result.stderr,
			/missing required packed resource: prompts\/qa-handoff\.md/,
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("rejects forbidden and unsupported packed resources", async () => {
	for (const relativePath of [
		"node_modules/eld/index.js",
		"extensions/gentle-engram.ts",
		"skills/private-internal/SKILL.md",
		"docs/duplicated-workflow.md",
	]) {
		const fixture = await fixtureTarball({
			extra: { [relativePath]: "forbidden\n" },
		});
		try {
			const result = await validate(fixture.tarball);
			assert.notEqual(result.code, 0, relativePath);
			assert.match(
				result.stderr,
				/forbidden (?:packed|public) resource|unsupported packed resource/,
			);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}
});

test("rejects duplicated prompt prose and future migration registries", async (t) => {
	await t.test("duplicated prose", async () => {
		const fixture = await fixtureTarball({
			extra: {
				"prompts/qa-handoff.md":
					"---\ndescription: fixture\n---\nDuplicated workflow prose.\nLoad and follow the `qa-handoff` skill.\n\nArguments: $ARGUMENTS\n",
			},
		});
		try {
			const result = await validate(fixture.tarball);
			assert.notEqual(result.code, 0);
			assert.match(result.stderr, /duplicated workflow prose/);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
	await t.test("future migrations", async () => {
		const fixture = await fixtureTarball({
			extra: {
				"assets/agent-asset-migrations.json": JSON.stringify({
					schemaVersion: 2,
					migrations: [],
				}),
			},
		});
		try {
			const result = await validate(fixture.tarball);
			assert.notEqual(result.code, 0);
			assert.match(result.stderr, /migration schemaVersion must be 1/);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
});

test("rejects packed release notes without the operational contract", async () => {
	const fixture = await fixtureTarball({
		extra: { "RELEASE_NOTES.md": "# Notas incompletas\n" },
	});
	try {
		const result = await validate(fixture.tarball);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /invalid packed release contract/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("rejects future agent catalog versions", async () => {
	const fixture = await fixtureTarball({ catalogVersion: 2 });
	try {
		const result = await validate(fixture.tarball);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /agent asset catalog schemaVersion must be 1/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("validates the real npm pack artifact reproducibly and installs it", {
	timeout: 120_000,
}, async () => {
	const result = await execFileAsync(process.execPath, [validator], {
		cwd: resolve("."),
		timeout: 120_000,
	});
	assert.match(result.stdout, /Packed distribution validation passed/);
	assert.match(result.stdout, /reproducible/);
	assert.match(result.stdout, /installable/);
});
