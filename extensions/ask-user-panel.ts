import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, Input, Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskUserOption {
	label: string;
	description?: string;
}

export type AskUserAnswer =
	| { status: "answered"; kind: "option"; index: number; label: string }
	| { status: "answered"; kind: "text"; text: string }
	| { status: "refused"; reason: string };

export interface AskUserPanelState {
	pendingCount: number;
}

export function createAskUserPanelState(): AskUserPanelState {
	return { pendingCount: 0 };
}

const ASK_USER_TOOL_NAMES = new Set(["ask_user_choice", "ask_user_question"]);

export function registerAskUserQueueCounter(pi: ExtensionAPI, state: AskUserPanelState): void {
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		state.pendingCount = event.message.content.filter(
			(block) => block.type === "toolCall" && ASK_USER_TOOL_NAMES.has(block.name),
		).length;
	});
	pi.on("tool_execution_end", (event) => {
		if (!ASK_USER_TOOL_NAMES.has(event.toolName)) return;
		state.pendingCount = Math.max(0, state.pendingCount - 1);
	});
	pi.on("turn_end", () => {
		state.pendingCount = 0;
	});
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
	return `Free-text answer: ${answer.text}`;
}

async function askPanel(
	ctx: ExtensionContext,
	state: AskUserPanelState,
	question: string,
	options: AskUserOption[],
	allowFreeText: boolean,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<AskUserAnswer>> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		return refusal(NO_UI_REASON);
	}
	if (signal?.aborted) {
		return refusal(ABORTED_REASON);
	}

	const startedAt = Date.now();

	const answer = await ctx.ui.custom<AskUserAnswer>((_tui, theme, _keybindings, done) => {
		const freeTextIndex = options.length;
		const rowCount = allowFreeText ? options.length + 1 : options.length;
		const input = new Input();
		let index = 0;
		let mode: "browse" | "edit" = allowFreeText && options.length === 0 ? "edit" : "browse";

		const isFreeTextRow = (i: number) => allowFreeText && i === freeTextIndex;

		const finish = (result: AskUserAnswer) => {
			signal?.removeEventListener("abort", onAbort);
			done(result);
		};
		const onAbort = () => finish({ status: "refused", reason: ABORTED_REASON });
		signal?.addEventListener("abort", onAbort, { once: true });

		input.onSubmit = (value) => {
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
				const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
				const usage = ctx.getContextUsage();
				const tokenInfo = usage?.tokens != null ? `${usage.tokens} tokens` : "token count unavailable";
				const waiting = `${state.pendingCount} question${state.pendingCount === 1 ? "" : "s"} waiting`;
				const lines = [
					theme.fg("dim", `${waiting} · ${elapsedSeconds}s · ${tokenInfo}`),
					theme.bold(question),
				];
				options.forEach((option, i) => {
					const active = i === index;
					const radio = active ? "●" : "○";
					const left = `${i + 1} (${radio}) ${option.label}`;
					const row = option.description ? `${left}  ${option.description}` : left;
					lines.push(active ? theme.fg("accent", row) : row);
				});
				if (allowFreeText) {
					const active = isFreeTextRow(index);
					input.focused = active && mode === "edit";
					const radio = active ? "●" : "○";
					const prefix = `z (${radio}) `;
					const row = input.focused
						? prefix + (input.render(Math.max(width - prefix.length, 1))[0] ?? "")
						: `${prefix}${input.getValue() || "Type your answer"}`;
					lines.push(active ? theme.fg("accent", row) : row);
				}
				const browseHintParts = ["Tab:next answer", "Enter:select"];
				if (allowFreeText) browseHintParts.push("z:edit free text");
				browseHintParts.push("Esc:panel stays open", "Shift+X:dismiss");
				const hint =
					mode === "edit"
						? "Enter:submit  Tab:next answer  Esc:back to browse"
						: browseHintParts.join("  ");
				lines.push(theme.fg("dim", hint));
				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate() {},
			handleInput(data: string) {
				if (mode === "edit") {
					if (matchesKey(data, Key.tab)) {
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
				if (matchesKey(data, Key.tab)) {
					index = (index + 1) % rowCount;
					return;
				}
				if (matchesKey(data, Key.shift("x"))) {
					finish({ status: "refused", reason: "The operator dismissed the question with Shift+X." });
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (isFreeTextRow(index)) {
						mode = "edit";
						return;
					}
					submitCurrent();
					return;
				}
				const char = printableChar(data);
				if (char === undefined) return;
				const digit = Number.parseInt(char, 10);
				if (!Number.isNaN(digit) && digit >= 1 && digit <= options.length) {
					index = digit - 1;
					return;
				}
				if (allowFreeText && (char === "z" || char === "Z")) {
					index = freeTextIndex;
					mode = "edit";
				}
			},
		};

		return component;
	});

	return { content: [{ type: "text", text: describeAnswer(answer) }], details: answer };
}

const optionSchema = Type.Object({
	label: Type.String({ description: "The option's label, shown next to its number." }),
	description: Type.Optional(Type.String({ description: "Short description shown to the right of the option." })),
});

const choiceParameters = Type.Object({
	question: Type.String({ description: "The question to ask the operator." }),
	options: Type.Array(optionSchema, { minItems: 1, description: "Numbered options presented to the operator." }),
	allowFreeText: Type.Optional(
		Type.Boolean({ description: "Whether the operator may answer with free text instead of a listed option. Defaults to true." }),
	),
});

export function createAskUserChoiceTool(state: AskUserPanelState): ToolDefinition<typeof choiceParameters, AskUserAnswer> {
	return {
		name: "ask_user_choice",
		label: "Ask User Choice",
		description:
			"Ask the operator to pick one of several numbered options from the TUI question panel. Refuses in print mode or when no TUI session is available, and never launches a child session.",
		promptSnippet: "Ask the operator to choose among numbered options in the TUI question panel",
		promptGuidelines: [
			"Use ask_user_choice for a closed decision with a short list of named options.",
			"ask_user_choice never launches a child session and never invents an answer when the operator dismisses or is unavailable.",
		],
		parameters: choiceParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return askPanel(ctx, state, params.question, params.options, params.allowFreeText ?? true, signal);
		},
	};
}

const questionParameters = Type.Object({
	question: Type.String({ description: "The open-ended question to ask the operator." }),
});

export function createAskUserQuestionTool(state: AskUserPanelState): ToolDefinition<typeof questionParameters, AskUserAnswer> {
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
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return askPanel(ctx, state, params.question, [], true, signal);
		},
	};
}
