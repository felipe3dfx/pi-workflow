import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { capabilities } from "../extensions/configure.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { createDelegationMode } from "../extensions/workflow-settings.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { fakeChildren } from "./support/fake-children.mjs";
import {
	body as shown,
	driveConfig,
	focusOn,
	keys,
	newKeybindings,
	plainTheme,
	press,
} from "./support/config-guide.mjs";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { assertSentence } from "./support/sentence.mjs";

initTheme("dark", false);

const ESC = "\x1b";

function extensionCommand(agentDirectory, name) {
	const commands = new Map();
	piWorkflowExtension(
		{
			on() {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			sendMessage() {},
		},
		{ agentDirectory },
	);
	return commands.get(name);
}

const focus = focusOn;

function openApply(panel) {
	press(panel, keys.tab, keys.enter);
}

async function stored(dir, name) {
	try {
		return JSON.parse(await readFile(join(dir, name), "utf8"));
	} catch {
		return undefined;
	}
}

test("the /workflow:config menu shows the Delegation mode in its own section, opportunistic by default", async (t) => {
	const dir = withAgentDirectory(t);
	let lines;
	await driveConfig(extensionCommand(dir, "workflow:config"), (panel) => {
		lines = shown(panel);
		panel.handleInput(ESC);
	});
	const section = lines.findIndex((line) => /^Delegation ─+$/.test(line));
	const mode = lines.findIndex((line) => /^Delegation mode\s+‹ opportunistic ›$/.test(line));
	assert.ok(section > 0);
	assert.equal(mode, section + 1);
});

test("orchestrator with the child tools off is accepted by Apply and reports no error", async (t) => {
	const dir = withAgentDirectory(t);
	const notifications = [];
	let review;
	await extensionCommand(dir, "workflow:config").handler("", {
		hasUI: true,
		mode: "tui",
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			custom: (factory) =>
				new Promise((resolve) => {
					const panel = factory({ requestRender() {}, terminal: { rows: 40 } }, plainTheme, newKeybindings(), () => resolve());
					focus(panel, "Child session");
					panel.handleInput(" ");
					focus(panel, "Delegation mode");
					panel.handleInput(" ");
					openApply(panel);
					review = shown(panel);
					panel.handleInput("\r");
				}),
		},
	});
	assert.ok(review.some((line) => /^Delegation mode\s+opportunistic → orchestrator$/.test(line)));
	assert.deepEqual(await stored(dir, "pi-workflow-delegation.json"), {
		schemaVersion: 1,
		delegationMode: "orchestrator",
	});
	assert.equal((await stored(dir, "pi-workflow-selection.json")).capabilities["child-session"], false);
	assert.ok(notifications.every((entry) => entry.level !== "error"));
});

test("choosing orchestrator and confirming Apply names the change and persists it for a new process", async (t) => {
	const dir = withAgentDirectory(t);
	let review;
	await driveConfig(extensionCommand(dir, "workflow:config"), (panel) => {
		focus(panel, "Delegation mode");
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /^▸\s+Delegation mode\s+‹ orchestrator ›\s+•$/.test(line)));
		openApply(panel);
		review = shown(panel);
		panel.handleInput("\r");
	});
	assert.ok(review.some((line) => /^Delegation mode\s+opportunistic → orchestrator$/.test(line)));
	assert.deepEqual(await stored(dir, "pi-workflow-delegation.json"), {
		schemaVersion: 1,
		delegationMode: "orchestrator",
	});

	const restarted = execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
			import { initTheme } from "@earendil-works/pi-coding-agent";
			import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
			import { stripVTControlCharacters } from "node:util";
			import piWorkflowExtension from ${JSON.stringify(new URL("../extensions/pi-workflow.ts", import.meta.url).href)};
			initTheme("dark", false);
			const commands = new Map();
			piWorkflowExtension({
				on() {},
				exec: async () => ({ code: 0 }),
				registerCommand: (name, command) => commands.set(name, command),
				registerTool() {},
				registerShortcut() {},
				registerMessageRenderer() {},
				registerToolRenderer() {},
				registerProvider() {},
				sendMessage() {},
			});
			await commands.get("workflow:config").handler("", {
				hasUI: true,
				mode: "tui",
				ui: {
					notify() {},
					custom: async (factory) => {
						const plain = { fg: (_c, text) => text, bg: (_c, text) => text, bold: (text) => text };
						const panel = factory({ terminal: { rows: 40 } }, plain, new KeybindingsManager(TUI_KEYBINDINGS), () => {});
						for (const line of panel.render(80)) console.log(stripVTControlCharacters(line));
					},
				},
			});
			`,
		],
		{
			cwd: new URL("..", import.meta.url),
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			encoding: "utf8",
		},
	);
	assert.match(restarted, /Delegation mode\s+‹ orchestrator ›\s+│$/m);
});

test("choosing orchestrator and cancelling with Esc writes nothing", async (t) => {
	const dir = withAgentDirectory(t);
	await driveConfig(extensionCommand(dir, "workflow:config"), (panel) => {
		focus(panel, "Delegation mode");
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /^▸\s+Delegation mode\s+‹ orchestrator ›\s+•$/.test(line)));
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.equal(await stored(dir, "pi-workflow-delegation.json"), undefined);
});

for (const [label, write] of [
	["absent", async () => {}],
	["unreadable", (path) => mkdir(path)],
	["not JSON", (path) => writeFile(path, "{ orchestrator")],
	[
		"an unknown value",
		(path) =>
			writeFile(path, JSON.stringify({ schemaVersion: 1, delegationMode: "parent" })),
	],
	[
		"an unknown schema",
		(path) =>
			writeFile(path, JSON.stringify({ schemaVersion: 2, delegationMode: "orchestrator" })),
	],
]) {
	test(`the Delegation mode reads as opportunistic when its document is ${label}`, async (t) => {
		const dir = withAgentDirectory(t);
		await write(join(dir, "pi-workflow-delegation.json"));
		assert.equal(createDelegationMode(dir).current(), "opportunistic");
	});
}

test("the Delegation mode follows its document on each read", async (t) => {
	const dir = withAgentDirectory(t);
	const mode = createDelegationMode(dir);
	mode.set("orchestrator");
	assert.equal(mode.current(), "orchestrator");
	await writeFile(join(dir, "pi-workflow-delegation.json"), "{ corrupt");
	assert.equal(mode.current(), "opportunistic");
});

function seat(on = capabilities) {
	replaceSelection({
		schemaVersion: 1,
		capabilities: Object.fromEntries(
			capabilities.map((capability) => [capability, on.includes(capability)]),
		),
		expectations: {},
	});
}

function chooseMode(dir, mode) {
	createDelegationMode(dir).set(mode);
}

async function parentSession(agentDirectory, { legacy = false, create } = {}) {
	const handlers = new Map();
	const tools = [];
	const ui = {
		notify() {},
		setWidget() {},
		setStatus() {},
		setHeader() {},
		setFooter() {},
		setEditorComponent() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setWorkingMessage() {},
	};
	piWorkflowExtension(
		{
			on(event, handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			registerTool: (tool) => tools.push(tool),
			sendMessage() {},
			appendEntry() {},
			exec: async () => {
				throw new Error("must not run commands");
			},
		},
		{
			catalog: {
				resolveInstalledVersion: (name) =>
					legacy && name === "@tintinweb/pi-subagents" ? { version: "2.0.0" } : {},
			},
			agentDirectory,
			childSessions: create ? { create } : undefined,
		},
	);
	const fire = async (event, payload = {}, ctx = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? []) {
			result = await handler(payload, ctx);
		}
		return result;
	};
	await fire("session_start", {}, {
		mode: "print",
		hasUI: true,
		ui,
		cwd: agentDirectory,
		sessionManager: { getBranch: () => [], getEntries: () => [] },
	});
	return { fire, tools };
}

const systemMessage = {
	role: "system",
	content: "Base prompt.",
	sections: { cwd: "Current directory: /work" },
	toolsAdded: [
		{ name: "read", description: "Read a file.", parameters: { type: "object" } },
	],
	timestamp: 1,
};
const userMessage = {
	role: "user",
	content: [{ type: "text", text: "Read README.md and tell me what it installs" }],
	timestamp: 2,
};

function modelCall(session) {
	return session.fire("context_with_system", {
		type: "context_with_system",
		messages: [structuredClone(systemMessage), structuredClone(userMessage)],
	});
}

function instructionOf(result) {
	assert.ok(result, "the model call carries no instruction");
	const [system, ...rest] = result.messages;
	assert.equal(system.role, "system");
	assert.equal(system.content, systemMessage.content);
	assert.deepEqual(system.toolsAdded, systemMessage.toolsAdded);
	assert.equal(system.sections.cwd, systemMessage.sections.cwd);
	assert.deepEqual(rest, [userMessage]);
	const added = Object.entries(system.sections).filter(([name]) => name !== "cwd");
	assert.equal(added.length, 1);
	return added[0][1];
}

test("in orchestrator with the child tools, the parent's leading system message carries the instruction to delegate all work", async (t) => {
	const dir = withAgentDirectory(t);
	chooseMode(dir, "orchestrator");
	seat();
	const instruction = instructionOf(await modelCall(await parentSession(dir)));

	assert.match(instruction, /delegate all work to child sessions/i);
	assert.match(instruction, /reading included/i);
	assert.match(instruction, /git and gh/);
	assert.match(instruction, /commit/);
	assert.match(instruction, /except the signed checkpoint commits of a worker you grant checkpoint in an isolated worktree you created, which you verify before you integrate them/);
	assert.match(instruction, /AGENTS\.md/);
	assert.doesNotMatch(instruction, /bounded discovery/);
	assert.match(instruction, /GLOSSARY\.md, and docs\/agents/);
	assert.match(instruction, /todo/);
	assert.match(instruction, /ask_user_question/);
	assert.match(instruction, /refused/i);
	assert.match(instruction, /tell the operator why/i);
});

test("the instruction names the Todo and operator questions only when each is seated", async (t) => {
	const dir = withAgentDirectory(t);
	chooseMode(dir, "orchestrator");
	seat(["child-session"]);
	const bare = instructionOf(await modelCall(await parentSession(dir)));
	assert.match(bare, /delegate all work to child sessions/i);
	assert.doesNotMatch(bare, /todo/i);
	assert.doesNotMatch(bare, /ask_user/);

	seat(["child-session", "todo"]);
	const withTodo = instructionOf(await modelCall(await parentSession(dir)));
	assert.match(withTodo, /todo/);
	assert.doesNotMatch(withTodo, /ask_user/);
});

test("opportunistic adds no Delegation mode instruction", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	assert.equal(await modelCall(await parentSession(dir)), undefined);

	chooseMode(dir, "opportunistic");
	assert.equal(await modelCall(await parentSession(dir)), undefined);
});

test("orchestrator adds no Delegation mode instruction while child session is not seated", async (t) => {
	const dir = withAgentDirectory(t);
	chooseMode(dir, "orchestrator");
	seat(capabilities.filter((capability) => capability !== "child-session"));
	assert.equal(await modelCall(await parentSession(dir)), undefined);
});

test("orchestrator adds no Delegation mode instruction while a legacy subagent package withholds the child tools", async (t) => {
	const dir = withAgentDirectory(t);
	chooseMode(dir, "orchestrator");
	seat();
	const session = await parentSession(dir, { legacy: true });
	assert.equal(session.tools.some((tool) => tool.name === "spawn_child"), false);
	assert.equal(await modelCall(session), undefined);
});

test("a Delegation mode change applies from the next model call of the same session", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const session = await parentSession(dir);
	assert.equal(await modelCall(session), undefined);

	chooseMode(dir, "orchestrator");
	assert.match(instructionOf(await modelCall(session)), /delegate all work/i);

	chooseMode(dir, "opportunistic");
	assert.equal(await modelCall(session), undefined);
});

function spawnContext(cwd) {
	return {
		mode: "tui",
		hasUI: true,
		cwd,
		isProjectTrusted: () => false,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: { getAvailable: () => [] },
		sessionManager: {
			getBranch: () => [
				{
					id: "m1",
					type: "message",
					message: { role: "user", content: "Read README.md and tell me what it installs" },
				},
			],
		},
	};
}

async function gitRepository(dir) {
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	return worktree;
}

test("in orchestrator, the prompt the child session factory receives never carries the instruction", async (t) => {
	const dir = withAgentDirectory(t);
	const worktree = await gitRepository(dir);
	chooseMode(dir, "orchestrator");
	seat();
	const children = fakeChildren();
	const session = await parentSession(dir, { create: children.create });
	const spawn = session.tools.find((tool) => tool.name === "spawn_child");
	assert.ok(instructionOf(await modelCall(session)));

	const result = await spawn.execute(
		"call-1",
		{ role: "explore", task: "Read README.md and report what it installs." },
		undefined,
		undefined,
		spawnContext(worktree),
	);

	assert.equal(result.details.status, "queued");
	assert.equal(children.created.length, 1);
	const { prompt } = children.created[0].spec;
	assert.ok(prompt.length > 0);
	assert.doesNotMatch(prompt, /Delegation mode/);
	assert.doesNotMatch(prompt, /delegate all work/i);
});

const noStandInLine =
	/^Do not stand in for the child with another agent process, such as Pi or another model CLI started from the shell\. Tell the operator that no child ran and why; any work you then do yourself is yours, not a child's or an independent agent's\.$/m;

for (const mode of ["opportunistic", "orchestrator"]) {
	test(`in ${mode}, a spawn_child refused by a Pi version mismatch tells the parent not to stand in for the child`, async (t) => {
		const dir = withAgentDirectory(t);
		const worktree = await gitRepository(dir);
		chooseMode(dir, mode);
		seat();
		const children = fakeChildren({
			onCreate: () => {
				throw new Error("The Pi on PATH at /x/pi is version 1.3.9, but a child requires Pi >=1.4.0.");
			},
		});
		const session = await parentSession(dir, { create: children.create });
		const spawn = session.tools.find((tool) => tool.name === "spawn_child");

		const result = await spawn.execute(
			"call-1",
			{ role: "explore", task: "Read README.md and report what it installs." },
			undefined,
			undefined,
			spawnContext(worktree),
		);

		const text = result.content[0].text;
		assert.equal(result.details.status, "refused");
		assert.match(text, /Launch refused\. No child was launched\./);
		assert.match(text, /version 1\.3\.9, but a child requires Pi >=1\.4\.0\./);
		assert.match(text, noStandInLine);
		assert.equal(children.created.length, 0);
	});

	test(`in ${mode}, a continue_child refused for an unknown child tells the parent not to stand in for the child`, async (t) => {
		const dir = withAgentDirectory(t);
		const worktree = await gitRepository(dir);
		chooseMode(dir, mode);
		seat();
		const children = fakeChildren();
		const session = await parentSession(dir, { create: children.create });
		const resume = session.tools.find((tool) => tool.name === "continue_child");

		const result = await resume.execute(
			"call-1",
			{ id: "nope", task: "Try again" },
			undefined,
			undefined,
			spawnContext(worktree),
		);

		const text = result.content[0].text;
		assert.equal(result.details.status, "refused");
		assert.match(text, /Continue refused\. No child was launched\./);
		assert.match(text, noStandInLine);
		assert.equal(children.created.length, 0);
	});
}

async function realParent(t, dir, responses) {
	const worktree = await gitRepository(dir);
	const runtime = await ModelRuntime.create({
		authPath: join(dir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "faux", models: [{ id: "parent", reasoning: true }] });
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey("faux", "key");
	const requests = [];
	faux.setResponses(
		responses.map((response) => (context) => {
			requests.push(structuredClone(context));
			return response;
		}),
	);
	const children = fakeChildren();
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: worktree,
		agentDir: dir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
		extensionFactories: [
			(pi) =>
				piWorkflowExtension(pi, {
					agentDirectory: dir,
					catalog: { resolveInstalledVersion: () => ({}) },
					childSessions: { create: children.create },
				}),
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: worktree,
		agentDir: dir,
		modelRuntime: runtime,
		model: faux.getModel(),
		thinkingLevel: "high",
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.inMemory(worktree),
	});
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "rpc" });
	return { session, requests, children };
}

const spawnThenWait = () => [
	fauxAssistantMessage(
		fauxToolCall(
			"spawn_child",
			{ role: "explore", task: "Read README.md and report what it installs." },
			{ id: "spawn" },
		),
		{ stopReason: "toolUse" },
	),
	fauxAssistantMessage("Waiting for the child."),
	fauxAssistantMessage("It installs the harness."),
];

async function wakeByChildResult({ session, requests, children }) {
	await session.prompt("Read README.md and tell me what it installs");
	assert.equal(requests.length, 2);
	assert.equal(children.created.length, 1);
	children.created[0].result.resolve("README.md installs the harness.");
	for (let i = 0; i < 200 && requests.length < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(requests.length, 3);
}

test("in a real Pi session, the run that a child result starts carries the instruction", async (t) => {
	const dir = withAgentDirectory(t);
	chooseMode(dir, "orchestrator");
	seat();
	const parent = await realParent(t, dir, spawnThenWait());
	await wakeByChildResult(parent);
	const { requests } = parent;

	const woken = requests[2];
	assert.match(JSON.stringify(woken.messages.slice(1)), /README\.md installs the harness\./);
	const [system] = woken.messages;
	const injected = JSON.stringify(system);
	assert.ok(injected.includes("read it when delegation mode allows, otherwise delegate its discovery"));
	assert.ok(injected.includes("An unmet mandatory prerequisite stops dependent work"));
	assert.ok(injected.includes("reconcile left_undone and unverified against the remaining obligations"));

	assert.equal(system.role, "system");
	assert.ok(system.toolsAdded.some((tool) => tool.name === "spawn_child"));
	assert.ok(delegationInstructed(woken));
});

function languageInstruction(request) {
	const [system] = request.messages;
	assert.equal(system.role, "system");
	const found = Object.values(system.sections).filter(
		(section) => /\bEnglish\b/.test(section) && /\buser's language\b/.test(section),
	);
	assert.equal(found.length, 1, "the model call carries no language instruction");
	return found[0];
}

function delegationInstructed(request) {
	return Object.values(request.messages[0].sections).some((section) =>
		/delegate all work to child sessions/i.test(section),
	);
}

test("the language instruction keeps parent-child text English, the user's language with the user, and transported content as it is", async (t) => {
	const dir = withAgentDirectory(t);
	seat();
	const parent = await realParent(t, dir, [fauxAssistantMessage("Hello.")]);
	await parent.session.prompt("Explain what the README installs");
	const instruction = languageInstruction(parent.requests[0]);
	const sentence = (...patterns) => assertSentence(instruction, ...patterns);

	sentence(/\buser's language\b/, /\bexplicit user instruction\b/, /\bchild sessions never change it\b/);
	sentence(/\bEnglish\b/, /\bspawn_child\b/, /\bcontinue_child\b/, /\breply_child\b/, /\bconsultation reply\b/);
	sentence(/\bchild questions and conclusions\b/, /\buser's language\b/, /\buser's decisions to children in English\b/);
	sentence(/\bcode, identifiers, tool outputs, quotations,? and artifacts\b/, /\bnever translate stable JSON keys, enum values, or identifiers\b/, /\bref, kind, and confirm\b/);
	sentence(/\bFleet view\b/, /\bSteer\b/, /\bunchanged\b/);
	assert.doesNotMatch(instruction, /delegate all work/i);
});

for (const mode of ["opportunistic", "orchestrator"]) {
	for (const offered of [true, false]) {
		test(`in ${mode} with the child tools ${offered ? "offered" : "not offered"}, every parent model call carries the language instruction and the Delegation mode section keeps its conditions`, async (t) => {
			const dir = withAgentDirectory(t);
			chooseMode(dir, mode);
			seat(offered ? capabilities : capabilities.filter((capability) => capability !== "child-session"));
			const parent = await realParent(t, dir, [fauxAssistantMessage("Hello."), fauxAssistantMessage("Sure.")]);

			await parent.session.prompt("Hello");
			await parent.session.prompt("Now in English, please");

			assert.equal(parent.requests.length, 2);
			for (const request of parent.requests) {
				languageInstruction(request);
				assert.equal(
					request.messages[0].toolsAdded.some((tool) => tool.name === "spawn_child"),
					offered,
				);
				assert.equal(delegationInstructed(request), mode === "orchestrator" && offered);
			}
		});
	}
	test(`in ${mode}, every model call of a run a child result starts carries the language instruction`, async (t) => {
		const dir = withAgentDirectory(t);
		chooseMode(dir, mode);
		seat();
		const parent = await realParent(t, dir, spawnThenWait());
		await wakeByChildResult(parent);
		for (const request of parent.requests) {
			languageInstruction(request);
			assert.equal(delegationInstructed(request), mode === "orchestrator");
		}
	});
}
