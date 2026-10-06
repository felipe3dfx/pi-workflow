import type { Theme } from "@earendil-works/pi-coding-agent";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

export function theme() {
	const current = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
	if (!current)
		throw new Error("Theme not initialized. Call initTheme() first.");
	return current;
}
