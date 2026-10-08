import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { occupyAboveInput, seated } from "./shell.ts";
import { offerTool } from "./tool-offer.ts";
import {
	renderTodoBox,
	type TaskExecutors,
	type TodoBoxState,
} from "./todo-header.ts";
import { createTodoList, TASK_STATES, type Task } from "./todo-list.ts";

const TodoTaskState = Type.Union(
	TASK_STATES.map((state) => Type.Literal(state)),
	{ description: "Task state; blocked means the task needs the parent's attention" },
);

const TodoWriteTask = Type.Object({
	text: Type.String({ description: "Task text" }),
	state: Type.Optional(TodoTaskState),
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
	state: Type.Optional(TodoTaskState),
});

function summarize(tasks: Task[]): string {
	if (tasks.length === 0) return "No session tasks";
	return tasks.map((task) => `[${task.state}] #${task.id}: ${task.text}`).join("\n");
}

const HARNESS_ENTRY = "pi-workflow-todo";

export type TodoClaim = { reason: string } | { task: Task; start(): void };

function replayTasks(entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): Task[] {
	let tasks: Task[] = [];
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === HARNESS_ENTRY) {
			const data = entry.data as { tasks?: Task[] } | undefined;
			if (data && Array.isArray(data.tasks)) tasks = data.tasks;
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== "todo" || message.isError) continue;
		const details = message.details as { tasks?: Task[] } | undefined;
		if (details && Array.isArray(details.tasks)) tasks = details.tasks;
	}
	return tasks.length > 0 && tasks.every((task) => task.state === "done") ? [] : tasks;
}

export function registerSessionTodo(
	pi: ExtensionAPI,
	requestRender: () => void,
	executors: () => TaskExecutors,
) {
	const todoList = createTodoList();
	const boxState: TodoBoxState = { collapsed: false, showDone: true };
	occupyAboveInput("todo", (width, theme) =>
		renderTodoBox(theme, todoList.list(), boxState, width, executors()),
	);

	function reveal(): void {
		boxState.collapsed = false;
		requestRender();
	}

	const tool: ToolDefinition<typeof TodoParams> = {
		name: "todo",
		label: "Todo",
		description:
			"Manage the current session's task list, shown in a box pinned above the input. Actions: write (replace the whole list), add, update, clear, list. Session-scoped only; never creates a file.",
		promptSnippet: "Track the session's todo list, shown above the input, with write/add/update/clear/list",
		promptGuidelines: [
			"Use todo, not a markdown or TODO file, whenever the user asks for a task list or to track work for this session, unless the user explicitly asks for a file; todo never creates a file.",
			"Prefer todo write to replace the whole plan when it changes, and todo update to move one task's Task state as work progresses.",
		],
		parameters: TodoParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!seated("todo", "above-input")) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Todo is not seated. Run /workflow:config.",
						},
					],
					details: { status: "refused" },
				};
			}
			switch (params.action) {
				case "write": {
					if (params.tasks === undefined) {
						throw new Error("tasks is required for write");
					}
					const tasks = todoList.write(params.tasks);
					reveal();
					return { content: [{ type: "text", text: summarize(tasks) }], details: { tasks } };
				}
				case "add": {
					if (!params.text) {
						throw new Error("text is required for add");
					}
					const task = todoList.add(params.text, params.state);
					reveal();
					return {
						content: [{ type: "text", text: `Added #${task.id}: ${task.text}\n${summarize(todoList.list())}` }],
						details: { tasks: todoList.list() },
					};
				}
				case "update": {
					if (params.id === undefined) {
						throw new Error("id is required for update");
					}
					const task = todoList.update(params.id, { text: params.text, state: params.state });
					if (!task) {
						throw new Error(`task #${params.id} not found`);
					}
					reveal();
					return { content: [{ type: "text", text: `Updated #${task.id}\n${summarize(todoList.list())}` }], details: { tasks: todoList.list() } };
				}
				case "clear": {
					todoList.clear();
					reveal();
					return { content: [{ type: "text", text: "Cleared session tasks" }], details: { tasks: [] } };
				}
				case "list":
					return {
						content: [{ type: "text", text: summarize(todoList.list()) }],
						details: { tasks: todoList.list() },
					};
			}
		},
	};
	pi.registerTool(tool);

	pi.registerShortcut("alt+shift+t", {
		description: "Collapse or expand the session task box above the input",
		handler: async (_ctx) => {
			boxState.collapsed = !boxState.collapsed;
			requestRender();
		},
	});

	pi.registerShortcut("alt+shift+h", {
		description: "Show or hide done session tasks above the input",
		handler: async (_ctx) => {
			boxState.showDone = !boxState.showDone;
			requestRender();
		},
	});

	async function restoreFromBranch(_event: unknown, ctx: ExtensionContext) {
		todoList.restore(replayTasks(ctx.sessionManager.getBranch()));
		requestRender();
	}

	pi.on("session_start", restoreFromBranch);
	pi.on("session_tree", restoreFromBranch);

	function claim(id: number): TodoClaim {
		if (!seated("todo", "above-input")) {
			return { reason: `Todo is not seated, so task #${id} cannot be linked. Run /workflow:config.` };
		}
		const task = todoList.list().find((candidate) => candidate.id === id);
		if (!task) return { reason: `Task #${id} does not exist in the Todo.` };
		if (task.state === "done") {
			return { reason: `Task #${id} is done. Change its Task state before executing it again.` };
		}
		return {
			task,
			start() {
				if (!todoList.update(id, { state: "in progress" })) return;
				pi.appendEntry(HARNESS_ENTRY, { tasks: todoList.list() });
				reveal();
			},
		};
	}

	return {
		offer: () => offerTool(pi, tool, seated("todo", "above-input")),
		claim,
	};
}
