import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

export default function fixture(pi) {
	const provider = fauxProvider({
		provider: "fleet-fixture",
		models: [{ id: "local", contextWindow: 10_000_000, maxTokens: 100_000 }],
		tokensPerSecond: 20_000,
		tokenSize: { min: 256, max: 256 },
	});
	pi.registerProvider(provider.provider);
	pi.on("before_agent_start", () => {
		provider.appendResponses([fauxAssistantMessage("audit transcript\n".repeat(4096))]);
	});
	let deltas = 0;
	pi.on("message_update", (event) => {
		if (event.assistantMessageEvent.type !== "text_delta") return;
		deltas++;
		if (process.env.FLEET_CRASH === "stream" && deltas === 8) crash("stream", deltas);
	});
	pi.on("agent_settled", () => {
		if (process.env.FLEET_CRASH === "settled") crash("settled", deltas);
	});
}

function crash(checkpoint, deltas) {
	const root = process.env.FLEET_FIXTURE_ROOT;
	if (!root || process.env.FLEET_OWNED_PROCESS !== "1") throw new Error("Not an owned fixture process");
	writeFileSync(join(root, "checkpoint.json"), JSON.stringify({ checkpoint, deltas }));
	process.kill(process.pid, "SIGKILL");
}
