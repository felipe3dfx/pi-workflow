import readline from "node:readline";
import { appendFileSync } from "node:fs";
const log = (value) =>
	appendFileSync(
		process.env.PROTO_MCP_LOG,
		`${JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd(), label: process.env.PROTO_LABEL, ...value })}\n`,
	);
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
log({ event: "start" });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const m = JSON.parse(line);
	log({ event: "receive", message: m });
	if (m.method === "initialize")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: {
				protocolVersion: m.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "proto", version: "1" },
			},
		});
	else if (m.method === "notifications/initialized")
		send({ jsonrpc: "2.0", id: "roots", method: "roots/list" });
	else if (m.method === "tools/list")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: {
				tools: [
					{
						name: "ping",
						description: "ping",
						inputSchema: { type: "object", properties: {} },
					},
				],
			},
		});
	else if (m.method === "tools/call")
		send({
			jsonrpc: "2.0",
			id: m.id,
			result: { content: [{ type: "text", text: "pong" }] },
		});
});
