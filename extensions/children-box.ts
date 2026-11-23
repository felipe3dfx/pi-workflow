import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
	type ChildRecord,
	type createChildSessions,
	isWorking,
} from "./child-sessions.ts";
import { type Schedule, scheduleTimer } from "./clock.ts";
import { occupyAboveInput } from "./shell.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";
import {
	narrowScreen,
	runStateMark,
	spinnerMs,
	spread,
	workingFrames,
} from "./visual-language.ts";

type Sessions = ReturnType<typeof createChildSessions>;
export type ChildTheme = Pick<Theme, "fg" | "bg" | "bold">;

const retainMs = 60_000;
const maxFinished = 3;
const maxRows = 8;
const tickMs = 1000;
const coalesceMs = 400;

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

function childMeta(child: ChildRecord, now: number, width: number) {
	if (child.state === "queued") return "queued";
	const elapsed = childElapsed(child, now);
	const model = truncateToWidth(
		childModelLine(child),
		Math.max(0, width - visibleWidth(elapsed) - 2),
	);
	return `${model} ${elapsed}`;
}

export function childGlyph(theme: ChildTheme, child: ChildRecord) {
	return runStateMark(child.state).paint(theme);
}

function rowGlyph(theme: ChildTheme, child: ChildRecord, now: number) {
	if (child.state !== "running") return childGlyph(theme, child);
	const frame =
		workingFrames[Math.floor(now / spinnerMs) % workingFrames.length];
	return runStateMark("running").paint(theme, frame);
}

function childrenHeading(theme: ChildTheme, rows: ChildRecord[]) {
	const tally = (match: (state: ChildRecord["state"]) => boolean) =>
		rows.filter((child) => match(child.state)).length;
	const parts = [
		["warning", tally((state) => state === "waiting"), "waiting"],
		["dim", tally((state) => state === "running"), "running"],
		["dim", tally((state) => state === "queued"), "queued"],
		["dim", tally((state) => !isWorking(state)), "finished"],
	] as const;
	const counts = parts
		.filter(([, count]) => count > 0)
		.map(([color, count, label]) => theme.fg(color, `${count} ${label}`))
		.join(theme.fg("dim", " · "));
	return `${theme.fg("dim", "▾")} ${theme.bold(theme.fg("muted", "Subagents"))} ${counts}`;
}

function renderChildRow(
	theme: ChildTheme,
	child: ChildRecord,
	now: number,
	active: boolean,
	width: number,
) {
	const step = terminalSafeLine(childStep(child));
	// Narrow, timed out shares ✗ with failed, so its state word is reserved
	// before the task and model are cut (D-open-2).
	const word =
		narrowScreen() && child.state === "timed out"
			? ` ${runStateMark(child.state).paint(theme, "timed out")}`
			: "";
	const head = ` ${rowGlyph(theme, child, now)}${word} ${theme.fg("accent", child.role)} ${child.id.slice(0, 4)}`;
	const meta = childMeta(
		child,
		now,
		word ? width - visibleWidth(head) - 4 : width,
	);
	const line = spread(`${head} ${step}`, theme.fg("dim", meta), width);
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
		spread(childrenHeading(theme, rows), hint, width),
		...shown.map((child, i) =>
			renderChildRow(theme, child, now, i === 0, width),
		),
	];
	if (rows.length > shown.length) {
		const view = narrowScreen() ? "Alt+A" : "alt+a view";
		lines.push(
			theme.fg("dim", ` … ${rows.length - shown.length} more · ${view}`),
		);
	}
	return lines.map((line) => truncateToWidth(line, width));
}

export function registerChildrenBox(
	pi: ExtensionAPI,
	sessions: Sessions,
	requestRender: () => void,
	schedule: Schedule = scheduleTimer,
) {
	let unsubscribe: (() => void) | undefined;
	let tick: (() => void) | undefined;
	let tickWait = 0;
	let spin: (() => void) | undefined;
	let cooling: (() => void) | undefined;
	let dirty = false;

	occupyAboveInput("child-session", (width, theme) =>
		renderChildrenBox(theme, sessions.list(), Date.now(), width),
	);

	function render() {
		if (cooling) {
			dirty = true;
			return;
		}
		requestRender();
		cooling = schedule(() => {
			cooling = undefined;
			if (!dirty) return;
			dirty = false;
			render();
		}, coalesceMs);
	}

	function animate() {
		requestRender();
		spin = schedule(animate, spinnerMs);
	}

	function update() {
		render();
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
		tick?.();
		cooling?.();
		spin?.();
		unsubscribe = tick = cooling = spin = undefined;
		dirty = false;
	}

	pi.on("session_start", async (_event, ctx) => {
		stop();
		if (ctx.mode !== "tui") return;
		unsubscribe = sessions.subscribe(update);
	});
	pi.on("session_shutdown", async () => stop());
}
