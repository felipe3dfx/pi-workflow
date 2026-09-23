import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerSessionTodo } from "../extensions/todo-extension.ts";

function fakeTheme() {
	return {
		fg: (_color, text) => text,
		bold: (text) => text,
	};
}

function fakeTui() {
	let renders = 0;
	return {
		tui: { requestRender: () => renders++ },
		renderCount: () => renders,
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
	let headerFactory;
	let headerCalls = 0;
	let currentBranch = branch;
	return {
		ctx: {
			mode,
			ui: {
				setHeader: (factory) => {
					headerFactory = factory;
					headerCalls += 1;
				},
			},
			sessionManager: { getBranch: () => currentBranch },
		},
		getHeaderFactory: () => headerFactory,
		headerCallCount: () => headerCalls,
		setBranch: (next) => {
			currentBranch = next;
		},
	};
}

function todoResultEntry(tasks, { isError = false } = {}) {
	return {
		type: "message",
		message: { role: "toolResult", toolName: "todo", isError, details: { tasks } },
	};
}

async function execute(tools, action, params, ctx) {
	const tool = tools.get("todo");
	return tool.execute("call-1", { action, ...params }, undefined, undefined, ctx ?? fakeCtx().ctx);
}

async function fireEvent(handlers, event, ctx) {
	for (const handler of handlers.get(event) ?? []) {
		await handler({}, ctx);
	}
}

test("add appends a pending task and reports it", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	const result = await execute(tools, "add", { text: "Review the doctor output" });
	assert.match(result.content[0].text, /Added #1: Review the doctor output/);
	assert.deepEqual(result.details.tasks, [{ id: 1, text: "Review the doctor output", done: false }]);
});

test("write replaces the whole list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await execute(tools, "add", { text: "stale" });
	const result = await execute(tools, "write", { tasks: [{ text: "alpha" }, { text: "beta", done: true }] });
	assert.deepEqual(
		result.details.tasks.map((task) => task.text),
		["alpha", "beta"],
	);
	assert.equal(result.details.tasks[1].done, true);
});

test("write with an explicit empty tasks array clears the list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await execute(tools, "add", { text: "stale" });
	const result = await execute(tools, "write", { tasks: [] });
	assert.deepEqual(result.details.tasks, []);
});

test("write without tasks throws and does not mutate the list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await execute(tools, "add", { text: "stale" });
	await assert.rejects(() => execute(tools, "write", {}), /tasks is required for write/);
	const result = await execute(tools, "list", {});
	assert.deepEqual(result.details.tasks, [{ id: 1, text: "stale", done: false }]);
});

test("session_start does not replay a write that failed because tasks was omitted", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(pi);
	const branch = [
		todoResultEntry([{ id: 1, text: "kept", done: false }]),
		{ type: "message", message: { role: "toolResult", toolName: "todo", isError: true, details: undefined } },
	];
	const { ctx } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	const listed = await execute(tools, "list", {}, ctx);
	assert.deepEqual(listed.details.tasks, [{ id: 1, text: "kept", done: false }]);
});

test("list reports the current tasks without mutating them", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await execute(tools, "add", { text: "alpha" });
	const result = await execute(tools, "list", {});
	assert.match(result.content[0].text, /alpha/);
	assert.equal(result.details.tasks.length, 1);
});

test("update changes an existing task's done flag", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await execute(tools, "add", { text: "alpha" });
	const result = await execute(tools, "update", { id: 1, done: true });
	assert.match(result.content[0].text, /Updated #1/);
	assert.equal(result.details.tasks[0].done, true);
});

test("clear empties the list", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await execute(tools, "add", { text: "alpha" });
	const result = await execute(tools, "clear", {});
	assert.match(result.content[0].text, /Cleared/);
	assert.deepEqual(result.details.tasks, []);
});

test("add without text throws instead of returning a disguised error", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await assert.rejects(() => execute(tools, "add", {}), /text is required for add/);
});

test("update without an id throws instead of returning a disguised error", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await assert.rejects(() => execute(tools, "update", { done: true }), /id is required for update/);
});

test("update with an unknown id throws instead of silently doing nothing", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	await assert.rejects(() => execute(tools, "update", { id: 9999, done: true }), /#9999 not found/);
});

test("the todo tool never writes into the process working directory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-todo-ext-"));
	const originalCwd = process.cwd();
	try {
		process.chdir(dir);
		const before = await readdir(dir);
		const { pi, tools } = fakePi();
		registerSessionTodo(pi);
		await execute(tools, "add", { text: "one" });
		await execute(tools, "write", { tasks: [{ text: "two" }] });
		await execute(tools, "update", { id: 2, done: true });
		await execute(tools, "clear", {});
		const after = await readdir(dir);
		assert.deepEqual(after, before);
	} finally {
		process.chdir(originalCwd);
		await rm(dir, { recursive: true, force: true });
	}
});

test("in tui mode, the header is installed only once a task exists", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	const { ctx, getHeaderFactory, headerCallCount } = fakeCtx({ mode: "tui" });

	assert.equal(headerCallCount(), 0);
	await execute(tools, "add", { text: "Review the doctor output" }, ctx);
	assert.equal(headerCallCount(), 1);
	assert.ok(getHeaderFactory());

	const { tui } = fakeTui();
	const lines = getHeaderFactory()(tui, fakeTheme()).render(80);
	assert.ok(lines.some((line) => line.includes("Review the doctor output")));
});

test("in tui mode, the built-in header is restored once the list empties", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	const { ctx, getHeaderFactory, headerCallCount } = fakeCtx({ mode: "tui" });

	await execute(tools, "add", { text: "Review the doctor output" }, ctx);
	assert.equal(headerCallCount(), 1);

	await execute(tools, "clear", {}, ctx);
	assert.equal(headerCallCount(), 2);
	assert.equal(getHeaderFactory(), undefined);
});

test("outside tui mode, executing the tool never touches the header", async () => {
	const { pi, tools } = fakePi();
	registerSessionTodo(pi);
	const { ctx, headerCallCount } = fakeCtx({ mode: "print" });
	await execute(tools, "add", { text: "Review the doctor output" }, ctx);
	assert.equal(headerCallCount(), 0);
});

test("alt+shift+t toggles the box open and closed", async () => {
	const { pi, tools, shortcuts } = fakePi();
	registerSessionTodo(pi);
	const { ctx, getHeaderFactory } = fakeCtx({ mode: "tui" });
	await execute(tools, "add", { text: "Review the doctor output" }, ctx);

	const { tui } = fakeTui();
	const component = getHeaderFactory()(tui, fakeTheme());
	assert.ok(component.render(80).some((line) => line.includes("Review the doctor output")));

	await shortcuts.get("alt+shift+t").handler(ctx);
	assert.ok(!component.render(80).some((line) => line.includes("Review the doctor output")));

	await shortcuts.get("alt+shift+t").handler(ctx);
	assert.ok(component.render(80).some((line) => line.includes("Review the doctor output")));
});

test("adding a task after collapsing reopens the box", async () => {
	const { pi, tools, shortcuts } = fakePi();
	registerSessionTodo(pi);
	const { ctx, getHeaderFactory } = fakeCtx({ mode: "tui" });
	await execute(tools, "add", { text: "Review the doctor output" }, ctx);
	await shortcuts.get("alt+shift+t").handler(ctx);

	await execute(tools, "add", { text: "Write the list contract" }, ctx);

	const { tui } = fakeTui();
	const component = getHeaderFactory()(tui, fakeTheme());
	assert.ok(component.render(80).some((line) => line.includes("Write the list contract")));
});

test("alt+shift+h hides and re-shows done tasks", async () => {
	const { pi, tools, shortcuts } = fakePi();
	registerSessionTodo(pi);
	const { ctx, getHeaderFactory } = fakeCtx({ mode: "tui" });
	await execute(tools, "write", { tasks: [{ text: "pending" }, { text: "finished", done: true }] }, ctx);

	const { tui } = fakeTui();
	const component = getHeaderFactory()(tui, fakeTheme());
	assert.ok(component.render(80).some((line) => line.includes("finished")));

	await shortcuts.get("alt+shift+h").handler(ctx);
	assert.ok(!component.render(80).some((line) => line.includes("finished")));

	await shortcuts.get("alt+shift+h").handler(ctx);
	assert.ok(component.render(80).some((line) => line.includes("finished")));
});

test("session_start rebuilds the list from the last todo tool result on the branch", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(pi);
	const branch = [
		todoResultEntry([{ id: 1, text: "old", done: false }]),
		todoResultEntry([
			{ id: 1, text: "old", done: false },
			{ id: 2, text: "recent", done: false },
		]),
	];
	const { ctx, getHeaderFactory } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	const { tui } = fakeTui();
	const lines = getHeaderFactory()(tui, fakeTheme()).render(80);
	assert.ok(lines.some((line) => line.includes("old")));
	assert.ok(lines.some((line) => line.includes("recent")));

	const added = await execute(tools, "add", { text: "brand new" }, ctx);
	assert.equal(added.details.tasks.at(-1).id, 3);
});

test("session_start ignores a failed todo tool result", async () => {
	const { pi, handlers } = fakePi();
	registerSessionTodo(pi);
	const branch = [
		todoResultEntry([{ id: 1, text: "kept", done: false }]),
		todoResultEntry([{ id: 2, text: "should be ignored", done: false }], { isError: true }),
	];
	const { ctx, getHeaderFactory } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	const { tui } = fakeTui();
	const lines = getHeaderFactory()(tui, fakeTheme()).render(80);
	assert.ok(lines.some((line) => line.includes("kept")));
	assert.ok(!lines.some((line) => line.includes("should be ignored")));
});

test("session_start starts empty when the restored list has no open tasks", async () => {
	const { pi, handlers } = fakePi();
	registerSessionTodo(pi);
	const branch = [todoResultEntry([{ id: 1, text: "finished", done: true }])];
	const { ctx, getHeaderFactory, headerCallCount } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	assert.equal(headerCallCount(), 0);
	assert.equal(getHeaderFactory(), undefined);
});

test("session_start header sync installs the header when the restored list has open tasks", async () => {
	const { pi, handlers } = fakePi();
	registerSessionTodo(pi);
	const branch = [todoResultEntry([{ id: 1, text: "still open", done: false }])];
	const { ctx, getHeaderFactory, headerCallCount } = fakeCtx({ mode: "tui", branch });
	await fireEvent(handlers, "session_start", ctx);

	assert.equal(headerCallCount(), 1);
	assert.ok(getHeaderFactory());
});

test("session_tree rebuilds the list from the tree's branch, like session_start does", async () => {
	const { pi, tools, handlers } = fakePi();
	registerSessionTodo(pi);
	const { ctx, getHeaderFactory, setBranch } = fakeCtx({
		mode: "tui",
		branch: [todoResultEntry([{ id: 1, text: "on the old branch", done: false }])],
	});
	await fireEvent(handlers, "session_start", ctx);

	setBranch([todoResultEntry([{ id: 7, text: "on the tree branch", done: false }])]);
	await fireEvent(handlers, "session_tree", ctx);

	const { tui } = fakeTui();
	const lines = getHeaderFactory()(tui, fakeTheme()).render(80);
	assert.ok(lines.some((line) => line.includes("on the tree branch")));
	assert.ok(!lines.some((line) => line.includes("on the old branch")));

	const listed = await execute(tools, "list", {}, ctx);
	assert.match(listed.content[0].text, /on the tree branch/);
	assert.doesNotMatch(listed.content[0].text, /on the old branch/);
});
