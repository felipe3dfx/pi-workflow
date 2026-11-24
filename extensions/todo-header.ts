import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { terminalSafeLine } from "./terminal-safe-text.ts";
import type { Task } from "./todo-list.ts";
import { narrowScreen, pinRight, taskStateMark } from "./visual-language.ts";

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

/** Tasks per page at `terminalRows`, under the live density terminal. */
export function todoCapacity(terminalRows: number): number {
	const budget = Math.max(0, Math.floor(terminalRows / 3));
	// Narrow, the Todo has no frame or blank rows: its heading and control row
	// are the only overhead (NS-28).
	return Math.max(0, Math.min(8, budget - (narrowScreen() ? 2 : 5)));
}

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
	const narrow = narrowScreen();
	const capacity = todoCapacity(terminalRows);
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
	const tasksOnPage = visible.slice(
		(effectivePage - 1) * capacity,
		effectivePage * capacity,
	);
	const taskContent = (task: Task) => {
		const text = terminalSafeLine(task.text);
		const mark = taskStateMark(task.state).paint(theme);
		const executor =
			task.state === "in progress" ? executors.get(task.id) : undefined;
		return `${mark} ${theme.fg(task.state === "done" ? "muted" : "text", text)}${
			executor
				? theme.fg(
						"dim",
						` ← ${terminalSafeLine(executor.role)} ${terminalSafeLine(executor.id.slice(0, 4))}`,
					)
				: ""
		}`;
	};
	if (narrow) {
		const done = tasks.filter((task) => task.state === "done").length;
		const heading = pinRight(
			`${theme.fg("dim", "▾")} ${theme.bold(theme.fg("muted", "Todo"))} ${theme.fg("dim", `${done}/${tasks.length}`)}`,
			theme.fg("dim", "Alt+Shift+T"),
			safeWidth,
		);
		const end = visibleWidth(heading);
		if (end > 0) targets.push({ action: "collapse", row: 0, start: 0, end });
		const lines = [
			heading,
			...tasksOnPage.map((task) =>
				truncateToWidth(taskContent(task), safeWidth, "…"),
			),
		];
		if (tasks.length >= capacity)
			lines.push(
				controlRow(theme, state, visible.length, tasks.length, {
					width: safeWidth,
					row: lines.length,
					page: effectivePage,
					pageCount,
					targets,
				}),
			);
		return { lines, capacity, page: effectivePage, pageCount, targets };
	}
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
	const rows = tasksOnPage.map((task) => {
		const inner = truncateToWidth(
			` ${taskContent(task)}`,
			Math.max(0, safeWidth - 2),
			"…",
			true,
		);
		return (
			theme.fg("borderMuted", SIDE) + inner + theme.fg("borderMuted", SIDE)
		);
	});
	const lines = ["", top, ...rows];
	if (tasks.length >= capacity)
		lines.push(
			controlRow(theme, state, visible.length, tasks.length, {
				width: safeWidth,
				row: lines.length,
				page: effectivePage,
				pageCount,
				targets,
			}),
		);
	lines.push(bottom, "");
	return {
		lines: lines.map((line) => truncateToWidth(line, safeWidth)),
		capacity,
		page: effectivePage,
		pageCount,
		targets,
	};
}

// The visible over total count, then page position, navigation, filter and
// hints, each only while it fits; its targets are pushed for `row`.
function controlRow(
	theme: TodoTheme,
	state: TodoBoxState,
	visible: number,
	total: number,
	at: {
		width: number;
		row: number;
		page: number;
		pageCount: number;
		targets: TodoHitTarget[];
	},
) {
	let control = `${visible}/${total} ${state.showDone ? "All" : "Without done"}`;
	control = truncateToWidth(control, at.width);
	let full = false;
	const add = (label: string, action?: TodoHitAction) => {
		const start = visibleWidth(control) + 1;
		const end = start + visibleWidth(label);
		if (full || end > at.width) {
			full = true;
			return;
		}
		control += ` ${label}`;
		if (action) at.targets.push({ action, row: at.row, start, end });
	};
	add(`${at.page}/${at.pageCount}`);
	add("‹", "previous");
	add("›", "next");
	add(state.showDone ? "Without done" : "All", "filter");
	add("Alt+Shift+P/N/H");
	return theme.fg("dim", control);
}
