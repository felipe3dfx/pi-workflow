import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-settings-"));
	let panel;
	try {
		const worktree = join(dir, "repo");
		await mkdir(worktree);
		execFileSync("git", ["init", "--quiet"], { cwd: worktree });
		const notifications = [];
		const { command, notify } = extension(new Map(), notifications);
		panel = await openSettings(command, notify);
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
		const ctx = {
			cwd: worktree,
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
	} finally {
		if (panel) {
			const shown = panel
				.render(50)
				.map((line) => stripVTControlCharacters(line));
			if (shown.some((line) => /Jev routing\s+off/.test(line))) {
				panel.handleInput(" ");
			}
		}
		await rm(dir, { recursive: true, force: true });
	}
});
