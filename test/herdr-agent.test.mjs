import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { childrenEvent } from "../extensions/children-event.ts";
import {
	herdrSource,
	managedBridgeFile,
	registerHerdrAgent,
} from "../extensions/herdr-agent.ts";
import { withAgentDirectory } from "./support/agent-directory.mjs";
import { eventually } from "./support/eventually.mjs";

async function herdrServer(t, dir) {
	const path = join(dir, "herdr.sock");
	const requests = [];
	const server = createServer((socket) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			const end = buffer.indexOf("\n");
			if (end < 0) return;
			requests.push(JSON.parse(buffer.slice(0, end)));
			socket.end('{"result":{}}\n');
		});
		socket.on("error", () => {});
	});
	await new Promise((resolve) => server.listen(path, resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return { path, requests };
}

function fakePi() {
	const handlers = new Map();
	const listeners = new Map();
	let registrations = 0;
	const pi = {
		on(event, handler) {
			registrations += 1;
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		events: {
			on(channel, handler) {
				registrations += 1;
				listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
				return () => {};
			},
			emit(channel, data) {
				for (const handler of listeners.get(channel) ?? []) handler(data);
			},
		},
	};
	return {
		pi,
		registrations: () => registrations,
		async fire(event, payload, ctx) {
			for (const handler of handlers.get(event) ?? [])
				await handler(payload, ctx);
		},
	};
}

function context({ idle = true, mode = "tui" } = {}) {
	const warnings = [];
	return {
		warnings,
		ctx: {
			mode,
			isIdle: () => idle,
			ui: { notify: (message, level) => warnings.push({ message, level }) },
			sessionManager: {
				getSessionFile: () => "/sessions/parent.jsonl",
				getSessionId: () => "parent",
			},
		},
	};
}

async function reporter(t, { env = {}, bridge = false } = {}) {
	const dir = withAgentDirectory(t);
	const server = await herdrServer(t, dir);
	if (bridge) {
		mkdirSync(join(dir, "extensions"), { recursive: true });
		writeFileSync(join(dir, "extensions", managedBridgeFile), "");
	}
	const fake = fakePi();
	registerHerdrAgent(fake.pi, {
		agentDirectory: dir,
		env: {
			HERDR_ENV: "1",
			HERDR_SOCKET_PATH: server.path,
			HERDR_PANE_ID: "pane-1",
			...env,
		},
	});
	const states = () =>
		server.requests.filter((request) => request.method === "pane.report_agent");
	const latest = () => states().at(-1)?.params;
	return { ...fake, requests: server.requests, states, latest };
}

const settledTo = (latest, state, message) =>
	eventually(
		latest,
		(params) => params?.state === state && params.message === message,
	);

test("outside Herdr the reporter registers nothing", () => {
	for (const env of [
		{},
		{ HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
		{ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock" },
		{ HERDR_ENV: "0", HERDR_SOCKET_PATH: "/tmp/h.sock", HERDR_PANE_ID: "p" },
	]) {
		const fake = fakePi();
		registerHerdrAgent(fake.pi, { agentDirectory: "/nowhere", env });
		assert.equal(fake.registrations(), 0, JSON.stringify(env));
	}
});

test("inside a child tree the reporter registers nothing and sends nothing", async (t) => {
	const herdr = await reporter(t, {
		env: { PI_WORKFLOW_PROCESS_TREE: "token/id/" },
	});
	assert.equal(herdr.registrations(), 0);
	const { ctx } = context();
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await herdr.fire("agent_start", {}, ctx);
	await delay(50);
	assert.deepEqual(herdr.requests, []);
});

test("a session that is not the TUI sends nothing", async (t) => {
	const herdr = await reporter(t);
	const { ctx } = context({ mode: "rpc" });
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await herdr.fire("agent_start", {}, ctx);
	herdr.pi.events.emit(childrenEvent, { working: 2 });
	await delay(50);
	assert.deepEqual(herdr.requests, []);
});

test("the session is reported, then idle at start and working on agent_start", async (t) => {
	const herdr = await reporter(t);
	const { ctx } = context();
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await settledTo(herdr.latest, "idle", undefined);
	assert.deepEqual(herdr.requests[0].method, "pane.report_agent_session");
	assert.equal(herdr.requests[0].params.session_start_source, "startup");
	assert.equal(
		herdr.requests[0].params.agent_session_path,
		"/sessions/parent.jsonl",
	);
	await herdr.fire("agent_start", {}, ctx);
	const params = await settledTo(herdr.latest, "working", undefined);
	assert.equal(params.source, herdrSource);
	assert.equal(params.source.startsWith("herdr:"), false);
	assert.equal(params.agent, "pi");
	assert.equal(params.pane_id, "pane-1");
	assert.equal(params.agent_session_path, "/sessions/parent.jsonl");
});

test("a settled parent with two working children stays working while it waits on them", async (t) => {
	const herdr = await reporter(t);
	const { ctx } = context();
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await herdr.fire("agent_start", {}, ctx);
	herdr.pi.events.emit(childrenEvent, { working: 2 });
	await settledTo(herdr.latest, "working", undefined);
	await herdr.fire("agent_settled", {}, ctx);
	await settledTo(herdr.latest, "working", "waiting on 2 children");
	herdr.pi.events.emit(childrenEvent, { working: 1 });
	await settledTo(herdr.latest, "working", "waiting on 1 child");
	herdr.pi.events.emit(childrenEvent, { working: 0 });
	await settledTo(herdr.latest, "idle", undefined);
});

test("a settled parent with no working children is idle", async (t) => {
	const herdr = await reporter(t);
	const { ctx } = context();
	herdr.pi.events.emit(childrenEvent, { working: 0 });
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await herdr.fire("agent_start", {}, ctx);
	await settledTo(herdr.latest, "working", undefined);
	await herdr.fire("agent_settled", {}, ctx);
	await settledTo(herdr.latest, "idle", undefined);
});

test("a count received before session_start is published there", async (t) => {
	const herdr = await reporter(t);
	const { ctx } = context();
	herdr.pi.events.emit(childrenEvent, { working: 3 });
	await herdr.fire("session_start", { reason: "reload" }, ctx);
	await settledTo(herdr.latest, "working", "waiting on 3 children");
});

test("blocked wins over an active agent and working children", async (t) => {
	const herdr = await reporter(t);
	const { ctx } = context();
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await herdr.fire("agent_start", {}, ctx);
	herdr.pi.events.emit(childrenEvent, { working: 2 });
	herdr.pi.events.emit("herdr:blocked", { active: true, label: "approve?" });
	await settledTo(herdr.latest, "blocked", "approve?");
	await herdr.fire("agent_settled", {}, ctx);
	await delay(20);
	assert.equal(herdr.latest().state, "blocked");
	herdr.pi.events.emit("herdr:blocked", { active: false });
	await settledTo(herdr.latest, "working", "waiting on 2 children");
});

test("with Herdr's managed integration installed nothing is sent and each session start warns once", async (t) => {
	const herdr = await reporter(t, { bridge: true });
	const { ctx, warnings } = context();
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	await herdr.fire("agent_start", {}, ctx);
	herdr.pi.events.emit(childrenEvent, { working: 2 });
	herdr.pi.events.emit("herdr:blocked", { active: true, label: "x" });
	await herdr.fire("agent_settled", {}, ctx);
	await delay(50);
	assert.deepEqual(herdr.requests, []);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].level, "warning");
	assert.match(warnings[0].message, /herdr integration uninstall pi/);
	assert.match(warnings[0].message, /reload/);
	await herdr.fire("session_start", { reason: "reload" }, ctx);
	assert.equal(warnings.length, 2);
});

test("every report carries a strictly increasing seq", async (t) => {
	const before = Date.now() * 1000;
	const herdr = await reporter(t);
	const { ctx } = context();
	await herdr.fire("session_start", { reason: "startup" }, ctx);
	for (let round = 0; round < 3; round++) {
		await herdr.fire("agent_start", {}, ctx);
		await settledTo(herdr.latest, "working", undefined);
		await herdr.fire("agent_settled", {}, ctx);
		await settledTo(herdr.latest, "idle", undefined);
	}
	const seqs = herdr.requests.map((request) => request.params.seq);
	assert.ok(seqs.length >= 7, String(seqs.length));
	assert.ok(seqs[0] > before);
	const states = herdr.states().map((request) => request.params.seq);
	for (let i = 1; i < states.length; i++) assert.ok(states[i] > states[i - 1]);
	assert.equal(new Set(seqs).size, seqs.length);
});

test("an unreachable Herdr socket never throws into Pi", async (t) => {
	const dir = withAgentDirectory(t);
	const fake = fakePi();
	registerHerdrAgent(fake.pi, {
		agentDirectory: dir,
		env: {
			HERDR_ENV: "1",
			HERDR_SOCKET_PATH: join(dir, "missing.sock"),
			HERDR_PANE_ID: "pane-1",
		},
	});
	const { ctx } = context();
	await fake.fire("session_start", { reason: "startup" }, ctx);
	await fake.fire("agent_start", {}, ctx);
	fake.pi.events.emit(childrenEvent, { working: 1 });
	await fake.fire("agent_settled", {}, ctx);
});
