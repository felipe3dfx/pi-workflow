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
import {
	contribute,
	held,
	readSelection,
	replaceSelection,
} from "./configure.ts";
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
	childDetails,
	createChildQueryTools,
	createChildSessions,
	childOverlay,
	createContinueChildTool,
	createSpawnChildTool,
	isWorking,
	type Schedule,
} from "./child-sessions.ts";
import { childName } from "./children-box.ts";
import { childOutcome } from "./child-projection.ts";
import { registerChildrenBox } from "./children-box.ts";
import { createFooterHints, registerChrome } from "./chrome.ts";
import { createChildrenViews } from "./children-view.ts";
import {
	createModelProfiles,
	type ModelProfilesOptions,
	report,
} from "./model-profiles.ts";
import type { Fetch } from "./jev-client.ts";
import { registerSessionTodo, syncTodoTool } from "./todo-extension.ts";
import { registerCompactTools, syncCompactTools } from "./compact-tools.ts";
import { activePiAgentDirectory, writeJsonAtomically } from "./mcp-config.ts";

const usage =
	"Usage: /workflow:status | /workflow:doctor | /workflow:configure | /workflow:models | /workflow:subagents | /workflow:delegation-check";



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
		expectedPackages: options.expectedPackages,
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
	const workflow = createWorkflow(pi, context, {
		...options,
		expectedPackages: expectedPackageNames,
	});
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
	contribute("child-session", "header", () => {
		const working = childSessions
			.list()
			.filter((child) => isWorking(child.state));
		const first = working[0];
		return {
			count: working.length,
			label: first ? `Subagent: ${childName(first)}…` : undefined,
			stepMs: first ? Date.now() - (first.startedAt ?? first.createdAt) : 0,
		};
	});
	registerChrome(pi, footerHints);
	pi.registerShortcut("alt+a", {
		description: "Open the subagents view",
		handler: async (ctx) => {
			if (ctx.mode === "tui") await childrenViews.open(ctx);
		},
	});
	const launcher = createChildLauncher({
		modelProfiles,
		fetch: options.childSessions?.fetch,
		childSessionSeated: () => held(childOverlay),
	});

	function selectionPath() {
		return resolve(
			activePiAgentDirectory(options.mcp),
			"pi-workflow-selection.json",
		);
	}

	function companionPackages() {
		return loadCompanionsFromPath(
			options.catalog?.metadataPath ?? companionMetadataPath,
		);
	}

	function seatFromDisk(ctx: { hasUI?: boolean; mode?: string }) {
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
		if (text === undefined || !ctx.hasUI || ctx.mode !== "tui") return selection;
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
		const on = held(childOverlay);
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
			if (!held(childOverlay)) return;
			const gate = await launcher.gateToolCall(event, toolCtx);
			if (gate.allow) return;
			return { block: true, reason: gate.reason };
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const seated = seatFromDisk(ctx);
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
	pi.registerCommand("workflow:configure", {
		description:
			"Review the local selection, then seat capabilities and install expected companions",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify(usage, "error");
				return;
			}
			currentCtx = ctx;
			const seated = seatFromDisk(ctx);
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
			const guided = await guideSelection(
				ctx,
				seated.selection,
				packages,
				states,
			);
			if (!guided) return;
			writeJsonAtomically(selectionPath(), guided);
			replaceSelection(guided);
			const { allowed } = await workflow.checkSpawnTools();
			syncAskUserTools(pi, footerHints);
			syncTodoTool(pi);
			syncCodeGraphTool(pi, options.codegraph);
			syncCompactTools(pi, ctx);
			registerChildTools(allowed);
			const expected = Object.entries(guided.expectations)
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
			if (!held(childOverlay)) {
				report(
					ctx,
					"Child session is not seated. Run /workflow:configure.",
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
			if (!held(childOverlay)) {
				report(
					ctx,
					"Child session is not seated. Run /workflow:configure.",
					"error",
				);
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
