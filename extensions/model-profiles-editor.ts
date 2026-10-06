import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
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
import {
	type EditableProfiles,
	profileName,
	type Specialist,
	specialists,
} from "./model-profiles.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";

type Screen = {
	title: string;
	hints: Hint[];
	blocksSave?: boolean;
	render(width: number): string[];
	handleInput(data: string): void;
};

const VISIBLE_ROWS = 10;

function sanitize(text: string): string {
	return terminalSafeLine(text);
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

export function createModelProfilesEditor(
	state: EditableProfiles,
	catalog: string[],
	supportedThinking: Record<string, ModelThinkingLevel[]>,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (action: "save" | "exit") => void,
	terminalRows: () => number,
): Component {
	const listTheme = selectListTheme(theme);
	const stack: Screen[] = [];
	const push = (screen: Screen) => stack.push(screen);
	const pop = () => stack.pop();
	let notice = "";
	let visible = VISIBLE_ROWS;
	let frameWidth = 0;

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

	function nameScreen(
		title: string,
		initial: string,
		accept: (name: string) => void,
		unchanged?: string,
	): Screen {
		const input = new Input();
		input.focused = true;
		for (const character of initial) input.handleInput(character);
		input.onEscape = pop;
		input.onSubmit = (value) => {
			const name = value.trim();
			if (name === unchanged) {
				pop();
			} else if (!profileName.test(name)) {
				notice =
					"Use 1 to 64 lowercase letters, digits, or hyphens for the name.";
			} else if (Object.hasOwn(state.profiles, name)) {
				notice = `A profile named ${name} already exists.`;
			} else {
				pop();
				accept(name);
			}
		};
		return {
			title,
			hints: [
				["type", "name"],
				["Enter", "confirm"],
				["Esc", "back"],
			],
			blocksSave: true,
			render: (width) => input.render(width),
			handleInput(data) {
				input.handleInput(data);
				input.setValue(sanitize(input.getValue()));
			},
		};
	}

	function confirmScreen(title: string, accept: () => void): Screen {
		return {
			title,
			hints: [
				["y", "delete"],
				["n/Esc", "keep"],
			],
			blocksSave: true,
			render: () => [],
			handleInput(data) {
				const key = printable(data);
				if (key === "y") {
					pop();
					accept();
				} else if (
					key === "n" ||
					keybindings.matches(data, "tui.select.cancel")
				) {
					pop();
				}
			},
		};
	}

	function thinkingScreen(
		model: string,
		choose: (thinking: ModelThinkingLevel) => void,
	): Screen {
		const levels = supportedThinking[model] ?? [];
		const items = levels.map((level) => ({ value: level, label: level }));
		const list = selectList(items, (item) =>
			choose(item.value as ModelThinkingLevel),
		);
		return {
			title: `Thinking level for ${sanitize(model)}`,
			hints: [
				["↑/↓", "choose"],
				["Enter", "confirm"],
				["Esc", "back"],
			],
			blocksSave: true,
			render: (width) => [
				sectionRule(theme, "Thinking", width),
				...rows(list, items, width),
			],
			handleInput: (data) => list.handleInput(data),
		};
	}

	function catalogScreen(
		title: string,
		set: (model: string, thinking: ModelThinkingLevel) => void,
	): Screen {
		const input = new Input();
		input.focused = true;
		const items = catalog
			.filter((model) => (supportedThinking[model] ?? []).length > 0)
			.map((model) => ({
				value: model,
				label: sanitize(model),
			}));
		const choose = (item: SelectItem) =>
			push(
				thinkingScreen(item.value, (thinking) => {
					pop();
					pop();
					set(item.value, thinking);
				}),
			);
		let filtered = items;
		let list = selectList(filtered, choose);
		return {
			title,
			blocksSave: true,
			hints: [
				["type", "filter"],
				["↑/↓", "choose"],
				["Enter", "select"],
				["Esc", "back"],
			],
			render(width) {
				const [filter] = input.render(width);
				const rule = sectionRule(theme, "Models", width);
				if (filtered.length === 0)
					return [filter, rule, theme.fg("dim", "No matches")];
				return [filter, rule, ...rows(list, filtered, width, true)];
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

	function profileScreen(name: string): Screen {
		const profile = () => state.profiles[name];
		const items = () =>
			specialists.map((specialist) => {
				const entry = profile()[specialist];
				return {
					value: specialist,
					label: specialist,
					description: entry
						? theme.fg(
								"text",
								`${sanitize(entry.model)} · thinking: ${entry.thinking}`,
							)
						: theme.fg("dim", "inherits session model"),
				};
			});
		let list = rebuild(0);
		function rebuild(selected: number): SelectList {
			return selectList(
				items(),
				(item) => {
					const specialist = item.value as Specialist;
					push(
						catalogScreen(
							`${sanitize(name)} · ${specialist} model`,
							(model, thinking) => {
								profile()[specialist] = { model, thinking };
								list = rebuild(specialists.indexOf(specialist));
							},
						),
					);
				},
				selected,
			);
		}
		const selectedIndex = () =>
			specialists.indexOf(list.getSelectedItem()?.value as Specialist);
		return {
			get title() {
				return `Profile ${sanitize(name)}${state.active === name ? " (active)" : ""}`;
			},
			hints: [
				["↑/↓", "choose"],
				["Enter", "pick model"],
				["i", "inherit"],
				["s", "save"],
				["Esc", "back"],
			],
			render: (width) => [
				sectionRule(theme, "Specialists", width),
				...rows(list, items(), width, true),
			],
			handleInput(data) {
				if (printable(data) === "i") {
					const index = selectedIndex();
					delete profile()[specialists[index]];
					list = rebuild(index);
				} else {
					list.handleInput(data);
				}
			},
		};
	}

	function profilesScreen(): Screen {
		const names = () => Object.keys(state.profiles);
		let items: SelectItem[] = [];
		const rebuild = (selected: number) => {
			items = names().map((name) => ({
				value: name,
				label: sanitize(name),
				description:
					name === state.active
						? `${theme.fg("accent", "●")} ${theme.fg("text", "active")}`
						: "",
			}));
			const list = new SelectList(items, VISIBLE_ROWS, listTheme);
			list.setSelectedIndex(selected);
			list.onSelect = (item) => push(profileScreen(item.value));
			list.onCancel = () => done("exit");
			return list;
		};
		let list = rebuild(0);
		const reselect = (name: string) => {
			list = rebuild(Math.max(names().indexOf(name), 0));
		};
		const renamed = (from: string, to: string) => {
			state.profiles = Object.fromEntries(
				Object.entries(state.profiles).map(([name, profile]) => [
					name === from ? to : name,
					profile,
				]),
			);
			if (state.active === from) state.active = to;
			reselect(to);
		};
		return {
			title: "Model profiles",
			hints: [
				["Enter", "open"],
				["a", "activate"],
				["c", "create"],
				["d", "duplicate"],
				["r", "rename"],
				["x", "delete"],
				["s", "save"],
				["Esc", "exit"],
			],
			render: (width) => [
				sectionRule(theme, "Profiles", width),
				...rows(list, items, width, true),
			],
			handleInput(data) {
				const selected = list.getSelectedItem()?.value;
				const key = printable(data);
				if (key === "c") {
					push(
						nameScreen("New profile name", "", (name) => {
							state.profiles[name] = {};
							reselect(name);
						}),
					);
				} else if (selected === undefined) {
					list.handleInput(data);
				} else if (key === "a") {
					state.active = selected;
					reselect(selected);
				} else if (key === "d") {
					push(
						nameScreen(
							`Duplicate ${sanitize(selected)} as`,
							`${selected}-copy`,
							(name) => {
								state.profiles[name] = structuredClone(
									state.profiles[selected],
								);
								reselect(name);
							},
						),
					);
				} else if (key === "r") {
					push(
						nameScreen(
							`Rename ${sanitize(selected)} to`,
							selected,
							(name) => renamed(selected, name),
							selected,
						),
					);
				} else if (key === "x") {
					if (selected === state.active) {
						notice = `${selected} is the active profile and cannot be deleted.`;
						return;
					}
					push(
						confirmScreen(`Delete profile ${sanitize(selected)}?`, () => {
							delete state.profiles[selected];
							list = rebuild(0);
						}),
					);
				} else {
					list.handleInput(data);
				}
			},
		};
	}

	push(profilesScreen());

	return {
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
			done("exit");
			return { handled: true };
		},
		invalidate() {},
		handleInput(data) {
			notice = "";
			const screen = stack[stack.length - 1];
			if (!screen.blocksSave && printable(data) === "s") done("save");
			else screen.handleInput(data);
		},
	};
}
