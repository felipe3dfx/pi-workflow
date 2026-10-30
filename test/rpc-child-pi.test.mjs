import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildLauncher } from "../extensions/child-launcher.ts";
import { createChildSessions } from "../extensions/child-sessions.ts";
import { treeDeadline } from "../extensions/process-tree.ts";
import { createRpcChildSession, readinessDeadline } from "../extensions/rpc-child.ts";
import { companionMetadataPath, loadCompanionsFromPath } from "../extensions/companion-workflow.ts";
import { eventually } from "./support/eventually.mjs";
import { pi as installedPi, piSkip as skip, piVersion } from "./support/installed-pi.mjs";
import { modelEndpoint } from "./support/model-endpoint.mjs";
import { alive, gone, parent } from "./support/process-tree.mjs";
import { selectionWith } from "./support/selection.mjs";
import { withCheckpoint } from "./support/signed-checkpoint.mjs";

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

function launch(t, { dir, endpoint }, cwd, project, tools = ["read", "mcp__*"]) {
	const create = createRpcChildSession({ sessionRoot: join(dir, "sessions") });
	return create({
		cwd,
		project,
		role: "worker",
		model: endpoint.model,
		thinking: "off",
		prompt: "You are a child session. Answer DONE.",
		tools,
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

function runsInstalledPi(pid) {
	if (existsSync("/proc/self/exe")) assert.equal(realpathSync(`/proc/${pid}/exe`), realpathSync(installedPi));
}

test("the real-binary checks run the installed Pi, never the SDK's node_modules/.bin/pi", { skip }, (t) => {
	assert.doesNotMatch(installedPi, /node_modules/);
	t.diagnostic(`pi --version: ${piVersion}; ${installedPi}`);
});

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

test("a real Pi child resolves its MCP servers' working directories against its worktree on the inherited and contextual routes", { skip, timeout: 90_000 }, async (t) => {
	for (const route of ["inherited", "contextual"]) {
		await t.test(route, async (t) => {
			const scene = await fixture(t);
			const outside = join(scene.dir, "outside");
			await mkdir(outside);
			const repo = await repository(scene.dir, "repo", {
				".pi/mcp.json": JSON.stringify({
					mcpServers: {
						bare: server("bare", scene.evidence),
						relative: { ...server("relative", scene.evidence), cwd: ".pi" },
						absolute: { ...server("absolute", scene.evidence), cwd: outside },
					},
				}),
			});
			const worktree = join(scene.dir, "child-worktree");
			git(repo, "worktree", "add", "--quiet", "-b", "child", worktree);
			const project = { cwd: repo, trusted: true };
			const handle =
				route === "inherited"
					? await launch(t, scene, worktree, project)
					: await createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") })({
							authorization: {
								authority: () => ({ assignment: "Answer DONE.", instructions: [] }),
								classify: async () => {
									throw new Error("classify is not expected");
								},
							},
							cwd: worktree,
							project,
							role: "explore",
							model: scene.endpoint.model,
							thinking: "off",
							prompt: "You are a contextual child. Answer DONE.",
							tools: ["read"],
							shell: {},
							onEvent() {},
							notify() {},
							ask: async () => "answer",
							report() {},
							checkpointed() {},
						});
			if (route === "contextual") t.after(() => handle.dispose());
			assert.equal(await handle.run("Say done."), "DONE");
			const expected = { bare: worktree, relative: join(worktree, ".pi"), absolute: outside };
			for (const [name, cwd] of Object.entries(expected)) {
				const evidence = await eventually(() =>
					existsSync(join(scene.evidence, `${name}.roots`)) && seen(scene.evidence, name),
				);
				assert.deepEqual(await evidence, { cwd, roots: [pathToFileURL(worktree).href] }, name);
			}
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
	runsInstalledPi(pi);
	process.kill(pi, "SIGKILL");
	const crashed = Date.now();
	const elapsed = await gone(pids, crashed);
	assert.ok(elapsed < treeDeadline, `cleanup took ${elapsed} ms`);
	t.diagnostic(`MCP server, shell and its background sleep (${pids.slice(1).join(", ")}) ended ${elapsed} ms after the child Pi was killed`);
});

test("a real Pi child that ends cleanly leaves no background process of its shell within the tree deadline", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t, [{ tool: "bash", args: { command: "sleep 600 >/dev/null 2>&1 & echo $!" } }, "DONE"]);
	const repo = await repository(scene.dir, "repo", {});
	const handle = await launch(t, scene, repo, { cwd: repo, trusted: false }, ["read", "bash"]);
	assert.equal(await handle.run("Start the sleep."), "DONE");
	const sleep = Number(toolResults(scene.endpoint.requests[1]).at(-1).trim());
	assert.ok(alive(sleep));
	const since = Date.now();
	await handle.dispose();
	const elapsed = await gone([sleep], since);
	assert.ok(elapsed < treeDeadline, `cleanup took ${elapsed} ms`);
	t.diagnostic(`the background sleep ${sleep} ended ${elapsed} ms after the child Pi ended`);
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

const reloadCommand = fileURLToPath(new URL("./support/reload-command.mjs", import.meta.url));
const workflowExtension = fileURLToPath(new URL("../extensions/pi-workflow.ts", import.meta.url));

function rpcParent(t, scene, cwd) {
	const pi = spawn(
		installedPi,
		[
			"--mode", "rpc",
			"--session-dir", join(scene.dir, "parent-sessions"),
			"--model", scene.endpoint.model,
			"--thinking", "off",
			"--no-extensions",
			"--extension", workflowExtension,
			"--extension", reloadCommand,
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-approve",
		],
		{
			cwd,
			env: { ...process.env, PI_CODING_AGENT_DIR: scene.agentDir },
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	const exited = new Promise((resolve) => pi.once("exit", resolve));
	t.after(async () => {
		if (pi.exitCode === null && pi.signalCode === null) {
			pi.stdin.end();
			await Promise.race([exited, delay(5_000)]);
			pi.kill("SIGKILL");
		}
	});
	const events = [];
	const waiting = new Map();
	let stderr = "";
	let buffer = "";
	let requests = 0;
	pi.stderr.setEncoding("utf8");
	pi.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	pi.stdout.setEncoding("utf8");
	pi.stdout.on("data", (chunk) => {
		buffer += chunk;
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const record = JSON.parse(buffer.slice(0, end));
			buffer = buffer.slice(end + 1);
			if (record.type === "response" && waiting.has(record.id)) {
				waiting.get(record.id)(record);
				waiting.delete(record.id);
			} else events.push(record);
		}
	});
	function request(type, fields = {}) {
		const id = `t${++requests}`;
		return new Promise((resolve, reject) => {
			waiting.set(id, (record) =>
				record.success ? resolve(record.data) : reject(new Error(`${record.error}\n${stderr}`)),
			);
			pi.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
		});
	}
	return { pi, events, request, exited, stderr: () => stderr };
}

const realParentPolls = 12_000;

const said = (message) => JSON.stringify(message.content ?? "");
const toolNames = (body) => (body.tools ?? []).map((tool) => tool.function?.name);

function childPids(agentDir) {
	return execFileSync("ps", ["-A", "-ww", "-o", "pid=,command="], { encoding: "utf8" })
		.split("\n")
		.filter((line) => line.includes(join(agentDir, "pi-workflow-children")) && line.includes("--mode rpc"))
		.map((line) => Number(line.trim().split(/\s+/)[0]));
}

test("a real Pi parent's /reload keeps its working child processes, a Pending result is delivered once, a Consumed one never, an answer in flight across it reaches its child once, and quitting or killing the parent still ends the children", { skip, timeout: 120_000 }, async (t) => {
	for (const ending of ["quit", "SIGKILL"]) await t.test(ending, (t) => reloadScenario(t, ending));
});

function colorChild(body) {
	const asked = body.messages.map(said).find((text) => text.includes("Which color?") && text.includes("asks (question 1)"));
	return asked.match(/Child (\S+) asks/)[1];
}

const queuedChild = (message) => said(message).match(/Child (\S+) is queued in the background/)[1];

async function reloadScenario(t, ending) {
	let replies = 0;
	const answered = Promise.withResolvers();
	const asked = Promise.withResolvers();
	let release;
	t.after(() => {
		asked.resolve();
		release?.();
	});
	const scene = await fixture(t, (body) => {
		const last = body.messages.at(-1);
		if (!toolNames(body).includes("spawn_child")) {
			const conversation = body.messages.map(said).join("\n");
			if (conversation.includes("Hold on")) {
				return { tool: "ask_parent", args: { question: "Keep holding?" } };
			}
			if (conversation.includes("Map the docs")) return asked.promise.then(() => "Docs mapped.");
			if (conversation.includes("Map the tests")) return asked.promise.then(() => "Tests mapped.");
			const [answer, reported] = body.messages.filter((message) => message.role === "tool");
			if (!answer) return { tool: "ask_parent", args: { question: "Which color?" } };
			if (!reported) {
				const reason = `The color is ${answer.content}.`;
				const step = { tool: "report_result", args: { verdict: "partial", reason, files_changed: [], validation: [], left_undone: ["Paint it."] } };
				if (release) return step;
				answered.resolve();
				return new Promise((resolve) => {
					release = () => resolve(step);
				});
			}
			return `The color is ${answer.content}.`;
		}
		const text = said(last);
		const launched = body.messages.filter((message) => message.role === "tool" && said(message).includes("is queued in the background"));
		if (last.role === "user" && text.includes("Delegate the color question.")) {
			return { tool: "spawn_child", args: { role: "worker", task: "Ask the parent which color, then say it." } };
		}
		const next = ["Hold on until the parent answers.", "Map the docs.", "Map the tests."][launched.length - 1];
		if (next) return { tool: "spawn_child", args: { role: "verify", task: next } };
		if (last.role === "user" && text.includes("Read the docs map.")) {
			return { tool: "child_result", args: { id: queuedChild(launched[2]) } };
		}
		if (last.role === "user" && text.includes("Answer the child now.")) {
			replies += 1;
			return { tool: "reply_child", args: { id: colorChild(body), question: 1, answer: "blue" } };
		}
		if (last.role === "tool" && replies === 1) {
			replies += 1;
			return { tool: "reply_child", args: { id: colorChild(body), question: 1, answer: "red" } };
		}
		return "Noted.";
	});
	const repo = await repository(scene.dir, "repo", {});
	await writeFile(
		join(scene.agentDir, "pi-workflow-selection.json"),
		JSON.stringify(
			selectionWith(loadCompanionsFromPath(companionMetadataPath).companions.map((companion) => companion.package), {
				todo: false,
				"operator-questions": false,
				"model-profiles": false,
				codegraph: false,
				"compact-rendering": false,
			}),
		),
	);
	const parentPi = rpcParent(t, scene, repo);
	const ended = (type) =>
		parentPi.events.filter((event) => event.type === "message_end" && event.message.customType === type);
	const idle = () =>
		parentPi.events.findLast((event) => event.type === "agent_start" || event.type === "agent_settled")?.type === "agent_settled";
	const settled = () => parentPi.events.filter((event) => event.type === "agent_settled").length;
	async function turn(message, done = () => true) {
		const before = settled();
		const response = await parentPi.request("prompt", { message });
		await eventually(() => settled() > before && idle() && done(), undefined, realParentPolls);
		return response;
	}

	await turn("Delegate the color question.", () => ended("pi-workflow-child-question").length === 2);
	asked.resolve();
	const pids = await eventually(() => childPids(scene.agentDir), (found) => found.length === 2, realParentPolls);
	for (const pid of pids) runsInstalledPi(pid);
	await turn("Read the docs map.");
	await turn("Answer the child now.", () => replies === 2);
	await answered.promise;

	const reloaded = await parentPi.request("prompt", { message: "/test-reload" });
	assert.equal(reloaded.disposition, "handled");
	assert.deepEqual(childPids(scene.agentDir), pids);
	assert.deepEqual(ended("pi-workflow-child-result"), []);

	release();
	const [result] = await eventually(
		() => ended("pi-workflow-child-result"),
		(found) => found.length === 1 && idle(),
		realParentPolls,
	);
	const { messages } = await parentPi.request("get_messages");
	const custom = (type) => messages.filter((message) => message.customType === type);
	const [color, , docs, tests] = messages
		.filter((message) => message.role === "toolResult" && message.toolName === "spawn_child")
		.map(queuedChild);
	const consumed = messages.find((message) => message.role === "toolResult" && message.toolName === "child_result");

	assert.equal(custom("pi-workflow-child-question").length, 2);
	assert.equal(custom("pi-workflow-child-result").length, 1);
	assert.match(said(consumed), /Docs mapped\./);
	assert.deepEqual(result.message.details.results.map(({ id }) => id), [tests, color]);
	assert.match(result.message.content, /Tests mapped\.[\s\S]*completed\. Verdict: partial[\s\S]*The color is blue\./);
	assert.equal(result.message.content.includes(docs), false);
	const childAnswers = scene.endpoint.requests
		.filter((body) => !toolNames(body).includes("spawn_child"))
		.flatMap((body) => body.messages.filter((message) => message.role === "tool").slice(0, 1).map((message) => message.content));
	assert.deepEqual([...new Set(childAnswers)], ["blue"]);
	const answeredRequests = scene.endpoint.requests.filter(
		(body) => body.messages.filter((message) => message.role === "tool").map((message) => message.content).join() === "blue",
	);
	assert.equal(answeredRequests.length, 1);
	const second = messages.filter((message) => message.role === "toolResult" && message.toolName === "reply_child").at(-1);
	assert.equal(second.isError, true);
	assert.match(said(second), /already answered by the parent: blue/);
	const holding = childPids(scene.agentDir);
	assert.equal(holding.length, 1);
	assert.ok(pids.includes(holding[0]));
	t.diagnostic(`child pids ${pids.join(", ")} kept across /reload; Consumed before it: ${docs}; Pending at it: ${tests}; answered "blue" before it, reported after it: ${color}`);
	t.diagnostic(`one result message after the reload: ${result.message.details.results.map(({ id, state, result }) => `${id} ${state}${result ? ` Verdict ${result.verdict}` : ""}`).join(", ")}`);

	const since = Date.now();
	if (ending === "quit") parentPi.pi.stdin.end();
	else parentPi.pi.kill("SIGKILL");
	await parentPi.exited;
	const elapsed = await gone(holding, since);
	assert.ok(elapsed < treeDeadline + 1_000, `${elapsed} ms`);
	t.diagnostic(`after ${ending}, the waiting child ended in ${elapsed} ms`);
}

const head = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function granted(core, scene, worktree, grant) {
	return core.start(
		{
			role: "worker",
			contract: { prompt: "You are a child session.", tools: ["read", "bash", "codemode", "checkpoint"] },
			task: "Commit a.txt.",
			worktree,
			model: scene.endpoint.model,
			thinking: "off",
			chosenBy: "parent",
			references: [],
			checkpoint: grant,
		},
		{
			background: true,
			project: () => ({ cwd: worktree, trusted: false }),
			shell: () => ({}),
		},
	);
}

test("a real Pi worker's guard holds inside a script and its granted checkpoint makes a signed commit the parent records", { skip, timeout: 90_000 }, async (t) => {
	const scene = await fixture(t, [
		{ tool: "codemode", args: { code: "return await tools.bash({ command: 'git push origin HEAD' });" } },
		{ tool: "bash", args: { command: "printf 'A\\n' > a.txt" } },
		{ tool: "checkpoint", args: { message: "feat: add a", paths: ["a.txt"] } },
		"DONE",
	]);
	await withCheckpoint(async ({ worktree, grant }) => {
		const core = registry(t, scene);
		const started = await granted(core, scene, worktree, grant);
		assert.equal(started.status, "queued");
		const done = await eventually(() => core.get(started.id), (child) => child?.state === "completed");
		const nested = toolResults(scene.endpoint.requests[1]).at(-1);
		assert.match(nested, /`git push` is reserved for the parent/);
		const sha = head(worktree, "rev-parse", "HEAD");
		assert.match(head(worktree, "cat-file", "commit", "HEAD"), /^gpgsig /m);
		assert.equal(head(worktree, "show", "HEAD:a.txt"), "A");
		assert.deepEqual(done.checkpoints, [{ sha, parent: grant.base, base: grant.base, branch: "feature" }]);
		t.diagnostic(`nested bash: ${nested.split("\n").find((line) => line.includes("reserved"))}`);
		t.diagnostic(`checkpoint: ${toolResults(scene.endpoint.requests[3]).at(-1).split("\n")[0]}; gpgsig present`);
	});
});

test("a real Pi worker's checkpoint fails closed on a signing failure and records nothing", { skip, timeout: 90_000 }, async (t) => {
	const scene = await fixture(t, [
		{ tool: "bash", args: { command: "printf 'A\\n' > a.txt" } },
		{ tool: "checkpoint", args: { message: "feat: add a", paths: ["a.txt"] } },
		"DONE",
	]);
	await withCheckpoint(async ({ dir, worktree, grant }) => {
		head(worktree, "config", "user.signingkey", join(dir, "missing-key"));
		const core = registry(t, scene);
		const started = await granted(core, scene, worktree, grant);
		const done = await eventually(() => core.get(started.id), (child) => child?.state === "completed");
		const failure = toolResults(scene.endpoint.requests[2]).at(-1);
		assert.doesNotMatch(failure, /^Checkpoint /);
		assert.equal(head(worktree, "rev-parse", "HEAD"), grant.base);
		assert.equal(done.checkpoints, undefined);
		t.diagnostic(`checkpoint: ${failure.split("\n")[0]}`);
	});
});

test("a real Pi contextual child continues an authorized call, holds an uncertain nested one after consulting the parent and verifies a scoped signed commit", { skip, timeout: 90_000 }, async (t) => {
	const scene = await fixture(t, [
		{ tool: "write", args: { path: "assigned.txt", content: "ASSIGNED" } },
		{ tool: "codemode", args: { code: "return await tools.write({ path: 'other.txt', content: 'OTHER' });" } },
		{ tool: "bash", args: { command: "git add assigned.txt && git commit -q -m 'feat: assigned change'" } },
		"DONE",
	]);
	const known = { prohibited: false, scope: "within", ownership: "assigned", effects: "ordinary", confirmed: false, commit: false };
	await withCheckpoint(async ({ worktree, grant }) => {
		const proposals = [];
		const questions = [];
		const recorded = [];
		const handle = await createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") })({
			authorization: {
				authority: () => ({
					assignment: "Write assigned.txt and commit it.",
					instructions: [],
					commit: { paths: ["assigned.txt"], context: "noninterfering" },
				}),
				classify: async (proposal) => {
					proposals.push(proposal);
					const { tool, input } = proposal.action;
					if (tool === "write" && input.path === "other.txt")
						return { ...known, scope: "unknown", reason: "other.txt is outside the assignment." };
					if (tool === "bash") return { ...known, commit: { paths: ["assigned.txt"] }, reason: "The assigned commit." };
					return { ...known, reason: "Assigned work." };
				},
			},
			cwd: worktree,
			project: { cwd: worktree, trusted: false },
			role: "explore",
			model: scene.endpoint.model,
			thinking: "off",
			prompt: "You are a contextual child.",
			tools: ["read"],
			shell: {},
			onEvent() {},
			notify() {},
			ask: async (text) => {
				const question = JSON.parse(text.slice(text.indexOf("\n") + 1));
				questions.push(question);
				return JSON.stringify({ ref: question.ref, kind: "pending", answer: "Waiting for the owner." });
			},
			report() {},
			checkpointed: (checkpoint) => recorded.push(checkpoint),
		});
		t.after(() => handle.dispose());
		assert.equal(await handle.run("Do the assigned work."), "DONE");
		assert.equal(head(worktree, "show", "HEAD:assigned.txt"), "ASSIGNED");
		assert.equal(existsSync(join(worktree, "other.txt")), false);
		const held = toolResults(scene.endpoint.requests[2]).at(-1);
		assert.match(held, /Authorization held; consultation required: Consultation remains pending; no authority established\./);
		assert.equal(questions.length, 1);
		assert.deepEqual(questions[0].action, { tool: "write", input: { path: "other.txt", content: "OTHER" }, cwd: worktree });
		assert.deepEqual(handle.pendingAuthorizations().map((decision) => decision.proposal.action), [questions[0].action]);
		assert.match(proposals[0].context.systemPrompt, /You are a contextual child\./);
		assert.ok(proposals.some((proposal) => proposal.action.tool === "codemode"));
		const sha = head(worktree, "rev-parse", "HEAD");
		assert.equal(head(worktree, "rev-parse", "HEAD^"), grant.base);
		assert.match(head(worktree, "cat-file", "commit", "HEAD"), /^gpgsig /m);
		const committed = toolResults(scene.endpoint.requests[3]).at(-1);
		assert.match(committed, new RegExp(`Signed commit ${sha}; parent: ${grant.base}; base: ${grant.base}; branch: feature`));
		assert.deepEqual(recorded, [{ sha, parent: grant.base, base: grant.base, branch: "feature", files: ["A\tassigned.txt"] }]);
		t.diagnostic(`allowed: ${proposals[0].action.tool} ${proposals[0].action.input.path}`);
		t.diagnostic(`held: ${held.split("\n").find((line) => line.includes("Authorization held"))}`);
		t.diagnostic(`commit: ${committed.split("\n").at(-1)}`);
	});
});

test("a real Pi contextual child surfaces a scope violation after commit and refuses a commit without signing", { skip, timeout: 90_000 }, async (t) => {
	const cases = {
		"scope violation": {
			prepare: (worktree) => writeFile(join(worktree, "outside.txt"), "OUTSIDE"),
			expected: /Postcommit verification failed \(no rollback\): /,
			committed: true,
		},
		"disabled signing": {
			prepare: (worktree) => head(worktree, "config", "commit.gpgsign", "false"),
			expected: /Authorization held; consultation required: Authorization unresolved: /,
			committed: false,
		},
	};
	for (const [name, { prepare, expected, committed }] of Object.entries(cases)) {
		await t.test(name, async (t) => {
			const scene = await fixture(t, [
				{ tool: "bash", args: { command: "printf A > assigned.txt && git add -A && git commit -q -m 'feat: assigned change'" } },
				"DONE",
			]);
			await withCheckpoint(async ({ worktree, grant }) => {
				await prepare(worktree);
				const handle = await createRpcChildSession({ sessionRoot: join(scene.dir, "sessions") })({
					authorization: {
						authority: () => ({
							assignment: "Commit assigned.txt.",
							instructions: [],
							commit: { paths: ["assigned.txt"], context: "noninterfering" },
						}),
						classify: async () => ({
							prohibited: false, scope: "within", ownership: "assigned", effects: "ordinary", confirmed: false,
							commit: { paths: ["assigned.txt"] }, reason: "The assigned commit.",
						}),
					},
					cwd: worktree,
					project: { cwd: worktree, trusted: false },
					role: "worker",
					model: scene.endpoint.model,
					thinking: "off",
					prompt: "You are a contextual child.",
					tools: ["read"],
					shell: {},
					onEvent() {},
					notify() {},
					ask: async () => "{}",
					report() {},
					checkpointed() {},
				});
				t.after(() => handle.dispose());
				assert.equal(await handle.run("Commit."), "DONE");
				const result = toolResults(scene.endpoint.requests[1]).at(-1);
				assert.match(result, expected);
				assert.equal(head(worktree, "rev-parse", "HEAD") !== grant.base, committed);
				t.diagnostic(result.split("\n").find((line) => expected.test(line)));
			});
		});
	}
});

test("a real Pi child's codemode offers no models API and calls only the child's allowlisted tools", { skip, timeout: 60_000 }, async (t) => {
	const scene = await fixture(t, [
		{ tool: "codemode", args: { code: "return { tools: Object.keys(tools).sort(), models: typeof models };" } },
		"DONE",
	]);
	const repo = await repository(scene.dir, "repo", {});
	const core = registry(t, scene);
	const started = await background(core, repo, scene, "worker", ["read", "grep", "find", "ls", "codemode"]);
	assert.equal(started.status, "queued", started.reason);
	await eventually(() => core.get(started.id), (child) => child?.state === "completed");
	const output = toolResults(scene.endpoint.requests[1]).at(-1);
	assert.match(output, /"models":"undefined"/);
	assert.match(
		output,
		/"tools":\["ask_parent","find","grep","list_mcp_resource_templates","list_mcp_resources","ls","mcp__global__echo","read","read_mcp_resource","report_result"\]/,
	);
	t.diagnostic(`codemode: ${output.split("\n").find((line) => line.includes("tools"))}`);
});
