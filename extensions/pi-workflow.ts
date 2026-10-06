import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
	createAskUserChoiceTool,
	createAskUserQuestionTool,
	syncAskUserTools,
} from "./ask-user-panel.ts";
import {
	companionMetadataPath,
	createCompanionWorkflow,
	type CompanionWorkflowOptions,
	getCompanionState,
	loadCompanionsFromPath,
} from "./companion-workflow.ts";
import { guideSelection } from "./configure-guide.ts";
import { readSelection } from "./configure.ts";
import { contribute, replaceSelection, seated } from "./shell.ts";
import {
	type CodeGraphAdapters,
	createCodeGraphTool,
	syncCodeGraphTool,
} from "./codegraph-tool.ts";
import { createChildLauncher } from "./child-launcher.ts";
import { runDelegationCheck } from "./delegation-check.ts";
import { registerChildResultCards } from "./child-result-card.ts";
import {
	type ChildSessionFactory,
	createChildQueryTools,
	createChildSessions,
	createContinueChildTool,
	createSpawnChildTool,
	isWorking,
} from "./child-sessions.ts";
import type { Schedule } from "./clock.ts";
import { registerChildrenBox } from "./children-box.ts";
import { createFooterHints, registerChrome } from "./chrome.ts";
import { createChildrenViews } from "./children-view.ts";
import { createModelProfiles, report } from "./model-profiles.ts";
import { registerSessionTodo, syncTodoTool } from "./todo-extension.ts";
import { registerCompactTools, syncCompactTools } from "./compact-tools.ts";
import { resolveAgentDirectory, writeJsonAtomically } from "./agent-directory.ts";
import { jevRoutingEnabled, setJevRouting } from "./workflow-settings.ts";

const usage =
	"Usage: /workflow:status | /workflow:doctor | /workflow:config | /workflow:models | /workflow:subagents | /workflow:delegation-check";



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
		agentDirectory: options.agentDirectory,
		expectedPackages: options.expectedPackages,
	});
}

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	options: CompanionWorkflowOptions & {
		codegraph?: CodeGraphAdapters;
		childSessions?: {
			create?: ChildSessionFactory;
			schedule?: Schedule;
			refresh?: Schedule;
		};
	} = {},
) {
	const agentDirectory = resolveAgentDirectory(options.agentDirectory);
	let currentCtx: ExtensionContext | ExtensionCommandContext | undefined;
	const context = () => currentCtx;
	const workflow = createWorkflow(pi, context, {
		...options,
		agentDirectory,
		expectedPackages: expectedPackageNames,
	});
	registerCompactTools(pi);
	registerChildResultCards(pi);
	const modelProfiles = createModelProfiles(agentDirectory);
	const childSessions = createChildSessions({
		create: options.childSessions?.create,
		schedule: options.childSessions?.schedule,
		send: (message) =>
			pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true }),
		idle: () => currentCtx?.isIdle() ?? false,
		trace: (entry) => pi.appendEntry("pi-workflow-child-trace", entry),
		report: (message) => {
			if (currentCtx) report(currentCtx, message, "error");
		},
	});
	pi.on("turn_end", () => childSessions.atBoundary());
	pi.on("agent_settled", () => childSessions.atBoundary());
	const childrenViews = createChildrenViews(childSessions);
	registerChildrenBox(pi, childSessions, options.childSessions?.refresh);
	registerSessionTodo(pi);
	const footerHints = createFooterHints();
	contribute("child-session", "header", () => ({
		count: childSessions.list().filter((child) => isWorking(child.state))
			.length,
	}));
	registerChrome(pi, footerHints);
	pi.registerShortcut("alt+a", {
		description: "Open the subagents view",
		handler: async (ctx) => {
			if (ctx.mode === "tui") await childrenViews.open(ctx);
		},
	});
	const launcher = createChildLauncher({
		modelProfiles,
		childSessionSeated: () => seated("child-session", "overlay"),
	});

	function selectionPath() {
		return resolve(agentDirectory, "pi-workflow-selection.json");
	}

	function companionPackages() {
		return loadCompanionsFromPath(
			options.catalog?.metadataPath ?? companionMetadataPath,
		);
	}

	function seatFromDisk() {
		const loaded = companionPackages();
		if (loaded.error) return { status: "refused" as const, reason: loaded.error };
		const packages = loaded.companions.map((companion) => companion.package);
		let text: string | undefined;
		try {
			text = readFileSync(selectionPath(), "utf8");
		} catch (error) {
			const code =
				error instanceof Error && "code" in error ? error.code : undefined;
			if (code !== "ENOENT") {
				return {
					status: "refused" as const,
					reason: `Unable to read the selection: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}
		const selection = readSelection(text, packages);
		if (selection.status === "refused") return selection;
		if (text === undefined) return selection;
		replaceSelection(selection.selection);
		return selection;
	}

	function expectedPackageNames(): readonly string[] {
		const loaded = companionPackages();
		if (loaded.error) return [];
		const packages = loaded.companions.map((companion) => companion.package);
		let text: string | undefined;
		try {
			text = readFileSync(selectionPath(), "utf8");
		} catch {
			return [];
		}
		const selection = readSelection(text, packages);
		if (selection.status !== "ready") return [];
		return Object.entries(selection.selection.expectations)
			.filter(([, on]) => on)
			.map(([name]) => name);
	}

	const childTools = [
		createSpawnChildTool(launcher, childSessions),
		createContinueChildTool(childSessions),
		...createChildQueryTools(childSessions),
	];
	let childHooks = false;
	let childOffered: boolean | undefined;

	function registerChildTools(allowed: boolean) {
		if (!allowed) return;
		const on = seated("child-session", "overlay");
		if (!childHooks && !on) return;
		if (childHooks && childOffered === on) return;
		childOffered = on;
		for (const tool of childTools) {
			pi.registerTool({
			...tool,
			exposure: on ? "direct" : "hidden",
		} as typeof tool);
		}
		if (childHooks) return;
		childHooks = true;
		pi.on("turn_start", () => {
			launcher.beginTurn();
		});
		pi.on("tool_call", async (event, toolCtx) => {
			if (!seated("child-session", "overlay")) return;
			const gate = await launcher.gateToolCall(event, toolCtx);
			if (gate.allow) return;
			if (event.parentToolCallId) {
				pi.sendMessage(
					{
						customType: "pi-workflow-gate-block",
						content: gate.reason,
						display: true,
					},
					{ deliverAs: "steer" },
				);
			}
			return { block: true, reason: gate.reason };
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const seated = seatFromDisk();
		if (seated.status === "refused") report(ctx, seated.reason, "error");
		const { allowed } = await workflow.checkSpawnTools();
		syncAskUserTools(pi, footerHints);
		syncTodoTool(pi);
		syncCodeGraphTool(pi, options.codegraph);
		syncCompactTools(pi, ctx);
		registerChildTools(allowed);
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
			report(ctx, usage, "error");
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
	pi.registerCommand("workflow:config", {
		description:
			"Configure companions, harness capabilities, and Jev routing",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			currentCtx = ctx;
			if (!ctx.hasUI || ctx.mode !== "tui") {
				report(ctx, "Configure needs the TUI.", "error");
				return;
			}
			const seated = seatFromDisk();
			if (seated.status === "refused") {
				report(ctx, seated.reason, "error");
				return;
			}
			const loaded = companionPackages();
			const packages = loaded.companions.map((companion) => companion.package);
			const states = loaded.companions.map((companion) =>
				getCompanionState(
					companion,
					options.catalog?.resolveInstalledVersion,
				),
			);
			const routing = jevRoutingEnabled();
			const guided = await guideSelection(
				ctx,
				seated.selection,
				packages,
				states,
				routing,
			);
			if (!guided) return;
			const { selection: chosen, jevRouting } = guided;
			writeJsonAtomically(selectionPath(), chosen);
			if (jevRouting !== routing) setJevRouting(jevRouting);
			replaceSelection(chosen);
			const { allowed } = await workflow.checkSpawnTools();
			syncAskUserTools(pi, footerHints);
			syncTodoTool(pi);
			syncCodeGraphTool(pi, options.codegraph);
			syncCompactTools(pi, ctx);
			registerChildTools(allowed);
			const expected = Object.entries(chosen.expectations)
				.filter(([, on]) => on)
				.map(([name]) => name);
			await workflow.setup(expected);
		},
	});
	pi.registerCommand("workflow:subagents", {
		description: "Open the subagents view of this session",
		handler: async (args, ctx) => {
			if (args.trim()) {
				report(ctx, usage, "error");
				return;
			}
			if (!seated("child-session", "overlay")) {
				report(
					ctx,
					"Child session is not seated. Run /workflow:config.",
					"error",
				);
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
			if (!seated("child-session", "overlay")) {
				report(
					ctx,
					"Child session is not seated. Run /workflow:config.",
					"error",
				);
				return;
			}
			const { lines, failed } = await runDelegationCheck(ctx, {
				modelProfiles,
			});
			report(ctx, lines.join("\n"), failed ? "error" : "info");
		},
	});
}
