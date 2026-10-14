import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { errorMessage } from "./error-message.ts";
import {
	type ChildLauncherOptions,
	createChildLauncher,
} from "./child-launcher.ts";

type DelegationAction = "launch" | "stay" | "decide" | "block";

interface Expectation {
	action: DelegationAction;
	destinationAsked: boolean;
}

interface DelegationCase {
	name: string;
	live?: boolean;
	task: string;
	userRequest: string;
	expected: Expectation;
	orchestrator?: Expectation;
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
			destinationAsked: true,
		},
	},
	{
		name: "explicit subagents in Spanish",
		live: true,
		task: "Wait 10 seconds and report.",
		userRequest: "Lanza 5 subagentes que esperen 10 segundos",
		expected: {
			action: "launch",
			destinationAsked: true,
		},
	},
	{
		name: "explicit subagents in English",
		live: true,
		task: "Wait 10 seconds and report.",
		userRequest: "Spawn three subagents to wait 10 seconds each",
		expected: {
			action: "launch",
			destinationAsked: true,
		},
	},
	{
		name: "bounded source comparison",
		live: true,
		task: "Compare the two cited source files and report how they differ.",
		userRequest:
			"Compare the two cited source implementations and report how they differ. The comparison is bounded and can be finished alone.",
		expected: {
			action: "launch",
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
			destinationAsked: true,
		},
	},
	{
		name: "independent review request",
		live: true,
		task: "Independently check the work.",
		userRequest:
			"Revisa de forma independiente si docs/adr/0011-git-and-gh-guard-in-child-bash.md describe correctamente lo que hace extensions/child-bash.ts. Quiero un veredicto claro.",
		expected: {
			action: "launch",
			destinationAsked: true,
		},
	},
	{
		name: "independent verification request",
		live: true,
		task: "Independently check the work.",
		userRequest:
			"Verifica de forma independiente que la rama feature-inexistente pasa todos los tests de este repo",
		expected: {
			action: "launch",
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
		orchestrator: { action: "launch", destinationAsked: true },
	},
	{
		name: "reserved commit and push",
		task: "Commit and push the changes.",
		userRequest: "Commit and push the changes.",
		expected: { action: "stay", destinationAsked: true },
	},
	{
		name: "implement skill",
		task: "Implement the approved ticket.",
		userRequest: "Usa la skill implement para este ticket.",
		expected: {
			action: "launch",
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
	if (verdict.kind === "leave") return "launch";
	if (verdict.kind === "stay") return "stay";
	if (verdict.kind === "decide") return "decide";
	return "block";
}

function evidence(verdict: Verdict): string {
	const jev = verdict.jev;
	if (!jev) return "";
	const destination = jev.answers.destination;
	const parts: string[] = [];
	if (destination?.type === "choice") {
		parts.push(`destination choice ${destination.choice}`);
		parts.push(`confidence ${destination.confidence}`);
		parts.push(`probabilities ${JSON.stringify(destination.probabilities)}`);
	}
	return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

function scoreLine(
	item: DelegationCase,
	expected: Expectation,
	verdict: Verdict,
): string {
	const action = actionOf(verdict);
	const destinationAsked = verdict.jev?.answers.destination !== undefined;
	const mismatches: string[] = [];
	if (action !== expected.action) {
		mismatches.push(`action expected ${expected.action}, got ${action}`);
	}
	if (destinationAsked !== expected.destinationAsked) {
		mismatches.push(
			`destination question expected ${expected.destinationAsked ? "yes" : "no"}, got ${destinationAsked ? "yes" : "no"}`,
		);
	}
	const detail = evidence(verdict);
	if (mismatches.length > 0) {
		const reason = verdict.kind === "leave" ? "" : `; ${verdict.reason}`;
		return `fail: ${item.name}: ${mismatches.join("; ")}${detail}${reason}`;
	}
	return `pass: ${item.name}: action ${action}, destination asked ${destinationAsked ? "yes" : "no"}${detail}`;
}

export async function runDelegationCheck(
	ctx: CheckContext,
	options: Pick<
		ChildLauncherOptions,
		"modelProfiles" | "jevRouting" | "delegationMode"
	>,
): Promise<{ lines: string[]; failed: boolean }> {
	const launcher = createChildLauncher({
		modelProfiles: options.modelProfiles,
		jevRouting: options.jevRouting,
		delegationMode: options.delegationMode,
	});
	const orchestrator = options.delegationMode.current() === "orchestrator";
	const lines: string[] = [];
	const routingOn = options.jevRouting.enabled();
	for (const item of delegationCases) {
		if (!routingOn) {
			lines.push(
				`fail: ${item.name}: Jev routing is off. Turn it on in /workflow:config.`,
			);
			continue;
		}
		try {
			const verdict = await launcher.classify(
				{ task: item.task, userRequest: item.userRequest },
				ctx,
			);
			lines.push(
				scoreLine(
					item,
					(orchestrator && item.orchestrator) || item.expected,
					verdict,
				),
			);
		} catch (error) {
			const message = errorMessage(error);
			lines.push(`fail: ${item.name}: ${message}`);
		}
	}
	return { lines, failed: lines.some((line) => line.startsWith("fail:")) };
}
