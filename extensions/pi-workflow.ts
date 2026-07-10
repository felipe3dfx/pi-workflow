import { statSync } from "node:fs";

import {
	createCompanionWorkflow,
	type CompanionWorkflowOptions,
} from "./companion-workflow.ts";

interface CommandContext {
	hasUI?: boolean;
	ui: {
		confirm?: (
			title: string,
			message: string,
			options?: unknown,
		) => Promise<boolean>;
		notify: (message: string, level?: "info" | "warning" | "error") => void;
	};
}

interface ExtensionAPI {
	exec: (
		command: string,
		args?: string[],
	) => Promise<{ code: number; stdout?: string; stderr?: string }>;
	registerCommand: (
		name: string,
		definition: {
			description: string;
			handler: (args: string, ctx: CommandContext) => Promise<void> | void;
		},
	) => void;
}

function directoryExists(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch (error) {
		const code =
			typeof error === "object" && error !== null
				? (error as { code?: unknown }).code
				: undefined;
		if (code === "ENOENT" || code === "ENOTDIR") return false;
		throw error;
	}
}

function createWorkflow(
	pi: ExtensionAPI,
	ctx: CommandContext,
	workflowOptions: CompanionWorkflowOptions = {},
) {
	return createCompanionWorkflow({
		catalog: workflowOptions.catalog,
		interaction: {
			...workflowOptions.interaction,
			notify: (message, level) => ctx.ui.notify(message, level),
			confirm:
				ctx.hasUI && ctx.ui.confirm
					? (title, message, options) =>
							ctx.ui.confirm?.(title, message, options) ??
							Promise.resolve(false)
					: undefined,
			installPackage: (spec) => pi.exec("pi", ["install", spec]),
		},
		diagnostics: {
			exec: pi.exec,
			cwd: () => process.cwd(),
			directoryExists,
			...workflowOptions.diagnostics,
		},
	});
}

export default function piWorkflowExtension(
	pi: ExtensionAPI,
	workflowOptions: CompanionWorkflowOptions = {},
) {
	pi.registerCommand("pi-workflow-status", {
		description:
			"Show configured pi-workflow companion packages and install state",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).inspect();
		},
	});

	pi.registerCommand("pi-workflow-doctor", {
		description: "Show diagnostic pi-workflow companion package status",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).diagnose();
		},
	});

	pi.registerCommand("pi-workflow-install-companions", {
		description:
			"Confirm and install missing or mismatched pi-workflow companion packages",
		handler: async (_args, ctx) => {
			await createWorkflow(pi, ctx, workflowOptions).installMissing();
		},
	});
}
