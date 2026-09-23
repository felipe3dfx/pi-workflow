import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { renderTodoBox, type TodoBoxState } from "./todo-header.ts";
import { createTodoList, type Task } from "./todo-list.ts";

const TodoWriteTask = Type.Object({
	text: Type.String({ description: "Task text" }),
	done: Type.Optional(Type.Boolean({ description: "Whether the task is already done" })),
});

const TodoParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("write"),
			Type.Literal("add"),
			Type.Literal("update"),
			Type.Literal("clear"),
			Type.Literal("list"),
		],
		{
			description:
				"write replaces the whole list; add appends one task; update changes one task; clear empties the list; list reads it",
		},
	),
	tasks: Type.Optional(Type.Array(TodoWriteTask, { description: "The whole list, for action write" })),
	text: Type.Optional(Type.String({ description: "Task text, for action add or update" })),
	id: Type.Optional(Type.Number({ description: "Task id, for action update" })),
	done: Type.Optional(Type.Boolean({ description: "Done flag, for action update" })),
});

function summarize(tasks: Task[]): string {
	if (tasks.length === 0) return "No session tasks";
	return tasks.map((task) => `[${task.done ? "x" : " "}] #${task.id}: ${task.text}`).join("\n");
}

function replayTasks(entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): Task[] {
	let tasks: Task[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== "todo" || message.isError) continue;
		const details = message.details as { tasks?: Task[] } | undefined;
		if (details && Array.isArray(details.tasks)) tasks = details.tasks;
	}
	return tasks.length > 0 && tasks.every((task) => task.done) ? [] : tasks;
}

export function registerSessionTodo(pi: ExtensionAPI): void {
	const todoList = createTodoList();
	const boxState: TodoBoxState = { collapsed: false, showDone: true };
	let currentTui: { requestRender: (force?: boolean) => void } | undefined;
	let headerInstalled = false;

	function headerFactory(tui: { requestRender: (force?: boolean) => void }, theme: Theme) {
		currentTui = tui;
		return {
			render(width: number) {
				return renderTodoBox(theme, todoList.list(), boxState, width);
			},
			invalidate() {},
		};
	}

	function reveal(): void {
		boxState.collapsed = false;
		currentTui?.requestRender();
	}

	function syncHeader(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		const hasTasks = todoList.list().length > 0;
		if (hasTasks && !headerInstalled) {
			ctx.ui.setHeader(headerFactory);
			headerInstalled = true;
		} else if (!hasTasks && headerInstalled) {
			ctx.ui.setHeader(undefined);
			headerInstalled = false;
		}
	}

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Manage the current session's task list, shown in the header. Actions: write (replace the whole list), add, update, clear, list. Session-scoped only; never creates a file.",
		parameters: TodoParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "write": {
					if (params.tasks === undefined) {
						throw new Error("tasks is required for write");
					}
					const tasks = todoList.write(params.tasks);
					reveal();
					syncHeader(ctx);
					return { content: [{ type: "text", text: summarize(tasks) }], details: { tasks } };
				}
				case "add": {
					if (!params.text) {
						throw new Error("text is required for add");
					}
					const task = todoList.add(params.text);
					reveal();
					syncHeader(ctx);
					return {
						content: [{ type: "text", text: `Added #${task.id}: ${task.text}` }],
						details: { tasks: todoList.list() },
					};
				}
				case "update": {
					if (params.id === undefined) {
						throw new Error("id is required for update");
					}
					const task = todoList.update(params.id, { text: params.text, done: params.done });
					if (!task) {
						throw new Error(`task #${params.id} not found`);
					}
					reveal();
					syncHeader(ctx);
					return { content: [{ type: "text", text: `Updated #${task.id}` }], details: { tasks: todoList.list() } };
				}
				case "clear": {
					todoList.clear();
					reveal();
					syncHeader(ctx);
					return { content: [{ type: "text", text: "Cleared session tasks" }], details: { tasks: [] } };
				}
				case "list":
					return {
						content: [{ type: "text", text: summarize(todoList.list()) }],
						details: { tasks: todoList.list() },
					};
			}
		},
	});

	pi.registerShortcut("alt+shift+t", {
		description: "Collapse or expand the session task box in the header",
		handler: async (_ctx) => {
			boxState.collapsed = !boxState.collapsed;
			currentTui?.requestRender();
		},
	});

	pi.registerShortcut("alt+shift+h", {
		description: "Show or hide done session tasks in the header",
		handler: async (_ctx) => {
			boxState.showDone = !boxState.showDone;
			currentTui?.requestRender();
		},
	});

	async function restoreFromBranch(_event: unknown, ctx: ExtensionContext) {
		todoList.restore(replayTasks(ctx.sessionManager.getBranch()));
		syncHeader(ctx);
	}

	pi.on("session_start", restoreFromBranch);
	pi.on("session_tree", restoreFromBranch);
}
