import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
	createAskUserChoiceTool,
	createAskUserQuestionTool,
} from "./ask-user-panel.ts";
import {
	createCompanionWorkflow,
	type CompanionWorkflowOptions,
} from "./companion-workflow.ts";
import { type CodeGraphAdapters, createCodeGraphTool } from "./codegraph-tool.ts";
import { createChildLauncher } from "./child-launcher.ts";
import { runDelegationCheck } from "./delegation-check.ts";
import { registerChildResultCards } from "./child-result-card.ts";
import {
	type ChildRecord,
	type ChildSessionFactory,
	childDetails,
	createChildQueryTools,
	createChildSessions,
	createContinueChildTool,
	createSpawnChildTool,
	type Schedule,
} from "./child-sessions.ts";
import { registerChildrenBox } from "./children-box.ts";
import { createFooterHints, registerChrome } from "./chrome.ts";
import { createChildrenViews } from "./children-view.ts";
import {
	createModelProfiles,
	type ModelProfilesOptions,
	report,
} from "./model-profiles.ts";
import type { Fetch } from "./jev-client.ts";
import { registerSessionTodo } from "./todo-extension.ts";
import { registerCompactTools } from "./compact-tools.ts";

const usage =
	"Usage: /workflow:status | /workflow:doctor | /workflow:setup | /workflow:models | /workflow:subagents | /workflow:delegation-check";

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
		settings: options.settings,
	});
}

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	options: CompanionWorkflowOptions & {
		codegraph?: CodeGraphAdapters;
		modelProfiles?: ModelProfilesOptions;
		childSessions?: {
			create?: ChildSessionFactory;
			fetch?: Fetch;
			schedule?: Schedule;
			refresh?: Schedule;
		};
	} = {},
) {
	let currentCtx: ExtensionContext | ExtensionCommandContext | undefined;
	const context = () => currentCtx;
	const workflow = createWorkflow(pi, context, options);
	registerCompactTools(pi);
	registerChildResultCards(pi);
	const modelProfiles = createModelProfiles(options.modelProfiles);
	const childSessions = createChildSessions({
		create: options.childSessions?.create,
		schedule: options.childSessions?.schedule,
		deliver: (child) =>
			pi.sendMessage(
				{
					customType: "pi-workflow-child-result",
					content: childOutcome(child),
					display: true,
					details: childDetails(child),
				},
				{ deliverAs: "followUp", triggerTurn: true },
			),
		ask: (child, question, number) =>
			pi.sendMessage(
				{
					customType: "pi-workflow-child-question",
					content: `Child ${child.id} asks (question ${number}):\n\n${question}\n\nAnswer with reply_child with question ${number}.`,
					display: true,
					details: { ...childDetails(child), question: number, text: question },
				},
				{ deliverAs: "steer", triggerTurn: true },
			),
		report: (message) => {
			if (currentCtx) report(currentCtx, message, "error");
		},
	});
	const childrenViews = createChildrenViews(childSessions);
	registerChildrenBox(pi, childSessions, options.childSessions?.refresh);
	registerSessionTodo(pi);
	const footerHints = createFooterHints();
	registerChrome(pi, childSessions, footerHints);
	pi.registerShortcut("alt+a", {
		description: "Open the subagents view",
		handler: async (ctx) => {
			if (ctx.mode === "tui") await childrenViews.open(ctx);
		},
	});
	let spawnChildRegistered = false;
	const launcher = createChildLauncher({
		modelProfiles,
		fetch: options.childSessions?.fetch,
	});

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const { allowed } = await workflow.checkSpawnTools();
		if (allowed && !spawnChildRegistered) {
			spawnChildRegistered = true;
			pi.registerTool(createSpawnChildTool(launcher, childSessions));
			pi.registerTool(createContinueChildTool(childSessions));
			for (const tool of createChildQueryTools(childSessions)) {
				pi.registerTool(tool);
			}
			pi.on("turn_start", () => {
				launcher.beginTurn();
			});
			pi.on("tool_call", async (event, toolCtx) => {
				const gate = await launcher.gateToolCall(event, toolCtx);
				if (gate.allow) return;
				return { block: true, reason: gate.reason };
			});
		}
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("session_shutdown", async () => {
		currentCtx = undefined;
		childrenViews.close();
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
	pi.registerTool(createAskUserChoiceTool(footerHints));
	pi.registerTool(createAskUserQuestionTool(footerHints));

	pi.registerCommand("workflow:status", {
		description: "Summarize companion, MCP, and default settings readiness",
		handler: (args, ctx) => runCatalogCommand("inspect", args, ctx),
	});
	pi.registerCommand("workflow:doctor", {
		description: "Show companion diagnostic detail",
		handler: (args, ctx) => runCatalogCommand("diagnose", args, ctx),
	});
	pi.registerCommand("workflow:setup", {
		description:
			"Install missing companions, align the MCP catalog, and apply default settings",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify(usage, "error");
				return;
			}
			currentCtx = ctx;
			await workflow.setup();
		},
	});
	pi.registerCommand("workflow:subagents", {
		description: "Open the subagents view of this session",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			if (ctx.mode !== "tui") {
				report(ctx, "The children view needs the TUI.", "error");
				return;
			}
			await childrenViews.open(ctx);
		},
	});
	pi.registerCommand("workflow:models", {
		description: "Edit the global model profiles in the TUI",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			await modelProfiles.edit(ctx);
		},
	});
	pi.registerCommand("workflow:delegation-check", {
		description:
			"Score the fixed delegation cases against Jev without launching a child",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			const { lines, failed } = await runDelegationCheck(ctx, {
				fetch: options.childSessions?.fetch,
				modelProfiles,
			});
			report(ctx, lines.join("\n"), failed ? "error" : "info");
		},
	});
}
