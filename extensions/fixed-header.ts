import type { Component, TUI } from "@earendil-works/pi-tui";

// Relies on pi-tui 1.0 internals: TuiAltScreen's private `layoutRoot` and the
// layout-node symbol, which the package index does not export.
const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

type LayoutNode = { type: string };
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type Host = TUI & { mode?: string; layoutRoot?: LayoutRoot };

export function fixHeader(tui: TUI, header: Component) {
	const host = tui as Host;
	const roots = new Set<LayoutRoot>();
	const cleanups: (() => void)[] = [];
	let stopped = false;
	let failed = false;

	const attach = () => {
		if (stopped || failed || host.mode !== "fullscreen") return;
		try {
			const root = host.layoutRoot;
			const original = root?.[NODE];
			if (!root || typeof original !== "function" || roots.has(root)) return;
			const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
			const nativeHost = {
				render: () => [],
				invalidate() {},
				[NODE]: () => original.call(root),
			};
			const replacement = () =>
				stopped || failed || host.mode !== "fullscreen"
					? original.call(root)
					: {
							type: "vstack",
							gap: 0,
							align: "stretch",
							entries: [
								{
									component: header,
									basis: "auto",
									grow: 0,
									shrink: 0,
									minSize: 0,
								},
								{
									component: nativeHost,
									basis: 0,
									grow: 1,
									shrink: 1,
									minSize: 1,
								},
							],
						};
			root[NODE] = replacement;
			roots.add(root);
			cleanups.push(() => {
				if (root[NODE] !== replacement) return;
				if (descriptor) Object.defineProperty(root, NODE, descriptor);
				else Reflect.deleteProperty(root, NODE);
			});
			tui.requestRender();
		} catch {
			failed = true;
		}
	};

	attach();
	// Pi swaps renderers without an event.
	const timer = setInterval(attach, 100);
	timer.unref();

	return {
		active: () =>
			!stopped &&
			!failed &&
			host.mode === "fullscreen" &&
			roots.has(host.layoutRoot as LayoutRoot),
		stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(timer);
			for (const cleanup of cleanups.reverse()) cleanup();
			roots.clear();
			tui.requestRender();
		},
	};
}
