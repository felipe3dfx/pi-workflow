import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createCompanionWorkflow } from "../extensions/companion-workflow.ts";

const mcpServerCatalog = JSON.parse(
	readFileSync(new URL("../assets/mcp-servers.json", import.meta.url), "utf8"),
);

async function withMetadataFile(companions, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-companion-workflow-"));
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

function createNotifications() {
	const notifications = [];
	return {
		notifications,
		notify: (message, level = "info") => {
			notifications.push({ message, level });
		},
	};
}

test("inspect reports companion state and status output through the workflow seam", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ metadataPath }) => {
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: { notify },
			});

			const result = await workflow.inspect();

			assert.equal(result.level, "warning");
			assert.deepEqual(
				result.states.map(({ package: packageName, status }) => ({
					package: packageName,
					status,
				})),
				[
					{ package: "alpha", status: "installed" },
					{ package: "beta", status: "missing" },
				],
			);
			assert.match(result.message, /Recommended companion packages:/);
			assert.match(result.message, /alpha@1\.0\.0/);
			assert.match(result.message, /beta@2\.0\.0/);
			assert.match(result.message, /pi install npm:beta@2\.0\.0/);
			assert.deepEqual(notifications, [
				{ message: result.message, level: "warning" },
			]);
		},
	);
});

test("diagnose reports CodeGraph readiness through an explicit diagnostic operation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "@vndv/pi-codegraph", version: "0.1.10" },
		],
		async ({ metadataPath }) => {
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => ({
						version: packageName === "alpha" ? "1.0.0" : "0.1.10",
					}),
				},
				interaction: { notify },
				diagnostics: {
					exec: async () => ({ code: 0, stdout: "codegraph 0.1.0" }),
					cwd: () => "/tmp/project",
					directoryExists: async (path) => path !== "/tmp/project/.codegraph",
				},
			});

			const result = await workflow.diagnose();

			assert.equal(result.level, "warning");
			assert.equal(result.readiness?.cli, "available");
			assert.equal(result.readiness?.index, "missing");
			assert.match(result.message, /pi-workflow companion doctor/);
			assert.match(result.message, /CodeGraph readiness:/);
			assert.match(result.message, /CodeGraph index: missing/);
			assert.deepEqual(notifications, [
				{ message: result.message, level: "warning" },
			]);
		},
	);
});

test("installMissing is a no-op when companions are installed and MCP servers already match the catalog", async () => {
	await withMetadataFile(
		[{ package: "alpha", version: "1.0.0" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify({ mcpServers: mcpServerCatalog.mcpServers }, null, 2)}\n`,
				"utf8",
			);
			const { notifications, notify } = createNotifications();
			let confirmCalls = 0;
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify,
					confirm: async () => {
						confirmCalls += 1;
						return true;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "noop");
			assert.equal(confirmCalls, 0);
			assert.deepEqual(installCalls, []);
			assert.deepEqual(notifications, [
				{
					message:
						"pi-workflow companions are installed and MCP servers are already configured.",
					level: "info",
				},
			]);
		},
	);
});

test("installMissing installs missing companions and configures MCP servers after confirmation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notify } = createNotifications();
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify,
					confirm: async (title, message) => {
						confirmPrompts.push({ title, message });
						return true;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "installed");
			assert.equal(confirmPrompts.length, 1);
			assert.match(confirmPrompts[0].title, /install pi-workflow companions and configure mcp servers/i);
			assert.match(confirmPrompts[0].message, /pi install npm:beta@2\.0\.0/);
			assert.match(confirmPrompts[0].message, /context7/);
			assert.deepEqual(installCalls, ["npm:beta@2.0.0"]);
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
			assert.match(result.message ?? "", /Configured pi-workflow MCP servers/);
		},
	);
});

test("installMissing prints combined manual guidance without mutating when confirmation is unavailable", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: { notify },
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "manual");
			assert.equal(notifications.length, 1);
			assert.match(notifications[0].message, /pi install npm:beta@2\.0\.0/);
			assert.match(notifications[0].message, /cannot mutate Pi configuration automatically/i);
			assert.match(notifications[0].message, /mcp\.json/);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing preserves unrelated MCP configuration while merging the catalog", async () => {
	await withMetadataFile(
		[{ package: "alpha", version: "1.0.0" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify(
					{
						telemetry: { enabled: true },
						mcpServers: {
							custom: { url: "https://example.test/custom" },
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({ version: "1.0.0" }),
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "installed");
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, {
				telemetry: { enabled: true },
				mcpServers: {
					custom: { url: "https://example.test/custom" },
					...mcpServerCatalog.mcpServers,
				},
			});
		},
	);
});

test("installMissing returns canceled and leaves packages and MCP untouched when the user declines", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async (title, message) => {
						confirmPrompts.push({ title, message });
						return false;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "canceled");
			assert.equal(confirmPrompts.length, 1);
			assert.match(
				result.message ?? "",
				/Canceled\. No companion packages or MCP configuration were changed\./,
			);
			assert.deepEqual(installCalls, []);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing reports partial failure when a companion install exits non-zero during combined companion and MCP work", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 23, stderr: "permission denied" };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "failed");
			assert.deepEqual(installCalls, ["npm:beta@2.0.0"]);
			assert.match(
				result.message ?? "",
				/Configured pi-workflow MCP servers at .*mcp\.json\./,
			);
			assert.match(result.message ?? "", /Some companion installs failed:/);
			assert.match(
				result.message ?? "",
				/npm:beta@2\.0\.0: permission denied/,
			);
			assert.doesNotMatch(
				result.message ?? "",
				/Installed or updated pi-workflow companions\./,
			);
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		},
	);
});

test("installMissing reports partial failure when a companion install throws during combined companion and MCP work", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
					installPackage: async (spec) => {
						installCalls.push(spec);
						throw new Error("network down");
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "failed");
			assert.deepEqual(installCalls, ["npm:beta@2.0.0"]);
			assert.match(result.message ?? "", /Some companion installs failed:/);
			assert.match(result.message ?? "", /npm:beta@2\.0\.0: network down/);
			assert.doesNotMatch(
				result.message ?? "",
				/pi-workflow does not connect or authenticate MCP servers during installation/,
			);
			const config = JSON.parse(
				await readFile(join(agentDirectory, "mcp.json"), "utf8"),
			);
			assert.deepEqual(config, { mcpServers: mcpServerCatalog.mcpServers });
		},
	);
});

test("installMissing still installs safe companion packages when the existing MCP config is malformed", async () => {
	await withMetadataFile(
		[{ package: "beta", version: "2.0.0" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			const mcpPath = join(agentDirectory, "mcp.json");
			await writeFile(mcpPath, "{\n  invalid json\n", "utf8");
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify: () => {},
					confirm: async (title, message) => {
						confirmPrompts.push({ title, message });
						return true;
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "failed");
			assert.equal(confirmPrompts.length, 1);
			assert.deepEqual(installCalls, ["npm:beta@2.0.0"]);
			assert.match(
				result.message ?? "",
				/Refusing to overwrite malformed JSON at .*mcp\.json/,
			);
			assert.match(
				result.message ?? "",
				/Edit .*mcp\.json manually and merge these MCP server definitions under top-level "mcpServers":/,
			);
			assert.match(
				result.message ?? "",
				/Preserve unrelated top-level fields and unrelated MCP servers\./,
			);
			assert.equal(await readFile(mcpPath, "utf8"), "{\n  invalid json\n");
		},
	);
});

test("installMissing falls back to manual instructions when confirmation rejects", async () => {
	await withMetadataFile(
		[{ package: "beta", version: "2.0.0" }],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			const { notifications, notify } = createNotifications();
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify,
					confirm: async () => {
						throw new Error("confirmation adapter offline");
					},
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "manual");
			assert.deepEqual(installCalls, []);
			assert.equal(notifications.length, 1);
			assert.match(
				notifications[0].message,
				/confirmation adapter offline/,
			);
			assert.match(notifications[0].message, /pi install npm:beta@2\.0\.0/);
			assert.match(notifications[0].message, /mcp\.json/);
			await assert.rejects(readFile(join(agentDirectory, "mcp.json"), "utf8"));
		},
	);
});

test("installMissing does not report global success when another companion could not be inspected", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
		],
		async ({ dir, metadataPath }) => {
			const agentDirectory = join(dir, "agent");
			mkdirSync(agentDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				`${JSON.stringify({ mcpServers: mcpServerCatalog.mcpServers }, null, 2)}\n`,
				"utf8",
			);
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") {
							return { error: "package.json unreadable" };
						}
						return {};
					},
				},
				interaction: {
					notify: () => {},
					confirm: async () => true,
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
				mcp: { agentDirectory },
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "failed");
			assert.deepEqual(installCalls, ["npm:beta@2.0.0"]);
			assert.match(
				result.message ?? "",
				/Some companion versions could not be inspected:/,
			);
			assert.match(
				result.message ?? "",
				/alpha: package\.json unreadable/,
			);
			assert.match(
				result.message ?? "",
				/Install or update pi-workflow companions manually:/,
			);
			assert.doesNotMatch(
				result.message ?? "",
				/pi-workflow does not connect or authenticate MCP servers during installation/,
			);
		},
	);
});
