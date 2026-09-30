// Replicates the logic of Pi 0.99.1 (SelectList.renderItem, SettingsList.renderMainList).
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
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const ORIGINAL = Symbol.for("pi-workflow:chrome-menus:original");
const INHERITED = Symbol.for("pi-workflow:chrome-menus:inherited");
const RESET = "\x1b[0m";
const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;
const hintGap = "  |  ";
const close = " [×] ";

type Method = ((...args: never[]) => unknown) & {
	[ORIGINAL]?: Method;
	[INHERITED]?: boolean;
};

type SelectListState = {
	theme: SelectListTheme & { [NATIVE]?: true };
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

function theme() {
	const current = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
	if (!current)
		throw new Error("Theme not initialized. Call initTheme() first.");
	return current;
}

export function fit(line: string, width: number) {
	return visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
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
) {
	const tail = chevron === undefined ? " " : chevron ? " › " : "   ";
	const room = Math.max(0, width - 2 - tail.length);
	const shownValue = truncateToWidth(
		value,
		Math.max(0, room - Math.min(visibleWidth(label), 8) - 1),
		"",
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
	const mark = selected ? t.bold(t.fg("text", "▸ ")) : t.fg("dim", "▸ ");
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
	center = true,
) {
	const rows: number[][] = [[]];
	let used = 0;
	hints.forEach(([key, action], index) => {
		const size = visibleWidth(`${key} ${action}`);
		const row = rows[rows.length - 1];
		if (row.length > 0 && used + hintGap.length + size > width) {
			rows.push([index]);
			used = size;
		} else {
			row.push(index);
			used += (row.length > 1 ? hintGap.length : 0) + size;
		}
	});
	const spans: HintSpan[] = [];
	const lines = rows.map((row, y) => {
		const total =
			row.reduce(
				(sum, index) => sum + visibleWidth(hints[index].join(" ")),
				0,
			) +
			hintGap.length * Math.max(0, row.length - 1);
		let x = center ? Math.max(0, Math.floor((width - total) / 2)) : 0;
		let line = " ".repeat(x);
		row.forEach((index, i) => {
			const [key, action] = hints[index];
			if (i > 0) {
				line += t.fg("dim", hintGap);
				x += hintGap.length;
			}
			const size = visibleWidth(`${key} ${action}`);
			spans.push({ index, row: y, start: x, end: x + size });
			line += `${t.bold(t.fg("text", key))} ${t.fg("dim", action)}`;
			x += size;
		});
		return fit(line, width);
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

export function modalMetrics(width: number) {
	const pad = framePad(width);
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
	body: string[],
	width: number,
) {
	if (width < 4) return body.map((line) => fit(line, width));
	const { pad, inner, close: shutSpan } = modalMetrics(width);
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
		const clipped = fit(line, inner);
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

function wrapSelectRender(original: Method) {
	return function (this: SelectListState, width: number) {
		if (this.theme[NATIVE])
			return (original as (width: number) => string[]).call(this, width);
		const own = this.theme;
		this.theme = listTheme;
		try {
			return (original as (width: number) => string[])
				.call(this, width)
				.map((line) => fit(line, width));
		} finally {
			this.theme = own;
		}
	} as Method;
}

function wrapRenderItem(original: Method) {
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
		if (descriptionSingleLine && width > 40) {
			const effectivePrimaryColumnWidth = Math.max(
				1,
				Math.min(primaryColumnWidth, width - prefixWidth - 4),
			);
			const maxPrimaryWidth = Math.max(
				1,
				effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP,
			);
			const truncatedValue = this.truncatePrimary(
				shown,
				isSelected,
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
					"",
				);
				return row(
					`${mark}${label(truncatedValue)}${spacing}${t.fg("dim", truncatedDesc)}`,
				);
			}
		}
		const maxWidth = Math.max(0, width - prefixWidth - 2);
		const truncatedValue = this.truncatePrimary(
			shown,
			isSelected,
			maxWidth,
			maxWidth,
		);
		return row(`${mark}${label(truncatedValue)}`);
	} as Method;
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
	const { lines } = hintRows(theme(), hints, Math.max(1, width - 2), false);
	return ["", ...lines.map((line) => fit(`  ${line}`, width))];
}

function renderMainList(this: SettingsListState, width: number) {
	const t = theme();
	const lines: string[] = [];
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
		if (this.searchEnabled) lines.push(...settingsHints(this, width));
		return lines;
	}
	const displayItems = this.getDisplayItems();
	if (displayItems.length === 0) {
		lines.push(fit(t.fg("dim", "  No matching settings"), width));
		lines.push(...settingsHints(this, width));
		return lines;
	}
	const { startIndex, endIndex } = this.getVisibleRange(displayItems);
	for (let i = startIndex; i < endIndex; i++) {
		const item = displayItems[i];
		if (!item) continue;
		const action = !item.submenu && item.values?.length === 1;
		lines.push(
			menuRow(
				t,
				item.label,
				action ? "" : valueStyle(t, item.currentValue),
				i === this.selectedIndex,
				width,
				action || Boolean(item.submenu),
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
	lines.push(...settingsHints(this, width));
	return lines;
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

function restyleRow(t: MenuTheme, text: string) {
	const pi = t.fg("accent", "→ ");
	if (!text.startsWith(pi))
		return text.startsWith("  ")
			? t.fg("dim", "▸ ") + restyleLabel(t, text.slice(2))
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

function isText(child: unknown): child is Styled {
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

function restyle(t: MenuTheme, node: unknown, swaps: Swap[], dress: Dress) {
	const active = (node as { activeComponent?: unknown }).activeComponent;
	if (active) restyle(t, active, swaps, dress);
	const children = (node as { children?: unknown[] }).children;
	if (!Array.isArray(children)) return;
	if (dress.pane) hidePane(t, children, swaps);
	const texts = children.filter(isText);
	const listed = texts.some(({ text }) =>
		text.startsWith(t.fg("accent", "→ ")),
	);
	for (const child of texts) {
		const text =
			(dress.notices ? quiet(t, child.text) : undefined) ??
			restyleTitle(t, child.text) ??
			(listed ? restyleRow(t, child.text) : child.text);
		if (text !== child.text) swap(swaps, child, "text", text);
	}
	for (const child of children) {
		if (dress.search && child instanceof Input) dressSearch(child, swaps);
		else restyle(t, child, swaps, dress);
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

function restyleHints(line: string, width: number) {
	const body = line.trim();
	const found = body && piHints(theme(), body);
	if (!found) return line;
	const hints = found.map(([key, action]): Hint => [displayKey(key), action]);
	const shown = stripTerminalSequences(line);
	const lead = shown.length - shown.trimStart().length;
	const { lines } = hintRows(theme(), hints, Math.max(1, width - lead), false);
	return lines.length === 1 ? fit(" ".repeat(lead) + lines[0], width) : line;
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
	original: Method,
	root: (self: unknown) => unknown,
	dress: Dress,
	margin: boolean,
) {
	return function (this: unknown, width: number) {
		const node = root(this);
		if (!node)
			return (original as (width: number) => string[]).call(this, width);
		const edge = margin ? marginFor(width) : 0;
		const inner = width - edge * 2;
		const swaps: Swap[] = [];
		try {
			restyle(theme(), node, swaps, dress);
			return (original as (width: number) => string[])
				.call(this, inner)
				.map(
					(line) =>
						" ".repeat(edge) + restyleHints(swapMarker(line, inner), inner),
				);
		} finally {
			unswap(swaps);
		}
	} as Method;
}

type MouseHandler = (event: TuiMouseEvent) => TuiMouseEventResult | undefined;

function shifted(event: TuiMouseEvent, left: number, width: number) {
	return { ...event, x: event.x - left, width };
}

function wrapMarginMouse(original: Method) {
	return function (this: unknown, event: TuiMouseEvent) {
		const edge = marginFor(event.width);
		return (original as MouseHandler).call(
			this,
			shifted(event, edge, event.width - edge * 2),
		);
	} as Method;
}

type SettingsSelectorState = {
	children: Component[];
	mouseLayout?: {
		width: number;
		children: { component: Component; height: number }[];
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

function settingsFrame(width: number) {
	const edge = marginFor(width);
	const outer = width - edge * 2;
	const metrics = modalMetrics(outer);
	return {
		edge,
		outer,
		left: edge + metrics.inset,
		inner: Math.max(1, metrics.inner),
		top: outer >= 4 ? 1 : 0,
	};
}

function renderSettings(this: SettingsSelectorState, width: number) {
	const list = this.getSettingsList();
	const { edge, outer, inner, top } = settingsFrame(width);
	const body = list.render(inner);
	this.mouseLayout = {
		width: inner,
		children: [
			{ component: this.children[0], height: top },
			{ component: list, height: body.length },
			{ component: this.children[this.children.length - 1], height: top },
		],
	};
	const title = [
		"Settings",
		...crumbs(list as unknown as SettingsListState),
	].join(" › ");
	return modalFrame(theme(), title, body, outer).map(
		(line) => " ".repeat(edge) + line,
	);
}

function closeSettings(list: SettingsListState) {
	for (let depth = 0; list.submenuComponent && depth < 8; depth++)
		list.handleInput("\x1b");
	if (!list.submenuComponent) list.onCancel();
}

function wrapSettingsMouse(original: Method) {
	return function (this: SettingsSelectorState, event: TuiMouseEvent) {
		const { edge, outer, left, inner } = settingsFrame(event.width);
		const shut = modalMetrics(outer).close;
		const x = event.x - edge;
		if (event.y === 0 && shut && x >= shut.start && x < shut.end) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			closeSettings(this.getSettingsList() as unknown as SettingsListState);
			return { handled: true };
		}
		return (original as MouseHandler).call(this, shifted(event, left, inner));
	} as Method;
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

const targets: {
	proto: object;
	name: string;
	create: (original: Method) => Method;
	replaces: boolean;
}[] = [
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
		create: () => renderMainList as Method,
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
		create: () => renderSettings as Method,
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
			create: (original: Method) =>
				wrapSelectorRender(original, (self) => self, dress, true),
			replaces: false,
		},
		{ proto, name: "handleMouse", create: wrapMarginMouse, replaces: false },
	]),
];

function slot(proto: object) {
	return proto as Record<string, Method | undefined>;
}

function pristine(method: Method, name: string) {
	return Function.prototype.toString.call(method).startsWith(`${name}(`);
}

export function patchMenus() {
	for (const { proto, name, create, replaces } of targets) {
		const current = slot(proto)[name];
		if (!current) continue;
		const original = current[ORIGINAL] ?? current;
		if (replaces && !pristine(original, name)) continue;
		const inherited = current[ORIGINAL]
			? current[INHERITED]
			: !Object.hasOwn(proto, name);
		const patched = create(original);
		patched[ORIGINAL] = original;
		patched[INHERITED] = inherited;
		slot(proto)[name] = patched;
	}
}

export function restoreMenus() {
	for (const { proto, name } of targets) {
		const current = slot(proto)[name];
		if (!current?.[ORIGINAL]) continue;
		if (current[INHERITED]) delete slot(proto)[name];
		else slot(proto)[name] = current[ORIGINAL];
	}
}
