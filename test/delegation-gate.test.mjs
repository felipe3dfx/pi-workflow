import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import { capabilities, replaceSelection } from "../extensions/configure.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { classifierRegistry } from "./support/fake-jev.mjs";
import { turnJevRoutingOn } from "./support/jev-routing.mjs";

turnJevRoutingOn();

const absentProfiles = { load: () => ({ status: "absent" }) };
const specialists = ["explorer", "worker", "verifier"];

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
		const named = specialists.includes(text);
		const answers = {};
		if (questions.specialist) {
			answers.specialist = choiceAnswer(
				named ? text : "worker",
				questions.specialist.criteria,
				confidence,
			);
		}
		if (questions.destination) {
			const picked = ["stay", "leave", "decide"].includes(text) ? text : "leave";
			answers.destination = choiceAnswer(
				picked,
				questions.destination.criteria,
				confidence,
			);
		}
		return { answers };
	});
}

function branchEnding(text, older = "Use a child for the old turn") {
	return [
		{ type: "message", message: { role: "user", content: older } },
		{
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "Waiting." }] },
		},
		{
			type: "message",
			message: { role: "user", content: [{ type: "text", text }] },
		},
		{ type: "message", message: { role: "user", content: "   " } },
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

function launcherFor(options = {}) {
	return createChildLauncher({ modelProfiles: absentProfiles, ...options });
}

async function withWorkspace(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-delegation-gate-"));
	try {
		const worktree = join(dir, "repo");
		await mkdir(worktree);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		return await run({ worktree });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function loadExtension({ legacy = false, profilesPath }) {
	const handlers = new Map();
	const tools = [];
	const notifications = [];
	const messages = [];
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
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
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
			modelProfiles: { path: profilesPath },
		},
	);
	const fire = async (event, payload = {}, ctx = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? []) {
			result = await handler(payload, ctx);
		}
		return result;
	};
	return { handlers, tools, fire, notifications, messages, ui };
}

test("the first grep blocks when Jev says leave, names the role, and asks destination", async () => {
	const message = "Find where launch decides to stay";
	const jev = fakeJev("explorer", 0.2);
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
	assert.match(result.reason, /\bexplore\b/);
	assert.equal(jev.requests.length, 1);
	const request = jev.requests[0];
	assert.deepEqual(Object.keys(request.questions).sort(), [
		"destination",
		"specialist",
	]);
	assert.equal(request.questions.destination.type, "choice");
	assert.equal(request.questions.specialist.type, "choice");
	assert.equal(request.questions.choice, undefined);
	assert.equal(request.state.delegation_intent, "optional");
	assert.equal(request.state.task, message);
	assert.equal(request.state.user_request, message);
	assert.equal("suggested_specialist" in request.state, false);
});

test("the second gated tool in the turn does not call Jev again", async () => {
	const jev = fakeJev("worker");
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
	assert.match(second.reason, /\bworker\b/);
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
			{ role: "explore", task: "parent paraphrase", userRequest: message },
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
		assert.equal(jev.requests[0].state.delegation_intent, "optional");
		assert.equal(jev.requests[0].state.user_request, message);
		assert.equal(jev.requests[0].questions.destination.type, "choice");
	});
});

test("explicit child text blocks a read and does not ask where the work should go", async () => {
	for (const message of ["Revisa esto con un hijo", "Read the file with a child"]) {
		const jev = fakeJev("worker");
		const launcher = launcherFor();
		const result = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "src/main.ts" } },
			gateContext("/work", branchEnding(message, "Look at the previous note"), jev),
		);

		assert.equal(result.allow, false);
		assert.match(result.reason, /spawn_child/);
		assert.match(result.reason, /\bworker\b/);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.delegation_intent, "explicit");
		assert.equal(jev.requests[0].state.user_request, message);
		assert.equal(jev.requests[0].questions.destination, undefined);
		assert.deepEqual(Object.keys(jev.requests[0].questions), ["specialist"]);
	}
});

test("a read of AGENTS.md does not call Jev or block, and the next grep asks once", async () => {
	const cwd = "/work";
	const jev = fakeJev("explorer");
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

	launcher.beginTurn();
	const escaped = await launcher.gateToolCall(
		{ toolName: "read", input: { path: "../AGENTS.md" } },
		ctx,
	);
	assert.equal(escaped.allow, false);
	assert.equal(jev.requests.length, 1);
});

test("codegraph init is not gated and codegraph explore is", async () => {
	const jev = fakeJev("explorer");
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
	assert.match(explored.reason, /\bexplore\b/);
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
				specialist: {
					type: "choice",
					choice: "architect",
					confidence: 0.2,
					probabilities: { explorer: 0.4, worker: 0.4, verifier: 0.2 },
				},
				destination: {
					type: "choice",
					choice: "leave",
					confidence: 0.8,
					probabilities: { stay: 0.1, leave: 0.9 },
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
			{ role: "worker", task: "parent paraphrase", userRequest: message },
			ctx,
		);

		assert.equal(result.allow, false);
		assert.match(result.reason, /Launch blocked/);
		assert.match(result.reason, /invalid selection/);
		assert.doesNotMatch(result.reason, /stays/);
		assert.equal(decided.kind, "blocked");
		assert.equal(decided.warning, "Launch blocked. No child was launched.");
		assert.doesNotMatch(decided.warning, /stays/);
		assert.equal(decided.jev.answers.specialist.choice, "architect");
		assert.equal(decided.jev.answers.specialist.confidence, 0.2);
		assert.equal(jev.requests.length, 2);
	});
});

test("decide() after a leave verdict asks Jev once and launches the cached role", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Compare the two implementations";
		const jev = fakeJev("explorer", 0.2);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const blocked = await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "compare" } },
			ctx,
		);
		const result = await launcher.prepareLaunch(
			{ role: "worker", task: "parent paraphrase", userRequest: message },
			ctx,
		);

		assert.equal(blocked.allow, false);
		assert.match(blocked.reason, /\bexplore\b/);
		assert.equal(result.kind, "ready");
		assert.equal(result.role, "explore");
		assert.equal(result.task, "parent paraphrase");
		assert.equal(result.model, "session/model");
		assert.equal(result.thinking, "medium");
		assert.ok(result.contract.tools.includes("read"));
		assert.equal(result.jev.answers.specialist.confidence, 0.2);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.task, message);
		assert.equal(jev.requests[0].state.user_request, message);
		assert.equal("suggested_specialist" in jev.requests[0].state, false);
		assert.equal(jev.requests[0].questions.destination.type, "choice");
	});
});

test("decide() stores the verdict so a later gated tool does not ask Jev again", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export";
		const jev = fakeJev("verifier", 0.15);
		const launcher = launcherFor();
		const ctx = gateContext(worktree, branchEnding(message), jev);
		const result = await launcher.prepareLaunch(
			{
				role: "worker",
				task: "Add the missing export",
				userRequest: message,
			},
			ctx,
		);
		const blocked = await launcher.gateToolCall(
			{ toolName: "edit", input: { path: "src/export.ts" } },
			ctx,
		);

		assert.equal(result.kind, "ready");
		assert.equal(result.role, "verify");
		assert.equal(result.jev.answers.specialist.confidence, 0.15);
		assert.equal(blocked.allow, false);
		assert.match(blocked.reason, /\bverify\b/);
		assert.equal(jev.requests.length, 1);
		assert.equal(jev.requests[0].state.suggested_specialist, "worker");
	});
});

test("beginTurn keeps the verdict, the next operator message asks again, and unseating lets the tool run", async () => {
	const jev = fakeJev("explorer");
	let seated = true;
	const launcher = launcherFor({ childSessionSeated: () => seated });
	const ctx = gateContext("/work", branchEnding("Map the launcher module"), jev);
	await launcher.gateToolCall(
		{ toolName: "find", input: { pattern: "judge" } },
		ctx,
	);
	assert.equal(jev.requests.length, 1);
	launcher.beginTurn();
	const again = await launcher.gateToolCall(
		{ toolName: "ls", input: { path: "extensions" } },
		ctx,
	);
	assert.equal(again.allow, false);
	assert.equal(jev.requests.length, 1);

	seated = false;
	assert.deepEqual(
		await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "gate" } },
			ctx,
		),
		{ allow: true },
	);
	assert.equal(jev.requests.length, 1);

	seated = true;
	const next = gateContext("/work", branchEnding("A later operator message"), jev);
	const refreshed = await launcher.gateToolCall(
		{ toolName: "grep", input: { pattern: "gate" } },
		next,
	);
	assert.equal(refreshed.allow, false);
	assert.equal(jev.requests.length, 2);
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
	const jev = fakeJev("explorer");
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
	await withWorkspace(async ({ worktree }) => {
		const jev = fakeJev("explorer");
		const allowed = loadExtension({
			profilesPath: join(worktree, "missing-profiles.json"),
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
		assert.equal(allowed.handlers.get("turn_start").length, 1);

		const ctx = gateContext(worktree, branchEnding("Map the launcher module"), jev);
		const first = await allowed.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c1", toolName: "grep", input: { pattern: "map" } },
			ctx,
		);
		assert.equal(first.block, true);
		assert.equal(jev.requests.length, 1);
		await allowed.fire(
			"turn_start",
			{ type: "turn_start", turnIndex: 1, timestamp: 1 },
			ctx,
		);
		await allowed.fire(
			"tool_call",
			{ type: "tool_call", toolCallId: "c2", toolName: "ls", input: { path: "." } },
			ctx,
		);
		assert.equal(jev.requests.length, 1);

		const blocked = loadExtension({
			legacy: true,
			profilesPath: join(worktree, "missing-profiles.json"),
		});
		await blocked.fire("session_start", {}, { ...session, ui: blocked.ui });
		assert.equal(blocked.tools.some((tool) => tool.name === "spawn_child"), false);
		assert.equal(blocked.handlers.get("tool_call"), undefined);
		assert.equal(blocked.handlers.get("turn_start"), undefined);
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
			{ task: "parent paraphrase", userRequest: message },
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

test("with Jev routing on, a named skill fixes neither the destination nor the specialist", async () => {
	await withWorkspace(async ({ worktree }) => {
		for (const [message, answer, role] of [
			["Usa implement en este paquete", "explorer", "explore"],
			["Usa la skill tdd para este ticket", "verifier", "verify"],
			["Corre code-review en este cambio", "worker", "worker"],
			["prototype ya está aprobado", "explorer", "explore"],
		]) {
			const jev = fakeJev(answer);
			const launcher = launcherFor();
			const ctx = gateContext(worktree, branchEnding(message), jev);
			const blocked = await launcher.gateToolCall(
				{ toolName: "grep", input: { pattern: "ticket" } },
				ctx,
			);
			const decided = await launcher.prepareLaunch(
				{ role: "worker", task: "parent paraphrase", userRequest: message },
				ctx,
			);

			assert.equal(blocked.allow, false, message);
			assert.equal(blocked.reason, `Call spawn_child. Jev selected the ${role} role.`);
			assert.equal(decided.kind, "ready", message);
			assert.equal(decided.role, role, message);
			assert.equal("skill" in decided, false, message);
			assert.equal(decided.jev.answers.specialist.choice, answer, message);
			assert.equal(jev.requests.length, 1, message);
			assert.equal(jev.requests[0].state.user_request, message);
			assert.ok(jev.requests[0].questions.destination, message);
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

		const suggested = fakeJev("verifier");
		const suggestedMessage = "Usa implement en este paquete";
		const suggestedLauncher = launcherFor();
		const fromTool = await suggestedLauncher.prepareLaunch(
			{ role: "worker", task: "Implement the ticket", userRequest: suggestedMessage },
			gateContext(worktree, branchEnding(suggestedMessage), suggested),
		);
		assert.equal(fromTool.kind, "ready");
		assert.equal(fromTool.role, "verify");
		assert.equal(suggested.requests[0].state.suggested_specialist, "worker");

		const explicit = fakeJev("explorer");
		const explicitMessage = "Quiero un subagente para domain-modeling y hazlo";
		const explicitLauncher = launcherFor();
		const delegated = await explicitLauncher.prepareLaunch(
			{ task: "parent paraphrase", userRequest: explicitMessage },
			gateContext(worktree, branchEnding(explicitMessage), explicit),
		);
		assert.equal(delegated.kind, "ready");
		assert.equal(delegated.role, "explore");
		assert.equal(explicit.requests.length, 1);
		assert.equal(explicit.requests[0].state.delegation_intent, "explicit");
		assert.equal(explicit.requests[0].questions.destination, undefined);
	});
});

test("a missing TypeSafe key blocks the gated tool and the launch without inventing stay or worker", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export and its test";
		const jev = fakeJev("worker");
		const ctx = gateContext(worktree, branchEnding(message), jev);
		ctx.modelRegistry.getApiKeyForProvider = async () => undefined;
		const blocked = await launcherFor().gateToolCall(
			{ toolName: "edit", input: { path: "src/export.ts" } },
			ctx,
		);
		const decided = await launcherFor().prepareLaunch(
			{ task: "parent paraphrase", userRequest: message },
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

test("while routing is on, Jev can leave git and gh work to a specialist and explore still has no shell", async () => {
	await withWorkspace(async ({ worktree }) => {
		for (const command of ["git status", "gh pr list"]) {
			const message = `Run ${command} and report what you find`;
			const jev = fakeJev("explorer");
			const launcher = launcherFor();
			const ctx = gateContext(worktree, branchEnding(message), jev);
			const blocked = await launcher.gateToolCall(
				{ toolName: "bash", input: { command } },
				ctx,
			);
			const launched = await launcherFor().prepareLaunch(
				{ role: "worker", task: command, userRequest: message },
				ctx,
			);

			assert.equal(blocked.allow, false, command);
			assert.match(
				blocked.reason,
				/Call spawn_child\. Jev selected the explore role\./,
				command,
			);
			assert.equal(launched.kind, "ready", command);
			assert.equal(launched.role, "explore", command);
			assert.equal(launched.contract.tools.includes("bash"), false, command);
			assert.equal(jev.requests.length, 2, command);
			assert.equal(jev.requests[0].state.user_request, message, command);
			assert.equal(jev.requests[1].state.task, command, command);
		}
	});
});

test("Jev is asked through Pi's classifier registry as typesafe/jev-latest with the turn's signal", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map the launcher module";
		const jev = fakeJev("explorer");
		const turn = new AbortController();
		const ctx = { ...gateContext(worktree, branchEnding(message), jev), signal: turn.signal };
		const blocked = await launcherFor().gateToolCall(
			{ toolName: "grep", input: { pattern: "judge" } },
			ctx,
		);
		const launched = await launcherFor().prepareLaunch(
			{ task: "parent paraphrase", userRequest: message },
			ctx,
		);

		assert.equal(blocked.reason, "Call spawn_child. Jev selected the explore role.");
		assert.equal(launched.kind, "ready");
		assert.equal(jev.requests.length, 2);
		assert.equal(jev.options[0].signal, turn.signal);
		assert.equal(jev.options[1].signal, turn.signal);
	});
});

test("without typesafe/jev-latest in the registry, or with only another provider's Jev, the launch is blocked", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Add the missing export and its test";
		const absent = fakeJev("worker");
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
				{ task: "parent paraphrase", userRequest: message },
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
					specialist: choiceAnswer("worker", { worker: "" }),
					destination: choiceAnswer("stay", { stay: "" }),
				},
			}));
			const ctx = gateContext(worktree, branchEnding(message), jev);
			const blocked = await launcherFor().gateToolCall(
				{ toolName: "bash", input: { command: "ls" } },
				ctx,
			);
			const decided = await launcherFor().prepareLaunch(
				{ role: "worker", task: "parent paraphrase", userRequest: message },
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
							specialist: choiceAnswer("explorer", context.questions.specialist.criteria),
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
			{ task: "parent paraphrase", userRequest: message },
			ctx,
		);
		failing = false;
		const launched = await launcher.prepareLaunch(
			{ task: "parent paraphrase", userRequest: message },
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
		assert.equal(third.reason, "Call spawn_child. Jev selected the explore role.");
		assert.equal(jev.requests.length, 4);
	});
});

async function seatedExtension(worktree, message) {
	const extension = loadExtension({
		profilesPath: join(worktree, "missing-profiles.json"),
	});
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
		expectations: {},
	});
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

test("a gated tool called from a codemode script follows the direct verdict and its block also reaches the parent model", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Map the launcher module";
		const jev = fakeJev("explorer");
		const extension = await seatedExtension(worktree, message);
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
	await withWorkspace(async ({ worktree }) => {
		const message = "Map the launcher module";
		const left = fakeJev("explorer");
		const leaving = await seatedExtension(worktree, message);
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
		const staying = await seatedExtension(worktree, message);
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
