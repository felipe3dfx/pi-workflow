import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

import { initTheme } from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createChildAudit } from "../extensions/child-audit.ts";
import { createTranscript } from "../extensions/child-transcript.ts";
import { createChildrenViews } from "../extensions/children-view.ts";
import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { withAgentDirectory } from "./support/jev-routing.mjs";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
	expectations: {},
});

initTheme("dark", false);

const codes = {
	accent: 36,
	dim: 90,
	muted: 37,
	error: 31,
	warning: 33,
	success: 32,
	toolTitle: 92,
	border: 34,
	text: 97,
};

const theme = {
	fg: (color, text) => `\x1b[${codes[color] ?? 39}m${text}\x1b[39m`,
	bg: (_color, text) => `\x1b[48;5;236m${text}\x1b[49m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
};

const keys = new KeybindingsManager({
	...TUI_KEYBINDINGS,
	"app.thinking.toggle": {
		defaultKeys: "ctrl+t",
		description: "Toggle thinking",
	},
	"app.tools.expand": {
		defaultKeys: "ctrl+o",
		description: "Toggle tool output",
	},
});

const plain = (line) => stripVTControlCharacters(line);
const now = Date.now();

function record(id, overrides = {}) {
	return {
		id: `${id}000000-0000-0000-0000-000000000000`,
		role: "worker",
		task: "Run sleep 60 to wait 60 seconds, then confirm that you are done. Do not modify files.",
		worktree: "/home/u/repos/pi-workflow",
		model: "xai/gpt-6-luna",
		thinking: "high",
		state: "running",
		createdAt: now - 62_000,
		startedAt: now - 62_000,
		...overrides,
	};
}

function assistant(id, content, extra = {}) {
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
			usage: { totalTokens: 6200, cost: { total: 0.015 } },
			timestamp: 1,
			...extra,
		},
	};
}

function result(id, toolCallId, isError = false) {
	return {
		type: "message",
		id,
		message: {
			role: "toolResult",
			toolCallId,
			toolName: "bash",
			content: [{ type: "text", text: "ok" }],
			isError,
		},
	};
}

function busyThread() {
	return {
		entries: [
			{
				type: "message",
				id: "u1",
				message: { role: "user", content: record("5636").task },
			},
			assistant("a1", [
				{ type: "thinking", thinking: "Waiting 60 seconds.\tThen report." },
				{
					type: "text",
					text: "Voy a **esperar** 60 segundos — 漢字テキスト 🚀 y luego `confirmo`.",
				},
				{
					type: "toolCall",
					id: "t1",
					name: "read",
					arguments: { path: "extensions/children-view.ts" },
				},
				{
					type: "toolCall",
					id: "t2",
					name: "mcp__engram__mem_search",
					arguments: { query: "x" },
				},
				{
					type: "toolCall",
					id: "t3",
					name: "bash",
					arguments: { command: "sleep 60" },
				},
			]),
			result("r1", "t1"),
			result("r2", "t2", true),
		],
	};
}

function fakeSessions(records, threads = {}) {
	const listeners = new Set();
	const followers = new Map();
	return {
		records,
		threads,
		followers,
		list: () => records.map((item) => ({ ...item })),
		get(id) {
			const found = records.find((item) => item.id === id);
			return found && { ...found };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		follow(id, listener) {
			followers.set(id, (followers.get(id) ?? 0) + 1);
			void listener;
			return () => followers.set(id, followers.get(id) - 1);
		},
		thread: (id) => threads[id],
		changedFiles: () => [],
		cancel(id) {
			const found = records.find((item) => item.id === id);
			found.state = "cancelled";
			found.endedAt = Date.now();
			found.text = "The child was cancelled.";
			return { cancelled: true, message: "" };
		},
		replies: [],
		reply(id, number, text, by) {
			const found = records.find((item) => item.id === id);
			if (found.question !== number) {
				throw new Error(
					`Question ${number} of child ${id} was already answered by the parent: \x1b[31mred\x1b[39m`,
				);
			}
			this.replies.push({ id, number, text, by });
			found.state = "running";
			found.question = undefined;
		},
		steers: [],
		async steer(id, text) {
			if (text.startsWith("/")) {
				throw new Error("A Steer cannot begin with \x1b[31m/\x1b[39m.");
			}
			this.steers.push({ id, text });
		},
		changed() {
			for (const listener of listeners) listener();
		},
	};
}

function audited(t, records, options = {}) {
	const audit = createChildAudit({
		root: options.root ?? withAgentDirectory(t),
		parent: () => ("parent" in options ? options.parent : "parent-1"),
		limits: options.limits,
	});
	const captures = {};
	for (const item of records) {
		captures[item.id] = audit.begin({
			child: item.id,
			role: item.role,
			task: item.task,
			references: [],
			instructions: "You are a worker. Follow the Contract.",
			tools: ["read"],
			model: item.model,
			thinking: item.thinking,
			worktree: item.worktree,
			createdAt: item.createdAt,
			...(item.group === undefined ? {} : { group: item.group }),
		});
	}
	const emit = (id, event) => captures[id].event(event);
	return {
		audit,
		captures,
		emit,
		say(id, content, extra = {}) {
			const message = { role: "assistant", content, ...extra };
			emit(id, { type: "message_start", message });
			emit(id, { type: "message_end", message });
		},
		tool(id, call, toolName, args, text, isError = false) {
			emit(id, { type: "tool_execution_start", toolCallId: call, toolName, args });
			if (text === undefined) return;
			emit(id, {
				type: "tool_execution_end",
				toolCallId: call,
				toolName,
				result: { content: [{ type: "text", text }] },
				isError,
			});
		},
	};
}

async function settle(view, width = 120) {
	let quiet = 0;
	for (let i = 0; i < 400 && quiet < 4; i++) {
		const renders = view.tui.renders;
		view.lines(width);
		await delay(5);
		quiet = view.tui.renders === renders ? quiet + 1 : 0;
	}
	return view.lines(width).join("\n");
}

const emptyAudit = {
	list: async () => ({ records: [] }),
	read: async () => undefined,
	segment: async () => undefined,
};

function manualSchedule() {
	const pending = new Set();
	const schedule = (run, ms) => {
		const timer = { run, ms };
		pending.add(timer);
		return () => pending.delete(timer);
	};
	return {
		schedule,
		pending: () => [...pending].map((timer) => timer.ms),
		fire() {
			for (const timer of [...pending]) {
				pending.delete(timer);
				timer.run();
			}
		},
	};
}

function open(
	sessions,
	{
		rows = 40,
		schedule = manualSchedule().schedule,
		latest = false,
		tasks = {},
		audit = emptyAudit,
	} = {},
) {
	let factory;
	const views = createChildrenViews(
		sessions,
		audit,
		{ text: (id) => tasks[id] },
		schedule,
	);
	void views.open({
		ui: {
			custom(make) {
				factory = make;
				return new Promise(() => {});
			},
		},
	});
	const tui = {
		renders: 0,
		requestRender() {
			this.renders += 1;
		},
		terminal: { rows },
	};
	let closed = false;
	const component = factory(tui, theme, keys, () => {
		closed = true;
	});
	if (!latest) component.handleInput("k");
	return {
		tui,
		component,
		closed: () => closed,
		press: (...data) => {
			for (const key of data) component.handleInput(key);
		},
		raw: (width) => component.render(width),
		lines: (width) => component.render(width).map(plain),
		mouse: (event) =>
			component.handleMouse({ button: "left", clickCount: 1, ...event }),
	};
}

function threeChildren() {
	const running = record("5636", { step: "bash sleep 60" });
	const done = record("a809", {
		state: "completed",
		role: "worker",
		endedAt: now - 1_000,
		startedAt: now - 65_000,
		text: "Waited 60 seconds.",
	});
	const failed = record("27c1", {
		state: "failed",
		role: "reviewer",
		endedAt: now - 2_000,
		startedAt: now - 242_000,
		text: "no activity for 4 minutes",
	});
	return fakeSessions([done, running, failed], {
		[running.id]: busyThread(),
		[done.id]: { entries: [] },
		[failed.id]: { entries: [] },
	});
}

test("the view never draws more lines than the terminal has rows, nor a line wider than it, from 40x10 to 200x60", () => {
	const sessions = threeChildren();
	for (const rows of [10, 12, 16, 24, 40, 60]) {
		const view = open(sessions, { rows });
		for (const focus of ["list", "detail"]) {
			for (const width of [40, 56, 64, 65, 72, 80, 100, 120, 139, 160, 200]) {
				const lines = view.raw(width);
				assert.ok(lines.length <= rows, `${focus} ${width}x${rows}`);
				for (const line of lines) {
					assert.ok(visibleWidth(line) <= width, `${focus} ${width}x${rows}`);
					assert.equal(line.includes("\n"), false);
					assert.equal(line.includes("\t"), false);
					assert.equal(line.includes("\x1b]133"), false);
				}
			}
			view.press("\t");
		}
	}
});

test("from 65 columns the view splits into a list and a detail pane; below that it keeps one pane", () => {
	const sessions = threeChildren();
	const view = open(sessions, { rows: 40 });

	const wide = view.lines(120);
	assert.match(wide[0], /^ ┌─ Fleet 3 · 1 active · 6\.2k tok · \$0\.01 ─+ \[×\] ─┐$/);
	assert.equal(wide[1].indexOf("│", 2), 1 + 1 + 2 + 34 + 1);
	assert.match(wide[1], /Working ─+ │ ◐ worker 5636 +running · 1m 0\ds {2}│$/);
	assert.match(
		wide[2],
		/▸ ◐ worker 5636 +running · 1m 0\ds │ gpt-6-luna \(high\) · 6\.2k tok · \$0\.01 · wt: pi-workflow/,
	);
	assert.match(wide[3], /^ │ {6}bash sleep 60 6\.2k tok · \$0\.01 │ Run sleep 60 /);

	const narrow = view.lines(80);
	assert.equal(narrow[1].indexOf("│", 2), 1 + 1 + 2 + 23 + 1);

	assert.notEqual(view.lines(65)[1].indexOf(" │ "), -1);
	const single = view.lines(64);
	assert.equal(single[1].split("│").length, 3);
	assert.match(single.join("\n"), /j\/k move {2}\| {2}Enter detail/);
});

test("list rows take two lines under Working and History rules, and the selected child gets the selection background on both", () => {
	const view = open(threeChildren(), { rows: 40 });
	const raw = view.raw(120);
	const lines = raw.map(plain);
	assert.match(lines[1], /│ {2} Working ─/);
	assert.match(lines[2], /▸ ◐ worker 5636 +running · 1m 0\ds/);
	assert.match(lines[3], /│ {6}bash sleep 60 +6\.2k tok · \$0\.01 │/);
	assert.match(lines[4], /│ {2} History ─/);
	assert.match(lines[5], /│ {4}✓ worker a809 +completed · 1m 04s/);
	assert.match(lines[6], /│ {6}Run sleep 60/);
	assert.match(lines[7], /│ {4}✗ reviewer 27c1 +failed · 4m 00s/);
	assert.ok(raw[2].includes("\x1b[48;5;236m"));
	assert.ok(raw[3].includes("\x1b[48;5;236m"));
	assert.equal(raw[5].includes("\x1b[48;5;236m"), false);

	view.press("j");
	const moved = view.raw(120);
	assert.ok(moved[5].includes("\x1b[48;5;236m"));
	assert.match(plain(moved[1]), /│ ✓ worker a809 +completed · 1m 04s/);
});

test("the list keeps the selected child in view and falls back to one line per child on short terminals", () => {
	const records = Array.from({ length: 12 }, (_, i) =>
		record(`${1000 + i}`, { task: `Task ${i}` }),
	);
	const view = open(fakeSessions(records), { rows: 16 });
	view.press(..."j".repeat(11));
	const lines = view.lines(120);
	assert.match(lines.join("\n"), /▸ ◐ worker 1011/);
	assert.doesNotMatch(lines.join("\n"), /worker 1000/);

	const short = open(fakeSessions(records), { rows: 10 });
	const rows = short
		.lines(120)
		.map((line) => line.slice(0, 40))
		.filter((line) => /◐ worker/.test(line));
	assert.match(rows[0], /▸ ◐ worker 1000 +running/);
	assert.ok(rows.length >= 4);
});

function busyEvidence(capture, id) {
	capture.say(id, [
		{ type: "thinking", thinking: "Waiting 60 seconds.\tThen report." },
		{
			type: "text",
			text: "Voy a **esperar** 60 segundos — 漢字テキスト 🚀 y luego `confirmo`.",
		},
		{ type: "toolCall", id: "t1", name: "read", arguments: { path: "extensions/children-view.ts" } },
	]);
	capture.tool(id, "t1", "read", { path: "extensions/children-view.ts" }, "ok");
	capture.tool(id, "t2", "mcp__engram__mem_search", { query: "x" }, "no index", true);
	capture.tool(id, "t3", "bash", { command: "sleep 60" });
}

test("the detail shows a header, the clamped prompt, the audited thread in chat rows, and a result once the child ends", async (t) => {
	const long = Array.from(
		{ length: 8 },
		(_, i) => `Step ${i} of the work.`,
	).join("\n");
	const running = record("5636", { task: long });
	const failed = record("27c1", {
		state: "failed",
		endedAt: now,
		text: "The child failed: provider error",
	});
	const capture = audited(t, [running, failed]);
	capture.emit(running.id, {
		type: "message_start",
		message: { role: "user", content: [{ type: "text", text: long }] },
	});
	busyEvidence(capture, running.id);
	const sessions = fakeSessions([running, failed]);
	const view = open(sessions, { rows: 60, audit: capture.audit });
	let text = await settle(view);
	assert.match(text, / Prompt ─/);
	assert.match(text, /❯ Step 0 of the work\./);
	assert.match(text, /Step 3 of the work\./);
	assert.doesNotMatch(text, /Step 4 of the work\./);
	assert.match(text, /… \+4 lines · p expand/);
	assert.match(text, /Contract · 1 line · p expand/);
	assert.match(text, / Thread ─/);
	assert.match(text, /◆ Thought\s/);
	assert.match(text, / {2}Waiting 60 seconds\. {3}Then report\./);
	assert.match(text, /Voy a esperar 60 segundos/);
	assert.match(text, /◆ Read extensions\/children-view\.ts/);
	assert.match(text, /◆ Engram Mem Search/);
	assert.match(text, /◆ Run sleep 60/);
	assert.doesNotMatch(text, / Result ─/);
	const raw = view.raw(120).join("\n");
	assert.ok(raw.includes("\x1b[92m◆\x1b[39m \x1b[1m\x1b[37mRead"));
	assert.ok(raw.includes("\x1b[31m◆\x1b[39m \x1b[1m\x1b[37mEngram"));
	assert.ok(raw.includes("\x1b[90m◆\x1b[39m \x1b[1m\x1b[37mRun"));
	assert.ok(raw.includes("  \x1b[31mno index"));

	view.press("p");
	text = view.lines(120).join("\n");
	assert.match(text, /Step 7 of the work\./);
	assert.match(text, /You are a worker\. Follow the Contract\./);

	view.press("\x14");
	text = view.lines(120).join("\n");
	assert.match(text, /◆ Thought/);
	assert.doesNotMatch(text, /Waiting 60 seconds/);

	view.press("j");
	text = await settle(view);
	assert.match(text, /✗ worker 27c1 +failed · 1m 02s/);
	assert.match(text, / Result ─/);
	assert.ok(
		view
			.raw(120)
			.some((line) =>
				line.includes("\x1b[31mThe child failed: provider error"),
			),
	);
});

test("a thought streamed while the view is open shows its duration once it ends", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	capture.emit(child.id, {
		type: "message_update",
		message: streaming,
		assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Planning the wait." },
	});
	const sessions = fakeSessions([child]);
	const view = open(sessions, { audit: capture.audit });
	assert.match(await settle(view), /◆ Thinking…/);
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "thinking", thinking: "Planning the wait." }] },
	});
	sessions.changed();
	assert.match(await settle(view), /◆ Thought for \d+\.\ds/);
});

function lines40(t, child, others = []) {
	const capture = audited(t, [child, ...others]);
	for (let i = 0; i < 40; i++) capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
	return capture;
}

test("Tab moves the focus between panes, Ctrl+J/K and page keys scroll the focused pane, f follows the tail, and Esc or q closes", async (t) => {
	const child = record("5636");
	const capture = lines40(t, child);
	const sessions = fakeSessions([child]);
	const view = open(sessions, { rows: 20, audit: capture.audit });
	assert.match(await settle(view), /Line 39\./);
	assert.match(
		view.lines(120).at(-3),
		/j\/k move {2}\| {2}Tab focus {2}\| {2}Enter steer {2}\| {2}Ctrl\+J\/K scroll {2}\| {2}f follow {2}\| {2}s\/c cancel/,
	);
	const accent = "\x1b[1m\x1b[36mworker 5636";
	assert.equal(
		view.raw(120).some((line) => line.includes(accent)),
		false,
	);
	view.press("\t");
	assert.ok(view.raw(120).some((line) => line.includes(accent)));

	view.press("\x0b", "\x0b");
	let text = await settle(view);
	assert.doesNotMatch(text, /Line 39\./);
	capture.say(child.id, [{ type: "text", text: "Line 40." }]);
	sessions.changed();
	assert.doesNotMatch(await settle(view), /Line 40\./);
	view.press("\x1b[6~", "\x1b[6~", "\x1b[6~");
	assert.match(await settle(view), /Line 40\./);
	view.press("\x1b[5~");
	assert.doesNotMatch(await settle(view), /Line 40\./);
	view.press("f");
	assert.match(await settle(view), /Line 40\./);

	view.press("\n");
	text = view.lines(120).join("\n");
	assert.match(text, /Line 40\./);

	view.press("\x1b");
	assert.equal(view.closed(), true);
});

test("in one pane, Enter opens the detail, j/k scroll it, and Esc goes back to the list", async (t) => {
	const child = record("5636");
	const capture = lines40(t, child);
	const view = open(fakeSessions([child]), { rows: 20, audit: capture.audit });
	view.press("\r");
	let lines = (await settle(view, 60)).split("\n");
	assert.match(lines[1], /◐ worker 5636 +running · 1m 0\ds/);
	assert.match(lines.join("\n"), /Line 39\./);
	assert.match(lines.join("\n"), /Esc back/);
	view.press("k");
	assert.doesNotMatch(await settle(view, 60), /Line 39\./);
	view.press("\x1b");
	lines = view.lines(60);
	assert.match(lines[2], /▸ ◐ worker 5636/);
	assert.equal(view.closed(), false);
	view.press("q");
	assert.equal(view.closed(), true);
});

test("s or c cancels the selected child after y/n in the two-pane view", () => {
	const sessions = threeChildren();
	const view = open(sessions);
	view.press("s");
	assert.match(view.lines(120).join("\n"), /Cancel worker 5636\? y\/n/);
	assert.match(view.lines(120).at(-2), /y yes {2}\| {2}n no/);
	view.press("y");
	assert.equal(sessions.get(sessions.records[1].id).state, "cancelled");
	assert.match(view.lines(120).join("\n"), /worker 5636 cancelled\./);
});

test("a click selects a list row, a double click focuses the detail, the wheel scrolls the pane under the pointer, and footer labels and [×] act", async (t) => {
	const records = [
		record("5636"),
		...Array.from({ length: 12 }, (_, i) => record(`${1000 + i}`)),
	];
	const capture = lines40(t, records[0]);
	const view = open(fakeSessions(records), { rows: 20, audit: capture.audit });
	let lines = view.lines(120);
	const row = lines.findIndex((line) => line.includes("worker 1001"));
	assert.deepEqual(view.mouse({ type: "click", x: 5, y: row }), {
		handled: true,
	});
	assert.match(view.lines(120)[row], /▸ ◐ worker 1001/);

	view.mouse({ type: "click", x: 5, y: row, clickCount: 2 });
	assert.ok(
		view.raw(120).some((line) => line.includes("\x1b[1m\x1b[36mworker 1001")),
	);

	view.press("k", "k");
	assert.match(await settle(view), /Line 39\./);
	assert.deepEqual(view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -5 }), {
		handled: true,
	});
	assert.doesNotMatch(await settle(view), /Line 39\./);

	const before = view.lines(120)[2];
	view.mouse({ type: "wheel", x: 5, y: 8, wheelDelta: 6 });
	assert.notEqual(view.lines(120)[2], before);

	lines = view.lines(120);
	const footer = lines.findIndex((line) => line.includes("f follow"));
	view.mouse({
		type: "click",
		x: lines[footer].indexOf("f follow") + 1,
		y: footer,
	});
	assert.match(await settle(view), /Line 39\./);

	assert.deepEqual(
		view.mouse({ type: "click", x: view.lines(120)[0].indexOf("×"), y: 0 }),
		{ handled: true },
	);
	assert.equal(view.closed(), true);
});

test("the elapsed time ticks every second while a child works, and the timer stops when the view closes", () => {
	const clock = manualSchedule();
	const sessions = threeChildren();
	const view = open(sessions, { schedule: clock.schedule });
	assert.deepEqual(clock.pending(), [1000]);
	const renders = view.tui.renders;
	clock.fire();
	assert.equal(view.tui.renders, renders + 1);
	assert.deepEqual(clock.pending(), [1000]);
	view.press("q");
	assert.deepEqual(clock.pending(), []);

	const idle = manualSchedule();
	open(fakeSessions([record("a809", { state: "completed", endedAt: now })]), {
		schedule: idle.schedule,
	});
	assert.deepEqual(idle.pending(), []);
});

test("the final assistant text and the error appear once, in the Result section, and the view opens on the latest finished child", async (t) => {
	const done = record("a809", {
		state: "completed",
		endedAt: now - 1_000,
		text: "Waited 60 seconds.",
	});
	const failed = record("27c1", {
		state: "failed",
		endedAt: now - 5_000,
		text: "provider error",
	});
	const capture = audited(t, [failed, done]);
	capture.say(done.id, [{ type: "text", text: "Checking first." }]);
	capture.say(done.id, [{ type: "text", text: "Waited 60 seconds.  " }]);
	capture.say(failed.id, [], { errorMessage: "provider error", stopReason: "error" });
	const view = open(fakeSessions([failed, done]), {
		rows: 60,
		latest: true,
		audit: capture.audit,
	});
	let text = await settle(view);
	assert.match(text, /Checking first\./);
	assert.equal(text.match(/Waited 60 seconds\./g)?.length, 1);
	assert.match(text, / Result ─/);
	view.press("k");
	text = await settle(view);
	assert.equal(text.match(/provider error/g)?.length, 1);
});

function scripted(id, totalTokens, total) {
	return {
		type: "message",
		id,
		message: {
			role: "toolResult",
			toolCallId: `${id}-call`,
			toolName: "codemode",
			content: [{ type: "text", text: "ok" }],
			usage: { totalTokens, cost: { total } },
			isError: false,
		},
	};
}

function fleet() {
	const running = record("5636", { step: "bash sleep 60" });
	const done = record("a809", {
		state: "completed",
		endedAt: now - 1_000,
		startedAt: now - 65_000,
		text: "Waited 60 seconds.",
	});
	const failed = record("27c1", {
		state: "failed",
		role: "reviewer",
		endedAt: now - 2_000,
		startedAt: now - 242_000,
		text: "no activity for 4 minutes",
	});
	const busy = busyThread();
	return fakeSessions([done, running, failed], {
		[running.id]: { entries: [...busy.entries, scripted("s1", 1800, 0.005)] },
		[done.id]: {
			entries: [
				assistant("d1", [{ type: "text", text: "Done." }], {
					usage: { totalTokens: 3000, cost: { total: 0.01 } },
				}),
				scripted("s2", 1000, 0.004),
			],
		},
		[failed.id]: { entries: [] },
	});
}

test("the Fleet view is titled Fleet with the total of every child, and each row shows its Run state, tokens, and cost including tool-result usage", () => {
	const view = open(fleet(), { rows: 40 });
	const lines = view.lines(120);
	assert.match(
		lines[0],
		/^ ┌─ Fleet 3 · 1 active · 12\.0k tok · \$0\.03 ─+ \[×\] ─┐$/,
	);
	assert.match(lines[2], /▸ ◐ worker 5636 +running · 1m 0\ds │/);
	assert.match(lines[3], /│ {6}bash sleep 60 +8\.0k tok · \$0\.02 │/);
	assert.match(lines[5], /✓ worker a809 +completed · 1m 04s │/);
	assert.match(lines[6], /│ {6}Run sleep.* 4\.0k tok · \$0\.01 │/);
	assert.match(lines[7], /✗ reviewer 27c1 +failed · 4m 00s │/);
	assert.match(
		lines[2],
		/│ gpt-6-luna \(high\) · 8\.0k tok · \$0\.02 · wt: pi-workflow/,
	);

});

test("one-line rows show the Run state, or only its time in the narrowest pane, then tokens, cost, and the step as the pane has room", () => {
	const split = open(fleet(), { rows: 10 }).lines(120);
	assert.match(split[2], /▸ ◐ worker 5636 +running · 1m 0\ds │/);
	assert.match(split[4], /✓ worker a809 +completed · 1m 04s │/);
	assert.match(split[5], /✗ reviewer 27c1 +failed · 4m 00s │/);

	const narrow = open(fleet(), { rows: 10 }).lines(80);
	assert.match(narrow[2], /▸ ◐ worker 5636 +1m 0\ds │/);
	assert.match(narrow[4], /✓ worker a809 +1m 04s │/);

	const single = open(fleet(), { rows: 10 }).lines(64);
	assert.match(
		single[2],
		/▸ ◐ worker 5636 bas… running · 1m 0\ds · 8\.0k tok · \$0\.02 +│$/,
	);
	assert.match(
		single[4],
		/✓ worker a809 R.* completed · 1m 04s · 4\.0k tok · \$0\.01 +│$/,
	);
	assert.match(single[5], /✗ reviewer 27c1 Run sleep.* failed · 4m 00s +│$/);
});

test("hostile text in a child's step, task, or model never reaches the terminal from the Fleet rows", () => {
	const bytes = ["\x1b[2J", "\x1b]52;c;", "\x9b", "\x07", "‮", "⁦"];
	const hostile = (label) =>
		`${label}\x1b[2J\x1b]52;c;eA==\x07\x9b31m‮⁦end`;
	const sessions = fakeSessions([
		record("5636", { step: hostile("step"), model: hostile("model") }),
		record("a809", {
			state: "failed",
			endedAt: now,
			task: hostile("task"),
			text: hostile("text"),
		}),
	]);
	for (const rows of [40, 10]) {
		const raw = open(sessions, { rows }).raw(120).join("\n");
		for (const sequence of bytes) {
			assert.equal(raw.includes(sequence), false, JSON.stringify(sequence));
		}
	}
});

test("the detail's input line answers a waiting child, and its text and refusals stay terminal-safe", () => {
	const waiting = record("5636", {
		state: "waiting",
		question: 2,
		step: "asks question 2",
	});
	const sessions = fakeSessions([waiting]);
	const view = open(sessions, { rows: 30 });

	const lines = view.lines(120);
	assert.ok(lines.some((line) => line.includes("❯ Enter to answer question 2")));
	assert.match(lines.join("\n"), /Enter answer/);
	view.press("\r", "\x1b[200~qs \x1b[31mc\u202e\x1b[201~", "\x7f", "a");
	const typed = view.raw(120).join("\n");
	assert.match(view.lines(120).join("\n"), /Enter send {2}\| {2}Esc stop typing/);
	assert.equal(typed.includes("\x1b[31mc"), false);
	assert.equal(typed.includes("\u202e"), false);
	view.press("\r");
	assert.deepEqual(sessions.replies, [
		{ id: waiting.id, number: 2, text: "qs  [31mca", by: "operator" },
	]);
	assert.ok(
		view.lines(120).some((line) => line.includes("Answer sent to worker 5636.")),
	);
	assert.equal(view.closed(), false);

	waiting.state = "waiting";
	waiting.question = 3;
	view.press("\r", "x");
	waiting.question = 4;
	view.press("\r");
	const refused = view.raw(160).join("\n");
	assert.equal(refused.includes("\x1b[31mred"), false);
	assert.match(
		view.lines(160).join("\n"),
		/Question 3 of child 5636[-0]+ was already answered by the parent:  \[31mred/,
	);
	assert.equal(sessions.replies.length, 1);
});

test("a waiting child without a question number does not advertise an answer", () => {
	const waiting = record("5636", { state: "waiting", step: "waiting" });
	const view = open(fakeSessions([waiting]), { rows: 30 });

	const text = view.lines(120).join("\n");
	assert.doesNotMatch(text, /Enter answer/);
	assert.match(text, /Enter input/);
});

test("the detail's input line shows why a queued child takes no Steer yet and an ended child takes neither a Steer nor an answer", () => {
	for (const [state, reason] of [
		["queued", "is queued; it takes a Steer once it runs."],
		...["completed", "failed", "cancelled", "timed out"].map((ended) => [
			ended,
			`is ${ended}; an ended child takes no Steer or answer.`,
		]),
	]) {
		const sessions = fakeSessions([
			record("5636", { state, endedAt: isWorkingState(state) ? undefined : now }),
		]);
		const view = open(sessions, { rows: 30 });
		view.lines(120);
		view.press("\r");
		assert.ok(
			view
				.lines(120)
				.some((line) =>
					line.includes(`worker 5636 ${reason}`),
				),
			state,
		);
		assert.deepEqual(sessions.replies, [], state);
		assert.deepEqual(sessions.steers, [], state);
	}
});

function isWorkingState(state) {
	return state === "queued" || state === "running";
}

test("the detail's input line steers a running child, and its text and refusals stay terminal-safe", async () => {
	const running = record("5636", { step: "bash sleep 60" });
	const sessions = fakeSessions([running]);
	const view = open(sessions, { rows: 30 });

	const lines = view.lines(120);
	assert.ok(lines.some((line) => line.includes("❯ Enter to steer")));
	assert.match(lines.join("\n"), /Enter steer/);
	view.press("\r", "\x1b[200~use \x1b[31mtabs\u202e\x1b[201~", "\r");
	await Promise.resolve();
	assert.deepEqual(sessions.steers, [{ id: running.id, text: "use  [31mtabs" }]);
	assert.ok(view.lines(120).some((line) => line.includes("Steer sent to worker 5636.")));

	view.press("\r", ..."/mcp", "\r");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(view.raw(120).join("\n").includes("\x1b[31m/"), false);
	assert.ok(
		view.lines(120).some((line) => line.includes("A Steer cannot begin with  [31m/")),
	);
	assert.equal(sessions.steers.length, 1);
});

test("a row marks its pending and undelivered Steers, and the detail lists their text terminal-safe", () => {
	const hostile = "go\x1b[2J\x1b]52;c;eA==\x07\x9b31m\u202eon";
	const running = record("5636", {
		step: "bash sleep 60",
		steering: [hostile, "then rerun"],
	});
	const ended = record("a809", {
		state: "completed",
		endedAt: now,
		text: "Done.",
		undelivered: ["late"],
	});
	for (const rows of [40, 10]) {
		const view = open(fakeSessions([running, ended]), { rows });
		const raw = view.raw(120).join("\n");
		for (const sequence of ["\x1b[2J", "\x1b]52;c;", "\x9b", "\x07", "\u202e"]) {
			assert.equal(raw.includes(sequence), false, JSON.stringify(sequence));
		}
		const lines = view.lines(120).join("\n");
		assert.match(lines, /2 steers pending/, `${rows}`);
		assert.match(lines, /1 steer undelivered/, `${rows}`);
	}
	const detail = open(fakeSessions([running]), { rows: 40 }).lines(120).join("\n");
	assert.match(detail, /pending go.*on/);
	assert.match(detail, /pending then rerun/);
});

test("a click on another row while typing stops typing, so Enter never sends the text to the newly selected child", () => {
	const sessions = fakeSessions([record("5636"), record("1001")]);
	const view = open(sessions, { rows: 30 });
	const lines = view.lines(120);
	const row = lines.findIndex((line) => line.includes("worker 1001"));
	view.press("\r", "x");
	view.mouse({ type: "click", x: 5, y: row });
	view.press("\r");
	assert.deepEqual(sessions.steers, []);
	assert.match(view.lines(120).join("\n"), /▸ ◐ worker 1001/);
});

test("a linked child's Fleet row shows its task number and text, truncated to the row and terminal-safe, without the Task state", () => {
	const sessions = fakeSessions([
		record("5636", {
			step: "bash sleep 60",
			todo: 3,
		}),
	]);
	const tasks = { 3: `Wire\x1b the parser ${"and more ".repeat(30)}` };
	for (const [rows, width] of [[40, 200], [10, 64]]) {
		const raw = open(sessions, { rows, tasks }).raw(width);
		const lines = raw.map(plain);
		assert.ok(lines.some((line) => /#3 Wire {2}the/.test(line)), lines.join("\n"));
		assert.equal(lines.some((line) => line.includes("in progress")), false);
		assert.equal(raw.join("\n").includes("\x1b the"), false);
		for (const line of raw) assert.ok(visibleWidth(line) <= width);
	}
});

test("a linked child's Fleet row stops naming its task once the task no longer exists", () => {
	const sessions = fakeSessions([
		record("5636", {
			step: "bash sleep 60",
			todo: 3,
		}),
	]);
	const lines = open(sessions).lines(200).join("\n");
	assert.doesNotMatch(lines, /#3|Wire the parser/);
	assert.match(lines, /bash sleep 60/);
});

test("a mixed Group appears under Working and History, and a reopened record is read-only Interrupted history", async (t) => {
	const root = withAgentDirectory(t);
	const lost = record("9e01", { group: "group-7af3", task: "Index the docs" });
	const before = audited(t, [lost], { root });
	before.say(lost.id, [{ type: "text", text: "Indexed half." }]);
	before.audit.execution(lost.id, "running");
	await before.audit.close();

	const working = record("5636", { group: "group-7af3" });
	const done = record("a809", {
		group: "group-7af3",
		state: "completed",
		endedAt: now - 1_000,
		text: "Done.",
	});
	const capture = audited(t, [working, done], { root });
	const sessions = fakeSessions([working, done]);
	const view = open(sessions, { rows: 40, audit: capture.audit });
	const text = await settle(view);
	const lines = text.split("\n").map((line) => line.slice(0, 38));
	const at = (pattern) => lines.findIndex((line) => pattern.test(line));
	assert.ok(at(/Working ─/) < at(/script 7af3/), text);
	assert.ok(at(/script 7af3/) < at(/worker 5636/));
	assert.ok(at(/History ─/) > at(/worker 5636/));
	assert.equal(lines.filter((line) => /script 7af3/.test(line)).length, 2);
	assert.ok(at(/✓ worker a809/) > at(/History ─/));
	assert.match(lines[at(/worker 9e01/)], /⊘ worker 9e01 +interrupted/);

	const rows = lines.findIndex((line) => line.includes("worker 9e01"));
	view.mouse({ type: "click", x: 5, y: rows });
	const detail = await settle(view);
	assert.match(detail, /⊘ worker 9e01 .* interrupted/);
	assert.match(detail, /Indexed half\./);
	assert.match(detail, /❯ History is read-only/);
	assert.doesNotMatch(detail, /s\/c cancel|Enter (steer|input|answer)/);
	view.press("s");
	assert.match(view.lines(120).join("\n"), /worker 9e01 is history; it is read-only\./);
	view.press("\r", "x", "\r");
	assert.match(view.lines(120).join("\n"), /worker 9e01 is history; it is read-only\./);
	assert.deepEqual(sessions.steers, []);
	assert.deepEqual(sessions.replies, []);
	assert.equal(sessions.get(working.id).state, "running");
	assert.equal(sessions.followers.has(lost.id), false);
});

test("a child whose transcript cannot be read stays listed with its identity", async (t) => {
	const root = withAgentDirectory(t);
	const lost = record("9e01", { task: "Index the docs" });
	const before = audited(t, [lost], { root });
	await before.audit.close();
	const later = audited(t, [], { root });
	const audit = {
		list: later.audit.list,
		read: async () => {
			throw new Error("disk gone");
		},
		segment: later.audit.segment,
	};
	const view = open(fakeSessions([]), { rows: 30, audit });
	const text = await settle(view);
	assert.match(text, /⊘ worker 9e01 +interrupted/);
	assert.match(text, /❯ Index the docs/);
});

test("a record with an index warning is repaired only on request, and the repair can be cancelled and shows its outcome", async (t) => {
	const root = withAgentDirectory(t);
	const lost = record("9e01", { task: "Index the docs" });
	const before = audited(t, [lost], { root });
	before.say(lost.id, [{ type: "text", text: "Indexed half." }]);
	await written(before.audit, lost.id);
	await before.audit.close();
	await rm(join(root, "parent-1", `${lost.id}.index`), { recursive: true });
	const later = audited(t, [], { root });
	const gates = [];
	const audit = {
		list: later.audit.list,
		read: later.audit.read,
		segment: later.audit.segment,
		async repair(id, signal) {
			await new Promise((resolve) => gates.push(resolve));
			return later.audit.repair(id, signal);
		},
	};
	const view = open(fakeSessions([]), { rows: 30, audit });
	let text = await settle(view);
	assert.match(text, /worker 9e01/);
	assert.match(text, /index is missing or damaged/);
	assert.match(text, /r repair/);
	assert.equal(gates.length, 0);

	view.press("r");
	text = view.lines(120).join("\n");
	assert.match(text, /Repairing worker 9e01/);
	assert.match(text, /r cancel repair/);
	view.press("r");
	gates.shift()();
	assert.match(await settle(view), /Repair of worker 9e01 cancelled\./);

	view.press("r");
	gates.shift()();
	text = await settle(view);
	assert.match(text, /Repaired worker 9e01: \d+ observations recovered/);
	assert.doesNotMatch(text, /index is missing or damaged/);
});

test("an answer shows queued and delivered once under its question number, and an aborted ask never reads as an answer", async (t) => {
	const root = withAgentDirectory(t);
	const child = record("5636");
	const before = audited(t, [child], { root });
	before.tool(child.id, "call-1", "ask_parent", { question: "Which file?" });
	before.captures[child.id].answered(1, "src/a.ts");
	before.emit(child.id, {
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "ask_parent",
		result: { content: [{ type: "text", text: "src/a.ts" }] },
		isError: false,
	});
	before.tool(child.id, "call-2", "ask_parent", { question: "Which test?" }, "The call was aborted.", true);
	await before.audit.close();
	const later = audited(t, [], { root });
	const view = open(fakeSessions([]), { rows: 40, audit: later.audit });
	const text = await settle(view);
	assert.match(text, /Answer 1 queued src\/a\.ts/);
	assert.equal(text.match(/Answer 1: src\/a\.ts/g)?.length, 1);
	assert.doesNotMatch(text, /Answer: The call was aborted/);
	assert.match(text, /The call was aborted\./);
});

test("without a parent session identity the capture warning shows beside the Run state while live inspection still reads the child", async (t) => {
	const child = record("5636");
	const gone = record("9e01");
	const capture = audited(t, [child, gone], { parent: undefined });
	const sessions = fakeSessions([child], {
		[child.id]: { entries: [assistant("a1", [{ type: "text", text: "Live without a parent." }])] },
	});
	const view = open(sessions, { rows: 30, audit: capture.audit });
	const text = await settle(view);
	assert.match(text, /Live without a parent\./);
	assert.doesNotMatch(text, /worker 9e01/);
	assert.match(text, /▸ ◐ worker 5636 +running · 1m 0\ds/);
	assert.match(text, /│ +incomplete transcript · 6\.2k t/);
	assert.match(text, /incomplete transcript \(live\): No parent session identity/);
	assert.match(text, /❯ Run sleep 60/);
	assert.match(text, /Enter steer/);
});

test("backscroll keeps its rows while the selected and other children stream, and f returns to the selected tail", async (t) => {
	const mine = record("5636");
	const other = record("1001");
	const capture = lines40(t, mine, [other]);
	const sessions = fakeSessions([mine, other]);
	const view = open(sessions, { rows: 20, audit: capture.audit });
	await settle(view);
	view.press("\t", "\x0b", "\x0b");
	const detail = (text) =>
		text
			.split("\n")
			.slice(4)
			.map((line) => line.split("│")[2] ?? "")
			.join("\n");
	const held = detail(await settle(view));
	assert.doesNotMatch(held, /Line 39\./);
	for (let i = 0; i < 300; i++) {
		capture.say(other.id, [{ type: "text", text: `Other ${i}.` }]);
	}
	capture.say(mine.id, [{ type: "text", text: "Line 40." }]);
	capture.emit(mine.id, {
		type: "tool_execution_start",
		toolCallId: "late",
		toolName: "bash",
		args: { command: "make" },
	});
	sessions.changed();
	assert.equal(detail(await settle(view)), held);
	assert.equal(detail(await settle(view, 140)).includes("Line"), true);
	assert.equal(detail(await settle(view)), held);
	view.press("f");
	const tail = await settle(view);
	assert.match(tail, /Line 40\./);
	assert.match(tail, /◆ Run make/);
	assert.doesNotMatch(tail, /Other/);
});

test("a late read for a previous selection never replaces the current one", async (t) => {
	const first = record("5636");
	const second = record("1001");
	const capture = audited(t, [first, second]);
	capture.say(first.id, [{ type: "text", text: "First child text." }]);
	capture.say(second.id, [{ type: "text", text: "Second child text." }]);
	const held = [];
	const audit = {
		list: capture.audit.list,
		segment: capture.audit.segment,
		async read(child, cursor) {
			if (child === first.id) {
				await new Promise((resolve) => held.push(resolve));
			}
			return capture.audit.read(child, cursor);
		},
	};
	const view = open(fakeSessions([first, second]), { rows: 30, audit });
	view.lines(120);
	assert.equal(held.length, 1);
	view.press("j");
	assert.match(await settle(view), /Second child text\./);
	for (const release of held.splice(0)) release();
	const text = await settle(view);
	assert.match(text, /Second child text\./);
	assert.doesNotMatch(text, /First child text\./);
});

async function written(audit, id) {
	for (let i = 0; i < 400; i++) {
		const { health } = await audit.read(id);
		if (health.written === health.received) return;
		await delay(5);
	}
	assert.fail("the evidence was never written");
}

const detailColumn = (text) =>
	text.split("\n").map((line) => line.split("│")[2] ?? "");

test("an expanded huge message is read in bounded parts instead of staying collapsed", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child], { limits: { chunk: 1024, windowBytes: 4096 } });
	const lines = Array.from({ length: 200 }, (_, i) => `m${String(i).padStart(3, "0")}. ${"long ".repeat(18)}end`);
	capture.say(child.id, [{ type: "text", text: lines.join("\n") }]);
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 24, audit: capture.audit });
	assert.match(await settle(view), /Message retained in parts/);

	view.press("\t", "\x0f");
	assert.match(await settle(view), /m199\. long/);
});

test("an expanded tool call shows all of its arguments, not only the truncated title", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	capture.tool(child.id, "t1", "bash", { command: `echo ${"word ".repeat(60)}LAST`, timeout: 99 }, "ok");
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 40, audit: capture.audit });
	assert.doesNotMatch(await settle(view), /LAST/);

	view.press("\t", "\x0f");
	const text = await settle(view);
	assert.match(text, /LAST/);
	assert.match(text, /"timeout": 99/);
});

test("a huge delivered message stays listed and expands by bounded parts", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child], { limits: { chunk: 1024, windowBytes: 4096 } });
	const lines = Array.from({ length: 200 }, (_, i) => `i${String(i).padStart(3, "0")}. ${"long ".repeat(18)}end`);
	capture.emit(child.id, {
		type: "message_start",
		message: { role: "user", content: [{ type: "text", text: lines.join("\n") }] },
	});
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 24, audit: capture.audit });
	assert.match(await settle(view), /❯ Message retained in parts/);

	view.press("\t", "\x0f");
	assert.match(await settle(view), /i199\. long/);
});

test("an expanded huge result made of many small fields still shows its parts", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child], { limits: { chunk: 1024, windowBytes: 4096 } });
	const content = Array.from({ length: 300 }, (_, i) => ({ type: "text", text: `s${String(i).padStart(3, "0")} ${"x".repeat(40)}` }));
	capture.emit(child.id, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } });
	capture.emit(child.id, {
		type: "tool_execution_end",
		toolCallId: "t1",
		toolName: "bash",
		result: { content },
		isError: false,
	});
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 24, audit: capture.audit });
	assert.match(await settle(view), /large output/);

	view.press("\t", "\x0f");
	assert.match(await settle(view), /"text":"s\d{3}/);
});

test("an expanded huge result is read in bounded parts, every row is reachable in both directions, and the anchor survives resize and theme", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child], { limits: { chunk: 1024, windowBytes: 4096 } });
	const rows = Array.from(
		{ length: 300 },
		(_, i) => `r${String(i).padStart(3, "0")}. ${"wide ".repeat(18)}end`,
	);
	capture.tool(child.id, "big", "bash", { command: "cat log" }, rows.join("\n"));
	await written(capture.audit, child.id);
	const reads = [];
	const audit = {
		list: capture.audit.list,
		read: capture.audit.read,
		async segment(id, cursor) {
			reads.push(cursor.offset);
			return capture.audit.segment(id, cursor);
		},
	};
	const view = open(fakeSessions([child]), { rows: 24, audit });
	const text = await settle(view);
	assert.match(text, /◆ Run cat log/);
	assert.match(text, /… large output · Ctrl\+O to expand/);
	assert.equal(reads.length, 0);

	view.press("\t", "\x0f");
	assert.match(await settle(view), /r299\. wide/);

	const back = [];
	for (let i = 0; i < 400 && !back.join("").includes("r000"); i++) {
		view.press("\x0b");
		back.push(...detailColumn(await settle(view)));
	}
	assert.match(back.join("\n"), /result\.content\.0\.text/);

	const seen = [];
	for (let i = 0; i < 400 && !seen.join("").includes("r299"); i++) {
		seen.push(...detailColumn(await settle(view)));
		view.press("\n");
	}
	const joined = seen.join("").replace(/\s+/g, "");
	for (const row of rows) assert.ok(joined.includes(row.replace(/\s+/g, "")), row.slice(0, 5));
	assert.ok(new Set(reads).size < 60);

	const firstRow = (width) =>
		detailColumn(view.lines(width).join("\n"))
			.join("\n")
			.match(/r(\d{3})\./)?.[1];
	view.press("\x0b", "\x0b", "\x0b");
	await settle(view);
	const anchored = firstRow(120);
	assert.ok(anchored);
	await settle(view, 90);
	assert.equal(firstRow(90), anchored);
	view.component.invalidate();
	await settle(view);
	assert.equal(firstRow(120), anchored);
});

test("hostile evidence is shown terminal-safe at every width without changing what the audit retains", async (t) => {
	const hostile = (label) => `${label}\x1b[2J\x1b]52;c;eA==\x07\x9b31m‮⁦end`;
	const child = record("5636", { task: hostile("task") });
	const root = withAgentDirectory(t);
	const old = record("9e01", { task: hostile("old"), role: hostile("role") });
	const before = audited(t, [old], { root });
	await before.audit.close();
	const capture = audited(t, [child], { root });
	capture.emit(child.id, {
		type: "message_start",
		message: { role: "user", content: [{ type: "text", text: hostile("steer") }] },
	});
	capture.say(child.id, [
		{ type: "thinking", thinking: hostile("thought") },
		{ type: "text", text: hostile("text") },
	]);
	capture.tool(child.id, "c1", hostile("tool"), { path: hostile("path") }, hostile("output"), true);
	const view = open(fakeSessions([child]), { rows: 40, audit: capture.audit });
	await settle(view);
	for (const rows of [10, 24, 40]) {
		view.tui.terminal.rows = rows;
		for (const width of [40, 56, 64, 65, 80, 120, 200]) {
			for (const pane of ["list", "detail"]) {
				const raw = (await settle(view, width)) && view.raw(width);
				assert.ok(raw.length <= rows, `${width}x${rows}`);
				for (const line of raw) {
					assert.ok(visibleWidth(line) <= width, `${width}x${rows} ${pane}`);
					for (const sequence of ["\x1b[2J", "\x1b]52;c;", "\x9b", "\x07", "‮", "⁦"]) {
						assert.equal(line.includes(sequence), false, JSON.stringify(sequence));
					}
				}
				view.press("\t");
			}
		}
	}
	const kept = await capture.audit.read(child.id);
	assert.ok(JSON.stringify(kept.observations).includes("text\\u001b[2J"));
});

test("unseating the child-session capability closes Fleet while accepted work and its auditing continue", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const sessions = fakeSessions([child]);
	const view = open(sessions, { audit: capture.audit });
	await settle(view);
	replaceSelection({
		schemaVersion: 1,
		capabilities: {
			...Object.fromEntries(capabilities.map((capability) => [capability, true])),
			"child-session": false,
		},
		expectations: {},
	});
	try {
		assert.deepEqual(view.raw(120), []);
		assert.equal(view.closed(), true);
		capture.say(child.id, [{ type: "text", text: "Still working after Fleet closed." }]);
		assert.equal(sessions.get(child.id).state, "running");
		const window = await capture.audit.read(child.id);
		assert.ok(
			window.observations.some((entry) =>
				JSON.stringify(entry.content ?? "").includes("Still working after Fleet closed."),
			),
		);
	} finally {
		replaceSelection({
			schemaVersion: 1,
			capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
			expectations: {},
		});
	}
});

test("a long transcript opens on its tail in bounded windows and backscroll reaches the prompt", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 400; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	const cursors = [];
	const audit = {
		list: capture.audit.list,
		segment: capture.audit.segment,
		read(id, cursor) {
			cursors.push(cursor?.from ?? 1);
			return capture.audit.read(id, cursor);
		},
	};
	const view = open(fakeSessions([child]), { rows: 20, audit });
	const text = await settle(view);
	assert.match(text, /Line 399\./);
	assert.doesNotMatch(text, / Prompt ─/);
	assert.ok(cursors.length <= 3, JSON.stringify(cursors));
	view.press("\t");
	let top = "";
	for (let i = 0; i < 600 && !/ Prompt ─/.test(top); i++) {
		view.press("\x0b");
		top = await settle(view);
	}
	assert.match(top, / Prompt ─/);
	assert.match(top, /Line 0\./);
	assert.ok(cursors.length < 40, JSON.stringify(cursors));
});

test("a tool or message that began before the resident windows says so, and expansion reveals its start", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	const piece = (delta) => ({
		type: "message_update",
		message: streaming,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
	});
	capture.emit(child.id, {
		type: "tool_execution_start",
		toolCallId: "c1",
		toolName: "read",
		args: { path: "early/start.ts" },
	});
	capture.emit(child.id, { type: "message_start", message: streaming });
	capture.emit(child.id, piece("Opening words. "));
	for (let i = 0; i < 300; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	capture.emit(child.id, piece("Closing words."));
	capture.emit(child.id, {
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "read",
		result: { content: [{ type: "text", text: "done" }] },
		isError: false,
	});
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 30, audit: capture.audit });
	const tail = await settle(view);
	assert.match(tail, /Closing words\./);
	assert.doesNotMatch(tail, /early\/start\.ts|Opening words/);
	assert.equal(tail.match(/continues from earlier evidence/g)?.length, 2);

	view.press("\t", "\x0f");
	const expanded = await settle(view);
	assert.match(expanded, /Opening words\. Closing words\./);
	assert.match(expanded, /early\/start\.ts/);
	assert.doesNotMatch(expanded, /continues from earlier evidence/);
});

test("a message streamed far before the resident windows is revealed contiguously, its gap marked where it lies", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	for (let i = 0; i < 900; i++) {
		capture.emit(child.id, {
			type: "message_update",
			message: streaming,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `w${i} ` },
		});
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const fromStart = [];
	const audit = {
		read(id, cursor) {
			if (cursor?.from === 1) fromStart.push(cursor);
			return capture.audit.read(id, cursor);
		},
		segment: capture.audit.segment,
	};
	const transcript = createTranscript({ audit, child: child.id, changed() {} });
	const draw = () => {
		const pieces = [];
		transcript.layout(
			80,
			10_000,
			"",
			(item) => {
				if (item.kind !== "message") return [];
				pieces.push({ text: item.entry.content[0]?.text ?? "", earlier: item.entry.earlier });
				return [
					{
						sub: "body",
						rows: ["row"],
						...(item.entry.earlier === undefined ? {} : { load: { earlier: item.entry.earlier } }),
					},
				];
			},
			{ head: [], tail: [] },
		);
		return pieces;
	};
	const contiguous = (text) => {
		const numbers = text.trim().split(" ").map((word) => Number(word.slice(1)));
		return numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
	};
	const words = (text) => text.trim().split(" ").filter(Boolean);
	const reached = new Set();
	const step = async (done) => {
		for (let i = 0; i < 800; i++) {
			const pieces = draw();
			for (const [index, piece] of pieces.entries()) {
				assert.ok(contiguous(piece.text), piece.text);
				for (const word of words(piece.text)) reached.add(word);
				if (index === 0) {
					assert.equal(piece.earlier === undefined, piece.text.startsWith("w0 "), piece.text);
				} else {
					assert.notEqual(piece.earlier, undefined);
				}
				if (index < pieces.length - 1) assert.ok(words(piece.text).length <= 384);
			}
			if (pieces.length > 0) assert.ok(words(pieces.at(-1).text).length <= 384 + 384);
			if (pieces.length > 0 && done(pieces)) return pieces;
			await delay(5);
		}
		assert.fail("the expansion never settled");
	};
	const slid = await step((pieces) => pieces.length === 1 && reached.size === 900);
	assert.notEqual(slid[0].earlier, undefined);
	assert.match(slid[0].text, / w899 $/);
	assert.equal(fromStart.length, 1);

	let redraws = 0;
	await step(() => ++redraws > 300);

	transcript.collapse();
	const again = await step((pieces) => pieces[0].text.startsWith("w0 "));
	assert.equal(again.length, 2);
	transcript.dispose();
});

test("a detached view keeps its row when a streamed message is replaced by its final", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const body = Array.from({ length: 60 }, (_, i) => `Para ${i}.`).join("\n\n");
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	capture.emit(child.id, {
		type: "message_update",
		message: streaming,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: body },
	});
	const sessions = fakeSessions([child]);
	const view = open(sessions, { rows: 20, audit: capture.audit });
	await settle(view);
	view.press("\t", "\x0b", "\x0b");
	const held = detailColumn(await settle(view)).slice(4).join("\n");
	assert.match(held, /Para \d+\./);
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: body }] },
	});
	sessions.changed();
	assert.equal(detailColumn(await settle(view)).slice(4).join("\n"), held);
});

test("a message streamed across several windows reads back once and in order, including a character split between windows", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	const deltas = [];
	for (let i = 0; i < 300; i++) deltas.push(`d${i}\n`);
	deltas[200] = "d200 \ud83d";
	deltas[201] = "\ude00\n";
	for (const [i, delta] of deltas.entries()) {
		capture.emit(child.id, {
			type: "message_update",
			message: streaming,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		});
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 60, audit: capture.audit });
	await settle(view);
	view.press("\t");
	const seen = [];
	for (let i = 0; i < 200 && !seen.join("\n").includes(" Prompt ─"); i++) {
		seen.unshift(...detailColumn(await settle(view)).slice(4, -1));
		view.press("\x0b");
	}
	const text = seen.join("\n");
	assert.equal(text.match(/\bd0\b/g)?.length >= 1, true);
	const order = [...text.matchAll(/\bd(\d+)\b/g)].map((match) => Number(match[1]));
	const unique = [...new Set(order)];
	assert.deepEqual(unique, [...unique].sort((a, b) => a - b));
	assert.equal(unique.length, 299);
	assert.match(text, /d200 😀/);
});
