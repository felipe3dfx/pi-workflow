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
import {
	notifyHeader,
	occupyAboveInput,
	paintAboveInput,
	seated,
	subscribePlace,
} from "./shell.ts";
import { sanitizeTaskText } from "./todo-header.ts";

type Sessions = ReturnType<typeof createChildSessions>;
export type ChildTheme = Pick<Theme, "fg" | "bg" | "bold">;

const WIDGET_KEY = "pi-workflow-children";
const retainMs = 60_000;
const maxFinished = 3;
const maxRows = 8;
const tickMs = 1000;
const coalesceMs = 400;
export const spinnerMs = 133;
export const workingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

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

import { childElapsed, childModelLine, childStep } from "./child-projection.ts";

export { childElapsed, childName } from "./child-projection.ts";

export function spread(left: string, right: string, width: number) {
	const shown = truncateToWidth(
		left,
		Math.max(0, width - visibleWidth(right) - 1),
	);
	const gap = Math.max(1, width - visibleWidth(shown) - visibleWidth(right));
	return truncateToWidth(`${shown}${" ".repeat(gap)}${right}`, width);
}

function childMeta(child: ChildRecord, now: number) {
	if (child.state === "queued") return "queued";
	return `${childModelLine(child)} ${childElapsed(child, now)}`;
}

export function childGlyph(theme: ChildTheme, child: ChildRecord) {
	const [glyph, color] = glyphs[child.state];
	return theme.fg(color, glyph);
}

function rowGlyph(theme: ChildTheme, child: ChildRecord, now: number) {
	if (child.state !== "running") return childGlyph(theme, child);
	const frame =
		workingFrames[Math.floor(now / spinnerMs) % workingFrames.length];
	return theme.fg(glyphs.running[1], frame);
}

function childrenHeading(theme: ChildTheme, count: number) {
	return `${theme.fg("dim", "▾")} ${theme.bold(theme.fg("muted", "Subagents"))} ${theme.fg("dim", String(count))}`;
}

function renderChildRow(
	theme: ChildTheme,
	child: ChildRecord,
	now: number,
	active: boolean,
	width: number,
) {
	const step = sanitizeTaskText(childStep(child));
	const meta = childMeta(child, now);
	const left = ` ${rowGlyph(theme, child, now)} ${theme.fg("accent", child.role)} ${child.id.slice(0, 4)} ${step}`;
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
			renderChildRow(theme, child, now, i === 0, width),
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
	let unsubscribePlace: (() => void) | undefined;
	let tick: (() => void) | undefined;
	let tickWait = 0;
	let spin: (() => void) | undefined;
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

	function animate() {
		tui?.requestRender();
		spin = schedule(animate, spinnerMs);
	}

	function update() {
		render();
		notifyHeader();
		const now = Date.now();
		const records = sessions.list();
		if (!records.some((child) => child.state === "running")) {
			spin?.();
			spin = undefined;
		} else if (!spin) spin = schedule(animate, spinnerMs);
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
		unsubscribePlace?.();
		tick?.();
		cooling?.();
		spin?.();
		unsubscribe = unsubscribePlace = tick = cooling = spin = tui = undefined;
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
					render: (width: number) => {
						occupyAboveInput("child-session", (paintedWidth) =>
							renderChildrenBox(
								theme,
								sessions.list(),
								Date.now(),
								paintedWidth,
							),
						);
						if (!seated("child-session", "above-input")) return [];
						return paintAboveInput(width);
					},
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);
		unsubscribe = sessions.subscribe(update);
		unsubscribePlace = subscribePlace("above-input", () => render());
	});
	pi.on("session_shutdown", async () => stop());
}
