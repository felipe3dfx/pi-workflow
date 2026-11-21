import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

import { formatContextTokens } from "./chrome.ts";
import {
	type BackstopDetails,
	CONTEXT_BACKSTOP_TYPE,
} from "./context-backstop.ts";
import {
	type NoticeMessage,
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

function advisorStatus(t: Theme, advisor: BackstopDetails["advisor"]) {
	if (!advisor) return "";
	const { turnsAgo } = advisor;
	if (typeof turnsAgo !== "number")
		return t.fg("dim", " · advisor not consulted");
	const when =
		turnsAgo === 0
			? "this turn"
			: `${turnsAgo} ${turnsAgo === 1 ? "turn" : "turns"} ago`;
	return `${t.fg("dim", " · advisor ")}${t.fg("success", "✓")}${t.fg("dim", ` ${when}`)}`;
}

function backstopHead(t: Theme, details: BackstopDetails) {
	const { tokens, threshold, contextWindow, advisor } = details;
	const usage = `${formatContextTokens(tokens)} / ${formatContextTokens(threshold)}${meter(tokens, contextWindow)}`;
	return `${t.fg("warning", "◆")} ${t.bold(t.fg("muted", "Context"))} ${t.fg("warning", usage)}${t.fg("dim", " · delegate the next bounded unit")}${advisorStatus(t, advisor)}`;
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
				backstopHead(t, details),
				expanded,
				t,
			);
		},
	);
}
