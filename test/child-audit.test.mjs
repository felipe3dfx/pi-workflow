import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { crc32 } from "node:zlib";

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

function auditedCore(
	t,
	{ root = withAgentDirectory(t), parent = "parent-1", limits, run, files, schedule } = {},
) {
	const children = fakeChildren({ run });
	const audit = createChildAudit({ root, parent: () => parent, limits, files, schedule });
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
	child.spec.onEvent({
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "ask_parent",
		result: { content: [{ type: "text", text: "src/a.ts" }], details: {} },
		isError: false,
	});

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(
		window.observations
			.filter((entry) => entry.kind === "input")
			.map(({ source, delivery, question, text }) => ({ source, delivery, question, text })),
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
	assert.deepEqual(window.transcript, [
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

	const live = await audit.read(id);
	assert.deepEqual(live.transcript, [
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
	]);

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(events(window), [
		"m1:start",
		"m1:update:1",
		"m1:update:2",
		"m1:update:3",
		"m1:end",
		"m1:update:4",
	]);
	assert.deepEqual(window.transcript, live.transcript);
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

	const window = await eventually(() => audit.read(id), allWritten);
	assert.deepEqual(window.transcript, [
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

	const window = await eventually(() => audit.read(id), allWritten);
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
	assert.deepEqual(window.health, { complete: true, received: 6, admitted: 6, written: 6, lost: 0 });
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

	const summary = (window) =>
		window.transcript.map((entry) =>
			entry.type === "tool"
				? `${entry.call} final=${entry.final}`
				: `${entry.message} ${entry.content[0].text}`,
		);
	const one = await eventually(() => audit.read(first.id), allWritten);
	const two = await eventually(() => audit.read(second.id), allWritten);
	assert.deepEqual(summary(one), ["c1 final=true", "m1 same", "m2 same"]);
	assert.deepEqual(summary(two), ["c1 final=true", "m1 same"]);
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
	assert.deepEqual(window.transcript, [
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
					const plan = fault.write?.(call, length) ?? { bytes: length };
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
	window.transcript.find(
		(entry) => entry.type === "tool" && entry.call === call,
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
	await eventually(() => audit.read(id), allWritten);
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
	const written = (await eventually(() => audit.read(id), allWritten)).health.written;
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
	const entry = window.transcript.find((item) => item.call === "c1");
	assert.equal(entry.result, undefined);
	assert.equal(entry.final, true);
	assert.ok(files.reads.filter(isJournal).reduce((total, read) => total + read.bytes, 0) <= 4096);

	const segments = [];
	for (let cursor = entry.resultSegment; cursor; ) {
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
