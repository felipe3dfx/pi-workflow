import { setTimeout as delay } from "node:timers/promises";

import { shutdownDeadline } from "../../extensions/child-handle.ts";
import { createRpcChildSession } from "../../extensions/rpc-child.ts";

const { command, sessionRoot, cwd, model, ending } = JSON.parse(process.argv[2]);
const handle = await createRpcChildSession({ command, sessionRoot })({
	cwd,
	project: { cwd, trusted: false },
	role: "worker",
	model,
	thinking: "off",
	prompt: "You are a child session. Answer DONE.",
	tools: ["read", "mcp__*"],
	shell: {},
	onEvent() {},
	notify() {},
	ask: async () => "answer",
	report() {},
	checkpointed() {},
});
process.stdout.write(`${await handle.run("Say done.")}\n`);
process.stdin.once("data", async () => {
	if (ending !== "shutdown") return;
	await Promise.race([handle.dispose(), delay(shutdownDeadline)]);
	process.exit(0);
});
