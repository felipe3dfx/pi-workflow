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
	type ChildRecord,
	type ChildSessionFactory,
	createChildQueryTools,
	createChildSessions,
	createContinueChildTool,
	createSpawnChildTool,
	describeChildren,
	isWorking,
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
	"Usage: /pi-workflow-status | /pi-workflow-doctor | /pi-workflow-install-companions [--apply] | /pi-workflow-models | /pi-workflow-models-edit | /pi-workflow-children | /pi-workflow-child-cancel <id>";

function childOutcome({ id, state, text }: ChildRecord) {
	if (state === "completed") return `Child ${id} completed:\n\n${text}`;
	if (state === "cancelled") return `Child ${id} cancelled.`;
	return `Child ${id} ${state}: ${text}`;
}

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
		childSessions?: {
			create?: ChildSessionFactory;
			fetch?: Fetch;
			schedule?: Parameters<typeof createChildSessions>[0]["schedule"];
		};
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
		schedule: options.childSessions?.schedule,
		deliver: (child) =>
			pi.sendMessage(
				{
					customType: "pi-workflow-child-result",
					content: childOutcome(child),
					display: true,
					details: { id: child.id, state: child.state },
				},
				{ deliverAs: "followUp", triggerTurn: true },
			),
		ask: (child, question, number) =>
			pi.sendMessage(
				{
					customType: "pi-workflow-child-question",
					content: `Child ${child.id} asks (question ${number}):\n\n${question}\n\nAnswer with reply_child with question ${number}.`,
					display: true,
					details: { id: child.id, state: child.state, question: number },
				},
				{ deliverAs: "steer", triggerTurn: true },
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
			pi.registerTool(createContinueChildTool(childSessions));
			for (const tool of createChildQueryTools(childSessions)) {
				pi.registerTool(tool);
			}
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
	pi.registerCommand("pi-workflow-children", {
		description: "List the child sessions of this session",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			report(ctx, describeChildren(childSessions.list()).join("\n"), "info");
		},
	});
	pi.registerCommand("pi-workflow-child-cancel", {
		description: "Cancel a queued, running, or waiting child session",
		getArgumentCompletions: (prefix) =>
			childSessions
				.list()
				.filter(
					(child) =>
						isWorking(child.state) && child.id.startsWith(prefix.trim()),
				)
				.map((child) => ({ value: child.id, label: child.id })),
		handler: async (args, ctx) => {
			const id = args.trim();
			if (!id || /\s/.test(id)) {
				report(ctx, usage, "error");
				return;
			}
			const { cancelled, message } = childSessions.cancel(id, true);
			report(ctx, message, cancelled ? "info" : "error");
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
