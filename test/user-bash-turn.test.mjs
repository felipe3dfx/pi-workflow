import test from "node:test";
import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { USER_BASH_TURN_TYPE } from "../extensions/user-bash-turn.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { eventually } from "./support/eventually.mjs";
import { realParent } from "./support/workflow-parent.mjs";

const tree = "PI_WORKFLOW_PROCESS_TREE";

// The suite may itself run inside a child tree, which the feature skips.
function treeMark(t, value) {
	const saved = process.env[tree];
	if (value === undefined) delete process.env[tree];
	else process.env[tree] = value;
	t.after(() => {
		if (saved === undefined) delete process.env[tree];
		else process.env[tree] = saved;
	});
}

async function tuiParent(t, responses, options = {}) {
	treeMark(t, undefined);
	const dir = withAgentDirectory(t);
	return realParent(t, dir, responses, { mode: "tui", ...options });
}

// The interactive mode's `!` path: emit user_bash, then execute with the operations it returned.
async function bang(session, command, excludeFromContext = false) {
	const handled = await session.extensionRunner.emitUserBash({
		type: "user_bash",
		command,
		excludeFromContext,
		cwd: session.sessionManager.getCwd(),
	});
	assert.equal(handled?.result, undefined);
	return session.executeBash(command, undefined, {
		excludeFromContext,
		operations: handled?.operations,
	});
}

const texts = (request) =>
	request.messages.map((message) =>
		typeof message.content === "string"
			? message.content
			: message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	);

function assertReactsTo(request, ...outputs) {
	const messages = texts(request);
	const notice = messages.at(-1);
	assert.match(notice, /shell command/i);
	for (const output of outputs) {
		assert.equal(
			messages.filter((text) => text.includes(output)).length,
			1,
			`${output} enters the context once`,
		);
		assert.ok(
			messages.findIndex((text) => text.includes(output)) < messages.length - 1,
			`${output} precedes the trigger`,
		);
		assert.ok(!notice.includes(output), "the trigger does not copy output");
	}
}

const quiet = async () => {
	await delay(50);
};

test("a `!` command run while idle starts a turn whose context holds its output once, before a hidden trigger", async (t) => {
	const { session, requests } = await tuiParent(t, [
		fauxAssistantMessage("reacted"),
	]);
	const result = await bang(session, "printf '%s-%s' idle out");
	assert.equal(result.output, "idle-out");
	await eventually(
		() => requests.length,
		(n) => n === 1,
	);
	assertReactsTo(requests[0], "idle-out");
	const trigger = session.sessionManager
		.getEntries()
		.find((entry) => entry.customType === USER_BASH_TURN_TYPE);
	assert.equal(trigger?.display, false);
});

test("a `!` command that exits non-zero still starts a turn", async (t) => {
	const { session, requests } = await tuiParent(t, [
		fauxAssistantMessage("reacted"),
	]);
	const result = await bang(session, "printf '%s-%s' failed out; exit 3");
	assert.equal(result.exitCode, 3);
	await eventually(
		() => requests.length,
		(n) => n === 1,
	);
	assertReactsTo(requests[0], "failed-out");
});

test("`!` commands that finish while the agent works start one turn after it settles, with their output first", async (t) => {
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const { session, requests } = await tuiParent(t, [
		async () => {
			await held;
			return fauxAssistantMessage("first");
		},
		fauxAssistantMessage("reacted"),
		fauxAssistantMessage("extra"),
	]);
	const prompt = session.prompt("hello");
	await eventually(
		() => requests.length,
		(n) => n === 1,
	);
	await bang(session, "printf '%s-%s' busy one");
	await bang(session, "printf '%s-%s' busy two");
	await quiet();
	assert.equal(requests.length, 1);
	release();
	await prompt;
	await eventually(
		() => requests.length,
		(n) => n === 2,
	);
	assertReactsTo(requests[1], "busy-one", "busy-two");
	await eventually(() => session.isIdle);
	await quiet();
	assert.equal(requests.length, 2, "the commands coalesce into one turn");
});

test("a `!!` command never starts a turn", async (t) => {
	const { session, requests } = await tuiParent(t, [
		fauxAssistantMessage("reacted"),
	]);
	await bang(session, "printf hidden", true);
	await quiet();
	assert.equal(requests.length, 0);
});

test("a cancelled `!` command does not start a turn", async (t) => {
	const { session, requests } = await tuiParent(t, [
		fauxAssistantMessage("reacted"),
	]);
	const running = bang(session, "sleep 5");
	await eventually(() => session.isBashRunning);
	session.abortBash();
	const result = await running;
	assert.equal(result.cancelled, true);
	await quiet();
	assert.equal(requests.length, 0);
});

test("a `!` command that cannot run does not start a turn", async (t) => {
	const { session, requests } = await tuiParent(
		t,
		[fauxAssistantMessage("reacted")],
		{ settings: { shellPath: "/nonexistent/shell" } },
	);
	await assert.rejects(bang(session, "printf x"), /Custom shell path/);
	await quiet();
	assert.equal(requests.length, 0);
});

test("the `!` command runs in the configured shell", async (t) => {
	const dir = withAgentDirectory(t);
	const shell = join(dir, "custom-shell");
	await writeFile(shell, '#!/bin/sh\nprintf custom-; exec /bin/sh "$@"\n');
	await chmod(shell, 0o755);
	const { session, requests } = await tuiParent(
		t,
		[fauxAssistantMessage("reacted")],
		{ settings: { shellPath: shell } },
	);
	const result = await bang(session, "printf shell");
	assert.equal(result.output, "custom-shell");
	await eventually(
		() => requests.length,
		(n) => n === 1,
	);
});

test("a `!` command whose session ends before the trigger leaves no failure behind", async (t) => {
	const { session, requests } = await tuiParent(t, [
		fauxAssistantMessage("reacted"),
	]);
	await bang(session, "printf done");
	session.dispose();
	await quiet();
	assert.equal(requests.length, 0);
});

test("outside the TUI or inside a child tree, `!` stays Pi's own", async (t) => {
	treeMark(t, undefined);
	const rpc = await realParent(t, withAgentDirectory(t), []);
	const event = {
		type: "user_bash",
		command: "true",
		excludeFromContext: false,
		cwd: rpc.worktree,
	};
	assert.equal(
		await rpc.session.extensionRunner.emitUserBash(event),
		undefined,
	);
	const child = await tuiParent(t, []);
	process.env[tree] = "token/id/";
	assert.equal(
		await child.session.extensionRunner.emitUserBash(event),
		undefined,
	);
});
