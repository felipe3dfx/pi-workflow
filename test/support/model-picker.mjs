import { stripVTControlCharacters } from "node:util";

export const catalog = [
	{ provider: "openai-codex", id: "gpt-5.6-luna", reasoning: true },
	{
		provider: "openai-codex",
		id: "gpt-6-astra",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh", max: "max" },
	},
	{ provider: "nan", id: "mimo-v2.5", reasoning: false },
	{ provider: "anthropic", id: "claude-opus", reasoning: true },
];

export function lines(panel, width = 120) {
	const [top, ...rest] = panel
		.render(width)
		.map((line) => stripVTControlCharacters(line));
	const title = top.replace(/^┌─ /, "").replace(/ ─+( \[×\] )?─┐$/, "");
	const body = rest
		.slice(0, -1)
		.map((line) =>
			line
				.slice(1, -1)
				.trim()
				.replace(/^▸ /, "")
				.replace(/\s*›$/, "")
				.replace(/ {2,}/g, " "),
		)
		.filter((line) => line !== "" && !/ ─+$/.test(line));
	return [title, ...body];
}
