import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import piWorkflowExtension from "../extensions/pi-workflow.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const workerContract = await readFile(
	fileURLToPath(new URL("../assets/contracts/worker.md", import.meta.url)),
	"utf8",
);
const workerTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];

async function withWorkspace(run) {
	const dir = await realpath(
		await mkdtemp(join(tmpdir(), "pi-workflow-child-sessions-")),
	);
	try {
		const worktree = join(dir, "repo");
		const agentDir = join(dir, "agent");
		await mkdir(worktree);
		await mkdir(agentDir);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		return await run({ worktree, agentDir });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function fakeJev({ choice = "leave", types = { implement: 0.9 } } = {}) {
	const requests = [];
	const fetch = async (_url, init) => {
		const body = JSON.parse(init.body);
		requests.push(body);
		if (body.questions.choice) {
			return Response.json({
				answers: { choice: { choice, confidence: 0.9 } },
			});
		}
		return Response.json({
			answers: Object.fromEntries(
				Object.keys(body.questions).map((type) => [
					type,
					{ noul: types[type] ?? 0.1 },
				]),
			),
		});
	};
	return { fetch, requests };
}

function fakeChildren({ model, thinking, tools, run, dispose, onCreate } = {}) {
	const created = [];
	const create = async (spec) => {
		await onCreate?.();
		const child = {
			spec,
			tasks: [],
			aborts: 0,
			disposals: 0,
			result: Promise.withResolvers(),
			entries: [{ type: "message", id: `entry-${created.length}` }],
		};
		created.push(child);
		return {
			sessionId: `session-${created.length - 1}`,
			entries: () => child.entries,
			model: model ?? spec.model,
			thinking: thinking ?? spec.thinking,
			tools: tools ?? spec.tools,
			run: async (task) => {
				child.tasks.push(task);
				return run ? run(task) : child.result.promise;
			},
			abort: async () => {
				child.aborts += 1;
			},
			dispose: () => {
				child.disposals += 1;
				dispose?.(child);
			},
		};
	};
	return { create, created };
}

function loadExtension({
	agentDir,
	create,
	fetch,
	legacy = false,
	sendMessage,
	schedule,
}) {
	const handlers = new Map();
	const tools = [];
	const commands = new Map();
	const messages = [];
	const notifications = [];
	piWorkflowExtension(
		{
			on(event, handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand: (name, command) => commands.set(name, command),
			registerShortcut() {},
			registerProvider() {},
			registerTool: (tool) => tools.push(tool),
			sendMessage: (message, options) => {
				messages.push({ message, options });
				sendMessage?.(message, options);
			},
			exec: async () => {
				throw new Error("must not run commands");
			},
		},
		{
			catalog: {
				resolveInstalledVersion: (name) =>
					legacy && name === "@tintinweb/pi-subagents"
						? { version: "2.0.0" }
						: {},
			},
			modelLists: { path: join(agentDir, "pi-workflow-models.json") },
			childSessions: { create, fetch, schedule },
		},
	);
	const fire = async (event, payload = {}) => {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, {
				mode: "tui",
				hasUI: true,
				ui: {
					notify: (message, level) => notifications.push({ message, level }),
					setWidget() {},
					setStatus() {},
				},
				sessionManager: { getBranch: () => [] },
			});
		}
	};
	const command = (name, args = "") =>
		commands.get(name).handler(args, {
			mode: "tui",
			hasUI: true,
			ui: {
				notify: (message, level) => notifications.push({ message, level }),
			},
		});
	return {
		tools,
		messages,
		notifications,
		fire,
		command,
		completions: (name, prefix) =>
			commands.get(name).getArgumentCompletions(prefix),
		named: (name) => tools.find((tool) => tool.name === name),
		spawnTools: () => tools.filter((tool) => tool.name === "spawn_child"),
	};
}

async function loadSpawnTool(options) {
	const extension = loadExtension(options);
	await extension.fire("session_start");
	const [tool] = extension.spawnTools();
	return { ...extension, tool };
}

function toolContext(mode, cwd) {
	return {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async () => "typesafe-key",
			getAvailable: () => [],
		},
	};
}

function spawn(tool, params, ctx, signal) {
	return tool.execute("call-1", params, signal, undefined, ctx);
}

function text(result) {
	return result.content.map((part) => part.text).join("\n");
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function eventually(condition) {
	for (let i = 0; i < 500 && !condition(); i++) await delay(10);
	assert.ok(condition());
}

const childTools = [
	"cancel_child",
	"continue_child",
	"reply_child",
	"list_children",
	"child_status",
	"child_result",
];

test("the child tools are registered once at session start, and not while the legacy spawn package is installed", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const registered = (extension) =>
			extension.tools
				.map((tool) => tool.name)
				.filter((name) => childTools.includes(name))
				.sort();
		const blocked = loadExtension({ agentDir, legacy: true });
		await blocked.fire("session_start");
		assert.deepEqual(registered(blocked), []);

		const allowed = loadExtension({ agentDir });
		assert.deepEqual(registered(allowed), []);
		await allowed.fire("session_start");
		await allowed.fire("session_start");
		assert.deepEqual(registered(allowed), [...childTools].sort());
	});
});

test("spawn_child is registered once at session start, and not while the legacy spawn package is installed", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const blocked = loadExtension({ agentDir, legacy: true });
		await blocked.fire("session_start");
		assert.equal(blocked.spawnTools().length, 0);

		const allowed = loadExtension({ agentDir });
		assert.equal(allowed.spawnTools().length, 0);
		await allowed.fire("session_start");
		await allowed.fire("session_start");
		assert.equal(allowed.spawnTools().length, 1);
	});
});

for (const mode of ["tui", "rpc"]) {
	test(`in ${mode} mode the call returns the child id at once and the result arrives later as a message`, async () => {
		await withWorkspace(async ({ worktree, agentDir }) => {
			const children = fakeChildren();
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
				fetch: fakeJev().fetch,
			});
			const ctx = toolContext(mode, worktree);

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				ctx,
			);

			assert.equal(result.details.status, "queued");
			assert.match(result.details.id, uuid);
			assert.match(text(result), new RegExp(`${result.details.id} is queued`));
			assert.equal(children.created.length, 1);
			const [child] = children.created;
			await settle();
			assert.deepEqual(child.tasks, ["Fix the failing test"]);
			assert.equal(child.spec.cwd, worktree);
			assert.equal(child.spec.model, "session/model");
			assert.equal(child.spec.thinking, "medium");
			assert.deepEqual(child.spec.tools, workerTools);
			assert.ok(workerContract.includes(child.spec.prompt));
			assert.equal(messages.length, 0);

			child.result.resolve("All tests pass.");
			await settle();

			assert.equal(messages.length, 1);
			const [{ message, options }] = messages;
			assert.equal(message.customType, "pi-workflow-child-result");
			assert.equal(message.display, true);
			assert.deepEqual(message.details, {
				id: result.details.id,
				state: "completed",
			});
			assert.match(message.content, /completed:\n\nAll tests pass\./);
			assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: true });
			assert.equal(child.disposals, 1);
			assert.deepEqual(ctx.model, {
				provider: "session",
				id: "model",
				reasoning: true,
			});
			assert.equal(ctx.thinkingLevel, "medium");
			assert.deepEqual(await readdir(agentDir), []);
		});
	});
}

for (const mode of ["print", "json"]) {
	test(`in ${mode} mode the child runs in the foreground and its answer returns in the same call`, async () => {
		await withWorkspace(async ({ worktree, agentDir }) => {
			const children = fakeChildren({ run: async () => "All tests pass." });
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
				fetch: fakeJev().fetch,
			});

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext(mode, worktree),
			);

			assert.match(text(result), /All tests pass\./);
			assert.equal("id" in result.details, false);
			assert.equal(messages.length, 0);
			assert.equal(children.created[0].disposals, 1);
		});
	});
}

test("print mode refuses an explicit background request before asking Jev or creating a child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const jev = fakeJev();
		const { tool, messages } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: jev.fetch,
		});

		for (const mode of ["print", "json"]) {
			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test", background: true },
				toolContext(mode, worktree),
			);

			assert.equal(result.details.status, "refused");
			assert.equal("id" in result.details, false);
			assert.match(text(result), /background/);
		}
		assert.equal(jev.requests.length, 0);
		assert.equal(children.created.length, 0);
		assert.equal(messages.length, 0);
	});
});

test("an interactive session accepts an explicit background request as redundant", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test", background: true },
			toolContext("tui", worktree),
		);

		assert.match(result.details.id, uuid);
	});
});

test("refused and pending launches return a warning and reason with no child id and no child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const cases = [
			{
				params: { role: "planner", task: "Fix the failing test" },
				status: "refused",
				reason: /unknown role planner/,
			},
			{
				params: { task: "Fix the failing test", worktree: agentDir },
				status: "refused",
				reason: /not a valid worktree/,
			},
			{
				params: { role: "worker", task: "Decide the architecture" },
				jev: { choice: "stay" },
				status: "refused",
				reason: /Jev answered that the work stays/,
			},
		];
		for (const { params, jev, status, reason } of cases) {
			const children = fakeChildren();
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
				fetch: fakeJev(jev).fetch,
			});

			const result = await spawn(tool, params, toolContext("tui", worktree));

			assert.equal(result.details.status, status);
			assert.match(result.details.reason, reason);
			assert.equal("id" in result.details, false);
			assert.match(text(result), /No child was launched/);
			assert.equal(children.created.length, 0);
			assert.equal(messages.length, 0);
		}
	});
});

test("a selected pair Pi cannot run leaves the work pending with no child id", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await writeFile(
			join(agentDir, "pi-workflow-models.json"),
			JSON.stringify({
				schemaVersion: 1,
				specialists: {
					implement: [{ model: "missing/model", thinking: "high" }],
				},
				tiers: {},
				taskTypes: {},
			}),
		);
		const children = fakeChildren();
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);

		assert.equal(result.details.status, "pending");
		assert.equal("id" in result.details, false);
		assert.match(text(result), /The work stays pending/);
		assert.equal(children.created.length, 0);
	});
});

test("a child that would run another model or thinking stays pending, and one missing a contract tool is refused", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const cases = [
			{ child: { model: "other/model" }, status: "pending" },
			{ child: { thinking: "low" }, status: "pending" },
			{
				child: { tools: workerTools.filter((tool) => tool !== "bash") },
				status: "refused",
				reason: /bash/,
			},
		];
		for (const { child, status, reason } of cases) {
			const children = fakeChildren(child);
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
				fetch: fakeJev().fetch,
			});

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("tui", worktree),
			);

			assert.equal(result.details.status, status);
			if (reason) assert.match(result.details.reason, reason);
			assert.equal("id" in result.details, false);
			assert.deepEqual(children.created[0].tasks, []);
			assert.equal(children.created[0].disposals, 1);
			assert.equal(messages.length, 0);
		}
	});
});

test("aborting a foreground call aborts the child, while a background child ignores the call's signal", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});

		const foreground = new AbortController();
		const call = spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("print", worktree),
			foreground.signal,
		);
		await eventually(() => children.created[0]?.tasks.length === 1);
		foreground.abort();
		assert.equal(children.created[0].aborts, 1);
		children.created[0].result.reject(new Error("aborted"));
		await assert.rejects(call, /aborted/);
		assert.equal(children.created[0].disposals, 1);

		const background = new AbortController();
		await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
			background.signal,
		);
		background.abort();
		assert.equal(children.created[1].aborts, 0);
		assert.equal(children.created[1].disposals, 0);
	});
});

test("a failed background child is delivered as a failure message", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool, messages } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);
		await settle();
		children.created[0].result.reject(new Error("provider overloaded"));
		await settle();

		assert.equal(messages.length, 1);
		assert.deepEqual(messages[0].message.details, {
			id: result.details.id,
			state: "failed",
		});
		assert.match(messages[0].message.content, /provider overloaded/);
		assert.equal(children.created[0].disposals, 1);
	});
});

test("session shutdown disposes running background children, which then deliver nothing", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool, messages, fire } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);

		await fire("session_shutdown", { reason: "new" });
		assert.equal(children.created[0].disposals, 1);
		children.created[0].result.resolve("Late result.");
		await settle();

		assert.equal(messages.length, 0);
		assert.equal(children.created[0].disposals, 1);
	});
});

test("a null role is treated as missing: worker is used with a warning", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});

		const result = await spawn(
			tool,
			{ role: null, task: "Fix the failing test" },
			toolContext("print", worktree),
		);

		assert.match(text(result), /No role was named, so worker is used\./);
		assert.deepEqual(children.created[0].spec.tools, workerTools);
	});
});

test("the default child factory refuses when the session's model runtime is not reachable", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { tool } = await loadSpawnTool({ agentDir, fetch: fakeJev().fetch });

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("print", worktree),
		);

		assert.equal(result.details.status, "refused");
		assert.match(result.details.reason, /model runtime/);
		assert.equal("id" in result.details, false);
	});
});

async function fauxParent(agentDir, responses, { tokensPerSecond } = {}) {
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({
		provider: "faux",
		models: [{ id: "child", reasoning: true }],
		tokensPerSecond,
	});
	runtime.registerNativeProvider(faux.provider);
	const requests = [];
	faux.setResponses(
		[responses].flat().map((response) => (context) => {
			requests.push(context);
			return response;
		}),
	);
	const modelRegistry = new ModelRegistry(runtime);
	modelRegistry.getApiKeyForProvider = async () => "typesafe-key";
	return {
		runtime,
		requests,
		context: { model: faux.getModel(), thinkingLevel: "high", modelRegistry },
	};
}

test("the default child factory runs the contract on the parent's model runtime through Pi's SDK", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(
			agentDir,
			fauxAssistantMessage("Faux child answer."),
		);
		const { tool, messages } = await loadSpawnTool({
			agentDir,
			fetch: fakeJev().fetch,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			{ ...toolContext("print", worktree), ...parent.context },
		);

		assert.equal(result.details.status, "completed", text(result));
		assert.match(text(result), /Faux child answer\./);
		assert.equal(parent.requests.length, 1);
		const [system] = parent.requests[0].messages;
		assert.equal(system.role, "system");
		assert.ok(workerContract.includes(system.sections.preamble));
		assert.match(system.sections.cwd, new RegExp(worktree));
		assert.deepEqual(
			system.toolsAdded.map((tool) => tool.name).sort(),
			[...workerTools, "ask_parent"].sort(),
		);
		assert.equal(messages.length, 0);
	});
});

test("a foreground child whose run ends in a provider error is a tool error", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(
			agentDir,
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "invalid request schema",
			}),
		);
		const { tool } = await loadSpawnTool({
			agentDir,
			fetch: fakeJev().fetch,
		});

		await assert.rejects(
			spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				{ ...toolContext("print", worktree), ...parent.context },
			),
			/invalid request schema/,
		);
	});
});

async function collectUnhandled(run) {
	const unhandled = [];
	const record = (reason) => unhandled.push(reason);
	const consoleError = console.error;
	console.error = (...args) => unhandled.push(["console.error", ...args]);
	process.on("unhandledRejection", record);
	try {
		await run();
		await settle();
		await settle();
	} finally {
		process.off("unhandledRejection", record);
		console.error = consoleError;
	}
	return unhandled;
}

test("a background child disposed at session shutdown while its prompt is still preparing never sends a provider request", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(
			agentDir,
			fauxAssistantMessage("Late answer."),
		);
		const preparing = Promise.withResolvers();
		const release = Promise.withResolvers();
		const checkAuth = parent.runtime.checkAuth.bind(parent.runtime);
		parent.runtime.hasConfiguredAuth = () => false;
		parent.runtime.checkAuth = async (...args) => {
			preparing.resolve();
			await release.promise;
			return checkAuth(...args);
		};
		const { tool, messages, fire } = await loadSpawnTool({
			agentDir,
			fetch: fakeJev().fetch,
		});

		const unhandled = await collectUnhandled(async () => {
			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				{ ...toolContext("tui", worktree), ...parent.context },
			);
			assert.equal(result.details.status, "queued", text(result));
			await preparing.promise;
			await fire("session_shutdown", { reason: "quit" });
			release.resolve();
			await settle();
		});

		assert.equal(parent.requests.length, 0);
		assert.equal(messages.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("aborting a foreground call while the child's prompt is still preparing sends no provider request and does not complete", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(
			agentDir,
			fauxAssistantMessage("Late answer."),
		);
		const preparing = Promise.withResolvers();
		const release = Promise.withResolvers();
		const checkAuth = parent.runtime.checkAuth.bind(parent.runtime);
		parent.runtime.hasConfiguredAuth = () => false;
		parent.runtime.checkAuth = async (...args) => {
			preparing.resolve();
			await release.promise;
			return checkAuth(...args);
		};
		const { tool, messages } = await loadSpawnTool({
			agentDir,
			fetch: fakeJev().fetch,
		});
		const call = new AbortController();

		const unhandled = await collectUnhandled(async () => {
			const result = spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				{ ...toolContext("print", worktree), ...parent.context },
				call.signal,
			);
			await preparing.promise;
			call.abort();
			release.resolve();
			await assert.rejects(result, /The child session was stopped\./);
		});

		assert.equal(parent.requests.length, 0);
		assert.equal(messages.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("a background result is still delivered when disposing the child throws, and nothing is left unhandled", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			dispose: () => {
				throw new Error("cleanup failed");
			},
		});
		const { tool, messages, notifications } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		notifications.length = 0;

		const unhandled = await collectUnhandled(async () => {
			await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("tui", worktree),
			);
			children.created[0].result.resolve("All tests pass.");
		});

		assert.deepEqual(unhandled, []);
		assert.equal(messages.length, 1);
		assert.match(messages[0].message.content, /All tests pass\./);
		assert.equal(children.created[0].disposals, 1);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "error");
		assert.match(notifications[0].message, /cleanup failed/);
	});
});

test("a background child is disposed and nothing is left unhandled when delivering its result throws", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool, messages, notifications } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			sendMessage: () => {
				throw new Error("stale extension context");
			},
		});
		notifications.length = 0;

		const unhandled = await collectUnhandled(async () => {
			await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("tui", worktree),
			);
			children.created[0].result.resolve("All tests pass.");
		});

		assert.deepEqual(unhandled, []);
		assert.equal(messages.length, 1);
		assert.equal(children.created[0].disposals, 1);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "error");
		assert.match(notifications[0].message, /stale extension context/);
	});
});

test("session shutdown disposes every background child even when one dispose throws, and none delivers", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			dispose: (child) => {
				if (child === children.created[0]) throw new Error("cleanup failed");
			},
		});
		const { tool, messages, fire } = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		for (let i = 0; i < 2; i++) {
			await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("tui", worktree),
			);
		}

		await fire("session_shutdown", { reason: "quit" });
		for (const child of children.created) child.result.resolve("Late result.");
		await settle();

		assert.deepEqual(
			children.created.map((child) => child.disposals),
			[1, 1],
		);
		assert.equal(messages.length, 0);
	});
});

test("a call aborted before launch is refused with a reason and runs no child, in the foreground and the background", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		for (const mode of ["print", "tui"]) {
			const children = fakeChildren({ run: async () => "Ran anyway." });
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
				fetch: fakeJev().fetch,
			});
			const aborted = new AbortController();
			aborted.abort();

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext(mode, worktree),
				aborted.signal,
			);

			assert.equal(result.details.status, "refused");
			assert.match(result.details.reason, /aborted/);
			assert.equal("id" in result.details, false);
			assert.equal(children.created.length, 0);
			assert.equal(messages.length, 0);
		}
	});
});

test("a call aborted while the child session is being created is refused and the child never runs", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		for (const mode of ["print", "tui"]) {
			const aborted = new AbortController();
			const children = fakeChildren({
				onCreate: () => aborted.abort(),
				run: async () => "Ran anyway.",
			});
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
				fetch: fakeJev().fetch,
			});

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext(mode, worktree),
				aborted.signal,
			);

			assert.equal(result.details.status, "refused");
			assert.match(result.details.reason, /aborted/);
			assert.deepEqual(children.created[0].tasks, []);
			assert.equal(children.created[0].disposals, 1);
			assert.equal(messages.length, 0);
		}
	});
});

async function spawnBackground(
	extension,
	worktree,
	task = "Fix the failing test",
) {
	const result = await spawn(
		extension.tool,
		{ role: "worker", task },
		toolContext("tui", worktree),
	);
	return result.details.id;
}

function use(extension, name, params, ctx = {}) {
	return extension
		.named(name)
		.execute("call-1", params, undefined, undefined, ctx);
}

async function stateOf(extension, id) {
	return (await use(extension, "child_status", { id })).details.child?.state;
}

test("at most five children run at once; the others wait queued and start first in first out", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const ids = [];
		for (let i = 0; i < 7; i++) {
			ids.push(await spawnBackground(extension, worktree, `Task ${i}`));
		}
		await settle();

		assert.deepEqual(
			children.created.map((child) => child.tasks.length),
			[1, 1, 1, 1, 1, 0, 0],
		);
		assert.deepEqual(
			await Promise.all(ids.map((id) => stateOf(extension, id))),
			[
				"running",
				"running",
				"running",
				"running",
				"running",
				"queued",
				"queued",
			],
		);

		children.created[2].result.resolve("Done.");
		await settle();

		assert.deepEqual(children.created[5].tasks, ["Task 5"]);
		assert.deepEqual(children.created[6].tasks, []);
		assert.equal(await stateOf(extension, ids[2]), "completed");
		assert.equal(await stateOf(extension, ids[5]), "running");
		assert.equal(await stateOf(extension, ids[6]), "queued");
	});
});

test("list_children, child_status, child_result, and /pi-workflow-children report the children of this session", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		await extension.command("pi-workflow-children");
		assert.match(extension.notifications.at(-1).message, /No children/);

		const done = await spawnBackground(extension, worktree);
		const busy = await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("All tests pass.");
		await settle();

		const list = await use(extension, "list_children", {});
		assert.deepEqual(
			list.details.children.map(({ id, role, state, model, thinking }) => ({
				id,
				role,
				state,
				model,
				thinking,
			})),
			[done, busy].map((id, i) => ({
				id,
				role: "worker",
				state: ["completed", "running"][i],
				model: "session/model",
				thinking: "medium",
			})),
		);
		const [first, second] = list.details.children;
		assert.ok(first.createdAt <= first.startedAt);
		assert.ok(first.startedAt <= first.endedAt);
		assert.equal(second.endedAt, undefined);
		assert.match(text(list), new RegExp(`${done} · worker · completed`));
		assert.match(text(list), new RegExp(`${busy} · worker · running`));

		const status = await use(extension, "child_status", { id: busy });
		assert.equal(status.details.child.state, "running");
		assert.match(text(status), new RegExp(`${busy} · worker · running`));

		const result = await use(extension, "child_result", { id: done });
		assert.equal(text(result), "All tests pass.");
		assert.equal(result.details.state, "completed");
		const pending = await use(extension, "child_result", { id: busy });
		assert.match(
			text(pending),
			new RegExp(`${busy} is running and has no result yet`),
		);

		for (const name of ["child_status", "child_result"]) {
			const unknown = await use(extension, name, { id: "nope" });
			assert.match(text(unknown), /No child nope in this session/);
		}

		await extension.command("pi-workflow-children");
		const shown = extension.notifications.at(-1).message;
		assert.match(shown, new RegExp(`${done} · worker · completed`));
		assert.match(shown, new RegExp(`${busy} · worker · running`));
	});
});

test("session shutdown forgets the children of the session", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		assert.equal(await stateOf(extension, id), "completed");

		await extension.fire("session_shutdown", { reason: "new" });
		await extension.fire("session_start");

		assert.equal(
			(await use(extension, "list_children", {})).details.children.length,
			0,
		);
		assert.equal(await stateOf(extension, id), undefined);
	});
});

test("cancel_child and /pi-workflow-child-cancel leave a running child in the same cancelled state; only the command delivers it", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const byModel = await spawnBackground(extension, worktree);
		const byOperator = await spawnBackground(extension, worktree);
		await settle();

		const result = await use(extension, "cancel_child", { id: byModel });
		assert.equal(text(result), `Child ${byModel} cancelled.`);
		assert.deepEqual(result.details, { id: byModel, state: "cancelled" });
		assert.equal(children.created[0].disposals, 1);
		assert.equal(extension.messages.length, 0);

		await extension.command("pi-workflow-child-cancel", byOperator);
		assert.equal(
			extension.notifications.at(-1).message,
			`Child ${byOperator} cancelled.`,
		);
		assert.equal(children.created[1].disposals, 1);
		assert.equal(extension.messages.length, 1);
		assert.deepEqual(extension.messages[0].message.details, {
			id: byOperator,
			state: "cancelled",
		});

		for (const child of children.created) child.result.resolve("Late result.");
		await settle();

		assert.equal(await stateOf(extension, byModel), "cancelled");
		assert.equal(await stateOf(extension, byOperator), "cancelled");
		assert.equal(extension.messages.length, 1);
	});
});

test("a queued child that is cancelled never runs", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const ids = [];
		for (let i = 0; i < 6; i++)
			ids.push(await spawnBackground(extension, worktree));
		await settle();
		assert.equal(await stateOf(extension, ids[5]), "queued");

		await use(extension, "cancel_child", { id: ids[5] });
		children.created[0].result.resolve("Done.");
		await settle();

		assert.equal(await stateOf(extension, ids[5]), "cancelled");
		assert.deepEqual(children.created[5].tasks, []);
		assert.equal(children.created[5].disposals, 1);
	});
});

test("cancelling a child that already ended, or an unknown id, is refused and changes nothing", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		extension.messages.length = 0;

		const ended = await use(extension, "cancel_child", { id });
		assert.match(
			text(ended),
			new RegExp(
				`Child ${id} is completed; only a queued, running, or waiting child can be cancelled\\.`,
			),
		);
		const unknown = await use(extension, "cancel_child", { id: "nope" });
		assert.match(text(unknown), /No child nope in this session/);
		await extension.command("pi-workflow-child-cancel", id);
		assert.equal(extension.notifications.at(-1).level, "error");
		assert.match(extension.notifications.at(-1).message, /is completed/);
		await extension.command("pi-workflow-child-cancel", "");
		assert.match(
			extension.notifications.at(-1).message,
			/Usage: .*\/pi-workflow-child-cancel <id>/,
		);

		assert.equal(await stateOf(extension, id), "completed");
		assert.equal(extension.messages.length, 0);
	});
});

test("/pi-workflow-child-cancel completes the ids of children still working", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const done = await spawnBackground(extension, worktree);
		const busy = await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("Done.");
		await settle();

		const items = await extension.completions("pi-workflow-child-cancel", "");
		assert.deepEqual(
			items.map((item) => item.value),
			[busy],
		);
		assert.notEqual(done, busy);
		assert.deepEqual(
			await extension.completions("pi-workflow-child-cancel", "zzz"),
			[],
		);
	});
});

function manualClock() {
	const timers = new Set();
	return {
		schedule: (fn, ms) => {
			const timer = { fn, ms };
			timers.add(timer);
			return () => timers.delete(timer);
		},
		pending: () => [...timers].map((timer) => timer.ms),
		fire(ms) {
			for (const timer of [...timers]) {
				if (timer.ms !== ms) continue;
				timers.delete(timer);
				timer.fn();
			}
		},
	};
}

const minutes = (count) => count * 60_000;

test("a running child silent for four minutes times out, a tool in flight stretches the budget to thirty minutes, and queue time does not count", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: clock.schedule,
		});
		const ids = [];
		for (let i = 0; i < 6; i++)
			ids.push(await spawnBackground(extension, worktree));
		await settle();
		assert.deepEqual(clock.pending(), Array(5).fill(minutes(4)));

		const [first] = children.created;
		const emit = (event) => first.spec.onEvent(event);
		emit({ type: "message_update" });
		assert.deepEqual(clock.pending(), Array(5).fill(minutes(4)));
		emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash" });
		assert.equal(clock.pending().filter((ms) => ms === minutes(30)).length, 1);
		emit({ type: "tool_execution_end", toolCallId: "t1" });
		assert.deepEqual(clock.pending(), Array(5).fill(minutes(4)));
		emit({ type: "tool_execution_start", toolCallId: "t2", toolName: "bash" });

		clock.fire(minutes(30));
		await settle();

		assert.equal(await stateOf(extension, ids[0]), "timed out");
		assert.equal(first.disposals, 1);
		assert.equal(extension.messages.length, 1);
		assert.deepEqual(extension.messages[0].message.details, {
			id: ids[0],
			state: "timed out",
		});
		assert.match(
			extension.messages[0].message.content,
			/timed out: .*bash.*30 minutes/,
		);
		assert.equal(await stateOf(extension, ids[5]), "running");

		clock.fire(minutes(4));
		await settle();
		assert.deepEqual(
			await Promise.all(ids.map((id) => stateOf(extension, id))),
			[
				"timed out",
				"timed out",
				"timed out",
				"timed out",
				"timed out",
				"timed out",
			],
		);
		assert.match(
			extension.messages[1].message.content,
			/no activity for 4 minutes/,
		);

		for (const child of children.created) child.result.resolve("Late result.");
		emit({ type: "message_update" });
		await settle();
		assert.equal(extension.messages.length, 6);
		assert.deepEqual(clock.pending(), []);
	});
});

test("a foreground child silent for four minutes is aborted and the call fails as timed out", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: clock.schedule,
		});

		const call = spawn(
			extension.tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("print", worktree),
		);
		await eventually(() => children.created[0]?.tasks.length === 1);
		assert.deepEqual(clock.pending(), [minutes(4)]);
		clock.fire(minutes(4));
		assert.equal(children.created[0].aborts, 1);
		children.created[0].result.reject(new Error("Request was aborted"));

		await assert.rejects(call, /timed out: no activity for 4 minutes/);
		assert.equal(children.created[0].disposals, 1);
		assert.deepEqual(clock.pending(), []);
		assert.equal(extension.messages.length, 0);
	});
});

test("continue_child starts a new queued child from a completed child's conversation, and the completed record stays completed", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const jev = fakeJev();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: jev.fetch,
		});
		const done = await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("First answer.");
		await settle();
		for (let i = 0; i < 5; i++) await spawnBackground(extension, worktree);
		await settle();
		const jevRequests = jev.requests.length;

		const result = await use(
			extension,
			"continue_child",
			{ id: done, task: "Now add a test" },
			toolContext("tui", worktree),
		);

		const next = result.details.id;
		assert.equal(result.details.status, "queued");
		assert.match(next, uuid);
		assert.notEqual(next, done);
		assert.match(text(result), new RegExp(`${next} is queued`));
		assert.equal(jev.requests.length, jevRequests);
		const [first] = children.created;
		const continued = children.created.at(-1);
		assert.deepEqual(continued.spec.entries, first.entries);
		assert.equal(continued.spec.parentSession, "session-0");
		for (const key of ["cwd", "model", "thinking", "prompt", "tools"]) {
			assert.deepEqual(continued.spec[key], first.spec[key]);
		}
		const list = (await use(extension, "list_children", {})).details.children;
		assert.deepEqual(
			list
				.filter((child) => [done, next].includes(child.id))
				.map(({ id, state, continuedFrom }) => ({ id, state, continuedFrom })),
			[
				{ id: done, state: "completed", continuedFrom: undefined },
				{ id: next, state: "queued", continuedFrom: done },
			],
		);

		children.created[1].result.resolve("Done.");
		await settle();
		assert.deepEqual(continued.tasks, ["Now add a test"]);
		assert.equal(await stateOf(extension, next), "running");
		assert.equal(await stateOf(extension, done), "completed");

		const again = await use(
			extension,
			"continue_child",
			{ id: done, task: "And another" },
			toolContext("tui", worktree),
		);
		assert.equal(again.details.status, "queued");
		assert.ok(![done, next].includes(again.details.id));
	});
});

test("continue_child refuses failed, cancelled, timed-out, working, and unknown children without creating one", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: clock.schedule,
		});
		const failed = await spawnBackground(extension, worktree);
		const cancelled = await spawnBackground(extension, worktree);
		const timedOut = await spawnBackground(extension, worktree);
		const running = await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.reject(new Error("provider overloaded"));
		await settle();
		await use(extension, "cancel_child", { id: cancelled });
		children.created[3].spec.onEvent({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
		});
		clock.fire(minutes(4));
		await settle();
		assert.equal(await stateOf(extension, timedOut), "timed out");
		const created = children.created.length;

		for (const [id, state] of [
			[failed, "failed"],
			[cancelled, "cancelled"],
			[timedOut, "timed out"],
			[running, "running"],
		]) {
			const result = await use(
				extension,
				"continue_child",
				{ id, task: "Try again" },
				toolContext("tui", worktree),
			);
			assert.equal(result.details.status, "refused");
			assert.equal("id" in result.details, false);
			assert.match(
				text(result),
				new RegExp(
					`Child ${id} is ${state}; only a completed child can be continued\\.`,
				),
			);
			assert.equal(await stateOf(extension, id), state);
		}
		const unknown = await use(
			extension,
			"continue_child",
			{ id: "nope", task: "Try again" },
			toolContext("tui", worktree),
		);
		assert.equal(unknown.details.status, "refused");
		assert.match(text(unknown), /No child nope in this session/);
		assert.equal(children.created.length, created);
	});
});

test("a continued child whose session cannot be created is refused with no child id", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		let creates = 0;
		const children = fakeChildren({
			run: async () => "First answer.",
			onCreate: () => {
				creates += 1;
				if (creates > 1) throw new Error("provider gone");
			},
		});
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const done = await spawnBackground(extension, worktree);
		await settle();

		const result = await use(
			extension,
			"continue_child",
			{ id: done, task: "Now add a test" },
			toolContext("tui", worktree),
		);

		assert.equal(result.details.status, "refused");
		assert.match(result.details.reason, /provider gone/);
		assert.equal("id" in result.details, false);
		assert.equal(
			(await use(extension, "list_children", {})).details.children.length,
			1,
		);
	});
});

test("a completed child cannot be continued after session shutdown", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});
		const done = await spawnBackground(extension, worktree);
		await settle();
		await extension.fire("session_shutdown", { reason: "new" });
		await extension.fire("session_start");

		const result = await use(
			extension,
			"continue_child",
			{ id: done, task: "Now add a test" },
			toolContext("tui", worktree),
		);

		assert.match(text(result), new RegExp(`No child ${done} in this session`));
		assert.equal(children.created.length, 1);
	});
});

test("a child that asks waits for the parent model's reply_child answer, still holding its running slot", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: clock.schedule,
		});
		const ids = [];
		for (let i = 0; i < 5; i++)
			ids.push(await spawnBackground(extension, worktree));
		await settle();
		const [id] = ids;

		const answer = children.created[0].spec.ask("Which file holds the parser?");

		assert.equal(await stateOf(extension, id), "waiting");
		assert.equal(extension.messages.length, 1);
		const [{ message, options }] = extension.messages;
		assert.equal(message.customType, "pi-workflow-child-question");
		assert.equal(message.display, true);
		assert.deepEqual(message.details, { id, state: "waiting", question: 1 });
		assert.match(
			message.content,
			new RegExp(
				`Child ${id} asks \\(question 1\\):\\n\\nWhich file holds the parser\\?`,
			),
		);
		assert.match(message.content, /reply_child with question 1/);
		assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
		const sixth = await spawnBackground(extension, worktree);
		await settle();
		assert.equal(await stateOf(extension, sixth), "queued");

		const reply = await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "src/parser.ts",
		});

		assert.equal(text(reply), `Reply sent to child ${id}.`);
		assert.equal(await answer, "src/parser.ts");
		assert.equal(await stateOf(extension, id), "running");

		const again = await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "x",
		});
		assert.equal(
			text(again),
			`Question 1 of child ${id} is not waiting for a reply.`,
		);
		const unknown = await use(extension, "reply_child", {
			id: "nope",
			question: 1,
			answer: "x",
		});
		assert.match(text(unknown), /No child nope in this session/);
	});
});

test("a repeated reply to an answered question never answers the child's next question", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: clock.schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const first = children.created[0].spec.ask("Delete the cache?");
		await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "Yes, delete it.",
		});
		assert.equal(await first, "Yes, delete it.");
		const second = children.created[0].spec.ask("Rename the module?");
		assert.deepEqual(
			extension.messages.map((entry) => entry.message.details.question),
			[1, 2],
		);

		const late = await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "Yes, delete it.",
		});

		assert.equal(
			text(late),
			`Question 1 of child ${id} is not waiting for a reply.`,
		);
		assert.equal(await stateOf(extension, id), "waiting");
		const reply = await use(extension, "reply_child", {
			id,
			question: 2,
			answer: "No.",
		});
		assert.equal(text(reply), `Reply sent to child ${id}.`);
		assert.equal(await second, "No.");
	});
});

test("a reply to a child that has ended is refused", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const asked = outcome(children.created[0].spec.ask("Which file?"));
		await use(extension, "cancel_child", { id });
		assert.equal(await asked(), "The child was cancelled.");

		const reply = await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "src/a.ts",
		});

		assert.equal(
			text(reply),
			`Child ${id} is cancelled; question 1 can no longer be answered.`,
		);
		assert.equal(await stateOf(extension, id), "cancelled");
	});
});

test("a child asks one question at a time", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();

		const first = children.created[0].spec.ask("First?");
		await assert.rejects(
			children.created[0].spec.ask("Second?"),
			/A question is already waiting for the parent's reply\./,
		);

		assert.equal(await stateOf(extension, id), "waiting");
		assert.equal(extension.messages.length, 1);
		await use(extension, "reply_child", { id, question: 1, answer: "Yes." });
		assert.equal(await first, "Yes.");
	});
});

test("cancelling a waiting child, or shutting the session down, rejects its question", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: manualClock().schedule,
		});
		const cancelled = await spawnBackground(extension, worktree);
		await spawnBackground(extension, worktree);
		await settle();
		const first = outcome(children.created[0].spec.ask("Which file?"));
		const second = outcome(children.created[1].spec.ask("Which file?"));
		extension.messages.length = 0;

		const result = await use(extension, "cancel_child", { id: cancelled });
		assert.equal(text(result), `Child ${cancelled} cancelled.`);
		assert.equal(await first(), "The child was cancelled.");
		assert.equal(children.created[0].disposals, 1);

		await extension.fire("session_shutdown", { reason: "quit" });
		assert.equal(await second(), "The session ended.");
		assert.equal(children.created[1].disposals, 1);
		assert.equal(extension.messages.length, 0);
	});
});

test("a question the parent cannot receive fails at once and the child keeps running", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: manualClock().schedule,
			sendMessage: () => {
				throw new Error("stale extension context");
			},
		});
		const id = await spawnBackground(extension, worktree);
		await settle();

		await assert.rejects(
			children.created[0].spec.ask("Which file?"),
			/The question could not reach the parent: stale extension context/,
		);
		assert.equal(await stateOf(extension, id), "running");
	});
});

test("a foreground child's question fails closed because the parent is waiting inside spawn_child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: manualClock().schedule,
		});

		const call = spawn(
			extension.tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("print", worktree),
		);
		await eventually(() => children.created[0]?.tasks.length === 1);

		await assert.rejects(
			children.created[0].spec.ask("Which file?"),
			/The parent cannot answer: it is waiting for this child in the foreground\. Continue without an answer\./,
		);
		children.created[0].result.resolve("Done without asking.");
		assert.match(text(await call), /Done without asking\./);
		assert.equal(extension.messages.length, 0);
	});
});

function sent(request) {
	return JSON.stringify(request.messages);
}

function asking(question) {
	return fauxAssistantMessage(fauxToolCall("ask_parent", { question }), {
		stopReason: "toolUse",
	});
}

async function realChild(agentDir, responses, options) {
	const parent = await fauxParent(agentDir, responses, options);
	const clock = manualClock();
	const extension = await loadSpawnTool({
		agentDir,
		fetch: fakeJev().fetch,
		schedule: clock.schedule,
	});
	return { parent, clock, extension };
}

async function spawnReal({ parent, extension }, worktree, mode = "tui") {
	return spawn(
		extension.tool,
		{ role: "worker", task: "Fix the failing test" },
		{ ...toolContext(mode, worktree), ...parent.context },
	);
}

test("cancelling a streaming child through Pi's SDK leaves it cancelled, not failed, and stops its provider stream", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(
			agentDir,
			fauxAssistantMessage("a very long answer ".repeat(400)),
			{ tokensPerSecond: 200 },
		);
		let id;
		const unhandled = await collectUnhandled(async () => {
			const result = await spawnReal(child, worktree);
			id = result.details.id;
			await eventually(() => child.parent.requests.length === 1);
			await delay(20);
			const cancelled = await use(child.extension, "cancel_child", { id });
			assert.equal(text(cancelled), `Child ${id} cancelled.`);
			await delay(150);
		});

		assert.equal(await stateOf(child.extension, id), "cancelled");
		assert.equal(child.parent.requests.length, 1);
		assert.equal(child.extension.messages.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("a streaming child that stalls through Pi's SDK times out, is delivered as timed out, and is not turned into a failure", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(
			agentDir,
			fauxAssistantMessage("a very long answer ".repeat(400)),
			{ tokensPerSecond: 200 },
		);
		let id;
		const unhandled = await collectUnhandled(async () => {
			id = (await spawnReal(child, worktree)).details.id;
			await eventually(() => child.parent.requests.length === 1);
			await delay(20);
			assert.deepEqual(child.clock.pending(), [minutes(4)]);
			child.clock.fire(minutes(4));
			await delay(150);
		});

		assert.equal(await stateOf(child.extension, id), "timed out");
		assert.equal(child.parent.requests.length, 1);
		assert.equal(child.extension.messages.length, 1);
		assert.deepEqual(child.extension.messages[0].message.details, {
			id,
			state: "timed out",
		});
		assert.deepEqual(child.clock.pending(), []);
		assert.deepEqual(unhandled, []);
	});
});

test("a child that times out through Pi's SDK while its prompt is still preparing never sends a provider request", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(
			agentDir,
			fauxAssistantMessage("Late answer."),
		);
		const preparing = Promise.withResolvers();
		const release = Promise.withResolvers();
		const runtime = child.parent.runtime;
		const checkAuth = runtime.checkAuth.bind(runtime);
		runtime.hasConfiguredAuth = () => false;
		runtime.checkAuth = async (...args) => {
			preparing.resolve();
			await release.promise;
			return checkAuth(...args);
		};
		let id;
		const unhandled = await collectUnhandled(async () => {
			id = (await spawnReal(child, worktree)).details.id;
			await preparing.promise;
			child.clock.fire(minutes(4));
			release.resolve();
			await delay(20);
		});

		assert.equal(await stateOf(child.extension, id), "timed out");
		assert.equal(child.parent.requests.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("continue_child through Pi's SDK sends the completed child's conversation plus the follow-up, and leaves that conversation unchanged", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			fauxAssistantMessage("First answer."),
			fauxAssistantMessage("Second answer."),
			fauxAssistantMessage("Third answer."),
		]);
		const { extension, parent } = child;
		const ctx = { ...toolContext("tui", worktree), ...parent.context };
		const unhandled = await collectUnhandled(async () => {
			const done = (await spawnReal(child, worktree)).details.id;
			await eventually(() => extension.messages.length === 1);

			const next = await use(
				extension,
				"continue_child",
				{ id: done, task: "Now add a test" },
				ctx,
			);
			assert.equal(next.details.status, "queued", text(next));
			await eventually(() => extension.messages.length === 2);
			assert.match(
				extension.messages[1].message.content,
				/completed:\n\nSecond answer\./,
			);
			assert.deepEqual(extension.messages[1].message.details, {
				id: next.details.id,
				state: "completed",
			});
			assert.deepEqual(
				parent.requests[1].messages.map((message) => message.role),
				["system", "user", "assistant", "user"],
			);
			const second = sent(parent.requests[1]);
			assert.ok(
				second.indexOf("Fix the failing test") <
					second.indexOf("First answer.") &&
					second.indexOf("First answer.") < second.indexOf("Now add a test"),
			);
			assert.equal(await stateOf(extension, done), "completed");

			await use(
				extension,
				"continue_child",
				{ id: done, task: "Once more" },
				ctx,
			);
			await eventually(() => extension.messages.length === 3);
			assert.equal(parent.requests[2].messages.length, 4);
			assert.ok(!sent(parent.requests[2]).includes("Second answer."));
		});

		assert.deepEqual(unhandled, []);
	});
});

test("a background child asks through Pi's SDK, the parent model replies, and the child finishes with the answer", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			asking("Which file holds the parser?"),
			fauxAssistantMessage("Fixed src/parser.ts."),
		]);
		const { extension, parent } = child;
		let id;
		const unhandled = await collectUnhandled(async () => {
			id = (await spawnReal(child, worktree)).details.id;
			await eventually(() => extension.messages.length === 1);
			assert.equal(
				extension.messages[0].message.customType,
				"pi-workflow-child-question",
			);
			assert.match(
				extension.messages[0].message.content,
				/Which file holds the parser\?/,
			);
			assert.equal(await stateOf(extension, id), "waiting");

			await use(extension, "reply_child", {
				id,
				question: 1,
				answer: "src/parser.ts",
			});
			await eventually(() => extension.messages.length === 2);
		});

		assert.match(
			extension.messages[1].message.content,
			/completed:\n\nFixed src\/parser\.ts\./,
		);
		assert.ok(sent(parent.requests[1]).includes("src/parser.ts"));
		assert.equal(await stateOf(extension, id), "completed");
		assert.deepEqual(unhandled, []);
	});
});

test("a child through Pi's SDK that waits for a reply that never comes ends timed out by the watchdog, and a late reply is refused", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			asking("Which file?"),
			fauxAssistantMessage("Late answer."),
		]);
		const { extension, parent, clock } = child;
		let id;
		const unhandled = await collectUnhandled(async () => {
			id = (await spawnReal(child, worktree)).details.id;
			await eventually(() => extension.messages.length === 1);
			assert.equal(await stateOf(extension, id), "waiting");
			assert.deepEqual(clock.pending(), [minutes(30)]);
			clock.fire(minutes(30));
			await delay(50);
		});

		assert.equal(await stateOf(extension, id), "timed out");
		assert.equal(extension.messages.length, 2);
		assert.deepEqual(extension.messages[1].message.details, {
			id,
			state: "timed out",
		});
		assert.match(
			extension.messages[1].message.content,
			/ask_parent ran for 30 minutes/,
		);
		const late = await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "src/a.ts",
		});
		assert.equal(
			text(late),
			`Child ${id} is timed out; question 1 can no longer be answered.`,
		);
		assert.equal(parent.requests.length, 1);
		assert.deepEqual(unhandled, []);
	});
});

test("cancelling a child through Pi's SDK while it waits for a reply ends it with no further provider request", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			asking("Which file?"),
			fauxAssistantMessage("Late answer."),
		]);
		const { extension, parent } = child;
		let id;
		const unhandled = await collectUnhandled(async () => {
			id = (await spawnReal(child, worktree)).details.id;
			await eventually(() => extension.messages.length === 1);
			await use(extension, "cancel_child", { id });
			await delay(50);
		});

		assert.equal(await stateOf(extension, id), "cancelled");
		assert.equal(parent.requests.length, 1);
		assert.equal(extension.messages.length, 1);
		assert.deepEqual(unhandled, []);
	});
});

test("a foreground child's question through Pi's SDK fails closed and the child finishes in the same call", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			asking("Which file?"),
			fauxAssistantMessage("Finished without an answer."),
		]);
		const { extension, parent } = child;

		const result = await spawnReal(child, worktree, "print");

		assert.match(text(result), /Finished without an answer\./);
		assert.ok(
			sent(parent.requests[1]).includes(
				"The parent cannot answer: it is waiting for this child in the foreground.",
			),
		);
		assert.equal(extension.messages.length, 0);
	});
});

test("a child that finishes between the parent's abort and session shutdown is delivered to the outgoing session and never to the next one", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		let session = "outgoing";
		const deliveredTo = [];
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			sendMessage: () => deliveredTo.push(session),
		});
		const call = new AbortController();
		const finished = await spawn(
			extension.tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
			call.signal,
		);
		await spawnBackground(extension, worktree);
		await settle();

		call.abort();
		children.created[0].result.resolve("Finished in the gap.");
		await settle();
		await extension.fire("session_shutdown", { reason: "new" });
		session = "next";
		await extension.fire("session_start");
		children.created[1].result.resolve("Finished after the switch.");
		await settle();

		assert.deepEqual(deliveredTo, ["outgoing"]);
		assert.equal(extension.messages[0].message.details.id, finished.details.id);
		assert.deepEqual(
			(await use(extension, "list_children", {})).details.children,
			[],
		);
	});
});

function outcome(promise) {
	const settled = promise.then(
		() => "resolved",
		(error) => error.message,
	);
	return async () => {
		await settle();
		return Promise.race([settled, Promise.resolve("still pending")]);
	};
}

function settledNow(promise) {
	return outcome(promise)();
}

test("a child that is no longer working cannot ask the parent", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
			schedule: manualClock().schedule,
		});
		const cancelled = await spawnBackground(extension, worktree);
		await spawnBackground(extension, worktree);
		await settle();
		await use(extension, "cancel_child", { id: cancelled });

		assert.equal(
			await settledNow(children.created[0].spec.ask("Still there?")),
			"The child is not running.",
		);
		assert.equal(await stateOf(extension, cancelled), "cancelled");

		await extension.fire("session_shutdown", { reason: "quit" });
		assert.equal(
			await settledNow(children.created[1].spec.ask("Still there?")),
			"The child is not running.",
		);
		assert.equal(extension.messages.length, 0);
	});
});

test("a launch whose child session is created after session shutdown is refused and never runs", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const creating = Promise.withResolvers();
		const release = Promise.withResolvers();
		const children = fakeChildren({
			onCreate: async () => {
				creating.resolve();
				await release.promise;
			},
		});
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			fetch: fakeJev().fetch,
		});

		const call = spawn(
			extension.tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);
		await creating.promise;
		await extension.fire("session_shutdown", { reason: "quit" });
		release.resolve();
		const result = await call;
		await settle();

		assert.equal(result.details.status, "refused");
		assert.match(
			result.details.reason,
			/The session ended before the child launched\./,
		);
		assert.equal("id" in result.details, false);
		assert.equal(children.created[0].disposals, 1);
		assert.deepEqual(children.created[0].tasks, []);
		assert.deepEqual(
			(await use(extension, "list_children", {})).details.children,
			[],
		);
	});
});
