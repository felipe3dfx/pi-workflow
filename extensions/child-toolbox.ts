import { join } from "node:path";
import {
	getAgentDir,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import type { ActionAuthorization } from "./action-authorization.ts";
import {
	createAskUserChoiceTool,
	createAskUserQuestionTool,
} from "./ask-user-panel.ts";
import { createChildAudit } from "./child-audit.ts";
import { createChildLauncher } from "./child-launcher.ts";
import {
	createChildQueryTools,
	createChildSessions,
	createContinueChildTool,
	createSpawnChildTool,
} from "./child-sessions.ts";
import { createFooterHints } from "./chrome.ts";
import { createCodeGraphTool } from "./codegraph-tool.ts";
import { createModelProfiles } from "./model-profiles.ts";
import { seated, watchHeader } from "./shell.ts";
import { offerTool } from "./tool-offer.ts";
import type { CommonToolSources } from "./tool-sources.ts";
import { registerSessionTodo } from "./todo-extension.ts";
import { createDelegationMode, createJevRouting } from "./workflow-settings.ts";

export function childToolbox(
	authorization: ActionAuthorization,
	sources: CommonToolSources,
): ExtensionFactory {
	return (pi) => {
		const agentDirectory = getAgentDir();
		const todo = registerSessionTodo(
			pi,
			() => {},
			() => new Map(),
			{ attachUI: false },
		);
		const audit = createChildAudit({
			root: join(agentDirectory, "pi-workflow-audit"),
			parent: () => undefined,
		});
		const sessions = createChildSessions({
			authorization,
			sources,
			todo,
			audit,
			send: (message) =>
				pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true }),
			idle: () => false,
			trace: (entry) => pi.appendEntry("pi-workflow-child-trace", entry),
			report: (message) =>
				pi.appendEntry("pi-workflow-child-warning", { message }),
		});
		const launcher = createChildLauncher({
			contextual: true,
			modelProfiles: createModelProfiles(agentDirectory),
			jevRouting: createJevRouting(agentDirectory),
			delegationMode: createDelegationMode(agentDirectory),
		});
		const hints = createFooterHints();
		const questions = [
			createAskUserChoiceTool(hints, () => {}),
			createAskUserQuestionTool(hints, () => {}),
		];
		const graph = createCodeGraphTool();
		const children = [
			createSpawnChildTool(launcher, sessions, todo, true),
			createContinueChildTool(sessions),
			...createChildQueryTools(sessions),
		];
		const refresh = () => {
			todo.offer();
			for (const tool of questions)
				offerTool(pi, tool, seated("operator-questions", "overlay"));
			offerTool(pi, graph, seated("codegraph", "message-stream"));
			for (const tool of children)
				offerTool(
					pi,
					tool,
					seated("child-session", "overlay") ||
						(sessions.waiting() && tool.name === "reply_child"),
				);
		};
		pi.on("session_start", refresh);
		const unsubscribe = watchHeader(refresh);
		const unsubscribeSessions = sessions.subscribe(refresh);
		pi.on("turn_end", () => sessions.atBoundary());
		pi.on("agent_settled", () => sessions.atBoundary());
		pi.on("session_shutdown", async () => {
			unsubscribe();
			unsubscribeSessions();
			await sessions.disposeAll();
			await audit.close();
		});
	};
}
