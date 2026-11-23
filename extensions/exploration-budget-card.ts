import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ExplorationFacts } from "./exploration-budget.ts";
import {
	type NoticeMessage,
	RuntimeNoticeCard,
} from "./runtime-notice-card.ts";

export const EXPLORATION_BUDGET_TYPE = "pi-workflow-exploration-budget";

export function formatBytes(bytes: number) {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function registerExplorationBudgetCard(pi: ExtensionAPI) {
	pi.registerMessageRenderer(
		EXPLORATION_BUDGET_TYPE,
		(message: NoticeMessage, { expanded }, t) => {
			const facts = message.details as ExplorationFacts | undefined;
			if (
				typeof facts?.lookups !== "number" ||
				typeof facts?.textBytes !== "number"
			)
				return undefined;
			return new RuntimeNoticeCard(
				message,
				{
					title: "Exploration budget",
					metric: {
						text: `${facts.lookups} lookups · ${formatBytes(facts.textBytes)}`,
						tone: "dim",
					},
					action: "continue discovery in an explore child",
					wide: { metric: "· ", action: " → " },
				},
				expanded,
				t,
			);
		},
	);
}
