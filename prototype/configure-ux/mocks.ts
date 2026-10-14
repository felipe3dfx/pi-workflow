// Prototype only. Replaces seating.read(), resolveCompanionStates(), jevRouting and delegationMode reads.
import type { CompanionStatus, GuideModel } from "./guide.ts";

const capabilityCopy: [string, string, string][] = [
	[
		"child-session",
		"Child session",
		"Delegate bounded work to child sessions; shows them above the input and offers spawn_child.",
	],
	["todo", "Todo", "Session task list pinned above the input."],
	[
		"operator-questions",
		"Operator questions",
		"Lets the agent ask you choices or open questions in a panel.",
	],
	[
		"model-profiles",
		"Model profiles",
		"Pick a model per role with /workflow:models.",
	],
	[
		"codegraph",
		"CodeGraph",
		"Offers the codegraph tool for structural code search.",
	],
	[
		"compact-rendering",
		"Compact rendering",
		"Shows Pi's built-in tool calls in compact form. Off restores native rendering.",
	],
];

const companions: [string, string][] = [
	["gentle-engram", "Persistent memory tools and Engram integration for Pi."],
	["@gtrabanco/pi-nan-provider", "NaN model provider for Pi."],
	["pi-web-access", "Web access extension and skills for Pi."],
	["pi-claude-bridge", "Official Claude Bridge model provider for Pi."],
];

export type Scenario = {
	capabilitiesOff?: string[];
	jevRouting?: boolean;
	delegationMode?: "opportunistic" | "orchestrator";
	expectationsOff?: string[];
	status?: Record<string, CompanionStatus>;
	catalogError?: string;
};

export const scenarios: Record<string, Scenario> = {
	fresh: {
		status: { "pi-web-access": "missing", "pi-claude-bridge": "missing" },
	},
	mixed: {
		capabilitiesOff: ["codegraph"],
		jevRouting: true,
		expectationsOff: ["@gtrabanco/pi-nan-provider"],
		status: { "pi-claude-bridge": "missing", "gentle-engram": "error" },
	},
	broken: {
		catalogError:
			"Unable to load companion metadata at assets/companions.json: Unexpected token } in JSON.",
	},
};

export function buildModel(scenario: Scenario): GuideModel {
	const off = new Set(scenario.capabilitiesOff ?? []);
	const notExpected = new Set(scenario.expectationsOff ?? []);
	const mode = scenario.delegationMode ?? "opportunistic";
	const jev = scenario.jevRouting ?? false;
	return {
		sections: [
			{
				title: "Capabilities",
				rows: capabilityCopy.map(([id, label, description]) => ({
					kind: "toggle" as const,
					id: `capability:${id}`,
					label,
					description,
					on: !off.has(id),
					was: !off.has(id),
				})),
			},
			{
				title: "Routing and delegation",
				rows: [
					{
						kind: "toggle",
						id: "jev-routing",
						label: "Jev routing",
						description:
							"Ask Jev on each message whether the work stays in the parent or goes to a child session. Needs a TypeSafe key.",
						on: jev,
						was: jev,
					},
					{
						kind: "choice",
						id: "delegation-mode",
						label: "Delegation mode",
						values: ["opportunistic", "orchestrator"],
						descriptions: {
							opportunistic:
								"the parent decides per message whether to delegate (default).",
							orchestrator:
								"the parent is told to delegate all work and keep to planning and conversation.",
						},
						value: mode,
						was: mode,
					},
				],
			},
			{
				title: "Companions",
				error: scenario.catalogError,
				rows: (scenario.catalogError ? [] : companions).map(
					([name, description]) => ({
						kind: "toggle" as const,
						id: `expectation:${name}`,
						label: name,
						description: `${description} Off stops expecting it; it is never uninstalled.`,
						on: !notExpected.has(name),
						was: !notExpected.has(name),
						status: scenario.status?.[name] ?? "installed",
					}),
				),
			},
		],
		alwaysOnApply: [
			"Align MCP servers (mcp.json)",
			"Apply default Pi settings",
			"Nothing is uninstalled",
		],
		catalogError: scenario.catalogError,
	};
}
