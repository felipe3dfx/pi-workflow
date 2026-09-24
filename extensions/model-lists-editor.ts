import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	fuzzyFilter,
	Input,
	Key,
	type KeybindingsManager,
	matchesKey,
	type SelectItem,
	SelectList,
	type SelectListTheme,
	truncateToWidth,
} from "@earendil-works/pi-tui";

type Entry = { model: string; thinking: string };

export type EditableLists = {
	specialists: Record<string, Entry[]>;
	tiers: Record<string, Entry[]>;
	taskTypes: Record<string, string | undefined>;
};

export type CatalogModel = {
	model: string;
	available: boolean;
	thinking: string[];
};

type Screen = {
	title: string;
	hint: string;
	blocksSave?: boolean;
	render(width: number): string[];
	handleInput(data: string): void;
};

const UNSAFE_TERMINAL_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/gu;
const VISIBLE_ROWS = 10;

function sanitize(text: string): string {
	return text.replace(UNSAFE_TERMINAL_CHARACTERS, " ");
}

function printable(data: string): string {
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

export function createModelListsEditor(
	lists: EditableLists,
	catalog: CatalogModel[],
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (action: "save" | "exit") => void,
): Component {
	const listTheme = selectListTheme(theme);
	const stack: Screen[] = [];
	const push = (screen: Screen) => stack.push(screen);
	const pop = () => stack.pop();
	const taskTypes = Object.keys(lists.specialists);
	const tiers = Object.keys(lists.tiers);

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

	function thinkingScreen(
		model: string,
		levels: string[],
		add: (entry: Entry) => void,
	): Screen {
		const list = selectList(
			levels.map((level) => ({ value: level, label: level })),
			(item) => {
				pop();
				add({ model, thinking: item.value });
			},
		);
		return {
			title: `Thinking level for ${sanitize(model)}`,
			hint: "↑↓ choose · Enter confirm · Esc back",
			blocksSave: true,
			render: (width) => list.render(width),
			handleInput: (data) => list.handleInput(data),
		};
	}

	function catalogScreen(add: (entry: Entry) => void): Screen {
		const input = new Input();
		input.focused = true;
		const items = catalog.map((entry) => ({
			value: entry.model,
			label: sanitize(entry.model),
			description: entry.available ? "available" : "no credentials",
		}));
		const choose = (item: SelectItem) => {
			pop();
			push(
				thinkingScreen(
					item.value,
					catalog.find((entry) => entry.model === item.value)?.thinking ?? [],
					add,
				),
			);
		};
		let filtered = items;
		let list = selectList(filtered, choose);
		return {
			title: "Add a model from the catalog",
			blocksSave: true,
			hint: "Type to filter · ↑↓ choose · Enter select · Esc back",
			render(width) {
				const [filter] = input.render(width);
				if (filtered.length === 0) return [filter, "  No matches"];
				return [filter, ...list.render(width)];
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
				input.setValue(sanitize(input.getValue()));
				filtered = fuzzyFilter(items, input.getValue(), (item) => item.value);
				list = selectList(filtered, choose);
			},
		};
	}

	function entriesScreen(title: string, entries: Entry[]): Screen {
		let list = rebuild(0);
		function rebuild(selected: number): SelectList {
			return selectList(
				entries.map((entry, index) => ({
					value: String(index),
					label: `${index + 1}  ${sanitize(entry.model)}`,
					description: `thinking: ${entry.thinking}`,
				})),
				() => {},
				selected,
			);
		}
		const selectedIndex = () => Number(list.getSelectedItem()?.value ?? 0);
		const move = (offset: number) => {
			const from = selectedIndex();
			const to = from + offset;
			if (to < 0 || to >= entries.length) return;
			[entries[from], entries[to]] = [entries[to], entries[from]];
			list = rebuild(to);
		};
		return {
			title,
			hint: "a add · d remove · Shift+↑↓ move · t thinking · s save · Esc back",
			render(width) {
				if (entries.length === 0) return ["  (empty)"];
				return list.render(width);
			},
			handleInput(data) {
				const key = printable(data);
				if (key === "a") {
					push(
						catalogScreen((entry) => {
							entries.push(entry);
							list = rebuild(entries.length - 1);
						}),
					);
				} else if (key === "d" && entries.length > 0) {
					const index = selectedIndex();
					entries.splice(index, 1);
					list = rebuild(Math.min(index, entries.length - 1));
				} else if (key === "t" && entries.length > 0) {
					const entry = entries[selectedIndex()];
					const levels = catalog.find(
						(candidate) => candidate.model === entry.model,
					)?.thinking ?? [entry.thinking];
					entry.thinking =
						levels[(levels.indexOf(entry.thinking) + 1) % levels.length];
					list = rebuild(selectedIndex());
				} else if (matchesKey(data, Key.shift("up"))) {
					move(-1);
				} else if (matchesKey(data, Key.shift("down"))) {
					move(1);
				} else {
					list.handleInput(data);
				}
			},
		};
	}

	function sectionScreen(
		title: string,
		prefix: string,
		section: Record<string, Entry[]>,
	): Screen {
		const items = Object.keys(section).map((key) => ({
			value: key,
			label: key,
			description: "",
		}));
		const list = selectList(items, (item) =>
			push(entriesScreen(`${prefix}: ${item.value}`, section[item.value])),
		);
		return {
			title,
			hint: "↑↓ choose · Enter open · s save · Esc back",
			render(width) {
				for (const item of items) {
					item.description = `${section[item.value].length} models`;
				}
				return list.render(width);
			},
			handleInput: (data) => list.handleInput(data),
		};
	}

	function mapScreen(title: string): Screen {
		const typeWidth = Math.max(...taskTypes.map((type) => type.length));
		const tierLabel = (type: string) =>
			`${type.padEnd(typeWidth)}  ◂ ${lists.taskTypes[type] ?? "—"} ▸`;
		const items = taskTypes.map((type) => ({
			value: type,
			label: tierLabel(type),
		}));
		const list = selectList(items, () => {});
		const cycle = (offset: number) => {
			const item = list.getSelectedItem();
			if (!item) return;
			const stops = [...tiers, undefined];
			lists.taskTypes[item.value] =
				stops[
					(stops.indexOf(lists.taskTypes[item.value]) + offset + stops.length) %
						stops.length
				];
			item.label = tierLabel(item.value);
		};
		return {
			title,
			hint: "↑↓ choose · ←→ change tier · s save · Esc back",
			render: (width) => list.render(width),
			handleInput(data) {
				if (matchesKey(data, Key.left)) cycle(-1);
				else if (matchesKey(data, Key.right)) cycle(1);
				else list.handleInput(data);
			},
		};
	}

	const sections: Array<[string, (title: string) => Screen]> = [
		[
			"Specialists by task type",
			(title) => sectionScreen(title, "Specialists", lists.specialists),
		],
		[
			"Tiers (quick · standard · high)",
			(title) => sectionScreen(title, "Tier", lists.tiers),
		],
		["Map: task type → tier", mapScreen],
	];
	const root = new SelectList(
		sections.map(([label]) => ({ value: label, label })),
		VISIBLE_ROWS,
		listTheme,
	);
	root.onSelect = (item) => {
		const open = sections.find(([label]) => label === item.value)?.[1];
		if (open) push(open(item.value));
	};
	root.onCancel = () => done("exit");
	push({
		title: "Model lists",
		hint: "↑↓ choose · Enter open · s save · Esc exit",
		render: (width) => root.render(width),
		handleInput: (data) => root.handleInput(data),
	});

	return {
		render(width) {
			const screen = stack[stack.length - 1];
			return [
				theme.bold(screen.title),
				...screen.render(width),
				theme.fg("dim", screen.hint),
			].map((line) => truncateToWidth(line, width));
		},
		invalidate() {},
		handleInput(data) {
			const screen = stack[stack.length - 1];
			if (!screen.blocksSave && printable(data) === "s") done("save");
			else screen.handleInput(data);
		},
	};
}
