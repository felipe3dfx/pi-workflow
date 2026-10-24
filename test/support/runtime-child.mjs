import { resolve } from "node:path";

import {
	createAgentSession,
	createCodemodeExtension,
	createMcpExtension,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { installChildRuntime } from "../../extensions/child-runtime.ts";
import { seated } from "../../extensions/shell.ts";
import { commonToolFactories, defaultActiveTools } from "../../extensions/tool-sources.ts";

function held(entries) {
	const decisions = new Map();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== "pi-workflow-authorization") continue;
		if (entry.data.kind === "held") decisions.set(entry.data.call, entry.data);
		else decisions.delete(entry.data.call);
	}
	return structuredClone([...decisions.values()]);
}

export function runtimeChild(runtime) {
	const sessions = new Map();
	return async (spec) => {
		const policy = spec.authorization;
		const slash = spec.model.indexOf("/");
		const model = runtime.getModel(spec.model.slice(0, slash), spec.model.slice(slash + 1));
		if (!model) throw new Error(`The selected model ${spec.model} is not available in Pi.`);
		const channel = {
			ready() {},
			async request(frame, signal) {
				if (frame.type === "ask") return spec.ask(frame.question, signal);
				if (frame.type === "report") {
					spec.report(frame.result);
					return "";
				}
				if (frame.type === "checkpoint") {
					await spec.checkpointed(frame.checkpoint);
					return "";
				}
				const value =
					frame.method === "authority"
						? await policy.authority({ cwd: spec.cwd, signal: signal ?? new AbortController().signal })
						: frame.method === "classify"
							? await policy.classify(frame.value, signal)
							: await policy.onDecision?.(frame.value);
				return JSON.stringify(value ?? null);
			},
		};
		const config = {
			role: spec.role,
			cwd: spec.cwd,
			shell: spec.shell,
			checkpoint: spec.checkpoint,
			codegraph: !policy && seated("codegraph", "message-stream"),
			contextual: policy && { active: spec.sources?.active ?? defaultActiveTools },
		};
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.inMemory({}, { projectTrusted: spec.project.trusted });
		const resourceLoader = new DefaultResourceLoader({
			cwd: spec.cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			additionalExtensionPaths: (spec.sources?.paths ?? []).map((path) => resolve(spec.project.cwd, path)),
			extensionFactories: [
				...(policy ? commonToolFactories(spec.sources ?? {}) : [createCodemodeExtension({ models: false })]),
				createMcpExtension(),
				(pi) => pi.on("session_start", (_event, ctx) => installChildRuntime(pi, config, channel, ctx)),
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			systemPromptOverride: () => spec.prompt,
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: spec.cwd,
			modelRuntime: runtime,
			model,
			thinkingLevel: spec.thinking,
			...(policy ? {} : { tools: spec.tools }),
			resourceLoader,
			sessionManager: SessionManager.inMemory(
				spec.cwd,
				{ parentSession: spec.parentSession },
				sessions.get(spec.parentSession)?.getEntries(),
			),
			settingsManager,
		});
		sessions.set(session.sessionId, session.sessionManager);
		session.subscribe((event) => spec.onEvent(event));
		await session.bindExtensions({
			uiContext: { ...session.extensionRunner.getUIContext(), notify: (message) => spec.notify(message) },
		});
		return {
			sessionId: session.sessionId,
			entries: () => session.sessionManager.getEntries(),
			pendingAuthorizations: () => held(session.sessionManager.getEntries()),
			tools: session.getActiveToolNames(),
			async run(task) {
				await session.prompt(task);
				const last = session.messages.at(-1);
				if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
					throw new Error(last.errorMessage ?? `The child run ${last.stopReason}.`);
				}
				return session.getLastAssistantText() ?? "";
			},
			steer: (text) => session.steer(text),
			clearQueue: () => session.clearQueue().steering,
			abort: () => session.abort(),
			async dispose() {
				try {
					await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				} finally {
					session.dispose();
				}
			},
			async removeSession() {},
		};
	};
}

export function runtimeChildSession({ runtime, ...spec }) {
	return runtimeChild(runtime)({
		project: { cwd: spec.cwd, trusted: false },
		role: "explore",
		model: "faux/child",
		thinking: "high",
		prompt: "You are a child session.",
		tools: ["read"],
		shell: {},
		onEvent: () => {},
		notify: () => {},
		ask: async () => "answer",
		report: () => {},
		checkpointed: () => {},
		...spec,
	});
}
