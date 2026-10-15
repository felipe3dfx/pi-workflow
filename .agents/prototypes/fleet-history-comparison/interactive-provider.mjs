import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export default function fixture(pi) {
 const provider = fauxProvider({ provider: "fleet-fixture", models: [{ id: "local", contextWindow: 10_000_000, maxTokens: 100_000 }], tokensPerSecond: 5000, tokenSize: { min: 256, max: 256 } });
 pi.registerProvider(provider.provider);
 pi.registerTool({ name: "fixture_result", label: "Fixture result", description: "Local representative result", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "fixture tool output\n".repeat(80) }], details: {} }; } });
 pi.on("before_agent_start", () => provider.appendResponses([
 fauxAssistantMessage(fauxToolCall("fixture_result", {}), { stopReason: "toolUse" }),
 fauxAssistantMessage("audit transcript\n".repeat(4096)),
 ]));
}
