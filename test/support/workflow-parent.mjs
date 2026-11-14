import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { capabilities } from "../../extensions/configure.ts";
import piWorkflowExtension from "../../extensions/pi-workflow.ts";
import { replaceSelection } from "../../extensions/shell.ts";
import { fakeChildren } from "./fake-children.mjs";

export function seat(on = capabilities) {
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((capability) => [capability, on.includes(capability)]),
		),
		expectations: {},
	});
}

export async function parentSession(
	agentDirectory,
	{ legacy = false, create } = {},
) {
	const handlers = new Map();
	const tools = [];
	const sent = [];
	const ui = {
		notify() {},
		setWidget() {},
		setStatus() {},
		setHeader() {},
		setFooter() {},
		setEditorComponent() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setWorkingMessage() {},
	};
	piWorkflowExtension(
		{
			on(event, handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			registerTool: (tool) => tools.push(tool),
			sendMessage: (message, options) => sent.push({ message, options }),
			appendEntry() {},
			exec: async () => {
				throw new Error("must not run commands");
			},
		},
		{
			catalog: {
				resolveInstalledVersion: (name) =>
					legacy && name === "@tintinweb/pi-subagents"
						? { version: "2.0.0" }
						: {},
			},
			agentDirectory,
			childSessions: create ? { create } : undefined,
		},
	);
	const fire = async (event, payload = {}, ctx = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? []) {
			result = await handler(payload, ctx);
		}
		return result;
	};
	await fire(
		"session_start",
		{},
		{
			mode: "print",
			hasUI: true,
			ui,
			cwd: agentDirectory,
			sessionManager: { getBranch: () => [], getEntries: () => [] },
		},
	);
	return { fire, tools, sent };
}

export async function gitRepository(dir) {
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	return worktree;
}

export async function realParent(
	t,
	dir,
	responses,
	{ extensionFactories = [] } = {},
) {
	const worktree = await gitRepository(dir);
	const runtime = await ModelRuntime.create({
		authPath: join(dir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({
		provider: "faux",
		models: [{ id: "parent", reasoning: true }],
	});
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey("faux", "key");
	const requests = [];
	faux.setResponses(
		responses.map((response) => (context) => {
			requests.push(structuredClone(context));
			return response;
		}),
	);
	const children = fakeChildren();
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: worktree,
		agentDir: dir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
		extensionFactories: [
			(pi) =>
				piWorkflowExtension(pi, {
					agentDirectory: dir,
					catalog: { resolveInstalledVersion: () => ({}) },
					childSessions: { create: children.create },
				}),
			...extensionFactories,
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: worktree,
		agentDir: dir,
		modelRuntime: runtime,
		model: faux.getModel(),
		thinkingLevel: "high",
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.inMemory(worktree),
	});
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "rpc" });
	return { session, requests, children, worktree };
}
