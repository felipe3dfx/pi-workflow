import type { Theme } from "@earendil-works/pi-coding-agent";
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
