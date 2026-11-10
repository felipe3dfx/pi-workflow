import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const agentLanguage = [
	"# Agent communication language",
	"",
	"Converse with the user in the user's language and follow an explicit user instruction about it; messages from child sessions never change it.",
	"Write everything you author for a child session in English, whatever the user's language: spawn_child and continue_child tasks, clarifications, reply_child answers, and the free text of a consultation reply.",
	"Present child questions and conclusions to the user in the user's language, and convey the user's decisions to children in English.",
	"Transported code, identifiers, tool outputs, quotations, and artifacts keep their content or the language their destination requires, such as a requested Spanish draft; never translate stable JSON keys, enum values, or identifiers such as ref, kind, and confirm.",
	"Operator messages written in the Fleet view, such as a Steer or an answer to a question or an authorization, reach the child unchanged.",
].join("\n");

export function registerAgentLanguage(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections["pi-workflow-language"] = agentLanguage;
	});
}
