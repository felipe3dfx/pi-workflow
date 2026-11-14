import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdir,
	open as openFile,
	opendir,
	rename,
	rm,
	stat,
	unlink,
} from "node:fs/promises";
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
import { renderHeader } from "../extensions/chrome.ts";
import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(
		capabilities.map((capability) => [capability, true]),
	),
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
		contexts: {},
		context(id) {
			return this.contexts[id];
		},
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
		files: options.files,
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
			emit(id, {
				type: "tool_execution_start",
				toolCallId: call,
				toolName,
				args,
			});
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
	let lines = view.lines(width);
	for (let i = 0; i < 400 && view.component.pending; i++) {
		await delay(5);
		lines = view.lines(width);
	}
	assert.equal(view.component.pending, false, "the view never settled");
	return lines.join("\n");
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
	assert.match(
		wide[0],
		/^ ┌─ Fleet 3 · 1 active · 6\.2k tok · \$0\.01 ─+ \[×\] ─┐$/,
	);
	assert.equal(wide[1].indexOf("│", 2), 1 + 1 + 2 + 34 + 1);
	assert.match(wide[1], /Working ─+ │ ◐ worker 5636 +running · 1m 0\ds {2}│$/);
	assert.match(
		wide[2],
		/▸ ◐ worker 5636 +running · 1m 0\ds │ gpt-6-luna \(high\) · 6\.2k tok · \$0\.01 · wt: pi-workflow/,
	);
	assert.match(
		wide[3],
		/^ │ {6}bash sleep 60 6\.2k tok · \$0\.01 │ ctx unavailable /,
	);
	assert.match(wide[4], /│ Run sleep 60 /);

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
		{
			type: "toolCall",
			id: "t1",
			name: "read",
			arguments: { path: "extensions/children-view.ts" },
		},
	]);
	capture.tool(id, "t1", "read", { path: "extensions/children-view.ts" }, "ok");
	capture.tool(
		id,
		"t2",
		"mcp__engram__mem_search",
		{ query: "x" },
		"no index",
		true,
	);
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
	t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	capture.emit(child.id, {
		type: "message_update",
		message: streaming,
		assistantMessageEvent: {
			type: "thinking_delta",
			contentIndex: 0,
			delta: "Planning the wait.",
		},
	});
	const sessions = fakeSessions([child]);
	const view = open(sessions, { audit: capture.audit });
	assert.match(await settle(view), /◆ Thinking…/);
	t.mock.timers.tick(1_500);
	capture.emit(child.id, {
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "thinking", thinking: "Planning the wait." }],
		},
	});
	sessions.changed();
	assert.match(await settle(view), /◆ Thought for 1\.5s/);
});

function lines40(t, child, others = []) {
	const capture = audited(t, [child, ...others]);
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
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

test("the view opens on a running child while one works", () => {
	const view = open(threeChildren(), { latest: true });
	assert.match(
		view.lines(120).find((line) => line.includes("▸")),
		/▸ ◐ worker 5636 +running/,
	);
});

test("the wheel over the title, borders, divider, or footer stays in the view", async (t) => {
	const child = record("5636");
	const capture = lines40(t, child);
	const view = open(fakeSessions([child]), { rows: 20, audit: capture.audit });
	await settle(view);
	const lines = view.lines(120);
	const divider = lines[2].indexOf("│", 2);
	const footer = lines.findIndex((line) => line.includes("f follow"));
	for (const [x, y] of [
		[60, 0],
		[0, 8],
		[divider, 8],
		[119, 8],
		[60, footer],
	]) {
		assert.deepEqual(
			view.mouse({ type: "wheel", x, y, wheelDelta: -3 }),
			{ handled: true },
			`wheel at ${x},${y}`,
		);
	}
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
	capture.say(failed.id, [], {
		errorMessage: "provider error",
		stopReason: "error",
	});
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
	const hostile = (label) => `${label}\x1b[2J\x1b]52;c;eA==\x07\x9b31m‮⁦end`;
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
	assert.ok(
		lines.some((line) => line.includes("❯ Enter to answer question 2")),
	);
	assert.match(lines.join("\n"), /Enter answer/);
	view.press("\r", "\x1b[200~qs \x1b[31mc\u202e\x1b[201~", "\x7f", "a");
	const typed = view.raw(120).join("\n");
	assert.match(
		view.lines(120).join("\n"),
		/Enter send {2}\| {2}Esc stop typing/,
	);
	assert.equal(typed.includes("\x1b[31mc"), false);
	assert.equal(typed.includes("\u202e"), false);
	view.press("\r");
	assert.deepEqual(sessions.replies, [
		{ id: waiting.id, number: 2, text: "qs  [31mca", by: "operator" },
	]);
	assert.ok(
		view
			.lines(120)
			.some((line) => line.includes("Answer sent to worker 5636.")),
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
		/Question 3 of child 5636[-0]+ was already answered by the parent: {2}\[31mred/,
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
			record("5636", {
				state,
				endedAt: isWorkingState(state) ? undefined : now,
			}),
		]);
		const view = open(sessions, { rows: 30 });
		view.lines(120);
		view.press("\r");
		assert.ok(
			view.lines(120).some((line) => line.includes(`worker 5636 ${reason}`)),
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
	assert.deepEqual(sessions.steers, [
		{ id: running.id, text: "use  [31mtabs" },
	]);
	assert.ok(
		view.lines(120).some((line) => line.includes("Steer sent to worker 5636.")),
	);

	view.press("\r", ..."/mcp", "\r");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(view.raw(120).join("\n").includes("\x1b[31m/"), false);
	assert.ok(
		view
			.lines(120)
			.some((line) => line.includes("A Steer cannot begin with  [31m/")),
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
		for (const sequence of [
			"\x1b[2J",
			"\x1b]52;c;",
			"\x9b",
			"\x07",
			"\u202e",
		]) {
			assert.equal(raw.includes(sequence), false, JSON.stringify(sequence));
		}
		const lines = view.lines(120).join("\n");
		assert.match(lines, /2 steers pending/, `${rows}`);
		assert.match(lines, /1 steer undelivered/, `${rows}`);
	}
	const detail = open(fakeSessions([running]), { rows: 40 })
		.lines(120)
		.join("\n");
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
	for (const [rows, width] of [
		[40, 200],
		[10, 64],
	]) {
		const raw = open(sessions, { rows, tasks }).raw(width);
		const lines = raw.map(plain);
		assert.ok(
			lines.some((line) => /#3 Wire {2}the/.test(line)),
			lines.join("\n"),
		);
		assert.equal(
			lines.some((line) => line.includes("in progress")),
			false,
		);
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
	assert.match(
		view.lines(120).join("\n"),
		/worker 9e01 is history; it is read-only\./,
	);
	view.press("\r", "x", "\r");
	assert.match(
		view.lines(120).join("\n"),
		/worker 9e01 is history; it is read-only\./,
	);
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

test("children the catalog lost are reported, and r rebuilds the catalog so they are listed again", async (t) => {
	const root = withAgentDirectory(t);
	let failing = true;
	const files = {
		mkdir,
		rename,
		stat,
		unlink,
		opendir,
		async open(path, flags, mode) {
			if (failing && path.endsWith(".catalog"))
				throw new Error("catalog unavailable");
			return openFile(path, flags, mode);
		},
	};
	const lost = record("9e01", { task: "Index the docs" });
	const before = audited(t, [lost], { root, files });
	before.say(lost.id, [{ type: "text", text: "Indexed half." }]);
	await written(before.audit, lost.id);
	await before.audit.close();
	failing = false;

	const later = audited(t, [], { root });
	const view = open(fakeSessions([]), { rows: 30, audit: later.audit });
	let text = await settle(view);
	assert.doesNotMatch(text, /worker 9e01/);
	assert.match(text, /missing from the audit catalog/);
	assert.match(text, /r repair/);

	view.press("r");
	text = await settle(view);
	assert.match(text, /Catalog repaired: 1 record added\./);
	assert.match(text, /worker 9e01/);
	assert.doesNotMatch(text, /missing from the audit catalog/);
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
	before.tool(
		child.id,
		"call-2",
		"ask_parent",
		{ question: "Which test?" },
		"The call was aborted.",
		true,
	);
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
		[child.id]: {
			entries: [
				assistant("a1", [{ type: "text", text: "Live without a parent." }]),
			],
		},
	});
	const view = open(sessions, { rows: 30, audit: capture.audit });
	const text = await settle(view);
	assert.match(text, /Live without a parent\./);
	assert.doesNotMatch(text, /worker 9e01/);
	assert.match(text, /▸ ◐ worker 5636 +running · 1m 0\ds/);
	assert.match(text, /│ +incomplete transcript · 6\.2k t/);
	assert.match(
		text,
		/incomplete transcript \(live\): No parent session identity/,
	);
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
		if (i % 50 === 49) await written(capture.audit, other.id);
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

test("the wheel scrolls streamed messages longer than the resident windows by its exact delta, settles after each step, and follows again at the end", async (t) => {
	const child = record("5636", {
		state: "completed",
		endedAt: now,
		text: "done",
	});
	const capture = audited(t, [child]);
	for (let m = 0; m < 5; m++) {
		const message = { role: "assistant", content: [] };
		capture.emit(child.id, { type: "message_start", message });
		let text = "";
		for (let i = 0; i < 300; i++) {
			const delta =
				i % 12 === 11 ? `M${m}.${i}\n\n` : `M${m}.${i} alpha beta gamma `;
			text += delta;
			capture.emit(child.id, {
				type: "message_update",
				message,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
			});
			if (i % 100 === 99) await written(capture.audit, child.id);
		}
		capture.emit(child.id, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text }] },
		});
	}
	await written(capture.audit, child.id);
	const sessions = fakeSessions([child]);
	const view = open(sessions, { rows: 30, audit: capture.audit });
	view.press("\t");
	const pane = async () => detailColumn(await settle(view)).slice(5, 25);
	let before = await pane();
	for (let step = 0; step < 130; step++) {
		view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -3 });
		const renders = view.tui.renders;
		const after = await pane();
		assert.ok(view.tui.renders - renders < 20, `step ${step} never settled`);
		assert.deepEqual(after.slice(3), before.slice(0, -3), `step ${step}`);
		before = after;
	}
	for (let i = 0; i < 100 && !/M4\.299/.test(before.join("\n")); i++) {
		view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: 40 });
		before = await pane();
	}
	view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: 3 });
	for (let i = 0; i < 30; i++)
		capture.say(child.id, [{ type: "text", text: `Late ${i}.` }]);
	await written(capture.audit, child.id);
	sessions.changed();
	assert.match((await pane()).join("\n"), /Late 29\./);
});

for (const ended of [true, false]) {
	test(`the wheel scrolls up ${ended ? "an ended" : "a streaming"} message of token-sized deltas by its exact delta while the pane stays full`, async (t) => {
		const child = record(
			"5636",
			ended ? { state: "completed", endedAt: now, text: "done" } : {},
		);
		const capture = audited(t, [child]);
		const message = { role: "assistant", content: [] };
		capture.emit(child.id, { type: "message_start", message });
		let text = "";
		for (let i = 0; i < 3000; i++) {
			const delta = i % 60 === 59 ? `t${i}\n\n` : `t${i} `;
			text += delta;
			capture.emit(child.id, {
				type: "message_update",
				message,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
			});
			if (i % 100 === 99) await written(capture.audit, child.id);
		}
		if (ended) {
			capture.emit(child.id, {
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text }] },
			});
		}
		await written(capture.audit, child.id);
		const view = open(fakeSessions([child]), {
			rows: 60,
			audit: capture.audit,
		});
		view.press("\t");
		const pane = async () => detailColumn(await settle(view)).slice(5, 55);
		let before = await pane();
		for (let step = 0; step < 45; step++) {
			view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -3 });
			const renders = view.tui.renders;
			const after = await pane();
			assert.ok(view.tui.renders - renders < 20, `step ${step} never settled`);
			assert.deepEqual(after.slice(3), before.slice(0, -3), `step ${step}`);
			assert.ok(
				after.filter((line) => line.trim()).length > 40,
				`step ${step}`,
			);
			before = after;
		}
	});
}

test("the wheel settles over tool calls whose messages draw no rows, scrolling up and then down", async (t) => {
	const child = record("5636", {
		state: "completed",
		endedAt: now,
		text: "done",
	});
	const capture = audited(t, [child]);
	for (let n = 0; n < 200; n++) {
		const message = { role: "assistant", content: [] };
		capture.emit(child.id, { type: "message_start", message });
		for (let i = 0; i < 20; i++) {
			capture.emit(child.id, {
				type: "message_update",
				message,
				assistantMessageEvent: {
					type: "toolcall_delta",
					contentIndex: 0,
					delta: `${i}`,
				},
			});
		}
		const call = {
			type: "toolCall",
			id: `c${n}`,
			name: "read",
			arguments: { path: `f${n}` },
		};
		capture.emit(child.id, {
			type: "message_end",
			message: { role: "assistant", content: [call] },
		});
		capture.tool(child.id, `c${n}`, "read", { path: `f${n}` }, "ok");
		if (n % 4 === 3) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 30, audit: capture.audit });
	view.press("\t");
	await settle(view);
	for (const [steps, wheelDelta] of [
		[150, -3],
		[60, 3],
	]) {
		for (let step = 0; step < steps; step++) {
			view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta });
			const renders = view.tui.renders;
			await settle(view);
			assert.ok(
				view.tui.renders - renders < 20,
				`${wheelDelta} step ${step} never settled`,
			);
		}
	}
});

async function quiet(transcript, draw) {
	let rows = draw();
	for (let i = 0; i < 100 && transcript.pending; i++) {
		await delay(5);
		rows = draw();
	}
	assert.equal(transcript.pending, false, "the windows never settled");
	return rows;
}

test("a followed message streaming far past its text cap keeps showing its newest delta under the marker", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	await written(capture.audit, child.id);
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed() {},
	});
	let entry;
	const draw = () =>
		transcript.layout(
			80,
			30,
			"",
			(item) => {
				if (item.kind !== "message") return [];
				entry = item.entry;
				const text = item.entry.content[0]?.text ?? "";
				return [{ sub: "b", rows: text.trim().split(" ").slice(-200) }];
			},
			{ head: [], tail: [] },
		);
	await quiet(transcript, draw);
	for (let i = 0; i < 4000; i++) {
		capture.emit(child.id, {
			type: "message_update",
			message: streaming,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: `w${i} pad${i} `,
			},
		});
		if (i % 50 === 49) {
			await written(capture.audit, child.id);
			transcript.changed();
			await quiet(transcript, draw);
			const text = entry.content[0]?.text ?? "";
			assert.match(text, new RegExp(` pad${i} $`), `delta ${i}`);
			assert.ok(text.length <= 32 * 1024, `delta ${i}`);
		}
	}
	assert.notEqual(entry.earlier, undefined);
	transcript.dispose();
});

test("the row under the earlier-evidence marker stays put while backward pages add no rows to its message", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 5; i++)
		capture.say(child.id, [{ type: "text", text: `Say ${i}.` }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	const delta = (text) =>
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: text,
			},
		});
	for (let i = 0; i < 700; i++) {
		delta(i < 600 ? "a" : `w${i - 600}\n`);
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed() {},
	});
	const draw = () =>
		transcript.layout(
			80,
			30,
			"",
			(item) => {
				if (item.kind !== "message") return [];
				const lines = (item.entry.content[0]?.text ?? "")
					.split("\n")
					.filter(Boolean);
				return [
					...(item.entry.earlier === undefined
						? []
						: [{ sub: "e", rows: ["marker"] }]),
					{ sub: "b", rows: lines.map((line) => line.replace(/^a+/, "")) },
				];
			},
			{ head: [], tail: [] },
		);
	let rows = await quiet(transcript, draw);
	for (let i = 0; i < 400 && rows[0] !== "marker"; i++) {
		transcript.scroll(-1);
		rows = draw();
	}
	assert.equal(rows[0], "marker");
	const after = await quiet(transcript, draw);
	assert.notEqual(after[0], "marker");
	assert.deepEqual(after.slice(1), rows.slice(1));
	transcript.dispose();
});

function oversized() {
	const length = 40 * 1024 + 1;
	const text = [..."S".padEnd(length - 1, "a"), "E"];
	for (const at of [length - 32 * 1024 - 1, 32 * 1024 - 1]) {
		text[at] = "\ud83d";
		text[at + 1] = "\ude00";
	}
	return text.join("");
}

function messageTranscript(audit, id) {
	const state = { expand: false, pieces: [] };
	const transcript = createTranscript({
		audit,
		child: id,
		changed() {},
	});
	const render = (item) => {
		if (item.kind === "static") return [{ sub: "s", rows: ["head"] }];
		if (item.kind !== "message") return [];
		const text = item.entry.content[0]?.text ?? "";
		if (
			!text.startsWith("S") &&
			!text.endsWith("E") &&
			item.entry.earlier === undefined
		) {
			return [{ sub: "b", rows: [text] }];
		}
		state.pieces.push({ key: item.key, text, earlier: item.entry.earlier });
		const load =
			state.expand && item.entry.earlier !== undefined
				? { load: { earlier: item.entry.earlier } }
				: {};
		return [{ sub: "b", rows: ["BIG"], ...load }];
	};
	const draw = () => {
		state.pieces = [];
		return transcript.layout(80, 30, "", render, {
			head: [{ key: "head", kind: "static" }],
			tail: [],
		});
	};
	return { transcript, state, draw: () => quiet(transcript, draw) };
}

test("a followed message made of one oversized delta keeps its last 32 KiB under the marker, and expansion reaches its start", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	const delta = oversized();
	capture.emit(child.id, {
		type: "message_update",
		message,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
	});
	await written(capture.audit, child.id);
	const { transcript, state, draw } = messageTranscript(
		capture.audit,
		child.id,
	);
	await draw();
	assert.equal(state.pieces.length, 1);
	const [piece] = state.pieces;
	assert.ok(piece.text.length <= 32 * 1024, `${piece.text.length} characters`);
	assert.ok(piece.text.isWellFormed());
	assert.ok(delta.endsWith(piece.text));
	assert.notEqual(piece.earlier, undefined);
	state.expand = true;
	await draw();
	assert.equal(state.pieces.map((shown) => shown.text).join(""), delta);
	transcript.dispose();
});

test("a message made of one oversized delta read forward from above keeps its first 32 KiB", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 400; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	const delta = oversized();
	capture.emit(child.id, {
		type: "message_update",
		message,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
	});
	await written(capture.audit, child.id);
	for (let i = 0; i < 200; i++) {
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	const { transcript, state, draw } = messageTranscript(
		capture.audit,
		child.id,
	);
	let rows = await draw();
	for (let i = 0; i < 100 && rows[0] !== "head"; i++) {
		transcript.scroll(-30);
		rows = await draw();
	}
	assert.equal(rows[0], "head");
	for (let i = 0; i < 100 && !rows.includes("BIG"); i++) {
		transcript.scroll(30);
		rows = await draw();
	}
	assert.equal(state.pieces.length, 1);
	const [piece] = state.pieces;
	assert.ok(piece.text.length <= 32 * 1024, `${piece.text.length} characters`);
	assert.ok(piece.text.isWellFormed());
	assert.ok(piece.text.length > 0);
	assert.ok(delta.startsWith(piece.text));
	assert.equal(piece.earlier, undefined);
	transcript.dispose();
});

test("expanding a capped message whose earlier read ends right before the kept delta shows the whole text", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	let full = "";
	for (let i = 0; i < 127; i++) {
		full += `d${i}.`;
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: `d${i}.`,
			},
		});
	}
	const delta = oversized();
	full += delta;
	capture.emit(child.id, {
		type: "message_update",
		message,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
	});
	await written(capture.audit, child.id);
	const { transcript, state, draw } = messageTranscript(
		capture.audit,
		child.id,
	);
	await draw();
	state.expand = true;
	await draw();
	await draw();
	assert.equal(state.pieces.map((piece) => piece.text).join(""), full);
	transcript.dispose();
});

test("paging a long transcript row by row settles after every step", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 600; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed() {},
	});
	const draw = () =>
		transcript.layout(80, 70, "", (item) => [{ sub: "b", rows: [item.key] }], {
			head: [{ key: "head", kind: "static" }],
			tail: [],
		});
	let rows = await quiet(transcript, draw);
	for (let i = 0; i < 100 && rows[0] !== "head"; i++) {
		transcript.scroll(-70);
		rows = await quiet(transcript, draw);
	}
	assert.equal(rows[0], "head");
	for (let step = 0; step < 250; step++) {
		transcript.scroll(1);
		const after = await quiet(transcript, draw);
		assert.deepEqual(after.slice(0, -1), rows.slice(1), `step ${step}`);
		rows = after;
	}
	transcript.dispose();
});

test("a tool streaming thousands of updates stays bounded while followed", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const update = (i) =>
		capture.emit(child.id, {
			type: "tool_execution_update",
			toolCallId: "long",
			toolName: "bash",
			args: { command: "make" },
			partialResult: { content: [{ type: "text", text: `p${i}` }] },
		});
	capture.tool(child.id, "long", "bash", { command: "make" });
	for (let i = 0; i < 3000; i++) {
		update(i);
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed() {},
	});
	let tool;
	const draw = () =>
		transcript.layout(
			80,
			30,
			"",
			(item) => {
				if (item.kind !== "tool") return [];
				tool = item.entry;
				return [
					{ sub: "t", rows: ["tool", JSON.stringify(item.entry.partial)] },
				];
			},
			{ head: [], tail: [] },
		);
	await quiet(transcript, draw);
	assert.equal(tool.earlier, undefined);
	assert.deepEqual(tool.args, { command: "make" });
	for (let i = 3000; i < 3300; i++) {
		update(i);
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	transcript.changed();
	await quiet(transcript, draw);
	assert.match(JSON.stringify(tool.partial), /p3299/);
	assert.deepEqual(tool.args, { command: "make" });
	assert.deepEqual(transcript.info().retained, { items: 1, observations: 2 });
	transcript.dispose();
});

test("scrolling up a streamed message longer than its text cap shows its capped tail under the marker, and expansion reaches its start", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	for (let i = 0; i < 8000; i++) {
		capture.emit(child.id, {
			type: "message_update",
			message: streaming,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: `w${i} `,
			},
		});
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed() {},
	});
	let expand = false;
	let revealed = false;
	let pieces = [];
	const draw = () => {
		pieces = [];
		return transcript.layout(
			80,
			50,
			"",
			(item) => {
				if (item.kind === "static") return [{ sub: "s", rows: ["head"] }];
				if (item.kind !== "message") return [];
				const text = item.entry.content[0]?.text ?? "";
				pieces.push({ text, earlier: item.entry.earlier });
				revealed ||= text.startsWith("w0 ");
				const load =
					expand && item.entry.earlier !== undefined
						? { load: { earlier: item.entry.earlier } }
						: {};
				return [{ sub: "body", rows: text.trim().split(" "), ...load }];
			},
			{ head: [{ key: "head", kind: "static" }], tail: [] },
		);
	};
	let rows = await quiet(transcript, draw);
	for (let i = 0; i < 400 && rows[0] !== "head"; i++) {
		transcript.scroll(-40);
		rows = await quiet(transcript, draw);
		assert.ok(pieces[0].text.length <= 32 * 1024, `step ${i}`);
	}
	assert.equal(rows[0], "head");
	assert.equal(pieces.length, 1);
	assert.notEqual(pieces[0].earlier, undefined);
	assert.match(pieces[0].text, / w7999 $/);
	assert.equal(revealed, false);
	expand = true;
	await quiet(transcript, draw);
	assert.equal(revealed, true);
	transcript.dispose();
});

function compact(item) {
	if (item.kind === "static") return [{ sub: "s", rows: ["head"] }];
	const text = item.entry?.content?.[0]?.text ?? "";
	return [{ sub: "b", rows: [/^(Line|After) /.test(text) ? text : "LONG"] }];
}

function compactTranscript(capture, id) {
	const transcript = createTranscript({
		audit: capture.audit,
		child: id,
		changed() {},
	});
	const draw = () =>
		transcript.layout(80, 30, "", compact, {
			head: [{ key: "head", kind: "static" }],
			tail: [],
		});
	return { transcript, draw: () => quiet(transcript, draw) };
}

async function pageDown(transcript, draw, rows) {
	for (let step = 0; rows.at(-1) !== "After 99."; step++) {
		assert.ok(step < 400, "the end was never reached");
		transcript.scroll(1);
		const after = await draw();
		assert.equal(after.length, 30, `step ${step}`);
		assert.deepEqual(after.slice(0, -1), rows.slice(1), `step ${step}`);
		rows = after;
	}
	assert.equal(transcript.following, true);
}

function streamLong(capture, id, message, count, part = "text_delta") {
	return (async () => {
		for (let i = 0; i < count; i++) {
			capture.emit(id, {
				type: "message_update",
				message,
				assistantMessageEvent: { type: part, contentIndex: 0, delta: `d${i} ` },
			});
			if (i % 100 === 99) await written(capture.audit, id);
		}
	})();
}

test("paging row by row past a message longer than the resident windows keeps the pane full on both sides of it and follows again at the end", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 100; i++)
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
	await written(capture.audit, child.id);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	await streamLong(capture, child.id, message, 1000);
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "LONG" }] },
	});
	for (let i = 0; i < 100; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	const { transcript, draw } = compactTranscript(capture, child.id);
	let rows = await draw();
	for (let i = 0; i < 100 && rows[0] !== "head"; i++) {
		transcript.scroll(-30);
		rows = await draw();
	}
	assert.equal(rows[0], "head");
	await pageDown(transcript, draw, rows);
	transcript.dispose();
});

test("paging row by row from the top past a message that grew longer than the resident windows after the view reached it keeps the pane full", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	await written(capture.audit, child.id);
	const { transcript, draw } = compactTranscript(capture, child.id);
	let rows = await draw();
	for (let i = 0; i < 10 && rows[0] !== "head"; i++) {
		transcript.scroll(-30);
		rows = await draw();
	}
	assert.equal(rows[0], "head");
	await streamLong(capture, child.id, message, 1000);
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "LONG" }] },
	});
	for (let i = 0; i < 100; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	transcript.changed();
	await pageDown(transcript, draw, await draw());
	transcript.dispose();
});

for (const key of ["wheel", "page"]) {
	test(`${key === "wheel" ? "the wheel" : "Ctrl+K"} reaches the start past a long ended tool call, settling after every step`, async (t) => {
		const child = record("5636", {
			state: "completed",
			endedAt: now,
			text: "done",
		});
		const capture = audited(t, [child]);
		for (let i = 0; i < 60; i++)
			capture.say(child.id, [{ type: "text", text: `Before ${i}.` }]);
		capture.tool(child.id, "long", "bash", { command: "make" });
		for (let i = 0; i < 2000; i++) {
			capture.emit(child.id, {
				type: "tool_execution_update",
				toolCallId: "long",
				toolName: "bash",
				args: { command: "make" },
				partialResult: { content: [{ type: "text", text: `p${i}` }] },
			});
			if (i % 100 === 99) await written(capture.audit, child.id);
		}
		capture.emit(child.id, {
			type: "tool_execution_end",
			toolCallId: "long",
			toolName: "bash",
			result: { content: [{ type: "text", text: "built" }] },
			isError: false,
		});
		for (let i = 0; i < 60; i++)
			capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
		await written(capture.audit, child.id);
		const view = open(fakeSessions([child]), {
			rows: 30,
			audit: capture.audit,
		});
		view.press("\t");
		let text = await settle(view);
		let before = detailColumn(text).slice(5, 25);
		for (let step = 0; !/Before 0\./.test(text); step++) {
			assert.ok(step < 300, "the start was never reached");
			if (key === "wheel")
				view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -3 });
			else view.press("\x0b");
			const renders = view.tui.renders;
			text = await settle(view);
			assert.ok(view.tui.renders - renders < 20, `step ${step} never settled`);
			const after = detailColumn(text).slice(5, 25);
			if (key === "wheel")
				assert.deepEqual(after.slice(3), before.slice(0, -3), `step ${step}`);
			before = after;
		}
	});
}

test("the wheel scrolls down past a long streamed tool call by its exact delta while the pane stays full, and f reaches the tail", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `Before ${i}.` }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	capture.emit(child.id, {
		type: "message_update",
		message,
		assistantMessageEvent: {
			type: "toolcall_delta",
			contentIndex: 0,
			delta: `{"path":"big.txt","content":"`,
		},
	});
	await written(capture.audit, child.id);
	const sessions = fakeSessions([child]);
	const view = open(sessions, { rows: 30, audit: capture.audit });
	view.press("\t");
	const wheel = async (wheelDelta) => {
		view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta });
		const renders = view.tui.renders;
		const text = await settle(view);
		assert.ok(view.tui.renders - renders < 20, "a step never settled");
		return text;
	};
	let text = await settle(view);
	for (let i = 0; i < 40 && !/Before 0\./.test(text); i++)
		text = await wheel(-3);
	assert.match(text, /Before 0\./);
	await streamLong(capture, child.id, message, 2000, "toolcall_delta");
	const call = {
		type: "toolCall",
		id: "w",
		name: "write",
		arguments: { path: "big.txt", content: "x" },
	};
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [call] },
	});
	capture.tool(child.id, "w", "write", { path: "big.txt", content: "x" }, "ok");
	for (let i = 0; i < 60; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	sessions.changed();
	let before = detailColumn(await settle(view)).slice(5, 25);
	for (let step = 0; !/After 59\./.test(before.join("\n")); step++) {
		assert.ok(step < 200, "the end was never reached");
		const after = detailColumn(await wheel(3)).slice(5, 25);
		if (!/After 59\./.test(after.join("\n"))) {
			assert.deepEqual(after.slice(0, -3), before.slice(3), `step ${step}`);
		}
		before = after;
	}
	for (let i = 0; i < 12; i++) await wheel(-3);
	assert.doesNotMatch(await settle(view), /After 59\./);
	view.press("f");
	assert.match(await settle(view), /After 59\./);
});

test("following a long streaming tool call preceded by messages fills the pane, and the wheel then moves it by its exact delta", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `Before ${i}.` }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	await streamLong(capture, child.id, message, 2000, "toolcall_delta");
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 30, audit: capture.audit });
	view.press("\t");
	const before = detailColumn(await settle(view)).slice(5, 25);
	assert.match(before.join("\n"), /Before 39\./);
	assert.match(before.at(-1), /Calling a tool/);
	view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -3 });
	const after = detailColumn(await settle(view)).slice(5, 25);
	assert.deepEqual(after.slice(3), before.slice(0, -3));
});

test("the wheel moves down and up through a long ended message of interleaved thinking, text and steers by its exact delta, settling after each step and reaching its end", async (t) => {
	const child = record("5636", {
		state: "completed",
		endedAt: now,
		text: "done",
	});
	const capture = audited(t, [child]);
	for (let i = 0; i < 400; i++) {
		capture.say(child.id, [{ type: "text", text: `Before ${i}.` }]);
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	let thinking = "";
	let text = "";
	const steers = [];
	for (let i = 0; i < 1200; i++) {
		const thought = `k${i} `;
		const said = i % 40 === 39 ? `t${i}\n\n` : `t${i} `;
		thinking += thought;
		text += said;
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: {
				type: "thinking_delta",
				contentIndex: 0,
				delta: thought,
			},
		});
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 1,
				delta: said,
			},
		});
		if (i % 300 === 299) {
			steers.push(`Steer ${i}.`);
			capture.emit(child.id, {
				type: "queue_update",
				steering: [...steers],
				followUp: [],
			});
		}
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	capture.emit(child.id, {
		type: "message_end",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking },
				{ type: "text", text },
			],
		},
	});
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 30, audit: capture.audit });
	view.press("\t");
	const pane = async () => detailColumn(await settle(view)).slice(5, 25);
	const wheel = async (wheelDelta) => {
		view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta });
		const renders = view.tui.renders;
		const after = await pane();
		assert.ok(view.tui.renders - renders < 20, "a step never settled");
		return after;
	};
	let before = await pane();
	for (let i = 0; i < 200 && !/Before 0\./.test(before.join("\n")); i++)
		before = await wheel(-40);
	for (let i = 0; i < 200 && !/Before 390\./.test(before.join("\n")); i++)
		before = await wheel(40);
	for (let step = 0; !/After 39\./.test(before.join("\n")); step++) {
		assert.ok(step < 600, "the end was never reached");
		const after = await wheel(3);
		if (!/After 39\./.test(after.join("\n"))) {
			assert.deepEqual(
				after.slice(0, -3),
				before.slice(3),
				`down step ${step}`,
			);
		}
		before = after;
	}
	for (let step = 0; !/Before 390\./.test(before.join("\n")); step++) {
		assert.ok(step < 600, "the start was never reached again");
		const after = await wheel(-3);
		assert.deepEqual(after.slice(3), before.slice(0, -3), `up step ${step}`);
		before = after;
	}
});

function toolUpdate(capture, id, call, i) {
	capture.emit(id, {
		type: "tool_execution_update",
		toolCallId: call,
		toolName: "bash",
		args: { command: call },
		partialResult: { content: [{ type: "text", text: `${call}${i}` }] },
	});
}

function toolEnd(capture, id, call) {
	capture.emit(id, {
		type: "tool_execution_end",
		toolCallId: call,
		toolName: "bash",
		result: { content: [{ type: "text", text: `${call} done` }] },
		isError: false,
	});
}

function itemRows(item) {
	if (item.kind === "static") return [{ sub: "s", rows: ["head"] }];
	if (item.kind === "tool") {
		const partial = JSON.stringify(
			item.entry.partial ?? item.entry.result ?? "",
		);
		return [{ sub: "t", rows: [item.key, partial] }];
	}
	const text = item.entry?.content?.[0]?.text;
	return text === undefined ? [] : [{ sub: "b", rows: [text] }];
}

function rowsTranscript(audit, id) {
	const transcript = createTranscript({
		audit,
		child: id,
		changed() {},
	});
	const draw = () =>
		transcript.layout(80, 30, "", itemRows, {
			head: [{ key: "head", kind: "static" }],
			tail: [],
		});
	return { transcript, draw: () => quiet(transcript, draw) };
}

test("two parallel tools streaming thousands of interleaved updates retain observations bounded by their items while the view crosses them", async (t) => {
	const child = record("5636", {
		state: "completed",
		endedAt: now,
		text: "done",
	});
	const capture = audited(t, [child]);
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
	capture.tool(child.id, "A", "bash", { command: "A" });
	capture.tool(child.id, "B", "bash", { command: "B" });
	for (let i = 0; i < 2000; i++) {
		toolUpdate(capture, child.id, "A", i);
		toolUpdate(capture, child.id, "B", i);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	toolEnd(capture, child.id, "A");
	toolEnd(capture, child.id, "B");
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	const { transcript, draw } = rowsTranscript(capture.audit, child.id);
	const bounded = (where) => {
		const { items, observations } = transcript.info().retained;
		assert.ok(items <= 82, `${items} items retained ${where}`);
		assert.ok(
			observations <= 80 + 2 * 3,
			`${observations} observations retained ${where}`,
		);
	};
	let rows = await draw();
	bounded("when opened");
	for (let i = 0; i < 100 && rows[0] !== "head"; i++) {
		transcript.scroll(-7);
		rows = await draw();
		bounded("going up");
	}
	assert.equal(rows[0], "head");
	for (let i = 0; i < 100 && rows.at(-1) !== "After 39."; i++) {
		transcript.scroll(7);
		rows = await draw();
		bounded("going down");
	}
	assert.equal(rows.at(-1), "After 39.");
	transcript.dispose();
});

test("scrolling both ways over thousands of tool-call messages that draw no rows keeps at most 384 items resident", async (t) => {
	const child = record("5636", {
		state: "completed",
		endedAt: now,
		text: "done",
	});
	const capture = audited(t, [child]);
	for (let n = 0; n < 3000; n++) {
		if (n % 10 === 0) {
			capture.say(child.id, [{ type: "text", text: `Line ${n}.` }]);
		} else {
			const message = { role: "assistant", content: [] };
			capture.emit(child.id, { type: "message_start", message });
			for (let i = 0; i < 5; i++) {
				capture.emit(child.id, {
					type: "message_update",
					message,
					assistantMessageEvent: {
						type: "toolcall_delta",
						contentIndex: 0,
						delta: `${i}`,
					},
				});
			}
			const call = {
				type: "toolCall",
				id: `c${n}`,
				name: "read",
				arguments: {},
			};
			capture.emit(child.id, {
				type: "message_end",
				message: { role: "assistant", content: [call] },
			});
		}
		if (n % 20 === 19) await written(capture.audit, child.id);
	}
	for (let i = 0; i < 40; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	let reads = 0;
	const audit = {
		read(id, cursor) {
			reads += 1;
			return capture.audit.read(id, cursor);
		},
		segment: capture.audit.segment,
	};
	const { transcript, draw } = rowsTranscript(audit, child.id);
	let rows = await draw();
	let most = 0;
	const step = async (delta) => {
		const before = reads;
		transcript.scroll(delta);
		rows = await draw();
		most = Math.max(most, reads - before);
		assert.equal(rows.length, 30);
		assert.ok(
			transcript.info().retained.items <= 384,
			`${transcript.info().retained.items} items`,
		);
	};
	for (let i = 0; i < 200 && rows[0] !== "head"; i++) await step(-7);
	assert.equal(rows[0], "head");
	for (let i = 0; i < 200 && rows.at(-1) !== "After 39."; i++) await step(7);
	assert.equal(rows.at(-1), "After 39.");
	assert.ok(most <= 8, `${most} reads in one step`);
	transcript.dispose();
});

test("an early tool updated late is not pruned with the rows on screen when the read after it crosses the item budget", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	capture.tool(child.id, "early", "bash", { command: "early" });
	for (let i = 0; i < 383; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const { transcript, draw } = rowsTranscript(capture.audit, child.id);
	let rows = await draw();
	for (let i = 0; i < 40 && rows[0] !== "head"; i++) {
		transcript.scroll(-30);
		rows = await draw();
	}
	assert.equal(rows[0], "head");
	for (let i = 0; i < 40 && !rows.includes("Line 350."); i++) {
		transcript.scroll(30);
		rows = await draw();
	}
	assert.ok(rows.includes("Line 350."));
	assert.equal(transcript.info().retained.items, 384);
	toolUpdate(capture, child.id, "early", 1);
	capture.say(child.id, [{ type: "text", text: "Line 383." }]);
	await written(capture.audit, child.id);
	transcript.changed();
	const after = await draw();
	assert.deepEqual(after, rows);
	for (const delta of [-3, -3, -3, 3, 3, 3, 3, 3]) {
		transcript.scroll(delta);
		const next = await draw();
		assert.equal(next.length, 30);
		if (delta < 0) assert.deepEqual(next.slice(3), rows.slice(0, -3));
		else assert.deepEqual(next.slice(0, -3), rows.slice(3));
		rows = next;
	}
	for (let i = 0; i < 40 && rows[0] !== "head"; i++) {
		transcript.scroll(-10);
		rows = await draw();
	}
	assert.equal(rows[0], "head");
	assert.ok(
		rows.some((row) => row.includes("early1")),
		rows.join("\n"),
	);
	transcript.dispose();
});

function earlyInPlace(rows) {
	const at = rows.indexOf("tool:early");
	if (at >= 0 && at + 2 < rows.length) assert.equal(rows[at + 2], "Line 0.");
}

test("following a child whose early tool keeps updating among thousands of later items keeps residency bounded", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	capture.tool(child.id, "early", "bash", { command: "early" });
	await written(capture.audit, child.id);
	const { transcript, draw } = rowsTranscript(capture.audit, child.id);
	let rows = await draw();
	for (let n = 0; n < 2400; n++) {
		capture.say(child.id, [{ type: "text", text: `Line ${n}.` }]);
		if (n % 5 === 4) toolUpdate(capture, child.id, "early", n);
		if (n % 60 === 59) {
			await written(capture.audit, child.id);
			transcript.changed();
			rows = await draw();
			assert.ok(
				transcript.info().retained.items <= 384,
				`${transcript.info().retained.items} items`,
			);
		}
	}
	assert.equal(rows.at(-1), "Line 2399.");
	transcript.scroll(-100000);
	earlyInPlace(
		transcript.layout(80, 30, "", itemRows, {
			head: [{ key: "head", kind: "static" }],
			tail: [],
		}),
	);
	for (let i = 0; i < 200 && rows[0] !== "head"; i++) {
		transcript.scroll(-30);
		rows = await draw();
		assert.ok(
			transcript.info().retained.items <= 384,
			`${transcript.info().retained.items} items`,
		);
		earlyInPlace(rows);
	}
	assert.equal(rows[0], "head");
	assert.ok(
		rows.some((row) => row.includes("early2399")),
		rows.join("\n"),
	);
	transcript.dispose();
});

async function runningTools(t, options = {}) {
	const root = withAgentDirectory(t);
	const child = record("5636");
	const capture = audited(t, [child], { root, limits: options.limits });
	const issued = new Set();
	const invented = [];
	const audit = {
		async read(id, cursor) {
			if (cursor?.offset !== undefined && !issued.has(JSON.stringify(cursor)))
				invented.push(cursor);
			const read = await capture.audit.read(id, cursor);
			if (read && "next" in read) issued.add(JSON.stringify(read.next));
			return read;
		},
		segment: capture.audit.segment,
	};
	const { transcript, draw } = rowsTranscript(audit, child.id);
	let rows = await draw();
	const latest = new Map();
	const message = { role: "assistant", content: [] };
	let streamed = "";
	capture.emit(child.id, { type: "message_start", message });
	const sync = async () => {
		const delta = `d${streamed.split(" ").length} `;
		streamed += delta;
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		});
		await written(capture.audit, child.id);
		transcript.changed();
		rows = await draw();
		assert.ok(
			transcript.info().retained.items <= 384,
			`${transcript.info().retained.items} items`,
		);
	};
	let started = 0;
	const start = async (count) => {
		for (let j = 0; j < count; j++) {
			capture.tool(child.id, `p${started}`, "bash", { command: `p${started}` });
			started += 1;
			if (started % 50 === 0) await sync();
		}
		await sync();
	};
	const update = async (round, step = 1) => {
		for (let k = 0; k < started; k += step) {
			toolUpdate(capture, child.id, `p${k}`, `u${round}`);
			latest.set(`tool:p${k}`, `p${k}u${round}`);
			if (k % 50 === 49) await sync();
		}
		await sync();
	};
	await start(384);
	await update(0);
	await start(1);
	await update(1, 2);
	await start(20);
	assert.ok(rows.includes("tool:p404"), rows.join("\n"));
	if (options.unindexed)
		await rm(join(root, "parent-1", `${child.id}.index`), { recursive: true });
	const shown = (pane) => {
		for (const [at, row] of pane.entries()) {
			const want = latest.get(row);
			if (want !== undefined && at + 1 < pane.length)
				assert.match(pane[at + 1], new RegExp(want), row);
		}
	};
	for (let i = 0; i < 400 && rows[0] !== "head"; i++) {
		transcript.scroll(-7);
		rows = await draw();
		assert.equal(rows.length, 30);
		assert.ok(
			transcript.info().retained.items <= 384,
			`${transcript.info().retained.items} items`,
		);
		shown(rows);
	}
	assert.equal(rows[0], "head");
	assert.equal(rows[1], streamed);
	assert.deepEqual(invented, []);
	transcript.dispose();
}

test("following hundreds of running tools that all update after the last one started keeps residency bounded and each tool's state", (t) =>
	runningTools(t));

test("a removed tool brought back over a record without its index, by backward pages that pass their boundary, shows its latest state", (t) =>
	runningTools(t, {
		unindexed: true,
		limits: { windowBytes: 2048, cacheEntries: 0 },
	}));

test("a followed child streaming while each render lags behind its reads keeps at most 384 items resident", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	let timer;
	let resident = 0;
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed: () => {
			timer ??= setTimeout(draw, 16);
		},
	});
	const layout = () =>
		transcript.layout(80, 30, "", itemRows, { head: [], tail: [] });
	function draw() {
		timer = undefined;
		layout();
		resident = Math.max(resident, transcript.info().retained.items);
	}
	for (let i = 0; i < 1000; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		transcript.changed();
		timer ??= setTimeout(draw, 16);
		if (i % 2 === 1) await delay(1);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	clearTimeout(timer);
	const rows = await quiet(transcript, layout);
	assert.equal(rows.at(-1), "Line 999.");
	assert.ok(resident <= 384, `${resident} items`);
	transcript.dispose();
});

test("a record without its index opens on its tail even when the tail lies past the first window of bytes", async (t) => {
	const root = withAgentDirectory(t);
	const child = record("5636");
	const capture = audited(t, [child], {
		root,
		limits: { windowBytes: 4096, cacheEntries: 0 },
	});
	for (let i = 0; i < 300; i++) {
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
		if (i % 50 === 49) await written(capture.audit, child.id);
	}
	await rm(join(root, "parent-1", `${child.id}.index`), { recursive: true });
	const { transcript, draw } = rowsTranscript(capture.audit, child.id);
	const rows = await draw();
	assert.equal(rows.at(-1), "Line 299.");
	transcript.dispose();
});

function zeroRow(capture, id, n) {
	const message = { role: "assistant", content: [] };
	capture.emit(id, { type: "message_start", message });
	capture.emit(id, {
		type: "message_update",
		message,
		assistantMessageEvent: {
			type: "toolcall_delta",
			contentIndex: 0,
			delta: "x",
		},
	});
	const call = { type: "toolCall", id: `c${n}`, name: "read", arguments: {} };
	capture.emit(id, {
		type: "message_end",
		message: { role: "assistant", content: [call] },
	});
}

test("an undrawn tool that ended below the read range shows its result when scrolling back reaches it", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	capture.tool(child.id, "a", "bash", { command: "a" });
	capture.tool(child.id, "b", "bash", { command: "b" });
	for (let i = 0; i < 100; i++)
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
	await written(capture.audit, child.id);
	const { transcript, draw } = rowsTranscript(capture.audit, child.id);
	let rows = await draw();
	let n = 0;
	const read = async (count) => {
		for (let j = 0; j < count; j++) zeroRow(capture, child.id, n++);
		await written(capture.audit, child.id);
		transcript.changed();
		rows = await draw();
	};
	for (let k = 0; k < 10; k++) {
		for (let j = 0; j < 40; j++) zeroRow(capture, child.id, n++);
		toolUpdate(capture, child.id, "a", k);
		toolUpdate(capture, child.id, "b", k);
		await read(0);
	}
	toolEnd(capture, child.id, "a");
	toolEnd(capture, child.id, "b");
	await read(40);
	transcript.scroll(-5);
	await read(60);
	for (let i = 0; i < 400 && rows[0] !== "head"; i++) {
		transcript.scroll(-30);
		rows = await draw();
	}
	assert.equal(rows[0], "head");
	assert.ok(
		rows.some((row) => row.includes("b done")),
		rows.slice(0, 6).join("\n"),
	);
	transcript.dispose();
});

test("random wheel reversals over consecutive long tool calls keep the pane full", async (t) => {
	const child = record("5636", {
		state: "completed",
		endedAt: now,
		text: "done",
	});
	const capture = audited(t, [child]);
	for (let i = 0; i < 20; i++)
		capture.say(child.id, [{ type: "text", text: `Line ${i}.` }]);
	for (let k = 0; k < 6; k++) {
		capture.tool(child.id, `T${k}`, "bash", { command: `T${k}` });
		for (let i = 0; i < 1000; i++) {
			toolUpdate(capture, child.id, `T${k}`, i);
			if (i % 100 === 99) await written(capture.audit, child.id);
		}
		toolEnd(capture, child.id, `T${k}`);
	}
	for (let i = 0; i < 20; i++)
		capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
	await written(capture.audit, child.id);
	const { transcript, draw } = rowsTranscript(capture.audit, child.id);
	let seed = 7;
	const random = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	await draw();
	for (let step = 0; step < 300; step++) {
		transcript.scroll(Math.round((random() - 0.5) * 40) || 1);
		const rows = await draw();
		assert.equal(rows.length, 30, `step ${step}`);
	}
	transcript.dispose();
});

for (const reopened of [true, false]) {
	test(`${reopened ? "a reopened record left unclosed" : "a live record"} scrolls down into a long ended message by its exact delta`, async (t) => {
		const root = withAgentDirectory(t);
		const child = record("5636", {
			state: "completed",
			endedAt: now,
			text: "done",
		});
		const capture = audited(t, [child], { root });
		for (let i = 0; i < 450; i++) {
			capture.say(child.id, [{ type: "text", text: `Say ${i}.` }]);
			if (i % 50 === 49) await written(capture.audit, child.id);
		}
		const message = { role: "assistant", content: [] };
		capture.emit(child.id, { type: "message_start", message });
		let text = "";
		for (let i = 0; i < 7000; i++) {
			const delta = i % 40 === 39 ? `w${i}\n\n` : `w${i} `;
			text += delta;
			capture.emit(child.id, {
				type: "message_update",
				message,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
			});
			if (i % 100 === 99) await written(capture.audit, child.id);
		}
		capture.emit(child.id, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text }] },
		});
		for (let i = 0; i < 20; i++)
			capture.say(child.id, [{ type: "text", text: `After ${i}.` }]);
		await written(capture.audit, child.id);
		const audit = reopened
			? createChildAudit({ root, parent: () => "parent-1" })
			: capture.audit;
		const view = open(fakeSessions([child]), { rows: 40, audit });
		view.press("\t");
		const pane = async () => detailColumn(await settle(view)).slice(6, 35);
		let before = await pane();
		for (let i = 0; i < 400 && !/Say 0\./.test(before.join("\n")); i++) {
			view.press("\x0b");
			before = await pane();
		}
		assert.match(before.join("\n"), /Say 0\./);
		for (let i = 0; i < 400 && !/Say 440\./.test(before.join("\n")); i++) {
			view.press("\x0a");
			before = await pane();
		}
		for (let step = 0; !/After 19\./.test(before.join("\n")); step++) {
			assert.ok(step < 600, "the end was never reached");
			view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: 3 });
			const after = await pane();
			if (!/After 19\./.test(after.join("\n"))) {
				assert.deepEqual(after.slice(0, -3), before.slice(3), `step ${step}`);
			}
			before = after;
		}
	});
}

test("a followed message past its text cap keeps the rows the wheel left when its end arrives", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	capture.say(child.id, [{ type: "text", text: "Before." }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	await written(capture.audit, child.id);
	const sessions = fakeSessions([child]);
	const view = open(sessions, { rows: 40, audit: capture.audit });
	view.press("\t");
	const pane = async () => detailColumn(await settle(view)).slice(4, 35);
	await pane();
	let text = "";
	for (let i = 0; i < 7000; i++) {
		const delta = i % 40 === 39 ? `w${i}\n\n` : `w${i} `;
		text += delta;
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		});
		if (i % 100 === 99) {
			await written(capture.audit, child.id);
			sessions.changed();
			await pane();
		}
	}
	await written(capture.audit, child.id);
	sessions.changed();
	assert.match((await pane()).join("\n"), /w6999/);
	view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -15 });
	const before = await pane();
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
	await written(capture.audit, child.id);
	sessions.changed();
	assert.deepEqual(await pane(), before);
});

test("a streaming message whose start is not loaded keeps the rows the wheel left when its end arrives", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	for (let i = 0; i < 5; i++)
		capture.say(child.id, [{ type: "text", text: `Say ${i}.` }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	let text = "";
	for (let i = 0; i < 600; i++) {
		const delta = `w${i}\n`;
		text += delta;
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		});
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const sessions = fakeSessions([child]);
	const view = open(sessions, { rows: 40, audit: capture.audit });
	view.press("\t");
	const pane = async () => detailColumn(await settle(view)).slice(4, 35);
	assert.match((await pane()).join("\n"), /w599/);
	view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -50 });
	const before = await pane();
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
	await written(capture.audit, child.id);
	sessions.changed();
	assert.deepEqual(await pane(), before);
});

test("a fast flick up a streaming message whose start is not loaded settles where the flick put it", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	capture.say(child.id, [{ type: "text", text: "Before the stream." }]);
	const message = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message });
	for (let i = 0; i < 3000; i++) {
		const delta = i % 25 === 24 ? `t${i}\n\n` : `t${i} `;
		capture.emit(child.id, {
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		});
		if (i % 100 === 99) await written(capture.audit, child.id);
	}
	await written(capture.audit, child.id);
	const flicked = open(fakeSessions([child]), {
		rows: 40,
		audit: capture.audit,
	});
	const stepped = open(fakeSessions([child]), {
		rows: 40,
		audit: capture.audit,
	});
	const pane = async (view) => detailColumn(await settle(view)).slice(4, 35);
	for (const view of [flicked, stepped]) {
		view.press("\t");
		await pane(view);
	}
	for (let k = 0; k < 40; k++) {
		flicked.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -3 });
		flicked.lines(120);
	}
	for (let k = 0; k < 40; k++) {
		stepped.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -3 });
		await pane(stepped);
	}
	assert.deepEqual(await pane(flicked), await pane(stepped));
});

test("a detached view keeps the newest text of a message streaming past its cap, so following shows it at once", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child]);
	const streaming = { role: "assistant", content: [] };
	capture.emit(child.id, { type: "message_start", message: streaming });
	let i = 0;
	const stream = async (count) => {
		for (const end = i + count; i < end; i++) {
			capture.emit(child.id, {
				type: "message_update",
				message: streaming,
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: `w${i} pad${i} `,
				},
			});
			if (i % 50 === 49) {
				await written(capture.audit, child.id);
				transcript.changed();
				await quiet(transcript, draw);
			}
		}
	};
	const transcript = createTranscript({
		audit: capture.audit,
		child: child.id,
		changed() {},
	});
	let entry;
	const draw = () =>
		transcript.layout(
			80,
			30,
			"",
			(item) => {
				if (item.kind !== "message") return [];
				entry = item.entry;
				const text = item.entry.content[0]?.text ?? "";
				return [{ sub: "b", rows: text.trim().split(" ").slice(-10) }];
			},
			{ head: [], tail: [] },
		);
	await stream(2300);
	transcript.scroll(-3);
	await quiet(transcript, draw);
	assert.equal(transcript.following, false);
	await stream(300);
	transcript.follow();
	await quiet(transcript, draw);
	assert.match(entry.content[0]?.text ?? "", / pad2599 $/);
	transcript.dispose();
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
	const capture = audited(t, [child], {
		limits: { chunk: 1024, windowBytes: 4096 },
	});
	const lines = Array.from(
		{ length: 200 },
		(_, i) => `m${String(i).padStart(3, "0")}. ${"long ".repeat(18)}end`,
	);
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
	capture.tool(
		child.id,
		"t1",
		"bash",
		{ command: `echo ${"word ".repeat(60)}LAST`, timeout: 99 },
		"ok",
	);
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
	const capture = audited(t, [child], {
		limits: { chunk: 1024, windowBytes: 4096 },
	});
	const lines = Array.from(
		{ length: 200 },
		(_, i) => `i${String(i).padStart(3, "0")}. ${"long ".repeat(18)}end`,
	);
	capture.emit(child.id, {
		type: "message_start",
		message: {
			role: "user",
			content: [{ type: "text", text: lines.join("\n") }],
		},
	});
	await written(capture.audit, child.id);
	const view = open(fakeSessions([child]), { rows: 24, audit: capture.audit });
	assert.match(await settle(view), /❯ Message retained in parts/);

	view.press("\t", "\x0f");
	assert.match(await settle(view), /i199\. long/);
});

test("an expanded huge result made of many small fields still shows its parts", async (t) => {
	const child = record("5636");
	const capture = audited(t, [child], {
		limits: { chunk: 1024, windowBytes: 4096 },
	});
	const content = Array.from({ length: 300 }, (_, i) => ({
		type: "text",
		text: `s${String(i).padStart(3, "0")} ${"x".repeat(40)}`,
	}));
	capture.emit(child.id, {
		type: "tool_execution_start",
		toolCallId: "t1",
		toolName: "bash",
		args: { command: "ls" },
	});
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
	const capture = audited(t, [child], {
		limits: { chunk: 1024, windowBytes: 4096 },
	});
	const rows = Array.from(
		{ length: 300 },
		(_, i) => `r${String(i).padStart(3, "0")}. ${"wide ".repeat(18)}end`,
	);
	capture.tool(
		child.id,
		"big",
		"bash",
		{ command: "cat log" },
		rows.join("\n"),
	);
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
	for (const row of rows)
		assert.ok(joined.includes(row.replace(/\s+/g, "")), row.slice(0, 5));
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
		message: {
			role: "user",
			content: [{ type: "text", text: hostile("steer") }],
		},
	});
	capture.say(child.id, [
		{ type: "thinking", thinking: hostile("thought") },
		{ type: "text", text: hostile("text") },
	]);
	capture.tool(
		child.id,
		"c1",
		hostile("tool"),
		{ path: hostile("path") },
		hostile("output"),
		true,
	);
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
					for (const sequence of [
						"\x1b[2J",
						"\x1b]52;c;",
						"\x9b",
						"\x07",
						"‮",
						"⁦",
					]) {
						assert.equal(
							line.includes(sequence),
							false,
							JSON.stringify(sequence),
						);
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
			...Object.fromEntries(
				capabilities.map((capability) => [capability, true]),
			),
			"child-session": false,
		},
		expectations: {},
	});
	try {
		assert.deepEqual(view.raw(120), []);
		assert.equal(view.closed(), true);
		capture.say(child.id, [
			{ type: "text", text: "Still working after Fleet closed." },
		]);
		assert.equal(sessions.get(child.id).state, "running");
		const window = await capture.audit.read(child.id);
		assert.ok(
			window.observations.some((entry) =>
				JSON.stringify(entry.content ?? "").includes(
					"Still working after Fleet closed.",
				),
			),
		);
	} finally {
		replaceSelection({
			schemaVersion: 1,
			capabilities: Object.fromEntries(
				capabilities.map((capability) => [capability, true]),
			),
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
	for (let i = 0; i < 8000; i++) {
		capture.emit(child.id, {
			type: "message_update",
			message: streaming,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: `w${i} `,
			},
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
				pieces.push({
					text: item.entry.content[0]?.text ?? "",
					earlier: item.entry.earlier,
				});
				return [
					{
						sub: "body",
						rows: ["row"],
						...(item.entry.earlier === undefined
							? {}
							: { load: { earlier: item.entry.earlier } }),
					},
				];
			},
			{ head: [], tail: [] },
		);
		return pieces;
	};
	const contiguous = (text) => {
		const numbers = text
			.trim()
			.split(" ")
			.map((word) => Number(word.slice(1)));
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
					assert.equal(
						piece.earlier === undefined,
						piece.text.startsWith("w0 "),
						piece.text,
					);
				} else {
					assert.notEqual(piece.earlier, undefined);
				}
				if (index < pieces.length - 1)
					assert.ok(words(piece.text).length <= 384);
			}
			if (pieces.length > 0)
				assert.ok(pieces.at(-1).text.length <= 32 * 1024 + 384 * 6);
			if (pieces.length > 0 && done(pieces)) return pieces;
			await delay(5);
		}
		assert.fail("the expansion never settled");
	};
	const slid = await step(
		(pieces) => pieces.length === 1 && reached.size === 8000,
	);
	assert.notEqual(slid[0].earlier, undefined);
	assert.match(slid[0].text, / w7999 $/);
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
	const held = detailColumn(await settle(view))
		.slice(4)
		.join("\n");
	assert.match(held, /Para \d+\./);
	capture.emit(child.id, {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: body }] },
	});
	sessions.changed();
	assert.equal(
		detailColumn(await settle(view))
			.slice(4)
			.join("\n"),
		held,
	);
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
	const order = [...text.matchAll(/\bd(\d+)\b/g)].map((match) =>
		Number(match[1]),
	);
	const unique = [...new Set(order)];
	assert.deepEqual(
		unique,
		[...unique].sort((a, b) => a - b),
	);
	assert.equal(unique.length, 299);
	assert.match(text, /d200 😀/);
});

function contextView(t, child, context, { rows = 20 } = {}) {
	const capture = lines40(t, child);
	const sessions = fakeSessions([child]);
	if (context) sessions.contexts[child.id] = context;
	const view = open(sessions, { rows, audit: capture.audit });
	view.press("\r");
	return { view, sessions };
}

test("the detail shows the selected child's context below its model and above its task, fixed while the transcript scrolls", async (t) => {
	const child = record("5636");
	const { view } = contextView(t, child, {
		capacity: 200_000,
		tokens: 100_000,
		last: false,
	});
	const lines = (await settle(view, 60)).split("\n");
	const meta = lines.findIndex((line) => /gpt-6-luna \(high\)/.test(line));
	assert.match(
		lines[meta + 1],
		/│ {2}ctx ▰ ▰ ▰ ▰ ▱ ▱ ▱ ▱ {2}50% · 100K \/ 200K +│/,
	);
	assert.match(lines[meta + 2], /Run sleep 60/);
	view.press("k", "k", "k");
	const scrolled = (await settle(view, 60)).split("\n");
	assert.notDeepEqual(scrolled, lines);
	assert.equal(scrolled[meta + 1], lines[meta + 1]);
});

test("a short terminal clips the detail header from the bottom, giving up the task before the context row", async (t) => {
	const ctx = /^ │ {2}ctx ▰ ▰ ▰ ▰ ▱ ▱ ▱ ▱ {2}50% · 100K \/ 200K +│$/;
	for (const [rows, top] of [
		[8, [/◐ worker 5636/, /gpt-6-luna \(high\)/]],
		[9, [/◐ worker 5636/, /gpt-6-luna \(high\)/, ctx]],
		[10, [/◐ worker 5636/, /gpt-6-luna \(high\)/, ctx, /Run sleep 60/]],
	]) {
		await t.test(`${rows} rows`, async (t) => {
			const { view } = contextView(
				t,
				record("5636"),
				{ capacity: 200_000, tokens: 100_000, last: false },
				{ rows },
			);
			await settle(view, 60);
			const lines = view.raw(60).map(plain);
			assert.equal(lines.length, rows);
			for (const [at, pattern] of top.entries())
				assert.match(lines[1 + at], pattern);
			assert.equal(
				lines.filter((line) => line.includes("ctx ")).length,
				rows >= 9 ? 1 : 0,
			);
			assert.match(lines[1 + top.length], /^ │ +│$/);
		});
	}
});

const contextRawOf = (view, width) => {
	const lines = view.raw(width);
	return lines[
		lines.findIndex((line) => plain(line).includes("gpt-6-luna (high)")) + 1
	];
};

test("the context row's percentage, eight-cell meter and colors follow the principal header's rounded rules, uncapped above 100%", async (t) => {
	for (const [tokens, row, color] of [
		[0, "ctx ▱ ▱ ▱ ▱ ▱ ▱ ▱ ▱  0% · 0 / 200K", "text"],
		[12_000, "ctx ▱ ▱ ▱ ▱ ▱ ▱ ▱ ▱  6% · 12K / 200K", "text"],
		[14_000, "ctx ▰ ▱ ▱ ▱ ▱ ▱ ▱ ▱  7% · 14K / 200K", "text"],
		[148_000, "ctx ▰ ▰ ▰ ▰ ▰ ▰ ▱ ▱  74% · 148K / 200K", "text"],
		[149_000, "ctx ▰ ▰ ▰ ▰ ▰ ▰ ▱ ▱  75% · 149K / 200K", "warning"],
		[188_999, "ctx ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰  94% · 188K / 200K", "warning"],
		[189_000, "ctx ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰  95% · 189K / 200K", "error"],
		[300_000, "ctx ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰  150% · 300K / 200K", "error"],
	]) {
		await t.test(`${tokens} of 200K`, async (t) => {
			const { view } = contextView(t, record("5636"), {
				capacity: 200_000,
				tokens,
				last: false,
			});
			await settle(view, 60);
			const raw = contextRawOf(view, 60);
			assert.equal(
				plain(raw)
					.replace(/^ │ {2}/, "")
					.trimEnd()
					.replace(/ +│$/, ""),
				row,
			);
			const percent = row.match(/\d+%/)[0];
			assert.ok(raw.includes(theme.fg(color, percent)), raw);
			const main = renderHeader(
				theme,
				{
					branch: null,
					cwd: "/",
					home: "/",
					working: 0,
					usage: { tokens, contextWindow: 200_000 },
				},
				120,
			)[0];
			const start = main.indexOf(theme.fg("dim", "ctx"));
			const meter = main.slice(
				start,
				main.indexOf(theme.fg(color, percent)) +
					theme.fg(color, percent).length,
			);
			assert.ok(
				raw.includes(meter),
				`${JSON.stringify(meter)} in ${JSON.stringify(raw)}`,
			);
		});
	}
});

test("the context row tells unavailable, unknown occupancy and retained readings apart, and an ended child's reading is last", async (t) => {
	const running = record("5636");
	const ended = record("5636", {
		state: "completed",
		endedAt: now,
		text: "Done.",
	});
	for (const [name, child, context, row] of [
		[
			"queued",
			record("5636", { state: "queued", startedAt: undefined }),
			undefined,
			"ctx unavailable",
		],
		["no measurement", running, undefined, "ctx unavailable"],
		[
			"unknown occupancy",
			running,
			{ capacity: 200_000, tokens: null, last: false },
			"ctx ? · 200K",
		],
		[
			"retained reading",
			running,
			{ capacity: 200_000, tokens: 100_000, last: true },
			"ctx ▰ ▰ ▰ ▰ ▱ ▱ ▱ ▱  50% · 100K / 200K · last",
		],
		[
			"retained unknown occupancy",
			running,
			{ capacity: 200_000, tokens: null, last: true },
			"ctx ? · 200K · last",
		],
		[
			"ended reading",
			ended,
			{ capacity: 200_000, tokens: 100_000, last: false },
			"ctx ▰ ▰ ▰ ▰ ▱ ▱ ▱ ▱  50% · 100K / 200K · last",
		],
		[
			"ended unknown occupancy",
			ended,
			{ capacity: 200_000, tokens: null, last: false },
			"ctx ? · 200K · last",
		],
		["ended without a measurement", ended, undefined, "ctx unavailable"],
	]) {
		await t.test(name, async (t) => {
			const { view } = contextView(t, child, context);
			await settle(view, 60);
			assert.equal(
				plain(contextRawOf(view, 60))
					.replace(/^ │ {2}/, "")
					.replace(/ +│$/, ""),
				row,
			);
		});
	}
});

test("a narrowing detail drops the meter, then the counts, then clips the context row, never overflowing down to one column", async (t) => {
	const forms = {
		numeric: [
			[60, "ctx ▰ ▰ ▰ ▰ ▱ ▱ ▱ ▱  50% · 100K / 200K · last"],
			[52, "ctx 50% · 100K / 200K · last"],
			[35, "ctx 50% · last"],
			[19, "ctx 50% · la…"],
		],
		unknown: [
			[60, "ctx ? · 200K · last"],
			[24, "ctx ? · last"],
			[17, "ctx ? · la…"],
		],
		unavailable: [
			[60, "ctx unavailable"],
			[17, "ctx unavai…"],
		],
	};
	const contexts = {
		numeric: { capacity: 200_000, tokens: 100_000, last: true },
		unknown: { capacity: 200_000, tokens: null, last: true },
		unavailable: undefined,
	};
	for (const [name, expected] of Object.entries(forms)) {
		await t.test(name, async (t) => {
			const { view } = contextView(t, record("5636"), contexts[name]);
			await settle(view, 60);
			for (const [width, row] of expected) {
				assert.equal(
					plain(view.lines(width)[3])
						.replace(/^ │ {1,2}/, "")
						.replace(/ +│$/, ""),
					row,
					`${width}`,
				);
			}
			for (let width = 60; width >= 1; width--) {
				for (const line of view.raw(width))
					assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
			}
			assert.equal(plain(view.lines(4)[3]), "│c…│");
		});
	}
});

test("a reopened history child shows its recovered context as last, and unavailable without a valid snapshot", async (t) => {
	const root = withAgentDirectory(t);
	const numeric = record("5636", {
		state: "completed",
		endedAt: now,
		text: "Done.",
	});
	const unknown = record("9e01", {
		state: "completed",
		endedAt: now,
		text: "Done.",
	});
	const interrupted = record("a809");
	const never = record("b7c2", {
		state: "completed",
		endedAt: now,
		text: "Done.",
	});
	const before = audited(t, [numeric, unknown, interrupted, never], { root });
	before.captures[numeric.id].context({
		capacity: 200_000,
		tokens: 100_000,
		last: false,
	});
	before.captures[unknown.id].context({
		capacity: 200_000,
		tokens: null,
		last: false,
	});
	before.captures[interrupted.id].context({
		capacity: 200_000,
		tokens: 50_000,
		last: false,
	});
	for (const child of [numeric, unknown, never])
		before.audit.execution(child.id, "completed");
	before.audit.execution(interrupted.id, "running");
	await before.audit.close();

	const later = audited(t, [], { root });
	const view = open(fakeSessions([]), { rows: 30, audit: later.audit });
	await settle(view, 60);
	const rows = {};
	for (let i = 0; i < 4; i++) {
		view.press("\r");
		const shown = (await settle(view, 60)).split("\n")[1];
		const child = [numeric, unknown, interrupted, never].find(({ id }) =>
			shown.includes(`worker ${id.slice(0, 4)}`),
		);
		rows[child.id] = plain(contextRawOf(view, 60))
			.replace(/^ │ {2}/, "")
			.trimEnd()
			.replace(/ +│$/, "");
		view.press("\x1b", "j");
	}
	assert.deepEqual(rows, {
		[numeric.id]: "ctx ▰ ▰ ▰ ▰ ▱ ▱ ▱ ▱  50% · 100K / 200K · last",
		[unknown.id]: "ctx ? · 200K · last",
		[interrupted.id]: "ctx ▰ ▰ ▱ ▱ ▱ ▱ ▱ ▱  25% · 50K / 200K · last",
		[never.id]: "ctx unavailable",
	});
});
