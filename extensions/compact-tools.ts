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
import { type Component, TruncatedText } from "@earendil-works/pi-tui";

type Theme = Parameters<NonNullable<ToolDefinition["renderCall"]>>[1];

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

function title(name: string, args: unknown, theme: Theme, isError: boolean) {
	const fields = (args ?? {}) as Record<string, unknown>;
	const subject = [
		fields.command,
		fields.pattern,
		fields.path,
		fields.file_path,
	].find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	const head = theme.fg(
		isError ? "error" : "toolTitle",
		theme.bold(`◆ ${name}`),
	);
	return subject ? `${head} ${theme.fg("accent", subject)}` : head;
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
				new TruncatedText(title(name, args, theme, context.isError)),
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
