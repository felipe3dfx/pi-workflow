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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FooterHints } from "./chrome.ts";
import { marginFor } from "./chrome-editor.ts";
import { hidden } from "./compact-tools.ts";
import { seated } from "./shell.ts";
import { closeChildrenView } from "./children-view.ts";
import { offerTool } from "./tool-offer.ts";
import { terminalSafeBlock, terminalSafeLine } from "./terminal-safe-text.ts";

interface AskUserOption {
	label: string;
	description?: string;
}

export type AskUserAnswer =
	| { status: "answered"; kind: "option"; index: number; label: string }
	| { status: "answered"; kind: "options"; indices: number[]; labels: string[]; text?: string }
	| { status: "answered"; kind: "text"; text: string }
	| { status: "refused"; reason: string };

const CAPTION = " question ";
const minFrame = 12;
const minLabel = 4;
const footerRows = 1;

function normalizeSingleLine(text: string): string {
	return terminalSafeLine(text.replace(/\r\n/g, " "));
}

function normalizeQuestionText(text: string): string {
	return terminalSafeBlock(text.replace(/\r\n?/g, "\n"));
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

	closeChildrenView();
	const answer = await ctx.ui.custom<AskUserAnswer>((tui, theme, keybindings, done) => {
		const freeTextIndex = options.length;
		const rowCount = options.length + 1;
		const input = new Input({ prompt: "" });
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

		const component: Component = {
			render(width) {
				const edge = marginFor(width);
				const frameWidth = width - edge * 2;
				const framed = frameWidth >= minFrame;
				const contentWidth = Math.max(1, framed ? frameWidth - 4 : frameWidth);
				const border = (text: string) => theme.fg("borderAccent", text);
				const row = (content: string) => {
					if (!framed) return content;
					const clipped = truncateToWidth(content, contentWidth, "");
					const pad = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
					return `${border("│")} ${clipped}${pad} ${border("│")}`;
				};
				const strong = (text: string) => theme.bold(theme.fg("text", text));
				const numberWidth = String(Math.max(options.length, 1)).length;
				const markWidth = multiple ? 4 : 0;
				const prefixWidth = 2 + markWidth + numberWidth + 2;
				const pointer = (active: boolean) => (active ? strong("❯ ") : "  ");
				const labels = options.map((option) => normalizeSingleLine(option.label));
				const labelRoom = Math.max(0, contentWidth - prefixWidth);
				const labelWidth = Math.min(
					Math.max(0, ...labels.map((label) => visibleWidth(label))),
					options.some((option) => option.description) ? Math.floor(0.45 * labelRoom) : labelRoom,
				);
				const descriptionWidth = contentWidth - prefixWidth - labelWidth - 2;
				let wrapped: [string[], string[]] | undefined;
				const optionRows = (i: number, limit = Number.POSITIVE_INFINITY) => {
					const active = i === index;
					const description = options[i].description ? normalizeSingleLine(options[i].description) : "";
					const mark = multiple
						? marked.has(i)
							? strong("[x] ")
							: theme.fg("dim", "[ ] ")
						: "";
					const number = String(i + 1).padStart(numberWidth);
					const head = `${pointer(active)}${mark}${active ? strong(number) : theme.fg("muted", number)}  `;
					const shown = description && descriptionWidth >= 4;
					if (!active || labelWidth < minLabel || limit < 2) {
						const label = truncateToWidth(labels[i], labelWidth, "…", true);
						const tail = shown ? `  ${theme.fg("dim", truncateToWidth(description, descriptionWidth, "…"))}` : "";
						return [`${head}${active ? strong(label) : theme.fg("text", label)}${tail}`];
					}
					const cut = (lines: string[], width: number) =>
						lines.length > limit
							? [...lines.slice(0, limit - 1), truncateToWidth(`${lines[limit - 1]}…`, width, "…")]
							: lines;
					wrapped ??= [
						wrapTextWithAnsi(labels[i], labelWidth),
						shown ? wrapTextWithAnsi(description, descriptionWidth) : [],
					];
					const labelLines = cut(wrapped[0], labelWidth);
					const descriptionLines = cut(wrapped[1], descriptionWidth);
					return Array.from({ length: Math.max(labelLines.length, descriptionLines.length) }, (_, k) => {
						const label = strong(truncateToWidth(labelLines[k] ?? "", labelWidth, "", true));
						const tail = descriptionLines[k] ? `  ${theme.fg("dim", descriptionLines[k])}` : "";
						return `${k === 0 ? head : " ".repeat(prefixWidth)}${label}${tail}`;
					});
				};
				const questionLines = wrapTextWithAnsi(strong(normalizeQuestionText(question)), contentWidth);
				const active = isFreeTextRow(index);
				input.focused = active && mode === "edit";
				const freeHead =
					options.length > 0
						? `${pointer(active)}${" ".repeat(markWidth)}${active ? strong("z".padStart(numberWidth)) : theme.fg("muted", "z".padStart(numberWidth))}  `
						: pointer(active);
				const freeRow = input.focused
					? freeHead + (input.render(Math.max(contentWidth - visibleWidth(freeHead), 1))[0] ?? "")
					: freeHead + (input.getValue() ? theme.fg("text", input.getValue()) : theme.fg("dim", "Type your answer"));
				const body = [...questionLines];
				if (options.length > 0) {
					const budget = Math.max(
						1,
						Math.floor(tui.terminal.rows / 2) - (framed ? 2 : 0) - questionLines.length - 3,
					);
					const focus = Math.min(index, options.length - 1);
					const span = (visible: number) => {
						const first = Math.min(Math.max(0, focus - Math.floor(visible / 2)), options.length - visible);
						return [first, first + visible];
					};
					const height = (visible: number, tall: number) => {
						const [first, last] = span(visible);
						return visible - 1 + tall + (first > 0 ? 1 : 0) + (last < options.length ? 1 : 0);
					};
					const tall = active ? 1 : optionRows(index).length;
					let visible = options.length - 1 + tall <= budget ? options.length : Math.max(1, budget - tall - 1);
					if (visible + 1 < options.length && height(visible + 1, tall) <= budget) visible++;
					if (options.length <= height(visible, 1)) visible = options.length;
					const activeRows = active ? [] : optionRows(index, Math.max(1, budget - height(visible, 1) + 1));
					const [first, last] = span(visible);
					const more = (arrow: string, count: number) => {
						const long = `${arrow} ${count} more`;
						const text = visibleWidth(long) <= contentWidth ? long : `${arrow} ${count}`;
						const indent = prefixWidth + visibleWidth(text) <= contentWidth ? prefixWidth : 0;
						return theme.fg("dim", `${" ".repeat(indent)}${text}`);
					};
					body.push("");
					if (first > 0) body.push(more("↑", first));
					for (let i = first; i < last; i++) body.push(...(i === index ? activeRows : optionRows(i)));
					if (last < options.length) body.push(more("↓", options.length - last));
					body.push("");
				}
				body.push(freeRow);
				const lines = body.map(row);
				if (framed) {
					const caption = frameWidth - 4 >= visibleWidth(CAPTION) ? CAPTION : "";
					lines.unshift(border(`╭${"─".repeat(frameWidth - 2)}╮`));
					lines.push(
						border(`╰${"─".repeat(frameWidth - 3 - visibleWidth(caption))}`) +
							theme.fg("dim", caption) +
							border("─╯"),
					);
				}
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
				return lines.map((line) => truncateToWidth(" ".repeat(edge) + line, width));
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
	}, {
		overlay: true,
		overlayOptions: { anchor: "bottom-center", width: "100%", margin: { bottom: footerRows } },
	}).finally(() => hints.set(undefined));

	return { content: [{ type: "text", text: describeAnswer(answer) }], details: answer };
}

type AskTheme = Parameters<NonNullable<ToolDefinition["renderCall"]>>[1];

function answerText(answer: AskUserAnswer | undefined) {
	if (!answer) return "";
	if (answer.status === "refused") return "Dismissed";
	if (answer.kind === "option") return answer.label;
	if (answer.kind === "text") return answer.text;
	return [...answer.labels, ...(answer.text ? [answer.text] : [])].join(", ");
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
			const answer = normalizeSingleLine(answerText(result.details)).trim();
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
			"Ask the operator to pick one of several numbered options, or several with multiple: true, in the question panel. Refuses in print mode or when no TUI session is available, and never launches a child session.",
		promptSnippet: "Ask the operator to choose among numbered options in the question panel",
		promptGuidelines: [
			"Use ask_user_choice for a closed decision with a short list of named options.",
			"Set multiple: true on ask_user_choice only when the options are not mutually exclusive.",
			"ask_user_choice never launches a child session and never invents an answer when the operator dismisses or is unavailable.",
		],
		parameters: choiceParameters,
		executionMode: "sequential",
		...askRenderers(),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!seated("operator-questions", "overlay")) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Operator questions are not seated. Run /workflow:config.",
						},
					],
					details: {
						status: "refused",
						reason: "Operator questions are not seated.",
					},
				};
			}
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
			"Ask the operator an open question and collect a free-text answer in the question panel. Refuses in print mode or when no TUI session is available, and never launches a child session.",
		promptSnippet: "Ask the operator an open question in the question panel",
		promptGuidelines: [
			"Use ask_user_question for an open question with no fixed set of options.",
			"ask_user_question never launches a child session and never invents an answer when the operator dismisses or is unavailable.",
		],
		parameters: questionParameters,
		executionMode: "sequential",
		...askRenderers(),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!seated("operator-questions", "overlay")) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Operator questions are not seated. Run /workflow:config.",
						},
					],
					details: {
						status: "refused",
						reason: "Operator questions are not seated.",
					},
				};
			}
			return askPanel(ctx, hints, params.question, [], false, signal);
		},
	};
}

export function syncAskUserTools(pi: ExtensionAPI, hints: FooterHints) {
	const on = seated("operator-questions", "overlay");
	offerTool(pi, createAskUserChoiceTool(hints), on);
	offerTool(pi, createAskUserQuestionTool(hints), on);
}
