export const capabilities = [
	"child-session",
	"todo",
	"operator-questions",
	"model-profiles",
	"codegraph",
	"compact-rendering",
] as const;

export type Capability = (typeof capabilities)[number];

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
