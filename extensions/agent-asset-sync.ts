import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

const AGENT_ASSET_CATALOG_SCHEMA_VERSION = 1 as const;
const AGENT_ASSET_MANIFEST_SCHEMA_VERSION = 1 as const;
const AGENT_ASSET_PLAN_SCHEMA_VERSION = 1 as const;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const ASSET_KINDS = new Set(["agent", "skill", "template", "companion", "mcp"]);

type AgentAssetKind = "agent" | "skill" | "template" | "companion" | "mcp";

interface AgentAssetCatalogEntry {
	kind: AgentAssetKind;
	name: string;
	version: number;
	content?: string;
	source?: string;
	digest?: string;
}

interface AgentAssetCatalog {
	schemaVersion: typeof AGENT_ASSET_CATALOG_SCHEMA_VERSION;
	assets: AgentAssetCatalogEntry[];
}

interface AgentAssetFilesystem {
	readFile(path: string): Promise<string | undefined>;
}

export interface AgentAssetSyncOptions {
	catalog: unknown;
	filesystem: AgentAssetFilesystem;
	packageDirectory?: string;
	agentDirectory: string;
	manifestPath: string;
}

export interface AgentAssetPreviewOptions {
	signal?: AbortSignal;
}
type AgentAssetDrift =
	| "missing"
	| "none"
	| "modified"
	| "outdated"
	| "future";

interface InspectedAgentAsset {
	name: string;
	targetPath: string;
	ownership: "package" | "unmanaged";
	packageVersion: number;
	installedVersion: number | null;
	drift: AgentAssetDrift;
	collision: boolean;
	sourcePath: string | null;
	sourceDigest: string;
	remediation?: string;
}

export interface AgentAssetInspection {
	status: "ready" | "blocked" | "canceled";
	mutation: "none";
	assets: InspectedAgentAsset[];
	diagnostics: string[];
	digest: string;
}

type AgentAssetPlanActionKind = "create" | "replace" | "migrate" | "refusal";
interface AgentAssetPlanAction {
	name: string;
	kind: AgentAssetPlanActionKind;
	targetPath: string;
	fromVersion: number | null;
	toVersion: number;
	sourceDigest: string;
	content: string;
	reason?: "managed-drift" | "unmanaged-collision" | "future-version";
	remediation?: string;
}

export interface AgentAssetPlan {
	schemaVersion: typeof AGENT_ASSET_PLAN_SCHEMA_VERSION;
	status: "ready" | "blocked" | "canceled";
	mutation: "none";
	inspectionDigest: string;
	actions: AgentAssetPlanAction[];
	diagnostics: string[];
	digest: string;
}

interface ManagedAssetRecord {
	version: number;
	digest: string;
}
interface AgentAssetManifest {
	schemaVersion: typeof AGENT_ASSET_MANIFEST_SCHEMA_VERSION;
	assets: Record<string, ManagedAssetRecord>;
}

type Validation<T> = { ok: true; value: T } | { ok: false; diagnostic: string };
type ReadResult =
	| { status: "ok"; content: string | undefined }
	| { status: "canceled" }
	| { status: "error"; diagnostic: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}
function digestValue(value: unknown): string {
	return sha256(JSON.stringify(value));
}
function isContained(parent: string, candidate: string): boolean {
	const path = relative(resolve(parent), resolve(candidate));
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
function validName(name: unknown): name is string {
	return typeof name === "string" && AGENT_NAME_PATTERN.test(name);
}
function validKind(kind: unknown): kind is AgentAssetKind {
	return typeof kind === "string" && ASSET_KINDS.has(kind);
}
function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function validateCatalog(
	value: unknown,
	options: AgentAssetSyncOptions,
): Validation<AgentAssetCatalog> {
	if (!isRecord(value))
		return {
			ok: false,
			diagnostic:
				"Agent asset catalog must be a JSON object. Reinstall a compatible pi-workflow package before planning; no files were changed.",
		};
	if (
		!Number.isInteger(value.schemaVersion) ||
		value.schemaVersion !== AGENT_ASSET_CATALOG_SCHEMA_VERSION
	) {
		return {
			ok: false,
			diagnostic: `Agent asset catalog schema version ${String(value.schemaVersion)} is unsupported; expected version ${AGENT_ASSET_CATALOG_SCHEMA_VERSION}. Install a compatible pi-workflow package before planning; no files were changed.`,
		};
	}
	if (!Array.isArray(value.assets))
		return {
			ok: false,
			diagnostic:
				"Agent asset catalog assets must be an array. Reinstall a compatible pi-workflow package before planning; no files were changed.",
		};
	const assets: AgentAssetCatalogEntry[] = [];
	const names = new Set<string>();
	for (const [index, raw] of value.assets.entries()) {
		if (!isRecord(raw))
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} must be an object; no files were changed.`,
			};
		if (!validKind(raw.kind))
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} has invalid kind; no files were changed.`,
			};
		if (typeof raw.name !== "string" || raw.name.length === 0)
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} must define a non-empty name; no files were changed.`,
			};
		if (raw.kind === "agent" && !validName(raw.name))
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} has invalid agent name ${raw.name}; use only case-sensitive letters, numbers, and internal hyphens (for example Explore or Plan). Separators, dots, and traversal are refused; no files were changed.`,
			};
		if (
			typeof raw.version !== "number" ||
			!Number.isInteger(raw.version) ||
			raw.version <= 0
		)
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} version must be a positive integer; no files were changed.`,
			};
		const content = typeof raw.content === "string" ? raw.content : undefined;
		const source =
			typeof raw.source === "string" && raw.source.length > 0
				? raw.source
				: undefined;
		if ((content === undefined) === (source === undefined))
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} must define exactly one string content or source field; no files were changed.`,
			};
		const entryDigest =
			typeof raw.digest === "string" && DIGEST_PATTERN.test(raw.digest)
				? raw.digest
				: undefined;
		if (raw.digest !== undefined && entryDigest === undefined)
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} digest must be a lowercase SHA-256 digest; no files were changed.`,
			};
		if (source !== undefined && entryDigest === undefined)
			return {
				ok: false,
				diagnostic: `Agent asset catalog record ${index} with a packaged source must define its lowercase SHA-256 digest; no files were changed.`,
			};
		if (raw.kind === "agent") {
			if (names.has(raw.name)) {
				const target = resolve(options.agentDirectory, `${raw.name}.md`);
				return {
					ok: false,
					diagnostic: `Catalog contains duplicate agent name and target: ${raw.name} -> ${target}. Remove duplicate entries before planning; no files were changed.`,
				};
			}
			names.add(raw.name);
			const target = resolve(options.agentDirectory, `${raw.name}.md`);
			if (!isContained(options.agentDirectory, target))
				return {
					ok: false,
					diagnostic: `Agent ${raw.name} resolves outside the configured agent directory; no files were changed.`,
				};
			if (source !== undefined) {
				const expected = `assets/agents/${raw.name}.md`;
				const sourcePath = resolve(options.packageDirectory ?? "", source);
				const sourceRoot = resolve(
					options.packageDirectory ?? "",
					"assets/agents",
				);
				if (raw.source !== expected || !isContained(sourceRoot, sourcePath))
					return {
						ok: false,
						diagnostic: `Agent ${raw.name} has invalid source path ${String(raw.source)}; expected ${expected}. Use a package-local agent source before planning; no files were changed.`,
					};
			}
		}
		assets.push({
			kind: raw.kind,
			name: raw.name,
			version: raw.version,
			content,
			source,
			digest: entryDigest,
		});
	}
	return {
		ok: true,
		value: { schemaVersion: AGENT_ASSET_CATALOG_SCHEMA_VERSION, assets },
	};
}

function parseManifest(
	content: string | undefined,
): Validation<AgentAssetManifest> {
	if (content === undefined)
		return {
			ok: true,
			value: { schemaVersion: AGENT_ASSET_MANIFEST_SCHEMA_VERSION, assets: {} },
		};
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch (error) {
		return {
			ok: false,
			diagnostic: `Agent asset manifest is malformed JSON: ${error instanceof Error ? error.message : String(error)}. Repair or remove the manifest before planning; no files were changed.`,
		};
	}
	if (!isRecord(value))
		return {
			ok: false,
			diagnostic:
				"Agent asset manifest must be a JSON object. Repair or remove it before planning; no files were changed.",
		};
	if (
		!Number.isInteger(value.schemaVersion) ||
		value.schemaVersion !== AGENT_ASSET_MANIFEST_SCHEMA_VERSION
	) {
		if (
			typeof value.schemaVersion === "number" &&
			value.schemaVersion > AGENT_ASSET_MANIFEST_SCHEMA_VERSION
		)
			return {
				ok: false,
				diagnostic: `Manifest schema version ${value.schemaVersion} is newer than supported version ${AGENT_ASSET_MANIFEST_SCHEMA_VERSION}. Upgrade pi-workflow before syncing; the manifest was not changed.`,
			};
		return {
			ok: false,
			diagnostic: `Manifest schema version ${String(value.schemaVersion)} is unsupported; expected version ${AGENT_ASSET_MANIFEST_SCHEMA_VERSION}. Repair or remove the manifest before planning; no files were changed.`,
		};
	}
	if (!isRecord(value.assets))
		return {
			ok: false,
			diagnostic:
				"Agent asset manifest assets must be an object. Repair or remove the manifest before planning; no files were changed.",
		};
	const assets: Record<string, ManagedAssetRecord> = {};
	for (const [name, raw] of Object.entries(value.assets)) {
		if (
			!validName(name) ||
			!isRecord(raw) ||
			typeof raw.version !== "number" ||
			!Number.isInteger(raw.version) ||
			raw.version <= 0 ||
			typeof raw.digest !== "string" ||
			!DIGEST_PATTERN.test(raw.digest)
		) {
			return {
				ok: false,
				diagnostic: `Manifest asset record ${name || "<empty>"} must have a valid agent name, positive integer version, and lowercase SHA-256 digest. Repair or remove the record before planning; no files were changed.`,
			};
		}
		assets[name] = { version: raw.version, digest: raw.digest };
	}
	return {
		ok: true,
		value: { schemaVersion: AGENT_ASSET_MANIFEST_SCHEMA_VERSION, assets },
	};
}

async function safeRead(
	path: string,
	options: AgentAssetSyncOptions,
	signal?: AbortSignal,
): Promise<ReadResult> {
	if (signal?.aborted) return { status: "canceled" };
	try {
		const content = await options.filesystem.readFile(path);
		if (signal?.aborted) return { status: "canceled" };
		return { status: "ok", content };
	} catch (error) {
		if (signal?.aborted) return { status: "canceled" };
		return {
			status: "error",
			diagnostic: `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}. Check permissions and retry; no files were changed.`,
		};
	}
}

async function readAssetSource(
	asset: AgentAssetCatalogEntry,
	options: AgentAssetSyncOptions,
	signal?: AbortSignal,
): Promise<
	| Validation<{
			content: string;
			sourcePath: string | null;
			sourceDigest: string;
	  }>
	| { canceled: true }
> {
	if (asset.source) {
		const sourcePath = resolve(options.packageDirectory ?? "", asset.source);
		const read = await safeRead(sourcePath, options, signal);
		if (read.status === "canceled") return { canceled: true };
		if (read.status === "error")
			return { ok: false, diagnostic: read.diagnostic };
		if (read.content === undefined)
			return {
				ok: false,
				diagnostic: `Packaged source ${asset.source} for agent ${asset.name} is missing. Reinstall @felipe.3dfx/pi-workflow before planning; no files were changed.`,
			};
		const sourceDigest = sha256(read.content);
		if (asset.digest !== undefined && asset.digest !== sourceDigest)
			return {
				ok: false,
				diagnostic: `Catalog digest mismatch for agent ${asset.name} at ${asset.source}. Reinstall @felipe.3dfx/pi-workflow before planning; no files were changed.`,
			};
		return {
			ok: true,
			value: { content: read.content, sourcePath, sourceDigest },
		};
	}
	const content = asset.content as string;
	return {
		ok: true,
		value: { content, sourcePath: null, sourceDigest: sha256(content) },
	};
}

function remediationFor(drift: AgentAssetDrift, targetPath: string): string {
	if (drift === "modified")
		return `Back up ${targetPath}, then restore the managed version or remove its manifest entry before planning again.`;
	if (drift === "future")
		return "Upgrade pi-workflow to a version that supports the installed agent version; automatic downgrade is refused.";
	return `Move or remove the unmanaged file at ${targetPath}, then run pi-workflow-sync plan again.`;
}

function classifyAsset(
	asset: AgentAssetCatalogEntry,
	targetPath: string,
	content: string | undefined,
	managed: ManagedAssetRecord | undefined,
	source: { sourcePath: string | null; sourceDigest: string },
): InspectedAgentAsset {
	const base = {
		name: asset.name,
		targetPath,
		packageVersion: asset.version,
		sourcePath: source.sourcePath,
		sourceDigest: source.sourceDigest,
	};
	if (!managed && content !== undefined)
		return {
			...base,
			ownership: "unmanaged",
			installedVersion: null,
			drift: "modified",
			collision: true,
			remediation: remediationFor("missing", targetPath),
		};
	if (!managed)
		return {
			...base,
			ownership: "package",
			installedVersion: null,
			drift: "missing",
			collision: false,
		};
	if (managed.version > asset.version)
		return {
			...base,
			ownership: "package",
			installedVersion: managed.version,
			drift: "future",
			collision: false,
			remediation: remediationFor("future", targetPath),
		};
	if (content === undefined || sha256(content) !== managed.digest)
		return {
			...base,
			ownership: "package",
			installedVersion: managed.version,
			drift: "modified",
			collision: false,
			remediation: remediationFor("modified", targetPath),
		};
	return {
		...base,
		ownership: "package",
		installedVersion: managed.version,
		drift:
			managed.version < asset.version || managed.digest !== source.sourceDigest
				? "outdated"
				: "none",
		collision: false,
	};
}

function emptyInspection(
	status: "blocked" | "canceled",
	diagnostics: string[],
): AgentAssetInspection {
	const value = { status, mutation: "none" as const, assets: [], diagnostics };
	return { ...value, digest: digestValue(value) };
}
function canceledInspection(): AgentAssetInspection {
	return emptyInspection("canceled", []);
}
function canceledPlan(inspectionDigest: string): AgentAssetPlan {
	const value = {
		schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
		status: "canceled" as const,
		mutation: "none" as const,
		inspectionDigest,
		actions: [],
		diagnostics: [],
	};
	return { ...value, digest: digestValue(value) };
}

export function createAgentAssetSync(options: AgentAssetSyncOptions) {
	async function inspect(
		preview: AgentAssetPreviewOptions = {},
	): Promise<AgentAssetInspection> {
		const { signal } = preview;
		if (signal?.aborted) return canceledInspection();
		const catalogResult = validateCatalog(options.catalog, options);
		if (!catalogResult.ok)
			return emptyInspection("blocked", [catalogResult.diagnostic]);
		const catalog = catalogResult.value;
		const manifestRead = await safeRead(options.manifestPath, options, signal);
		if (manifestRead.status === "canceled") return canceledInspection();
		if (manifestRead.status === "error")
			return emptyInspection("blocked", [manifestRead.diagnostic]);
		const manifestResult = parseManifest(manifestRead.content);
		if (!manifestResult.ok)
			return emptyInspection("blocked", [manifestResult.diagnostic]);
		const manifest = manifestResult.value;
		const assets: InspectedAgentAsset[] = [];
		const diagnostics: string[] = [];
		const observations: Array<{
			name: string;
			targetPath: string;
			exists: boolean;
			contentDigest: string | null;
			manifestRecord: ManagedAssetRecord | null;
		}> = [];
		for (const asset of catalog.assets.filter(
			(entry) => entry.kind === "agent",
		)) {
			if (signal?.aborted) return canceledInspection();
			const sourceResult = await readAssetSource(asset, options, signal);
			if ("canceled" in sourceResult) return canceledInspection();
			if (!sourceResult.ok)
				return emptyInspection("blocked", [sourceResult.diagnostic]);
			const targetPath = resolve(options.agentDirectory, `${asset.name}.md`);
			const targetRead = await safeRead(targetPath, options, signal);
			if (targetRead.status === "canceled") return canceledInspection();
			if (targetRead.status === "error")
				return emptyInspection("blocked", [targetRead.diagnostic]);
			const managed = manifest.assets[asset.name];
			const inspected = classifyAsset(
				asset,
				targetPath,
				targetRead.content,
				managed,
				sourceResult.value,
			);
			assets.push(inspected);
			observations.push({
				name: asset.name,
				targetPath,
				exists: targetRead.content !== undefined,
				contentDigest:
					targetRead.content === undefined ? null : sha256(targetRead.content),
				manifestRecord: managed ?? null,
			});
			if (inspected.remediation) diagnostics.push(inspected.remediation);
		}
		if (signal?.aborted) return canceledInspection();
		const status = assets.some(
			(asset) =>
				asset.collision ||
				asset.drift === "modified" ||
				asset.drift === "future",
		)
			? "blocked"
			: "ready";
		const snapshot = {
			status,
			mutation: "none" as const,
			catalogSchemaVersion: catalog.schemaVersion,
			manifest: {
				path: resolve(options.manifestPath),
				exists: manifestRead.content !== undefined,
				contentDigest:
					manifestRead.content === undefined
						? null
						: sha256(manifestRead.content),
				schemaVersion: manifest.schemaVersion,
			},
			assets: assets.toSorted((a, b) =>
				compareText(a.targetPath, b.targetPath),
			),
			observations: observations.toSorted((a, b) =>
				compareText(a.targetPath, b.targetPath),
			),
			diagnostics: diagnostics.toSorted(compareText),
		};
		if (signal?.aborted) return canceledInspection();
		return {
			status,
			mutation: "none",
			assets,
			diagnostics,
			digest: digestValue(snapshot),
		};
	}

	async function plan(
		preview: AgentAssetPreviewOptions = {},
	): Promise<AgentAssetPlan> {
		const inspection = await inspect(preview);
		if (inspection.status === "canceled" || preview.signal?.aborted)
			return canceledPlan(inspection.digest);
		const catalogResult = validateCatalog(options.catalog, options);
		if (!catalogResult.ok) {
			const value = {
				schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
				status: "blocked" as const,
				mutation: "none" as const,
				inspectionDigest: inspection.digest,
				actions: [],
				diagnostics: [catalogResult.diagnostic],
			};
			return { ...value, digest: digestValue(value) };
		}
		const actions: AgentAssetPlanAction[] = [];
		for (const asset of inspection.assets.filter(
			(entry) => entry.drift !== "none",
		)) {
			if (preview.signal?.aborted) return canceledPlan(inspection.digest);
			const catalogAsset = catalogResult.value.assets.find(
				(entry) => entry.kind === "agent" && entry.name === asset.name,
			);
			if (!catalogAsset) {
				const diagnostic = `Catalog asset ${asset.name} is unavailable during planning; rerun the command. No files were changed.`;
				const value = {
					schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
					status: "blocked" as const,
					mutation: "none" as const,
					inspectionDigest: inspection.digest,
					actions: [],
					diagnostics: [diagnostic],
				};
				return { ...value, digest: digestValue(value) };
			}
			const sourceResult = await readAssetSource(
				catalogAsset,
				options,
				preview.signal,
			);
			if ("canceled" in sourceResult) return canceledPlan(inspection.digest);
			if (
				!sourceResult.ok ||
				sourceResult.value.sourceDigest !== asset.sourceDigest
			) {
				const diagnostic = !sourceResult.ok
					? sourceResult.diagnostic
					: `Agent source changed during planning: ${asset.name}. Rerun planning; no files were changed.`;
				const value = {
					schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
					status: "blocked" as const,
					mutation: "none" as const,
					inspectionDigest: inspection.digest,
					actions: [],
					diagnostics: [diagnostic],
				};
				return { ...value, digest: digestValue(value) };
			}
			let kind: AgentAssetPlanActionKind = "refusal";
			if (!asset.collision && asset.drift === "missing") kind = "create";
			if (!asset.collision && asset.drift === "outdated")
				kind =
					asset.installedVersion === asset.packageVersion
						? "replace"
						: "migrate";
			const reason =
				kind !== "refusal"
					? undefined
					: asset.collision
						? "unmanaged-collision"
						: asset.drift === "future"
							? "future-version"
							: "managed-drift";
			actions.push({
				name: asset.name,
				kind,
				targetPath: asset.targetPath,
				fromVersion: asset.installedVersion,
				toVersion: asset.packageVersion,
				sourceDigest: sourceResult.value.sourceDigest,
				content: sourceResult.value.content,
				reason,
				remediation: asset.remediation,
			});
		}
		actions.sort((a, b) => compareText(a.targetPath, b.targetPath));
		if (preview.signal?.aborted) return canceledPlan(inspection.digest);
		const status: AgentAssetPlan["status"] =
			inspection.status === "blocked" ||
			actions.some((action) => action.kind === "refusal")
				? "blocked"
				: "ready";
		const value = {
			schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
			status,
			mutation: "none" as const,
			inspectionDigest: inspection.digest,
			actions,
			diagnostics: inspection.diagnostics,
		};
		if (preview.signal?.aborted) return canceledPlan(inspection.digest);
		return { ...value, digest: digestValue(value) };
	}
	return { inspect, plan };
}
