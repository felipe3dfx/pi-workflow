import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const [name, pidDir, delayMs = "0"] = process.argv.slice(2);
writeFileSync(join(pidDir, `${name}.pid`), String(process.pid));

const results = {
	initialize: (params) => ({
		protocolVersion: params.protocolVersion,
		capabilities: { tools: {}, resources: {} },
		serverInfo: { name, version: "1.0.0" },
	}),
	ping: () => ({}),
	"tools/list": () => ({
		tools: [
			{
				name: "echo",
				description: `Echo text from ${name}.`,
				inputSchema: {
					type: "object",
					properties: { text: { type: "string" } },
					required: ["text"],
				},
			},
		],
	}),
	"tools/call": (params) => ({
		content: [{ type: "text", text: `${name} echoes ${params.arguments.text}` }],
	}),
	"resources/list": () => ({
		resources: [{ uri: `fixture://${name}/note`, name: "note" }],
	}),
	"resources/templates/list": () => ({ resourceTemplates: [] }),
	"resources/read": (params) => ({
		contents: [{ uri: params.uri, text: `${name} note` }],
	}),
};

createInterface({ input: process.stdin }).on("line", async (line) => {
	const message = JSON.parse(line);
	if (message.id === undefined) return;
	if (message.method === "initialize") await delay(Number(delayMs));
	const result = results[message.method];
	process.stdout.write(
		`${JSON.stringify(
			result
				? { jsonrpc: "2.0", id: message.id, result: result(message.params) }
				: {
						jsonrpc: "2.0",
						id: message.id,
						error: { code: -32601, message: "Method not found" },
					},
		)}\n`,
	);
});
process.stdin.on("end", () => process.exit(0));
