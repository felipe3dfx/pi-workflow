import test from "node:test";
import assert from "node:assert/strict";

import {
	backstopNotice,
	backstopThreshold,
	createContextBackstop,
} from "../extensions/context-backstop.ts";
import { capabilities } from "../extensions/configure.ts";
import { createDelegationMode } from "../extensions/workflow-settings.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { parentSession, seat } from "./support/workflow-parent.mjs";

test("the threshold is min(150,000, 15% of the window), and 150,000 for an unknown or zero window", () => {
	assert.equal(backstopThreshold(272_000), 40_800);
	assert.equal(backstopThreshold(1_000_000), 150_000);
	assert.equal(backstopThreshold(100_001), 15_000);
	assert.equal(backstopThreshold(100_004), 15_000);
	assert.equal(backstopThreshold(undefined), 150_000);
	assert.equal(backstopThreshold(0), 150_000);
});

test("the first reading at or above the threshold fires once with its facts; a reading below stays silent", () => {
	const backstop = createContextBackstop();
	assert.equal(
		backstop.reading({ tokens: 40_799, contextWindow: 272_000 }),
		undefined,
	);
	assert.deepEqual(
		backstop.reading({ tokens: 40_800, contextWindow: 272_000 }),
		{
			tokens: 40_800,
			threshold: 40_800,
		},
	);
	assert.equal(
		backstop.reading({ tokens: 90_000, contextWindow: 272_000 }),
		undefined,
	);
});

test("a numeric reading below the threshold re-arms and a later crossing fires again", () => {
	const backstop = createContextBackstop();
	const window = { contextWindow: 272_000 };
	assert.ok(backstop.reading({ tokens: 50_000, ...window }));
	assert.equal(backstop.reading({ tokens: 10_000, ...window }), undefined);
	assert.deepEqual(backstop.reading({ tokens: 60_000, ...window }), {
		tokens: 60_000,
		threshold: 40_800,
	});
});

test("null tokens and an absent reading change no state in either direction", () => {
	const backstop = createContextBackstop();
	const window = { contextWindow: 272_000 };
	assert.equal(backstop.reading({ tokens: null, ...window }), undefined);
	assert.equal(backstop.reading(undefined), undefined);
	assert.ok(backstop.reading({ tokens: 50_000, ...window }));
	assert.equal(backstop.reading({ tokens: null, ...window }), undefined);
	assert.equal(backstop.reading(undefined), undefined);
	assert.equal(backstop.reading({ tokens: 60_000, ...window }), undefined);
});

test("the notice states the tokens, the threshold, the delegation ask and that it grants nothing", () => {
	assert.equal(
		backstopNotice({ tokens: 41_234, threshold: 40_800 }),
		"Context backstop: the parent context holds 41,234 tokens, at or above the 40,800-token threshold. Delegate the next bounded multi-step unit to a child session through spawn_child; single small edits and state checks stay inline. This is runtime context for the original task, not a new user request. This notice grants no mutation or guard bypass authority.",
	);
});

function usage(tokens, contextWindow = 272_000) {
	return { getContextUsage: () => ({ tokens, contextWindow }) };
}

async function backstopParent(agentDirectory) {
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
		async result(ctx, { toolName = "read" } = {}) {
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
					content: [{ type: "text", text: "x" }],
					isError: false,
				},
				ctx,
			);
		},
	};
}

test("a crossing in opportunistic sends one visible steer message with its own type", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await backstopParent(dir);
	await parent.prompt();
	await parent.result(usage(1_000));
	assert.deepEqual(parent.sent, []);
	await parent.result(usage(41_000));
	await parent.result(usage(42_000));
	assert.equal(parent.sent.length, 1);
	const [{ message, options }] = parent.sent;
	assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
	assert.equal(message.customType, "pi-workflow-context-backstop");
	assert.equal(message.display, true);
	assert.equal(
		message.content,
		backstopNotice({ tokens: 41_000, threshold: 40_800 }),
	);
});

test("a numeric reading below the threshold re-arms the harness backstop; null and absent readings do not", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await backstopParent(dir);
	await parent.prompt();
	await parent.result(usage(41_000), { toolName: "edit" });
	await parent.result(usage(null), { toolName: "edit" });
	await parent.result(
		{ getContextUsage: () => undefined },
		{ toolName: "edit" },
	);
	await parent.result(usage(50_000), { toolName: "edit" });
	assert.equal(parent.sent.length, 1);
	await parent.result(usage(1_000), { toolName: "edit" });
	await parent.result(usage(50_000), { toolName: "edit" });
	assert.equal(parent.sent.length, 2);
});

test("orchestrator mode and a session without the child tools send no backstop message", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	createDelegationMode(dir).set("orchestrator");
	const orchestrator = await backstopParent(dir);
	await orchestrator.prompt();
	await orchestrator.result(usage(200_000));
	assert.deepEqual(orchestrator.sent, []);

	const other = withAgentDirectory(t);
	seat(capabilities.filter((capability) => capability !== "child-session"));
	const bare = await backstopParent(other);
	await bare.prompt();
	await bare.result(usage(200_000));
	assert.deepEqual(bare.sent, []);
});

test("when the backstop and the exploration notice fire on the same result only the backstop is sent, and the exploration notice does not return in that request", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await backstopParent(dir);
	await parent.prompt();
	for (let i = 0; i < 3; i++) await parent.result(usage(1_000));
	await parent.result(usage(41_000));
	assert.equal(parent.sent.length, 1);
	assert.equal(
		parent.sent[0].message.customType,
		"pi-workflow-context-backstop",
	);
	await parent.result(usage(1_000));
	await parent.result(usage(1_000));
	assert.equal(parent.sent.length, 1);
	await parent.prompt();
	for (let i = 0; i < 4; i++) await parent.result(usage(1_000));
	assert.equal(parent.sent.length, 2);
	assert.equal(
		parent.sent[1].message.customType,
		"pi-workflow-exploration-budget",
	);
});

test("an aborted tool result neither fires nor changes the backstop state", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await backstopParent(dir);
	await parent.prompt();
	await parent.result(
		{ ...usage(41_000), signal: AbortSignal.abort() },
		{ toolName: "edit" },
	);
	assert.deepEqual(parent.sent, []);
	await parent.result(usage(41_000), { toolName: "edit" });
	assert.equal(parent.sent.length, 1);
	assert.equal(
		parent.sent[0].message.customType,
		"pi-workflow-context-backstop",
	);
	await parent.result(
		{ ...usage(1_000), signal: AbortSignal.abort() },
		{ toolName: "edit" },
	);
	await parent.result(usage(42_000), { toolName: "edit" });
	assert.equal(parent.sent.length, 1);
});
