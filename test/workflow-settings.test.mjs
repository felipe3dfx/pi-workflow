import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getAgentDir, initTheme } from "@earendil-works/pi-coding-agent";

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
import { installedPackagePath } from "./support/child-session.mjs";
import {
	body as shown,
	driveConfig as drive_,
	focusOn,
	keys,
	press,
	title,
} from "./support/config-guide.mjs";
import { withAgentDirectory } from "./support/jev-routing.mjs";

initTheme("dark", false);

function extension(commands, notifications, agentDirectory, catalog, exec = async () => ({ code: 0 })) {
	piWorkflowExtension(
		{
			on() {},
			exec,
			registerCommand: (name, command) => commands.set(name, command),
			registerTool() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			registerToolRenderer() {},
			registerProvider() {},
			sendMessage() {},
		},
		{ agentDirectory, catalog },
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

const ESC = "\x1b";

const driveConfig = (command, notify, drive) =>
	drive_(command, drive, { notify });

function focusRouting(panel) {
	focusOn(panel, "Jev routing");
}

const focus = focusOn;

function openApply(panel) {
	press(panel, keys.tab, keys.enter);
}

function confirmApply(panel) {
	openApply(panel);
	press(panel, keys.enter);
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
	const routing = lines.findIndex((line) => /^\[x\] Jev routing$/.test(line));
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
		assert.ok(shown(panel).some((line) => /^(▸ )?\[ \] Jev routing\s*$/.test(line)));
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /^(▸ )?\[x\] Jev routing\s+•$/.test(line)));
		openApply(panel);
		review = shown(panel);
		focus(panel, "Confirm apply");
		panel.handleInput("\r");
	});
	assert.ok(review.some((line) => /^Jev routing\s+off → on$/.test(line)));
	assert.deepEqual(await storedRouting(dir), { schemaVersion: 1, jevRouting: "on" });
	assert.equal(await readFile(profilesPath, "utf8"), profiles);

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
	assert.match(restarted, /\[x\] Jev routing\s+│$/m);
});

test("toggling Jev routing and cancelling with Esc writes nothing", async (t) => {
	const dir = withAgentDirectory(t);
	const { command, notify } = extension(new Map(), [], dir);
	await driveConfig(command, notify, (panel) => {
		focusRouting(panel);
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /^(▸ )?\[x\] Jev routing\s+•$/.test(line)));
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.equal(await storedRouting(dir), undefined);
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
		assert.ok(shown(p).some((line) => /^▸ \[ \] Jev routing\s+•$/.test(line)));
		confirmApply(p);
	});
	assert.deepEqual(await storedRouting(dir), { schemaVersion: 1, jevRouting: "off" });

	const jev = classifierRegistry(() => ({}));
	const launcher = createChildLauncher({
		modelProfiles: { load: () => ({ status: "absent" }) },
		jevRouting: createJevRouting(dir),
		delegationMode: { current: () => "opportunistic" },
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
		delegationMode: { current: () => "opportunistic" },
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

test("with Jev routing off and no role, a refused model profile is reported before the routing stay", async (t) => {
	const dir = withAgentDirectory(t);
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	const jev = classifierRegistry(() => ({}));
	const launcher = createChildLauncher({
		modelProfiles: {
			load: () => ({ status: "refused", reason: "Profiles file is broken." }),
		},
		jevRouting: createJevRouting(dir),
		delegationMode: { current: () => "opportunistic" },
	});

	const launch = await launcher.prepareLaunch(
		{ task: "Map the source", userRequest: "Map the source" },
		launcherContext(worktree, jev),
	);
	assert.equal(launch.kind, "refused");
	assert.equal(launch.reason, "Profiles file is broken.");
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
			delegationMode: { current: () => "opportunistic" },
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

test("status and doctor recognize the official installed Bridge from the parent package source", async (t) => {
	const installed = installedPackagePath(getAgentDir(), "npm:pi-claude-bridge");
	if (!installed) {
		t.skip("pi-claude-bridge is not installed in the Pi agent directory");
		return;
	}
	const version = JSON.parse(await readFile(join(installed, "package.json"), "utf8")).version;
	for (const [source, install] of [
		["npm:pi-claude-bridge", async (dir) => {
			await mkdir(join(dir, "npm", "node_modules"), { recursive: true });
			await symlink(installed, join(dir, "npm", "node_modules", "pi-claude-bridge"), "dir");
		}],
		["git:github.com/elidickinson/pi-claude-bridge@feature/branch", async (dir) => {
			const root = join(dir, "git", "github.com", "elidickinson");
			await mkdir(root, { recursive: true });
			await symlink(installed, join(root, "pi-claude-bridge"), "dir");
		}],
		[installed, async () => {}],
	]) {
		const dir = withAgentDirectory(t);
		await install(dir);
		await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [source] }));
		await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
		const commands = new Map();
		const notifications = [];
		extension(commands, notifications, dir);
		const context = {
			cwd: dir,
			isProjectTrusted: () => false,
			ui: { notify: (message, level) => notifications.push({ message, level }) },
		};
		for (const name of ["workflow:status", "workflow:doctor"]) {
			await commands.get(name).handler("", context);
			assert.ok(notifications.at(-1).message.includes(`✓ pi-claude-bridge — installed ${version}, installed`), source);
			assert.doesNotMatch(notifications.at(-1).message, /pi install npm:pi-claude-bridge/, source);
		}
		const settingsBefore = await readFile(join(dir, "settings.json"), "utf8");
		const off = readSelection(undefined, ["pi-claude-bridge"]).selection;
		off.capabilities.codegraph = true;
		off.expectations["pi-claude-bridge"] = false;
		await writeFile(selectionFile(dir), JSON.stringify(off));
		for (const name of ["workflow:status", "workflow:doctor"]) {
			await commands.get(name).handler("", context);
			assert.ok(notifications.at(-1).message.includes(`✓ pi-claude-bridge — installed ${version}, installed`), source);
			assert.doesNotMatch(notifications.at(-1).message, /pi install npm:pi-claude-bridge/, source);
		}
		assert.equal(await readFile(join(dir, "settings.json"), "utf8"), settingsBefore, source);
	}
});

test("status and doctor follow configured Bridge source scenarios without writes or installation", async (t) => {
	const cases = [
		{ name: "bare autoload:false user delta", user: true, projectPackage: { source: "npm:pi-claude-bridge", autoload: false }, version: "1.1.1" },
		{ name: "enabled delta retains user companion", user: true, projectPackage: { source: "npm:pi-claude-bridge", autoload: false, extensions: ["src/index.ts"] }, version: "1.1.1" },
		{ name: "filtered delta retains installed user companion", user: true, projectPackage: { source: "npm:pi-claude-bridge", autoload: false, extensions: ["!src/index.ts"] }, version: "1.1.1" },
		{ name: "ordinary project shadow", user: true, projectPackage: "npm:pi-claude-bridge", version: "2.2.2" },
		{ name: "missing configured user is a gap despite project cache", user: false, configuredUser: true, projectPackage: { source: "npm:pi-claude-bridge", autoload: false }, missing: true },
		{ name: "no configured user match preserves project companion behavior", user: false, projectPackage: { source: "npm:pi-claude-bridge", autoload: false }, version: "2.2.2" },
	];
	for (const scenario of cases) {
		const dir = withAgentDirectory(t);
		const project = join(dir, "project");
		const userRoot = join(dir, "npm", "node_modules", "pi-claude-bridge");
		const projectRoot = join(project, ".pi", "npm", "node_modules", "pi-claude-bridge");
		await mkdir(project, { recursive: true });
		const manifest = (version) => JSON.stringify({
			name: "pi-claude-bridge", version,
			repository: "https://github.com/elidickinson/pi-claude-bridge",
			pi: { extensions: ["./src/index.ts"] },
		});
		for (const [root, version, present] of [[userRoot, "1.1.1", scenario.user], [projectRoot, "2.2.2", true]]) {
			if (!present) continue;
			await mkdir(join(root, "src"), { recursive: true });
			await writeFile(join(root, "package.json"), manifest(version));
			await writeFile(join(root, "src", "index.ts"), "export default () => ({})");
		}
		const userSettings = { packages: scenario.user || scenario.configuredUser ? ["npm:pi-claude-bridge"] : [] };
		const projectSettings = { packages: [scenario.projectPackage] };
		await writeFile(join(dir, "settings.json"), JSON.stringify(userSettings));
		await mkdir(join(project, ".pi"), { recursive: true });
		await writeFile(join(project, ".pi", "settings.json"), JSON.stringify(projectSettings));
		const beforeSettings = await readFile(join(dir, "settings.json"), "utf8");
		const beforeProjectSettings = await readFile(join(project, ".pi", "settings.json"), "utf8");
		const selection = readSelection(undefined, ["pi-claude-bridge"]).selection;
		selection.capabilities.codegraph = true;
		selection.expectations["pi-claude-bridge"] = true;
		await writeFile(selectionFile(dir), JSON.stringify(selection));
		const metadataPath = join(dir, "companions.json");
		await writeFile(metadataPath, JSON.stringify({ schemaVersion: 1, companions: [{ package: "pi-claude-bridge", description: "Claude Bridge" }] }));
		const commands = new Map();
		const notifications = [];
		const invocations = [];
		extension(commands, notifications, dir, { metadataPath }, async (command, args) => {
			invocations.push([command, args]);
			return { code: 0 };
		});
		const context = {
			cwd: project,
			isProjectTrusted: () => true,
			ui: { notify: (message, level) => notifications.push({ message, level }) },
		};
		for (const expectation of [true, false]) {
			selection.expectations["pi-claude-bridge"] = expectation;
			await writeFile(selectionFile(dir), JSON.stringify(selection));
			const selectionBytes = await readFile(selectionFile(dir), "utf8");
			for (const name of ["workflow:status", "workflow:doctor"]) {
				await commands.get(name).handler("", context);
				const { message } = notifications.at(-1);
				if (scenario.missing) {
					assert.match(message, /pi-claude-bridge — missing/, `${scenario.name} ${name} expected=${expectation}`);
					if (!expectation) assert.match(message, /All configured companions are installed\./, `${scenario.name} ${name}: off expectation is not degraded`);
					if (expectation) assert.match(message, /pi install npm:pi-claude-bridge/, `${scenario.name} ${name}`);
					else assert.doesNotMatch(message, /pi install npm:pi-claude-bridge/, `${scenario.name} ${name}`);
				} else {
					assert.match(message, new RegExp(`✓ pi-claude-bridge — installed ${scenario.version.replaceAll(".", "\\.")}, installed`), `${scenario.name} ${name} expected=${expectation}`);
					assert.doesNotMatch(message, /multiple effective sources|pi install npm:pi-claude-bridge/,
						`${scenario.name} ${name} expected=${expectation}`);
				}
			}
			assert.equal(await readFile(selectionFile(dir), "utf8"), selectionBytes, scenario.name);
		}
		assert.deepEqual(invocations, [], scenario.name);
		assert.equal(await readFile(join(dir, "settings.json"), "utf8"), beforeSettings, scenario.name);
		assert.equal(await readFile(join(project, ".pi", "settings.json"), "utf8"), beforeProjectSettings, scenario.name);
		for (const packageRoot of [userRoot, projectRoot]) {
			if (!await readFile(join(packageRoot, "package.json"), "utf8").then(() => true, () => false)) continue;
			assert.equal(await readFile(join(packageRoot, "package.json"), "utf8"), manifest(packageRoot === userRoot ? "1.1.1" : "2.2.2"), scenario.name);
		}
	}
});

test("status and doctor show a missing expected Bridge without invoking installation", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
	const commands = new Map();
	const notifications = [];
	const installs = [];
	extension(commands, notifications, dir, undefined, async (command, args) => {
		installs.push([command, args]);
		return { code: 0 };
	});
	const context = {
		cwd: dir,
		isProjectTrusted: () => false,
		ui: { notify: (message, level) => notifications.push({ message, level }) },
	};
	for (const name of ["workflow:status", "workflow:doctor"]) {
		await commands.get(name).handler("", context);
		assert.equal(notifications.at(-1).level, "warning");
		assert.match(notifications.at(-1).message, /pi install npm:pi-claude-bridge/);
	}
	assert.deepEqual(installs, []);
});

test("status and doctor expose configured Bridge validation failures without installing or changing settings", async (t) => {
	const cases = [
		["malformed manifest", "{"],
		["wrong package identity", JSON.stringify({ name: "not-pi-claude-bridge", version: "1.0.0", repository: "https://github.com/elidickinson/pi-claude-bridge" })],
		["unreadable manifest", undefined],
	];
	for (const [label, manifest] of cases) {
		const dir = withAgentDirectory(t);
		const project = join(dir, "project");
		const root = join(dir, "npm", "node_modules", "pi-claude-bridge");
		await mkdir(project, { recursive: true });
		await mkdir(root, { recursive: true });
		if (manifest !== undefined) await writeFile(join(root, "package.json"), manifest);
		else await symlink(join(root, "missing-manifest"), join(root, "package.json"));
		await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:pi-claude-bridge"] }));
		await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
		const settingsBefore = await readFile(join(dir, "settings.json"), "utf8");
		const commands = new Map();
		const notifications = [];
		const installs = [];
		extension(commands, notifications, dir, undefined, async (command, args) => {
			installs.push([command, args]);
			return { code: 0 };
		});
		const context = {
			cwd: project,
			isProjectTrusted: () => false,
			ui: { notify: (message, level) => notifications.push({ message, level }) },
		};
		for (const name of ["workflow:status", "workflow:doctor"]) {
			await commands.get(name).handler("", context);
			assert.equal(notifications.at(-1).level, "warning", label);
			assert.match(notifications.at(-1).message, /✗ pi-claude-bridge — error \(/, label);
			assert.doesNotMatch(notifications.at(-1).message, /✓ pi-claude-bridge — installed/, label);
		}
		assert.deepEqual(installs, [], label);
		assert.equal(await readFile(join(dir, "settings.json"), "utf8"), settingsBefore, label);
	}
});

test("status and doctor report a true configured-source ambiguity without installing", async (t) => {
	const dir = withAgentDirectory(t);
	const project = join(dir, "project");
	const user = join(dir, "npm", "node_modules", "pi-claude-bridge");
	const projectPackage = join(project, "project-bridge");
	const manifest = JSON.stringify({
		name: "pi-claude-bridge",
		version: "1.0.0",
		repository: "https://github.com/elidickinson/pi-claude-bridge",
		pi: { extensions: ["./index.ts"] },
	});
	await mkdir(user, { recursive: true });
	await mkdir(projectPackage, { recursive: true });
	for (const root of [user, projectPackage]) {
		await writeFile(join(root, "package.json"), manifest);
		await writeFile(join(root, "index.ts"), "export default () => ({})");
	}
	await mkdir(join(project, ".pi"), { recursive: true });
	await writeFile(join(project, ".pi", "settings.json"), JSON.stringify({ packages: [projectPackage] }));
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:pi-claude-bridge"] }));
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph"])));
	const settingsBefore = await readFile(join(dir, "settings.json"), "utf8");
	const commands = new Map();
	const notifications = [];
	const installs = [];
	extension(commands, notifications, dir, undefined, async (command, args) => {
		installs.push([command, args]);
		return { code: 0 };
	});
	const context = {
		cwd: project,
		isProjectTrusted: () => true,
		ui: { notify: (message, level) => notifications.push({ message, level }) },
	};
	for (const name of ["workflow:status", "workflow:doctor"]) {
		await commands.get(name).handler("", context);
		assert.equal(notifications.at(-1).level, "warning");
		assert.match(notifications.at(-1).message, /✗ pi-claude-bridge — error \(The official Claude Bridge package is configured from multiple effective sources\./);
		assert.doesNotMatch(notifications.at(-1).message, /✓ pi-claude-bridge — installed/);
	}
	assert.deepEqual(installs, []);
	assert.equal(await readFile(join(dir, "settings.json"), "utf8"), settingsBefore);
});

test("Configure presents Bridge as a separate expectation and cancellation writes nothing", async (t) => {
	const dir = withAgentDirectory(t);
	const selection = selectionWith(["codegraph"]);
	selection.expectations["pi-claude-bridge"] = false;
	const original = `${JSON.stringify(selection)}\n`;
	await writeFile(selectionFile(dir), original);
	seatOnly(t, ["codegraph"]);
	const installs = [];
	const catalog = {
		resolveInstalledVersion: () => ({ version: "1.0.0" }),
		resolveInstalledVersionAsync: async (name) => name === "pi-claude-bridge" ? { version: "0.9.2" } : undefined,
	};
	const { command, notify } = extension(
		new Map(), [], dir, catalog,
		async (command, args) => { installs.push([command, args]); return { code: 0 }; },
	);
	let menu;
	await driveConfig(command, notify, (panel) => {
		menu = shown(panel);
		assert.ok(menu.some((line) => /^\[ \] pi-claude-bridge\b/.test(line)));
		focus(panel, "pi-claude-bridge");
		panel.handleInput(" ");
		assert.ok(shown(panel).some((line) => /^▸ \[x\] pi-claude-bridge\b.*•$/.test(line)));
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.ok(menu.some((line) => /Compact rendering/.test(line)));
	assert.equal(await readFile(selectionFile(dir), "utf8"), original);
	assert.deepEqual(installs, []);
});

test("Configure confirmation uses the generic unpinned npm package action for an expected missing Bridge", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith([])));
	seatOnly(t, []);
	const installs = [];
	const catalog = {
		resolveInstalledVersion: () => ({ version: "1.0.0" }),
		resolveInstalledVersionAsync: async (name) => name === "pi-claude-bridge" ? {} : undefined,
	};
	const { command, notify } = extension(
		new Map(), [], dir, catalog,
		async (command, args) => { installs.push([command, args]); return { code: 0 }; },
	);
	let review;
	await driveConfig(command, notify, (panel) => {
		openApply(panel);
		review = shown(panel);
		assert.ok(review.some((line) => /Install pi-claude-bridge/.test(line)));
		confirmApply(panel);
	});
	assert.deepEqual(installs, [["pi", ["install", "npm:pi-claude-bridge"]]]);
	const saved = JSON.parse(await readFile(selectionFile(dir), "utf8"));
	assert.equal(saved.expectations["pi-claude-bridge"], true);
	assert.ok(Object.values(saved.capabilities).every((on) => on === false));
});

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
	assert.ok(lines.some((line) => /^\[x\] CodeGraph$/.test(line)));
	assert.ok(lines.some((line) => /^\[ \] Todo$/.test(line)));
});

test("the review omits Jev routing when it is unchanged", async (t) => {
	const dir = withAgentDirectory(t);
	const selection = selectionWith([]);
	selection.expectations["pi-claude-bridge"] = false;
	await writeFile(selectionFile(dir), JSON.stringify(selection));
	seatOnly(t, []);
	const { command, notify } = extension(new Map(), [], dir, {
		resolveInstalledVersion: () => ({ version: "1.0.0" }),
	});
	let review;
	await driveConfig(command, notify, (panel) => {
		openApply(panel);
		review = shown(panel);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.ok(review.some((line) => /Keep pi-claude-bridge installed \(not uninstalled\)/.test(line)));
	assert.ok(review.some((line) => /Nothing is uninstalled/.test(line)));
	assert.ok(review.every((line) => !/Jev routing/.test(line)));
});

const changesSection = (review) =>
	review.slice(
		review.findIndex((line) => line.startsWith("Changes")) + 1,
		review.findIndex((line) => line.startsWith("Seating") || line.startsWith("Always on apply")),
	);

for (const [label, seatedOn, expected] of [
	["a partly seated harness", ["todo"], ["Seat CodeGraph"]],
	["a fresh installation", [], ["Seat Todo", "Seat CodeGraph"]],
]) {
	test(`the review compares changes against the selection on disk and lists seating against the seated one, on ${label}`, async (t) => {
		const dir = withAgentDirectory(t);
		await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["codegraph", "todo"])));
		seatOnly(t, seatedOn);
		const { command, notify } = extension(new Map(), [], dir);
		let review;
		await driveConfig(command, notify, (panel) => {
			openApply(panel);
			review = shown(panel);
			panel.handleInput(ESC);
			panel.handleInput(ESC);
		});
		assert.ok(changesSection(review).includes("No changes to your selection."));
		assert.ok(changesSection(review).every((line) => !/(Seat|Unseat) /.test(line)));
		const seating = review.findIndex((line) => line.startsWith("Seating"));
		assert.ok(seating > review.findIndex((line) => line.startsWith("Changes")));
		assert.deepEqual(review.slice(seating + 1, seating + 1 + expected.length), expected);
		assert.ok(seating < review.findIndex((line) => line.startsWith("Always on apply")));
	});
}

test("a draft edit that unseats a seated capability lists Unseat in the review", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["todo"])));
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	let review;
	await driveConfig(command, notify, (panel) => {
		focus(panel, "Todo");
		press(panel, keys.space);
		openApply(panel);
		review = shown(panel);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	const seating = review.findIndex((line) => line.startsWith("Seating"));
	assert.ok(seating > 0);
	assert.equal(review[seating + 1], "Unseat Todo");
	assert.ok(changesSection(review).some((line) => /Todo\s+on → off/.test(line)));
});

test("the review has no Seating section when the seated capabilities equal the draft", async (t) => {
	const dir = withAgentDirectory(t);
	await writeFile(selectionFile(dir), JSON.stringify(selectionWith(["todo"])));
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	let heading;
	let review;
	await driveConfig(command, notify, (panel) => {
		openApply(panel);
		heading = title(panel);
		review = shown(panel);
		panel.handleInput(ESC);
		panel.handleInput(ESC);
	});
	assert.equal(heading, "Workflow config › Review");
	assert.ok(review.includes("No changes to your selection."));
	assert.ok(review.some((line) => line.startsWith("Always on apply")));
	assert.ok(review.every((line) => !line.startsWith("Seating")));
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

test("a failed Jev routing write on confirm stops before seating", async (t) => {
	const dir = withAgentDirectory(t);
	seatOnly(t, ["todo"]);
	const { command, notify } = extension(new Map(), [], dir);
	await assert.rejects(
		driveConfig(command, notify, (panel) => {
			focusRouting(panel);
			panel.handleInput(" ");
			mkdirSync(join(dir, "pi-workflow-routing.json"));
			confirmApply(panel);
		}),
	);
	assert.deepEqual(seatedNames(), ["todo"]);
	assert.equal(seated("todo", "above-input"), true);
});
