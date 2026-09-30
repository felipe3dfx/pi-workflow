import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

export function offerTool(pi: ExtensionAPI, tool: object, on: boolean) {
	pi.registerTool({
		...tool,
		exposure: on ? "direct" : "hidden",
	} as RegisteredTool);
}
