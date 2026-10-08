import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { terminalSafeLine } from "./terminal-safe-text.ts";
import type { Task, TaskState } from "./todo-list.ts";

export interface TodoBoxState {
	collapsed: boolean;
	showDone: boolean;
}

export type TodoTheme = Pick<Theme, "fg" | "bold">;

export type TaskExecutor = { role: string; id: string };

export type TaskExecutors = ReadonlyMap<number, TaskExecutor>;

const CLOSE_HINT = "×";
const CORNER_TOP = "┌";
const CORNER_BOTTOM = "└";
const CORNER_BOTTOM_RIGHT = "┘";
const SIDE = "│";

const STATE_MARKS: Record<TaskState, { color: Parameters<TodoTheme["fg"]>[0]; glyph: string }> = {
	pending: { color: "text", glyph: "□" },
	"in progress": { color: "accent", glyph: "◐" },
	done: { color: "success", glyph: "✓" },
	blocked: { color: "warning", glyph: "!" },
};

export function renderTodoBox(
	theme: TodoTheme,
	tasks: Task[],
	state: TodoBoxState,
	width: number,
	executors: TaskExecutors,
): string[] {
	if (tasks.length === 0) return [];

	const safeWidth = Math.max(0, width);

	if (state.collapsed) {
		return [truncateToWidth(theme.fg("dim", "session tasks collapsed"), safeWidth)];
	}

	const visible = tasks.filter((task) => state.showDone || task.state !== "done");
	const fillerWidth = Math.max(0, safeWidth - CORNER_TOP.length - CLOSE_HINT.length);
	const top = theme.fg("borderMuted", CORNER_TOP) + " ".repeat(fillerWidth) + theme.fg("dim", CLOSE_HINT);
	const bottom =
		theme.fg("borderMuted", CORNER_BOTTOM) +
		" ".repeat(Math.max(0, safeWidth - CORNER_BOTTOM.length - CORNER_BOTTOM_RIGHT.length)) +
		theme.fg("borderMuted", CORNER_BOTTOM_RIGHT);

	const rows = visible.map((task) => {
		const text = terminalSafeLine(task.text);
		const mark = STATE_MARKS[task.state];
		const executor = task.state === "in progress" ? executors.get(task.id) : undefined;
		const content = `${theme.fg(mark.color, mark.glyph)} ${theme.fg(task.state === "done" ? "muted" : "text", text)}${
			executor ? theme.fg("dim", ` ← ${executor.role} ${executor.id.slice(0, 4)}`) : ""
		}`;
		const inner = truncateToWidth(` ${content}`, Math.max(0, safeWidth - 2), "…", true);
		return theme.fg("borderMuted", SIDE) + inner + theme.fg("borderMuted", SIDE);
	});

	return ["", top, ...rows, bottom, ""].map((line) => truncateToWidth(line, safeWidth));
}
