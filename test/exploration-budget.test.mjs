import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

import { capabilities } from "../extensions/configure.ts";
import {
	createExplorationBudget,
	explorationNotice,
} from "../extensions/exploration-budget.ts";
import { createDelegationMode } from "../extensions/workflow-settings.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { parentSession, realParent, seat } from "./support/workflow-parent.mjs";

let calls = 0;

function lookup(budget, toolName, options = {}) {
	const id = options.id ?? `call-${++calls}`;
	const input = options.input ?? {};
	if (!options.unrecorded)
		budget.call({ toolCallId: id, toolName, parentToolCallId: options.parent });
	return budget.result(
		{
			toolCallId: id,
			toolName,
			input,
			parentToolCallId: options.parent,
			content: [{ type: "text", text: options.text ?? "x" }],
			details: options.details,
			isError: options.isError ?? false,
		},
		options.aborted ?? false,
	);
}

function started() {
	const budget = createExplorationBudget();
	budget.start();
	return budget;
}

function counts(toolName, options) {
	const budget = started();
	for (let i = 0; i < 3; i++) lookup(budget, "read");
	return lookup(budget, toolName, options) !== undefined;
}

test("the fourth discovery lookup of a request crosses the budget once, with its lookups and UTF-8 text bytes", () => {
	const budget = started();
	assert.equal(lookup(budget, "read", { text: "abc" }), undefined);
	assert.equal(lookup(budget, "grep", { text: "é" }), undefined);
	assert.equal(lookup(budget, "find", { text: "" }), undefined);
	assert.deepEqual(lookup(budget, "ls", { text: "ñu" }), {
		lookups: 4,
		textBytes: 8,
	});
	assert.equal(lookup(budget, "read"), undefined);
	assert.equal(lookup(budget, "read", { text: "x".repeat(50_000) }), undefined);
});

test("40,000 UTF-8 text bytes stay within the budget and one more byte crosses it", () => {
	assert.equal(
		lookup(started(), "read", { text: "é".repeat(20_000) }),
		undefined,
	);
	assert.deepEqual(
		lookup(started(), "read", { text: `${"é".repeat(20_000)}x` }),
		{
			lookups: 1,
			textBytes: 40_001,
		},
	);
});

test("only text parts add bytes", () => {
	const budget = started();
	const id = "image";
	budget.call({ toolCallId: id, toolName: "read" });
	assert.equal(
		budget.result(
			{
				toolCallId: id,
				toolName: "read",
				input: {},
				content: [
					{ type: "image", data: "y".repeat(80_000), mimeType: "image/png" },
					{ type: "text", text: "x".repeat(40_000) },
				],
				isError: false,
			},
			false,
		),
		undefined,
	);
});

test("a new request resets the lookups, the bytes and the single notice", () => {
	const budget = started();
	for (let i = 0; i < 3; i++) lookup(budget, "read");
	assert.ok(lookup(budget, "read"));
	budget.start();
	for (let i = 0; i < 3; i++) assert.equal(lookup(budget, "read"), undefined);
	assert.deepEqual(lookup(budget, "read"), { lookups: 4, textBytes: 4 });
});

test("a call started before the request began contributes nothing", () => {
	const budget = createExplorationBudget();
	budget.call({ toolCallId: "early", toolName: "read" });
	budget.start();
	for (let i = 0; i < 3; i++) lookup(budget, "read");
	assert.equal(
		lookup(budget, "read", { id: "early", unrecorded: true }),
		undefined,
	);
	assert.ok(lookup(budget, "read"));
});

test("errors, aborted results and unrecorded calls do not count", () => {
	assert.equal(counts("read", { isError: true }), false);
	assert.equal(counts("read", { aborted: true }), false);
	assert.equal(counts("read", { unrecorded: true }), false);
});

test("a result whose tool name differs from its recorded call does not count", () => {
	const budget = started();
	for (let i = 0; i < 3; i++) lookup(budget, "read");
	budget.call({ toolCallId: "swapped", toolName: "edit" });
	assert.equal(
		lookup(budget, "read", { id: "swapped", unrecorded: true }),
		undefined,
	);
});

test("Engram memory reads and MCP-proxied discovery tools count", () => {
	for (const name of [
		"mem_search",
		"mem_get_observation",
		"mem_context",
		"mcp__plugin_engram_engram__mem_search",
		"mcp__plugin_engram_engram__mem_get_observation",
		"mcp__codegraph__codegraph_query",
		"mcp__codegraph__codegraph_explore",
		"mcp__files__read",
	])
		assert.equal(counts(name), true, name);
});

test("writes, other MCP tools, web tools and harness tools do not count", () => {
	for (const name of [
		"edit",
		"write",
		"mem_save",
		"mcp__plugin_engram_engram__mem_save",
		"mcp__claude_ai_Linear__get_issue",
		"mcp__plugin_sentry_sentry__search_issues",
		"web_search",
		"web_fetch",
		"spawn_child",
		"codemode",
		"todo",
	])
		assert.equal(counts(name), false, name);
});

test("codegraph counts its successful query and explore operations only", () => {
	const ok = { status: "ok" };
	assert.equal(
		counts("codegraph", { input: { operation: "query" }, details: ok }),
		true,
	);
	assert.equal(
		counts("codegraph", { input: { operation: "explore" }, details: ok }),
		true,
	);
	assert.equal(
		counts("codegraph", { input: { operation: "init" }, details: ok }),
		false,
	);
	for (const status of ["failed", "unavailable", "refused"])
		assert.equal(
			counts("codegraph", {
				input: { operation: "query" },
				details: { status },
			}),
			false,
			status,
		);
});

test("a discovery call nested in codemode counts and the codemode call does not", () => {
	const budget = started();
	budget.call({ toolCallId: "script", toolName: "codemode" });
	for (let i = 1; i <= 3; i++)
		assert.equal(
			lookup(budget, "read", { id: `script/${i}`, parent: "script" }),
			undefined,
		);
	assert.equal(
		lookup(budget, "mcp__codegraph__codegraph_explore", {
			id: "script/4",
			parent: "script",
		}) !== undefined,
		true,
	);
	assert.equal(
		lookup(budget, "codemode", { id: "script", unrecorded: true }),
		undefined,
	);
});

test("nested calls count only one level below codemode", () => {
	const nested = (parentName, grandparent) => {
		const budget = started();
		for (let i = 0; i < 3; i++) lookup(budget, "read");
		if (grandparent) budget.call({ toolCallId: "outer", toolName: "codemode" });
		budget.call({
			toolCallId: "p",
			toolName: parentName,
			parentToolCallId: grandparent ? "outer" : undefined,
		});
		return lookup(budget, "read", { id: "p/1", parent: "p" }) !== undefined;
	};
	assert.equal(nested("codemode"), true);
	assert.equal(nested("mcp"), false);
	assert.equal(nested("bash"), false);
	assert.equal(nested("codemode", true), false);
});

const inspecting = [
	"git diff main...HEAD",
	"git show HEAD:README.md",
	"git log --oneline -5",
	"git blame src/a.ts",
	"git grep -n foo",
	"git status --short",
	"git ls-files",
	"git rev-parse --show-toplevel",
	"git -C ../repo status",
	"git branch",
	"git branch -a",
	"git tag --list",
	"git remote -v",
	"git worktree list",
	"git stash list",
	"git config --get user.name",
	"git config --list",
	"gh pr view 12 --comments",
	"gh issue list",
	"gh repo view",
	"gh release list",
	"gh pr diff 3",
	"gh pr status",
	"ls -la",
	"cat README.md",
	"head -n 20 a.ts",
	"tail -f log.txt",
	"grep -rn foo src",
	"rg foo",
	"wc -l a.ts",
	"tree src",
	"stat a.ts",
	"jq .name package.json",
	"diff a b",
	"find . -name '*.ts'",
	"sed -n 1,20p a.ts",
	"sort a.txt",
	"cd src && ls",
	"cat a.ts | grep foo | wc -l",
	"cat a.ts 2>/dev/null || echo missing",
	"git log -1; git status",
	"rg foo &\nls",
	'grep "a && b" file',
	"grep 'x; touch y' file",
	"cat $(git rev-parse --show-toplevel)/README.md",
	"git diff 2>&1 | head",
];

const notInspecting = [
	"",
	"cd src",
	"echo hi",
	"npm test",
	"npm run check",
	"node --test test/a.test.mjs",
	"npx tsc --noEmit",
	"make",
	"gh pr checks 3",
	"gh run view 12",
	"gh pr create --fill",
	"gh pr merge 3",
	"git commit -m x",
	"git push",
	"git checkout main",
	"git branch new-feature",
	"git branch -D old",
	"git tag v1.0.0",
	"git remote add origin x",
	"git stash",
	"git config user.name x",
	"rm -rf dist",
	"touch a",
	"mkdir b",
	"cat a > b",
	"echo x > out.txt",
	"sed -i s/a/b/ a.ts",
	"sort -o out a.txt",
	"find . -name '*.tmp' -delete",
	"find . -exec rm {} \\;",
	"cat a.ts && npm test",
	"ls | xargs rm",
	"cat $(rm -rf x)",
	"curl https://example.com",
	"python3 script.py",
	"git status & npm install",
	"cat `rm x`",
	"echo `rm x`; ls",
	"cat <(rm x)",
	"ls >(rm x)",
	"FILE=README.md cat $FILE",
	"GIT_EXTERNAL_DIFF=./x.sh git diff",
	"X=1; ls",
	"awk '{print $1}' a.txt",
	"awk 'BEGIN{system(\"rm x\")}'",
];

test("bash counts only when every segment is read-only inspection", () => {
	for (const command of inspecting)
		assert.equal(counts("bash", { input: { command } }), true, command);
	for (const command of notInspecting)
		assert.equal(counts("bash", { input: { command } }), false, command);
	assert.equal(counts("bash", { input: {} }), false);
});

test("the notice states the evidence budget, the explore child, the mode and that it grants nothing", () => {
	const tail =
		"This is runtime context for the original task, not a new user request. This notice grants no mutation or guard bypass authority.";
	const head =
		"Exploration budget: 1,234 tracked lookups and 56,789 UTF-8 text bytes (an approximate evidence budget). Ongoing discovery needs an explore child through spawn_child, or a verify child when it checks a change, even if read-only or initially small.";
	const facts = { lookups: 1234, textBytes: 56789 };
	assert.equal(
		explorationNotice(facts, "orchestrator"),
		`${head} Reading that prepares a writer belongs in that writer's task. ${tail}`,
	);
	assert.equal(
		explorationNotice(facts, "opportunistic"),
		`${head} Preparation for an already-understood inline write remains exempt. ${tail}`,
	);
});

async function budgetParent(agentDirectory) {
	const { fire, sent } = await parentSession(agentDirectory);
	let id = 0;
	return {
		sent,
		prompt: () =>
			fire("before_agent_start", {
				type: "before_agent_start",
				messageType: "user",
				prompt: "Explain",
				systemPromptOptions: { sections: {} },
			}),
		wake: () =>
			fire("before_agent_start", {
				type: "before_agent_start",
				messageType: "custom",
				message: {},
				systemPromptOptions: { sections: {} },
			}),
		async lookups(count, { toolName = "read", text = "x", ctx = {} } = {}) {
			for (let i = 0; i < count; i++) {
				const toolCallId = `call-${++id}`;
				await fire(
					"tool_execution_start",
					{ type: "tool_execution_start", toolCallId, toolName, args: {} },
					ctx,
				);
				await fire(
					"tool_result",
					{
						type: "tool_result",
						toolCallId,
						toolName,
						input: {},
						content: [{ type: "text", text }],
						isError: false,
					},
					ctx,
				);
			}
		},
	};
}

test("a parent with the child tools that crosses the budget gets one visible steer notice for the request", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await budgetParent(dir);
	await parent.prompt();
	await parent.lookups(3, { text: "abc" });
	assert.deepEqual(parent.sent, []);
	await parent.lookups(3, { text: "abc" });
	assert.equal(parent.sent.length, 1);
	const [{ message, options }] = parent.sent;
	assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
	assert.equal(message.customType, "pi-workflow-exploration-budget");
	assert.equal(message.display, true);
	assert.deepEqual(message.details, { lookups: 4, textBytes: 12 });
	assert.equal(
		message.content,
		explorationNotice({ lookups: 4, textBytes: 12 }, "opportunistic"),
	);
});

test("the notice reads the Delegation mode when it is sent", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await budgetParent(dir);
	await parent.prompt();
	await parent.lookups(3);
	createDelegationMode(dir).set("orchestrator");
	await parent.lookups(1);
	assert.match(
		parent.sent[0].message.content,
		/Reading that prepares a writer belongs in that writer's task\./,
	);
});

test("a run woken by a custom message continues the request and a new prompt starts another", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await budgetParent(dir);
	await parent.prompt();
	await parent.lookups(3);
	await parent.wake();
	await parent.lookups(1);
	assert.equal(parent.sent.length, 1);
	await parent.wake();
	await parent.lookups(4);
	assert.equal(parent.sent.length, 1);
	await parent.prompt();
	await parent.lookups(3);
	assert.equal(parent.sent.length, 1);
	await parent.lookups(1);
	assert.equal(parent.sent.length, 2);
});

test("aborted results and non-discovery tools send no notice", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await budgetParent(dir);
	await parent.prompt();
	await parent.lookups(5, { ctx: { signal: AbortSignal.abort() } });
	await parent.lookups(5, { toolName: "web_fetch" });
	await parent.lookups(5, { toolName: "mcp__claude_ai_Linear__get_issue" });
	assert.deepEqual(parent.sent, []);
});

test("a session without the child tools sends no notice", async (t) => {
	const dir = withAgentDirectory(t);
	seat(capabilities.filter((capability) => capability !== "child-session"));
	const parent = await budgetParent(dir);
	await parent.prompt();
	await parent.lookups(5, { text: "x".repeat(50_000) });
	assert.deepEqual(parent.sent, []);
});

async function budgetRealParent(t, dir, responses) {
	const parent = await realParent(t, dir, responses, {
		extensionFactories: [
			(pi) =>
				pi.registerTool({
					name: "codemode",
					label: "Codemode",
					description: "Run a script.",
					parameters: { type: "object", properties: {} },
					async execute(_id, _params, signal, _onUpdate, ctx) {
						for (let i = 0; i < 4; i++)
							await ctx.executeTool("read", { path: "README.md" }, { signal });
						return { content: [{ type: "text", text: "done" }], details: {} };
					},
				}),
		],
	});
	await writeFile(
		join(parent.worktree, "README.md"),
		"Installs the harness.\n",
	);
	return parent;
}

const notices = (request) =>
	JSON.stringify(request.messages).match(/Exploration budget: /g)?.length ?? 0;

test("in a real Pi session, the fourth read of a prompt steers the notice into the next model call", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const reads = (prefix) =>
		fauxAssistantMessage(
			[1, 2, 3, 4].map((n) =>
				fauxToolCall("read", { path: "README.md" }, { id: `${prefix}-${n}` }),
			),
			{ stopReason: "toolUse" },
		);
	const { session, requests } = await budgetRealParent(t, dir, [
		reads("a"),
		fauxAssistantMessage("Done."),
	]);
	await session.prompt("Explain the README");
	assert.equal(requests.length, 2);
	assert.equal(notices(requests[1]), 1);
	assert.match(JSON.stringify(requests[1].messages), /4 tracked lookups/);
	const result = (id) =>
		requests[1].messages.find((message) => message.toolCallId === id);
	assert.equal(result("a-4").isError, false);
	assert.match(JSON.stringify(result("a-4").content), /Installs the harness\./);
	assert.deepEqual(result("a-4").content, result("a-1").content);
});

test("in a real Pi session, reads a codemode script makes count toward the budget", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const { session, requests } = await budgetRealParent(t, dir, [
		fauxAssistantMessage(fauxToolCall("codemode", {}, { id: "script" }), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage("Done."),
	]);
	await session.prompt("Explain the README");
	assert.equal(requests.length, 2);
	assert.equal(notices(requests[1]), 1);
	assert.match(JSON.stringify(requests[1].messages), /4 tracked lookups/);
});
