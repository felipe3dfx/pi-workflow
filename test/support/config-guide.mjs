import { stripVTControlCharacters } from "node:util";

import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";

export const keys = {
	enter: "\r",
	escape: "\x1b",
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	tab: "\t",
	space: " ",
};

export const plainTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};

export const taggedTheme = {
	fg: (_color, text) => text,
	bg: (color, text) => `{${color}:${text}}`,
	bold: (text) => text,
};

export const newKeybindings = () => new KeybindingsManager(TUI_KEYBINDINGS);

export async function driveConfig(
	command,
	drive,
	{ notify = () => {}, rows = 40, theme = plainTheme } = {},
) {
	const session = { closed: false };
	await command.handler("", {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		isProjectTrusted: () => false,
		ui: {
			notify,
			custom: (factory) =>
				new Promise((resolve) => {
					const panel = factory(
						{ requestRender() {}, terminal: { rows } },
						theme,
						newKeybindings(),
						() => {
							session.closed = true;
							resolve();
						},
					);
					drive(panel, session);
				}),
		},
	});
	return session;
}

export const WIDTH = 80;

export const plain = (panel, width = WIDTH) =>
	panel.render(width).map((line) => stripVTControlCharacters(line));

export function title(panel, width = WIDTH) {
	return plain(panel, width)[0]
		.replace(/^┌─ /, "")
		.replace(/ ─+( \[×\] )?─┐$/, "");
}

export const body = (panel, width = WIDTH) =>
	plain(panel, width)
		.slice(1, -1)
		.map((line) => line.replace(/^│\s*/, "").replace(/\s*│$/, ""));

export const rowOf = (panel, label, width = WIDTH) =>
	body(panel, width).find((line) =>
		line
			.replace(/^▸\s+/, "")
			.replace(/^\[[x ]\] /, "")
			.startsWith(label),
	);

export function focusOn(panel, label) {
	for (let i = 0; i < 30 && !rowOf(panel, label)?.startsWith("▸ "); i++) {
		panel.handleInput(keys.down);
	}
}

export function press(panel, ...sequence) {
	for (const data of sequence) panel.handleInput(data);
}

const mouse = (type, x, y, extra) => ({
	type,
	button: "left",
	x,
	y,
	screenX: x,
	screenY: y,
	width: WIDTH,
	height: 40,
	shift: false,
	alt: false,
	ctrl: false,
	...extra,
});

export const click = (panel, x, y) => panel.handleMouse(mouse("click", x, y));
export const wheel = (panel, delta) =>
	panel.handleMouse(
		mouse("wheel", 5, 5, { button: "none", wheelDelta: delta }),
	);

export function lineIndex(panel, text, width = WIDTH) {
	return plain(panel, width).findIndex((line) => line.includes(text));
}

export function closeSpan(panel, width = WIDTH) {
	const x = plain(panel, width)[0].indexOf("[×]");
	return { x: x + 1, y: 0 };
}

export function catalogOf(states = {}) {
	return {
		resolveInstalledVersion: (name) => {
			const state = states[name] ?? "installed";
			if (state === "missing") return {};
			if (state === "error") return { error: "unreadable manifest" };
			return { version: "1.0.0" };
		},
	};
}
