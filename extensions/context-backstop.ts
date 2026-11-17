import type { ContextUsage } from "@earendil-works/pi-coding-agent";

export const CONTEXT_BACKSTOP_TYPE = "pi-workflow-context-backstop";

export type ContextReading = Pick<ContextUsage, "tokens" | "contextWindow">;

export type BackstopFacts = { tokens: number; threshold: number };

const TOKEN_CAP = 150_000;
const WINDOW_FRACTION = 0.15;

export function backstopThreshold(contextWindow: number | undefined) {
	return typeof contextWindow === "number" && contextWindow > 0
		? Math.min(TOKEN_CAP, Math.floor(WINDOW_FRACTION * contextWindow))
		: TOKEN_CAP;
}

export function createContextBackstop() {
	let notified = false;
	return {
		reading(usage: ContextReading | undefined): BackstopFacts | undefined {
			if (typeof usage?.tokens !== "number") return;
			const threshold = backstopThreshold(usage.contextWindow);
			if (usage.tokens < threshold) {
				notified = false;
				return;
			}
			if (notified) return;
			notified = true;
			return { tokens: usage.tokens, threshold };
		},
	};
}

export function backstopNotice({ tokens, threshold }: BackstopFacts): string {
	return `Context backstop: the parent context holds ${tokens.toLocaleString("en-US")} tokens, at or above the ${threshold.toLocaleString("en-US")}-token threshold. Delegate the next bounded multi-step unit to a child session through spawn_child; single small edits and state checks stay inline. This is runtime context for the original task, not a new user request. This notice grants no mutation or guard bypass authority.`;
}
