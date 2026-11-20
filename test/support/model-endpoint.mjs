import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

export async function modelEndpoint(agentDir, answer = "DONE") {
	const steps = Array.isArray(answer) ? [...answer] : [];
	const requests = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", async () => {
			const parsed = JSON.parse(body);
			requests.push(parsed);
			const step =
				typeof answer === "function"
					? await answer(parsed)
					: Array.isArray(answer)
						? (steps.shift() ?? "DONE")
						: answer;
			if (step.error !== undefined) {
				response.writeHead(step.status, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: step.error } }));
				return;
			}
			response.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (choice, extra = {}) =>
				response.write(
					`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: "echo", choices: choice ? [{ index: 0, ...choice }] : [], ...extra })}\n\n`,
				);
			const text = typeof step === "string" ? step : step.text;
			if (text !== undefined) {
				chunk({ delta: { role: "assistant", content: text } });
				chunk({ delta: {}, finish_reason: "stop" });
				if (step.usage) chunk(undefined, { usage: step.usage });
			} else {
				chunk({
					delta: {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: `call_${requests.length}`,
								type: "function",
								function: {
									name: step.tool,
									arguments: JSON.stringify(step.args),
								},
							},
						],
					},
				});
				chunk({ delta: {}, finish_reason: "tool_calls" });
			}
			response.end("data: [DONE]\n\n");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	await writeFile(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				fake: {
					baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
					api: "openai-completions",
					apiKey: "fixture",
					models: [{ id: "echo", cost: zero }],
				},
			},
		}),
	);
	return {
		model: "fake/echo",
		requests,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}
