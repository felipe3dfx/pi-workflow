import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildLauncher } from "../extensions/child-launcher.ts";
import { createChildSessions } from "../extensions/child-sessions.ts";
import { treeDeadline } from "../extensions/process-tree.ts";
import { createRpcChildSession, readinessDeadline } from "../extensions/rpc-child.ts";
import { eventually } from "./support/eventually.mjs";
import { modelEndpoint } from "./support/model-endpoint.mjs";
import { gone, parent } from "./support/process-tree.mjs";

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

function server(name, evidence, scenario = "roots") {
	return { command: process.execPath, args: [mcpFixture, name, evidence, "0", scenario] };
}

async function fixture(t, answer) {
	const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-workflow-rpc-child-pi-")));
	const agentDir = join(dir, "agent");
	const evidence = join(dir, "evidence");
	await mkdir(agentDir);
	await mkdir(evidence);
	await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { global: server("global", evidence) } }));
	const endpoint = await modelEndpoint(agentDir, answer);
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
		role: "worker",
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
			role: "worker",
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

async function descendantTree(scene) {
	await writeFile(
		join(scene.agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { global: server("global", scene.evidence, "descendants") } }),
	);
	return async () => {
		const [mcp, ...shell] = await eventually(
			async () =>
				existsSync(join(scene.evidence, "global.tree"))
					? (await readFile(join(scene.evidence, "global.tree"), "utf8")).trim().split("\n").map(Number)
					: [],
			(pids) => pids.length === 3,
		);
		const pi = Number(execFileSync("ps", ["-o", "ppid=", "-p", String(mcp)], { encoding: "utf8" }).trim());
		return { pi, pids: [pi, mcp, ...shell] };
	};
}

test("a real Pi child, its MCP server and its shell descendants end within the tree deadline when the parent exits or is killed", { skip, timeout: 60_000 }, async (t) => {
	assert.equal(treeDeadline, 2_000);
	for (const ending of ["shutdown", "SIGKILL"]) {
		await t.test(ending, async (t) => {
			const scene = await fixture(t);
			const repo = await repository(scene.dir, "repo", {});
			const tree = await descendantTree(scene);
			const started = await parent(t, {
				sessionRoot: join(scene.dir, "sessions"),
				cwd: repo,
				model: scene.endpoint.model,
				ending,
			});
			assert.equal(started.answer, "DONE");
			const { pids } = await tree();
			started.end();
			const elapsed = await gone(pids, await started.exited);
			assert.ok(elapsed < treeDeadline, `cleanup took ${elapsed} ms`);
			t.diagnostic(`Pi, MCP server, shell and its background sleep (${pids.join(", ")}) ended ${elapsed} ms after the parent ${ending === "SIGKILL" ? "was killed" : "exited"}`);
		});
	}
});

test("a real Pi child that crashes leaves no MCP server or shell descendant within the tree deadline", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t);
	const repo = await repository(scene.dir, "repo", {});
	const tree = await descendantTree(scene);
	const handle = await launch(t, scene, repo, { cwd: repo, trusted: false });
	assert.equal(await handle.run("Say done."), "DONE");
	const { pi, pids } = await tree();
	process.kill(pi, "SIGKILL");
	const crashed = Date.now();
	const elapsed = await gone(pids, crashed);
	assert.ok(elapsed < treeDeadline, `cleanup took ${elapsed} ms`);
	t.diagnostic(`MCP server, shell and its background sleep (${pids.slice(1).join(", ")}) ended ${elapsed} ms after the child Pi was killed`);
});

const realAgentDir = getAgentDir();
const installedPackage = (name) =>
	new DefaultPackageManager({
		cwd: process.cwd(),
		agentDir: realAgentDir,
		settingsManager: SettingsManager.create(process.cwd(), realAgentDir, { projectTrusted: false }),
	}).getInstalledPath(`npm:${name}`, "user");

async function install(scene) {
	await mkdir(join(scene.agentDir, "npm"), { recursive: true });
	await symlink(join(realAgentDir, "npm", "node_modules"), join(scene.agentDir, "npm", "node_modules"), "dir");
}

const webSkip = skip || (!installedPackage("pi-web-access") && "pi-web-access is not installed in the Pi agent directory.");

test("a real Pi explorer child offers the pi-web-access tools to its model", { skip: webSkip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t);
	await install(scene);
	await writeFile(join(scene.agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-web-access"] }));
	const repo = await repository(scene.dir, "repo", {});
	const create = createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") });
	const handle = await create({
		cwd: repo,
		project: { cwd: repo, trusted: false },
		role: "explore",
		model: scene.endpoint.model,
		thinking: "off",
		prompt: "You are a child session. Answer DONE.",
		tools: ["read", "web_search", "source_check", "fetch_content", "get_search_content"],
		modelRegistry: {},
		shell: {},
		onEvent() {},
		notify() {},
		ask: async () => "answer",
		report() {},
		checkpointed() {},
	});
	t.after(() => handle.dispose());
	assert.equal(await handle.run("Say done."), "DONE");
	const offered = scene.endpoint.requests[0].tools.map((tool) => tool.function.name);
	for (const name of ["web_search", "source_check", "fetch_content", "get_search_content"]) {
		assert.ok(offered.includes(name), `${name} missing from ${offered.join(", ")}`);
	}
	t.diagnostic(`offered: ${offered.join(", ")}`);
});

const bridgeSkip = skip || (!installedPackage("pi-claude-bridge") && "pi-claude-bridge is not installed in the Pi agent directory.");

test("a real Pi child with a Claude Bridge model loads the provider and a missing package fails the launch", { skip: bridgeSkip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t);
	const repo = await repository(scene.dir, "repo", {});
	const spec = {
		cwd: repo,
		project: { cwd: repo, trusted: false },
		role: "worker",
		model: "claude-bridge/claude-haiku-4-5",
		thinking: "off",
		prompt: "You are a child session.",
		tools: ["read"],
		modelRegistry: {},
		shell: {},
		onEvent() {},
		notify() {},
		ask: async () => "answer",
		report() {},
		checkpointed() {},
	};
	const create = createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") });
	await assert.rejects(create(spec), /official pi-claude-bridge package is not installed and configured/);
	await install(scene);
	await writeFile(join(scene.agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-claude-bridge"] }));
	const handle = await create(spec);
	t.after(() => handle.dispose());
	const outcome = await handle.run("Reply with the single word DONE.").then((text) => ({ text }), (error) => ({ error }));
	t.diagnostic(outcome.error ? `failed: ${outcome.error.message}` : `answered: ${outcome.text}`);
	assert.doesNotMatch(outcome.error?.message ?? "", /not found|did not become ready|instead of the selected/);
	assert.ok(outcome.error || outcome.text.length > 0);
});

function registry(t, scene, sent = []) {
	const core = createChildSessions({
		create: createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") }),
		send: (message) => sent.push(message),
		idle: () => false,
		trace() {},
		report() {},
		audit: createChildAudit({ root: "", parent: () => undefined }),
	});
	t.after(() => core.disposeAll());
	return core;
}

function background(core, repo, scene, role, tools) {
	return core.start(
		{
			role,
			contract: { prompt: "You are a child session.", tools },
			task: "Do the task.",
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
}

const toolResults = (request) =>
	request.messages.filter((message) => message.role === "tool").map((message) => message.content);

test("a real Pi child asks the parent, the first answer wins and the child continues with it", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t, [{ tool: "ask_parent", args: { question: "Which file?" } }, "DONE"]);
	const repo = await repository(scene.dir, "repo", {});
	const sent = [];
	const core = registry(t, scene, sent);
	const started = await background(core, repo, scene, "worker", ["read"]);
	assert.equal(started.status, "queued");
	const waiting = await eventually(() => core.get(started.id), (child) => child?.state === "waiting");
	assert.equal(waiting.question, 1);
	const question = sent.find((message) => message.customType === "pi-workflow-child-question");
	assert.equal(question.details.text, "Which file?");
	core.reply(started.id, 1, "README.md", "operator");
	assert.throws(
		() => core.reply(started.id, 1, "other.md", "parent"),
		/already answered by the operator: README.md/,
	);
	const done = await eventually(() => core.get(started.id), (child) => child?.state === "completed");
	assert.equal(done.text, "DONE");
	assert.deepEqual(toolResults(scene.endpoint.requests[1]), ["README.md"]);
	t.diagnostic(`asked: ${question.details.text}; answered by the operator: README.md; final: ${done.text}`);
});

test("a real Pi child withdraws a question when its call is aborted", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t, [{ tool: "ask_parent", args: { question: "Which file?" } }, "DONE"]);
	const repo = await repository(scene.dir, "repo", {});
	const signals = [];
	const handle = await createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") })({
		cwd: repo,
		project: { cwd: repo, trusted: false },
		role: "worker",
		model: scene.endpoint.model,
		thinking: "off",
		prompt: "You are a child session.",
		tools: ["read", "ask_parent"],
		modelRegistry: {},
		shell: {},
		onEvent() {},
		notify() {},
		ask: (_question, signal) => {
			signals.push(signal);
			return new Promise(() => {});
		},
		report() {},
		checkpointed() {},
	});
	t.after(() => handle.dispose());
	const run = handle.run("Ask first.");
	run.catch(() => {});
	await eventually(() => signals.length === 1);
	assert.equal(signals[0].aborted, false);
	await handle.abort();
	await eventually(() => signals[0].aborted);
	await assert.rejects(run, /aborted/);
	t.diagnostic("the aborted ask_parent call withdrew question 1");
});

test("a real Pi worker's guarded bash refuses a parent command and its report stays apart from its final answer", { skip, timeout: 60_000 }, async (t) => {
	const result = { verdict: "done", files_changed: [], validation: ["git push origin HEAD: refused"], left_undone: [] };
	const scene = await fixture(t, [
		{ tool: "bash", args: { command: "git push origin HEAD" } },
		{ tool: "bash", args: { command: "ls -l /proc/$$/fd" } },
		{ tool: "report_result", args: result },
		"DONE",
	]);
	await writeFile(join(scene.agentDir, "APPEND_SYSTEM.md"), "APPENDED-BY-THE-USER\n");
	const repo = await repository(scene.dir, "repo", {});
	const core = registry(t, scene);
	const started = await background(core, repo, scene, "worker", ["read", "bash"]);
	assert.equal(started.status, "queued");
	const done = await eventually(() => core.get(started.id), (child) => child?.state === "completed");
	assert.equal(done.text, "DONE");
	assert.deepEqual(done.result, result);
	const refusal = toolResults(scene.endpoint.requests[1]).at(-1);
	assert.match(refusal, /`git push` is reserved for the parent/);
	const descriptors = toolResults(scene.endpoint.requests[2]).at(-1);
	assert.deepEqual(
		[...descriptors.matchAll(/ (\d+) -> socket:/g)].map((match) => match[1]),
		["1", "2"],
	);
	assert.equal(toolResults(scene.endpoint.requests[3]).at(-1), "Result recorded.");
	const system = scene.endpoint.requests[0].messages.find((message) => message.role === "system").content;
	assert.match(system, /You are a child session\./);
	assert.doesNotMatch(system, /APPENDED-BY-THE-USER/);
	t.diagnostic(`bash: ${refusal.trim()}`);
	t.diagnostic(`bash sockets: ${[...descriptors.matchAll(/ \d+ -> socket:\S+/g)].join(",")}`);
	t.diagnostic(`result: ${JSON.stringify(done.result)}; final: ${done.text}`);
});
