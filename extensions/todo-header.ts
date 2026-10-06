import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { claim } from "./configure.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";
import type { Task } from "./todo-list.ts";

export const todoAboveInput = claim("todo", "above-input");

export interface TodoBoxState {
	collapsed: boolean;
	showDone: boolean;
}

export type TodoTheme = Pick<Theme, "fg" | "bold">;

const CLOSE_HINT = "×";
const CORNER_TOP = "┌";
const CORNER_BOTTOM = "└";
const CORNER_BOTTOM_RIGHT = "┘";
const SIDE = "│";

export function renderTodoBox(
	theme: TodoTheme,
	tasks: Task[],
	state: TodoBoxState,
	width: number,
): string[] {
	if (tasks.length === 0) return [];

	const safeWidth = Math.max(0, width);

	if (state.collapsed) {
		return [truncateToWidth(theme.fg("dim", "session tasks collapsed"), safeWidth)];
	}

	const visible = tasks.filter((task) => state.showDone || !task.done);
	const fillerWidth = Math.max(0, safeWidth - CORNER_TOP.length - CLOSE_HINT.length);
	const top = theme.fg("borderMuted", CORNER_TOP) + " ".repeat(fillerWidth) + theme.fg("dim", CLOSE_HINT);
	const bottom =
		theme.fg("borderMuted", CORNER_BOTTOM) +
		" ".repeat(Math.max(0, safeWidth - CORNER_BOTTOM.length - CORNER_BOTTOM_RIGHT.length)) +
		theme.fg("borderMuted", CORNER_BOTTOM_RIGHT);

	const rows = visible.map((task) => {
		const text = terminalSafeLine(task.text);
		const content = task.done
			? `${theme.fg("success", "✓")} ${theme.fg("muted", text)}`
			: `${theme.fg("text", "□")} ${theme.fg("text", text)}`;
		const inner = truncateToWidth(` ${content}`, Math.max(0, safeWidth - 2), "…", true);
		return theme.fg("borderMuted", SIDE) + inner + theme.fg("borderMuted", SIDE);
	});

	return ["", top, ...rows, bottom, ""].map((line) => truncateToWidth(line, safeWidth));
}
