import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	createCompanionWorkflow,
	getCodeGraphReadiness,
	getCompanionState,
	loadCompanionsFromPath,
	manualInstallInstructions,
} from "../extensions/companion-workflow.ts";

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
	const readiness = await getCodeGraphReadiness({
		companion: { package: "@vndv/pi-codegraph", status: "missing" },
		exec: async () => {
			throw new Error("missing");
		},
		cwd: () => "/tmp/pi-workflow-no-index",
		directoryExists: () => false,
	});
	assert.equal(readiness.cli, "missing");
	assert.equal(readiness.index, "missing");
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
