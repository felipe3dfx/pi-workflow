import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import type { ProductReviewResult } from "./product-review-draft-store.ts";
import type { ProductReviewMcpPublication } from "./product-review-mcp-publication.ts";

interface Workflow {
	prepare(issueId: string): Promise<unknown>;
	approve(input: unknown): Promise<unknown>;
	publish(input: unknown): Promise<unknown>;
}
interface RuntimeOutcome { readonly status: string; readonly blocker?: { readonly code: string; readonly message: string } }
const publicEntry = /^\/(?:skill:)?product-review(?:\s|$)/;
const command = /^\/(?:skill:)?product-review\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;
const selection = /^([A-Z][A-Z0-9]*-[1-9][0-9]*)\s+(Aceptado|Cambios requeridos)\s+([a-f0-9]{64})$/;
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
	let choice: { readonly result: ProductReviewResult; readonly digest: string } | undefined;
	let awaitingSelection = false;
	const clear = (): void => {
		issueId = undefined;
		preparation = undefined;
		choice = undefined;
		awaitingSelection = false;
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
		if (!awaitingSelection || !issueId || event.source !== "interactive" || event.streamingBehavior !== undefined) return;
		const match = event.text.trim().match(selection);
		if (match?.[1] === issueId && match[2] && match[3]) {
			choice = {
				result: match[2] === "Aceptado" ? "Aceptado" : "Cambios requeridos",
				digest: match[3],
			};
			if (mcpPublication)
				mcpPublication.select({
					issueId,
					result: choice.result,
					digest: choice.digest,
				});
			else if (!preparation) return;
			awaitingSelection = false;
		}
	}
	function shouldContinue(event: InputEvent): boolean {
		if (!awaitingSelection) return false;
		const match = event.text.trim().match(selection);
		const accepted = event.source === "interactive" && event.streamingBehavior === undefined && match?.[1] === issueId;
		if (!accepted && event.source === "interactive" && event.streamingBehavior === undefined) awaitingSelection = false;
		return accepted;
	}
	async function execute(input: unknown): Promise<unknown> {
		if (mcpPublication) {
			const outcome = await mcpPublication.complete(input);
			if (status(outcome) !== "continuing") issueId = undefined;
			return outcome;
		}
		const id = issueId, pending = preparation, chosen = choice; clear();
		if (!workflow || !id || !pending || !chosen || !record(input) || !exact(input, ["issueId", "result", "digest"]) ||
			input.issueId !== id || input.result !== chosen.result || input.digest !== chosen.digest)
			return blocked("PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID", "Publication requires the exact Owner selection bound to the active turn.");
		let prepared: unknown;
		try { prepared = await pending; } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PREPARATION_FAILED"), error instanceof Error ? error.message : "Preparation failed."); }
		if (status(prepared) !== "prepared") return prepared;
		if (preparedChoice(prepared, chosen.result) !== chosen.digest) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "Owner selection does not match a prepared digest.");
		let approval: unknown;
		try { approval = await workflow.approve({ issueId: id, result: chosen.result, digest: chosen.digest }); } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_APPROVAL_FAILED"), error instanceof Error ? error.message : "Approval failed."); }
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
						: "Report the active product-review blocker exactly. Communicate in the language used by the user.",
				};
			}
			if (!preparation) return undefined;
			const prepared = await preparation;
			if (status(prepared) !== "prepared") return { systemPrompt: `Report this blocker exactly: ${JSON.stringify(prepared)} Communicate in the language used by the user.` };
			const accepted = preparedChoice(prepared, "Aceptado"), rejected = preparedChoice(prepared, "Cambios requeridos"), suggested = recommendation(prepared);
			if (!accepted || !rejected || !suggested) return { systemPrompt: "Report exactly that Product Review preparation is invalid. Communicate in the language used by the user." };
			return { systemPrompt: `Agent recommendation: ${suggested}. Ask the Owner to confirm the exact issue, result, and digest using one of these formats: ${issueId} Aceptado ${accepted}; ${issueId} Cambios requeridos ${rejected}. Do not call the tool until that explicit selection is received. Communicate in the language used by the user. Linear-facing publication content remains professional-neutral Spanish.` };
		});
		pi.on("tool_call", (event) => mcpPublication?.handleToolCall(event));
		pi.on("tool_result", async (event) => {
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
			parameters: { type: "object", additionalProperties: false, required: ["issueId", "result", "digest"], properties: {
				issueId: { type: "string", pattern: "^[A-Z][A-Z0-9]*-[1-9][0-9]*$" }, result: { type: "string", enum: ["Aceptado", "Cambios requeridos"] }, digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
			} },
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
