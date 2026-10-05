import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyMcpConfiguration,
	legacyMcpAdapterNote,
	loadMcpServerCatalog,
	manualMcpConfigurationInstructions,
	planMcpConfiguration,
	type CompanionMcpAdapters,
	type McpConfigurationPlan,
} from "./mcp-config.ts";
import {
	applyPiSettings,
	loadPiSettingsCatalog,
	manualPiSettingsInstructions,
	type PiSettingsAdapters,
	type PiSettingsCatalog,
	planPiSettings,
} from "./pi-settings.ts";

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

interface CompanionCatalogAdapters {
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
	settings?: PiSettingsAdapters;
	expectedPackages?: () => readonly string[];
}

export interface InspectResult {
	message: string;
	level: NotificationLevel;
	states: CompanionState[];
	actionable: CompanionState[];
	loadError?: string;
	metadataPath: string;
}

export interface SetupResult {
	outcome:
		| "metadata-error"
		| "mcp-catalog-error"
		| "settings-catalog-error"
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
	settingsPath?: string;
}

interface ResolvedCompanionCatalog {
	metadataPath: string;
	states: CompanionState[];
	actionable: CompanionState[];
	loadError?: string;
	collidingPackages: (typeof collidingPackages)[number][];
	legacySpawnPackageBlocked: boolean;
	legacySpawnPackageError?: string;
}

const collidingPackages = [
	{
		name: "@heyhuynhgiabuu/pi-pretty",
		conflict:
			"registers the same tool names as pi-workflow (read, bash, grep, find, ls)",
	},
	{
		name: "pi-powerline-footer",
		conflict: "replaces the same header, footer, and editor as pi-workflow",
	},
	{
		name: "pi-mcp-adapter",
		conflict:
			"replaces Pi's built-in /mcp, so Pi ignores mcp.json while it is installed",
	},
];
const legacySpawnPackage = "@tintinweb/pi-subagents";

const requireFromPackage = createRequire(import.meta.url);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
export const companionMetadataPath = resolve(
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

function spawnToolsAllowed(legacySpawnPackageState: {
	version?: string;
	error?: string;
}): boolean {
	return !legacySpawnPackageState.version && !legacySpawnPackageState.error;
}

function legacySpawnPackageWarningLines(error?: string): string[] {
	return [
		error
			? `${legacySpawnPackage} may be installed (its install state could not be confirmed: ${error}). Spawn tools are not registered while it remains. Remove it yourself:`
			: `${legacySpawnPackage} is installed and spawn tools are not registered while it remains. Remove it yourself:`,
		`pi remove npm:${legacySpawnPackage}`,
		"Then run /reload.",
	];
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
	const legacySpawnPackageState = resolveInstalledVersion(legacySpawnPackage);
	return {
		metadataPath,
		states,
		actionable: states.filter((companion) => companion.status !== "installed"),
		loadError: loaded.error,
		collidingPackages: collidingPackages.filter(
			({ name }) => resolveInstalledVersion(name).version,
		),
		legacySpawnPackageBlocked: !spawnToolsAllowed(legacySpawnPackageState),
		legacySpawnPackageError: legacySpawnPackageState.error,
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

function notificationLevel(loadError: boolean, needsAttention: boolean): NotificationLevel {
	if (loadError) return "error";
	if (needsAttention) return "warning";
	return "info";
}

type Alignment = {
	heading: string;
	path?: string;
	misaligned: string[];
	conflicts?: string[];
	error?: string;
	note?: string;
};

function mcpAlignment(mcp: CompanionMcpAdapters | undefined): Alignment {
	const heading = "MCP configuration:";
	const loaded = loadMcpServerCatalog(mcp);
	if (!loaded.catalog) {
		return {
			heading,
			misaligned: [],
			error: loaded.error ?? "Unable to load the MCP server catalog.",
		};
	}
	const plan = planMcpConfiguration(loaded.catalog, mcp);
	return {
		heading,
		path: plan.path,
		misaligned: [
			...plan.additions,
			...plan.replacements.map((replacement) => replacement.name),
		],
		error: plan.error,
		note: legacyMcpAdapterNote(mcp),
	};
}

function settingsAlignment(
	settings: PiSettingsAdapters | undefined,
): Alignment {
	const heading = "Default settings:";
	const loaded = loadPiSettingsCatalog(settings);
	if (!loaded.catalog) {
		return {
			heading,
			misaligned: [],
			error: loaded.error ?? "Unable to load the settings catalog.",
		};
	}
	const plan = planPiSettings(loaded.catalog, settings);
	return {
		heading,
		path: plan.path,
		misaligned: plan.misaligned,
		conflicts: plan.conflicts,
		error: plan.error,
	};
}

function alignmentLines(alignment: Alignment): string[] {
	const note = alignment.note ? [alignment.note] : [];
	if (alignment.error)
		return ["", alignment.heading, `✗ ${alignment.error}`, ...note];
	const conflicts = alignment.conflicts ?? [];
	if (alignment.misaligned.length > 0 || conflicts.length > 0) {
		return [
			"",
			alignment.heading,
			`✗ ${alignment.path} — not aligned: ${[...alignment.misaligned, ...conflicts].join(", ")}`,
			...(alignment.misaligned.length > 0
				? ["Run /workflow:configure to align it."]
				: []),
			...note,
		];
	}
	return ["", alignment.heading, `✓ ${alignment.path} — aligned`, ...note];
}

function renderCompanionCatalogStatus(
	catalog: ResolvedCompanionCatalog,
	options: {
		heading: string;
		metadataPath?: string;
		alignments: Alignment[];
		expected?: ReadonlySet<string>;
	},
): { lines: string[]; level: NotificationLevel } {
	const degraded = catalog.actionable.filter((companion) =>
		options.expected?.has(companion.package),
	);
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
	} else if (degraded.length > 0) {
		lines.push(
			"",
			"Missing or unreadable companions are installed independently. Run /workflow:configure or install manually:",
			...degraded.map(
				(companion) => `pi install ${companionInstallSpec(companion)}`,
			),
			"Then run /reload.",
		);
	} else {
		lines.push("", "All configured companions are installed.");
	}

	lines.push(...collisionLines(catalog));

	if (catalog.legacySpawnPackageBlocked) {
		lines.push("", ...legacySpawnPackageWarningLines(catalog.legacySpawnPackageError));
	}

	for (const alignment of options.alignments) lines.push(...alignmentLines(alignment));

	if (options.metadataPath) lines.push("", `Companion metadata: ${options.metadataPath}`);

	return {
		lines,
		level: notificationLevel(
			Boolean(catalog.loadError) ||
				options.alignments.some((alignment) => alignment.error),
			degraded.length > 0 ||
				catalog.collidingPackages.length > 0 ||
				catalog.legacySpawnPackageBlocked ||
				options.alignments.some(
					(alignment) =>
						alignment.misaligned.length > 0 ||
						(alignment.conflicts?.length ?? 0) > 0,
				),
		),
	};
}

function collisionLines(catalog: ResolvedCompanionCatalog) {
	return catalog.collidingPackages.flatMap(({ name, conflict }) => [
		"",
		`${name} is installed and ${conflict}. pi-workflow does not remove it. Remove it yourself:`,
		`pi remove npm:${name}`,
		"Then run /reload.",
	]);
}

function notify(
	interaction: CompanionInteractionAdapters,
	message: string,
	level: NotificationLevel,
) {
	interaction.notify?.(message, level);
}

function emptyInstallResult(
	outcome: SetupResult["outcome"],
	extra: Partial<SetupResult> = {},
): SetupResult {
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

	async function reportStatus(heading: string): Promise<InspectResult> {
		const catalog = resolveCompanionCatalog(options.catalog);
		const expected = new Set(options.expectedPackages?.() ?? []);
		const degraded = catalog.actionable.filter((companion) =>
			expected.has(companion.package),
		);
		const { lines, level } = renderCompanionCatalogStatus(catalog, {
			heading,
			metadataPath: catalog.metadataPath,
			alignments: [
				mcpAlignment(options.mcp),
				settingsAlignment(options.settings),
			],
			expected,
		});
		const message = lines.join("\n");
		notify(interaction, message, level);
		return {
			message,
			level,
			states: catalog.states,
			actionable: degraded,
			loadError: catalog.loadError,
			metadataPath: catalog.metadataPath,
		};
	}

	return {
		async checkSpawnTools(): Promise<{ allowed: boolean }> {
			const resolveInstalledVersion =
				options.catalog?.resolveInstalledVersion ?? getInstalledCompanionVersion;
			const legacySpawnPackageState = resolveInstalledVersion(legacySpawnPackage);
			const allowed = spawnToolsAllowed(legacySpawnPackageState);
			if (!allowed) {
				notify(
					interaction,
					legacySpawnPackageWarningLines(legacySpawnPackageState.error).join("\n"),
					"warning",
				);
			}
			return { allowed };
		},

		inspect: () => reportStatus("pi-workflow companion status"),
		diagnose: () => reportStatus("pi-workflow companion doctor"),

		async setup(expectedPackages?: readonly string[]): Promise<SetupResult> {
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

			const legacyNote = legacyMcpAdapterNote(options.mcp);
			if (legacyNote) notify(interaction, legacyNote, "info");

			const mcpPlan = planMcpConfiguration(loadedMcp.catalog, options.mcp);
			if (mcpPlan.error) {
				notify(interaction, mcpPlan.error, "error");
				return emptyInstallResult("config-error", {
					message: mcpPlan.error,
					mcpPath: mcpPlan.path,
				});
			}

			const loadedSettings = loadPiSettingsCatalog(options.settings);
			if (!loadedSettings.catalog) {
				const message = loadedSettings.error ?? "Unable to load the settings catalog.";
				notify(interaction, message, "error");
				return emptyInstallResult("settings-catalog-error", { message });
			}

			const settingsPlan = planPiSettings(loadedSettings.catalog, options.settings);
			if (settingsPlan.error) {
				notify(interaction, settingsPlan.error, "error");
				return emptyInstallResult("config-error", {
					message: settingsPlan.error,
					settingsPath: settingsPlan.path,
				});
			}

			const expected = expectedPackages
				? new Set(expectedPackages)
				: undefined;
			const installable = catalog.states.filter(
				(companion) =>
					companion.status === "missing" &&
					(!expected || expected.has(companion.package)),
			);
			const errored = catalog.states.filter(
				(companion) =>
					companion.status === "error" &&
					(!expected || expected.has(companion.package)),
			);
			const manualInstructions = [
				manualInstallInstructions(
					[...installable, ...errored],
					"Install or update pi-workflow companions manually:",
				),
				manualMcpConfigurationInstructions(mcpPlan, loadedMcp.catalog),
				manualPiSettingsInstructions(settingsPlan, loadedSettings.catalog),
			].join("\n\n");
			const base = {
				installable,
				errored,
				manualInstructions,
				mcpPath: mcpPlan.path,
				settingsPath: settingsPlan.path,
			};
			const hasWork =
				installable.length > 0 || errored.length > 0 || mcpPlan.changed || settingsPlan.changed;
			if (!hasWork) {
				const message =
					"All configured companions are installed, MCP configuration matches the catalog, and default settings are applied.";
				const full = [message, ...collisionLines(catalog)].join("\n");
				notify(
					interaction,
					full,
					catalog.collidingPackages.length > 0 ? "warning" : "info",
				);
				return emptyInstallResult("noop", {
					message: full,
					mcpPath: mcpPlan.path,
					settingsPath: settingsPlan.path,
				});
			}

			if (
				installable.length === 0 &&
				!mcpPlan.changed &&
				!settingsPlan.changed
			) {
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
			return finishApply(
				interaction,
				mcpPlan,
				loadedMcp.catalog,
				loadedSettings.catalog,
				options,
				base,
				catalog,
				failures,
			);
		},
	};
}

async function finishApply(
	interaction: CompanionInteractionAdapters,
	mcpPlan: McpConfigurationPlan,
	catalog: NonNullable<ReturnType<typeof loadMcpServerCatalog>["catalog"]>,
	settingsCatalog: PiSettingsCatalog,
	options: CompanionWorkflowOptions,
	base: Pick<
		SetupResult,
		"installable" | "errored" | "manualInstructions" | "mcpPath" | "settingsPath"
	>,
	companions: ResolvedCompanionCatalog,
	failures: string[] = [],
): Promise<SetupResult> {
	const noted = (text: string) =>
		failures.length > 0
			? `Companion install failed:\n${failures.join("\n")}\n${text}`
			: text;
	const applied = applyMcpConfiguration(mcpPlan, catalog, options.mcp);
	if (applied.status === "refused-concurrent-change") {
		const message = noted(
			`Refusing to write MCP configuration because these entries changed: ${applied.changedTargets.join(", ")}.`,
		);
		notify(interaction, message, "error");
		return { outcome: "config-error", message, ...base, failures };
	}
	if (applied.status !== "applied") {
		const message = noted(
			applied.status === "reread-failed"
				? applied.error
				: `Unable to write MCP configuration: ${applied.error}`,
		);
		notify(interaction, message, "error");
		return { outcome: "config-error", message, ...base, failures };
	}
	const settings = applyPiSettings(settingsCatalog, options.settings);
	const installedCount = base.installable.length - failures.length;
	if (settings.error) {
		const done = [
			installedCount > 0 ? "Companions were installed." : undefined,
			applied.wrote
				? `MCP configuration was updated at ${applied.path}.`
				: undefined,
		].filter((line) => line !== undefined);
		const message = noted(
			done.length > 0
				? `${settings.error}\n${done.join(" ")} Run /reload to pick these up, then fix the settings error and run /workflow:configure again.`
				: settings.error,
		);
		notify(interaction, message, "error");
		return { outcome: "config-error", message, ...base, failures };
	}
	const summary = [
		installedCount > 0
			? applied.wrote
				? `Installed companions and updated MCP configuration at ${applied.path}.`
				: "Installed companions. MCP configuration already matched the catalog."
			: applied.wrote
				? `Updated MCP configuration at ${applied.path}.`
				: "MCP configuration already matched the catalog.",
		settings.wrote
			? `Applied default settings at ${settings.path}. Restart Pi to apply them; /reload is not enough.`
			: "Default settings already matched the catalog. Run /reload.",
	].join(" ");
	const message = noted(
		[
			base.errored.length > 0
				? `${summary}\n\nThese companions need attention:\n${base.manualInstructions}`
				: summary,
			...collisionLines(companions),
		].join("\n"),
	);
	notify(
		interaction,
		message,
		failures.length > 0
			? "error"
			: base.errored.length > 0 || companions.collidingPackages.length > 0
				? "warning"
				: "info",
	);
	return {
		outcome: failures.length > 0 ? "failed" : "installed",
		message,
		...base,
		failures,
	};
}
