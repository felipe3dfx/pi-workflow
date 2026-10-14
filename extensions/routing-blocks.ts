import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// Pi skips tool_result for blocked calls, so presentation provenance lives in session entries.
const entryType = "pi-workflow-routing-block";
type Destination = "leave" | "decide";
const blocks = new Map<string, Destination>();

export function routingBlock(toolCallId: string | undefined) {
	return toolCallId === undefined ? undefined : blocks.get(toolCallId);
}

export function routingLabel(destination: Destination) {
	return destination === "leave" ? "Delegated by Jev" : "Decision needed";
}

export function registerRoutingBlocks(pi: ExtensionAPI) {
	function restore(_event: unknown, ctx: ExtensionContext) {
		blocks.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== entryType) continue;
			const data = entry.data;
			if (
				typeof data === "object" &&
				data !== null &&
				"toolCallId" in data &&
				typeof data.toolCallId === "string" &&
				"destination" in data &&
				(data.destination === "leave" || data.destination === "decide")
			) {
				blocks.set(data.toolCallId, data.destination);
			}
		}
	}
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	return (toolCallId: string, destination: Destination) => {
		pi.appendEntry(entryType, { toolCallId, destination });
		blocks.set(toolCallId, destination);
	};
}
