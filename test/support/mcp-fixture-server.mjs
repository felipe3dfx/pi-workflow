import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const [name, pidDir, delayMs = "0", scenario] = process.argv.slice(2);
writeFileSync(join(pidDir, `${name}.pid`), String(process.pid));
appendFileSync(join(pidDir, `${name}.pids`), `${process.pid}\n`);
writeFileSync(join(pidDir, `${name}.cwd`), process.cwd());

let lateToolAdvertised = false;
const lateToolScenario = scenario === "late-tool" || scenario === "authorization";
const listedTools = () => [
	{
		name: "echo",
		description: `Echo text from ${name}.`,
		inputSchema: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		},
	},
	...(lateToolScenario
		? lateToolAdvertised
			? [{
					name: "lookup_release_fact",
					description: "Return the independent proof token DYNAMIC_TOOL_RESULT_240 for the requested release fact.",
					inputSchema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
				}]
			: [{
					name: "publish_late_tool",
					description: "Fixture barrier: publish the late release-fact tool, then return after tools/list_changed is sent.",
					inputSchema: { type: "object", properties: {}, additionalProperties: false },
				}]
		: []),
];

const results = {
	initialize: (params) => ({
		protocolVersion: params.protocolVersion,
		capabilities: { tools: lateToolScenario ? { listChanged: true } : {}, resources: {} },
		serverInfo: { name, version: "1.0.0" },
	}),
	ping: () => ({}),
	"tools/list": () => ({ tools: listedTools() }),
	"tools/call": (params) => {
		if (scenario === "authorization") appendFileSync(join(pidDir, `${name}.calls`), `${params.name}\n`);
		if (lateToolScenario && params.name === "publish_late_tool") {
			lateToolAdvertised = true;
			process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`);
			return { content: [{ type: "text", text: "Late release-fact tool advertised; list_changed notification sent." }] };
		}
		if (lateToolScenario && params.name === "lookup_release_fact") {
			return { content: [{ type: "text", text: "DYNAMIC_TOOL_RESULT_240" }] };
		}
		return { content: [{ type: "text", text: `${name} echoes ${params.arguments.text}` }] };
	},

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
	if (scenario === "roots" && message.method === "notifications/initialized") {
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "roots", method: "roots/list" })}\n`);
	}
	if (message.id === "roots" && message.method === undefined) {
		writeFileSync(join(pidDir, `${name}.roots`), JSON.stringify(message.result ?? message.error));
		return;
	}
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
