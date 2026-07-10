import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	applyMcpConfiguration,
	loadMcpServerCatalog,
	manualMcpConfigurationInstructions,
	planMcpConfiguration,
} from "../extensions/mcp-config.ts";

const catalog = {
	schemaVersion: 1,
	mcpServers: {
		foo: { url: "https://example.test/foo" },
		bar: { url: "https://example.test/bar" },
	},
};

async function withAgentDirectory(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-config-"));
	try {
		const agentDirectory = join(dir, ".pi", "agent");
		mkdirSync(agentDirectory, { recursive: true });
		return await run({ dir, agentDirectory });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function withCatalogFile(catalogContent, run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-mcp-catalog-"));
	try {
		const catalogPath = join(dir, "mcp-servers.json");
		await writeFile(catalogPath, catalogContent, "utf8");
		return await run({ catalogPath });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("loadMcpServerCatalog loads a valid catalog from the given path", async () => {
	await withCatalogFile(JSON.stringify(catalog), async ({ catalogPath }) => {
		const result = loadMcpServerCatalog({ catalogPath });
		assert.deepEqual(result.catalog, catalog);
		assert.equal(result.error, undefined);
	});
});

test("loadMcpServerCatalog reports an error for an invalid schema version", async () => {
	await withCatalogFile(
		JSON.stringify({ schemaVersion: 2, mcpServers: {} }),
		async ({ catalogPath }) => {
			const result = loadMcpServerCatalog({ catalogPath });
			assert.equal(result.catalog, undefined);
			assert.match(result.error, /schemaVersion 1/);
		},
	);
});

test("planMcpConfiguration marks a plan as changed with all additions when no file exists", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const plan = planMcpConfiguration(catalog, { agentDirectory });
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.additions.sort(), ["bar", "foo"]);
		assert.deepEqual(plan.replacements, []);
		assert.equal(plan.error, undefined);
	});
});

test("planMcpConfiguration is a noop when existing definitions already match the catalog", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		await writeFile(
			join(agentDirectory, "mcp.json"),
			`${JSON.stringify({ mcpServers: catalog.mcpServers }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });
		assert.equal(plan.changed, false);
		assert.deepEqual(plan.additions, []);
		assert.deepEqual(plan.replacements, []);
	});
});

test("planMcpConfiguration reports replacements when existing definitions drift from the catalog", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		await writeFile(
			join(agentDirectory, "mcp.json"),
			`${JSON.stringify(
				{ mcpServers: { foo: { url: "https://example.test/drifted" } } },
				null,
				2,
			)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.additions, ["bar"]);
		assert.equal(plan.replacements.length, 1);
		assert.equal(plan.replacements[0].name, "foo");
		assert.deepEqual(plan.replacements[0].expected, catalog.mcpServers.foo);
	});
});

test("planMcpConfiguration reports an error for corrupt existing configuration", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		await writeFile(join(agentDirectory, "mcp.json"), "{ not valid json", "utf8");

		const plan = planMcpConfiguration(catalog, { agentDirectory });
		assert.equal(plan.changed, false);
		assert.match(plan.error, /Refusing to overwrite malformed JSON/);
	});
});

test("applyMcpConfiguration writes the merged configuration atomically on the happy path", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		await writeFile(
			join(agentDirectory, "mcp.json"),
			`${JSON.stringify({ telemetry: { enabled: true } }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });
		const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

		assert.equal(outcome.status, "applied");
		assert.equal(outcome.path, join(agentDirectory, "mcp.json"));
		assert.equal(outcome.wrote, true);

		const written = JSON.parse(await readFile(outcome.path, "utf8"));
		assert.deepEqual(written, {
			telemetry: { enabled: true },
			mcpServers: catalog.mcpServers,
		});
	});
});

test("applyMcpConfiguration refuses when a target changes concurrently after the preview plan", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const configPath = join(agentDirectory, "mcp.json");
		await writeFile(
			configPath,
			`${JSON.stringify({ mcpServers: { custom: { url: "https://example.test/custom" } } }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });

		await writeFile(
			configPath,
			`${JSON.stringify(
				{
					mcpServers: {
						custom: { url: "https://example.test/custom" },
						foo: { url: "https://example.test/changed-after-preview" },
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

		assert.equal(outcome.status, "refused-concurrent-change");
		assert.deepEqual(outcome.changedTargets, ["foo"]);

		const stillOnDisk = JSON.parse(await readFile(configPath, "utf8"));
		assert.deepEqual(stillOnDisk, {
			mcpServers: {
				custom: { url: "https://example.test/custom" },
				foo: { url: "https://example.test/changed-after-preview" },
			},
		});
	});
});

test("applyMcpConfiguration reports reread-failed when the config is corrupted between preview and apply", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const configPath = join(agentDirectory, "mcp.json");
		await writeFile(
			configPath,
			`${JSON.stringify({ mcpServers: { custom: { url: "https://example.test/custom" } } }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });

		await writeFile(configPath, "{ not valid json", "utf8");

		const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

		assert.equal(outcome.status, "reread-failed");
		assert.match(outcome.error, /Refusing to overwrite malformed JSON/);

		const stillOnDisk = await readFile(configPath, "utf8");
		assert.equal(stillOnDisk, "{ not valid json");
	});
});

test("applyMcpConfiguration refuses when a previewed server is deleted before apply, naming it in changedTargets", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const configPath = join(agentDirectory, "mcp.json");
		await writeFile(
			configPath,
			`${JSON.stringify({ mcpServers: { foo: { url: "https://example.test/foo" } } }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });

		await writeFile(
			configPath,
			`${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
			"utf8",
		);

		const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

		assert.equal(outcome.status, "refused-concurrent-change");
		assert.deepEqual(outcome.changedTargets, ["foo"]);
		assert.equal(outcome.latestPlan.error, undefined);
	});
});

test("applyMcpConfiguration is a no-op that leaves the file untouched when the plan already matches the file", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const configPath = join(agentDirectory, "mcp.json");
		await writeFile(
			configPath,
			`${JSON.stringify({ mcpServers: catalog.mcpServers }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });
		assert.equal(plan.changed, false);

		const before = await readFile(configPath, "utf8");
		const statBefore = statSync(configPath).mtimeMs;

		const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

		assert.equal(outcome.status, "applied");
		assert.equal(outcome.path, configPath);
		assert.equal(outcome.wrote, false);

		const after = await readFile(configPath, "utf8");
		assert.equal(after, before);
		assert.equal(statSync(configPath).mtimeMs, statBefore);
	});
});

test("applyMcpConfiguration reports write-failed and leaves no temp file when the directory is not writable", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		await writeFile(
			join(agentDirectory, "mcp.json"),
			`${JSON.stringify({ telemetry: { enabled: true } }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });

		chmodSync(agentDirectory, 0o500);
		try {
			const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

			assert.equal(outcome.status, "write-failed");
			assert.ok(typeof outcome.error === "string" && outcome.error.length > 0);
		} finally {
			chmodSync(agentDirectory, 0o700);
		}

		const leftovers = readdirSync(agentDirectory).filter((name) =>
			name.endsWith(".tmp"),
		);
		assert.deepEqual(leftovers, []);
	});
});

test("applyMcpConfiguration write-failed reports a freshly re-read latestPlan, not the stale preview", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const configPath = join(agentDirectory, "mcp.json");
		await writeFile(
			configPath,
			`${JSON.stringify({ telemetry: { enabled: true } }, null, 2)}\n`,
			"utf8",
		);

		const plan = planMcpConfiguration(catalog, { agentDirectory });
		assert.equal(plan.mergedConfig.telemetry.sampleRate, undefined);

		// Mutate an untracked top-level field after the preview plan was built.
		// This does not touch any catalog-tracked target (foo/bar), so it must
		// not trip changedMcpTargets / refused-concurrent-change.
		await writeFile(
			configPath,
			`${JSON.stringify(
				{ telemetry: { enabled: true, sampleRate: 0.5 } },
				null,
				2,
			)}\n`,
			"utf8",
		);

		chmodSync(agentDirectory, 0o500);
		try {
			const outcome = applyMcpConfiguration(plan, catalog, { agentDirectory });

			assert.equal(outcome.status, "write-failed");
			assert.ok(outcome.latestPlan);
			assert.equal(
				outcome.latestPlan.mergedConfig.telemetry.sampleRate,
				0.5,
			);
		} finally {
			chmodSync(agentDirectory, 0o700);
		}
	});
});

test("manualMcpConfigurationInstructions renders the catalog and flags same-name conflicts", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		await writeFile(
			join(agentDirectory, "mcp.json"),
			`${JSON.stringify({ mcpServers: { foo: { url: "https://example.test/drifted" } } }, null, 2)}\n`,
			"utf8",
		);
		const plan = planMcpConfiguration(catalog, { agentDirectory });

		const instructions = manualMcpConfigurationInstructions(plan, catalog);

		assert.match(instructions, /cannot mutate Pi configuration automatically/i);
		assert.match(instructions, new RegExp(plan.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.match(instructions, /"foo"/);
		assert.match(instructions, /"bar"/);
		assert.match(instructions, /Same-name conflicts must be replaced only after reviewing/);
		assert.match(instructions, /https:\/\/example\.test\/drifted/);
	});
});

test("manualMcpConfigurationInstructions omits the conflict warning when there are no replacements", async () => {
	await withAgentDirectory(async ({ agentDirectory }) => {
		const plan = planMcpConfiguration(catalog, { agentDirectory });

		const instructions = manualMcpConfigurationInstructions(plan, catalog);

		assert.doesNotMatch(
			instructions,
			/Same-name conflicts must be replaced only after reviewing/,
		);
	});
});
