import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createCompanionWorkflow } from "../extensions/companion-workflow.ts";

async function withMetadataFile(companions, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-companion-workflow-"));
	try {
		const metadataPath = join(dir, "companions.json");
		await writeFile(
			metadataPath,
			JSON.stringify({ schemaVersion: 1, companions }),
			"utf8",
		);
		return await run(metadataPath);
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
		async (metadataPath) => {
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
		async (metadataPath) => {
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

test("installMissing is a no-op when every configured companion is already installed", async () => {
	await withMetadataFile(
		[{ package: "alpha", version: "1.0.0" }],
		async (metadataPath) => {
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
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "noop");
			assert.equal(confirmCalls, 0);
			assert.deepEqual(installCalls, []);
			assert.deepEqual(notifications, [
				{
					message:
						"All configured pi-workflow companions are installed at the expected versions.",
					level: "info",
				},
			]);
		},
	);
});

test("installMissing installs exactly the missing or mismatched companions after confirmation", async () => {
	await withMetadataFile(
		[
			{ package: "alpha", version: "1.0.0" },
			{ package: "beta", version: "2.0.0" },
			{ package: "gamma", version: "3.0.0" },
		],
		async (metadataPath) => {
			const { notify } = createNotifications();
			const confirmPrompts = [];
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: (packageName) => {
						if (packageName === "alpha") return { version: "1.0.0" };
						if (packageName === "beta") return {};
						return { version: "9.9.9" };
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
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "installed");
			assert.equal(confirmPrompts.length, 1);
			assert.match(confirmPrompts[0].message, /pi install npm:beta@2\.0\.0/);
			assert.match(confirmPrompts[0].message, /pi install npm:gamma@3\.0\.0/);
			assert.deepEqual(installCalls, ["npm:beta@2.0.0", "npm:gamma@3.0.0"]);
		},
	);
});

test("installMissing does not invoke pi install when confirmation is declined", async () => {
	await withMetadataFile(
		[{ package: "beta", version: "2.0.0" }],
		async (metadataPath) => {
			const { notifications, notify } = createNotifications();
			const installCalls = [];
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify,
					confirm: async () => false,
					installPackage: async (spec) => {
						installCalls.push(spec);
						return { code: 0 };
					},
				},
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "canceled");
			assert.deepEqual(installCalls, []);
			assert.deepEqual(notifications.at(-1), {
				message: "Canceled. No companion packages were installed.",
				level: "info",
			});
		},
	);
});

test("installMissing reports install failures with the existing manual recovery guidance", async () => {
	await withMetadataFile(
		[{ package: "beta", version: "2.0.0" }],
		async (metadataPath) => {
			const { notifications, notify } = createNotifications();
			const workflow = createCompanionWorkflow({
				catalog: {
					metadataPath,
					resolveInstalledVersion: () => ({}),
				},
				interaction: {
					notify,
					confirm: async () => true,
					installPackage: async () => ({
						code: 1,
						stderr: "permission denied",
					}),
				},
			});

			const result = await workflow.installMissing();

			assert.equal(result.outcome, "failed");
			assert.deepEqual(notifications.at(-1), {
				message: [
					"Some companion installs failed:",
					"npm:beta@2.0.0: permission denied",
					"",
					"Install or update pi-workflow companions manually:",
					"pi install npm:beta@2.0.0",
					"Then run /reload.",
				].join("\n"),
				level: "error",
			});
		},
	);
});
