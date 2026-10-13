import { createPiChildSession } from "../../extensions/child-sessions.ts";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import process from "node:process";

export const workerTools = ["read", "bash", "edit", "write", "grep", "find", "ls", "codemode"];
export const spawnedTools = [...workerTools, "ask_parent", "report_result"];

export function installedPackagePath(agentDir, source, scope = "user") {
	return new DefaultPackageManager({
		cwd: process.cwd(),
		agentDir,
		settingsManager: SettingsManager.create(process.cwd(), agentDir, {
			projectTrusted: false,
		}),
	}).getInstalledPath(source, scope);
}

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
