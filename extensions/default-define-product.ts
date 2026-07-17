import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
	DefaultResourceLoader,
	SessionManager,
	createAgentSession,
	getAgentDir,
	parseFrontmatter,
	type AgentSession,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { createAgentValidator } from "./agent-validator.ts";
import {
	createDurableDelegationCheckpointStore,
	type DelegationCheckpointStore,
} from "./delegation-checkpoints.ts";
import {
	createDefineProductWorkflow,
	type ExplorationRecoveryStore,
	type SpecApprovalRecoveryStore,
	type TicketApprovalRecoveryStore,
} from "./define-product-workflow.ts";
import { createProjectStandardsResolver } from "./project-standards-resolver.ts";
import { createSkillResolver } from "./skill-resolver.ts";
import {
	createSubagentLauncher,
	type LaunchOptions,
} from "./subagent-launcher.ts";
import { createRuntimeEngramApprovedSpecStore, createRuntimeEngramArtifactStore } from "./runtime-engram-store.ts";
import { createRuntimePrivateStatePersistence } from "./runtime-private-state.ts";
import { createDurableExplorationRecoveryStore } from "./exploration-recovery.ts";
import { createDurableSpecApprovalRecoveryStore } from "./spec-approval-recovery.ts";
import { createDurableTicketApprovalRecoveryStore } from "./ticket-approval-recovery.ts";
import { createDurablePublicationManifest } from "./publication-manifest.ts";
import type { DeliveryParentPublicationDependencies } from "./delivery-parent-publication.ts";
import { createEngramApprovedSpecReader } from "./engram-approved-spec-reader.ts";
import { createLinearDeliveryParentGateway } from "./linear-delivery-parent-gateway.ts";
import { createRuntimeLinearDeliveryParentTransport } from "./runtime-linear-delivery-parent.ts";
import { createPublicationStateMachine } from "./publication-state-machine.ts";
import { createDeliveryParentSnapshotStore, readDeliveryParentSnapshot } from "./delivery-parent-snapshot-store.ts";
import { createApprovedTicketGraphStore } from "./approved-ticket-graph-store.ts";
import { createApprovedTicketPublicationStore } from "./approved-ticket-publication.ts";
import { publishApprovedTickets } from "./delivery-ticket-publication.ts";
import { publishApprovedRevision, type ApprovedRevisionPublicationArtifact } from "./approved-revision-publication.ts";
import { createApprovedRevisionPublicationManifestStore } from "./approved-revision-publication-manifest.ts";
import { createRuntimeLinearApprovedRevisionGateway } from "./runtime-linear-approved-revision.ts";
import { recoverApprovedTicketGraph } from "./ticket-graph-recovery.ts";
import { createTicketPublicationAuthorityGuard } from "./ticket-publication-authority-guard.ts";
import { createTicketPublicationManifestStore } from "./ticket-publication-manifest.ts";
import { createRuntimeLinearDeliveryTicketGateway } from "./runtime-linear-delivery-ticket.ts";
import type { DeliveryTicketGraph } from "./delivery-ticket-graph.ts";
import {
	createResearchEvidenceEnvelope,
	createBlocker,
	uniqueVerifiedArtifactRefs,
	type AuthenticatedAuthority,
	type OwnerAuthority,
	type DesignExplorationSnapshot,
	type DigestedRef,
	type ExactLaunchProvenance,
	type Intervention,
	type PreparedLaunch,
	type ProjectRef,
	type ResearchFinding,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";
import {
	createWorkflowArtifactInterface,
	type WorkflowArtifactStore,
} from "./workflow-artifacts.ts";
import { createWorkflowDelegate } from "./workflow-delegate.ts";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetCatalogPath = join(packageDirectory, "assets", "agent-assets.json");
const researchAssetPath = join(packageDirectory, "assets", "agents", "research.md");
const prototypeAssetPath = join(packageDirectory, "assets", "agents", "prototype.md");
const ticketGraphAssetPath = join(packageDirectory, "assets", "agents", "to-tickets.md");
const publicSkillNames = new Set([
	"define-product",
	"deliver-ticket",
	"qa-handoff",
	"product-review",
]);
const workflowArtifactToolName = "workflow_artifact_session";
const allowedResearchTools = [
	"read",
	"grep",
	"find",
	"ls",
	"web_search",
	"fetch_content",
	"get_search_content",
	workflowArtifactToolName,
];
const allowedExplorationTools = [
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"bash",
	workflowArtifactToolName,
];
const allowedTicketGraphTools = ["read", "grep", "find", "ls", workflowArtifactToolName];

const artifactToolParameters = {
	type: "object",
	additionalProperties: false,
	properties: {
		action: { type: "string", enum: ["write_snapshot"] },
		findings: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					claim: { type: "string" },
					evidence: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								uri: { type: "string" },
								title: { type: "string" },
								retrievedAt: { type: "string" },
								publishedAt: { type: "string" },
								excerpt: { type: "string" },
							},
							required: ["uri", "title", "retrievedAt"],
						},
					},
				},
				required: ["claim", "evidence"],
			},
		},
		limitations: {
			type: "array",
			items: { type: "string" },
		},
	},
	required: ["action", "findings", "limitations"],
} as const;

const explorationArtifactToolParameters = {
	type: "object",
	additionalProperties: false,
	properties: {
		action: {
			type: "string",
			enum: ["read_alias", "merge_progress", "write_snapshot"],
		},
		alias: { type: "string" },
		batchKey: { type: "string" },
		payload: {},
		digest: { type: "string" },
		supersedes: { type: "string" },
		summary: { type: "string" },
		comparison: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					criterion: { type: "string" },
					assessment: { type: "string" },
				},
				required: ["criterion", "assessment"],
			},
		},
		changedPaths: { type: "array", items: { type: "string" } },
		discoveredPaths: { type: "array", items: { type: "string" } },
		limitations: { type: "array", items: { type: "string" } },
	},
	required: ["action"],
} as const;

const ticketGraphArtifactToolParameters = {
	type: "object",
	additionalProperties: false,
	properties: {
		action: { type: "string", enum: ["read_alias", "write_graph"] },
		alias: { type: "string" },
		graph: {},
	},
	required: ["action"],
} as const;

interface AgentAssetMetadata {
	name: string;
	version: number;
	digest: string;
	capabilityProfile: string;
	provider: string;
	model: string;
	effort: string;
	inheritContext: boolean;
	promptMode: string;
	allowedTools: readonly string[];
	extensions: readonly string[];
	skills: readonly string[];
	supportsScopedArtifacts: boolean;
	systemPrompt: string;
}

interface ResearchExecutorInput {
	cwd: string;
	launchOptions: LaunchOptions;
	model: NonNullable<ExtensionContext["model"]>;
	thinkingLevel: "medium";
	prompt: string;
	systemPrompt: string;
	allowedTools: readonly string[];
	webExtensionPath: string;
	writeArtifact(input: {
		findings: readonly ResearchFinding[];
		limitations: readonly string[];
	}): Promise<VerifiedArtifactRef>;
}

interface ResearchExecutor {
	execute(input: ResearchExecutorInput): Promise<{ assistantText: string }>;
}

interface ExplorationExecutorInput {
	cwd: string;
	launchOptions: LaunchOptions;
	model: NonNullable<ExtensionContext["model"]>;
	thinkingLevel: "medium";
	intent: "prototype" | "design-alternative";
	prompt: string;
	systemPrompt: string;
	allowedTools: readonly string[];
	launchProvenance: ExactLaunchProvenance;
	readArtifact(alias: string): Promise<string>;
	mergeProgress(
		batch: Parameters<PreparedLaunch["artifactSession"]["mergeProgress"]>[0],
	): Promise<VerifiedArtifactRef>;
	writeArtifact(input: DesignExplorationSnapshot): Promise<VerifiedArtifactRef>;
}

interface ExplorationExecutor {
	execute(input: ExplorationExecutorInput): Promise<{
		assistantText: string;
		discoveredPaths?: readonly string[];
	}>;
	intervene?(sessionId: string, intervention: Intervention): Promise<void>;
}

interface TicketGraphExecutorInput {
	cwd: string;
	launchOptions: LaunchOptions;
	model: NonNullable<ExtensionContext["model"]>;
	thinkingLevel: "medium";
	prompt: string;
	systemPrompt: string;
	allowedTools: readonly string[];
	readArtifact(alias: string): Promise<string>;
	writeArtifact(graph: DeliveryTicketGraph): Promise<VerifiedArtifactRef>;
}

interface TicketGraphExecutor {
	execute(input: TicketGraphExecutorInput): Promise<{ assistantText: string }>;
}

export interface DefaultDefineProductRuntimeOptions {
	artifactStore?: WorkflowArtifactStore;
	checkpointStore?: DelegationCheckpointStore;
	explorationRecoveryStore?: ExplorationRecoveryStore;
	specApprovalRecoveryStore?: SpecApprovalRecoveryStore;
	ticketApprovalRecoveryStore?: TicketApprovalRecoveryStore;
	authenticatedAuthority?: {
		current(): Promise<AuthenticatedAuthority>;
	};
	approvedSpecReader?: DeliveryParentPublicationDependencies["approvedSpecReader"];
	linearDeliveryParents?: DeliveryParentPublicationDependencies["linear"];
	linearDeliveryTickets?: ReturnType<typeof createRuntimeLinearDeliveryTicketGateway>;
	linearApprovedRevision?: ReturnType<typeof createRuntimeLinearApprovedRevisionGateway>;
	publicationManifest?: Parameters<typeof createPublicationStateMachine>[0]["store"];
	researchExecutor?: ResearchExecutor | ResearchExecutor["execute"];
	explorationExecutor?: ExplorationExecutor | ExplorationExecutor["execute"];
	ticketGraphExecutor?: TicketGraphExecutor | TicketGraphExecutor["execute"];
	webExtensionPath?: string;
	createRequestId?: () => string;
	skillEntries?: readonly {
		name: string;
		path: string;
		scope: "core" | "project" | "public";
	}[];
}

function configuredOwnerAuthority(
	environment: NodeJS.ProcessEnv,
): DefaultDefineProductRuntimeOptions["authenticatedAuthority"] {
	const actorId = environment.PI_WORKFLOW_OWNER_ACTOR_ID;
	const authorityRevision =
		environment.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	if (
		!actorId ||
		actorId !== actorId.trim() ||
		!authorityRevision ||
		authorityRevision !== authorityRevision.trim()
	) {
		return undefined;
	}
	const authority = Object.freeze({
		actorId,
		role: "Owner" as const,
		authorityRevision,
	});
	return { current: async () => authority };
}

function configuredLinearDeliveryParents(
	environment: NodeJS.ProcessEnv,
): DeliveryParentPublicationDependencies["linear"] | undefined {
	const apiKey = environment.LINEAR_API_KEY?.trim();
	if (!apiKey) return undefined;
	return createLinearDeliveryParentGateway(createRuntimeLinearDeliveryParentTransport({
		apiKey,
		url: environment.LINEAR_API_URL?.trim() || undefined,
	}));
}

function configuredLinearDeliveryTickets(
	environment: NodeJS.ProcessEnv,
): DefaultDefineProductRuntimeOptions["linearDeliveryTickets"] {
	const apiKey = environment.LINEAR_API_KEY?.trim();
	return apiKey
		? createRuntimeLinearDeliveryTicketGateway({
			apiKey,
			url: environment.LINEAR_API_URL?.trim() || undefined,
		})
		: undefined;
}

function configuredLinearApprovedRevision(
	environment: NodeJS.ProcessEnv,
): DefaultDefineProductRuntimeOptions["linearApprovedRevision"] {
	const apiKey = environment.LINEAR_API_KEY?.trim();
	return apiKey
		? createRuntimeLinearApprovedRevisionGateway({
			apiKey,
			url: environment.LINEAR_API_URL?.trim() || undefined,
		})
		: undefined;
}

function findProjectRoot(cwd: string): string {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}

function resolveProjectRef(cwd: string): ProjectRef {
	const root = findProjectRoot(cwd);
	return { name: basename(root), root };
}

function lastAssistantText(messages: readonly { role?: string; content?: unknown }[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
				const text = (part as { text?: unknown }).text;
				if (typeof text === "string" && text.trim().length > 0) return text.trim();
			}
		}
	}
	return "";
}

interface InterruptedRuntimeError extends Error {
	code: "PI_WORKFLOW_DELEGATION_INTERRUPTED";
	interrupted: true;
	sessionId?: string;
	verifiedArtifacts: readonly VerifiedArtifactRef[];
}

function isInterruptedRuntimeError(
	error: unknown,
): error is InterruptedRuntimeError {
	if (!(error instanceof Error)) return false;
	const candidate = error as Partial<InterruptedRuntimeError>;
	return (
		candidate.code === "PI_WORKFLOW_DELEGATION_INTERRUPTED" &&
		candidate.interrupted === true &&
		Array.isArray(candidate.verifiedArtifacts)
	);
}

function readFileIfPresent(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	return readFileSync(path, "utf8");
}

function readAgentAssetMetadata(
	name: "research" | "prototype" | "to-tickets",
	path: string,
	allowedTools: readonly string[],
): AgentAssetMetadata {
	const catalog = JSON.parse(readFileSync(assetCatalogPath, "utf8")) as {
		assets?: Array<{ kind?: string; name?: string; version?: number; digest?: string }>;
	};
	const catalogEntry = catalog.assets?.find(
		(entry) => entry.kind === "agent" && entry.name === name,
	);
	if (!catalogEntry?.digest || typeof catalogEntry.version !== "number") {
		throw new Error(`The packaged ${name} asset catalog entry is missing or invalid.`);
	}
	const parsed = parseFrontmatter<Record<string, unknown>>(
		readFileSync(path, "utf8"),
	);
	const modelReference = String(parsed.frontmatter.model ?? "").trim();
	const [provider, model] = modelReference.split("/");
	if (!provider || !model) {
		throw new Error("The packaged research asset model reference is invalid.");
	}
	return {
		name,
		version: catalogEntry.version,
		digest: catalogEntry.digest,
		capabilityProfile: String(parsed.frontmatter.capability_profile ?? ""),
		provider,
		model,
		effort: String(parsed.frontmatter.thinking ?? ""),
		inheritContext: parsed.frontmatter.inherit_context === true,
		promptMode: String(parsed.frontmatter.prompt_mode ?? ""),
		allowedTools,
		extensions: Array.isArray(parsed.frontmatter.extensions)
			? parsed.frontmatter.extensions.map((entry) => String(entry))
			: [],
		skills: Array.isArray(parsed.frontmatter.skills)
			? parsed.frontmatter.skills.map((entry) => String(entry))
			: [],
		supportsScopedArtifacts: true,
		systemPrompt: parsed.body.trim(),
	};
}

function readResearchAssetMetadata(): AgentAssetMetadata {
	return readAgentAssetMetadata(
		"research",
		researchAssetPath,
		allowedResearchTools,
	);
}

function readExplorationAssetMetadata(): AgentAssetMetadata {
	return readAgentAssetMetadata(
		"prototype",
		prototypeAssetPath,
		allowedExplorationTools,
	);
}

function readTicketGraphAssetMetadata(): AgentAssetMetadata {
	return readAgentAssetMetadata("to-tickets", ticketGraphAssetPath, allowedTicketGraphTools);
}

function listSkillRegistryEntries(projectRoot: string) {
	const registryPath = join(projectRoot, ".atl", "skill-registry.md");
	if (!existsSync(registryPath)) return [];
	const lines = readFileSync(registryPath, "utf8").split("\n");
	const entries: Array<{
		name: string;
		path: string;
		scope: "core" | "project" | "public";
	}> = [];
	for (const line of lines) {
		if (!line.startsWith("| `")) continue;
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
		if (cells.length < 4) continue;
		const [nameCell, , , pathCell] = cells;
		const name = nameCell.replace(/^`|`$/g, "").trim();
		const path = pathCell.replace(/^`|`$/g, "").trim();
		if (!name || !path.startsWith("/")) continue;
		const scope = path.startsWith(projectRoot)
			? publicSkillNames.has(name)
				? "public"
				: "project"
			: "core";
		entries.push({ name, path, scope });
	}
	return entries;
}

function fallbackSkillEntries(projectRoot: string) {
	const roots = [
		join(projectRoot, "skills"),
		join(projectRoot, ".pi", "skills"),
		join(projectRoot, ".agents", "skills"),
		join(process.env.HOME ?? "", ".pi", "agent", "skills"),
		join(process.env.HOME ?? "", ".agents", "skills"),
	];
	const entries: Array<{
		name: string;
		path: string;
		scope: "core" | "project" | "public";
	}> = [];
	for (const root of roots) {
		if (!root || !existsSync(root)) continue;
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const skillPath = join(root, entry.name, "SKILL.md");
			if (!existsSync(skillPath)) continue;
			const canonical = realpathSync(skillPath);
			const scope = canonical.startsWith(projectRoot)
				? publicSkillNames.has(entry.name)
					? "public"
					: "project"
				: "core";
			entries.push({ name: entry.name, path: canonical, scope });
		}
	}
	return entries;
}

function resolveWebExtensionPath(projectRoot: string, override?: string): string {
	const candidates = [
		override,
		join(getAgentDir(), "npm", "node_modules", "pi-web-access", "index.ts"),
		join(projectRoot, "node_modules", "pi-web-access", "index.ts"),
	].filter((value): value is string => Boolean(value));
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0] ?? join(getAgentDir(), "npm", "node_modules", "pi-web-access", "index.ts");
}

function buildResearchSystemPrompt(input: {
	asset: AgentAssetMetadata;
	preparedLaunch: PreparedLaunch;
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
}) {
	const skillBlocks = input.skillRefs.map((ref) => {
		const content = readFileSync(ref.path, "utf8");
		return `## Skill\nName: ${ref.name}\nPath: ${ref.path}\nDigest: ${ref.digest}\n\n${content}`;
	});
	const standardBlocks = input.standardRefs.map((ref) => {
		const content = readFileSync(ref.path, "utf8");
		return `## Standard\nName: ${ref.name}\nPath: ${ref.path}\nDigest: ${ref.digest}\n\n${content}`;
	});
	return [
		input.asset.systemPrompt,
		"You are executing the package-owned define-product research workflow.",
		`Capability profile: ${input.preparedLaunch.launchProvenance.capabilityProfile}.`,
		`Provider/model/effort: ${input.preparedLaunch.launchProvenance.provider}/${input.preparedLaunch.launchProvenance.model} / ${input.preparedLaunch.launchProvenance.effort}.`,
		`Artifact topic: ${input.preparedLaunch.launchProvenance.artifactTopic}.`,
		`Confirmed route: ${input.preparedLaunch.intent.route}.`,
		"Use only the exposed read-only tools plus workflow_artifact_session.",
		"Do not invoke public skills, Linear capabilities, bash, editing, writing, or recursive agent launches.",
		`Call ${workflowArtifactToolName} exactly once with action="write_snapshot" after collecting evidence.`,
		"After the tool returns, provide a concise executive summary and one next recommended step for the Owner.",
		...skillBlocks,
		...standardBlocks,
	].join("\n\n");
}

function buildExplorationSystemPrompt(input: {
	asset: AgentAssetMetadata;
	preparedLaunch: PreparedLaunch;
	skillRefs: readonly DigestedRef[];
	standardRefs: readonly DigestedRef[];
}) {
	const skillBlocks = input.skillRefs.map((ref) => {
		const content = readFileSync(ref.path, "utf8");
		return `## Skill\nName: ${ref.name}\nPath: ${ref.path}\nDigest: ${ref.digest}\n\n${content}`;
	});
	const standardBlocks = input.standardRefs.map((ref) => {
		const content = readFileSync(ref.path, "utf8");
		return `## Standard\nName: ${ref.name}\nPath: ${ref.path}\nDigest: ${ref.digest}\n\n${content}`;
	});
	return [
		input.asset.systemPrompt,
		`You are executing the package-owned ${input.preparedLaunch.intent.kind} workflow in a disposable project copy.`,
		`Capability profile: ${input.preparedLaunch.launchProvenance.capabilityProfile}.`,
		`Provider/model/effort: ${input.preparedLaunch.launchProvenance.provider}/${input.preparedLaunch.launchProvenance.model} / ${input.preparedLaunch.launchProvenance.effort}.`,
		"Read only explicitly granted aliases through workflow_artifact_session action=read_alias.",
		"Never inspect or expose delegation checkpoints, private workflow state, raw history, Linear, or agent launch capabilities.",
		"Repository writes and bounded shell commands are allowed only inside this disposable copy.",
		"Persist durable intermediate batches with workflow_artifact_session action=merge_progress when recovery would otherwise lose verified work.",
		"Report newly discovered project paths that require standards or skill re-resolution separately from files changed in the disposable copy.",
		`Call ${workflowArtifactToolName} exactly once with action=write_snapshot and a comparable summary, comparison criteria, changed paths, and limitations.`,
		...skillBlocks,
		...standardBlocks,
	].join("\n\n");
}

function buildTicketGraphSystemPrompt(input: { asset: AgentAssetMetadata; preparedLaunch: PreparedLaunch }) {
	return [
		input.asset.systemPrompt,
		"You are executing the package-owned to-tickets workflow.",
		`Artifact topic: ${input.preparedLaunch.launchProvenance.artifactTopic}.`,
		"Read only the granted approved-spec and delivery-parent aliases through workflow_artifact_session.",
		"Call workflow_artifact_session exactly once with action=write_graph and the complete canonical graph.",
	].join("\n\n");
}

const researchMaxTurns = 20;

export async function executeResearchSession(
	session: {
		messages: readonly { role?: string; content?: unknown }[];
		bindExtensions(bindings: Record<string, never>): Promise<void>;
		subscribe(listener: (event: { type: string }) => void): () => void;
		prompt(prompt: string): Promise<void>;
		abort(): Promise<void>;
	},
	prompt: string,
): Promise<{ assistantText: string }> {
	let turnCount = 0;
	let limitExceeded = false;
	await session.bindExtensions({});
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "turn_end") return;
		turnCount += 1;
		if (turnCount < researchMaxTurns) return;
		limitExceeded = true;
		void session.abort().catch(() => undefined);
	});
	try {
		await session.prompt(prompt);
		if (limitExceeded) {
			throw new Error(
				"PI_WORKFLOW_RESEARCH_MAX_TURNS_EXCEEDED: research is limited to 20 turns.",
			);
		}
		return { assistantText: lastAssistantText(session.messages) };
	} finally {
		unsubscribe();
	}
}

function createDefaultResearchExecutor(): ResearchExecutor {
	return {
		async execute(input) {
			const resourceLoader = new DefaultResourceLoader({
				cwd: input.cwd,
				agentDir: getAgentDir(),
				additionalExtensionPaths: [input.webExtensionPath],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPrompt: input.systemPrompt,
				extensionsOverride: (base) => ({
					...base,
					extensions: base.extensions.filter(
						(extension) => extension.resolvedPath === input.webExtensionPath,
					),
				}),
			});
			await resourceLoader.reload();
			const customTools = [
				{
					name: workflowArtifactToolName,
					label: "Workflow Artifact Session",
					description:
						"Persist the request-bound research artifact snapshot for the active define-product workflow.",
					parameters: artifactToolParameters as never,
					async execute(_toolCallId: string, params: {
						action: "write_snapshot";
						findings: readonly ResearchFinding[];
						limitations: readonly string[];
					}) {
						const artifact = await input.writeArtifact({
							findings: params.findings,
							limitations: params.limitations,
						});
						return {
							content: [{ type: "text" as const, text: JSON.stringify(artifact, null, 2) }],
							details: artifact,
						};
					},
				},
			];
			const { session } = await createAgentSession({
				cwd: input.cwd,
				agentDir: getAgentDir(),
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				resourceLoader,
				tools: [...input.allowedTools],
				customTools,
				sessionManager: SessionManager.inMemory(input.cwd),
			});
			try {
				return await executeResearchSession(session, input.prompt);
			} finally {
				session.dispose();
			}
		},
	};
}

function createDefaultTicketGraphExecutor(): TicketGraphExecutor {
	return {
		async execute(input) {
			const resourceLoader = new DefaultResourceLoader({
				cwd: input.cwd, agentDir: getAgentDir(), noSkills: true, noPromptTemplates: true,
				noThemes: true, noContextFiles: true, systemPrompt: input.systemPrompt,
				extensionsOverride: (base) => ({ ...base, extensions: [] }),
			});
			await resourceLoader.reload();
			const { session } = await createAgentSession({
				cwd: input.cwd, agentDir: getAgentDir(), model: input.model,
				thinkingLevel: input.thinkingLevel, resourceLoader, tools: [...input.allowedTools],
				customTools: [{
					name: workflowArtifactToolName, label: "Workflow Artifact Session",
					description: "Read granted inputs and persist one verified delivery ticket graph.",
					parameters: ticketGraphArtifactToolParameters as never,
					async execute(_toolCallId: string, params: { action: "read_alias" | "write_graph"; alias?: string; graph?: DeliveryTicketGraph }) {
						if (params.action === "read_alias") {
							if (!params.alias) throw new Error("A granted artifact alias is required.");
							return { content: [{ type: "text" as const, text: await input.readArtifact(params.alias) }], details: { alias: params.alias } };
						}
						if (!params.graph) throw new Error("A delivery ticket graph is required.");
						const artifact = await input.writeArtifact(params.graph);
						return { content: [{ type: "text" as const, text: JSON.stringify(artifact, null, 2) }], details: artifact };
					},
				}],
				sessionManager: SessionManager.inMemory(input.cwd),
			});
			try { return await executeResearchSession(session, input.prompt); }
			finally { session.dispose(); }
		},
	};
}

export async function createRecoverableSessionManager(
	cwd: string,
	sessionDirectory: string,
	launchOptions: LaunchOptions,
): Promise<SessionManager> {
	if (launchOptions.resumeSessionId) {
		const sessions = await SessionManager.listAll(sessionDirectory);
		const exact = sessions.find(
			(session) => session.id === launchOptions.resumeSessionId,
		);
		if (!exact) {
			throw new Error(
				`The exact recoverable Pi session is unavailable: ${launchOptions.resumeSessionId}.`,
			);
		}
		return SessionManager.open(exact.path, sessionDirectory, cwd);
	}
	const manager = SessionManager.create(cwd, sessionDirectory, {
		id: launchOptions.sessionId,
	});
	manager.appendSessionInfo(launchOptions.sessionId);
	return manager;
}

export function createDefaultExplorationExecutor(
	sessionDirectory: string,
	createSession: typeof createAgentSession = createAgentSession,
): ExplorationExecutor {
	const activeSessions = new Map<string, AgentSession>();
	return {
		async execute(input) {
			let discoveredPaths: readonly string[] | undefined;
			const resourceLoader = new DefaultResourceLoader({
				cwd: input.cwd,
				agentDir: getAgentDir(),
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPrompt: input.systemPrompt,
				extensionsOverride: (base) => ({ ...base, extensions: [] }),
			});
			await resourceLoader.reload();
			const customTools = [
				{
					name: workflowArtifactToolName,
					label: "Workflow Artifact Session",
					description:
						"Read granted aliases, merge immutable progress, and persist one request-bound design exploration snapshot.",
					parameters: explorationArtifactToolParameters as never,
					async execute(
						_toolCallId: string,
						params: {
							action: "read_alias" | "merge_progress" | "write_snapshot";
							alias?: string;
							batchKey?: string;
							payload?: unknown;
							digest?: string;
							supersedes?: string;
							summary?: string;
							comparison?: DesignExplorationSnapshot["comparison"];
							changedPaths?: readonly string[];
							discoveredPaths?: readonly string[];
							limitations?: readonly string[];
						},
					) {
						if (params.action === "read_alias") {
							if (!params.alias) throw new Error("A granted artifact alias is required.");
							const content = await input.readArtifact(params.alias);
							return {
								content: [{ type: "text" as const, text: content }],
								details: { alias: params.alias },
							};
						}
						if (params.action === "merge_progress") {
							if (!params.batchKey?.trim()) {
								throw new Error("A non-empty progress batch key is required.");
							}
							const artifact = await input.mergeProgress({
								batchKey: params.batchKey,
								payload: params.payload,
								...(params.digest === undefined ? {} : { digest: params.digest }),
								...(params.supersedes === undefined
									? {}
									: { supersedes: params.supersedes }),
							});
							return {
								content: [{ type: "text" as const, text: JSON.stringify(artifact, null, 2) }],
								details: artifact,
							};
						}
						discoveredPaths = params.discoveredPaths
							?.map((path) => path.trim())
							.filter(Boolean);
						const artifact = await input.writeArtifact({
							summary: params.summary ?? "",
							comparison: params.comparison ?? [],
							changedPaths: params.changedPaths ?? [],
							limitations: params.limitations ?? [],
						});
						return {
							content: [{ type: "text" as const, text: JSON.stringify(artifact, null, 2) }],
							details: artifact,
						};
					},
				},
			];
			const sessionManager = await createRecoverableSessionManager(
				input.cwd,
				sessionDirectory,
				input.launchOptions,
			);
			const { session } = await createSession({
				cwd: input.cwd,
				agentDir: getAgentDir(),
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				resourceLoader,
				tools: [...input.allowedTools],
				customTools,
				sessionManager,
			});
			activeSessions.set(session.sessionId, session);
			try {
				const result = await executeResearchSession(session, input.prompt);
				return {
					...result,
					...(discoveredPaths?.length ? { discoveredPaths } : {}),
				};
			} finally {
				if (activeSessions.get(session.sessionId) === session) {
					activeSessions.delete(session.sessionId);
				}
				session.dispose();
			}
		},
		async intervene(sessionId, intervention) {
			const session = activeSessions.get(sessionId);
			if (!session) {
				throw new Error(`The exact active Pi session is unavailable: ${sessionId}.`);
			}
			if (intervention.kind === "steer") {
				await session.steer(intervention.guidance);
				return;
			}
			await session.abort();
		},
	};
}

async function withDisposableProjectCopy<T>(
	projectRoot: string,
	run: (cwd: string) => Promise<T>,
): Promise<T> {
	const isolationRoot = await mkdtemp(join(tmpdir(), "pi-workflow-prototype-"));
	const cwd = join(isolationRoot, "workspace");
	try {
		await cp(projectRoot, cwd, {
			recursive: true,
			filter: (source) => {
				const relative = source.slice(projectRoot.length).replace(/^[/\\]/, "");
				const [top] = relative.split(sep);
				if ([".git", "node_modules", ".pi-workflow", ".codegraph"].includes(top ?? "")) {
					return false;
				}
				return !lstatSync(source).isSocket();
			},
		});
		return await run(cwd);
	} finally {
		await rm(isolationRoot, { recursive: true, force: true });
	}
}

function createRuntimeResourceLoader(
	projectRoot: string,
	skillEntries?: DefaultDefineProductRuntimeOptions["skillEntries"],
) {
	return {
		skillResolver: createSkillResolver({
			list: async () => {
				if (skillEntries) return [...skillEntries];
				const registryEntries = listSkillRegistryEntries(projectRoot);
				return registryEntries.length > 0
					? registryEntries
					: fallbackSkillEntries(projectRoot);
			},
			readFile: async (path) => readFileSync(path, "utf8"),
			canonicalPath: (path) => realpathSync(path),
		}),
		standardsResolver: createProjectStandardsResolver({
			load: async (project) => {
				const instructions = [
					{ name: "AGENTS", path: join(project.root, "AGENTS.md") },
					{ name: "CLAUDE", path: join(project.root, "CLAUDE.md") },
				]
					.map((entry) => ({
						...entry,
						content: readFileIfPresent(entry.path) ?? "",
						required: false,
					}))
					.filter((entry) => entry.content.length > 0);
				const contextPath = join(project.root, "CONTEXT.md");
				const context = readFileIfPresent(contextPath)
					? {
						name: "CONTEXT",
						path: contextPath,
						content: readFileSync(contextPath, "utf8"),
					}
					: undefined;
				return {
					instructions,
					context,
					requiredSkills: [],
				};
			},
		}),
	};
}

export function createDefaultDefineProductWorkflow(
	_pi: ExtensionAPI,
	getCurrentContext: () => ExtensionContext | undefined,
	options: DefaultDefineProductRuntimeOptions = {},
) {
	const baseProject = resolveProjectRef(process.cwd());
	const resources = createRuntimeResourceLoader(
		baseProject.root,
		options.skillEntries,
	);
	const artifactStore =
		options.artifactStore ??
		createRuntimeEngramArtifactStore({
			sessionId: () => getCurrentContext()?.sessionManager.getSessionId(),
			directory: () => getCurrentContext()?.cwd ?? process.cwd(),
		});
	const researchExecutor =
		typeof options.researchExecutor === "function"
			? { execute: options.researchExecutor }
			: options.researchExecutor ?? createDefaultResearchExecutor();
	const explorationExecutor =
		typeof options.explorationExecutor === "function"
			? { execute: options.explorationExecutor }
			: options.explorationExecutor ??
				createDefaultExplorationExecutor(
					join(
						getAgentDir(),
						".pi-workflow",
						"exploration-sessions",
						baseProject.name,
					),
				);
	const ticketGraphExecutor =
		typeof options.ticketGraphExecutor === "function"
			? { execute: options.ticketGraphExecutor }
			: options.ticketGraphExecutor ?? createDefaultTicketGraphExecutor();
	const webExtensionPath = resolveWebExtensionPath(
		baseProject.root,
		options.webExtensionPath,
	);

	const privateStateDirectory = join(
		getAgentDir(),
		".pi-workflow",
		"delegation-checkpoints",
		baseProject.name,
	);
	const privateStatePersistence =
		createRuntimePrivateStatePersistence(privateStateDirectory);
	const checkpointStore =
		options.checkpointStore ??
		createDurableDelegationCheckpointStore({
			directory: privateStateDirectory,
			persistence: privateStatePersistence,
		});
	const explorationRecoveryStore =
		options.explorationRecoveryStore ??
		createDurableExplorationRecoveryStore({
			path: join(privateStateDirectory, "exploration-recovery.json"),
			persistence: privateStatePersistence,
		});
	const specApprovalRecoveryStore =
		options.specApprovalRecoveryStore ??
		createDurableSpecApprovalRecoveryStore({
			path: join(privateStateDirectory, "spec-approval-recovery.json"),
			persistence: privateStatePersistence,
		});
	const ticketApprovalRecoveryStore =
		options.ticketApprovalRecoveryStore ??
		createDurableTicketApprovalRecoveryStore({
			path: join(privateStateDirectory, "ticket-approval-recovery.json"),
			persistence: privateStatePersistence,
		});
	const approvedSpecReader = options.approvedSpecReader ?? createEngramApprovedSpecReader({
		project: baseProject.name,
		store: createRuntimeEngramApprovedSpecStore({
			sessionId: () => getCurrentContext()?.sessionManager.getSessionId(),
			directory: () => getCurrentContext()?.cwd ?? process.cwd(),
		}),
	});
	const publicationManifest = options.publicationManifest ?? createDurablePublicationManifest({
		directory: join(privateStateDirectory, "delivery-parent-publications"),
		persistence: privateStatePersistence,
	});
	const linearDeliveryParents = options.linearDeliveryParents ?? configuredLinearDeliveryParents(process.env);
	const linearDeliveryTickets = options.linearDeliveryTickets ?? configuredLinearDeliveryTickets(process.env);
	const linearApprovedRevision = options.linearApprovedRevision ?? configuredLinearApprovedRevision(process.env);
	const authenticatedAuthority = options.authenticatedAuthority ?? configuredOwnerAuthority(process.env);
	const approvedTicketPublication = createApprovedTicketPublicationStore({
		store: artifactStore,
		project: baseProject.name,
		topic: "workflow/define-product",
	});
	const ticketPublicationManifest = createTicketPublicationManifestStore({
		persistence: {
			async read(operationId) {
				const stored = await artifactStore.readCurrent(baseProject.name, `workflow/define-product/ticket-publication/${operationId}`);
				return stored ? { revision: stored.revision, value: JSON.parse(stored.content) } : undefined;
			},
			async create(value) {
				const stored = await artifactStore.write(baseProject.name, `workflow/define-product/ticket-publication/${value.operationId}`, JSON.stringify(value), undefined);
				return { revision: stored.revision, value };
			},
			async compareAndSwap(revision, value) {
				const stored = await artifactStore.write(baseProject.name, `workflow/define-product/ticket-publication/${value.operationId}`, JSON.stringify(value), revision);
				return { revision: stored.revision, value };
			},
		},
	});
	const approvedRevisionPublicationManifest = createApprovedRevisionPublicationManifestStore({
		persistence: {
			async read(operationId) {
				const stored = await artifactStore.readCurrent(baseProject.name, `workflow/define-product/approved-revision-publication/${operationId}`);
				return stored ? { revision: stored.revision, value: JSON.parse(stored.content) } : undefined;
			},
			async create(value) {
				const stored = await artifactStore.write(baseProject.name, `workflow/define-product/approved-revision-publication/${value.operationId}`, JSON.stringify(value), undefined);
				return { revision: stored.revision, value };
			},
			async compareAndSwap(revision, value) {
				const stored = await artifactStore.write(baseProject.name, `workflow/define-product/approved-revision-publication/${value.operationId}`, JSON.stringify(value), revision);
				return { revision: stored.revision, value };
			},
		},
	});

	const agentValidator = createAgentValidator({
		readResearchAsset: () => readResearchAssetMetadata(),
		readTicketGraphAsset: () => readTicketGraphAssetMetadata(),
		readExplorationAsset: () => readExplorationAssetMetadata(),
		readModelAvailability: async (provider, model, effort) => {
			const ctx = getCurrentContext();
			if (!ctx) {
				return {
					authenticated: false,
					supportsToolCalling: false,
					exact: false,
				};
			}
			ctx.modelRegistry.refresh();
			const available = ctx.modelRegistry.getAvailable();
			const exact = available.some(
				(candidate) =>
					candidate.provider === provider && candidate.id === model,
			);
			return {
				authenticated: exact,
				supportsToolCalling: exact,
				exact: exact && effort === "medium",
			};
		},
	});

	const workflowDelegate = createWorkflowDelegate({
		skillResolver: resources.skillResolver,
		checkpointStore,
		standardsResolver: resources.standardsResolver,
		agentValidator,
		artifactInterface: createWorkflowArtifactInterface(artifactStore),
		subagentLauncher: createSubagentLauncher({
			intervene: async (sessionId, intervention) => {
				await explorationExecutor.intervene?.(sessionId, intervention);
			},
			launch: async (preparedLaunch, launchOptions) => {
				const intent = preparedLaunch.intent;
				const ctx = getCurrentContext();
				if (!ctx) {
					return {
						status: "blocked",
						executiveSummary:
							"The define-product workflow does not have an active Pi execution context.",
						artifacts: [],
						nextRecommended: { kind: "owner-action" },
						risks: [],
						blocker: createBlocker(
							"PI_WORKFLOW_AGENT_ASSET_NOT_READY",
							"The define-product workflow does not have an active Pi execution context.",
						),
						launchProvenance: preparedLaunch.launchProvenance,
					};
				}
				if (intent.kind === "research" && !existsSync(webExtensionPath)) {
					return {
						status: "blocked",
						executiveSummary:
							"The pi-web-access companion extension is not available for read-only research.",
						artifacts: [],
						nextRecommended: { kind: "owner-action" },
						risks: [],
						blocker: createBlocker(
							"PI_WORKFLOW_AGENT_ASSET_NOT_READY",
							"The pi-web-access companion extension is not available for read-only research.",
						),
						launchProvenance: preparedLaunch.launchProvenance,
					};
				}
				const availableModels = ctx.modelRegistry.getAvailable();
				const model = availableModels.find(
					(candidate) =>
						candidate.provider === preparedLaunch.launchProvenance.provider &&
						candidate.id === preparedLaunch.launchProvenance.model,
				);
				if (!model) {
					return {
						status: "blocked",
						executiveSummary:
							"The exact validated model is unavailable for the define-product research launch.",
						artifacts: [],
						nextRecommended: { kind: "owner-action" },
						risks: [],
						blocker: createBlocker(
							"PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE",
							"The exact validated model is unavailable for the define-product research launch.",
						),
						launchProvenance: preparedLaunch.launchProvenance,
					};
				}
				if (!launchOptions) {
					throw new Error("A recoverable launch requires explicit launch options.");
				}
				const projectRef = resolveProjectRef(ctx.cwd);
				if (intent.kind === "prototype" || intent.kind === "design-alternative") {
					let writtenExploration: VerifiedArtifactRef | undefined;
					const verifiedProgress: VerifiedArtifactRef[] = [];
					try {
						const execution = await withDisposableProjectCopy(
							projectRef.root,
							(cwd) =>
								explorationExecutor.execute({
									cwd,
									launchOptions,
									model,
									thinkingLevel: "medium",
									intent: intent.kind,
									prompt: preparedLaunch.prompt,
									systemPrompt: buildExplorationSystemPrompt({
										asset: readExplorationAssetMetadata(),
										preparedLaunch,
										skillRefs: preparedLaunch.skillRefs,
										standardRefs: preparedLaunch.standardRefs,
									}),
									allowedTools: preparedLaunch.launchProvenance.allowedTools,
									launchProvenance: preparedLaunch.launchProvenance,
									readArtifact: async (alias) =>
										(await preparedLaunch.artifactSession.read(alias)).content,
									mergeProgress: async (batch) => {
										const artifact =
											await preparedLaunch.artifactSession.mergeProgress(batch);
										verifiedProgress.push(artifact);
										return artifact;
									},
									writeArtifact: async (snapshot) => {
										if (writtenExploration) {
											throw new Error(
												`${workflowArtifactToolName} may write only one verified artifact per request.`,
											);
										}
										writtenExploration =
											await preparedLaunch.artifactSession.writeExplorationSnapshot(
												snapshot,
											);
										return writtenExploration;
									},
								}),
						);
						if (!writtenExploration) {
							return {
								status: "blocked",
								executiveSummary:
									"The exploration launch completed without writing a verified design artifact.",
								artifacts: [],
								nextRecommended: { kind: "owner-action" },
								risks: [],
								blocker: createBlocker(
									"PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH",
									"The exploration launch completed without writing a verified design artifact.",
								),
								launchProvenance: preparedLaunch.launchProvenance,
							};
						}
						return {
							result: {
								status: "completed",
								executiveSummary:
									execution.assistantText.trim() ||
									`${intent.kind} complete. The verified artifact is ready for comparison.`,
								artifacts: [writtenExploration],
								nextRecommended: {
									kind: "compare-exploration",
									intent: intent.kind,
								},
								risks: [],
								launchProvenance: preparedLaunch.launchProvenance,
							},
							sessionId: launchOptions.sessionId,
							...(execution.discoveredPaths
								? { discoveredPaths: [...execution.discoveredPaths] }
								: {}),
						};
					} catch (error) {
						if (isInterruptedRuntimeError(error)) {
							throw Object.assign(error, {
								sessionId: error.sessionId || launchOptions.sessionId,
								verifiedArtifacts: uniqueVerifiedArtifactRefs([
									...launchOptions.verifiedArtifacts,
									...verifiedProgress,
									...error.verifiedArtifacts,
								]),
							});
						}
						const message = error instanceof Error ? error.message : String(error);
						return {
							status: "blocked",
							executiveSummary: message,
							artifacts: [],
							nextRecommended: { kind: "owner-action" },
							risks: [],
							blocker: createBlocker(
								writtenExploration
									? "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH"
									: "PI_WORKFLOW_AGENT_ASSET_NOT_READY",
								message,
							),
							launchProvenance: preparedLaunch.launchProvenance,
						};
					}
				}
				if (intent.kind === "to-tickets") {
					let writtenGraph: VerifiedArtifactRef | undefined;
					try {
						const execution = await ticketGraphExecutor.execute({
							cwd: projectRef.root, launchOptions, model, thinkingLevel: "medium",
							prompt: preparedLaunch.prompt,
							systemPrompt: buildTicketGraphSystemPrompt({ asset: readTicketGraphAssetMetadata(), preparedLaunch }),
							allowedTools: preparedLaunch.launchProvenance.allowedTools,
							readArtifact: async (alias) => (await preparedLaunch.artifactSession.read(alias)).content,
							writeArtifact: async (graph) => {
								if (writtenGraph) throw new Error(`${workflowArtifactToolName} may write only one verified artifact per request.`);
								writtenGraph = await preparedLaunch.artifactSession.writeDeliveryTicketGraph(graph);
								return writtenGraph;
							},
						});
						if (!writtenGraph) return {
							status: "blocked", executiveSummary: "The to-tickets launch completed without a verified ticket graph.", artifacts: [],
							nextRecommended: { kind: "owner-action" }, risks: [],
							blocker: createBlocker("PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH", "The to-tickets launch completed without a verified ticket graph."),
							launchProvenance: preparedLaunch.launchProvenance,
						};
						return { status: "completed", executiveSummary: execution.assistantText.trim() || "Ticket graph ready for Owner approval.", artifacts: [writtenGraph], nextRecommended: { kind: "confirmed-route", route: intent.route }, risks: [], launchProvenance: preparedLaunch.launchProvenance };
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return { status: "blocked", executiveSummary: message, artifacts: [], nextRecommended: { kind: "owner-action" }, risks: [], blocker: createBlocker(writtenGraph ? "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH" : "PI_WORKFLOW_AGENT_ASSET_NOT_READY", message), launchProvenance: preparedLaunch.launchProvenance };
					}
				}
				if (intent.kind !== "research") {
					throw new Error("Only research remains after exploration dispatch.");
				}
				let writtenArtifact: VerifiedArtifactRef | undefined;
				try {
					const execution = await researchExecutor.execute({
						cwd: projectRef.root,
						launchOptions,
						model,
						thinkingLevel: "medium",
						prompt: preparedLaunch.prompt,
						systemPrompt: buildResearchSystemPrompt({
							asset: readResearchAssetMetadata(),
							preparedLaunch,
							skillRefs: preparedLaunch.skillRefs,
							standardRefs: preparedLaunch.standardRefs,
						}),
						allowedTools: preparedLaunch.launchProvenance.allowedTools,
						webExtensionPath,
						writeArtifact: async (input) => {
							if (writtenArtifact) {
								throw new Error(
									`${workflowArtifactToolName} may write only one verified artifact per request.`,
								);
							}
							const envelope = createResearchEvidenceEnvelope({
								assignmentId: intent.requestId,
								definitionId: intent.definitionId,
								recommendationDigest: intent.recommendationDigest,
								route: intent.route,
								question: intent.question,
								domainAnchorDigest: intent.domainAnchorDigest,
								findings: input.findings,
								limitations: input.limitations,
								skillRefs: preparedLaunch.skillRefs,
								standardRefs: preparedLaunch.standardRefs,
								launchProvenance: preparedLaunch.launchProvenance,
							});
							writtenArtifact =
								await preparedLaunch.artifactSession.writeSnapshot(envelope);
							return writtenArtifact;
						},
					});
					if (!writtenArtifact) {
						return {
							status: "blocked",
							executiveSummary:
								"The research launch completed without writing the verified workflow artifact.",
							artifacts: [],
							nextRecommended: { kind: "owner-action" },
							risks: [],
							blocker: createBlocker(
								"PI_WORKFLOW_RESEARCH_ARTIFACT_INVALID",
								"The research launch completed without writing the verified workflow artifact.",
							),
							launchProvenance: preparedLaunch.launchProvenance,
						};
					}
					return {
						status: "completed",
						executiveSummary:
							execution.assistantText.trim() ||
							"Research complete. The verified artifact is ready for the Owner.",
						artifacts: [writtenArtifact],
						nextRecommended: {
							kind: "confirmed-route",
							route: intent.route,
						},
						risks: [],
						launchProvenance: preparedLaunch.launchProvenance,
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						status: "blocked",
						executiveSummary: message,
						artifacts: [],
						nextRecommended: { kind: "owner-action" },
						risks: [],
						blocker: createBlocker(
							writtenArtifact
								? "PI_WORKFLOW_ARTIFACT_READBACK_MISMATCH"
								: "PI_WORKFLOW_AGENT_ASSET_NOT_READY",
							message,
						),
						launchProvenance: preparedLaunch.launchProvenance,
					};
				}
			},
		}),
	});

	return createDefineProductWorkflow({
		delegate: workflowDelegate,
		explorationRecoveryStore,
		specApprovalRecoveryStore,
		ticketApprovalRecoveryStore,
		approvedSpecStore: approvedSpecReader,
		readPublishedParent: (ref) => readDeliveryParentSnapshot({ store: artifactStore, ref }),
		recoverTicketGraph: (ref) => recoverApprovedTicketGraph(artifactStore, ref).catch(() => undefined),
		approvedTicketGraphs: {
			save: (definitionId, graph) => createApprovedTicketGraphStore({
				store: artifactStore,
				project: baseProject.name,
				topic: `workflow/define-product/${definitionId}/approved-ticket-graph`,
			}).save(graph),
		},
		approvedTicketPublication,
		ticketPublication: linearDeliveryTickets ? {
			async publish(definitionId) {
				const publication = await approvedTicketPublication.read(definitionId);
				const graph = publication && await recoverApprovedTicketGraph(artifactStore, publication.graphRef);
				const approved = publication && await approvedSpecReader.read(definitionId);
				if (!publication || !graph || !approved) {
					return { status: "blocked", blocker: createBlocker("PI_WORKFLOW_RECOVERY_FAILED", "Ticket publication requires the exact durable approved graph.") };
				}
				const expected = {
					definitionId,
					artifact: { approvedDigest: publication.approvedSpecRef.digest, graphDigest: publication.graphRef.digest },
					approval: { ownerId: publication.approval.payload.actor.actorId, role: "Owner" as const, digest: publication.approval.digest },
					authorityRevision: publication.approval.payload.actor.authorityRevision,
					requiredCapabilities: ["sub-issues", "native-blockers", "estimates", "triage-state"],
					mutationPermission: true,
					parent: publication.graphParent,
					state: { parent: "compatible" as const, team: "compatible" as const },
				};
				const current = async () => {
					const [currentPublication, authority] = await Promise.all([
						approvedTicketPublication.read(definitionId),
						authenticatedAuthority?.current(),
					]);
					const currentGraph = currentPublication && await recoverApprovedTicketGraph(artifactStore, currentPublication.graphRef);
					const currentApproved = currentPublication && await approvedSpecReader.read(definitionId);
					if (!currentPublication || !currentGraph || !currentApproved || currentGraph.digest !== currentPublication.graphRef.digest || currentApproved.spec.digest !== currentPublication.approvedSpecRef.digest || authority?.role !== "Owner") throw Object.assign(new Error("Canonical ticket publication authority is unavailable."), { code: "PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT" });
					return linearDeliveryTickets.readAuthoritySnapshot({
						definitionId,
						artifact: { approvedDigest: currentPublication.approvedSpecRef.digest, graphDigest: currentPublication.graphRef.digest },
						approval: { ownerId: currentPublication.approval.payload.actor.actorId, role: "Owner", digest: currentPublication.approval.digest },
						authorityRevision: authority.authorityRevision,
						parent: currentPublication.graphParent,
						expectedParentDescription: currentApproved.spec.payload.body,
					});
				};
				const outcome = await publishApprovedTickets({
					definitionId,
					graph,
					manifest: ticketPublicationManifest,
					guard: createTicketPublicationAuthorityGuard({
						expected,
						current,
					}),
					gateway: linearDeliveryTickets,
				});
				return outcome.status === "tickets-published"
					? { status: "tickets-published", definitionId }
					: outcome;
			},
		} : undefined,
		approvedRevisionPublication: linearApprovedRevision && authenticatedAuthority ? {
			async publish(definitionId, digest) {
				return publishApprovedRevision({
					definitionId,
					digest,
					currentActor: async () => {
						const authority = await authenticatedAuthority.current();
						return authority.role === "Owner" ? authority as OwnerAuthority : undefined;
					},
					manifest: approvedRevisionPublicationManifest,
					gateway: linearApprovedRevision,
					async readApprovedRevision(targetDefinitionId, targetDigest) {
						const topic = `workflow/define-product/${targetDefinitionId}/approved-revision/${targetDigest}`;
						const current = await artifactStore.readCurrent(baseProject.name, topic);
						if (!current) return undefined;
						const parsed = JSON.parse(current.content) as { schema?: string; schemaVersion?: number; payload?: ApprovedRevisionPublicationArtifact; digest?: string };
						if (parsed.schema !== "approved-revision" || parsed.schemaVersion !== 1 || parsed.digest !== targetDigest || parsed.payload?.digest !== targetDigest) return undefined;
						return parsed.payload;
					},
				});
			},
		} : undefined,
		publication: linearDeliveryParents && authenticatedAuthority ? {
			approvedSpecReader,
			linear: linearDeliveryParents,
			state: createPublicationStateMachine({
				store: publicationManifest,
				createReservationId: () => `publication-${Date.now()}`,
			}),
			authenticatedAuthority,
			parentSnapshots: createDeliveryParentSnapshotStore({
				project: baseProject,
				artifactStore,
			}),
		} : undefined,
		authenticatedAuthority,
		createRequestId:
			options.createRequestId ?? (() => `request-${Date.now()}`),
		project: baseProject,
	});
}
