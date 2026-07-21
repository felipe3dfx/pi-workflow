import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";

const PUBLIC_ENTRIES = new Set([
	"define-product",
	"deliver-ticket",
	"qa-handoff",
	"product-review",
]);

const PENDING_TOOL_REASON =
	"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities";

export interface PublicEntryCapability {
	status: "pending" | "implemented";
	allowedTools?: readonly string[];
	continueIf?: (event: InputEvent) => boolean;
	hasActiveAuthorization?: () => boolean;
	retainAfterSettled?: boolean;
	onAdmittedInput?: (event: InputEvent) => void;
	onSettled?: () => void;
}

function publicEntryName(text: string): string | undefined {
	const match = text.match(/^\/(?:skill:)?([^\s]+)(?:\s|$)/);
	return match && PUBLIC_ENTRIES.has(match[1]) ? match[1] : undefined;
}

function forbiddenBlocker(capability: string): string {
	return `status: blocked\ncode: PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN\ncapability: ${capability}\nmutation: none`;
}

export function registerPublicEntryGuard(
	pi: ExtensionAPI,
	capabilities: Partial<Record<string, PublicEntryCapability>> = {},
): void {
	let activeCapability: string | undefined;
	const clear = () => {
		activeCapability = undefined;
	};

	pi.on("input", (event, ctx) => {
		const capability = publicEntryName(event.text);
		if (capability) {
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
			capabilities[capability]?.onAdmittedInput?.(event);
			return { action: "continue" };
		}
		if (activeCapability !== undefined) {
			const descriptor = capabilities[activeCapability];
			if (
				descriptor?.status === "implemented" &&
				descriptor.continueIf?.(event)
			) {
				descriptor.onAdmittedInput?.(event);
			}
			return { action: "continue" };
		}
		for (const [name, descriptor] of Object.entries(capabilities)) {
			if (descriptor?.status !== "implemented") continue;
			if (!descriptor.continueIf?.(event)) continue;
			activeCapability = name;
			descriptor.onAdmittedInput?.(event);
			return { action: "continue" };
		}
		return { action: "continue" };
	});

	pi.on("tool_call", (event) => {
		const descriptor = activeCapability
			? capabilities[activeCapability]
			: Object.values(capabilities).find(
				(candidate) =>
					candidate?.status === "implemented" &&
					candidate.allowedTools?.includes(event.toolName),
			);
		if (!descriptor) return activeCapability ? { block: true, reason: PENDING_TOOL_REASON } : undefined;
		if (
			descriptor.status === "implemented" &&
			descriptor.allowedTools?.includes(event.toolName) &&
			descriptor.hasActiveAuthorization?.()
		)
			return undefined;
		return { block: true, reason: PENDING_TOOL_REASON };
	});
	pi.on("agent_settled", () => {
		const descriptor = activeCapability
			? capabilities[activeCapability]
			: undefined;
		descriptor?.onSettled?.();
		if (!descriptor?.hasActiveAuthorization?.() || descriptor.retainAfterSettled !== true)
			clear();
	});
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);
}
