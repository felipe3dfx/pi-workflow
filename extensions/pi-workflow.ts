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
import { createChildLauncher } from "./child-launcher.ts";
import {
	type ChildSessionFactory,
	createChildSessions,
	createSpawnChildTool,
} from "./child-sessions.ts";
import {
	createModelLists,
	type ModelListsOptions,
	report,
} from "./model-lists.ts";
import { type Fetch, registerTypesafeLogin } from "./jev-client.ts";
import { registerSessionTodo } from "./todo-extension.ts";
import { registerCompactTools } from "./compact-tools.ts";

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
		childSessions?: { create?: ChildSessionFactory; fetch?: Fetch };
	} = {},
) {
	let currentCtx: ExtensionContext | ExtensionCommandContext | undefined;
	const context = () => currentCtx;
	const workflow = createWorkflow(pi, context, options);
	registerSessionTodo(pi);
	registerCompactTools(pi);
	registerTypesafeLogin(pi);
	const modelLists = createModelLists(options.modelLists);
	const childSessions = createChildSessions({
		create: options.childSessions?.create,
		deliver: (id, text, failed) =>
			pi.sendMessage(
				{
					customType: "pi-workflow-child-result",
					content: failed
						? `Child ${id} failed: ${text}`
						: `Child ${id} finished:\n\n${text}`,
					display: true,
					details: { id, failed },
				},
				{ deliverAs: "followUp", triggerTurn: true },
			),
		report: (message) => {
			if (currentCtx) report(currentCtx, message, "error");
		},
	});
	let spawnChildRegistered = false;

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const { allowed } = await workflow.checkSpawnTools();
		if (allowed && !spawnChildRegistered) {
			spawnChildRegistered = true;
			pi.registerTool(
				createSpawnChildTool(
					createChildLauncher({
						modelLists,
						fetch: options.childSessions?.fetch,
					}),
					childSessions,
				),
			);
		}
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("session_shutdown", async () => {
		currentCtx = undefined;
		childSessions.disposeAll();
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
