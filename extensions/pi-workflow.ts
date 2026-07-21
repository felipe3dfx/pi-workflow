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
import { createDefaultDefineProductWorkflow, type DefaultDefineProductRuntimeOptions } from "./default-define-product.ts";
import { createDefaultQaHandoffWorkflow, type DefaultQaHandoffRuntimeOptions } from "./default-qa-handoff.ts";
import type { createDefineProductWorkflow } from "./define-product-workflow.ts";
import { createDefineProductRuntime } from "./define-product-runtime.ts";
import type { createQaHandoffWorkflow } from "./qa-handoff-workflow.ts";
import { createQaHandoffRuntime } from "./qa-handoff-runtime.ts";
import { registerPublicEntryGuard } from "./public-entry-guard.ts";

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

export interface PiWorkflowExtensionOptions extends CompanionWorkflowOptions {
	defineProduct?: {
		workflow?: ReturnType<typeof createDefineProductWorkflow>;
		createDefinitionId?: () => string;
		runtime?: DefaultDefineProductRuntimeOptions;
	};
	qaHandoff?: {
		workflow?: ReturnType<typeof createQaHandoffWorkflow>;
		runtime?: DefaultQaHandoffRuntimeOptions;
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
		"product-review": { status: "pending" },
	});

	pi.registerCommand("pi-workflow-status", {
		description:
			"Show configured pi-workflow companion packages and install state",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).inspect();
		},
	});

	pi.registerCommand("pi-workflow-doctor", {
		description: "Show diagnostic pi-workflow companion package status",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).diagnose();
		},
	});

	pi.registerCommand("pi-workflow-install-companions", {
		description:
			"Confirm and install missing or mismatched pi-workflow companion packages",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).installMissing();
		},
	});
}
