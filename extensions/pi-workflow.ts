import {
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandContext {
	hasUI?: boolean;
	ui: {
		confirm?: (
			title: string,
			message: string,
			options?: unknown,
		) => Promise<boolean>;
		notify: (message: string, level?: "info" | "warning" | "error") => void;
	};
}

interface ExtensionAPI {
	exec: (
		command: string,
		args?: string[],
	) => Promise<{ code: number; stdout?: string; stderr?: string }>;
	registerCommand: (
		name: string,
		definition: {
			description: string;
			handler: (args: string, ctx: CommandContext) => Promise<void> | void;
		},
	) => void;
}

interface CompanionPackage {
	package: string;
	version: string;
	description?: string;
}

interface CompanionMetadata {
	companions: CompanionPackage[];
}

type CompanionStatus = "missing" | "version-mismatch" | "installed" | "error";

interface CompanionState extends CompanionPackage {
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

type DiagnosticAdapters = {
	exec: ExtensionAPI["exec"];
	cwd: () => string;
	directoryExists: (path: string) => Promise<boolean> | boolean;
};

type CodeGraphReadiness = {
	companion: CompanionState | undefined;
	cli: "available" | "missing";
	index: "present" | "missing" | "unknown";
	messages: string[];
};

type CompanionStatusOptions = {
	companions?: CompanionPackage[];
	metadataPath?: string;
	loadError?: string;
	resolveInstalledVersion?: (packageName: string) => {
		version?: string;
		error?: string;
	};
	diagnosticAdapters?: DiagnosticAdapters;
};

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

function loadCompanions(): CompanionLoadResult {
	return loadCompanionsFromPath(companionMetadataPath);
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

function loadMcpServerCatalog(): McpServerCatalogLoadResult {
	return loadMcpServerCatalogFromPath(mcpServerCatalogPath);
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

function activePiAgentDirectory(): string {
	return process.env.PI_CODING_AGENT_DIR
		? resolve(process.env.PI_CODING_AGENT_DIR)
		: piAgentHome();
}

function piCompanionNodeModulesPaths(): string[] {
	const paths = [];
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
	resolveInstalledVersion: (packageName: string) => {
		version?: string;
		error?: string;
	} = getInstalledCompanionVersion,
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

function notifyMultiline(
	ctx: CommandContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
) {
	ctx.ui.notify(message, level);
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
): "info" | "warning" | "error" {
	if (loadError) return "error";
	if (actionableCount > 0) return "warning";
	return "info";
}

export async function getCodeGraphReadiness({
	companion,
	exec,
	cwd,
	directoryExists,
}: DiagnosticAdapters & { companion?: CompanionState }): Promise<CodeGraphReadiness> {
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
		messages.push("CodeGraph index: unknown; pi-workflow could not inspect .codegraph.");
	} else {
		messages.push("CodeGraph index: present.");
	}

	if (companion?.status === "installed" && cli === "available" && index === "present") {
		messages.push("CodeGraph: ready.");
	}

	return { companion, cli, index, messages };
}

function isCodeGraphReadinessDegraded(readiness: CodeGraphReadiness): boolean {
	return readiness.cli === "missing" || readiness.index !== "present";
}

export async function companionStatusLines(
	heading: string,
	diagnostic: boolean,
	options: CompanionStatusOptions = {},
): Promise<{ lines: string[]; level: "info" | "warning" | "error" }> {
	const loaded = options.companions
		? { companions: options.companions, error: options.loadError }
		: loadCompanions();
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

async function showCompanionStatus(ctx: CommandContext) {
	const { lines, level } = await companionStatusLines(
		"pi-workflow companion status",
		false,
	);
	notifyMultiline(ctx, lines.join("\n"), level);
}

async function showCompanionDoctor(pi: ExtensionAPI, ctx: CommandContext) {
	const { lines, level } = await companionStatusLines(
		"pi-workflow companion doctor",
		true,
		{
			diagnosticAdapters: {
				exec: pi.exec,
				cwd: () => process.cwd(),
				directoryExists: (path) => statSync(path).isDirectory(),
			},
		},
	);
	notifyMultiline(ctx, lines.join("\n"), level);
}

function createCompanionInstallPlan(
	companions: CompanionPackage[],
): CompanionInstallPlan {
	const states = companions.map((companion) => getCompanionState(companion));
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

function notifyCompanionMetadataError(ctx: CommandContext, error: string) {
	notifyMultiline(
		ctx,
		[
			`Companion metadata error: ${error}`,
			"Cannot determine companion install commands automatically. Check assets/companions.json and retry.",
		].join("\n"),
		"error",
	);
}

function notifyCompanionInspectionErrors(
	ctx: CommandContext,
	plan: CompanionInstallPlan,
) {
	if (plan.errored.length === 0) return;

	notifyMultiline(
		ctx,
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

function notifyMcpCatalogError(ctx: CommandContext, error: string) {
	notifyMultiline(
		ctx,
		[
			`MCP server catalog error: ${error}`,
			"Cannot determine MCP server configuration automatically. Check assets/mcp-servers.json and retry.",
		].join("\n"),
		"error",
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

function definitionsEqual(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function mcpConfigPath(): string {
	return resolve(activePiAgentDirectory(), "mcp.json");
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
): McpConfigurationPlan {
	const path = mcpConfigPath();
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

function formatJsonBlock(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function formatMcpServerList(names: string[], catalog: McpServerCatalog): string[] {
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

function confirmHarnessInstall(
	ctx: CommandContext,
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
): Promise<boolean> {
	if (!ctx.hasUI || !ctx.ui.confirm) {
		return Promise.resolve(false);
	}

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

	messageLines.push(
		"",
		"Continue?",
	);

	const title =
		companionPlan.installable.length > 0
			? "Install pi-workflow companions and configure MCP servers?"
			: "Configure MCP servers for pi-workflow?";
	return ctx.ui.confirm(title, messageLines.join("\n"));
}

async function installCompanionPackages(
	pi: ExtensionAPI,
	ctx: CommandContext,
	installable: CompanionState[],
): Promise<string[]> {
	const failures: string[] = [];

	for (const companion of installable) {
		const spec = companionInstallSpec(companion);
		notifyMultiline(ctx, `Installing ${spec}...`, "info");
		try {
			const result = await pi.exec("pi", ["install", spec]);
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

	return failures;
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

function notifyHarnessAlreadyConfigured(ctx: CommandContext) {
	notifyMultiline(
		ctx,
		"pi-workflow companions are installed and MCP servers are already configured.",
		"info",
	);
}

function notifyHarnessManualGuidance(
	ctx: CommandContext,
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
) {
	const lines: string[] = [];
	if (companionPlan.installable.length > 0 || companionPlan.errored.length > 0) {
		lines.push(companionPlan.manualInstructions, "");
	}
	lines.push(manualMcpConfigurationInstructions(mcpPlan, catalog));
	notifyMultiline(ctx, lines.join("\n"), "warning");
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

function notifyMcpConfigurationPreviewConflict(
	ctx: CommandContext,
	failures: string[],
	companionPlan: CompanionInstallPlan,
	previewPlan: McpConfigurationPlan,
	latestPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
) {
	notifyMultiline(
		ctx,
		[
			...companionOutcomeLines(failures, companionPlan),
			`MCP configuration at ${previewPlan.path} changed after preview. No MCP configuration changes were written.`,
			"Affected MCP server names:",
			...changedMcpTargets(previewPlan, latestPlan).map((name) => `- ${name}`),
			"",
			`Review ${previewPlan.path} and run /pi-workflow-install-companions again to confirm against the latest configuration.`,
			"",
			manualMcpConfigurationInstructions(latestPlan, catalog),
		].join("\n"),
		"error",
	);
}

function notifyMcpConfigurationRefreshError(
	ctx: CommandContext,
	failures: string[],
	companionPlan: CompanionInstallPlan,
	previewPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
	error: string,
) {
	notifyMultiline(
		ctx,
		[
			...companionOutcomeLines(failures, companionPlan),
			`MCP configuration at ${previewPlan.path} could not be re-read after confirmation: ${error}`,
			"No MCP configuration changes were written.",
			"",
			manualMcpConfigurationInstructions(previewPlan, catalog),
		].join("\n"),
		"error",
	);
}

function notifyMcpConfigurationWriteError(
	ctx: CommandContext,
	failures: string[],
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
	error: unknown,
) {
	notifyMultiline(
		ctx,
		[
			...companionOutcomeLines(failures, companionPlan),
			`Could not write pi-workflow MCP servers to ${mcpPlan.path}: ${error instanceof Error ? error.message : String(error)}`,
			"No MCP configuration changes were written automatically.",
			"",
			manualMcpConfigurationInstructions(mcpPlan, catalog),
		].join("\n"),
		"error",
	);
}

function notifyHarnessCanceled(ctx: CommandContext) {
	notifyMultiline(ctx, "Canceled. No companion packages or MCP configuration were changed.", "info");
}

function notifyHarnessInstallOutcome(
	ctx: CommandContext,
	failures: string[],
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
) {
	const configuredMcp = mcpPlan.changed
		? `Configured pi-workflow MCP servers at ${mcpPlan.path}.`
		: "MCP servers were already configured.";

	if (failures.length > 0) {
		notifyMultiline(
			ctx,
			[
				configuredMcp,
				"Some companion installs failed:",
				...failures,
				"",
				companionPlan.manualInstructions,
				"",
				"Run /reload after the companion installs are fixed. Authenticate Sentry/Linear as needed.",
			].join("\n"),
			"error",
		);
		return;
	}

	const actionSummary =
		companionPlan.installable.length > 0
			? `${configuredMcp} Installed or updated pi-workflow companions.`
			: configuredMcp;
	notifyMultiline(
		ctx,
		`${actionSummary} Run /reload. Authenticate Sentry/Linear as needed. pi-workflow does not connect or authenticate MCP servers during installation.`,
		"info",
	);
}

async function installMissingCompanions(pi: ExtensionAPI, ctx: CommandContext) {
	const loadedCompanions = loadCompanions();
	if (loadedCompanions.error) {
		notifyCompanionMetadataError(ctx, loadedCompanions.error);
		return;
	}

	const loadedMcpCatalog = loadMcpServerCatalog();
	if (loadedMcpCatalog.error || !loadedMcpCatalog.catalog) {
		notifyMcpCatalogError(
			ctx,
			loadedMcpCatalog.error ?? "Unknown MCP server catalog error.",
		);
		return;
	}

	const companionPlan = createCompanionInstallPlan(loadedCompanions.companions);
	const mcpPlan = createMcpConfigurationPlan(loadedMcpCatalog.catalog);
	if (mcpPlan.error) {
		notifyMultiline(ctx, mcpPlan.error, "error");
		return;
	}

	if (
		companionPlan.installable.length === 0 &&
		companionPlan.errored.length === 0 &&
		!mcpPlan.changed
	) {
		notifyHarnessAlreadyConfigured(ctx);
		return;
	}

	notifyCompanionInspectionErrors(ctx, companionPlan);

	if (!ctx.hasUI || !ctx.ui.confirm) {
		notifyHarnessManualGuidance(ctx, companionPlan, mcpPlan, loadedMcpCatalog.catalog);
		return;
	}

	const confirmed = await confirmHarnessInstall(
		ctx,
		companionPlan,
		mcpPlan,
		loadedMcpCatalog.catalog,
	);
	if (!confirmed) {
		notifyHarnessCanceled(ctx);
		return;
	}

	const failures = await installCompanionPackages(pi, ctx, companionPlan.installable);
	let appliedMcpPlan = mcpPlan;
	if (mcpPlan.changed) {
		const latestMcpPlan = createMcpConfigurationPlan(loadedMcpCatalog.catalog);
		if (latestMcpPlan.error) {
			notifyMcpConfigurationRefreshError(
				ctx,
				failures,
				companionPlan,
				mcpPlan,
				loadedMcpCatalog.catalog,
				latestMcpPlan.error,
			);
			return;
		}
		if (changedMcpTargets(mcpPlan, latestMcpPlan).length > 0) {
			notifyMcpConfigurationPreviewConflict(
				ctx,
				failures,
				companionPlan,
				mcpPlan,
				latestMcpPlan,
				loadedMcpCatalog.catalog,
			);
			return;
		}
		appliedMcpPlan = latestMcpPlan;
		if (appliedMcpPlan.changed) {
			try {
				writeJsonAtomically(appliedMcpPlan.path, appliedMcpPlan.mergedConfig);
			} catch (error) {
				notifyMcpConfigurationWriteError(
					ctx,
					failures,
					companionPlan,
					appliedMcpPlan,
					loadedMcpCatalog.catalog,
					error,
				);
				return;
			}
		}
	}
	notifyHarnessInstallOutcome(ctx, failures, companionPlan, appliedMcpPlan);
}

export default function piWorkflowExtension(pi: ExtensionAPI) {
	pi.registerCommand("pi-workflow-status", {
		description:
			"Show configured pi-workflow companion packages and install state",
		handler: (_args, ctx) => showCompanionStatus(ctx),
	});

	pi.registerCommand("pi-workflow-doctor", {
		description: "Show diagnostic pi-workflow companion package status",
		handler: (_args, ctx) => showCompanionDoctor(pi, ctx),
	});

	pi.registerCommand("pi-workflow-install-companions", {
		description:
			"Confirm and install missing or mismatched pi-workflow companion packages",
		handler: (_args, ctx) => installMissingCompanions(pi, ctx),
	});
}
