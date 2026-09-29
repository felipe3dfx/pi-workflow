import type {
	ExtensionAPI,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
	type ChildRecord,
	type createChildSessions,
	isWorking,
	type Schedule,
	scheduleTimer,
} from "./child-sessions.ts";
import { sanitizeTaskText } from "./todo-header.ts";

type Sessions = ReturnType<typeof createChildSessions>;
export type ChildTheme = Pick<Theme, "fg" | "bg" | "bold">;

const WIDGET_KEY = "pi-workflow-children";
const retainMs = 60_000;
const maxFinished = 3;
const maxRows = 8;
const tickMs = 1000;
const coalesceMs = 400;

const glyphs: Record<ChildRecord["state"], [string, ThemeColor]> = {
	queued: ["○", "muted"],
	running: ["◐", "accent"],
	waiting: ["?", "warning"],
	completed: ["✓", "success"],
	failed: ["✗", "error"],
	cancelled: ["–", "muted"],
	"timed out": ["⧖", "error"],
};

const rank: Record<ChildRecord["state"], number> = {
	waiting: 0,
	running: 1,
	queued: 2,
	completed: 3,
	failed: 3,
	cancelled: 3,
	"timed out": 3,
};

export function byState(a: ChildRecord, b: ChildRecord) {
	return rank[a.state] - rank[b.state];
}

export function childName(child: ChildRecord) {
	return `${child.role} ${child.id.slice(0, 4)}`;
}

export function spread(left: string, right: string, width: number) {
	const shown = truncateToWidth(
		left,
		Math.max(0, width - visibleWidth(right) - 1),
	);
	const gap = Math.max(1, width - visibleWidth(shown) - visibleWidth(right));
	return truncateToWidth(`${shown}${" ".repeat(gap)}${right}`, width);
}

export function childElapsed(child: ChildRecord, now: number) {
	const seconds = Math.max(
		0,
		Math.floor(
			((child.endedAt ?? now) - (child.startedAt ?? child.createdAt)) / 1000,
		),
	);
	const pad = (value: number) => String(value).padStart(2, "0");
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600)
		return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
	return `${Math.floor(seconds / 3600)}h ${pad(Math.floor(seconds / 60) % 60)}m`;
}

export function childMeta(child: ChildRecord, now: number) {
	if (child.state === "queued") return "queued";
	const model = child.model.slice(child.model.indexOf("/") + 1);
	return `${model} (${child.thinking}) ${childElapsed(child, now)}`;
}

export function childGlyph(theme: ChildTheme, child: ChildRecord) {
	const [glyph, color] = glyphs[child.state];
	return theme.fg(color, glyph);
}

function childrenHeading(theme: ChildTheme, count: number) {
	return `${theme.fg("dim", "▾")} ${theme.bold(theme.fg("muted", "Subagents"))} ${theme.fg("dim", String(count))}`;
}

function renderChildRow(
	theme: ChildTheme,
	child: ChildRecord,
	meta: string,
	active: boolean,
	width: number,
) {
	const step = sanitizeTaskText(child.step ?? child.task.trim().split("\n")[0]);
	const left = ` ${childGlyph(theme, child)} ${theme.fg("accent", child.role)} ${child.id.slice(0, 4)} ${step}`;
	const line = spread(left, theme.fg("dim", meta), width);
	return active ? theme.bg("selectedBg", line) : line;
}

export function renderChildrenBox(
	theme: ChildTheme,
	records: ChildRecord[],
	now: number,
	width: number,
) {
	const finished = new Set(
		records
			.filter(
				(child) =>
					!isWorking(child.state) && now - (child.endedAt ?? 0) < retainMs,
			)
			.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
			.slice(0, maxFinished),
	);
	const rows = records
		.filter((child) => isWorking(child.state) || finished.has(child))
		.sort(byState);
	if (rows.length === 0) return [];
	const shown = rows.slice(0, maxRows);
	const hint = theme.fg("dim", "alt+a view");
	const lines = [
		spread(childrenHeading(theme, rows.length), hint, width),
		...shown.map((child, i) =>
			renderChildRow(theme, child, childMeta(child, now), i === 0, width),
		),
	];
	if (rows.length > shown.length) {
		lines.push(
			theme.fg("dim", ` … ${rows.length - shown.length} more · alt+a view`),
		);
	}
	return lines.map((line) => truncateToWidth(line, width));
}

export function registerChildrenBox(
	pi: ExtensionAPI,
	sessions: Sessions,
	schedule: Schedule = scheduleTimer,
) {
	let tui: { requestRender(): void } | undefined;
	let unsubscribe: (() => void) | undefined;
	let tick: (() => void) | undefined;
	let tickWait = 0;
	let cooling: (() => void) | undefined;
	let dirty = false;

	function render() {
		if (cooling) {
			dirty = true;
			return;
		}
		tui?.requestRender();
		cooling = schedule(() => {
			cooling = undefined;
			if (!dirty) return;
			dirty = false;
			render();
		}, coalesceMs);
	}

	function update() {
		render();
		const now = Date.now();
		const records = sessions.list();
		const wait = records.some((child) => isWorking(child.state))
			? tickMs
			: Math.min(
					...records.flatMap((child) =>
						child.endedAt !== undefined && now - child.endedAt < retainMs
							? [child.endedAt + retainMs - now]
							: [],
					),
				);
		if (!Number.isFinite(wait) || (tick && tickWait <= wait)) return;
		tick?.();
		tickWait = wait;
		tick = schedule(() => {
			tick = undefined;
			update();
		}, wait);
	}

	function stop() {
		unsubscribe?.();
		tick?.();
		cooling?.();
		unsubscribe = tick = cooling = tui = undefined;
		dirty = false;
	}

	pi.on("session_start", async (_event, ctx) => {
		stop();
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			WIDGET_KEY,
			(widgetTui, theme) => {
				tui = widgetTui;
				return {
					render: (width: number) =>
						renderChildrenBox(theme, sessions.list(), Date.now(), width),
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);
		unsubscribe = sessions.subscribe(update);
	});
	pi.on("session_shutdown", async () => stop());
}
