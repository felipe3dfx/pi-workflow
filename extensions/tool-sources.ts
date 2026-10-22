import {
	createCodemodeExtension,
	createToolSearchExtension,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

export interface CommonToolSources {
	paths?: readonly string[];
	factories?: readonly ExtensionFactory[];
	active?: readonly string[];
}

const defaults = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"codemode",
	"tool_search",
];

export function commonToolFactories(
	sources: CommonToolSources,
): ExtensionFactory[] {
	return [
		createCodemodeExtension({ models: false }),
		createToolSearchExtension(),
		...(sources.factories ?? []),
		(pi) => {
			pi.on("session_start", () => {
				pi.setActiveTools([
					...new Set([...pi.getActiveTools(), ...(sources.active ?? defaults)]),
				]);
			});
		},
	];
}
