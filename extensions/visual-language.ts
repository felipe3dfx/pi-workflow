import { readFileSync } from "node:fs";

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ChildRecord } from "./child-sessions.ts";
import type { TaskState } from "./todo-list.ts";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const TERMINAL = Symbol.for("pi-workflow:visual-language:terminal");

const narrowColumns = 60;

type DensityTerminal = { readonly columns: number; readonly rows?: number };
type DensityBinding = { terminal: DensityTerminal; host?: object };
const densityTerminalSlots = globalThis as Record<
	symbol,
	DensityBinding | undefined
>;

// The host is the TUI that owns the terminal: only its layout knows the rows a
// docked component is given.
export function setDensityTerminal(
	terminal: DensityTerminal | undefined,
	host?: object,
) {
	densityTerminalSlots[TERMINAL] = terminal && { terminal, host };
}

export function densityBinding() {
	return densityTerminalSlots[TERMINAL];
}

// Read on every call: density follows a resize on the next render (NS-02).
export function narrowScreen() {
	const columns = densityTerminalSlots[TERMINAL]?.terminal.columns;
	return typeof columns === "number" && columns < narrowColumns;
}

export const spinnerMs = 133;
export const workingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

export function initializedTheme() {
	return (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
}

export function theme() {
	const current = initializedTheme();
	if (!current)
		throw new Error("Theme not initialized. Call initTheme() first.");
	return current;
}

type Palette = Pick<Theme, "fg"> &
	Partial<Pick<Theme, "sourcePath" | "getColorMode">>;

const parsedVars = new WeakMap<object, Record<string, unknown>>();

function themeVars(source: Palette, path: string) {
	let vars = parsedVars.get(source);
	if (!vars) {
		try {
			vars = JSON.parse(readFileSync(path, "utf8")).vars ?? {};
		} catch {
			vars = {};
		}
		parsedVars.set(source, vars as Record<string, unknown>);
	}
	return vars as Record<string, unknown>;
}

function varRgb(source: Palette, name: string) {
	if (!source.sourcePath || source.getColorMode?.() !== "truecolor") return;
	const vars = themeVars(source, source.sourcePath);
	const seen = new Set<string>();
	let value = vars[name];
	while (typeof value === "string" && !value.startsWith("#")) {
		if (seen.has(value)) return;
		seen.add(value);
		value = vars[value];
	}
	const hex =
		typeof value === "string"
			? /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value)
			: null;
	return hex
		?.slice(1)
		.map((pair) => Number.parseInt(pair, 16))
		.join(";");
}

export function themeVar(name: string, fallback: ThemeColor) {
	return (text: string, source: Palette = theme()) => {
		const rgb = varRgb(source, name);
		return rgb ? `\x1b[38;2;${rgb}m${text}\x1b[39m` : source.fg(fallback, text);
	};
}

// The one state-glyph table (NS-14). Below 60 columns every component paints a
// state from the shared scale; at 60 columns and above each mapping keeps
// today's glyph where it differed (D-open-1).
type Tone = ThemeColor | "cyan";
type Mark = readonly [glyph: string, tone: Tone];

const scale = {
	pending: ["○", "muted"],
	running: ["◐", "cyan"],
	waiting: ["?", "warning"],
	blocked: ["!", "warning"],
	done: ["✓", "success"],
	failed: ["✗", "error"],
	cancelled: ["–", "muted"],
	interrupted: ["⊘", "warning"],
} as const satisfies Record<string, Mark>;

type Mapping = readonly [narrow: Mark, wide?: Mark];

type RunState = ChildRecord["state"] | "interrupted";

const runStates: Record<RunState, Mapping> = {
	queued: [scale.pending],
	running: [scale.running],
	waiting: [scale.waiting],
	completed: [scale.done],
	failed: [scale.failed],
	cancelled: [scale.cancelled],
	"timed out": [scale.failed, ["⧖", "error"]],
	interrupted: [scale.interrupted],
};

const taskStates: Record<TaskState, Mapping> = {
	pending: [scale.pending, ["□", "text"]],
	"in progress": [scale.running, ["◐", "accent"]],
	done: [scale.done],
	blocked: [scale.blocked],
};

const cyan = themeVar("cyan", "accent");

type StateMark = {
	readonly glyph: string;
	// Paints `text`, the glyph by default, in the state's tone.
	paint(source: Palette, text?: string): string;
};

function stateMark([narrow, wide = narrow]: Mapping): StateMark {
	const [glyph, tone] = narrowScreen() ? narrow : wide;
	return {
		glyph,
		paint: (source, text = glyph) =>
			tone === "cyan" ? cyan(text, source) : source.fg(tone, text),
	};
}

export function runStateMark(state: RunState) {
	return stateMark(runStates[state]);
}

export function taskStateMark(state: TaskState) {
	return stateMark(taskStates[state]);
}

export function themeBgVar(name: string) {
	return (text: string, source: Palette = theme()) => {
		const rgb = varRgb(source, name);
		return rgb ? `\x1b[48;2;${rgb}m${text}\x1b[49m` : text;
	};
}

export const minThoughtMs = 1_000;

export function formatDuration(ms: number) {
	const elapsed = Math.max(0, ms);
	const tenths = Math.round(elapsed / 100);
	if (tenths < 100) return `${(tenths / 10).toFixed(1)}s`;
	const whole = Math.round(elapsed / 1000);
	if (whole < 60) return `${whole}s`;
	const minutes = Math.floor(whole / 60);
	const pad = (value: number) => String(value).padStart(2, "0");
	if (minutes < 60) return `${minutes}m ${pad(whole % 60)}s`;
	return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

// The width the base's whole-second time took: integer seconds below 10, the shared format above.
export function legacyDurationWidth(ms: number) {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	return seconds < 10
		? `${seconds}s`.length
		: visibleWidth(formatDuration(seconds * 1000));
}

export function affordance(theme: Theme) {
	return theme.fg("dim", "›");
}

export function spread(left: string, right: string, width: number) {
	const shown = truncateToWidth(
		left,
		Math.max(0, width - visibleWidth(right) - 1),
	);
	const gap = Math.max(1, width - visibleWidth(shown) - visibleWidth(right));
	return truncateToWidth(`${shown}${" ".repeat(gap)}${right}`, width);
}

// The suffix is never cut: it takes the row's last cells, the only ones when
// the row has no more, and `left` is cut with … to fit before it.
export function pinRight(left: string, right: string, width: number) {
	const suffix = visibleWidth(right);
	if (width <= suffix)
		return width > 0 ? truncateToWidth(right, width, "") : "";
	const room = width - suffix - 1;
	const shown = room > 0 ? truncateToWidth(left, room, "…") : "";
	return `${shown}${" ".repeat(width - visibleWidth(shown) - suffix)}${right}`;
}
