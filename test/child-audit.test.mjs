import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { crc32 } from "node:zlib";

import { createChildAudit } from "../extensions/child-audit.ts";
import { createChildSessions } from "../extensions/child-sessions.ts";
import { createTranscript } from "../extensions/child-transcript.ts";
import { eventually } from "./support/eventually.mjs";
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

function auditedCore(
	t,
	{ root = withAgentDirectory(t), parent = "parent-1", limits, run, dispose, files, schedule, timer } = {},
) {
	const children = fakeChildren({ run, dispose });
	const audit = createChildAudit({ root, parent: () => parent, limits, files, schedule, timer });
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

const allWritten = (window) =>
	window.identity.written && window.observations.every((entry) => entry.written);

async function projects(audit, child, expected, view = (entries) => entries) {
	const transcript = createTranscript({ audit, child, changed() {} });
	const draw = () => {
		const entries = [];
		transcript.layout(
			80,
			1000,
			"",
			(item) => {
				if (item.kind === "message" || item.kind === "tool") entries.push(item.entry);
				return [];
			},
			{ head: [], tail: [] },
		);
		return view(entries);
	};
	try {
		await eventually(async () => draw(), (shown) => isDeepStrictEqual(shown, expected));
	} finally {
		transcript.dispose();
	}
}

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
	assert.deepEqual(live.health, { complete: true, received: 3, admitted: 3, written: 0, lost: 0 });

	const durable = await eventually(() => audit.read(id), allWritten);
	assert.equal(durable.identity.written, true);
	assert.equal(durable.identity.child, id);
});

const inputs = (window) =>
	window.observations.filter((entry) => entry.kind === "input").map(({ ordinal, kind, source, delivery, text }) => ({
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
		{ ordinal: 3, kind: "input", source: "user", delivery: "delivered", text: "Fix the failing test" },
		{ ordinal: 4, kind: "input", source: "steer", delivery: "queued", text: "Also update the README" },
		{ ordinal: 5, kind: "input", source: "steer", delivery: "delivered", text: "Also update the README" },
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
	const delivered = {
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "ask_parent",
		result: { content: [{ type: "text", text: "src/a.ts" }], details: {} },
		isError: false,
	};
	child.spec.onEvent(delivered);
	child.spec.onEvent(delivered);

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(
		window.observations
			.filter((entry) => entry.kind === "input")
			.map(({ source, delivery, question, text }) => ({ source, delivery, question, text })),
		[
			{ source: "answer", delivery: "queued", question: 1, text: "src/a.ts" },
			{ source: "answer", delivery: "delivered", question: 1, text: "src/a.ts" },
		],
	);
});

test("an aborted ask records no answer, only the failed ask_parent call", async (t) => {
	const { audit, launch } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	await delay(0);
	const controller = new AbortController();
	const asked = child.spec.ask("Which file?", controller.signal);
	controller.abort();
	await assert.rejects(asked);
	child.spec.onEvent({
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "ask_parent",
		result: { content: [{ type: "text", text: "The call was aborted." }], details: {} },
		isError: true,
	});

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(window.observations.filter((entry) => entry.kind === "input"), []);
	assert.deepEqual(
		window.observations
			.filter((entry) => entry.kind === "tool")
			.map(({ name, phase, error }) => ({ name, phase, error })),
		[{ name: "ask_parent", phase: "end", error: true }],
	);
});

test("an instruction loadout change exposed by Pi is recorded", async (t) => {
	const { audit, launch } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	child.spec.onEvent({ type: "thinking_level_changed", level: "high" });

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(
		window.observations
			.filter((entry) => entry.kind === "loadout")
			.map(({ ordinal, kind, thinking }) => ({ ordinal, kind, thinking })),
		[{ ordinal: 3, kind: "loadout", thinking: "high" }],
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
		limits: { entries: 5 },
	});
	const { id, child } = await launch();
	for (const text of ["one", "two", "three"]) {
		child.spec.onEvent(userMessage(text));
	}

	const window = await eventually(
		() => audit.read(id),
		(read) => allWritten(read) && read.health.marker,
	);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["one"]);
	assert.deepEqual(window.health, {
		complete: false,
		received: 6,
		admitted: 4,
		written: 4,
		lost: 2,
		lostFrom: 4,
		marker: "written",
		warning: "The audit capture budget is exhausted.",
	});
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
	await eventually(() => audit.read(id, { from: 5 }), allWritten);

	const texts = async (from) =>
		inputs(await audit.read(id, { from })).map(({ ordinal, text }) => [ordinal, text]);
	assert.deepEqual(await texts(3), [[3, "one"], [4, "two"]]);
	assert.deepEqual(await texts(5), [[5, "three"]]);
});

const toolEvent = (type, toolCallId, fields = {}) => ({
	type: `tool_execution_${type}`,
	toolCallId,
	toolName: fields.toolName ?? "read",
	...fields,
});

const events = (window) =>
	window.observations
		.filter((entry) => entry.event)
		.map((entry) => entry.event);

test("nested tool calls are captured live with their arguments, updates, and results correlated to the outer call", async (t) => {
	const { audit, launch } = auditedCore(t, {
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const emit = (event) => child.spec.onEvent(event);
	const nestedEnd = toolEvent("end", "c1/1", {
		parentToolCallId: "c1",
		result: {
			content: [{ type: "text", text: "full text" }],
			details: { fullOutputPath: "/tmp/full-output.txt" },
			usage: { input: 5, output: 1 },
		},
		isError: false,
	});
	emit(
		toolEvent("start", "c1", {
			toolName: "codemode",
			args: { script: "read('a')" },
		}),
	);
	emit(
		toolEvent("start", "c1/1", { parentToolCallId: "c1", args: { path: "a" } }),
	);
	emit(
		toolEvent("update", "c1/1", {
			parentToolCallId: "c1",
			args: { path: "a" },
			partialResult: { content: [{ type: "text", text: "full" }] },
		}),
	);
	emit(nestedEnd);
	emit(nestedEnd);
	emit(
		toolEvent("end", "c1", {
			toolName: "codemode",
			result: { content: [{ type: "text", text: "script done" }] },
			isError: false,
		}),
	);
	const toolResult = {
		role: "toolResult",
		toolCallId: "c1",
		toolName: "codemode",
		content: [{ type: "text", text: "script done" }],
		nestedCalls: { calls: [], complete: true },
		usage: { input: 5, output: 1 },
		isError: false,
	};
	emit({ type: "message_start", message: toolResult });
	emit({ type: "message_end", message: toolResult });

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(events(window), [
		"tool:c1:start",
		"tool:c1/1:start",
		"tool:c1/1:update:1",
		"tool:c1/1:end",
		"tool:c1:end",
	]);
	await projects(audit, id, [
		{
			type: "tool",
			call: "c1",
			name: "codemode",
			args: { script: "read('a')" },
			result: { content: [{ type: "text", text: "script done" }] },
			error: false,
			final: true,
		},
		{
			type: "tool",
			call: "c1/1",
			parent: "c1",
			name: "read",
			args: { path: "a" },
			result: {
				content: [{ type: "text", text: "full text" }],
				details: { fullOutputPath: "/tmp/full-output.txt" },
				usage: { input: 5, output: 1 },
			},
			error: false,
			final: true,
		},
	]);
});

test("evidence the cancelled child emits while it is disposed is recorded before its record closes", async (t) => {
	const aborted = { role: "assistant", content: [], stopReason: "aborted" };
	const { audit, core, launch } = auditedCore(t, {
		run: () => new Promise(() => {}),
		dispose: async (child) => {
			await delay(20);
			child.spec.onEvent({ type: "message_end", message: aborted });
			child.spec.onEvent(toolEvent("end", "c1", { result: { content: [] }, isError: true }));
		},
	});
	const { id, child } = await launch();
	await eventually(async () => core.get(id).state, (state) => state === "running");
	child.spec.onEvent({ type: "message_start", message: aborted });
	child.spec.onEvent(toolEvent("start", "c1", { args: { path: "a" } }));
	core.cancel(id, false);

	const window = await eventually(() => audit.read(id), (read) => read.health.closed);
	assert.deepEqual(events(window), ["m1:start", "tool:c1:start", "m1:end", "tool:c1:end"]);
	assert.deepEqual(window.health, { complete: true, closed: true, written: 8 });
});

test("evidence arriving after a record closed is reported lost, never dropped silently", async (t) => {
	const root = withAgentDirectory(t);
	const audit = createChildAudit({ root, parent: () => "parent-1" });
	const capture = audit.begin({
		child: "late",
		role: "worker",
		task: "Task",
		references: [],
		instructions: "",
		tools: [],
		model: "p/m",
		thinking: "low",
		worktree: "/tmp",
		createdAt: 0,
	});
	audit.execution("late", "running");
	audit.execution("late", "cancelled");
	capture.disposed();
	await eventually(() => audit.read("late"), (read) => read.health.closed);
	capture.event(toolEvent("end", "c1", { result: { content: [] }, isError: true }));

	const window = await eventually(
		() => createChildAudit({ root, parent: () => "parent-1" }).read("late"),
		(read) => !read.health.complete,
	);
	assert.equal(window.health.closed, false);
	assert.equal(window.health.lostFrom, 3);
	assert.match(window.health.warning, /arrived after the record was closed/);
});

test("the same update event delivered twice is recorded once, while distinct equal updates stay distinct", async (t) => {
	const { audit, launch } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	const emit = (event) => child.spec.onEvent(event);
	const update = () =>
		toolEvent("update", "c1", { partialResult: { content: [{ type: "text", text: "same" }] } });
	const repeated = update();
	emit(toolEvent("start", "c1", { args: { path: "a" } }));
	emit(repeated);
	emit(repeated);
	emit(update());
	const streaming = { role: "assistant", content: [] };
	const piece = delta(streaming, "text_delta", 0, "same");
	emit({ type: "message_start", message: streaming });
	emit(piece);
	emit(piece);
	emit(delta(streaming, "text_delta", 0, "same"));

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(events(window), [
		"tool:c1:start",
		"tool:c1:update:1",
		"tool:c1:update:2",
		"m1:start",
		"m1:update:1",
		"m1:update:2",
	]);
});

test("a finished child's record is closed after its drain and read back from its journal", async (t) => {
	const { audit, core, sent, launch } = auditedCore(t);
	const { id, child } = await launch();
	child.spec.onEvent(userMessage("alpha"));
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(() => audit.read(id), (read) => read.health.closed);
	assert.deepEqual(window.health, { complete: true, closed: true, written: 6 });
	assert.deepEqual(inputs(window).map(({ text }) => text), ["alpha"]);
	assert.deepEqual(outcome((await audit.list()).records[0]), {
		section: "history",
		state: "completed",
		verdict: "done",
		interrupted: undefined,
	});
});

const delta = (message, type, contentIndex, text) => ({
	type: "message_update",
	message,
	assistantMessageEvent: { type, contentIndex, delta: text, partial: message },
});

test("an authoritative final replaces its streamed partials once, while the partials stay auditable", async (t) => {
	const { audit, launch } = auditedCore(t, {
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const emit = (event) => child.spec.onEvent(event);
	const streaming = { role: "assistant", content: [] };
	const final = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "\u{1F44D} ok" },
		],
		usage: { input: 10, output: 4 },
		stopReason: "stop",
	};
	emit({ type: "message_start", message: streaming });
	emit(delta(streaming, "thinking_delta", 0, "plan"));
	emit(delta(streaming, "text_delta", 1, "\ud83d"));
	emit(delta(streaming, "text_delta", 1, "\udc4d ok"));
	emit({ type: "message_end", message: final });
	emit({ type: "message_end", message: final });
	emit(delta(streaming, "text_delta", 1, " late"));
	final.content[1].text = "rewritten after the event";

	const authoritative = [
		{
			type: "message",
			message: "m1",
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "plan" },
				{ type: "text", text: "\u{1F44D} ok" },
			],
			usage: { input: 10, output: 4 },
			stopReason: "stop",
			final: true,
		},
	];
	await projects(audit, id, authoritative);

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(events(window), [
		"m1:start",
		"m1:update:1",
		"m1:update:2",
		"m1:update:3",
		"m1:end",
		"m1:update:4",
	]);
	await projects(audit, id, authoritative);
	assert.deepEqual(
		window.observations
			.filter((entry) => entry.phase === "update")
			.map((entry) => entry.delta)
			.join(""),
		"plan\u{1F44D} ok late",
	);
});

test("a streaming message shows one current partial joined across Unicode-split deltas", async (t) => {
	const { audit, launch } = auditedCore(t, {
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const streaming = { role: "assistant", content: [] };
	child.spec.onEvent({ type: "message_start", message: streaming });
	child.spec.onEvent(delta(streaming, "text_delta", 0, "cafe"));
	child.spec.onEvent(delta(streaming, "text_delta", 0, "́ \ud83d"));
	child.spec.onEvent(delta(streaming, "text_delta", 0, "\ude00"));

	await eventually(() => audit.read(id), allWritten);
	await projects(audit, id, [
		{
			type: "message",
			message: "m1",
			role: "assistant",
			content: [{ type: "text", text: "café \u{1F600}" }],
			final: false,
		},
	]);
});

test("execution transitions and each corrected Verdict report are recorded apart from capture health", async (t) => {
	const { audit, core, launch } = auditedCore(t);
	const { id, child } = await launch();
	await eventually(
		async () => core.get(id).state,
		(state) => state === "running",
	);
	const blocked = {
		verdict: "blocked",
		reason: "Missing fixture",
		files_changed: [],
		validation: [],
		left_undone: ["tests"],
	};
	const done = {
		verdict: "done",
		files_changed: ["a.ts: fixed"],
		validation: ["npm test: pass"],
		left_undone: [],
	};
	child.spec.report(blocked);
	child.spec.report(done);
	child.result.resolve("Done.");
	await eventually(
		async () => core.get(id).state,
		(state) => state === "completed",
	);

	const window = await eventually(() => audit.read(id), (read) => read.health.closed);
	assert.deepEqual(
		window.observations.map(({ kind, state, verdict, result }) => ({
			kind,
			state,
			verdict,
			result,
		})),
		[
			{
				kind: "execution",
				state: "queued",
				verdict: undefined,
				result: undefined,
			},
			{
				kind: "execution",
				state: "running",
				verdict: undefined,
				result: undefined,
			},
			{ kind: "report", state: undefined, verdict: undefined, result: blocked },
			{ kind: "report", state: undefined, verdict: undefined, result: done },
			{
				kind: "execution",
				state: "completed",
				verdict: "done",
				result: undefined,
			},
		],
	);
	assert.deepEqual(window.health, { complete: true, closed: true, written: 6 });
});

test("concurrent children keep their own order and correlation, and identical text from distinct events stays distinct", async (t) => {
	const { audit, launch } = auditedCore(t, {
		run: () => new Promise(() => {}),
	});
	const first = await launch();
	const second = await launch();
	const say = (child, text) => {
		const message = {
			role: "assistant",
			content: [{ type: "text", text }],
			stopReason: "stop",
		};
		child.spec.onEvent({ type: "message_start", message });
		child.spec.onEvent({ type: "message_end", message });
	};
	for (const { child } of [first, second]) {
		child.spec.onEvent(toolEvent("start", "c1", { args: { path: "a" } }));
	}
	say(first.child, "same");
	say(second.child, "same");
	say(first.child, "same");
	for (const { child } of [second, first]) {
		child.spec.onEvent(
			toolEvent("end", "c1", { result: { content: [] }, isError: false }),
		);
	}

	const summary = (entries) =>
		entries.map((entry) =>
			entry.type === "tool"
				? `${entry.call} final=${entry.final}`
				: `${entry.message} ${entry.content[0].text}`,
		);
	const one = await eventually(() => audit.read(first.id), allWritten);
	const two = await eventually(() => audit.read(second.id), allWritten);
	await projects(audit, first.id, ["c1 final=true", "m1 same", "m2 same"], summary);
	await projects(audit, second.id, ["c1 final=true", "m1 same"], summary);
	for (const window of [one, two]) {
		const ordinals = window.observations.map((entry) => entry.ordinal);
		assert.deepEqual(
			ordinals,
			ordinals.map((_, index) => index + 1),
		);
	}
});

test("a final the capture could not retain never appears authoritative", async (t) => {
	const { audit, core, launch } = auditedCore(t, {
		limits: { entries: 6 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const streaming = { role: "assistant", content: [] };
	child.spec.onEvent({ type: "message_start", message: streaming });
	child.spec.onEvent(delta(streaming, "text_delta", 0, "half"));
	child.spec.onEvent({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "half and whole" }],
			stopReason: "stop",
		},
	});

	const window = await eventually(() => audit.read(id), allWritten);
	await projects(audit, id, [
		{
			type: "message",
			message: "m1",
			role: "assistant",
			content: [{ type: "text", text: "half" }],
			final: false,
		},
	]);
	assert.equal(window.health.complete, false);
	assert.equal(window.health.lost, 1);
	assert.equal(core.get(id).state, "running");
});

function faultyFiles(fault = {}) {
	const writes = [];
	const reads = [];
	return {
		writes,
		reads,
		mkdir,
		readdir,
		stat,
		async rename(from, to) {
			await fault.rename?.(from, to);
			await rename(from, to);
		},
		async open(path, flags, mode) {
			await fault.open?.(path, flags);
			const handle = await open(path, flags, mode);
			if (!path.endsWith(".jsonl")) {
				return {
					write: (...args) => handle.write(...args),
					async read(...args) {
						const result = await handle.read(...args);
						reads.push({ path, bytes: result.bytesRead });
						return result;
					},
					close: () => handle.close(),
				};
			}
			return {
				async write(buffer, offset = 0, length = buffer.length - offset) {
					const call = writes.push(length) - 1;
					const plan = (await fault.write?.(call, length)) ?? { bytes: length };
					if (plan.bytes > 0) await handle.write(buffer, offset, plan.bytes);
					if (plan.error) throw plan.error;
					return { bytesWritten: plan.bytes };
				},
				async read(...args) {
					await fault.read?.(path);
					const result = await handle.read(...args);
					reads.push({ path, bytes: result.bytesRead });
					return result;
				},
				close: async () => {
					await fault.close?.();
					await handle.close();
				},
			};
		},
	};
}

function manualScheduler() {
	const tasks = [];
	return {
		schedule: (task) => tasks.push(task),
		async runUntil(condition) {
			for (let i = 0; i < 2000; i++) {
				if (await condition()) return;
				tasks.shift()?.();
				await delay(1);
			}
			assert.fail("the scheduled work never reached the condition");
		},
	};
}

const done = {
	verdict: "done",
	files_changed: ["a.ts: fixed"],
	validation: ["npm test: pass"],
	left_undone: [],
};

async function finishesUnchanged(core, id, child, sent) {
	child.spec.report(done);
	child.result.resolve("Done.");
	await eventually(
		async () => core.get(id).state,
		(state) => state === "completed",
	);
	await eventually(
		async () => sent,
		(messages) => messages.length === 1,
	);
	assert.equal(sent[0].customType, "pi-workflow-child-result");
	assert.match(sent[0].content, /Done\./);
	assert.equal(core.get(id).result.verdict, "done");
	assert.equal(child.aborts, 0);
	assert.deepEqual(child.steered, []);
}

const unicodeText = (length) => {
	let text = "";
	for (let i = 0; text.length < length; i++)
		text += `${"a".repeat(i % 7)}\u{1F600}é\n"\\`;
	return text;
};

const resultOf = (window, call) =>
	window.observations.find(
		(entry) => entry.kind === "tool" && entry.call === call && entry.phase === "end",
	)?.result;

test("a large Unicode result is captured in bounded parts and read back exactly", async (t) => {
	const files = faultyFiles();
	const { audit, launch } = auditedCore(t, {
		files,
		limits: { chunk: 1024 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const text = unicodeText(40_000);
	child.spec.onEvent(toolEvent("start", "c1", { args: { path: "big" } }));
	child.spec.onEvent(
		toolEvent("end", "c1", {
			result: { content: [{ type: "text", text }] },
			isError: false,
		}),
	);

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(resultOf(window, "c1"), {
		content: [{ type: "text", text }],
	});
	assert.equal(window.health.complete, true);
	assert.ok(files.writes.length > 40);
	assert.ok(Math.max(...files.writes) <= 1024 + 512);
});

test("one observation larger than the whole budget is refused visibly, not hidden behind a small entry", async (t) => {
	const { audit, core, sent, launch } = auditedCore(t, {
		limits: { bytes: 16 * 1024, chunk: 1024 },
	});
	const { id, child } = await launch();
	child.spec.onEvent(toolEvent("start", "c1", { args: { path: "big" } }));
	child.spec.onEvent(
		toolEvent("end", "c1", {
			result: { content: [{ type: "text", text: "x".repeat(64 * 1024) }] },
			isError: false,
		}),
	);
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(
		() => audit.read(id),
		(read) => allWritten(read) && read.health.marker,
	);
	const refused = window.health.lostFrom;
	assert.equal(
		window.observations.some((entry) => entry.ordinal >= refused),
		false,
	);
	assert.equal(resultOf(window, "c1"), undefined);
	assert.equal(window.health.complete, false);
	assert.match(window.health.warning, /exceeds the whole audit capture budget/);
	assert.doesNotMatch(window.health.warning, /not guaranteed/);
	assert.equal(window.health.marker, "written");
});

test("an event counts as written only when its last part lands", async (t) => {
	const files = faultyFiles();
	const scheduler = manualScheduler();
	const { audit, launch } = auditedCore(t, {
		files,
		schedule: scheduler.schedule,
		limits: { chunk: 1024 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	await scheduler.runUntil(async () => allWritten(await audit.read(id)));
	const before = files.writes.length;
	child.spec.onEvent(
		toolEvent("end", "c1", {
			result: { content: [{ type: "text", text: unicodeText(5000) }] },
			isError: false,
		}),
	);
	await scheduler.runUntil(() => files.writes.length === before + 1);
	const window = await audit.read(id);

	const big = window.observations.at(-1);
	assert.equal(big.kind, "tool");
	assert.equal(big.written, false);
	assert.equal(window.health.admitted, big.ordinal + 1);
	assert.equal(window.health.written, big.ordinal);
	assert.equal(window.health.complete, true);
});

test("short writes are continued without losing or duplicating evidence", async (t) => {
	const files = faultyFiles({
		write: (_call, length) => ({ bytes: Math.min(length, 7) }),
	});
	const { audit, launch } = auditedCore(t, {
		files,
		limits: { chunk: 1024 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const text = unicodeText(3000);
	child.spec.onEvent(
		toolEvent("end", "c1", {
			result: { content: [{ type: "text", text }] },
			isError: false,
		}),
	);

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(resultOf(window, "c1"), {
		content: [{ type: "text", text }],
	});
	assert.equal(window.health.complete, true);
	assert.equal(window.health.written, window.health.received);
});

const failingNext = () => {
	const state = { next: undefined };
	const files = faultyFiles({
		write: (_call, length) => {
			const plan = state.next;
			state.next = undefined;
			return plan ?? { bytes: length };
		},
	});
	return { files, failNext: (plan) => (state.next = plan) };
};

async function flushed(audit, id) {
	return eventually(() => audit.read(id), allWritten);
}

test("a zero-byte write loses evidence exactly from that observation and a marker records the loss", async (t) => {
	const { files, failNext } = failingNext();
	const { audit, core, sent, launch } = auditedCore(t, { files });
	const { id, child } = await launch();
	const before = await flushed(audit, id);
	failNext({ bytes: 0 });
	child.spec.onEvent(userMessage("one"));
	child.spec.onEvent(userMessage("two"));
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(
		() => audit.read(id),
		(read) => read.health.marker,
	);
	const first = before.health.received;
	assert.equal(window.health.complete, false);
	assert.equal(window.health.lostFrom, first);
	assert.equal(window.health.uncertain, undefined);
	assert.equal(window.health.written, first);
	assert.equal(window.health.marker, "written");
	assert.doesNotMatch(window.health.warning, /not guaranteed/);
	assert.deepEqual(inputs(window), []);
});

test("an ambiguous failed append is declared uncertain and never retried", async (t) => {
	const { files, failNext } = failingNext();
	const { audit, core, sent, launch } = auditedCore(t, { files });
	const { id, child } = await launch();
	const before = await flushed(audit, id);
	failNext({ bytes: 3, error: new Error("EIO") });
	child.spec.onEvent(userMessage("one"));
	child.spec.onEvent(userMessage("two"));
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(
		() => audit.read(id),
		(read) => read.health.marker,
	);
	const first = before.health.received;
	assert.equal(window.health.uncertain, first);
	assert.equal(window.health.lostFrom, first + 1);
	assert.equal(window.health.written, first);
	assert.equal(window.health.marker, "written");
	assert.match(window.health.warning, /EIO/);
	assert.equal(files.writes.length, before.health.written + 2);
});

test("when every write fails the child finishes normally and nothing is presented as durable", async (t) => {
	const files = faultyFiles({
		write: () => ({ bytes: 0, error: new Error("EIO") }),
	});
	const { audit, core, sent, launch } = auditedCore(t, { files });
	const { id, child } = await launch();
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(
		() => audit.read(id),
		(read) => read.health.marker,
	);
	assert.equal(window.identity.written, false);
	assert.equal(window.health.written, 0);
	assert.equal(window.health.uncertain, 0);
	assert.equal(window.health.marker, "failed");
	assert.match(window.health.warning, /not guaranteed/);
	assert.equal(
		window.observations.some((entry) => entry.written),
		false,
	);
});

test("a journal that cannot be created loses everything from the identity and leaves no identity-less file", async (t) => {
	const root = withAgentDirectory(t);
	const files = faultyFiles({
		open: () => {
			throw new Error("EACCES");
		},
	});
	const { audit, core, sent, launch } = auditedCore(t, { root, files });
	const { id, child } = await launch();
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(
		() => audit.read(id),
		(read) => read.health.marker,
	);
	assert.equal(window.health.lostFrom, 0);
	assert.equal(window.health.uncertain, undefined);
	assert.equal(window.health.marker, "failed");
	assert.match(window.health.warning, /EACCES.*not guaranteed/);
	await assert.rejects(access(join(root, "parent-1", `${id}.jsonl`)));
});

test("evidence that cannot be snapshotted marks the record incomplete without reaching the child", async (t) => {
	const { audit, core, sent, launch } = auditedCore(t);
	const { id, child } = await launch();
	const args = { path: "a" };
	args.self = args;
	child.spec.onEvent(toolEvent("start", "c1", { args }));
	await finishesUnchanged(core, id, child, sent);

	const window = await eventually(
		() => audit.read(id),
		(read) => read.health.marker,
	);
	assert.equal(window.health.complete, false);
	assert.match(window.health.warning, /circular/i);
});

test("evidence observed while the journal is closing is still written", async (t) => {
	const closing = Promise.withResolvers();
	let closes = 0;
	const files = faultyFiles({
		close: () => {
			closes += 1;
			return closing.promise;
		},
	});
	const { audit, launch } = auditedCore(t, { files, run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	await eventually(async () => closes, (count) => count > 0);
	child.spec.onEvent(userMessage("during close"));
	closing.resolve();

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["during close"]);
});

test("a saturating child cannot starve the identity and first evidence of a sibling started later", async (t) => {
	const scheduler = manualScheduler();
	const { audit, launch } = auditedCore(t, {
		schedule: scheduler.schedule,
		limits: { bytes: 64 * 1024, chunk: 1024 },
		run: () => new Promise(() => {}),
	});
	const busy = await launch();
	for (let i = 0; i < 100; i++) busy.child.spec.onEvent(userMessage("x".repeat(500)));
	const late = await launch();
	late.child.spec.onEvent(userMessage("hello"));

	const saturated = await audit.read(busy.id);
	assert.equal(saturated.health.complete, false);
	assert.match(saturated.health.warning, /exhausted/);
	const started = await audit.read(late.id);
	assert.equal(started.health.complete, true);
	assert.equal(started.health.admitted, started.health.received);
	assert.deepEqual(inputs(started).map(({ text }) => text), ["hello"]);
});

async function damage(path, from, to) {
	const bytes = await readFile(path);
	const at = bytes.indexOf(from);
	assert.ok(at >= 0);
	const file = await open(path, "r+");
	await file.write(Buffer.from(to), 0, Buffer.byteLength(to), at);
	await file.close();
}

const journalOf = (root, id) => join(root, "parent-1", `${id}.jsonl`);

test("a read never presents accidentally damaged evidence and still shows the verified rest", async (t) => {
	const { audit, launch, root } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	for (const text of ["alpha", "bravo", "charlie"]) child.spec.onEvent(userMessage(text));
	await eventually(() => audit.read(id), allWritten);
	await damage(journalOf(root, id), "bravo", "brava");

	const window = await audit.read(id);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["alpha", "charlie"]);
	assert.deepEqual(window.unavailable, [{ from: 4, to: 4 }]);
	assert.match(window.warning, /failed verification/);
});

const isJournal = (read) => read.path.endsWith(".jsonl");
const ordinals = (window) => window.observations.map(({ ordinal }) => ordinal);

async function largeRecord(t, limits) {
	const files = faultyFiles();
	const audited = auditedCore(t, {
		files,
		limits: { entries: 4096, ...limits },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await audited.launch();
	for (let i = 0; i < 400; i++) child.spec.onEvent(userMessage(`message ${i}`));
	await eventually(
		() => audited.audit.read(id, { from: 400 }),
		(window) => window.health.written === window.health.received,
	);
	files.reads.length = 0;
	return { ...audited, files, id };
}

test("opening a window of a large record reads bounded index pages and journal bytes, and continues from its cursor", async (t) => {
	const { audit, files, id } = await largeRecord(t, { window: 16, windowBytes: 1024 });

	const window = await audit.read(id, { from: 200 });
	const count = window.observations.length;
	assert.ok(count > 1 && count < 16);
	assert.deepEqual(ordinals(window), Array.from({ length: count }, (_, i) => 200 + i));
	const journal = files.reads.filter(isJournal);
	assert.ok(journal.reduce((total, read) => total + read.bytes, 0) <= 1024);
	assert.ok(files.reads.length - journal.length <= 4);
	assert.equal(window.warning, undefined);

	const next = await audit.read(id, window.next);
	assert.equal(next.observations[0].ordinal, 200 + count);
});

test("index pages are cached within a bounded number of entries", async (t) => {
	const { audit, files, id } = await largeRecord(t, { window: 16, cacheEntries: 2 });
	const pageReads = () => files.reads.filter((read) => !isJournal(read)).length;

	await audit.read(id, { from: 200 });
	const first = pageReads();
	assert.ok(first > 0);
	await audit.read(id, { from: 200 });
	assert.equal(pageReads(), first);
	await audit.read(id, { from: 300 });
	await audit.read(id, { from: 200 });
	assert.ok(pageReads() > first + 1);
});

const indexOf = (root, id) => join(root, "parent-1", `${id}.index`);

async function drained(audit, root, id) {
	const window = await flushed(audit, id);
	await eventually(
		() => readFile(join(indexOf(root, id), "head.json"), "utf8").then(JSON.parse, () => ({})),
		(head) => head.committed === window.health.received,
	);
	return window;
}

test("without its index a record still shows the known identity and windows verified from the record, with a warning", async (t) => {
	const { audit, files, id, root } = await largeRecord(t, { window: 16, windowBytes: 1024 });
	await rm(indexOf(root, id), { recursive: true });

	const first = await audit.read(id);
	assert.equal(first.identity.child, id);
	assert.match(first.warning, /index is missing or damaged/);
	assert.deepEqual(ordinals(first), Array.from({ length: first.observations.length }, (_, i) => 1 + i));
	assert.ok(first.observations.length > 0);

	files.reads.length = 0;
	const later = await audit.read(id, { from: 200 });
	assert.match(later.warning, /index is missing or damaged/);
	assert.ok(later.observations.every((entry) => entry.ordinal >= 200 && entry.written));
	assert.ok(files.reads.filter(isJournal).reduce((total, read) => total + read.bytes, 0) <= 1024);
	assert.ok(later.next.offset > 0);
});

test("an index that contradicts the record never prevails over it", async (t) => {
	const { audit, id, root } = await largeRecord(t, { window: 16 });
	const path = join(indexOf(root, id), "0-12.json");
	const page = JSON.parse(await readFile(path, "utf8"));
	page.entries.reverse();
	await writeFile(path, JSON.stringify(page));

	const window = await audit.read(id, { from: 192 });
	assert.ok(window.observations.every((entry) => entry.ordinal >= 208));
	assert.deepEqual(window.unavailable, [{ from: 192, to: 207 }]);
	assert.match(window.warning, /failed verification/);
});

test("when only the index cannot be written the evidence stays complete and readable with a warning", async (t) => {
	const files = faultyFiles({
		rename: () => {
			throw new Error("ENOSPC");
		},
	});
	const { audit, launch } = auditedCore(t, {
		files,
		limits: { window: 4 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	for (const text of ["one", "two", "three", "four", "five"]) child.spec.onEvent(userMessage(text));

	const window = await eventually(() => audit.read(id), (read) => read.health.written === read.health.received);
	assert.equal(window.health.complete, true);
	assert.match(window.warning, /index could not be written: ENOSPC/);
	assert.deepEqual(inputs(await audit.read(id, { from: 3 })).map(({ text }) => text).slice(0, 2), ["one", "two"]);
});

test("a second capture of the same record is refused visibly while the owner keeps writing", async (t) => {
	const { audit, launch, root } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	await eventually(() => audit.read(id), allWritten);
	const before = await readFile(journalOf(root, id));

	const other = createChildAudit({ root, parent: () => "parent-1" });
	const capture = other.begin({
		child: id,
		role: "worker",
		task: "Someone else",
		references: [],
		instructions: "",
		tools: [],
		model: "p/m",
		thinking: "low",
		worktree: "/tmp",
		createdAt: 0,
	});
	capture.event(userMessage("intruder"));
	const refused = await eventually(() => other.read(id), (read) => read.health.marker);
	assert.equal(refused.health.complete, false);
	assert.match(refused.health.warning, /Another capture already owns this audit record/);

	child.spec.onEvent(userMessage("owner"));
	const owner = await eventually(() => audit.read(id), allWritten);
	assert.equal(owner.health.complete, true);
	assert.deepEqual(inputs(owner).map(({ text }) => text), ["owner"]);
	const after = await readFile(journalOf(root, id));
	assert.deepEqual(after.subarray(0, before.length), before);
	assert.doesNotMatch(after.toString(), /intruder|Someone else/);
});

test("repair is refused while the record is still being captured", async (t) => {
	const { audit, launch } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id } = await launch();
	await eventually(() => audit.read(id), allWritten);

	assert.deepEqual(await audit.repair(id), { refused: "The record is still being captured." });
});

test("an explicit repair can be cancelled, then recovers only verified evidence without touching the record", async (t) => {
	const controller = new AbortController();
	let abortOnRead = false;
	const files = faultyFiles({
		read: () => {
			if (abortOnRead) controller.abort();
		},
	});
	const { audit, core, sent, launch, root } = auditedCore(t, { files });
	const { id, child } = await launch();
	for (const text of ["alpha", "bravo", "charlie"]) child.spec.onEvent(userMessage(text));
	await finishesUnchanged(core, id, child, sent);
	await eventually(() => audit.read(id), (read) => read.health.closed);
	const stale = (await audit.read(id)).next;
	await damage(journalOf(root, id), "bravo", "brava");
	await writeFile(journalOf(root, id), "torn", { flag: "a" });
	await rm(indexOf(root, id), { recursive: true });
	const original = await readFile(journalOf(root, id));

	abortOnRead = true;
	assert.deepEqual(await audit.repair(id, controller.signal), { cancelled: true });
	abortOnRead = false;
	assert.equal((await audit.read(id, stale)).refresh, undefined);

	const repaired = await audit.repair(id);
	const last = repaired.recovered;
	assert.deepEqual(repaired, {
		generation: 1,
		recovered: last,
		unavailable: [{ from: 4, to: 4 }, { from: last + 1 }],
		unsupported: [],
	});
	assert.deepEqual(await readFile(journalOf(root, id)), original);
	assert.deepEqual(await audit.read(id, stale), {
		refresh: true,
		identity: (await audit.read(id)).identity,
		health: (await audit.read(id)).health,
	});

	const window = await audit.read(id);
	assert.equal(window.warning, undefined);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["alpha", "charlie"]);
	assert.deepEqual(window.unavailable, [{ from: 4, to: 4 }, { from: last + 1 }]);
});

function forged(header) {
	const body = `${JSON.stringify(header)}\t{}`;
	return `${crc32(body).toString(16).padStart(8, "0")}\t${body}\n`;
}

test("evidence in an unsupported format stays visible as uninterpreted after repair", async (t) => {
	const { audit, core, sent, launch, root } = auditedCore(t);
	const { id, child } = await launch();
	await finishesUnchanged(core, id, child, sent);
	const written = (await eventually(() => audit.read(id), (read) => read.health.closed)).health
		.written;
	await writeFile(journalOf(root, id), forged({ v: 2, ordinal: written, part: 0, parts: 1 }), {
		flag: "a",
	});

	const repaired = await audit.repair(id);
	assert.deepEqual(repaired.unsupported, [written]);
	const window = await audit.read(id, { from: written });
	assert.deepEqual(window.observations, [{ ordinal: written, written: true, unsupported: true }]);
	assert.match(window.warning, /unsupported format/);
});

test("a block larger than a window is listed without being read and expands by bounded segments in both directions", async (t) => {
	const files = faultyFiles();
	const { audit, launch } = auditedCore(t, {
		files,
		limits: { chunk: 1024, windowBytes: 4096 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	const text = unicodeText(20_000);
	child.spec.onEvent(
		toolEvent("end", "c1", {
			result: { content: [{ type: "text", text }] },
			isError: false,
		}),
	);
	await eventually(() => audit.read(id), allWritten);
	files.reads.length = 0;

	const window = await audit.read(id);
	const { large } = window.observations.find((item) => item.large?.meta.call === "c1");
	assert.equal(large.meta.phase, "end");
	assert.ok(files.reads.filter(isJournal).reduce((total, read) => total + read.bytes, 0) <= 4096);

	const segments = [];
	for (let cursor = large.segment; cursor; ) {
		files.reads.length = 0;
		const segment = await audit.segment(id, cursor);
		assert.ok(files.reads.filter(isJournal).every((read) => read.bytes <= 1024 + 512));
		segments.push({ cursor, segment });
		cursor = segment.next;
	}
	assert.equal(segments.at(-1).segment.final, true);
	assert.equal(
		segments
			.filter(({ segment }) => segment.field === "result.content.0.text")
			.map(({ segment }) => segment.text)
			.join(""),
		text,
	);
	const back = await audit.segment(id, segments.at(-1).segment.previous);
	assert.deepEqual(back, segments.at(-2).segment);
});

const reopen = (root, parent = "parent-1", options = {}) =>
	createChildAudit({ root, parent: () => parent, ...options });

const outcome = ({ section, state, verdict, interrupted }) => ({ section, state, verdict, interrupted });

async function listed(audit) {
	const { records, next } = await audit.list();
	assert.equal(next, undefined);
	return Object.fromEntries(records.map((record) => [record.child, record]));
}

test("reopening the same parent lists a known terminal child and an interrupted running child as read-only history", async (t) => {
	const { audit, core, launch, root } = auditedCore(t);
	const finished = await launch();
	finished.child.spec.report(done);
	finished.child.result.resolve("Done.");
	await eventually(async () => core.get(finished.id).state, (state) => state === "completed");
	const working = await launch();
	working.child.spec.onEvent(userMessage("Started"));
	await eventually(async () => core.get(working.id).state, (state) => state === "running");
	await core.disposeAll();
	await audit.close();

	const later = reopen(root);
	const records = await listed(later);
	assert.deepEqual(outcome(records[finished.id]), {
		section: "history",
		state: "completed",
		verdict: "done",
		interrupted: undefined,
	});
	assert.deepEqual(outcome(records[working.id]), {
		section: "history",
		state: "running",
		verdict: undefined,
		interrupted: true,
	});
	for (const record of Object.values(records)) {
		assert.equal(record.health.complete, true);
		assert.equal(record.health.closed, true);
	}
	assert.equal(records[working.id].identity.task, "Fix the failing test");

	const window = await later.read(working.id);
	assert.equal(window.identity.child, working.id);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["Started"]);
	assert.equal(window.health.complete, true);
});

test("children still queued or waiting when the parent closed reopen as Interrupted child records", async (t) => {
	const { audit, core, launch, root } = auditedCore(t);
	const launched = [];
	for (let i = 0; i < 6; i++) launched.push(await launch());
	await eventually(async () => core.get(launched[4].id).state, (state) => state === "running");
	launched[0].child.spec.ask("Which file?").catch(() => {});
	await eventually(async () => core.get(launched[0].id).state, (state) => state === "waiting");
	assert.equal(core.get(launched[5].id).state, "queued");
	await audit.close();

	const records = await listed(reopen(root));
	assert.deepEqual(outcome(records[launched[0].id]), {
		section: "history",
		state: "waiting",
		verdict: undefined,
		interrupted: true,
	});
	assert.deepEqual(outcome(records[launched[5].id]), {
		section: "history",
		state: "queued",
		verdict: undefined,
		interrupted: true,
	});
});

test("a known terminal outcome is kept when its transcript is incomplete, and only the written loss facts are reported", async (t) => {
	const { files, failNext } = failingNext();
	const { audit, core, sent, launch, root } = auditedCore(t, { files });
	const { id, child } = await launch();
	const before = await flushed(audit, id);
	failNext({ bytes: 0 });
	child.spec.onEvent(userMessage("one"));
	await finishesUnchanged(core, id, child, sent);
	await eventually(() => audit.read(id), (read) => read.health.marker);
	await audit.close();

	const record = (await listed(reopen(root)))[id];
	assert.deepEqual(outcome(record), {
		section: "history",
		state: "completed",
		verdict: "done",
		interrupted: undefined,
	});
	assert.deepEqual(record.health, {
		complete: false,
		closed: true,
		written: before.health.received,
		lostFrom: before.health.received,
		marker: "written",
		warning: "Audit capture failed: the storage accepted no bytes.",
	});
});

async function readAll(audit, id) {
	const texts = [];
	let window = await audit.read(id);
	for (let i = 0; i < 50; i++) {
		texts.push(...inputs(window).map(({ text }) => text));
		const next = await audit.read(id, window.next);
		if (next.next.from === window.next.from && next.next.offset === window.next.offset) break;
		window = next;
	}
	return { texts, window };
}

test("after an abrupt end the verified prefix is recoverable and only available facts are reported", async (t) => {
	const { audit, launch, root } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	child.spec.onEvent(userMessage("alpha"));
	await drained(audit, root, id);
	const index = ["head.json", "0-0.json"].map((name) => join(indexOf(root, id), name));
	const stale = await Promise.all(index.map((path) => readFile(path)));
	child.spec.onEvent(userMessage("bravo"));
	child.spec.onEvent(userMessage("charlie"));
	await drained(audit, root, id);
	await Promise.all(index.map((path, i) => writeFile(path, stale[i])));
	await writeFile(journalOf(root, id), '0badc0de\t{"v":1,"ordinal":9,"part":0', { flag: "a" });

	const later = reopen(root);
	const record = (await listed(later))[id];
	assert.deepEqual(outcome(record), {
		section: "history",
		state: "running",
		verdict: undefined,
		interrupted: true,
	});
	assert.deepEqual(record.health, {
		complete: false,
		closed: false,
		warning: "The record was not closed; evidence after its last verified line may be missing.",
	});
	const { texts } = await readAll(later, id);
	assert.deepEqual(texts, ["alpha", "bravo", "charlie"]);
});

test("a reopened record without its index is still listed and read from verified journal lines, with a warning", async (t) => {
	const { audit, launch, root } = auditedCore(t, { run: () => new Promise(() => {}) });
	const { id, child } = await launch();
	child.spec.onEvent(userMessage("alpha"));
	await flushed(audit, id);
	await audit.close();
	await rm(indexOf(root, id), { recursive: true });

	const later = reopen(root);
	assert.equal((await listed(later))[id].health.complete, true);
	const window = await later.read(id);
	assert.deepEqual(inputs(window).map(({ text }) => text), ["alpha"]);
	assert.match(window.warning, /index is missing or damaged/);
});

test("another parent session, such as a fork or clone, neither lists nor reads this parent's children", async (t) => {
	const { audit, launch, root } = auditedCore(t);
	const { id } = await launch();
	await flushed(audit, id);
	await audit.close();

	const fork = reopen(root, "parent-2");
	assert.deepEqual(await fork.list(), { records: [] });
	assert.equal(await fork.read(id), undefined);
	assert.equal(await fork.read(`../parent-1/${id}`), undefined);
	assert.deepEqual(Object.keys(await listed(reopen(root))), [id]);
});

test("recovered history never becomes executable: no child, launch slot, question, result, or turn is restored", async (t) => {
	const { audit, core, launch, root } = auditedCore(t);
	const finished = await launch();
	finished.child.spec.report(done);
	finished.child.result.resolve("Done.");
	await eventually(async () => core.get(finished.id).state, (state) => state === "completed");
	const asking = await launch();
	await eventually(async () => core.get(asking.id).state, (state) => state === "running");
	asking.child.spec.ask("Which file?").catch(() => {});
	await core.disposeAll();
	await audit.close();

	const later = reopen(root);
	const children = fakeChildren();
	const sent = [];
	const fresh = createChildSessions({
		create: children.create,
		send: (message) => sent.push(message),
		idle: () => true,
		trace() {},
		report() {},
		audit: later,
	});
	assert.equal(Object.keys(await listed(later)).length, 2);
	await later.read(finished.id);
	await later.read(asking.id);
	await delay(10);
	assert.deepEqual(fresh.list(), []);
	assert.equal(fresh.get(finished.id), undefined);
	assert.equal(fresh.working(), 0);
	assert.equal(fresh.waiting(), false);
	assert.equal(fresh.get(asking.id), undefined);
	assert.deepEqual(children.created, []);
	assert.deepEqual(sent, []);
});

function manualTimer() {
	const timers = [];
	return {
		timer(task, ms) {
			const entry = { task, ms, cancelled: false };
			timers.push(entry);
			return () => {
				entry.cancelled = true;
			};
		},
		timers,
		expire() {
			for (const entry of timers) if (!entry.cancelled) entry.task();
		},
	};
}

test("closing drains admitted evidence, seals the record, and discards callbacks that arrive afterwards", async (t) => {
	const clock = manualTimer();
	const { audit, launch, root } = auditedCore(t, { run: () => new Promise(() => {}), timer: clock.timer });
	const { id, child } = await launch();
	child.spec.onEvent(userMessage("last words"));
	assert.deepEqual(await audit.close(), { closed: 1, expired: 0 });
	assert.deepEqual(clock.timers.map(({ ms, cancelled }) => ({ ms, cancelled })), [{ ms: 1000, cancelled: true }]);
	const sealed = await readFile(journalOf(root, id));

	child.spec.onEvent(userMessage("too late"));
	await delay(20);
	assert.deepEqual(await readFile(journalOf(root, id)), sealed);
	assert.equal(await audit.read(id).then((read) => read.health.closed), true);
	const later = reopen(root);
	assert.deepEqual(inputs(await later.read(id)).map(({ text }) => text), ["last words"]);
});

test("when the drain deadline expires the close returns, frees the budget, and a late write completion appends nothing more", async (t) => {
	const clock = manualTimer();
	const stuck = Promise.withResolvers();
	let hold = false;
	const files = faultyFiles({
		write: async (_call, length) => {
			if (hold) await stuck.promise;
			return { bytes: length };
		},
	});
	const { audit, launch, root } = auditedCore(t, {
		files,
		timer: clock.timer,
		limits: { chunk: 1024, entries: 16 },
		run: () => new Promise(() => {}),
	});
	const { id, child } = await launch();
	await flushed(audit, id);
	hold = true;
	for (let i = 0; i < 13; i++) child.spec.onEvent(userMessage(`message ${i}`));
	assert.equal((await audit.read(id)).health.lost, 0);
	await delay(10);
	const closing = audit.close();
	clock.expire();
	assert.deepEqual(await closing, { closed: 0, expired: 1 });
	const size = (await readFile(journalOf(root, id))).length;

	stuck.resolve();
	await delay(20);
	assert.ok((await readFile(journalOf(root, id))).length <= size + 1024);
	const record = (await listed(reopen(root)))[id];
	assert.equal(record.health.complete, false);
	assert.equal(record.health.closed, false);

	const next = await launch();
	const fresh = await flushed(audit, next.id);
	assert.equal(fresh.health.complete, true);
});

test("the parent's records are listed in bounded pages, live working children in the working section", async (t) => {
	const { audit, core, launch, root } = auditedCore(t, { limits: { catalog: 2 } });
	const ids = [];
	for (let i = 0; i < 3; i++) ids.push((await launch()).id);
	await eventually(async () => core.get(ids[2]).state, (state) => state === "running");

	const first = await audit.list();
	assert.equal(first.records.length, 2);
	assert.ok(first.next);
	const second = await audit.list(first.next);
	assert.equal(second.next, undefined);
	const all = [...first.records, ...second.records];
	assert.deepEqual(all.map(({ child }) => child), [...ids].sort());
	assert.ok(all.every(({ section, state }) => section === "working" && state === "running"));

	await audit.close();
	const later = reopen(root, "parent-1", { limits: { catalog: 2 } });
	const reopened = await later.list();
	assert.equal(reopened.records.length, 2);
	assert.equal((await later.list(reopened.next)).records.length, 1);
});
