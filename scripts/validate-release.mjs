#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredSections = [
	"Implemented",
	"Migrations",
	"Required sync",
	"Capability changes",
	"Rollback",
];

export function validateReleaseBody(body, expectedTag) {
	if (typeof body !== "string" || body.trim().length === 0) {
		throw new Error("GitHub Release body must be non-empty English Markdown");
	}
	if (!body.startsWith(`# Release ${expectedTag}\n`)) {
		throw new Error(`GitHub Release body title must identify ${expectedTag}`);
	}
	const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
	if (
		headings.length !== requiredSections.length ||
		headings.some((heading, index) => heading !== requiredSections[index])
	) {
		throw new Error(
			`GitHub Release body must contain exactly these ordered English sections: ${requiredSections.join(", ")}`,
		);
	}
	for (const [index, section] of requiredSections.entries()) {
		const marker = `## ${section}`;
		const start = body.indexOf(marker) + marker.length;
		const next = requiredSections[index + 1];
		const end = next ? body.indexOf(`## ${next}`, start) : body.length;
		if (start < marker.length || end < start || body.slice(start, end).trim().length === 0) {
			throw new Error(`GitHub Release body section ${section} must be non-empty`);
		}
	}
	return { sections: [...requiredSections] };
}

export function validateRelease({ manifest, tag, body }) {
	if (
		!manifest ||
		typeof manifest !== "object" ||
		manifest.name !== "@felipe.3dfx/pi-workflow" ||
		typeof manifest.version !== "string" ||
		!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
	) {
		throw new Error("release package metadata is invalid");
	}
	const expectedTag = `v${manifest.version}`;
	if ((tag === undefined) !== (body === undefined)) {
		throw new Error("release tag and release body must be validated together");
	}
	if (tag !== undefined) {
		if (tag !== expectedTag) {
			throw new Error(
				`release tag ${String(tag)} does not match package version ${expectedTag}`,
			);
		}
		validateReleaseBody(body, expectedTag);
	}
	return { packageName: manifest.name, version: manifest.version, tag: expectedTag };
}

async function main() {
	const args = process.argv.slice(2);
	const eventIndex = args.indexOf("--event");
	if (
		(eventIndex !== -1 && (!args[eventIndex + 1] || args.length !== 2)) ||
		(eventIndex === -1 && args.length !== 0)
	) {
		throw new Error("Usage: validate-release.mjs [--event <github-event.json>]");
	}
	const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
	let tag;
	let body;
	if (eventIndex !== -1) {
		const event = JSON.parse(await readFile(resolve(args[eventIndex + 1]), "utf8"));
		tag = event.release?.tag_name;
		body = event.release?.body;
	}
	const result = validateRelease({ manifest, tag, body });
	process.stdout.write(`Release validation passed for ${result.tag}.\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((error) => {
		process.stderr.write(
			`pi-workflow release validation failed:\n\n${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
