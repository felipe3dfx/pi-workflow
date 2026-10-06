import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { capabilities, replaceSelection } from "../extensions/configure.ts";
import { createModelProfiles } from "../extensions/model-profiles.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

replaceSelection({
	schemaVersion: 1,
	capabilities: Object.fromEntries(capabilities.map((capability) => [capability, true])),
	expectations: {},
});

async function withConfigDirectory(run) {
	const dir = await mkdtemp(join(tmpdir(), "pi-workflow-model-profiles-"));
	try {
		return await run({
			dir,
			path: join(dir, "agent", "pi-workflow-models.json"),
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const valid = {
	schemaVersion: 2,
	active: "daily",
	profiles: {
		daily: {
			explorer: { model: "nan/mimo-v2.5", thinking: "low" },
			worker: { model: "openai-codex/gpt-5.6-luna", thinking: "medium" },
			verifier: { model: "openai-codex/gpt-6-astra", thinking: "high" },
		},
		"deep-2": {},
	},
};

async function writeJson(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		typeof content === "string" ? content : JSON.stringify(content),
		"utf8",
	);
}

test("the loader reads a valid file with optional specialists", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeJson(path, valid);

		assert.deepEqual(createModelProfiles(dirname(path)).load(), {
			status: "loaded",
			profiles: valid,
		});
	});
});

test("the loader treats a missing file as absent", async () => {
	await withConfigDirectory(async ({ path }) => {
		assert.deepEqual(createModelProfiles(dirname(path)).load(), {
			status: "absent",
		});
	});
});

test("an invalid file is a refusal, never an absent file", async () => {
	await withConfigDirectory(async ({ path }) => {
		const daily = valid.profiles.daily;
		const invalid = [
			"{ not json",
			[],
			{ ...valid, schemaVersion: 3 },
			{ ...valid, extra: true },
			{ ...valid, active: "missing" },
			{ ...valid, active: undefined },
			{ ...valid, profiles: { Daily: daily }, active: "Daily" },
			{ ...valid, profiles: { ["a".repeat(65)]: {} }, active: "a".repeat(65) },
			{ ...valid, profiles: { daily: { orchestrator: daily.worker } } },
			{ ...valid, profiles: { daily: { worker: [daily.worker] } } },
			{
				...valid,
				profiles: { daily: { worker: { ...daily.worker, fallback: [] } } },
			},
			{
				...valid,
				profiles: { daily: { worker: { model: "gpt-5", thinking: "low" } } },
			},
			{
				...valid,
				profiles: {
					daily: { worker: { model: "nan/mimo-v2.5", thinking: "huge" } },
				},
			},
			{
				...valid,
				profiles: { daily: { worker: { model: "nan/mimo-v2.5" } } },
			},
			{
				...valid,
				profiles: {
					daily: { worker: { model: "nan/evil\x1b[2J", thinking: "low" } },
				},
			},
			{
				...valid,
				profiles: {
					daily: { worker: { model: "nan/evil\u202Emodel", thinking: "low" } },
				},
			},
		];
		for (const content of invalid) {
			await writeJson(path, content);
			const result = createModelProfiles(dirname(path)).load();
			assert.equal(result.status, "refused", JSON.stringify(content));
			assert.match(result.reason, /Invalid model profiles/);
			assert.ok(result.reason.includes(path));
		}
		await writeJson(path, {
			...valid,
			profiles: { ["a".repeat(64)]: {} },
			active: "a".repeat(64),
		});
		assert.equal(createModelProfiles(dirname(path)).load().status, "loaded");
	});
});

test("schema version 1 model lists are refused with a message to recreate the profiles", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeJson(path, {
			schemaVersion: 1,
			specialists: {},
			tiers: {},
			taskTypes: {},
		});

		const result = createModelProfiles(dirname(path)).load();

		assert.equal(result.status, "refused");
		assert.match(result.reason, /schema version 1/);
		assert.match(result.reason, /recreate the profiles with \/workflow:models/);
	});
});

test("an unreadable file or a dangling symlink is a refusal, not an absent file", async () => {
	await withConfigDirectory(async ({ path }) => {
		await mkdir(path, { recursive: true });
		const directory = createModelProfiles(dirname(path)).load();
		assert.equal(directory.status, "refused");
		assert.match(directory.reason, /Unable to read/);

		await rm(path, { recursive: true });
		await symlink(join(dirname(path), "missing-target.json"), path);
		const dangling = createModelProfiles(dirname(path)).load();
		assert.equal(dangling.status, "refused");
		assert.match(dangling.reason, /Unable to read/);
	});
});

test("a file changed after loading applies only after /reload", async () => {
	await withConfigDirectory(async ({ path }) => {
		await writeJson(path, valid);
		const profiles = createModelProfiles(dirname(path));
		await writeFile(path, "{ not json", "utf8");

		assert.deepEqual(profiles.load(), { status: "loaded", profiles: valid });
		assert.equal(createModelProfiles(dirname(path)).load().status, "refused");
	});
});

function extensionCommands(path) {
	const commands = new Map();
	piWorkflowExtension(
		{
			on: () => {},
			exec: async () => ({ code: 0 }),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool: () => {},
			registerShortcut: () => {},
			registerMessageRenderer: () => {},
			registerToolRenderer: () => {},
			registerProvider: () => {},
		},
		{ agentDirectory: dirname(path) },
	);
	return commands;
}

test("/workflow:models rejects extra arguments with the shared usage", async (t) => {
	await withConfigDirectory(async ({ path }) => {
		const printed = [];
		t.mock.method(console, "error", (message) => printed.push(message));
		const command = extensionCommands(path).get("workflow:models");
		const notifications = [];
		const ui = {
			notify: (message, level) => notifications.push({ message, level }),
			custom: () => assert.fail("the panel must not open"),
		};

		await command.handler("--force", { hasUI: true, mode: "tui", ui });
		await command.handler("--force", { hasUI: false, mode: "print", ui });

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "error");
		for (const message of [notifications[0].message, ...printed]) {
			assert.match(message, /\/workflow:models \| \/workflow:subagents/);
			assert.doesNotMatch(message, /models-edit/);
		}
		assert.equal(printed.length, 1);
		await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
	});
});
