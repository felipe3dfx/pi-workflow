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
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, TruncatedText } from "@earendil-works/pi-tui";

import { claim, held } from "./configure.ts";

const compactStream = claim("compact-rendering", "message-stream");

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
	const [label, detail] = toolLabel(name, args);
	return toolRow(theme, status, label, detail);
}

function titleCase(value: string) {
	return value
		.split(/[_\-\s]+/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

export function toolLabel(name: string, args: unknown) {
	const fields = (args ?? {}) as Record<string, unknown>;
	if (name.startsWith("mcp__")) {
		const [server, ...action] = name.slice(5).split("__");
		return [titleCase(server), titleCase(action.join(" "))];
	}
	const verb = verbs[name];
	const subject = (
		verb
			? [fields.command, fields.pattern, fields.path, fields.file_path]
			: Object.values(fields)
	).find(
		(value): value is string =>
			typeof value === "string" && value.trim().length > 0,
	);
	return [verb ?? titleCase(name), subject?.trim().split("\n")[0] ?? ""];
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
	session: ExtensionContext,
): ToolDefinition<TParams, TDetails, TState> {
	const builtIn = create(session.cwd, session);
	return {
		...builtIn,
		renderShell: "self",
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			create(ctx.cwd, ctx).execute(toolCallId, params, signal, onUpdate, ctx),
		renderCall(args, theme, context) {
			if (!held(compactStream)) {
				return builtIn.renderCall?.(args, theme, context) ?? hidden;
			}
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
			if (!held(compactStream)) {
				return (
					builtIn.renderResult?.(result, options, theme, context) ?? hidden
				);
			}
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

function usesFallback(toolName: string, own: ToolRenderers | undefined) {
	return (
		toolName.startsWith("mcp__") ||
		toolName === "codemode" ||
		!own?.renderCall
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

function scriptRenderers(definition: ToolRenderers | undefined) {
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

function fallbackRenderers(toolName: string, own: ToolRenderers | undefined) {
	if (toolName === "codemode") return scriptRenderers(own);
	return {
		renderCall(
			args: unknown,
			theme: Theme,
			context: Status & { expanded: boolean },
		): Component {
			const head = title(toolName, args, theme, context);
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

export function compactToolRenderers(
	toolName: string,
	next: () => ToolRenderers | undefined,
): ToolRenderers | undefined {
	if (!held(compactStream)) return next();
	const own = next();
	if (!usesFallback(toolName, own)) return own;
	return { ...own, renderShell: "self", ...fallbackRenderers(toolName, own) };
}

// The options mirror what Pi's session passes when it builds its own base tools.
export function syncCompactTools(pi: ExtensionAPI, ctx?: ExtensionContext) {
	if (!ctx?.cwd || typeof ctx.isProjectTrusted !== "function") return;
	const on = held(compactStream);
	const register = (name: string, create: (cwd: string, ctx?: ExtensionContext) => object) => {
		const tool = (on
			? compact(name, create as Parameters<typeof compact>[1], ctx)
			: create(ctx.cwd, ctx)) as Parameters<ExtensionAPI["registerTool"]>[0];
		pi.registerTool(tool);
	};
	register("read", (cwd, ctx) =>
		createReadToolDefinition(
			cwd,
			ctx && { autoResizeImages: settings(ctx).getImageAutoResize() },
		),
	);
	register("bash", (cwd, ctx) => {
		const shell = ctx && settings(ctx);
		return createBashToolDefinition(
			cwd,
			shell && {
				commandPrefix: shell.getShellCommandPrefix(),
				shellPath: shell.getShellPath(),
			},
		);
	});
	register("grep", (cwd) => createGrepToolDefinition(cwd));
	register("find", (cwd) => createFindToolDefinition(cwd));
	register("ls", (cwd) => createLsToolDefinition(cwd));
	register("edit", (cwd) => createEditToolDefinition(cwd));
	register("write", (cwd) => createWriteToolDefinition(cwd));
}

export function registerCompactTools(pi: ExtensionAPI) {
	pi.registerToolRenderer(compactToolRenderers);
	syncCompactTools(pi);
}
