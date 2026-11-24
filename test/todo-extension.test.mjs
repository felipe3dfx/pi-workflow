import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { capabilities } from "../extensions/configure.ts";
import {
	occupyAboveInput,
	paintAboveInput,
	registerShell,
	replaceSelection,
	resetPlaces,
} from "../extensions/shell.ts";
import { registerSessionTodo } from "../extensions/todo-extension.ts";
import { densityTerminal } from "./support/density-terminal.mjs";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(
		capabilities.map((capability) => [capability, capability === "todo"]),
	),
	expectations: {},
});

function fakeTheme() {
	return {
		fg: (_color, text) => text,
		bold: (text) => text,
	};
}

function fakePi() {
	const tools = new Map();
	const shortcuts = new Map();
	const handlers = new Map();
	return {
		pi: {
			registerTool(definition) {
				tools.set(definition.name, definition);
			},
			registerShortcut(key, definition) {
				shortcuts.set(key, definition);
			},
			on(event, handler) {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
		},
		tools,
		shortcuts,
		handlers,
	};
}

function fakeCtx({ mode = "tui", branch = [] } = {}) {
	let currentBranch = branch;
	return {
		ctx: {
			mode,
			sessionManager: { getBranch: () => currentBranch },
		},
		setBranch: (next) => {
			currentBranch = next;
		},
	};
}

function todoResultEntry(tasks, { isError = false } = {}) {
	return {
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todo",
			isError,
			details: { tasks },
		},
	};
}

async function execute(tools, action, params, ctx) {
	const tool = tools.get("todo");
	return tool.execute(
		"call-1",
		{ action, ...params },
		undefined,
		undefined,
		ctx ?? fakeCtx().ctx,
	);
}

async function fireEvent(handlers, event, ctx) {
	for (const handler of handlers.get(event) ?? []) {
		await handler({}, ctx);
	}
}

test("the todo tool advertises itself in the system prompt so the model finds it", () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const tool = tools.get("todo");
	assert.match(tool.promptSnippet, /todo/i);
	assert.ok(
		Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length > 0,
	);
	assert.ok(tool.promptGuidelines.some((line) => /todo/i.test(line)));
});

test("the write action description says ids are new and never reused", () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	assert.match(
		tools.get("todo").parameters.properties.action.description,
		/write replaces the whole list with new, increasing ids that are never reused; use the ids it returns/,
	);
});

test("add appends a pending task and reports it", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const result = await execute(tools, "add", {
		text: "Review the doctor output",
	});
	assert.match(result.content[0].text, /Added #1: Review the doctor output/);
	assert.deepEqual(result.details.tasks, [
		{ id: 1, text: "Review the doctor output", state: "pending" },
	]);
});

test("write replaces the whole list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "add", { text: "stale" });
	const result = await execute(tools, "write", {
		tasks: [{ text: "alpha" }, { text: "beta", state: "done" }],
	});
	assert.deepEqual(
		result.details.tasks.map((task) => task.text),
		["alpha", "beta"],
	);
	assert.equal(result.details.tasks[1].state, "done");
});

test("write with an explicit empty tasks array clears the list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "add", { text: "stale" });
	const result = await execute(tools, "write", { tasks: [] });
	assert.deepEqual(result.details.tasks, []);
});

test("write without tasks throws and does not mutate the list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "add", { text: "stale" });
	await assert.rejects(
		() => execute(tools, "write", {}),
		/tasks is required for write/,
	);
	const result = await execute(tools, "list", {});
	assert.deepEqual(result.details.tasks, [
		{ id: 1, text: "stale", state: "pending" },
	]);
});

test("session_start does not replay a write that failed because tasks was omitted", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const branch = [
		todoResultEntry([{ id: 1, text: "kept", state: "pending" }]),
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "todo",
				isError: true,
				details: undefined,
			},
		},
	];
	const { ctx } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	const listed = await execute(tools, "list", {}, ctx);
	assert.deepEqual(listed.details.tasks, [
		{ id: 1, text: "kept", state: "pending" },
	]);
});

test("list reports the current tasks without mutating them", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "add", { text: "alpha" });
	const result = await execute(tools, "list", {});
	assert.match(result.content[0].text, /alpha/);
	assert.equal(result.details.tasks.length, 1);
});

test("update changes an existing task's Task state", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "add", { text: "alpha" });
	const result = await execute(tools, "update", { id: 1, state: "done" });
	assert.match(result.content[0].text, /Updated #1/);
	assert.equal(result.details.tasks[0].state, "done");
});

test("add, write, and update set any Task state, and a task without one is pending", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "write", {
		tasks: [{ text: "alpha" }, { text: "beta", state: "in progress" }],
	});
	const added = await execute(tools, "add", {
		text: "gamma",
		state: "blocked",
	});
	const result = await execute(tools, "update", { id: 1, state: "blocked" });
	assert.deepEqual(added.details.tasks.at(-1), {
		id: 3,
		text: "gamma",
		state: "blocked",
	});
	assert.deepEqual(
		result.details.tasks.map((task) => task.state),
		["blocked", "in progress", "blocked"],
	);
});

test("the todo summary shows each task's Task state", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const written = await execute(tools, "write", {
		tasks: [
			{ text: "alpha" },
			{ text: "beta", state: "in progress" },
			{ text: "gamma", state: "done" },
		],
	});
	const added = await execute(tools, "add", { text: "delta" });
	const updated = await execute(tools, "update", { id: 1, state: "blocked" });
	const listed = await execute(tools, "list", {});
	assert.equal(
		written.content[0].text,
		"[pending] #1: alpha\n[in progress] #2: beta\n[done] #3: gamma",
	);
	assert.equal(
		added.content[0].text,
		"Added #4: delta\n[pending] #1: alpha\n[in progress] #2: beta\n[done] #3: gamma\n[pending] #4: delta",
	);
	assert.equal(
		updated.content[0].text,
		"Updated #1\n[blocked] #1: alpha\n[in progress] #2: beta\n[done] #3: gamma\n[pending] #4: delta",
	);
	assert.equal(
		listed.content[0].text,
		"[blocked] #1: alpha\n[in progress] #2: beta\n[done] #3: gamma\n[pending] #4: delta",
	);
});

test("clear empties the list and the box", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await execute(tools, "add", { text: "alpha" });
	assert.ok(
		paintAboveInput(80, fakeTheme(), 99).some((line) => line.includes("alpha")),
	);
	const result = await execute(tools, "clear", {});
	assert.match(result.content[0].text, /Cleared/);
	assert.deepEqual(result.details.tasks, []);
	assert.deepEqual(paintAboveInput(80, fakeTheme(), 99), []);
});

test("add without text throws instead of returning a disguised error", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await assert.rejects(
		() => execute(tools, "add", {}),
		/text is required for add/,
	);
});

test("update without an id throws instead of returning a disguised error", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await assert.rejects(
		() => execute(tools, "update", { state: "done" }),
		/id is required for update/,
	);
});

test("update with an unknown id throws instead of silently doing nothing", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	await assert.rejects(
		() => execute(tools, "update", { id: 9999, state: "done" }),
		/#9999 not found/,
	);
});

test("the todo tool never writes into the process working directory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-todo-ext-"));
	const originalCwd = process.cwd();
	try {
		process.chdir(dir);
		const before = await readdir(dir);
		const { pi, tools } = fakePi();
		registerSessionTodo(
			pi,
			() => {},
			() => new Map(),
		);
		await execute(tools, "add", { text: "one" });
		await execute(tools, "write", { tasks: [{ text: "two" }] });
		await execute(tools, "update", { id: 2, state: "done" });
		await execute(tools, "clear", {});
		const after = await readdir(dir);
		assert.deepEqual(after, before);
	} finally {
		process.chdir(originalCwd);
		await rm(dir, { recursive: true, force: true });
	}
});

test("alt+shift+t toggles the box open and closed", async () => {
	const { pi, tools, shortcuts } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const { ctx } = fakeCtx({ mode: "tui" });
	await execute(tools, "add", { text: "Review the doctor output" }, ctx);

	const component = {
		render: (width) => paintAboveInput(width, fakeTheme(), 99),
	};
	assert.ok(
		component
			.render(80)
			.some((line) => line.includes("Review the doctor output")),
	);

	await shortcuts.get("alt+shift+t").handler(ctx);
	assert.ok(
		!component
			.render(80)
			.some((line) => line.includes("Review the doctor output")),
	);

	await shortcuts.get("alt+shift+t").handler(ctx);
	assert.ok(
		component
			.render(80)
			.some((line) => line.includes("Review the doctor output")),
	);
});

test("adding a task after collapsing reopens the box", async () => {
	const { pi, tools, shortcuts } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const { ctx } = fakeCtx({ mode: "tui" });
	await execute(tools, "add", { text: "Review the doctor output" }, ctx);
	await shortcuts.get("alt+shift+t").handler(ctx);

	await execute(tools, "add", { text: "Write the list contract" }, ctx);

	const component = {
		render: (width) => paintAboveInput(width, fakeTheme(), 99),
	};
	assert.ok(
		component
			.render(80)
			.some((line) => line.includes("Write the list contract")),
	);
});

test("alt+shift+h hides and re-shows done tasks", async () => {
	const { pi, tools, shortcuts } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const { ctx } = fakeCtx({ mode: "tui" });
	await execute(
		tools,
		"write",
		{ tasks: [{ text: "pending" }, { text: "finished", state: "done" }] },
		ctx,
	);

	const component = {
		render: (width) => paintAboveInput(width, fakeTheme(), 99),
	};
	assert.ok(component.render(80).some((line) => line.includes("finished")));

	await shortcuts.get("alt+shift+h").handler(ctx);
	assert.ok(!component.render(80).some((line) => line.includes("finished")));

	await shortcuts.get("alt+shift+h").handler(ctx);
	assert.ok(component.render(80).some((line) => line.includes("finished")));
});

test("session_start rebuilds the list from the last todo tool result on the branch", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const branch = [
		todoResultEntry([{ id: 1, text: "old", state: "pending" }]),
		todoResultEntry([
			{ id: 1, text: "old", state: "pending" },
			{ id: 2, text: "recent", state: "pending" },
		]),
	];
	const { ctx } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	const lines = paintAboveInput(80, fakeTheme(), 99);
	assert.ok(lines.some((line) => line.includes("old")));
	assert.ok(lines.some((line) => line.includes("recent")));

	const added = await execute(tools, "add", { text: "brand new" }, ctx);
	assert.equal(added.details.tasks.at(-1).id, 3);
});

test("session_start ignores a failed todo tool result", async () => {
	const { pi, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const branch = [
		todoResultEntry([{ id: 1, text: "kept", state: "pending" }]),
		todoResultEntry([{ id: 2, text: "should be ignored", state: "pending" }], {
			isError: true,
		}),
	];
	const { ctx } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	const lines = paintAboveInput(80, fakeTheme(), 99);
	assert.ok(lines.some((line) => line.includes("kept")));
	assert.ok(!lines.some((line) => line.includes("should be ignored")));
});

test("session_start starts empty when the restored list has no open tasks", async () => {
	const { pi, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const branch = [
		todoResultEntry([{ id: 1, text: "finished", state: "done" }]),
	];
	const { ctx } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	assert.deepEqual(paintAboveInput(80, fakeTheme(), 99), []);
});

test("session_start restores each task's Task state when the list still has unfinished tasks", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const restored = [
		{ id: 1, text: "finished", state: "done" },
		{ id: 2, text: "stuck", state: "blocked" },
		{ id: 3, text: "working", state: "in progress" },
	];
	const { ctx } = fakeCtx({ mode: "tui", branch: [todoResultEntry(restored)] });
	await fireEvent(handlers, "session_start", ctx);

	const listed = await execute(tools, "list", {}, ctx);
	assert.equal(
		listed.content[0].text,
		"[done] #1: finished\n[blocked] #2: stuck\n[in progress] #3: working",
	);
	const row = (text) =>
		paintAboveInput(80, fakeTheme(), 99).find((line) => line.includes(text));
	assert.ok(row("stuck").includes("! stuck"));
	assert.ok(row("working").includes("◐ working"));
});

test("session_start drops restored tasks without a known Task state instead of crashing the box", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const restored = [
		{ id: 1, text: "legacy", done: false },
		{ id: 2, text: "current", state: "pending" },
	];
	const { ctx } = fakeCtx({ mode: "tui", branch: [todoResultEntry(restored)] });
	await fireEvent(handlers, "session_start", ctx);

	const listed = await execute(tools, "list", {}, ctx);
	assert.equal(listed.content[0].text, "[pending] #2: current");
	const painted = paintAboveInput(80, fakeTheme(), 99);
	assert.ok(painted.some((line) => line.includes("□ current")));
	assert.ok(!painted.some((line) => line.includes("legacy")));
});

test("session_start restores the latest list whether a todo tool result or a harness entry wrote it", async () => {
	const harness = (tasks) => ({
		type: "custom",
		customType: "pi-workflow-todo",
		data: { tasks },
	});
	const fromTool = [{ id: 1, text: "from the tool", state: "pending" }];
	const fromHarness = [
		{ id: 1, text: "from the harness", state: "in progress" },
	];
	for (const [branch, expected] of [
		[
			[todoResultEntry(fromTool), harness(fromHarness)],
			"[in progress] #1: from the harness",
		],
		[
			[harness(fromHarness), todoResultEntry(fromTool)],
			"[pending] #1: from the tool",
		],
	]) {
		const { pi, tools, handlers } = fakePi();
		registerSessionTodo(
			pi,
			() => {},
			() => new Map(),
		);
		const { ctx } = fakeCtx({ mode: "tui", branch });
		await fireEvent(handlers, "session_start", ctx);

		assert.equal(
			(await execute(tools, "list", {}, ctx)).content[0].text,
			expected,
		);
	}
});

test("a Task state the harness sets redraws the box", async () => {
	const { pi, tools } = fakePi();
	pi.appendEntry = () => {};
	let redraws = 0;
	const { set } = registerSessionTodo(
		pi,
		() => redraws++,
		() => new Map(),
	);
	await execute(tools, "add", { text: "Fix the parser" });
	const before = redraws;

	set(1, "blocked");
	assert.equal(redraws, before + 1);
	assert.ok(
		paintAboveInput(80, fakeTheme(), 99).some((line) =>
			line.includes("! Fix the parser"),
		),
	);
});

test("session_tree rebuilds the list from the tree's branch, like session_start does", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);
	const { ctx, setBranch } = fakeCtx({
		mode: "tui",
		branch: [
			todoResultEntry([{ id: 1, text: "on the old branch", state: "pending" }]),
		],
	});
	await fireEvent(handlers, "session_start", ctx);

	setBranch([
		todoResultEntry([{ id: 7, text: "on the tree branch", state: "pending" }]),
	]);
	await fireEvent(handlers, "session_tree", ctx);

	const lines = paintAboveInput(80, fakeTheme(), 99);
	assert.ok(lines.some((line) => line.includes("on the tree branch")));
	assert.ok(!lines.some((line) => line.includes("on the old branch")));

	const listed = await execute(tools, "list", {}, ctx);
	assert.match(listed.content[0].text, /on the tree branch/);
	assert.doesNotMatch(listed.content[0].text, /on the old branch/);
});

test("the returned todo offer exposes the tool only while todo is seated", () => {
	const { pi, tools } = fakePi();
	const { offer } = registerSessionTodo(
		pi,
		() => {},
		() => new Map(),
	);

	offer();
	assert.equal(tools.get("todo").exposure, "direct");

	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((capability) => [capability, false]),
		),
		expectations: {},
	});
	try {
		offer();
		assert.equal(tools.get("todo").exposure, "hidden");
	} finally {
		replaceSelection({
			schemaVersion: 1,
			capabilities: Object.fromEntries(
				capabilities.map((capability) => [capability, capability === "todo"]),
			),
			expectations: {},
		});
	}
});

test("actual shell widget routes the rendered close and reopen cells without mutating tasks", async (t) => {
	t.after(resetPlaces);
	const { pi, tools, handlers } = fakePi();
	const shell = registerShell(pi);
	registerSessionTodo(pi, shell.requestAboveInputRender, () => new Map());
	let factory;
	const ctx = {
		...fakeCtx().ctx,
		ui: {
			setWidget: (_key, make) => {
				factory = make;
			},
		},
	};
	await fireEvent(handlers, "session_start", ctx);
	const tui = { terminal: { rows: 39 }, requestRender() {} };
	const widget = factory(tui, fakeTheme());
	await execute(tools, "write", { tasks: [{ text: "kept" }] }, ctx);
	let lines = widget.render(40);
	const event = (x, y) => ({
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 40,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
	});
	assert.equal(widget.handleMouse(event(39, 1))?.handled, true);
	lines = widget.render(40);
	assert.match(lines[0], /collapsed/);
	assert.equal(widget.handleMouse(event(0, 0))?.handled, true);
	lines = widget.render(40);
	assert.ok(lines.some((line) => line.includes("kept")));
	assert.equal((await execute(tools, "list", {}, ctx)).details.tasks.length, 1);
});

test("height-only resize invalidates old hits; paging clamps only after expansion", async (t) => {
	t.after(resetPlaces);
	const { pi, tools, handlers, shortcuts } = fakePi();
	const shell = registerShell(pi);
	registerSessionTodo(pi, shell.requestAboveInputRender, () => new Map());
	let factory;
	const ctx = {
		...fakeCtx().ctx,
		ui: {
			setWidget: (_key, make) => {
				factory = make;
			},
		},
	};
	await fireEvent(handlers, "session_start", ctx);
	const tui = { terminal: { rows: 18 }, requestRender() {} };
	const widget = factory(tui, fakeTheme());
	await execute(
		tools,
		"write",
		{ tasks: Array.from({ length: 9 }, (_, i) => ({ text: `Task ${i + 1}` })) },
		ctx,
	);
	let lines = widget.render(80);
	for (let i = 0; i < 6; i++) {
		await shortcuts.get("alt+shift+n").handler(ctx);
		lines = widget.render(80);
	}
	assert.ok(lines.some((line) => line.includes("Task 7")));
	const click = (x, y) => ({
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 80,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
	});
	tui.terminal.rows = 17;
	assert.equal(widget.handleMouse(click(79, 1)), undefined);
	lines = widget.render(80);
	assert.equal(lines.length, 1);
	tui.terminal.rows = 39;
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("Task 9")));
	tui.terminal.rows = 18;
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("Task 2")));
});

test("a fresh frame handles filter and page clicks like keyboard and isolates the child panel", async (t) => {
	t.after(() => {
		resetPlaces();
		replaceSelection({
			schemaVersion: 1,
			capabilities: Object.fromEntries(
				capabilities.map((c) => [c, c === "todo"]),
			),
			expectations: {},
		});
	});
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((c) => [c, c === "todo" || c === "child-session"]),
		),
		expectations: {},
	});
	occupyAboveInput("child-session", () => ["child one", "child two"]);
	const { pi, tools, handlers, shortcuts } = fakePi();
	const shell = registerShell(pi);
	registerSessionTodo(pi, shell.requestAboveInputRender, () => new Map());
	let factory;
	const ctx = {
		...fakeCtx().ctx,
		ui: {
			setWidget: (_key, make) => {
				factory = make;
			},
		},
	};
	await fireEvent(handlers, "session_start", ctx);
	const tui = { terminal: { rows: 18 }, requestRender() {} };
	const widget = factory(tui, fakeTheme());
	await execute(
		tools,
		"write",
		{ tasks: [{ text: "界 pending" }, { text: "done", state: "done" }] },
		ctx,
	);
	let lines = widget.render(80);
	const click = (x, y, overrides = {}) =>
		widget.handleMouse({
			type: "click",
			button: "left",
			x,
			y,
			screenX: x,
			screenY: y,
			width: 80,
			height: lines.length,
			shift: false,
			alt: false,
			ctrl: false,
			...overrides,
		});
	assert.equal(click(0, 0), undefined);
	assert.equal(click(79, 3, { type: "press" }), undefined);
	let control = lines.findIndex((line) => line.includes("Without done"));
	assert.equal(click(lines[control].indexOf("›"), control)?.handled, true);
	assert.equal(click(lines[control].indexOf("›"), control), undefined);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("✓ done")));
	control = lines.findIndex((line) => line.includes("Without done"));
	assert.equal(click(lines[control].indexOf("‹"), control)?.handled, true);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("界 pending")));
	assert.ok(!lines.some((line) => line.includes("✓ done")));
	control = lines.findIndex((line) => line.includes("Without done"));
	assert.equal(click(lines[control].indexOf("›"), control)?.handled, true);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("✓ done")));
	await shortcuts.get("alt+shift+p").handler(ctx);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("界 pending")));
	assert.ok(!lines.some((line) => line.includes("✓ done")));
	control = lines.findIndex((line) => line.includes("Without done"));
	assert.equal(
		click(lines[control].indexOf("Without done"), control)?.handled,
		true,
	);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("界 pending")));
	assert.ok(!lines.some((line) => line.includes("✓ done")));
	await shortcuts.get("alt+shift+h").handler(ctx);
	lines = widget.render(80);
	assert.match(
		lines.find((line) => line.includes("Without done")),
		/2\/2 All/,
	);
});

test("filtered empty stays reversible, and stale hits cannot survive reseating or session changes", async (t) => {
	const selection = (enabled) => ({
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((c) => [c, c === "todo" && enabled]),
		),
		expectations: {},
	});
	t.after(() => {
		resetPlaces();
		replaceSelection(selection(true));
	});
	const { pi, tools, handlers, shortcuts } = fakePi();
	const shell = registerShell(pi);
	registerSessionTodo(pi, shell.requestAboveInputRender, () => new Map());
	let factory;
	const ctx = {
		...fakeCtx().ctx,
		ui: {
			setWidget: (_key, make) => {
				factory = make;
			},
		},
	};
	await fireEvent(handlers, "session_start", ctx);
	const tui = { terminal: { rows: 18 }, requestRender() {} };
	const widget = factory(tui, fakeTheme());
	await execute(
		tools,
		"write",
		{ tasks: [{ text: "done 界", state: "done" }] },
		ctx,
	);
	let lines = widget.render(80);
	await shortcuts.get("alt+shift+h").handler(ctx);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("0/1 Without done")));
	const y = lines.findIndex((line) => line.includes("0/1"));
	const x = lines[y].indexOf(" All");
	const event = {
		type: "click",
		button: "left",
		x: x + 1,
		y,
		screenX: x + 1,
		screenY: y,
		width: 80,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
	};
	assert.equal(widget.handleMouse(event)?.handled, true);
	lines = widget.render(80);
	assert.ok(lines.some((line) => line.includes("done 界")));
	replaceSelection(selection(false));
	replaceSelection(selection(true));
	assert.equal(widget.handleMouse({ ...event, x: 79, y: 1 }), undefined);
	lines = widget.render(1);
	assert.equal(
		widget.handleMouse({
			...event,
			width: 1,
			x: 0,
			y: 1,
			height: lines.length,
		}),
		undefined,
	);
	lines = widget.render(80);
	await fireEvent(handlers, "session_start", ctx);
	assert.equal(widget.handleMouse({ ...event, x: 79, y: 1 }), undefined);
});

test("below 60 terminal columns a tap on the ▾ Todo heading collapses it like Alt+Shift+T, and its page and collapse survive crossing 60 columns both ways", async (t) => {
	t.after(resetPlaces);
	const terminal = densityTerminal(t, 44);
	const { pi, tools, handlers, shortcuts } = fakePi();
	const shell = registerShell(pi);
	registerSessionTodo(pi, shell.requestAboveInputRender, () => new Map());
	let factory;
	const ctx = {
		...fakeCtx().ctx,
		ui: {
			setWidget: (_key, make) => {
				factory = make;
			},
		},
	};
	await fireEvent(handlers, "session_start", ctx);
	const tui = { terminal: { rows: 31 }, requestRender() {} };
	const widget = factory(tui, fakeTheme());
	await execute(
		tools,
		"write",
		{
			tasks: Array.from({ length: 12 }, (_, i) => ({ text: `Task ${i + 1}` })),
		},
		ctx,
	);
	let lines = widget.render(44);
	const tap = (x, y) => ({
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 44,
		height: lines.length,
		shift: false,
		alt: false,
		ctrl: false,
	});
	assert.equal(lines[0], `▾ Todo 0/12${" ".repeat(22)}Alt+Shift+T`);
	assert.equal(lines[9], "12/12 All 1/2 ‹ › Without done");
	assert.equal(widget.handleMouse(tap(16, 9))?.handled, true);
	lines = widget.render(44);
	assert.equal(lines[1], "○ Task 9");
	assert.equal(widget.handleMouse(tap(0, 1)), undefined);
	assert.equal(widget.handleMouse(tap(0, 0))?.handled, true);
	lines = widget.render(44);
	assert.deepEqual(lines, ["session tasks collapsed"]);

	terminal.columns = 60;
	assert.deepEqual(widget.render(60), ["session tasks collapsed"]);
	await shortcuts.get("alt+shift+t").handler(ctx);
	lines = widget.render(60);
	assert.equal(lines[1], `┌${" ".repeat(58)}×`);
	assert.equal(lines[2], `│ □ Task 6${" ".repeat(49)}│`);

	terminal.columns = 59;
	lines = widget.render(59);
	assert.equal(lines[0], `▾ Todo 0/12${" ".repeat(37)}Alt+Shift+T`);
	assert.equal(lines[1], "○ Task 9");
	await shortcuts.get("alt+shift+t").handler(ctx);
	assert.deepEqual(widget.render(59), ["session tasks collapsed"]);
	await shortcuts.get("alt+shift+t").handler(ctx);
	assert.equal(widget.render(59)[1], "○ Task 9");
	assert.equal(
		(await execute(tools, "list", {}, ctx)).details.tasks.length,
		12,
	);

	// A width-only crossing keeps the browsing position on the final wide page.
	terminal.columns = 60;
	widget.render(60);
	await shortcuts.get("alt+shift+n").handler(ctx);
	const finalPage = () => {
		const wide = widget.render(60);
		return [wide[2], wide.find((line) => line.includes("/3 "))];
	};
	const before = finalPage();
	assert.equal(before[0], `│ □ Task 11${" ".repeat(48)}│`);
	assert.match(before[1], / 3\/3 /);
	for (const columns of [43, 59]) {
		terminal.columns = columns;
		assert.equal(widget.render(columns)[1], "○ Task 9");
		terminal.columns = 60;
		assert.deepEqual(finalPage(), before);
	}
});

async function pagedTodo(t, columns, count) {
	t.after(resetPlaces);
	const terminal = densityTerminal(t, columns);
	const { pi, tools, handlers, shortcuts } = fakePi();
	const shell = registerShell(pi);
	registerSessionTodo(pi, shell.requestAboveInputRender, () => new Map());
	let factory;
	const ctx = {
		...fakeCtx().ctx,
		ui: {
			setWidget: (_key, make) => {
				factory = make;
			},
		},
	};
	await fireEvent(handlers, "session_start", ctx);
	const tui = { terminal: { rows: 31 }, requestRender() {} };
	const widget = factory(tui, fakeTheme());
	const tasks = Array.from({ length: count }, (_, i) => ({
		text: `Task ${i + 1}`,
	}));
	await execute(tools, "write", { tasks }, ctx);
	const view = () => {
		const lines = widget.render(terminal.columns);
		return {
			lines,
			first: lines.map((line) => line.match(/Task \d+/)?.[0]).find(Boolean),
			page: lines
				.map((line) => line.match(/(?:All|Without done) (\d+\/\d+)/)?.[1])
				.find(Boolean),
		};
	};
	const next = () => shortcuts.get("alt+shift+n").handler(ctx);
	const withoutDone = () => shortcuts.get("alt+shift+h").handler(ctx);
	const done = (id) => execute(tools, "update", { id, state: "done" }, ctx);
	return { terminal, tui, widget, view, next, withoutDone, done };
}

test("below 60 columns a height change that keeps the Todo capacity keeps the projected page", async (t) => {
	const { terminal, tui, view, next } = await pagedTodo(t, 60, 20);
	view();
	await next();
	view();
	await next();
	assert.deepEqual([view().first, view().page], ["Task 11", "3/4"]);
	terminal.columns = 43;
	assert.deepEqual([view().first, view().page], ["Task 9", "2/3"]);
	tui.terminal.rows = 32;
	assert.deepEqual([view().first, view().page], ["Task 9", "2/3"]);
	tui.terminal.rows = 31;
	assert.deepEqual([view().first, view().page], ["Task 9", "2/3"]);
	terminal.columns = 60;
	assert.deepEqual([view().first, view().page], ["Task 11", "3/4"]);
});

test("below 60 columns a height round trip that changes the Todo capacity keeps the wide page to return to", async (t) => {
	const { terminal, tui, view, next } = await pagedTodo(t, 60, 20);
	view();
	await next();
	view();
	await next();
	assert.deepEqual([view().first, view().page], ["Task 11", "3/4"]);
	for (const columns of [43, 59]) {
		terminal.columns = columns;
		assert.deepEqual([view().first, view().page], ["Task 9", "2/3"]);
		tui.terminal.rows = 29;
		assert.deepEqual([view().first, view().page], ["Task 8", "2/3"]);
		tui.terminal.rows = 31;
		assert.deepEqual([view().first, view().page], ["Task 9", "2/3"]);
		terminal.columns = 60;
		assert.deepEqual([view().first, view().page], ["Task 11", "3/4"]);
	}
});

test("below 60 columns a saved offset whose task leaves a partial page returns to that page's first task", async (t) => {
	for (const columns of [43, 59]) {
		const { terminal, tui, view, next, withoutDone, done } = await pagedTodo(
			t,
			columns,
			15,
		);
		tui.terminal.rows = 29;
		await withoutDone();
		view();
		await next();
		view();
		await next();
		assert.deepEqual([view().first, view().page], ["Task 15", "3/3"]);
		tui.terminal.rows = 31;
		assert.deepEqual([view().first, view().page], ["Task 9", "2/2"]);
		await done(15);
		assert.deepEqual([view().first, view().page], ["Task 9", "2/2"]);
		terminal.columns = 60;
		assert.deepEqual([view().first, view().page], ["Task 6", "2/3"]);
	}
});

test("a Next that cannot leave the last narrow page keeps the wide page to return to", async (t) => {
	const { terminal, widget, view, next } = await pagedTodo(t, 60, 12);
	view();
	await next();
	view();
	await next();
	assert.deepEqual([view().first, view().page], ["Task 11", "3/3"]);
	for (const columns of [43, 59]) {
		terminal.columns = columns;
		const { lines, first, page } = view();
		assert.deepEqual([first, page], ["Task 9", "2/2"]);
		const row = lines.findIndex((line) => line.includes("‹ ›"));
		const x = lines[row].indexOf("›");
		assert.equal(
			widget.handleMouse({
				type: "click",
				button: "left",
				x,
				y: row,
				screenX: x,
				screenY: row,
				width: columns,
				height: lines.length,
				shift: false,
				alt: false,
				ctrl: false,
			})?.handled,
			true,
		);
		assert.deepEqual([view().first, view().page], ["Task 9", "2/2"]);
		await next();
		assert.deepEqual([view().first, view().page], ["Task 9", "2/2"]);
		terminal.columns = 60;
		assert.deepEqual([view().first, view().page], ["Task 11", "3/3"]);
	}
});

test("two Next shortcuts before one render advance two Todo pages at narrow and wide sizes", async (t) => {
	for (const [columns, expected] of [
		[43, ["Task 17", "3/4"]],
		[59, ["Task 17", "3/4"]],
		[60, ["Task 11", "3/5"]],
		[100, ["Task 11", "3/5"]],
	]) {
		const { view, next } = await pagedTodo(t, columns, 25);
		assert.equal(view().page, columns < 60 ? "1/4" : "1/5");
		await next();
		await next();
		assert.deepEqual([view().first, view().page], expected, `${columns}`);
	}
});
