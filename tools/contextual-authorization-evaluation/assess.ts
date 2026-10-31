import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
	installActionAuthorization,
	type ActionAuthorization,
	type AuthorizationDecision,
} from "../../extensions/action-authorization.ts";

type Proposal = Parameters<ActionAuthorization["classify"]>[0];
type Handler = (
	event: ToolCallEvent,
	ctx: ExtensionContext,
) => Promise<unknown>;

// This is a classification-level harness, not evidence of dispatch or effects.
export async function assessProposal(
	proposal: Proposal,
	classify: ActionAuthorization["classify"],
	signal?: AbortSignal,
) {
	let handler: Handler | undefined;
	let assessment: AuthorizationDecision | undefined;
	let classification: unknown;
	let failure: unknown;
	let failed = false;
	let called = false;
	const resumed = proposal.consultation !== undefined;
	const expected = structuredClone(proposal);
	const pi = {
		on(name: string, callback: Handler) {
			if (name === "tool_call") handler = callback;
		},
		getAllTools() {
			return expected.tool
				? [{ name: expected.action.tool, ...expected.tool }]
				: [];
		},
		appendEntry() {},
	} as unknown as ExtensionAPI;
	installActionAuthorization(pi, {
		authority: () => expected.authority,
		sessionInstructions: () => ({
			systemPrompt: expected.context.systemPrompt,
			basePrompt: expected.context.systemPrompt,
		}),
		async classify(actual, currentSignal) {
			if (resumed && !actual.consultation) {
				const { consultation: _consultation, ...initial } = expected;
				if (!isDeepStrictEqual(actual, initial)) {
					failed = true;
					failure = new Error("Runtime proposal differs from input.");
				}
				return {
					scope: "unknown",
					effects: "unknown",
					ownership: "unknown",
					restriction: "none",
					confirmed: false,
					commit: false,
					reason: "Scripted consultation gate",
				};
			}
			try {
				if (!isDeepStrictEqual(actual, expected))
					throw new Error("Runtime proposal differs from input.");
				if (called) throw new Error("Classifier called more than once.");
				called = true;
				classification = await classify(actual, currentSignal);
				const v = classification as Record<string, unknown> | null;
				if (
					!v ||
					typeof v !== "object" ||
					!["within", "outside", "unknown"].includes(v.scope as string) ||
					!["ordinary", "high-impact", "unknown"].includes(
						v.effects as string,
					) ||
					!["assigned", "other", "unknown"].includes(v.ownership as string) ||
					!["none", "prohibition", "confirmation", "information"].includes(v.restriction as string) ||
					typeof v.confirmed !== "boolean" ||
					typeof v.reason !== "string" ||
					!v.reason.trim() ||
					!(
						v.commit === false ||
						(typeof v.commit === "object" &&
							v.commit !== null &&
							Array.isArray((v.commit as { paths?: unknown }).paths) &&
							(v.commit as { paths: unknown[] }).paths.length > 0 &&
							(v.commit as { paths: unknown[] }).paths.every(
								(p) => typeof p === "string" && p.trim(),
							))
					)
				)
					throw new Error("Malformed classification.");
				return classification;
			} catch (error) {
				failed = true;
				failure = error;
				throw error;
			}
		},
		...(resumed
			? {
					consult: async (question) => ({
						...question,
						kind: "resolved" as const,
						...expected.consultation,
					}),
				}
			: {}),
		onDecision: (decision) => {
			assessment = decision;
		},
	});
	const event = {
		type: "tool_call",
		toolCallId: "synthetic",
		toolName: expected.action.tool,
		input: expected.action.input,
	} as ToolCallEvent;
	const ctx = {
		cwd: expected.action.cwd,
		signal,
		getSystemPrompt: () => expected.context.systemPrompt,
	} as ExtensionContext;
	if (!handler) throw new Error("Authorization hook was not installed.");
	const finalGate = await (handler as Handler)(event, ctx);
	if (failed) throw failure;
	if (signal?.aborted) throw new Error("Authorization evaluation cancelled.");
	if (!called || !assessment)
		throw new Error("Classification was not completed.");
	return {
		assessment,
		finalGate,
		classification,
		stage: resumed ? ("resumed" as const) : ("initial" as const),
		initialGate: resumed ? ("scripted-held" as const) : null,
	};
}
