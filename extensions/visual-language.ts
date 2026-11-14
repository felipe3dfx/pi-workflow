import { readFileSync } from "node:fs";

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

export const spinnerMs = 133;
export const workingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

export function theme() {
	const current = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
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

export function themeBgVar(name: string) {
	return (text: string, source: Palette = theme()) => {
		const rgb = varRgb(source, name);
		return rgb ? `\x1b[48;2;${rgb}m${text}\x1b[49m` : text;
	};
}

export const minThoughtMs = 1_000;

export function formatDuration(ms: number) {
	const tenths = Math.round(Math.max(0, ms) / 100);
	if (tenths < 100) return `${(tenths / 10).toFixed(1)}s`;
	const whole = Math.round(tenths / 10);
	if (whole < 60) return `${whole}s`;
	const minutes = Math.floor(whole / 60);
	if (minutes < 60) return `${minutes}m${whole % 60}s`;
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

export function spread(left: string, right: string, width: number) {
	const shown = truncateToWidth(
		left,
		Math.max(0, width - visibleWidth(right) - 1),
	);
	const gap = Math.max(1, width - visibleWidth(shown) - visibleWidth(right));
	return truncateToWidth(`${shown}${" ".repeat(gap)}${right}`, width);
}
