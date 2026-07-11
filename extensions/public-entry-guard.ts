import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PUBLIC_ENTRIES = new Set([
	"define-product",
	"deliver-ticket",
	"qa-handoff",
	"product-review",
]);

const PENDING_TOOL_REASON =
	"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities";

function publicEntryName(text: string): string | undefined {
	const match = text.match(/^\/(?:skill:)?([^\s]+)(?:\s|$)/);
	return match && PUBLIC_ENTRIES.has(match[1]) ? match[1] : undefined;
}

function forbiddenBlocker(capability: string): string {
	return `status: blocked\ncode: PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN\ncapability: ${capability}\nmutation: none`;
}

export function registerPublicEntryGuard(pi: ExtensionAPI): void {
	let activeCapability: string | undefined;
	const clear = () => {
		activeCapability = undefined;
	};

	pi.on("input", (event, ctx) => {
		const capability = publicEntryName(event.text);
		if (!capability) return { action: "continue" };
		if (
			activeCapability !== undefined ||
			event.source !== "interactive" ||
			event.streamingBehavior !== undefined ||
			!ctx.isIdle()
		) {
			ctx.ui.notify(forbiddenBlocker(capability), "error");
			return { action: "handled" };
		}
		activeCapability = capability;
		return { action: "continue" };
	});

	pi.on("tool_call", () =>
		activeCapability
			? { block: true, reason: PENDING_TOOL_REASON }
			: undefined,
	);
	pi.on("agent_settled", clear);
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);
}
