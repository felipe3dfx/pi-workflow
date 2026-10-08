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
import { createSeating } from "./seating.ts";
import {
	notifyHeader,
	occupyHeader,
	registerShell,
	seated,
	seatedCapabilities,
} from "./shell.ts";
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
import { registerSessionTodo } from "./todo-extension.ts";
import { registerCompactTools, syncCompactTools } from "./compact-tools.ts";
import { resolveAgentDirectory } from "./agent-directory.ts";
import { createJevRouting } from "./workflow-settings.ts";

const usage =
	"Usage: /workflow:status | /workflow:doctor | /workflow:config | /workflow:models | /workflow:subagents | /workflow:delegation-check";



function createWorkflow(
	pi: ExtensionAPI,
	getContext: () => ExtensionCommandContext | ExtensionContext | undefined,
	options: CompanionWorkflowOptions,
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
	options: Omit<CompanionWorkflowOptions, "agentDirectory"> & {
		agentDirectory?: string;
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
	const jevRouting = createJevRouting(agentDirectory);
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
	const { requestAboveInputRender } = registerShell(pi);
	registerChildrenBox(
		pi,
		childSessions,
		requestAboveInputRender,
		options.childSessions?.refresh,
	);
	const todo = registerSessionTodo(pi, requestAboveInputRender, () => {
		const executors = new Map<number, { role: string; id: string }>();
		for (const child of childSessions.list()) {
			if (child.todo && isWorking(child.state)) {
				executors.set(child.todo.id, { role: child.role, id: child.id });
			}
		}
		return executors;
	});
	const footerHints = createFooterHints();
	occupyHeader("child-session", childSessions.working);
	childSessions.subscribe(notifyHeader);
	registerChrome(pi, footerHints);
	pi.registerShortcut("alt+a", {
		description: "Open the subagents view",
		handler: async (ctx) => {
			if (ctx.mode === "tui") await childrenViews.open(ctx);
		},
	});
	const launcher = createChildLauncher({ modelProfiles, jevRouting });

	function companionPackages() {
		return loadCompanionsFromPath(
			options.catalog?.metadataPath ?? companionMetadataPath,
		);
	}

	function expectedPackageNames(): readonly string[] {
		const read = seating.read();
		if (read.status !== "ready") return [];
		return Object.entries(read.selection.expectations)
			.filter(([, on]) => on)
			.map(([name]) => name);
	}

	const childTools = launcher.childToolsOffer(
		pi,
		[
			createSpawnChildTool(launcher, childSessions, todo),
			createContinueChildTool(childSessions),
			...createChildQueryTools(childSessions),
		],
		childSessions,
		workflow.checkSpawnTools,
	);

	const seating = createSeating({
		agentDirectory,
		packages: () => {
			const loaded = companionPackages();
			return {
				packages: loaded.companions.map((companion) => companion.package),
				error: loaded.error,
			};
		},
		offers: [
			() => syncAskUserTools(pi, footerHints),
			todo.offer,
			() => syncCodeGraphTool(pi, options.codegraph),
			() => syncCompactTools(pi, currentCtx),
			childTools.offer,
		],
	});
	childSessions.subscribe(childTools.refresh);

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const read = seating.read();
		if (read.status === "refused") report(ctx, read.reason, "error");
		await seating.seat(read.status === "ready" ? read.selection : undefined);
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("session_shutdown", async (event, ctx) => {
		currentCtx = undefined;
		childrenViews.close();
		const ended = await childSessions.disposeAll();
		if (event.reason !== "reload" || ended === 0) return;
		pi.appendEntry("pi-workflow-child-trace", { reason: "reload", ended });
		report(
			ctx,
			`/reload ended ${ended} working ${ended === 1 ? "child" : "children"}.`,
			"warning",
		);
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
			const read = seating.read();
			if (read.status === "refused") {
				report(ctx, read.reason, "error");
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
			const routing = jevRouting.enabled();
			const guided = await guideSelection(
				ctx,
				read.selection,
				packages,
				states,
				routing,
				seatedCapabilities(),
			);
			if (!guided) return;
			const { selection: chosen, jevRouting: chosenRouting } = guided;
			seating.save(chosen);
			if (chosenRouting !== routing) jevRouting.set(chosenRouting);
			await seating.seat(chosen);
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
				jevRouting,
			});
			report(ctx, lines.join("\n"), failed ? "error" : "info");
		},
	});
}
