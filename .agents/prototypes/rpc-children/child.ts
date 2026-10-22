import net from "node:net";
import { Type } from "@earendil-works/pi-ai";
export default function (pi) {
	const sock = net.createConnection(process.env.PROTO_SOCKET);
	let seq = 0,
		buffer = "";
	const pending = new Map();
	const emit = (value) =>
		sock.write(`${JSON.stringify({ pid: process.pid, ...value })}\n`);
	sock.on("error", (error) =>
		console.error("prototype channel:", error.message),
	);
	sock.on("data", (data) => {
		buffer += data;
		while (buffer.includes("\n")) {
			const i = buffer.indexOf("\n");
			const m = JSON.parse(buffer.slice(0, i));
			buffer = buffer.slice(i + 1);
			pending.get(m.id)?.(m.answer);
			pending.delete(m.id);
		}
	});
	const ask = (kind, message, signal) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, resolve);
			emit({ kind, id, message });
			if (signal)
				signal.addEventListener(
					"abort",
					() => {
						pending.delete(id);
						emit({ kind: "withdraw", id });
						reject(new Error("aborted"));
					},
					{ once: true },
				);
		});
	const result = (data) => ({
		content: [{ type: "text", text: JSON.stringify(data) }],
		details: data,
	});
	const tool = (name, parameters, execute) =>
		pi.registerTool({
			name,
			label: name,
			description: `Disposable prototype ${name}`,
			parameters,
			execute,
		});
	tool(
		"ask_parent",
		Type.Object({ question: Type.String() }),
		async (_id, p, signal) =>
			result({ answer: await ask("ask_parent", p.question, signal) }),
	);
	tool(
		"report_result",
		Type.Object({ verdict: Type.String() }),
		async (_id, p) => {
			emit({ kind: "report_result", ...p });
			return result(p);
		},
	);
	tool(
		"guarded_bash",
		Type.Object({ command: Type.String() }),
		async (_id, p, signal, _u, ctx) => {
			if (p.command.includes("FORBIDDEN"))
				throw new Error("forbidden command blocked by guarded_bash");
			return await ctx.executeTool("bash", { command: p.command }, { signal });
		},
	);
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		emit({ kind: "tool_call", input: event.input });
		if (event.input.command.includes("DENY"))
			return { block: true, reason: "authorization denied" };
		if (event.input.command.includes("CONSULT")) {
			const answer = await ask(
				"authorize",
				"replace CONSULT with approved printf?",
			);
			if (answer !== "allow") return { block: true, reason: "parent denied" };
			event.input.command = "printf authorized-replacement";
		}
	});
	tool(
		"prototype_scenario",
		Type.Object({}),
		async (_id, _p, signal, _u, ctx) => {
			const out = {};
			out.ask = await ctx.executeTool(
				"ask_parent",
				{ question: "Reply ACK after a short delay" },
				{ signal },
			);
			for (const [key, name, args] of [
				["guard", "guarded_bash", { command: "printf FORBIDDEN" }],
				["blocked", "bash", { command: "printf DENY" }],
				["replaced", "bash", { command: "printf CONSULT" }],
				["reported", "report_result", { verdict: "prototype-pass" }],
			]) {
				try {
					out[key] = await ctx.executeTool(name, args, { signal });
				} catch (e) {
					out[key] = { error: String(e) };
				}
			}
			emit({ kind: "scenario", out });
			return result(out);
		},
	);
	pi.registerCommand("prototype-check", {
		description: "Deterministic check of command context",
		handler: async (_args, ctx) => {
			emit({ kind: "command-context", executeTool: typeof ctx.executeTool });
			if (ctx.executeTool) {
				const r = await ctx.executeTool("prototype_scenario", {});
				emit({ kind: "command-result", result: r });
			}
		},
	});
	pi.registerCommand("prototype-ping", {
		description: "Channel ping",
		handler: async () => emit({ kind: "ping" }),
	});
	pi.on("session_start", () => emit({ kind: "session_start" }));
	pi.on("session_shutdown", (e) => {
		emit({ kind: "shutdown", event: e });
		sock.end();
	});
}
