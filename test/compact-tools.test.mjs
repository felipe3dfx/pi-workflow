import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createCodemodeExtension,
	createWriteToolDefinition,
	initTheme,
} from "@earendil-works/pi-coding-agent";

import {
	fallbackRenderers,
	syncCompactTools,
	usesFallback,
} from "../extensions/compact-tools.ts";
import { readSelection, replaceSelection } from "../extensions/configure.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

const builtIns = {
	read: createReadToolDefinition,
	bash: createBashToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
};

const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
};

function sessionContext(cwd) {
	return { cwd, isProjectTrusted: () => false };
}

function loadTools() {
	const tools = new Map();
	const pi = {
		on() {},
		registerCommand() {},
		registerShortcut() {},
		registerMessageRenderer() {},
		registerProvider() {},
		registerTool: (tool) => tools.set(tool.name, tool),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	};
	const preview = readSelection(undefined, []);
	if (preview.status === "ready") replaceSelection(preview.selection);
	piWorkflowExtension(pi);
	syncCompactTools(pi, sessionContext(process.cwd()));
	return tools;
}

async function withWorkspace(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-tools-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
	try {
		return await run(dir);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(dir, { recursive: true, force: true });
	}
}

function executionContext(cwd) {
	return {
		cwd,
		isProjectTrusted: () => false,
		sessionManager: {
			getSessionId: () => "session-1",
			getSessionFile: () => undefined,
		},
	};
}

function renderContext(args, expanded, cwd) {
	return {
		args,
		state: {},
		lastComponent: undefined,
		invalidate() {},
		toolCallId: "call-1",
		cwd,
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded,
		showImages: false,
		isError: false,
	};
}

function lines(component, width = 60) {
	return component
		.render(width)
		.map((line) => stripVTControlCharacters(line).trimEnd());
}

test("the seven tools keep the built-in contract the model sees", () => {
	const tools = loadTools();
	for (const [name, create] of Object.entries(builtIns)) {
		const builtIn = create(process.cwd());
		const tool = tools.get(name);
		assert.ok(tool, `${name} is registered`);
		assert.equal(tool.description, builtIn.description);
		assert.deepEqual(tool.parameters, builtIn.parameters);
		assert.equal(tool.promptSnippet, builtIn.promptSnippet);
		assert.deepEqual(tool.promptGuidelines, builtIn.promptGuidelines);
		assert.equal(tool.prepareArguments, builtIn.prepareArguments);
	}
});

test("read, write, edit, ls, and bash produce the built-in effect and result", async () => {
	const tools = loadTools();
	await withWorkspace(async (cwd) => {
		const ctx = executionContext(cwd);
		const run = (tool, params) =>
			tool.execute("call-1", params, undefined, undefined, ctx);
		const cases = [
			["write", { path: "note.txt", content: "alpha\nbeta\n" }],
			["read", { path: "note.txt", offset: 2 }],
			[
				"edit",
				{ path: "note.txt", edits: [{ oldText: "beta", newText: "gamma" }] },
			],
			["ls", {}],
			["bash", { command: "printf done" }],
		];
		for (const [name, params] of cases) {
			await writeFile(join(cwd, "note.txt"), "alpha\nbeta\n");
			const expected = await run(builtIns[name](cwd), params);
			const expectedFile = await readFile(join(cwd, "note.txt"), "utf8");
			await writeFile(join(cwd, "note.txt"), "alpha\nbeta\n");
			const actual = await run(tools.get(name), params);
			assert.deepEqual(actual, expected, `${name} result`);
			assert.equal(
				await readFile(join(cwd, "note.txt"), "utf8"),
				expectedFile,
				`${name} effect`,
			);
		}
	});
});

test("a closed tool is one short line and hides its body", () => {
	initTheme("dark", false);
	const tools = loadTools();
	const titles = {
		read: [{ path: "src/app.ts" }, "◆ Read src/app.ts"],
		bash: [{ command: "npm test\nnpm run lint" }, "◆ Run npm test"],
		grep: [{ pattern: "TODO", path: "src" }, "◆ Search TODO"],
		find: [{ pattern: "*.ts" }, "◆ Find *.ts"],
		ls: [{}, "◆ List"],
		edit: [{ path: "a.ts", edits: [] }, "◆ Edit a.ts"],
		write: [{ path: "b.ts", content: "x\ny\nz" }, "◆ Write b.ts"],
	};
	const result = {
		content: [{ type: "text", text: "one\ntwo" }],
		details: undefined,
	};
	for (const [name, [args, title]] of Object.entries(titles)) {
		const tool = tools.get(name);
		const context = renderContext(args, false, process.cwd());
		assert.deepEqual(
			lines(tool.renderCall(args, theme, context)),
			[title],
			name,
		);
		assert.deepEqual(
			lines(
				tool.renderResult(
					result,
					{ expanded: false, isPartial: false },
					theme,
					context,
				),
			),
			[],
			name,
		);
	}
	const narrow = tools
		.get("bash")
		.renderCall(
			{ command: "x".repeat(80) },
			theme,
			renderContext({}, false, "/"),
		);
	assert.equal(narrow.render(20).length, 1);
	assert.ok(stripVTControlCharacters(narrow.render(20)[0]).length <= 20);
});

test("an open tool shows exactly what Pi draws for the call and result, inside a thick left bar", () => {
	initTheme("dark", false);
	const tools = loadTools();
	const width = 24;
	const cases = {
		read: { path: "package.json", offset: 2 },
		bash: { command: "printf done\necho more" },
		grep: { pattern: "TODO", path: "src" },
		find: { pattern: "*.ts" },
		ls: { path: "extensions" },
		edit: { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
		write: { path: "b.txt", content: "first line\nsecond line" },
	};
	const result = {
		content: [{ type: "text", text: "one\ntwo" }],
		details: undefined,
	};
	const options = { expanded: true, isPartial: false };
	for (const [name, args] of Object.entries(cases)) {
		const builtIn = builtIns[name](process.cwd());
		const piContext = renderContext(args, true, process.cwd());
		const expected = [
			...builtIn.renderCall(args, theme, piContext).render(width - 2),
			...builtIn
				.renderResult(result, options, theme, piContext)
				.render(width - 2),
		].map((line) => `┃ ${line}`);
		const snapshot = structuredClone(result);

		const tool = tools.get(name);
		const context = renderContext(args, true, process.cwd());
		const actual = [
			...tool.renderCall(args, theme, context).render(width),
			...tool.renderResult(result, options, theme, context).render(width),
		];

		assert.deepEqual(actual, expected, name);
		assert.ok(
			actual.every((line) => !line.includes("◆")),
			name,
		);
		assert.deepEqual(result, snapshot, name);
	}
});

test("a closed tool colors only its glyph by status: error, running dim, done toolTitle", () => {
	const tool = loadTools().get("bash");
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
	};
	const context = {
		...renderContext({ command: "false" }, false, "/"),
		isError: true,
	};
	const row = (status) =>
		tool
			.renderCall({ command: "false" }, tagged, { ...context, ...status })
			.render(80)[0]
			.trimEnd();
	const rest = "<muted>Run</muted> <dim>false</dim>";
	assert.equal(row({}), `<error>◆</error> ${rest}`);
	assert.equal(
		row({ isError: false, isPartial: true }),
		`<dim>◆</dim> ${rest}`,
	);
	assert.equal(row({ isError: false }), `<toolTitle>◆</toolTitle> ${rest}`);
});

test("an open bash keeps the elapsed time Pi draws", () => {
	initTheme("dark", false);
	const tool = loadTools().get("bash");
	const args = { command: "printf done" };
	const context = renderContext(args, true, process.cwd());
	tool.renderCall(args, theme, context);
	const body = lines(
		tool.renderResult(
			{ content: [{ type: "text", text: "done" }], details: undefined },
			{ expanded: true, isPartial: false },
			theme,
			context,
		),
	);
	assert.ok(
		body.every((line) => line.startsWith("┃")),
		body.join("\n"),
	);
	assert.ok(
		body.some((line) => /Took \d/.test(line)),
		body.join("\n"),
	);
});

test("MCP and renderer-less tools render one Grok row closed and their arguments and output open", () => {
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
		bold: (text) => `<b>${text}</b>`,
	};
	const renderCall = () => {};
	assert.equal(
		usesFallback({
			toolName: "mcp__engram__mem_search",
			toolDefinition: { renderCall },
		}),
		true,
	);
	assert.equal(
		usesFallback({
			toolName: "spawn_child",
			toolDefinition: { label: "Spawn Child" },
		}),
		true,
	);
	assert.equal(usesFallback({ toolName: "unknown" }), true);
	assert.equal(
		usesFallback({ toolName: "read", toolDefinition: { renderCall } }),
		false,
	);
	const status = { isError: false, isPartial: false };
	const mcp = fallbackRenderers({ toolName: "mcp__engram__mem_search" });
	const args = { query: "typebox", project: "pi" };
	const closed = { ...status, expanded: false };
	assert.deepEqual(
		mcp
			.renderCall(args, tagged, closed)
			.render(80)
			.map((line) => line.trimEnd()),
		[
			"<toolTitle>◆</toolTitle> <b><muted>Engram</muted></b> <dim>Mem Search</dim>",
		],
	);
	const output = { content: [{ type: "text", text: "Found 2" }] };
	assert.deepEqual(mcp.renderResult(output, {}, tagged, closed).render(80), []);
	const child = fallbackRenderers({
		toolName: "spawn_child",
		toolDefinition: { label: "Spawn Child" },
	});
	assert.deepEqual(
		lines(
			child.renderCall({ task: "Audit\nthe repo" }, theme, {
				...status,
				isPartial: true,
				expanded: false,
			}),
		),
		["◆ Spawn Child Audit"],
	);
	const open = { ...status, expanded: true };
	assert.deepEqual(
		[
			...lines(mcp.renderCall(args, theme, open), 30),
			...lines(mcp.renderResult(output, {}, theme, open), 30),
		],
		[
			"┃ ◆ Engram Mem Search",
			"┃ {",
			'┃   "query": "typebox",',
			'┃   "project": "pi"',
			"┃ }",
			"┃ Found 2",
		],
	);
	for (let width = 1; width <= 40; width++)
		for (const line of mcp.renderCall(args, theme, open).render(width))
			assert.ok(
				stripVTControlCharacters(line).length <= Math.max(width, 3),
				`${width}`,
			);
});

test("a codemode script is one Run script row closed and Pi's code and output under the bar open", () => {
	initTheme("dark", false);
	let codemode;
	createCodemodeExtension()({
		registerTool: (tool) => {
			codemode = tool;
		},
		appendEntry() {},
		getSettings: () => ({}),
		getAllTools: () => [],
	});
	const row = { toolName: "codemode", toolDefinition: codemode };
	assert.equal(usesFallback(row), true);
	const renderers = fallbackRenderers(row);
	const args = {
		code: '// @options: {"max_output_tokens": 1000}\nconst issues = await sentry_search_issues({ query: "is:unresolved" });\nreturn issues.length;',
	};
	const context = renderContext(args, false, "/");
	const call = renderers.renderCall(args, theme, context);
	assert.deepEqual(lines(call, 100), [
		"◆ Run script const issues = await sentry_search_issues({ query: \"is:unresolved\" });",
	]);
	const result = {
		content: [
			{ type: "text", text: "Script completed\nWall time 0.4 seconds\nOutput:\n" },
			{ type: "text", text: "3" },
		],
		details: {
			calls: [
				{ name: "mcp__sentry__search_issues", args: "{}", status: "ok" },
				{ name: "mcp__linear__get_issue", args: "{}", status: "ok" },
				{ name: "mcp__sentry__get_issue", args: "{}", status: "ok" },
			],
		},
	};
	const closed = renderers.renderResult(result, { expanded: false, isPartial: false }, theme, context);
	assert.deepEqual(lines(closed, 80), []);
	assert.deepEqual(lines(call, 80), [
		"◆ Run script Sentry Search Issues, Linear Get Issue, … · 3 tool calls",
	]);
	const open = renderContext(args, true, "/");
	open.state = context.state;
	const expanded = [
		...lines(renderers.renderCall(args, theme, open), 80),
		...lines(renderers.renderResult(result, { expanded: true, isPartial: false }, theme, open), 80),
	];
	assert.ok(expanded.every((line) => line.startsWith("┃")));
	assert.ok(expanded[0].includes("codemode"));
	assert.ok(expanded.some((line) => line.includes("return issues.length;")));
	assert.ok(expanded.some((line) => line.includes("mcp__linear__get_issue")));
	assert.equal(expanded.at(-1), "┃ 3");
	for (let width = 1; width <= 60; width++)
		for (const line of call.render(width))
			assert.ok(stripVTControlCharacters(line).length <= width, `width ${width}`);
});

test("turning compact rendering off registers the seven tools with the session cwd", async () => {
	await withWorkspace(async (cwd) => {
		const preview = readSelection(undefined, []);
		assert.equal(preview.status, "ready");
		preview.selection.capabilities["compact-rendering"] = false;
		replaceSelection(preview.selection);
		const skipped = [];
		syncCompactTools({ registerTool: (tool) => skipped.push(tool.name) });
		assert.deepEqual(skipped, []);
		const tools = new Map();
		syncCompactTools(
			{ registerTool: (tool) => tools.set(tool.name, tool) },
			sessionContext(cwd),
		);
		for (const name of Object.keys(builtIns)) assert.ok(tools.has(name), name);
		const result = await tools.get("bash").execute(
			"call-1",
			{ command: "pwd" },
			undefined,
			undefined,
			{
				isProjectTrusted: () => false,
				sessionManager: {
					getSessionId: () => "session-1",
					getSessionFile: () => undefined,
				},
			},
		);
		const text = result.content
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("\n");
		assert.match(text, new RegExp(cwd));
	});
});
