import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
		| "noop"
		| "manual"
		| "manual-only"
		| "canceled"
		| "installed"
		| "failed";
	message?: string;
	manualInstructions?: string;
	installable: CompanionState[];
	errored: CompanionState[];
	failures: string[];
}

interface ResolvedCompanionCatalog {
	metadataPath: string;
	states: CompanionState[];
	actionable: CompanionState[];
	loadError?: string;
}

const requireFromPackage = createRequire(import.meta.url);
const companionMetadataPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../assets/companions.json",
);
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

function loadCompanionsFromPath(metadataPath: string): CompanionLoadResult {
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

function piCompanionNodeModulesPaths(): string[] {
	const paths = [];
	if (process.env.PI_WORKFLOW_COMPANION_NODE_MODULES) {
		paths.push(resolve(process.env.PI_WORKFLOW_COMPANION_NODE_MODULES));
	}

	const piAgentHome = process.env.PI_AGENT_HOME
		? resolve(process.env.PI_AGENT_HOME)
		: resolve(process.env.HOME ?? homedir(), ".pi", "agent");
	paths.push(resolve(piAgentHome, "npm", "node_modules"));

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
		if (
			code === "MODULE_NOT_FOUND" ||
			code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
		) {
			return {};
		}
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function getCompanionState(
	companion: CompanionPackage,
	resolveInstalledVersion: ResolveInstalledVersion,
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

function manualInstallInstructions(
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

interface CompanionInstallPlan {
	installable: CompanionState[];
	errored: CompanionState[];
	manualInstructions: string;
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

async function getCodeGraphReadiness({
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

function installConfirmationMessage(installable: CompanionState[]): string {
	return [
		"This will run pi install for missing or mismatched companion packages:",
		"",
		...installable.map(
			(companion) => `pi install ${companionInstallSpec(companion)}`,
		),
		"",
		"Continue?",
	].join("\n");
}

function buildInspectionLines(
	heading: string,
	catalog: ResolvedCompanionCatalog,
): string[] {
	const lines = [
		heading,
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

	return lines;
}

export function createCompanionWorkflow(
	options: CompanionWorkflowOptions = {},
) {
	const catalog = options.catalog ?? {};
	const interaction = options.interaction ?? {};
	const diagnostics = options.diagnostics;

	return {
		async inspect(): Promise<InspectResult> {
			const resolvedCatalog = resolveCompanionCatalog(catalog);
			const level = notificationLevel(
				Boolean(resolvedCatalog.loadError),
				resolvedCatalog.actionable.length,
			);
			const message = buildInspectionLines(
				"pi-workflow companion status",
				resolvedCatalog,
			).join("\n");
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
			const lines = buildInspectionLines(
				"pi-workflow companion doctor",
				resolvedCatalog,
			);
			lines.push("", `Companion metadata: ${resolvedCatalog.metadataPath}`);

			let readiness: CodeGraphReadiness | undefined;
			let diagnosticReadinessDegraded = false;
			const codeGraphCompanion = resolvedCatalog.states.find(
				(companion) => companion.package === codeGraphPackageName,
			);
			if (codeGraphCompanion && diagnostics) {
				readiness = await getCodeGraphReadiness({
					...diagnostics,
					companion: codeGraphCompanion,
				});
				diagnosticReadinessDegraded = isCodeGraphReadinessDegraded(readiness);
				lines.push("", "CodeGraph readiness:", ...readiness.messages);
			}

			const level = notificationLevel(
				Boolean(resolvedCatalog.loadError),
				resolvedCatalog.actionable.length +
					(diagnosticReadinessDegraded ? 1 : 0),
			);
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

			const plan = createCompanionInstallPlan(resolvedCatalog.states);
			if (plan.installable.length === 0 && plan.errored.length === 0) {
				const message =
					"All configured pi-workflow companions are installed at the expected versions.";
				notify(interaction, message, "info");
				return {
					outcome: "noop",
					message,
					installable: [],
					errored: [],
					failures: [],
				};
			}

			if (plan.errored.length > 0) {
				notify(
					interaction,
					[
						"Some companion versions could not be inspected:",
						...plan.errored.map(
							(companion) =>
								`${companion.package}: ${companion.error ?? "unknown error"}`,
						),
						"",
						plan.manualInstructions,
					].join("\n"),
					"warning",
				);
			}

			if (plan.installable.length === 0) {
				return {
					outcome: "manual-only",
					manualInstructions: plan.manualInstructions,
					installable: [],
					errored: plan.errored,
					failures: [],
				};
			}

			if (!interaction.confirm || !interaction.installPackage) {
				notify(interaction, plan.manualInstructions, "warning");
				return {
					outcome: "manual",
					message: plan.manualInstructions,
					manualInstructions: plan.manualInstructions,
					installable: plan.installable,
					errored: plan.errored,
					failures: [],
				};
			}

			const confirmed = await interaction.confirm(
				"Install pi-workflow companions?",
				installConfirmationMessage(plan.installable),
			);
			if (!confirmed) {
				const message = "Canceled. No companion packages were installed.";
				notify(interaction, message, "info");
				return {
					outcome: "canceled",
					message,
					manualInstructions: plan.manualInstructions,
					installable: plan.installable,
					errored: plan.errored,
					failures: [],
				};
			}

			const failures: string[] = [];
			for (const companion of plan.installable) {
				const spec = companionInstallSpec(companion);
				notify(interaction, `Installing ${spec}...`, "info");
				try {
					const result = await interaction.installPackage(spec);
					if (result.code !== 0) {
						failures.push(
							`${spec}: ${result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.code}`}`,
						);
					}
				} catch (error) {
					failures.push(
						`${spec}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			if (failures.length > 0) {
				const message = [
					"Some companion installs failed:",
					...failures,
					"",
					plan.manualInstructions,
				].join("\n");
				notify(interaction, message, "error");
				return {
					outcome: "failed",
					message,
					manualInstructions: plan.manualInstructions,
					installable: plan.installable,
					errored: plan.errored,
					failures,
				};
			}

			const message =
				"Installed or updated pi-workflow companions. Run /reload to load their resources.";
			notify(interaction, message, "info");
			return {
				outcome: "installed",
				message,
				manualInstructions: plan.manualInstructions,
				installable: plan.installable,
				errored: plan.errored,
				failures: [],
			};
		},
	};
}
