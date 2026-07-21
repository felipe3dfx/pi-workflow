import crypto from "node:crypto";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	createCompanionWorkflow,
	type CompanionWorkflowOptions,
} from "./companion-workflow.ts";
import {
	createDefaultDefineProductWorkflow,
	type DefaultDefineProductRuntimeOptions,
} from "./default-define-product.ts";
import {
	createDefaultQaHandoffWorkflow,
	type DefaultQaHandoffRuntimeOptions,
} from "./default-qa-handoff.ts";
import {
	createDefaultProductReviewWorkflow,
	type DefaultProductReviewRuntimeOptions,
} from "./default-product-review.ts";
import type { createDefineProductWorkflow } from "./define-product-workflow.ts";
import { createDefineProductRuntime } from "./define-product-runtime.ts";
import type { createQaHandoffWorkflow } from "./qa-handoff-workflow.ts";
import { createQaHandoffRuntime } from "./qa-handoff-runtime.ts";
import type { createProductReviewWorkflow } from "./product-review-workflow.ts";
import { createProductReviewRuntime } from "./product-review-runtime.ts";
import { registerPublicEntryGuard } from "./public-entry-guard.ts";
import type {
	DiagnosticScope,
	WorkflowDiagnosticsAdapter,
} from "./workflow-diagnostics.ts";
import { createWorkflowDiagnostics } from "./workflow-diagnostics.ts";

function createWorkflow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	workflowOptions: CompanionWorkflowOptions = {},
) {
	return createCompanionWorkflow({
		catalog: workflowOptions.catalog,
		interaction: {
			// exec comes first so tests can override it via workflowOptions.interaction
			// (the spread below); notify/confirm are intentionally locked after the
			// spread so callers cannot swap out the real UI adapters.
			exec: (command, args) => pi.exec(command, args ?? []),
			...workflowOptions.interaction,
			notify: (message, level) => ctx.ui.notify(message, level),
			confirm:
				ctx.hasUI && ctx.ui.confirm
					? (title, message) =>
							ctx.ui.confirm?.(title, message) ?? Promise.resolve(false)
					: undefined,
		},
		diagnostics: {
			exec: (command, args) => pi.exec(command, args ?? []),
			cwd: () => process.cwd(),
			...workflowOptions.diagnostics,
		},
		mcp: workflowOptions.mcp,
	});
}

const diagnosticUsage =
	"Usage: /pi-workflow-<status|doctor> <installation|product <teamId>|delivery <issueId>|qa-handoff <issueId>|product-review <issueId>>";

export function parseDiagnosticScope(args: string): DiagnosticScope | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 1 && parts[0] === "installation") return { kind: "installation" };
	if (parts.length !== 2 || !parts[1]) return undefined;
	if (parts[0] === "product") return { kind: "product", teamId: parts[1] };
	if (parts[0] === "delivery" && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(parts[1]))
		return { kind: "delivery", issueId: parts[1] };
	if (parts[0] === "qa-handoff" && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(parts[1]))
		return { kind: "qa-handoff", issueId: parts[1] };
	if (parts[0] === "product-review" && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(parts[1]))
		return { kind: "product-review", issueId: parts[1] };
	return undefined;
}

export interface PiWorkflowExtensionOptions extends CompanionWorkflowOptions {
	diagnosticsWorkflow?: {
		adapter: WorkflowDiagnosticsAdapter;
		strictCompatibility?: boolean;
	};
	defineProduct?: {
		workflow?: ReturnType<typeof createDefineProductWorkflow>;
		createDefinitionId?: () => string;
		runtime?: DefaultDefineProductRuntimeOptions;
	};
	qaHandoff?: {
		workflow?: ReturnType<typeof createQaHandoffWorkflow>;
		runtime?: DefaultQaHandoffRuntimeOptions;
	};
	productReview?: {
		workflow?: ReturnType<typeof createProductReviewWorkflow>;
		runtime?: DefaultProductReviewRuntimeOptions;
	};
}

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	workflowOptions: PiWorkflowExtensionOptions = {},
) {
	let currentCtx: ExtensionContext | undefined;
	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("session_shutdown", async () => {
		currentCtx = undefined;
	});

	const defineProductWorkflow =
		workflowOptions.defineProduct?.workflow ??
		createDefaultDefineProductWorkflow(
			pi,
			() => currentCtx,
			workflowOptions.defineProduct?.runtime,
		);
	const qaHandoffRuntime = createQaHandoffRuntime({
		workflow:
			workflowOptions.qaHandoff?.workflow ??
			createDefaultQaHandoffWorkflow(
				() => currentCtx,
				workflowOptions.qaHandoff?.runtime,
			),
	});
	qaHandoffRuntime.register(pi);
	const productReviewRuntime = createProductReviewRuntime({
		workflow:
			workflowOptions.productReview?.workflow ??
			createDefaultProductReviewWorkflow(
				() => currentCtx,
				workflowOptions.productReview?.runtime,
			),
	});
	productReviewRuntime.register(pi);
	const defineProductRuntime = createDefineProductRuntime({
		workflow: defineProductWorkflow,
		createDefinitionId:
			workflowOptions.defineProduct?.createDefinitionId ??
			(() => crypto.randomUUID()),
	});
	defineProductRuntime.register(pi);
	registerPublicEntryGuard(pi, {
		"define-product": {
			status: "implemented",
			allowedTools: [defineProductRuntime.toolName],
			continueIf: (event) => defineProductRuntime.shouldContinue(event),
			hasActiveAuthorization: () => defineProductRuntime.hasActiveTurn(),
			retainAfterSettled: true,
			onAdmittedInput: (event) => defineProductRuntime.handlePublicEntry(event),
		},
		"deliver-ticket": { status: "pending" },
		"qa-handoff": {
			status: "implemented",
			allowedTools: [qaHandoffRuntime.toolName],
			continueIf: (event) => qaHandoffRuntime.shouldContinue(event),
			hasActiveAuthorization: () => qaHandoffRuntime.hasActiveTurn(),
			onAdmittedInput: (event) => qaHandoffRuntime.handlePublicEntry(event),
			onSettled: () => qaHandoffRuntime.handleSettled(),
		},
		"product-review": {
			status: "implemented",
			allowedTools: [productReviewRuntime.toolName],
			continueIf: (event) => productReviewRuntime.shouldContinue(event),
			hasActiveAuthorization: () => productReviewRuntime.hasActiveTurn(),
			retainAfterSettled: true,
			onAdmittedInput: (event) => productReviewRuntime.handlePublicEntry(event),
		},
	});

	const diagnostics = workflowOptions.diagnosticsWorkflow
		? createWorkflowDiagnostics({
				adapter: workflowOptions.diagnosticsWorkflow.adapter,
				strictCompatibility:
					workflowOptions.diagnosticsWorkflow.strictCompatibility ?? true,
			})
		: undefined;
	async function runDiagnosticsCommand(
		mode: "status" | "doctor",
		args: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const scope = parseDiagnosticScope(args);
		if (!diagnostics || !scope) {
			if (args.trim()) {
				ctx.ui.notify(diagnosticUsage, "error");
				return;
			}
			await createWorkflow(pi, ctx, workflowOptions)[
				mode === "status" ? "inspect" : "diagnose"
			]();
			return;
		}
		const report = await diagnostics[
			mode === "status" ? "inspect" : "diagnose"
		](scope);
		ctx.ui.notify(
			JSON.stringify(report, null, 2),
			report.readiness === "ready"
				? "info"
				: report.readiness === "degraded"
					? "warning"
					: "error",
		);
	}

	pi.registerCommand("pi-workflow-status", {
		description: "Summarize readiness for a pi-workflow operation scope",
		handler: (args, ctx) => runDiagnosticsCommand("status", args, ctx),
	});

	pi.registerCommand("pi-workflow-doctor", {
		description: "Show safe diagnostic evidence and remediation for a scope",
		handler: (args, ctx) => runDiagnosticsCommand("doctor", args, ctx),
	});

	pi.registerCommand("pi-workflow-install-companions", {
		description:
			"Confirm and install missing or mismatched pi-workflow companion packages",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).installMissing();
		},
	});
}
