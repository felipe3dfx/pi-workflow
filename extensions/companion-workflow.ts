import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyMcpConfiguration,
	defaultMcpServerCatalogPath,
	formatJsonBlock,
	loadMcpServerCatalog,
	manualMcpConfigurationInstructions,
	mcpConfigPath,
	planMcpConfiguration,
	emptyMcpConfigurationPlan,
	type CompanionMcpAdapters,
	type McpConfigurationPlan,
	type McpServerCatalog,
} from "./mcp-config.ts";

export interface CompanionPackage {
	package: string;
	version: string;
	description?: string;
}

interface CompanionMetadata {
	companions: CompanionPackage[];
}

export type CompanionStatus =
	| "missing"
	| "version-mismatch"
	| "installed"
	| "error";

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

export type ResolveInstalledVersion = (packageName: string) => {
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

export interface CompanionInteractionAdapters {
	notify?: (message: string, level?: NotificationLevel) => void;
	confirm?: (
		title: string,
		message: string,
		options?: unknown,
	) => Promise<boolean>;
	installPackage?: InstallPackage;
}

export interface CompanionDiagnosticAdapters {
	exec: (
		command: string,
		args?: string[],
	) => Promise<{ code: number; stdout?: string; stderr?: string }>;
	cwd: () => string;
	directoryExists: (path: string) => Promise<boolean> | boolean;
}

export interface CodeGraphReadiness {
	companion: CompanionState | undefined;
	cli: "available" | "missing";
	index: "present" | "missing" | "unknown";
	messages: string[];
}

export interface CompanionWorkflowOptions {
	catalog?: CompanionCatalogAdapters;
	interaction?: CompanionInteractionAdapters;
	diagnostics?: CompanionDiagnosticAdapters;
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

export interface DiagnoseResult extends InspectResult {
	readiness?: CodeGraphReadiness;
}

export interface InstallMissingResult {
	outcome:
		| "metadata-error"
		| "mcp-catalog-error"
		| "manual"
		| "canceled"
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

interface CompanionInstallPlan {
	installable: CompanionState[];
	errored: CompanionState[];
	manualInstructions: string;
}

const requireFromPackage = createRequire(import.meta.url);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const companionMetadataPath = resolve(packageDirectory, "../assets/companions.json");
const codeGraphPackageName = "@vndv/pi-codegraph";

function isCompanionPackage(value: unknown): value is CompanionPackage {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as CompanionPackage).package === "string" &&
		(value as CompanionPackage).package.length > 0 &&
		typeof (value as CompanionPackage).version === "string" &&
		(value as CompanionPackage).version.length > 0
	);
}

export function loadCompanionsFromPath(
	metadataPath: string,
): CompanionLoadResult {
	try {
		const metadata = JSON.parse(
			readFileSync(metadataPath, "utf8"),
		) as CompanionMetadata;
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
	if (
		typeof packageJson.version !== "string" ||
		packageJson.version.length === 0
	) {
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
		const packageJsonPath = requireFromPackage.resolve(
			`${packageName}/package.json`,
		);
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
	if (!installed.version) {
		return { ...companion, status: "missing" };
	}
	if (installed.version !== companion.version) {
		return {
			...companion,
			installedVersion: installed.version,
			status: "version-mismatch",
		};
	}
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
	const actionable = states.filter(
		(companion) => companion.status !== "installed",
	);

	return {
		metadataPath,
		states,
		actionable,
		loadError: loaded.error,
	};
}

function companionInstallSpec(companion: CompanionPackage): string {
	return `npm:${companion.package}@${companion.version}`;
}

function statusIcon(status: CompanionStatus): string {
	if (status === "installed") return "✓";
	if (status === "version-mismatch") return "!";
	return "✗";
}

function formatCompanionStatus(states: CompanionState[]): string {
	return states
		.map((companion) => {
			const installedVersion = companion.installedVersion
				? ` installed ${companion.installedVersion},`
				: "";
			const error = companion.error ? ` (${companion.error})` : "";
			return `${statusIcon(companion.status)} ${companion.package}@${companion.version} —${installedVersion} ${companion.status}${error}`;
		})
		.join("\n");
}

export function manualInstallInstructions(
	companions: CompanionPackage[],
	heading: string,
): string {
	return [
		heading,
		...companions.map(
			(companion) => `pi install ${companionInstallSpec(companion)}`,
		),
		"Then run /reload.",
	].join("\n");
}

function notificationLevel(
	loadError: boolean,
	actionableCount: number,
): NotificationLevel {
	if (loadError) return "error";
	if (actionableCount > 0) return "warning";
	return "info";
}

function isCodeGraphReadinessDegraded(readiness: CodeGraphReadiness): boolean {
	return readiness.cli === "missing" || readiness.index !== "present";
}

export async function getCodeGraphReadiness({
	companion,
	exec,
	cwd,
	directoryExists,
}: CompanionDiagnosticAdapters & {
	companion?: CompanionState;
}): Promise<CodeGraphReadiness> {
	let cli: CodeGraphReadiness["cli"] = "available";
	let index: CodeGraphReadiness["index"] = "unknown";
	const messages: string[] = [];

	try {
		const result = await exec("codegraph", ["--version"]);
		cli = result.code === 0 ? "available" : "missing";
	} catch {
		cli = "missing";
	}

	try {
		index = (await directoryExists(resolve(cwd(), ".codegraph")))
			? "present"
			: "missing";
	} catch {
		index = "unknown";
	}

	if (companion?.status !== "installed") {
		messages.push("CodeGraph companion: missing or mismatched.");
	}
	if (cli === "missing") {
		messages.push(
			"CodeGraph CLI: missing. Install or expose the codegraph command on PATH.",
		);
	} else {
		messages.push("CodeGraph CLI: available.");
	}

	if (index === "missing") {
		messages.push(
			"CodeGraph index: missing. Run codegraph init <project-root> explicitly before relying on CodeGraph.",
		);
	} else if (index === "unknown") {
		messages.push(
			"CodeGraph index: unknown; pi-workflow could not inspect .codegraph.",
		);
	} else {
		messages.push("CodeGraph index: present.");
	}

	if (
		companion?.status === "installed" &&
		cli === "available" &&
		index === "present"
	) {
		messages.push("CodeGraph: ready.");
	}

	return { companion, cli, index, messages };
}

function renderCompanionCatalogStatus(
	catalog: ResolvedCompanionCatalog,
	options: {
		heading: string;
		metadataPath?: string;
		readiness?: CodeGraphReadiness;
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
			"Missing, mismatched, or unreadable companions are installed independently. Run /pi-workflow-install-companions or install manually:",
			...catalog.actionable.map(
				(companion) => `pi install ${companionInstallSpec(companion)}`,
			),
			"Then run /reload.",
		);
	} else {
		lines.push(
			"",
			"All configured companions are installed at the expected versions.",
		);
	}

	if (options.metadataPath) {
		lines.push("", `Companion metadata: ${options.metadataPath}`);
	}

	const readinessDegraded = options.readiness
		? isCodeGraphReadinessDegraded(options.readiness)
		: false;
	if (options.readiness) {
		lines.push("", "CodeGraph readiness:", ...options.readiness.messages);
	}

	return {
		lines,
		level: notificationLevel(
			Boolean(catalog.loadError),
			catalog.actionable.length + (readinessDegraded ? 1 : 0),
		),
	};
}

function createCompanionInstallPlan(
	states: CompanionState[],
): CompanionInstallPlan {
	const installable = states.filter(
		(companion) =>
			companion.status === "missing" || companion.status === "version-mismatch",
	);
	const errored = states.filter((companion) => companion.status === "error");
	const manualInstructions = manualInstallInstructions(
		[...installable, ...errored],
		"Install or update pi-workflow companions manually:",
	);

	return { installable, errored, manualInstructions };
}

function notify(
	interaction: CompanionInteractionAdapters,
	message: string,
	level: NotificationLevel,
) {
	interaction.notify?.(message, level);
}

function formatMcpServerList(
	names: string[],
	catalog: McpServerCatalog,
): string[] {
	return names.flatMap((name) => [
		`- ${name}`,
		formatJsonBlock(catalog.mcpServers[name]),
	]);
}

function installConfirmationMessage(
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
): { title: string; message: string } {
	const messageLines = [
		companionPlan.installable.length > 0
			? "This explicit pi-workflow install will mutate only confirmed harness resources:"
			: "This explicit pi-workflow install will configure only confirmed harness resources:",
	];

	if (companionPlan.installable.length > 0) {
		messageLines.push(
			"",
			"Companion packages to install or update:",
			...companionPlan.installable.map(
				(companion) => `- pi install ${companionInstallSpec(companion)}`,
			),
		);
	}

	if (mcpPlan.changed) {
		messageLines.push(
			"",
			`MCP configuration target: ${mcpPlan.path}`,
			"Unrelated top-level fields and unrelated MCP servers will be preserved.",
		);
		if (mcpPlan.additions.length > 0) {
			messageLines.push(
				"",
				"Add MCP server definitions:",
				...formatMcpServerList(mcpPlan.additions, catalog),
			);
		}
		if (mcpPlan.replacements.length > 0) {
			messageLines.push("", "Replace MCP server definitions:");
			for (const replacement of mcpPlan.replacements) {
				messageLines.push(
					`- ${replacement.name}`,
					"Current:",
					formatJsonBlock(replacement.current),
					"Expected:",
					formatJsonBlock(replacement.expected),
				);
			}
		}
	}

	messageLines.push("", "Continue?");

	let title = "Install pi-workflow companions?";
	if (companionPlan.installable.length > 0 && mcpPlan.changed) {
		title = "Install pi-workflow companions and configure MCP servers?";
	} else if (mcpPlan.changed) {
		title = "Configure MCP servers for pi-workflow?";
	}

	return { title, message: messageLines.join("\n") };
}

function companionOutcomeLines(
	failures: string[],
	companionPlan: CompanionInstallPlan,
): string[] {
	if (failures.length > 0) {
		return [
			"Some companion installs failed:",
			...failures,
			"",
			companionPlan.manualInstructions,
			"",
		];
	}
	if (companionPlan.installable.length > 0) {
		return ["Installed or updated pi-workflow companions.", ""];
	}
	return ["Companion packages were already installed.", ""];
}

function combineManualInstructions(...sections: string[]): string {
	return sections
		.map((section) => section.trim())
		.filter((section) => section.length > 0)
		.join("\n\n")
		.trim();
}

function manualMcpCatalogInstructions(
	mcpOptions: CompanionMcpAdapters = {},
): string {
	const catalogPath = mcpOptions.catalogPath ?? defaultMcpServerCatalogPath;
	return [
		`Repair ${catalogPath} so it is valid JSON with schemaVersion 1 and an object top-level "mcpServers" map.`,
		"Then run /pi-workflow-install-companions again, /reload, and authenticate Sentry/Linear as needed.",
	].join("\n");
}

function manualHarnessInstructions(
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
): string {
	return combineManualInstructions(
		companionPlan.installable.length > 0 || companionPlan.errored.length > 0
			? companionPlan.manualInstructions
			: "",
		mcpPlan.changed || mcpPlan.error
			? manualMcpConfigurationInstructions(mcpPlan, catalog)
			: "",
	);
}

async function installCompanionPackages(
	interaction: CompanionInteractionAdapters,
	installable: CompanionState[],
): Promise<string[]> {
	const failures: string[] = [];

	for (const companion of installable) {
		const spec = companionInstallSpec(companion);
		notify(interaction, `Installing ${spec}...`, "info");
		try {
			const result = await interaction.installPackage?.(spec);
			if (result?.code !== 0) {
				failures.push(
					`${spec}: ${result?.stderr?.trim() || result?.stdout?.trim() || `exit code ${result?.code ?? "unknown"}`}`,
				);
			}
		} catch (error) {
			failures.push(
				`${spec}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return failures;
}

export function createCompanionWorkflow(
	options: CompanionWorkflowOptions = {},
) {
	const catalog = options.catalog ?? {};
	const interaction = options.interaction ?? {};
	const diagnostics = options.diagnostics;
	const mcp = options.mcp ?? {};

	return {
		async inspect(): Promise<InspectResult> {
			const resolvedCatalog = resolveCompanionCatalog(catalog);
			const { lines, level } = renderCompanionCatalogStatus(resolvedCatalog, {
				heading: "pi-workflow companion status",
			});
			const message = lines.join("\n");
			notify(interaction, message, level);
			return {
				message,
				level,
				states: resolvedCatalog.states,
				actionable: resolvedCatalog.actionable,
				loadError: resolvedCatalog.loadError,
				metadataPath: resolvedCatalog.metadataPath,
			};
		},

		async diagnose(): Promise<DiagnoseResult> {
			const resolvedCatalog = resolveCompanionCatalog(catalog);
			const codeGraphCompanion = resolvedCatalog.states.find(
				(companion) => companion.package === codeGraphPackageName,
			);
			const readiness =
				codeGraphCompanion && diagnostics
					? await getCodeGraphReadiness({
							...diagnostics,
							companion: codeGraphCompanion,
						})
					: undefined;

			const { lines, level } = renderCompanionCatalogStatus(resolvedCatalog, {
				heading: "pi-workflow companion doctor",
				metadataPath: resolvedCatalog.metadataPath,
				readiness,
			});
			const message = lines.join("\n");
			notify(interaction, message, level);
			return {
				message,
				level,
				states: resolvedCatalog.states,
				actionable: resolvedCatalog.actionable,
				loadError: resolvedCatalog.loadError,
				metadataPath: resolvedCatalog.metadataPath,
				readiness,
			};
		},

		async installMissing(): Promise<InstallMissingResult> {
			const resolvedCatalog = resolveCompanionCatalog(catalog);
			if (resolvedCatalog.loadError) {
				const message = [
					`Companion metadata error: ${resolvedCatalog.loadError}`,
					"Cannot determine companion install commands automatically. Check assets/companions.json and retry.",
				].join("\n");
				notify(interaction, message, "error");
				return {
					outcome: "metadata-error",
					message,
					installable: [],
					errored: [],
					failures: [],
				};
			}

			const companionPlan = createCompanionInstallPlan(resolvedCatalog.states);
			// finish() is defined here (not at the top of installMissing) so its
			// installable/errored defaults can read companionPlan directly; the
			// metadata-error return above precedes the plan and stays inline.
			const finish = (options: {
				level: NotificationLevel;
				outcome: InstallMissingResult["outcome"];
				message: string;
				installable?: InstallMissingResult["installable"];
				errored?: InstallMissingResult["errored"];
				failures?: InstallMissingResult["failures"];
				manualInstructions?: InstallMissingResult["manualInstructions"];
				mcpPath?: InstallMissingResult["mcpPath"];
			}): InstallMissingResult => {
				const {
					level,
					outcome,
					message,
					installable = companionPlan.installable,
					errored = companionPlan.errored,
					failures = [],
					manualInstructions,
					mcpPath,
				} = options;
				notify(interaction, message, level);
				return {
					outcome,
					message,
					installable,
					errored,
					failures,
					manualInstructions,
					mcpPath,
				};
			};
			const loadedMcpCatalog = loadMcpServerCatalog(mcp);
			if (loadedMcpCatalog.error || !loadedMcpCatalog.catalog) {
				const manualInstructions = combineManualInstructions(
					companionPlan.installable.length > 0 || companionPlan.errored.length > 0
						? companionPlan.manualInstructions
						: "",
					manualMcpCatalogInstructions(mcp),
				);
				const message = [
					`MCP server catalog error: ${loadedMcpCatalog.error ?? "Unknown MCP server catalog error."}`,
					"Cannot determine MCP server configuration automatically.",
					"",
					manualInstructions,
				].join("\n");

				if (companionPlan.installable.length === 0) {
					return finish({
						level: "error",
						outcome: "mcp-catalog-error",
						message,
						manualInstructions,
						mcpPath: mcpConfigPath(mcp),
					});
				}

				if (!interaction.confirm || !interaction.installPackage) {
					return finish({
						level: "warning",
						outcome: "manual",
						message,
						manualInstructions,
						mcpPath: mcpConfigPath(mcp),
					});
				}

				const confirmation = installConfirmationMessage(
					companionPlan,
					emptyMcpConfigurationPlan(mcp),
					{ schemaVersion: 1, mcpServers: {} },
				);
				let confirmed: boolean;
				try {
					confirmed = await interaction.confirm(
						confirmation.title,
						confirmation.message,
					);
				} catch (error) {
					const confirmationMessage = [
						`Could not confirm pi-workflow companion install automatically: ${error instanceof Error ? error.message : String(error)}`,
						"",
						manualInstructions,
					].join("\n");
					return finish({
						level: "warning",
						outcome: "manual",
						message: confirmationMessage,
						manualInstructions,
						mcpPath: mcpConfigPath(mcp),
					});
				}
				if (!confirmed) {
					const canceledMessage =
						"Canceled. No companion packages or MCP configuration were changed.";
					return finish({
						level: "info",
						outcome: "canceled",
						message: canceledMessage,
						manualInstructions,
						mcpPath: mcpConfigPath(mcp),
					});
				}

				const failures = await installCompanionPackages(
					interaction,
					companionPlan.installable,
				);
				const postInstallMessage = [
					...companionOutcomeLines(failures, companionPlan),
					`MCP server catalog error: ${loadedMcpCatalog.error ?? "Unknown MCP server catalog error."}`,
					"No MCP configuration changes were written automatically.",
					"",
					manualMcpCatalogInstructions(mcp),
				].join("\n");
				return finish({
					level: "error",
					outcome: "failed",
					message: postInstallMessage,
					failures,
					manualInstructions,
					mcpPath: mcpConfigPath(mcp),
				});
			}

			const mcpPlan = planMcpConfiguration(loadedMcpCatalog.catalog, mcp);
			const mcpConfigBlocked = Boolean(mcpPlan.error);
			const confirmationPlan = mcpConfigBlocked
				? emptyMcpConfigurationPlan(mcp)
				: mcpPlan;
			const manualInstructions = manualHarnessInstructions(
				companionPlan,
				mcpPlan,
				loadedMcpCatalog.catalog,
			);
			if (mcpPlan.error && companionPlan.installable.length === 0) {
				const message = [mcpPlan.error, "", manualInstructions].join("\n");
				return finish({
					level: "error",
					outcome: "config-error",
					message,
					manualInstructions,
					mcpPath: mcpPlan.path,
				});
			}

			if (
				companionPlan.installable.length === 0 &&
				companionPlan.errored.length === 0 &&
				!mcpPlan.changed
			) {
				const message =
					"pi-workflow companions are installed and MCP servers are already configured.";
				return finish({
					level: "info",
					outcome: "noop",
					message,
					mcpPath: mcpPlan.path,
				});
			}

			if (companionPlan.errored.length > 0) {
				notify(
					interaction,
					[
						"Some companion versions could not be inspected:",
						...companionPlan.errored.map(
							(companion) =>
								`${companion.package}: ${companion.error ?? "unknown error"}`,
						),
						"",
						companionPlan.manualInstructions,
					].join("\n"),
					"warning",
				);
			}

			if (companionPlan.installable.length === 0 && !mcpPlan.changed) {
				// Deliberately not finish(): manual-only emits no notification and
				// carries no user-facing message, so there is nothing for finish() to do.
				return {
					outcome: "manual-only",
					manualInstructions: companionPlan.manualInstructions,
					installable: [],
					errored: companionPlan.errored,
					failures: [],
					mcpPath: mcpPlan.path,
				};
			}

			const needsInstallPackage = companionPlan.installable.length > 0;
			if (!interaction.confirm || (needsInstallPackage && !interaction.installPackage)) {
				return finish({
					level: "warning",
					outcome: "manual",
					message: manualInstructions,
					manualInstructions,
					mcpPath: mcpPlan.path,
				});
			}

			const confirmation = installConfirmationMessage(
				companionPlan,
				confirmationPlan,
				loadedMcpCatalog.catalog,
			);
			let confirmed: boolean;
			try {
				confirmed = await interaction.confirm(
					confirmation.title,
					confirmation.message,
				);
			} catch (error) {
				const message = [
					`Could not confirm pi-workflow companion install automatically: ${error instanceof Error ? error.message : String(error)}`,
					"",
					manualInstructions,
				].join("\n");
				return finish({
					level: "warning",
					outcome: "manual",
					message,
					manualInstructions,
					mcpPath: mcpPlan.path,
				});
			}
			if (!confirmed) {
				const message =
					"Canceled. No companion packages or MCP configuration were changed.";
				return finish({
					level: "info",
					outcome: "canceled",
					message,
					manualInstructions,
					mcpPath: mcpPlan.path,
				});
			}

			const failures = await installCompanionPackages(
				interaction,
				companionPlan.installable,
			);
			if (mcpConfigBlocked) {
				const message = [
					...companionOutcomeLines(failures, companionPlan),
					mcpPlan.error ??
						`Unable to read MCP configuration at ${mcpPlan.path}.`,
					"No MCP configuration changes were written automatically.",
					"",
					manualMcpConfigurationInstructions(
						mcpPlan,
						loadedMcpCatalog.catalog,
					),
				].join("\n");
				return finish({
					level: "error",
					outcome: "failed",
					message,
					failures,
					manualInstructions,
					mcpPath: mcpPlan.path,
				});
			}

			let finalMcpPath = mcpPlan.path;
			let wroteMcp = false;
			if (mcpPlan.changed) {
				const applyOutcome = applyMcpConfiguration(
					mcpPlan,
					loadedMcpCatalog.catalog,
					mcp,
				);

				if (applyOutcome.status === "reread-failed") {
					const message = [
						...companionOutcomeLines(failures, companionPlan),
						`MCP configuration at ${mcpPlan.path} could not be re-read after confirmation: ${applyOutcome.error}`,
						"No MCP configuration changes were written.",
						"",
						manualMcpConfigurationInstructions(
							mcpPlan,
							loadedMcpCatalog.catalog,
						),
					].join("\n");
					return finish({
						level: "error",
						outcome: "failed",
						message,
						failures,
						manualInstructions: manualHarnessInstructions(
							companionPlan,
							mcpPlan,
							loadedMcpCatalog.catalog,
						),
						mcpPath: mcpPlan.path,
					});
				}

				if (applyOutcome.status === "write-failed") {
					const latestMcpPlan = applyOutcome.latestPlan;
					const message = [
						...companionOutcomeLines(failures, companionPlan),
						`Could not write pi-workflow MCP servers to ${latestMcpPlan.path}: ${applyOutcome.error}`,
						"No MCP configuration changes were written automatically.",
						"",
						manualMcpConfigurationInstructions(
							latestMcpPlan,
							loadedMcpCatalog.catalog,
						),
					].join("\n");
					return finish({
						level: "error",
						outcome: "failed",
						message,
						failures,
						manualInstructions: manualHarnessInstructions(
							companionPlan,
							latestMcpPlan,
							loadedMcpCatalog.catalog,
						),
						mcpPath: latestMcpPlan.path,
					});
				}

				if (applyOutcome.status === "refused-concurrent-change") {
					const latestMcpPlan = applyOutcome.latestPlan;
					const message = [
						...companionOutcomeLines(failures, companionPlan),
						`MCP configuration at ${mcpPlan.path} changed after preview. No MCP configuration changes were written.`,
						"Affected MCP server names:",
						...applyOutcome.changedTargets.map((name) => `- ${name}`),
						"",
						`Review ${mcpPlan.path} and run /pi-workflow-install-companions again to confirm against the latest configuration.`,
						"",
						manualMcpConfigurationInstructions(
							latestMcpPlan,
							loadedMcpCatalog.catalog,
						),
					].join("\n");
					return finish({
						level: "error",
						outcome: "failed",
						message,
						failures,
						manualInstructions: manualHarnessInstructions(
							companionPlan,
							latestMcpPlan,
							loadedMcpCatalog.catalog,
						),
						mcpPath: mcpPlan.path,
					});
				}

				finalMcpPath = applyOutcome.path;
				wroteMcp = applyOutcome.wrote;
			}

			const configuredMcp = wroteMcp
				? `Configured pi-workflow MCP servers at ${finalMcpPath}.`
				: "MCP servers were already configured.";
			if (failures.length > 0) {
				const message = [
					configuredMcp,
					"Some companion installs failed:",
					...failures,
					"",
					companionPlan.manualInstructions,
					"",
					"Run /reload after the companion installs are fixed. Authenticate Sentry/Linear as needed.",
				].join("\n");
				return finish({
					level: "error",
					outcome: "failed",
					message,
					failures,
					manualInstructions: companionPlan.manualInstructions,
					mcpPath: finalMcpPath,
				});
			}
			if (companionPlan.errored.length > 0) {
				const unresolvedInstructions = manualInstallInstructions(
					companionPlan.errored,
					"Install or update pi-workflow companions manually:",
				);
				const message = [
					configuredMcp,
					"Some companion versions could not be inspected:",
					...companionPlan.errored.map(
						(companion) =>
							`${companion.package}: ${companion.error ?? "unknown error"}`,
					),
					"",
					unresolvedInstructions,
					"",
					"Run /reload after the unresolved companions are fixed. Authenticate Sentry/Linear as needed.",
				].join("\n");
				return finish({
					level: "error",
					outcome: "failed",
					message,
					manualInstructions: unresolvedInstructions,
					mcpPath: finalMcpPath,
				});
			}

			const actionSummary =
				companionPlan.installable.length > 0
					? `${configuredMcp} Installed or updated pi-workflow companions.`
					: configuredMcp;
			const message =
				`${actionSummary} Run /reload. Authenticate Sentry/Linear as needed. pi-workflow does not connect or authenticate MCP servers during installation.`;
			return finish({
				level: "info",
				outcome: "installed",
				message,
				manualInstructions,
				mcpPath: finalMcpPath,
			});
		},
	};
}
