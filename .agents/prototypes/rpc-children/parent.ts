import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import net from "node:net";
const key = Symbol.for("prototype.rpc-children.v1");
const log = (value) =>
	appendFileSync(
		process.env.PROTO_LIFECYCLE_LOG,
		`${JSON.stringify({ source: "parent", time: Date.now() / 1000, pid: process.pid, ...value })}\n`,
	);
export default function (pi) {
	globalThis[key] ??= {
		generation: 0,
		n: 0,
		pending: new Map(),
		buffer: "",
		sockets: [],
	};
	const s = globalThis[key];
	s.generation++;
	log({ event: "load", generation: s.generation, hasChild: !!s.child });
	pi.on("session_start", () =>
		log({ event: "session_start", generation: s.generation }),
	);
	pi.on("session_shutdown", async (e) => {
		log({ event: "session_shutdown", reason: e.reason });
		if (e.reason === "reload") return;
		if (s.child) {
			s.child.stdio[3].end();
			await new Promise((resolve) => s.child.once("exit", resolve));
		}
		s.server?.close();
		for (const sock of s.sockets) sock.destroy();
	});
	const rpc = (type, extra = {}) =>
		new Promise((resolve, reject) => {
			const id = String(++s.n);
			const timeout = setTimeout(() => {
				s.pending.delete(id);
				reject(new Error("rpc timeout"));
			}, 5000);
			s.pending.set(id, (m) => {
				clearTimeout(timeout);
				resolve(m);
			});
			s.child.stdin.write(`${JSON.stringify({ id, type, ...extra })}\n`);
		});
	pi.registerCommand("fleet-start", {
		description: "Start isolated RPC child",
		handler: async () => {
			if (s.child) return;
			s.server = net.createServer((sock) => {
				s.sockets.push(sock);
				let buffer = "";
				sock.on("data", (data) => {
					buffer += data;
					while (buffer.includes("\n")) {
						const i = buffer.indexOf("\n");
						const m = JSON.parse(buffer.slice(0, i));
						buffer = buffer.slice(i + 1);
						log({ event: "channel", frame: m });
					}
				});
			});
			await new Promise((resolve) =>
				s.server.listen(process.env.PROTO_SOCKET, resolve),
			);
			const args = [
				`${process.env.PROTO_HERE}/supervisor.py`,
				process.env.PROTO_PI,
				"--mode",
				"rpc",
				"--session-dir",
				`${process.env.PI_CODING_AGENT_DIR}/child-sessions`,
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--approve",
				"--extension",
				"builtin:mcp",
				"--extension",
				`${process.env.PROTO_HERE}/child.ts`,
			];
			s.child = spawn("python3", args, {
				cwd: process.env.PROTO_WORKTREE,
				env: process.env,
				detached: true,
				stdio: ["pipe", "pipe", "pipe", "pipe"],
			});
			s.child.stdout.on("data", (data) => {
				s.buffer += data;
				while (s.buffer.includes("\n")) {
					const i = s.buffer.indexOf("\n");
					const m = JSON.parse(s.buffer.slice(0, i));
					s.buffer = s.buffer.slice(i + 1);
					log({ event: "rpc", frame: m });
					s.pending.get(m.id)?.(m);
					s.pending.delete(m.id);
				}
			});
			s.child.stderr.on("data", (data) =>
				log({ event: "child-stderr", text: String(data) }),
			);
			await rpc("get_state");
			s.child.stdin.write(
				`${JSON.stringify({ id: "long-bash", type: "bash", command: "echo BASH_PID=$$; sleep 300 & echo SLEEP_PID=$!; wait" })}\n`,
			);
			log({ event: "started", supervisor: s.child.pid });
		},
	});
	pi.registerCommand("fleet-state", {
		description: "Probe surviving handles and channel",
		handler: async () => {
			const state = await rpc("get_state");
			const ping = await rpc("prompt", { message: "/prototype-ping" });
			log({
				event: "state",
				generation: s.generation,
				supervisor: s.child.pid,
				state,
				ping,
			});
		},
	});
	pi.registerCommand("fleet-quit", {
		description: "Orderly parent exit",
		handler: async (_args, ctx) => ctx.shutdown(),
	});
}
