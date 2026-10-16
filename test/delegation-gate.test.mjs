import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { syncCompactTools } from "../extensions/compact-tools.ts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { createJevRouting } from "../extensions/workflow-settings.ts";
import { classifierRegistry } from "./support/fake-jev.mjs";
import { turnJevRoutingOn } from "./support/jev-routing.mjs";

const jevRouting = turnJevRoutingOn();
const delegationMode = { current: () => "opportunistic" };

const absentProfiles = { load: () => ({ status: "absent" }) };

function choiceAnswer(choice, criteria, confidence = 0.91) {
	return {
		type: "choice",
		choice,
		confidence,
		probabilities: Object.fromEntries(
			Object.keys(criteria ?? {}).map((key) => [key, key === choice ? 1 : 0]),
		),
	};
}

function fakeJev(answer, confidence = 0.91) {
	return classifierRegistry((context) => {
		const answered = typeof answer === "function" ? answer(context) : answer;
		if (answered && typeof answered === "object") return answered;
		const questions = context.questions ?? {};
		const text = typeof answered === "string" ? answered : "leave";
		const answers = {};
		if (questions.destination) {
			answers.destination = choiceAnswer(
				text,
				questions.destination.criteria,
				confidence,
			);
		}
		return { answers };
	});
}

function assertDelegatesWithoutRole(reason) {
	assert.match(reason, /spawn_child/);
	assert.doesNotMatch(reason, /\b(explore|worker|verify)\b/);
}

function branchEnding(text, older = "Use a child for the old turn", id = text) {
	return [
		{ id: "older", type: "message", message: { role: "user", content: older } },
		{
			id: "waiting",
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "Waiting." }] },
		},
		{
			id,
			type: "message",
			message: { role: "user", content: [{ type: "text", text }] },
		},
		{ id: "blank", type: "message", message: { role: "user", content: "   " } },
	];
}

function gateContext(cwd, branch, jev) {
	return {
		cwd,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? "typesafe-key" : undefined,
			getAvailable: () => [],
			...jev?.registry,
		},
		sessionManager: { getBranch: () => branch },
	};
}

function seatEverything(on = true) {
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(capabilities.map((capability) => [capability, on])),
		expectations: {},
	});
}

function launcherFor(options = {}) {
	seatEverything();
	return createChildLauncher({
		modelProfiles: absentProfiles,
		jevRouting,
		delegationMode,
		...options,
	});
}

async function withWorkspace(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-delegation-gate-"));
	try {
		const worktree = join(dir, "repo");
		const agentDirectory = join(dir, "agent");
		await mkdir(worktree);
		await mkdir(agentDirectory);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		return await run({ worktree, agentDirectory });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function loadExtension({ legacy = false, agentDirectory }) {
	turnJevRoutingOn(agentDirectory);
	const handlers = new Map();
	const tools = [];
	const notifications = [];
	const messages = [];
	const entries = [];
	const ui = {
		notify: (message, level) => notifications.push({ message, level }),
		setWidget() {},
		setStatus() {},
		setHeader() {},
		setFooter() {},
		setEditorComponent() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setWorkingMessage() {},
	};
	piWorkflowExtension(
		{
			on(event, handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			registerTool: (tool) => tools.push(tool),
			sendMessage: (message, options) => messages.push({ message, options }),
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
			agentDirectory,
		},
	);
	const fire = async (event, payload = {}, ctx = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? []) {
			result = await handler(payload, ctx);
		}
		return result;
	};
	return { handlers, tools, fire, notifications, messages, entries, ui };
}

test("the first grep blocks when Jev says leave, names no role, and asks only the destination", async () => {
	const message = "Find where launch decides to stay";
	const jev = fakeJev("leave", 0.2);
	const launcher = launcherFor();
	const input = { pattern: "judge", path: "extensions/child-launcher.ts" };
	const snapshot = { ...input };
	const result = await launcher.gateToolCall(
		{ toolName: "grep", input },
		gateContext("/work", branchEnding(message), jev),
	);

	assert.deepEqual(input, snapshot);
	assert.equal(result.allow, false);
	assert.match(result.reason, /spawn_child/);
	assert.doesNotMatch(result.reason, /\b(explore|worker|verify)\b/);
	assert.equal(jev.requests.length, 1);
	const request = jev.requests[0];
	assert.deepEqual(Object.keys(request.questions), ["destination"]);
	assert.equal(request.questions.destination.type, "choice");
	assert.deepEqual(request.state, { user_request: message, task: message });
});

test("the second gated tool in the turn does not call Jev again", async () => {
	const jev = fakeJev("leave");
	const launcher = launcherFor();
	const ctx = gateContext("/work", branchEnding("Map the launcher module"), jev);
	const first = await launcher.gateToolCall(
		{ toolName: "grep", input: { pattern: "judge" } },
		ctx,
	);
	const second = await launcher.gateToolCall(
		{ toolName: "read", input: { path: "extensions/child-launcher.ts" } },
		ctx,
	);

	assert.equal(first.allow, false);
	assert.equal(second.allow, false);
	assert.equal(second.reason, first.reason);
	assert.equal(jev.requests.length, 1);
});

test("Jev stay allows the tool and a later tool does not ask again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Decide the storage architecture with me";
		const jev = fakeJev("stay");
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const first = await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "storage" } },
			ctx,
		);
		const second = await launcher.gateToolCall(
			{ toolName: "bash", input: { command: "ls" } },
			ctx,
		);
		const decided = await launcher.prepareLaunch(
			{
				role: "explore",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);

		assert.equal(first.allow, true);
		assert.equal(second.allow, true);
		assert.equal(decided.kind, "stay");
		assert.equal(
			decided.warning,
			"The work stays in this session. No child was launched.",
		);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.user_request, message);
		assert.equal(jev.requests[0].questions.destination.type, "choice");
	});
});

test("a stay from spawn_child lets the parent's next git, gh, and read run on the same verdict", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Revisa SYN-2320 contra qa con git diff y git log";
		const jev = fakeJev("stay");
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const decided = await launcher.prepareLaunch(
			{
				role: "explore",
				task: "Compare SYN-2320 with qa",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);
		const gated = [];
		for (const event of [
			{ toolName: "bash", input: { command: "git diff qa...SYN-2320" } },
			{ toolName: "bash", input: { command: "git merge-base qa SYN-2320" } },
			{ toolName: "bash", input: { command: "gh pr view SYN-2320" } },
			{ toolName: "read", input: { path: "src/index.ts" } },
		]) {
			gated.push(await launcher.gateToolCall(event, ctx));
		}

		assert.equal(decided.kind, "stay");
		assert.equal(
			decided.warning,
			"The work stays in this session. No child was launched.",
		);
		assert.deepEqual(gated, [
			{ allow: true },
			{ allow: true },
			{ allow: true },
			{ allow: true },
		]);
		assert.equal(jev.requests.length, 1);
	});
});

test("explicit child text blocks a read and asks Jev only for the destination", async () => {
	for (const message of ["Revisa esto con un hijo", "Read the file with a child"]) {
		const jev = fakeJev("leave");
		const launcher = launcherFor();
		const result = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "src/main.ts" } },
			gateContext("/work", branchEnding(message, "Look at the previous note"), jev),
		);

		assert.equal(result.allow, false);
		assert.match(result.reason, /spawn_child/);
		assert.doesNotMatch(result.reason, /\b(explore|worker|verify)\b/);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.user_request, message);
		assert.deepEqual(Object.keys(jev.requests[0].questions), ["destination"]);
	}
});

test("a read of AGENTS.md does not call Jev or block, and the next grep asks once", async () => {
	const cwd = "/work";
	const jev = fakeJev("leave");
	const launcher = launcherFor();
	const ctx = gateContext(cwd, branchEnding("Find where launch decides to stay"), jev);
	const reads = [
		"AGENTS.md",
		"./AGENTS.md",
		"docs/../AGENTS.md",
		join(cwd, "AGENTS.md"),
		"GLOSSARY.md",
		"docs/agents/workflow.md",
		join(cwd, "docs/agents/domain.md"),
		"docs/agents/../agents/workflow.md",
	];
	for (const path of reads) {
		assert.deepEqual(
			await launcher.gateToolCall({ toolName: "read", input: { path } }, ctx),
			{ allow: true },
		);
	}
	assert.equal(jev.requests.length, 0);

	const grep = await launcher.gateToolCall(
		{ toolName: "grep", input: { pattern: "policy", path: "AGENTS.md" } },
		ctx,
	);
	const bash = await launcher.gateToolCall(
		{ toolName: "bash", input: { command: "cat AGENTS.md" } },
		ctx,
	);
	assert.equal(grep.allow, false);
	assert.equal(bash.allow, false);
	assert.equal(jev.requests.length, 1);
	assert.deepEqual(
		await launcher.gateToolCall(
			{ toolName: "read", input: { path: "AGENTS.md" } },
			ctx,
		),
		{ allow: true },
	);
	assert.equal(jev.requests.length, 1);

	const escaped = await launcher.gateToolCall(
		{ toolName: "read", input: { path: "../AGENTS.md" } },
		ctx,
	);
	assert.equal(escaped.allow, false);
	assert.equal(jev.requests.length, 1);
});

test("codegraph init is not gated and codegraph explore is", async () => {
	const jev = fakeJev("leave");
	const launcher = launcherFor();
	const ctx = gateContext("/work", branchEnding("Map the launcher module"), jev);
	const harness = [
		"spawn_child",
		"continue_child",
		"reply_child",
		"cancel_child",
		"list_children",
		"child_status",
		"child_result",
		"ask_user_choice",
		"ask_user_question",
		"todo",
	];
	for (const toolName of harness) {
		assert.deepEqual(
			await launcher.gateToolCall({ toolName, input: { task: "Map it" } }, ctx),
			{ allow: true },
		);
	}
	assert.deepEqual(
		await launcher.gateToolCall(
			{ toolName: "codegraph", input: { operation: "init" } },
			ctx,
		),
		{ allow: true },
	);
	assert.equal(jev.requests.length, 0);

	const explored = await launcher.gateToolCall(
		{ toolName: "codegraph", input: { operation: "explore", query: "launcher" } },
		ctx,
	);
	assert.equal(explored.allow, false);
	assertDelegatesWithoutRole(explored.reason);
	const queried = await launcher.gateToolCall(
		{ toolName: "codegraph", input: { operation: "query", query: "launcher" } },
		ctx,
	);
	assert.equal(queried.allow, false);
	assert.equal(jev.requests.length, 1);
	for (const toolName of harness) {
		assert.deepEqual(
			await launcher.gateToolCall({ toolName, input: {} }, ctx),
			{ allow: true },
		);
	}
	assert.equal(jev.requests.length, 1);
});

test("an invalid Jev selection blocks the tool and is not a stay", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Compare the cited sources";
		const jev = fakeJev(() => ({
			answers: {
				destination: {
					type: "choice",
					choice: "elsewhere",
					confidence: 0.2,
					probabilities: { stay: 0.4, leave: 0.4, decide: 0.2 },
				},
			},
		}));
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const result = await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "sources" } },
			ctx,
		);
		const decided = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);

		assert.equal(result.allow, false);
		assert.match(result.reason, /Launch blocked/);
		assert.match(result.reason, /invalid selection/);
		assert.doesNotMatch(result.reason, /stays/);
		assert.equal(decided.kind, "blocked");
		assert.equal(decided.warning, "Launch blocked. No child was launched.");
		assert.doesNotMatch(decided.warning, /stays/);
		assert.equal(decided.jev.answers.destination.choice, "elsewhere");
		assert.equal(decided.jev.answers.destination.confidence, 0.2);
		assert.equal(jev.requests.length, 2);
	});
});

test("a launch after the gate's leave verdict keeps the parent's role without asking Jev again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Compare the two implementations";
		const jev = fakeJev("leave", 0.2);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const blocked = await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "compare" } },
			ctx,
		);
		const result = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);

		assert.equal(blocked.allow, false);
		assertDelegatesWithoutRole(blocked.reason);
		assert.equal(result.kind, "ready");
		assert.equal(result.role, "worker");
		assert.equal(result.chosenBy, "parent");
		assert.equal(result.task, "parent paraphrase");
		assert.equal(result.model, "session/model");
		assert.equal(result.thinking, "medium");
		assert.ok(result.contract.tools.includes("bash"));
		assert.equal(result.jev.answers.destination.confidence, 0.2);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.task, message);
		assert.equal(jev.requests[0].state.user_request, message);
	});
});

test("a prepared launch stores the verdict so a later gated tool does not ask Jev again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export";
		const jev = fakeJev("leave", 0.15);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const result = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "Add the missing export",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);
		const blocked = await launcher.gateToolCall(
			{ toolName: "edit", input: { path: "src/export.ts" } },
			ctx,
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.role, "worker");
		assert.equal(result.jev.answers.destination.confidence, 0.15);
		assert.equal(blocked.allow, false);
		assertDelegatesWithoutRole(blocked.reason);
		assert.equal(jev.requests.length, 1);
	});
});

test("the same message reuses the decision across a turn start, a new message asks Jev again, and unseated gated tools run despite the cached block", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const jev = fakeJev("leave");
		const extension = await seatedExtension(
			{ worktree, agentDirectory },
			"Map the launcher module",
		);
		const ctx = gateContext(worktree, branchEnding("Map the launcher module"), jev);
		const first = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c1", toolName: "find", input: { pattern: "judge" } },
			ctx,
		);
		await extension.fire("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1 }, ctx);
		const again = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c2", toolName: "ls", input: { path: "extensions" } },
			ctx,
		);
		assert.equal(first.block, true);
		assert.deepEqual(again, first);
		assert.equal(jev.requests.length, 1);

		const next = gateContext(worktree, branchEnding("A later operator message"), jev);
		const refreshed = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c3", toolName: "grep", input: { pattern: "gate" } },
			next,
		);
		assert.equal(refreshed.block, true);
		assert.equal(jev.requests.length, 2);

		seatEverything(false);
		const unseated = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c4", toolName: "grep", input: { pattern: "gate" } },
			next,
		);
		assert.equal(unseated, undefined);
		assert.equal(jev.requests.length, 2);
	});
});

test("a reseat or a Jev routing change within the same message reuses the decision already made", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const jev = fakeJev("leave");
		const extension = await seatedExtension(
			{ worktree, agentDirectory },
			"Map the launcher module",
		);
		const ctx = gateContext(worktree, branchEnding("Map the launcher module"), jev);
		const first = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c1", toolName: "find", input: { pattern: "judge" } },
			ctx,
		);
		assert.equal(first.block, true);

		seatEverything(false);
		seatEverything(true);
		const reseated = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c2", toolName: "ls", input: { path: "extensions" } },
			ctx,
		);
		assert.deepEqual(reseated, first);

		createJevRouting(agentDirectory).set(false);
		const routedOff = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c3", toolName: "grep", input: { pattern: "gate" } },
			ctx,
		);
		assert.deepEqual(routedOff, first);
		assert.equal(jev.requests.length, 1);
	});
});

test("a missing user message does not call Jev or block", async () => {
	const jev = fakeJev("leave");
	const launcher = launcherFor();
	const branches = [
		undefined,
		[],
		[{ type: "message", message: { role: "assistant", content: "hello" } }],
		[{ type: "message", message: { role: "user", content: "   " } }],
		[{ type: "message", message: { role: "user", content: "" } }],
		[{ type: "message", message: { role: "user", content: [] } }],
	];
	for (const branch of branches) {
		const ctx = gateContext("/work", branch, jev);
		if (branch === undefined) delete ctx.sessionManager;
		assert.deepEqual(
			await launcher.gateToolCall(
				{ toolName: "grep", input: { pattern: "x" } },
				ctx,
			),
			{ allow: true },
		);
	}
	assert.equal(jev.requests.length, 0);
});

test("concurrent gated calls in one turn share a single Jev request", async () => {
	const jev = fakeJev("leave");
	let release;
	const hold = new Promise((resolve) => {
		release = resolve;
	});
	const classify = jev.registry.classify;
	jev.registry.classify = async (...args) => {
		const result = classify(...args);
		await hold;
		return result;
	};
	const launcher = launcherFor();
	const ctx = gateContext("/work", branchEnding("Map the launcher module"), jev);
	const first = launcher.gateToolCall(
		{ toolName: "grep", input: { pattern: "a" } },
		ctx,
	);
	const second = launcher.gateToolCall(
		{ toolName: "read", input: { path: "src/a.ts" } },
		ctx,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(jev.requests.length, 1);
	release();
	const [left, right] = await Promise.all([first, second]);
	assert.equal(jev.requests.length, 1);
	assert.equal(left.allow, false);
	assert.equal(right.reason, left.reason);
});

test("the parent registers the gate with spawn_child only when spawn tools are allowed", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const jev = fakeJev("leave");
		const allowed = loadExtension({
			agentDirectory,
		});
		const session = {
			mode: "print",
			hasUI: true,
			ui: allowed.ui,
			cwd: worktree,
			sessionManager: {
				getBranch: () => branchEnding("Map the launcher module"),
				getEntries: () => [],
			},
		};
		replaceSelection({
			schemaVersion: 1,
			capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
			expectations: {},
		});
		await allowed.fire("session_start", {}, session);
		await allowed.fire("session_start", {}, session);
		assert.equal(allowed.tools.filter((tool) => tool.name === "spawn_child").length, 1);
		assert.equal(allowed.handlers.get("tool_call").length, 1);

		const ctx = gateContext(worktree, branchEnding("Map the launcher module"), jev);
		const first = await allowed.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c1", toolName: "grep", input: { pattern: "map" } },
			ctx,
		);
		assert.equal(first.block, true);
		assert.equal(jev.requests.length, 1);
		await allowed.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c2", toolName: "ls", input: { path: "." } },
			ctx,
		);
		assert.equal(jev.requests.length, 1);

		const blocked = loadExtension({
			legacy: true,
			agentDirectory,
		});
		await blocked.fire("session_start", {}, { ...session, ui: blocked.ui });
		assert.equal(blocked.tools.some((tool) => tool.name === "spawn_child"), false);
		assert.equal(blocked.handlers.get("tool_call"), undefined);
	});
});

test("decide blocks the tool until one question is asked and does not launch", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Quiero decidir contigo si este cambio debe existir";
		const jev = fakeJev("decide");
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const blocked = await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "gate" } },
			ctx,
		);
		const again = await launcher.gateToolCall(
			{ toolName: "bash", input: { command: "ls" } },
			ctx,
		);
		const decided = await launcher.prepareLaunch(
			{
				role: "explore",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);

		assert.equal(blocked.allow, false);
		assert.match(blocked.reason, /Ask the user one question and wait/);
		assert.doesNotMatch(blocked.reason, /spawn_child/);
		assert.equal(again.reason, blocked.reason);
		assert.equal(decided.kind, "decide");
		assert.equal(
			decided.warning,
			"Ask the user one question and wait. No child was launched.",
		);
		assert.equal(jev.requests.length, 1);
		assert.equal("decide" in jev.requests[0].questions.destination.criteria, true);
	});
});

test("with Jev routing on, a named skill fixes neither the destination nor the role", async () => {
	await withWorkspace(async ({ worktree }) => {
		for (const [message, role] of [
			["Usa implement en este paquete", "explore"],
			["Usa la skill tdd para este ticket", "verify"],
			["Corre code-review en este cambio", "worker"],
			["Quiero un subagente para domain-modeling y hazlo", "explore"],
		]) {
			const jev = fakeJev("leave");
			const launcher = launcherFor();
			const ctx = gateContext(worktree, branchEnding(message), jev);
			const blocked = await launcher.gateToolCall(
				{ toolName: "grep", input: { pattern: "ticket" } },
				ctx,
			);
			const decided = await launcher.prepareLaunch(
				{
					role,
					task: "parent paraphrase",
					userRequest: message,
					userMessageId: message,
				},
				ctx,
			);

			assert.equal(blocked.allow, false, message);
			assertDelegatesWithoutRole(blocked.reason);
			assert.equal(decided.kind, "ready", message);
			assert.equal(decided.role, role, message);
			assert.equal(decided.chosenBy, "parent", message);
			assert.equal("skill" in decided, false, message);
			assert.equal(jev.requests.length, 1, message);
			assert.deepEqual(Object.keys(jev.requests[0].questions), ["destination"], message);
		}

		const stayed = fakeJev("stay");
		const stayMessage = "Usa implement para este cambio pequeño";
		const stayLauncher = launcherFor();
		const stayCtx = gateContext(worktree, branchEnding(stayMessage), stayed);
		assert.deepEqual(
			await stayLauncher.gateToolCall(
				{ toolName: "read", input: { path: "src/main.ts" } },
				stayCtx,
			),
			{ allow: true },
		);
		assert.equal(stayed.requests.length, 1);
	});
});

test("a missing TypeSafe key blocks the gated tool and the launch without inventing stay or worker", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export and its test";
		const jev = fakeJev("leave");
		const ctx = gateContext(worktree, branchEnding(message), jev);
		ctx.modelRegistry.getApiKeyForProvider = async () => undefined;
		const blocked = await launcherFor().gateToolCall(
			{ toolName: "edit", input: { path: "src/export.ts" } },
			ctx,
		);
		const decided = await launcherFor().prepareLaunch(
			{
				role: "worker",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);

		assert.equal(blocked.allow, false);
		assert.match(blocked.reason, /Launch blocked/);
		assert.match(blocked.reason, /TypeSafe/);
		assert.doesNotMatch(blocked.reason, /stays|spawn_child/);
		assert.equal(decided.kind, "blocked");
		assert.equal(decided.warning, "Launch blocked. No child was launched.");
		assert.equal("role" in decided, false);
		assert.equal(jev.requests.length, 0);
	});
});

test("while routing is on, git and gh work leaves with the parent's role and explore still has no shell", async () => {
	await withWorkspace(async ({ worktree }) => {
		for (const command of ["git status", "gh pr list"]) {
			const message = `Run ${command} and report what you find`;
			const jev = fakeJev("leave");
			const launcher = launcherFor();
			const ctx = gateContext(worktree, branchEnding(message), jev);
			const blocked = await launcher.gateToolCall(
				{ toolName: "bash", input: { command } },
				ctx,
			);
			const launched = await launcher.prepareLaunch(
				{
					role: "explore",
					task: command,
					userRequest: message,
					userMessageId: message,
				},
				ctx,
			);

			assert.equal(blocked.allow, false, command);
			assertDelegatesWithoutRole(blocked.reason);
			assert.equal(launched.kind, "ready", command);
			assert.equal(launched.role, "explore", command);
			assert.equal(launched.contract.tools.includes("bash"), false, command);
			assert.equal(jev.requests.length, 1, command);
			assert.equal(jev.requests[0].state.user_request, message, command);
		}
	});
});

test("Jev is asked through Pi's classifier registry as typesafe/jev-latest with the turn's signal", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map the launcher module";
		const jev = fakeJev("leave");
		const turn = new AbortController();
		const ctx = { ...gateContext(worktree, branchEnding(message), jev), signal: turn.signal };
		const blocked = await launcherFor().gateToolCall(
			{ toolName: "grep", input: { pattern: "judge" } },
			ctx,
		);
		const launched = await launcherFor().prepareLaunch(
			{
				role: "explore",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);

		assertDelegatesWithoutRole(blocked.reason);
		assert.equal(launched.kind, "ready");
		assert.equal(jev.requests.length, 2);
		assert.equal(jev.options[0].signal, turn.signal);
		assert.equal(jev.options[1].signal, turn.signal);
	});
});

test("without typesafe/jev-latest in the registry, or with only another provider's Jev, the launch is blocked", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export and its test";
		const absent = fakeJev("leave");
		const missing = gateContext(worktree, branchEnding(message), absent);
		missing.modelRegistry.findOfType = () => undefined;
		const elsewhere = classifierRegistry(() => ({}), { provider: "openrouter" });
		const other = gateContext(worktree, branchEnding(message), elsewhere);
		other.modelRegistry.getApiKeyForProvider = async (provider) =>
			provider === "openrouter" ? "openrouter-key" : undefined;
		for (const ctx of [missing, other]) {
			const blocked = await launcherFor().gateToolCall(
				{ toolName: "edit", input: { path: "src/export.ts" } },
				ctx,
			);
			const decided = await launcherFor().prepareLaunch(
				{
					role: "worker",
					task: "parent paraphrase",
					userRequest: message,
					userMessageId: message,
				},
				ctx,
			);

			assert.equal(blocked.allow, false);
			assert.match(blocked.reason, /Launch blocked/);
			assert.match(blocked.reason, /typesafe\/jev-latest/);
			assert.doesNotMatch(blocked.reason, /stays|spawn_child/);
			assert.equal(decided.kind, "blocked");
			assert.equal("role" in decided, false);
		}
		assert.equal(absent.requests.length, 0);
		assert.equal(elsewhere.requests.length, 0);
	});
});

test("a classification that does not stop, including a cancelled turn, blocks the launch and invents no verdict", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export and its test";
		for (const stopReason of ["error", "aborted"]) {
			const jev = fakeJev(() => ({
				stopReason,
				errorMessage: `Jev ${stopReason}`,
				answers: {
					destination: choiceAnswer("stay", { stay: "" }),
				},
			}));
			const ctx = gateContext(worktree, branchEnding(message), jev);
			const blocked = await launcherFor().gateToolCall(
				{ toolName: "bash", input: { command: "ls" } },
				ctx,
			);
			const decided = await launcherFor().prepareLaunch(
				{
					role: "worker",
					task: "parent paraphrase",
					userRequest: message,
					userMessageId: message,
				},
				ctx,
			);

			assert.equal(blocked.allow, false, stopReason);
			assert.match(blocked.reason, /Launch blocked/, stopReason);
			assert.match(blocked.reason, new RegExp(`Jev ${stopReason}`), stopReason);
			assert.doesNotMatch(blocked.reason, /stays|spawn_child/, stopReason);
			assert.equal(decided.kind, "blocked", stopReason);
			assert.equal("role" in decided, false, stopReason);
		}
	});
});

test("Launch blocked is not kept: the next gated tool and the next launch for the same message ask Jev again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map the launcher module";
		let failing = true;
		const jev = fakeJev((context) =>
			failing
				? { stopReason: "error", errorMessage: "Jev is down" }
				: {
						answers: {
							destination: choiceAnswer("leave", context.questions.destination.criteria),
						},
					},
		);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const first = await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "judge" } },
			ctx,
		);
		const second = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "src/main.ts" } },
			ctx,
		);
		const blockedLaunch = await launcher.prepareLaunch(
			{
				role: "explore",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);
		failing = false;
		const launched = await launcher.prepareLaunch(
			{
				role: "explore",
				task: "parent paraphrase",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);
		const third = await launcher.gateToolCall(
			{ toolName: "ls", input: { path: "." } },
			ctx,
		);

		assert.match(first.reason, /Launch blocked/);
		assert.match(second.reason, /Launch blocked/);
		assert.equal(blockedLaunch.kind, "blocked");
		assert.equal(launched.kind, "ready");
		assert.equal(launched.role, "explore");
		assertDelegatesWithoutRole(third.reason);
		assert.equal(jev.requests.length, 4);
	});
});

async function seatedExtension({ worktree, agentDirectory }, message) {
	const extension = loadExtension({
		agentDirectory,
	});
	seatEverything();
	await extension.fire("session_start", {}, {
		mode: "print",
		hasUI: true,
		ui: extension.ui,
		cwd: worktree,
		sessionManager: {
			getBranch: () => branchEnding(message),
			getEntries: () => [],
		},
	});
	return extension;
}

test("a Jev delegation blocks execution without painting the tool as failed, including after resume", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const message = "Review the PR";
		const extension = await seatedExtension({ worktree, agentDirectory }, message);
		const ctx = gateContext(worktree, branchEnding(message), fakeJev("leave"));
		const call = { type: "toolCall", id: "routing-read", name: "read", arguments: { path: "src/main.ts" } };
		let executions = 0;
		const tools = [];
		syncCompactTools({ registerTool: (tool) => tools.push(tool) }, {
			cwd: worktree, isProjectTrusted: () => false,
		});
		const read = tools.find((tool) => tool.name === "read");
		const runtime = await ModelRuntime.create({
			authPath: join(agentDirectory, "auth.json"), modelsPath: null, refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "faux", models: [{ id: "parent", reasoning: true }] });
		runtime.registerNativeProvider(faux.provider);
		await runtime.setRuntimeApiKey("faux", "key");
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall(call.name, call.arguments, { id: call.id }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Delegating."),
		]);
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: worktree, agentDir: agentDirectory, settingsManager,
			noExtensions: true, noSkills: true, noContextFiles: true,
			extensionFactories: [(pi) => {
				pi.registerTool({ ...read, execute: async () => { executions++; return { content: [], details: {} }; } });
				pi.on("tool_call", (event) => extension.fire("tool_call", event, ctx));
			}],
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: worktree, agentDir: agentDirectory, modelRuntime: runtime, model: faux.getModel(),
			resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(worktree),
		});
		try {
			await session.bindExtensions({ mode: "rpc" });
			await session.prompt(message);
		} finally {
			session.dispose();
		}
		const result = session.messages.find((entry) => entry.role === "toolResult");
		assert.equal(executions, 0);
		assert.equal(result.isError, true);
		const theme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => text };
		const render = () => read.renderCall(call.arguments, theme, {
			toolCallId: call.id, isError: result.isError, isPartial: false,
			expanded: false, state: {},
		}).render(160).join("\n");
		assert.match(render(), /Delegated by Jev/);
		assert.doesNotMatch(render(), /<error>/);
		const entries = structuredClone(extension.entries);
		await extension.fire("session_tree", {}, { sessionManager: { getBranch: () => [] } });
		assert.match(render(), /<error>/);
		await extension.fire("session_tree", {}, { sessionManager: { getBranch: () => entries } });
		assert.match(render(), /Delegated by Jev/);
		assert.doesNotMatch(render(), /<error>/);
	});
});

test("only valid routing blocks get neutral presentation; classifier and tool errors remain errors", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		for (const [destination, isError, label] of [
			["decide", true, "Decision needed"],
			["invalid", true, undefined],
			["stay", true, undefined],
			["stay", false, undefined],
		]) {
			const message = `Route ${destination} ${isError}`;
			const extension = await seatedExtension({ worktree, agentDirectory }, message);
			const id = `call-${destination}-${isError}`;
			const args = { path: "src/main.ts" };
			const gate = await extension.fire("tool_call", {
				type: "tool_call", toolCallId: id, toolName: "read", input: args,
			}, gateContext(worktree, branchEnding(message), fakeJev(destination)));
			assert.equal(gate?.block, destination === "stay" ? undefined : true);
			const tools = [];
			syncCompactTools({ registerTool: (tool) => tools.push(tool) }, {
				cwd: worktree, isProjectTrusted: () => false,
			});
			const read = tools.find((tool) => tool.name === "read");
			const theme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => text };
			for (const expanded of [false, true]) {
				const output = read.renderCall(args, theme, {
					toolCallId: id, isError, isPartial: false, expanded, state: {},
				}).render(160).join("\n");
				if (label) assert.ok(output.includes(label));
				if (!expanded || label) assert.equal(output.includes("<error>"), isError && !label);
			}
			assert.equal(extension.entries.filter((entry) => entry.customType === "pi-workflow-routing-block").length, label ? 1 : 0);
		}
	});
});

test("a gated tool called from a codemode script follows the direct verdict and its block also reaches the parent model", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const message = "Map the launcher module";
		const jev = fakeJev("leave");
		const extension = await seatedExtension({ worktree, agentDirectory }, message);
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const direct = await extension.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c1", toolName: "grep", input: { pattern: "map" } },
			ctx,
		);
		assert.equal(extension.messages.length, 0);
		const nested = await extension.fire(
			"tool_call",
			{
				type: "tool_call",
				toolCallId: "c2/1",
				parentToolCallId: "c2",
				toolName: "read",
				input: { path: "src/main.ts" },
			},
			ctx,
		);

		assert.equal(direct.block, true);
		assert.deepEqual(nested, direct);
		assert.equal(jev.requests.length, 1);
		assert.equal(extension.messages.length, 1);
		assert.equal(extension.messages[0].message.content, direct.reason);
		assert.equal(extension.messages[0].message.display, true);
		assert.equal(extension.messages[0].options.deliverAs, "steer");
	});
});

test("while routing is on, a codemode script runs after leave and its nested calls follow a stay", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const message = "Map the launcher module";
		const left = fakeJev("leave");
		const leaving = await seatedExtension({ worktree, agentDirectory }, message);
		const leaveCtx = gateContext(worktree, branchEnding(message), left);
		await leaving.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c1", toolName: "bash", input: { command: "ls" } },
			leaveCtx,
		);
		const script = await leaving.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c2", toolName: "codemode", input: { code: "text(1)" } },
			leaveCtx,
		);
		assert.equal(script, undefined);
		assert.equal(left.requests.length, 1);

		const stayed = fakeJev("stay");
		const staying = await seatedExtension({ worktree, agentDirectory }, message);
		const nested = await staying.fire(
			"tool_call",
			{
				type: "tool_call",
				toolCallId: "c3/1",
				parentToolCallId: "c3",
				toolName: "grep",
				input: { pattern: "map" },
			},
			gateContext(worktree, branchEnding(message), stayed),
		);
		assert.equal(nested, undefined);
		assert.equal(staying.messages.length, 0);
		assert.equal(stayed.requests.length, 1);
	});
});

test("after a launch for the message under leave, gated parent tools run without asking Jev again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Research three files in parallel and tell me the package version";
		const jev = fakeJev("leave");
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const before = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "package.json" } },
			ctx,
		);
		const launch = await launcher.prepareLaunch(
			{
				role: "explore",
				task: "Research the three files",
				userRequest: message,
				userMessageId: message,
			},
			ctx,
		);
		launcher.recordLaunch(message);
		const after = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "package.json" } },
			ctx,
		);
		const afterCodegraph = await launcher.gateToolCall(
			{ toolName: "codegraph", input: { action: "explore", query: "x" } },
			ctx,
		);

		assert.equal(before.allow, false);
		assertDelegatesWithoutRole(before.reason);
		assert.equal(launch.kind, "ready");
		assert.deepEqual(after, { allow: true });
		assert.deepEqual(afterCodegraph, { allow: true });
		assert.equal(jev.requests.length, 1);
	});
});

test("a launch for one message does not unblock the next message under leave", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev("leave");
		const launcher = launcherFor();
		const first = gateContext(worktree, branchEnding("First delegated request"), jev);
		await launcher.prepareLaunch(
			{
				role: "worker",
				task: "t",
				userRequest: "First delegated request",
				userMessageId: "First delegated request",
			},
			first,
		);
		launcher.recordLaunch("First delegated request");
		const next = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "package.json" } },
			gateContext(worktree, branchEnding("Second delegated request"), jev),
		);

		assert.equal(next.allow, false);
		assert.equal(jev.requests.length, 2);
	});
});

test("a new message with the same text gets its own verdict and no launch from the earlier message", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Research three files in parallel and tell me the package version";
		const jev = fakeJev("leave");
		const launcher = launcherFor();
		const earlier = gateContext(worktree, branchEnding(message, undefined, "first"), jev);
		await launcher.gateToolCall(
			{ toolName: "read", input: { path: "package.json" } },
			earlier,
		);
		await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "version" } },
			earlier,
		);
		launcher.recordLaunch("first");
		const repeated = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "package.json" } },
			gateContext(worktree, branchEnding(message, undefined, "second"), jev),
		);

		assert.equal(repeated.allow, false);
		assert.equal(jev.requests.length, 2);
	});
});

function scriptJev(destinations) {
	const order = [];
	let firstDone = false;
	const jev = fakeJev((context) => {
		const index = order.length;
		order.push({ task: context.state.task, afterFirst: firstDone });
		return destinations[index] ?? "leave";
	});
	const classify = jev.registry.classify;
	jev.registry.classify = async (...args) => {
		const result = await classify(...args);
		await new Promise((resolve) => setImmediate(resolve));
		firstDone = true;
		return result;
	};
	return { ...jev, order };
}

function launchFor(launcher, ctx, message, task, role) {
	return launcher.prepareLaunch(
		{ role, task, userRequest: message, userMessageId: message },
		ctx,
	);
}

test("each launch of a script keeps the role its parent named and the first launch alone decides the destination", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map, change, and verify the launcher";
		const jev = scriptJev(["leave", "stay", "decide"]);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const launches = await Promise.all([
			launchFor(launcher, ctx, message, "map the launcher", "explore"),
			launchFor(launcher, ctx, message, "change the launcher", "worker"),
			launchFor(launcher, ctx, message, "verify the launcher", "verify"),
		]);

		assert.deepEqual(
			launches.map((launch) => [launch.kind, launch.role, launch.chosenBy]),
			[
				["ready", "explore", "parent"],
				["ready", "worker", "parent"],
				["ready", "verify", "parent"],
			],
		);
		assert.equal(jev.requests.length, 1);
	});
});

test("a script launch with an invalid Jev answer is Launch blocked, is not kept, and the next launch decides", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map, change, and verify the launcher";
		const jev = scriptJev(["invalid", "leave", "stay"]);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const launches = await Promise.all([
			launchFor(launcher, ctx, message, "map the launcher", "explore"),
			launchFor(launcher, ctx, message, "change the launcher", "worker"),
			launchFor(launcher, ctx, message, "verify the launcher", "verify"),
		]);
		const gate = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "src/main.ts" } },
			ctx,
		);

		assert.deepEqual(launches.map((launch) => launch.kind).sort(), [
			"blocked",
			"ready",
			"ready",
		]);
		const blocked = launches.find((launch) => launch.kind === "blocked");
		assert.equal(blocked.warning, "Launch blocked. No child was launched.");
		assert.equal(jev.requests.length, 2);
		assert.equal(gate.allow, false);
		assertDelegatesWithoutRole(gate.reason);
		assert.equal(jev.requests.length, 2);
	});
});

test("later launches of a message reuse its destination and never classify again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map and change the launcher";
		let failing = false;
		const jev = fakeJev(() =>
			failing ? { stopReason: "error", errorMessage: "Jev is down" } : "leave",
		);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const first = await launchFor(launcher, ctx, message, "map the launcher", "explore");
		failing = true;
		const second = await launchFor(launcher, ctx, message, "change the launcher", "worker");
		const third = await launchFor(launcher, ctx, message, "verify the launcher", "verify");
		const gate = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "src/main.ts" } },
			ctx,
		);

		assert.deepEqual(
			[first, second, third].map((launch) => [launch.kind, launch.role]),
			[
				["ready", "explore"],
				["ready", "worker"],
				["ready", "verify"],
			],
		);
		assertDelegatesWithoutRole(gate.reason);
		assert.equal(jev.requests.length, 1);
	});
});

test("a gate verdict of stay or decide refuses every launch of the message without asking Jev", async () => {
	await withWorkspace(async ({ worktree }) => {
		for (const [destination, warning] of [
			["stay", "The work stays in this session. No child was launched."],
			["decide", "Ask the user one question and wait. No child was launched."],
		]) {
			const message = `Keep it here (${destination})`;
			const jev = fakeJev(destination);
			const launcher = launcherFor();
			const ctx = gateContext(worktree, branchEnding(message), jev);
			await launcher.gateToolCall({ toolName: "read", input: { path: "a.ts" } }, ctx);
			const launches = await Promise.all([
				launchFor(launcher, ctx, message, "map", "explore"),
				launchFor(launcher, ctx, message, "change", "worker"),
			]);

			assert.deepEqual(
				launches.map((launch) => [launch.kind, launch.warning]),
				[
					[destination, warning],
					[destination, warning],
				],
				destination,
			);
			assert.equal(jev.requests.length, 1, destination);
		}
	});
});

test("with Jev routing off, a script's named roles launch and Jev is not called", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map and change the launcher";
		const jev = fakeJev("leave");
		const launcher = launcherFor({ jevRouting: { enabled: () => false } });
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const launches = await Promise.all([
			launchFor(launcher, ctx, message, "map the launcher", "explore"),
			launchFor(launcher, ctx, message, "change the launcher", "worker"),
			launchFor(launcher, ctx, message, "verify the launcher", "verify"),
		]);

		assert.deepEqual(
			launches.map((launch) => [launch.role, launch.chosenBy]),
			[
				["explore", "parent"],
				["worker", "parent"],
				["verify", "parent"],
			],
		);
		assert.equal(jev.requests.length, 0);
	});
});

test("several blocked inner calls of a script in one turn send one gate message while each call gets its reason", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const message = "Map the launcher module";
		const jev = fakeJev("leave");
		const extension = await seatedExtension({ worktree, agentDirectory }, message);
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const nested = (id, toolName, input) =>
			extension.fire(
				"tool_call",
				{ type: "tool_call", toolCallId: `c1/${id}`, parentToolCallId: "c1", toolName, input },
				ctx,
			);
		const blocked = await Promise.all([
			nested(1, "read", { path: "src/a.ts" }),
			nested(2, "grep", { pattern: "launch" }),
			nested(3, "ls", { path: "." }),
		]);
		assert.deepEqual(
			blocked.map((result) => result.block),
			[true, true, true],
		);
		assert.ok(blocked.every((result) => result.reason === blocked[0].reason));
		assert.equal(extension.messages.length, 1);

		await extension.fire("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1 }, ctx);
		await nested(4, "read", { path: "src/b.ts" });
		assert.equal(extension.messages.length, 2);
	});
});

test("after a stay, a direct read on the next message names its own verdict and a launch for it proceeds", async () => {
	await withWorkspace(async ({ worktree }) => {
		const jev = scriptJev(["stay", "leave"]);
		const launcher = launcherFor();
		const branch = branchEnding("Revisa de nuevo el PR 941", undefined, "review");
		const ctx = gateContext(worktree, branch, jev);
		const declined = [];
		for (const task of ["Standards", "Spec", "Valuable Tests"]) {
			declined.push(await launchFor(launcher, ctx, "review", task, "verify"));
		}
		branch.push({
			id: "direct",
			type: "message",
			message: { role: "user", content: "Revísalo tú directamente" },
		});
		const gated = await launcher.gateToolCall(
			{
				toolName: "bash",
				input: { command: "gh pr view 941 --json headRefOid && git diff c7db f674 --" },
			},
			ctx,
		);
		const launched = await launchFor(launcher, ctx, "direct", "Standards", "verify");

		assert.deepEqual(
			declined.map(({ kind, reason }) => [kind, reason]),
			Array(3).fill([
				"stay",
				"Jev answered that the work for this user message stays. Do it in this session with your own tools.",
			]),
		);
		assert.equal(gated.allow, false);
		assert.equal(
			gated.reason,
			"Jev answered that the work for the latest user message leaves this session; a verdict for an earlier message does not carry over. Call spawn_child with the role whose tools cover the task; this message's verdict allows the launch. If procedure instructions are needed, delegate bounded discovery of obligations, prerequisites, sources, and unresolved questions before dependent work.",
		);
		assertDelegatesWithoutRole(gated.reason);
		assert.equal(launched.kind, "ready");
		assert.equal(jev.order.length, 2);
	});
});


for (const destination of ["off", "stay", "leave"]) {
	for (const purpose of ["Read review instructions", "Review the skill itself"]) {
		test(`${purpose}: skill and references are ordinary reads with routing ${destination}`, async () => {
			await withWorkspace(async ({ worktree }) => {
				const dir = join(worktree, ".pi/skills/review");
				await mkdir(dir, { recursive: true });
				await writeFile(join(dir, "SKILL.md"), "Read [scope](scope.md).\n");
				await writeFile(join(dir, "scope.md"), "Scope must pass before judgment.\n");
				const jev = fakeJev(destination === "off" ? "leave" : destination);
				const launcher = launcherFor(destination === "off" ? { jevRouting: { enabled: () => false } } : {});
				const ctx = gateContext(worktree, branchEnding(purpose), jev);
				for (const name of ["SKILL.md", "scope.md", "missing.md"]) {
					const result = await launcher.gateToolCall({ toolName: "read", input: { path: join(dir, name) } }, ctx);
					assert.equal(result.allow, destination !== "leave", name);
					if (destination === "leave") assert.match(result.reason, /spawn_child/);
				}
				assert.equal(jev.requests.length, destination === "off" ? 0 : 1);
			});
		});
	}
}

test("unrelated tools do not need a session branch", async () => {
	const launcher = launcherFor();
	const ctx = { cwd: "/", sessionManager: { getBranch() { throw new Error("No branch for unrelated tool"); } } };
	assert.deepEqual(await launcher.gateToolCall({ toolName: "record_review_state", input: {} }, ctx), { allow: true });
});

test("a real Pi parent receives a routing block for direct procedure reads", async () => {
	await withWorkspace(async ({ worktree, agentDirectory }) => {
		const dir = join(worktree, ".pi/skills/review");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "Read [scope](scope.md).\n");
		await writeFile(join(dir, "scope.md"), "Scope must pass before judgment.\n");
		const jev = fakeJev("leave");
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding("Review PR"), jev);
		const runtime = await ModelRuntime.create({ authPath: join(agentDirectory, "auth.json"), modelsPath: null, refreshOnCreate: false });
		const faux = fauxProvider({ provider: "faux", models: [{ id: "parent", reasoning: true }] });
		runtime.registerNativeProvider(faux.provider);
		await runtime.setRuntimeApiKey("faux", "key");
		faux.setResponses([
			...["SKILL.md", "scope.md", "missing.md"].map((name) => fauxAssistantMessage(fauxToolCall("read", { path: join(dir, name) }), { stopReason: "toolUse" })),
			fauxAssistantMessage("Transport characterization only."),
		]);
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: worktree, agentDir: agentDirectory, settingsManager,
			noExtensions: true, noSkills: true, noContextFiles: true,
			extensionFactories: [(pi) => {
				pi.on("tool_call", async (event) => {
					const result = await launcher.gateToolCall(event, ctx);
					if (!result.allow) return { block: true, reason: result.reason };
				});
			}],
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({ cwd: worktree, agentDir: agentDirectory, modelRuntime: runtime, model: faux.getModel(), resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(worktree) });
		try {
			await session.bindExtensions({ mode: "rpc" });
			await session.prompt("Review PR");
			const results = session.messages.filter((message) => message.role === "toolResult");
			assert.equal(results.length, 3);
			for (const result of results) {
				assert.equal(result.isError, true);
				assert.match(JSON.stringify(result.content), /spawn_child/);
			}
		} finally { session.dispose(); }
	});
});
