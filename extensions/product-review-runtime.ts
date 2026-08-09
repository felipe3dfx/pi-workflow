import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import type { ProductReviewMcpPublication } from "./product-review-mcp-publication.ts";
import { isReadOnlyEngramCall } from "./public-entry-guard.ts";

const publicEntry = /^\/(?:skill:)?product-review(?:\s|$)/;
const command = /^\/(?:skill:)?product-review\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\s*$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function status(value: unknown): string | undefined { return record(value) && typeof value.status === "string" ? value.status : undefined; }
export interface ProductReviewRuntimeOptions {
	readonly mcpPublication: ProductReviewMcpPublication;
}

export function createProductReviewRuntime(options: ProductReviewRuntimeOptions) {
	const toolName = "workflow_product_review" as const;
	const mcpPublication = options.mcpPublication;
	let issueId: string | undefined;
	let awaitingSelection = false;
	const readOnlyEngramToolCallIds = new Set<string>();
	const clear = (): void => {
		issueId = undefined;
		awaitingSelection = false;
		readOnlyEngramToolCallIds.clear();
		mcpPublication.clear();
	};
	function handlePublicEntry(event: InputEvent): void {
		if (publicEntry.test(event.text)) {
			clear();
			const match = event.text.match(command);
			if (match?.[1]) {
				issueId = match[1];
				mcpPublication.start(match[1]);
			}
			return;
		}
	}
	function shouldContinue(_event: InputEvent): boolean {
		return false;
	}
	async function execute(input: unknown): Promise<unknown> {
		const outcome = await mcpPublication.complete(input);
		if (status(outcome) !== "continuing") issueId = undefined;
		return outcome;
	}
	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", async () => {
			if (!issueId) return undefined;
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
						? `Wait for the shared product-review decision descriptor. After it records a choice, call ${toolName} with exactly action="select_result" and result="Aceptado", action="select_result" and result="Cambios requeridos", or action="cancel_decision" to match that claim. Never infer approval from prose.`
						: "Report the active product-review blocker exactly. Communicate in the language used by the user.",
			};
		});
		pi.on("tool_call", (event) => {
			if (isReadOnlyEngramCall(event)) {
				if (typeof event.toolCallId === "string")
					readOnlyEngramToolCallIds.add(event.toolCallId);
				return undefined;
			}
			return mcpPublication.handleToolCall(event);
		});
		pi.on("tool_result", async (event) => {
			if (
				typeof event.toolCallId === "string" &&
				readOnlyEngramToolCallIds.delete(event.toolCallId)
			)
				return undefined;
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
			awaitingSelection = mcpPublication.hasPendingOwnerSelection();
		});
		pi.on("session_start", clear); pi.on("session_shutdown", clear);
		pi.registerTool?.({
			name: toolName, label: "Product Review Workflow", description: "Publish an Owner-approved product review bound to the active turn.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["action"],
				properties: {
					action: { type: "string", enum: ["select_result", "cancel_decision"] },
					result: { type: "string", enum: ["Aceptado", "Cambios requeridos"] },
				},
			},
			async execute(_toolCallId: string, input: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(await execute(input)) }], details: {} }; },
		});
	}
	return {
		toolName,
		allowedTools: mcpPublication.allowedTools,
		handlePublicEntry,
		shouldContinue,
		hasActiveTurn: () => mcpPublication.hasActiveTurn(),
		hasPendingSelection: () => awaitingSelection,
		handleSettled: () => {
			awaitingSelection = mcpPublication.hasPendingOwnerSelection();
		},
		execute,
		register,
		clearActiveTurn: clear,
	};
}
