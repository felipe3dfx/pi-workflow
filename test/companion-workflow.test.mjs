import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, statSync, symlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	createCompanionWorkflow,
	getCompanionState,
	loadCompanionsFromPath,
	manualInstallInstructions,
} from "../extensions/companion-workflow.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

const isColliding = (name) =>
	name === "@heyhuynhgiabuu/pi-pretty" ||
	name === "pi-powerline-footer" ||
	name === "pi-mcp-adapter";

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
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			setWidget() {},
			setHeader() {},
			setFooter() {},
			setEditorComponent() {},
			setWorkingVisible() {},
		},
		sessionManager: { getBranch: () => [], getEntries: () => [] },
	};
}

const alignedDir = await mkdtemp(join(tmpdir(), "pi-workflow-aligned-"));
await writeFile(
	join(alignedDir, "mcp-servers.json"),
	JSON.stringify({ schemaVersion: 1, mcpServers: {} }),
	"utf8",
);
await writeFile(
	join(alignedDir, "settings-catalog.json"),
	JSON.stringify({ schemaVersion: 1, settings: {} }),
	"utf8",
);
test.after(() => rm(alignedDir, { recursive: true, force: true }));
const aligned = {
	mcp: {
		catalogPath: join(alignedDir, "mcp-servers.json"),
		agentDirectory: alignedDir,
	},
	settings: {
		catalogPath: join(alignedDir, "settings-catalog.json"),
		agentDirectory: alignedDir,
	},
};

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
			...aligned,
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

test("status and doctor no longer expect pi-pretty and mention no CodeGraph or removed packages", async () => {
	const workflow = createCompanionWorkflow({
		...aligned,
		catalog: {
			resolveInstalledVersion: (name) =>
				isColliding(name) || name === "@tintinweb/pi-subagents" ? {} : { version: "1.0.0" },
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
		...aligned,
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

test("setup reports installed colliding packages at warning level on the no-op path without removing them", async () => {
	const notifications = [];
	const workflow = createCompanionWorkflow({
		...aligned,
		catalog: {
			resolveInstalledVersion: () => ({ version: "1.0.0" }),
		},
		interaction: {
			notify: (message, level) => notifications.push({ message, level }),
			installPackage: async () => {
				throw new Error("must not install or remove");
			},
		},
	});
	const result = await workflow.setup();
	assert.equal(result.outcome, "noop");
	assert.match(result.message, /pi-powerline-footer is installed and replaces/);
	assert.match(result.message, /pi remove npm:@heyhuynhgiabuu\/pi-pretty/);
	assert.equal(notifications.at(-1).level, "warning");
	assert.equal(notifications.at(-1).message, result.message);
});

test("status and doctor warn that an installed pi-powerline-footer conflicts with the chrome without removing it", async () => {
	const notifications = [];
	const workflow = createCompanionWorkflow({
		...aligned,
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@heyhuynhgiabuu/pi-pretty" || name === "@tintinweb/pi-subagents"
					? {}
					: { version: "1.0.0" },
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
		assert.match(
			result.message,
			/pi-powerline-footer is installed and replaces the same header, footer, and editor as pi-workflow/,
		);
		assert.match(result.message, /pi remove npm:pi-powerline-footer/);
		assert.doesNotMatch(result.message, /pi-pretty/);
	}
	assert.equal(notifications.length, 2);
});

test("status and doctor warn that an installed pi-mcp-adapter hides mcp.json from Pi without removing it", async () => {
	const workflow = createCompanionWorkflow({
		...aligned,
		catalog: {
			resolveInstalledVersion: (name) =>
				name !== "pi-mcp-adapter" &&
				(isColliding(name) || name === "@tintinweb/pi-subagents")
					? {}
					: { version: "1.0.0" },
		},
		interaction: {
			installPackage: async () => {
				throw new Error("must not install or remove");
			},
		},
	});
	for (const result of [await workflow.inspect(), await workflow.diagnose()]) {
		assert.equal(result.level, "warning");
		assert.match(
			result.message,
			/pi-mcp-adapter is installed and replaces Pi's built-in \/mcp, so Pi ignores mcp\.json while it is installed/,
		);
		assert.match(result.message, /pi remove npm:pi-mcp-adapter/);
	}
});

test("status and setup note that an existing mcp-adapter.json is no longer read and leave it untouched", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ metadataPath }) => {
		await withFinishApplyDirectories(async ({ mcp, settings }) => {
			const legacyPath = join(mcp.agentDirectory, "mcp-adapter.json");
			const legacy = '{ "mcpServers": { "old": { "command": "old" } } }\n';
			await writeFile(legacyPath, legacy, "utf8");
			const notifications = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: installedExceptBlocked,
				},
				interaction: {
					notify: (message, level) => notifications.push({ message, level }),
					installPackage: async () => ({ code: 0 }),
				},
				mcp,
				settings,
			});
			const note = `${legacyPath} is no longer read. Move any servers you still need from it to ${join(mcp.agentDirectory, "mcp.json")}.`;
			const status = await workflow.inspect();
			assert.ok(status.message.includes(note));
			await workflow.setup();
			assert.ok(
				notifications.some(
					({ message, level }) => message === note && level === "info",
				),
			);
			assert.equal(await readFile(legacyPath, "utf8"), legacy);
			const written = JSON.parse(
				await readFile(join(mcp.agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(Object.keys(written.mcpServers), ["context7"]);
		});
	});
});

test("doctor reports info when every catalog companion is installed, with no CodeGraph mention", async () => {
	const workflow = createCompanionWorkflow({
		...aligned,
		catalog: {
			resolveInstalledVersion: (name) =>
				isColliding(name) || name === "@tintinweb/pi-subagents" ? {} : { version: "1.0.0" },
		},
		interaction: {},
	});
	const result = await workflow.diagnose();
	assert.equal(result.level, "info");
	assert.doesNotMatch(result.message, /CodeGraph/);
});

test("setup installs missing companions and stops when install fails", async () => {
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
			settings: aligned.settings,
		});
		await writeFile(
			join(dir, "mcp-servers.json"),
			JSON.stringify({ schemaVersion: 1, mcpServers: {} }),
			"utf8",
		);
		const result = await workflow.setup();
		assert.equal(result.outcome, "failed");
		assert.deepEqual(specs, ["npm:beta"]);
		assert.match(result.failures[0], /offline/);
	});
});

function catalogResolverWithLegacyState(legacyState) {
	return (name) => {
		if (name === "@tintinweb/pi-subagents") return legacyState;
		if (isColliding(name)) return {};
		return { version: "1.0.0" };
	};
}

test("status and doctor warn that an installed legacy spawn package blocks spawn tools, isolated from every other companion", async () => {
	const notifications = [];
	const workflow = createCompanionWorkflow({
		...aligned,
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
		...aligned,
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
		...aligned,
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
		...aligned,
		catalog: {
			resolveInstalledVersion: (name) =>
				name === "@tintinweb/pi-subagents" || isColliding(name)
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

const installedExceptBlocked = (name) =>
	isColliding(name) || name === "@tintinweb/pi-subagents"
		? {}
		: { version: "1.0.0" };

async function withSettingsWorkflow(existingSettings, run) {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ metadataPath, dir }) => {
			const catalogPath = join(dir, "settings-catalog.json");
			const settingsPath = join(dir, "settings.json");
			await writeFile(
				catalogPath,
				JSON.stringify({
					schemaVersion: 1,
					settings: { tuiMode: "fullscreen" },
				}),
				"utf8",
			);
			if (existingSettings !== undefined)
				await writeFile(settingsPath, existingSettings, "utf8");
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: installedExceptBlocked,
				},
				interaction: {
					installPackage: async () => {
						throw new Error("must not install");
					},
				},
				mcp: aligned.mcp,
				settings: { catalogPath, agentDirectory: dir },
			});
			await run({ workflow, settingsPath });
		},
	);
}

test("setup sets a different tuiMode and preserves every other settings key", async () => {
	await withSettingsWorkflow(
		JSON.stringify({
			theme: "dark",
			tuiMode: "regular",
			packages: ["npm:alpha"],
		}),
		async ({ workflow, settingsPath }) => {
			const result = await workflow.setup();
			assert.equal(result.outcome, "installed");
			assert.match(result.message, /Restart Pi/);
			assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
				theme: "dark",
				tuiMode: "fullscreen",
				packages: ["npm:alpha"],
			});
		},
	);
});

test("setup creates the settings file when it is missing", async () => {
	await withSettingsWorkflow(undefined, async ({ workflow, settingsPath }) => {
		const result = await workflow.setup();
		assert.equal(result.outcome, "installed");
		assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
			tuiMode: "fullscreen",
		});
	});
});

test("setup is a no-op when companions, MCP, and default settings are aligned", async () => {
	const existing = JSON.stringify({ tuiMode: "fullscreen", theme: "light" });
	await withSettingsWorkflow(existing, async ({ workflow, settingsPath }) => {
		const result = await workflow.setup();
		assert.equal(result.outcome, "noop");
		assert.equal(await readFile(settingsPath, "utf8"), existing);
	});
});

test("setup fails closed on a malformed settings file without overwriting it", async () => {
	const existing = "{ not json";
	await withSettingsWorkflow(existing, async ({ workflow, settingsPath }) => {
		const result = await workflow.setup();
		assert.equal(result.outcome, "config-error");
		assert.match(result.message, /Refusing to overwrite malformed JSON/);
		assert.equal(await readFile(settingsPath, "utf8"), existing);
	});
});

test("status and doctor report default settings as aligned or pointing to /workflow:setup", async () => {
	await withSettingsWorkflow(
		JSON.stringify({ tuiMode: "fullscreen" }),
		async ({ workflow }) => {
			for (const result of [
				await workflow.inspect(),
				await workflow.diagnose(),
			]) {
				assert.equal(result.level, "info");
				assert.match(result.message, /MCP configuration:\n✓ .* — aligned/);
				assert.match(
					result.message,
					/Default settings:\n✓ .*settings\.json — aligned/,
				);
			}
		},
	);
	await withSettingsWorkflow(
		JSON.stringify({ tuiMode: "regular" }),
		async ({ workflow, settingsPath }) => {
			for (const result of [
				await workflow.inspect(),
				await workflow.diagnose(),
			]) {
				assert.equal(result.level, "warning");
				assert.match(
					result.message,
					/Default settings:\n✗ .* — not aligned: tuiMode\nRun \/workflow:setup/,
				);
			}
			assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
				tuiMode: "regular",
			});
		},
	);
});

test("status reports a misaligned MCP configuration and points to /workflow:setup", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ metadataPath, dir }) => {
			const catalogPath = join(dir, "mcp-servers.json");
			await writeFile(
				catalogPath,
				JSON.stringify({
					schemaVersion: 1,
					mcpServers: { context7: { command: "npx" } },
				}),
				"utf8",
			);
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: installedExceptBlocked,
				},
				interaction: {},
				mcp: { catalogPath, agentDirectory: dir },
				settings: aligned.settings,
			});
			const result = await workflow.inspect();
			assert.equal(result.level, "warning");
			assert.match(
				result.message,
				/MCP configuration:\n✗ .*mcp\.json — not aligned: context7\nRun \/workflow:setup/,
			);
		},
	);
});

test("status does not point to /workflow:setup when the only settings misalignment is a conflict setup cannot fix", async () => {
	await withMetadataFile(
		[{ package: "alpha" }],
		async ({ metadataPath, dir }) => {
			const catalogPath = join(dir, "settings-catalog.json");
			await writeFile(
				catalogPath,
				JSON.stringify({ schemaVersion: 1, settings: { defaultTools: ["+codemode"] } }),
				"utf8",
			);
			await writeFile(
				join(dir, "settings.json"),
				JSON.stringify({ defaultTools: ["-codemode"] }),
				"utf8",
			);
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: installedExceptBlocked,
				},
				interaction: {},
				mcp: aligned.mcp,
				settings: { catalogPath, agentDirectory: dir },
			});
			const result = await workflow.inspect();
			assert.equal(result.level, "warning");
			assert.match(
				result.message,
				/Default settings:\n✗ .*settings\.json — not aligned: defaultTools: -codemode conflicts with \+codemode \(remove it manually\)/,
			);
			assert.doesNotMatch(result.message, /Default settings:(.|\n)*Run \/workflow:setup/);
		},
	);
});

async function withFinishApplyDirectories(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-finish-"));
	try {
		const mcpDirectory = join(dir, "mcp");
		const settingsDirectory = join(dir, "settings");
		await mkdir(mcpDirectory);
		await mkdir(settingsDirectory);
		const mcpCatalogPath = join(dir, "mcp-servers.json");
		const settingsCatalogPath = join(dir, "settings-catalog.json");
		await writeFile(
			mcpCatalogPath,
			JSON.stringify({
				schemaVersion: 1,
				mcpServers: { context7: { command: "npx" } },
			}),
			"utf8",
		);
		await writeFile(
			settingsCatalogPath,
			JSON.stringify({ schemaVersion: 1, settings: { tuiMode: "fullscreen" } }),
			"utf8",
		);
		return await run({
			dir,
			mcp: { catalogPath: mcpCatalogPath, agentDirectory: mcpDirectory },
			settings: {
				catalogPath: settingsCatalogPath,
				agentDirectory: settingsDirectory,
			},
			settingsDirectory,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("setup does not claim companions were installed when only MCP and settings changed", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ metadataPath }) => {
		await withFinishApplyDirectories(async ({ mcp, settings }) => {
			const workflow = createCompanionWorkflow({
				catalog: { metadataPath, resolveInstalledVersion: () => ({ version: "1.0.0" }) },
				interaction: {
					installPackage: async () => {
						throw new Error("must not install");
					},
				},
				mcp,
				settings,
			});
			const result = await workflow.setup();
			assert.equal(result.outcome, "installed");
			assert.doesNotMatch(result.message, /Installed companions/);
			assert.match(result.message, /Updated MCP configuration/);
		});
	});
});

test("setup lists errored companions and manual instructions in the final message", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ metadataPath }) => {
		await withFinishApplyDirectories(async ({ mcp, settings }) => {
			const notifications = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ error: "EACCES" }),
				},
				interaction: {
					installPackage: async () => ({ code: 0 }),
					notify: (message, level) => notifications.push({ message, level }),
				},
				mcp,
				settings,
			});
			const result = await workflow.setup();
			assert.equal(result.outcome, "installed");
			assert.match(result.message, /need attention/);
			assert.match(result.message, /pi install npm:alpha/);
			assert.equal(notifications.at(-1).level, "warning");
			assert.match(notifications.at(-1).message, /pi install npm:alpha/);
		});
	});
});

test("a settings write failure after an MCP write reports what was already done", async () => {
	await withMetadataFile([{ package: "alpha" }], async ({ metadataPath }) => {
		await withFinishApplyDirectories(async ({ mcp, settings, settingsDirectory }) => {
			const workflow = createCompanionWorkflow({
				catalog: { metadataPath, resolveInstalledVersion: () => ({ version: "1.0.0" }) },
				interaction: { installPackage: async () => ({ code: 0 }) },
				mcp,
				settings,
			});
			chmodSync(settingsDirectory, 0o500);
			try {
				const result = await workflow.setup();
				assert.equal(result.outcome, "config-error");
				assert.match(result.message, /MCP configuration was updated/);
				assert.match(result.message, /\/reload/);
				assert.doesNotMatch(result.message, /Companions were installed/);
			} finally {
				chmodSync(settingsDirectory, 0o700);
			}
		});
	});
});

test("settings write keeps 0600 permissions and writes through a symlink", async () => {
	await withSettingsWorkflow(
		JSON.stringify({ tuiMode: "regular" }),
		async ({ workflow, settingsPath }) => {
			chmodSync(settingsPath, 0o600);
			await workflow.setup();
			assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
		},
	);
	await withSettingsWorkflow(undefined, async ({ workflow, settingsPath }) => {
		const realPath = `${settingsPath}.real`;
		await writeFile(realPath, JSON.stringify({ tuiMode: "regular" }), "utf8");
		symlinkSync(realPath, settingsPath);
		await workflow.setup();
		assert.ok(lstatSync(settingsPath).isSymbolicLink());
		assert.deepEqual(JSON.parse(await readFile(realPath, "utf8")), {
			tuiMode: "fullscreen",
		});
	});
});
