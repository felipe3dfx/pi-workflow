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

export function spread(left: string, right: string, width: number) {
	const shown = truncateToWidth(
		left,
		Math.max(0, width - visibleWidth(right) - 1),
	);
	const gap = Math.max(1, width - visibleWidth(shown) - visibleWidth(right));
	return truncateToWidth(`${shown}${" ".repeat(gap)}${right}`, width);
}
