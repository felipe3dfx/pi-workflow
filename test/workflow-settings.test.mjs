import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { createChildLauncher } from "../extensions/child-launcher.ts";
import {
	companionMetadataPath,
	loadCompanionsFromPath,
} from "../extensions/companion-workflow.ts";
import { capabilities, readSelection } from "../extensions/configure.ts";
import { createJevRouting } from "../extensions/workflow-settings.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { occupants, replaceSelection, seated } from "../extensions/shell.ts";
import { classifierRegistry } from "./support/fake-jev.mjs";
import { withAgentDirectory } from "./support/jev-routing.mjs";

initTheme("dark", false);

function extension(commands, notifications, agentDirectory) {
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
	return {
		command: commands.get("workflow:config"),
		commands,
		notify: (message, level) => notifications.push({ message, level }),
	};
}

function launcherContext(cwd, jev) {
	return {
		cwd,
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
					type: "message",
					message: { role: "user", content: "Map the source" },
				},
			],
		},
	};
}

const DOWN = "\x1b[B";
const ESC = "\x1b";

async function driveConfig(command, notify, drive) {
	let panel;
	await command.handler("", {
		hasUI: true,
		mode: "tui",
		ui: {
			notify,
			custom: (factory) =>
				new Promise((resolve) => {
					panel = factory(undefined, undefined, undefined, () => resolve());
					drive(panel);
				}),
		},
	});
	return panel;
}

const shown = (panel) =>
	panel.render(60).map((line) => stripVTControlCharacters(line));

function focusRouting(panel) {
	for (let i = 0; i < capabilities.length; i++) panel.handleInput(DOWN);
}

function focus(panel, label) {
	for (let i = 0; i < 20 && !shown(panel).some((line) => line.startsWith(`→ ${label}`)); i++) {
		panel.handleInput(DOWN);
	}
}

function openApply(panel) {
	focus(panel, "Apply");
	panel.handleInput("\r");
}

function confirmApply(panel) {
	openApply(panel);
	focus(panel, "Confirm apply");
	panel.handleInput("\r");
}

async function storedRouting(dir) {
	try {
		return JSON.parse(await readFile(join(dir, "pi-workflow-routing.json"), "utf8"));
	} catch {
		return undefined;
	}
}

test("/workflow:config rejects the settings argument and unknown arguments, and needs the TUI", async () => {
	const notifications = [];
	const { command, commands, notify } = extension(new Map(), notifications);
	assert.match(command.description, /Jev routing/);
	assert.equal(command.getArgumentCompletions, undefined);
	assert.equal(commands.has("workflow:settings"), false);
	assert.equal(commands.has("workflow:configure"), false);

	for (const args of ["--force", "settings"]) {
		await command.handler(args, { hasUI: true, mode: "tui", ui: { notify } });
		assert.equal(notifications.at(-1).level, "error");
		assert.match(notifications.at(-1).message, /Usage: .*\/workflow:config \|/);
		assert.doesNotMatch(notifications.at(-1).message, /settings\]/);
	}

	await command.handler("", { hasUI: true, mode: "print", ui: { notify } });
	assert.equal(notifications.at(-1).level, "error");
	assert.match(notifications.at(-1).message, /needs the TUI/);
});

test("the /workflow:config menu shows the stored Jev routing after the capabilities", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(
		join(dir, "pi-workflow-routing.json"),
		JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
	);
	const { command, notify } = extension(new Map(), [], dir);
	let lines;
	await driveConfig(command, notify, (panel) => {
		lines = shown(panel);
		panel.handleInput(ESC);
	});
	const routing = lines.findIndex((line) => /Jev routing\s+on\s*$/.test(line));
	assert.ok(routing > 0);
	assert.ok(lines.findIndex((line) => /Compact rendering/.test(line)) < routing);
});

test("toggling Jev routing and confirming Apply persists it for a new process and leaves the model profiles alone", async (t) => {
	const dir = withAgentDirectory(t);
	const profilesPath = join(dir, "pi-workflow-models.json");
	const profiles =
		'{"schemaVersion":2,"active":"default","profiles":{"default":{}}}\n';
	await writeFile(profilesPath, profiles);
	const { command, notify } = extension(new Map(), [], dir);
	let review;
	await driveConfig(command, notify, (panel) => {
		focusRouting(panel);
		assert.ok(shown(panel).some((line) => /Jev routing\s+off\s*$/.test(line)));
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /Jev routing\s+on\s*$/.test(line)));
		openApply(panel);
		review = shown(panel);
		focus(panel, "Confirm apply");
		panel.handleInput("\r");
	});
	assert.equal(
		review.findIndex((line) => /Jev routing: off -> on/.test(line)),
		0,
	);
	assert.deepEqual(await storedRouting(dir), { schemaVersion: 1, jevRouting: "on" });
	assert.equal(await readFile(profilesPath, "utf8"), profiles);

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
						for (const line of panel.render(60)) console.log(stripVTControlCharacters(line));
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
	assert.match(restarted, /Jev routing\s+on\s*$/m);
});

test("toggling Jev routing and cancelling with Esc writes nothing", async (t) => {
	const dir = withAgentDirectory(t);
	const { command, notify } = extension(new Map(), [], dir);
	await driveConfig(command, notify, (panel) => {
		focusRouting(panel);
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /Jev routing\s+on\s*$/.test(line)));
		panel.handleInput(ESC);
	});
	assert.equal(await storedRouting(dir), undefined);
});

test("the Apply review omits Jev routing when it is unchanged", async (t) => {
	const dir = withAgentDirectory(t);
	const { command, notify } = extension(new Map(), [], dir);
	let review;
	await driveConfig(command, notify, (panel) => {
		focusRouting(panel);
		panel.handleInput(" ");
		panel.handleInput(" ");
		openApply(panel);
		review = shown(panel);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.ok(review.some((line) => /Does not uninstall packages/.test(line)));
	assert.ok(review.every((line) => !/Jev routing:/.test(line)));
});

test("turning Jev routing off in the menu gates a launch on the stored choice", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(
		join(dir, "pi-workflow-routing.json"),
		JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
	);
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	const { command, notify } = extension(new Map(), [], dir);
	await driveConfig(command, notify, (p) => {
		focusRouting(p);
		p.handleInput(" ");
		assert.ok(shown(p).some((line) => /Jev routing\s+off\s*$/.test(line)));
		confirmApply(p);
	});
	assert.deepEqual(await storedRouting(dir), { schemaVersion: 1, jevRouting: "off" });

	const jev = classifierRegistry(() => ({}));
	const launcher = createChildLauncher({
		modelProfiles: { load: () => ({ status: "absent" }) },
		jevRouting: createJevRouting(dir),
	});
	const ctx = launcherContext(worktree, jev);
	assert.deepEqual(
		await launcher.gateToolCall(
			{ toolName: "grep", input: { pattern: "source" } },
			ctx,
		),
		{ allow: true },
	);
	const missingRole = await launcher.prepareLaunch(
		{ task: "Map the source", userRequest: "Map the source" },
		ctx,
	);
	assert.equal(missingRole.kind, "stay");
	assert.equal(missingRole.reason, "Jev routing is off.");
	assert.equal(jev.requests.length, 0);
});

test("with Jev routing off, a message naming implement neither calls Jev nor launches a worker", async (t) => {
	const dir = withAgentDirectory(t);
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	const jev = classifierRegistry(() => ({}));
	const launcher = createChildLauncher({
		modelProfiles: { load: () => ({ status: "absent" }) },
		jevRouting: createJevRouting(dir),
	});
	const message = "implement the toggle";
	const ctx = {
		...launcherContext(worktree, jev),
		sessionManager: {
			getBranch: () => [
				{ type: "message", message: { role: "user", content: message } },
			],
		},
	};

	assert.deepEqual(
		await launcher.gateToolCall(
			{ toolName: "edit", input: { path: "src/toggle.ts" } },
			ctx,
		),
		{ allow: true },
	);
	const decided = await launcher.prepareLaunch(
		{ task: "Implement the toggle", userRequest: message },
		ctx,
	);
	assert.equal(decided.kind, "stay");
	assert.equal(decided.reason, "Jev routing is off.");
	assert.equal(jev.requests.length, 0);
});

for (const [label, write] of [
	["absent", async () => {}],
	["unreadable", (path) => mkdir(path)],
	["not JSON", (path) => writeFile(path, "{ on")],
	[
		"an unknown value",
		(path) =>
			writeFile(path, JSON.stringify({ schemaVersion: 1, jevRouting: "yes" })),
	],
	[
		"an unknown schema",
		(path) =>
			writeFile(path, JSON.stringify({ schemaVersion: 2, jevRouting: "on" })),
	],
]) {
	test(`Jev routing is off without asking Jev when the choice document is ${label}`, async (t) => {
		const dir = withAgentDirectory(t);
		await write(join(dir, "pi-workflow-routing.json"));
		const worktree = join(dir, "repo");
		await mkdir(worktree);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		const jev = classifierRegistry(() => ({}));
		const launcher = createChildLauncher({
			modelProfiles: { load: () => ({ status: "absent" }) },
			jevRouting: createJevRouting(dir),
		});
		const ctx = launcherContext(worktree, jev);

		assert.deepEqual(
			await launcher.gateToolCall(
				{ toolName: "grep", input: { pattern: "source" } },
				ctx,
			),
			{ allow: true },
		);
		const launch = await launcher.prepareLaunch(
			{ task: "Map the source", userRequest: "Map the source" },
			ctx,
		);
		assert.equal(launch.kind, "stay");
		assert.equal(launch.reason, "Jev routing is off.");
		assert.doesNotMatch(launch.warning, /Launch blocked/);
		assert.equal(jev.requests.length, 0);
	});
}

test("Jev routing follows its document in the injected directory on each read", async (t) => {
	const dir = withAgentDirectory(t);
	const path = join(dir, "pi-workflow-routing.json");
	const jevRouting = createJevRouting(dir);
	assert.equal(jevRouting.enabled(), false);

	jevRouting.set(true);
	assert.equal(jevRouting.enabled(), true);

	await writeFile(path, "{ corrupt");
	assert.equal(jevRouting.enabled(), false);

	await writeFile(path, JSON.stringify({ schemaVersion: 1, jevRouting: "on" }));
	assert.equal(jevRouting.enabled(), true);

	await rm(path);
	assert.equal(jevRouting.enabled(), false);
});

test("/workflow:status and /workflow:doctor report unsupported arguments without UI", async () => {
	const notifications = [];
	const { commands, notify } = extension(new Map(), notifications);
	const originalError = console.error;
	const errors = [];
	console.error = (message) => errors.push(message);
	try {
		for (const name of ["workflow:status", "workflow:doctor"]) {
			await commands.get(name).handler("--force", { hasUI: false, mode: "print", ui: { notify } });
		}
	} finally {
		console.error = originalError;
	}
	assert.deepEqual(notifications, []);
	assert.equal(errors.length, 2);
	assert.ok(errors.every((message) => message.startsWith("Usage: /workflow:status")));
});

const companionNames = loadCompanionsFromPath(companionMetadataPath).companions.map(
	(companion) => companion.package,
);

function selectionWith(on) {
	const read = readSelection(undefined, companionNames);
	for (const capability of capabilities) {
		read.selection.capabilities[capability] = on.includes(capability);
	}
	return read.selection;
}

function seatedNames() {
	const names = new Set();
	for (const place of ["header", "above-input", "overlay", "message-stream"]) {
		for (const capability of occupants(place)) names.add(capability);
	}
	return [...names].sort();
}

function seatOnly(t, on) {
	replaceSelection(selectionWith(on));
	t.after(() => replaceSelection(selectionWith([])));
}

const selectionFile = (dir) => join(dir, "pi-workflow-selection.json");

test("closing /workflow:config without confirming changes neither the seating nor the disk", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	await driveConfig(command, notify, (panel) => panel.handleInput(ESC));
	assert.deepEqual(seatedNames(), ["todo"]);
	assert.deepEqual(
		JSON.parse(await readFile(selectionFile(dir), "utf8")),
		selectionWith(["codegraph"]),
	);
});

test("the /workflow:config guide opens from the selection on disk, not the seated one", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	let lines;
	await driveConfig(command, notify, (panel) => {
		lines = shown(panel);
		panel.handleInput(ESC);
	});
	assert.ok(lines.some((line) => /CodeGraph\s+on\s*$/.test(line)));
	assert.ok(lines.some((line) => /Todo\s+off\s*$/.test(line)));
});

test("the Apply plan compares against the seated selection", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph", "todo"])));
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	let review;
	await driveConfig(command, notify, (panel) => {
		openApply(panel);
		review = shown(panel);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.ok(review.some((line) => /Seat codegraph/.test(line)));
	assert.ok(review.every((line) => !/(Seat|Unseat) todo/.test(line)));
});

test("on a fresh installation the first plan seats each capability that is on", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
	seatOnly(t, []);
	const { command, notify } = extension(new Map(), [], dir);
	let review;
	await driveConfig(command, notify, (panel) => {
		openApply(panel);
		review = shown(panel);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.ok(review.some((line) => /Seat codegraph/.test(line)));
	assert.ok(review.every((line) => !/Seat todo/.test(line)));
});

test("an unreadable selection reports the error and does not open the guide", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), "{nope");
	const notifications = [];
	const { command, notify } = extension(new Map(), notifications, dir);
	let opened = false;
	await command.handler("", {
		hasUI: true,
		mode: "tui",
		ui: {
			notify,
			custom: async () => {
				opened = true;
			},
		},
	});
	assert.equal(opened, false);
	assert.deepEqual(notifications, [
		{ message: "Selection is not valid JSON.", level: "error" },
	]);
});

test("a failed selection write on confirm stops before seating", async (t) => {
	const dir = withAgentDirectory(t);
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	await assert.rejects(
		driveConfig(command, notify, (panel) => {
			mkdirSync(selectionFile(dir));
			confirmApply(panel);
		}),
	);
	assert.deepEqual(seatedNames(), ["todo"]);
	assert.equal(seated("todo", "above-input"), true);
});
