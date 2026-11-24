import { stripVTControlCharacters } from "node:util";

import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	TuiAltScreen,
} from "@earendil-works/pi-tui";

import { setDensityTerminal } from "../../extensions/visual-language.ts";

function fakeTerminal(columns, rows) {
	return {
		start() {},
		stop() {},
		async drainInput() {},
		write() {},
		columns,
		rows,
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
		kittyProtocolActive: false,
		getBufferedInput: () => "",
		hasPendingInput: () => false,
	};
}

export function piScreen(t, columns, { rows = 40, theme } = {}) {
	const terminal = fakeTerminal(columns, rows);
	const tui = new TuiAltScreen(terminal, false);
	tui.start();
	setDensityTerminal(terminal, tui);
	t.after(() => {
		setDensityTerminal(undefined);
		tui.stop();
	});
	const opened = [];
	const custom = (factory, options) =>
		new Promise((resolve) => {
			const entry = { options, closed: false };
			entry.panel = factory(
				tui,
				theme,
				new KeybindingsManager(TUI_KEYBINDINGS),
				(value) => {
					entry.closed = true;
					entry.handle?.hide();
					resolve(value);
				},
			);
			if (options?.overlay && !entry.closed) {
				entry.handle = tui.showOverlay(entry.panel, options.overlayOptions);
				options.onHandle?.(entry.handle);
			}
			opened.push(entry);
		});
	return {
		terminal,
		tui,
		opened,
		custom,
		async frame() {
			tui.requestRender(true);
			await new Promise((resolve) => setImmediate(resolve));
			return tui
				.getScreenLines()
				.map((line) => stripVTControlCharacters(line).trimEnd());
		},
	};
}
