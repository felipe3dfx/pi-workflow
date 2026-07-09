#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const defaultTargets = ["test"];
const targetArgs = process.argv.slice(2);
const targets = targetArgs.length > 0 ? targetArgs : defaultTargets;
const focusPattern = /\b(?:test|it|describe|suite)\s*\.\s*only\s*\(/g;
const testFilePattern = /\.(?:test|spec)\.mjs$/;
const errors = [];

async function collectTestFiles(target) {
	const absoluteTarget = path.resolve(root, target);
	let info;
	try {
		info = await stat(absoluteTarget);
	} catch {
		return [];
	}

	if (info.isFile()) {
		return testFilePattern.test(absoluteTarget) ? [absoluteTarget] : [];
	}

	if (!info.isDirectory()) return [];

	const entries = await readdir(absoluteTarget, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => collectTestFiles(path.join(absoluteTarget, entry.name))),
	);
	return files.flat();
}

function lineAndColumn(source, index) {
	const beforeMatch = source.slice(0, index);
	const lines = beforeMatch.split("\n");
	return {
		line: lines.length,
		column: lines.at(-1).length + 1,
	};
}

for (const target of targets) {
	const files = await collectTestFiles(target);
	for (const file of files) {
		const source = await readFile(file, "utf8");
		for (const match of source.matchAll(focusPattern)) {
			const { line, column } = lineAndColumn(source, match.index ?? 0);
			errors.push(
				`${path.relative(root, file)}:${line}:${column} contains focused test marker ${match[0]}`,
			);
		}
	}
}

if (errors.length > 0) {
	console.error("Focused tests are not allowed in committed test files:");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log("No focused tests found.");
