import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	getSystemMessageText,
} from "@earendil-works/pi-ai";
import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createAdvisor } from "../extensions/advisor.ts";
import { capabilities } from "../extensions/configure.ts";
import { createDelegationMode } from "../extensions/workflow-settings.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { driveConfig, focusOn } from "./support/config-guide.mjs";
import { modelEndpoint } from "./support/model-endpoint.mjs";
import { selectionWith } from "./support/selection.mjs";
import { parentSession, realParent, seat } from "./support/workflow-parent.mjs";

const keys = { enter: "\r", escape: "\x1b", down: "\x1b[B" };

const fakeTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};

const catalog = [
	{ provider: "openai-codex", id: "gpt-5.6-luna", reasoning: true },
	{
		provider: "openai-codex",
		id: "gpt-6-astra",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh", max: "max" },
	},
	{ provider: "nan", id: "mimo-v2.5", reasoning: false },
	{ provider: "anthropic", id: "claude-opus", reasoning: true },
];

function commandContext({
	mode = "tui",
	hasUI = true,
	available = catalog.slice(0, 3),
	model,
} = {}) {
	const notifications = [];
	const opened = [];
	const waiting = [];
	const ctx = {
		hasUI,
		mode,
		model,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			custom: (factory) =>
				new Promise((resolve) => {
					const panel = factory(
						{ requestRender() {}, terminal: { rows: 40 } },
						fakeTheme,
						new KeybindingsManager(TUI_KEYBINDINGS),
						resolve,
					);
					const waiter = waiting.shift();
					if (waiter) waiter(panel);
					else opened.push(panel);
				}),
		},
		modelRegistry: {
			getAll: () => catalog,
			getAvailable: () => available,
		},
	};
	const nextPanel = () =>
		opened.length > 0
			? Promise.resolve(opened.shift())
			: new Promise((resolve) => waiting.push(resolve));
	return { ctx, notifications, nextPanel };
}

async function advisorCommand(t) {
	const dir = withAgentDirectory(t);
	const parent = await parentSession(dir);
	t.after(() => seat());
	seat();
	return {
		dir,
		path: join(dir, "pi-workflow-advisor.json"),
		run: (args, ctx) =>
			parent.commands.get("workflow:advisor").handler(args, ctx),
	};
}

function press(panel, ...sequence) {
	for (const data of sequence) panel.handleInput(data);
}

function lines(panel, width = 120) {
	const [top, ...rest] = panel
		.render(width)
		.map((line) => stripVTControlCharacters(line));
	const title = top.replace(/^┌─ /, "").replace(/ ─+( \[×\] )?─┐$/, "");
	const body = rest
		.slice(0, -1)
		.map((line) =>
			line
				.slice(1, -1)
				.trim()
				.replace(/^▸ /, "")
				.replace(/\s*›$/, "")
				.replace(/ {2,}/g, " "),
		)
		.filter((line) => line !== "" && !/ ─+$/.test(line));
	return [title, ...body];
}

const absent = (path) =>
	assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });

test("/workflow:advisor refuses arguments, then a disabled advisor, then a missing TUI, and writes nothing", async (t) => {
	const command = await advisorCommand(t);
	const printed = [];
	t.mock.method(console, "error", (message) => printed.push(message));
	const refusal = async (args, options) => {
		const { ctx, notifications } = commandContext(options);
		ctx.ui.custom = () => assert.fail("the picker must not open");
		await command.run(args, ctx);
		return notifications.map(({ message }) => message);
	};

	seat(capabilities.filter((capability) => capability !== "advisor"));
	const notes = await refusal("gpt", { mode: "rpc" });
	assert.equal(notes.length, 1);
	assert.match(notes[0], /^Usage: .*\/workflow:advisor/);
	assert.deepEqual(await refusal("", { mode: "rpc" }), [
		"Advisor is disabled. Enable it in /workflow:config.",
	]);
	seat();
	assert.deepEqual(await refusal("", { mode: "rpc" }), [
		"The advisor picker needs the TUI.",
	]);
	await refusal("", { mode: "print", hasUI: false });
	assert.deepEqual(printed, ["The advisor picker needs the TUI."]);
	await absent(command.path);
});

test("the picker lists available models with a filter, then the levels the chosen model supports", async (t) => {
	const command = await advisorCommand(t);
	const { ctx, nextPanel } = commandContext();
	const choosing = command.run("", ctx);
	const panel = await nextPanel();

	assert.equal(lines(panel)[0], "Advisor model");
	assert.deepEqual(lines(panel).slice(2, 5), [
		"openai-codex/gpt-5.6-luna",
		"openai-codex/gpt-6-astra",
		"nan/mimo-v2.5",
	]);
	assert.ok(!lines(panel).includes("anthropic/claude-opus"));
	assert.equal(
		lines(panel).at(-1),
		"type filter | ↑/↓ choose | Enter select | Esc close",
	);
	press(panel, ..."luna");
	assert.deepEqual(lines(panel).slice(2, -1), ["openai-codex/gpt-5.6-luna"]);
	press(panel, keys.enter);
	assert.deepEqual(lines(panel), [
		"Thinking level for openai-codex/gpt-5.6-luna",
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"↑/↓ choose | Enter confirm | Esc back",
	]);
	press(panel, keys.escape, keys.escape);
	await choosing;
	await absent(command.path);

	const astra = commandContext();
	const choosingAstra = command.run("", astra.ctx);
	const astraPanel = await astra.nextPanel();
	press(astraPanel, ..."astra", keys.enter);
	assert.deepEqual(lines(astraPanel), [
		"Thinking level for openai-codex/gpt-6-astra",
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
		"↑/↓ choose | Enter confirm | Esc back",
	]);
	press(astraPanel, keys.escape, keys.escape);
	await choosingAstra;
	await absent(command.path);
});

test("choosing a thinking level writes the advisor model file and closes the picker, even for the session's own model", async (t) => {
	const command = await advisorCommand(t);
	const untouched = {
		[join(command.dir, "pi-workflow-selection.json")]:
			'{"probe":"selection"}\n',
		[join(command.dir, "pi-workflow-models.json")]: '{"probe":"models"}\n',
	};
	for (const [path, content] of Object.entries(untouched)) {
		await writeFile(path, content, "utf8");
	}
	const { ctx, nextPanel } = commandContext({ model: catalog[0] });
	const choosing = command.run("", ctx);
	const panel = await nextPanel();

	press(panel, keys.enter, keys.down, keys.down, keys.enter);
	await choosing;
	for (const [path, content] of Object.entries(untouched)) {
		assert.equal(await readFile(path, "utf8"), content);
	}

	assert.deepEqual(JSON.parse(await readFile(command.path, "utf8")), {
		schemaVersion: 1,
		model: "openai-codex/gpt-5.6-luna",
		thinking: "low",
	});
	assert.deepEqual(createAdvisor(command.dir).model(), {
		model: "openai-codex/gpt-5.6-luna",
		thinking: "low",
	});
});

test("Esc on the thinking levels returns to the models, and Esc on the models closes without writing", async (t) => {
	const command = await advisorCommand(t);
	const { ctx, nextPanel } = commandContext();
	let closed = false;
	const choosing = command.run("", ctx).then(() => {
		closed = true;
	});
	const panel = await nextPanel();

	press(panel, keys.down, keys.enter, keys.escape);
	assert.equal(lines(panel)[0], "Advisor model");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(closed, false);
	press(panel, keys.escape);
	await choosing;
	assert.equal(closed, true);
	await absent(command.path);
});

test("an ill-formed or unreadable advisor model file opens the picker and is overwritten", async (t) => {
	const command = await advisorCommand(t);
	const choose = async () => {
		const { ctx, nextPanel } = commandContext();
		const choosing = command.run("", ctx);
		press(await nextPanel(), keys.enter, keys.enter);
		await choosing;
		return JSON.parse(await readFile(command.path, "utf8"));
	};
	const chosen = {
		schemaVersion: 1,
		model: "openai-codex/gpt-5.6-luna",
		thinking: "off",
	};

	await writeFile(command.path, "{ broken", "utf8");
	assert.deepEqual(await choose(), chosen);

	await writeFile(
		command.path,
		JSON.stringify({ schemaVersion: 2, model: "x", thinking: "warm" }),
		"utf8",
	);
	assert.deepEqual(await choose(), chosen);

	await rm(command.path);
	await symlink(join(command.dir, "missing-target.json"), command.path);
	assert.deepEqual(await choose(), chosen);
});

test("a file changed while the picker is open is overwritten without a check", async (t) => {
	const command = await advisorCommand(t);
	const { ctx, nextPanel } = commandContext();
	const choosing = command.run("", ctx);
	const panel = await nextPanel();
	await writeFile(command.path, '{"changed":"meanwhile"}\n', "utf8");
	press(panel, keys.enter, keys.enter);
	await choosing;
	assert.deepEqual(JSON.parse(await readFile(command.path, "utf8")), {
		schemaVersion: 1,
		model: "openai-codex/gpt-5.6-luna",
		thinking: "off",
	});
});

test("choosing over an unreadable advisor model file leaves a readable file", {
	skip:
		process.getuid?.() === 0 &&
		"root reads a mode 000 file, so it is never unreadable",
}, async (t) => {
	const command = await advisorCommand(t);
	await writeFile(command.path, "{}", { encoding: "utf8", mode: 0o000 });
	const { ctx, nextPanel } = commandContext();
	const choosing = command.run("", ctx);
	press(await nextPanel(), keys.enter, keys.enter);
	await choosing;

	const chosen = { model: "openai-codex/gpt-5.6-luna", thinking: "off" };
	assert.deepEqual(createAdvisor(command.dir).model(), chosen);
	assert.deepEqual(JSON.parse(await readFile(command.path, "utf8")), {
		schemaVersion: 1,
		...chosen,
	});
});

test("every rendered line fits the width and hostile model names cannot inject control sequences", async (t) => {
	const command = await advisorCommand(t);
	const hostile = { provider: "nan", id: "evil\x1b[2J‮name", reasoning: true };
	const { ctx, nextPanel } = commandContext({ available: [hostile] });
	ctx.modelRegistry.getAll = () => [hostile];
	const choosing = command.run("", ctx);
	const panel = await nextPanel();
	const screens = [];
	for (const width of [10, 24, 44, 80]) screens.push(panel.render(width));
	press(panel, keys.enter);
	for (const width of [10, 24, 44, 80]) screens.push(panel.render(width));

	for (const [index, screen] of screens.entries()) {
		const width = [10, 24, 44, 80][index % 4];
		for (const line of screen) {
			assert.ok(visibleWidth(line) <= width, JSON.stringify(line));
			for (const unsafe of ["\x1b[2J", "‮", "\n"]) {
				assert.ok(!line.includes(unsafe), JSON.stringify(line));
			}
		}
	}
	press(panel, keys.escape, keys.escape);
	await choosing;
});

test("the advisor model reads as absent unless the file is well-formed", async (t) => {
	const dir = withAgentDirectory(t);
	const path = join(dir, "pi-workflow-advisor.json");
	const advisor = createAdvisor(dir);
	assert.equal(advisor.model(), undefined);

	await writeFile(
		path,
		JSON.stringify({
			schemaVersion: 1,
			model: "openrouter/anthropic/claude",
			thinking: "high",
			note: "kept",
		}),
	);
	assert.deepEqual(advisor.model(), {
		model: "openrouter/anthropic/claude",
		thinking: "high",
	});

	for (const content of [
		"{ broken",
		"[]",
		JSON.stringify({ schemaVersion: 2, model: "a/b", thinking: "high" }),
		JSON.stringify({ schemaVersion: 1, model: "ab", thinking: "high" }),
		JSON.stringify({ schemaVersion: 1, model: "/b", thinking: "high" }),
		JSON.stringify({ schemaVersion: 1, model: "a/", thinking: "high" }),
		JSON.stringify({ schemaVersion: 1, model: 7, thinking: "high" }),
		JSON.stringify({ schemaVersion: 1, model: "a/b", thinking: "warm" }),
		JSON.stringify({ schemaVersion: 1, model: "a/b" }),
	]) {
		await writeFile(path, content);
		assert.equal(advisor.model(), undefined, content);
	}
});

const advisorTool = (tools) =>
	tools.findLast((tool) => tool.name === "advisor");
const offered = (tools) => advisorTool(tools)?.exposure === "direct";
const withoutAdvisor = capabilities.filter(
	(capability) => capability !== "advisor",
);
const echoModel = { schemaVersion: 1, model: "fake/echo", thinking: "off" };

function writeAdvisorModel(dir, value = echoModel) {
	return writeFile(
		join(dir, "pi-workflow-advisor.json"),
		typeof value === "string" ? value : JSON.stringify(value),
	);
}

test("the advisor tool is offered at session start only while seated with a well-formed model file", async (t) => {
	t.after(() => seat());
	seat();
	const dir = withAgentDirectory(t);
	assert.equal(offered((await parentSession(dir)).tools), false);

	await writeAdvisorModel(dir, "{ broken");
	assert.equal(offered((await parentSession(dir)).tools), false);

	await writeAdvisorModel(dir);
	assert.equal(offered((await parentSession(dir)).tools), true);

	seat(withoutAdvisor);
	assert.equal(offered((await parentSession(dir)).tools), false);
});

test("the advisor tool takes no parameters, runs alone, and tells the parent when to consult", async (t) => {
	t.after(() => seat());
	seat();
	const dir = withAgentDirectory(t);
	await writeAdvisorModel(dir);
	const tool = advisorTool((await parentSession(dir)).tools);

	assert.deepEqual(tool.parameters.properties ?? {}, {});
	assert.equal(tool.executionMode, "sequential");
	const guidance = tool.promptGuidelines.join("\n");
	assert.match(guidance, /before committing to an approach/i);
	assert.match(guidance, /stuck/i);
	assert.match(guidance, /chang\w* (your )?approach/i);
	assert.match(guidance, /before declaring\b.*\bdone/i);
});

test("seat changes and /workflow:advisor saves re-evaluate the offer, and an outside edit waits for them", async (t) => {
	t.after(() => seat());
	seat();
	const dir = withAgentDirectory(t);
	const packages = JSON.parse(
		await readFile(new URL("../assets/companions.json", import.meta.url)),
	).companions.map((entry) => entry.package);
	const stored = selectionWith(packages, {});
	for (const name of Object.keys(stored.expectations))
		stored.expectations[name] = false;
	await writeFile(
		join(dir, "pi-workflow-selection.json"),
		JSON.stringify(stored),
	);
	const parent = await parentSession(dir);
	assert.equal(offered(parent.tools), false);

	const { ctx, nextPanel } = commandContext();
	const choosing = parent.commands.get("workflow:advisor").handler("", ctx);
	press(await nextPanel(), keys.enter, keys.enter);
	await choosing;
	assert.equal(offered(parent.tools), true);

	await rm(join(dir, "pi-workflow-advisor.json"));
	assert.equal(offered(parent.tools), true);

	const toggleAdvisor = (panel) => {
		focusOn(panel, "Advisor");
		press(panel, " ", "\t", keys.enter, keys.enter);
	};
	await writeAdvisorModel(dir);
	await driveConfig(parent.commands.get("workflow:config"), toggleAdvisor);
	assert.equal(offered(parent.tools), false);

	await rm(join(dir, "pi-workflow-advisor.json"));
	await driveConfig(parent.commands.get("workflow:config"), toggleAdvisor);
	assert.equal(offered(parent.tools), false);
	await writeAdvisorModel(dir);
	await driveConfig(parent.commands.get("workflow:config"), (panel) =>
		press(panel, "\t", keys.enter, keys.enter),
	);
	assert.equal(offered(parent.tools), true);
});

const plan = "I plan to rewrite the parser before touching the lexer.";
const consultCall = (...before) =>
	fauxAssistantMessage(
		[fauxText(plan), ...before, fauxToolCall("advisor", {}, { id: "consult" })],
		{ stopReason: "toolUse" },
	);

const fixtureTool = {
	name: "fixture",
	label: "Fixture",
	description: "Return a fixture.",
	parameters: {
		type: "object",
		properties: { topic: { type: "string" } },
	},
	async execute(_id, params) {
		if (params.topic === "before")
			return {
				content: [{ type: "text", text: "BEFORE-THE-ADVISOR" }],
				details: {},
			};
		return {
			content: [
				{ type: "text", text: `long-start ${"x".repeat(3_000)} long-end` },
				{ type: "image", data: "aW1hZ2UtYnl0ZXM=", mimeType: "image/png" },
			],
			details: {},
		};
	},
};

async function consult(
	t,
	{
		answer = "Keep the plan.",
		model = echoModel,
		call = consultCall(),
		before = [],
		mode,
		prepare,
	} = {},
) {
	t.after(() => seat());
	seat();
	const dir = withAgentDirectory(t);
	const log = [];
	const endpoint = await modelEndpoint(
		dir,
		typeof answer === "function"
			? (body) => {
					log.push("request");
					return answer(body, dir);
				}
			: () => {
					log.push("request");
					return answer;
				},
	);
	t.after(endpoint.close);
	if (model) await writeAdvisorModel(dir, model);
	if (mode) createDelegationMode(dir).set(mode);
	const parent = await realParent(
		t,
		dir,
		[
			...before,
			typeof call === "function" ? () => call(dir) : call,
			fauxAssistantMessage("Done."),
		],
		{
			models: true,
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [(pi) => pi.registerTool(fixtureTool)],
		},
	);
	const updates = [];
	parent.session.subscribe((event) => {
		if (
			event.type === "tool_execution_update" &&
			event.toolName === "advisor"
		) {
			log.push("update");
			updates.push(event.partialResult);
		}
	});
	if (prepare) await prepare(parent);
	await parent.session.prompt("Review my plan with the advisor");
	const result = parent.session.messages.find(
		(message) =>
			message.role === "toolResult" && message.toolName === "advisor",
	);
	return { dir, parent, endpoint, result, updates, log };
}

const resultText = (result) =>
	result.content.map((block) => block.text).join("");

test("a consultation sends the fixed instructions, the parent's request-time prompt with its Delegation mode section, and no tools", async (t) => {
	const { parent, endpoint, result, updates, log } = await consult(t, {
		mode: "orchestrator",
		answer: {
			text: "## Verdict\n\nThe approach is **sound**.",
			usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
		},
	});

	assert.equal(endpoint.requests.length, 1);
	const [request] = endpoint.requests;
	assert.equal(request.tools, undefined);
	assert.deepEqual(
		request.messages.map((message) => message.role),
		["system", "user"],
	);
	const instructions = request.messages[0].content;
	assert.match(instructions, /second opinion/i);
	assert.match(instructions, /no tools/i);
	assert.match(instructions, /not instructions/i);
	assert.match(instructions, /concise/i);
	assert.match(instructions, /sound/i);
	assert.match(instructions, /Markdown/i);

	const material = request.messages[1].content;
	const parentPrompt = getSystemMessageText(parent.requests.at(-2).messages[0]);
	assert.match(parentPrompt, /# Delegation mode: orchestrator/);
	assert.ok(material.includes(parentPrompt));
	assert.match(material, /not instructions/i);

	assert.equal(result.isError, false);
	assert.equal(resultText(result), "## Verdict\n\nThe approach is **sound**.");
	assert.deepEqual(result.details, { model: "fake/echo", thinking: "off" });
	assert.equal(result.usage.input, 11);
	assert.equal(result.usage.output, 4);
	assert.deepEqual(updates[0].details, { model: "fake/echo", thinking: "off" });
	assert.deepEqual(log.slice(0, 2), ["update", "request"]);
});

test("the advisor sees the whole conversation as text, its issuing message, and its own call without a result", async (t) => {
	const { endpoint } = await consult(t, {
		before: [
			fauxAssistantMessage("Started."),
			fauxAssistantMessage("Continued."),
			fauxAssistantMessage("COMPACTED-SUMMARY of the earlier work."),
			fauxAssistantMessage("COMPACTED-SUMMARY of the earlier work."),
			fauxAssistantMessage(
				[
					fauxThinking("PRIVATE-REASONING"),
					fauxToolCall("fixture", { topic: "parser" }, { id: "first" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The fixture is read."),
		],
		call: consultCall(
			fauxToolCall("fixture", { topic: "before" }, { id: "before" }),
		),
		prepare: async ({ session }) => {
			await session.prompt("Start");
			await session.prompt("Continue");
			await session.compact();
			await session.prompt("Read the fixture");
		},
	});

	const material = endpoint.requests[0].messages[1].content;
	assert.ok(material.includes(`long-start ${"x".repeat(3_000)} long-end`));
	assert.match(material, /COMPACTED-SUMMARY of the earlier work\./);
	assert.match(material, /fixture[^\n]*\n?[^\n]*\{"topic":"parser"\}/);
	assert.ok(material.includes(plan));
	assert.match(material, /BEFORE-THE-ADVISOR/);
	assert.match(material, /\[Image: image\/png\]/);
	assert.doesNotMatch(material, /aW1hZ2UtYnl0ZXM=/);
	assert.doesNotMatch(material, /PRIVATE-REASONING/);
	const labels = material.match(/^\[[^\]\n]*\]/gm);
	assert.ok(labels.length > 0);
	for (const label of labels)
		assert.doesNotMatch(label, /executor|reviewer|verifier/i);
	assert.match(material, /^\[Tool call: advisor\]$/m);
	assert.doesNotMatch(material, /^\[Tool result: advisor\b/m);
});

const failure = (result) => ({
	failure: result.details.failure,
	isError: result.isError,
	text: resultText(result),
});

test("a call that arrives after the advisor was unseated is refused without an error", async (t) => {
	const { result, endpoint } = await consult(t, {
		call: () => {
			seat(withoutAdvisor);
			return consultCall();
		},
	});
	assert.deepEqual(failure(result), {
		failure: "refused",
		isError: false,
		text: "Advisor is disabled. Enable it in /workflow:config.",
	});
	assert.equal(result.details.model, "fake/echo");
	assert.equal(endpoint.requests.length, 0);
});

test("a model file removed by an outside edit fails the call with no model to show", async (t) => {
	const { result } = await consult(t, {
		call: async (dir) => {
			await rm(join(dir, "pi-workflow-advisor.json"));
			return consultCall();
		},
	});
	assert.deepEqual(failure(result), {
		failure: "no-model",
		isError: true,
		text: "No advisor model is set. Choose one with /workflow:advisor.",
	});
	assert.equal(result.details.model, undefined);
});

test("a model Pi does not offer, or a thinking level it does not support, fails before any request", async (t) => {
	const missing = await consult(t, {
		model: { ...echoModel, model: "fake/missing" },
	});
	assert.deepEqual(failure(missing.result), {
		failure: "unavailable",
		isError: true,
		text: "The advisor model fake/missing is not available in Pi. Choose another with /workflow:advisor.",
	});
	assert.equal(missing.result.details.model, "fake/missing");
	assert.equal(missing.endpoint.requests.length, 0);

	const thinking = await consult(t, {
		model: { ...echoModel, thinking: "high" },
	});
	assert.deepEqual(failure(thinking.result), {
		failure: "thinking",
		isError: true,
		text: "The advisor model fake/echo does not support thinking high. Choose another level with /workflow:advisor.",
	});
	assert.equal(thinking.endpoint.requests.length, 0);
});

test("a provider failure returns its message once, and a recognized overflow adds the hint", async (t) => {
	const provider = await consult(t, {
		answer: { status: 400, error: "Invalid API key provided" },
	});
	assert.equal(provider.result.details.failure, "provider");
	assert.equal(provider.result.isError, true);
	assert.match(resultText(provider.result), /Invalid API key provided/);
	assert.doesNotMatch(resultText(provider.result), /\/workflow:advisor/);
	assert.equal(provider.endpoint.requests.length, 1);

	const overflow = await consult(t, {
		answer: {
			status: 400,
			error: "Your input exceeds the context window of this model.",
		},
	});
	assert.equal(overflow.result.details.failure, "overflow");
	assert.equal(overflow.result.isError, true);
	assert.match(
		resultText(overflow.result),
		/Your input exceeds the context window of this model\.[\s\S]*\nChoose a larger advisor model with \/workflow:advisor\.$/,
	);
	assert.doesNotMatch(resultText(overflow.result), /\btokens?\b/i);
	assert.equal(overflow.result.details.model, "fake/echo");
});

test("an answer with no text is a failure", async (t) => {
	const { result } = await consult(t, { answer: "  \n " });
	assert.deepEqual(failure(result), {
		failure: "empty",
		isError: true,
		text: "The advisor returned no advice.",
	});
});

test("Esc during a consultation stops it with the operator's reason", async (t) => {
	let release;
	t.after(() => release?.("late"));
	const parentRef = {};
	const { result } = await consult(t, {
		answer: () =>
			new Promise((resolve) => {
				release = resolve;
				parentRef.session.abort();
			}),
		prepare: ({ session }) => {
			parentRef.session = session;
		},
	});
	assert.deepEqual(failure(result), {
		failure: "aborted",
		isError: true,
		text: "Advisor consultation stopped by the operator.",
	});
	assert.equal(result.details.model, "fake/echo");
});

test("a running consultation finishes with the model it started with", async (t) => {
	const { result } = await consult(t, {
		answer: async (_body, dir) => {
			await writeAdvisorModel(dir, { ...echoModel, model: "fake/other" });
			seat(withoutAdvisor);
			return "Still advised.";
		},
	});
	assert.equal(result.isError, false);
	assert.equal(resultText(result), "Still advised.");
	assert.deepEqual(result.details, { model: "fake/echo", thinking: "off" });
});
