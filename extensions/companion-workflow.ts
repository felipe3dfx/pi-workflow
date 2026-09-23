import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyMcpConfiguration,
	loadMcpServerCatalog,
	manualMcpConfigurationInstructions,
	planMcpConfiguration,
	type CompanionMcpAdapters,
	type McpConfigurationPlan,
} from "./mcp-config.ts";

export interface CompanionPackage {
	package: string;
	description?: string;
}

interface CompanionMetadata {
	companions: CompanionPackage[];
}

type CompanionStatus = "missing" | "installed" | "error";

export interface CompanionState extends CompanionPackage {
	installedVersion?: string;
	status: CompanionStatus;
	error?: string;
}

interface CompanionLoadResult {
	companions: CompanionPackage[];
	error?: string;
}

export type NotificationLevel = "info" | "warning" | "error";

type ResolveInstalledVersion = (packageName: string) => {
	version?: string;
	error?: string;
};

export type InstallPackage = (
	spec: string,
) => Promise<{ code: number; stdout?: string; stderr?: string }>;

export interface CompanionCatalogAdapters {
	metadataPath?: string;
	resolveInstalledVersion?: ResolveInstalledVersion;
}

type ExecCapability = (
	command: string,
	args?: string[],
) => Promise<{ code: number; stdout?: string; stderr?: string }>;

export interface CompanionInteractionAdapters {
	notify?: (message: string, level?: NotificationLevel) => void;
	exec?: ExecCapability;
	installPackage?: InstallPackage;
}

export interface CompanionWorkflowOptions {
	catalog?: CompanionCatalogAdapters;
	interaction?: CompanionInteractionAdapters;
	mcp?: CompanionMcpAdapters;
}

export interface InspectResult {
	message: string;
	level: NotificationLevel;
	states: CompanionState[];
	actionable: CompanionState[];
	loadError?: string;
	metadataPath: string;
}

export interface InstallMissingResult {
	outcome:
		| "metadata-error"
		| "mcp-catalog-error"
		| "manual"
		| "failed"
		| "config-error"
		| "noop"
		| "manual-only"
		| "installed";
	message?: string;
	manualInstructions?: string;
	installable: CompanionState[];
	errored: CompanionState[];
	failures: string[];
	mcpPath?: string;
}

interface ResolvedCompanionCatalog {
	metadataPath: string;
	states: CompanionState[];
	actionable: CompanionState[];
	loadError?: string;
}

const requireFromPackage = createRequire(import.meta.url);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const companionMetadataPath = resolve(
	packageDirectory,
	"../assets/companions.json",
);

function isCompanionPackage(value: unknown): value is CompanionPackage {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as CompanionPackage).package === "string" &&
		(value as CompanionPackage).package.length > 0
	);
}

export function loadCompanionsFromPath(
	metadataPath: string,
): CompanionLoadResult {
	try {
		const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as CompanionMetadata;
		if (!Array.isArray(metadata.companions)) {
			return {
				companions: [],
				error: "Companion metadata must define companions[].",
			};
		}
		if (!metadata.companions.every(isCompanionPackage)) {
			return {
				companions: [],
				error: "Companion metadata contains invalid package entries.",
			};
		}
		return { companions: metadata.companions };
	} catch (error) {
		return {
			companions: [],
			error: `Unable to load companion metadata at ${metadataPath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function readInstalledPackageVersion(packageJsonPath: string): {
	version?: string;
	error?: string;
} {
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
		version?: unknown;
	};
	if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
		return { error: "installed package.json does not define a version" };
	}
	return { version: packageJson.version };
}

function piAgentHome(): string {
	return process.env.PI_AGENT_HOME
		? resolve(process.env.PI_AGENT_HOME)
		: resolve(process.env.HOME ?? homedir(), ".pi", "agent");
}

function piCompanionNodeModulesPaths(): string[] {
	const paths: string[] = [];
	if (process.env.PI_WORKFLOW_COMPANION_NODE_MODULES) {
		paths.push(resolve(process.env.PI_WORKFLOW_COMPANION_NODE_MODULES));
	}
	paths.push(resolve(piAgentHome(), "npm", "node_modules"));
	return paths;
}

function readPiCompanionPackageVersion(packageName: string): {
	version?: string;
	error?: string;
} {
	for (const nodeModulesPath of piCompanionNodeModulesPaths()) {
		try {
			return readInstalledPackageVersion(
				resolve(nodeModulesPath, packageName, "package.json"),
			);
		} catch (error) {
			const code =
				typeof error === "object" && error !== null
					? (error as { code?: unknown }).code
					: undefined;
			if (code === "ENOENT") continue;
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}
	return {};
}

function getInstalledCompanionVersion(packageName: string): {
	version?: string;
	error?: string;
} {
	const piInstalled = readPiCompanionPackageVersion(packageName);
	if (piInstalled.version || piInstalled.error) return piInstalled;

	try {
		const packageJsonPath = requireFromPackage.resolve(`${packageName}/package.json`);
		return readInstalledPackageVersion(packageJsonPath);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null
				? (error as { code?: unknown }).code
				: undefined;
		if (code === "MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
			return {};
		}
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function getCompanionState(
	companion: CompanionPackage,
	resolveInstalledVersion: ResolveInstalledVersion = getInstalledCompanionVersion,
): CompanionState {
	const installed = resolveInstalledVersion(companion.package);
	if (installed.error) {
		return {
			...companion,
			installedVersion: installed.version,
			status: "error",
			error: installed.error,
		};
	}
	if (!installed.version) return { ...companion, status: "missing" };
	return {
		...companion,
		installedVersion: installed.version,
		status: "installed",
	};
}

function resolveCompanionCatalog(
	catalogOptions: CompanionCatalogAdapters = {},
): ResolvedCompanionCatalog {
	const metadataPath = catalogOptions.metadataPath ?? companionMetadataPath;
	const loaded = loadCompanionsFromPath(metadataPath);
	const resolveInstalledVersion =
		catalogOptions.resolveInstalledVersion ?? getInstalledCompanionVersion;
	const states = loaded.companions.map((companion) =>
		getCompanionState(companion, resolveInstalledVersion),
	);
	return {
		metadataPath,
		states,
		actionable: states.filter((companion) => companion.status !== "installed"),
		loadError: loaded.error,
	};
}

function companionInstallSpec(companion: CompanionPackage): string {
	return `npm:${companion.package}`;
}

function resolveInstallPackage(
	interaction: CompanionInteractionAdapters,
): InstallPackage | undefined {
	if (interaction.installPackage) return interaction.installPackage;
	if (!interaction.exec) return undefined;
	const exec = interaction.exec;
	return (spec) => exec("pi", ["install", spec]);
}

function statusIcon(status: CompanionStatus): string {
	return status === "installed" ? "✓" : "✗";
}

function formatCompanionStatus(states: CompanionState[]): string {
	return states
		.map((companion) => {
			const installedVersion = companion.installedVersion
				? ` installed ${companion.installedVersion},`
				: "";
			const error = companion.error ? ` (${companion.error})` : "";
			return `${statusIcon(companion.status)} ${companion.package} —${installedVersion} ${companion.status}${error}`;
		})
		.join("\n");
}

export function manualInstallInstructions(
	companions: CompanionPackage[],
	heading: string,
): string {
	return [
		heading,
		...companions.map((companion) => `pi install ${companionInstallSpec(companion)}`),
		"Then run /reload.",
	].join("\n");
}

function notificationLevel(loadError: boolean, actionableCount: number): NotificationLevel {
	if (loadError) return "error";
	if (actionableCount > 0) return "warning";
	return "info";
}

function renderCompanionCatalogStatus(
	catalog: ResolvedCompanionCatalog,
	options: {
		heading: string;
		metadataPath?: string;
	},
): { lines: string[]; level: NotificationLevel } {
	const lines = [
		options.heading,
		"",
		"Recommended companion packages:",
		catalog.loadError
			? `Companion metadata error: ${catalog.loadError}`
			: formatCompanionStatus(catalog.states),
	];

	if (catalog.loadError) {
		lines.push(
			"",
			"Companion status is degraded; pi-workflow cannot confirm configured companion state.",
		);
	} else if (catalog.actionable.length > 0) {
		lines.push(
			"",
			"Missing or unreadable companions are installed independently. Run /pi-workflow-install-companions or install manually:",
			...catalog.actionable.map(
				(companion) => `pi install ${companionInstallSpec(companion)}`,
			),
			"Then run /reload.",
		);
	} else {
		lines.push("", "All configured companions are installed.");
	}

	if (options.metadataPath) lines.push("", `Companion metadata: ${options.metadataPath}`);

	return {
		lines,
		level: notificationLevel(Boolean(catalog.loadError), catalog.actionable.length),
	};
}

function notify(
	interaction: CompanionInteractionAdapters,
	message: string,
	level: NotificationLevel,
) {
	interaction.notify?.(message, level);
}

function emptyInstallResult(
	outcome: InstallMissingResult["outcome"],
	extra: Partial<InstallMissingResult> = {},
): InstallMissingResult {
	return {
		outcome,
		installable: [],
		errored: [],
		failures: [],
		...extra,
	};
}

export function createCompanionWorkflow(options: CompanionWorkflowOptions = {}) {
	const interaction = options.interaction ?? {};

	return {
		async inspect(): Promise<InspectResult> {
			const catalog = resolveCompanionCatalog(options.catalog);
			const { lines, level } = renderCompanionCatalogStatus(catalog, {
				heading: "pi-workflow companion status",
				metadataPath: catalog.metadataPath,
			});
			const message = lines.join("\n");
			notify(interaction, message, level);
			return {
				message,
				level,
				states: catalog.states,
				actionable: catalog.actionable,
				loadError: catalog.loadError,
				metadataPath: catalog.metadataPath,
			};
		},

		async diagnose(): Promise<InspectResult> {
			const catalog = resolveCompanionCatalog(options.catalog);
			const { lines, level } = renderCompanionCatalogStatus(catalog, {
				heading: "pi-workflow companion doctor",
				metadataPath: catalog.metadataPath,
			});
			const message = lines.join("\n");
			notify(interaction, message, level);
			return {
				message,
				level,
				states: catalog.states,
				actionable: catalog.actionable,
				loadError: catalog.loadError,
				metadataPath: catalog.metadataPath,
			};
		},

		async installMissing(apply = false): Promise<InstallMissingResult> {
			const catalog = resolveCompanionCatalog(options.catalog);
			if (catalog.loadError) {
				notify(interaction, catalog.loadError, "error");
				return emptyInstallResult("metadata-error", {
					message: catalog.loadError,
				});
			}

			const loadedMcp = loadMcpServerCatalog(options.mcp);
			if (!loadedMcp.catalog) {
				const message = loadedMcp.error ?? "Unable to load the MCP server catalog.";
				notify(interaction, message, "error");
				return emptyInstallResult("mcp-catalog-error", { message });
			}

			const mcpPlan = planMcpConfiguration(loadedMcp.catalog, options.mcp);
			if (mcpPlan.error) {
				notify(interaction, mcpPlan.error, "error");
				return emptyInstallResult("config-error", {
					message: mcpPlan.error,
					mcpPath: mcpPlan.path,
				});
			}

			const installable = catalog.states.filter((companion) => companion.status === "missing");
			const errored = catalog.states.filter((companion) => companion.status === "error");
			const manualInstructions = [
				manualInstallInstructions(
					[...installable, ...errored],
					"Install or update pi-workflow companions manually:",
				),
				manualMcpConfigurationInstructions(mcpPlan, loadedMcp.catalog),
			].join("\n\n");
			const base = {
				installable,
				errored,
				manualInstructions,
				mcpPath: mcpPlan.path,
			};
			const hasWork = installable.length > 0 || errored.length > 0 || mcpPlan.changed;
			if (!hasWork) {
				const message = "All configured companions are installed and MCP configuration matches the catalog.";
				notify(interaction, message, "info");
				return emptyInstallResult("noop", { message, mcpPath: mcpPlan.path });
			}

			if (!apply) {
				const message = `${manualInstructions}\n\nRe-run /pi-workflow-install-companions --apply to confirm this install.`;
				notify(interaction, message, "warning");
				return { outcome: "manual", message, ...base, failures: [] };
			}

			if (installable.length === 0 && !mcpPlan.changed) {
				notify(interaction, manualInstructions, "error");
				return { outcome: "manual-only", message: manualInstructions, ...base, failures: [] };
			}

			const installPackage = resolveInstallPackage(interaction);
			if (!installPackage) {
				notify(interaction, manualInstructions, "warning");
				return { outcome: "manual-only", message: manualInstructions, ...base, failures: [] };
			}

			const failures: string[] = [];
			for (const companion of installable) {
				const spec = companionInstallSpec(companion);
				notify(interaction, `Installing ${spec}...`, "info");
				const result = await installPackage(spec);
				if (result.code !== 0) {
					failures.push(
						`${spec} exited ${result.code}${result.stderr ? `: ${result.stderr}` : ""}`,
					);
				}
			}
			if (failures.length > 0) {
				const message = `Companion install stopped:\n${failures.join("\n")}`;
				notify(interaction, message, "error");
				return { outcome: "failed", message, ...base, failures };
			}

			return finishMcpApply(interaction, mcpPlan, loadedMcp.catalog, options.mcp, base);
		},
	};
}

async function finishMcpApply(
	interaction: CompanionInteractionAdapters,
	mcpPlan: McpConfigurationPlan,
	catalog: NonNullable<ReturnType<typeof loadMcpServerCatalog>["catalog"]>,
	mcp: CompanionMcpAdapters | undefined,
	base: Pick<InstallMissingResult, "installable" | "errored" | "manualInstructions" | "mcpPath">,
): Promise<InstallMissingResult> {
	const applied = applyMcpConfiguration(mcpPlan, catalog, mcp);
	if (applied.status === "applied") {
		const message = applied.wrote
			? `Installed companions and updated MCP configuration at ${applied.path}. Run /reload.`
			: "Installed companions. MCP configuration already matched the catalog. Run /reload.";
		notify(interaction, message, base.errored.length > 0 ? "warning" : "info");
		return { outcome: "installed", message, ...base, failures: [] };
	}
	if (applied.status === "refused-concurrent-change") {
		const message = `Refusing to write MCP configuration because these entries changed: ${applied.changedTargets.join(", ")}.`;
		notify(interaction, message, "error");
		return { outcome: "config-error", message, ...base, failures: [] };
	}
	const message =
		applied.status === "reread-failed"
			? applied.error
			: `Unable to write MCP configuration: ${applied.error}`;
	notify(interaction, message, "error");
	return { outcome: "config-error", message, ...base, failures: [] };
}
