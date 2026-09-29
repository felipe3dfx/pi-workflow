import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, TruncatedText } from "@earendil-works/pi-tui";

type Theme = Parameters<NonNullable<ToolDefinition["renderCall"]>>[1];
type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
type ScriptCall = { name: string };

function settings(ctx: ExtensionContext) {
	return SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	});
}

const hidden: Component = { render: () => [], invalidate() {} };

class View implements Component {
	readonly own: Component;
	private readonly closed: Component;
	private readonly bar: string | undefined;

	constructor(own: Component, closed: Component, bar: string | undefined) {
		this.own = own;
		this.closed = closed;
		this.bar = bar;
	}

	render(width: number) {
		if (this.bar === undefined) return this.closed.render(width);
		return this.own
			.render(Math.max(1, width - 2))
			.map((line) => `${this.bar} ${line}`);
	}

	invalidate() {
		this.own.invalidate();
	}
}

const verbs: Record<string, string> = {
	read: "Read",
	bash: "Run",
	grep: "Search",
	find: "Find",
	ls: "List",
	edit: "Edit",
	write: "Write",
};

type Status = { isError: boolean; isPartial: boolean };

function toolRow(theme: Theme, status: Status, label: string, detail = "") {
	const glyph = theme.fg(
		status.isError ? "error" : status.isPartial ? "dim" : "toolTitle",
		"◆",
	);
	const head = theme.bold(theme.fg("muted", label));
	return detail
		? `${glyph} ${head} ${theme.fg("dim", detail)}`
		: `${glyph} ${head}`;
}

function title(name: string, args: unknown, theme: Theme, status: Status) {
	const fields = (args ?? {}) as Record<string, unknown>;
	const subject = [
		fields.command,
		fields.pattern,
		fields.path,
		fields.file_path,
	].find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return toolRow(theme, status, verbs[name] ?? name, subject?.split("\n")[0]);
}

function titleCase(value: string) {
	return value
		.split(/[_\-\s]+/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

function firstText(args: unknown) {
	for (const value of Object.values((args ?? {}) as Record<string, unknown>))
		if (typeof value === "string" && value.trim())
			return value.trim().split("\n")[0];
	return "";
}

function fallbackTitle(
	name: string,
	label: string | undefined,
	args: unknown,
	theme: Theme,
	status: Status,
) {
	if (name.startsWith("mcp__")) {
		const [server, ...action] = name.slice(5).split("__");
		return toolRow(
			theme,
			status,
			titleCase(server),
			titleCase(action.join(" ")),
		);
	}
	return toolRow(theme, status, titleCase(label ?? name), firstText(args));
}

function outputText(result: { content: { type: string; text?: string }[] }) {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n")
		.trim();
}

function bar(theme: Theme, expanded: boolean) {
	return expanded ? theme.fg("borderMuted", "┃") : undefined;
}

function compact<
	TParams extends ToolDefinition["parameters"],
	TDetails,
	TState,
>(
	name: string,
	create: (
		cwd: string,
		ctx?: ExtensionContext,
	) => ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	const builtIn = create(process.cwd());
	return {
		...builtIn,
		renderShell: "self",
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			create(ctx.cwd, ctx).execute(toolCallId, params, signal, onUpdate, ctx),
		renderCall(args, theme, context) {
			const previous =
				context.lastComponent instanceof View
					? context.lastComponent.own
					: undefined;
			const own =
				builtIn.renderCall?.(args, theme, {
					...context,
					lastComponent: previous,
				}) ?? hidden;
			return new View(
				own,
				new TruncatedText(title(name, args, theme, context)),
				bar(theme, context.expanded),
			);
		},
		renderResult(result, options, theme, context) {
			const previous =
				context.lastComponent instanceof View
					? context.lastComponent.own
					: undefined;
			const own =
				builtIn.renderResult?.(result, options, theme, {
					...context,
					lastComponent: previous,
				}) ?? hidden;
			return new View(own, hidden, bar(theme, context.expanded));
		},
	};
}

type Fallback = {
	toolName: string;
	toolDefinition?: Pick<ToolDefinition, "label" | "renderCall" | "renderResult">;
};

export function usesFallback(row: Fallback) {
	return (
		row.toolName.startsWith("mcp__") ||
		row.toolName === "codemode" ||
		!row.toolDefinition?.renderCall
	);
}

function unwrapped(context: RenderContext) {
	return {
		...context,
		lastComponent:
			context.lastComponent instanceof View ? context.lastComponent.own : undefined,
	};
}

function callName(name: string) {
	return name.startsWith("mcp__")
		? titleCase(name.slice(5).replace(/__/g, " "))
		: name;
}

function scriptDetail(code: unknown, calls: ScriptCall[]) {
	if (calls.length > 0) {
		const names = [...new Set(calls.map((call) => callName(call.name)))];
		const shown = names.slice(0, 2).join(", ") + (names.length > 2 ? ", …" : "");
		return `${shown} · ${calls.length} tool call${calls.length === 1 ? "" : "s"}`;
	}
	if (typeof code !== "string") return "";
	return (
		code
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line && !line.startsWith("// @options")) ?? ""
	);
}

function scriptRenderers(definition: Fallback["toolDefinition"]) {
	return {
		renderCall(args: unknown, theme: Theme, context: RenderContext): Component {
			const state = context.state as { calls?: ScriptCall[] };
			const code = (args as { code?: unknown } | undefined)?.code;
			const own =
				definition?.renderCall?.(args, theme, unwrapped(context)) ?? hidden;
			const head: Component = {
				render: (width) =>
					new TruncatedText(
						toolRow(
							theme,
							context,
							"Run script",
							scriptDetail(code, state.calls ?? []),
						),
					).render(width),
				invalidate() {},
			};
			return new View(own, head, bar(theme, context.expanded));
		},
		renderResult(
			result: { content: { type: string; text?: string }[]; details?: unknown },
			options: { expanded: boolean; isPartial: boolean },
			theme: Theme,
			context: RenderContext,
		): Component {
			const details = result.details as { calls?: ScriptCall[] } | undefined;
			(context.state as { calls?: ScriptCall[] }).calls = details?.calls;
			const own =
				definition?.renderResult?.(
					result as Parameters<NonNullable<ToolDefinition["renderResult"]>>[0],
					options,
					theme,
					unwrapped(context),
				) ?? hidden;
			return new View(own, hidden, bar(theme, context.expanded));
		},
	};
}

export function fallbackRenderers(row: Fallback) {
	if (row.toolName === "codemode") return scriptRenderers(row.toolDefinition);
	const label = row.toolName.startsWith("mcp__")
		? undefined
		: row.toolDefinition?.label;
	return {
		renderCall(
			args: unknown,
			theme: Theme,
			context: Status & { expanded: boolean },
		): Component {
			const head = fallbackTitle(row.toolName, label, args, theme, context);
			const body = JSON.stringify(args ?? {}, null, 2);
			return new View(
				new Text(`${head}\n${theme.fg("dim", body)}`, 0, 0),
				new TruncatedText(head),
				bar(theme, context.expanded),
			);
		},
		renderResult(
			result: { content: { type: string; text?: string }[] },
			_options: unknown,
			theme: Theme,
			context: { expanded: boolean },
		): Component {
			const output = outputText(result);
			return new View(
				output ? new Text(theme.fg("toolOutput", output), 0, 0) : hidden,
				hidden,
				bar(theme, context.expanded),
			);
		},
	};
}

// The options mirror what Pi's session passes when it builds its own base tools.
export function registerCompactTools(pi: ExtensionAPI) {
	pi.registerTool(
		compact("read", (cwd, ctx) =>
			createReadToolDefinition(
				cwd,
				ctx && { autoResizeImages: settings(ctx).getImageAutoResize() },
			),
		),
	);
	pi.registerTool(
		compact("bash", (cwd, ctx) => {
			const shell = ctx && settings(ctx);
			return createBashToolDefinition(
				cwd,
				shell && {
					commandPrefix: shell.getShellCommandPrefix(),
					shellPath: shell.getShellPath(),
				},
			);
		}),
	);
	pi.registerTool(compact("grep", (cwd) => createGrepToolDefinition(cwd)));
	pi.registerTool(compact("find", (cwd) => createFindToolDefinition(cwd)));
	pi.registerTool(compact("ls", (cwd) => createLsToolDefinition(cwd)));
	pi.registerTool(compact("edit", (cwd) => createEditToolDefinition(cwd)));
	pi.registerTool(compact("write", (cwd) => createWriteToolDefinition(cwd)));
}
