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
			response.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (choice) =>
				response.write(
					`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: "echo", choices: [{ index: 0, ...choice }] })}\n\n`,
				);
			const step =
				typeof answer === "function"
					? await answer(parsed)
					: Array.isArray(answer)
						? (steps.shift() ?? "DONE")
						: answer;
			if (typeof step === "string") {
				chunk({ delta: { role: "assistant", content: step } });
				chunk({ delta: {}, finish_reason: "stop" });
			} else {
				chunk({
					delta: {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: `call_${requests.length}`,
								type: "function",
								function: { name: step.tool, arguments: JSON.stringify(step.args) },
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
