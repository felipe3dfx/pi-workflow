import {
	type ExtensionAPI,
	keyText,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { markToggle } from "./chrome-groups.ts";
import { assistantInset, edgeFor } from "./chrome-messages.ts";
import type { ExplorationFacts } from "./exploration-budget.ts";
import { terminalSafeBlock } from "./terminal-safe-text.ts";
import { spread } from "./visual-language.ts";

export const EXPLORATION_BUDGET_TYPE = "pi-workflow-exploration-budget";

type Message = { content: unknown; details?: unknown };

const opened = new WeakMap<Message, boolean>();

export function formatBytes(bytes: number) {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function noticeText(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

class ExplorationBudgetCard implements Component {
	message: Message;
	facts: ExplorationFacts;
	text: string;
	expanded: boolean;
	theme: Theme;

	constructor(
		message: Message,
		facts: ExplorationFacts,
		expanded: boolean,
		theme: Theme,
	) {
		this.message = message;
		this.facts = facts;
		this.text = noticeText(message.content);
		this.expanded = expanded;
		this.theme = theme;
		markToggle(this);
	}

	open() {
		return this.expanded || opened.get(this.message) === true;
	}

	invalidate() {}

	handleMouse(event: TuiMouseEvent) {
		if (event.type !== "click" || event.button !== "left" || event.y > 0)
			return undefined;
		opened.set(this.message, !this.open());
		return { handled: true };
	}

	render(outer: number) {
		const t = this.theme;
		const edge = edgeFor(assistantInset, outer);
		const width = Math.max(1, outer - edge * 2);
		const margin = " ".repeat(edge);
		const { lookups, textBytes } = this.facts;
		const head = `${t.fg("warning", "◆")} ${t.bold(t.fg("muted", "Exploration budget"))} ${t.fg("dim", `· ${lookups} lookups · ${formatBytes(textBytes)} → continue discovery in an explore child`)}`;
		const key = keyText("app.tools.expand");
		const hint = key
			? t.fg("dim", `(${key} to ${this.open() ? "collapse" : "expand"})`)
			: "";
		const top =
			hint && visibleWidth(head) + visibleWidth(hint) + 2 <= width
				? spread(head, hint, width)
				: truncateToWidth(head, width);
		const lines = [margin + top];
		if (!this.open() || !this.text) return lines;
		const inner = Math.max(1, width - 2);
		for (const line of wrapTextWithAnsi(
			t.fg("dim", terminalSafeBlock(this.text)),
			inner,
		))
			lines.push(`${margin}  ${line}`);
		return lines;
	}
}

export function registerExplorationBudgetCard(pi: ExtensionAPI) {
	pi.registerMessageRenderer(
		EXPLORATION_BUDGET_TYPE,
		(message: Message, { expanded }, theme) => {
			const facts = message.details as ExplorationFacts | undefined;
			if (
				typeof facts?.lookups !== "number" ||
				typeof facts?.textBytes !== "number"
			)
				return undefined;
			return new ExplorationBudgetCard(message, facts, expanded, theme);
		},
	);
}
