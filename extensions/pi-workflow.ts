import { readFileSync, statSync } from "node:fs";
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

interface CompanionInstallPlan {
	installable: CompanionState[];
	errored: CompanionState[];
	manualInstructions: string;
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

function confirmCompanionInstall(
	ctx: CommandContext,
	installable: CompanionState[],
): Promise<boolean> {
	if (!ctx.hasUI || !ctx.ui.confirm) {
		return Promise.resolve(false);
	}

	return ctx.ui.confirm(
		"Install pi-workflow companions?",
		[
			"This will run pi install for missing or mismatched companion packages:",
			"",
			...installable.map(
				(companion) => `pi install ${companionInstallSpec(companion)}`,
			),
			"",
			"Continue?",
		].join("\n"),
	);
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

function notifyCompanionInstallOutcome(
	ctx: CommandContext,
	failures: string[],
	manualInstructions: string,
) {
	if (failures.length > 0) {
		notifyMultiline(
			ctx,
			[
				"Some companion installs failed:",
				...failures,
				"",
				manualInstructions,
			].join("\n"),
			"error",
		);
		return;
	}

	notifyMultiline(
		ctx,
		"Installed or updated pi-workflow companions. Run /reload to load their resources.",
		"info",
	);
}

async function installMissingCompanions(pi: ExtensionAPI, ctx: CommandContext) {
	const loaded = loadCompanions();
	if (loaded.error) {
		notifyCompanionMetadataError(ctx, loaded.error);
		return;
	}

	const plan = createCompanionInstallPlan(loaded.companions);
	if (plan.installable.length === 0 && plan.errored.length === 0) {
		notifyMultiline(
			ctx,
			"All configured pi-workflow companions are installed at the expected versions.",
			"info",
		);
		return;
	}

	notifyCompanionInspectionErrors(ctx, plan);

	if (plan.installable.length === 0) return;

	if (!ctx.hasUI || !ctx.ui.confirm) {
		notifyMultiline(ctx, plan.manualInstructions, "warning");
		return;
	}

	const confirmed = await confirmCompanionInstall(ctx, plan.installable);
	if (!confirmed) {
		notifyMultiline(
			ctx,
			"Canceled. No companion packages were installed.",
			"info",
		);
		return;
	}

	const failures = await installCompanionPackages(pi, ctx, plan.installable);
	notifyCompanionInstallOutcome(ctx, failures, plan.manualInstructions);
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
