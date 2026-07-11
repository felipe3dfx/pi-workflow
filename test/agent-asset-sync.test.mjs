import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { createAgentAssetSync } from "../extensions/agent-asset-sync.ts";
import { runSyncCommand } from "../extensions/pi-workflow-sync.ts";

function createFakeFilesystem(files = {}) {
	const entries = new Map(Object.entries(files));
	const reads = [];
	const writes = [];
	return {
		reads,
		writes,
		async readFile(path) {
			reads.push(path);
			return entries.get(path);
		},
		async writeFile(path, content) {
			writes.push({ path, content });
		},
	};
}

function digest(content) {
	return createHash("sha256").update(content).digest("hex");
}

const approvedAgentNames = [
	"orchestrator",
	"sdd-init",
	"sdd-explore",
	"sdd-proposal",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-status",
	"sdd-sync",
	"sdd-archive",
	"sdd-onboard",
	"research",
	"prototype",
	"to-spec",
	"to-tickets",
	"review-readability",
	"review-reliability",
	"review-resilience",
	"review-risk",
	"jd-judge-a",
	"jd-judge-b",
	"jd-fix-agent",
	"Explore",
	"Plan",
	"general-purpose",
	"prepare-commit",
	"simplify",
	"product-review",
];

const packageCatalog = {
	schemaVersion: 1,
	assets: [
		{
			kind: "agent",
			name: "orchestrator",
			version: 1,
			content: "---\nname: orchestrator\n---\n",
		},
	],
};

test("packaged plan creates the exact approved agent inventory from verified source assets", async () => {
	const catalog = JSON.parse(
		readFileSync(
			new URL("../assets/agent-assets.json", import.meta.url),
			"utf8",
		),
	);
	const packageDirectory = "/package";
	const sourceFiles = Object.fromEntries(
		catalog.assets.map((asset) => [
			resolve(packageDirectory, asset.source),
			readFileSync(new URL(`../${asset.source}`, import.meta.url), "utf8"),
		]),
	);
	const filesystem = createFakeFilesystem(sourceFiles);
	const sync = createAgentAssetSync({
		catalog,
		filesystem,
		packageDirectory,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const plan = await sync.plan();

	assert.equal(plan.status, "ready");
	assert.deepEqual(
		plan.actions.map(({ name }) => name),
		approvedAgentNames.toSorted(),
	);
	assert.equal(plan.actions.length, 30);
	for (const action of plan.actions) {
		assert.equal(action.kind, "create");
		assert.ok(
			action.content.length > 0,
			`${action.name} source must not be empty`,
		);
		assert.match(action.sourceDigest, /^[a-f0-9]{64}$/);
		assert.equal(digest(action.content), action.sourceDigest);
	}
	assert.deepEqual(filesystem.writes, []);
});

test("inspect blocks when a catalog digest does not match its packaged source", async () => {
	const filesystem = createFakeFilesystem({
		"/package/assets/agents/orchestrator.md": "packaged source",
	});
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "orchestrator",
					version: 1,
					source: "assets/agents/orchestrator.md",
					digest: "0".repeat(64),
				},
			],
		},
		filesystem,
		packageDirectory: "/package",
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.inspect();

	assert.equal(result.status, "blocked");
	assert.deepEqual(result.assets, []);
	assert.deepEqual(result.diagnostics, [
		"Catalog digest mismatch for agent orchestrator at assets/agents/orchestrator.md. Reinstall @felipe.3dfx/pi-workflow before planning; no files were changed.",
	]);
	assert.deepEqual(filesystem.writes, []);
});

test("inspect blocks duplicate catalog names that resolve to the same target", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{ kind: "agent", name: "orchestrator", version: 1, content: "first" },
				{ kind: "agent", name: "orchestrator", version: 1, content: "second" },
			],
		},
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.inspect();

	assert.equal(result.status, "blocked");
	assert.deepEqual(result.assets, []);
	assert.deepEqual(result.diagnostics, [
		"Catalog contains duplicate agent name and target: orchestrator -> /agent/agents/orchestrator.md. Remove duplicate entries before planning; no files were changed.",
	]);
	assert.deepEqual(filesystem.writes, []);
});

test("plan blocks a missing packaged source with actionable remediation", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "orchestrator",
					version: 1,
					source: "assets/agents/orchestrator.md",
					digest: "0".repeat(64),
				},
			],
		},
		filesystem,
		packageDirectory: "/package",
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.plan();

	assert.equal(result.status, "blocked");
	assert.deepEqual(result.actions, []);
	assert.deepEqual(result.diagnostics, [
		"Packaged source assets/agents/orchestrator.md for agent orchestrator is missing. Reinstall @felipe.3dfx/pi-workflow before planning; no files were changed.",
	]);
	assert.deepEqual(filesystem.writes, []);
});

test("inspect rejects an unsupported catalog schema before filesystem inspection", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: { schemaVersion: 2, assets: [] },
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.inspect();

	assert.equal(result.status, "blocked");
	assert.deepEqual(result.assets, []);
	assert.deepEqual(result.diagnostics, [
		"Agent asset catalog schema version 2 is unsupported; expected version 1. Install a compatible pi-workflow package before planning; no files were changed.",
	]);
	assert.deepEqual(filesystem.reads, []);
	assert.deepEqual(filesystem.writes, []);
});

test("inspect rejects an agent source path outside the package-owned agent directory", async () => {
	const filesystem = createFakeFilesystem({ "/escape.md": "outside package" });
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "orchestrator",
					version: 1,
					source: "../escape.md",
					digest: digest("outside package"),
				},
			],
		},
		filesystem,
		packageDirectory: "/package",
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.inspect();

	assert.equal(result.status, "blocked");
	assert.deepEqual(result.diagnostics, [
		"Agent orchestrator has invalid source path ../escape.md; expected assets/agents/orchestrator.md. Use a package-local agent source before planning; no files were changed.",
	]);
	assert.deepEqual(filesystem.reads, []);
	assert.deepEqual(filesystem.writes, []);
});

test("inspect previews a missing package-owned agent without filesystem side effects", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.inspect();

	assert.equal(result.status, "ready");
	assert.deepEqual(result.assets, [
		{
			name: "orchestrator",
			targetPath: "/agent/agents/orchestrator.md",
			ownership: "package",
			packageVersion: 1,
			installedVersion: null,
			drift: "missing",
			collision: false,
			sourcePath: null,
			sourceDigest: digest("---\nname: orchestrator\n---\n"),
		},
	]);
	assert.deepEqual(filesystem.writes, []);
});

test("inspect blocks an unknown future manifest version with actionable remediation", async () => {
	const filesystem = createFakeFilesystem({
		"/agent/.pi-workflow/agent-assets.json": JSON.stringify({
			schemaVersion: 2,
			assets: {},
		}),
	});
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const result = await sync.inspect();

	assert.equal(result.status, "blocked");
	assert.deepEqual(result.assets, []);
	assert.deepEqual(result.diagnostics, [
		"Manifest schema version 2 is newer than supported version 1. Upgrade pi-workflow before syncing; the manifest was not changed.",
	]);
	assert.deepEqual(filesystem.writes, []);
});

test("plan cancellation returns no preview and performs no filesystem operations", async () => {
	const filesystem = createFakeFilesystem();
	const controller = new AbortController();
	controller.abort();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const plan = await sync.plan({ signal: controller.signal });

	assert.equal(plan.status, "canceled");
	assert.deepEqual(plan.actions, []);
	assert.deepEqual(filesystem.reads, []);
	assert.deepEqual(filesystem.writes, []);
});

test("pi-workflow-sync inspect emits the exact read-only preview through the command boundary", async () => {
	const filesystem = createFakeFilesystem();
	const output = [];
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const exitCode = await runSyncCommand(["inspect"], {
		sync,
		write: (text) => output.push(text),
	});

	assert.equal(exitCode, 0);
	assert.equal(output.length, 1);
	const preview = JSON.parse(output[0]);
	assert.equal(preview.status, "ready");
	assert.equal(preview.assets[0].ownership, "package");
	assert.equal(preview.assets[0].drift, "missing");
	assert.deepEqual(filesystem.writes, []);
});

test("inspection and plan digests bind the observed managed predecessor bytes", async () => {
	const manifest = JSON.stringify({
		schemaVersion: 1,
		assets: {
			orchestrator: {
				version: 1,
				digest: digest("expected clean predecessor"),
			},
		},
	});
	function syncFor(content) {
		return createAgentAssetSync({
			catalog: packageCatalog,
			filesystem: createFakeFilesystem({
				"/agent/.pi-workflow/agent-assets.json": manifest,
				"/agent/agents/orchestrator.md": content,
			}),
			agentDirectory: "/agent/agents",
			manifestPath: "/agent/.pi-workflow/agent-assets.json",
		});
	}

	const firstInspection = await syncFor("first predecessor").inspect();
	const secondInspection = await syncFor("second predecessor").inspect();
	const firstPlan = await syncFor("first predecessor").plan();
	const secondPlan = await syncFor("second predecessor").plan();

	assert.notEqual(firstInspection.digest, secondInspection.digest);
	assert.notEqual(firstPlan.digest, secondPlan.digest);
});

test("malformed runtime catalog and manifest inputs fail closed without throwing", async () => {
	for (const catalog of [
		null,
		{},
		{ schemaVersion: 1, assets: null },
		{
			schemaVersion: 1,
			assets: [{ kind: "agent", name: "bad", version: 0, content: "x" }],
		},
	]) {
		const result = await createAgentAssetSync({
			catalog,
			filesystem: createFakeFilesystem(),
			agentDirectory: "/agent/agents",
			manifestPath: "/agent/manifest.json",
		}).inspect();
		assert.equal(result.status, "blocked");
		assert.equal(result.mutation, "none");
		assert.ok(result.diagnostics.length > 0);
	}

	for (const manifest of [
		"{",
		"null",
		JSON.stringify({ schemaVersion: 0, assets: {} }),
		JSON.stringify({ schemaVersion: 1, assets: null }),
		JSON.stringify({ schemaVersion: 1, assets: { orchestrator: null } }),
	]) {
		const result = await createAgentAssetSync({
			catalog: packageCatalog,
			filesystem: createFakeFilesystem({ "/agent/manifest.json": manifest }),
			agentDirectory: "/agent/agents",
			manifestPath: "/agent/manifest.json",
		}).plan();
		assert.equal(result.status, "blocked");
		assert.equal(result.mutation, "none");
		assert.ok(result.diagnostics.length > 0);
	}
});

test("read failures and inline agent traversal return structured refusals", async () => {
	const failingFilesystem = {
		writes: [],
		async readFile() {
			throw new Error("EACCES: permission denied");
		},
	};
	const failedRead = await createAgentAssetSync({
		catalog: packageCatalog,
		filesystem: failingFilesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/manifest.json",
	}).inspect();
	assert.equal(failedRead.status, "blocked");
	assert.match(
		failedRead.diagnostics[0],
		/permission denied.*no files were changed/i,
	);

	const traversal = await createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [{ kind: "agent", name: "../escape", version: 1, content: "x" }],
		},
		filesystem: createFakeFilesystem(),
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/manifest.json",
	}).inspect();
	assert.equal(traversal.status, "blocked");
	assert.deepEqual(traversal.assets, []);
	assert.match(traversal.diagnostics[0], /invalid agent name/i);
});

test("cancellation during the final awaited read discards inspection and plan previews", async () => {
	for (const command of ["inspect", "plan"]) {
		const controller = new AbortController();
		let reads = 0;
		const filesystem = {
			writes: [],
			async readFile() {
				reads += 1;
				if (reads === 2) controller.abort();
				return undefined;
			},
		};
		const result = await createAgentAssetSync({
			catalog: packageCatalog,
			filesystem,
			agentDirectory: "/agent/agents",
			manifestPath: "/agent/manifest.json",
		})[command]({ signal: controller.signal });
		assert.equal(result.status, "canceled");
		assert.deepEqual(result.assets ?? result.actions, []);
		assert.deepEqual(filesystem.writes, []);
	}
});

test("plan cancellation during its final packaged-source read returns no actions", async () => {
	const controller = new AbortController();
	let reads = 0;
	const filesystem = {
		writes: [],
		async readFile(path) {
			reads += 1;
			if (reads === 4) controller.abort();
			if (path.endsWith("orchestrator.md")) return "packaged";
			return undefined;
		},
	};
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "orchestrator",
					version: 1,
					source: "assets/agents/orchestrator.md",
					digest: digest("packaged"),
				},
			],
		},
		filesystem,
		packageDirectory: "/package",
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/manifest.json",
	});

	const result = await sync.plan({ signal: controller.signal });

	assert.equal(reads, 4);
	assert.equal(result.status, "canceled");
	assert.deepEqual(result.actions, []);
	assert.deepEqual(filesystem.writes, []);
});

test("command cancellation uses conventional non-zero exit status", async () => {
	const exitCode = await runSyncCommand(["plan"], {
		sync: {
			async plan() {
				return { status: "canceled" };
			},
		},
		write() {},
	});
	assert.equal(exitCode, 130);
});

test("packed agent catalog passes the deterministic inventory and digest check", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/check-agent-assets.mjs", "--check"],
		{
			cwd: new URL("..", import.meta.url),
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr);
});

test("plan distinguishes create, replace, migrate, and refusal while excluding non-agent setup", async () => {
	const assets = [
		{ kind: "agent", name: "create", version: 2, content: "create-v2" },
		{ kind: "agent", name: "replace", version: 2, content: "replace-v2" },
		{ kind: "agent", name: "migrate", version: 2, content: "migrate-v2" },
		{ kind: "agent", name: "modified", version: 2, content: "modified-v2" },
		{ kind: "agent", name: "collision", version: 2, content: "collision-v2" },
		{ kind: "agent", name: "future", version: 2, content: "future-v2" },
		{
			kind: "skill",
			name: "define-product",
			version: 1,
			content: "native skill",
		},
		{
			kind: "template",
			name: "deliver-ticket",
			version: 1,
			content: "native template",
		},
		{
			kind: "companion",
			name: "gentle-engram",
			version: 1,
			content: "external package",
		},
		{ kind: "mcp", name: "linear", version: 1, content: "external setup" },
	];
	const manifest = {
		schemaVersion: 1,
		assets: {
			replace: { version: 2, digest: digest("replace-v1") },
			migrate: { version: 1, digest: digest("migrate-v1") },
			modified: { version: 2, digest: digest("modified-clean") },
			future: { version: 3, digest: digest("future-v3") },
		},
	};
	const filesystem = createFakeFilesystem({
		"/agent/.pi-workflow/agent-assets.json": JSON.stringify(manifest),
		"/agent/agents/replace.md": "replace-v1",
		"/agent/agents/migrate.md": "migrate-v1",
		"/agent/agents/modified.md": "locally changed",
		"/agent/agents/collision.md": "unmanaged file",
		"/agent/agents/future.md": "future-v3",
	});
	const sync = createAgentAssetSync({
		catalog: { schemaVersion: 1, assets },
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const inspection = await sync.inspect();
	const plan = await sync.plan();

	assert.equal(plan.inspectionDigest, inspection.digest);
	assert.match(plan.digest, /^[a-f0-9]{64}$/);
	assert.deepEqual(
		plan.actions.map(({ name, kind }) => ({ name, kind })),
		[
			{ name: "collision", kind: "refusal" },
			{ name: "create", kind: "create" },
			{ name: "future", kind: "refusal" },
			{ name: "migrate", kind: "migrate" },
			{ name: "modified", kind: "refusal" },
			{ name: "replace", kind: "replace" },
		],
	);
	assert.equal(plan.status, "blocked");
	assert.deepEqual(
		plan.actions
			.filter(({ kind }) => kind === "refusal")
			.map(({ name, reason }) => ({ name, reason })),
		[
			{ name: "collision", reason: "unmanaged-collision" },
			{ name: "future", reason: "future-version" },
			{ name: "modified", reason: "managed-drift" },
		],
	);
	for (const refusal of plan.actions.filter(({ kind }) => kind === "refusal")) {
		assert.ok(refusal.remediation, `${refusal.name} must include remediation`);
		assert.match(refusal.remediation, /pi-workflow|manifest|file|version/i);
	}
	assert.deepEqual(filesystem.writes, []);
});
