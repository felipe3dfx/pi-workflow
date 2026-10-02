import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	type ChildLauncherOptions,
	createChildLauncher,
} from "./child-launcher.ts";
import { jevRoutingEnabled } from "./workflow-settings.ts";

type DelegationAction = "launch" | "stay" | "decide" | "block";

interface DelegationCase {
	name: string;
	live?: boolean;
	task: string;
	userRequest: string;
	suggestedRole?: "explore" | "worker" | "verify";
	expected: {
		action: DelegationAction;
		role?: "explore" | "worker" | "verify";
		destinationAsked: boolean;
	};
}

export const delegationCases: readonly DelegationCase[] = [
	{
		name: "explicit architecture research",
		live: true,
		task: "Map how the two implementations fit together.",
		userRequest:
			"Investiga con un hijo la arquitectura de estas dos implementaciones y cómo encajan.",
		expected: {
			action: "launch",
			role: "explore",
			destinationAsked: false,
		},
	},
	{
		name: "suggested worker plus source comparison",
		live: true,
		task: "Compare the two cited source files and report how they differ.",
		userRequest:
			"Compare the two cited source implementations and report how they differ. The comparison is bounded and can be finished alone.",
		suggestedRole: "worker",
		expected: {
			action: "launch",
			role: "explore",
			destinationAsked: true,
		},
	},
	{
		name: "bounded implementation",
		live: true,
		task: "Add the missing export and its unit test.",
		userRequest:
			"Add the missing export and a unit test that covers it. The change is bounded and can be finished alone.",
		expected: {
			action: "launch",
			role: "worker",
			destinationAsked: true,
		},
	},
	{
		name: "independent check",
		live: true,
		task: "Independently check the completed change.",
		userRequest:
			"Haz una comprobación independiente del cambio que ya está hecho. La revisión está acotada y se puede terminar sola.",
		expected: {
			action: "launch",
			role: "verify",
			destinationAsked: true,
		},
	},
	{
		name: "open product decision",
		task: "Decide whether this product change should exist.",
		userRequest:
			"Quiero decidir contigo si este cambio de producto debe existir. La decisión sigue abierta.",
		expected: { action: "decide", destinationAsked: true },
	},
	{
		name: "small understood answer",
		task: "Restate the stay warning in one sentence.",
		userRequest:
			"Esto ya está entendido y es pequeño. Dime aquí, en una frase, qué dice el warning de quedarse en la sesión.",
		expected: { action: "stay", destinationAsked: true },
	},
	{
		name: "implement skill",
		task: "Implement the approved ticket.",
		userRequest: "Usa la skill implement para este ticket.",
		expected: {
			action: "launch",
			role: "worker",
			destinationAsked: true,
		},
	},
];

type CheckContext = Pick<
	ExtensionContext,
	"cwd" | "modelRegistry" | "model" | "thinkingLevel" | "signal"
>;

type Verdict = Awaited<
	ReturnType<ReturnType<typeof createChildLauncher>["classify"]>
>;

function actionOf(verdict: Verdict): DelegationAction {
	if (verdict.kind === "launch") return "launch";
	if (verdict.kind === "stay") return "stay";
	if (verdict.kind === "decide") return "decide";
	return "block";
}

function evidence(verdict: Verdict): string {
	const jev = verdict.jev;
	if (!jev) return "";
	const specialist = jev.answers.specialist;
	const destination = jev.answers.destination;
	const primary =
		verdict.kind === "launch" ? specialist : (destination ?? specialist);
	const parts: string[] = [];
	if (specialist?.type === "choice") {
		parts.push(`specialist choice ${specialist.choice}`);
	}
	if (destination?.type === "choice") {
		parts.push(`destination choice ${destination.choice}`);
	}
	if (primary?.type === "choice") {
		parts.push(`confidence ${primary.confidence}`);
		parts.push(`probabilities ${JSON.stringify(primary.probabilities)}`);
	}
	return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

function scoreLine(item: DelegationCase, verdict: Verdict): string {
	const action = actionOf(verdict);
	const destinationAsked = verdict.jev?.answers.destination !== undefined;
	const role = verdict.kind === "launch" ? verdict.role : undefined;
	const mismatches: string[] = [];
	if (action !== item.expected.action) {
		mismatches.push(`action expected ${item.expected.action}, got ${action}`);
	}
	if (item.expected.role && role !== item.expected.role) {
		mismatches.push(
			`specialist expected ${item.expected.role}, got ${role ?? "none"}`,
		);
	}
	if (destinationAsked !== item.expected.destinationAsked) {
		mismatches.push(
			`destination question expected ${item.expected.destinationAsked ? "yes" : "no"}, got ${destinationAsked ? "yes" : "no"}`,
		);
	}
	const detail = evidence(verdict);
	if (mismatches.length > 0) {
		const reason = verdict.kind === "launch" ? "" : `; ${verdict.reason}`;
		return `fail: ${item.name}: ${mismatches.join("; ")}${detail}${reason}`;
	}
	const specialist = role ? `, specialist ${role}` : "";
	return `pass: ${item.name}: action ${action}${specialist}, destination asked ${destinationAsked ? "yes" : "no"}${detail}`;
}

export async function runDelegationCheck(
	ctx: CheckContext,
	options: { modelProfiles: ChildLauncherOptions["modelProfiles"] },
): Promise<{ lines: string[]; failed: boolean }> {
	const launcher = createChildLauncher({
		modelProfiles: options.modelProfiles,
	});
	const lines: string[] = [];
	const routingOn = jevRoutingEnabled();
	for (const item of delegationCases) {
		if (!routingOn) {
			lines.push(
				`fail: ${item.name}: Jev routing is off. Turn it on in /workflow:settings.`,
			);
			continue;
		}
		try {
			const verdict = await launcher.classify(
				{
					task: item.task,
					userRequest: item.userRequest,
					...(item.suggestedRole ? { role: item.suggestedRole } : {}),
				},
				ctx,
			);
			lines.push(scoreLine(item, verdict));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			lines.push(`fail: ${item.name}: ${message}`);
		}
	}
	return { lines, failed: lines.some((line) => line.startsWith("fail:")) };
}
