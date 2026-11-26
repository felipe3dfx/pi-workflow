import {
	createLocalBashOperations,
	type ExtensionAPI,
	type ExtensionContext,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { insideChildTree } from "./process-tree.ts";

const USER_BASH_TURN_TYPE = "pi-workflow-user-bash-turn";

const notice =
	"The user ran a shell command; its output is in the message above. React to it.";

export function registerUserBashTurn(pi: ExtensionAPI) {
	let pending = false;
	// Deferred a macrotask so Pi has recorded the output first; while the agent runs, Pi holds the
	// record until just before agent_settled. One idle moment consumes every pending completion.
	const drain = (ctx: ExtensionContext) =>
		setTimeout(() => {
			try {
				if (!pending || !ctx.isIdle()) return;
				pending = false;
				pi.sendMessage(
					{ customType: USER_BASH_TURN_TYPE, content: notice, display: false },
					{ triggerTurn: true },
				);
			} catch {
				// The session ended or was replaced before the trigger; its ctx is stale.
			}
		}, 0);

	pi.on("user_bash", (event, ctx) => {
		// RPC still fires user_bash and reports hasUI, so the mode is the gate.
		if (event.excludeFromContext || ctx.mode !== "tui" || insideChildTree())
			return undefined;
		// Pi's own `!` path builds its operations from the normalized shellPath setting.
		const shellPath = SettingsManager.inMemory({
			shellPath: pi.getSettings().shellPath,
		}).getShellPath();
		const local = createLocalBashOperations({ shellPath });
		return {
			operations: {
				exec: async (command, cwd, options) => {
					const result = await local.exec(command, cwd, options);
					if (!options.signal?.aborted) {
						pending = true;
						drain(ctx);
					}
					return result;
				},
			},
		};
	});

	pi.on("agent_settled", (_event, ctx) => {
		drain(ctx);
	});
}
