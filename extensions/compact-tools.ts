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

function settings(ctx: ExtensionContext) {
	return SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	});
}

const hidden: Component = { render: () => [], invalidate() {} };

class Barred implements Component {
	readonly inner: Component;
	private readonly bar: string;
	private readonly fallback: Component;

	constructor(inner: Component, bar: string, fallback = hidden) {
		this.inner = inner;
		this.bar = bar;
		this.fallback = fallback;
	}

	render(width: number) {
		const innerWidth = Math.max(1, width - 2);
		const lines = this.inner.render(innerWidth);
		return (lines.length > 0 ? lines : this.fallback.render(innerWidth)).map(
			(line) => `${this.bar} ${line}`,
		);
	}

	invalidate() {
		this.inner.invalidate();
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

function resultText(result: { content: { type: string; text?: string }[] }) {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
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
			const line = new TruncatedText(title(name, args, theme, context.isError));
			return context.expanded
				? new Barred(line, theme.fg("borderMuted", "┃"))
				: line;
		},
		renderResult(result, options, theme, context) {
			if (!context.expanded) return hidden;
			const previous =
				context.lastComponent instanceof Barred
					? context.lastComponent.inner
					: undefined;
			const body =
				builtIn.renderResult?.(result, options, theme, {
					...context,
					lastComponent: previous,
				}) ?? hidden;
			const fallback = new Text(
				theme.fg("toolOutput", resultText(result)),
				0,
				0,
			);
			return new Barred(body, theme.fg("borderMuted", "┃"), fallback);
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
