import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import type { ProductReviewResult } from "./product-review-draft-store.ts";

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
export function createUnavailableProductReviewWorkflow(): Workflow {
	const unavailable = () => Promise.resolve(blocked("PI_WORKFLOW_PRODUCT_REVIEW_CONFIGURATION_REQUIRED", "Product review stores, Owner authority, and Linear adapters are not configured."));
	return { prepare: unavailable, approve: unavailable, publish: unavailable };
}
export function createProductReviewRuntime(options: { readonly workflow: Workflow }) {
	const toolName = "workflow_product_review";
	let issueId: string | undefined;
	let preparation: Promise<unknown> | undefined;
	let choice: { readonly result: ProductReviewResult; readonly digest: string } | undefined;
	let awaitingSelection = false;
	const clear = (): void => { issueId = undefined; preparation = undefined; choice = undefined; awaitingSelection = false; };
	function handlePublicEntry(event: InputEvent): void {
		if (publicEntry.test(event.text)) {
			clear(); const match = event.text.match(command);
			if (match?.[1]) { issueId = match[1]; preparation = options.workflow.prepare(match[1]); awaitingSelection = true; }
			return;
		}
		if (!awaitingSelection || !issueId || !preparation || event.source !== "interactive" || event.streamingBehavior !== undefined) return;
		const match = event.text.trim().match(selection);
		if (match?.[1] === issueId && match[2] && match[3]) {
			choice = {
				result: match[2] === "Aceptado" ? "Aceptado" : "Cambios requeridos",
				digest: match[3],
			};
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
		const id = issueId, pending = preparation, chosen = choice; clear();
		if (!id || !pending || !chosen || !record(input) || !exact(input, ["issueId", "result", "digest"]) ||
			input.issueId !== id || input.result !== chosen.result || input.digest !== chosen.digest)
			return blocked("PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID", "Publication requires the exact Owner selection bound to the active turn.");
		let prepared: unknown;
		try { prepared = await pending; } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PREPARATION_FAILED"), error instanceof Error ? error.message : "Preparation failed."); }
		if (status(prepared) !== "prepared") return prepared;
		if (preparedChoice(prepared, chosen.result) !== chosen.digest) return blocked("PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH", "Owner selection does not match a prepared digest.");
		let approval: unknown;
		try { approval = await options.workflow.approve({ issueId: id, result: chosen.result, digest: chosen.digest }); } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_APPROVAL_FAILED"), error instanceof Error ? error.message : "Approval failed."); }
		if (status(approval) !== "approved") return approval;
		let publication: unknown;
		try { publication = await options.workflow.publish({ issueId: id }); } catch (error) { return blocked(errorCode(error, "PI_WORKFLOW_PRODUCT_REVIEW_PUBLICATION_FAILED"), error instanceof Error ? error.message : "Publication failed."); }
		if (status(publication) !== "published") return publication;
		const commentId = publishedCommentId(publication);
		return { status: "published", issueId: id, ...(commentId ? { commentId } : {}) };
	}
	function register(pi: ExtensionAPI): void {
		pi.on("before_agent_start", async () => {
			if (!issueId || !preparation) return undefined;
			const prepared = await preparation;
			if (status(prepared) !== "prepared") return { systemPrompt: `Reporta exactamente este blocker: ${JSON.stringify(prepared)}` };
			const accepted = preparedChoice(prepared, "Aceptado"), rejected = preparedChoice(prepared, "Cambios requeridos"), suggested = recommendation(prepared);
			if (!accepted || !rejected || !suggested) return { systemPrompt: "Reporta exactamente que la preparación de revisión de producto es inválida." };
			return { systemPrompt: `Recomendación del agente: ${suggested}. Solicita al Owner que confirme exactamente issue, resultado y digest con uno de estos formatos: ${issueId} Aceptado ${accepted}; ${issueId} Cambios requeridos ${rejected}. No llames la herramienta hasta recibir esa selección explícita.` };
		});
		pi.on("agent_settled", () => { if (!awaitingSelection) clear(); });
		pi.on("session_start", clear); pi.on("session_shutdown", clear);
		pi.registerTool?.({
			name: toolName, label: "Product Review Workflow", description: "Publish an Owner-approved product review bound to the active turn.",
			parameters: { type: "object", additionalProperties: false, required: ["issueId", "result", "digest"], properties: {
				issueId: { type: "string", pattern: "^[A-Z][A-Z0-9]*-[1-9][0-9]*$" }, result: { type: "string", enum: ["Aceptado", "Cambios requeridos"] }, digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
			} },
			async execute(_toolCallId: string, input: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(await execute(input)) }], details: {} }; },
		});
	}
	return { toolName, handlePublicEntry, shouldContinue, hasActiveTurn: () => !!issueId && !!preparation, hasPendingSelection: () => awaitingSelection, handleSettled: () => { if (!awaitingSelection) clear(); }, execute, register, clearActiveTurn: clear };
}
