import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import piWorkflowExtension from "../extensions/pi-workflow.ts";

const fixtureCompanions = [
	{ package: "gentle-engram", version: "0.1.10" },
	{ package: "@vndv/pi-codegraph", version: "0.1.10" },
];

async function withMetadataFile(companions, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-companions-"));
	try {
		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({ schemaVersion: 1, companions }),
			"utf8",
		);
		return await run({ dir, metadataPath });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function createInstalledVersionResolver(installedVersions = {}, errors = {}) {
	return (packageName) => {
		if (errors[packageName]) return { error: errors[packageName] };
		if (installedVersions[packageName]) {
			return { version: installedVersions[packageName] };
		}
		return {};
	};
}

function registerCommands(
	workflowOptions = {},
	exec = async () => ({ code: 0 }),
) {
	const commands = new Map();
	const pi = {
		exec,
		registerCommand: (name, definition) => {
			commands.set(name, definition);
		},
	};

	piWorkflowExtension(pi, workflowOptions);

	return commands;
}

test("registers expected pi-workflow commands", () => {
	const commands = registerCommands();

	assert.deepEqual(
		[...commands.keys()],
		[
			"pi-workflow-status",
			"pi-workflow-doctor",
			"pi-workflow-install-companions",
		],
	);
});

test("status command reports companion state through the public command handler", async () => {
	await withMetadataFile(fixtureCompanions, async ({ metadataPath }) => {
		const notifications = [];
		const commands = registerCommands({
			catalog: {
				metadataPath,
				resolveInstalledVersion: createInstalledVersionResolver({
					"gentle-engram": "0.1.10",
				}),
			},
		});

		await commands.get("pi-workflow-status").handler("", {
			ui: {
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].message, /pi-workflow companion status/);
		assert.match(
			notifications[0].message,
			/gentle-engram@0\.1\.10 — installed/,
		);
		assert.match(
			notifications[0].message,
			/@vndv\/pi-codegraph@0\.1\.10 — missing/,
		);
		assert.match(
			notifications[0].message,
			/pi install npm:@vndv\/pi-codegraph@0\.1\.10/,
		);
	});
});

test("doctor command reports a missing CodeGraph index from a cwd without .codegraph", async () => {
	await withMetadataFile(fixtureCompanions, async ({ dir, metadataPath }) => {
		const notifications = [];
		const commands = registerCommands({
			catalog: {
				metadataPath,
				resolveInstalledVersion: createInstalledVersionResolver({
					"gentle-engram": "0.1.10",
					"@vndv/pi-codegraph": "0.1.10",
				}),
			},
			diagnostics: {
				exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
				cwd: () => dir,
			},
		});

		await commands.get("pi-workflow-doctor").handler("", {
			ui: {
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].message, /CodeGraph index: missing/);
		assert.match(
			notifications[0].message,
			/codegraph init <project-root>|codegraph init .*explicitly/,
		);
		assert.doesNotMatch(notifications[0].message, /CodeGraph index: unknown/);
	});
});

test("install command prints documented manual commands without executing installs in non-UI mode", async () => {
	await withMetadataFile(fixtureCompanions, async ({ metadataPath }) => {
		const notifications = [];
		const execCalls = [];
		const commands = registerCommands(
			{
				catalog: {
					metadataPath,
					resolveInstalledVersion: createInstalledVersionResolver(),
				},
			},
			async (command, args) => {
				execCalls.push({ command, args });
				return { code: 0 };
			},
		);

		await commands.get("pi-workflow-install-companions").handler("", {
			ui: {
				notify: (message, level) => notifications.push({ message, level }),
			},
			hasUI: false,
		});

		assert.deepEqual(execCalls, []);
		assert.deepEqual(notifications, [
			{
				level: "warning",
				message: [
					"Install or update pi-workflow companions manually:",
					"pi install npm:gentle-engram@0.1.10",
					"pi install npm:@vndv/pi-codegraph@0.1.10",
					"Then run /reload.",
				].join("\n"),
			},
		]);
	});
});
