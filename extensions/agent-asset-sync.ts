import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import {
	composeMigrationChain,
	createMigrationRegistry,
	type AgentAssetMigrationStep,
} from "./agent-asset-migrations.ts";
import {
	createVerifiedOperation,
	persistVerifiedOperation,
	verifyOperationBackups,
	verifyOperationSuccessors,
} from "./agent-asset-operation.ts";

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
	withMutation<T>(operationId: string, run: () => Promise<T>): Promise<T>;
	writeFileAtomic(
		path: string,
		content: string,
		expectedDigest: string | null,
	): Promise<void>;
	removeFileAtomic(path: string, expectedDigest: string): Promise<void>;
}

export interface AgentAssetSyncOptions {
	catalog: unknown;
	migrations?: unknown;
	filesystem: AgentAssetFilesystem;
	packageDirectory?: string;
	agentDirectory: string;
	manifestPath: string;
	operationDirectory?: string;
	nonce?: () => string;
}

export interface AgentAssetPreviewOptions {
	signal?: AbortSignal;
}
export interface AgentAssetApplyOptions extends AgentAssetPreviewOptions {
	confirm(plan: AgentAssetPlan): Promise<boolean>;
}
type AgentAssetDrift = "missing" | "none" | "modified" | "outdated" | "future";

interface InspectedAgentAsset {
	name: string;
	targetPath: string;
	ownership: "package" | "unmanaged";
	packageVersion: number;
	installedVersion: number | null;
	installedDigest: string | null;
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
	manifestDigest: string | null;
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
	previousDigest: string | null;
	content: string;
	migrationSteps?: readonly AgentAssetMigrationStep[];
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
	manifestDigest: string | null;
	digest: string;
}

interface ManagedAssetRecord {
	ownership: "package";
	version: number;
	digest: string;
}
interface AgentAssetManifest {
	schemaVersion: typeof AGENT_ASSET_MANIFEST_SCHEMA_VERSION;
	assets: Record<string, ManagedAssetRecord>;
}

interface AppliedAgentAsset {
	name: string;
	targetPath: string;
	version: number;
	digest: string;
	verified: boolean;
}

export interface AgentAssetApplyResult {
	status: "applied" | "blocked" | "canceled";
	mutation: "applied" | "none";
	durability: "durable" | "uncertain";
	readiness: "ready" | "blocked";
	assets: AppliedAgentAsset[];
	diagnostics: string[];
	operationId: string | null;
	digest: string;
}

type Validation<T> = { ok: true; value: T } | { ok: false; diagnostic: string };
type ReadResult =
	| { status: "ok"; content: string | undefined }
	| { status: "canceled" }
	| { status: "error"; diagnostic: string };

function mutationReceipt(error: unknown): {
	mutation: AgentAssetApplyResult["mutation"];
	durability: AgentAssetApplyResult["durability"];
} {
	if (
		isRecord(error) &&
		error.mutation === "applied" &&
		error.durability === "uncertain"
	)
		return { mutation: "applied", durability: "uncertain" };
	return { mutation: "none", durability: "durable" };
}

function releasedOperationResult(error: unknown): AgentAssetApplyResult | undefined {
	if (!isRecord(error) || !isRecord(error.operationResult)) return undefined;
	const result = error.operationResult;
	if (
		(result.status !== "applied" && result.status !== "blocked" && result.status !== "canceled") ||
		(result.mutation !== "applied" && result.mutation !== "none") ||
		!Array.isArray(result.assets) ||
		typeof result.operationId !== "string" && result.operationId !== null
	)
		return undefined;
	return result as unknown as AgentAssetApplyResult;
}

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
			(raw.ownership !== undefined && raw.ownership !== "package") ||
			typeof raw.version !== "number" ||
			!Number.isInteger(raw.version) ||
			raw.version <= 0 ||
			typeof raw.digest !== "string" ||
			!DIGEST_PATTERN.test(raw.digest)
		) {
			return {
				ok: false,
				diagnostic: `Manifest asset record ${name || "<empty>"} must have package ownership when specified, a valid agent name, positive integer version, and lowercase SHA-256 digest. Repair or remove the record before planning; no files were changed.`,
			};
		}
		assets[name] = {
			ownership: "package",
			version: raw.version,
			digest: raw.digest,
		};
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
		installedDigest: managed?.digest ?? null,
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
	return { ...value, manifestDigest: null, digest: digestValue(value) };
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
		manifestDigest: null,
	};
	return { ...value, digest: digestValue(value) };
}

export function createAgentAssetSync(options: AgentAssetSyncOptions) {
	const operationDirectory =
		options.operationDirectory ??
		resolve(options.agentDirectory, "..", ".pi-workflow/sync-operations");
	const recoveryResult = (
		status: AgentAssetApplyResult["status"],
		mutation: AgentAssetApplyResult["mutation"],
		diagnostics: string[],
		operationId: string | null,
		durability: AgentAssetApplyResult["durability"] = "durable",
	): AgentAssetApplyResult => {
		const value = {
			status,
			mutation,
			durability,
			readiness: status === "applied" ? ("ready" as const) : ("blocked" as const),
			assets: [],
			diagnostics,
			operationId,
		};
		return { ...value, digest: digestValue(value) };
	};

	async function recover(
		operationId: string,
		mode: "resume" | "rollback",
	): Promise<AgentAssetApplyResult> {
		if (!DIGEST_PATTERN.test(operationId))
			return recoveryResult("blocked", "none", ["Operation ID is invalid; no files were changed."], null);
		try {
			return await options.filesystem.withMutation(operationId, async () => {
		const operationPath = `${operationDirectory}/${operationId}/operation.json`;
		let rawOperation: string | undefined;
		try {
			rawOperation = await options.filesystem.readFile(operationPath);
			if (rawOperation === undefined)
				return recoveryResult("blocked", "none", ["Operation evidence is missing; no files were changed."], operationId);
		} catch (error) {
			return recoveryResult("blocked", "none", [`Unable to read operation evidence: ${error instanceof Error ? error.message : String(error)}. No files were changed.`], operationId);
		}
		let operationValue: unknown;
		try {
			operationValue = JSON.parse(rawOperation);
		} catch {
			return recoveryResult("blocked", "none", ["Operation evidence is malformed; no files were changed."], operationId);
		}
		const operation = await verifyOperationBackups(operationValue, options.filesystem);
		if (!operation.ok)
			return recoveryResult("blocked", "none", [operation.diagnostic], operationId);
		const manifest = operation.value;
		if (
			manifest.operationId !== operationId ||
			manifest.operationDirectory !== operationDirectory ||
			manifest.manifestPath !== options.manifestPath ||
			manifest.targets.some(
				(target) =>
					!isContained(options.agentDirectory, target.targetPath) ||
					resolve(options.agentDirectory, `${target.targetPath.split("/").at(-1)}`) !==
						target.targetPath,
			)
		)
			return recoveryResult("blocked", "none", ["Operation evidence targets an unsupported path; no files were changed."], operationId);

		const desiredContents = new Map<string, string>();
		if (mode === "resume") {
			const successors = await verifyOperationSuccessors(operationValue, options.filesystem);
			if (!successors.ok) return recoveryResult("blocked", "none", [successors.diagnostic], operationId);
			for (const target of manifest.targets)
				desiredContents.set(target.targetPath, (await options.filesystem.readFile(target.successorPath)) as string);
		}
		const manifestBeforeContent = manifest.manifestOriginallyMissing
			? undefined
			: await options.filesystem.readFile(manifest.manifestBackupPath as string);
		const manifestBefore = parseManifest(manifestBeforeContent);
		if (!manifestBefore.ok)
			return recoveryResult("blocked", "none", ["Operation manifest backup is invalid; no files were changed."], operationId);
		const resumeManifestContent = `${JSON.stringify(
			{
				schemaVersion: AGENT_ASSET_MANIFEST_SCHEMA_VERSION,
				assets: {
					...manifestBefore.value.assets,
					...Object.fromEntries(
						manifest.targets.map((target) => [
							target.targetPath.split("/").at(-1)?.replace(/\.md$/, ""),
							{
								ownership: "package" as const,
								version: target.toVersion,
								digest: target.sourceDigest,
							},
						]),
					),
				},
			},
			null,
			2,
		)}\n`;
		if (sha256(resumeManifestContent) !== manifest.manifestAfterDigest)
			return recoveryResult("blocked", "none", ["Operation manifest evidence does not reproduce the approved state; no files were changed."], operationId);

		const currentTargets = await Promise.all(
			manifest.targets.map(async (target) => ({
				target,
				content: await options.filesystem.readFile(target.targetPath),
			})),
		);
		const currentManifest = await options.filesystem.readFile(options.manifestPath);
		const digestOf = (content: string | undefined) =>
			content === undefined ? null : sha256(content);
		if (
			currentTargets.some(({ target, content }) => {
				const current = digestOf(content);
				return current !== target.previousDigest && current !== target.sourceDigest;
			}) ||
			![manifest.manifestBeforeDigest, manifest.manifestAfterDigest].includes(
				digestOf(currentManifest),
			)
		)
			return recoveryResult("blocked", "none", ["Operation recovery found an unrecognized current state; no files were changed."], operationId);

		let wrote = false;
		try {
			for (const { target, content } of currentTargets) {
				const expectedDigest = digestOf(content);
				if (mode === "resume") {
					if (expectedDigest !== target.sourceDigest)
						await options.filesystem.writeFileAtomic(target.targetPath, desiredContents.get(target.targetPath) as string, expectedDigest);
						wrote = true;
				} else if (target.originallyMissing) {
					if (content !== undefined)
						await options.filesystem.removeFileAtomic(target.targetPath, expectedDigest as string);
						wrote = true;
				} else if (expectedDigest !== target.previousDigest) {
					const backup = await options.filesystem.readFile(target.backupPath as string);
					if (backup === undefined) throw new Error(`missing backup for ${target.targetPath}`);
					await options.filesystem.writeFileAtomic(target.targetPath, backup, expectedDigest);
					wrote = true;
				}
			}
			const currentManifestDigest = digestOf(currentManifest);
			if (mode === "resume" && currentManifestDigest !== manifest.manifestAfterDigest)
				await options.filesystem.writeFileAtomic(
					options.manifestPath,
					resumeManifestContent,
					currentManifestDigest,
				);
				wrote = true;
			if (mode === "rollback" && manifest.manifestOriginallyMissing) {
				if (currentManifest !== undefined)
					await options.filesystem.removeFileAtomic(options.manifestPath, currentManifestDigest as string);
					wrote = true;
			} else if (mode === "rollback" && currentManifestDigest !== manifest.manifestBeforeDigest) {
				const backup = await options.filesystem.readFile(manifest.manifestBackupPath as string);
				if (backup === undefined) throw new Error("missing manifest backup");
				await options.filesystem.writeFileAtomic(options.manifestPath, backup, currentManifestDigest);
				wrote = true;
			}
			return recoveryResult("applied", "applied", [], operationId);
		} catch (error) {
			const receipt = mutationReceipt(error);
			const applied = wrote || receipt.mutation === "applied";
			return recoveryResult("blocked", applied ? "applied" : "none", [`Unable to ${mode} operation: ${error instanceof Error ? error.message : String(error)}. ${applied ? "Partial mutation was applied; completed atomic writes remain recoverable." : "No files were changed."}`], operationId, receipt.durability);
		}
			});
		} catch (error) {
			const prior = releasedOperationResult(error);
			if (prior)
				return recoveryResult(
					"blocked",
					prior.mutation,
					[...prior.diagnostics, `Cooperative lock release failed: ${error instanceof Error ? error.message : String(error)}.`],
					prior.operationId,
					"uncertain",
				);
			const receipt = mutationReceipt(error);
			return recoveryResult("blocked", receipt.mutation, [`Unable to acquire cooperative mutation boundary: ${error instanceof Error ? error.message : String(error)}. ${receipt.mutation === "applied" ? "Lock cleanup is uncertain." : "No files were changed."}`], operationId, receipt.durability);
		}
	}

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
			manifestDigest:
				manifestRead.content === undefined
					? null
					: sha256(manifestRead.content),
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
				manifestDigest: inspection.manifestDigest,
			};
			return { ...value, digest: digestValue(value) };
		}
		const actions: AgentAssetPlanAction[] = [];
		const registry = createMigrationRegistry(options.migrations);
		if (!registry.ok) {
			const value = {
				schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
				status: "blocked" as const,
				mutation: "none" as const,
				inspectionDigest: inspection.digest,
				actions: [],
				diagnostics: [registry.diagnostic],
				manifestDigest: inspection.manifestDigest,
			};
			return { ...value, digest: digestValue(value) };
		}
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
					manifestDigest: inspection.manifestDigest,
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
					manifestDigest: inspection.manifestDigest,
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
			const migration =
				kind === "migrate"
					? composeMigrationChain(
							registry.value,
							asset.name,
							asset.installedVersion as number,
							asset.packageVersion,
							asset.installedDigest as string,
							sourceResult.value.sourceDigest,
						)
					: undefined;
			if (migration && !migration.ok) {
				const value = {
					schemaVersion: AGENT_ASSET_PLAN_SCHEMA_VERSION,
					status: "blocked" as const,
					mutation: "none" as const,
					inspectionDigest: inspection.digest,
					actions: [],
					diagnostics: [migration.diagnostic],
					manifestDigest: inspection.manifestDigest,
				};
				return { ...value, digest: digestValue(value) };
			}
			actions.push({
				name: asset.name,
				kind,
				targetPath: asset.targetPath,
				fromVersion: asset.installedVersion,
				toVersion: asset.packageVersion,
				sourceDigest: sourceResult.value.sourceDigest,
				previousDigest: asset.installedDigest,
				content: sourceResult.value.content,
				migrationSteps: migration?.value,
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
			manifestDigest: inspection.manifestDigest,
		};
		if (preview.signal?.aborted) return canceledPlan(inspection.digest);
		return { ...value, digest: digestValue(value) };
	}

	async function apply(
		approvedPlan: AgentAssetPlan,
		applyOptions: AgentAssetApplyOptions,
	): Promise<AgentAssetApplyResult> {
		const result = (
			status: AgentAssetApplyResult["status"],
			mutation: AgentAssetApplyResult["mutation"],
			assets: AppliedAgentAsset[],
			diagnostics: string[],
			operationId: string | null = null,
			durability: AgentAssetApplyResult["durability"] = "durable",
		): AgentAssetApplyResult => {
			const value = {
				status,
				mutation,
				durability,
				readiness:
					status === "applied" ? ("ready" as const) : ("blocked" as const),
				assets,
				diagnostics,
				operationId,
			};
			return { ...value, digest: digestValue(value) };
		};
		if (applyOptions.signal?.aborted) return result("canceled", "none", [], []);
		const { digest: suppliedDigest, ...planValue } = approvedPlan;
		if (
			suppliedDigest !== digestValue(planValue) ||
			approvedPlan.status !== "ready" ||
			approvedPlan.actions.some((action) => action.kind === "refusal")
		)
			return result(
				"blocked",
				"none",
				[],
				[
					"The approved agent asset plan is invalid or blocked. Generate and review a new plan; no files were changed.",
				],
			);
		if (!(await applyOptions.confirm(approvedPlan)))
			return result("canceled", "none", [], []);
		if (applyOptions.signal?.aborted) return result("canceled", "none", [], []);
		try {
			return await options.filesystem.withMutation(approvedPlan.digest, async () => {
		const latestPlan = await plan({ signal: applyOptions.signal });
		if (latestPlan.status === "canceled")
			return result("canceled", "none", [], []);
		let recovering = false;
		let currentManifestContent: string | undefined;
		if (latestPlan.digest !== approvedPlan.digest) {
			const currentManifest = await safeRead(
				options.manifestPath,
				options,
				applyOptions.signal,
			);
			if (currentManifest.status !== "ok")
				return result(
					"blocked",
					"none",
					[],
					[
						"Agent assets changed after planning. Review and confirm a new plan; no files were changed.",
					],
				);
			const manifestDigest =
				currentManifest.content === undefined
					? null
					: sha256(currentManifest.content);
			const targetReads = await Promise.all(
				approvedPlan.actions.map((action) =>
					safeRead(action.targetPath, options, applyOptions.signal),
				),
			);
			recovering =
				manifestDigest === approvedPlan.manifestDigest &&
				targetReads.every((read, index) => {
					if (read.status !== "ok") return false;
					const action = approvedPlan.actions[index];
					if (!action) return false;
					const digest =
						read.content === undefined ? null : sha256(read.content);
					return (
						digest === action.previousDigest || digest === action.sourceDigest
					);
				});
			if (!recovering)
				return result(
					"blocked",
					"none",
					[],
					[
						"Agent assets changed after planning. Review and confirm a new plan; no files were changed.",
					],
				);
			currentManifestContent = currentManifest.content;
		}
		let wrote = false;
		let canceled = false;
		let operationId: string | null = null;
		try {
			if (!recovering) {
				const manifestRead = await safeRead(
					options.manifestPath,
					options,
					applyOptions.signal,
				);
				if (manifestRead.status !== "ok")
					throw new Error("unable to re-read the approved manifest");
				const manifestDigest =
					manifestRead.content === undefined
						? null
						: sha256(manifestRead.content);
				if (manifestDigest !== approvedPlan.manifestDigest)
					throw new Error("the manifest changed after confirmation");
				currentManifestContent = manifestRead.content;
			}
			const previousManifest = parseManifest(currentManifestContent);
			if (!previousManifest.ok) throw new Error(previousManifest.diagnostic);
			const nextManifest: AgentAssetManifest = {
				schemaVersion: AGENT_ASSET_MANIFEST_SCHEMA_VERSION,
				assets: {
					...previousManifest.value.assets,
					...Object.fromEntries(
						approvedPlan.actions.map((action) => [
							action.name,
							{
								ownership: "package" as const,
								version: action.toVersion,
								digest: action.sourceDigest,
							},
						]),
					),
				},
			};
			const manifestContent = `${JSON.stringify(nextManifest, null, 2)}\n`;
			if (!recovering) {
				const targets = await Promise.all(
					approvedPlan.actions.map(async (action) => {
						const target = await safeRead(
							action.targetPath,
							options,
							applyOptions.signal,
						);
						if (target.status !== "ok")
							throw new Error(`unable to re-read ${action.targetPath}`);
						return { action, previousContent: target.content };
					}),
				);
				const operation = await createVerifiedOperation(
					{
						operationDirectory,
							nonce: (options.nonce ?? randomUUID)(),
						manifestPath: options.manifestPath,
						planDigest: approvedPlan.digest,
						manifestBeforeDigest: approvedPlan.manifestDigest,
						manifestAfterDigest: sha256(manifestContent),
						manifestBeforeContent: currentManifestContent,
						targets: targets.map(({ action, previousContent }) => ({
							targetPath: action.targetPath,
							fromVersion: action.fromVersion,
							toVersion: action.toVersion,
							previousContent,
						sourceDigest: action.sourceDigest,
						sourceContent: action.content,
						})),
					},
					options.filesystem,
				);
				if (!operation.ok) throw new Error(operation.diagnostic);
				const persisted = await persistVerifiedOperation(
					operation.value,
					options.filesystem,
				);
				if (!persisted.ok) throw new Error(persisted.diagnostic);
				operationId = persisted.value.operationId;
			}
			for (const action of approvedPlan.actions) {
				if (applyOptions.signal?.aborted) {
					canceled = true;
					throw new Error("apply was canceled during atomic writes");
				}
				const targetRead = await safeRead(
					action.targetPath,
					options,
					applyOptions.signal,
				);
				if (targetRead.status !== "ok")
					throw new Error(`unable to re-read ${action.targetPath}`);
				const targetDigest =
					targetRead.content === undefined ? null : sha256(targetRead.content);
				if (targetDigest === action.sourceDigest) continue;
				if (targetDigest !== action.previousDigest)
					throw new Error(
						`the target changed after confirmation: ${action.name}`,
					);
				await options.filesystem.writeFileAtomic(
					action.targetPath,
					action.content,
					action.previousDigest,
				);
				wrote = true;
			}
			const manifestBeforeWrite = await safeRead(
				options.manifestPath,
				options,
				applyOptions.signal,
			);
			if (
				manifestBeforeWrite.status !== "ok" ||
				manifestBeforeWrite.content !== currentManifestContent
			)
				throw new Error("the manifest changed during asset writes");
			await options.filesystem.writeFileAtomic(
				options.manifestPath,
				manifestContent,
				approvedPlan.manifestDigest,
			);
			wrote = true;
			const assets: AppliedAgentAsset[] = [];
			for (const action of approvedPlan.actions) {
				const content = await options.filesystem.readFile(action.targetPath);
				assets.push({
					name: action.name,
					targetPath: action.targetPath,
					version: action.toVersion,
					digest: action.sourceDigest,
					verified:
						content !== undefined && sha256(content) === action.sourceDigest,
				});
			}
			const manifestRead = await options.filesystem.readFile(
				options.manifestPath,
			);
			if (
				assets.some((asset) => !asset.verified) ||
				manifestRead !== manifestContent ||
				!parseManifest(manifestRead).ok
			)
				return result("blocked", "applied", assets, [
					"Agent asset read-back verification failed. Run inspect before retrying.",
				]);
			return result("applied", wrote ? "applied" : "none", assets, [], operationId);
		} catch (error) {
			const receipt = mutationReceipt(error);
			const applied = wrote || receipt.mutation === "applied";
			if (canceled)
				return result("canceled", applied ? "applied" : "none", [], [], operationId, receipt.durability);
			return result(
				"blocked",
				applied ? "applied" : "none",
				[],
				[
					`Unable to apply agent assets: ${error instanceof Error ? error.message : String(error)}. Run inspect and retry the approved plan; completed atomic writes remain recoverable.`,
				],
				operationId,
				receipt.durability,
			);
		}
			});
		} catch (error) {
			const prior = releasedOperationResult(error);
			if (prior)
				return result(
					"blocked",
					prior.mutation,
					prior.assets,
					[...prior.diagnostics, `Cooperative lock release failed: ${error instanceof Error ? error.message : String(error)}.`],
					prior.operationId,
					"uncertain",
				);
			const receipt = mutationReceipt(error);
			return result("blocked", receipt.mutation, [], [
				`Unable to acquire cooperative mutation boundary: ${error instanceof Error ? error.message : String(error)}. ${receipt.mutation === "applied" ? "Lock cleanup is uncertain." : "No files were changed."}`,
			], undefined, receipt.durability);
		}
	}
	return {
		inspect,
		plan,
		apply,
		resume: (operationId: string) => recover(operationId, "resume"),
		rollback: (operationId: string) => recover(operationId, "rollback"),
	};
}
