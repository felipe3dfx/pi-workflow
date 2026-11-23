import { readFileSync } from "node:fs";

// Raw wide bytes of each card, captured from the base before the narrow layouts.
export const wideCards = JSON.parse(
	readFileSync(new URL("../fixtures/wide-cards.json", import.meta.url), "utf8"),
);

export function eachWideWidth(terminal, check) {
	for (const [columns, widths] of [
		[60, [59, 60]],
		[100, [99, 100]],
	]) {
		terminal.columns = columns;
		for (const width of widths) check(width, columns);
	}
}
