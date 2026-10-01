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
	const requests = [];
	const fetch = async (_url, init) => {
		const body = JSON.parse(init.body);
		requests.push(body);
		const answered = typeof answer === "function" ? answer(body) : answer;
		if (answered instanceof Response) return answered;
		if (answered && typeof answered === "object") return Response.json(answered);
		const questions = body.questions ?? {};
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
		return Response.json({ model: "jev-1.13.0", id: "req-1", answers });
	};
	return { fetch, requests };
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

function gateContext(cwd, branch) {
	return {
		cwd,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async (provider) =>
				provider === "typesafe" ? "typesafe-key" : undefined,
			getAvailable: () => [],
		},
		sessionManager: { getBranch: () => branch },
	};
}

function launcherFor(fetch, options = {}) {
	return createChildLauncher({ modelProfiles: absentProfiles, fetch, ...options });
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

function loadExtension({ fetch, legacy = false, profilesPath }) {
	const handlers = new Map();
	const tools = [];
	const notifications = [];
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
			sendMessage() {},
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
			childSessions: { fetch },
		},
	);
	const fire = async (event, payload = {}, ctx = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? []) {
			result = await handler(payload, ctx);
		}
		return result;
	};
	return { handlers, tools, fire, notifications, ui };
}

test("the first grep blocks when Jev says leave, names the role, and asks destination", async () => {
	const message = "Find where launch decides to stay";
	const jev = fakeJev("explorer", 0.2);
	const launcher = launcherFor(jev.fetch);
	const input = { pattern: "judge", path: "extensions/child-launcher.ts" };
	const snapshot = { ...input };
	const result = await launcher.gateToolCall(
		{ toolName: "grep", input },
		gateContext("/work", branchEnding(message)),
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
	const launcher = launcherFor(jev.fetch);
	const ctx = gateContext("/work", branchEnding("Map the launcher module"));
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
		const launcher = launcherFor(jev.fetch);
		const ctx = gateContext(worktree, branchEnding(message));
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
		const launcher = launcherFor(jev.fetch);
		const result = await launcher.gateToolCall(
			{ toolName: "read", input: { path: "src/main.ts" } },
			gateContext("/work", branchEnding(message, "Look at the previous note")),
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
	const launcher = launcherFor(jev.fetch);
	const ctx = gateContext(cwd, branchEnding("Find where launch decides to stay"));
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
	const launcher = launcherFor(jev.fetch);
	const ctx = gateContext("/work", branchEnding("Map the launcher module"));
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
			model: "jev-1.13.0",
			id: "req-invalid",
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
		const launcher = launcherFor(jev.fetch);
		const ctx = gateContext(worktree, branchEnding(message));
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
		assert.equal(jev.requests.length, 1);
	});
});

test("decide() after a leave verdict asks Jev once and launches the cached role", async () => {
	await withWorkspace(async ({ worktree }) => {
		const message = "Compare the two implementations";
		const jev = fakeJev("explorer", 0.2);
		const launcher = launcherFor(jev.fetch);
		const ctx = gateContext(worktree, branchEnding(message));
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
		const launcher = launcherFor(jev.fetch);
		const ctx = gateContext(worktree, branchEnding(message));
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
	const launcher = launcherFor(jev.fetch, { childSessionSeated: () => seated });
	const ctx = gateContext("/work", branchEnding("Map the launcher module"));
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
	const next = gateContext("/work", branchEnding("A later operator message"));
	const refreshed = await launcher.gateToolCall(
		{ toolName: "grep", input: { pattern: "gate" } },
		next,
	);
	assert.equal(refreshed.allow, false);
	assert.equal(jev.requests.length, 2);
});

test("a missing user message does not call Jev or block", async () => {
	const jev = fakeJev("leave");
	const launcher = launcherFor(jev.fetch);
	const branches = [
		undefined,
		[],
		[{ type: "message", message: { role: "assistant", content: "hello" } }],
		[{ type: "message", message: { role: "user", content: "   " } }],
		[{ type: "message", message: { role: "user", content: "" } }],
		[{ type: "message", message: { role: "user", content: [] } }],
	];
	for (const branch of branches) {
		const ctx = gateContext("/work", branch);
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
	const fetch = async (url, init) => {
		const response = jev.fetch(url, init);
		await hold;
		return response;
	};
	const launcher = launcherFor(fetch);
	const ctx = gateContext("/work", branchEnding("Map the launcher module"));
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
			fetch: jev.fetch,
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

		const ctx = gateContext(worktree, branchEnding("Map the launcher module"));
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
			fetch: fakeJev("leave").fetch,
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
		const launcher = launcherFor(jev.fetch);
		const ctx = gateContext(worktree, branchEnding(message));
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

test("a named skill routes without calling Jev, and a parent-owned skill beats an explicit child request", async () => {
	await withWorkspace(async ({ worktree }) => {
		const leave = [
			["feature-review", "verify"],
			["code-review", "verify"],
			["review-critique", "verify"],
			["promotion-readiness", "verify"],
			["mutation-testing", "verify"],
			["simplify", "explore"],
			["scope-audit", "explore"],
			["qa-impact", "explore"],
			["implement", "worker"],
			["tdd", "worker"],
		];
		for (const [skill, role] of leave) {
			const message = `Usa ${skill} en este paquete`;
			const jev = fakeJev("explorer");
			const launcher = launcherFor(jev.fetch);
			const ctx = gateContext(worktree, branchEnding(message));
			const blocked = await launcher.gateToolCall(
				{ toolName: "grep", input: { pattern: skill } },
				ctx,
			);
			const decided = await launcher.prepareLaunch(
				{ role: "explore", task: "parent paraphrase", userRequest: message },
				ctx,
			);

			assert.equal(blocked.allow, false, skill);
			assert.match(
				blocked.reason,
				new RegExp(`The ${skill} skill selected the ${role} role`),
				skill,
			);
			assert.doesNotMatch(blocked.reason, /Jev selected/, skill);
			assert.equal(decided.kind, "ready", skill);
			assert.equal(decided.role, role, skill);
			assert.equal(decided.skill, skill, skill);
			assert.equal("jev" in decided, false, skill);
			assert.equal(jev.requests.length, 0, skill);
		}

		for (const skill of [
			"codebase-design",
			"feature",
			"domain-modeling",
			"to-tickets",
			"create-pr",
		]) {
			const message = `Quiero un subagente para ${skill} y hazlo`;
			const jev = fakeJev("worker");
			const launcher = launcherFor(jev.fetch);
			const ctx = gateContext(worktree, branchEnding(message));
			const allowed = await launcher.gateToolCall(
				{ toolName: "read", input: { path: "src/main.ts" } },
				ctx,
			);
			const decided = await launcher.prepareLaunch(
				{ task: "parent paraphrase", userRequest: message },
				ctx,
			);

			assert.equal(allowed.allow, true, skill);
			assert.equal(decided.kind, "stay", skill);
			assert.equal(
				decided.warning,
				"The work stays in this session. No child was launched.",
				skill,
			);
			assert.match(decided.reason, new RegExp(skill), skill);
			assert.equal(jev.requests.length, 0, skill);
		}
	});
});

test("feature-review wins over feature and implement when the message names all three", async () => {
	const jev = fakeJev("worker");
	const launcher = launcherFor(jev.fetch);
	const message = "Corre feature-review y después implement el feature";
	const blocked = await launcher.gateToolCall(
		{ toolName: "grep", input: { pattern: "brief" } },
		gateContext("/work", branchEnding(message)),
	);

	assert.match(blocked.reason, /feature-review skill selected the verify role/);
	assert.doesNotMatch(blocked.reason, /The feature skill/);
	assert.equal(jev.requests.length, 0);
});

test("approval skills stay until the same message approves the work", async () => {
	await withWorkspace(async ({ worktree }) => {
		for (const skill of [
			"prototype",
			"to-spec",
			"setup-workflow",
			"writing-for-agents",
		]) {
			for (const [message, action] of [
				[`Quiero un subagente para ${skill}`, "stay"],
				[`${skill} ya está aprobado`, "launch"],
			]) {
				const jev = fakeJev("explorer");
				const launcher = launcherFor(jev.fetch);
				const ctx = gateContext(worktree, branchEnding(message));
				const gated = await launcher.gateToolCall(
					{ toolName: "bash", input: { command: "ls" } },
					ctx,
				);
				const decided = await launcher.prepareLaunch(
					{ task: "parent paraphrase", userRequest: message },
					ctx,
				);

				assert.equal(jev.requests.length, 0, message);
				if (action === "stay") {
					assert.equal(gated.allow, true, message);
					assert.match(decided.warning, /stays/, message);
				} else {
					assert.match(
						gated.reason,
						new RegExp(`The ${skill} skill selected the worker role`),
						message,
					);
					assert.equal(decided.kind, "ready", message);
					assert.equal(decided.role, "worker", message);
				}
			}
		}
	});
});
