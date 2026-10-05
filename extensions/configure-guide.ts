import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";

import {
	capabilities,
	type Capability,
	describePlan,
	type Selection,
} from "./configure.ts";
import { report } from "./model-profiles.ts";

const capabilityLabels: Record<Capability, string> = {
	"child-session": "Child session",
	todo: "Todo",
	"operator-questions": "Operator questions",
	"model-profiles": "Model profiles",
	codegraph: "CodeGraph",
	"compact-rendering": "Compact rendering",
};

export async function guideSelection(
	ctx: ExtensionCommandContext,
	selection: Selection,
	packages: readonly string[],
	states: readonly {
		package: string;
		status: "missing" | "installed" | "error";
	}[],
	jevRouting: boolean,
): Promise<{ selection: Selection; jevRouting: boolean } | undefined> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		report(ctx, "Configure needs the TUI.", "error");
		return undefined;
	}
	const draft: Selection = structuredClone(selection);
	let draftRouting = jevRouting;
	let confirmed = false;
	await ctx.ui.custom(
		(_tui, _theme, _keybindings, done) => {
			const items: SettingItem[] = [
				...capabilities.map((capability) => ({
					id: `capability:${capability}`,
					label: capabilityLabels[capability],
					description: "Seat this harness capability",
					currentValue: draft.capabilities[capability] ? "on" : "off",
					values: ["on", "off"],
				})),
				{
					id: "jev-routing",
					label: "Jev routing",
					description: "Ask Jev before routing a turn",
					currentValue: draftRouting ? "on" : "off",
					values: ["on", "off"],
				},
				...packages.map((name) => ({
					id: `expectation:${name}`,
					label: name,
					description: "Expect this companion. Off does not uninstall it.",
					currentValue: draft.expectations[name] ? "on" : "off",
					values: ["on", "off"],
				})),
				{
					id: "apply",
					label: "Apply",
					description: "Review, then confirm. Off does not uninstall a package.",
					currentValue: "review",
					submenu: (_value, closeSubmenu) =>
						new SettingsList(
							[
								...[
									...(draftRouting === jevRouting
										? []
										: [
												`Jev routing: ${jevRouting ? "on" : "off"} -> ${draftRouting ? "on" : "off"}`,
											]),
									...describePlan(selection, draft, states),
								].map((line, index) => ({
									id: `plan-${index}`,
									label: line,
									currentValue: "",
								})),
								{
									id: "confirm",
									label: "Confirm apply",
									description: "Apply this plan in this session.",
									currentValue: "now",
									values: ["now"],
								},
							],
							4,
							getSettingsListTheme(),
							() => {
								confirmed = true;
								closeSubmenu();
								done(undefined);
							},
							() => closeSubmenu(),
						),
				},
			];
			return new SettingsList(
				items,
				12,
				getSettingsListTheme(),
				(id, value) => {
					const on = value === "on";
					if (id.startsWith("capability:")) {
						const capability = id.slice("capability:".length) as Capability;
						draft.capabilities[capability] = on;
					} else if (id === "jev-routing") {
						draftRouting = on;
					} else if (id.startsWith("expectation:")) {
						draft.expectations[id.slice("expectation:".length)] = on;
					}
				},
				() => done(undefined),
			);
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 48,
				maxHeight: "100%",
			},
		},
	);
	return confirmed
		? { selection: draft, jevRouting: draftRouting }
		: undefined;
}
