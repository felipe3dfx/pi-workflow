import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

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
import { delegationCases } from "../extensions/delegation-check.ts";
import { createDelegationMode } from "../extensions/workflow-settings.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { classifierRegistry } from "./support/fake-jev.mjs";
import { fakeChildren } from "./support/fake-children.mjs";
import { turnJevRoutingOn, withAgentDirectory } from "./support/jev-routing.mjs";

initTheme("dark", false);

const DOWN = "\x1b[B";
const ESC = "\x1b";

function configExtension(agentDirectory) {
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
	return commands.get("workflow:config");
}

async function driveConfig(command, drive) {
	await command.handler("", {
		hasUI: true,
		mode: "tui",
		ui: {
			notify() {},
			custom: (factory) =>
				new Promise((resolve) => {
					drive(factory(undefined, undefined, undefined, () => resolve()));
				}),
		},
	});
}

const shown = (panel) =>
	panel.render(80).map((line) => stripVTControlCharacters(line));

function focus(panel, label) {
	for (let i = 0; i < 30 && !shown(panel).some((line) => line.startsWith(`→ ${label}`)); i++) {
		panel.handleInput(DOWN);
	}
}

function openApply(panel) {
	focus(panel, "Apply");
	panel.handleInput("\r");
}

async function stored(dir, name) {
	try {
		return JSON.parse(await readFile(join(dir, name), "utf8"));
	} catch {
		return undefined;
	}
}

test("the /workflow:config menu shows the Delegation mode beside Jev routing, opportunistic by default", async (t) => {
	const dir = withAgentDirectory(t);
	let lines;
	await driveConfig(configExtension(dir), (panel) => {
		lines = shown(panel);
		panel.handleInput(ESC);
	});
	const routing = lines.findIndex((line) => /Jev routing\s+off\s*$/.test(line));
	const mode = lines.findIndex((line) => /Delegation mode\s+opportunistic\s*$/.test(line));
	assert.ok(routing > 0);
	assert.equal(mode, routing + 1);
});

test("choosing orchestrator and confirming Apply names the change and persists it for a new process without touching Jev routing", async (t) => {
	const dir = withAgentDirectory(t);
	let review;
	await driveConfig(configExtension(dir), (panel) => {
		focus(panel, "Delegation mode");
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /Delegation mode\s+orchestrator\s*$/.test(line)));
		openApply(panel);
		review = shown(panel);
		focus(panel, "Confirm apply");
		panel.handleInput("\r");
	});
	assert.ok(review.some((line) => /Delegation mode: opportunistic -> orchestrator/.test(line)));
	assert.ok(review.every((line) => !/Jev routing:/.test(line)));
	assert.deepEqual(await stored(dir, "pi-workflow-delegation.json"), {
		schemaVersion: 1,
		delegationMode: "orchestrator",
	});
	assert.equal(await stored(dir, "pi-workflow-routing.json"), undefined);

	const restarted = execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`
			import { initTheme } from "@earendil-works/pi-coding-agent";
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
						const panel = factory(undefined, undefined, undefined, () => {});
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
	assert.match(restarted, /Delegation mode\s+orchestrator\s*$/m);
});

test("choosing orchestrator and cancelling with Esc writes nothing", async (t) => {
	const dir = withAgentDirectory(t);
	await driveConfig(configExtension(dir), (panel) => {
		focus(panel, "Delegation mode");
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /Delegation mode\s+orchestrator\s*$/.test(line)));
		panel.handleInput(ESC);
	});
	assert.equal(await stored(dir, "pi-workflow-delegation.json"), undefined);
});

test("saving Jev routing keeps the Delegation mode, and saving the Delegation mode keeps Jev routing", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(
		join(dir, "pi-workflow-delegation.json"),
		JSON.stringify({ schemaVersion: 1, delegationMode: "orchestrator" }),
	);
	const command = configExtension(dir);
	let review;
	await driveConfig(command, (panel) => {
		focus(panel, "Jev routing");
		panel.handleInput(" ");
		openApply(panel);
		review = shown(panel);
		focus(panel, "Confirm apply");
		panel.handleInput("\r");
	});
	assert.ok(review.every((line) => !/Delegation mode:/.test(line)));
	assert.deepEqual(await stored(dir, "pi-workflow-routing.json"), {
		schemaVersion: 1,
		jevRouting: "on",
	});
	assert.deepEqual(await stored(dir, "pi-workflow-delegation.json"), {
		schemaVersion: 1,
		delegationMode: "orchestrator",
	});

	await driveConfig(command, (panel) => {
		focus(panel, "Delegation mode");
		panel.handleInput(" ");
		openApply(panel);
		focus(panel, "Confirm apply");
		panel.handleInput("\r");
	});
	assert.deepEqual(await stored(dir, "pi-workflow-delegation.json"), {
		schemaVersion: 1,
		delegationMode: "opportunistic",
	});
	assert.deepEqual(await stored(dir, "pi-workflow-routing.json"), {
		schemaVersion: 1,
		jevRouting: "on",
	});
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
	content: [{ type: "text", text: "Lee README.md y dime qué instala" }],
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
	assert.match(instruction, /AGENTS\.md/);
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

for (const routing of ["off", "on"]) {
	test(`with Jev routing ${routing}, opportunistic leaves the model call untouched`, async (t) => {
		const dir = withAgentDirectory(t);
		if (routing === "on") turnJevRoutingOn(dir);
		seat();
		assert.equal(await modelCall(await parentSession(dir)), undefined);

		chooseMode(dir, "opportunistic");
		assert.equal(await modelCall(await parentSession(dir)), undefined);
	});
}

test("orchestrator leaves the model call untouched while child session is not seated", async (t) => {
	const dir = withAgentDirectory(t);
	chooseMode(dir, "orchestrator");
	seat(capabilities.filter((capability) => capability !== "child-session"));
	assert.equal(await modelCall(await parentSession(dir)), undefined);
});

test("orchestrator leaves the model call untouched while a legacy subagent package withholds the child tools", async (t) => {
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

function destinationJev(destination) {
	return classifierRegistry((context) => ({
		answers: {
			specialist: { type: "choice", choice: "explorer", confidence: 0.9, probabilities: {} },
			...(context.questions.destination
				? {
						destination: {
							type: "choice",
							choice: destination,
							confidence: 0.9,
							probabilities: {},
						},
					}
				: {}),
		},
	}));
}

async function jevRequestFor(mode, t) {
	const dir = withAgentDirectory(t);
	turnJevRoutingOn(dir);
	chooseMode(dir, mode);
	seat();
	const session = await parentSession(dir);
	const jev = destinationJev("leave");
	await session.fire(
		"tool_call",
		{ type: "tool_call", toolCallId: "c1", toolName: "read", input: { path: "README.md" } },
		{
			cwd: dir,
			model: { provider: "session", id: "model", reasoning: true },
			thinkingLevel: "medium",
			modelRegistry: {
				getApiKeyForProvider: async () => "typesafe-key",
				getAvailable: () => [],
				...jev.registry,
			},
			sessionManager: {
				getBranch: () => [
					{
						id: "m1",
						type: "message",
						message: { role: "user", content: "Lee README.md y dime qué instala" },
					},
				],
			},
		},
	);
	assert.equal(jev.requests.length, 1);
	return jev.requests[0];
}

test("with Jev routing on, orchestrator gives Jev a stay criterion only for no work or the reserved git and gh operations", async (t) => {
	const opportunistic = await jevRequestFor("opportunistic", t);
	const orchestrator = await jevRequestFor("orchestrator", t);

	assert.match(
		opportunistic.questions.destination.criteria.stay,
		/^The package is small and already understood/,
	);
	const stay = orchestrator.questions.destination.criteria.stay;
	assert.doesNotMatch(stay, /small and already understood/);
	assert.match(stay, /needs no work/);
	assert.match(stay, /conversation, an opinion, or a question about what was already said/);
	assert.match(stay, /only for reserved operations/);
	assert.match(stay, /commit, a push, or opening a pull request/);

	assert.deepEqual(orchestrator.state, opportunistic.state);
	assert.deepEqual(orchestrator.questions.specialist, opportunistic.questions.specialist);
	const { stay: _o, ...otherOpportunistic } = opportunistic.questions.destination.criteria;
	const { stay: _r, ...otherOrchestrator } = orchestrator.questions.destination.criteria;
	assert.deepEqual(otherOrchestrator, otherOpportunistic);
	assert.equal(
		orchestrator.questions.destination.instructions,
		opportunistic.questions.destination.instructions,
	);
});

function spawnContext(cwd, jev) {
	return {
		mode: "tui",
		hasUI: true,
		cwd,
		isProjectTrusted: () => false,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async () => "typesafe-key",
			getAvailable: () => [],
			...jev.registry,
		},
		sessionManager: {
			getBranch: () => [
				{
					id: "m1",
					type: "message",
					message: { role: "user", content: "Lee README.md y dime qué instala" },
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
		spawnContext(worktree, destinationJev("leave")),
	);

	assert.equal(result.details.status, "queued");
	assert.equal(children.created.length, 1);
	const { prompt } = children.created[0].spec;
	assert.ok(prompt.length > 0);
	assert.doesNotMatch(prompt, /Delegation mode/);
	assert.doesNotMatch(prompt, /delegate all work/i);
});

for (const mode of ["opportunistic", "orchestrator"]) {
	test(`in ${mode}, a Jev stay verdict refuses spawn_child`, async (t) => {
		const dir = withAgentDirectory(t);
		const worktree = await gitRepository(dir);
		turnJevRoutingOn(dir);
		chooseMode(dir, mode);
		seat();
		const children = fakeChildren();
		const session = await parentSession(dir, { create: children.create });
		const spawn = session.tools.find((tool) => tool.name === "spawn_child");

		const result = await spawn.execute(
			"call-1",
			{ role: "explore", task: "Commit and push the change." },
			undefined,
			undefined,
			spawnContext(worktree, destinationJev("stay")),
		);

		assert.equal(result.details.status, "refused");
		assert.match(result.content[0].text, /The work stays in this session/);
		assert.equal(children.created.length, 0);
	});
}

function delegationCheckCommand(agentDirectory) {
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
	return commands.get("workflow:delegation-check");
}

const smallAnswer =
	"Esto ya está entendido y es pequeño. Dime aquí, en una frase, qué dice el warning de quedarse en la sesión.";

function orchestratingJev() {
	return classifierRegistry((context) => {
		const request = context.state.user_request;
		const reserved = /commit/.test(request) && /push/.test(request);
		const item = delegationCases.find((candidate) => candidate.userRequest === request);
		const destination =
			reserved
				? "stay"
				: request === smallAnswer
					? "leave"
					: item.expected.action === "decide"
						? "decide"
						: "leave";
		const specialist =
			item?.expected.role === "explore"
				? "explorer"
				: item?.expected.role === "verify"
					? "verifier"
					: "worker";
		return {
			answers: {
				specialist: { type: "choice", choice: specialist, confidence: 0.9, probabilities: {} },
				destination: { type: "choice", choice: destination, confidence: 0.9, probabilities: {} },
			},
		};
	});
}

async function runCheck(mode, t) {
	const dir = withAgentDirectory(t);
	turnJevRoutingOn(dir);
	chooseMode(dir, mode);
	seat();
	const jev = orchestratingJev();
	const notifications = [];
	await delegationCheckCommand(dir).handler("", {
		hasUI: true,
		mode: "tui",
		ui: { notify: (message, level) => notifications.push({ message, level }) },
		cwd: dir,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async () => "typesafe-key",
			getAvailable: () => [],
			...jev.registry,
		},
	});
	assert.equal(notifications.length, 1);
	return { ...notifications[0], lines: notifications[0].message.split("\n"), jev };
}

test("/workflow:delegation-check in orchestrator expects a launch for the small understood answer and stay for a commit and push", async (t) => {
	const { level, lines, jev } = await runCheck("orchestrator", t);

	assert.equal(level, "info", lines.join("\n"));
	assert.ok(lines.every((line) => line.startsWith("pass:")));
	assert.match(
		lines.find((line) => line.startsWith("pass: small understood answer")),
		/action launch/,
	);
	const reserved = jev.requests.find(
		(request) => /commit/.test(request.state.user_request) && /push/.test(request.state.user_request),
	);
	assert.ok(reserved);
	assert.ok(lines.some((line) => /^pass: .*action stay, destination asked yes/.test(line)));
	for (const request of jev.requests) {
		assert.match(request.questions.destination.criteria.stay, /needs no work/);
	}
});

test("/workflow:delegation-check in opportunistic keeps stay as the expectation for the small understood answer", async (t) => {
	const { level, lines, jev } = await runCheck("opportunistic", t);

	assert.equal(level, "error");
	assert.match(
		lines.find((line) => line.startsWith("fail: small understood answer")),
		/action expected stay, got launch/,
	);
	for (const request of jev.requests) {
		assert.match(request.questions.destination.criteria.stay, /small and already understood/);
	}
});

test("in a real Pi session, the run that a child result starts carries the instruction", async (t) => {
	const dir = withAgentDirectory(t);
	const worktree = await gitRepository(dir);
	chooseMode(dir, "orchestrator");
	seat();
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
		[
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
		].map((response) => (context) => {
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

	await session.prompt("Lee README.md y dime qué instala");
	assert.equal(requests.length, 2);
	assert.equal(children.created.length, 1);
	children.created[0].result.resolve("README.md installs the harness.");
	for (let i = 0; i < 200 && requests.length < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	assert.equal(requests.length, 3);
	const woken = requests[2];
	assert.match(JSON.stringify(woken.messages.slice(1)), /README\.md installs the harness\./);
	const [system] = woken.messages;
	assert.equal(system.role, "system");
	assert.ok(system.toolsAdded.some((tool) => tool.name === "spawn_child"));
	assert.ok(
		Object.values(system.sections).some((section) => /delegate all work to child sessions/i.test(section)),
	);
});
