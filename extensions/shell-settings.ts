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

export function shellOptions(
	ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
) {
	const user = settings(ctx);
	return {
		commandPrefix: user.getShellCommandPrefix(),
		shellPath: user.getShellPath(),
	};
}
