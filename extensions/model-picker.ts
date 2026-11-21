import {
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelRegistry, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	fuzzyFilter,
	Input,
	type KeybindingsManager,
	type SelectItem,
	SelectList,
	type SelectListTheme,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";

import {
	type Hint,
	hintRows,
	menuRow,
	modalFrame,
	modalMetrics,
	sectionRule,
} from "./chrome-menus.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";

export type Screen = {
	title: string;
	hints: Hint[];
	render(width: number): string[];
	handleInput(data: string): void;
};

const VISIBLE_ROWS = 10;

export const pickerOverlay = {
	overlay: true,
	overlayOptions: {
		anchor: "center",
		width: "70%",
		minWidth: 44,
		maxHeight: "100%",
	},
} as const;

export function modelChoices(
	registry: Pick<ModelRegistry, "getAvailable" | "getAll">,
) {
	const name = (entry: { provider: string; id: string }) =>
		`${entry.provider}/${entry.id}`;
	const catalog = registry.getAvailable().map(name);
	const supportedThinking = Object.fromEntries(
		registry
			.getAll()
			.map((entry) => [name(entry), getSupportedThinkingLevels(entry)]),
	);
	return { catalog, supportedThinking };
}

export function printable(data: string): string {
	return decodeKittyPrintable(data) ?? data;
}

function selectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("dim", text),
		noMatch: (text) => theme.fg("dim", text),
	};
}

export function createScreenFrame(
	theme: Theme,
	keybindings: KeybindingsManager,
	terminalRows: () => number,
	close: () => void,
) {
	const listTheme = selectListTheme(theme);
	const stack: Screen[] = [];
	let notice = "";
	let visible = VISIBLE_ROWS;
	let frameWidth = 0;

	const push = (screen: Screen) => stack.push(screen);
	const pop = () => {
		if (stack.length > 1) stack.pop();
		else close();
	};

	function rows(
		list: SelectList,
		items: SelectItem[],
		width: number,
		chevron?: boolean,
	): string[] {
		const selected = Math.max(
			0,
			items.findIndex((item) => item.value === list.getSelectedItem()?.value),
		);
		const start = Math.max(
			0,
			Math.min(selected - Math.floor(visible / 2), items.length - visible),
		);
		const shown = items
			.slice(start, start + visible)
			.map((item, i) =>
				menuRow(
					theme,
					item.label,
					item.description ?? "",
					start + i === selected,
					width,
					chevron,
				),
			);
		if (items.length > visible) {
			shown.push(theme.fg("dim", `(${selected + 1}/${items.length})`));
		}
		return shown;
	}

	function selectList(
		items: SelectItem[],
		onSelect: (item: SelectItem) => void,
		selected = 0,
	): SelectList {
		const list = new SelectList(items, VISIBLE_ROWS, listTheme);
		list.setSelectedIndex(selected);
		list.onSelect = onSelect;
		list.onCancel = pop;
		return list;
	}

	const component: Component = {
		render(width) {
			frameWidth = width;
			const screen = stack[stack.length - 1];
			const inner = Math.max(1, modalMetrics(width).inner);
			const head = ["", ...(notice ? [theme.fg("warning", notice), ""] : [])];
			const tail = ["", ...hintRows(theme, screen.hints, inner).lines];
			const room = Math.max(0, terminalRows() - 2);
			const space = room - head.length - tail.length;
			visible = Math.max(1, Math.min(VISIBLE_ROWS, space - 3));
			const body = space > 0 ? screen.render(inner).slice(0, space) : [];
			const content = [...head, ...body, ...tail];
			return modalFrame(
				theme,
				screen.title,
				content.slice(Math.max(0, content.length - room)),
				width,
			);
		},
		handleMouse(event: TuiMouseEvent) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			const shut = modalMetrics(frameWidth).close;
			if (event.y !== 0 || !shut || event.x < shut.start || event.x >= shut.end)
				return undefined;
			close();
			return { handled: true };
		},
		invalidate() {},
		handleInput(data) {
			notice = "";
			stack[stack.length - 1].handleInput(data);
		},
	};

	return {
		push,
		pop,
		notify: (text: string) => {
			notice = text;
		},
		rows,
		selectList,
		keybindings,
		theme,
		component,
	};
}

export type ScreenFrame = ReturnType<typeof createScreenFrame>;

function thinkingScreen(
	frame: ScreenFrame,
	levels: ModelThinkingLevel[],
	model: string,
	choose: (thinking: ModelThinkingLevel) => void,
): Screen {
	const items = levels.map((level) => ({ value: level, label: level }));
	const list = frame.selectList(items, (item) =>
		choose(item.value as ModelThinkingLevel),
	);
	return {
		title: `Thinking level for ${terminalSafeLine(model)}`,
		hints: [
			["↑/↓", "choose"],
			["Enter", "confirm"],
			["Esc", "back"],
		],
		render: (width) => [
			sectionRule(frame.theme, "Thinking", width),
			...frame.rows(list, items, width),
		],
		handleInput: (data) => list.handleInput(data),
	};
}

export function modelCatalogScreen(
	frame: ScreenFrame,
	catalog: string[],
	supportedThinking: Record<string, ModelThinkingLevel[]>,
	title: string,
	choose: (model: string, thinking: ModelThinkingLevel) => void,
	escapeHint: "back" | "close" = "back",
): Screen {
	const { keybindings, theme } = frame;
	const input = new Input();
	input.focused = true;
	const items = catalog
		.filter((model) => (supportedThinking[model] ?? []).length > 0)
		.map((model) => ({
			value: model,
			label: terminalSafeLine(model),
		}));
	const pick = (item: SelectItem) =>
		frame.push(
			thinkingScreen(
				frame,
				supportedThinking[item.value] ?? [],
				item.value,
				(thinking) => choose(item.value, thinking),
			),
		);
	let filtered = items;
	let list = frame.selectList(filtered, pick);
	return {
		title,
		hints: [
			["type", "filter"],
			["↑/↓", "choose"],
			["Enter", "select"],
			["Esc", escapeHint],
		],
		render(width) {
			const [filter] = input.render(width);
			const rule = sectionRule(theme, "Models", width);
			if (filtered.length === 0)
				return [filter, rule, theme.fg("dim", "No matches")];
			return [filter, rule, ...frame.rows(list, filtered, width, true)];
		},
		handleInput(data) {
			const cancel = keybindings.matches(data, "tui.select.cancel");
			if (
				cancel ||
				keybindings.matches(data, "tui.select.up") ||
				keybindings.matches(data, "tui.select.down") ||
				keybindings.matches(data, "tui.select.confirm")
			) {
				if (filtered.length > 0 || cancel) {
					list.handleInput(data);
				}
				return;
			}
			input.handleInput(data);
			input.setValue(terminalSafeLine(input.getValue()));
			filtered = fuzzyFilter(items, input.getValue(), (item) => item.value);
			list = frame.selectList(filtered, pick);
		},
	};
}
