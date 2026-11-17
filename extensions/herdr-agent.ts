import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join, posix, win32 } from "node:path";

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { childrenEvent } from "./children-event.ts";
import { insideChildTree } from "./process-tree.ts";

// Reports the top-level Pi session's agent state to the Herdr pane it runs in, following Herdr's managed Pi
// integration (version 9) under its own source, and keeps the pane working while background children run.
export const herdrSource = "pi-workflow";
const agent = "pi";
// Herdr's managed Pi integration; Herdr accepts one lifecycle source per pane, so this reporter yields to it.
export const managedBridgeFile = "herdr-agent-state.ts";
const attempts = [500, 1500];

type AgentState = "working" | "blocked" | "idle";
type Desired = { state: AgentState; message?: string };
type Endpoint = { socket: string; pane: string };

export type HerdrAgentOptions = {
	agentDirectory: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
};

function herdrEndpoint(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): Endpoint | undefined {
	const socket = env.HERDR_SOCKET_PATH;
	const pane = env.HERDR_PANE_ID;
	if (env.HERDR_ENV !== "1" || !socket || !pane) return undefined;
	return {
		socket: platform === "win32" ? `\\\\.\\pipe\\${socket}` : socket,
		pane,
	};
}

function deliver(path: string, request: unknown, timeoutMs: number) {
	return new Promise<boolean>((resolve) => {
		let done = false;
		let socket: Socket | undefined;
		const finish = (delivered: boolean) => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			socket?.destroy();
			resolve(delivered);
		};
		const timeout = setTimeout(() => finish(false), timeoutMs);
		timeout.unref?.();
		try {
			const connection = createConnection(path);
			socket = connection;
			connection.on("error", () => finish(false));
			connection.on("connect", () =>
				connection.write(`${JSON.stringify(request)}\n`),
			);
			connection.on("data", () => finish(true));
			connection.on("end", () => finish(false));
		} catch {
			finish(false);
		}
	});
}

async function send(path: string, request: unknown) {
	try {
		for (const timeoutMs of attempts)
			if (await deliver(path, request, timeoutMs)) return;
	} catch {
		// Reporting never breaks Pi.
	}
}

function childrenMessage(count: number) {
	return `waiting on ${count} ${count === 1 ? "child" : "children"}`;
}

function safely<T>(read: () => T): T | undefined {
	try {
		return read();
	} catch {
		return undefined;
	}
}

// Active only inside Herdr, outside a child tree, in the top-level TUI session, and while Herdr's managed Pi
// integration is absent; otherwise it registers nothing.
export function registerHerdrAgent(
	pi: ExtensionAPI,
	{
		agentDirectory,
		env = process.env,
		platform = process.platform,
	}: HerdrAgentOptions,
) {
	const endpoint = herdrEndpoint(env, platform);
	if (!endpoint || insideChildTree(env)) return;
	const { socket, pane } = endpoint;

	let seq = Date.now() * 1000;
	let sessionPath: string | undefined;
	let sessionId: string | undefined;
	let root = false;
	let agentActive = false;
	let childCount = 0;
	let blockedCount = 0;
	let blockedMessage: string | undefined;
	let last: Desired | undefined;
	let inFlight = false;
	let queued: (Desired & { seq: number }) | undefined;

	const nextSeq = () => ++seq;
	const requestId = (kind?: string) =>
		`${herdrSource}:${kind ? `${kind}:` : ""}${Date.now()}:${Math.random().toString(36).slice(2)}`;

	function updateSessionRef(ctx: ExtensionContext) {
		const file = safely(() => ctx.sessionManager?.getSessionFile());
		sessionPath =
			typeof file === "string" &&
			(posix.isAbsolute(file) || win32.isAbsolute(file))
				? file
				: undefined;
		const id = safely(() => ctx.sessionManager?.getSessionId());
		sessionId = typeof id === "string" && id.length > 0 ? id : undefined;
	}

	function sessionRef() {
		if (sessionPath) return { agent_session_path: sessionPath };
		if (sessionId) return { agent_session_id: sessionId };
		return undefined;
	}

	function reportSession(sessionStartSource?: string) {
		const ref = sessionRef();
		if (!ref) return Promise.resolve();
		return send(socket, {
			id: requestId("session"),
			method: "pane.report_agent_session",
			params: {
				pane_id: pane,
				source: herdrSource,
				agent,
				seq: nextSeq(),
				session_start_source: sessionStartSource,
				...ref,
			},
		});
	}

	// One report in flight; only the latest state waits behind it.
	async function drain() {
		if (inFlight) return;
		inFlight = true;
		try {
			while (queued) {
				const next = queued;
				queued = undefined;
				await send(socket, {
					id: requestId(),
					method: "pane.report_agent",
					params: {
						pane_id: pane,
						source: herdrSource,
						agent,
						state: next.state,
						message: next.message,
						seq: next.seq,
						...sessionRef(),
					},
				});
			}
		} finally {
			inFlight = false;
			if (queued) void drain();
		}
	}

	function desired(): Desired {
		if (blockedCount > 0) return { state: "blocked", message: blockedMessage };
		if (agentActive) return { state: "working" };
		if (childCount > 0)
			return { state: "working", message: childrenMessage(childCount) };
		return { state: "idle" };
	}

	function publish(force = false) {
		const next = desired();
		if (!force && next.state === last?.state && next.message === last?.message)
			return;
		last = next;
		queued = { ...next, seq: nextSeq() };
		void drain().catch(() => {});
	}

	pi.events?.on("herdr:blocked", (data) => {
		if (!root) return;
		const event = (data ?? {}) as { active?: unknown; label?: unknown };
		if (event.active) {
			blockedCount += 1;
			blockedMessage =
				typeof event.label === "string" ? event.label : undefined;
		} else {
			blockedCount = Math.max(0, blockedCount - 1);
			if (blockedCount === 0) blockedMessage = undefined;
		}
		publish();
	});

	// The count may arrive before this session_start; it is kept and published there.
	pi.events?.on(childrenEvent, (data) => {
		const working = Number(
			(data as { working?: unknown } | undefined)?.working,
		);
		if (!Number.isFinite(working)) return;
		childCount = Math.max(0, Math.floor(working));
		if (root) publish();
	});

	pi.on("session_start", async (event, ctx) => {
		// RPC still reports hasUI, so the mode is the reliable gate for the top-level session.
		if (ctx.mode !== "tui") return;
		const bridge = join(agentDirectory, "extensions", managedBridgeFile);
		if (safely(() => existsSync(bridge))) {
			root = false;
			safely(() =>
				ctx.ui.notify(
					`pi-workflow Herdr reporting is off: Herdr's managed Pi integration is installed (${bridge}). Run \`herdr integration uninstall pi\` and reload.`,
					"warning",
				),
			);
			return;
		}
		root = true;
		updateSessionRef(ctx);
		await reportSession(event.reason);
		// A reload replaces this extension mid-run without another agent_start.
		agentActive = safely(() => ctx.isIdle()) === false;
		publish(true);
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!root) return;
		updateSessionRef(ctx);
		void reportSession();
		agentActive = true;
		publish();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!root || safely(() => ctx.isIdle()) !== true) return;
		agentActive = false;
		publish();
	});

	pi.on("session_shutdown", () => {
		childCount = 0;
	});
}
