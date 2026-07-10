import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
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

type McpServerDefinition = Record<string, unknown>;

type McpServerCatalog = {
	schemaVersion: number;
	mcpServers: Record<string, McpServerDefinition>;
};

type McpServerCatalogLoadResult = {
	catalog?: McpServerCatalog;
	error?: string;
};

type McpConfigurationTarget = {
	name: string;
	current: unknown;
	existed: boolean;
	expected: McpServerDefinition;
};

type McpConfigurationPlan = {
	changed: boolean;
	path: string;
	mergedConfig: Record<string, unknown>;
	additions: string[];
	replacements: Array<{
		name: string;
		current: unknown;
		expected: McpServerDefinition;
	}>;
	targets: McpConfigurationTarget[];
	error?: string;
};

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

export interface CompanionMcpAdapters {
	catalogPath?: string;
	agentDirectory?: string;
}

export interface CodeGraphReadiness {
	companion: CompanionState | undefined;
	cli: "available" | "missing";
	index: "present" | "missing" | "unknown";
	messages: string[];
}

export type CompanionStatusOptions = {
	companions?: CompanionPackage[];
	metadataPath?: string;
	loadError?: string;
	resolveInstalledVersion?: ResolveInstalledVersion;
	diagnosticAdapters?: CompanionDiagnosticAdapters;
};

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
		| "config-error"
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
const mcpServerCatalogPath = resolve(packageDirectory, "../assets/mcp-servers.json");
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpServerDefinition(value: unknown): value is McpServerDefinition {
	return isPlainRecord(value);
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

function loadMcpServerCatalog(
	mcpOptions: CompanionMcpAdapters = {},
): McpServerCatalogLoadResult {
	return loadMcpServerCatalogFromPath(
		mcpOptions.catalogPath ?? mcpServerCatalogPath,
	);
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

function activePiAgentDirectory(
	mcpOptions: CompanionMcpAdapters = {},
): string {
	if (mcpOptions.agentDirectory) {
		return resolve(mcpOptions.agentDirectory);
	}
	return process.env.PI_CODING_AGENT_DIR
		? resolve(process.env.PI_CODING_AGENT_DIR)
		: piAgentHome();
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

export async function companionStatusLines(
	heading: string,
	diagnostic: boolean,
	options: CompanionStatusOptions = {},
): Promise<{ lines: string[]; level: NotificationLevel }> {
	const loaded = options.companions
		? { companions: options.companions, error: options.loadError }
		: loadCompanionsFromPath(options.metadataPath ?? companionMetadataPath);
	const states = loaded.companions.map((companion) =>
		getCompanionState(companion, options.resolveInstalledVersion),
	);
	const actionable = states.filter(
		(companion) => companion.status !== "installed",
	);
	const lines = [
		heading,
		"",
		"Recommended companion packages:",
		loaded.error
			? `Companion metadata error: ${loaded.error}`
			: formatCompanionStatus(states),
	];
	let diagnosticReadinessDegraded = false;

	if (loaded.error) {
		lines.push(
			"",
			"Companion status is degraded; pi-workflow cannot confirm configured companion state.",
		);
	} else if (actionable.length > 0) {
		lines.push(
			"",
			"Missing, mismatched, or unreadable companions are installed independently. Run /pi-workflow-install-companions or install manually:",
			...actionable.map(
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

	if (diagnostic) {
		lines.push("", `Companion metadata: ${options.metadataPath ?? companionMetadataPath}`);
		const codeGraphCompanion = states.find(
			(companion) => companion.package === codeGraphPackageName,
		);
		if (codeGraphCompanion && options.diagnosticAdapters) {
			const readiness = await getCodeGraphReadiness({
				...options.diagnosticAdapters,
				companion: codeGraphCompanion,
			});
			diagnosticReadinessDegraded = isCodeGraphReadinessDegraded(readiness);
			lines.push("", "CodeGraph readiness:", ...readiness.messages);
		}
	}

	return {
		lines,
		level: notificationLevel(
			Boolean(loaded.error),
			actionable.length + (diagnosticReadinessDegraded ? 1 : 0),
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

function formatJsonBlock(value: unknown): string {
	return JSON.stringify(value, null, 2);
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

function definitionsEqual(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function mcpConfigPath(mcpOptions: CompanionMcpAdapters = {}): string {
	return resolve(activePiAgentDirectory(mcpOptions), "mcp.json");
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

function createMcpConfigurationPlan(
	catalog: McpServerCatalog,
	mcpOptions: CompanionMcpAdapters = {},
): McpConfigurationPlan {
	const path = mcpConfigPath(mcpOptions);
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
		.filter(
			(target) =>
				target.existed && !definitionsEqual(target.current, target.expected),
		)
		.map((target) => ({
			name: target.name,
			current: target.current,
			expected: target.expected,
		}));

	return {
		changed: additions.length > 0 || replacements.length > 0,
		path,
		mergedConfig: {
			...existingRoot,
			mcpServers: {
				...currentServers,
				...catalog.mcpServers,
			},
		},
		additions,
		replacements,
		targets,
	};
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

function manualMcpConfigurationInstructions(
	plan: McpConfigurationPlan,
	catalog: McpServerCatalog,
): string {
	const replacementLines = plan.replacements.flatMap((replacement) => [
		`- ${replacement.name}`,
		"Current:",
		formatJsonBlock(replacement.current),
		"Expected:",
		formatJsonBlock(replacement.expected),
	]);

	return [
		"pi-workflow cannot mutate Pi configuration automatically in this context.",
		`Edit ${plan.path} manually and merge these MCP server definitions under top-level "mcpServers":`,
		formatJsonBlock(catalog.mcpServers),
		"Preserve unrelated top-level fields and unrelated MCP servers.",
		plan.replacements.length > 0
			? "Same-name conflicts must be replaced only after reviewing the current vs expected definitions below:"
			: "",
		...replacementLines,
		"Then run /reload and authenticate Sentry/Linear as needed.",
	]
		.filter((line) => line.length > 0)
		.join("\n");
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

function writeJsonAtomically(path: string, value: Record<string, unknown>) {
	const directory = dirname(path);
	mkdirSync(directory, { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		renameSync(temporaryPath, path);
	} catch (error) {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// ignore cleanup failures
		}
		throw error;
	}
}

function combineManualInstructions(...sections: string[]): string {
	return sections
		.map((section) => section.trim())
		.filter((section) => section.length > 0)
		.join("\n\n")
		.trim();
}

function emptyMcpConfigurationPlan(
	mcpOptions: CompanionMcpAdapters = {},
): McpConfigurationPlan {
	return {
		changed: false,
		path: mcpConfigPath(mcpOptions),
		mergedConfig: {},
		additions: [],
		replacements: [],
		targets: [],
	};
}

function manualMcpCatalogInstructions(
	mcpOptions: CompanionMcpAdapters = {},
): string {
	const catalogPath = mcpOptions.catalogPath ?? mcpServerCatalogPath;
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

			const companionPlan = createCompanionInstallPlan(resolvedCatalog.states);
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
					notify(interaction, message, "error");
					return {
						outcome: "mcp-catalog-error",
						message,
						manualInstructions,
						installable: companionPlan.installable,
						errored: companionPlan.errored,
						failures: [],
						mcpPath: mcpConfigPath(mcp),
					};
				}

				if (!interaction.confirm || !interaction.installPackage) {
					notify(interaction, message, "warning");
					return {
						outcome: "manual",
						message,
						manualInstructions,
						installable: companionPlan.installable,
						errored: companionPlan.errored,
						failures: [],
						mcpPath: mcpConfigPath(mcp),
					};
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
					notify(interaction, confirmationMessage, "warning");
					return {
						outcome: "manual",
						message: confirmationMessage,
						manualInstructions,
						installable: companionPlan.installable,
						errored: companionPlan.errored,
						failures: [],
						mcpPath: mcpConfigPath(mcp),
					};
				}
				if (!confirmed) {
					const canceledMessage =
						"Canceled. No companion packages or MCP configuration were changed.";
					notify(interaction, canceledMessage, "info");
					return {
						outcome: "canceled",
						message: canceledMessage,
						manualInstructions,
						installable: companionPlan.installable,
						errored: companionPlan.errored,
						failures: [],
						mcpPath: mcpConfigPath(mcp),
					};
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
				notify(interaction, postInstallMessage, "error");
				return {
					outcome: "failed",
					message: postInstallMessage,
					manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures,
					mcpPath: mcpConfigPath(mcp),
				};
			}

			const mcpPlan = createMcpConfigurationPlan(loadedMcpCatalog.catalog, mcp);
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
				notify(interaction, message, "error");
				return {
					outcome: "config-error",
					message,
					manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures: [],
					mcpPath: mcpPlan.path,
				};
			}

			if (
				companionPlan.installable.length === 0 &&
				companionPlan.errored.length === 0 &&
				!mcpPlan.changed
			) {
				const message =
					"pi-workflow companions are installed and MCP servers are already configured.";
				notify(interaction, message, "info");
				return {
					outcome: "noop",
					message,
					installable: [],
					errored: [],
					failures: [],
					mcpPath: mcpPlan.path,
				};
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
				notify(interaction, manualInstructions, "warning");
				return {
					outcome: "manual",
					message: manualInstructions,
					manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures: [],
					mcpPath: mcpPlan.path,
				};
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
				notify(interaction, message, "warning");
				return {
					outcome: "manual",
					message,
					manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures: [],
					mcpPath: mcpPlan.path,
				};
			}
			if (!confirmed) {
				const message =
					"Canceled. No companion packages or MCP configuration were changed.";
				notify(interaction, message, "info");
				return {
					outcome: "canceled",
					message,
					manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures: [],
					mcpPath: mcpPlan.path,
				};
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
				notify(interaction, message, "error");
				return {
					outcome: "failed",
					message,
					manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures,
					mcpPath: mcpPlan.path,
				};
			}

			let appliedMcpPlan = mcpPlan;
			if (mcpPlan.changed) {
				const latestMcpPlan = createMcpConfigurationPlan(
					loadedMcpCatalog.catalog,
					mcp,
				);
				if (latestMcpPlan.error) {
					const message = [
						...companionOutcomeLines(failures, companionPlan),
						`MCP configuration at ${mcpPlan.path} could not be re-read after confirmation: ${latestMcpPlan.error}`,
						"No MCP configuration changes were written.",
						"",
						manualMcpConfigurationInstructions(
							mcpPlan,
							loadedMcpCatalog.catalog,
						),
					].join("\n");
					notify(interaction, message, "error");
					return {
						outcome: "failed",
						message,
						manualInstructions: manualHarnessInstructions(
							companionPlan,
							mcpPlan,
							loadedMcpCatalog.catalog,
						),
						installable: companionPlan.installable,
						errored: companionPlan.errored,
						failures,
						mcpPath: mcpPlan.path,
					};
				}
				const changedTargets = changedMcpTargets(mcpPlan, latestMcpPlan);
				if (changedTargets.length > 0) {
					const message = [
						...companionOutcomeLines(failures, companionPlan),
						`MCP configuration at ${mcpPlan.path} changed after preview. No MCP configuration changes were written.`,
						"Affected MCP server names:",
						...changedTargets.map((name) => `- ${name}`),
						"",
						`Review ${mcpPlan.path} and run /pi-workflow-install-companions again to confirm against the latest configuration.`,
						"",
						manualMcpConfigurationInstructions(
							latestMcpPlan,
							loadedMcpCatalog.catalog,
						),
					].join("\n");
					notify(interaction, message, "error");
					return {
						outcome: "failed",
						message,
						manualInstructions: manualHarnessInstructions(
							companionPlan,
							latestMcpPlan,
							loadedMcpCatalog.catalog,
						),
						installable: companionPlan.installable,
						errored: companionPlan.errored,
						failures,
						mcpPath: mcpPlan.path,
					};
				}
				appliedMcpPlan = latestMcpPlan;
				if (appliedMcpPlan.changed) {
					try {
						writeJsonAtomically(
							appliedMcpPlan.path,
							appliedMcpPlan.mergedConfig,
						);
					} catch (error) {
						const message = [
							...companionOutcomeLines(failures, companionPlan),
							`Could not write pi-workflow MCP servers to ${appliedMcpPlan.path}: ${error instanceof Error ? error.message : String(error)}`,
							"No MCP configuration changes were written automatically.",
							"",
							manualMcpConfigurationInstructions(
								appliedMcpPlan,
								loadedMcpCatalog.catalog,
							),
						].join("\n");
						notify(interaction, message, "error");
						return {
							outcome: "failed",
							message,
							manualInstructions: manualHarnessInstructions(
								companionPlan,
								appliedMcpPlan,
								loadedMcpCatalog.catalog,
							),
							installable: companionPlan.installable,
							errored: companionPlan.errored,
							failures,
							mcpPath: appliedMcpPlan.path,
						};
					}
				}
			}

			const configuredMcp = appliedMcpPlan.changed
				? `Configured pi-workflow MCP servers at ${appliedMcpPlan.path}.`
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
				notify(interaction, message, "error");
				return {
					outcome: "failed",
					message,
					manualInstructions: companionPlan.manualInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures,
					mcpPath: appliedMcpPlan.path,
				};
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
				notify(interaction, message, "error");
				return {
					outcome: "failed",
					message,
					manualInstructions: unresolvedInstructions,
					installable: companionPlan.installable,
					errored: companionPlan.errored,
					failures: [],
					mcpPath: appliedMcpPlan.path,
				};
			}

			const actionSummary =
				companionPlan.installable.length > 0
					? `${configuredMcp} Installed or updated pi-workflow companions.`
					: configuredMcp;
			const message =
				`${actionSummary} Run /reload. Authenticate Sentry/Linear as needed. pi-workflow does not connect or authenticate MCP servers during installation.`;
			notify(interaction, message, "info");
			return {
				outcome: "installed",
				message,
				manualInstructions,
				installable: companionPlan.installable,
				errored: companionPlan.errored,
				failures: [],
				mcpPath: appliedMcpPlan.path,
			};
		},
	};
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
