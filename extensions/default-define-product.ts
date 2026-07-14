import { existsSync, readFileSync } from "node:fs";
import { readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	DefaultResourceLoader,
	SessionManager,
	createAgentSession,
	getAgentDir,
	parseFrontmatter,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { createAgentValidator } from "./agent-validator.ts";
import { createDefineProductWorkflow } from "./define-product-workflow.ts";
import { createProjectStandardsResolver } from "./project-standards-resolver.ts";
import { createSkillResolver } from "./skill-resolver.ts";
import { createSubagentLauncher } from "./subagent-launcher.ts";
import { createRuntimeEngramArtifactStore } from "./runtime-engram-store.ts";
import {
	createResearchEvidenceEnvelope,
	createBlocker,
	type DigestedRef,
	type ProjectRef,
	type ResearchFinding,
	type VerifiedArtifactRef,
	type PreparedLaunch,
} from "./workflow-contracts.ts";
import {
	createWorkflowArtifactInterface,
	type WorkflowArtifactStore,
} from "./workflow-artifacts.ts";
import { createWorkflowDelegate } from "./workflow-delegate.ts";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetCatalogPath = join(packageDirectory, "assets", "agent-assets.json");
const researchAssetPath = join(packageDirectory, "assets", "agents", "research.md");
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

interface ResearchAssetMetadata {
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

export interface DefaultDefineProductRuntimeOptions {
	artifactStore?: WorkflowArtifactStore;
	researchExecutor?: ResearchExecutor | ResearchExecutor["execute"];
	webExtensionPath?: string;
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

function readFileIfPresent(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	return readFileSync(path, "utf8");
}

function readResearchAssetMetadata(): ResearchAssetMetadata {
	const catalog = JSON.parse(readFileSync(assetCatalogPath, "utf8")) as {
		assets?: Array<{ kind?: string; name?: string; version?: number; digest?: string }>;
	};
	const catalogEntry = catalog.assets?.find(
		(entry) => entry.kind === "agent" && entry.name === "research",
	);
	if (!catalogEntry?.digest || typeof catalogEntry.version !== "number") {
		throw new Error("The packaged research asset catalog entry is missing or invalid.");
	}
	const parsed = parseFrontmatter<Record<string, unknown>>(
		readFileSync(researchAssetPath, "utf8"),
	);
	const modelReference = String(parsed.frontmatter.model ?? "").trim();
	const [provider, model] = modelReference.split("/");
	if (!provider || !model) {
		throw new Error("The packaged research asset model reference is invalid.");
	}
	return {
		name: "research",
		version: catalogEntry.version,
		digest: catalogEntry.digest,
		capabilityProfile: String(parsed.frontmatter.capability_profile ?? ""),
		provider,
		model,
		effort: String(parsed.frontmatter.thinking ?? ""),
		inheritContext: parsed.frontmatter.inherit_context === true,
		promptMode: String(parsed.frontmatter.prompt_mode ?? ""),
		allowedTools: allowedResearchTools,
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
	asset: ResearchAssetMetadata;
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

function createRuntimeResourceLoader(projectRoot: string) {
	return {
		skillResolver: createSkillResolver({
			list: async () => {
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
	const resources = createRuntimeResourceLoader(baseProject.root);
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
	const webExtensionPath = resolveWebExtensionPath(
		baseProject.root,
		options.webExtensionPath,
	);

	const agentValidator = createAgentValidator({
		readResearchAsset: () => readResearchAssetMetadata(),
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
		standardsResolver: resources.standardsResolver,
		agentValidator,
		artifactInterface: createWorkflowArtifactInterface(artifactStore),
		subagentLauncher: createSubagentLauncher({
			launch: async (preparedLaunch) => {
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
				if (!existsSync(webExtensionPath)) {
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
				let writtenArtifact: VerifiedArtifactRef | undefined;
				const projectRef = resolveProjectRef(ctx.cwd);
				try {
					const execution = await researchExecutor.execute({
						cwd: projectRef.root,
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
								assignmentId: preparedLaunch.intent.requestId,
								definitionId: preparedLaunch.intent.definitionId,
								recommendationDigest: preparedLaunch.intent.recommendationDigest,
								route: preparedLaunch.intent.route,
								question: preparedLaunch.intent.question,
								domainAnchorDigest: preparedLaunch.intent.domainAnchorDigest,
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
							route: preparedLaunch.intent.route,
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
		createRequestId: () => `request-${Date.now()}`,
		project: baseProject,
	});
}
