import {
	CustomEditor,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteProvider,
	type EditorTheme,
	type SelectListTheme,
	stripTerminalSequences,
	type TUI,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { ChromeTheme } from "./chrome.ts";
import { NATIVE } from "./chrome-menus.ts";

export const PLACEHOLDER = "What should we build together?";

const TOP = "\u0000chrome-top";
const BOTTOM = "\u0000chrome-bottom";
const SCROLL = "\u0000chrome-scroll";
const EMPTY = "\u0000chrome-empty";
const CURSOR = "\x1b[7m \x1b[0m";
const RESET = "\x1b[0m";
const inset = 4;
const gutter = 2;
const minWidth = 12;
const minContent = 4;
const margin = 1;
const marginMinWidth = 16;

export function marginFor(width: number) {
	return width >= marginMinWidth ? margin : 0;
}

export interface ChromeEditorOptions {
	theme: () => ChromeTheme;
	label: () => string;
}

function rule(width: number) {
	return "─".repeat(Math.max(0, width));
}

function more(arrow: string, count: number) {
	return count > 0 ? ` ${arrow} ${count} more ` : "";
}

function withPlaceholder(line: string, text: string) {
	const cursor = line.indexOf(CURSOR);
	const head =
		cursor === -1
			? line.slice(0, line.length - line.trimStart().length)
			: line.slice(0, cursor + CURSOR.length);
	return head + text;
}

function tint(line: string, theme: ChromeTheme) {
	const [open, close] = theme.fg("text", "\u0000").split("\u0000");
	const kept = line
		.split(RESET)
		.join(RESET + open)
		.split(close)
		.join(close + open);
	return open + kept + close;
}

function argumentHint(description: string | undefined) {
	const [head, ...tail] = (description ?? "").split(" — ");
	const hint = head.trim();
	if (!hint || /^\[[\w:.-]+\] /.test(hint)) return undefined;
	return tail.length > 0 || hint.startsWith("<") ? hint : undefined;
}

function menuTheme(
	theme: () => ChromeTheme,
): SelectListTheme & { [NATIVE]: true } {
	return {
		[NATIVE]: true,
		selectedPrefix: (text) => text,
		selectedText(text) {
			const t = theme();
			const [, value, gap = "", description = ""] = text
				.slice(2)
				.match(/^(.*?)( {2,})(.*)$/) ?? [undefined, text.slice(2)];
			return `${t.bold(t.fg("text", `❯ ${value}`))}${gap}${t.fg("dim", description)}`;
		},
		description: (text) => theme().fg("dim", text),
		scrollInfo: (text) => `${SCROLL}${text}`,
		noMatch: (text) => `${EMPTY}${theme().fg("dim", text)}`,
	};
}

function unmark(line: string) {
	return line.replace(SCROLL, "").replace(EMPTY, "");
}

class ChromeEditor extends CustomEditor {
	chrome: ChromeEditorOptions;
	framed = false;
	hiddenAbove = 0;
	hiddenBelow = 0;
	menuStart = 0;
	menuRows = 0;
	commands = new Map<string, string | undefined>();
	providerVersion = 0;
	host: TUI;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		chrome: ChromeEditorOptions,
	) {
		super(tui, { ...theme, selectList: menuTheme(chrome.theme) }, keybindings);
		this.chrome = chrome;
		this.host = tui;
	}

	setAutocompleteProvider(provider: AutocompleteProvider) {
		super.setAutocompleteProvider(provider);
		this.commands = new Map();
		const version = ++this.providerVersion;
		provider
			.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal })
			.then((result) => {
				if (!result || version !== this.providerVersion) return;
				this.commands = new Map(
					result.items.map((item) => [
						item.value,
						argumentHint(item.description),
					]),
				);
				this.host.requestRender();
			})
			.catch(() => {});
	}

	slashLine(line: string, theme: ChromeTheme, inner: number) {
		const text = this.getText();
		const token = /^\/\S+/.exec(text)?.[0];
		if (!token || !this.commands.has(token.slice(1))) return line;
		const lead = line.length - line.trimStart().length;
		if (!line.startsWith(token, lead)) return line;
		const colored =
			line.slice(0, lead) +
			theme.fg("mdHeading", token) +
			line.slice(lead + token.length);
		const hint = this.commands.get(token.slice(1));
		const cursor = this.getCursor();
		const rest = text.slice(token.length);
		const cursorAt = colored.indexOf(CURSOR);
		if (
			!hint ||
			cursorAt === -1 ||
			(rest !== "" && rest !== " ") ||
			cursor.line !== 0 ||
			cursor.col !== text.length
		)
			return colored;
		const head = colored.slice(0, cursorAt);
		const spaced = rest === " ";
		const room = inner - visibleWidth(head) - (spaced ? 0 : 1);
		if (room <= 0) return colored;
		const ghost = truncateToWidth(hint, room, "…");
		if (!spaced) return head + CURSOR + theme.fg("muted", ghost);
		const [first, ...others] = [...ghost];
		return `${head}\x1b[7m${first}${RESET}${theme.fg("muted", others.join(""))}`;
	}

	protected renderTopBorder(width: number, hiddenLineCount: number) {
		if (!this.framed) return super.renderTopBorder(width, hiddenLineCount);
		this.hiddenAbove = hiddenLineCount;
		return TOP;
	}

	protected renderBottomBorder(width: number, hiddenLineCount: number) {
		if (!this.framed) return super.renderBottomBorder(width, hiddenLineCount);
		this.hiddenBelow = hiddenLineCount;
		return BOTTOM;
	}

	render(full: number): string[] {
		const edge = marginFor(full);
		const width = full - edge * 2;
		const inner = width - inset - 1;
		const pad = this.getPaddingX();
		const content = inner - pad * 2 - (pad ? 0 : 1);
		this.framed = width >= minWidth && content >= minContent;
		this.menuRows = 0;
		if (!this.framed) return super.render(full).map(unmark);
		const lines = super.render(inner);
		const bottom = lines.indexOf(BOTTOM);
		const theme = this.chrome.theme();
		const empty = this.getText() === "";
		const frame = this.getText().trimStart().startsWith("!")
			? "accent"
			: this.focused
				? "borderAccent"
				: "border";
		const border = (text: string) => theme.fg(frame, text);
		const body = lines.slice(1, bottom).map((line, row) => {
			const shown =
				empty && row === 0
					? withPlaceholder(line, theme.fg("dim", PLACEHOLDER))
					: row === 0
						? this.slashLine(line, theme, inner)
						: line;
			const clipped = truncateToWidth(tint(shown, theme), inner, "");
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			const prompt = row === 0 ? `${theme.fg("text", "❯")} ` : "  ";
			return `${border("│")} ${prompt}${clipped}${pad}${border("│")}`;
		});
		let above = more("↑", this.hiddenAbove);
		if (visibleWidth(above) + 3 > width) above = "";
		const top =
			border(`╭${above ? "─" : ""}`) +
			theme.fg("dim", above) +
			border(`${rule(width - 2 - (above ? visibleWidth(above) + 1 : 0))}╮`);
		let below = more("↓", this.hiddenBelow);
		if (visibleWidth(below) + 4 > width) below = "";
		const lead = below ? visibleWidth(below) + 1 : 0;
		const room = width - 4 - lead;
		const label = this.chrome.label();
		const caption =
			label && room >= 6 ? truncateToWidth(` ${label} `, room) : "";
		const end =
			border(`╰${below ? "─" : ""}`) +
			theme.fg("dim", below) +
			border(rule(width - 3 - lead - visibleWidth(caption))) +
			caption +
			border("─╯");
		this.menuStart = bottom + 1;
		const menu = this.renderMenu(lines.slice(bottom + 1), width, theme);
		this.menuRows = menu.length;
		const gap = " ".repeat(edge);
		return [...menu, top, ...body, end].map((line) => gap + line);
	}

	renderMenu(lines: string[], width: number, theme: ChromeTheme) {
		if (lines.length === 0) return [];
		const scroll = lines.find((line) => line.includes(SCROLL));
		const items = lines.filter((line) => line !== scroll);
		const rows = items.map((line) => {
			const text = truncateToWidth(
				`${" ".repeat(gutter)}${unmark(line)}`,
				width,
				"",
			);
			const row = text + " ".repeat(Math.max(0, width - visibleWidth(text)));
			const selected = stripTerminalSequences(line).trimStart().startsWith("❯");
			return row
				.split(RESET)
				.map((part) =>
					selected ? theme.bg("selectedBg", part) : theme.fg("text", part),
				)
				.join(RESET);
		});
		const total = scroll?.match(/\/(\d+)\)/)?.[1];
		const empty = items.some((line) => line.includes(EMPTY));
		const count = total ?? String(empty ? 0 : items.length);
		const edge = (size: number) => theme.fg("border", rule(size));
		const head =
			count.length + 2 <= width
				? edge(width - count.length - 1) + theme.fg("dim", count) + edge(1)
				: edge(width);
		return [head, ...rows, edge(width)];
	}

	handleMouse(event: TuiMouseEvent) {
		if (!this.framed) return super.handleMouse(event);
		const inMenu = event.y < this.menuRows;
		if (inMenu && (event.y === 0 || event.y === this.menuRows - 1))
			return undefined;
		const edge = marginFor(event.width);
		return super.handleMouse({
			...event,
			x: event.x - edge - inset,
			y: inMenu ? this.menuStart + event.y - 1 : event.y - this.menuRows,
			width: event.width - edge * 2 - inset - 1,
		});
	}
}

export function createChromeEditor(
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
	chrome: ChromeEditorOptions,
) {
	return new ChromeEditor(tui, theme, keybindings, chrome);
}
