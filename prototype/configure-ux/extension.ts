// Prototype only. Run: pi -e prototype/configure-ux/extension.ts, then /proto:config [fresh|mixed|broken].
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createConfigGuide, type GuideResult } from "./guide.ts";
import { buildModel, scenarios } from "./mocks.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("proto:config", {
		description:
			"Prototype of the redesigned /workflow:config guide (writes nothing)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui") return;
			const name = args.trim() || "fresh";
			const scenario = scenarios[name];
			if (!scenario) {
				ctx.ui.notify(
					`Unknown scenario ${name}. Use: ${Object.keys(scenarios).join(", ")}`,
					"error",
				);
				return;
			}
			const model = buildModel(scenario);
			const result = await ctx.ui.custom<GuideResult>(
				(tui, theme, keybindings, done) =>
					createConfigGuide(
						model,
						theme,
						keybindings,
						() => tui.terminal.rows,
						done,
					),
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "70%",
						minWidth: 56,
						maxHeight: "100%",
					},
				},
			);
			if (result.status === "closed") return;
			const changes = result.model.sections
				.flatMap((section) => section.rows)
				.filter((row) =>
					row.kind === "toggle" ? row.on !== row.was : row.value !== row.was,
				)
				.map((row) => row.label);
			ctx.ui.notify(
				`Prototype: would apply ${changes.length ? changes.join(", ") : "no selection changes"} and align MCP and default settings. Nothing was written.`,
				"info",
			);
		},
	});
}
