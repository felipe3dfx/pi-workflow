import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { formatContextTokens } from "./chrome.ts";
import {
	type BackstopDetails,
	CONTEXT_BACKSTOP_TYPE,
} from "./context-backstop.ts";
import {
	type NoticeMessage,
	type NoticeParts,
	RuntimeNoticeCard,
	type Span,
} from "./runtime-notice-card.ts";

const meterCells = 8;

function meter(tokens: number, contextWindow: number | undefined) {
	if (typeof contextWindow !== "number" || contextWindow <= 0) return "";
	const filled = Math.min(
		meterCells,
		Math.max(0, Math.round((tokens / contextWindow) * meterCells)),
	);
	return ` ${"▰".repeat(filled)}${"▱".repeat(meterCells - filled)}`;
}

function advisorStatus(
	advisor: BackstopDetails["advisor"],
): Span[] | undefined {
	if (!advisor) return undefined;
	const { turnsAgo } = advisor;
	if (typeof turnsAgo !== "number")
		return [{ text: "advisor not consulted", tone: "dim" }];
	const when =
		turnsAgo === 0
			? "this turn"
			: `${turnsAgo} ${turnsAgo === 1 ? "turn" : "turns"} ago`;
	return [
		{ text: "advisor ", tone: "dim" },
		{ text: "✓", tone: "success" },
		{ text: ` ${when}`, tone: "dim" },
	];
}

function backstopParts(details: BackstopDetails): NoticeParts {
	const { tokens, threshold, contextWindow, advisor } = details;
	return {
		title: "Context",
		metric: {
			text: `${formatContextTokens(tokens)} / ${formatContextTokens(threshold)}${meter(tokens, contextWindow)}`,
			tone: "warning",
		},
		action: "delegate the next bounded unit",
		status: advisorStatus(advisor),
		wide: { metric: "", action: " · " },
	};
}

export function registerContextBackstopCard(pi: ExtensionAPI) {
	pi.registerMessageRenderer(
		CONTEXT_BACKSTOP_TYPE,
		(message: NoticeMessage, { expanded }, t) => {
			const details = message.details as BackstopDetails | undefined;
			if (
				typeof details?.tokens !== "number" ||
				typeof details?.threshold !== "number"
			)
				return undefined;
			return new RuntimeNoticeCard(
				message,
				backstopParts(details),
				expanded,
				t,
			);
		},
	);
}
