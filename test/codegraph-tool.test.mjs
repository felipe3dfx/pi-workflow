import test from "node:test";
import assert from "node:assert/strict";

import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import piWorkflowExtension from "../extensions/pi-workflow.ts";

function missing(path) {
	return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

function fakeWorkspace(t, { index = "directory", git, codegraph } = {}) {
	const base = realpathSync(
		mkdtempSync(join(tmpdir(), "pi-workflow-codegraph-")),
	);
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const root = join(base, "repo");
	mkdirSync(join(root, "extensions"), { recursive: true });
	symlinkSync(root, join(base, "link"));
	const indexPath = join(root, ".codegraph");
	if (index === "directory") mkdirSync(indexPath);
	if (index === "file") writeFileSync(indexPath, "");
	if (index === "symlink") {
		mkdirSync(join(base, "elsewhere"));
		symlinkSync(join(base, "elsewhere"), indexPath);
	}
	const calls = [];
	return {
		base,
		root,
		calls,
		codegraphCalls: () => calls.filter((call) => call.command === "codegraph"),
		adapters: {
			run: async (command, args, options) => {
				calls.push({ command, args, cwd: options.cwd });
				if (command === "git") {
					return git ? git() : { code: 0, stdout: `${root}\n`, stderr: "" };
				}
				return codegraph
					? codegraph(args)
					: { code: 0, stdout: "search results", stderr: "" };
			},
		},
	};
}

function loadTool(adapters) {
	const tools = [];
	piWorkflowExtension(
		{
			on() {},
			registerCommand() {},
			registerTool: (tool) => tools.push(tool),
			exec: async () => {
				throw new Error("registration must not run commands");
			},
		},
		{ codegraph: adapters },
	);
	return tools.find((tool) => tool.name === "codegraph");
}

function execute(tool, params, cwd, signal) {
	return tool.execute("call-1", params, signal, undefined, { cwd });
}

test("query runs codegraph only at the real Git root and returns its output", async (t) => {
	const workspace = fakeWorkspace(t);
	const tool = loadTool(workspace.adapters);
	const result = await execute(
		tool,
		{ operation: "query", query: "--path /etc" },
		join(workspace.base, "link"),
	);
	assert.deepEqual(workspace.codegraphCalls(), [
		{
			command: "codegraph",
			args: ["query", "--path", workspace.root, "--", "--path /etc"],
			cwd: workspace.root,
		},
	]);
	assert.equal(result.details.status, "ok");
	assert.equal(result.content[0].text, "search results");
});

test("init may create a missing index at the Git root and explore reads it", async (t) => {
	const workspace = fakeWorkspace(t, { index: "missing" });
	const tool = loadTool(workspace.adapters);
	assert.equal(
		(await execute(tool, { operation: "init" }, workspace.root)).details.status,
		"ok",
	);
	assert.equal(
		(
			await execute(
				tool,
				{ operation: "explore", query: "Workflow" },
				workspace.root,
			)
		).details.status,
		"ok",
	);
	assert.deepEqual(
		workspace.codegraphCalls().map((call) => call.args),
		[
			["init", workspace.root],
			["explore", "--path", workspace.root, "--", "Workflow"],
		],
	);
});

test("a workspace that is not the Git root is rejected and codegraph does not run", async (t) => {
	const workspace = fakeWorkspace(t);
	const tool = loadTool(workspace.adapters);
	await assert.rejects(
		execute(
			tool,
			{ operation: "query", query: "Workflow" },
			join(workspace.root, "extensions"),
		),
		/real Git root/,
	);
	assert.deepEqual(workspace.codegraphCalls(), []);
});

test("a missing git binary is rejected and codegraph does not run", async (t) => {
	const workspace = fakeWorkspace(t, {
		git: async () => {
			throw missing("git");
		},
	});
	await assert.rejects(
		execute(
			loadTool(workspace.adapters),
			{ operation: "query", query: "Workflow" },
			workspace.root,
		),
		/real Git root/,
	);
	assert.deepEqual(workspace.codegraphCalls(), []);
});

test("a workspace outside any Git repository is rejected and codegraph does not run", async (t) => {
	const workspace = fakeWorkspace(t, {
		git: () => ({
			code: 128,
			stdout: "",
			stderr: "fatal: not a git repository",
		}),
	});
	const previous = process.cwd();
	// realpathSync("") resolves to process.cwd(), so only the exit-code check can reject here.
	process.chdir(workspace.root);
	t.after(() => process.chdir(previous));
	await assert.rejects(
		execute(
			loadTool(workspace.adapters),
			{ operation: "query", query: "Workflow" },
			workspace.root,
		),
		/real Git root/,
	);
	assert.deepEqual(workspace.codegraphCalls(), []);
});

for (const index of ["symlink", "file"]) {
	test(`a .codegraph ${index} is rejected and codegraph does not run`, async (t) => {
		const workspace = fakeWorkspace(t, { index });
		const tool = loadTool(workspace.adapters);
		await assert.rejects(
			execute(tool, { operation: "init" }, workspace.root),
			/real directory/,
		);
		assert.deepEqual(workspace.codegraphCalls(), []);
	});
}

test("a missing codegraph binary is unavailable and points to read, grep, and find", async (t) => {
	const workspace = fakeWorkspace(t, {
		codegraph: async () => {
			throw missing("codegraph");
		},
	});
	const result = await execute(
		loadTool(workspace.adapters),
		{ operation: "query", query: "Workflow" },
		workspace.root,
	);
	assert.equal(result.details.status, "unavailable");
	assert.match(result.content[0].text, /unavailable/);
	assert.match(result.content[0].text, /read, grep, and find/);
});

for (const step of ["git", "codegraph"]) {
	test(`a cancelled ${step} run propagates the abort instead of reporting a failure`, async (t) => {
		const controller = new AbortController();
		const abort = async () => {
			controller.abort();
			throw Object.assign(new Error("The operation was aborted"), {
				name: "AbortError",
				code: "ABORT_ERR",
			});
		};
		const workspace = fakeWorkspace(t, { [step]: abort });
		await assert.rejects(
			execute(
				loadTool(workspace.adapters),
				{ operation: "explore", query: "Workflow" },
				workspace.root,
				controller.signal,
			),
			{ name: "AbortError" },
		);
		assert.equal(workspace.codegraphCalls().length, step === "git" ? 0 : 1);
	});
}

for (const [name, codegraph, detail] of [
	[
		"a non-zero exit",
		async () => ({ code: 2, stdout: "", stderr: "index is corrupt" }),
		/index is corrupt/,
	],
	[
		"a spawn error",
		async () => {
			throw Object.assign(new Error("permission denied"), { code: "EACCES" });
		},
		/permission denied/,
	],
]) {
	test(`${name} is failed and points to read, grep, and find`, async (t) => {
		const workspace = fakeWorkspace(t, { codegraph });
		const result = await execute(
			loadTool(workspace.adapters),
			{ operation: "explore", query: "Workflow" },
			workspace.root,
		);
		assert.equal(result.details.status, "failed");
		assert.match(result.content[0].text, /failed/);
		assert.match(result.content[0].text, detail);
		assert.match(result.content[0].text, /read, grep, and find/);
	});
}

test("registration runs nothing and the tool accepts only an operation and a query", (t) => {
	const workspace = fakeWorkspace(t);
	const tool = loadTool(workspace.adapters);
	assert.deepEqual(workspace.calls, []);
	assert.equal(tool.parameters.additionalProperties, false);
	assert.deepEqual(Object.keys(tool.parameters.properties), [
		"operation",
		"query",
	]);
	assert.deepEqual(tool.parameters.properties.operation.enum, [
		"init",
		"query",
		"explore",
	]);
});
