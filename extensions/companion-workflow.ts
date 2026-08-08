import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
	CompanionInstallFailure,
	CompanionInstallIdentity,
	CompanionInstallManifestStore,
	StoredCompanionInstallManifest,
} from "./companion-install-manifest.ts";
import { companionInstallOperationId } from "./companion-install-manifest.ts";
import type {
	AuthenticatedDecisionActor,
	AuthorizationOutcome,
	DecisionRequest,
	ExecutionLease,
	TypedDecisionAction,
} from "./interactive-decisions.ts";
import {
	applyMcpConfiguration,
	defaultMcpServerCatalogPath,
	loadMcpServerCatalog,
	mcpConfigPath,
	planMcpConfiguration,
	emptyMcpConfigurationPlan,
	type CompanionMcpAdapters,
	type McpConfigurationPlan,
	type McpServerCatalog,
} from "./mcp-config.ts";
import type { PiInteractiveDecisions } from "./pi-decision-adapter.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";

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

type ExecCapability = (
	command: string,
	args?: string[],
) => Promise<{ code: number; stdout?: string; stderr?: string }>;

export interface CompanionInteractionAdapters {
	notify?: (message: string, level?: NotificationLevel) => void;
	exec?: ExecCapability;
	installPackage?: InstallPackage;
}

interface CompanionDecisionAuthority {
	readonly project: string | (() => string);
	readonly actor: () => AuthenticatedDecisionActor | undefined;
	readonly hasUI: () => boolean;
	readonly decisions: PiInteractiveDecisions;
	readonly manifests: CompanionInstallManifestStore;
	readonly requestTurn?: () => void;
}

export interface CompanionDiagnosticAdapters {
	exec: ExecCapability;
	cwd: () => string;
	directoryExists?: (path: string) => Promise<boolean> | boolean;
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
	authority?: CompanionDecisionAuthority;
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
			| "awaiting-decision"
			| "waiting"
			| "blocked"
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

export interface CompanionDecisionDescriptor {
	readonly request: DecisionRequest;
	readonly actions: readonly TypedDecisionAction[];
}

function withoutPackageFailure(
	failures: readonly CompanionInstallFailure[],
	packageName: string,
): CompanionInstallFailure[] {
	return failures.filter(
		(failure) => failure.kind !== "package" || failure.package !== packageName,
	);
}

function withoutMcpFailure(
	failures: readonly CompanionInstallFailure[],
): CompanionInstallFailure[] {
	return failures.filter((failure) => failure.kind !== "mcp");
}

interface PreparedCompanionOperation {
	readonly kind: "install" | "recovery";
	readonly descriptor: CompanionDecisionDescriptor;
	readonly decisionId: string;
	readonly identity: CompanionInstallIdentity;
	readonly planDigest: string;
	readonly mcpPlanDigest: string;
	readonly attempt: number;
	readonly companionPlan: CompanionInstallPlan;
	readonly mcpPlan: McpConfigurationPlan;
	readonly mcpCatalog: McpServerCatalog;
	readonly manifest?: StoredCompanionInstallManifest;
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
		(value as CompanionPackage).package.length > 0
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
	return `npm:${companion.package}`;
}

function defaultDirectoryExists(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch (error) {
		const code =
			typeof error === "object" && error !== null
				? (error as { code?: unknown }).code
				: undefined;
		if (code === "ENOENT" || code === "ENOTDIR") return false;
		throw error;
	}
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
	if (status === "installed") return "✓";
	return "✗";
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
	directoryExists = defaultDirectoryExists,
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
		messages.push("CodeGraph companion: missing or unreadable.");
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
			"Missing or unreadable companions are installed independently. Run /pi-workflow-install-companions or install manually:",
			...catalog.actionable.map(
				(companion) => `pi install ${companionInstallSpec(companion)}`,
			),
			"Then run /reload.",
		);
	} else {
		lines.push(
			"",
			"All configured companions are installed.",
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
		(companion) => companion.status === "missing",
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

function mcpPlanEvidence(plan: McpConfigurationPlan) {
	return {
		path: plan.path,
		changed: plan.changed,
		targets: plan.targets.map((target) => ({
			name: target.name,
			existed: target.existed,
			current: target.existed ? target.current : null,
			expected: target.expected,
		})),
		error: plan.error ?? null,
	};
}

function operationEvidence(
	companionPlan: CompanionInstallPlan,
	mcpPlan: McpConfigurationPlan,
	catalog: McpServerCatalog,
) {
	const identity: CompanionInstallIdentity = {
		packages: companionPlan.installable.map((companion) => ({
			package: companion.package,
			spec: companionInstallSpec(companion),
		})),
		mcp: {
			path: mcpPlan.path,
			catalogDigest: digestCanonicalValue(catalog),
		},
	};
	const mcpPlanDigest = digestCanonicalValue(mcpPlanEvidence(mcpPlan));
	return {
		identity,
		mcpPlanDigest,
		planDigest: digestCanonicalValue({ identity, mcpPlanDigest }),
	};
}

export function companionInstallDecision(
	project: string,
	identity: CompanionInstallIdentity,
	planDigest: string,
	mcpPlan: McpConfigurationPlan,
): CompanionDecisionDescriptor {
	const operationId = companionInstallOperationId(identity);
	const action: TypedDecisionAction = {
		id: "companions.install",
		input: { operationId, planDigest },
	};
	return {
		actions: [action, { id: "decision.cancel", input: null }],
		request: {
			scope: { project, workflow: "companion-install", subject: operationId },
			operation: {
				kind: "install-companions",
				phase: "plan-ready",
				input: { operationId, planDigest },
				artifacts: [{ catalogDigest: identity.mcp.catalogDigest }],
				targets: [
					...identity.packages.map((entry) => ({
						package: entry.package,
						spec: entry.spec,
					})),
					...(mcpPlan.changed ? [{ path: mcpPlan.path }] : []),
				],
				evidence: [{ mcpPlanDigest: digestCanonicalValue(mcpPlanEvidence(mcpPlan)) }],
			},
			presentation: {
				locale: "en",
				summary:
					identity.packages.length > 0 && mcpPlan.changed
						? "Install pi-workflow companions and configure MCP servers?"
						: identity.packages.length > 0
							? "Install pi-workflow companions?"
							: "Configure MCP servers for pi-workflow?",
				details: [
					...identity.packages.map((entry) => `pi install ${entry.spec}`),
					...(mcpPlan.changed ? [`MCP configuration: ${mcpPlan.path}`] : []),
					...(mcpPlan.additions.length > 0
						? [`Add MCP servers: ${mcpPlan.additions.join(", ")}`]
						: []),
					...(mcpPlan.replacements.length > 0
						? [
								"Replace MCP server definitions:",
								...mcpPlan.replacements.flatMap((entry) => [
									entry.name,
									`Current: ${JSON.stringify(entry.current)}`,
									`Expected: ${JSON.stringify(entry.expected)}`,
								]),
							]
						: []),
				],
				consequences: [
					"One execution lease covers the reviewed package and MCP effects.",
				],
				risks: [
					"Package or targeted MCP drift stops the affected mutation and requires reconciliation.",
				],
				choices: [
					{
						id: action.id,
						mode: "execute",
						action,
						label: "Install and configure",
						description: "Execute this exact package and MCP plan.",
					},
					{
						id: "decision.cancel",
						mode: "cancel",
						action: { id: "decision.cancel", input: null },
						label: "Cancel",
						description: "Leave packages and MCP configuration unchanged.",
					},
				],
			},
		},
	};
}

export function companionRecoveryDecision(
	project: string,
	operationId: string,
	attempt: number,
	planDigest: string,
	details: readonly string[],
): CompanionDecisionDescriptor {
	const reconcile: TypedDecisionAction = {
		id: "companions.reconcile",
		input: { operationId, attempt, planDigest },
	};
	const wait: TypedDecisionAction = {
		id: "companions.wait",
		input: { operationId, attempt },
	};
	return {
		actions: [reconcile, wait, { id: "decision.cancel", input: null }],
		request: {
			scope: {
				project,
				workflow: "companion-install",
				subject: `${operationId}:recovery:${attempt}`,
			},
			operation: {
				kind: "reconcile-companion-install",
				phase: "partial-or-drifted",
				input: { operationId, attempt, planDigest },
				artifacts: [{ operationId }],
				targets: [],
				evidence: details.map((detail) => ({ detail })),
			},
			presentation: {
				locale: "en",
				summary: "Reconcile the interrupted companion installation?",
				details,
				consequences: [
					"Reconcile revalidates current package and MCP state under a new lease.",
				],
				risks: [
					"Wait preserves durable progress but authorizes no additional effects.",
				],
				choices: [
					{
						id: reconcile.id,
						mode: "execute",
						action: reconcile,
						label: "Reconcile now",
						description: "Replan and continue only the remaining verified effects.",
					},
					{
						id: wait.id,
						mode: "execute",
						action: wait,
						label: "Wait",
						description: "Keep the durable partial state without running effects.",
					},
					{
						id: "decision.cancel",
						mode: "cancel",
						action: { id: "decision.cancel", input: null },
						label: "Cancel",
						description: "Close this recovery attempt without running effects.",
					},
				],
			},
		},
	};
}

export function createCompanionWorkflow(
	options: CompanionWorkflowOptions = {},
) {
	const catalog = options.catalog ?? {};
	const interaction = options.interaction ?? {};
	const diagnostics = options.diagnostics;
	const mcp = options.mcp ?? {};
	const authority = options.authority;
	const installPackage = resolveInstallPackage(interaction);
	let pending: PreparedCompanionOperation | undefined;

	type PlanSnapshot = {
		readonly companionPlan: CompanionInstallPlan;
		readonly mcpPlan: McpConfigurationPlan;
		readonly mcpCatalog: McpServerCatalog;
		readonly identity: CompanionInstallIdentity;
		readonly planDigest: string;
		readonly mcpPlanDigest: string;
	};

	const authorityProject = () =>
		typeof authority?.project === "function"
			? authority.project()
			: (authority?.project ?? "pi-workflow");

	function result(
		outcome: InstallMissingResult["outcome"],
		message: string,
		level: NotificationLevel,
		plan?: Pick<PlanSnapshot, "companionPlan" | "mcpPlan">,
		failures: string[] = [],
	): InstallMissingResult {
		notify(interaction, message, level);
		return {
			outcome,
			message,
			installable: plan?.companionPlan.installable ?? [],
			errored: plan?.companionPlan.errored ?? [],
			failures,
			mcpPath: plan?.mcpPlan.path,
		};
	}

	function snapshot():
		| { readonly ok: true; readonly value: PlanSnapshot }
		| {
				readonly ok: false;
				readonly outcome: InstallMissingResult["outcome"];
				readonly message: string;
				readonly companionPlan?: CompanionInstallPlan;
				readonly mcpPath?: string;
		  } {
		const resolvedCatalog = resolveCompanionCatalog(catalog);
		if (resolvedCatalog.loadError)
			return {
				ok: false,
				outcome: "metadata-error",
				message: `Companion metadata error: ${resolvedCatalog.loadError}\nNo package or MCP effects were authorized.`,
			};
		const companionPlan = createCompanionInstallPlan(resolvedCatalog.states);
		if (companionPlan.errored.length > 0)
			return {
				ok: false,
				outcome: "blocked",
				message: [
					"Companion inspection is incomplete; no package or MCP effects were authorized.",
					...companionPlan.errored.map(
						(entry) => `${entry.package}: ${entry.error ?? "unknown error"}`,
					),
				].join("\n"),
				companionPlan,
			};
		const loaded = loadMcpServerCatalog(mcp);
		if (loaded.error || !loaded.catalog)
			return {
				ok: false,
				outcome: "mcp-catalog-error",
				message: [
					`MCP server catalog error: ${loaded.error ?? "Unknown MCP server catalog error."}`,
					"No package or MCP effects were authorized.",
					`Repair ${mcp.catalogPath ?? defaultMcpServerCatalogPath} before preparing a new installation decision.`,
				].join("\n"),
				companionPlan,
				mcpPath: mcpConfigPath(mcp),
			};
		const mcpPlan = planMcpConfiguration(loaded.catalog, mcp);
		if (mcpPlan.error)
			return {
				ok: false,
				outcome: "config-error",
				message: `${mcpPlan.error}\nNo package or MCP effects were authorized.`,
				companionPlan,
				mcpPath: mcpPlan.path,
			};
		const evidence = operationEvidence(companionPlan, mcpPlan, loaded.catalog);
		return {
			ok: true,
			value: {
				companionPlan,
				mcpPlan,
				mcpCatalog: loaded.catalog,
				...evidence,
			},
		};
	}

	async function prepare(
		plan: PlanSnapshot,
		kind: PreparedCompanionOperation["kind"],
		attempt: number,
		manifest?: StoredCompanionInstallManifest,
		details: readonly string[] = [],
	): Promise<InstallMissingResult> {
		if (!authority?.hasUI())
			return result(
				"blocked",
				"Shared interactive decision authority with an active UI is required; no package or MCP effects were authorized.",
				"error",
				plan,
			);
		const actor = authority.actor();
		if (!actor)
			return result(
				"blocked",
				"Authenticated local operator authority is unavailable; no package or MCP effects were authorized.",
				"error",
				plan,
			);
		const operationId = companionInstallOperationId(plan.identity);
		const descriptor =
			kind === "install"
				? companionInstallDecision(
						authorityProject(),
						plan.identity,
						plan.planDigest,
						plan.mcpPlan,
					)
				: companionRecoveryDecision(
						authorityProject(),
						operationId,
						attempt,
						plan.planDigest,
						details,
					);
		try {
			const presentation = await authority.decisions.prepare(
				descriptor.request,
				actor,
			);
			pending = {
				kind,
				descriptor,
				decisionId: presentation.decisionId,
				identity: plan.identity,
				planDigest: plan.planDigest,
				mcpPlanDigest: plan.mcpPlanDigest,
				attempt,
				companionPlan: plan.companionPlan,
				mcpPlan: plan.mcpPlan,
				mcpCatalog: plan.mcpCatalog,
				manifest,
			};
			authority.requestTurn?.();
			return result(
				"awaiting-decision",
				"Companion installation decision prepared. No effects run until the shared decision is claimed.",
				"info",
				plan,
			);
		} catch (error) {
			return result(
				"blocked",
				`Companion installation decision could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
				"error",
				plan,
			);
		}
	}

	async function terminalize(
		active: PreparedCompanionOperation,
		lease: ExecutionLease,
		state: string,
	): Promise<void> {
		if (!authority) throw new Error("Shared decision authority is unavailable.");
		const outcome = await authority.decisions.recover(
			active.descriptor.request.scope,
			{
				actorId: lease.actorId,
				authorityRevision: lease.authorityRevision,
				active: true,
				guest: false,
			},
			{ kind: "terminal", state },
		);
		if (outcome.kind !== "terminal" || outcome.state !== state)
			throw new Error(`Shared decision could not be finalized as ${state}.`);
	}

	async function authorizeEffect(lease: ExecutionLease): Promise<void> {
		if (!authority) throw new Error("Shared decision authority is unavailable.");
		const outcome = await authority.decisions.authorizeEffect(lease);
		if (outcome.kind === "blocked") throw new Error(outcome.blocker.message);
	}

	async function bindManifest(
		active: PreparedCompanionOperation,
		lease: ExecutionLease,
	): Promise<StoredCompanionInstallManifest> {
		if (!authority) throw new Error("Shared decision authority is unavailable.");
		const manifest = await authority.manifests.open(
			active.identity,
			active.planDigest,
			lease,
			active.attempt,
		);
		const binding = {
			ref: `workflow://companion-install/${manifest.value.operationId}/${manifest.revision}`,
			decisionId: lease.decisionId,
			operationDigest: lease.operationDigest,
			executionId: lease.executionId,
			generation: lease.generation,
		};
		const bound = await authority.decisions.bindExecutionManifest(lease, binding);
		if (bound.kind === "blocked") throw new Error(bound.blocker.message);
		return manifest;
	}

	async function prepareRecovery(
		active: PreparedCompanionOperation,
		lease: ExecutionLease,
		manifest: StoredCompanionInstallManifest,
		plan: PlanSnapshot,
		details: readonly string[],
	): Promise<InstallMissingResult> {
		if (!authority) throw new Error("Shared decision authority is unavailable.");
		let partial = manifest;
		if (manifest.value.stage !== "partial")
			partial = await authority.manifests.update(manifest, {
				stage: "partial",
				pendingEffect: undefined,
			});
		await terminalize(active, lease, "partial");
		pending = undefined;
		return prepare(plan, "recovery", active.attempt + 1, partial, details);
	}

	async function execute(
		active: PreparedCompanionOperation,
		lease: ExecutionLease,
	): Promise<InstallMissingResult> {
		if (!authority) throw new Error("Shared decision authority is unavailable.");
		const latest = snapshot();
		if (!latest.ok) {
			await terminalize(active, lease, "drifted");
			pending = undefined;
			return result(
				"blocked",
				`${latest.message}\nThe approved operation was closed before any new effect.`,
				"error",
				latest.companionPlan && latest.mcpPath
					? {
							companionPlan: latest.companionPlan,
							mcpPlan: { ...emptyMcpConfigurationPlan(mcp), path: latest.mcpPath },
						}
					: undefined,
			);
		}
		if (
			latest.value.planDigest !== active.planDigest ||
			canonicalJson(latest.value.identity) !== canonicalJson(active.identity)
		) {
			await terminalize(active, lease, "drifted");
			pending = undefined;
			return prepare(
				latest.value,
				"recovery",
				active.attempt + 1,
				active.manifest,
				["Package or targeted MCP evidence changed after approval."],
			);
		}

		let manifest: StoredCompanionInstallManifest;
		try {
			manifest = await bindManifest(active, lease);
		} catch (error) {
			pending = undefined;
			return result(
				"blocked",
				`Companion execution binding failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
				latest.value,
			);
		}

		let failures: CompanionInstallFailure[] = [...manifest.value.failures];
		const completedPackages = new Set(manifest.value.completedPackages);
		for (const entry of active.identity.packages) {
			if (completedPackages.has(entry.package)) continue;
			const current = getCompanionState(
				{ package: entry.package },
				catalog.resolveInstalledVersion ?? getInstalledCompanionVersion,
			);
			if (current.status === "installed") {
				completedPackages.add(entry.package);
				failures = withoutPackageFailure(failures, entry.package);
				manifest = await authority.manifests.update(manifest, {
					completedPackages: [...completedPackages],
					failures,
				});
				continue;
			}
			if (current.status !== "missing") {
				const detail = `${entry.spec}: ${current.error ?? "package state is unavailable"}`;
				failures = withoutPackageFailure(failures, entry.package);
				failures.push({ kind: "package", package: entry.package, message: detail });
				manifest = await authority.manifests.update(manifest, {
					failures,
					stage: "partial",
				});
				return prepareRecovery(active, lease, manifest, latest.value, [detail]);
			}
			manifest = await authority.manifests.update(manifest, {
				pendingEffect: { kind: "package", package: entry.package },
			});
			try {
				await authorizeEffect(lease);
				notify(interaction, `Installing ${entry.spec}...`, "info");
				const installed = await installPackage?.(entry.spec);
				if (installed?.code !== 0) {
					const message =
						installed?.stderr?.trim() ||
						installed?.stdout?.trim() ||
						`exit code ${installed?.code ?? "unknown"}`;
					failures = withoutPackageFailure(failures, entry.package);
					failures.push({
						kind: "package",
						package: entry.package,
						message: `${entry.spec}: ${message}`,
					});
				} else {
					completedPackages.add(entry.package);
					failures = withoutPackageFailure(failures, entry.package);
				}
			} catch (error) {
				failures = withoutPackageFailure(failures, entry.package);
				failures.push({
					kind: "package",
					package: entry.package,
					message: `${entry.spec}: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
			manifest = await authority.manifests.update(manifest, {
				completedPackages: [...completedPackages],
				failures,
				pendingEffect: undefined,
			});
		}

		if (!active.mcpPlan.changed) {
			failures = withoutMcpFailure(failures);
			manifest = await authority.manifests.update(manifest, {
				mcpConfigured: true,
				failures,
			});
		} else if (!manifest.value.mcpConfigured) {
			const latestMcpPlan = planMcpConfiguration(active.mcpCatalog, mcp);
			const latestMcpDigest = digestCanonicalValue(mcpPlanEvidence(latestMcpPlan));
			if (latestMcpPlan.error || latestMcpDigest !== active.mcpPlanDigest) {
				const detail = latestMcpPlan.error
					? `MCP configuration could not be re-read: ${latestMcpPlan.error}`
					: `MCP configuration at ${active.mcpPlan.path} changed after approval.`;
				failures = withoutMcpFailure(failures);
				failures.push({ kind: "mcp", path: active.mcpPlan.path, message: detail });
				manifest = await authority.manifests.update(manifest, {
					failures,
					stage: "partial",
				});
				const replanned = snapshot();
				return prepareRecovery(
					active,
					lease,
					manifest,
					replanned.ok ? replanned.value : latest.value,
					[detail],
				);
			}
			manifest = await authority.manifests.update(manifest, {
				pendingEffect: { kind: "mcp", path: active.mcpPlan.path },
			});
			try {
				await authorizeEffect(lease);
				const applied = applyMcpConfiguration(
					active.mcpPlan,
					active.mcpCatalog,
					mcp,
				);
				if (applied.status !== "applied") {
					const detail =
						applied.status === "refused-concurrent-change"
							? `MCP targets changed after fencing: ${applied.changedTargets.join(", ")}`
							: `MCP configuration failed: ${applied.error}`;
					failures = withoutMcpFailure(failures);
					failures.push({ kind: "mcp", path: active.mcpPlan.path, message: detail });
					manifest = await authority.manifests.update(manifest, {
						failures,
						stage: "partial",
						pendingEffect: undefined,
					});
					const replanned = snapshot();
					return prepareRecovery(
						active,
						lease,
						manifest,
						replanned.ok ? replanned.value : latest.value,
						[detail],
					);
				}
				failures = withoutMcpFailure(failures);
				manifest = await authority.manifests.update(manifest, {
					mcpConfigured: true,
					failures,
					pendingEffect: undefined,
				});
			} catch (error) {
				const detail = `MCP effect authorization failed: ${error instanceof Error ? error.message : String(error)}`;
				failures = withoutMcpFailure(failures);
				failures.push({ kind: "mcp", path: active.mcpPlan.path, message: detail });
				manifest = await authority.manifests.update(manifest, {
					failures,
					stage: "partial",
				});
				return prepareRecovery(active, lease, manifest, latest.value, [detail]);
			}
		}

		if (failures.length > 0) {
			manifest = await authority.manifests.update(manifest, {
				stage: "partial",
				failures,
			});
			const replanned = snapshot();
			return prepareRecovery(
				active,
				lease,
				manifest,
				replanned.ok ? replanned.value : latest.value,
				failures.map((failure) => failure.message),
			);
		}

		await authority.manifests.update(manifest, {
			stage: "completed",
			pendingEffect: undefined,
		});
		await terminalize(active, lease, "completed");
		pending = undefined;
		const message =
			"Installed or updated pi-workflow companions and configured the reviewed MCP plan. Run /reload; authenticate Sentry/Linear as needed.";
		return result("installed", message, "info", latest.value);
	}

	async function startInstall(): Promise<InstallMissingResult> {
		const planned = snapshot();
		if (!planned.ok)
			return result(
				planned.outcome,
				planned.message,
				"error",
				planned.companionPlan && planned.mcpPath
					? {
							companionPlan: planned.companionPlan,
							mcpPlan: { ...emptyMcpConfigurationPlan(mcp), path: planned.mcpPath },
						}
					: undefined,
			);
		const plan = planned.value;
		if (
			plan.companionPlan.installable.length === 0 &&
			!plan.mcpPlan.changed
		)
			return result(
				"noop",
				"pi-workflow companions are installed and MCP servers are already configured.",
				"info",
				plan,
			);
		if (plan.companionPlan.installable.length > 0 && !installPackage)
			return result(
				"blocked",
				"The package execution capability is unavailable; no package or MCP effects were authorized.",
				"error",
				plan,
			);
		if (!authority)
			return result(
				"blocked",
				"Shared interactive decision authority is unavailable; no package or MCP effects were authorized.",
				"error",
				plan,
			);
		try {
			const operationId = companionInstallOperationId(plan.identity);
			let manifest = await authority.manifests.read(operationId);
			if (manifest?.value.stage === "executing")
				manifest = await authority.manifests.update(manifest, { stage: "partial" });
			if (
				manifest?.value.stage === "completed" ||
				manifest?.value.stage === "cancelled"
			)
				return result(
					"blocked",
					`Companion operation ${operationId} is already ${manifest.value.stage}; terminal evidence cannot be replayed.`,
					"error",
					plan,
				);
			if (manifest)
				return prepare(
					plan,
					"recovery",
					manifest.value.attempt + 1,
					manifest,
					[
						manifest.value.pendingEffect
							? `Interrupted ${manifest.value.pendingEffect.kind} effect requires reconciliation.`
							: `Durable operation is ${manifest.value.stage}.`,
					],
				);
			return prepare(plan, "install", 1);
		} catch (error) {
			return result(
				"blocked",
				`Companion recovery evidence could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
				"error",
				plan,
			);
		}
	}

	async function continuePending(): Promise<InstallMissingResult | undefined> {
		const active = pending;
		if (!active || !authority) return undefined;
		const actor = authority.actor();
		if (!actor)
			return result(
				"blocked",
				"Authenticated local operator authority disappeared before execution; no effects were run.",
				"error",
				active,
			);
		for (const action of active.descriptor.actions) {
			let authorization: AuthorizationOutcome;
			try {
				authorization = await authority.decisions.authorize(
					active.decisionId,
					action,
					actor,
				);
			} catch (error) {
				pending = undefined;
				return result(
					"blocked",
					`Shared companion decision failed closed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
					active,
				);
			}
			if (authorization.kind === "blocked") {
				if (
					authorization.blocker.code === "PI_WORKFLOW_DECISION_CLAIM_MISSING" ||
					authorization.blocker.code === "PI_WORKFLOW_DECISION_ACTION_MISMATCH"
				)
					continue;
				pending = undefined;
				return result(
					"blocked",
					authorization.blocker.message,
					"error",
					active,
				);
			}
			if (authorization.kind === "cancelled") {
				if (active.manifest)
					await authority.manifests.update(active.manifest, {
						stage: "cancelled",
						pendingEffect: undefined,
					});
				pending = undefined;
				return result(
					"canceled",
					"Canceled through the shared decision. No additional package or MCP effects were run.",
					"info",
					active,
				);
			}
			if (action.id === "companions.wait") {
				const manifest = await bindManifest(active, authorization.lease);
				await authority.manifests.update(manifest, {
					stage: "waiting",
					pendingEffect: undefined,
				});
				await terminalize(active, authorization.lease, "waiting");
				pending = undefined;
				return result(
					"waiting",
					"Companion reconciliation is waiting. Durable progress was preserved and no additional effects were run.",
					"info",
					active,
				);
			}
			return execute(active, authorization.lease);
		}
		return undefined;
	}

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

		continuePending,

		async installMissing(): Promise<InstallMissingResult> {
			return startInstall();

		},
	};
}
