import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

import {
	type Capability,
	capabilities,
	type Selection,
} from "./configure.ts";

const places = [
	"header",
	"above-input",
	"overlay",
	"message-stream",
] as const;

type Place = (typeof places)[number];

const placement: Record<Capability, { place: Place; order: number }[]> = {
	"child-session": [
		{ place: "header", order: 0 },
		{ place: "above-input", order: 0 },
		{ place: "overlay", order: 0 },
		{ place: "message-stream", order: 1 },
	],
	todo: [{ place: "above-input", order: 1 }],
	"operator-questions": [{ place: "overlay", order: 1 }],
	"model-profiles": [{ place: "overlay", order: 2 }],
	codegraph: [{ place: "message-stream", order: 2 }],
	"compact-rendering": [{ place: "message-stream", order: 0 }],
};

let headerOccupant: { capability: Capability; read: () => number } | undefined;
const headerListeners = new Set<() => void>();
const aboveInput = new Map<
	Capability,
	(width: number, theme: Theme) => string[]
>();
const ABOVE_INPUT_WIDGET = "pi-workflow-above-input";

let seatedNow = Object.fromEntries(
	capabilities.map((capability) => [capability, false]),
) as Record<Capability, boolean>;

export function replaceSelection(selection: Selection) {
	seatedNow = selection.capabilities;
	notifyHeader();
}

export function seatedCapabilities(): Pick<Selection, "capabilities"> {
	return { capabilities: { ...seatedNow } };
}

function declare(capability: Capability, place: Place) {
	if (!placement[capability].some((seat) => seat.place === place)) {
		throw new Error(`${capability} is not declared at ${place}`);
	}
}

export function seated(capability: Capability, place: Place): boolean {
	declare(capability, place);
	return seatedNow[capability];
}

export function occupants(place: Place): Capability[] {
	return capabilities
		.filter(
			(capability) =>
				seatedNow[capability] &&
				placement[capability].some((seat) => seat.place === place),
		)
		.sort((left, right) => {
			const leftOrder =
				placement[left].find((seat) => seat.place === place)?.order ?? 0;
			const rightOrder =
				placement[right].find((seat) => seat.place === place)?.order ?? 0;
			return leftOrder - rightOrder;
		});
}

export function occupyAboveInput(
	capability: Capability,
	draw: (width: number, theme: Theme) => string[],
) {
	declare(capability, "above-input");
	aboveInput.set(capability, draw);
}

export function paintAboveInput(width: number, theme: Theme) {
	return occupants("above-input").flatMap(
		(capability) => aboveInput.get(capability)?.(width, theme) ?? [],
	);
}

export function registerShell(pi: ExtensionAPI) {
	let aboveInputTui: { requestRender(): void } | undefined;
	pi.on("session_start", async (_event, ctx) => {
		aboveInputTui = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			ABOVE_INPUT_WIDGET,
			(tui, theme) => {
				aboveInputTui = tui;
				return {
					render: (width: number) => paintAboveInput(width, theme),
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);
	});
	pi.on("session_shutdown", async () => {
		aboveInputTui = undefined;
	});
	return { requestAboveInputRender: () => aboveInputTui?.requestRender() };
}

export function occupyHeader(capability: Capability, read: () => number) {
	declare(capability, "header");
	headerOccupant = { capability, read };
}

export function readHeader(): number {
	if (!headerOccupant || !seatedNow[headerOccupant.capability]) return 0;
	return headerOccupant.read();
}

export function watchHeader(listener: () => void) {
	headerListeners.add(listener);
	return () => headerListeners.delete(listener);
}

export function notifyHeader() {
	for (const listener of headerListeners) listener();
}

export function resetPlaces() {
	headerOccupant = undefined;
	aboveInput.clear();
}
