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
	createWriteToolDefinition,
	initTheme,
} from "@earendil-works/pi-coding-agent";

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

function loadTools() {
	const tools = new Map();
	piWorkflowExtension({
		on() {},
		registerCommand() {},
		registerShortcut() {},
		registerProvider() {},
		registerTool: (tool) => tools.set(tool.name, tool),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	});
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
		read: [{ path: "src/app.ts" }, "◆ read src/app.ts"],
		bash: [{ command: "npm test\nnpm run lint" }, "◆ bash npm test"],
		grep: [{ pattern: "TODO", path: "src" }, "◆ grep TODO"],
		find: [{ pattern: "*.ts" }, "◆ find *.ts"],
		ls: [{}, "◆ ls"],
		edit: [{ path: "a.ts", edits: [] }, "◆ edit a.ts"],
		write: [{ path: "b.ts", content: "x\ny\nz" }, "◆ write b.ts"],
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

test("a closed tool that failed keeps a red title", () => {
	const tool = loadTools().get("bash");
	const tagged = {
		...theme,
		fg: (color, text) => `<${color}>${text}</${color}>`,
	};
	const context = {
		...renderContext({ command: "false" }, false, "/"),
		isError: true,
	};
	const [line] = tool
		.renderCall({ command: "false" }, tagged, context)
		.render(80);
	assert.match(line, /^<error>◆ bash<\/error>/);
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
