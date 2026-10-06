import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	applyPiSettings,
	loadPiSettingsCatalog,
	planPiSettings,
} from "../extensions/pi-settings.ts";
import { loadMcpServerCatalog } from "../extensions/mcp-config.ts";

const catalog = { schemaVersion: 1, settings: { defaultTools: ["+codemode"] } };

async function withSettings(initial, run) {
	const agentDirectory = await mkdtemp(join(tmpdir(), "pi-settings-"));
	const path = join(agentDirectory, "settings.json");
	if (initial !== undefined) await writeFile(path, JSON.stringify(initial));
	try {
		await run({ agentDirectory, path });
	} finally {
		await rm(agentDirectory, { recursive: true, force: true });
	}
}

test("shipped catalogs enable codemode and expose MCP servers through it", () => {
	assert.deepEqual(loadPiSettingsCatalog().catalog.settings.defaultTools, [
		"+codemode",
	]);
	const { mcpServers } = loadMcpServerCatalog().catalog;
	assert.equal(mcpServers.context7.exposure, "direct");
	assert.equal(mcpServers.sentry.exposure, "codemode-deferred");
	assert.equal(mcpServers.linear.exposure, "codemode-deferred");
});

test("array settings append the missing item and keep the user's items", async () => {
	await withSettings({ defaultTools: ["+tool_search"] }, async (options) => {
		const plan = planPiSettings(catalog, options.agentDirectory);
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.misaligned, ["defaultTools: missing +codemode"]);
		assert.deepEqual(applyPiSettings(catalog, options.agentDirectory), {
			path: options.path,
			wrote: true,
		});
		assert.deepEqual(JSON.parse(await readFile(options.path, "utf8")), {
			defaultTools: ["+tool_search", "+codemode"],
		});
	});
});

test("array settings are created when the key is absent", async () => {
	await withSettings({ theme: "dark" }, async (options) => {
		applyPiSettings(catalog, options.agentDirectory);
		assert.deepEqual(JSON.parse(await readFile(options.path, "utf8")), {
			theme: "dark",
			defaultTools: ["+codemode"],
		});
	});
});

test("an aligned array is a no-op regardless of order", async () => {
	await withSettings(
		{ defaultTools: ["+codemode", "+tool_search"] },
		async (options) => {
			const plan = planPiSettings(catalog, options.agentDirectory);
			assert.equal(plan.changed, false);
			assert.deepEqual(plan.misaligned, []);
			assert.equal(applyPiSettings(catalog, options.agentDirectory).wrote, false);
		},
	);
});

test("an explicit -codemode is reported and left alone", async () => {
	await withSettings({ defaultTools: ["-codemode"] }, async (options) => {
		const plan = planPiSettings(catalog, options.agentDirectory);
		assert.equal(plan.changed, false);
		assert.deepEqual(plan.misaligned, []);
		assert.deepEqual(plan.conflicts, [
			"defaultTools: -codemode conflicts with +codemode (remove it manually)",
		]);
		assert.equal(applyPiSettings(catalog, options.agentDirectory).wrote, false);
		assert.deepEqual(JSON.parse(await readFile(options.path, "utf8")), {
			defaultTools: ["-codemode"],
		});
	});
});
