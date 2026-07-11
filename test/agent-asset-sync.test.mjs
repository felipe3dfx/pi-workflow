import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createAgentAssetSync } from "../extensions/agent-asset-sync.ts";
import {
	createVerifiedOperation,
	verifyOperationBackups,
	verifyOperationManifest,
} from "../extensions/agent-asset-operation.ts";
import { runSyncCommand } from "../extensions/pi-workflow-sync.ts";

function createFakeFilesystem(files = {}) {
	const entries = new Map(Object.entries(files));
	const reads = [];
	const writes = [];
	const mutations = [];
	let mutationActive = false;
	return {
		reads,
		writes,
		mutations,
		set(path, content) {
			entries.set(path, content);
		},
		delete(path) {
			entries.delete(path);
		},
		snapshot() {
			return Object.fromEntries(entries);
		},
		async readFile(path) {
			reads.push(path);
			return entries.get(path);
		},
		async writeFileAtomic(path, content, expectedDigest) {
			const current = entries.get(path);
			const currentDigest = current === undefined ? null : digest(current);
			if (expectedDigest !== undefined && currentDigest !== expectedDigest)
				throw new Error(`Concurrent change detected at ${path}`);
			writes.push({ path, content, mutationActive });
			entries.set(path, content);
		},
		async removeFileAtomic(path, expectedDigest) {
			const current = entries.get(path);
			const currentDigest = current === undefined ? null : digest(current);
			if (currentDigest !== expectedDigest)
				throw new Error(`Concurrent change detected at ${path}`);
			writes.push({ path, content: undefined, mutationActive });
			entries.delete(path);
		},
		async withMutation(operationId, run) {
			mutations.push({ phase: "acquire", operationId });
			mutationActive = true;
			try {
				return await run();
			} finally {
				mutationActive = false;
				mutations.push({ phase: "release", operationId });
			}
		},
		isMutationActive() {
			return mutationActive;
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

test("operation evidence derives a nonce-bound self-verifying manifest and backs up before use", async () => {
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": "version one",
		"/agent/.pi-workflow/agent-assets.json": "manifest before",
	});
	const input = {
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		nonce: "first-nonce",
		planDigest: digest("approved plan"),
		manifestBeforeDigest: digest("manifest before"),
		manifestAfterDigest: digest("manifest after"),
		manifestBeforeContent: "manifest before",
		targets: [
			{
				targetPath: "/agent/agents/orchestrator.md",
				fromVersion: 1,
				toVersion: 2,
				previousContent: "version one",
				sourceDigest: digest("version two"),
				sourceContent: "version two",
			},
		],
	};

	const prepared = await createVerifiedOperation(input, filesystem);
	assert.equal(prepared.ok, true);
	assert.equal(verifyOperationManifest(prepared.value).ok, true);
	assert.equal(filesystem.writes.length, 3);
	assert.equal(
		filesystem.writes[0].path,
		`${input.operationDirectory}/${prepared.value.operationId}/0.backup`,
	);
	assert.equal(filesystem.writes[0].content, "version one");
	assert.equal(filesystem.writes[1].content, "manifest before");
	assert.equal(filesystem.writes[2].content, "version two");
	assert.equal((await verifyOperationBackups(prepared.value, filesystem)).ok, true);

	const differentNonce = await createVerifiedOperation(
		{ ...input, nonce: "second-nonce" },
		createFakeFilesystem({
			"/agent/agents/orchestrator.md": "version one",
			"/agent/.pi-workflow/agent-assets.json": "manifest before",
		}),
	);
	assert.equal(differentNonce.ok, true);
	assert.notEqual(prepared.value.operationId, differentNonce.value.operationId);
});

test("operation evidence blocks missing or corrupt backups without accepting recovery state", async () => {
	const input = {
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		nonce: "backup-refusal",
		planDigest: digest("approved plan"),
		manifestBeforeDigest: digest("manifest before"),
		manifestAfterDigest: digest("manifest after"),
		manifestBeforeContent: "manifest before",
		targets: [
			{
				targetPath: "/agent/agents/orchestrator.md",
				fromVersion: 1,
				toVersion: 2,
				previousContent: "version one",
				sourceDigest: digest("version two"),
				sourceContent: "version two",
			},
		],
	};
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": "version one",
		"/agent/.pi-workflow/agent-assets.json": "manifest before",
	});
	const prepared = await createVerifiedOperation(input, filesystem);
	assert.equal(prepared.ok, true);
	filesystem.set(prepared.value.targets[0].backupPath, "corrupted backup");

	const result = await verifyOperationBackups(prepared.value, filesystem);
	assert.equal(result.ok, false);
	assert.match(result.diagnostic, /backup digest/i);
	filesystem.delete(prepared.value.targets[0].backupPath);
	const missing = await verifyOperationBackups(prepared.value, filesystem);
	assert.equal(missing.ok, false);
	assert.match(missing.diagnostic, /backup digest/i);
});

test("operation evidence records originally missing targets without inventing a backup", async () => {
	const filesystem = createFakeFilesystem();
	const prepared = await createVerifiedOperation(
		{
			operationDirectory: "/agent/.pi-workflow/sync-operations",
			manifestPath: "/agent/.pi-workflow/agent-assets.json",
			nonce: "missing-target",
			planDigest: digest("approved plan"),
			manifestBeforeDigest: null,
			manifestAfterDigest: digest("manifest after"),
			manifestBeforeContent: undefined,
			targets: [
				{
					targetPath: "/agent/agents/new-agent.md",
					fromVersion: null,
					toVersion: 1,
					previousContent: undefined,
					sourceDigest: digest("new agent"),
					sourceContent: "new agent",
				},
			],
		},
		filesystem,
	);

	assert.equal(prepared.ok, true);
	assert.equal(prepared.value.targets[0].originallyMissing, true);
	assert.equal(prepared.value.targets[0].backupDigest, null);
	assert.equal(filesystem.writes.length, 1);
	const verified = await verifyOperationBackups(prepared.value, filesystem);
	assert.equal(verified.ok, true);
});

test("operation evidence refuses to back up a target that changed after the approved snapshot", async () => {
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": "changed after planning",
		"/agent/.pi-workflow/agent-assets.json": "manifest before",
	});
	const prepared = await createVerifiedOperation(
		{
			operationDirectory: "/agent/.pi-workflow/sync-operations",
			manifestPath: "/agent/.pi-workflow/agent-assets.json",
			nonce: "changed-predecessor",
			planDigest: digest("approved plan"),
			manifestBeforeDigest: digest("manifest before"),
			manifestAfterDigest: digest("manifest after"),
			manifestBeforeContent: "manifest before",
			targets: [
				{
					targetPath: "/agent/agents/orchestrator.md",
					fromVersion: 1,
					toVersion: 2,
					previousContent: "version one",
				sourceDigest: digest("version two"),
				sourceContent: "version two",
				},
			],
		},
		filesystem,
	);

	assert.equal(prepared.ok, false);
	assert.equal(filesystem.writes.length, 0);
	assert.match(prepared.diagnostic, /changed after planning/i);
});

test("apply confirms, atomically creates an agent, and verifies its manifest by read-back", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();
	let confirmedPlan;

	const result = await sync.apply(plan, {
		confirm: async (candidate) => {
			confirmedPlan = candidate;
			return true;
		},
	});

	assert.equal(confirmedPlan.digest, plan.digest);
	assert.equal(result.status, "applied");
	assert.equal(result.mutation, "applied");
	assert.equal(result.readiness, "ready");
	assert.deepEqual(result.assets, [
		{
			name: "orchestrator",
			targetPath: "/agent/agents/orchestrator.md",
			version: 1,
			digest: digest("---\nname: orchestrator\n---\n"),
			verified: true,
		},
	]);
	assert.match(filesystem.writes[0].path, /\/0\.successor$/);
	assert.match(filesystem.writes[1].path, /\/operation\.json$/);
	assert.equal(filesystem.writes[2].path, "/agent/agents/orchestrator.md");
	assert.deepEqual(JSON.parse(filesystem.writes[3].content), {
		schemaVersion: 1,
		assets: {
			orchestrator: {
				ownership: "package",
				version: 1,
				digest: digest("---\nname: orchestrator\n---\n"),
			},
		},
	});
});

test("apply cancellation leaves the approved plan untouched", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();

	const result = await sync.apply(plan, { confirm: async () => false });

	assert.equal(result.status, "canceled");
	assert.equal(result.mutation, "none");
	assert.deepEqual(filesystem.writes, []);
});

test("apply refuses a concurrent target change after confirmation", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();

	const result = await sync.apply(plan, {
		confirm: async () => {
			filesystem.set("/agent/agents/orchestrator.md", "concurrent content");
			return true;
		},
	});

	assert.equal(result.status, "blocked");
	assert.equal(result.mutation, "none");
	assert.match(result.diagnostics[0], /changed after planning/i);
	assert.deepEqual(filesystem.writes, []);
});

test("apply resumes an interrupted approved create idempotently", async () => {
	const filesystem = createFakeFilesystem();
	let manifestAttempts = 0;
	const originalWrite = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content) => {
		if (path.endsWith("agent-assets.json") && manifestAttempts++ === 0)
			throw new Error("interrupted");
		await originalWrite(path, content);
	};
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();

	const interrupted = await sync.apply(plan, { confirm: async () => true });
	const resumed = await sync.apply(plan, { confirm: async () => true });

	assert.equal(interrupted.status, "blocked");
	assert.equal(interrupted.mutation, "applied");
	assert.equal(resumed.status, "applied");
	assert.equal(resumed.readiness, "ready");
	assert.equal(
		filesystem.writes.filter(
			(write) => write.path === "/agent/agents/orchestrator.md",
		).length,
		1,
	);
});

test("apply resumes only unfinished assets after a partial multi-asset interruption", async () => {
	const filesystem = createFakeFilesystem();
	let interrupted = false;
	const originalWrite = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content) => {
		if (path.endsWith("second.md") && !interrupted) {
			interrupted = true;
			throw new Error("interrupted between assets");
		}
		await originalWrite(path, content);
	};
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{ kind: "agent", name: "first", version: 1, content: "first" },
				{ kind: "agent", name: "second", version: 1, content: "second" },
			],
		},
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();

	const firstAttempt = await sync.apply(plan, { confirm: async () => true });
	const resumed = await sync.apply(plan, { confirm: async () => true });

	assert.equal(firstAttempt.status, "blocked");
	assert.equal(resumed.status, "applied");
	assert.deepEqual(
		filesystem.writes
			.filter((write) => write.path.endsWith(".md"))
			.map((write) => write.path),
		["/agent/agents/first.md", "/agent/agents/second.md"],
	);
});

test("apply cancellation between assets reports canceled and remains resumable", async () => {
	const controller = new AbortController();
	const filesystem = createFakeFilesystem();
	const originalWrite = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content, expectedDigest) => {
		await originalWrite(path, content, expectedDigest);
		if (path.endsWith("first.md")) controller.abort();
	};
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{ kind: "agent", name: "first", version: 1, content: "first" },
				{ kind: "agent", name: "second", version: 1, content: "second" },
			],
		},
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();

	const canceled = await sync.apply(plan, {
		confirm: async () => true,
		signal: controller.signal,
	});
	const resumed = await sync.apply(plan, { confirm: async () => true });

	assert.equal(canceled.status, "canceled");
	assert.equal(canceled.mutation, "applied");
	assert.equal(resumed.status, "applied");
});

test("pi-workflow-sync apply confirms and emits verified readiness through the command boundary", async () => {
	const filesystem = createFakeFilesystem();
	const output = [];
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});

	const exitCode = await runSyncCommand(["apply"], {
		sync,
		confirm: async (plan) => plan.actions.length === 1,
		write: (text) => output.push(text),
	});

	assert.equal(exitCode, 0);
	const result = JSON.parse(output[0]);
	assert.equal(result.status, "applied");
	assert.equal(result.readiness, "ready");
});

test("apply replaces a clean managed asset and preserves unrelated manifest ownership", async () => {
	const oldContent = "old managed agent";
	const manifestPath = "/agent/.pi-workflow/agent-assets.json";
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": oldContent,
		[manifestPath]: JSON.stringify({
			schemaVersion: 1,
			assets: {
				orchestrator: {
					ownership: "package",
					version: 1,
					digest: digest(oldContent),
				},
				legacy: {
					ownership: "package",
					version: 1,
					digest: digest("legacy"),
				},
			},
		}),
	});
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath,
	});
	const plan = await sync.plan();

	const result = await sync.apply(plan, { confirm: async () => true });

	assert.equal(plan.actions[0].kind, "replace");
	assert.equal(result.status, "applied");
	const manifest = JSON.parse(
		filesystem.writes.find((write) => write.path === manifestPath).content,
	);
	assert.equal(manifest.assets.legacy.digest, digest("legacy"));
	assert.equal(manifest.assets.orchestrator.ownership, "package");
	assert.equal(
		manifest.assets.orchestrator.digest,
		digest("---\nname: orchestrator\n---\n"),
	);
});

test("apply rejects a modified plan digest before confirmation or writes", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();
	let confirmations = 0;
	plan.actions[0].content = "tampered";

	const result = await sync.apply(plan, {
		confirm: async () => {
			confirmations += 1;
			return true;
		},
	});

	assert.equal(result.status, "blocked");
	assert.equal(confirmations, 0);
	assert.deepEqual(filesystem.writes, []);
});

test("apply blocks readiness when manifest read-back differs from the atomic write", async () => {
	const filesystem = createFakeFilesystem();
	const originalWrite = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content) => {
		await originalWrite(path, content);
		if (path.endsWith("agent-assets.json")) {
			filesystem.set(path, JSON.stringify({ schemaVersion: 1, assets: {} }));
		}
	};
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	});
	const plan = await sync.plan();

	const result = await sync.apply(plan, { confirm: async () => true });

	assert.equal(result.status, "blocked");
	assert.equal(result.mutation, "applied");
	assert.equal(result.readiness, "blocked");
	assert.match(result.diagnostics[0], /read-back verification failed/i);
});

test("apply persists verified recovery evidence before replacing an asset or its private manifest", async () => {
	const predecessor = "version one";
	const manifestContent = JSON.stringify({
		schemaVersion: 1,
		assets: {
			orchestrator: {
				ownership: "package",
				version: 1,
				digest: digest(predecessor),
			},
		},
	});
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": predecessor,
		"/agent/.pi-workflow/agent-assets.json": manifestContent,
	});
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "orchestrator",
					version: 2,
					content: "version two",
				},
			],
		},
		migrations: [
			{
				subject: "orchestrator",
				fromVersion: 1,
				toVersion: 2,
				fromDigest: digest(predecessor),
				toDigest: digest("version two"),
			},
		],
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		nonce: () => "apply-recovery",
	});

	const result = await sync.apply(await sync.plan(), { confirm: async () => true });

	assert.equal(result.status, "applied");
	assert.match(filesystem.writes[0].path, /\/0\.backup$/);
	assert.match(filesystem.writes[1].path, /\/1\.backup$/);
	assert.equal(filesystem.writes[1].content, manifestContent);
	assert.match(filesystem.writes[2].path, /\/0\.successor$/);
	assert.match(filesystem.writes[3].path, /\/operation\.json$/);
	assert.equal(filesystem.writes[4].path, "/agent/agents/orchestrator.md");
	assert.equal(filesystem.writes[5].path, "/agent/.pi-workflow/agent-assets.json");
	const operation = JSON.parse(filesystem.writes[3].content);
	assert.equal(operation.targets[0].backupDigest, digest(predecessor));
	assert.equal(operation.manifestBeforeDigest, digest(manifestContent));
	assert.equal(operation.manifestBackupDigest, digest(manifestContent));
});

test("apply refuses an interrupted recovery-evidence write before mutating an asset", async () => {
	const filesystem = createFakeFilesystem();
	const originalWrite = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content, expectedDigest) => {
		if (path.endsWith("operation.json")) throw new Error("interrupted evidence");
		await originalWrite(path, content, expectedDigest);
	};
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		nonce: () => "interrupted-evidence",
	});

	const result = await sync.apply(await sync.plan(), { confirm: async () => true });

	assert.equal(result.status, "blocked");
	assert.equal(result.mutation, "none");
	assert.equal(filesystem.writes.length, 1);
	assert.match(filesystem.writes[0].path, /\.successor$/);
	assert.equal(await filesystem.readFile("/agent/agents/orchestrator.md"), undefined);
});

test("resume requires the exact operation ID and verified manifest before restoring a partial apply", async () => {
	const predecessor = "version one";
	const manifestPath = "/agent/.pi-workflow/agent-assets.json";
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": predecessor,
		[manifestPath]: JSON.stringify({
			schemaVersion: 1,
			assets: {
				orchestrator: {
					ownership: "package",
					version: 1,
					digest: digest(predecessor),
				},
				legacy: {
					ownership: "package",
					version: 1,
					digest: digest("legacy"),
				},
			},
		}),
	});
	const sync = createAgentAssetSync({
		catalog: { schemaVersion: 1, assets: [{ kind: "agent", name: "orchestrator", version: 2, content: "version two" }] },
		migrations: [{ subject: "orchestrator", fromVersion: 1, toVersion: 2, fromDigest: digest(predecessor), toDigest: digest("version two") }],
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath,
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		nonce: () => "resume-operation",
	});
	const applied = await sync.apply(await sync.plan(), { confirm: async () => true });
	const operationPath = `/agent/.pi-workflow/sync-operations/${applied.operationId}/operation.json`;
	const operation = JSON.parse(await filesystem.readFile(operationPath));
	filesystem.set("/agent/agents/orchestrator.md", predecessor);
	filesystem.set(manifestPath, await filesystem.readFile(operation.manifestBackupPath));
	const writesBeforeInvalidId = filesystem.writes.length;

	const invalidId = await sync.resume("0".repeat(64));
	assert.equal(filesystem.writes.length, writesBeforeInvalidId);
	const resumed = await sync.resume(applied.operationId);

	assert.equal(invalidId.status, "blocked");
	assert.equal(filesystem.writes.length, writesBeforeInvalidId + 2);
	assert.equal(resumed.status, "applied");
	assert.equal(await filesystem.readFile("/agent/agents/orchestrator.md"), "version two");
	assert.equal(JSON.parse(await filesystem.readFile(manifestPath)).assets.legacy.digest, digest("legacy"));
});

test("recovery refuses stale evidence or a third target state without mutation", async () => {
	const filesystem = createFakeFilesystem();
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		nonce: () => "refuse-recovery",
	});
	const applied = await sync.apply(await sync.plan(), { confirm: async () => true });
	const operationPath = `/agent/.pi-workflow/sync-operations/${applied.operationId}/operation.json`;
	const writesBeforeCorrupt = filesystem.writes.length;
	filesystem.set(operationPath, "{corrupt");

	const corrupt = await sync.rollback(applied.operationId);
	assert.equal(corrupt.status, "blocked");
	assert.equal(filesystem.writes.length, writesBeforeCorrupt);

	const operation = JSON.parse(filesystem.writes.find((write) => write.path === operationPath).content);
	filesystem.set(operationPath, JSON.stringify(operation));
	filesystem.set("/agent/agents/orchestrator.md", "third state");
	const writesBeforeThirdState = filesystem.writes.length;
	const thirdState = await sync.rollback(applied.operationId);

	assert.equal(thirdState.status, "blocked");
	assert.equal(filesystem.writes.length, writesBeforeThirdState);
	assert.equal(await filesystem.readFile("/agent/agents/orchestrator.md"), "third state");
});

test("rollback atomically restores predecessors, removes originally absent paths, and preserves project overrides", async () => {
	const filesystem = createFakeFilesystem({
		"/project/.pi/agents/orchestrator.md": "project override",
	});
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		nonce: () => "rollback-operation",
	});
	const applied = await sync.apply(await sync.plan(), { confirm: async () => true });

	const rolledBack = await sync.rollback(applied.operationId);

	assert.equal(rolledBack.status, "applied");
	assert.equal(await filesystem.readFile("/agent/agents/orchestrator.md"), undefined);
	assert.equal(await filesystem.readFile("/agent/.pi-workflow/agent-assets.json"), undefined);
	assert.equal(await filesystem.readFile("/project/.pi/agents/orchestrator.md"), "project override");
});

test("rollback restores verified predecessors after the catalog advances while resume requires durable successor evidence", async () => {
	const predecessor = "version one";
	const manifestPath = "/agent/.pi-workflow/agent-assets.json";
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": predecessor,
		[manifestPath]: JSON.stringify({ schemaVersion: 1, assets: { orchestrator: { ownership: "package", version: 1, digest: digest(predecessor) } } }),
	});
	const before = createAgentAssetSync({
		catalog: { schemaVersion: 1, assets: [{ kind: "agent", name: "orchestrator", version: 2, content: "version two" }] },
		migrations: [{ subject: "orchestrator", fromVersion: 1, toVersion: 2, fromDigest: digest(predecessor), toDigest: digest("version two") }],
		filesystem, agentDirectory: "/agent/agents", manifestPath, operationDirectory: "/agent/.pi-workflow/sync-operations", nonce: () => "catalog-advance",
	});
	const applied = await before.apply(await before.plan(), { confirm: async () => true });
	const after = createAgentAssetSync({
		catalog: { schemaVersion: 1, assets: [{ kind: "agent", name: "orchestrator", version: 3, content: "version three" }] },
		filesystem, agentDirectory: "/agent/agents", manifestPath, operationDirectory: "/agent/.pi-workflow/sync-operations",
	});

	const rolledBack = await after.rollback(applied.operationId);
	assert.equal(rolledBack.status, "applied");
	assert.equal(await filesystem.readFile("/agent/agents/orchestrator.md"), predecessor);
	assert.equal((await after.resume(applied.operationId)).status, "applied");
	assert.equal(await filesystem.readFile("/agent/agents/orchestrator.md"), "version two");
});

test("recovery reports applied mutation when a later rollback write fails", async () => {
	const filesystem = createFakeFilesystem({
		"/agent/.pi-workflow/agent-assets.json": JSON.stringify({ schemaVersion: 1, assets: {} }),
	});
	const sync = createAgentAssetSync({
		catalog: packageCatalog, filesystem, agentDirectory: "/agent/agents", manifestPath: "/agent/.pi-workflow/agent-assets.json", operationDirectory: "/agent/.pi-workflow/sync-operations", nonce: () => "partial-rollback",
	});
	const applied = await sync.apply(await sync.plan(), { confirm: async () => true });
	const write = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content, expectedDigest) => {
		if (path.endsWith("agent-assets.json")) throw new Error("manifest write interrupted");
		return write(path, content, expectedDigest);
	};

	const result = await sync.rollback(applied.operationId);
	assert.equal(result.status, "blocked");
	assert.equal(result.mutation, "applied");
	assert.match(result.diagnostics[0], /partial mutation/i);
});

test("apply, resume, and rollback hold one mutation boundary through durable evidence and report uncertain receipts", async () => {
	const manifestPath = "/agent/.pi-workflow/agent-assets.json";
	const filesystem = createFakeFilesystem({ [manifestPath]: JSON.stringify({ schemaVersion: 1, assets: {} }) });
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath,
		operationDirectory: "/agent/.pi-workflow/sync-operations",
		nonce: () => "durable-boundary",
	});

	const applied = await sync.apply(await sync.plan(), { confirm: async () => true });
	const operationId = applied.operationId;
	assert.equal(applied.status, "applied");
	assert.equal(filesystem.mutations.length, 2);
	assert.deepEqual(filesystem.mutations.map(({ phase }) => phase), ["acquire", "release"]);
	assert.equal(filesystem.writes.every((write) => write.mutationActive), true);

	const resumed = await sync.resume(operationId);
	const rolledBack = await sync.rollback(operationId);

	assert.equal(resumed.status, "applied");
	assert.equal(rolledBack.status, "applied");
	assert.deepEqual(filesystem.mutations.map(({ phase }) => phase), [
		"acquire", "release", "acquire", "release", "acquire", "release",
	]);
});

test("apply preserves an applied durability-uncertain receipt from the filesystem boundary", async () => {
	const filesystem = createFakeFilesystem();
	const write = filesystem.writeFileAtomic;
	filesystem.writeFileAtomic = async (path, content, expectedDigest) => {
		await write(path, content, expectedDigest);
		if (path.endsWith("orchestrator.md")) {
			const error = new Error("parent directory sync failed");
			error.mutation = "applied";
			error.durability = "uncertain";
			throw error;
		}
	};
	const sync = createAgentAssetSync({
		catalog: packageCatalog,
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
		nonce: () => "uncertain-receipt",
	});

	const result = await sync.apply(await sync.plan(), { confirm: async () => true });

	assert.equal(result.status, "blocked");
	assert.equal(result.mutation, "applied");
	assert.equal(result.durability, "uncertain");
});

test("apply preserves successful and partial operation receipts when cooperative lock release is uncertain", async () => {
	for (const partial of [false, true]) {
		const filesystem = createFakeFilesystem();
		const withMutation = filesystem.withMutation;
		filesystem.withMutation = async (operationId, run) => {
			let operationResult;
			try {
				operationResult = await withMutation(operationId, run);
				if (partial) {
					const error = new Error("post-publish write failed");
					error.mutation = "applied";
					error.durability = "uncertain";
					throw error;
				}
			} catch {}
			const error = new Error("lock release parent sync failed");
			error.operationResult = operationResult;
			error.mutation = operationResult?.mutation ?? "applied";
			error.durability = "uncertain";
			throw error;
		};
		const sync = createAgentAssetSync({
			catalog: packageCatalog,
			filesystem,
			agentDirectory: "/agent/agents",
			manifestPath: "/agent/.pi-workflow/agent-assets.json",
			nonce: () => `release-${partial}`,
		});

		const result = await sync.apply(await sync.plan(), { confirm: async () => true });

		assert.equal(result.status, "blocked");
		assert.equal(result.mutation, "applied");
		assert.equal(result.durability, "uncertain");
		assert.match(result.diagnostics[0], /release/i);
	}
});

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
			installedDigest: null,
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
				ownership: "package",
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

test("pi-workflow-sync routes exact recovery commands with operation IDs and refuses invalid arguments", async () => {
	const operationId = "a".repeat(64);
	const output = [];
	const calls = [];
	const sync = {
		async resume(value) {
			calls.push(["resume", value]);
			return { status: "applied", mutation: "applied", operationId: value };
		},
		async rollback(value) {
			calls.push(["rollback", value]);
			return { status: "blocked", mutation: "none", operationId: value };
		},
	};

	const resumed = await runSyncCommand(["resume", operationId], {
		sync,
		write: (text) => output.push(text),
	});
	const rolledBack = await runSyncCommand(["rollback", operationId], {
		sync,
		write: (text) => output.push(text),
	});
	const invalid = await runSyncCommand(["resume", "not-an-operation-id"], {
		sync,
		write: (text) => output.push(text),
	});
	const extra = await runSyncCommand(["apply", operationId], {
		sync,
		write: (text) => output.push(text),
	});

	assert.equal(resumed, 0);
	assert.equal(rolledBack, 1);
	assert.equal(invalid, 2);
	assert.equal(extra, 2);
	assert.deepEqual(calls, [
		["resume", operationId],
		["rollback", operationId],
	]);
	assert.equal(JSON.parse(output[0]).operationId, operationId);
	assert.equal(JSON.parse(output[1]).operationId, operationId);
	assert.equal(output[2], "Usage: pi-workflow-sync <inspect|plan|apply|resume <operationId>|rollback <operationId>>");
	assert.equal(output[3], "Usage: pi-workflow-sync <inspect|plan|apply|resume <operationId>|rollback <operationId>>");
});

test("pi-workflow-sync recovers only global operation state and atomically removes rollback targets", async () => {
	const root = mkdtempSync(resolve(tmpdir(), "pi-workflow-sync-"));
	const agentHome = resolve(root, "global-agent-home");
	const projectOverride = resolve(root, "project", ".pi", "agents", "orchestrator.md");
	const agentDirectory = resolve(agentHome, "agents");
	const manifestPath = resolve(agentHome, ".pi-workflow", "agent-assets.json");
	const operationDirectory = resolve(agentHome, ".pi-workflow", "sync-operations");
	const filesystem = createFakeFilesystem();
	const packagedCatalog = JSON.parse(
		readFileSync(resolve("assets", "agent-assets.json"), "utf8"),
	);
	const packagedAgent = packagedCatalog.assets.find(
		(asset) => asset.kind === "agent" && asset.name === "orchestrator",
	);
	const catalog = {
		schemaVersion: packagedCatalog.schemaVersion,
		assets: [
			{
				...packagedAgent,
				content: readFileSync(resolve(packagedAgent.source), "utf8"),
				source: undefined,
			},
		],
	};

	try {
		const sync = createAgentAssetSync({
			catalog,
			filesystem,
			packageDirectory: resolve("."),
			agentDirectory,
			manifestPath,
			operationDirectory,
			nonce: () => "global-adapter-recovery",
		});
		const applied = await sync.apply(await sync.plan(), { confirm: async () => true });
		assert.equal(applied.status, "applied", applied.diagnostics.join("\n"));
		assert.ok(applied.operationId);
		for (const [path, content] of Object.entries(filesystem.snapshot())) {
			mkdirSync(resolve(path, ".."), { recursive: true });
			writeFileSync(path, content, "utf8");
		}
		mkdirSync(resolve(projectOverride, ".."), { recursive: true });
		writeFileSync(projectOverride, "project override", "utf8");

		const result = spawnSync(
			process.execPath,
			["scripts/pi-workflow-sync.mjs", "rollback", applied.operationId],
			{
				cwd: resolve("."),
				encoding: "utf8",
				env: { ...process.env, PI_CODING_AGENT_DIR: agentHome },
			},
		);

		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout).operationId, applied.operationId);
		assert.equal(existsSync(resolve(agentDirectory, "orchestrator.md")), false);
		assert.equal(existsSync(manifestPath), false);
		assert.equal(readFileSync(projectOverride, "utf8"), "project override");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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
			replace: {
				ownership: "package",
				version: 2,
				digest: digest("replace-v1"),
			},
			migrate: {
				ownership: "package",
				version: 1,
				digest: digest("migrate-v1"),
			},
			modified: {
				ownership: "package",
				version: 2,
				digest: digest("modified-clean"),
			},
			future: {
				ownership: "package",
				version: 3,
				digest: digest("future-v3"),
			},
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
		migrations: [
			{
				subject: "migrate",
				fromVersion: 1,
				toVersion: 2,
				fromDigest: digest("migrate-v1"),
				toDigest: digest("migrate-v2"),
			},
		],
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

test("plan composes digest-bound adjacent migrations for a managed version jump", async () => {
	const predecessor = "agent version one";
	const intermediate = "agent version two";
	const successor = "agent version three";
	const filesystem = createFakeFilesystem({
		"/agent/agents/orchestrator.md": predecessor,
		"/agent/.pi-workflow/agent-assets.json": JSON.stringify({
			schemaVersion: 1,
			assets: {
				orchestrator: {
					ownership: "package",
					version: 1,
					digest: digest(predecessor),
				},
			},
		}),
	});
	const plan = await createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{ kind: "agent", name: "orchestrator", version: 3, content: successor },
			],
		},
		migrations: [
			{
				subject: "orchestrator",
				fromVersion: 1,
				toVersion: 2,
				fromDigest: digest(predecessor),
				toDigest: digest(intermediate),
			},
			{
				subject: "orchestrator",
				fromVersion: 2,
				toVersion: 3,
				fromDigest: digest(intermediate),
				toDigest: digest(successor),
			},
		],
		filesystem,
		agentDirectory: "/agent/agents",
		manifestPath: "/agent/.pi-workflow/agent-assets.json",
	}).plan();

	assert.equal(plan.status, "ready");
	assert.deepEqual(plan.actions[0].migrationSteps, [
		{ subject: "orchestrator", fromVersion: 1, toVersion: 2, fromDigest: digest(predecessor), toDigest: digest(intermediate) },
		{ subject: "orchestrator", fromVersion: 2, toVersion: 3, fromDigest: digest(intermediate), toDigest: digest(successor) },
	]);
	assert.deepEqual(filesystem.writes, []);
});

test("plan blocks incomplete, duplicate, and digest-invalid migration chains without mutation", async () => {
	const predecessor = "agent version one";
	const successor = "agent version three";
	for (const migrations of [
		[
			{
				subject: "orchestrator",
				fromVersion: 1,
				toVersion: 3,
				fromDigest: digest(predecessor),
				toDigest: digest(successor),
			},
		],
		[
			{
				subject: "orchestrator",
				fromVersion: 1,
				toVersion: 2,
				fromDigest: digest(predecessor),
				toDigest: digest("agent version two"),
			},
			{
				subject: "orchestrator",
				fromVersion: 1,
				toVersion: 2,
				fromDigest: digest(predecessor),
				toDigest: digest("another version two"),
			},
		],
		[
			{
				subject: "orchestrator",
				fromVersion: 1,
				toVersion: 2,
				fromDigest: "not-a-digest",
				toDigest: digest("agent version two"),
			},
		],
	]) {
		const filesystem = createFakeFilesystem({
			"/agent/agents/orchestrator.md": predecessor,
			"/agent/.pi-workflow/agent-assets.json": JSON.stringify({
				schemaVersion: 1,
				assets: {
					orchestrator: {
						ownership: "package",
						version: 1,
						digest: digest(predecessor),
					},
				},
			}),
		});
		const plan = await createAgentAssetSync({
			catalog: {
				schemaVersion: 1,
				assets: [
					{ kind: "agent", name: "orchestrator", version: 3, content: successor },
				],
			},
			migrations,
			filesystem,
			agentDirectory: "/agent/agents",
			manifestPath: "/agent/.pi-workflow/agent-assets.json",
		}).plan();

		assert.equal(plan.status, "blocked");
		assert.deepEqual(plan.actions, []);
		assert.match(plan.diagnostics[0], /migration/i);
		assert.deepEqual(filesystem.writes, []);
	}
});
