import {
	createLocalBashOperations,
	type ExtensionAPI,
	type ExtensionContext,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { insideChildTree } from "./process-tree.ts";

export const USER_BASH_TURN_TYPE = "pi-workflow-user-bash-turn";

const notice =
	"The user ran a shell command; its output is in the message above. React to it.";

export function registerUserBashTurn(pi: ExtensionAPI) {
	let pending = false;
	const trigger = () => {
		pending = false;
		pi.sendMessage(
			{ customType: USER_BASH_TURN_TYPE, content: notice, display: false },
			{ triggerTurn: true },
		);
	};
	const finished = (ctx: ExtensionContext) => {
		try {
			if (ctx.isIdle()) trigger();
			else pending = true;
		} catch {
			// The session ended or was replaced before the trigger; its ctx is stale.
		}
	};

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
					// Pi records the output synchronously after exec settles, so the trigger waits a macrotask
					// to follow it; while the agent runs, Pi holds the record until just before agent_settled.
					if (!options.signal?.aborted) setTimeout(() => finished(ctx), 0);
					return result;
				},
			},
		};
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (pending && ctx.isIdle()) trigger();
	});
}
