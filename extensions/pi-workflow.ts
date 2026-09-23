import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
	createAskUserChoiceTool,
	createAskUserPanelState,
	createAskUserQuestionTool,
	registerAskUserQueueCounter,
} from "./ask-user-panel.ts";
import {
	createCompanionWorkflow,
	type CompanionWorkflowOptions,
} from "./companion-workflow.ts";
import { type CodeGraphAdapters, createCodeGraphTool } from "./codegraph-tool.ts";
import {
	createModelLists,
	type ModelListsOptions,
	report,
} from "./model-lists.ts";

const usage =
	"Usage: /pi-workflow-status | /pi-workflow-doctor | /pi-workflow-install-companions [--apply] | /pi-workflow-models | /pi-workflow-models-edit";

function createWorkflow(
	pi: ExtensionAPI,
	getContext: () => ExtensionCommandContext | ExtensionContext | undefined,
	options: CompanionWorkflowOptions = {},
) {
	return createCompanionWorkflow({
		catalog: options.catalog,
		interaction: {
			exec: (command, args) => pi.exec(command, args ?? []),
			...options.interaction,
			notify: (message, level) => getContext()?.ui.notify(message, level),
		},
		mcp: options.mcp,
	});
}

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	options: CompanionWorkflowOptions & {
		codegraph?: CodeGraphAdapters;
		modelLists?: ModelListsOptions;
	} = {},
) {
	let currentCtx: ExtensionContext | ExtensionCommandContext | undefined;
	const context = () => currentCtx;
	const workflow = createWorkflow(pi, context, options);
	const modelLists = createModelLists(options.modelLists);

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("session_shutdown", async () => {
		currentCtx = undefined;
	});

	async function runCatalogCommand(
		mode: "inspect" | "diagnose",
		args: string,
		ctx: ExtensionCommandContext,
	) {
		if (args.trim()) {
			ctx.ui.notify(usage, "error");
			return;
		}
		currentCtx = ctx;
		await workflow[mode]();
	}

	pi.registerTool(createCodeGraphTool(options.codegraph));
	const askUserPanelState = createAskUserPanelState();
	pi.registerTool(createAskUserChoiceTool(askUserPanelState));
	pi.registerTool(createAskUserQuestionTool(askUserPanelState));
	registerAskUserQueueCounter(pi, askUserPanelState);

	pi.registerCommand("pi-workflow-status", {
		description: "Summarize companion package readiness",
		handler: (args, ctx) => runCatalogCommand("inspect", args, ctx),
	});
	pi.registerCommand("pi-workflow-doctor", {
		description: "Show companion diagnostic detail",
		handler: (args, ctx) => runCatalogCommand("diagnose", args, ctx),
	});
	pi.registerCommand("pi-workflow-install-companions", {
		description:
			"Show the companion install plan, or apply it when --apply confirms the command",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length > 1 || (parts.length === 1 && parts[0] !== "--apply")) {
				ctx.ui.notify(usage, "error");
				return;
			}
			currentCtx = ctx;
			await workflow.installMissing(parts[0] === "--apply");
		},
	});
	pi.registerCommand("pi-workflow-models", {
		description:
			"Create the global model lists when missing, or replace them after confirmation",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			await modelLists.create(ctx);
		},
	});
	pi.registerCommand("pi-workflow-models-edit", {
		description: "Edit the global model lists in the TUI",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			await modelLists.edit(ctx);
		},
	});
}
