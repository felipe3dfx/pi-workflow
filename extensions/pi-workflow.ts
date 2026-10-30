import { join } from "node:path";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
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
	loadCompanionsFromPath,
	resolveCompanionStates,
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
import { type ChildAudit, createChildAudit } from "./child-audit.ts";
import { createChildLauncher } from "./child-launcher.ts";
import { runDelegationCheck } from "./delegation-check.ts";
import { registerDelegationMode } from "./delegation-mode.ts";
import { registerChildResultCards } from "./child-result-card.ts";
import type { ChildSessionFactory } from "./child-handle.ts";
import {
	type ResidentChildren,
	createChildQueryTools,
	createChildSessions,
	createContinueChildTool,
	createSpawnChildTool,
	isWorking,
} from "./child-sessions.ts";
import { type Schedule, scheduleTimer } from "./clock.ts";
import { registerChildrenBox } from "./children-box.ts";
import { pruneChildSessions } from "./rpc-child.ts";
import { createFooterHints, registerChrome } from "./chrome.ts";
import { createChildrenViews } from "./children-view.ts";
import { createModelProfiles, report } from "./model-profiles.ts";
import { registerSessionTodo } from "./todo-extension.ts";
import type { TaskExecutor } from "./todo-header.ts";
import { registerCompactTools, syncCompactTools } from "./compact-tools.ts";
import { resolveAgentDirectory } from "./agent-directory.ts";
import { inspectClaudeBridgeCompanion } from "./web-access.ts";
import { createDelegationMode, createJevRouting } from "./workflow-settings.ts";

import {
	type ActionAuthorization,
	installActionAuthorization,
	sessionActionAuthorization,
} from "./action-authorization.ts";
import { type CommonToolSources, commonToolFactories } from "./tool-sources.ts";
import { isHarnessMessage } from "./harness-message.ts";

// /reload replaces this module but not the Pi process, so the children of the old runtime wait here for the new one.
const RESIDENT = Symbol.for("pi-workflow:child-sessions:resident");
const slots = globalThis as Record<
	symbol,
	| { children: ResidentChildren; audit: Awaited<ReturnType<ChildAudit["detach"]>> }
	| undefined
>;
// /reload re-imports every extension within seconds; a runtime that has not adopted by then failed to load, and its children must not run unsupervised.
export const adoptionDeadline = 30_000;

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

export function contextualWorkflowSources(
	options: Parameters<typeof piWorkflowExtension>[1] & {
		authorization: ActionAuthorization;
		sources: CommonToolSources;
	},
) {
	const local = sessionActionAuthorization(options.authorization);
	return {
		bindSession: local.bindSession,
		noExtensions: true,
		additionalExtensionPaths: [...(options.sources.paths ?? [])],
		extensionFactories: [
			...commonToolFactories(options.sources),
			createMcpExtension(),
			((pi) =>
				piWorkflowExtension(pi, {
					...options,
					authorization: local.authorization,
				})) satisfies ExtensionFactory,
		],
	};
}

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	options: Omit<CompanionWorkflowOptions, "agentDirectory"> & {
		agentDirectory?: string;
		authorization?: ActionAuthorization;
		sources?: CommonToolSources;
		codegraph?: CodeGraphAdapters;
		childSessions?: {
			create?: ChildSessionFactory;
			schedule?: Schedule;
			refresh?: Schedule;
		};
	} = {},
) {
	const agentDirectory = resolveAgentDirectory(options.agentDirectory);
	const messages = new Map<string, unknown>();
	if (options.authorization)
		installActionAuthorization(pi, options.authorization, { messages });
	let currentCtx: ExtensionContext | ExtensionCommandContext | undefined;
	const context = () => currentCtx;
	const catalog = {
		...options.catalog,
		resolveInstalledVersionAsync:
			options.catalog?.resolveInstalledVersionAsync ??
			(options.catalog?.resolveInstalledVersion
				? undefined
				: async (packageName: string) => {
					if (packageName !== "pi-claude-bridge") return undefined;
					const project = currentCtx;
					if (
						!project ||
						typeof project.cwd !== "string" ||
						typeof project.isProjectTrusted !== "function"
					) {
						return { error: "The parent project context is unavailable." };
					}
					return inspectClaudeBridgeCompanion(agentDirectory, {
						cwd: project.cwd,
						trusted: project.isProjectTrusted(),
					});
				}),
	};
	const workflow = createWorkflow(pi, context, {
		...options,
		catalog,
		agentDirectory,
		expectedPackages: expectedPackageNames,
	});
	registerCompactTools(pi);
	registerChildResultCards(pi);
	const modelProfiles = createModelProfiles(agentDirectory);
	const jevRouting = createJevRouting(agentDirectory);
	const delegationMode = createDelegationMode(agentDirectory);
	const { requestAboveInputRender } = registerShell(pi);
	const todo = registerSessionTodo(pi, requestAboveInputRender, () => {
		const executors = new Map<number, TaskExecutor>();
		for (const child of childSessions.list()) {
			if (
				child.todo !== undefined &&
				isWorking(child.state) &&
				childSessions.latestLinked(child.todo) === child.id
			) {
				executors.set(child.todo, { role: child.role, id: child.id });
			}
		}
		return executors;
	});
	const audit = createChildAudit({
		root: join(agentDirectory, "pi-workflow-audit"),
		parent: () => {
			const session = currentCtx?.sessionManager;
			return session?.getSessionFile() ? session.getSessionId() : undefined;
		},
	});
	const childSessions = createChildSessions({
		authorization: options.authorization,
		sources: options.authorization ? (options.sources ?? {}) : undefined,
		create: options.childSessions?.create,
		schedule: options.childSessions?.schedule,
		send: (message) =>
			pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true }),
		idle: () => currentCtx?.isIdle() ?? false,
		trace: (entry) => pi.appendEntry("pi-workflow-child-trace", entry),
		report: (message) => {
			if (currentCtx) report(currentCtx, message, "error");
		},
		todo,
		audit,
	});
	pi.on("turn_end", () => childSessions.atBoundary());
	pi.on("agent_settled", () => childSessions.atBoundary());
	const childrenViews = createChildrenViews(childSessions, audit, todo);
	registerChildrenBox(
		pi,
		childSessions,
		requestAboveInputRender,
		options.childSessions?.refresh,
	);
	const footerHints = createFooterHints();
	const askChoice = createAskUserChoiceTool(footerHints);
	const askQuestion = createAskUserQuestionTool(footerHints);
	occupyHeader("child-session", childSessions.working);
	childSessions.subscribe(notifyHeader);
	registerChrome(pi, footerHints);
	pi.registerShortcut("alt+a", {
		description: "Open the subagents view",
		handler: async (ctx) => {
			if (ctx.mode === "tui") await childrenViews.open(ctx);
		},
	});
	const launcher = createChildLauncher({
		contextual: options.authorization !== undefined,
		modelProfiles,
		jevRouting,
		delegationMode,
	});

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

	const childQueries = createChildQueryTools(childSessions);
	for (const tool of [...childQueries, askChoice, askQuestion]) {
		if (isHarnessMessage(tool))
			messages.set(tool.name, tool.parameters);
	}
	const childTools = launcher.childToolsOffer(
		pi,
		[
			createSpawnChildTool(
				launcher,
				childSessions,
				todo,
				options.authorization !== undefined,
			),
			createContinueChildTool(childSessions),
			...childQueries,
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
			() => syncAskUserTools(pi, askChoice, askQuestion),
			todo.offer,
			() => syncCodeGraphTool(pi, options.codegraph),
			() => syncCompactTools(pi, currentCtx),
			childTools.offer,
		],
	});
	childSessions.subscribe(childTools.refresh);
	registerDelegationMode(
		pi,
		delegationMode,
		childTools.offered,
		options.authorization !== undefined,
	);

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		await pruneChildSessions();
		const resident = slots[RESIDENT];
		slots[RESIDENT] = undefined;
		if (resident) {
			audit.adopt(resident.audit);
			childSessions.adopt(resident.children);
		}
		const read = seating.read();
		if (read.status === "refused") report(ctx, read.reason, "error");
		await seating.seat(read.status === "ready" ? read.selection : undefined);
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		currentCtx = ctx;
	});
	pi.on("session_shutdown", async (event) => {
		currentCtx = undefined;
		childrenViews.close();
		if (event.reason === "reload") {
			const children = await childSessions.detach();
			const resident = { children, audit: await audit.detach() };
			slots[RESIDENT] = resident;
			(options.childSessions?.schedule ?? scheduleTimer)(async () => {
				if (slots[RESIDENT] !== resident) return;
				slots[RESIDENT] = undefined;
				audit.adopt(resident.audit);
				await childSessions.abandon(resident.children);
				await audit.close();
			}, adoptionDeadline);
			return;
		}
		await childSessions.disposeAll();
		await audit.close();
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
	pi.registerTool(askChoice);
	pi.registerTool(askQuestion);

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
			"Configure companions, harness capabilities, Jev routing, and Delegation mode",
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
			const states = await resolveCompanionStates(loaded.companions, catalog);
			const routing = jevRouting.enabled();
			const mode = delegationMode.current();
			const guided = await guideSelection(
				ctx,
				read.selection,
				loaded.companions,
				states,
				routing,
				mode,
				seatedCapabilities(),
			);
			if (!guided) return;
			const {
				selection: chosen,
				jevRouting: chosenRouting,
				delegationMode: chosenMode,
			} = guided;
			seating.save(chosen);
			if (chosenRouting !== routing) jevRouting.set(chosenRouting);
			if (chosenMode !== mode) delegationMode.set(chosenMode);
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
				delegationMode,
			});
			report(ctx, lines.join("\n"), failed ? "error" : "info");
		},
	});
}
