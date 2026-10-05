export const capabilities = [
	"child-session",
	"todo",
	"operator-questions",
	"model-profiles",
	"codegraph",
	"compact-rendering",
] as const;

export type Capability = (typeof capabilities)[number];

const places = [
	"header",
	"above-input",
	"overlay",
	"message-stream",
] as const;

export type Place = (typeof places)[number];

export type PlaceReading = { count: number };

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

export type Claim = symbol;

const claims = new Map<Claim, { capability: Capability; place: Place }>();
const painters = new Map<Claim, (width: number) => string[]>();

export type Selection = {
	schemaVersion: 1;
	capabilities: Record<Capability, boolean>;
	expectations: Record<string, boolean>;
};

type CompanionState = {
	package: string;
	status: "missing" | "installed" | "error";
};

export type ApplyPlan = {
	install: string[];
	leaveInstalled: string[];
	seated: Capability[];
	unseated: Capability[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCapability(value: string): value is Capability {
	return (capabilities as readonly string[]).includes(value);
}

function defaultSelection(packages: readonly string[]): Selection {
	return {
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((capability) => [capability, true]),
		) as Record<Capability, boolean>,
		expectations: Object.fromEntries(packages.map((name) => [name, true])),
	};
}

export function readSelection(
	text: string | undefined,
	packages: readonly string[],
):
	| { status: "ready"; selection: Selection }
	| { status: "refused"; reason: string } {
	if (text === undefined) {
		return { status: "ready", selection: defaultSelection(packages) };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { status: "refused", reason: "Selection is not valid JSON." };
	}
	if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
		return { status: "refused", reason: "Selection must use schemaVersion 1." };
	}
	const capabilityRecord = parsed.capabilities;
	const expectationRecord = parsed.expectations;
	if (!isRecord(capabilityRecord) || !isRecord(expectationRecord)) {
		return {
			status: "refused",
			reason: "Selection must name capabilities and expectations.",
		};
	}
	const capabilityKeys = Object.keys(capabilityRecord);
	if (
		capabilityKeys.length !== capabilities.length ||
		capabilityKeys.some((key) => !isCapability(key)) ||
		capabilities.some((capability) => !(capability in capabilityRecord))
	) {
		return {
			status: "refused",
			reason: "Selection must name each harness capability.",
		};
	}
	const capabilitiesOn = {} as Record<Capability, boolean>;
	for (const capability of capabilities) {
		const value = capabilityRecord[capability];
		if (typeof value !== "boolean") {
			return {
				status: "refused",
				reason: `Selection capability ${capability} must be on or off.`,
			};
		}
		capabilitiesOn[capability] = value;
	}
	for (const name of packages) {
		if (!(name in expectationRecord)) {
			return {
				status: "refused",
				reason: `Selection is missing the expectation for ${name}.`,
			};
		}
		if (typeof expectationRecord[name] !== "boolean") {
			return {
				status: "refused",
				reason: `Expectation for ${name} must be on or off.`,
			};
		}
	}
	const expectations: Record<string, boolean> = {};
	for (const name of packages) {
		expectations[name] = expectationRecord[name] as boolean;
	}
	return {
		status: "ready",
		selection: {
			schemaVersion: 1,
			capabilities: capabilitiesOn,
			expectations,
		},
	};
}

function unseatedSelection(): Selection {
	return {
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((capability) => [capability, false]),
		) as Record<Capability, boolean>,
		expectations: {},
	};
}

let seatedNow = unseatedSelection();

export function replaceSelection(selection: Selection) {
	seatedNow = selection;
}

function isSeated(capability: Capability): boolean {
	return seatedNow.capabilities[capability];
}

function seatedIn(place: Place, capability: Capability): boolean {
	return occupants(place).includes(capability);
}

export function claim(capability: Capability, place: Place): Claim {
	if (!placement[capability].some((seat) => seat.place === place)) {
		throw new Error(`${capability} is not declared at ${place}`);
	}
	const id: Claim = Symbol(capability);
	claims.set(id, { capability, place });
	return id;
}

export function held(id: Claim): boolean {
	const seat = claims.get(id);
	return seat ? seatedIn(seat.place, seat.capability) : false;
}

export function paint(id: Claim, draw: (width: number) => string[]) {
	painters.set(id, draw);
}

function painted(id: Claim, width: number): string[] {
	if (!held(id)) return [];
	return painters.get(id)?.(width) ?? [];
}

export function paintPlace(place: Place, width: number): string[] {
	const lines: string[] = [];
	for (const capability of occupants(place)) {
		for (const [id, seat] of claims) {
			if (seat.capability !== capability || seat.place !== place) continue;
			lines.push(...painted(id, width));
		}
	}
	return lines;
}

export function release(id: Claim) {
	claims.delete(id);
	painters.delete(id);
}

export function occupants(place: Place): Capability[] {
	return capabilities
		.filter(
			(capability) =>
				isSeated(capability) &&
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
}

export function notifyPlace(place: Place) {
	for (const listener of placeListeners.get(place) ?? []) listener();
}

export function describePlan(
	before: Selection,
	after: Selection,
	states: readonly CompanionState[],
): string[] {
	const plan = planApply(after, states);
	const lines: string[] = [];
	for (const capability of capabilities) {
		const was = before.capabilities[capability];
		const next = after.capabilities[capability];
		if (was === next) continue;
		lines.push(`${next ? "Seat" : "Unseat"} ${capability}`);
	}
	for (const name of plan.install) lines.push(`Install ${name}`);
	for (const name of plan.leaveInstalled) lines.push(`Leave installed ${name}`);
	lines.push("Does not uninstall packages.");
	lines.push("Aligns MCP servers and default settings.");
	return lines;
}

export function planApply(
	selection: Selection,
	states: readonly CompanionState[],
): ApplyPlan {
	const byPackage = new Map(states.map((state) => [state.package, state.status]));
	const install = Object.entries(selection.expectations)
		.filter(([name, expected]) => expected && byPackage.get(name) === "missing")
		.map(([name]) => name);
	const leaveInstalled = Object.entries(selection.expectations)
		.filter(([, expected]) => !expected)
		.filter(([name]) => byPackage.get(name) === "installed")
		.map(([name]) => name);
	const seated = capabilities.filter(
		(capability) => selection.capabilities[capability],
	);
	const unseated = capabilities.filter(
		(capability) => !selection.capabilities[capability],
	);
	return { install, leaveInstalled, seated, unseated };
}
