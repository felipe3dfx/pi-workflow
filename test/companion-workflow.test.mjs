import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	createCompanionWorkflow,
	getCompanionState,
	loadCompanionsFromPath,
	manualInstallInstructions,
} from "../extensions/companion-workflow.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

function fakePiExtensionApi() {
	const handlers = new Map();
	return {
		pi: {
			on(event, handler) {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
			registerCommand() {},
			registerShortcut() {},
			registerProvider() {},
			registerTool() {},
			exec: async () => {
				throw new Error("must not run commands");
			},
		},
		handlers,
	};
}

async function fireEvent(handlers, event, ctx) {
	for (const handler of handlers.get(event) ?? []) {
		await handler({}, ctx);
	}
}

function fakeSessionStartCtx(notifications = []) {
	return {
		mode: "tui",
		ui: { notify: (message, level) => notifications.push({ message, level }) },
		sessionManager: { getBranch: () => [] },
	};
}

async function withMetadataFile(companions, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-companion-"));
	try {
		const metadataPath = join(dir, "companions.json");
		await writeFile(metadataPath, JSON.stringify({ schemaVersion: 1, companions }), "utf8");
		return await run({ dir, metadataPath });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("catalog helpers fail closed on invalid metadata and format manual install lines", async () => {
	const loaded = loadCompanionsFromPath(join(tmpdir(), "missing-companions.json"));
	assert.match(loaded.error, /Unable to load companion metadata/);
	assert.equal(getCompanionState({ package: "alpha" }, () => ({})).status, "missing");
	assert.match(manualInstallInstructions([{ package: "alpha" }], "Install:"), /pi install npm:alpha/);
});

test("inspect reports missing companions without installing them", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ metadataPath }) => {
		const notifications = [];
		const workflow = createCompanionWorkflow({
			catalog: {
				metadataPath,
				resolveInstalledVersion: () => ({}),
			},
			interaction: {
				notify: (message, level) => notifications.push({ message, level }),
				installPackage: async () => {
					throw new Error("inspect must not install");
				},
			},
		});
		const result = await workflow.inspect();
		assert.equal(result.level, "warning");
		assert.match(result.message, /alpha — missing/);
		assert.equal(notifications.length, 1);
	});
});

test("install without apply prints the plan and does not mutate", async () => {
	await withMetadataFile([{ package: "beta" }], async ({ metadataPath, dir }) => {
		let installs = 0;
		const workflow = createCompanionWorkflow({
			catalog: {
				metadataPath,
				resolveInstalledVersion: () => ({}),
			},
			interaction: {
				installPackage: async () => {
					installs += 1;
					return { code: 0 };
				},
			},
			mcp: {
				catalogPath: join(dir, "mcp-servers.json"),
				agentDirectory: dir,
			},
		});
		await writeFile(
			join(dir, "mcp-servers.json"),
			JSON.stringify({ schemaVersion: 1, mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } } }),
			"utf8",
		);
		const result = await workflow.installMissing(false);
		assert.equal(result.outcome, "manual");
		assert.equal(installs, 0);
		assert.match(result.manualInstructions, /pi install npm:beta/);
	});
});

test("status and doctor no longer expect pi-pretty and mention no CodeGraph or removed packages", async () => {
	const workflow = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@heyhuynhgiabuu/pi-pretty" || name === "@tintinweb/pi-subagents" ? {} : { version: "1.0.0" },
		},
		interaction: {},
	});
	for (const result of [await workflow.inspect(), await workflow.diagnose()]) {
		assert.equal(result.level, "info");
		assert.doesNotMatch(result.message, /pi-pretty/);
		assert.doesNotMatch(result.message, /@tintinweb\/pi-subagents/);
		assert.doesNotMatch(result.message, /@vndv\/pi-codegraph/);
		assert.doesNotMatch(result.message, /CodeGraph/);
	}
});

test("status and doctor warn that an installed pi-pretty collides with the harness tools without removing it", async () => {
	const notifications = [];
	const workflow = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: () => ({ version: "1.0.0" }),
		},
		interaction: {
			notify: (message, level) => notifications.push({ message, level }),
			installPackage: async () => {
				throw new Error("must not install or remove");
			},
			exec: async () => {
				throw new Error("must not run commands");
			},
		},
	});
	for (const result of [await workflow.inspect(), await workflow.diagnose()]) {
		assert.equal(result.level, "warning");
		assert.match(result.message, /@heyhuynhgiabuu\/pi-pretty/);
		assert.match(result.message, /read, bash, grep, find, ls/);
		assert.match(result.message, /pi remove npm:@heyhuynhgiabuu\/pi-pretty/);
	}
	assert.equal(notifications.length, 2);
});

test("doctor reports info when every catalog companion is installed, with no CodeGraph mention", async () => {
	const workflow = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@heyhuynhgiabuu/pi-pretty" || name === "@tintinweb/pi-subagents" ? {} : { version: "1.0.0" },
		},
		interaction: {},
	});
	const result = await workflow.diagnose();
	assert.equal(result.level, "info");
	assert.doesNotMatch(result.message, /CodeGraph/);
});

test("apply installs missing companions and stops when install fails", async () => {
	await withMetadataFile([{ package: "beta" }], async ({ metadataPath, dir }) => {
		const specs = [];
		const workflow = createCompanionWorkflow({
			catalog: {
				metadataPath,
				resolveInstalledVersion: () => ({}),
			},
			interaction: {
				installPackage: async (spec) => {
					specs.push(spec);
					return { code: 1, stderr: "offline" };
				},
			},
			mcp: {
				catalogPath: join(dir, "mcp-servers.json"),
				agentDirectory: dir,
			},
		});
		await writeFile(
			join(dir, "mcp-servers.json"),
			JSON.stringify({ schemaVersion: 1, mcpServers: {} }),
			"utf8",
		);
		const result = await workflow.installMissing(true);
		assert.equal(result.outcome, "failed");
		assert.deepEqual(specs, ["npm:beta"]);
		assert.match(result.failures[0], /offline/);
	});
});

function catalogResolverWithLegacyState(legacyState) {
	return (name) => {
		if (name === "@tintinweb/pi-subagents") return legacyState;
		if (name === "@heyhuynhgiabuu/pi-pretty") return {};
		return { version: "1.0.0" };
	};
}

test("status and doctor warn that an installed legacy spawn package blocks spawn tools, isolated from every other companion", async () => {
	const notifications = [];
	const workflow = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: catalogResolverWithLegacyState({ version: "2.0.0" }),
		},
		interaction: {
			notify: (message, level) => notifications.push({ message, level }),
		},
	});
	for (const result of [await workflow.inspect(), await workflow.diagnose()]) {
		assert.equal(result.level, "warning");
		assert.match(result.message, /@tintinweb\/pi-subagents/);
		assert.match(result.message, /pi remove npm:@tintinweb\/pi-subagents/);
	}
	assert.equal(notifications.length, 2);

	const otherwiseIdentical = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: catalogResolverWithLegacyState({}),
		},
		interaction: {},
	});
	const result = await otherwiseIdentical.diagnose();
	assert.equal(result.level, "info");
});

test("spawn tools stay blocked and the warning surfaces the error when the legacy package's install state cannot be read", async () => {
	const notifications = [];
	const workflow = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: catalogResolverWithLegacyState({
				error: "EACCES: permission denied",
			}),
		},
		interaction: {
			notify: (message, level) => notifications.push({ message, level }),
		},
	});
	const result = await workflow.checkSpawnTools();
	assert.equal(result.allowed, false);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "warning");
	assert.match(notifications[0].message, /EACCES: permission denied/);
	assert.match(notifications[0].message, /pi remove npm:@tintinweb\/pi-subagents/);
});

test("status and doctor stay available and do not mention the legacy spawn package when it is not installed", async () => {
	const workflow = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@tintinweb/pi-subagents" || name === "@heyhuynhgiabuu/pi-pretty"
					? {}
					: { version: "1.0.0" },
		},
		interaction: {},
	});
	for (const result of [await workflow.inspect(), await workflow.diagnose()]) {
		assert.equal(result.level, "info");
		assert.doesNotMatch(result.message, /@tintinweb\/pi-subagents/);
	}
});

test("checkSpawnTools warns at session start when the legacy spawn package is installed and stays silent otherwise", async () => {
	const notifications = [];
	const blocked = createCompanionWorkflow({
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@tintinweb/pi-subagents" ? { version: "2.0.0" } : {},
		},
		interaction: {
			notify: (message, level) => notifications.push({ message, level }),
		},
	});
	const blockedResult = await blocked.checkSpawnTools();
	assert.equal(blockedResult.allowed, false);
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "warning");
	assert.match(notifications[0].message, /pi remove npm:@tintinweb\/pi-subagents/);

	const allowed = createCompanionWorkflow({
		catalog: { resolveInstalledVersion: () => ({}) },
		interaction: {
			notify: () => {
				throw new Error("must not notify when nothing is installed");
			},
		},
	});
	const allowedResult = await allowed.checkSpawnTools();
	assert.equal(allowedResult.allowed, true);
});

test("piWorkflowExtension warns at session start when the legacy spawn package is installed, and stays silent when it is not", async () => {
	const { pi, handlers } = fakePiExtensionApi();
	piWorkflowExtension(pi, {
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@tintinweb/pi-subagents" ? { version: "2.0.0" } : {},
		},
	});
	const notifications = [];
	await fireEvent(handlers, "session_start", fakeSessionStartCtx(notifications));
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "warning");
	assert.match(notifications[0].message, /pi remove npm:@tintinweb\/pi-subagents/);

	const silent = fakePiExtensionApi();
	piWorkflowExtension(silent.pi, {
		catalog: { resolveInstalledVersion: () => ({}) },
	});
	const silentNotifications = [];
	await fireEvent(silent.handlers, "session_start", fakeSessionStartCtx(silentNotifications));
	assert.equal(silentNotifications.length, 0);
});
