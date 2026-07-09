import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import piWorkflowExtension, {
	companionStatusLines,
	getCodeGraphReadiness,
	getCompanionState,
	loadCompanionsFromPath,
	manualInstallInstructions,
} from "../extensions/pi-workflow.ts";

function loadCompanionMetadata() {
	try {
		return JSON.parse(
			readFileSync(
				new URL("../assets/companions.json", import.meta.url),
				"utf8",
			),
		);
	} catch (error) {
		throw new Error(
			`Unable to load companion fixture metadata: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

const companionMetadata = loadCompanionMetadata();
const companion = companionMetadata.companions.find(
	({ package: packageName }) => packageName === "gentle-engram",
);
const codeGraphCompanion = {
	package: "@vndv/pi-codegraph",
	version: "0.1.10",
	description: "CodeGraph companion fixture",
};
const mismatchedInstalledVersion = "999.999.999-fixture";

test("registers expected pi-workflow commands", () => {
	const registeredCommands = [];
	const pi = {
		exec: async () => ({ code: 0 }),
		registerCommand: (name) => {
			registeredCommands.push(name);
		},
	};

	piWorkflowExtension(pi);

	assert.deepEqual(registeredCommands, [
		"pi-workflow-status",
		"pi-workflow-doctor",
		"pi-workflow-install-companions",
	]);
});

test("reports installed when exact companion version is installed", () => {
	const state = getCompanionState(companion, () => ({
		version: companion.version,
	}));
	assert.equal(state.status, "installed");
	assert.equal(state.installedVersion, companion.version);
});

test("reports version-mismatch when a different companion version is installed", () => {
	const state = getCompanionState(companion, () => ({
		version: mismatchedInstalledVersion,
	}));
	assert.equal(state.status, "version-mismatch");
	assert.equal(state.installedVersion, mismatchedInstalledVersion);
});

test("reports missing when companion package cannot be resolved", () => {
	const state = getCompanionState(companion, () => ({}));
	assert.equal(state.status, "missing");
	assert.equal(state.installedVersion, undefined);
});

test("reports metadata load errors instead of treating corrupt metadata as healthy", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-companions-"));
	try {
		const metadataPath = join(dir, "companions.json");
		await writeFile(metadataPath, "{ not json", "utf8");
		const result = loadCompanionsFromPath(metadataPath);
		assert.deepEqual(result.companions, []);
		assert.match(result.error ?? "", /Unable to load companion metadata/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("formats manual install fallback instructions for failed automatic installs", () => {
	const message = manualInstallInstructions([companion], "Install manually:");
	assert.equal(
		message,
		[
			"Install manually:",
			`pi install npm:${companion.package}@${companion.version}`,
			"Then run /reload.",
		].join("\n"),
	);
});

test("reports CodeGraph as recommended and missing without implying auto-installation", async () => {
	const { lines, level } = await companionStatusLines(
		"pi-workflow companion status",
		false,
		{
			companions: [codeGraphCompanion],
			resolveInstalledVersion: () => ({}),
		},
	);
	const message = lines.join("\n");

	assert.equal(level, "warning");
	assert.match(message, /@vndv\/pi-codegraph@0\.1\.10/);
	assert.match(message, /recommended/i);
	assert.match(message, /missing/);
	assert.match(message, /pi install npm:@vndv\/pi-codegraph@0\.1\.10/);
	assert.doesNotMatch(message, /auto-installed|automatically installed/i);
});

test("reports CodeGraph as installed when the companion is available", async () => {
	const { lines, level } = await companionStatusLines(
		"pi-workflow companion status",
		false,
		{
			companions: [codeGraphCompanion],
			resolveInstalledVersion: () => ({ version: "0.1.10" }),
		},
	);
	const message = lines.join("\n");

	assert.equal(level, "info");
	assert.match(message, /@vndv\/pi-codegraph@0\.1\.10/);
	assert.match(message, /installed/);
	assert.doesNotMatch(message, /missing/);
});

test("reports CodeGraph CLI readiness when the CLI is missing", async () => {
	const readiness = await getCodeGraphReadiness({
		companion: getCompanionState(codeGraphCompanion, () => ({ version: "0.1.10" })),
		exec: async () => ({ code: 127, stderr: "command not found" }),
		cwd: () => "/tmp/project",
		directoryExists: async () => true,
	});

	assert.equal(readiness.cli, "missing");
	assert.equal(readiness.index, "present");
	assert.match(readiness.messages.join("\n"), /CodeGraph CLI: missing/);
});

test("reports CodeGraph project index readiness when the index is missing", async () => {
	const readiness = await getCodeGraphReadiness({
		companion: getCompanionState(codeGraphCompanion, () => ({ version: "0.1.10" })),
		exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
		cwd: () => "/tmp/project",
		directoryExists: async (path) => path !== "/tmp/project/.codegraph",
	});

	assert.equal(readiness.cli, "available");
	assert.equal(readiness.index, "missing");
	assert.match(readiness.messages.join("\n"), /CodeGraph index: missing/);
	assert.match(readiness.messages.join("\n"), /codegraph init/);
});

test("reports CodeGraph ready when companion, CLI, and index are available", async () => {
	const readiness = await getCodeGraphReadiness({
		companion: getCompanionState(codeGraphCompanion, () => ({ version: "0.1.10" })),
		exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
		cwd: () => "/tmp/project",
		directoryExists: async () => true,
	});

	assert.equal(readiness.cli, "available");
	assert.equal(readiness.index, "present");
	assert.match(readiness.messages.join("\n"), /CodeGraph: ready/);
	assert.doesNotMatch(readiness.messages.join("\n"), /missing|warning/i);
});

test("reports CodeGraph project index missing when .codegraph is not a directory", async () => {
	const readiness = await getCodeGraphReadiness({
		companion: getCompanionState(codeGraphCompanion, () => ({ version: "0.1.10" })),
		exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
		cwd: () => "/tmp/project",
		directoryExists: async () => false,
	});

	assert.equal(readiness.cli, "available");
	assert.equal(readiness.index, "missing");
	assert.match(readiness.messages.join("\n"), /CodeGraph index: missing/);
});

test("doctor notification warns when CodeGraph CLI readiness is missing", async () => {
	const commands = new Map();
	const notifications = [];
	const pi = {
		exec: async () => ({ code: 127, stderr: "command not found" }),
		registerCommand: (name, definition) => {
			commands.set(name, definition);
		},
	};
	piWorkflowExtension(pi);

	await commands.get("pi-workflow-doctor").handler("", {
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
		},
	});

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "warning");
	assert.match(notifications[0].message, /CodeGraph CLI: missing/);
});

test("doctor notification warns when CodeGraph index readiness is missing", async () => {
	const { lines, level } = await companionStatusLines(
		"pi-workflow companion doctor",
		true,
		{
			companions: [codeGraphCompanion],
			resolveInstalledVersion: () => ({ version: "0.1.10" }),
			diagnosticAdapters: {
				exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
				cwd: () => "/tmp/project",
				directoryExists: async () => false,
			},
		},
	);

	assert.equal(level, "warning");
	assert.match(lines.join("\n"), /CodeGraph index: missing/);
});
