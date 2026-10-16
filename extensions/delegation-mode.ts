import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { seated } from "./shell.ts";
import type { DelegationMode } from "./workflow-settings.ts";

function orchestratorInstruction(): string {
	const keep = [
		"conversing with the operator",
		"launching, steering, and answering children with the child tools",
		"reading their results",
		...(seated("todo", "above-input") ? ["planning with the todo tool"] : []),
		...(seated("operator-questions", "overlay")
			? ["asking the operator questions with ask_user_choice or ask_user_question"]
			: []),
	];
	return [
		"# Delegation mode: orchestrator",
		"",
		"Delegate all work to child sessions, reading included: do not read, search, edit, write, or run commands for the work yourself.",
		`Keep to ${keep.slice(0, -1).join(", ")}, and ${keep.at(-1)}.`,
		"These stay with you: the mutating and publishing git and gh operations, such as a commit, a push, or opening a pull request, and the git reads they need; and reading AGENTS.md, GLOSSARY.md, and docs/agents/*.md.",
		"When a launch is refused, such as Launch blocked or the Launch limit, follow the refusal and tell the operator why. Do not retry silently or do the work yourself unannounced.",
	].join("\n");
}

export function registerDelegationMode(
	pi: ExtensionAPI,
	mode: Pick<DelegationMode, "current">,
	childToolsOffered: () => boolean,
) {
	pi.on("context_with_system", (event) => {
		const [system, ...rest] = event.messages;
		if (
			system?.role !== "system" ||
			mode.current() !== "orchestrator" ||
			!childToolsOffered()
		) {
			return;
		}
		return {
			messages: [
				{
					...system,
					sections: {
						...system.sections,
						"pi-workflow-delegation-mode": orchestratorInstruction(),
					},
				},
				...rest,
			],
		};
	});
}
