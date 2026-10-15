import { performance } from "node:perf_hooks";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { createChildrenViews } from "../../../extensions/children-view.ts";
import { replaceSelection } from "../../../extensions/shell.ts";

export function openFixtureView(entries) {
	initTheme("dark", false);
	replaceSelection({ schemaVersion: 1, capabilities: { "child-session": true }, expectations: {} });
	const record = { id: "fixture-child", role: "worker", task: "Audit fixture", worktree: "/fixture", model: "fleet-fixture/local", thinking: "off", state: "running", createdAt: Date.now(), startedAt: Date.now() };
	const thread = { entries };
	let factory;
	const views = createChildrenViews({
		list: () => [record], get: () => record, thread: () => thread,
		subscribe: () => () => {}, follow: () => () => {}, changedFiles: () => [],
	}, { text: () => undefined }, () => () => {});
	void views.open({ ui: { custom(make) { factory = make; return new Promise(() => {}); } } });
	const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
	const keys = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.thinking.toggle": { defaultKeys: "ctrl+t", description: "Toggle thinking" } });
	const component = factory({ requestRender() {}, terminal: { rows: 40 } }, theme, keys, () => {});
	const times = [];
	let lines = 0;
	return {
		thread,
		render() {
			const start = performance.now();
			lines = component.render(120).length;
			times.push(performance.now() - start);
		},
		stats: () => ({ frames: times.length, renderTotalMs: times.reduce((a, b) => a + b, 0), renderMaxMs: Math.max(0, ...times), outputLines: lines }),
		close: () => views.close(),
	};
}
