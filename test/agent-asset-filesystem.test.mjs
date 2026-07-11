import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentAssetFilesystem } from "../extensions/agent-asset-filesystem.ts";

function fake(files = {}, failures = {}) {
	const entries = new Map(Object.entries(files));
	const events = [];
	const fs = {
		entries,
		events,
		async read(path) {
			return entries.get(path);
		},
		async open(path, flag) {
			events.push(`open:${path}:${flag}`);
			if (flag === "wx" && entries.has(path))
				throw Object.assign(new Error("exists"), { code: "EEXIST" });
			entries.set(path, "");
			return {
				async write(content) {
					events.push(`write:${path}`);
					entries.set(path, content);
				},
				async sync() {
					events.push(`sync:${path}`);
					if (failures.fileSync === path) throw new Error("file sync failed");
				},
				async close() {
					events.push(`close:${path}`);
				},
			};
		},
		async rename(from, to) {
			events.push(`rename:${from}:${to}`);
			entries.set(to, entries.get(from));
			entries.delete(from);
		},
		async unlink(path) {
			events.push(`unlink:${path}`);
			entries.delete(path);
		},
		async remove(path) {
			events.push(`remove:${path}`);
			if (failures.cleanup === path) throw new Error("cleanup failed");
			entries.delete(path);
		},
		async syncDirectory(path) {
			events.push(`sync-dir:${path}`);
			if (failures.directorySync === path)
				throw new Error("directory sync failed");
		},
		digest(content) {
			return content === undefined ? null : `hash:${content}`;
		},
		randomToken() {
			return "owner-token";
		},
		owner() {
			return { pid: 1, hostname: "test", startedAt: "now" };
		},
	};
	return { fs, entries, events };
}

test("cooperative ownership blocks contention and never steals malformed or stale lock files", async () => {
	const fixture = fake();
	const seam = createAgentAssetFilesystem({
		lockPath: "/state/lock",
		primitives: fixture.fs,
	});
	const owner = await seam.acquire("apply");
	await assert.rejects(() => seam.acquire("resume"), /lock/i);
	await assert.rejects(
		() => seam.release({ ...owner, token: "wrong" }),
		/owner/i,
	);
	assert.equal(fixture.entries.has("/state/lock"), true);
	await seam.release(owner);
	for (const record of [
		"{bad",
		JSON.stringify({ token: "old", startedAt: "ancient" }),
	]) {
		fixture.entries.set("/state/lock", record);
		await assert.rejects(() => seam.acquire("rollback"), /lock/i);
		assert.equal(fixture.entries.get("/state/lock"), record);
		fixture.entries.delete("/state/lock");
	}
});

test("lock acquisition cleans a published lock and synchronizes its removal when publication fails", async () => {
	const fixture = fake({}, { fileSync: "/state/lock" });
	const seam = createAgentAssetFilesystem({
		lockPath: "/state/lock",
		primitives: fixture.fs,
	});

	await assert.rejects(() => seam.acquire("apply"), /lock/i);

	assert.equal(fixture.entries.has("/state/lock"), false);
	assert.deepEqual(fixture.events.slice(-2), ["remove:/state/lock", "sync-dir:/state"]);
});

test("durable conditional creation preserves competing bytes and lock failure writes nothing", async () => {
	const fixture = fake({ "/target": "competitor" });
	const seam = createAgentAssetFilesystem({
		lockPath: "/lock",
		primitives: fixture.fs,
	});
	const owner = await seam.acquire("apply");
	const receipt = await seam.writeFileDurableConditional(
		owner,
		"/target",
		"ours",
		null,
	);
	assert.deepEqual(receipt, {
		status: "blocked",
		mutation: "none",
		durability: "durable",
	});
	assert.equal(fixture.entries.get("/target"), "competitor");
	await seam.release(owner);
	fixture.entries.set("/lock", "malformed");
	const before = fixture.events.length;
	await assert.rejects(() => seam.acquire("apply"), /lock/i);
	assert.deepEqual(fixture.events.slice(before), ["open:/lock:wx"]);
});

test("no-clobber creation reports an uncertain published destination when cleanup fails", async () => {
	const fixture = fake({}, { directorySync: "/dir", cleanup: "/dir/asset" });
	const seam = createAgentAssetFilesystem({
		lockPath: "/lock",
		primitives: fixture.fs,
	});
	const owner = await seam.acquire("apply");

	const receipt = await seam.writeFileDurableConditional(
		owner,
		"/dir/asset",
		"after",
		null,
	);

	assert.deepEqual(receipt, {
		status: "blocked",
		mutation: "applied",
		durability: "uncertain",
	});
	assert.equal(fixture.entries.get("/dir/asset"), "after");
	assert.ok(fixture.events.includes("remove:/dir/asset"));
});

test("canonical root authorization rejects a symlinked ancestor without blocking a new in-root target", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-fs-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-workflow-outside-"));
	const primitives = {
		async read(path) {
			try { return await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
		},
		async open(path, flag) {
			const handle = await open(path, flag);
			return { write: (content) => handle.writeFile(content, "utf8"), sync: () => handle.sync(), close: () => handle.close() };
		},
		rename: (from, to) => import("node:fs/promises").then(({ rename }) => rename(from, to)),
		unlink: (path) => import("node:fs/promises").then(({ unlink }) => unlink(path)),
		remove: (path) => rm(path, { force: true }),
		async syncDirectory(path) { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } },
		canonicalPath: (path) => import("node:fs/promises").then(({ realpath }) => realpath(path)),
		digest: (content) => content === undefined ? null : createHash("sha256").update(content).digest("hex"),
		randomToken: () => "canonical-token",
		owner: () => ({ pid: 1, hostname: "test", startedAt: "now" }),
	};
	try {
		await mkdir(join(root, "state"), { recursive: true });
		await mkdir(join(root, "agents"), { recursive: true });
		await symlink(outside, join(root, "agents", "escape"));
		const seam = createAgentAssetFilesystem({
			lockPath: join(root, "state", "lock"),
			allowedRoots: [root],
			primitives,
		});
		const owner = await seam.acquire("apply");
		assert.deepEqual(
			await seam.writeFileDurableConditional(owner, join(root, "agents", "escape", "asset"), "outside", null),
			{ status: "blocked", mutation: "none", durability: "durable" },
		);
		assert.deepEqual(
			await seam.writeFileDurableConditional(owner, join(root, "agents", "new-agent"), "inside", null),
			{ status: "applied", mutation: "applied", durability: "durable" },
		);
		await seam.release(owner);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

test("replace writes a same-directory temp, syncs it before rename, and cleans sync failures", async () => {
	const fixture = fake({ "/dir/asset": "before" });
	const seam = createAgentAssetFilesystem({
		lockPath: "/lock",
		primitives: fixture.fs,
	});
	const owner = await seam.acquire("apply");
	const receipt = await seam.writeFileDurableConditional(
		owner,
		"/dir/asset",
		"after",
		"hash:before",
	);
	assert.deepEqual(receipt, {
		status: "applied",
		mutation: "applied",
		durability: "durable",
	});
	assert.deepEqual(fixture.events.slice(5, 11), [
		"open:/dir/.asset.owner-token.tmp:wx",
		"write:/dir/.asset.owner-token.tmp",
		"sync:/dir/.asset.owner-token.tmp",
		"close:/dir/.asset.owner-token.tmp",
		"rename:/dir/.asset.owner-token.tmp:/dir/asset",
		"sync-dir:/dir",
	]);
	await seam.release(owner);
	const failed = fake(
		{ "/dir/asset": "before" },
		{
			fileSync: "/dir/.asset.owner-token.tmp",
			cleanup: "/dir/.asset.owner-token.tmp",
		},
	);
	const failingSeam = createAgentAssetFilesystem({
		lockPath: "/lock",
		primitives: failed.fs,
	});
	const failingOwner = await failingSeam.acquire("apply");
	const blocked = await failingSeam.writeFileDurableConditional(
		failingOwner,
		"/dir/asset",
		"after",
		"hash:before",
	);
	assert.equal(blocked.mutation, "none");
	assert.equal(failed.entries.get("/dir/asset"), "before");
	assert.ok(failed.events.includes("remove:/dir/.asset.owner-token.tmp"));
	const stale = fake({ "/dir/asset": "changed" });
	const staleSeam = createAgentAssetFilesystem({
		lockPath: "/lock",
		primitives: stale.fs,
	});
	const staleOwner = await staleSeam.acquire("apply");
	assert.deepEqual(
		await staleSeam.writeFileDurableConditional(
			staleOwner,
			"/dir/asset",
			"after",
			"hash:before",
		),
		{ status: "blocked", mutation: "none", durability: "durable" },
	);
	assert.equal(
		stale.events.some((event) => event.startsWith("rename:")),
		false,
	);
});

test("directory sync failures after replace or remove report applied durability uncertainty", async () => {
	for (const operation of ["write", "remove"]) {
		const fixture = fake({ "/dir/asset": "before" }, { directorySync: "/dir" });
		const seam = createAgentAssetFilesystem({
			lockPath: "/lock",
			primitives: fixture.fs,
		});
		const owner = await seam.acquire(operation);
		const receipt =
			operation === "write"
				? await seam.writeFileDurableConditional(
						owner,
						"/dir/asset",
						"after",
						"hash:before",
					)
				: await seam.removeFileDurableConditional(
						owner,
						"/dir/asset",
						"hash:before",
					);
		assert.deepEqual(receipt, {
			status: "blocked",
			mutation: "applied",
			durability: "uncertain",
		});
		assert.equal(
			fixture.entries.get("/dir/asset"),
			operation === "write" ? "after" : undefined,
		);
	}
	const durable = fake({ "/dir/asset": "before" });
	const seam = createAgentAssetFilesystem({
		lockPath: "/lock",
		primitives: durable.fs,
	});
	const owner = await seam.acquire("rollback");
	assert.deepEqual(
		await seam.removeFileDurableConditional(owner, "/dir/asset", "hash:before"),
		{ status: "applied", mutation: "applied", durability: "durable" },
	);
	assert.equal(durable.entries.has("/dir/asset"), false);
});
