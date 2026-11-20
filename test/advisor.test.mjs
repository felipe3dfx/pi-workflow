import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { createAdvisor } from "../extensions/advisor.ts";
import { capabilities } from "../extensions/configure.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { parentSession, seat } from "./support/workflow-parent.mjs";

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
