import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	createCompanionWorkflow,
	type CompanionWorkflowOptions,
} from "./companion-workflow.ts";
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

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	workflowOptions: CompanionWorkflowOptions = {},
) {
	registerPublicEntryGuard(pi);

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
