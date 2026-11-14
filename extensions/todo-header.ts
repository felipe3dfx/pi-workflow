import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

const STATE_MARKS: Record<
	TaskState,
	{ color: Parameters<TodoTheme["fg"]>[0]; glyph: string }
> = {
	pending: { color: "text", glyph: "□" },
	"in progress": { color: "accent", glyph: "◐" },
	done: { color: "success", glyph: "✓" },
	blocked: { color: "warning", glyph: "!" },
};

export type TodoHitAction =
	| "collapse"
	| "expand"
	| "previous"
	| "next"
	| "filter";
export type TodoHitTarget = {
	action: TodoHitAction;
	row: number;
	start: number;
	end: number;
};
export type TodoLayout = {
	lines: string[];
	capacity: number;
	page: number;
	pageCount: number | null;
	targets: TodoHitTarget[];
};

/** Coordinates are zero-based logical cells; end is exclusive. */
export function renderTodoBox(
	theme: TodoTheme,
	tasks: Task[],
	state: TodoBoxState,
	width: number,
	executors: TaskExecutors,
	terminalRows: number,
	page: number,
): TodoLayout {
	const safeWidth = Math.max(0, Math.floor(width));
	const budget = Math.max(0, Math.floor(terminalRows / 3));
	const capacity = Math.max(0, Math.min(8, budget - 5));
	const targets: TodoHitTarget[] = [];
	const deferred = (lines: string[]): TodoLayout => ({
		lines,
		capacity,
		page,
		pageCount: null,
		targets,
	});
	if (tasks.length === 0 || budget === 0) return deferred([]);
	if (state.collapsed) {
		const line = truncateToWidth(
			theme.fg("dim", "session tasks collapsed"),
			safeWidth,
		);
		const end = visibleWidth(line);
		if (end > 0) targets.push({ action: "expand", row: 0, start: 0, end });
		return deferred([line]);
	}
	const visible = tasks.filter(
		(task) => state.showDone || task.state !== "done",
	);
	if (capacity === 0) {
		const summary = `${visible.length}/${tasks.length} ${state.showDone ? "All" : "Without done"} · Alt+Shift+T/H/P/N`;
		return deferred([truncateToWidth(theme.fg("dim", summary), safeWidth)]);
	}
	const pageCount = Math.max(1, Math.ceil(visible.length / capacity));
	const effectivePage = Math.max(1, Math.min(pageCount, Math.floor(page)));
	const fillerWidth = Math.max(
		0,
		safeWidth - CORNER_TOP.length - CLOSE_HINT.length,
	);
	const top = truncateToWidth(
		theme.fg("borderMuted", CORNER_TOP) +
			" ".repeat(fillerWidth) +
			theme.fg("dim", CLOSE_HINT),
		safeWidth,
	);
	if (safeWidth >= 2 && visibleWidth(top) === safeWidth) {
		targets.push({
			action: "collapse",
			row: 1,
			start: safeWidth - 1,
			end: safeWidth,
		});
	}
	const bottom =
		theme.fg("borderMuted", CORNER_BOTTOM) +
		" ".repeat(
			Math.max(
				0,
				safeWidth - CORNER_BOTTOM.length - CORNER_BOTTOM_RIGHT.length,
			),
		) +
		theme.fg("borderMuted", CORNER_BOTTOM_RIGHT);
	const rows = visible
		.slice((effectivePage - 1) * capacity, effectivePage * capacity)
		.map((task) => {
			const text = terminalSafeLine(task.text);
			const mark = STATE_MARKS[task.state];
			const executor =
				task.state === "in progress" ? executors.get(task.id) : undefined;
			const content = `${theme.fg(mark.color, mark.glyph)} ${theme.fg(task.state === "done" ? "muted" : "text", text)}${
				executor
					? theme.fg(
							"dim",
							` ← ${terminalSafeLine(executor.role)} ${terminalSafeLine(executor.id.slice(0, 4))}`,
						)
					: ""
			}`;
			const inner = truncateToWidth(
				` ${content}`,
				Math.max(0, safeWidth - 2),
				"…",
				true,
			);
			return (
				theme.fg("borderMuted", SIDE) + inner + theme.fg("borderMuted", SIDE)
			);
		});
	const lines = ["", top, ...rows];
	if (tasks.length >= capacity) {
		let control = `${visible.length}/${tasks.length} ${state.showDone ? "All" : "Without done"}`;
		control = truncateToWidth(control, safeWidth);
		let full = false;
		const add = (label: string, action?: TodoHitAction) => {
			const start = visibleWidth(control) + 1;
			const end = start + visibleWidth(label);
			if (full || end > safeWidth) {
				full = true;
				return;
			}
			control += ` ${label}`;
			if (action) targets.push({ action, row: lines.length, start, end });
		};
		add(`${effectivePage}/${pageCount}`);
		add("‹", "previous");
		add("›", "next");
		add(state.showDone ? "Without done" : "All", "filter");
		add("Alt+Shift+P/N/H");
		lines.push(theme.fg("dim", control));
	}
	lines.push(bottom, "");
	return {
		lines: lines.map((line) => truncateToWidth(line, safeWidth)),
		capacity,
		page: effectivePage,
		pageCount,
		targets,
	};
}
