import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import piWorkflowExtension, {
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
