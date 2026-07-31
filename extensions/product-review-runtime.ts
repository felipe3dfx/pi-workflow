import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import type { ProductReviewResult } from "./product-review-draft-store.ts";
import type { ProductReviewMcpPublication } from "./product-review-mcp-publication.ts";
import { isReadOnlyEngramCall } from "./public-entry-guard.ts";

interface Workflow {
	prepare(issueId: string): Promise<unknown>;
	approve(input: unknown): Promise<unknown>;
	publish(input: unknown): Promise<unknown>;
}
interface RuntimeOutcome { readonly status: string; readonly blocker?: { readonly code: string; readonly message: string } }
const publicEntry = /^\/(?:skill:)?product-review(?:\s|$)/;
const command = /^\/(?:skill:)?product-review\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;
const blocked = (code: string, message: string): RuntimeOutcome => ({ status: "blocked", blocker: { code, message } });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exact(value: object, keys: readonly string[]): boolean {
	const actual = Object.keys(value); return actual.length === keys.length && keys.every((key) => actual.includes(key));
}
function status(value: unknown): string | undefined { return record(value) && typeof value.status === "string" ? value.status : undefined; }
function errorCode(error: unknown, fallback: string): string {
	return record(error) && typeof error.code === "string" && error.code.length > 0 ? error.code : fallback;
}
function preparedChoice(value: unknown, result: ProductReviewResult): string | undefined {
	if (!record(value) || value.status !== "prepared" || !record(value.choices)) return undefined;
	const choice = value.choices[result]; return record(choice) && typeof choice.digest === "string" ? choice.digest : undefined;
}
function recommendation(value: unknown): string | undefined {
	return record(value) && (value.recommendation === "Aceptado" || value.recommendation === "Cambios requeridos") ? value.recommendation : undefined;
}
function publishedCommentId(value: unknown): string | undefined {
	if (!record(value) || value.status !== "published" || !record(value.comment)) return undefined;
	return typeof value.comment.id === "string" ? value.comment.id : undefined;
}
export type ProductReviewRuntimeOptions =
	| { readonly workflow: Workflow; readonly mcpPublication?: never }
	| {
			readonly workflow?: never;
			readonly mcpPublication: ProductReviewMcpPublication;
	  };

export function createProductReviewRuntime(options: ProductReviewRuntimeOptions) {
	const toolName = "workflow_product_review" as const;
	const workflow = "workflow" in options ? options.workflow : undefined;
	const mcpPublication =
		"mcpPublication" in options ? options.mcpPublication : undefined;
	let issueId: string | undefined;
	let preparation: Promise<unknown> | undefined;
	let awaitingSelection = false;
	let freshOwnerResponse = false;
	const readOnlyEngramToolCallIds = new Set<string>();
	const clear = (): void => {
		issueId = undefined;
		preparation = undefined;
		awaitingSelection = false;
		freshOwnerResponse = false;
		readOnlyEngramToolCallIds.clear();
		mcpPublication?.clear();
	};
	function handlePublicEntry(event: InputEvent): void {
		if (publicEntry.test(event.text)) {
			clear();
			const match = event.text.match(command);
			if (match?.[1]) {
				issueId = match[1];
				if (mcpPublication) mcpPublication.start(match[1]);
				else if (workflow) {
					preparation = workflow.prepare(match[1]);
					awaitingSelection = true;
				}
			}
			return;
		}
		if (
			!awaitingSelection ||
			!issueId ||
			event.source !== "interactive" ||
			event.streamingBehavior !== undefined ||
			!event.text.trim() ||
			event.text.trim().startsWith("/")
		)
			return;
		freshOwnerResponse = true;
	}
	function shouldContinue(event: InputEvent): boolean {
		return (
			awaitingSelection &&
			event.source === "interactive" &&
			event.streamingBehavior === undefined &&
			event.text.trim().length > 0 &&
			!event.text.trim().startsWith("/")
		);
	}
	async function execute(input: unknown): Promise<unknown> {
		if (mcpPublication) {
			if (
				mcpPublication.hasPendingOwnerSelection() &&
				(!freshOwnerResponse ||
					!record(input) ||
					!exact(input, ["action", "result"]) ||
					input.action !== "select_result" ||
					(input.result !== "Aceptado" && input.result !== "Cambios requeridos"))
			)
				return blocked(
					"PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID",
					"Selection requires one typed Agent decision bound to a fresh interactive Owner response.",
				);
			freshOwnerResponse = false;
			const outcome = await mcpPublication.complete(input);
			if (status(outcome) !== "continuing") issueId = undefined;
			return outcome;
		}
		const id = issueId;
		const pending = preparation;
		const hasFreshOwnerResponse = freshOwnerResponse;
		clear();
		if (
			!workflow ||
			!id ||
			!pending ||
			!hasFreshOwnerResponse ||
			!record(input) ||
			!exact(input, ["action", "result"]) ||
			input.action !== "select_result" ||
			(input.result !== "Aceptado" && input.result !== "Cambios requeridos")
		)
			return blocked("PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID", "Publication requires one typed Agent selection bound to a fresh interactive Owner response in the active turn.");
		const chosen = { result: input.result as ProductReviewResult };
		let prepared: unknown;
		try { prepared = await pending; } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PREPARATION_FAILED"), error instanceof Error ? error.message : "Preparation failed."); }
		if (status(prepared) !== "prepared") return prepared;
		const digest = preparedChoice(prepared, chosen.result);
		if (!digest) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "Owner selection does not match a prepared result.");
		let approval: unknown;
		try { approval = await workflow.approve({ issueId: id, result: chosen.result, digest }); } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_APPROVAL_FAILED"), error instanceof Error ? error.message : "Approval failed."); }
		if (status(approval) !== "approved") return approval;
		let publication: unknown;
		try { publication = await workflow.publish({ issueId: id }); } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PUBLICATION_FAILED"), error instanceof Error ? error.message : "Publication failed."); }
		if (status(publication) !== "published") return publication;
		const commentId = publishedCommentId(publication);
		return { status: "published", issueId: id, ...(commentId ? { commentId } : {}) };
	}
	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", async () => {
			if (!issueId) return undefined;
			if (mcpPublication) {
				const getActiveTools = (
					pi as { getActiveTools?: () => readonly string[] }
				).getActiveTools;
				const available = new Set(getActiveTools?.call(pi) ?? []);
				mcpPublication.setMcpAvailable(
					mcpPublication.allowedTools
						.filter((name) => name !== toolName)
						.every((name) => available.has(name)),
				);
				const expected = mcpPublication.expectedModelCall();
				return {
					systemPrompt: expected
						? `You are executing the artifact-backed Linear MCP product review for an explicitly admitted Owner turn. Call ${expected.toolName} exactly once with ${JSON.stringify(expected.input)}. Do not call tools in parallel or provide additional fields. Follow only the next exact call exposed after each result.`
						: mcpPublication.hasPendingOwnerSelection()
							? `Present the prepared product-review choices and ask the Owner to decide naturally. Interpret the response yourself. If the Owner selects a result, call ${toolName} with exactly action="select_result" and result="Aceptado" or result="Cambios requeridos". If ambiguous, ask a follow-up without calling tools. Do not expose workflow metadata.`
							: "Report the active product-review blocker exactly. Communicate in the language used by the user.",
				};
			}
			if (!preparation) return undefined;
			const prepared = await preparation;
			if (status(prepared) !== "prepared") return { systemPrompt: `Report this blocker exactly: ${JSON.stringify(prepared)} Communicate in the language used by the user.` };
			const accepted = preparedChoice(prepared, "Aceptado"), rejected = preparedChoice(prepared, "Cambios requeridos"), suggested = recommendation(prepared);
			if (!accepted || !rejected || !suggested) return { systemPrompt: "Report exactly that Product Review preparation is invalid. Communicate in the language used by the user." };
			return { systemPrompt: `Agent recommendation: ${suggested}. Present the prepared review choices and ask the Owner to decide naturally. Interpret the Owner's response yourself. If the Owner selects a result, call ${toolName} with exactly action="select_result" and result="Aceptado" or result="Cambios requeridos". If the response is ambiguous, ask a follow-up and do not call the tool. Do not display or request hashes or workflow metadata. Communicate in the language used by the user. Linear-facing publication content remains professional-neutral Spanish.` };
		});
		pi.on("tool_call", (event) => {
			if (isReadOnlyEngramCall(event)) {
				if (typeof event.toolCallId === "string")
					readOnlyEngramToolCallIds.add(event.toolCallId);
				return undefined;
			}
			if (
				event.toolName === toolName &&
				mcpPublication?.hasPendingOwnerSelection() &&
				!freshOwnerResponse
			)
				return {
					block: true as const,
					reason: "PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID",
				};
			return mcpPublication?.handleToolCall(event);
		});
		pi.on("tool_result", async (event) => {
			if (
				typeof event.toolCallId === "string" &&
				readOnlyEngramToolCallIds.delete(event.toolCallId)
			)
				return undefined;
			if (!mcpPublication) return undefined;
			const processed = await mcpPublication.handleToolResult(event);
			if (!processed) return undefined;
			const instruction = mcpPublication.nextCallInstruction();
			if (!instruction) return undefined;
			return {
				content: [
					...event.content,
					{ type: "text" as const, text: instruction },
				],
			};
		});
		pi.on("agent_settled", () => {
			if (mcpPublication) {
				awaitingSelection = mcpPublication.hasPendingOwnerSelection();
				return;
			}
			if (!awaitingSelection) clear();
		});
		pi.on("session_start", clear); pi.on("session_shutdown", clear);
		pi.registerTool?.({
			name: toolName, label: "Product Review Workflow", description: "Publish an Owner-approved product review bound to the active turn.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["action", "result"],
				properties: {
					action: { type: "string", enum: ["select_result"] },
					result: { type: "string", enum: ["Aceptado", "Cambios requeridos"] },
				},
			},
			async execute(_toolCallId: string, input: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(await execute(input)) }], details: {} }; },
		});
	}
	return {
		toolName,
		allowedTools: mcpPublication?.allowedTools ?? [toolName],
		handlePublicEntry,
		shouldContinue,
		hasActiveTurn: () =>
			mcpPublication?.hasActiveTurn() ?? (!!issueId && !!preparation),
		hasPendingSelection: () => awaitingSelection,
		handleSettled: () => {
			if (mcpPublication)
				awaitingSelection = mcpPublication.hasPendingOwnerSelection();
			else if (!awaitingSelection) clear();
		},
		execute,
		register,
		clearActiveTurn: clear,
	};
}
