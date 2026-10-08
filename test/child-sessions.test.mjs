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
import { stripVTControlCharacters } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultPackageManager,
	DefaultResourceLoader,
	getAgentDir,
	initTheme,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	TuiMainScreen,
	visibleWidth,
} from "@earendil-works/pi-tui";

import {
	createAskParentTool,
	createPiChildSession,
} from "../extensions/child-sessions.ts";
import { compactToolRenderers } from "../extensions/compact-tools.ts";
import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import {
	fakeChildren,
	recordingCore,
	userEntry,
} from "./support/fake-children.mjs";
import { classifierRegistry } from "./support/fake-jev.mjs";
import { turnJevRoutingOn } from "./support/jev-routing.mjs";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
	expectations: {},
});

const packageVersion = JSON.parse(
	await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const workerContract = await readFile(
	fileURLToPath(new URL("../assets/contracts/worker.md", import.meta.url)),
	"utf8",
);
const workerTools = ["read", "bash", "edit", "write", "grep", "find", "ls", "codemode"];
const spawnedTools = [...workerTools, "ask_parent", "report_result"];
const workerAllowlist = [
	...workerTools,
	"mcp__*",
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
	"ask_parent",
	"report_result",
];

function workerResult(verdict, reason = `The work is ${verdict}.`) {
	return {
		verdict,
		reason,
		files_changed: ["src/a.ts: fixed the parser"],
		validation: ["npm test: 12 passed"],
		left_undone: [],
	};
}

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
		process.env.PI_CODING_AGENT_DIR = agentDir;
		return await run({ worktree, agentDir, dir });
	} finally {
		delete process.env.PI_CODING_AGENT_DIR;
		await rm(dir, { recursive: true, force: true });
	}
}

function choiceAnswer(choice, criteria = {}) {
	return {
		type: "choice",
		choice,
		confidence: 0.9,
		probabilities: Object.fromEntries(
			Object.keys(criteria).map((key) => [key, key === choice ? 1 : 0]),
		),
	};
}

function fakeJev({ choice = "leave", specialist } = {}) {
	const specialists = ["explorer", "worker", "verifier"];
	return classifierRegistry((body) => {
		const questions = body.questions ?? {};
		const suggested = body.state?.suggested_specialist;
		const picked = specialists.includes(specialist)
			? specialist
			: specialists.includes(suggested)
				? suggested
				: "worker";
		const answers = {};
		if (questions.specialist) {
			answers.specialist = choiceAnswer(picked, questions.specialist.criteria);
		}
		if (questions.destination) {
			const destinations = ["stay", "leave", "decide"];
			answers.destination = choiceAnswer(
				destinations.includes(choice) ? choice : "leave",
				questions.destination.criteria,
			);
		}
		return { answers };
	});
}

function loadExtension({
	agentDir,
	create,
	legacy = false,
	sendMessage,
	schedule,
	refresh,
	branch = [],
	jevRouting = "on",
}) {
	if (jevRouting === "on") turnJevRoutingOn(agentDir);
	const handlers = new Map();
	const tools = [];
	const commands = new Map();
	const shortcuts = new Map();
	const messages = [];
	const entries = [];
	const notifications = [];
	const widgets = new Map();
	const views = [];
	const headers = {};
	let idle = true;
	const ui = {
		notify: (message, level) => notifications.push({ message, level }),
		setWidget(key, factory, options) {
			widgets.delete(key);
			if (factory) widgets.set(key, { factory, options });
		},
		setStatus() {},
		setHeader: (factory) => (headers.main = factory),
		setFooter() {},
		setEditorComponent() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setWorkingMessage() {},
		custom(factory, options) {
			const view = { factory, options, ...Promise.withResolvers() };
			views.push(view);
			return view.promise;
		},
	};
	piWorkflowExtension(
		{
			on(event, handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand: (name, command) => commands.set(name, command),
			registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut),
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			registerTool: (tool) => tools.push(tool),
			sendMessage: (message, options) => {
				messages.push({ message, options });
				sendMessage?.(message, options);
			},
			appendEntry: (customType, data) => entries.push({ customType, data }),
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
			agentDirectory: agentDir,
			childSessions: { create, schedule, refresh },
		},
	);
	const fire = async (event, payload = {}, mode = "tui") => {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, {
				mode,
				hasUI: true,
				ui,
				cwd: "/tmp",
				getContextUsage: () => undefined,
				isIdle: () => idle,
				sessionManager: { getBranch: () => branch, getEntries: () => [] },
			});
		}
	};
	const command = (name, args = "", mode = "tui") =>
		commands.get(name).handler(args, { mode, hasUI: true, ui });
	return {
		tools,
		messages,
		entries,
		notifications,
		widgets,
		headers,
		views,
		shortcuts,
		commands,
		ui,
		fire,
		command,
		busy: (value) => {
			idle = !value;
		},
		installLegacy: () => {
			legacy = true;
		},
		named: (name) => tools.find((tool) => tool.name === name),
		gate: (event, ctx) => handlers.get("tool_call")[0](event, ctx),
		spawnTools: () => tools.filter((tool) => tool.name === "spawn_child"),
	};
}

async function loadSpawnTool(options) {
	const extension = loadExtension(options);
	await extension.fire("session_start");
	const [tool] = extension.spawnTools();
	return { ...extension, tool };
}

function toolContext(mode, cwd, jev = fakeJev()) {
	return {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd,
		isProjectTrusted: () => false,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async () => "typesafe-key",
			getAvailable: () => [],
			...jev.registry,
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
const stateOfDetails = ({ id, state }) => ({ id, state });

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
			});
			const ctx = toolContext(mode, worktree);

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				ctx,
			);

			assert.equal(result.details.status, "queued");
			assert.match(result.details.id, uuid);
			assert.equal(result.details.role, "worker");
			assert.equal(result.details.jev.answers.specialist.choice, "worker");
			assert.match(text(result), new RegExp(`${result.details.id} is queued`));
			assert.match(text(result), /Jev selected worker\./);
			assert.equal(children.created.length, 1);
			const [child] = children.created;
			await settle();
			assert.deepEqual(child.tasks, ["Fix the failing test"]);
			assert.equal(child.spec.cwd, worktree);
			assert.equal(child.spec.model, "session/model");
			assert.equal(child.spec.thinking, "medium");
			assert.deepEqual(child.spec.tools, workerAllowlist);
			assert.ok(workerContract.includes(child.spec.prompt));
			assert.equal(messages.length, 0);

			child.result.resolve("All tests pass.");
			await settle();

			assert.equal(messages.length, 1);
			const [{ message, options }] = messages;
			assert.equal(message.customType, "pi-workflow-child-result");
			assert.equal(message.display, true);
			const { elapsedMs, ...details } = message.details;
			assert.ok(elapsedMs >= 0);
			assert.deepEqual(details, {
				id: result.details.id,
				state: "completed",
				role: "worker",
				model: "session/model",
				thinking: "medium",
				task: "Fix the failing test",
				text: "All tests pass.",
				result: undefined,
				verdict: undefined,
			});
			assert.match(message.content, /completed\. Verdict: absent\.\n\nAll tests pass\./);
			assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
			assert.equal(child.disposals, 1);
			assert.deepEqual(ctx.model, {
				provider: "session",
				id: "model",
				reasoning: true,
			});
			assert.equal(ctx.thinkingLevel, "medium");
			assert.deepEqual(await readdir(agentDir), ["pi-workflow-routing.json"]);
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
			});

			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext(mode, worktree),
			);

			assert.match(text(result), /All tests pass\./);
			assert.doesNotMatch(text(result), /Jev selected/);
			assert.equal(result.details.role, "worker");
			assert.equal(result.details.jev.answers.destination.choice, "leave");
			assert.equal("id" in result.details, false);
			assert.equal(messages.length, 0);
			assert.equal(children.created[0].disposals, 1);
		});
	});
}

test("a foreground result shows its Run state and Verdict to the parent", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			run: async (_task, spec) => {
				spec.report(workerResult("partial", "The migration is pending."));
				return "Could not finish.";
			},
		});
		const { tool } = await loadSpawnTool({ agentDir, create: children.create });

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("print", worktree),
		);

		assert.match(
			text(result),
			/^Child completed\. Verdict: partial\.\nReason: The migration is pending\.\n[\s\S]*\n\nCould not finish\.$/,
		);
		assert.equal(result.details.verdict, "partial");
	});
});

test("print mode refuses an explicit background request before asking Jev or creating a child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const jev = fakeJev();
		const { tool, messages } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		for (const mode of ["print", "json"]) {
			const result = await spawn(
				tool,
				{ role: "worker", task: "Fix the failing test", background: true },
				toolContext(mode, worktree, jev),
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
			});

			const result = await spawn(
				tool,
				params,
				toolContext("tui", worktree, fakeJev(jev)),
			);

			assert.equal(result.details.status, status);
			assert.match(result.details.reason, reason);
			assert.equal("id" in result.details, false);
			if (jev) {
				assert.equal(result.details.jev.answers.destination.choice, "stay");
			} else {
				assert.equal("jev" in result.details, false);
			}
			assert.match(text(result), /No child was launched/);
			assert.equal(children.created.length, 0);
			assert.equal(messages.length, 0);
		}
	});
});

test("under leave, the parent's gated tools stay blocked until a launch for the message succeeds", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const message = "Research the parser and tell me the package version";
		let failures = 1;
		const children = fakeChildren({
			onCreate: () => {
				if (failures-- > 0) throw new Error("provider gone");
			},
		});
		const extension = await loadSpawnTool({ agentDir, create: children.create });
		const ctx = {
			...toolContext("tui", worktree, fakeJev({ specialist: "explorer" })),
			sessionManager: {
				getBranch: () => [
					{ id: "request", type: "message", message: { role: "user", content: message } },
				],
			},
		};
		const read = { toolName: "read", input: { path: "package.json" } };

		const refused = await spawn(extension.tool, { task: "Research the parser" }, ctx);
		const afterRefusal = await extension.gate(read, ctx);
		const queued = await spawn(extension.tool, { task: "Research the parser" }, ctx);
		const afterLaunch = await extension.gate(read, ctx);

		assert.equal(refused.details.status, "refused");
		assert.equal(afterRefusal.block, true);
		assert.match(afterRefusal.reason, /\bexplore\b/);
		assert.equal(queued.details.status, "queued");
		assert.equal(afterLaunch, undefined);
	});
});

test("under leave, a foreground child that starts and then fails unblocks the parent's gated tools, and a refusal before start does not", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const message = "Research the parser and tell me the package version";
		let failures = 1;
		const children = fakeChildren({
			onCreate: () => {
				if (failures-- > 0) throw new Error("provider gone");
			},
			run: async () => {
				throw new Error("provider overloaded");
			},
		});
		const extension = await loadSpawnTool({ agentDir, create: children.create });
		const ctx = {
			...toolContext("print", worktree, fakeJev({ specialist: "explorer" })),
			sessionManager: {
				getBranch: () => [
					{ id: "request", type: "message", message: { role: "user", content: message } },
				],
			},
		};
		const read = { toolName: "read", input: { path: "package.json" } };

		const refused = await spawn(extension.tool, { task: "Research the parser" }, ctx);
		const afterRefusal = await extension.gate(read, ctx);
		await assert.rejects(
			spawn(extension.tool, { task: "Research the parser" }, ctx),
			/provider overloaded/,
		);
		const afterFailure = await extension.gate(read, ctx);

		assert.equal(refused.details.status, "refused");
		assert.equal(afterRefusal.block, true);
		assert.equal(afterFailure, undefined);
	});
});

test("a profile model Pi cannot run refuses the launch with no child id", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await writeFile(
			join(agentDir, "pi-workflow-models.json"),
			JSON.stringify({
				schemaVersion: 2,
				active: "default",
				profiles: {
					default: { worker: { model: "missing/model", thinking: "high" } },
				},
			}),
		);
		const children = fakeChildren();
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);

		assert.equal(result.details.status, "refused");
		assert.match(result.details.reason, /missing\/model/);
		assert.equal("id" in result.details, false);
		assert.match(text(result), /Launch refused/);
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
			{
				child: { tools: workerTools.filter((tool) => tool !== "codemode") },
				status: "refused",
				reason: /lacks the contract tools codemode\./,
			},
		];
		for (const { child, status, reason } of cases) {
			const children = fakeChildren(child);
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
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
		const { tool, entries } = await loadSpawnTool({
			agentDir,
			create: children.create,
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
		assert.deepEqual(traceStates(entries), ["running", "cancelled"]);

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
		assert.deepEqual(stateOfDetails(messages[0].message.details), {
			id: result.details.id,
			state: "failed",
		});
		assert.match(messages[0].message.content, /provider overloaded/);
		assert.equal(children.created[0].disposals, 1);
	});
});

test("each Run state transition of a child is appended to the parent session as a bounded trace entry", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await writeFile(join(worktree, "AGENTS.md"), "policy");
		const children = fakeChildren();
		const { tool, entries, messages } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Secret task text", references: ["AGENTS.md"] },
			toolContext("tui", worktree),
		);
		await settle();
		children.created[0].spec.report(workerResult("done"));
		children.created[0].result.resolve("full result body");
		await settle();

		const traces = entries.filter(
			(entry) => entry.customType === "pi-workflow-child-trace",
		);
		assert.deepEqual(
			traces.map((entry) => entry.data.state),
			["queued", "running", "completed"],
		);
		for (const { data } of traces) {
			assert.equal(data.id, result.details.id);
			assert.equal(data.role, "worker");
			assert.equal(data.chosenBy, "jev");
			assert.deepEqual(data.tools, workerAllowlist);
			assert.deepEqual(data.references, ["AGENTS.md"]);
			assert.equal(data.version, packageVersion);
			assert.ok(!JSON.stringify(data).includes("Secret task text"));
			assert.ok(!JSON.stringify(data).includes("full result body"));
		}
		assert.equal(traces[2].data.verdict, "done");
		assert.equal(traces[0].data.verdict, undefined);
		assert.equal(messages.length, 1);
	});
});

test("a worker reports its result with report_result; the last call wins and reaches the parent, the trace, and child_result", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const [child] = children.created;

		child.spec.report(workerResult("done"));
		child.spec.report(workerResult("blocked", "Database access is missing"));
		child.result.resolve("I stopped before the migration.");
		await settle();

		const [{ message }] = extension.messages;
		assert.equal(message.details.verdict, "blocked");
		assert.deepEqual(
			message.details.result,
			workerResult("blocked", "Database access is missing"),
		);
		assert.match(
			message.content,
			/completed\. Verdict: blocked\.\nReason: Database access is missing\nfiles_changed:\n- src\/a\.ts: fixed the parser\nvalidation:\n- npm test: 12 passed\nleft_undone:\n- none\n\nI stopped before the migration\.$/,
		);
		const traces = await backgroundTraceStates(extension, id);
		assert.equal(traces.at(-1).verdict, "blocked");
		assert.equal(traces.at(-1).reason, "Database access is missing");
		assert.match(
			text(await use(extension, "child_result", { id })),
			/Verdict: blocked\.\nReason: Database access is missing/,
		);
	});
});

test("a foreground child appends its running and terminal Run states as trace entries", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			run: async (_task, spec) => {
				spec.report(workerResult("blocked"));
				return "full result body";
			},
		});
		const { tool, entries } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		await spawn(
			tool,
			{ role: "worker", task: "Secret task text" },
			toolContext("print", worktree),
		);

		const traces = entries.filter(
			(entry) => entry.customType === "pi-workflow-child-trace",
		);
		assert.deepEqual(
			traces.map((entry) => entry.data.state),
			["running", "completed"],
		);
		assert.equal(traces[0].data.id, traces[1].data.id);
		assert.equal(traces[1].data.role, "worker");
		assert.equal(traces[1].data.verdict, "blocked");
		assert.equal(traces[1].data.reason, "The work is blocked.");
		assert.ok(!JSON.stringify(traces).includes("Secret task text"));
		assert.ok(!JSON.stringify(traces).includes("full result body"));
	});
});

test("a foreground child that fails appends a failed trace entry", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			run: async () => {
				throw new Error("provider overloaded");
			},
		});
		const { tool, entries } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		await assert.rejects(
			spawn(
				tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("print", worktree),
			),
			/provider overloaded/,
		);

		assert.deepEqual(
			entries
				.filter((entry) => entry.customType === "pi-workflow-child-trace")
				.map((entry) => entry.data.state),
			["running", "failed"],
		);
	});
});

function traceStates(entries) {
	return entries
		.filter((entry) => entry.customType === "pi-workflow-child-trace")
		.map((entry) => entry.data.state);
}

async function backgroundTraceStates(extension, id) {
	await settle();
	return extension.entries
		.filter(
			(entry) =>
				entry.customType === "pi-workflow-child-trace" && entry.data.id === id,
		)
		.map((entry) => entry.data);
}

test("a child that asks is traced as waiting, and as running again once the parent answers", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();

		const answer = children.created[0].spec.ask("Which file?");
		assert.deepEqual(
			(await backgroundTraceStates(extension, id)).map((data) => data.state),
			["queued", "running", "waiting"],
		);

		await use(extension, "reply_child", { id, question: 1, answer: "a.ts" });
		await answer;
		assert.deepEqual(
			(await backgroundTraceStates(extension, id)).map((data) => data.state),
			["queued", "running", "waiting", "running"],
		);
	});
});

test("a background child that fails, is cancelled, or times out is traced with that state and no Verdict", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: clock.schedule,
		});
		const failed = await spawnBackground(extension, worktree);
		const cancelled = await spawnBackground(extension, worktree);
		const timedOut = await spawnBackground(extension, worktree);
		await settle();

		children.created[0].result.reject(new Error("provider overloaded"));
		await settle();
		await use(extension, "cancel_child", { id: cancelled });
		clock.fire(minutes(4));

		for (const [id, state] of [
			[failed, "failed"],
			[cancelled, "cancelled"],
			[timedOut, "timed out"],
		]) {
			const traces = await backgroundTraceStates(extension, id);
			assert.equal(traces.at(-1).state, state);
			assert.equal(traces.at(-1).verdict, undefined);
		}
	});
});

test("a trace entry that cannot be appended does not break the child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({ agentDir, create: children.create });
		extension.entries.push = () => {
			throw new Error("disk full");
		};

		await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("Done.");
		await settle();

		assert.equal(extension.messages.length, 1);
	});
});

test("session shutdown disposes running background children, which then deliver nothing", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool, messages, fire } = await loadSpawnTool({
			agentDir,
			create: children.create,
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

test("a reload ends every working child, tells the operator how many ended, and records it in the trace", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		for (let i = 0; i < 7; i++) await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("Done.");
		await settle();
		extension.notifications.length = 0;

		await extension.fire("session_shutdown", { reason: "reload" });

		assert.deepEqual(
			children.created.map((child) => child.disposals),
			Array(7).fill(1),
		);
		assert.deepEqual(extension.notifications, [
			{ message: "/reload ended 6 working children.", level: "warning" },
		]);
		assert.deepEqual(extension.entries.at(-1), {
			customType: "pi-workflow-child-trace",
			data: { reason: "reload", ended: 6 },
		});
		assert.deepEqual((await use(extension, "list_children", {})).details.children, []);
		assert.equal(extension.messages.length, 0);
	});
});

test("a shutdown for another reason, or a reload with no working child, gives no notice", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		for (const [reason, launches] of [
			["new", 1],
			["quit", 1],
			["reload", 0],
		]) {
			const extension = await loadSpawnTool({
				agentDir,
				create: fakeChildren().create,
			});
			for (let i = 0; i < launches; i++)
				await spawnBackground(extension, worktree);
			extension.notifications.length = 0;
			const entries = extension.entries.length;

			await extension.fire("session_shutdown", { reason });

			assert.deepEqual(extension.notifications, [], reason);
			assert.equal(extension.entries.length, entries, reason);
		}
	});
});

test("a null role is missing and does not warn that worker was assumed", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		const result = await spawn(
			tool,
			{ role: null, task: "Fix the failing test" },
			toolContext("print", worktree),
		);

		assert.equal(result.details.status, "completed");
		assert.equal(result.details.role, "worker");
		assert.doesNotMatch(text(result), /No role was named/);
		assert.deepEqual(children.created[0].spec.tools, workerAllowlist);
	});
});

test("an explicit child request in the user message is sent to Jev with the destination question", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const jev = fakeJev();
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		const result = await spawn(
			tool,
			{ task: "Map the module" },
			{
				...toolContext("print", worktree, jev),
				sessionManager: {
					getBranch: () => [
						{
							type: "message",
							id: "older",
							message: { role: "user", content: "Look at the file" },
						},
						{
							type: "message",
							id: "assistant",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "I can spawn a child." }],
							},
						},
						{
							type: "message",
							id: "tool",
							message: {
								role: "toolResult",
								content: [{ type: "text", text: "child" }],
							},
						},
						{
							type: "message",
							id: "latest",
							message: {
								role: "user",
								content: [
									{ type: "text", text: "Use a child" },
									{ type: "text", text: "to map the module" },
								],
							},
						},
						{
							type: "message",
							id: "blank",
							message: { role: "user", content: "   " },
						},
					],
				},
			},
		);

		assert.equal(result.details.status, "completed");
		assert.equal(jev.requests.length, 1);
		assert.equal(
			jev.requests[0].state.user_request,
			"Use a child\nto map the module",
		);
		assert.equal(jev.requests[0].state.task, "Map the module");
		assert.equal(jev.requests[0].questions.destination.type, "choice");
	});
});

test("a named implement skill does not select the worker; Jev chooses the specialist", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const jev = fakeJev({ specialist: "explorer" });
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		const result = await spawn(
			tool,
			{ role: "worker", task: "Implement the ticket" },
			{
				...toolContext("tui", worktree, jev),
				sessionManager: {
					getBranch: () => [
						{
							type: "message",
							message: {
								role: "user",
								content: "Usa la skill implement para este ticket",
							},
						},
					],
				},
			},
		);

		assert.equal(result.details.status, "queued");
		assert.equal(result.details.role, "explore");
		assert.equal("skill" in result.details, false);
		assert.equal(result.details.jev.answers.specialist.choice, "explorer");
		assert.match(text(result), /Jev selected explore/);
		assert.doesNotMatch(text(result), /skill selected/);
		assert.equal(jev.requests.length, 1);
		assert.equal(
			jev.requests[0].state.user_request,
			"Usa la skill implement para este ticket",
		);
		assert.equal(jev.requests[0].state.suggested_specialist, "worker");
		assert.equal(children.created.length, 1);
		assert.ok(!children.created[0].spec.tools.includes("report_result"));
	});
});

test("the default child factory refuses when the session's model runtime is not reachable", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { tool } = await loadSpawnTool({ agentDir });

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
	Object.assign(modelRegistry, fakeJev().registry);
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
			[...spawnedTools].sort(),
		);
		assert.equal(messages.length, 0);
	});
});

test("the default child factory gives an explore child a read-only codegraph and no init", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(agentDir, fauxAssistantMessage("Found it."));
		const { tool } = await loadSpawnTool({ agentDir });

		const result = await spawn(
			tool,
			{ role: "explore", task: "Map the launcher" },
			{ ...toolContext("print", worktree), ...parent.context },
		);

		assert.equal(result.details.status, "completed", text(result));
		const [system] = parent.requests[0].messages;
		const added = system.toolsAdded.map((added) => added.name);
		assert.ok(added.includes("codegraph"));
		const codegraph = system.toolsAdded.find((added) => added.name === "codegraph");
		assert.deepEqual(codegraph.parameters.properties.operation.enum, [
			"query",
			"explore",
		]);
	});
});

test("the default child factory runs a trusted project's shell prefix in the child's bash", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await mkdir(join(worktree, ".pi"));
		await writeFile(
			join(worktree, ".pi", "settings.json"),
			JSON.stringify({ shellCommandPrefix: "PI_WORKFLOW_PREFIX=project" }),
		);
		const echo = () =>
			fauxAssistantMessage(
				fauxToolCall("bash", { command: 'echo "[$PI_WORKFLOW_PREFIX]"' }),
				{ stopReason: "toolUse" },
			);
		const parent = await fauxParent(agentDir, [
			echo(),
			fauxAssistantMessage("Trusted."),
			echo(),
			fauxAssistantMessage("Untrusted."),
		]);
		const { tool } = await loadSpawnTool({ agentDir });

		for (const trusted of [true, false]) {
			const result = await spawn(
				tool,
				{ role: "worker", task: "Echo the prefix" },
				{
					...toolContext("print", worktree),
					...parent.context,
					isProjectTrusted: () => trusted,
				},
			);
			assert.equal(result.details.status, "completed", text(result));
		}

		const outputs = parent.requests
			.flatMap((request) => request.messages)
			.filter((message) => message.role === "toolResult")
			.map((message) => message.content.map((part) => part.text).join(""));
		assert.deepEqual(outputs, ["[project]\n", "[]\n"]);
	});
});

const mcpFixture = fileURLToPath(
	new URL("./support/mcp-fixture-server.mjs", import.meta.url),
);

async function writeMcpConfig(dir, pids, servers) {
	await mkdir(dir, { recursive: true });
	await mkdir(pids, { recursive: true });
	await writeFile(
		join(dir, "mcp.json"),
		JSON.stringify({
			mcpServers: Object.fromEntries(
				Object.entries(servers).map(([name, config]) => [
					name,
					{ command: process.execPath, args: [mcpFixture, name, pids], ...config },
				]),
			),
		}),
	);
}

function processRuns(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function fixturePid(pids, name) {
	return Number(await readFile(join(pids, `${name}.pid`), "utf8"));
}

function declared(request) {
	return request.messages[0].toolsAdded.map((added) => added.name);
}

function toolOutputs(requests) {
	return requests
		.flatMap((request) => request.messages)
		.filter((message) => message.role === "toolResult")
		.map((message) => message.content.map((part) => part.text ?? "").join(""));
}

const mcpScript = [
	'const echoed = await tools.mcp__tracker__echo({ text: "hi" });',
	"return { echoed: echoed.content[0].text, models: typeof models, mcp: Object.keys(tools).filter((name) => name.includes(\"mcp\")).sort() };",
].join("\n");

test("every Specialist reaches the parent's direct and codemode-only MCP tools and the resource tools, and nothing of the parent", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const pids = join(agentDir, "pids");
		await writeMcpConfig(agentDir, pids, {
			docs: { exposure: "direct", description: "Library docs." },
			tracker: { description: "Issue tracker." },
		});
		const roles = { explore: [], worker: ["report_result"], verify: ["report_result"] };
		for (const [role, extra] of Object.entries(roles)) {
			const parent = await fauxParent(agentDir, [
				fauxAssistantMessage(fauxToolCall("codemode", { code: mcpScript }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("Done."),
			]);
			const { tool } = await loadSpawnTool({ agentDir });
			const contract = await readFile(
				fileURLToPath(new URL(`../assets/contracts/${role}.md`, import.meta.url)),
				"utf8",
			);
			const contractTools = contract
				.match(/^tools: (.*)$/m)[1]
				.split(", ");

			const result = await spawn(
				tool,
				{ role, task: "Use the trackers" },
				{ ...toolContext("print", worktree), ...parent.context },
			);

			assert.equal(result.details.status, "completed", text(result));
			const names = declared(parent.requests[0]);
			for (const name of [
				...contractTools,
				"ask_parent",
				...extra,
				"mcp__docs__echo",
				"list_mcp_resources",
				"list_mcp_resource_templates",
				"read_mcp_resource",
			]) {
				assert.ok(names.includes(name), `${role} lacks ${name}: ${names}`);
			}
			for (const name of [
				"spawn_child",
				"mcp__tracker__echo",
				...childTools,
			]) {
				assert.ok(!names.includes(name), `${role} declares ${name}`);
			}
			assert.ok(!names.some((name) => /web|fetch/.test(name)), `${role}: ${names}`);
			const [output] = toolOutputs(parent.requests);
			assert.match(output, /"echoed":"tracker echoes hi"/);
			assert.match(output, /"models":"undefined"/);
			assert.match(output, /mcp__docs__echo/);
			assert.match(output, /mcp__tracker__echo/);
		}
	});
});

test("a child session starts its MCP servers only when it runs and closes them when it is disposed", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const pids = join(agentDir, "pids");
		await writeMcpConfig(agentDir, pids, {
			docs: { exposure: "direct", description: "Library docs." },
		});
		const parent = await fauxParent(agentDir, fauxAssistantMessage("Done."));
		const handle = await createPiChildSession({
			cwd: worktree,
			project: { cwd: worktree, trusted: false },
			role: "explore",
			model: "faux/child",
			thinking: "high",
			prompt: "You are a child session.",
			tools: ["read", "codemode", "mcp__*", "ask_parent"],
			modelRegistry: parent.context.modelRegistry,
			shell: {},
			onEvent: () => {},
			notify: () => {},
			ask: async () => "answer",
			report: () => {},
		});

		await delay(100);
		assert.deepEqual(await readdir(pids), []);

		assert.equal(await handle.run("Look it up."), "Done.");
		const pid = await fixturePid(pids, "docs");
		assert.ok(processRuns(pid));
		assert.ok(declared(parent.requests[0]).includes("mcp__docs__echo"));

		await handle.dispose();
		await eventually(() => !processRuns(pid));
	});
});

test("a child's MCP notices reach its trace", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await writeFile(
			join(agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					broken: { command: join(agentDir, "missing-server"), exposure: "direct" },
				},
			}),
		);
		const parent = await fauxParent(agentDir, fauxAssistantMessage("Done."));
		const { tool, entries } = await loadSpawnTool({ agentDir });

		const result = await spawn(
			tool,
			{ role: "explore", task: "Look it up" },
			{ ...toolContext("print", worktree), ...parent.context },
		);

		assert.equal(result.details.status, "completed", text(result));
		const notices = entries
			.filter((entry) => entry.customType === "pi-workflow-child-trace")
			.flatMap((entry) => (entry.data.notice ? [entry.data] : []))
			.filter((trace) => !trace.notice.includes("pi-web-access"));
		assert.equal(notices.length, 1);
		assert.equal(notices[0].state, "running");
		assert.match(notices[0].notice, /MCP servers need attention/);
		assert.match(notices[0].notice, /broken/);
	});
});

test("a child receives the parent's project MCP servers only when the parent trusts the project, and never its worktree's", async () => {
	await withWorkspace(async ({ worktree, agentDir, dir }) => {
		const pids = join(agentDir, "pids");
		const project = join(dir, "parent");
		await writeMcpConfig(join(project, ".pi"), pids, {
			project: { exposure: "direct", description: "Project tools." },
		});
		await writeMcpConfig(join(worktree, ".pi"), pids, {
			rogue: { exposure: "direct", description: "Worktree tools." },
		});
		const parent = await fauxParent(agentDir, [
			fauxAssistantMessage("Trusted."),
			fauxAssistantMessage("Untrusted."),
		]);
		const { tool } = await loadSpawnTool({ agentDir });

		for (const trusted of [true, false]) {
			const result = await spawn(
				tool,
				{ role: "explore", task: "Look it up", worktree },
				{
					...toolContext("print", project),
					...parent.context,
					isProjectTrusted: () => trusted,
				},
			);
			assert.equal(result.details.status, "completed", text(result));
		}

		const [trustedNames, untrustedNames] = parent.requests.map(declared);
		assert.ok(trustedNames.includes("mcp__project__echo"), `${trustedNames}`);
		assert.ok(!untrustedNames.includes("mcp__project__echo"), `${untrustedNames}`);
		for (const names of [trustedNames, untrustedNames]) {
			assert.ok(!names.includes("mcp__rogue__echo"), `${names}`);
		}
		await assert.rejects(readFile(join(pids, "rogue.pid")));
	});
});

test("a worker and a verifier load the parent's context files, an explorer loads none, and no child loads skills", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await writeFile(join(agentDir, "AGENTS.md"), "Global rule: answer in haiku.");
		await writeFile(join(worktree, "AGENTS.md"), "Repository rule: run npm run check.");
		await mkdir(join(agentDir, "skills", "deploy"), { recursive: true });
		await writeFile(
			join(agentDir, "skills", "deploy", "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy the release train.\n---\nDeploy it.\n",
		);
		const roles = ["worker", "verify", "explore"];
		const parent = await fauxParent(
			agentDir,
			roles.map(() => fauxAssistantMessage("Done.")),
		);
		const { tool } = await loadSpawnTool({ agentDir });

		for (const role of roles) {
			const result = await spawn(
				tool,
				{ role, task: "Check the parser" },
				{ ...toolContext("print", worktree), ...parent.context },
			);
			assert.equal(result.details.status, "completed", text(result));
		}

		const systems = parent.requests.map((request) =>
			JSON.stringify(request.messages[0]),
		);
		for (const system of systems.slice(0, 2)) {
			assert.match(system, /Global rule: answer in haiku\./);
			assert.match(system, /Repository rule: run npm run check\./);
		}
		assert.doesNotMatch(systems[2], /Global rule|Repository rule/);
		for (const system of systems) {
			assert.doesNotMatch(system, /Deploy the release train/);
		}
	});
});

test("a worker loads the worktree's AGENTS.override.md in place of its AGENTS.md", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await writeFile(join(worktree, "AGENTS.md"), "Repository rule: run npm run check.");
		await writeFile(
			join(worktree, "AGENTS.override.md"),
			"Override rule: run npm test only.",
		);
		const parent = await fauxParent(agentDir, [fauxAssistantMessage("Done.")]);
		const { tool } = await loadSpawnTool({ agentDir });

		const result = await spawn(
			tool,
			{ role: "worker", task: "Check the parser" },
			{ ...toolContext("print", worktree), ...parent.context },
		);
		assert.equal(result.details.status, "completed", text(result));

		const system = JSON.stringify(parent.requests[0].messages[0]);
		assert.match(system, /Override rule: run npm test only\./);
		assert.doesNotMatch(system, /Repository rule/);
	});
});

async function installWebAccess(agentDir, label = "local") {
	const dir = join(agentDir, "npm", "node_modules", "pi-web-access");
	await mkdir(join(dir, "dist"), { recursive: true });
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({
			name: "pi-web-access",
			type: "module",
			pi: { extensions: ["./dist"] },
		}),
	);
	await writeFile(
		join(dir, "dist", "index.js"),
		[
			"const state = { fetches: new Set() };",
			"(globalThis.webAccessStates ??= []).push(state);",
			"export default function (pi) {",
			'\tpi.on("session_start", () => state.fetches.add("fetch"));',
			'\tpi.on("session_shutdown", () => state.fetches.clear());',
			'\tfor (const name of ["web_search", "fetch_content"]) {',
			"\t\tpi.registerTool({",
			"\t\t\tname,",
			"\t\t\tlabel: name,",
			`\t\t\tdescription: ${JSON.stringify(`Web from ${label}.`)},`,
			'\t\t\tparameters: { type: "object", properties: {} },',
			'\t\t\texecute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),',
			"\t\t});",
			"\t}",
			"}",
			"",
		].join("\n"),
	);
	return dir;
}

function childTraces(entries) {
	return entries
		.filter((entry) => entry.customType === "pi-workflow-child-trace")
		.map((entry) => entry.data);
}

test("an explorer has the local pi-web-access tools whether or not its expectation is on, and a worker and a verifier have none", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		await installWebAccess(agentDir);
		const roles = ["explore", "worker", "verify"];
		const launches = [false, true].flatMap((expected) =>
			roles.map((role) => ({ expected, role })),
		);
		const parent = await fauxParent(
			agentDir,
			launches.map(() => fauxAssistantMessage("Done.")),
		);

		try {
			for (const { expected, role } of launches) {
				replaceSelection({
					schemaVersion: 1,
					capabilities: Object.fromEntries(
						capabilities.map((capability) => [capability, true]),
					),
					expectations: { "pi-web-access": expected },
				});
				const { tool, entries } = await loadSpawnTool({ agentDir });
				const result = await spawn(
					tool,
					{ role, task: "Research the parser" },
					{ ...toolContext("print", worktree), ...parent.context },
				);
				assert.equal(result.details.status, "completed", text(result));
				assert.ok(
					childTraces(entries).every((trace) => trace.notice === undefined),
					`${role}: ${JSON.stringify(childTraces(entries))}`,
				);
			}
		} finally {
			replaceSelection({
				schemaVersion: 1,
				capabilities: Object.fromEntries(
					capabilities.map((capability) => [capability, true]),
				),
				expectations: {},
			});
		}

		parent.requests.forEach((request, index) => {
			const { role } = launches[index];
			const web = declared(request).filter((name) =>
				["web_search", "fetch_content"].includes(name),
			);
			assert.deepEqual(web, role === "explore" ? ["web_search", "fetch_content"] : [], role);
		});
	});
});

test("an explorer without a local pi-web-access launches without web tools, its trace names the package, and nothing is installed", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(agentDir, fauxAssistantMessage("Done."));
		const { tool, entries } = await loadSpawnTool({ agentDir });

		const result = await spawn(
			tool,
			{ role: "explore", task: "Research the parser" },
			{ ...toolContext("print", worktree), ...parent.context },
		);

		assert.equal(result.details.status, "completed", text(result));
		const names = declared(parent.requests[0]);
		assert.ok(!names.some((name) => /web|fetch/.test(name)), `${names}`);
		const notices = childTraces(entries).filter((trace) => trace.notice);
		assert.equal(notices.length, 1);
		assert.match(notices[0].notice, /pi-web-access/);
		await assert.rejects(readdir(join(agentDir, "npm")));
	});
});

test("an explorer loads pi-web-access from Pi's agent directory under both agent-directory variables", async () => {
	await withWorkspace(async ({ worktree, agentDir, dir }) => {
		const home = join(dir, "home");
		const piDefault = join(home, ".pi", "agent");
		const agentHome = join(dir, "agent-home");
		await installWebAccess(agentDir, "PI_CODING_AGENT_DIR");
		await installWebAccess(piDefault, "the default agent directory");
		await installWebAccess(agentHome, "PI_AGENT_HOME");
		const cases = [
			{ codingAgentDir: agentDir, agentHome: undefined, loads: "PI_CODING_AGENT_DIR" },
			{ codingAgentDir: agentDir, agentHome, loads: "PI_CODING_AGENT_DIR" },
			{ codingAgentDir: undefined, agentHome, loads: "the default agent directory" },
			{ codingAgentDir: undefined, agentHome: undefined, loads: "the default agent directory" },
		];
		const saved = { HOME: process.env.HOME, PI_AGENT_HOME: process.env.PI_AGENT_HOME };
		try {
			for (const variables of cases) {
				const parent = await fauxParent(agentDir, fauxAssistantMessage("Done."));
				process.env.HOME = home;
				for (const [name, value] of [
					["PI_CODING_AGENT_DIR", variables.codingAgentDir],
					["PI_AGENT_HOME", variables.agentHome],
				]) {
					if (value === undefined) delete process.env[name];
					else process.env[name] = value;
				}
				const parentPackage = new DefaultPackageManager({
					cwd: worktree,
					agentDir: getAgentDir(),
					settingsManager: SettingsManager.inMemory(),
				}).getInstalledPath("npm:pi-web-access", "user");
				const handle = await createPiChildSession({
					cwd: worktree,
					project: { cwd: worktree, trusted: false },
					role: "explore",
					model: "faux/child",
					thinking: "high",
					prompt: "You are a child session.",
					tools: ["read", "web_search"],
					modelRegistry: parent.context.modelRegistry,
					shell: {},
					onEvent: () => {},
					notify: () => {},
					ask: async () => "answer",
					report: () => {},
				});
				try {
					await handle.run("Look it up.");
				} finally {
					await handle.dispose();
				}
				const search = parent.requests[0].messages[0].toolsAdded.find(
					(added) => added.name === "web_search",
				);
				assert.equal(search?.description, `Web from ${variables.loads}.`, JSON.stringify(variables));
				assert.equal(
					parentPackage,
					join(variables.codingAgentDir ?? piDefault, "npm", "node_modules", "pi-web-access"),
				);
			}
		} finally {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	});
});

test("an explorer ending, in the parent's worktree or another, leaves the parent's pi-web-access state alone", async () => {
	await withWorkspace(async ({ worktree, agentDir, dir }) => {
		const directory = await installWebAccess(agentDir);
		const other = join(dir, "other");
		await mkdir(other);
		execFileSync("git", ["init", "--quiet"], { cwd: other });
		const parent = await fauxParent(agentDir, [
			fauxAssistantMessage("Same."),
			fauxAssistantMessage("Other."),
		]);
		const states = [];
		globalThis.webAccessStates = states;
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: worktree,
			agentDir,
			settingsManager,
			noSkills: true,
			noContextFiles: true,
			additionalExtensionPaths: [directory],
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: worktree,
			agentDir,
			modelRuntime: parent.runtime,
			model: parent.context.model,
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.inMemory(worktree),
		});
		await session.bindExtensions({});
		try {
			assert.equal(states.length, 1);
			const [parentState] = states;
			assert.deepEqual([...parentState.fetches], ["fetch"]);

			for (const cwd of [worktree, other]) {
				const handle = await createPiChildSession({
					cwd,
					project: { cwd: worktree, trusted: false },
					role: "explore",
					model: "faux/child",
					thinking: "high",
					prompt: "You are a child session.",
					tools: ["read", "web_search"],
					modelRegistry: parent.context.modelRegistry,
					shell: {},
					onEvent: () => {},
					notify: () => {},
					ask: async () => "answer",
					report: () => {},
				});
				await handle.run("Look it up.");
				const explorerState = states.at(-1);
				assert.notEqual(explorerState, parentState);
				assert.deepEqual([...explorerState.fetches], ["fetch"]);
				await handle.dispose();
				assert.deepEqual([...explorerState.fetches], []);
				assert.deepEqual([...parentState.fetches], ["fetch"], cwd);
			}
			assert.equal(states.length, 3);
		} finally {
			session.dispose();
			delete globalThis.webAccessStates;
		}
	});
});

test("two children of one Specialist and model in one worktree send the same prefix, with the task only in the user message", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const pids = join(agentDir, "pids");
		await writeMcpConfig(agentDir, pids, {
			docs: { exposure: "direct", description: "Library docs." },
			tracker: { description: "Issue tracker." },
		});
		await writeFile(join(worktree, "AGENTS.md"), "Repository rule: run npm run check.");
		const parent = await fauxParent(agentDir, [
			fauxAssistantMessage("First."),
			fauxAssistantMessage("Second."),
		]);
		const { tool } = await loadSpawnTool({ agentDir });

		for (const task of ["Fix the parser", "Fix the lexer"]) {
			const result = await spawn(
				tool,
				{ role: "worker", task },
				{ ...toolContext("print", worktree), ...parent.context },
			);
			assert.equal(result.details.status, "completed", text(result));
		}

		const [first, second] = parent.requests;
		const prefix = ({ timestamp: _sent, ...system }) => system;
		assert.deepEqual(prefix(first.messages[0]), prefix(second.messages[0]));
		assert.ok(declared(first).includes("mcp__docs__echo"));
		assert.match(JSON.stringify(first.messages[0]), /Repository rule/);
		assert.doesNotMatch(JSON.stringify(first.messages[0]), /Fix the/);
		assert.match(JSON.stringify(first.messages.slice(1)), /Fix the parser/);
		assert.match(JSON.stringify(second.messages.slice(1)), /Fix the lexer/);
	});
});

test("launching a child keeps the parent's model and thinking, and a profile naming a virtual model runs the child on it", async () => {
	await assertLaunchKeepsParentModel(fakeJev());
});

test("with Jev routing off, the launch response names the launched role and not Jev", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const { tool } = await loadSpawnTool({
			agentDir,
			create: children.create,
			jevRouting: "off",
		});

		const result = await spawn(
			tool,
			{ role: "verify", task: "Run the checks" },
			toolContext("tui", worktree),
		);

		assert.equal(result.details.status, "queued", text(result));
		assert.match(text(result), /Launched as verify\./);
		assert.doesNotMatch(text(result), /Jev selected/);
	});
});

test("spawn_child tells the parent to end its turn instead of polling", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { tool } = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		const guidance = tool.promptGuidelines.join("\n");
		assert.match(guidance, /end your turn/i);
		assert.match(
			guidance,
			/sleep, list_children, child_status, or child_result/,
		);
		assert.match(guidance, /Do not delegate mutating git or gh commands or publication/);
		assert.match(guidance, /reserved for the parent/);
		assert.match(guidance, /Do not ask the child for intermediate progress reports/);
		assert.match(guidance, /references accept only paths inside the cwd/);
		assert.match(guidance, /no channel to a running child; use reply_child only when the child asks/);
		assert.match(guidance, /Do not declare work done without a worker Verdict of done/);
		assert.match(guidance, /Do not declare work verified without a verifier Verdict of pass/);
		assert.match(guidance, /partial, fail, and blocked are not success/);
		assert.match(
			guidance,
			/One codemode script can launch several children: each spawn_child call returns at once without awaiting the child\. Their results arrive in one message when every child is done, or earlier when a result needs you\./,
		);
		assert.match(guidance, /At most 10 children can be queued, running, or waiting/);

		const result = await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);
		assert.match(text(result), /End your turn/i);
		assert.match(text(result), /do not poll/i);
	});
});

test("spawn_child describes who decides the role and what each role can do", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const { tool } = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		const role = tool.parameters.properties.role.description;
		assert.match(role, /Jev routing is off, the role you pass decides/);
		assert.match(role, /on, it is a suggestion/);
		const guidance = tool.promptGuidelines.join("\n");
		const taskDescription = tool.parameters.properties.task.description;
		assert.match(taskDescription, /acceptance criteria and changed-file\/diff context/);
		assert.match(taskDescription, /known validation commands\/results as context/);
		assert.match(taskDescription, /Exploration may discover context directly from the worktree/);
		assert.doesNotMatch(guidance, /acceptance criteria|changed-file diff|validation commands\/results/);
		assert.match(guidance, /Explore reads and queries CodeGraph without editing or commands/);
		assert.match(guidance, /Pass the task and the role \(explore, worker, or verify\)\./);
		assert.match(guidance, /verify independently checks completed work and may run checks and tests without editing/);
		assert.match(guidance, /worker implements and runs commands/);
		assert.match(
			guidance,
			/When Jev routing is on, the parent asks once per user turn/,
		);
		assert.doesNotMatch(guidance, /(^|\. )Jev selects the specialist/m);
		assert.match(
			guidance,
			/When Jev routing is on, the role is a suggestion and Jev selects the specialist/,
		);
		assert.match(
			tool.description,
			/When Jev routing is on, the harness decides whether the work leaves/,
		);
	});
});

test("with Jev routing off, launching a named role keeps the parent's model and thinking, and a profile naming a virtual model runs the child on it", async () => {
	const jev = fakeJev();
	await assertLaunchKeepsParentModel(jev, "off");
	assert.equal(jev.requests.length, 0);
});

async function assertLaunchKeepsParentModel(jev, jevRouting = "on") {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(
			agentDir,
			fauxAssistantMessage("Routed answer."),
		);
		const routes = [];
		parent.runtime.registerVirtualModel({
			provider: "router",
			id: "auto",
			name: "Auto",
			thinkingLevels: ["low", "high"],
			route(request) {
				routes.push(`${request.model.provider}/${request.model.id}:${request.thinkingLevel}`);
				return { model: parent.context.model, thinkingLevel: "high" };
			},
		});
		await writeFile(
			join(agentDir, "pi-workflow-models.json"),
			JSON.stringify({
				schemaVersion: 2,
				active: "default",
				profiles: {
					default: { worker: { model: "router/auto", thinking: "low" } },
				},
			}),
		);
		const extension = await loadSpawnTool({ agentDir, jevRouting });
		const ctx = { ...toolContext("tui", worktree, jev), ...parent.context };
		const parentModel = ctx.model;

		const result = await spawn(
			extension.tool,
			{ role: "worker", task: "Fix the failing test" },
			ctx,
		);
		await eventually(() => extension.messages.length === 1);

		assert.equal(result.details.status, "queued", text(result));
		assert.deepEqual(routes, ["router/auto:low"]);
		assert.equal(parent.requests.length, 1);
		const child = (await use(extension, "child_status", { id: result.details.id }))
			.details.child;
		assert.equal(child.state, "completed");
		assert.equal(child.model, "router/auto");
		assert.equal(child.thinking, "low");
		assert.equal(ctx.model, parentModel);
		assert.equal(`${ctx.model.provider}/${ctx.model.id}`, "faux/child");
		assert.equal(ctx.thinkingLevel, "high");
	});
}

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
			await assert.rejects(
				result,
				/The call was aborted and the child was stopped\./,
			);
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

test("a finished child's result is delivered while its session is still shutting down", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ dispose: () => new Promise(() => {}) });
		const { tool, messages } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawn(
			tool,
			{ role: "explore", task: "Map the parser" },
			toolContext("tui", worktree),
		);

		children.created[0].result.resolve("Mapped.");
		await settle();
		await settle();

		assert.equal(children.created[0].disposals, 1);
		assert.equal(messages.length, 1);
		assert.match(messages[0].message.content, /Mapped\./);
	});
});

test("a child session that fails to shut down is reported and leaves nothing unhandled", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			dispose: async () => {
				throw new Error("cleanup failed");
			},
		});
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const unhandled = await collectUnhandled(async () => {
			await spawn(
				extension.tool,
				{ role: "explore", task: "Map the parser" },
				toolContext("tui", worktree),
			);
			children.created[0].result.resolve("Mapped.");
			await settle();
		});

		assert.deepEqual(unhandled, []);
		assert.equal(extension.messages.length, 1);
		assert.ok(
			extension.notifications.some(({ message }) =>
				/cleanup failed/.test(message),
			),
		);
	});
});

test("the parent session's end waits for its children to shut down", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const shutdown = Promise.withResolvers();
		const children = fakeChildren({ dispose: () => shutdown.promise });
		const { tool, fire } = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawn(
			tool,
			{ role: "worker", task: "Fix the failing test" },
			toolContext("tui", worktree),
		);

		const ended = outcome(fire("session_shutdown", { reason: "quit" }));
		assert.equal(await ended(), "still pending");
		shutdown.resolve();
		assert.equal(await ended(), "resolved");
	});
});

test("a call aborted before launch is refused with a reason and runs no child, in the foreground and the background", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		for (const mode of ["print", "tui"]) {
			const children = fakeChildren({ run: async () => "Ran anyway." });
			const { tool, messages } = await loadSpawnTool({
				agentDir,
				create: children.create,
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
	role = "worker",
) {
	const result = await spawn(
		extension.tool,
		{ role, task },
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

test("with ten working children, spawn_child and continue_child are refused before Jev and before a session is created", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const jev = fakeJev();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			branch: [userEntry("request", "Fix the parser")],
		});
		const done = await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("First answer.");
		await settle();
		for (let i = 0; i < 10; i++) await spawnBackground(extension, worktree);
		await settle();
		const created = children.created.length;
		const jevRequests = jev.requests.length;

		const spawned = await spawn(
			extension.tool,
			{ role: "worker", task: "One more" },
			toolContext("tui", worktree, jev),
		);
		const continued = await use(
			extension,
			"continue_child",
			{ id: done, task: "Now add a test" },
			toolContext("tui", worktree, jev),
		);

		for (const [result, warning] of [
			[spawned, /Launch refused\. No child was launched\./],
			[continued, /Continue refused\. No child was launched\./],
		]) {
			assert.equal(result.details.status, "refused");
			assert.match(text(result), warning);
			assert.match(result.details.reason, /10 working children/);
		}
		assert.equal(children.created.length, created);
		assert.equal(jev.requests.length, jevRequests);

		children.created[1].result.resolve("Done.");
		await settle();
		const freed = await spawn(
			extension.tool,
			{ role: "worker", task: "One more" },
			toolContext("tui", worktree, jev),
		);
		assert.equal(freed.details.status, "queued");
		assert.equal(jev.requests.length, jevRequests + 1);
	});
});

test("a script that launches twelve children at once gets ten launches and two refusals, and returns without awaiting them", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ onCreate: () => delay(5) });
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		const results = await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				extension.tool.execute(
					`script/${i + 1}`,
					{ role: "worker", task: `Task ${i}` },
					undefined,
					undefined,
					toolContext("tui", worktree),
				),
			),
		);

		const statuses = results.map((result) => result.details.status);
		assert.equal(statuses.filter((status) => status === "queued").length, 10);
		assert.equal(statuses.filter((status) => status === "refused").length, 2);
		assert.equal(children.created.length, 10);
		await settle();
		assert.equal(
			children.created.filter((child) => child.tasks.length === 1).length,
			5,
		);
	});
});

test("print and json launches from a script run in the foreground outside the launch limit", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({
			onCreate: () => delay(5),
			run: async (task) => `${task} done.`,
		});
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});

		for (const mode of ["print", "json"]) {
			const results = await Promise.all(
				Array.from({ length: 12 }, (_, i) =>
					spawn(
						extension.tool,
						{ role: "worker", task: `Task ${i}` },
						toolContext(mode, worktree),
					),
				),
			);
			assert.deepEqual(
				results.map((result) => result.details.status),
				Array(12).fill("completed"),
			);
		}
		assert.equal(children.created.length, 24);
		assert.equal((await use(extension, "list_children", {})).details.children.length, 0);
	});
});

test("a pending launch from a script is no launched child and holds no place under the launch limit", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const mismatched = fakeChildren({ model: "other/model", onCreate: () => delay(5) });
		const children = fakeChildren({ onCreate: () => delay(5) });
		let pending = true;
		const extension = await loadSpawnTool({
			agentDir,
			create: (spec) =>
				pending ? mismatched.create(spec) : children.create(spec),
		});
		const script = () =>
			Promise.all(
				Array.from({ length: 10 }, (_, i) =>
					extension.tool.execute(
						`script/${i + 1}`,
						{ role: "worker", task: `Task ${i}` },
						undefined,
						undefined,
						toolContext("tui", worktree),
					),
				),
			);

		const held = await script();
		assert.deepEqual(
			held.map((result) => result.details.status),
			Array(10).fill("pending"),
		);
		assert.equal((await use(extension, "list_children", {})).details.children.length, 0);

		pending = false;
		const launched = await script();
		assert.deepEqual(
			launched.map((result) => result.details.status),
			Array(10).fill("queued"),
		);
	});
});

test("list_children, child_status, and child_result report the children of this session", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		assert.match(
			text(await use(extension, "list_children", {})),
			/No children/,
		);

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
		assert.equal(
			text(result),
			`Child ${done} completed. Verdict: absent.\n\nAll tests pass.`,
		);
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
	});
});

test("session shutdown forgets the children of the session", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren({ run: async () => "Done." });
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
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

test("cancel_child and the children view leave a running child in the same cancelled state; only the view delivers it", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const byModel = await spawnBackground(extension, worktree);
		const byOperator = await spawnBackground(extension, worktree);
		await settle();

		const result = await use(extension, "cancel_child", { id: byModel });
		assert.equal(text(result), `Child ${byModel} cancelled.`);
		assert.deepEqual(result.details, { id: byModel, state: "cancelled" });
		assert.equal(children.created[0].disposals, 1);
		assert.equal(extension.messages.length, 0);

		const view = openChildren(extension);
		view.press("s", "y");
		await settle();
		assert.match(view.lines().join("\n"), /worker [0-9a-f]{4} cancelled\./);
		assert.equal(children.created[1].disposals, 1);
		assert.equal(extension.messages.length, 1);
		assert.deepEqual(stateOfDetails(extension.messages[0].message.details), {
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

		assert.equal(await stateOf(extension, id), "completed");
		assert.equal(extension.messages.length, 0);
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
			schedule: clock.schedule,
		});
		const ids = [];
		for (let i = 0; i < 6; i++)
			ids.push(await spawnBackground(extension, worktree));
		await settle();
		assert.deepEqual(clock.pending(), Array(5).fill(minutes(4)));

		const [first] = children.created;
		const emit = (event) => first.spec.onEvent(event);
		emit({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "text_delta" },
		});
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
		assert.deepEqual(stateOfDetails(extension.messages[0].message.details), {
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
		assert.equal(extension.messages.length, 2);
		assert.deepEqual(
			extension.messages[1].message.details.results.map(stateOfDetails),
			ids.slice(1).map((id) => ({ id, state: "timed out" })),
		);
		assert.match(
			extension.messages[1].message.content,
			/no activity for 4 minutes/,
		);

		for (const child of children.created) child.result.resolve("Late result.");
		emit({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "text_delta" },
		});
		await settle();
		assert.equal(extension.messages.length, 2);
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
		assert.deepEqual(traceStates(extension.entries), ["running", "timed out"]);
	});
});

test("continue_child starts a new queued child from a completed child's conversation, and the completed record stays completed", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const jev = fakeJev();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
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
			toolContext("tui", worktree, jev),
		);

		const next = result.details.id;
		assert.equal(result.details.status, "queued");
		assert.match(next, uuid);
		assert.notEqual(next, done);
		assert.match(text(result), new RegExp(`${next} is queued`));
		assert.doesNotMatch(text(result), /Jev selected/);
		assert.equal("jev" in result.details, false);
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
			toolContext("tui", worktree, jev),
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

test("continue_child refuses an unknown child without reading the shell settings", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		let reads = 0;

		const result = await use(
			extension,
			"continue_child",
			{ id: "nope", task: "Try again" },
			{
				...toolContext("tui", worktree),
				isProjectTrusted: () => {
					reads += 1;
					return false;
				},
			},
		);

		assert.equal(result.details.status, "refused");
		assert.match(text(result), /No child nope in this session/);
		assert.equal(reads, 0);
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
		assert.equal(message.details.id, id);
		assert.equal(message.details.state, "waiting");
		assert.equal(message.details.question, 1);
		assert.equal(message.details.text, "Which file holds the parser?");
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

		await assert.rejects(
			use(extension, "reply_child", { id, question: 1, answer: "x" }),
			{
				message: `Question 1 of child ${id} was already answered by the parent: src/parser.ts`,
			},
		);
		await assert.rejects(
			use(extension, "reply_child", { id: "nope", question: 1, answer: "x" }),
			{ message: "No child nope in this session." },
		);
	});
});

const offeredTools = ["spawn_child", ...childTools];

function offers(extension) {
	return Object.fromEntries(
		offeredTools.map((name) => [
			name,
			extension.tools.findLast((tool) => tool.name === name).exposure,
		]),
	);
}

function offersWith(exposure, replyExposure = exposure) {
	return Object.fromEntries(
		offeredTools.map((name) => [
			name,
			name === "reply_child" ? replyExposure : exposure,
		]),
	);
}

test("while a child waits, reply_child is offered and accepts the answer with child session unseated, and is hidden again once no child waits", async (t) => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const seated = Object.fromEntries(
			capabilities.map((capability) => [capability, true]),
		);
		t.after(() =>
			replaceSelection({
				schemaVersion: 1,
				capabilities: seated,
				expectations: {},
			}),
		);
		replaceSelection({
			schemaVersion: 1,
			capabilities: { ...seated, "child-session": false },
			expectations: {},
		});
		await extension.fire("session_start");
		assert.deepEqual(offers(extension), offersWith("hidden"));

		const asked = children.created[0].spec.ask("Which file?");
		assert.deepEqual(offers(extension), offersWith("hidden", "direct"));
		await assert.rejects(
			use(extension, "reply_child", { id, question: 2, answer: "a.ts" }),
			{ message: `Question 2 of child ${id} is not waiting for a reply.` },
		);
		const reply = await use(extension, "reply_child", {
			id,
			question: 1,
			answer: "a.ts",
		});

		assert.equal(text(reply), `Reply sent to child ${id}.`);
		assert.equal(await asked, "a.ts");
		assert.deepEqual(offers(extension), offersWith("hidden"));
	});
});

test("with the legacy spawn package detected after the first offer, a child waiting or no longer waiting changes no child tool's offer", async (t) => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const registrations = () =>
			extension.tools.filter((tool) => offeredTools.includes(tool.name)).length;
		const registered = registrations();
		const seated = Object.fromEntries(
			capabilities.map((capability) => [capability, true]),
		);
		t.after(() =>
			replaceSelection({
				schemaVersion: 1,
				capabilities: seated,
				expectations: {},
			}),
		);
		extension.installLegacy();
		replaceSelection({
			schemaVersion: 1,
			capabilities: { ...seated, "child-session": false },
			expectations: {},
		});
		await extension.fire("session_start");

		const asked = children.created[0].spec.ask("Which file?");
		assert.equal(registrations(), registered);
		await use(extension, "reply_child", { id, question: 1, answer: "a.ts" });
		assert.equal(await asked, "a.ts");

		assert.equal(registrations(), registered);
		assert.deepEqual(offers(extension), offersWith("direct"));
	});
});

test("reply_child paints the answer card with compact rendering on and off, paints a refusal as a rejected card with its reason in both modes, and the plain answer card only on delivery", async (t) => {
	initTheme("dark", false);
	const extension = await loadSpawnTool({ agentDir: tmpdir() });
	const tool = extension.named("reply_child");
	const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
	const args = { id: "5636a1b2-0000", question: 3, answer: "src/parser.ts" };
	const lines = (component) =>
		component.render(60).map((line) => stripVTControlCharacters(line).trimEnd());
	const seated = Object.fromEntries(
		capabilities.map((capability) => [capability, true]),
	);
	t.after(() =>
		replaceSelection({ schemaVersion: 1, capabilities: seated, expectations: {} }),
	);
	const cards = [];
	for (const compact of [true, false]) {
		replaceSelection({
			schemaVersion: 1,
			capabilities: { ...seated, "compact-rendering": compact },
			expectations: {},
		});
		const renderers = compactToolRenderers("reply_child", () => tool);
		assert.deepEqual(lines(renderers.renderCall(args, theme, {})), []);
		cards.push(
			lines(
				renderers.renderResult(
					{ content: [{ type: "text", text: "sent" }], details: {} },
					{},
					theme,
					{ args, isError: false },
				),
			),
		);
	}
	assert.deepEqual(cards[0], cards[1]);
	assert.deepEqual(cards[0], [
		"   ◆ Parent → 5636 · answer 3",
		"     src/parser.ts",
	]);
	const refusal = await use(extension, "reply_child", {
		id: "nope",
		question: 1,
		answer: "x",
	}).then(
		() => assert.fail("the reply was accepted"),
		(error) => error.message,
	);
	const reasons = [
		refusal,
		`Child ${args.id} is completed; question 3 can no longer be answered.`,
	];
	for (const compact of [true, false]) {
		replaceSelection({
			schemaVersion: 1,
			capabilities: { ...seated, "compact-rendering": compact },
			expectations: {},
		});
		const renderers = compactToolRenderers("reply_child", () => tool);
		for (const reason of reasons) {
			const refused = renderers.renderResult(
				{ content: [{ type: "text", text: reason }], details: {}, isError: true },
				{},
				theme,
				{ args, isError: true },
			);
			assert.equal(lines(refused)[0], "   ◆ Parent → 5636 · answer 3 rejected");
			assert.ok(refused.render(200)[0].includes(theme.fg("error", "◆")));
			assert.ok(
				refused.render(200)[1].includes(theme.fg("error", reason)),
			);
		}
	}
	replaceSelection({
		schemaVersion: 1,
		capabilities: { ...seated, "child-session": false },
		expectations: {},
	});
	const renderers = compactToolRenderers("reply_child", () => tool);
	const unseated = renderers.renderResult(
		{ content: [{ type: "text", text: refusal }], details: {}, isError: true },
		{},
		theme,
		{ args, isError: true },
	);
	const [head, body] = unseated.render(200);
	assert.ok(head.includes(theme.fg("error", "◆")));
	assert.ok(head.includes(theme.fg("error", "· answer 3 rejected")));
	assert.ok(body.includes(theme.fg("error", refusal)));
});

test("reply_child falls back to a plain-text answer when the child-session card is not seated", async (t) => {
	initTheme("dark", false);
	const extension = await loadSpawnTool({ agentDir: tmpdir() });
	const tool = extension.named("reply_child");
	const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];
	const args = { id: "5636a1b2-0000", question: 3, answer: "src/\u001b[31mparser.ts" };
	const seated = Object.fromEntries(
		capabilities.map((capability) => [capability, true]),
	);
	t.after(() =>
		replaceSelection({ schemaVersion: 1, capabilities: seated, expectations: {} }),
	);
	replaceSelection({
		schemaVersion: 1,
		capabilities: { ...seated, "child-session": false },
		expectations: {},
	});
	const component = tool.renderResult(
		{ content: [{ type: "text", text: "sent" }], details: {} },
		{},
		theme,
		{ args, isError: false },
	);
	assert.deepEqual(
		component
			.render(60)
			.map((line) => stripVTControlCharacters(line).trimEnd())
			.filter(Boolean),
		["Parent → 5636 · answer 3", "src/ [31mparser.ts"],
	);
});

test("the ask_parent description tells the child to ask only when blocked and not to ask about reserved commands", () => {
	const { description } = createAskParentTool(async () => "answer");
	assert.match(
		description,
		/only when you are blocked and the answer changes your next step/,
	);
	assert.match(
		description,
		/a command reserved for the parent is not a reason to ask/,
	);
});

test("a repeated reply to an answered question never answers the child's next question", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
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

		await assert.rejects(
			use(extension, "reply_child", {
				id,
				question: 1,
				answer: "Yes, delete it.",
			}),
			{
				message: `Question 1 of child ${id} was already answered by the parent: Yes, delete it.`,
			},
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
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const asked = outcome(children.created[0].spec.ask("Which file?"));
		await use(extension, "cancel_child", { id });
		assert.equal(await asked(), "The child was cancelled.");

		await assert.rejects(
			use(extension, "reply_child", { id, question: 1, answer: "src/a.ts" }),
			{
				message: `Child ${id} is cancelled; question 1 can no longer be answered.`,
			},
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
		assert.deepEqual(
			stateOfDetails(child.extension.messages[0].message.details),
			{
				id,
				state: "timed out",
			},
		);
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
				/completed\. Verdict: absent\.\n\nSecond answer\./,
			);
			assert.deepEqual(stateOfDetails(extension.messages[1].message.details), {
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
			/completed\. Verdict: absent\.\n\nFixed src\/parser\.ts\./,
		);
		assert.ok(sent(parent.requests[1]).includes("src/parser.ts"));
		assert.equal(await stateOf(extension, id), "completed");
		assert.deepEqual(unhandled, []);
	});
});

test("a question asked from a script that times out through Pi's SDK is withdrawn, the child runs again, and a later reply is refused as withdrawn", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			fauxAssistantMessage(
				fauxToolCall("codemode", {
					code: '// @options: {"timeout_ms": 300}\nreturn await tools.ask_parent({ question: "Which file?" });',
				}),
				{ stopReason: "toolUse" },
			),
			asking("Which module?"),
			fauxAssistantMessage("Done."),
		]);
		const { extension } = child;
		let id;
		const unhandled = await collectUnhandled(async () => {
			id = (await spawnReal(child, worktree)).details.id;
			await eventually(() => extension.messages.length === 1);
			assert.equal(await stateOf(extension, id), "waiting");
			await eventually(() => extension.messages.length === 2);
			assert.equal(extension.messages[1].message.details.question, 2);

			await assert.rejects(
				use(extension, "reply_child", { id, question: 1, answer: "src/a.ts" }),
				{
					message: `Question 1 of child ${id} was withdrawn: the call that asked it ended.`,
				},
			);
			assert.equal(await stateOf(extension, id), "waiting");
			await use(extension, "reply_child", { id, question: 2, answer: "parser" });
			await eventually(() => extension.messages.length === 3);
		});

		assert.equal(await stateOf(extension, id), "completed");
		assert.deepEqual(unhandled, []);
	});
});

function reporting(result) {
	return fauxAssistantMessage(fauxToolCall("report_result", result), {
		stopReason: "toolUse",
	});
}

test("a worker reports through Pi's SDK; a result outside its role's schema is refused and the last valid call is delivered", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			reporting({ ...workerResult("done"), verdict: "pass" }),
			reporting(workerResult("partial", "The migration is pending.")),
			fauxAssistantMessage("Fixed src/parser.ts."),
		]);
		const { extension, parent } = child;
		await spawnReal(child, worktree);
		await eventually(() => extension.messages.length === 1);

		const refused = parent.requests[1].messages.at(-1);
		assert.equal(refused.toolName, "report_result");
		assert.equal(refused.isError, true);
		const { message } = extension.messages[0];
		assert.equal(message.details.verdict, "partial");
		assert.equal(message.details.result.reason, "The migration is pending.");
		assert.equal(message.details.text, "Fixed src/parser.ts.");
	});
});

test("a worker result through Pi's SDK with a property outside its role's schema is refused and the last valid call is delivered", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			reporting({ ...workerResult("done"), summary: "Finished" }),
			reporting(workerResult("partial", "The migration is pending.")),
			fauxAssistantMessage("Fixed src/parser.ts."),
		]);
		const { extension, parent } = child;
		await spawnReal(child, worktree);
		await eventually(() => extension.messages.length === 1);

		const refused = parent.requests[1].messages.at(-1);
		assert.equal(refused.toolName, "report_result");
		assert.equal(refused.isError, true);
		const { message } = extension.messages[0];
		assert.deepEqual(
			message.details.result,
			workerResult("partial", "The migration is pending."),
		);
		assert.match(message.content, /Verdict: partial\./);
	});
});

test("a worker through Pi's SDK reports done without a reason, and a blocked result without a reason is refused", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { reason: _reason, ...blocked } = workerResult("blocked");
		const { reason: _done, ...done } = workerResult("done");
		const child = await realChild(agentDir, [
			reporting(blocked),
			reporting(done),
			fauxAssistantMessage("Fixed src/parser.ts."),
		]);
		const { extension, parent } = child;
		await spawnReal(child, worktree);
		await eventually(() => extension.messages.length === 1);

		const refused = parent.requests[1].messages.at(-1);
		assert.equal(refused.toolName, "report_result");
		assert.equal(refused.isError, true);
		assert.match(refused.content[0].text, /reason/);
		const { message } = extension.messages[0];
		assert.equal(message.details.verdict, "done");
		assert.equal(message.details.result.reason, undefined);
		assert.doesNotMatch(message.content, /Reason:/);
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
		assert.deepEqual(stateOfDetails(extension.messages[1].message.details), {
			id,
			state: "timed out",
		});
		assert.match(
			extension.messages[1].message.content,
			/ask_parent ran for 30 minutes/,
		);
		await assert.rejects(
			use(extension, "reply_child", { id, question: 1, answer: "src/a.ts" }),
			{
				message: `Child ${id} is timed out; question 1 can no longer be answered.`,
			},
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
		children.created[0].result.reject(new Error("Failed in the gap."));
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

function holdPreparation(runtime) {
	const preparing = Promise.withResolvers();
	const release = Promise.withResolvers();
	const checkAuth = runtime.checkAuth.bind(runtime);
	runtime.hasConfiguredAuth = () => false;
	runtime.checkAuth = async (...args) => {
		preparing.resolve();
		await release.promise;
		return checkAuth(...args);
	};
	return { preparing: preparing.promise, release: release.resolve };
}

test("a foreground child held in preparation through Pi's SDK times out without waiting for its run, and never sends a request", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(
			agentDir,
			fauxAssistantMessage("Late answer."),
		);
		const hold = holdPreparation(child.parent.runtime);
		const unhandled = await collectUnhandled(async () => {
			const call = spawnReal(child, worktree, "print");
			await hold.preparing;
			child.clock.fire(minutes(4));

			assert.equal(
				await settledNow(call),
				"The child timed out: no activity for 4 minutes.",
			);

			hold.release();
			await delay(50);
		});

		assert.equal(child.parent.requests.length, 0);
		assert.equal(child.extension.messages.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("aborting a foreground call through Pi's SDK while the child is held in preparation returns at once, and never sends a request", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(
			agentDir,
			fauxAssistantMessage("Late answer."),
		);
		const hold = holdPreparation(child.parent.runtime);
		const call = new AbortController();
		const unhandled = await collectUnhandled(async () => {
			const result = spawn(
				child.extension.tool,
				{ role: "worker", task: "Fix the failing test" },
				{ ...toolContext("print", worktree), ...child.parent.context },
				call.signal,
			);
			await hold.preparing;
			call.abort();

			assert.equal(
				await settledNow(result),
				"The call was aborted and the child was stopped.",
			);

			hold.release();
			await delay(50);
		});

		assert.equal(child.parent.requests.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("a foreground child whose run rejects only after the timeout has already failed the call as timed out", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: clock.schedule,
		});
		const unhandled = await collectUnhandled(async () => {
			const call = spawn(
				extension.tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("print", worktree),
			);
			await eventually(() => children.created[0]?.tasks.length === 1);
			clock.fire(minutes(4));

			assert.equal(
				await settledNow(call),
				"The child timed out: no activity for 4 minutes.",
			);
			assert.equal(children.created[0].disposals, 1);

			children.created[0].result.reject(new Error("Request was aborted"));
			await settle();
		});

		assert.equal(extension.messages.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

test("aborting a foreground call's signal after the call has ended does nothing more to its child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: clock.schedule,
		});
		const unhandled = await collectUnhandled(async () => {
			const completed = new AbortController();
			const done = spawn(
				extension.tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("print", worktree),
				completed.signal,
			);
			await eventually(() => children.created[0]?.tasks.length === 1);
			children.created[0].result.resolve("All tests pass.");
			assert.match(text(await done), /All tests pass\./);
			completed.abort();

			const timedOut = new AbortController();
			const late = spawn(
				extension.tool,
				{ role: "worker", task: "Fix the failing test" },
				toolContext("print", worktree),
				timedOut.signal,
			);
			await eventually(() => children.created[1]?.tasks.length === 1);
			clock.fire(minutes(4));
			assert.equal(
				await settledNow(late),
				"The child timed out: no activity for 4 minutes.",
			);
			children.created[1].result.resolve("Too late.");
			timedOut.abort();
			await settle();
		});

		assert.deepEqual(
			children.created.map(({ aborts, disposals }) => ({ aborts, disposals })),
			[
				{ aborts: 0, disposals: 1 },
				{ aborts: 1, disposals: 1 },
			],
		);
		assert.equal(extension.messages.length, 0);
		assert.deepEqual(unhandled, []);
	});
});

const boxKey = "pi-workflow-above-input";

const plainTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => `\x1b[7m${text}\x1b[27m`,
	bold: (text) => text,
	italic: (text) => text,
};

const viewKeys = new KeybindingsManager({
	...TUI_KEYBINDINGS,
	"app.thinking.toggle": {
		defaultKeys: "ctrl+t",
		description: "Toggle thinking",
	},
});

const plain = (line) => stripVTControlCharacters(line);

function boxOf(extension, tui = { requestRender() {} }) {
	return extension.widgets.get(boxKey).factory(tui, plainTheme);
}

function openChildren(extension, { rows = 20, via = "shortcut" } = {}) {
	const ctx = { mode: "tui", hasUI: true, ui: extension.ui };
	const opened =
		via === "shortcut"
			? extension.shortcuts.get("alt+a").handler(ctx)
			: extension.command("workflow:subagents");
	const view = extension.views.at(-1);
	const tui = {
		renders: 0,
		requestRender() {
			this.renders += 1;
		},
		terminal: { rows, columns: 100 },
	};
	let closed = false;
	const component = view.factory(tui, plainTheme, viewKeys, () => {
		closed = true;
		view.resolve();
	});
	for (let i = 0; i < 20; i++) component.handleInput("k");
	return {
		opened,
		view,
		tui,
		component,
		closed: () => closed,
		press: (...keys) => {
			for (const key of keys) component.handleInput(key);
		},
		lines: (width = 100) => component.render(width).map(plain),
		active: (width = 100) =>
			component.render(width).findIndex((line) => line.includes("\x1b[7m")),
	};
}

const todoBranch = [
	{
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todo",
			isError: false,
			details: { tasks: [{ id: 1, text: "Review the doctor", done: false }] },
		},
	},
];

test("a background child shows in the subagent box pinned above the input and above the task box, with its live step", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			branch: todoBranch,
		});
		assert.deepEqual(
			[...extension.widgets.keys()],
			[boxKey, "pi-workflow-status"],
		);
		assert.equal(
			extension.widgets.get(boxKey).options.placement,
			"aboveEditor",
		);
		const box = boxOf(extension);
		assert.deepEqual(box.render(100).map(plain), [
			"",
			"┌                                                                                                  ×",
			"│ □ Review the doctor                                                                              │",
			"└                                                                                                  ┘",
			"",
		]);

		const id = await spawnBackground(extension, worktree);
		await settle();
		const lines = box.render(100).map(plain);
		assert.match(lines[0], /▾ Subagents 1 +alt\+a view/);
		assert.match(
			lines[1],
			/[⠋⠙⠹⠸⠼⠴⠦⠧] worker [0-9a-f]{4} Fix the failing test +model \(medium\) \d+s$/,
		);
		const task = lines.findIndex((line) => line.includes("□ Review the doctor"));
		assert.ok(task > 1);

		children.created[0].spec.onEvent({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
			args: { command: "npm test\n--watch" },
		});
		assert.match(
			plain(box.render(100)[1]),
			/[⠋⠙⠹⠸⠼⠴⠦⠧] worker [0-9a-f]{4} bash npm test +model/,
		);
		const [record] = (await use(extension, "list_children", {})).details
			.children;
		assert.equal(record.step, "bash npm test");

		children.created[0].spec.onEvent({
			type: "tool_execution_end",
			toolCallId: "t1",
			toolName: "bash",
			result: {},
			isError: false,
		});
		assert.match(
			plain(box.render(100)[1]),
			/[⠋⠙⠹⠸⠼⠴⠦⠧] worker [0-9a-f]{4} Fix the failing test/,
		);
		assert.equal(await stateOf(extension, id), "running");
	});
});

test("with child session unseated, a task that arrives mid-session shows in the one widget above the status row", async (t) => {
	await withWorkspace(async ({ agentDir }) => {
		const extension = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		const seated = Object.fromEntries(
			capabilities.map((capability) => [capability, true]),
		);
		replaceSelection({
			schemaVersion: 1,
			capabilities: { ...seated, "child-session": false },
			expectations: {},
		});
		t.after(() =>
			replaceSelection({
				schemaVersion: 1,
				capabilities: seated,
				expectations: {},
			}),
		);
		const box = boxOf(extension);
		assert.deepEqual(box.render(100), []);

		await use(extension, "todo", { action: "add", text: "Arrive late" });

		assert.deepEqual(
			[...extension.widgets.keys()],
			[boxKey, "pi-workflow-status"],
		);
		assert.ok(box.render(100).some((line) => plain(line).includes("Arrive late")));
	});
});

test("the header's working-children count follows a child's state while the parent stays idle", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const tui = { renders: 0, requestRender: () => (tui.renders += 1) };
		const header = extension.headers.main(tui, plainTheme);
		const working = () => plain(header.render(80)[0]).match(/◆ (\d+)/)?.[1];
		assert.equal(working(), undefined);

		const before = tui.renders;
		await spawnBackground(extension, worktree);
		await settle();
		assert.ok(tui.renders > before);
		assert.equal(working(), "1");

		const afterStart = tui.renders;
		children.created[0].result.resolve("All tests pass.");
		await eventually(() => working() === undefined);
		assert.ok(tui.renders > afterStart);
	});
});

test("the box refreshes at once on a state change, groups redraws within 400 ms, ticks each second only while a child works, spins every 133 ms only while one runs, drops finished rows at 60 s with one timer, and schedules nothing when idle or after shutdown", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			refresh: clock.schedule,
		});
		const tui = { renders: 0, requestRender: () => (tui.renders += 1) };
		const box = boxOf(extension, tui);
		const uiTimers = () => clock.pending().sort((a, b) => a - b);
		assert.deepEqual(uiTimers(), []);

		await spawnBackground(extension, worktree);
		assert.equal(tui.renders, 1);
		await settle();
		for (const toolName of ["read", "bash", "edit"]) {
			children.created[0].spec.onEvent({
				type: "tool_execution_start",
				toolCallId: toolName,
				toolName,
				args: {},
			});
		}
		assert.equal(tui.renders, 1);
		clock.fire(400);
		assert.equal(tui.renders, 2);
		clock.fire(400);
		assert.equal(tui.renders, 2);
		assert.deepEqual(uiTimers(), [133, 1000]);
		clock.fire(133);
		clock.fire(133);
		assert.equal(tui.renders, 4);
		assert.deepEqual(uiTimers(), [133, 1000]);

		clock.fire(1000);
		assert.equal(tui.renders, 5);
		assert.deepEqual(uiTimers(), [133, 400, 1000]);
		clock.fire(400);

		children.created[0].result.resolve("Done.");
		await settle();
		assert.equal(tui.renders, 6);
		assert.ok(!uiTimers().includes(133));
		clock.fire(400);
		clock.fire(1000);
		clock.fire(400);
		assert.deepEqual(uiTimers(), [60_000]);
		assert.match(plain(box.render(100)[1]), /✓ worker/);
		t.mock.timers.tick(60_000);
		const expired = tui.renders;
		clock.fire(60_000);
		clock.fire(400);
		assert.equal(tui.renders, expired + 1);
		assert.deepEqual(box.render(100), []);
		assert.deepEqual(uiTimers(), []);
		const idle = tui.renders;

		await spawnBackground(extension, worktree);
		await settle();
		assert.ok(uiTimers().includes(1000));
		assert.ok(uiTimers().includes(133));
		await extension.fire("session_shutdown", { reason: "quit" });
		assert.deepEqual(uiTimers(), []);
		assert.equal(tui.renders, idle + 1);
	});
});

test("each TUI session start installs the box again, and print mode installs no box", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const extension = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		await extension.fire("session_shutdown", { reason: "new" });
		extension.widgets.clear();
		await extension.fire("session_start");
		assert.ok(extension.widgets.has(boxKey));

		const printed = loadExtension({
			agentDir,
			create: fakeChildren().create,
		});
		await printed.fire("session_start", {}, "print");
		assert.equal(printed.widgets.has(boxKey), false);
	});
});

test("the empty subagents modal is sized to its content instead of filling the terminal", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const extension = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		const lines = openChildren(extension, { rows: 40 }).lines();
		assert.equal(lines.length, 8);
		assert.match(lines[0], /^ ┌─ Fleet 0 ─+ \[×\] ─┐$/);
		assert.match(lines[1], /No children in this session\./);
		assert.match(lines.at(-1), /^ └─+┘$/);
	});
});

test("alt+a and /workflow:subagents open a full-screen overlay of every child; j/k move the highlighted row and q or Esc close it", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree, "Map the launcher");
		await spawnBackground(extension, worktree, "Run the tests");
		await settle();
		children.created[0].result.resolve("Done.");
		await settle();

		const view = openChildren(extension, { rows: 12 });
		assert.equal(view.view.options.overlay, true);
		assert.equal(view.view.options.overlayOptions.width, "100%");
		assert.equal(view.view.options.overlayOptions.maxHeight, "100%");
		const lines = view.lines();
		assert.equal(lines.length, 12);
		assert.match(lines[0], /^ ┌─ Fleet 2 · 1 active ─+ \[×\] ─┐$/);
		assert.match(
			lines[1],
			/^ │ {3}Active ─+ │ ◐ worker [0-9a-f]{4} +running · \d+s {2}│$/,
		);
		assert.match(
			lines[2],
			/^ │ {2}▸ ◐ worker [0-9a-f]{4} +running · \d+s │ model \(medium\) · wt: repo/,
		);
		assert.match(lines[3], /^ │ {3}Finished ─+ │ Run the tests/);
		assert.match(lines[4], /^ │ {4}✓ worker [0-9a-f]{4} Map the.* \d+s │/);
		assert.match(
			view.lines(60).at(-2),
			/j\/k move {2}\| {2}Enter detail {2}\| {2}s\/c cancel {2}\| {2}q close/,
		);
		assert.match(lines.at(-1), /^ └─+┘$/);
		for (const width of [10, 40, 80, 160]) {
			for (const line of view.component.render(width)) {
				assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
			}
		}
		assert.equal(view.active(), 2);
		view.press("j");
		assert.equal(view.active(), 4);
		view.press("j");
		assert.equal(view.active(), 4);
		view.press("k");
		assert.equal(view.active(), 2);
		view.press("q");
		assert.equal(view.closed(), true);
		await view.opened;

		const byCommand = openChildren(extension, { via: "command" });
		assert.match(byCommand.lines()[0], /Fleet 2/);
		byCommand.press("\x1b");
		assert.equal(byCommand.closed(), true);

		await extension.command("workflow:subagents", "extra");
		assert.match(extension.notifications.at(-1).message, /Usage:/);
		const views = extension.views.length;
		await extension.command("workflow:subagents", "", "rpc");
		assert.equal(extension.views.length, views);
		assert.equal(extension.notifications.at(-1).level, "error");
		assert.equal(extension.commands.has("pi-workflow-child-cancel"), false);
		assert.doesNotMatch(extension.notifications.at(-2).message, /child-cancel/);
	});
});

test("the Fleet view keeps a child running after agent_end while Pi retries automatically, and shows it completed once Pi settles", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const parent = await fauxParent(agentDir, [
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "overloaded_error: Overloaded",
			}),
			fauxAssistantMessage("Retried answer."),
		]);
		const extension = await loadSpawnTool({ agentDir });
		const result = await spawn(
			extension.tool,
			{ role: "worker", task: "Fix the failing test" },
			{ ...toolContext("tui", worktree), ...parent.context },
		);
		const { id } = result.details;
		await eventually(() => parent.requests.length === 1);
		await delay(300);
		assert.equal(parent.requests.length, 1);
		assert.equal(await stateOf(extension, id), "running");
		const view = openChildren(extension, { rows: 20 });
		assert.match(view.lines().join("\n"), /◐ worker [0-9a-f]{4} +running/);

		await eventually(() => view.lines().join("\n").includes("completed"));
		assert.equal(parent.requests.length, 2);
		assert.equal(await stateOf(extension, id), "completed");
		assert.match(view.lines().join("\n"), /✓ worker [0-9a-f]{4} +completed/);
	});
});

test("in the view, s or c asks y/n before cancelling a running child, cancels a queued child at once, and refuses a finished child", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const ids = [];
		for (let i = 0; i < 6; i++)
			ids.push(await spawnBackground(extension, worktree));
		await settle();
		const view = openChildren(extension);

		view.press("s");
		assert.match(view.lines().join("\n"), /Cancel worker [0-9a-f]{4}\? y\/n/);
		assert.match(view.lines().at(-2), /y yes {2}\| {2}n no/);
		view.press("q", "n");
		assert.equal(view.closed(), false);
		assert.equal(await stateOf(extension, ids[0]), "running");
		assert.doesNotMatch(view.lines().join("\n"), /Cancel worker/);

		view.press("c", "y");
		assert.equal(await stateOf(extension, ids[0]), "cancelled");
		assert.deepEqual(
			stateOfDetails(extension.messages.at(-1).message.details),
			{
				id: ids[0],
				state: "cancelled",
			},
		);
		await settle();
		assert.equal(await stateOf(extension, ids[5]), "running");

		const more = await spawnBackground(extension, worktree);
		await settle();
		assert.equal(await stateOf(extension, more), "queued");
		view.press("k", "k", "k", "k", "k", "k", "j", "j", "j", "j", "j", "c");
		assert.equal(await stateOf(extension, more), "cancelled");
		assert.doesNotMatch(view.lines().join("\n"), /y\/n/);

		const delivered = extension.messages.length;
		view.press("k", "s");
		assert.match(
			view.lines().join("\n"),
			/already ended; it cannot be cancelled/,
		);
		assert.equal(await stateOf(extension, ids[0]), "cancelled");
		assert.equal(extension.messages.length, delivered);
	});
});

function assistantEntry(id, content) {
	return {
		type: "message",
		id,
		message: {
			role: "assistant",
			content,
			api: "faux",
			provider: "faux",
			model: "faux",
			stopReason: "toolUse",
			usage: {},
			timestamp: 0,
		},
	};
}

test("Enter opens a live detail that follows the tail, collapses thinking with Pi's toggle, cancels after y/n, and Esc goes back while q closes", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const id = await spawnBackground(extension, worktree, "Review the doctor");
		await settle();
		const child = children.created[0];
		child.entries = [
			userEntry("u1", "Review the doctor"),
			assistantEntry("a1", [
				{
					type: "thinking",
					thinking: "I should read the doctor module first.",
				},
				{ type: "text", text: "The doctor checks three things." },
				{
					type: "toolCall",
					id: "t1",
					name: "bash",
					arguments: { command: "npm test" },
				},
			]),
		];
		const view = openChildren(extension, { rows: 40 });
		view.press("\r");
		let lines = view.lines(60);
		let body = lines.join("\n");
		assert.match(lines[0], /^ ┌─ Fleet 1 · 1 active ─+ \[×\] ─┐$/);
		assert.match(lines[1], /^ │ {2}◐ worker [0-9a-f]{4} +running · \d+s {2}│$/);
		assert.match(body, /❯ Review the doctor/);
		assert.match(body, /I should read the doctor module first\./);
		assert.match(body, /The doctor checks three things\./);
		assert.match(body, /◆ Run npm test/);
		assert.match(body, /Esc back {2}\| {2}Enter steer {2}\| {2}Ctrl\+J\/K scroll/);
		assert.match(body, /s\/c cancel {2}\| {2}Ctrl\+T thinking/);

		const renders = view.tui.renders;
		child.spec.onEvent({
			type: "message_update",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Streaming the tail." }],
			},
			assistantMessageEvent: { type: "text_delta" },
		});
		assert.ok(view.tui.renders > renders);
		lines = view.lines(60);
		const threadLines = lines
			.slice(2, lines.findIndex((line) => /Esc back/.test(line)) - 2)
			.map((line) => line.slice(2, -1));
		assert.match(
			threadLines.findLast((line) => line.trim() !== ""),
			/Streaming the tail\./,
		);

		view.press("\x14");
		body = view.lines(60).join("\n");
		assert.doesNotMatch(body, /I should read the doctor module first/);
		assert.match(body, /◆ Thought/);
		view.press("\x14");
		assert.match(
			view.lines(60).join("\n"),
			/I should read the doctor module first/,
		);

		view.press("s");
		assert.match(view.lines(60).join("\n"), /Cancel worker [0-9a-f]{4}\? y\/n/);
		view.press("y");
		assert.equal(await stateOf(extension, id), "cancelled");
		lines = view.lines(60);
		assert.match(lines[1], /– worker [0-9a-f]{4} +cancelled · \d+s/);
		assert.match(lines.join("\n"), /The doctor checks three things\./);
		assert.match(lines.join("\n"), /◆ Run npm test/);
		assert.match(
			lines.join("\n"),
			/ Result ─+[\s\S]*The child was cancelled\./,
		);
		assert.doesNotMatch(lines.join("\n"), /Streaming the tail/);
		assert.doesNotMatch(lines.join("\n"), /s\/c cancel/);

		view.press("\x1b");
		assert.match(view.lines()[0], /Fleet 1/);
		assert.equal(view.closed(), false);
		view.press("\r", "q");
		assert.equal(view.closed(), true);
	});
});

test("a tall thread shows only its tail in the detail", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		children.created[0].entries = Array.from({ length: 30 }, (_, i) =>
			assistantEntry(`a${i}`, [{ type: "text", text: `Line ${i}.` }]),
		);
		const view = openChildren(extension, { rows: 10 });
		view.press("\r");
		const lines = view.lines();
		assert.equal(lines.length, 10);
		assert.match(lines.join("\n"), /Line 29\./);
		assert.doesNotMatch(lines.join("\n"), /Line 0\./);
	});
});

test("the children view never renders more lines than the terminal is tall", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree, "First");
		await settle();
		for (let rows = 4; rows <= 8; rows++) {
			const view = openChildren(extension, { rows });
			for (let width = 10; width <= 80; width++) {
				const lines = view.lines(width);
				assert.ok(lines.length <= rows, `${rows}x${width}: ${lines.length}`);
			}
			view.press("\r");
			for (let width = 10; width <= 80; width++) {
				const lines = view.lines(width);
				assert.ok(lines.length <= rows, `detail ${rows}x${width}: ${lines.length}`);
			}
		}
	});
});

test("in fullscreen a click selects a row, a double click opens it, and each footer label runs its key", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree, "First");
		await spawnBackground(extension, worktree, "Second");
		await settle();
		const view = openChildren(extension, { rows: 12 });
		const click = (x, y, clickCount = 1) =>
			view.component.handleMouse({
				type: "click",
				button: "left",
				x,
				y,
				clickCount,
			});

		view.lines(60);
		assert.deepEqual(click(5, 3), { handled: true });
		assert.equal(view.active(60), 3);
		click(5, 3, 2);
		let lines = view.lines(60);
		assert.match(lines[1], /◐ worker [0-9a-f]{4} +running · \d+s/);
		const at = lines.findIndex((line) => line.includes("Esc back"));
		click(lines[at].indexOf("Esc back") + 1, at);
		assert.match(view.lines(60)[1], /Active ─/);
		const footer = view.lines(60).at(-2);
		click(footer.indexOf("s/c cancel") + 1, 10);
		assert.match(view.lines(60).join("\n"), /Cancel worker [0-9a-f]{4}\? y\/n/);
		click(view.lines(60).at(-2).indexOf("n no") + 1, 10);
		assert.doesNotMatch(view.lines(60).join("\n"), /y\/n/);
		lines = view.lines(60);
		assert.equal(click(lines[0].indexOf("×"), 0).handled, true);
		assert.equal(view.closed(), true);
	});
});

class FakeTerminal {
	start(onInput) {
		this.onInput = onInput;
	}
	stop() {}
	async drainInput() {}
	write() {}
	get columns() {
		return 80;
	}
	get rows() {
		return 24;
	}
	get kittyProtocolActive() {
		return false;
	}
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
}

function overlayHost(tui) {
	return (factory, options) =>
		new Promise((resolve) => {
			let closed = false;
			const component = factory(tui, plainTheme, viewKeys, (result) => {
				if (closed) return;
				closed = true;
				tui.hideOverlay();
				resolve(result);
			});
			const handle = tui.showOverlay(component, options.overlayOptions);
			options.onHandle?.(handle);
		});
}

test("a dialog that takes focus while the children view is open closes the view, so the dialog stays visible and keeps the keys", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const extension = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		const terminal = new FakeTerminal();
		const tui = new TuiMainScreen(terminal);
		const keys = [];
		const component = (name) => ({
			render: () => [name],
			invalidate() {},
			handleInput: (data) => keys.push([name, data]),
		});
		const editor = component("editor");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		extension.ui.custom = overlayHost(tui);
		const opened = extension.shortcuts
			.get("alt+a")
			.handler({ mode: "tui", hasUI: true, ui: extension.ui });
		tui.renderNow();
		assert.equal(await settledNow(opened), "still pending");

		const panel = component("panel");
		tui.removeChild(editor);
		tui.addChild(panel);
		tui.setFocus(panel);
		tui.renderNow();
		assert.equal(await settledNow(opened), "resolved");
		terminal.onInput("\r");
		assert.deepEqual(keys, [["panel", "\r"]]);
		tui.stop();
	});
});

test("escape sequences in a child's tool arguments never reach the step, the rows, or the detail", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		const hostile = { command: "a\x1b[2Jb\x1b]52;c;eA==\x07c\u202ed" };
		const child = children.created[0];
		child.spec.onEvent({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
			args: hostile,
		});
		child.entries = [
			assistantEntry("a1", [
				{ type: "toolCall", id: "t1", name: "bash", arguments: hostile },
			]),
		];
		const [record] = (await use(extension, "list_children", {})).details
			.children;
		const view = openChildren(extension);
		const rows = view.component.render(100).join("\n");
		view.press("\r");
		const detail = view.component.render(100).join("\n");
		for (const text of [
			record.step,
			boxOf(extension).render(100).join(),
			rows,
			detail,
		]) {
			assert.equal(text.includes("\x1b[2J"), false);
			assert.equal(text.includes("\x1b]52"), false);
			assert.equal(text.includes("\u202e"), false);
		}
		assert.match(plain(detail), /◆ Run a \[2Jb \]52;c;eA== c d/);
	});
});

test("session shutdown closes an open children view and drops its listeners", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const view = openChildren(extension);
		view.press("\r");
		await extension.fire("session_shutdown", { reason: "new" });
		assert.equal(view.closed(), true);
		assert.equal(await settledNow(view.opened), "resolved");

		await extension.fire("session_start");
		const renders = view.tui.renders;
		await spawnBackground(extension, worktree);
		await settle();
		assert.equal(view.tui.renders, renders);
	});
});

test("the view lists waiting, running, queued, then finished children, and a click picks the row it shows", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const ids = [];
		for (let i = 0; i < 7; i++) {
			ids.push(await spawnBackground(extension, worktree, `Task ${i}`));
		}
		await settle();
		children.created[0].result.resolve("Done.");
		await settle();
		void children.created[4].spec.ask("Which branch?");
		const view = openChildren(extension, { rows: 14 });
		const order = view
			.lines(60)
			.filter((line) => /worker [0-9a-f]{4}/.test(line))
			.map((line) => line.match(/worker ([0-9a-f]{4})/)[1]);
		assert.deepEqual(
			order,
			[4, 1, 2, 3, 5, 6, 0].map((i) => ids[i].slice(0, 4)),
		);
		assert.equal(view.active(60), 2);
		assert.match(view.lines(60)[2], /\? worker [0-9a-f]{4} asks question 1/);
		assert.match(view.lines(60)[8], /Finished ─/);

		view.component.handleMouse({
			type: "click",
			button: "left",
			x: 5,
			y: 9,
			clickCount: 2,
		});
		assert.match(
			view.lines(60)[1],
			new RegExp(`✓ worker ${ids[0].slice(0, 4)} +completed · \\d+s`),
		);
	});
});

test("an overlay opened over the children view keeps its focus and closes normally, and the view still works afterwards", async () => {
	await withWorkspace(async ({ agentDir }) => {
		const extension = await loadSpawnTool({
			agentDir,
			create: fakeChildren().create,
		});
		const terminal = new FakeTerminal();
		const tui = new TuiMainScreen(terminal);
		const keys = [];
		const editor = {
			render: () => ["editor"],
			invalidate() {},
			handleInput: (data) => keys.push(["editor", data]),
		};
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		extension.ui.custom = overlayHost(tui);
		const opened = extension.shortcuts
			.get("alt+a")
			.handler({ mode: "tui", hasUI: true, ui: extension.ui });
		tui.renderNow();

		let closeOther;
		const other = overlayHost(tui)(
			(_tui, _theme, _keys, done) => {
				closeOther = done;
				return {
					render: () => ["OTHER"],
					invalidate() {},
					handleInput: (data) => keys.push(["other", data]),
				};
			},
			{ overlayOptions: { width: 20, anchor: "center" } },
		);
		tui.renderNow();
		assert.equal(await settledNow(opened), "still pending");
		terminal.onInput("x");
		assert.deepEqual(keys, [["other", "x"]]);

		closeOther("done");
		tui.renderNow();
		assert.equal(await settledNow(other), "resolved");
		assert.equal(await settledNow(opened), "still pending");
		terminal.onInput("q");
		tui.renderNow();
		assert.equal(await settledNow(opened), "resolved");
		terminal.onInput("z");
		assert.deepEqual(keys, [
			["other", "x"],
			["editor", "z"],
		]);
		tui.stop();
	});
});

test("a child that starts while a finished row waits to expire gets the one-second tick at once", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			refresh: clock.schedule,
		});
		boxOf(extension);
		await spawnBackground(extension, worktree);
		await settle();
		children.created[0].result.resolve("Done.");
		await settle();
		clock.fire(400);
		clock.fire(1000);
		const ticks = () => clock.pending().filter((ms) => ms !== 400);
		assert.deepEqual(ticks(), [60_000]);

		await spawnBackground(extension, worktree);
		await settle();
		assert.deepEqual(ticks().sort((a, b) => a - b), [133, 1000]);
	});
});

test("closing the view from an open detail stops following the child", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		const view = openChildren(extension);
		view.press("\r");
		children.created[0].spec.onEvent({ type: "turn_start" });
		const followed = view.tui.renders;
		assert.ok(followed > 0);
		view.press("q");
		const closed = view.tui.renders;
		children.created[0].spec.onEvent({ type: "turn_start" });
		assert.equal(view.tui.renders, closed);
	});
});

const hostileBytes = [
	"\x1b[2J",
	"\x1b]52;c;",
	"\x1b]8;;x",
	"\x1b]0;",
	"\x9b",
	"‮",
	"⁦",
];

function hostile(label) {
	return `${label}\x1b[2J\x1b]52;c;eA==\x07\x1b]8;;x\x07\x1b]0;title\x07\x9b31m‮⁦end\tcol\nnext ${label}`;
}

test("control sequences in a child's task, text, thinking, and streaming updates never reach the rendered detail", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		const child = children.created[0];
		child.entries = [
			userEntry("u1", hostile("task")),
			assistantEntry("a1", [
				{ type: "thinking", thinking: hostile("thought") },
				{ type: "text", text: hostile("answer") },
			]),
			{
				...assistantEntry("a2", [{ type: "text", text: "partial" }]),
				message: {
					...assistantEntry("a2", []).message,
					content: [{ type: "text", text: "partial" }],
					stopReason: "error",
					errorMessage: hostile("failure"),
				},
			},
			{
				type: "message",
				id: "r1",
				message: {
					role: "toolResult",
					toolCallId: "t1",
					toolName: "bash",
					content: [{ type: "text", text: hostile("output") }],
					isError: false,
				},
			},
		];
		child.spec.onEvent({
			type: "message_update",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: hostile("streamed thought") },
					{ type: "text", text: hostile("streamed answer") },
				],
			},
			assistantMessageEvent: { type: "text_delta" },
		});
		const view = openChildren(extension, { rows: 80 });
		view.press("\r");
		const emitted = view.component.render(100).join("\n");
		for (const bytes of hostileBytes) {
			assert.equal(emitted.includes(bytes), false, JSON.stringify(bytes));
		}
		const shown = plain(emitted);
		for (const label of [
			"task",
			"thought",
			"answer",
			"streamed thought",
			"streamed answer",
			"failure",
		]) {
			assert.match(shown, new RegExp(`next ${label}`));
		}
	});
});

test("the detail lists the files a child changed through its own successful edit and write calls, nested codemode calls included, and not a failed edit or a bash write", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		const emit = (event) => children.created[0].spec.onEvent(event);
		const call = (toolCallId, toolName, args, isError, parent) => {
			const nested = parent ? { parentToolCallId: parent } : {};
			emit({ type: "tool_execution_start", toolCallId, toolName, args, ...nested });
			return () =>
				emit({ type: "tool_execution_end", toolCallId, toolName, result: {}, isError, ...nested });
		};
		const script = call("cm1", "codemode", { code: "..." }, true);
		const nestedWrite = call("cm1/1", "write", { path: "src/b.ts", content: "b" }, false, "cm1");
		const nestedEdit = call("cm1/2", "edit", { path: "src/c.ts", edits: [] }, true, "cm1");
		call("t1", "edit", { path: "src/a.ts", edits: [] }, false)();
		call("t2", "bash", { command: "echo d > src/d.ts" }, false)();
		call("t3", "write", { path: "src/pending.ts", content: "e" }, false);
		nestedEdit();
		nestedWrite();
		script();
		call("t4", "edit", { path: "src/a.ts", edits: [] }, false)();

		const view = openChildren(extension, { rows: 80 });
		view.press("\r");
		const body = view.lines(100).join("\n");
		const files = body.slice(body.indexOf("Changed files"));
		assert.match(files, /src\/a\.ts[\s\S]*src\/b\.ts/);
		assert.equal(files.match(/src\/a\.ts/g)?.length, 1);
		for (const path of ["src/c.ts", "src/d.ts", "src/pending.ts"]) {
			assert.equal(files.includes(path), false, path);
		}
	});
});

test("a hostile changed path never reaches the rendered detail", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		const emit = (event) => children.created[0].spec.onEvent(event);
		const call = { toolCallId: "t1", toolName: "write" };
		emit({
			type: "tool_execution_start",
			...call,
			args: { path: hostile("path"), content: "x" },
		});
		emit({ type: "tool_execution_end", ...call, result: {}, isError: false });
		const view = openChildren(extension, { rows: 80 });
		view.press("\r");
		const emitted = view.component.render(100).join("\n");
		for (const bytes of hostileBytes) {
			assert.equal(emitted.includes(bytes), false, JSON.stringify(bytes));
		}
		assert.match(plain(emitted), /Changed files[\s\S]*path/);
	});
});

test("children launched by one codemode call are grouped under it with the number launched, the number done, and their token total, and a direct launch has no group", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const launch = async (toolCallId) =>
			(
				await extension.tool.execute(
					toolCallId,
					{ role: "worker", task: "Fix the failing test" },
					undefined,
					undefined,
					toolContext("tui", worktree),
				)
			).details.id;
		const direct = await launch("call-1");
		const first = await launch("toolu_script7/1");
		const second = await launch("toolu_script7/2");
		await settle();
		const spend = (child, totalTokens) => {
			child.entries.push(
				assistantEntry(`a-${totalTokens}`, [{ type: "text", text: "Done." }]),
			);
			child.entries.at(-1).message.usage = { totalTokens, cost: { total: 0 } };
		};
		spend(children.created[1], 2000);
		spend(children.created[2], 1000);
		children.created[1].result.resolve("Done.");
		await settle();

		const records = (await use(extension, "list_children", {})).details.children;
		const group = (id) => records.find((child) => child.id === id)?.group;
		assert.equal(group(direct), undefined);
		assert.equal(group(first), "toolu_script7");
		assert.equal(group(second), "toolu_script7");

		const lines = openChildren(extension, { rows: 40 }).lines(100);
		const at = lines.findIndex((line) => / script ipt7 ─/.test(line));
		assert.ok(at > 0, lines.join("\n"));
		assert.match(lines[at + 1], /2 launched · 1 done +3\.0k tok/);
		const rows = lines.map((line) => line.split("│")[1] ?? "");
		const row = (id) => rows.findIndex((line) => line.includes(`worker ${id.slice(0, 4)}`));
		assert.ok(row(direct) < at);
		assert.match(rows[at + 2], new RegExp(`◐ worker ${second.slice(0, 4)}`));
		assert.match(rows[at + 4], /✓ worker .*completed/);
	});
});

test("a hostile group label never reaches the rendered list", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await extension.tool.execute(
			`${hostile("group")}\x1b[2J/1`,
			{ role: "worker", task: "Fix the failing test" },
			undefined,
			undefined,
			toolContext("tui", worktree),
		);
		await settle();
		const emitted = openChildren(extension, { rows: 40 }).component.render(100).join("\n");
		for (const bytes of hostileBytes) {
			assert.equal(emitted.includes(bytes), false, JSON.stringify(bytes));
		}
		assert.match(plain(emitted), /1 launched · 0 done/);
	});
});

test("a child that times out after reporting shows its last result in the Fleet view, and the parent's message about it carries the same result", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: clock.schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		children.created[0].spec.report(workerResult("partial", "The parser half is fixed."));
		clock.fire(minutes(4));
		await settle();

		assert.equal(await stateOf(extension, id), "timed out");
		const last = [
			"Last reported result:",
			"Verdict: partial.",
			"Reason: The parser half is fixed.",
			"files_changed:",
			"- src/a.ts: fixed the parser",
			"validation:",
			"- npm test: 12 passed",
			"left_undone:",
			"- none",
		];
		assert.equal(extension.messages.length, 1);
		assert.equal(
			extension.messages[0].message.content,
			`Child ${id} timed out: no activity for 4 minutes.\n\n${last.join("\n")}`,
		);

		const view = openChildren(extension, { rows: 80 });
		view.press("\r");
		const lines = view.lines(100).map((line) => line.split("│")[2]?.trim() ?? "");
		const at = lines.findIndex((line) => /^Result ─/.test(line));
		assert.ok(at > 0, view.lines(100).join("\n"));
		assert.deepEqual(lines.slice(at + 1, at + 3 + last.length), [
			"no activity for 4 minutes.",
			"",
			...last,
		]);
	});
});

test("a timed-out child that reported nothing keeps only its reason, in the view and in the parent's message", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: clock.schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		clock.fire(minutes(4));
		await settle();
		assert.equal(
			extension.messages[0].message.content,
			`Child ${id} timed out: no activity for 4 minutes.`,
		);
		const view = openChildren(extension, { rows: 80 });
		view.press("\r");
		assert.doesNotMatch(view.lines(100).join("\n"), /Last reported result/);
	});
});

test("a hostile last result never reaches the rendered detail", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const clock = manualClock();
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: clock.schedule,
		});
		await spawnBackground(extension, worktree);
		await settle();
		children.created[0].spec.report({
			...workerResult("partial", hostile("reason")),
			left_undone: [hostile("undone")],
		});
		clock.fire(minutes(4));
		await settle();
		const view = openChildren(extension, { rows: 80 });
		view.press("\r");
		const emitted = view.component.render(100).join("\n");
		for (const bytes of hostileBytes) {
			assert.equal(emitted.includes(bytes), false, JSON.stringify(bytes));
		}
		assert.match(plain(emitted), /next undone/);
	});
});

test("a double click opens the child painted on that row even if the order changed before the next redraw, and a vanished child does nothing", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const first = await spawnBackground(extension, worktree, "First");
		await spawnBackground(extension, worktree, "Second");
		await settle();
		const view = openChildren(extension, { rows: 12 });
		view.component.render(60);
		children.created[1].spec.ask("Which branch?").catch(() => {});
		view.component.handleMouse({
			type: "click",
			button: "left",
			x: 5,
			y: 2,
			clickCount: 2,
		});
		assert.match(
			view.lines(60)[1],
			new RegExp(`◐ worker ${first.slice(0, 4)} +running`),
		);

		view.press("\x1b");
		view.component.render(60);
		await extension.fire("session_shutdown", { reason: "new" });
		assert.equal(
			view.component.handleMouse({
				type: "click",
				button: "left",
				x: 5,
				y: 2,
				clickCount: 2,
			}),
			undefined,
		);
	});
});

test("a click after leaving the detail and before the next redraw opens nothing", async () => {
	initTheme("dark", false);
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		await spawnBackground(extension, worktree);
		await settle();
		const view = openChildren(extension, { rows: 12 });
		view.component.render(60);
		view.press("\r");
		view.component.render(60);
		view.press("\x1b");
		const click = view.component.handleMouse({
			type: "click",
			button: "left",
			x: 5,
			y: 1,
			clickCount: 2,
		});
		assert.equal(click, undefined);
		assert.match(view.lines(60)[1], /Active ─/);
	});
});

test("a busy parent receives a child result after the current turn, steered rather than held until the run ends", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);

		children.created[0].result.resolve("Done.");
		await settle();
		assert.equal(extension.messages.length, 0);

		await extension.fire("turn_end");

		assert.equal(extension.messages.length, 1);
		const [{ message, options }] = extension.messages;
		assert.deepEqual(stateOfDetails(message.details), { id, state: "completed" });
		assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
	});
});

test("results pending at one turn boundary arrive together in a single message", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const first = await spawnBackground(extension, worktree);
		const second = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);

		children.created[0].result.resolve("First answer.");
		children.created[1].result.reject(new Error("provider overloaded"));
		await settle();
		await extension.fire("turn_end");
		await extension.fire("turn_end");

		assert.equal(extension.messages.length, 1);
		const [{ message, options }] = extension.messages;
		assert.equal(message.customType, "pi-workflow-child-result");
		assert.deepEqual(message.details.results.map(stateOfDetails), [
			{ id: first, state: "completed" },
			{ id: second, state: "failed" },
		]);
		assert.equal(
			message.content,
			`Child ${first} completed. Verdict: absent.\n\nFirst answer.\n\nChild ${second} failed: provider overloaded`,
		);
		assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
	});
});

test("a result the parent read with child_result is not delivered again and triggers no turn", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const read = await spawnBackground(extension, worktree);
		const other = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);
		children.created[0].result.resolve("Read answer.");
		await settle();

		const result = await use(extension, "child_result", { id: read });
		assert.match(text(result), /\n\nRead answer\.$/);
		await extension.fire("turn_end");
		assert.equal(extension.messages.length, 0);

		children.created[1].result.resolve("Other answer.");
		await settle();
		await extension.fire("turn_end");
		assert.equal(extension.messages.length, 1);
		assert.deepEqual(stateOfDetails(extension.messages[0].message.details), {
			id: other,
			state: "completed",
		});
		await use(extension, "child_result", { id: other });
		await extension.fire("agent_settled");
		assert.equal(extension.messages.length, 1);
	});
});

test("a child_result call that cannot render the result leaves it pending for delivery", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);
		children.created[0].spec.report({
			...workerResult("done"),
			files_changed: "src/a.ts",
		});
		children.created[0].result.resolve("Answer.");
		await settle();

		await assert.rejects(use(extension, "child_result", { id }));
		await extension.fire("turn_end");

		assert.match(
			extension.notifications.at(-1)?.message ?? "",
			/could not be delivered/,
		);
	});
});

test("a result whose delivery throws stays pending and is delivered on the next turn", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		let failures = 1;
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			sendMessage: () => {
				if (failures-- > 0) throw new Error("transport closed");
			},
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);
		children.created[0].result.resolve("Late answer.");
		await settle();

		await extension.fire("turn_end");
		assert.match(
			extension.notifications.at(-1).message,
			/could not be delivered: transport closed/,
		);
		await extension.fire("turn_end");

		assert.equal(extension.messages.length, 2);
		assert.deepEqual(stateOfDetails(extension.messages[1].message.details), {
			id,
			state: "completed",
		});
		await extension.fire("agent_settled");
		assert.equal(extension.messages.length, 2);
	});
});

test("continue_child consumes the earlier result, and the new record keeps continuedFrom", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const done = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);
		children.created[0].result.resolve("First answer.");
		await settle();

		const result = await use(
			extension,
			"continue_child",
			{ id: done, task: "Now add a test" },
			toolContext("tui", worktree),
		);
		await extension.fire("turn_end");

		assert.equal(extension.messages.length, 0);
		const next = result.details.id;
		assert.equal(
			(await use(extension, "child_status", { id: next })).details.child
				.continuedFrom,
			done,
		);
		await settle();
		children.created[1].result.resolve("Second answer.");
		await settle();
		await extension.fire("turn_end");
		assert.deepEqual(
			extension.messages.map(({ message }) => stateOfDetails(message.details)),
			[{ id: next, state: "completed" }],
		);
	});
});

test("session shutdown drops pending results, and the ended children are gone from child_result", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		extension.busy(true);
		children.created[0].result.resolve("Earlier answer.");
		await settle();

		await extension.fire("session_shutdown");
		await extension.fire("session_start", { reason: "resume" });
		await extension.fire("turn_end");
		await extension.fire("agent_settled");

		assert.equal(extension.messages.length, 0);
		assert.match(
			text(await use(extension, "child_result", { id })),
			/^No child .+ in this session/,
		);
	});
});

test("an idle parent receives results that end together in one message that starts one turn", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const first = await spawnBackground(extension, worktree);
		const second = await spawnBackground(extension, worktree);
		await settle();

		children.created[0].result.resolve("First answer.");
		children.created[1].result.resolve("Second answer.");
		await settle();

		assert.equal(extension.messages.length, 1);
		const [{ message, options }] = extension.messages;
		assert.deepEqual(message.details.results.map(stateOfDetails), [
			{ id: first, state: "completed" },
			{ id: second, state: "completed" },
		]);
		assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
	});
});

test("children launched by an aborted script keep running and asking, and reach the parent in one delivery when all are done", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const script = new AbortController();
		const ids = (
			await Promise.all(
				[0, 1, 2].map((i) =>
					extension.tool.execute(
						`script/${i + 1}`,
						{ role: "worker", task: `Task ${i}` },
						script.signal,
						undefined,
						toolContext("tui", worktree),
					),
				),
			)
		).map((result) => result.details.id);
		script.abort();
		await settle();

		assert.deepEqual(
			children.created.map((child) => child.aborts),
			[0, 0, 0],
		);
		const answer = children.created[1].spec.ask("Which file?");
		assert.equal(extension.messages.length, 1);
		assert.equal(
			extension.messages[0].message.customType,
			"pi-workflow-child-question",
		);
		const asking = extension.messages[0].message.details.id;
		assert.ok(ids.includes(asking));
		await use(extension, "reply_child", { id: asking, question: 1, answer: "a.ts" });
		assert.equal(await answer, "a.ts");

		for (const [i, child] of children.created.entries()) {
			child.spec.report(workerResult("done"));
			child.result.resolve(`Answer ${i}.`);
			await settle();
			await extension.fire("turn_end");
			await extension.fire("agent_settled");
		}

		assert.equal(extension.messages.length, 2);
		assert.deepEqual(
			extension.messages[1].message.details.results
				.map(stateOfDetails)
				.sort((a, b) => a.id.localeCompare(b.id)),
			ids
				.map((id) => ({ id, state: "completed" }))
				.sort((a, b) => a.id.localeCompare(b.id)),
		);
	});
});

test("after child session is unseated, a launch is refused while a fan-out's children still start, finish, and deliver", async (t) => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const ids = [];
		for (let i = 0; i < 6; i++)
			ids.push(await spawnBackground(extension, worktree, `Task ${i}`));
		await settle();
		const seated = Object.fromEntries(
			capabilities.map((capability) => [capability, true]),
		);
		t.after(() =>
			replaceSelection({
				schemaVersion: 1,
				capabilities: seated,
				expectations: {},
			}),
		);
		replaceSelection({
			schemaVersion: 1,
			capabilities: { ...seated, "child-session": false },
			expectations: {},
		});

		const refused = await spawn(
			extension.tool,
			{ role: "worker", task: "One more" },
			toolContext("tui", worktree),
		);
		assert.equal(refused.details.status, "refused");
		assert.equal(text(refused), "Child session is not seated. Run /workflow:config.");
		assert.equal(children.created.length, 6);

		for (const [i, child] of children.created.entries()) {
			child.result.resolve(`Answer ${i}.`);
			await settle();
			await extension.fire("turn_end");
		}

		assert.deepEqual(children.created[5].tasks, ["Task 5"]);
		assert.equal(extension.messages.length, 1);
		assert.deepEqual(
			extension.messages[0].message.details.results.map(stateOfDetails),
			ids.map((id) => ({ id, state: "completed" })),
		);
	});
});

test("five children that end at different times reach the parent in one delivery that starts one turn", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
		});
		const ids = [];
		for (let i = 0; i < 5; i++)
			ids.push(await spawnBackground(extension, worktree));
		await settle();
		const verdicts = ["done", "done", undefined, "done", "done"];

		for (const [i, child] of children.created.entries()) {
			if (verdicts[i]) child.spec.report(workerResult(verdicts[i]));
			child.result.resolve(`Answer ${i}.`);
			await settle();
			await extension.fire("turn_end");
			await extension.fire("agent_settled");
			if (i < 4) assert.equal(extension.messages.length, 0);
		}

		assert.equal(extension.messages.length, 1);
		const [{ message, options }] = extension.messages;
		assert.deepEqual(
			message.details.results.map(stateOfDetails),
			ids.map((id) => ({ id, state: "completed" })),
		);
		assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
	});
});

for (const [trigger, event] of [
	["failed", "fails"],
	["timed out", "times out"],
	["cancelled", "is cancelled from the view"],
	["blocked", "reports blocked"],
	["fail", "reports fail"],
	["partial", "reports partial"],
	["question", "asks a question"],
]) {
	test(`a child that ${event} wakes the parent at once with every pending result while another child still works`, async () => {
		await withWorkspace(async ({ worktree, agentDir }) => {
			const clock = manualClock();
			const children = fakeChildren();
			const extension = await loadSpawnTool({
				agentDir,
				create: children.create,
				schedule: clock.schedule,
			});
			const quiet = await spawnBackground(extension, worktree);
			const waker = await spawnBackground(
				extension,
				worktree,
				"Verify the parser fix",
				trigger === "fail" ? "verify" : "worker",
			);
			await spawnBackground(extension, worktree);
			await settle();
			const [first, second, third] = children.created;
			first.spec.report(workerResult("done"));
			first.result.resolve("Quiet answer.");
			await settle();
			assert.equal(extension.messages.length, 0);

			if (trigger === "failed") {
				second.result.reject(new Error("provider overloaded"));
			} else if (trigger === "timed out") {
				third.spec.onEvent({
					type: "tool_execution_start",
					toolCallId: "call-1",
					toolName: "bash",
					args: {},
				});
				clock.fire(minutes(4));
			} else if (trigger === "cancelled") {
				const view = openChildren(extension);
				view.press("s", "y");
			} else if (trigger === "question") {
				second.spec.ask("Which file holds the parser?");
			} else if (trigger === "fail") {
				assert.equal(second.spec.role, "verify");
				second.spec.report({
					verdict: "fail",
					reason: "The parser still drops tabs.",
					findings: ["test/parser.test.ts: the tab case fails"],
					unverified: [],
				});
				second.result.resolve("Waking answer.");
			} else {
				second.spec.report(workerResult(trigger));
				second.result.resolve("Waking answer.");
			}
			await settle();

			const delivered = extension.messages.map(({ message }) => message);
			const results = delivered.find(
				(message) => message.customType === "pi-workflow-child-result",
			);
			const resultIds = (results.details.results ?? [results.details]).map(
				(details) => details.id,
			);
			if (trigger === "question") {
				assert.deepEqual(resultIds, [quiet]);
				assert.equal(delivered.at(-1).customType, "pi-workflow-child-question");
				assert.equal(delivered.at(-1).details.id, waker);
			} else {
				assert.equal(delivered.length, 1);
				assert.deepEqual(resultIds, [quiet, waker]);
			}
		});
	});
}

test("the first answer wins: an operator answer in the Fleet view resolves the question, and a later reply_child is refused with it", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const asked = children.created[0].spec.ask("Which file holds the parser?");
		const view = openChildren(extension);

		view.press("\r", "\r", ..."queso cancel", "\r");

		assert.equal(await asked, "queso cancel");
		assert.equal(await stateOf(extension, id), "running");
		assert.equal(view.closed(), false);
		assert.deepEqual(
			extension.messages.map((entry) => entry.message.customType),
			["pi-workflow-child-question"],
		);
		await assert.rejects(
			use(extension, "reply_child", { id, question: 1, answer: "src/a.ts" }),
			{
				message: `Question 1 of child ${id} was already answered by the operator: queso cancel`,
			},
		);
		assert.equal(extension.messages.length, 1);
	});
});

test("the first answer wins: after the parent's reply_child, an operator answer is refused with its reason", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const children = fakeChildren();
		const extension = await loadSpawnTool({
			agentDir,
			create: children.create,
			schedule: manualClock().schedule,
		});
		const id = await spawnBackground(extension, worktree);
		await settle();
		const asked = children.created[0].spec.ask("Which file holds the parser?");
		const view = openChildren(extension);
		view.press("\r", "\r", ..."src/b.ts");

		await use(extension, "reply_child", { id, question: 1, answer: "src/a.ts" });
		view.press("\r");

		assert.equal(await asked, "src/a.ts");
		assert.ok(
			view
				.lines(160)
				.some((line) =>
					line.includes(
						`Question 1 of child ${id} was already answered by the parent: src/a.ts`,
					),
				),
		);
	});
});

async function steerable(worktree, agentDir) {
	const children = fakeChildren();
	const extension = await loadSpawnTool({
		agentDir,
		create: children.create,
		schedule: manualClock().schedule,
	});
	const id = await spawnBackground(extension, worktree);
	await settle();
	return { children, extension, id, child: children.created[0] };
}

function shows(view, text) {
	return view.lines(160).some((line) => line.includes(text));
}

test("the operator steers a running child from the Fleet view without cancelling it, the row shows each Steer pending until the child receives it, and the parent hears nothing", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { extension, id, child } = await steerable(worktree, agentDir);
		const tools = extension.tools.map((tool) => tool.name);
		const view = openChildren(extension, { rows: 30 });

		view.press("\r", "\r", ..."use tabs", "\r", "\r", ..."then rerun", "\r");
		await settle();

		assert.deepEqual(child.steered, ["use tabs", "then rerun"]);
		assert.equal(child.aborts, 0);
		assert.equal(await stateOf(extension, id), "running");
		assert.ok(shows(view, "2 steers pending"));
		child.deliver();
		assert.ok(shows(view, "1 steer pending"));
		child.deliver();
		assert.equal(shows(view, "pending"), false);

		child.result.resolve("Done with tabs.");
		await settle();
		assert.equal(shows(view, "undelivered"), false);
		assert.deepEqual(
			extension.messages.map((entry) => entry.message.customType),
			["pi-workflow-child-result"],
		);
		assert.equal(JSON.stringify(extension.messages).includes("use tabs"), false);
		assert.deepEqual(
			extension.tools.map((tool) => tool.name),
			tools,
		);
	});
});

test("a Steer the child has not received when it ends is shown as undelivered on its row and in its detail", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { extension, child } = await steerable(worktree, agentDir);
		const view = openChildren(extension, { rows: 30 });

		view.press("\r", "\r", ..."use tabs", "\r", "\r", ..."then rerun", "\r");
		await settle();
		child.deliver();
		child.result.resolve("Done.");
		await settle();

		assert.ok(shows(view, "1 steer undelivered"));
		assert.equal(shows(view, "pending"), false);
		assert.ok(shows(view, "undelivered then rerun"));
		assert.equal(shows(view, "undelivered use tabs"), false);
		assert.equal(JSON.stringify(extension.messages).includes("then rerun"), false);
	});
});

test("a Steer sent while the child retries automatically is not undelivered once the retry ends", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { extension, child } = await steerable(worktree, agentDir);
		const view = openChildren(extension, { rows: 30 });

		child.spec.onEvent({ type: "agent_end", messages: [], willRetry: true });
		view.press("\r", "\r", ..."use tabs", "\r");
		await settle();
		assert.ok(shows(view, "1 steer pending"));
		child.deliver();
		child.spec.onEvent({ type: "agent_settled" });
		child.result.resolve("Done with tabs.");
		await settle();

		assert.equal(shows(view, "undelivered"), false);
	});
});

test("a Steer beginning with / is refused, and a child that turns waiting or ends before the Steer is sent refuses it with the reason", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const { extension, id, child } = await steerable(worktree, agentDir);
		const view = openChildren(extension, { rows: 30 });

		view.press("\r", "\r", ..."/mcp", "\r");
		await settle();
		assert.ok(shows(view, "A Steer cannot begin with /."));

		view.press("\r", ..."use tabs");
		const asked = child.spec.ask("Which file?");
		view.press("\r");
		await settle();
		assert.ok(
			shows(view, `Child ${id} is waiting; only a running child can be steered.`),
		);

		view.press("\r", ..."src/a.ts", "\r");
		assert.equal(await asked, "src/a.ts");
		view.press("\r", ..."use tabs");
		child.result.resolve("Done.");
		await settle();
		view.press("\r");
		await settle();
		assert.ok(
			shows(view, `Child ${id} is completed; only a running child can be steered.`),
		);
		assert.deepEqual(child.steered, []);
	});
});

test("through Pi's SDK, two Steers reach a running child at its next turns, one per turn, after the tool results and without cancelling it", async () => {
	await withWorkspace(async ({ worktree, agentDir }) => {
		const child = await realChild(agentDir, [
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 0.5" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Using tabs."),
			fauxAssistantMessage("Rerunning."),
		]);
		const id = (await spawnReal(child, worktree)).details.id;
		await eventually(() => child.parent.requests.length === 1);
		const view = openChildren(child.extension, { rows: 30 });

		view.press("\r", "\r", ..."use tabs", "\r", "\r", ..."then rerun", "\r");
		await eventually(() => shows(view, "2 steers pending"));
		await eventually(() => child.parent.requests.length === 3);
		for (let i = 0; i < 100; i++) {
			if ((await stateOf(child.extension, id)) === "completed") break;
			await delay(10);
		}

		const tail = (request) =>
			request.messages
				.slice(-2)
				.map((message) =>
					message.role === "user"
						? `user: ${message.content.map((part) => part.text).join("")}`
						: message.role,
				);
		assert.deepEqual(tail(child.parent.requests[1]), [
			"toolResult",
			"user: use tabs",
		]);
		assert.deepEqual(tail(child.parent.requests[2]), [
			"assistant",
			"user: then rerun",
		]);
		assert.equal(await stateOf(child.extension, id), "completed");
		assert.equal(shows(view, "undelivered"), false);
	});
});

test("a Steer whose text begins with / after leading whitespace is refused", async () => {
	const { core, launch } = recordingCore();
	const { id, child } = await launch();
	await assert.rejects(core.steer(id, "  /mcp"), /A Steer cannot begin with \//);
	assert.deepEqual(child.steered, []);
});

test("a file a child edits by a relative and an absolute path is one changed file, shown relative to the child's worktree, and a file outside it keeps its absolute path", async () => {
	const { core, launch } = recordingCore();
	const { id, child } = await launch();
	const write = (toolCallId, path) => {
		const call = { toolCallId, toolName: "write" };
		child.spec.onEvent({ type: "tool_execution_start", ...call, args: { path } });
		child.spec.onEvent({ type: "tool_execution_end", ...call, result: {}, isError: false });
	};
	write("t1", "src/a.ts");
	write("t2", "/tmp/src/a.ts");
	write("t3", "./src/../src/a.ts");
	write("t4", "/etc/hosts");
	assert.deepEqual(core.changedFiles(id), ["src/a.ts", "/etc/hosts"]);
});
