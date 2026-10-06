import {
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export function settings(
	ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
) {
	return SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	});
}
