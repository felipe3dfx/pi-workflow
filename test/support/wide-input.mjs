import { readFileSync } from "node:fs";

const names = [
	"accent",
	"border",
	"borderAccent",
	"dim",
	"muted",
	"text",
	"thinkingHigh",
	"mdHeading",
	"selectedBg",
	"warning",
	"error",
];
const code = (color) => 16 + names.indexOf(color);

// The theme the base's bytes in `test/fixtures/wide-input.json` were captured with.
export const sgrTheme = {
	fg: (color, text) => `\x1b[38;5;${code(color)}m${text}\x1b[39m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	bg: (color, text) => `\x1b[48;5;${code(color)}m${text}\x1b[49m`,
};

export const wideInput = JSON.parse(
	readFileSync(new URL("../fixtures/wide-input.json", import.meta.url), "utf8"),
);
