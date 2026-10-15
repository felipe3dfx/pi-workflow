import { resultParameters, verdictNeedsNoReason } from "../../../extensions/child-projection.ts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAskParentTool } from "../../../extensions/child-sessions.ts";
import { createChildBashTool } from "../../../extensions/child-bash.ts";
import { createChildCodeGraphTool } from "../../../extensions/codegraph-tool.ts";

export default function brokerFixture(pi) {
	const provider = fauxProvider({ provider: "broker-fixture", models: [{ id: "local" }], tokensPerSecond: 100000 });
	pi.registerProvider(provider.provider);
	const ask = createAskParentTool(async () => { throw new Error("Context required"); });
	pi.registerTool({ ...ask, async execute(id, params, signal, _update, ctx) {
		return createAskParentTool(async (question, abort) => {
			const reply = await ctx.ui.input(question, "fixture parent answer", { signal: abort, timeout: 3000 });
			if (reply === undefined) throw new Error("Fixture question withdrawn");
			return reply;
		}).execute(id, params, signal);
	} });
	pi.registerTool(createChildBashTool(process.cwd()));
	pi.registerTool(createChildCodeGraphTool(process.cwd()));
	pi.registerTool({ name: "report_result", label: "Report", description: "Fixture result broker", parameters: resultParameters.worker, async execute(_id, params, _signal, _update, ctx) {
		if (!verdictNeedsNoReason(params.verdict) && !params.reason) throw new Error("Reason required");
		ctx.ui.notify(`fixture-report:${JSON.stringify(params)}`);
		return { content: [{ type: "text", text: "Result recorded." }], details: {} };
	} });
	pi.on("before_agent_start", (event) => {
		provider.setResponses(event.prompt === "cancel" ? [
			fauxAssistantMessage(fauxToolCall("ask_parent", { question: "Cancel this pending question?" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("unexpected continuation"),
		] : [
			fauxAssistantMessage(fauxToolCall("ask_parent", { question: "Which fixture value?" }), { stopReason: "toolUse" }),
			(context) => {
				const result = context.messages.filter((message) => message.role === "toolResult").at(-1);
				if (!result?.content.some((block) => block.type === "text" && block.text === "fixture-parent-reply")) throw new Error("Parent reply did not reach provider context");
				return fauxAssistantMessage(fauxToolCall("bash", { command: "printf 'fixture bash\\n'" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage(fauxToolCall("codegraph", { operation: "query", query: "fixture" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("report_result", { verdict: "partial", reason: "first report", files_changed: [], validation: [], left_undone: ["fixture pending"] }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("report_result", { verdict: "done", files_changed: [], validation: [], left_undone: [] }), { stopReason: "toolUse" }),
			fauxAssistantMessage("fixture broker finished"),
		]);
	});
}
