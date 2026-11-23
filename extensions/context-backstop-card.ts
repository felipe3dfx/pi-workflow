import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

import { formatContextTokens } from "./chrome.ts";
import {
	type BackstopDetails,
	CONTEXT_BACKSTOP_TYPE,
} from "./context-backstop.ts";
import {
	type NoticeMessage,
	type NoticeParts,
	RuntimeNoticeCard,
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
	t: Theme,
	advisor: BackstopDetails["advisor"],
	lead: string,
) {
	if (!advisor) return "";
	const { turnsAgo } = advisor;
	if (typeof turnsAgo !== "number")
		return t.fg("dim", `${lead}advisor not consulted`);
	const when =
		turnsAgo === 0
			? "this turn"
			: `${turnsAgo} ${turnsAgo === 1 ? "turn" : "turns"} ago`;
	return `${t.fg("dim", `${lead}advisor `)}${t.fg("success", "✓")}${t.fg("dim", ` ${when}`)}`;
}

const action = "delegate the next bounded unit";

function backstopParts(t: Theme, details: BackstopDetails): NoticeParts {
	const { tokens, threshold, contextWindow, advisor } = details;
	const usage = `${formatContextTokens(tokens)} / ${formatContextTokens(threshold)}${meter(tokens, contextWindow)}`;
	const head = `${t.fg("warning", "◆")} ${t.bold(t.fg("muted", "Context"))} ${t.fg("warning", usage)}`;
	return {
		head,
		action,
		status: advisorStatus(t, advisor, ""),
		line: `${head}${t.fg("dim", ` · ${action}`)}${advisorStatus(t, advisor, " · ")}`,
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
				backstopParts(t, details),
				expanded,
				t,
			);
		},
	);
}
