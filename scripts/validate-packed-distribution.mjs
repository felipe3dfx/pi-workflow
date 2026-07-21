#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workflows = [
	"define-product",
	"deliver-ticket",
	"product-review",
	"qa-handoff",
];
const obsoleteShims = new Set([
	"extensions/gentle-engram.ts",
	"extensions/pi-mcp-adapter.ts",
	"extensions/pi-subagents.ts",
	"extensions/pi-web-access.ts",
]);
const allowedRoots = [
	"assets/",
	"extensions/",
	"prompts/",
	"scripts/",
	"skills/",
];
const allowedFiles = new Set(["LICENSE", "README.md", "package.json"]);
const required = [
	"package.json",
	"README.md",
	"scripts/pi-workflow-sync.mjs",
	"scripts/acceptance-evidence.mjs",
	"scripts/check-acceptance.mjs",
	"scripts/run-packed-acceptance.mjs",
	"scripts/validate-release.mjs",
	"extensions/pi-workflow.ts",
	"extensions/agent-asset-migrations.ts",
	"extensions/agent-validator.ts",
	"assets/agent-assets.json",
	"assets/agent-asset-migrations.json",
	"assets/schemas/agent-assets.schema.json",
	"assets/schemas/agent-asset-migrations.schema.json",
	"assets/acceptance/qa-handoff.golden.md",
	"assets/acceptance/product-review.golden.md",
	...workflows.flatMap((name) => [
		`skills/${name}/SKILL.md`,
		`prompts/${name}.md`,
	]),
];
const digest = (content) => createHash("sha256").update(content).digest("hex");

async function filesUnder(root, directory = root) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
		else if (entry.isFile())
			files.push(relative(root, path).replaceAll("\\", "/"));
	}
	return files.sort();
}

function check(condition, message, errors) {
	if (!condition) errors.push(message);
}

async function validateExtracted(packageRoot) {
	const errors = [];
	const files = await filesUnder(packageRoot);
	const fileSet = new Set(files);
	for (const path of required)
		check(
			fileSet.has(path),
			`missing required packed resource: ${path}`,
			errors,
		);
	for (const path of files) {
		if (
			(path.startsWith("skills/") &&
				!workflows.some((name) => path === `skills/${name}/SKILL.md`)) ||
			(path.startsWith("prompts/") &&
				!workflows.some((name) => path === `prompts/${name}.md`))
		)
			errors.push(`forbidden public resource: ${path}`);
		else if (path.includes("node_modules/") || obsoleteShims.has(path))
			errors.push(`forbidden packed resource: ${path}`);
		else if (
			!allowedFiles.has(path) &&
			!allowedRoots.some((root) => path.startsWith(root))
		)
			errors.push(`unsupported packed resource: ${path}`);
	}

	let manifest;
	try {
		manifest = JSON.parse(
			await readFile(join(packageRoot, "package.json"), "utf8"),
		);
	} catch (error) {
		errors.push(
			`invalid packed package.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (manifest) {
		check(
			manifest.engines?.node === ">=22.19",
			"packed engines.node must be >=22.19",
			errors,
		);
		check(
			manifest.bin?.["pi-workflow-sync"] === "./scripts/pi-workflow-sync.mjs",
			"packed package must expose the pi-workflow-sync entrypoint",
			errors,
		);
		check(
			JSON.stringify(manifest.pi?.extensions) ===
				JSON.stringify(["./extensions/pi-workflow.ts"]),
			"packed pi manifest must expose only the local pi-workflow extension",
			errors,
		);
		check(
			JSON.stringify(manifest.pi?.skills) === JSON.stringify(["./skills"]),
			"packed pi.skills must expose only ./skills",
			errors,
		);
		check(
			JSON.stringify(manifest.pi?.prompts) === JSON.stringify(["./prompts"]),
			"packed pi.prompts must expose only ./prompts",
			errors,
		);
		check(
			!manifest.dependencies || Object.keys(manifest.dependencies).length === 0,
			"packed package must not define runtime dependencies",
			errors,
		);
		check(
			!(
				manifest.bundledDependencies?.length ||
				manifest.bundleDependencies?.length
			),
			"packed package must not bundle dependencies",
			errors,
		);
	}

	for (const name of workflows) {
		if (!fileSet.has(`prompts/${name}.md`)) continue;
		const prompt = await readFile(
			join(packageRoot, `prompts/${name}.md`),
			"utf8",
		);
		const frontmatterEnd = prompt.indexOf("\n---\n", 4);
		const body = frontmatterEnd === -1 ? "" : prompt.slice(frontmatterEnd + 5);
		check(
			prompt.startsWith("---\n") &&
				body ===
					`Load and follow the \`${name}\` skill.\n\nArguments: $ARGUMENTS\n`,
			`public prompt ${name} contains duplicated workflow prose`,
			errors,
		);
	}

	try {
		const migrationRegistry = JSON.parse(
			await readFile(
				join(packageRoot, "assets/agent-asset-migrations.json"),
				"utf8",
			),
		);
		check(
			migrationRegistry.schemaVersion === 1,
			"agent asset migration schemaVersion must be 1",
			errors,
		);
		check(
			Array.isArray(migrationRegistry.migrations),
			"agent asset migration registry must define migrations[]",
			errors,
		);
		if (Array.isArray(migrationRegistry.migrations)) {
			const links = new Set();
			for (const [index, step] of migrationRegistry.migrations.entries()) {
				check(
					typeof step.subject === "string" && step.subject.length > 0,
					`agent asset migration ${index} must name a subject`,
					errors,
				);
				check(
					Number.isInteger(step.fromVersion) &&
						step.fromVersion > 0 &&
						step.toVersion === step.fromVersion + 1,
					`agent asset migration ${index} must be an adjacent version fixture`,
					errors,
				);
				check(
					/^[a-f0-9]{64}$/.test(step.fromDigest ?? "") &&
						/^[a-f0-9]{64}$/.test(step.toDigest ?? ""),
					`agent asset migration ${index} must bind supported digests`,
					errors,
				);
				const link = `${step.subject}:${step.fromVersion}:${step.toVersion}`;
				check(
					!links.has(link),
					`agent asset migration registry contains duplicate link ${link}`,
					errors,
				);
				links.add(link);
			}
		}
		for (const schema of [
			"agent-assets.schema.json",
			"agent-asset-migrations.schema.json",
		]) {
			const document = JSON.parse(
				await readFile(join(packageRoot, "assets/schemas", schema), "utf8"),
			);
			check(
				document.$schema === "https://json-schema.org/draft/2020-12/schema",
				`packed schema ${schema} must use JSON Schema 2020-12`,
				errors,
			);
		}
	} catch (error) {
		errors.push(
			`invalid packed schema or migration registry: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	try {
		const catalog = JSON.parse(
			await readFile(join(packageRoot, "assets/agent-assets.json"), "utf8"),
		);
		check(
			catalog.schemaVersion === 1,
			"agent asset catalog schemaVersion must be 1",
			errors,
		);
		check(
			Array.isArray(catalog.assets) && catalog.assets.length > 0,
			"agent asset catalog must contain assets",
			errors,
		);
		if (Array.isArray(catalog.assets)) {
			const catalogSources = new Set();
			for (const asset of catalog.assets) {
				check(
					asset.version === 1,
					`agent asset ${asset.name ?? "unknown"} version must be 1`,
					errors,
				);
				check(
					typeof asset.source === "string" &&
						asset.source.startsWith("assets/agents/"),
					`agent asset ${asset.name ?? "unknown"} must use a packaged local source`,
					errors,
				);
				if (typeof asset.source !== "string") continue;
				catalogSources.add(asset.source);
				if (!fileSet.has(asset.source))
					errors.push(`agent asset catalog source is missing: ${asset.source}`);
				else
					check(
						digest(await readFile(join(packageRoot, asset.source))) ===
							asset.digest,
						`agent asset catalog digest mismatch: ${asset.source}`,
						errors,
					);
			}
			for (const source of files.filter(
				(path) => path.startsWith("assets/agents/") && path.endsWith(".md"),
			))
				check(
					catalogSources.has(source),
					`agent asset is absent from catalog: ${source}`,
					errors,
				);
		}
	} catch (error) {
		errors.push(
			`invalid agent asset catalog: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return { errors, files };
}

async function extract(tarball, destination) {
	await mkdir(destination, { recursive: true });
	await execFileAsync("tar", ["-xzf", tarball, "-C", destination]);
	return join(destination, "package");
}

async function semanticDigest(packageRoot, files) {
	const hash = createHash("sha256");
	for (const path of files) {
		const info = await stat(join(packageRoot, path));
		hash.update(`${path}\0${info.mode & 0o777}\0`);
		hash.update(await readFile(join(packageRoot, path)));
	}
	return hash.digest("hex");
}

async function npmPack(root, destination) {
	const { stdout } = await execFileAsync(
		"npm",
		["pack", "--json", "--pack-destination", destination, "--ignore-scripts"],
		{ cwd: root },
	);
	const result = JSON.parse(stdout);
	if (!Array.isArray(result) || !result[0]?.filename)
		throw new Error("npm pack did not report a tarball");
	return join(destination, result[0].filename);
}

async function main() {
	const suppliedIndex = process.argv.indexOf("--tarball");
	const workspace = await mkdtemp(join(tmpdir(), "pi-workflow-distribution-"));
	try {
		if (suppliedIndex !== -1) {
			const tarball = process.argv[suppliedIndex + 1];
			if (!tarball) throw new Error("--tarball requires a path");
			const packageRoot = await extract(
				resolve(tarball),
				join(workspace, "extract"),
			);
			const { errors } = await validateExtracted(packageRoot);
			if (errors.length) throw new Error(errors.join("\n"));
			process.stdout.write("Packed distribution validation passed.\n");
			return;
		}

		const packA = join(workspace, "pack-a");
		const packB = join(workspace, "pack-b");
		await mkdir(packA);
		await mkdir(packB);
		const [tarballA, tarballB] = await Promise.all([
			npmPack(process.cwd(), packA),
			npmPack(process.cwd(), packB),
		]);
		const rootA = await extract(tarballA, join(workspace, "extract-a"));
		const rootB = await extract(tarballB, join(workspace, "extract-b"));
		const resultA = await validateExtracted(rootA);
		const resultB = await validateExtracted(rootB);
		const errors = [...resultA.errors, ...resultB.errors];
		if (errors.length) throw new Error([...new Set(errors)].join("\n"));
		if (
			(await semanticDigest(rootA, resultA.files)) !==
			(await semanticDigest(rootB, resultB.files))
		)
			throw new Error("npm pack output is not reproducible");

		const installRoot = join(workspace, "install");
		await mkdir(installRoot);
		await writeFile(join(installRoot, "package.json"), '{"private":true}\n');
		await execFileAsync(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-package-lock",
				"--no-audit",
				"--no-fund",
				tarballA,
			],
			{ cwd: installRoot },
		);
		await stat(
			join(
				installRoot,
				"node_modules",
				"@felipe.3dfx",
				"pi-workflow",
				"package.json",
			),
		);
		process.stdout.write(
			"Packed distribution validation passed: semantically reproducible and installable.\n",
		);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

main().catch((error) => {
	process.stderr.write(
		`pi-workflow packed distribution validation failed:\n\n${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
