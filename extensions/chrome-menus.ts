// Replicates the logic of Pi 1.6.0 (SelectList.renderItem, SettingsList.renderMainList).
import {
	ExtensionEditorComponent,
	ExtensionInputComponent,
	ExtensionSelectorComponent,
	ModelSelectorComponent,
	OAuthSelectorComponent,
	SessionSelectorComponent,
	SettingsSelectorComponent,
	type Theme,
	ThinkingSelectorComponent,
	TreeSelectorComponent,
	UserMessageSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	type OverlayOptions,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	type SelectListTheme,
	type SettingItem,
	SettingsList,
	Spacer,
	stripTerminalSequences,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { marginFor } from "./chrome-editor.ts";
import {
	createPatchSet,
	type PatchMethod,
	type PatchTarget,
} from "./chrome-patch.ts";
import { densityBinding, narrowScreen, theme } from "./visual-language.ts";

export type MenuTheme = Pick<Theme, "fg" | "bg" | "bold">;
export type Hint = [key: string, action: string];
export type HintSpan = {
	index: number;
	row: number;
	start: number;
	end: number;
};

export const NATIVE: unique symbol = Symbol.for(
	"pi-workflow:chrome-menus:native",
);
const RESET = "\x1b[0m";
const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;
const wideHintGap = "  |  ";
// Below 60 columns hints read `Key action · Key action` from the left (NS-12).
const narrowHintGap = " · ";
const close = " [×] ";

type SelectListState = {
	theme: SelectListTheme & { [NATIVE]?: true };
	selectedIndex: number;
	filteredItems: readonly SelectItem[];
	getVisibleRange(): { startIndex: number; endIndex: number };
	truncatePrimary(
		item: SelectItem,
		isSelected: boolean,
		maxWidth: number,
		columnWidth: number,
	): string;
};

type SettingsListState = {
	items: SettingItem[];
	selectedIndex: number;
	searchEnabled: boolean;
	searchInput?: Component;
	submenuComponent: Component | null;
	submenuItemIndex: number | null;
	onCancel(): void;
	handleInput(data: string): void;
	getDisplayItems(): SettingItem[];
	getVisibleRange(items: SettingItem[]): {
		startIndex: number;
		endIndex: number;
	};
};

export function fit(line: string, width: number, ellipsis = "") {
	return visibleWidth(line) > width
		? truncateToWidth(line, width, ellipsis)
		: line;
}

// Resolved once, when the overlay opens, the way Pi resolves it: an open
// overlay keeps that width across a resize until it is reopened, and only Pi's
// clamp to the columns left can narrow it (NS-09, accepted risk W9).
export function overlayAtOpen(options: OverlayOptions): OverlayOptions {
	const columns = densityBinding()?.terminal.columns;
	if (columns === undefined) return options;
	const { minWidth, ...fixed } = options;
	const { margin } = options;
	const sides =
		typeof margin === "number"
			? margin * 2
			: (margin?.left ?? 0) + (margin?.right ?? 0);
	const room = Math.max(1, columns - Math.max(0, sides));
	if (narrowScreen()) return { ...fixed, width: room };
	const percent = /^(\d+(?:\.\d+)?)%$/.exec(String(options.width));
	const asked =
		typeof options.width === "number"
			? options.width
			: percent
				? Math.floor((columns * Number(percent[1])) / 100)
				: Math.min(80, room);
	return { ...fixed, width: Math.min(Math.max(asked, minWidth ?? 0), room) };
}

export function selectedRow(t: MenuTheme, line: string, width: number) {
	const clipped = fit(line, width);
	const padded =
		clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	return padded
		.split(RESET)
		.map((part) => t.bg("selectedBg", part))
		.join(RESET);
}

export function menuRow(
	t: MenuTheme,
	label: string,
	value: string,
	selected: boolean,
	width: number,
	chevron?: boolean,
	narrow = false,
) {
	const tail = chevron === undefined ? " " : chevron ? " › " : "   ";
	const room = Math.max(0, width - 2 - tail.length);
	const shownValue = truncateToWidth(
		value,
		Math.max(0, room - Math.min(visibleWidth(label), 8) - 1),
		narrow ? "…" : "",
	);
	const valueWidth = visibleWidth(shownValue);
	const shownLabel = truncateToWidth(
		label,
		Math.max(0, room - valueWidth - (valueWidth ? 1 : 0)),
		"…",
	);
	const gap = " ".repeat(
		Math.max(0, room - visibleWidth(shownLabel) - valueWidth),
	);
	const mark = selected
		? t.bold(t.fg("text", "▸ "))
		: narrow
			? "  "
			: t.fg("dim", "▸ ");
	const text = selected
		? t.bold(t.fg("text", shownLabel))
		: t.fg("text", shownLabel);
	const line = fit(
		`${mark}${text}${gap}${shownValue}${t.fg("dim", tail)}`,
		width,
	);
	return selected ? selectedRow(t, line, width) : line;
}

export function sectionRule(t: MenuTheme, label: string, width: number) {
	const title = truncateToWidth(` ${label} `, width, "");
	return (
		t.bold(t.fg("muted", title)) +
		t.fg("border", "─".repeat(Math.max(0, width - visibleWidth(title))))
	);
}

export function hintRows(
	t: MenuTheme,
	hints: Hint[],
	width: number,
	layout: { center?: boolean; narrow?: boolean } = {},
) {
	const { narrow = false } = layout;
	const center = !narrow && (layout.center ?? true);
	const gap = narrow ? narrowHintGap : wideHintGap;
	const rows: number[][] = [[]];
	let used = 0;
	hints.forEach(([key, action], index) => {
		const size = visibleWidth(`${key} ${action}`);
		const row = rows[rows.length - 1];
		if (row.length > 0 && used + gap.length + size > width) {
			rows.push([index]);
			used = size;
		} else {
			row.push(index);
			used += (row.length > 1 ? gap.length : 0) + size;
		}
	});
	const spans: HintSpan[] = [];
	const lines = rows.map((row, y) => {
		const total =
			row.reduce(
				(sum, index) => sum + visibleWidth(hints[index].join(" ")),
				0,
			) +
			gap.length * Math.max(0, row.length - 1);
		let x = center ? Math.max(0, Math.floor((width - total) / 2)) : 0;
		let line = " ".repeat(x);
		row.forEach((index, i) => {
			const [key, action] = hints[index];
			if (i > 0) {
				line += t.fg("dim", gap);
				x += gap.length;
			}
			const size = visibleWidth(`${key} ${action}`);
			spans.push({ index, row: y, start: x, end: x + size });
			line += `${t.bold(t.fg("text", key))} ${t.fg("dim", action)}`;
			x += size;
		});
		return fit(line, width, narrow ? "…" : "");
	});
	return { lines, spans };
}

function framePad(width: number) {
	return width >= 30 ? 2 : width >= 6 ? 1 : 0;
}

function closeSpan(width: number) {
	const start = width - close.length - 2;
	return start > 4 ? { start: start + 1, end: start + 4 } : undefined;
}

export function modalMetrics(width: number, narrow = false) {
	const pad = narrow ? (width >= 6 ? 1 : 0) : framePad(width);
	return {
		pad,
		inner: width - 2 - pad * 2,
		inset: 1 + pad,
		close: closeSpan(width),
	};
}

export function modalFrame(
	t: MenuTheme,
	title: string,
	body: readonly string[],
	width: number,
	narrow = false,
) {
	const cut = narrow ? "…" : "";
	if (width < 4) return body.map((line) => fit(line, width, cut));
	const { pad, inner, close: shutSpan } = modalMetrics(width, narrow);
	const border = (text: string) => t.fg("border", text);
	const shut = shutSpan ? close : "";
	const room = width - 6 - shut.length;
	const name = room >= 1 ? truncateToWidth(title, room, "…") : "";
	const rule = Math.max(
		0,
		width - 4 - (name ? visibleWidth(name) + 2 : 0) - shut.length,
	);
	const top = name
		? `${border("┌─ ")}${t.bold(t.fg("text", name))}${border(` ${"─".repeat(rule)}`)}${t.fg("dim", shut)}${border("─┐")}`
		: `${border(`┌${"─".repeat(rule + 1)}`)}${t.fg("dim", shut)}${border("─┐")}`;
	const side = border("│") + " ".repeat(pad);
	const rows = body.map((line) => {
		const clipped = fit(line, inner, cut);
		const fill = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
		return `${side}${clipped}${fill}${" ".repeat(pad)}${border("│")}`;
	});
	const bottom = border(`└${"─".repeat(width - 2)}┘`);
	return [fit(top, width), ...rows, bottom];
}

function valueStyle(t: MenuTheme, value: string) {
	return /^(off|false)$/.test(value) ? t.fg("dim", value) : t.fg("text", value);
}

const listTheme: SelectListTheme = {
	selectedPrefix: (text) => text,
	selectedText: (text) => text,
	description: (text) => theme().fg("dim", text),
	scrollInfo: (text) => theme().fg("dim", text),
	noMatch: (text) => theme().fg("dim", text),
};

function wrapSelectRender(original: PatchMethod) {
	return function (this: SelectListState, width: number) {
		if (this.theme[NATIVE])
			return (original as (width: number) => readonly string[]).call(
				this,
				width,
			);
		const own = this.theme;
		this.theme = listTheme;
		let lines: string[];
		try {
			lines = (original as (width: number) => readonly string[])
				.call(this, width)
				.map((line) => fit(line, width));
		} finally {
			this.theme = own;
		}
		const rows = settingsPass?.list && submenuRows(this, lines, width);
		if (settingsPass && rows) settingsPass.rows = rows;
		return lines;
	} as PatchMethod;
}

// The lines a component renders after `target`, one of its descendants.
function linesAfter(
	node: unknown,
	target: object,
	width: number,
): string[] | undefined {
	if (node === target) return [];
	// A settings list with an open submenu renders only that submenu.
	const open = (node as Partial<SettingsListState>).submenuComponent;
	if (node instanceof SettingsList && open)
		return linesAfter(open, target, width);
	const { activeComponent, children = [] } = node as {
		activeComponent?: unknown;
		children?: Component[];
	};
	if (activeComponent && children.length === 0)
		return linesAfter(activeComponent, target, width);
	for (const [index, child] of children.entries()) {
		const after = linesAfter(child, target, width);
		if (after)
			return [
				...after,
				...children.slice(index + 1).flatMap((next) => next.render(width)),
			];
	}
	return undefined;
}

// Where a select list in an open settings submenu puts its selection, and the
// rows the submenu renders after it, which end with its hints.
function submenuRows(
	list: SelectListState,
	lines: readonly string[],
	width: number,
): BodyRows | undefined {
	const open = settingsPass?.list?.submenuComponent;
	const after = open ? linesAfter(open, list, width) : undefined;
	if (!after) return undefined;
	const text = after.findIndex(
		(line) => stripTerminalSequences(line).trim() !== "",
	);
	const selected =
		list.filteredItems.length > 0
			? list.selectedIndex - list.getVisibleRange().startIndex
			: -1;
	return {
		count: lines.length + after.length,
		selected,
		hints: lines.length + (text < 0 ? after.length : text),
	};
}

function wrapRenderItem(original: PatchMethod) {
	return function (
		this: SelectListState & { layout: SelectListLayoutOptions },
		item: SelectItem,
		isSelected: boolean,
		width: number,
		descriptionSingleLine: string | undefined,
		primaryColumnWidth: number,
	) {
		if (this.theme[NATIVE])
			return (original as (...args: unknown[]) => string).call(
				this,
				item,
				isSelected,
				width,
				descriptionSingleLine,
				primaryColumnWidth,
			);
		const t = theme();
		const baked = item.label ?? "";
		const current = baked.startsWith("✓ ");
		const shown =
			current || baked.startsWith("  ")
				? { ...item, label: baked.slice(2) }
				: item;
		const prefixWidth = 3;
		const mark = current ? t.fg("text", " ● ") : t.fg("dim", " ○ ");
		const label = (text: string) =>
			isSelected ? t.bold(t.fg("text", text)) : t.fg("text", text);
		const row = (line: string) =>
			isSelected ? selectedRow(t, line, width) : fit(line, width);
		const cut = menuNarrow() ? "…" : "";
		// Pi cuts a label without an ellipsis; below 60 columns it ends with … (NS-13).
		const primary = (maxWidth: number, columnWidth: number) => {
			const fitted = this.truncatePrimary(
				shown,
				isSelected,
				maxWidth,
				columnWidth,
			);
			if (!cut) return fitted;
			const whole = this.truncatePrimary(
				shown,
				isSelected,
				Number.MAX_SAFE_INTEGER,
				columnWidth,
			);
			return visibleWidth(whole) > maxWidth
				? truncateToWidth(whole, maxWidth, cut)
				: fitted;
		};
		if (descriptionSingleLine && width > 40) {
			const effectivePrimaryColumnWidth = Math.max(
				1,
				Math.min(primaryColumnWidth, width - prefixWidth - 4),
			);
			const maxPrimaryWidth = Math.max(
				1,
				effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP,
			);
			const truncatedValue = primary(
				maxPrimaryWidth,
				effectivePrimaryColumnWidth,
			);
			const truncatedValueWidth = visibleWidth(truncatedValue);
			const spacing = " ".repeat(
				Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth),
			);
			const descriptionStart =
				prefixWidth + truncatedValueWidth + spacing.length;
			const remainingWidth = width - descriptionStart - 2;
			if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
				const truncatedDesc = truncateToWidth(
					descriptionSingleLine,
					remainingWidth,
					cut,
				);
				return row(
					`${mark}${label(truncatedValue)}${spacing}${t.fg("dim", truncatedDesc)}`,
				);
			}
		}
		const maxWidth = Math.max(0, width - prefixWidth - 2);
		return row(`${mark}${label(primary(maxWidth, maxWidth))}`);
	} as PatchMethod;
}

type Swap = [Record<string, unknown>, string, unknown];

function dressSearch(input: object, swaps: Swap[]) {
	const t = theme();
	const fields: Record<string, unknown> = {
		prompt: t.fg("dim", "❯ "),
		placeholder: "Type to search",
		placeholderStyle: (text: string) => t.fg("dim", text),
	};
	const slots = input as Record<string, unknown>;
	for (const [key, value] of Object.entries(fields)) {
		swaps.push([slots, key, slots[key]]);
		slots[key] = value;
	}
}

function unswap(swaps: Swap[]) {
	for (const [owner, key, value] of swaps.reverse()) owner[key] = value;
}

function settingsHints(state: SettingsListState, width: number) {
	const hints: Hint[] = [
		...(state.searchEnabled ? [["Type", "search"] as Hint] : []),
		["Enter/Space", "change"],
		["Esc", "cancel"],
	];
	const { lines } = hintRows(theme(), hints, Math.max(1, width - 2), {
		center: false,
		narrow: menuNarrow(),
	});
	return ["", ...lines.map((line) => fit(`  ${line}`, width))];
}

// The last `count` rows of a settings body: the selected one and where the
// hints start among them.
type BodyRows = { count: number; selected: number; hints: number };

// Set while a settings modal renders its list: the modal's opening density and
// its list in, and the rows of the selection and hints out.
let settingsPass:
	| { narrow: boolean; list?: SettingsListState; rows?: BodyRows }
	| undefined;

// A menu inside a settings modal keeps the density the modal opened with; any
// other menu follows the terminal on each render (NS-02, NS-09).
function menuNarrow() {
	return settingsPass?.narrow ?? narrowScreen();
}

function renderMainList(this: SettingsListState, width: number) {
	const t = theme();
	const lines: string[] = [];
	let selected = -1;
	const withHints = () => {
		const hints = lines.length + 1;
		lines.push(...settingsHints(this, width));
		if (settingsPass)
			settingsPass.rows = { count: lines.length, selected, hints };
		return lines;
	};
	if (this.searchEnabled && this.searchInput) {
		const swaps: Swap[] = [];
		try {
			dressSearch(this.searchInput, swaps);
			lines.push(...this.searchInput.render(width));
		} finally {
			unswap(swaps);
		}
		lines.push("");
	}
	if (this.items.length === 0) {
		lines.push(fit(t.fg("dim", "  No settings available"), width));
		return this.searchEnabled ? withHints() : lines;
	}
	const displayItems = this.getDisplayItems();
	if (displayItems.length === 0) {
		lines.push(fit(t.fg("dim", "  No matching settings"), width));
		return withHints();
	}
	const { startIndex, endIndex } = this.getVisibleRange(displayItems);
	for (let i = startIndex; i < endIndex; i++) {
		const item = displayItems[i];
		if (!item) continue;
		const action = !item.submenu && item.values?.length === 1;
		if (i === this.selectedIndex) selected = lines.length;
		lines.push(
			menuRow(
				t,
				item.label,
				action ? "" : valueStyle(t, item.currentValue),
				i === this.selectedIndex,
				width,
				action || Boolean(item.submenu),
				settingsPass?.narrow,
			),
		);
	}
	if (startIndex > 0 || endIndex < displayItems.length) {
		const scrollText = `  (${this.selectedIndex + 1}/${displayItems.length})`;
		lines.push(t.fg("dim", truncateToWidth(scrollText, width - 2, "")));
	}
	const selectedItem = displayItems[this.selectedIndex];
	if (selectedItem?.description) {
		lines.push("");
		for (const line of wrapTextWithAnsi(selectedItem.description, width - 4)) {
			lines.push(fit(t.fg("dim", `  ${line}`), width));
		}
	}
	return withHints();
}

const marks = ["→ ", "› "];

type Styled = { text: string };
type Padded = Styled & { paddingX: number };

function escapeCodes(text: string) {
	return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function codes(t: MenuTheme, color: Parameters<MenuTheme["fg"]>[0]) {
	return t.fg(color, "\u0000").split("\u0000").map(escapeCodes);
}

function restyleTitle(t: MenuTheme, text: string) {
	const plain = stripTerminalSequences(text);
	const forms = [
		t.fg("accent", t.bold(plain)),
		t.bold(t.fg("accent", plain)),
		t.fg("accent", plain),
	];
	return plain.trim() && forms.includes(text)
		? t.bold(t.fg("text", plain))
		: undefined;
}

function restyleLabel(t: MenuTheme, text: string) {
	const tick = t.fg("accent", "✓ ");
	const rest = text.startsWith(tick) ? text.slice(tick.length) : text;
	const at = rest.indexOf("\x1b");
	const plain = at < 0 ? rest : rest.slice(0, at);
	return `${rest === text ? "" : t.fg("text", "● ")}${plain.trim() ? t.fg("text", plain) + rest.slice(plain.length) : rest}`;
}

function restyleRow(t: MenuTheme, text: string, narrow: boolean) {
	const pi = t.fg("accent", "→ ");
	if (!text.startsWith(pi))
		return text.startsWith("  ")
			? (narrow ? "  " : t.fg("dim", "▸ ")) + restyleLabel(t, text.slice(2))
			: text;
	const [open, close] = t.fg("accent", "\u0000").split("\u0000");
	let rest = text.slice(pi.length);
	const tick = t.fg("accent", "✓ ");
	const found = [tick, "  "].find((mark) => rest.startsWith(mark + open)) ?? "";
	rest = rest.slice(found.length);
	const check = found === tick ? t.fg("text", "● ") : found;
	const end = rest.indexOf(close);
	const label = rest.startsWith(open) ? rest.slice(open.length, end) : "";
	const shown =
		end > 0 && label && !label.includes("\x1b")
			? t.bold(t.fg("text", label)) + rest.slice(end + close.length)
			: rest;
	return `${t.bold(t.fg("text", "▸ "))}${check}${shown}`;
}

type Dress = { search?: boolean; pane?: boolean; notices?: boolean };

function isText(child: unknown): child is Padded {
	const node = child as Partial<Padded> | undefined;
	return typeof node?.text === "string" && typeof node.paddingX === "number";
}

function swap(swaps: Swap[], owner: object, key: string, value: unknown) {
	const slots = owner as Record<string, unknown>;
	swaps.push([slots, key, slots[key]]);
	slots[key] = value;
}

function quiet(t: MenuTheme, text: string) {
	const plain = stripTerminalSequences(text);
	return [t.fg("warning", plain), t.fg("success", plain)].includes(text)
		? t.fg("dim", plain)
		: undefined;
}

function hidePane(t: MenuTheme, children: unknown[], swaps: Swap[]) {
	const nested = children.some(
		(child) =>
			child instanceof SettingsList &&
			(child as unknown as SettingsListState).submenuComponent,
	);
	const titled = isText(children[0]);
	children.forEach((child, i) => {
		if (child instanceof Spacer) {
			if (nested || (titled && i === 1)) swap(swaps, child, "lines", 0);
		} else if (isText(child)) {
			const plain = stripTerminalSequences(child.text);
			swap(
				swaps,
				child,
				"text",
				nested || (titled && i === 0) ? "" : t.fg("dim", plain),
			);
		}
	});
}

// The density and width a selector renders at.
type Pass = { narrow: boolean; width: number };

function restyle(
	t: MenuTheme,
	node: unknown,
	swaps: Swap[],
	dress: Dress,
	pass: Pass,
) {
	const active = (node as { activeComponent?: unknown }).activeComponent;
	if (active) restyle(t, active, swaps, dress, pass);
	const children = (node as { children?: unknown[] }).children;
	if (!Array.isArray(children)) return;
	if (dress.pane) hidePane(t, children, swaps);
	const texts = children.filter(isText);
	const listed = texts.some(({ text }) =>
		text.startsWith(t.fg("accent", "→ ")),
	);
	for (const child of texts) {
		const text =
			(pass.narrow ? wrappedHints(t, child, pass.width) : undefined) ??
			(dress.notices ? quiet(t, child.text) : undefined) ??
			restyleTitle(t, child.text) ??
			(listed ? restyleRow(t, child.text, pass.narrow) : child.text);
		if (text !== child.text) swap(swaps, child, "text", text);
	}
	for (const child of children) {
		if (dress.search && child instanceof Input) dressSearch(child, swaps);
		else restyle(t, child, swaps, dress, pass);
	}
}

function piHints(t: MenuTheme, text: string): Hint[] | undefined {
	const [dim, dimEnd] = codes(t, "dim");
	const [muted, mutedEnd] = codes(t, "muted");
	const spoken = new RegExp(`^${dim}  (.+)${dimEnd}$`).exec(text);
	if (spoken && !spoken[1].includes("\x1b")) {
		const hints = spoken[1].split(" · ").map((part) => {
			const at = part.indexOf(" to ");
			return (
				at < 0 ? ["", ""] : [part.slice(0, at), part.slice(at + 4)]
			) as Hint;
		});
		return hints.length > 1 && hints.every(([, action]) => action)
			? hints.filter(([key]) => key)
			: undefined;
	}
	const pair = new RegExp(
		`(?:^|  |${muted} · ${mutedEnd})${dim}([^\\x1b]+)${dimEnd}${muted} ([^\\x1b]+)${mutedEnd}`,
		"y",
	);
	const hints: Hint[] = [];
	let end = 0;
	for (let match = pair.exec(text); match; match = pair.exec(text)) {
		hints.push([match[1], match[2]]);
		end = pair.lastIndex;
	}
	return hints.length > 0 && end === text.length ? hints : undefined;
}

export function displayKey(key: string) {
	if (key === "↑↓") return "↑/↓";
	return key
		.split("/")
		.map((alternative) =>
			alternative
				.split("+")
				.map((part) =>
					/^escape$/i.test(part)
						? "Esc"
						: part.charAt(0).toUpperCase() + part.slice(1),
				)
				.join("+"),
		)
		.join("/");
}

// Pi's hints in `text` as this menu's hint rows, keeping the text's indent.
function ownHints(t: MenuTheme, text: string, width: number, narrow: boolean) {
	const body = text.trim();
	const found = body && piHints(t, body);
	if (!found) return undefined;
	const hints = found.map(([key, action]): Hint => [displayKey(key), action]);
	const shown = stripTerminalSequences(text);
	const lead = shown.length - shown.trimStart().length;
	const { lines } = hintRows(t, hints, Math.max(1, width - lead), {
		center: false,
		narrow,
	});
	return lines.map((line) => " ".repeat(lead) + line);
}

// Below 60 columns a hint text Pi would wrap mid-hint breaks between hints
// instead, so each row reads `Key action · Key action` (NS-12, NS-16).
function wrappedHints(t: MenuTheme, child: Padded, width: number) {
	return ownHints(t, child.text, width - child.paddingX * 2, true)?.join("\n");
}

function restyleHints(line: string, width: number, narrow: boolean) {
	const lines = ownHints(theme(), line, width, narrow);
	return lines?.length === 1 ? fit(lines[0], width) : line;
}

function swapMarker(line: string, width: number) {
	const t = theme();
	const mark = t.bold(t.fg("text", "▸ "));
	for (const styled of [...marks.map((glyph) => t.fg("accent", glyph)), mark]) {
		const at = line.indexOf(styled);
		if (at === -1 || stripTerminalSequences(line.slice(0, at)).trim() !== "")
			continue;
		const swapped = `${line.slice(0, at)}${mark}${line.slice(at + styled.length)}`;
		const open = t.bg("selectedBg", "\u0000").split("\u0000")[0];
		return swapped.includes(open) ? swapped : selectedRow(t, swapped, width);
	}
	return line;
}

function wrapSelectorRender(
	original: PatchMethod,
	root: (self: unknown) => unknown,
	dress: Dress,
	margin: boolean,
) {
	return function (this: unknown, width: number) {
		const node = root(this);
		if (!node)
			return (original as (width: number) => readonly string[]).call(
				this,
				width,
			);
		const edge = margin ? marginFor(width) : 0;
		const inner = width - edge * 2;
		const narrow = menuNarrow();
		const swaps: Swap[] = [];
		try {
			restyle(theme(), node, swaps, dress, { narrow, width: inner });
			return (original as (width: number) => readonly string[])
				.call(this, inner)
				.map(
					(line) =>
						" ".repeat(edge) +
						restyleHints(swapMarker(line, inner), inner, narrow),
				);
		} finally {
			unswap(swaps);
		}
	} as PatchMethod;
}

type MouseHandler = (event: TuiMouseEvent) => TuiMouseEventResult | undefined;

function shifted(event: TuiMouseEvent, left: number, width: number) {
	return { ...event, x: event.x - left, width };
}

function wrapMarginMouse(original: PatchMethod) {
	return function (this: unknown, event: TuiMouseEvent) {
		const edge = marginFor(event.width);
		return (original as MouseHandler).call(
			this,
			shifted(event, edge, event.width - edge * 2),
		);
	} as PatchMethod;
}

type SettingsSelectorState = {
	children: Component[];
	childLines?: {
		width: number;
		children: readonly Component[];
		parts: readonly (readonly string[])[];
		lines: readonly string[];
	};
	getSettingsList(): SettingsList;
};

function findList(node: unknown): SettingsListState | undefined {
	if (node instanceof SettingsList) return node as unknown as SettingsListState;
	const { activeComponent, children } = node as {
		activeComponent?: unknown;
		children?: unknown[];
	};
	for (const child of [activeComponent, ...(children ?? [])]) {
		const found = child ? findList(child) : undefined;
		if (found) return found;
	}
	return undefined;
}

function paneTitle(node: unknown) {
	const [title] = (node as { children?: unknown[] }).children ?? [];
	return isText(title) ? stripTerminalSequences(title.text) : undefined;
}

function crumbs(list: SettingsListState): string[] {
	const open = list.submenuComponent;
	if (!open || list.submenuItemIndex === null) return [];
	const step = (open as { activeComponent?: unknown }).activeComponent;
	const label =
		(step ? paneTitle(step) : undefined) ??
		list.getDisplayItems()[list.submenuItemIndex]?.label ??
		"";
	const nested = findList(open);
	return [label, ...(nested ? crumbs(nested) : [])].filter(Boolean);
}

// Relies on pi-tui 1.6.0 internals, as fixed-header.ts does: TuiAltScreen's
// `mode` and private `layoutRoot`, and the layout-node symbol. Pi renders a
// docked component without telling it its height, so the settings modal adds
// up what the rest of the fullscreen layout takes at its width.
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

type StackEntry = {
	component: Component;
	basis?: number | "auto";
	minSize?: number;
	maxSize?: number;
	visible?(viewport: { width: number; height: number }): boolean;
};
type LayoutNode = { type: string; entries?: StackEntry[]; gap?: number };
type LayoutHost = { mode?: string; layoutRoot?: Component };

function layoutNode(component: Component) {
	const node = (component as { [LAYOUT_NODE]?: () => LayoutNode })[LAYOUT_NODE];
	return typeof node === "function" ? node.call(component) : undefined;
}

function stackOf(
	component: Component,
	viewport: { width: number; height: number },
) {
	const node = layoutNode(component);
	if (!node)
		return {
			gap: 0,
			entries: ((component as { children?: Component[] }).children ?? []).map(
				(child): StackEntry => ({ component: child }),
			),
		};
	if (node.type !== "vstack") return undefined;
	return {
		gap: node.gap ?? 0,
		entries: (node.entries ?? []).filter(
			(entry) => entry.visible?.(viewport) ?? true,
		),
	};
}

function holds(
	component: Component,
	target: object,
	viewport: { width: number; height: number },
): boolean {
	return (
		component === target ||
		(stackOf(component, viewport)?.entries ?? []).some((entry) =>
			holds(entry.component, target, viewport),
		)
	);
}

// The rows left for `target`, and the innermost stack entry that holds it.
type Room = { rows: number; stack?: Component; entry?: Component };

function roomIn(
	component: Component,
	target: object,
	width: number,
	height: number,
	viewport: { width: number; height: number },
): Room | undefined {
	if (component === target) return { rows: height };
	const stack = stackOf(component, viewport);
	const at =
		stack?.entries.findIndex((entry) =>
			holds(entry.component, target, viewport),
		) ?? -1;
	if (!stack || at < 0) return undefined;
	const others = stack.entries.reduce((sum, entry, index) => {
		if (index === at) return sum;
		const natural =
			typeof entry.basis === "number"
				? entry.basis
				: entry.component.render(width).length;
		const least = entry.minSize ?? 0;
		return sum + Math.max(least, Math.min(entry.maxSize ?? natural, natural));
	}, 0);
	const gaps = stack.gap * (stack.entries.length - 1);
	const entry = stack.entries[at].component;
	const inner = roomIn(entry, target, width, height - gaps - others, viewport);
	return inner?.stack || !layoutNode(component)
		? inner
		: inner && { ...inner, stack: component, entry };
}

function dockRoom(target: object, width: number): Room | undefined {
	const bound = densityBinding();
	const rows = bound?.terminal.rows;
	if (rows === undefined) return undefined;
	const host = bound?.host as LayoutHost | undefined;
	const root = host?.mode === "fullscreen" ? host.layoutRoot : undefined;
	const viewport = { width, height: rows };
	return (root && roomIn(root, target, width, rows, viewport)) ?? { rows };
}

// A tall settings modal fixes the size of the stack entry that holds it, so
// Pi's own allocation shrinks the entries around it instead of clipping it.
type Reservation = { entry: Component; selector: object; rows: number };

const reservations = new Map<Component, Reservation>();

function release(stack: Component) {
	if (!reservations.delete(stack)) return;
	Reflect.deleteProperty(stack, LAYOUT_NODE);
}

function reserve(
	stack: Component,
	entry: Component,
	selector: object,
	rows: number | undefined,
) {
	const held = reservations.get(stack);
	if (rows === undefined) {
		if (held?.selector === selector) release(stack);
		return;
	}
	if (held) {
		Object.assign(held, { entry, selector, rows });
		return;
	}
	if (Object.hasOwn(stack, LAYOUT_NODE)) return;
	const reservation: Reservation = { entry, selector, rows };
	reservations.set(stack, reservation);
	const own = Object.getPrototypeOf(stack)[LAYOUT_NODE] as () => LayoutNode;
	Object.defineProperty(stack, LAYOUT_NODE, {
		configurable: true,
		writable: true,
		value() {
			const node = own.call(stack);
			const { entry, selector, rows } = reservation;
			const everywhere = { width: 1, height: Number.MAX_SAFE_INTEGER };
			if (!holds(entry, selector, everywhere)) {
				release(stack);
				return node;
			}
			return {
				...node,
				entries: node.entries?.map((item) =>
					item.component === entry
						? { ...item, minSize: rows, maxSize: rows }
						: item,
				),
			};
		},
	});
}

type BodyWindow = { lines: readonly string[]; row(shown: number): number };

type SettingsView = { narrow: boolean; width: number; window?: BodyWindow };

const settingsViews = new WeakMap<object, SettingsView>();

// Density and width are decided by the first render of each settings modal;
// later renders only narrow it to the columns they get (NS-09, W9).
function settingsView(selector: object, width: number) {
	let view = settingsViews.get(selector);
	if (!view) {
		view = { narrow: narrowScreen(), width };
		settingsViews.set(selector, view);
	}
	return view;
}

// The selected row and the first hint row of a whole settings body.
type BodyLayout = { selected: number; hints: number };

function bodyLayout(
	body: readonly string[],
	rows: BodyRows | undefined,
): BodyLayout | undefined {
	if (!rows) return undefined;
	const offset = body.length - rows.count;
	return {
		selected: rows.selected >= 0 ? offset + rows.selected : -1,
		hints: offset + rows.hints,
	};
}

// A body taller than its room keeps the list's hints in view and scrolls the
// rest around the selected row.
function tallBody(
	body: readonly string[],
	room: number,
	layout: BodyLayout | undefined,
): BodyWindow | undefined {
	if (body.length <= room) return undefined;
	const hints = layout?.hints ?? body.length;
	const pinned = Math.min(body.length - hints, room - 1);
	const rest = body.length - pinned;
	const size = room - pinned;
	const focus = Math.max(0, layout?.selected ?? 0);
	const start = Math.max(
		0,
		Math.min(focus - Math.floor(size / 2), rest - size),
	);
	return {
		lines: [...body.slice(start, start + size), ...body.slice(rest)],
		row: (shown) => (shown < size ? start + shown : rest + shown - size),
	};
}

function settingsFrame(width: number, narrow: boolean) {
	const edge = narrow ? 0 : marginFor(width);
	const outer = width - edge * 2;
	const metrics = modalMetrics(outer, narrow);
	return {
		edge,
		outer,
		left: edge + metrics.inset,
		inner: Math.max(1, metrics.inner),
		top: outer >= 4 ? 1 : 0,
		close: metrics.close,
	};
}

function renderSettings(this: SettingsSelectorState, width: number) {
	const list = this.getSettingsList();
	const view = settingsView(this, width);
	const { edge, outer, inner, top } = settingsFrame(
		Math.min(view.width, width),
		view.narrow,
	);
	const pass: NonNullable<typeof settingsPass> = {
		narrow: view.narrow,
		list: list as unknown as SettingsListState,
	};
	settingsPass = pass;
	let body: readonly string[];
	try {
		body = list.render(inner);
	} finally {
		settingsPass = undefined;
	}
	const layout = bodyLayout(body, pass.rows);
	const room = view.narrow ? dockRoom(this, width) : undefined;
	view.window = undefined;
	if (room) {
		// The frame, the selected row and the hints, when Pi has the rows.
		const pinned = body.length - (layout?.hints ?? body.length);
		const least = top * 2 + Math.min(body.length, pinned + 1);
		const rows = Math.max(room.rows, least);
		view.window = tallBody(body, Math.max(1, rows - top * 2), layout);
		if (room.stack && room.entry)
			reserve(room.stack, room.entry, this, view.window ? rows : undefined);
	}
	const border = Array<string>(top).fill("");
	this.childLines = {
		width: inner,
		children: [this.children[0], list, this.children[this.children.length - 1]],
		parts: [border, body, border],
		lines: [...border, ...body, ...border],
	};
	const title = [
		"Settings",
		...crumbs(list as unknown as SettingsListState),
	].join(" › ");
	return modalFrame(
		theme(),
		title,
		view.window?.lines ?? body,
		outer,
		view.narrow,
	).map((line) => " ".repeat(edge) + line);
}

function closeSettings(list: SettingsListState) {
	for (let depth = 0; list.submenuComponent && depth < 8; depth++)
		list.handleInput("\x1b");
	if (!list.submenuComponent) list.onCancel();
}

function wrapSettingsMouse(original: PatchMethod) {
	return function (this: SettingsSelectorState, event: TuiMouseEvent) {
		const { narrow, width, window } = settingsView(this, event.width);
		const {
			edge,
			outer,
			left,
			inner,
			top,
			close: shut,
		} = settingsFrame(Math.min(width, event.width), narrow);
		const x = event.x - edge;
		if (event.y === 0 && shut && x >= shut.start && x < shut.end) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			closeSettings(this.getSettingsList() as unknown as SettingsListState);
			return { handled: true };
		}
		if (narrow && (event.x < left || event.x >= left + inner)) return undefined;
		// Columns outside the frame, such as those a frame kept from a narrower
		// terminal leaves to its right, reach no setting.
		if (event.x < edge || event.x >= edge + outer) return undefined;
		const row = event.y - top;
		if (window && (row < 0 || row >= window.lines.length)) return undefined;
		const y = window ? top + window.row(row) : event.y;
		const height = event.height + y - event.y;
		return (original as MouseHandler).call(this, {
			...shifted(event, left, inner),
			y,
			height,
		});
	} as PatchMethod;
}

const selectors: [object, Dress][] = [
	[ModelSelectorComponent.prototype, { search: true, notices: true }],
	[SessionSelectorComponent.prototype, {}],
	[TreeSelectorComponent.prototype, {}],
	[UserMessageSelectorComponent.prototype, {}],
	[ExtensionSelectorComponent.prototype, {}],
	[OAuthSelectorComponent.prototype, { search: true }],
	[ExtensionInputComponent.prototype, {}],
	[ExtensionEditorComponent.prototype, {}],
	[ThinkingSelectorComponent.prototype, {}],
];

const targets: PatchTarget[] = [
	{
		proto: SelectList.prototype,
		name: "render",
		create: wrapSelectRender,
		replaces: false,
	},
	{
		proto: SelectList.prototype,
		name: "renderItem",
		create: wrapRenderItem,
		replaces: true,
	},
	{
		proto: SettingsList.prototype,
		name: "renderMainList",
		create: () => renderMainList as PatchMethod,
		replaces: true,
	},
	{
		proto: SettingsList.prototype,
		name: "render",
		create: (original) =>
			wrapSelectorRender(
				original,
				(list) => (list as SettingsListState).submenuComponent,
				{ search: true, pane: true },
				false,
			),
		replaces: false,
	},
	{
		proto: SettingsSelectorComponent.prototype,
		name: "render",
		create: () => renderSettings as PatchMethod,
		replaces: false,
	},
	{
		proto: SettingsSelectorComponent.prototype,
		name: "handleMouse",
		create: wrapSettingsMouse,
		replaces: false,
	},
	...selectors.flatMap(([proto, dress]) => [
		{
			proto,
			name: "render",
			create: (original: PatchMethod) =>
				wrapSelectorRender(original, (self) => self, dress, true),
			replaces: false,
		},
		{ proto, name: "handleMouse", create: wrapMarginMouse, replaces: false },
	]),
];

const patchSet = createPatchSet("chrome-menus", targets);

export function patchMenus() {
	patchSet.patch();
}

export function restoreMenus() {
	for (const stack of [...reservations.keys()]) release(stack);
	patchSet.restore();
}
