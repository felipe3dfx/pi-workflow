import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

import { initTheme } from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createChildrenViews } from "../extensions/children-view.ts";
import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";

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
		tasks = [3],
	} = {},
) {
	let factory;
	const views = createChildrenViews(
		sessions,
		{ has: (id) => tasks.includes(id) },
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
	assert.match(wide[1], /Active ─+ │ ◐ worker 5636 +running · 1m 0\ds {2}│$/);
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

test("list rows take two lines under Active and Finished rules, and the selected child gets the selection background on both", () => {
	const view = open(threeChildren(), { rows: 40 });
	const raw = view.raw(120);
	const lines = raw.map(plain);
	assert.match(lines[1], /│ {2} Active ─/);
	assert.match(lines[2], /▸ ◐ worker 5636 +running · 1m 0\ds/);
	assert.match(lines[3], /│ {6}bash sleep 60 +6\.2k tok · \$0\.01 │/);
	assert.match(lines[4], /│ {2} Finished ─/);
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

test("the detail shows a header, the clamped prompt, the thread in chat rows, and a result once the child ends", () => {
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
	const sessions = fakeSessions([running, failed], {
		[running.id]: busyThread(),
		[failed.id]: { entries: [] },
	});
	const view = open(sessions, { rows: 60 });
	let text = view.lines(120).join("\n");
	assert.match(text, / Prompt ─/);
	assert.match(text, /❯ Step 0 of the work\./);
	assert.match(text, /Step 3 of the work\./);
	assert.doesNotMatch(text, /Step 4 of the work\./);
	assert.match(text, /… \+4 lines · p expand/);
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

	view.press("p");
	assert.match(view.lines(120).join("\n"), /Step 7 of the work\./);

	view.press("\x14");
	text = view.lines(120).join("\n");
	assert.match(text, /◆ Thought/);
	assert.doesNotMatch(text, /Waiting 60 seconds/);

	view.press("j");
	text = view.lines(120).join("\n");
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

test("a thought streamed while the view is open shows its duration once it ends", () => {
	const child = record("5636");
	const streaming = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "Planning the wait." }],
		timestamp: 7,
	};
	const sessions = fakeSessions([child], {
		[child.id]: { entries: [], streaming },
	});
	const view = open(sessions);
	assert.match(view.lines(120).join("\n"), /◆ Thinking…/);
	sessions.threads[child.id] = {
		entries: [assistant("a1", streaming.content, { timestamp: 7 })],
	};
	assert.match(view.lines(120).join("\n"), /◆ Thought for \d+\.\ds/);
});

test("Tab moves the focus between panes, Ctrl+J/K and page keys scroll the focused pane, f follows the tail, and Esc or q closes", () => {
	const child = record("5636");
	const entries = Array.from({ length: 40 }, (_, i) =>
		assistant(`a${i}`, [{ type: "text", text: `Line ${i}.` }]),
	);
	const sessions = fakeSessions([child], { [child.id]: { entries } });
	const view = open(sessions, { rows: 20 });
	assert.match(view.lines(120).join("\n"), /Line 39\./);
	assert.match(
		view.lines(120).at(-3),
		/j\/k move {2}\| {2}Tab focus {2}\| {2}Enter steer {2}\| {2}Ctrl\+J\/K scroll {2}\| {2}f follow {2}\| {2}s\/c cancel {2}\| {2}Ctrl\+T thinking/,
	);
	const accent = "\x1b[1m\x1b[36mworker 5636";
	assert.equal(
		view.raw(120).some((line) => line.includes(accent)),
		false,
	);
	view.press("\t");
	assert.ok(view.raw(120).some((line) => line.includes(accent)));

	view.press("\x0b", "\x0b");
	let text = view.lines(120).join("\n");
	assert.doesNotMatch(text, /Line 39\./);
	sessions.threads[child.id] = {
		entries: [
			...entries,
			assistant("a40", [{ type: "text", text: "Line 40." }]),
		],
	};
	assert.doesNotMatch(view.lines(120).join("\n"), /Line 40\./);
	view.press("\x1b[6~", "\x1b[6~", "\x1b[6~");
	assert.match(view.lines(120).join("\n"), /Line 40\./);
	view.press("\x1b[5~");
	assert.doesNotMatch(view.lines(120).join("\n"), /Line 40\./);
	view.press("f");
	assert.match(view.lines(120).join("\n"), /Line 40\./);

	view.press("\n");
	text = view.lines(120).join("\n");
	assert.match(text, /Line 40\./);

	view.press("\x1b");
	assert.equal(view.closed(), true);
});

test("in one pane, Enter opens the detail, j/k scroll it, and Esc goes back to the list", () => {
	const child = record("5636");
	const entries = Array.from({ length: 40 }, (_, i) =>
		assistant(`a${i}`, [{ type: "text", text: `Line ${i}.` }]),
	);
	const view = open(fakeSessions([child], { [child.id]: { entries } }), {
		rows: 20,
	});
	view.press("\r");
	let lines = view.lines(60);
	assert.match(lines[1], /◐ worker 5636 +running · 1m 0\ds/);
	assert.match(lines.join("\n"), /Line 39\./);
	assert.match(lines.join("\n"), /Esc back/);
	view.press("k");
	assert.doesNotMatch(view.lines(60).join("\n"), /Line 39\./);
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

test("a click selects a list row, a double click focuses the detail, the wheel scrolls the pane under the pointer, and footer labels and [×] act", () => {
	const records = [
		record("5636"),
		...Array.from({ length: 12 }, (_, i) => record(`${1000 + i}`)),
	];
	const entries = Array.from({ length: 40 }, (_, i) =>
		assistant(`a${i}`, [{ type: "text", text: `Line ${i}.` }]),
	);
	const view = open(fakeSessions(records, { [records[0].id]: { entries } }), {
		rows: 20,
	});
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
	assert.match(view.lines(120).join("\n"), /Line 39\./);
	assert.deepEqual(view.mouse({ type: "wheel", x: 60, y: 8, wheelDelta: -5 }), {
		handled: true,
	});
	assert.doesNotMatch(view.lines(120).join("\n"), /Line 39\./);

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
	assert.match(view.lines(120).join("\n"), /Line 39\./);

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

test("the final assistant text and the error appear once, in the Result section, and the view opens on the latest finished child", () => {
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
	const sessions = fakeSessions([failed, done], {
		[done.id]: {
			entries: [
				assistant("m1", [{ type: "text", text: "Checking first." }]),
				assistant("m2", [{ type: "text", text: "Waited 60 seconds.  " }]),
			],
		},
		[failed.id]: {
			entries: [
				assistant("m3", [], {
					errorMessage: "provider error",
					stopReason: "error",
				}),
			],
		},
	});
	const view = open(sessions, { rows: 60, latest: true });
	let text = view.lines(120).join("\n");
	assert.match(text, /Checking first\./);
	assert.equal(text.match(/Waited 60 seconds\./g)?.length, 1);
	assert.match(text, / Result ─/);
	view.press("k");
	text = view.lines(120).join("\n");
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
			todo: { id: 3, text: `Wire\x1b the parser ${"and more ".repeat(30)}` },
		}),
	]);
	for (const [rows, width] of [[40, 200], [10, 64]]) {
		const raw = open(sessions, { rows }).raw(width);
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
			todo: { id: 3, text: "Wire the parser" },
		}),
	]);
	const lines = open(sessions, { tasks: [] }).lines(200).join("\n");
	assert.doesNotMatch(lines, /#3|Wire the parser/);
	assert.match(lines, /bash sleep 60/);
});
