import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildSessions } from "../extensions/child-sessions.ts";
import { fakeChildren } from "./support/fake-children.mjs";
import { withAgentDirectory } from "./support/jev-routing.mjs";

const plan = {
	role: "worker",
	contract: { prompt: "You are a worker. Follow the Contract.", tools: ["read"] },
	task: "Fix the failing test",
	worktree: "/tmp/worktree",
	model: "p/m",
	thinking: "medium",
	chosenBy: "parent",
	references: ["docs/spec.md"],
};

function auditedCore(t, { root = withAgentDirectory(t), parent = "parent-1", limits, run } = {}) {
	const children = fakeChildren({ run });
	const audit = createChildAudit({ root, parent: () => parent, limits });
	const sent = [];
	const core = createChildSessions({
		create: children.create,
		send: (message) => sent.push(message),
		idle: () => true,
		trace() {},
		report() {},
		audit,
	});
	async function launch(launchOptions = {}) {
		const started = await core.start(plan, {
			background: true,
			modelRegistry: {},
			project: () => ({ cwd: "/tmp", trusted: false }),
			shell: () => ({}),
			...launchOptions,
		});
		return { id: started.id, started, child: children.created.at(-1) };
	}
	return { core, audit, children, sent, launch, root };
}

async function eventually(read, condition) {
	let value;
	for (let i = 0; i < 200; i++) {
		value = await read();
		if (condition(value)) return value;
		await delay(5);
	}
	assert.fail(`condition never held: ${JSON.stringify(value)}`);
}

const allWritten = (window) =>
	window.identity.written && window.observations.every((entry) => entry.written);

test("an accepted child's identity is inspectable at once and then durably written without Fleet open", async (t) => {
	const { audit, launch } = auditedCore(t);
	const { id } = await launch({ group: "Fix tests" });

	const live = await audit.read(id);
	assert.deepEqual(live.identity, {
		parent: "parent-1",
		child: id,
		sdkSession: "session-0",
		role: "worker",
		task: "Fix the failing test",
		references: ["docs/spec.md"],
		instructions: "You are a worker. Follow the Contract.",
		tools: live.identity.tools,
		model: "p/m",
		thinking: "medium",
		worktree: "/tmp/worktree",
		createdAt: live.identity.createdAt,
		group: "Fix tests",
		written: false,
	});
	assert.ok(live.identity.tools.includes("read"));
	assert.equal(typeof live.identity.createdAt, "number");
	assert.deepEqual(live.health, { complete: true, lost: 0 });

	const durable = await eventually(() => audit.read(id), allWritten);
	assert.equal(durable.identity.written, true);
	assert.equal(durable.identity.child, id);
});

const inputs = (window) =>
	window.observations.map(({ ordinal, kind, source, delivery, text }) => ({
		ordinal,
		kind,
		source,
		delivery,
		text,
	}));

const userMessage = (text) => ({
	type: "message_start",
	message: { role: "user", content: [{ type: "text", text }] },
});

test("the subscription precedes the first prompt, and a Steer is recorded queued and then delivered", async (t) => {
	const { audit, core, launch } = auditedCore(t, {
		run: (task, spec) => {
			spec.onEvent(userMessage(task));
			return new Promise(() => {});
		},
	});
	const { id, child } = await launch();
	await delay(0);
	await core.steer(id, "Also update the README");
	child.deliver();

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(inputs(window), [
		{ ordinal: 1, kind: "input", source: "user", delivery: "delivered", text: "Fix the failing test" },
		{ ordinal: 2, kind: "input", source: "steer", delivery: "queued", text: "Also update the README" },
		{ ordinal: 3, kind: "input", source: "steer", delivery: "delivered", text: "Also update the README" },
	]);
});

test("an answer is recorded when the parent replies and again when the child receives it", async (t) => {
	const { audit, core, launch } = auditedCore(t, {
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	await delay(0);
	const asked = child.spec.ask("Which file?");
	core.reply(id, 1, "src/a.ts", "parent");
	assert.equal(await asked, "src/a.ts");
	child.spec.onEvent({
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "ask_parent",
		result: { content: [{ type: "text", text: "src/a.ts" }], details: {} },
		isError: false,
	});

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(
		window.observations.map(({ source, delivery, question, text }) => ({ source, delivery, question, text })),
		[
			{ source: "answer", delivery: "queued", question: 1, text: "src/a.ts" },
			{ source: "answer", delivery: "delivered", question: undefined, text: "src/a.ts" },
		],
	);
});

test("an instruction loadout change exposed by Pi is recorded", async (t) => {
	const { audit, launch } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	child.spec.onEvent({ type: "thinking_level_changed", level: "high" });

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(
		window.observations.map(({ ordinal, kind, thinking }) => ({ ordinal, kind, thinking })),
		[{ ordinal: 1, kind: "loadout", thinking: "high" }],
	);
});

test("when the audit storage cannot be created the child runs and delivers unchanged while live inspection warns", async (t) => {
	const blocked = join(withAgentDirectory(t), "not-a-directory");
	await writeFile(blocked, "");
	const { audit, sent, launch, children } = auditedCore(t, {
		root: blocked,
		run: async () => "Done.",
	});
	const { id, started } = await launch();
	assert.equal(started.status, "queued");

	const window = await eventually(() => audit.read(id), (read) => !read.health.complete);
	assert.equal(window.identity.child, id);
	assert.equal(window.identity.written, false);
	assert.match(window.health.warning, /not guaranteed/);
	await eventually(async () => sent, (messages) => messages.length === 1);
	assert.equal(sent[0].customType, "pi-workflow-child-result");
	assert.match(sent[0].content, /Done\./);
	assert.equal(children.created[0].aborts, 0);
});

test("without a parent session identity the child runs and live inspection warns that recovery is not guaranteed", async (t) => {
	const children = fakeChildren({ run: async () => "Done." });
	const audit = createChildAudit({
		root: withAgentDirectory(t),
		parent: () => {
			throw new Error("the session has no identity");
		},
	});
	const sent = [];
	const core = createChildSessions({
		create: children.create,
		send: (message) => sent.push(message),
		idle: () => true,
		trace() {},
		report() {},
		audit,
	});
	const { id } = await core.start(plan, {
		background: true,
		modelRegistry: {},
		project: () => ({ cwd: "/tmp", trusted: false }),
		shell: () => ({}),
	});

	const window = await audit.read(id);
	assert.equal(window.identity.child, id);
	assert.equal(window.health.complete, false);
	assert.match(window.health.warning, /not guaranteed/);
	await eventually(async () => sent, (messages) => messages.length === 1);
	assert.match(sent[0].content, /Done\./);
});

test("an exhausted capture budget marks the record incomplete without stopping, steering, or failing the child", async (t) => {
	const { audit, core, launch, children } = auditedCore(t, {
		limits: { entries: 2 },
	});
	const { id, child } = await launch();
	for (const text of ["one", "two", "three"]) {
		child.spec.onEvent(userMessage(text));
	}

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["one"]);
	assert.equal(window.health.complete, false);
	assert.equal(window.health.lost, 2);
	assert.match(window.health.warning, /budget/);
	assert.deepEqual(core.get(id).state, "running");
	assert.equal(children.created[0].aborts, 0);
	assert.deepEqual(children.created[0].steered, []);
	child.result.resolve("Done.");
	await eventually(async () => core.get(id).state, (state) => state === "completed");
});

test("a live continuation gets its own audit identity linked to the retained predecessor", async (t) => {
	const { audit, core, launch } = auditedCore(t);
	const { id, child } = await launch();
	child.result.resolve("Done.");
	await eventually(async () => core.get(id).state, (state) => state === "completed");

	const continued = await core.resume(id, "Now add a test", {
		modelRegistry: {},
		project: () => ({ cwd: "/tmp", trusted: false }),
		shell: () => ({}),
	});
	assert.equal(continued.status, "queued");
	const next = await audit.read(continued.id);
	assert.equal(next.identity.continuedFrom, id);
	assert.equal(next.identity.task, "Now add a test");
	assert.equal(next.identity.sdkSession, "session-1");
	assert.equal((await audit.read(id)).identity.task, "Fix the failing test");
});

test("a read returns one bounded window of the child's observations at a time", async (t) => {
	const { audit, launch } = auditedCore(t, { limits: { window: 2 } });
	const { id, child } = await launch();
	for (const text of ["one", "two", "three"]) child.spec.onEvent(userMessage(text));
	await eventually(() => audit.read(id, 3), allWritten);

	const texts = async (from) =>
		inputs(await audit.read(id, from)).map(({ ordinal, text }) => [ordinal, text]);
	assert.deepEqual(await texts(1), [[1, "one"], [2, "two"]]);
	assert.deepEqual(await texts(3), [[3, "three"]]);
});
