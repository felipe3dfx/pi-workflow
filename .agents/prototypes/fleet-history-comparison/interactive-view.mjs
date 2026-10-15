import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";
import { createChildrenViews } from "../../../extensions/children-view.ts";
import { replaceSelection } from "../../../extensions/shell.ts";

export function openInteractiveView(entries, logPath) {
	initTheme("dark", false);
	replaceSelection({ schemaVersion: 1, capabilities: { "child-session": true }, expectations: {} });
	const log = (event) => appendFileSync(logPath, `${JSON.stringify({ ...event, ns: String(process.hrtime.bigint()) })}\n`);
	const terminal = new ProcessTerminal();
	const tui = new TuiMainScreen(terminal);
	const record = { id: "fixture-child", role: "worker", task: "Audit fixture", worktree: "/fixture", model: "fleet-fixture/local", thinking: "off", state: "running", createdAt: Date.now(), startedAt: Date.now() };
	const thread = { entries };
	let factory;
	const views = createChildrenViews({ list: () => [record], get: () => record, thread: () => thread, subscribe: () => () => {}, follow: () => () => {}, changedFiles: () => [] }, { text: () => undefined }, () => () => {});
	void views.open({ ui: { custom(make) { factory = make; return new Promise(() => {}); } } });
	const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
	const keys = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.thinking.toggle": { defaultKeys: "ctrl+t", description: "Toggle thinking" } });
	const component = factory(tui, theme, keys, () => {});
	let seq = 0;
	const times = [];
	const write = terminal.write.bind(terminal);
	terminal.write = (data) => {
		write(data);
		for (const match of data.matchAll(/FLEET_PROBE_(\d+)_END/g)) log({ type: "write", seq: Number(match[1]) });
	};
	const wrapped = {
		render(width) {
			log({ type: "render_start", seq });
			const start = performance.now();
			const lines = component.render(width);
			times.push(performance.now() - start);
			lines[0] = `FLEET_PROBE_${seq}_END`;
			log({ type: "render_end", seq, ms: times.at(-1) });
			return lines;
		},
		invalidate() { component.invalidate(); },
		handleInput(data) { log({ type: "input", seq: ++seq, data, streaming: Boolean(thread.streaming?.content.some((block) => block.type === "text" && block.text)) }); component.handleInput(data); },
	};
	tui.addChild(wrapped);
	tui.setFocus(wrapped);
	tui.start();
	return { thread, render: () => tui.requestRender(), stats: () => ({ frames: times.length, renderMaxMs: Math.max(0, ...times), renderTotalMs: times.reduce((a, b) => a + b, 0) }), close() { views.close(); tui.stop(); } };
}
