import { createPiChildSession } from "../../extensions/child-sessions.ts";

export const workerTools = ["read", "bash", "edit", "write", "grep", "find", "ls", "codemode"];
export const spawnedTools = [...workerTools, "ask_parent", "report_result"];

export function piChildSession(spec) {
	return createPiChildSession({
		project: { cwd: spec.cwd, trusted: false },
		role: "explore",
		model: "faux/child",
		thinking: "high",
		prompt: "You are a child session.",
		tools: ["read", "web_search"],
		shell: {},
		onEvent: () => {},
		notify: () => {},
		ask: async () => "answer",
		report: () => {},
		...spec,
	});
}
