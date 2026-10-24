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
