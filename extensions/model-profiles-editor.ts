import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	type KeybindingsManager,
	type SelectItem,
} from "@earendil-works/pi-tui";

import { sectionRule } from "./chrome-menus.ts";
import {
	createScreenFrame,
	modelCatalogScreen,
	printable,
	type Screen,
} from "./model-picker.ts";
import {
	type EditableProfiles,
	profileName,
	type Specialist,
	specialists,
} from "./model-profiles.ts";
import { terminalSafeLine } from "./terminal-safe-text.ts";

export function createModelProfilesEditor(
	state: EditableProfiles,
	catalog: string[],
	supportedThinking: Record<string, ModelThinkingLevel[]>,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (action: "save" | "exit") => void,
	terminalRows: () => number,
): Component {
	const frame = createScreenFrame(
		theme,
		keybindings,
		terminalRows,
		() => done("exit"),
		(screen, data) => {
			if (screen.blocksSave || printable(data) !== "s") return false;
			done("save");
			return true;
		},
	);
	const { push, pop, rows, selectList } = frame;

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
				frame.notify(
					"Use 1 to 64 lowercase letters, digits, or hyphens for the name.",
				);
			} else if (Object.hasOwn(state.profiles, name)) {
				frame.notify(`A profile named ${name} already exists.`);
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
				input.setValue(terminalSafeLine(input.getValue()));
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
								`${terminalSafeLine(entry.model)} · thinking: ${entry.thinking}`,
							)
						: theme.fg("dim", "inherits session model"),
				};
			});
		let list = rebuild(0);
		function rebuild(selected: number) {
			return selectList(
				items(),
				(item) => {
					const specialist = item.value as Specialist;
					push(
						modelCatalogScreen(
							frame,
							catalog,
							supportedThinking,
							`${terminalSafeLine(name)} · ${specialist} model`,
							(model, thinking) => {
								pop();
								pop();
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
				return `Profile ${terminalSafeLine(name)}${state.active === name ? " (active)" : ""}`;
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
				label: terminalSafeLine(name),
				description:
					name === state.active
						? `${theme.fg("accent", "●")} ${theme.fg("text", "active")}`
						: "",
			}));
			return selectList(
				items,
				(item) => push(profileScreen(item.value)),
				selected,
			);
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
							`Duplicate ${terminalSafeLine(selected)} as`,
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
							`Rename ${terminalSafeLine(selected)} to`,
							selected,
							(name) => renamed(selected, name),
							selected,
						),
					);
				} else if (key === "x") {
					if (selected === state.active) {
						frame.notify(
							`${selected} is the active profile and cannot be deleted.`,
						);
						return;
					}
					push(
						confirmScreen(
							`Delete profile ${terminalSafeLine(selected)}?`,
							() => {
								delete state.profiles[selected];
								list = rebuild(0);
							},
						),
					);
				} else {
					list.handleInput(data);
				}
			},
		};
	}

	push(profilesScreen());

	return frame.component;
}
