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

type PlaceReading = { count: number };

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

type Contribution = {
	place: Place;
	order: number;
	read: () => PlaceReading;
};

const contributions = new Map<Capability, Contribution>();
const placeListeners = new Map<Place, Set<() => void>>();
const aboveInput = new Map<Capability, (width: number) => string[]>();

let seatedNow = Object.fromEntries(
	capabilities.map((capability) => [capability, false]),
) as Record<Capability, boolean>;

export function replaceSelection(selection: Selection) {
	seatedNow = selection.capabilities;
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
	draw: (width: number) => string[],
) {
	declare(capability, "above-input");
	aboveInput.set(capability, draw);
}

export function paintAboveInput(width: number) {
	return occupants("above-input").flatMap(
		(capability) => aboveInput.get(capability)?.(width) ?? [],
	);
}

export function contribute(
	capability: Capability,
	place: Place,
	read: () => PlaceReading,
) {
	const order =
		placement[capability].find((seat) => seat.place === place)?.order ?? 0;
	contributions.set(capability, { place, order, read });
}

export function readPlace(place: Place): PlaceReading | undefined {
	for (const capability of occupants(place)) {
		const contribution = contributions.get(capability);
		if (!contribution || contribution.place !== place) continue;
		const reading = contribution.read();
		if (reading.count > 0) return reading;
	}
	return undefined;
}

export function subscribePlace(place: Place, listener: () => void) {
	const listeners = placeListeners.get(place) ?? new Set();
	listeners.add(listener);
	placeListeners.set(place, listeners);
	return () => listeners.delete(listener);
}

export function resetPlaces() {
	contributions.clear();
	placeListeners.clear();
	aboveInput.clear();
}

export function notifyPlace(place: Place) {
	for (const listener of placeListeners.get(place) ?? []) listener();
}

export function readHeader() {
	return readPlace("header");
}

export function watchHeader(listener: () => void) {
	return subscribePlace("header", listener);
}

export function notifyHeader() {
	notifyPlace("header");
}
