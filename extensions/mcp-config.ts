import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPlainRecord, writeJsonAtomically } from "./agent-directory.ts";

type McpServerDefinition = Record<string, unknown>;

export type McpServerCatalog = {
	schemaVersion: number;
	mcpServers: Record<string, McpServerDefinition>;
};

export type McpServerCatalogLoadResult = {
	catalog?: McpServerCatalog;
	error?: string;
};

type McpConfigurationTarget = {
	name: string;
	current: unknown;
	existed: boolean;
	expected: McpServerDefinition;
};

export type McpConfigurationPlan = {
	changed: boolean;
	path: string;
	mergedConfig: Record<string, unknown>;
	additions: string[];
	replacements: Array<{
		name: string;
		current: unknown;
		expected: McpServerDefinition;
		keys: string[];
	}>;
	targets: McpConfigurationTarget[];
	error?: string;
};

export type McpConfigurationApplyOutcome =
	| { status: "applied"; path: string; wrote: boolean }
	| {
			status: "refused-concurrent-change";
			changedTargets: string[];
			latestPlan: McpConfigurationPlan;
	  }
	| { status: "reread-failed"; error: string }
	| { status: "write-failed"; error: string; latestPlan: McpConfigurationPlan };

export interface CompanionMcpAdapters {
	catalogPath?: string;
}

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const defaultMcpServerCatalogPath = resolve(
	packageDirectory,
	"../assets/mcp-servers.json",
);

function isMcpServerDefinition(value: unknown): value is McpServerDefinition {
	return isPlainRecord(value);
}

function loadMcpServerCatalogFromPath(
	catalogPath: string,
): McpServerCatalogLoadResult {
	try {
		const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as {
			schemaVersion?: unknown;
			mcpServers?: unknown;
		};
		if (parsed.schemaVersion !== 1) {
			return {
				error: `MCP server catalog at ${catalogPath} must define schemaVersion 1.`,
			};
		}
		if (!isPlainRecord(parsed.mcpServers)) {
			return {
				error: `MCP server catalog at ${catalogPath} must define mcpServers as an object.`,
			};
		}
		for (const [name, definition] of Object.entries(parsed.mcpServers)) {
			if (!isMcpServerDefinition(definition)) {
				return {
					error: `MCP server catalog entry ${name} must be an object.`,
				};
			}
		}
		return {
			catalog: {
				schemaVersion: 1,
				mcpServers: parsed.mcpServers as Record<string, McpServerDefinition>,
			},
		};
	} catch (error) {
		return {
			error: `Unable to load MCP server catalog at ${catalogPath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function loadMcpServerCatalog(
	mcpOptions: CompanionMcpAdapters = {},
): McpServerCatalogLoadResult {
	return loadMcpServerCatalogFromPath(
		mcpOptions.catalogPath ?? defaultMcpServerCatalogPath,
	);
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	}
	if (isPlainRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function misalignedKeys(
	current: unknown,
	expected: McpServerDefinition,
): string[] {
	const currentEntry = isPlainRecord(current) ? current : {};
	return Object.keys(expected).filter(
		(key) => !definitionsEqual(currentEntry[key], expected[key]),
	);
}

export function definitionsEqual(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function mcpConfigPath(agentDirectory: string): string {
	return resolve(agentDirectory, "mcp.json");
}

export function legacyMcpAdapterNote(agentDirectory: string): string | undefined {
	const legacyPath = resolve(agentDirectory, "mcp-adapter.json");
	if (!existsSync(legacyPath)) return undefined;
	return `${legacyPath} is no longer read. Move any servers you still need from it to ${mcpConfigPath(agentDirectory)}.`;
}

function readExistingMcpConfiguration(path: string): {
	root?: Record<string, unknown>;
	error?: string;
} {
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!isPlainRecord(parsed)) {
			return {
				error: `Refusing to overwrite malformed JSON at ${path}: top-level value must be an object.`,
			};
		}
		const currentServersValue = parsed.mcpServers;
		if (currentServersValue !== undefined && !isPlainRecord(currentServersValue)) {
			return {
				error: `Refusing to overwrite malformed JSON at ${path}: mcpServers must be an object when present.`,
			};
		}
		return { root: parsed };
	} catch (error) {
		const code =
			typeof error === "object" && error !== null
				? (error as { code?: unknown }).code
				: undefined;
		if (code === "ENOENT") return { root: {} };
		return {
			error: `Refusing to overwrite malformed JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function planMcpConfiguration(
	catalog: McpServerCatalog,
	agentDirectory: string,
): McpConfigurationPlan {
	const path = mcpConfigPath(agentDirectory);
	const loaded = readExistingMcpConfiguration(path);
	if (loaded.error || !loaded.root) {
		return {
			changed: false,
			path,
			mergedConfig: {},
			additions: [],
			replacements: [],
			targets: [],
			error: loaded.error ?? `Unable to read MCP configuration at ${path}.`,
		};
	}

	const existingRoot = loaded.root;
	const currentServersValue = existingRoot.mcpServers;
	const currentServers = isPlainRecord(currentServersValue)
		? currentServersValue
		: {};
	const targets = Object.entries(catalog.mcpServers).map(
		([name, expected]): McpConfigurationTarget => ({
			name,
			current: currentServers[name],
			existed: Object.hasOwn(currentServers, name),
			expected,
		}),
	);
	const additions = targets
		.filter((target) => !target.existed)
		.map((target) => target.name);
	const replacements = targets
		.filter((target) => target.existed)
		.map((target) => ({
			name: target.name,
			current: target.current,
			expected: target.expected,
			keys: misalignedKeys(target.current, target.expected),
		}))
		.filter((replacement) => replacement.keys.length > 0);

	return {
		changed: additions.length > 0 || replacements.length > 0,
		path,
		mergedConfig: {
			...existingRoot,
			mcpServers: {
				...currentServers,
				...Object.fromEntries(
					targets.map((target) => [
						target.name,
						{
							...(isPlainRecord(target.current) ? target.current : {}),
							...target.expected,
						},
					]),
				),
			},
		},
		additions,
		replacements,
		targets,
	};
}

function formatJsonBlock(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function manualMcpConfigurationInstructions(
	plan: McpConfigurationPlan,
	catalog: McpServerCatalog,
): string {
	const replacementLines = plan.replacements.flatMap((replacement) => [
		`- ${replacement.name}`,
		...replacement.keys.map(
			(key) =>
				`  ${key}: current ${JSON.stringify(
					isPlainRecord(replacement.current)
						? replacement.current[key]
						: replacement.current,
				)}, expected ${JSON.stringify(replacement.expected[key])}`,
		),
	]);

	return [
		"pi-workflow cannot mutate Pi configuration automatically in this context.",
		`Edit ${plan.path} manually and merge these MCP server definitions under top-level "mcpServers":`,
		formatJsonBlock(catalog.mcpServers),
		"Preserve unrelated top-level fields, unrelated MCP servers, and extra keys already set on these servers.",
		plan.replacements.length > 0
			? "Set only the differing keys below on the existing servers, after reviewing current vs expected values:"
			: "",
		...replacementLines,
		"Then run /reload and authenticate each OAuth server with /mcp login <server>, for example /mcp login sentry and /mcp login linear.",
	]
		.filter((line) => line.length > 0)
		.join("\n");
}

function changedMcpTargets(
	previewPlan: McpConfigurationPlan,
	latestPlan: McpConfigurationPlan,
): string[] {
	const latestTargets = new Map(
		latestPlan.targets.map((target) => [target.name, target]),
	);
	return previewPlan.targets
		.filter((previewTarget) => {
			const latestTarget = latestTargets.get(previewTarget.name);
			if (!latestTarget) return true;
			if (previewTarget.existed !== latestTarget.existed) return true;
			if (!previewTarget.existed) return false;
			return !definitionsEqual(previewTarget.current, latestTarget.current);
		})
		.map((target) => target.name);
}

/**
 * Re-plans against the current on-disk configuration, refuses if a target
 * changed concurrently since `plan` was produced, and otherwise writes the
 * merged configuration atomically (temp file + rename, temp file removed on
 * failure).
 */
export function applyMcpConfiguration(
	plan: McpConfigurationPlan,
	catalog: McpServerCatalog,
	agentDirectory: string,
): McpConfigurationApplyOutcome {
	const latestPlan = planMcpConfiguration(catalog, agentDirectory);
	if (latestPlan.error) {
		return { status: "reread-failed", error: latestPlan.error };
	}

	const changedTargets = changedMcpTargets(plan, latestPlan);
	if (changedTargets.length > 0) {
		return { status: "refused-concurrent-change", changedTargets, latestPlan };
	}

	if (!latestPlan.changed) {
		return { status: "applied", path: latestPlan.path, wrote: false };
	}

	try {
		writeJsonAtomically(latestPlan.path, latestPlan.mergedConfig);
		return { status: "applied", path: latestPlan.path, wrote: true };
	} catch (error) {
		return {
			status: "write-failed",
			error: error instanceof Error ? error.message : String(error),
			latestPlan,
		};
	}
}
