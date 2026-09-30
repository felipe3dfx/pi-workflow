import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";

import { report } from "./model-profiles.ts";

const routingValues = ["on", "off"] as const;

type Routing = (typeof routingValues)[number];

let routing: Routing = "on";

type WorkflowSetting = {
	id: string;
	label: string;
	description: string;
	values: readonly string[];
	get: () => string;
	set: (value: string) => void;
};

const settings: WorkflowSetting[] = [
	{
		id: "jev-routing",
		label: "Jev routing",
		description: "Ask Jev before routing a turn",
		values: routingValues,
		get: () => routing,
		set: (value) => {
			if (value === "on" || value === "off") routing = value;
		},
	},
];

export function jevRoutingEnabled(): boolean {
	return routing === "on";
}

function createWorkflowSettingsList(onCancel: () => void): SettingsList {
	const items: SettingItem[] = settings.map((setting) => ({
		id: setting.id,
		label: setting.label,
		description: setting.description,
		currentValue: setting.get(),
		values: [...setting.values],
	}));
	return new SettingsList(
		items,
		8,
		getSettingsListTheme(),
		(id, value) => {
			settings.find((setting) => setting.id === id)?.set(value);
		},
		onCancel,
		{ enableSearch: true },
	);
}

export async function openWorkflowSettings(ctx: ExtensionCommandContext) {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		report(ctx, "The workflow settings panel needs the TUI.", "error");
		return;
	}
	await ctx.ui.custom(
		(_tui, _theme, _keybindings, done) =>
			createWorkflowSettingsList(() => done(undefined)),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 44,
				maxHeight: "100%",
			},
		},
	);
}
