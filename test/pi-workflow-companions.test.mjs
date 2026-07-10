import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	createCompanionWorkflow,
	getCodeGraphReadiness,
	getCompanionState,
	loadCompanionsFromPath,
	manualInstallInstructions,
} from "../extensions/companion-workflow.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

function loadJsonFixture(relativePath) {
	try {
		return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
	} catch (error) {
		throw new Error(
			`Unable to load fixture metadata at ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

const companionMetadata = loadJsonFixture("../assets/companions.json");
const mcpServerCatalog = loadJsonFixture("../assets/mcp-servers.json");
const companion = companionMetadata.companions.find(
	({ package: packageName }) => packageName === "gentle-engram",
);
const codeGraphCompanion = {
	package: "@vndv/pi-codegraph",
	version: "0.1.10",
	description: "CodeGraph companion fixture",
};
const fixtureCompanions = [
	{ package: "gentle-engram", version: "0.1.10" },
	{ package: "@vndv/pi-codegraph", version: "0.1.10" },
];
const mismatchedInstalledVersion = "999.999.999-fixture";

function restoreEnv(snapshot) {
	for (const [name, value] of Object.entries(snapshot)) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
}

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

async function writePackageFixture(nodeModulesPath, packageName, packageJson) {
	const packageDir = join(nodeModulesPath, packageName);
	mkdirSync(packageDir, { recursive: true });
	await writeFile(
		join(packageDir, "package.json"),
		JSON.stringify({ name: packageName, ...packageJson }),
		"utf8",
	);
}

async function writeInstalledCompanionFixtures(nodeModulesPath) {
	for (const configuredCompanion of companionMetadata.companions) {
		await writePackageFixture(nodeModulesPath, configuredCompanion.package, {
			version: configuredCompanion.version,
		});
	}
}

function createExtensionHarness(execImpl = async () => ({ code: 0 })) {
	const commands = new Map();
	const execCalls = [];
	const pi = {
		exec: async (command, args = []) => {
			execCalls.push({ command, args });
			return execImpl(command, args);
		},
		registerCommand: (name, definition) => {
			commands.set(name, definition);
		},
	};

	piWorkflowExtension(pi);

	return { commands, execCalls };
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

test("reports companions installed from Pi's npm package directory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-home-"));
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		delete process.env.PI_WORKFLOW_COMPANION_NODE_MODULES;
		await writePackageFixture(
			join(dir, ".pi", "agent", "npm", "node_modules"),
			companion.package,
			{ version: companion.version },
		);
		process.env.HOME = dir;

		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({ companions: [companion] }),
			"utf8",
		);

		const workflow = createCompanionWorkflow({ catalog: { metadataPath } });
		const { message, level } = await workflow.inspect();

		assert.equal(level, "info");
		assert.match(message, /gentle-engram@0\.1\.10/);
		assert.match(message, /installed/);
		assert.doesNotMatch(message, /missing/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("reports scoped companions installed from an explicit Pi node_modules path", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-node-modules-"));
	const envSnapshot = {
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writePackageFixture(dir, codeGraphCompanion.package, {
			version: codeGraphCompanion.version,
			exports: { "./extensions/codegraph": "./extensions/codegraph.ts" },
		});
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = dir;

		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({ companions: [codeGraphCompanion] }),
			"utf8",
		);

		const workflow = createCompanionWorkflow({ catalog: { metadataPath } });
		const { message, level } = await workflow.inspect();

		assert.equal(level, "info");
		assert.match(message, /@vndv\/pi-codegraph@0\.1\.10/);
		assert.match(message, /installed/);
		assert.doesNotMatch(message, /missing/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("PI_WORKFLOW_COMPANION_NODE_MODULES takes precedence over the fake HOME copy when both define the package", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-precedence-"));
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		delete process.env.PI_AGENT_HOME;
		const envNodeModules = join(dir, "env-node-modules");
		await writePackageFixture(envNodeModules, "precedence-fixture-pkg", {
			version: "3.0.0",
		});
		await writePackageFixture(
			join(dir, ".pi", "agent", "npm", "node_modules"),
			"precedence-fixture-pkg",
			{ version: "2.0.0" },
		);
		process.env.HOME = dir;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = envNodeModules;

		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({
				companions: [{ package: "precedence-fixture-pkg", version: "3.0.0" }],
			}),
			"utf8",
		);

		const workflow = createCompanionWorkflow({ catalog: { metadataPath } });
		const { message } = await workflow.inspect();

		assert.match(message, /precedence-fixture-pkg@3\.0\.0 — installed 3\.0\.0, installed/);
		assert.doesNotMatch(message, /installed 2\.0\.0/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("PI_AGENT_HOME overrides HOME for the agent-home node_modules path", async () => {
	const ignoredHome = await mkdtemp(join(tmpdir(), "pi-workflow-agent-home-ignored-"));
	const agentHomeDir = await mkdtemp(join(tmpdir(), "pi-workflow-agent-home-active-"));
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		delete process.env.PI_WORKFLOW_COMPANION_NODE_MODULES;
		await writePackageFixture(
			join(ignoredHome, ".pi", "agent", "npm", "node_modules"),
			"agent-home-fixture-pkg",
			{ version: "1.2.3" },
		);
		await writePackageFixture(
			join(agentHomeDir, "npm", "node_modules"),
			"agent-home-fixture-pkg",
			{ version: "4.5.6" },
		);
		process.env.HOME = ignoredHome;
		process.env.PI_AGENT_HOME = agentHomeDir;

		const metadataPath = join(agentHomeDir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({
				companions: [{ package: "agent-home-fixture-pkg", version: "4.5.6" }],
			}),
			"utf8",
		);

		const workflow = createCompanionWorkflow({ catalog: { metadataPath } });
		const { message } = await workflow.inspect();

		assert.match(message, /agent-home-fixture-pkg@4\.5\.6 — installed 4\.5\.6, installed/);
		assert.doesNotMatch(message, /installed 1\.2\.3/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(ignoredHome, { recursive: true, force: true });
		await rm(agentHomeDir, { recursive: true, force: true });
	}
});

test("reports error status when the installed package.json does not define a version", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-no-version-"));
	const envSnapshot = {
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		const nodeModulesPath = join(dir, "node_modules");
		await writePackageFixture(nodeModulesPath, "no-version-fixture-pkg", {});
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;

		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({
				companions: [{ package: "no-version-fixture-pkg", version: "1.0.0" }],
			}),
			"utf8",
		);

		const workflow = createCompanionWorkflow({ catalog: { metadataPath } });
		const { message } = await workflow.inspect();

		assert.match(message, /no-version-fixture-pkg@1\.0\.0 — error/);
		assert.match(message, /does not define a version/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("reports error status with the underlying error when the installed package.json is unreadable", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-unreadable-"));
	const envSnapshot = {
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		const nodeModulesPath = join(dir, "node_modules");
		const packageJsonAsDirectory = join(
			nodeModulesPath,
			"unreadable-fixture-pkg",
			"package.json",
		);
		// ponytail: a directory named package.json is a portable way to force an
		// unreadable/non-JSON read failure without relying on chmod, which is
		// unreliable across CI file systems (e.g. when running as root).
		mkdirSync(packageJsonAsDirectory, { recursive: true });
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;

		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({
				companions: [{ package: "unreadable-fixture-pkg", version: "1.0.0" }],
			}),
			"utf8",
		);

		const workflow = createCompanionWorkflow({ catalog: { metadataPath } });
		const { message } = await workflow.inspect();

		assert.match(message, /unreadable-fixture-pkg@1\.0\.0 — error/);
		assert.doesNotMatch(message, /unreadable-fixture-pkg@1\.0\.0 — .*missing/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
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
	await withMetadataFile([codeGraphCompanion], async ({ metadataPath }) => {
		const workflow = createCompanionWorkflow({
			catalog: { metadataPath, resolveInstalledVersion: () => ({}) },
		});
		const { message, level } = await workflow.inspect();

		assert.equal(level, "warning");
		assert.match(message, /@vndv\/pi-codegraph@0\.1\.10/);
		assert.match(message, /recommended/i);
		assert.match(message, /missing/);
		assert.match(message, /pi install npm:@vndv\/pi-codegraph@0\.1\.10/);
		assert.doesNotMatch(message, /auto-installed|automatically installed/i);
	});
});

test("reports CodeGraph as installed when the companion is available", async () => {
	await withMetadataFile([codeGraphCompanion], async ({ metadataPath }) => {
		const workflow = createCompanionWorkflow({
			catalog: {
				metadataPath,
				resolveInstalledVersion: () => ({ version: "0.1.10" }),
			},
		});
		const { message, level } = await workflow.inspect();

		assert.equal(level, "info");
		assert.match(message, /@vndv\/pi-codegraph@0\.1\.10/);
		assert.match(message, /installed/);
		assert.doesNotMatch(message, /missing/);
	});
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
	await withMetadataFile([codeGraphCompanion], async ({ metadataPath }) => {
		const workflow = createCompanionWorkflow({
			catalog: {
				metadataPath,
				resolveInstalledVersion: () => ({ version: "0.1.10" }),
			},
			diagnostics: {
				exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
				cwd: () => "/tmp/project",
				directoryExists: async () => false,
			},
		});
		const { message, level } = await workflow.diagnose();

		assert.equal(level, "warning");
		assert.match(message, /CodeGraph index: missing/);
	});
});

test("install command configures the exact MCP catalog after confirmation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-install-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;

		const { commands, execCalls } = createExtensionHarness();
		const confirmations = [];
		const notifications = [];
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async (title, message) => {
					confirmations.push({ title, message });
					return true;
				},
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(execCalls.length, 0);
		assert.equal(confirmations.length, 1);
		assert.match(confirmations[0].title, /configure mcp servers/i);
		assert.match(confirmations[0].message, /context7/);
		assert.match(confirmations[0].message, /linear/);
		assert.match(confirmations[0].message, /sentry/);

		const config = JSON.parse(
			await readFile(join(dir, ".pi", "agent", "mcp.json"), "utf8"),
		);
		assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /Configured pi-workflow MCP servers/);
		assert.match(notifications[0].message, /\/reload/);
		assert.match(notifications[0].message, /Authenticate Sentry\/Linear/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command drives the real pi.exec adapter for a version-mismatched companion", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mismatch-install-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		for (const configuredCompanion of companionMetadata.companions) {
			const installedVersion =
				configuredCompanion.package === codeGraphCompanion.package
					? "0.0.1"
					: configuredCompanion.version;
			await writePackageFixture(nodeModulesPath, configuredCompanion.package, {
				version: installedVersion,
			});
		}
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		await writeFile(
			join(dir, ".pi", "agent", "mcp.json"),
			`${JSON.stringify({ mcpServers: mcpServerCatalog.mcpServers }, null, 2)}\n`,
			"utf8",
		);

		const { commands, execCalls } = createExtensionHarness();
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async () => true,
				notify: () => {},
			},
		});

		assert.deepEqual(execCalls, [
			{ command: "pi", args: ["install", "npm:@vndv/pi-codegraph@0.1.10"] },
		]);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command preserves unrelated top-level fields and unrelated MCP servers", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-preserve-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		await writeFile(
			configPath,
			`${JSON.stringify(
				{
					telemetry: { enabled: true },
					mcpServers: {
						custom: { url: "https://example.test/mcp" },
						context7: mcpServerCatalog.mcpServers.context7,
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const { commands } = createExtensionHarness();
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async () => true,
				notify: () => {},
			},
		});

		const config = JSON.parse(await readFile(configPath, "utf8"));
		assert.deepEqual(config, {
			telemetry: { enabled: true },
			mcpServers: {
				custom: { url: "https://example.test/mcp" },
				...mcpServerCatalog.mcpServers,
			},
		});
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command re-reads MCP config after confirmation and preserves concurrent unrelated changes", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-reread-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		await writeFile(
			configPath,
			`${JSON.stringify(
				{
					telemetry: { enabled: true },
					mcpServers: {
						custom: { url: "https://example.test/original" },
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const { commands } = createExtensionHarness();
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async () => {
					await writeFile(
						configPath,
						`${JSON.stringify(
							{
								telemetry: { enabled: true },
								diagnostics: { verbose: true },
								mcpServers: {
									custom: { url: "https://example.test/original" },
									customAfterPreview: { url: "https://example.test/new" },
								},
							},
							null,
							2,
						)}\n`,
						"utf8",
					);
					return true;
				},
				notify: () => {},
			},
		});

		const config = JSON.parse(await readFile(configPath, "utf8"));
		assert.deepEqual(config, {
			telemetry: { enabled: true },
			diagnostics: { verbose: true },
			mcpServers: {
				custom: { url: "https://example.test/original" },
				customAfterPreview: { url: "https://example.test/new" },
				...mcpServerCatalog.mcpServers,
			},
		});
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command is a no-op when the exact MCP catalog is already configured", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-noop-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		const existingConfig = `{
  "mcpServers": {
    "custom": { "url": "https://example.test/mcp" },
    "context7": ${JSON.stringify(mcpServerCatalog.mcpServers.context7)},
    "sentry": ${JSON.stringify(mcpServerCatalog.mcpServers.sentry)},
    "linear": ${JSON.stringify(mcpServerCatalog.mcpServers.linear)}
  },
  "telemetry": { "enabled": true }
}\n`;
		await writeFile(configPath, existingConfig, "utf8");

		const { commands, execCalls } = createExtensionHarness();
		const confirmations = [];
		const notifications = [];
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async (title, message) => {
					confirmations.push({ title, message });
					return true;
				},
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(execCalls.length, 0);
		assert.equal(confirmations.length, 0);
		assert.equal(await readFile(configPath, "utf8"), existingConfig);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /already configured/i);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command previews conflicting MCP definitions before replacement", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-conflict-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		const existingConfig = {
			mcpServers: {
				linear: { url: "https://example.test/linear" },
			},
		};
		await writeFile(configPath, `${JSON.stringify(existingConfig, null, 2)}\n`, "utf8");

		const { commands } = createExtensionHarness();
		const confirmations = [];
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async (title, message) => {
					confirmations.push({ title, message });
					return false;
				},
				notify: () => {},
			},
		});

		assert.equal(confirmations.length, 1);
		assert.match(confirmations[0].message, /replace MCP server definitions/i);
		assert.match(confirmations[0].message, /linear/);
		assert.match(confirmations[0].message, /https:\/\/example\.test\/linear/);
		assert.match(
			confirmations[0].message,
			/https:\/\/mcp\.linear\.app\/mcp/,
		);
		assert.equal(
			await readFile(configPath, "utf8"),
			`${JSON.stringify(existingConfig, null, 2)}\n`,
		);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command refuses to overwrite targeted MCP servers changed after preview", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-preview-conflict-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		await writeFile(
			configPath,
			`${JSON.stringify(
				{
					mcpServers: {
						custom: { url: "https://example.test/custom" },
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const { commands } = createExtensionHarness();
		const notifications = [];
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async () => {
					await writeFile(
						configPath,
						`${JSON.stringify(
							{
								mcpServers: {
									custom: { url: "https://example.test/custom" },
									linear: { url: "https://example.test/changed-after-preview" },
								},
							},
							null,
							2,
						)}\n`,
						"utf8",
					);
					return true;
				},
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(
			await readFile(configPath, "utf8"),
			`${JSON.stringify(
				{
					mcpServers: {
						custom: { url: "https://example.test/custom" },
						linear: { url: "https://example.test/changed-after-preview" },
					},
				},
				null,
				2,
			)}\n`,
		);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "error");
		assert.match(notifications[0].message, /changed after preview/i);
		assert.match(notifications[0].message, /linear/);
		assert.ok(notifications[0].message.includes(configPath));
		assert.match(notifications[0].message, /run .*again/i);
		assert.doesNotMatch(notifications[0].message, /Configured pi-workflow MCP servers/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command refuses to overwrite malformed MCP JSON", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-malformed-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		await writeFile(configPath, "{ not valid json", "utf8");

		const { commands, execCalls } = createExtensionHarness();
		const confirmations = [];
		const notifications = [];
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async (title, message) => {
					confirmations.push({ title, message });
					return true;
				},
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(execCalls.length, 0);
		assert.equal(confirmations.length, 0);
		assert.equal(await readFile(configPath, "utf8"), "{ not valid json");
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /refusing to overwrite malformed json/i);
		assert.match(notifications[0].message, /mcp\.json/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command reports MCP config write failures after confirmation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-write-error-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const configPath = join(dir, ".pi", "agent", "mcp.json");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;
		mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
		await writeFile(
			configPath,
			`${JSON.stringify({ telemetry: { enabled: true } }, null, 2)}\n`,
			"utf8",
		);

		const { commands } = createExtensionHarness();
		const notifications = [];
		await assert.doesNotReject(
			commands.get("pi-workflow-install-companions").handler("", {
				hasUI: true,
				ui: {
					confirm: async () => {
						await rm(configPath, { recursive: true, force: true });
						mkdirSync(configPath, { recursive: true });
						return true;
					},
					notify: (message, level) => notifications.push({ message, level }),
				},
			}),
		);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "error");
		assert.ok(notifications[0].message.includes(configPath));
		assert.match(notifications[0].message, /edit .* manually/i);
		assert.match(notifications[0].message, /context7/);
		assert.doesNotMatch(notifications[0].message, /Configured pi-workflow MCP servers/);
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command prints manual MCP guidance and does not mutate in non-UI contexts", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-manual-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = dir;
		delete process.env.PI_AGENT_HOME;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;

		const { commands, execCalls } = createExtensionHarness();
		const notifications = [];
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: false,
			ui: {
				notify: (message, level) => notifications.push({ message, level }),
			},
		});

		assert.equal(execCalls.length, 0);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /cannot mutate Pi configuration automatically/i);
		assert.match(notifications[0].message, /mcp\.json/);
		assert.match(notifications[0].message, /context7/);
		assert.match(notifications[0].message, /sentry/);
		assert.match(notifications[0].message, /linear/);
		await assert.rejects(readFile(join(dir, ".pi", "agent", "mcp.json"), "utf8"));
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command uses PI_AGENT_HOME for MCP configuration when PI_CODING_AGENT_DIR is unset", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-agent-home-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const piAgentHome = join(dir, "active-pi-agent");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = join(dir, "ignored-home");
		process.env.PI_AGENT_HOME = piAgentHome;
		delete process.env.PI_CODING_AGENT_DIR;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;

		const { commands } = createExtensionHarness();
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async () => true,
				notify: () => {},
			},
		});

		const config = JSON.parse(await readFile(join(piAgentHome, "mcp.json"), "utf8"));
		assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		await assert.rejects(readFile(join(dir, "ignored-home", ".pi", "agent", "mcp.json"), "utf8"));
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});

test("install command prefers PI_CODING_AGENT_DIR over PI_AGENT_HOME for MCP configuration", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-custom-dir-"));
	const nodeModulesPath = join(dir, "companions", "node_modules");
	const customPiAgentDir = join(dir, "custom-pi-agent");
	const envSnapshot = {
		HOME: process.env.HOME,
		PI_AGENT_HOME: process.env.PI_AGENT_HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_WORKFLOW_COMPANION_NODE_MODULES:
			process.env.PI_WORKFLOW_COMPANION_NODE_MODULES,
	};
	try {
		await writeInstalledCompanionFixtures(nodeModulesPath);
		process.env.HOME = join(dir, "ignored-home");
		process.env.PI_AGENT_HOME = join(dir, "ignored-pi-agent-home");
		process.env.PI_CODING_AGENT_DIR = customPiAgentDir;
		process.env.PI_WORKFLOW_COMPANION_NODE_MODULES = nodeModulesPath;

		const { commands } = createExtensionHarness();
		await commands.get("pi-workflow-install-companions").handler("", {
			hasUI: true,
			ui: {
				confirm: async () => true,
				notify: () => {},
			},
		});

		const config = JSON.parse(
			await readFile(join(customPiAgentDir, "mcp.json"), "utf8"),
		);
		assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		await assert.rejects(readFile(join(dir, "ignored-pi-agent-home", "mcp.json"), "utf8"));
		await assert.rejects(readFile(join(dir, "ignored-home", ".pi", "agent", "mcp.json"), "utf8"));
	} finally {
		restoreEnv(envSnapshot);
		await rm(dir, { recursive: true, force: true });
	}
});
