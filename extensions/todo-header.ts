import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import type { Task } from "./todo-list.ts";

export interface TodoBoxState {
	collapsed: boolean;
	showDone: boolean;
}

export type TodoTheme = Pick<Theme, "fg" | "bold">;

const CLOSE_HINT = "×";
const CORNER_TOP = "┌";
const CORNER_BOTTOM = "└";

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
	const bottom = theme.fg("borderMuted", CORNER_BOTTOM);

	const rows = visible.map((task) => {
		const text = task.text.replace(/\n/g, " ");
		return task.done
			? theme.fg("success", `  ✓ ${text}`)
			: theme.bold(theme.fg("accent", `  □ ${text}`));
	});

	return ["", top, ...rows, bottom, ""].map((line) => truncateToWidth(line, safeWidth));
}
