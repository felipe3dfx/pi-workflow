import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	Input,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { FooterHints } from "./chrome.ts";
import { marginFor } from "./chrome-editor.ts";

interface AskUserOption {
	label: string;
	description?: string;
}

export type AskUserAnswer =
	| { status: "answered"; kind: "option"; index: number; label: string }
	| { status: "answered"; kind: "options"; indices: number[]; labels: string[]; text?: string }
	| { status: "answered"; kind: "text"; text: string }
	| { status: "refused"; reason: string };

const ACCENT_BAR = "┃";
const RESET = "\x1b[0m";
const padLeft = 3;
const padRight = 2;

const CONTROL_OR_BIDI = /[\p{Cc}\p{Bidi_Control}]/gu;

function normalizeSingleLine(text: string): string {
	return text.replace(/\r\n/g, " ").replace(CONTROL_OR_BIDI, " ");
}

function normalizeQuestionText(text: string): string {
	const withLf = text.replace(/\r\n?/g, "\n");
	return withLf.replace(CONTROL_OR_BIDI, (ch) => (ch === "\n" ? ch : " "));
}

function printableChar(data: string): string | undefined {
	const kittyDecoded = decodeKittyPrintable(data);
	if (kittyDecoded !== undefined) return kittyDecoded;
	if (data.length === 1) {
		const code = data.charCodeAt(0);
		if (code >= 0x20 && code !== 0x7f) return data;
	}
	return undefined;
}

const NO_UI_REASON =
	"No interactive session is available to ask the operator; the tool refuses instead of inventing an answer.";
const ABORTED_REASON = "The turn was aborted.";

function refusal(reason: string): AgentToolResult<AskUserAnswer> {
	const details: AskUserAnswer = { status: "refused", reason };
	return { content: [{ type: "text", text: `Refused: ${reason}` }], details };
}

function describeAnswer(answer: AskUserAnswer): string {
	if (answer.status === "refused") return `Refused: ${answer.reason}`;
	if (answer.kind === "option") return `Selected option ${answer.index + 1}: ${answer.label}`;
	if (answer.kind === "options") {
		const parts = answer.indices.map((i, k) => `${i + 1}: ${answer.labels[k]}`);
		const base = `Selected options ${parts.join(", ")}`;
		return answer.text ? `${base}; free text: ${answer.text}` : base;
	}
	return `Free-text answer: ${answer.text}`;
}

async function askPanel(
	ctx: ExtensionContext,
	hints: FooterHints,
	question: string,
	options: AskUserOption[],
	multiple: boolean,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<AskUserAnswer>> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		return refusal(NO_UI_REASON);
	}
	if (signal?.aborted) {
		return refusal(ABORTED_REASON);
	}

	const answer = await ctx.ui.custom<AskUserAnswer>((_tui, theme, keybindings, done) => {
		const freeTextIndex = options.length;
		const rowCount = options.length + 1;
		const input = new Input();
		const marked = new Set<number>();
		let index = 0;
		let mode: "browse" | "edit" = options.length === 0 ? "edit" : "browse";

		const isFreeTextRow = (i: number) => i === freeTextIndex;

		const finish = (result: AskUserAnswer) => {
			signal?.removeEventListener("abort", onAbort);
			done(result);
		};
		const onAbort = () => finish({ status: "refused", reason: ABORTED_REASON });
		signal?.addEventListener("abort", onAbort, { once: true });

		const toggleMark = (i: number) => {
			if (marked.has(i)) marked.delete(i);
			else marked.add(i);
		};

		const submitMarked = () => {
			const indices = [...marked].sort((a, b) => a - b);
			if (indices.length === 0) return;
			const text = input.getValue().trim();
			const labels = indices.map((i) => options[i].label);
			finish({
				status: "answered",
				kind: "options",
				indices,
				labels,
				...(text.length > 0 ? { text } : {}),
			});
		};

		input.onSubmit = (value) => {
			if (multiple) {
				submitMarked();
				return;
			}
			if (value.trim().length === 0) return;
			finish({ status: "answered", kind: "text", text: value });
		};
		input.onEscape = () => {};

		const submitCurrent = () => {
			const option = options[index];
			finish({ status: "answered", kind: "option", index, label: option.label });
		};

		const rowMarker = (checked: boolean, active: boolean, checkable = true) =>
			multiple && checkable ? (checked ? "[x]" : "[ ]") : active ? "(●)" : "(○)";

		const component: Component = {
			render(width) {
				const margin = " ".repeat(marginFor(width));
				const bodyWidth = Math.max(0, width - margin.length * 2 - 1);
				const contentWidth = Math.max(1, bodyWidth - padLeft - padRight);
				const block = (content: string, selected = false) =>
					margin +
					theme.fg("text", ACCENT_BAR) +
					truncateToWidth(`${" ".repeat(padLeft)}${content}`, bodyWidth, "", true)
						.split(RESET)
						.map((part) => theme.bg(selected ? "selectedBg" : "customMessageBg", part))
						.join(RESET) +
					margin;
				const marker = (glyph: string, on: boolean) =>
					on ? theme.bold(theme.fg("text", glyph)) : theme.fg("dim", glyph);
				const numberWidth = String(Math.max(options.length, 1)).length;
				const prefixWidth = numberWidth + 5;
				const labels = options.map((option) => normalizeSingleLine(option.label));
				const labelRoom = Math.max(0, contentWidth - prefixWidth);
				const labelWidth = Math.min(
					Math.max(0, ...labels.map((label) => visibleWidth(label))),
					options.some((option) => option.description) ? Math.floor(0.45 * labelRoom) : labelRoom,
				);
				const descriptionWidth = contentWidth - prefixWidth - labelWidth - 2;
				const lines = [
					block(""),
					...wrapTextWithAnsi(
						theme.bold(theme.fg("text", normalizeQuestionText(question))),
						contentWidth,
					).map((line) => block(line)),
					block(""),
				];
				options.forEach((option, i) => {
					const active = i === index;
					const glyph = rowMarker(marked.has(i), active);
					const description = option.description ? normalizeSingleLine(option.description) : "";
					const head = `${theme.fg("text", String(i + 1).padStart(numberWidth))} ${marker(glyph, multiple ? marked.has(i) : active)} `;
					const shown = description && descriptionWidth >= 4;
					if (!active) {
						const label = truncateToWidth(labels[i], labelWidth, "…", true);
						const tail = shown ? `  ${theme.fg("dim", truncateToWidth(description, descriptionWidth, "…"))}` : "";
						lines.push(block(`${head}${theme.fg("text", label)}${tail}`));
						return;
					}
					const labelLines = wrapTextWithAnsi(labels[i], Math.max(1, labelWidth));
					const descriptionLines = shown ? wrapTextWithAnsi(description, descriptionWidth) : [];
					for (let k = 0; k < Math.max(labelLines.length, descriptionLines.length); k++) {
						const label = theme.fg("text", theme.bold(truncateToWidth(labelLines[k] ?? "", labelWidth, "", true)));
						const tail = descriptionLines[k] ? `  ${theme.fg("dim", descriptionLines[k])}` : "";
						lines.push(block(`${k === 0 ? head : " ".repeat(prefixWidth)}${label}${tail}`, true));
					}
				});
				const active = isFreeTextRow(index);
				input.focused = active && mode === "edit";
				const glyph = rowMarker(false, active, false);
				const prefix = `${theme.fg("text", "z".padStart(numberWidth))} ${marker(glyph, active && !multiple)} `;
				const row = input.focused
					? prefix + (input.render(Math.max(contentWidth - prefixWidth, 1))[0] ?? "")
					: prefix + (input.getValue() ? theme.fg("text", input.getValue()) : theme.fg("dim", "Type your answer"));
				lines.push(block(row, active));
				lines.push(block(""));
				const hasAnyMarked = marked.size > 0;
				const enterHint = isFreeTextRow(index)
					? "Enter:edit free text"
					: `Enter:${multiple ? (hasAnyMarked ? "submit marked" : "select at least one") : "select"}`;
				const browseHintParts = ["↑/↓:move"];
				if (multiple) browseHintParts.push("Space:mark");
				browseHintParts.push(enterHint);
				browseHintParts.push("z:edit free text", "Esc:panel stays open", "Shift+X:dismiss");
				const editEnterHint = multiple ? (hasAnyMarked ? "submit marked" : "select at least one") : "submit";
				const hintParts =
					mode === "edit"
						? [`Enter:${editEnterHint}`, "↑/↓:leave & move", "Esc:back to browse"]
						: browseHintParts;
				hints.set(
					hintParts.map((part) => {
						const split = part.indexOf(":");
						return { key: part.slice(0, split), action: part.slice(split + 1) };
					}),
				);
				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate() {},
			handleInput(data: string) {
				if (mode === "edit") {
					if (keybindings.matches(data, "tui.select.up")) {
						mode = "browse";
						index = (index - 1 + rowCount) % rowCount;
						return;
					}
					if (keybindings.matches(data, "tui.select.down")) {
						mode = "browse";
						index = (index + 1) % rowCount;
						return;
					}
					if (matchesKey(data, Key.escape)) {
						mode = "browse";
						return;
					}
					input.handleInput(data);
					return;
				}
				if (keybindings.matches(data, "tui.select.up")) {
					index = (index - 1 + rowCount) % rowCount;
					return;
				}
				if (keybindings.matches(data, "tui.select.down")) {
					index = (index + 1) % rowCount;
					return;
				}
				if (matchesKey(data, Key.shift("x"))) {
					finish({ status: "refused", reason: "The operator dismissed the question with Shift+X." });
					return;
				}
				if (multiple && matchesKey(data, Key.space) && !isFreeTextRow(index)) {
					toggleMark(index);
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (isFreeTextRow(index)) {
						mode = "edit";
						return;
					}
					if (multiple) {
						submitMarked();
					} else {
						submitCurrent();
					}
					return;
				}
				const char = printableChar(data);
				if (char === undefined) return;
				const digit = Number.parseInt(char, 10);
				if (!Number.isNaN(digit) && digit >= 1 && digit <= options.length) {
					index = digit - 1;
					return;
				}
				if (char === "z" || char === "Z") {
					index = freeTextIndex;
					mode = "edit";
				}
			},
		};

		return component;
	}).finally(() => hints.set(undefined));

	return { content: [{ type: "text", text: describeAnswer(answer) }], details: answer };
}

type AskTheme = Parameters<NonNullable<ToolDefinition["renderCall"]>>[1];

const hidden: Component = { render: () => [], invalidate() {} };

function answerText(answer: AskUserAnswer | undefined) {
	if (!answer) return "";
	if (answer.status === "refused") return "Dismissed";
	if (answer.kind === "option") return answer.label;
	if (answer.kind === "text") return answer.text;
	return [...answer.labels, ...(answer.text ? [answer.text] : [])].join(", ");
}

function contentAnswer(content: AgentToolResult<unknown>["content"]) {
	const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
	const single = /^Selected option \d+: ([\s\S]*)$/.exec(text);
	if (single) return single[1];
	const many = /^Selected options ([\s\S]*?)(?:; free text: ([\s\S]*))?$/.exec(text);
	if (many) return [many[1].replace(/(^|, )\d+: /g, "$1"), many[2]].filter(Boolean).join(", ");
	return /^Free-text answer: ([\s\S]*)$/.exec(text)?.[1] ?? "";
}

function askRenderers() {
	return {
		renderShell: "self" as const,
		renderCall: () => hidden,
		renderResult(
			result: AgentToolResult<AskUserAnswer>,
			options: { isPartial: boolean },
			theme: AskTheme,
			context: { args: { question?: string } },
		): Component {
			if (options.isPartial) return hidden;
			const question = normalizeSingleLine(context.args.question ?? "");
			const answer = normalizeSingleLine(
				result.details ? answerText(result.details) : contentAnswer(result.content),
			).trim();
			const head = `${theme.fg("toolTitle", "◆")} ${theme.bold(theme.fg("muted", "Asked"))} ${theme.fg("dim", question)}`;
			return new Text(
				answer ? `${head}\n  ${theme.fg("dim", `↳ ${answer}`)}` : head,
				0,
				0,
			);
		},
	};
}

const optionSchema = Type.Object({
	label: Type.String({ description: "The option's label, shown next to its number." }),
	description: Type.Optional(Type.String({ description: "Short description shown to the right of the option." })),
});

const choiceParameters = Type.Object({
	question: Type.String({ description: "The question to ask the operator." }),
	options: Type.Array(optionSchema, { minItems: 1, description: "Numbered options presented to the operator." }),
	multiple: Type.Optional(
		Type.Boolean({
			description:
				"If true, the operator marks any number of options (checkboxes) instead of choosing exactly one, and submits every marked option at once, plus free text if typed. Defaults to false (single choice).",
		}),
	),
});

export function createAskUserChoiceTool(hints: FooterHints): ToolDefinition<typeof choiceParameters, AskUserAnswer> {
	return {
		name: "ask_user_choice",
		label: "Ask User Choice",
		description:
			"Ask the operator to pick one of several numbered options, or several with multiple: true, from the TUI question panel. Refuses in print mode or when no TUI session is available, and never launches a child session.",
		promptSnippet: "Ask the operator to choose among numbered options in the TUI question panel",
		promptGuidelines: [
			"Use ask_user_choice for a closed decision with a short list of named options.",
			"Set multiple: true on ask_user_choice only when the options are not mutually exclusive.",
			"ask_user_choice never launches a child session and never invents an answer when the operator dismisses or is unavailable.",
		],
		parameters: choiceParameters,
		executionMode: "sequential",
		...askRenderers(),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return askPanel(ctx, hints, params.question, params.options, params.multiple ?? false, signal);
		},
	};
}

const questionParameters = Type.Object({
	question: Type.String({ description: "The open-ended question to ask the operator." }),
});

export function createAskUserQuestionTool(hints: FooterHints): ToolDefinition<typeof questionParameters, AskUserAnswer> {
	return {
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask the operator an open question and collect a free-text answer from the TUI question panel. Refuses in print mode or when no TUI session is available, and never launches a child session.",
		promptSnippet: "Ask the operator an open question in the TUI question panel",
		promptGuidelines: [
			"Use ask_user_question for an open question with no fixed set of options.",
			"ask_user_question never launches a child session and never invents an answer when the operator dismisses or is unavailable.",
		],
		parameters: questionParameters,
		executionMode: "sequential",
		...askRenderers(),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return askPanel(ctx, hints, params.question, [], false, signal);
		},
	};
}
