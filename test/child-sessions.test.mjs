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

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
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
		onCreate?.();
		const child = {
			spec,
			tasks: [],
			aborts: 0,
			disposals: 0,
			result: Promise.withResolvers(),
		};
		created.push(child);
		return {
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
}) {
	const handlers = new Map();
	const tools = [];
	const messages = [];
	const notifications = [];
	piWorkflowExtension(
		{
			on(event, handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand() {},
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
			childSessions: { create, fetch },
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
	return {
		tools,
		messages,
		notifications,
		fire,
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

			assert.match(result.details.id, uuid);
			assert.match(text(result), new RegExp(result.details.id));
			assert.equal(children.created.length, 1);
			const [child] = children.created;
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
				failed: false,
			});
			assert.match(message.content, /All tests pass\./);
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
		children.created[0].result.reject(new Error("provider overloaded"));
		await settle();

		assert.equal(messages.length, 1);
		assert.deepEqual(messages[0].message.details, {
			id: result.details.id,
			failed: true,
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

async function fauxParent(agentDir, response) {
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({
		provider: "faux",
		models: [{ id: "child", reasoning: true }],
	});
	runtime.registerNativeProvider(faux.provider);
	const requests = [];
	faux.setResponses([
		(context) => {
			requests.push(context);
			return response;
		},
	]);
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
			[...workerTools].sort(),
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
			assert.equal(result.details.status, "started", text(result));
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
