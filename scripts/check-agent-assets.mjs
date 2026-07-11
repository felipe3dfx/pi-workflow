#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(root, "assets/agents");
const catalogPath = resolve(root, "assets/agent-assets.json");
const digest = (content) => createHash("sha256").update(content).digest("hex");

async function generatedCatalog() {
	const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name)
		.sort();
	const assets = [];
	for (const filename of entries) {
		const content = await readFile(resolve(sourceDirectory, filename), "utf8");
		const name = filename.slice(0, -3);
		assets.push({
			kind: "agent",
			name,
			version: 1,
			source: `assets/agents/${filename}`,
			digest: digest(content),
		});
	}
	return `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`;
}

const expected = await generatedCatalog();
if (process.argv[2] === "--write") {
	await writeFile(catalogPath, expected);
	process.stdout.write("Wrote deterministic agent asset catalog.\n");
} else if (process.argv[2] === "--check") {
	const actual = await readFile(catalogPath, "utf8");
	if (actual !== expected) {
		process.stderr.write(
			"assets/agent-assets.json is stale. Run node scripts/check-agent-assets.mjs --write and review the generated inventory/digests.\n",
		);
		process.exitCode = 1;
	} else {
		process.stdout.write(
			"Agent asset catalog inventory and digests are current.\n",
		);
	}
} else {
	process.stderr.write("Usage: check-agent-assets.mjs <--check|--write>\n");
	process.exitCode = 2;
}
