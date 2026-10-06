import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const spinnerMs = 133;
export const workingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

export function spread(left: string, right: string, width: number) {
	const shown = truncateToWidth(
		left,
		Math.max(0, width - visibleWidth(right) - 1),
	);
	const gap = Math.max(1, width - visibleWidth(shown) - visibleWidth(right));
	return truncateToWidth(`${shown}${" ".repeat(gap)}${right}`, width);
}
