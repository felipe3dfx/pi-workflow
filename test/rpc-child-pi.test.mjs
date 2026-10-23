import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildLauncher } from "../extensions/child-launcher.ts";
import { createChildSessions } from "../extensions/child-sessions.ts";
import { createRpcChildSession, readinessDeadline } from "../extensions/rpc-child.ts";
import { eventually } from "./support/eventually.mjs";
import { modelEndpoint } from "./support/model-endpoint.mjs";

const installed = (process.env.PATH ?? "").split(delimiter).some((directory) => {
	try {
		accessSync(join(directory, "pi"), constants.X_OK);
		return true;
	} catch {
		return false;
	}
});
const skip = !installed && "Pi is not installed on PATH, so the real-binary RPC child checks cannot run.";
const mcpFixture = fileURLToPath(new URL("./support/mcp-fixture-server.mjs", import.meta.url));
const git = (cwd, ...args) =>
	execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });

function server(name, evidence) {
	return { command: process.execPath, args: [mcpFixture, name, evidence, "0", "roots"] };
}

async function fixture(t) {
	const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-workflow-rpc-child-pi-")));
	const agentDir = join(dir, "agent");
	const evidence = join(dir, "evidence");
	await mkdir(agentDir);
	await mkdir(evidence);
	await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { global: server("global", evidence) } }));
	const endpoint = await modelEndpoint(agentDir);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await endpoint.close();
		await rm(dir, { recursive: true, force: true });
	});
	return { dir, agentDir, evidence, endpoint };
}

async function repository(dir, name, files) {
	const repo = join(dir, name);
	await mkdir(join(repo, ".pi"), { recursive: true });
	git(repo, "init", "--quiet", "-b", "main");
	await writeFile(join(repo, "README.md"), "fixture\n");
	for (const [path, content] of Object.entries(files)) await writeFile(join(repo, path), content);
	git(repo, "add", ".");
	git(repo, "commit", "--quiet", "-m", "fixture");
	return repo;
}

function launch(t, { dir, endpoint }, cwd, project) {
	const create = createRpcChildSession({ sessionRoot: join(dir, "sessions") });
	return create({
		cwd,
		project,
		role: "explore",
		model: endpoint.model,
		thinking: "off",
		prompt: "You are a child session. Answer DONE.",
		tools: ["read", "mcp__*"],
		modelRegistry: {},
		shell: {},
		onEvent() {},
		notify() {},
		ask: async () => "answer",
		report() {},
		checkpointed() {},
	}).then((handle) => {
		t.after(() => handle.dispose());
		return handle;
	});
}

const seen = async (evidence, name) => ({
	cwd: await readFile(join(evidence, `${name}.cwd`), "utf8"),
	roots: JSON.parse(await readFile(join(evidence, `${name}.roots`), "utf8")).roots.map((root) => root.uri),
});

test("a real Pi child runs in its worktree and loads the worktree's MCP servers by the parent's trust", { skip, timeout: 60_000 }, async (t) => {
	assert.equal(readinessDeadline, 10_000);
	for (const trusted of [true, false]) {
		await t.test(trusted ? "--approve" : "--no-approve", async (t) => {
			const scene = await fixture(t);
			const repo = await repository(scene.dir, "repo", {
				".pi/mcp.json": JSON.stringify({ mcpServers: { project: server("project", scene.evidence) } }),
			});
			const worktree = join(scene.dir, "child-worktree");
			git(repo, "worktree", "add", "--quiet", "-b", "child", worktree);
			const handle = await launch(t, scene, worktree, { cwd: repo, trusted });
			const started = Date.now();
			assert.equal(await handle.run("Say done."), "DONE");
			t.diagnostic(`run completed in ${Date.now() - started} ms`);
			assert.equal(scene.endpoint.requests.length, 1);
			const global = await eventually(() =>
				existsSync(join(scene.evidence, "global.roots")) && seen(scene.evidence, "global"),
			);
			assert.deepEqual(await global, { cwd: worktree, roots: [pathToFileURL(worktree).href] });
			if (trusted) {
				const project = await eventually(() =>
					existsSync(join(scene.evidence, "project.roots")) && seen(scene.evidence, "project"),
				);
				assert.deepEqual(await project, { cwd: worktree, roots: [pathToFileURL(worktree).href] });
			} else {
				await delay(500);
				assert.equal(existsSync(join(scene.evidence, "project.pid")), false);
			}
			t.diagnostic(`servers started: ${["global", "project"].filter((name) => existsSync(join(scene.evidence, `${name}.pid`))).join(", ")}`);
		});
	}
});

test("a parent's untracked .pi/mcp.json is reported at launch and a real Pi child does not inherit it", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t);
	const repo = await repository(scene.dir, "repo", {});
	const worktree = join(scene.dir, "child-worktree");
	git(repo, "worktree", "add", "--quiet", "-b", "child", worktree);
	await writeFile(
		join(repo, ".pi", "mcp.json"),
		JSON.stringify({ mcpServers: { parent: server("parent", scene.evidence) } }),
	);
	const launcher = createChildLauncher({
		jevRouting: { enabled: () => false },
		delegationMode: { current: () => "opportunistic" },
		modelProfiles: { load: () => ({ status: "absent" }) },
	});
	const plan = await launcher.prepareLaunch(
		{ role: "explore", task: "Map the code", worktree },
		{
			cwd: repo,
			model: { provider: "fake", id: "echo", reasoning: false },
			thinkingLevel: "off",
			modelRegistry: { getAvailable: () => [] },
		},
	);
	assert.equal(plan.kind, "ready");
	assert.deepEqual(plan.warnings, [
		`The parent's .pi/mcp.json is absent from the worktree ${worktree}; the child does not inherit it.`,
	]);
	t.diagnostic(plan.warnings[0]);
	const handle = await launch(t, scene, worktree, { cwd: repo, trusted: true });
	assert.equal(await handle.run("Say done."), "DONE");
	await eventually(() => existsSync(join(scene.evidence, "global.roots")));
	await delay(500);
	assert.equal(existsSync(join(scene.evidence, "parent.pid")), false);
});

test("a background child runs as a real Pi process and reaches the registry completed with its final answer", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t);
	const repo = await repository(scene.dir, "repo", {});
	const sent = [];
	const core = createChildSessions({
		create: createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") }),
		send: (message) => sent.push(message),
		idle: () => true,
		trace() {},
		report() {},
		audit: createChildAudit({ root: "", parent: () => undefined }),
	});
	t.after(() => core.disposeAll());
	const started = await core.start(
		{
			role: "explore",
			contract: { prompt: "You are a child session. Answer DONE.", tools: ["read"] },
			task: "Say done.",
			worktree: repo,
			model: scene.endpoint.model,
			thinking: "off",
			chosenBy: "parent",
			references: [],
		},
		{
			background: true,
			modelRegistry: {},
			project: () => ({ cwd: repo, trusted: false }),
			shell: () => ({}),
		},
	);
	assert.equal(started.status, "queued");
	const record = await eventually(
		() => core.get(started.id),
		(child) => child?.state === "completed",
	);
	assert.equal(record.text, "DONE");
	const { entries } = core.thread(started.id);
	assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
	assert.deepEqual(
		entries.filter((entry) => entry.type === "message").map((entry) => entry.message.role),
		["system", "user", "assistant"],
	);
	const result = await eventually(() => sent.find((message) => message.customType === "pi-workflow-child-result"));
	assert.match(result.content, /DONE/);
	t.diagnostic(`${record.state}: ${record.text}`);

	const continued = await core.resume(started.id, "Say done again.", {
		modelRegistry: {},
		project: () => ({ cwd: repo, trusted: false }),
		shell: () => ({}),
	});
	assert.equal(continued.status, "queued");
	const again = await eventually(
		() => core.get(continued.id),
		(child) => child?.state === "completed",
	);
	assert.equal(again.continuedFrom, started.id);
	assert.deepEqual(
		core.thread(continued.id).entries.filter((entry) => entry.type === "message").map((entry) => entry.message.role),
		["system", "user", "assistant", "user", "assistant"],
	);
	assert.equal(scene.endpoint.requests.at(-1).messages.filter((message) => message.role === "user").length, 2);
});

test("a real Pi child whose model Pi cannot select fails its run instead of hanging", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t);
	const repo = await repository(scene.dir, "repo", {});
	const handle = await launch(t, { ...scene, endpoint: { model: "absent-provider/absent-model" } }, repo, { cwd: repo, trusted: false });
	const started = Date.now();
	const failure = await handle.run("Say done.").then(() => undefined, (error) => error);
	assert.ok(failure instanceof Error);
	assert.ok(Date.now() - started < readinessDeadline);
	assert.match(failure.message, /Model "absent-provider\/absent-model" not found/);
	t.diagnostic(failure.message);
});
