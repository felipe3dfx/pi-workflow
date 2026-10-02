import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { initTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";

import { patchMenus, restoreMenus } from "../extensions/chrome-menus.ts";
import { createChildLauncher } from "../extensions/child-launcher.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

initTheme("dark", false);
const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme")];

function extension(commands, notifications) {
	piWorkflowExtension({
		on() {},
		exec: async () => ({ code: 0 }),
		registerCommand: (name, command) => commands.set(name, command),
		registerTool() {},
		registerShortcut() {},
		registerMessageRenderer() {},
		registerProvider() {},
		sendMessage() {},
	});
	return {
		command: commands.get("workflow:settings"),
		notify: (message, level) => notifications.push({ message, level }),
	};
}

async function withAgentDirectory(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-agent-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});
	return dir;
}

function launcherContext(cwd) {
	return {
		cwd,
		model: { provider: "session", id: "model", reasoning: true },
		thinkingLevel: "medium",
		modelRegistry: {
			getApiKeyForProvider: async () => "typesafe-key",
			getAvailable: () => [],
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

async function openSettings(command, notify) {
	let panel;
	await command.handler("", {
		hasUI: true,
		mode: "tui",
		ui: {
			notify,
			custom: async (factory) => {
				panel = factory(undefined, undefined, undefined, () => {});
			},
		},
	});
	assert.ok(panel instanceof SettingsList);
	return panel;
}

test("/workflow:settings rejects extra arguments and needs the TUI", async () => {
	const notifications = [];
	const { command, notify } = extension(new Map(), notifications);
	assert.equal(command.description, "Open workflow settings");

	await command.handler("--force", { hasUI: true, mode: "tui", ui: { notify } });
	assert.equal(notifications[0].level, "error");
	assert.match(notifications[0].message, /\/workflow:settings/);

	await command.handler("", { hasUI: true, mode: "print", ui: { notify } });
	assert.equal(notifications.at(-1).level, "error");
	assert.match(notifications.at(-1).message, /needs the TUI/);
});

test("/workflow:settings turns Jev routing off on the existing settings line", async (t) => {
	patchMenus();
	t.after(restoreMenus);
	const dir = await withAgentDirectory(t);
	await writeFile(
		join(dir, "pi-workflow-routing.json"),
		JSON.stringify({ schemaVersion: 1, jevRouting: "on" }),
	);
	const worktree = join(dir, "repo");
	await mkdir(worktree);
	execFileSync("git", ["init", "--quiet"], { cwd: worktree });
	const notifications = [];
	const { command, notify } = extension(new Map(), notifications);
	const panel = await openSettings(command, notify);
	const before = panel.render(50).map((line) => stripVTControlCharacters(line));
	assert.ok(before.some((line) => /Jev routing\s+on\s*$/.test(line)));

	panel.handleInput(" ");
	const lines = panel.render(50);
	const shown = lines.map((line) => stripVTControlCharacters(line));
	assert.ok(shown.some((line) => /Jev routing\s+off\s*$/.test(line)));
	assert.ok(lines.some((line) => line.includes(theme.fg("dim", "off"))));

	const requests = [];
	const launcher = createChildLauncher({
		modelProfiles: { load: () => ({ status: "absent" }) },
		fetch: async () => {
			requests.push(1);
			return Response.json({ answers: {} });
		},
	});
	const ctx = launcherContext(worktree);
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
	assert.doesNotMatch(missingRole.warning, /Launch blocked/);
	assert.doesNotMatch(missingRole.reason, /Jev answered/);
	const explicit = await launcher.prepareLaunch(
		{ role: "worker", task: "Map the source", userRequest: "Map the source" },
		ctx,
	);
	assert.equal(explicit.kind, "ready");
	assert.equal(explicit.role, "worker");
	const skilled = await launcher.prepareLaunch(
		{
			task: "Implement the toggle",
			userRequest: "Please implement the toggle",
		},
		ctx,
	);
	assert.equal(skilled.kind, "ready");
	assert.equal(skilled.role, "worker");
	assert.equal(skilled.skill, "implement");
	assert.equal(requests.length, 0);
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
		const dir = await withAgentDirectory(t);
		await write(join(dir, "pi-workflow-routing.json"));
		const worktree = join(dir, "repo");
		await mkdir(worktree);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		const requests = [];
		const launcher = createChildLauncher({
			modelProfiles: { load: () => ({ status: "absent" }) },
			fetch: async () => {
				requests.push(1);
				return Response.json({ answers: {} });
			},
		});
		const ctx = launcherContext(worktree);

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
		assert.equal(requests.length, 0);
	});
}

test("turning Jev routing on persists for a new process and leaves the model profiles alone", async (t) => {
	const dir = await withAgentDirectory(t);
	const profilesPath = join(dir, "pi-workflow-models.json");
	const profiles =
		'{"schemaVersion":2,"active":"default","profiles":{"default":{}}}\n';
	await writeFile(profilesPath, profiles);
	const { command, notify } = extension(new Map(), []);
	const panel = await openSettings(command, notify);
	const shown = () =>
		panel.render(50).map((line) => stripVTControlCharacters(line));
	assert.ok(shown().some((line) => /Jev routing\s+off\s*$/.test(line)));

	panel.handleInput(" ");
	assert.ok(shown().some((line) => /Jev routing\s+on\s*$/.test(line)));

	const restart = () =>
		execFileSync(
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
					registerProvider() {},
					sendMessage() {},
				});
				await commands.get("workflow:settings").handler("", {
					hasUI: true,
					mode: "tui",
					ui: {
						notify() {},
						custom: async (factory) => {
							const panel = factory(undefined, undefined, undefined, () => {});
							for (const line of panel.render(50)) console.log(stripVTControlCharacters(line));
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
	assert.match(restart(), /Jev routing\s+on\s*$/m);

	panel.handleInput(" ");
	assert.ok(shown().some((line) => /Jev routing\s+off\s*$/.test(line)));
	assert.match(restart(), /Jev routing\s+off\s*$/m);
	assert.equal(await readFile(profilesPath, "utf8"), profiles);
});
