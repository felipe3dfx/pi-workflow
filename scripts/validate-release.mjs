#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredSections = [
	"Migraciones",
	"Sync requerido",
	"Cambios de capacidades",
	"Rollback",
];

function normalizedMarkdown(value) {
	return value.replaceAll("\r\n", "\n").trim();
}

export function validateReleaseNotes(notes) {
	if (typeof notes !== "string" || notes.trim().length === 0) {
		throw new Error("release notes must be non-empty Markdown");
	}
	const headings = [...notes.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
	if (
		headings.length !== requiredSections.length ||
		headings.some((heading, index) => heading !== requiredSections[index])
	) {
		throw new Error(
			`release notes must contain exactly these ordered sections: ${requiredSections.join(", ")}`,
		);
	}
	for (const [index, section] of requiredSections.entries()) {
		const start = notes.indexOf(`## ${section}`) + `## ${section}`.length;
		const next = requiredSections[index + 1];
		const end = next ? notes.indexOf(`## ${next}`, start) : notes.length;
		if (
			start < `## ${section}`.length ||
			end < start ||
			notes.slice(start, end).trim().length === 0
		) {
			throw new Error(`release notes section ${section} must be non-empty`);
		}
	}
	return { sections: [...requiredSections] };
}

export function validateRelease({ manifest, notes, tag, body }) {
	validateReleaseNotes(notes);
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
	if (
		!normalizedMarkdown(notes).startsWith(
			`# Notas de release — ${expectedTag}\n`,
		)
	) {
		throw new Error(`release notes title must identify ${expectedTag}`);
	}
	if ((tag === undefined) !== (body === undefined)) {
		throw new Error("release tag and release body must be validated together");
	}
	if (tag !== undefined) {
		if (tag !== expectedTag) {
			throw new Error(
				`release tag ${String(tag)} does not match package version ${expectedTag}`,
			);
		}
		if (typeof body !== "string" || body !== notes) {
			throw new Error("release body does not exactly match RELEASE_NOTES.md");
		}
	}
	return {
		packageName: manifest.name,
		version: manifest.version,
		tag: expectedTag,
	};
}

async function main() {
	const args = process.argv.slice(2);
	const eventIndex = args.indexOf("--event");
	if (
		(eventIndex !== -1 && (!args[eventIndex + 1] || args.length !== 2)) ||
		(eventIndex === -1 && args.length !== 0)
	) {
		throw new Error(
			"Usage: validate-release.mjs [--event <github-event.json>]",
		);
	}
	const [manifest, notes] = await Promise.all([
		readFile(resolve("package.json"), "utf8").then(JSON.parse),
		readFile(resolve("RELEASE_NOTES.md"), "utf8"),
	]);
	let tag;
	let body;
	if (eventIndex !== -1) {
		const event = JSON.parse(
			await readFile(resolve(args[eventIndex + 1]), "utf8"),
		);
		if (
			!event ||
			typeof event !== "object" ||
			!event.release ||
			typeof event.release !== "object"
		) {
			throw new Error("GitHub event does not contain a release payload");
		}
		tag = event.release.tag_name;
		body = event.release.body;
	}
	const result = validateRelease({ manifest, notes, tag, body });
	process.stdout.write(`Release validation passed for ${result.tag}.\n`);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((error) => {
		process.stderr.write(
			`pi-workflow release validation failed:\n\n${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
