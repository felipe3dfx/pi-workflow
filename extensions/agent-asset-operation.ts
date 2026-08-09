import { createHash } from "node:crypto";
import type { ExecutionLease } from "./interactive-decisions.ts";

const OPERATION_MANIFEST_SCHEMA_VERSION = 2 as const;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

type Validation<T> = { ok: true; value: T } | { ok: false; diagnostic: string };

export interface OperationFilesystem {
	readFile(path: string): Promise<string | undefined>;
	writeFileAtomic(
		path: string,
		content: string,
		expectedDigest: string | null,
	): Promise<void>;
}

interface OperationTargetInput {
	targetPath: string;
	fromVersion: number | null;
	toVersion: number;
	previousContent: string | undefined;
	sourceDigest: string;
	sourceContent: string;
}

export interface OperationInput {
	operationDirectory: string;
	manifestPath: string;
	nonce: string;
	planDigest: string;
	manifestBeforeDigest: string | null;
	manifestAfterDigest: string | null;
	manifestBeforeContent: string | undefined;
	targets: readonly OperationTargetInput[];
	executionLease: ExecutionLease;
}

type OperationExecutionBinding = Pick<
	ExecutionLease,
	"decisionId" | "operationDigest" | "executionId" | "generation"
>;

interface OperationManifestTarget {
	targetPath: string;
	fromVersion: number | null;
	toVersion: number;
	previousDigest: string | null;
	sourceDigest: string;
	successorPath: string;
	successorDigest: string;
	backupPath: string | null;
	backupDigest: string | null;
	originallyMissing: boolean;
}

export interface OperationManifest {
	schemaVersion: typeof OPERATION_MANIFEST_SCHEMA_VERSION;
	operationId: string;
	nonce: string;
	operationDirectory: string;
	manifestPath: string;
	planDigest: string;
	manifestBeforeDigest: string | null;
	manifestAfterDigest: string | null;
	manifestBackupPath: string | null;
	manifestBackupDigest: string | null;
	manifestOriginallyMissing: boolean;
	targets: readonly OperationManifestTarget[];
	executionBinding: OperationExecutionBinding;
	digest: string;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value))
		return `{${Object.keys(value)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

function validDigest(value: unknown): value is string {
	return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function validNullableDigest(value: unknown): value is string | null {
	return value === null || validDigest(value);
}

function validVersion(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

function operationIdentity(input: {
	nonce: string;
	operationDirectory: string;
	manifestPath: string;
	planDigest: string;
	manifestBeforeDigest: string | null;
	manifestAfterDigest: string | null;
	targets: readonly Pick<
		OperationManifestTarget,
		| "targetPath"
		| "fromVersion"
		| "toVersion"
		| "previousDigest"
		| "sourceDigest"
	>[];
	executionBinding: OperationExecutionBinding;
}): string {
	return sha256(
		canonicalJson({
			schemaVersion: OPERATION_MANIFEST_SCHEMA_VERSION,
			...input,
		}),
	);
}

function manifestDigest(manifest: Omit<OperationManifest, "digest">): string {
	return sha256(canonicalJson(manifest));
}

function validateInput(input: OperationInput): Validation<void> {
	if (
		typeof input.operationDirectory !== "string" ||
		!input.operationDirectory.startsWith("/") ||
		typeof input.manifestPath !== "string" ||
		!input.manifestPath.startsWith("/") ||
		typeof input.nonce !== "string" ||
		input.nonce.length === 0 ||
		!validDigest(input.planDigest) ||
		!validNullableDigest(input.manifestBeforeDigest) ||
		!validNullableDigest(input.manifestAfterDigest) ||
		(input.manifestBeforeContent !== undefined &&
			typeof input.manifestBeforeContent !== "string") ||
		(input.manifestBeforeContent === undefined
			? input.manifestBeforeDigest !== null
			: sha256(input.manifestBeforeContent) !== input.manifestBeforeDigest) ||
		!Array.isArray(input.targets) ||
		!validExecutionLease(input.executionLease)
	)
		return {
			ok: false,
			diagnostic:
				"Operation input must contain absolute paths, nonce, and matching manifest digests; no files were changed.",
		};
	for (const target of input.targets) {
		if (
			typeof target.targetPath !== "string" ||
			!target.targetPath.startsWith("/") ||
			(target.fromVersion !== null && !validVersion(target.fromVersion)) ||
			!validVersion(target.toVersion) ||
			(target.fromVersion !== null && target.fromVersion > target.toVersion) ||
			(target.previousContent !== undefined &&
				typeof target.previousContent !== "string") ||
			!validDigest(target.sourceDigest) ||
			typeof target.sourceContent !== "string" ||
			sha256(target.sourceContent) !== target.sourceDigest
		)
			return {
				ok: false,
				diagnostic:
					"Operation target must have absolute paths, forward versions, and valid digests; no files were changed.",
			};
	}
	return { ok: true, value: undefined };
}

function validExecutionBinding(
	value: unknown,
): value is OperationExecutionBinding {
	if (!isRecord(value)) return false;
	return (
		typeof value.decisionId === "string" &&
		value.decisionId.length > 0 &&
		validDigest(value.operationDigest) &&
		typeof value.executionId === "string" &&
		value.executionId.length > 0 &&
		Number.isSafeInteger(value.generation) &&
		(value.generation as number) > 0
	);
}

function validExecutionLease(value: unknown): value is ExecutionLease {
	if (!isRecord(value) || !validExecutionBinding(value)) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.actorId === "string" &&
		candidate.actorId.length > 0 &&
		typeof candidate.authorityRevision === "string" &&
		candidate.authorityRevision.length > 0 &&
		isRecord(candidate.action) &&
		typeof candidate.action.id === "string" &&
		candidate.action.id.length > 0
	);
}

export function createOperationManifest(
	input: OperationInput,
): Validation<OperationManifest> {
	const inputValidation = validateInput(input);
	if (!inputValidation.ok) return inputValidation;
	const identityTargets = input.targets.map((target) => ({
		targetPath: target.targetPath,
		fromVersion: target.fromVersion,
		toVersion: target.toVersion,
		previousDigest:
			target.previousContent === undefined
				? null
				: sha256(target.previousContent),
		sourceDigest: target.sourceDigest,
	}));
	const operationId = operationIdentity({
		nonce: input.nonce,
		operationDirectory: input.operationDirectory,
		manifestPath: input.manifestPath,
		planDigest: input.planDigest,
		manifestBeforeDigest: input.manifestBeforeDigest,
		manifestAfterDigest: input.manifestAfterDigest,
		targets: identityTargets,
		executionBinding: {
			decisionId: input.executionLease.decisionId,
			operationDigest: input.executionLease.operationDigest,
			executionId: input.executionLease.executionId,
			generation: input.executionLease.generation,
		},
	});
	const manifestWithoutDigest: Omit<OperationManifest, "digest"> = {
		schemaVersion: OPERATION_MANIFEST_SCHEMA_VERSION,
		operationId,
		nonce: input.nonce,
		operationDirectory: input.operationDirectory,
		manifestPath: input.manifestPath,
		planDigest: input.planDigest,
		manifestBeforeDigest: input.manifestBeforeDigest,
		manifestAfterDigest: input.manifestAfterDigest,
		manifestBackupPath:
			input.manifestBeforeDigest === null
				? null
				: `${input.operationDirectory}/${operationId}/${input.targets.length}.backup`,
		manifestBackupDigest: input.manifestBeforeDigest,
		manifestOriginallyMissing: input.manifestBeforeDigest === null,
		targets: identityTargets.map((target, index) => ({
			...target,
			successorPath: `${input.operationDirectory}/${operationId}/${index}.successor`,
			successorDigest: target.sourceDigest,
			backupPath:
				target.previousDigest === null
					? null
					: `${input.operationDirectory}/${operationId}/${index}.backup`,
			backupDigest: target.previousDigest,
			originallyMissing: target.previousDigest === null,
		})),
		executionBinding: {
			decisionId: input.executionLease.decisionId,
			operationDigest: input.executionLease.operationDigest,
			executionId: input.executionLease.executionId,
			generation: input.executionLease.generation,
		},
	};
	return {
		ok: true,
		value: {
			...manifestWithoutDigest,
			digest: manifestDigest(manifestWithoutDigest),
		},
	};
}

export function verifyOperationManifest(
	value: unknown,
): Validation<OperationManifest> {
	if (
		!isRecord(value) ||
		value.schemaVersion !== OPERATION_MANIFEST_SCHEMA_VERSION
	)
		return {
			ok: false,
			diagnostic:
				"Operation manifest schema is unsupported; no files were changed.",
		};
	const manifest = value as unknown as OperationManifest;
	if (
		typeof manifest.nonce !== "string" ||
		!validDigest(manifest.operationId) ||
		typeof manifest.operationDirectory !== "string" ||
		!manifest.operationDirectory.startsWith("/") ||
		typeof manifest.manifestPath !== "string" ||
		!manifest.manifestPath.startsWith("/") ||
		!validDigest(manifest.planDigest) ||
		!validNullableDigest(manifest.manifestBeforeDigest) ||
		!validNullableDigest(manifest.manifestAfterDigest) ||
		!validNullableDigest(manifest.manifestBackupDigest) ||
		manifest.manifestOriginallyMissing !==
			(manifest.manifestBeforeDigest === null) ||
		(manifest.manifestOriginallyMissing
			? manifest.manifestBackupPath !== null ||
				manifest.manifestBackupDigest !== null
			: typeof manifest.manifestBackupPath !== "string" ||
				manifest.manifestBackupDigest !== manifest.manifestBeforeDigest) ||
		!Array.isArray(manifest.targets) ||
		!validExecutionBinding(manifest.executionBinding) ||
		!validDigest(manifest.digest)
	)
		return {
			ok: false,
			diagnostic: "Operation manifest is malformed; no files were changed.",
		};
	for (const target of manifest.targets) {
		if (
			typeof target.targetPath !== "string" ||
			!target.targetPath.startsWith("/") ||
			(target.fromVersion !== null && !validVersion(target.fromVersion)) ||
			!validVersion(target.toVersion) ||
			!validNullableDigest(target.previousDigest) ||
			!validDigest(target.sourceDigest) ||
			typeof target.successorPath !== "string" ||
			!validDigest(target.successorDigest) ||
			target.successorDigest !== target.sourceDigest ||
			!validNullableDigest(target.backupDigest) ||
			target.originallyMissing !== (target.previousDigest === null) ||
			(target.originallyMissing
				? target.backupPath !== null || target.backupDigest !== null
				: typeof target.backupPath !== "string" ||
					target.backupDigest !== target.previousDigest)
		)
			return {
				ok: false,
				diagnostic:
					"Operation manifest target is malformed; no files were changed.",
			};
	}
	const expectedOperationId = operationIdentity({
		nonce: manifest.nonce,
		operationDirectory: manifest.operationDirectory,
		manifestPath: manifest.manifestPath,
		planDigest: manifest.planDigest,
		manifestBeforeDigest: manifest.manifestBeforeDigest,
		manifestAfterDigest: manifest.manifestAfterDigest,
		targets: manifest.targets.map((target) => ({
			targetPath: target.targetPath,
			fromVersion: target.fromVersion,
			toVersion: target.toVersion,
			previousDigest: target.previousDigest,
			sourceDigest: target.sourceDigest,
		})),
		executionBinding: manifest.executionBinding,
	});
	const { digest, ...withoutDigest } = manifest;
	if (
		manifest.operationId !== expectedOperationId ||
		digest !== manifestDigest(withoutDigest)
	)
		return {
			ok: false,
			diagnostic:
				"Operation manifest identity or self-digest does not match its immutable intent; no files were changed.",
		};
	return { ok: true, value: manifest };
}

export async function verifyOperationBackups(
	value: unknown,
	filesystem: OperationFilesystem,
): Promise<Validation<OperationManifest>> {
	const manifestResult = verifyOperationManifest(value);
	if (!manifestResult.ok) return manifestResult;
	for (const target of manifestResult.value.targets) {
		if (target.originallyMissing) continue;
		try {
			const backup = await filesystem.readFile(target.backupPath as string);
			if (backup === undefined || sha256(backup) !== target.backupDigest)
				return {
					ok: false,
					diagnostic: `Operation backup digest does not match for ${target.targetPath}; no files were changed.`,
				};
		} catch (error) {
			return {
				ok: false,
				diagnostic: `Unable to verify operation backup for ${target.targetPath}: ${error instanceof Error ? error.message : String(error)}. No files were changed.`,
			};
		}
	}
	if (!manifestResult.value.manifestOriginallyMissing) {
		try {
			const backup = await filesystem.readFile(
				manifestResult.value.manifestBackupPath as string,
			);
			if (
				backup === undefined ||
				sha256(backup) !== manifestResult.value.manifestBackupDigest
			)
				return {
					ok: false,
					diagnostic:
						"Operation manifest backup digest does not match; no files were changed.",
				};
		} catch (error) {
			return {
				ok: false,
				diagnostic: `Unable to verify operation manifest backup: ${error instanceof Error ? error.message : String(error)}. No files were changed.`,
			};
		}
	}
	return manifestResult;
}

export async function verifyOperationSuccessors(
	value: unknown,
	filesystem: OperationFilesystem,
): Promise<Validation<OperationManifest>> {
	const manifestResult = verifyOperationManifest(value);
	if (!manifestResult.ok) return manifestResult;
	for (const target of manifestResult.value.targets) {
		const successor = await filesystem.readFile(target.successorPath);
		if (successor === undefined || sha256(successor) !== target.successorDigest)
			return {
				ok: false,
				diagnostic: `Operation successor digest does not match for ${target.targetPath}; no files were changed.`,
			};
	}
	return manifestResult;
}

export async function createVerifiedOperation(
	input: OperationInput,
	filesystem: OperationFilesystem,
): Promise<Validation<OperationManifest>> {
	const manifestResult = createOperationManifest(input);
	if (!manifestResult.ok) return manifestResult;
	const persisted = await persistVerifiedOperation(
		manifestResult.value,
		filesystem,
	);
	if (!persisted.ok) return persisted;
	return materializeOperationEvidence(input, persisted.value, filesystem);
}

export async function materializeOperationEvidence(
	input: OperationInput,
	manifest: OperationManifest,
	filesystem: OperationFilesystem,
	beforeMutation: () => Promise<void> = async () => undefined,
): Promise<Validation<OperationManifest>> {
	const manifestResult = verifyOperationManifest(manifest);
	if (!manifestResult.ok) return manifestResult;
	if (
		manifest.planDigest !== input.planDigest ||
		manifest.executionBinding.executionId !== input.executionLease.executionId
	)
		return {
			ok: false,
			diagnostic:
				"Operation evidence input does not match its execution-bound manifest; no asset files were changed.",
		};
	for (const [index, target] of manifestResult.value.targets.entries()) {
		if (target.originallyMissing) continue;
		const previousContent = input.targets[index]?.previousContent;
		try {
			if (previousContent === undefined)
				return {
					ok: false,
					diagnostic: `Operation backup source is missing for ${target.targetPath}; no files were changed.`,
				};
			const currentContent = await filesystem.readFile(target.targetPath);
			if (
				currentContent === undefined ||
				sha256(currentContent) !== target.previousDigest
			)
				return {
					ok: false,
					diagnostic: `Operation target changed after planning: ${target.targetPath}; no files were changed.`,
				};
			const existing = await filesystem.readFile(target.backupPath as string);
			if (existing !== undefined) {
				if (sha256(existing) !== target.backupDigest)
					return {
						ok: false,
						diagnostic: `Operation backup conflicts for ${target.targetPath}; no asset files were changed.`,
					};
				continue;
			}
			await beforeMutation();
			const latestContent = await filesystem.readFile(target.targetPath);
			if (
				latestContent === undefined ||
				sha256(latestContent) !== target.previousDigest
			)
				return {
					ok: false,
					diagnostic: `Operation target changed before backup: ${target.targetPath}; no asset files were changed.`,
				};
			await filesystem.writeFileAtomic(
				target.backupPath as string,
				previousContent,
				null,
			);
		} catch (error) {
			return {
				ok: false,
				diagnostic: `Unable to create operation backup for ${target.targetPath}: ${error instanceof Error ? error.message : String(error)}. No asset files were changed.`,
			};
		}
	}
	if (!manifestResult.value.manifestOriginallyMissing) {
		try {
			const current = await filesystem.readFile(input.manifestPath);
			if (
				current === undefined ||
				sha256(current) !== manifestResult.value.manifestBeforeDigest
			)
				return {
					ok: false,
					diagnostic:
						"Operation manifest changed after planning; no files were changed.",
				};
			const existing = await filesystem.readFile(
				manifestResult.value.manifestBackupPath as string,
			);
			if (existing !== undefined) {
				if (sha256(existing) !== manifestResult.value.manifestBackupDigest)
					return {
						ok: false,
						diagnostic:
							"Operation manifest backup conflicts; no asset files were changed.",
					};
			} else {
				await beforeMutation();
				const latest = await filesystem.readFile(input.manifestPath);
				if (
					latest === undefined ||
					sha256(latest) !== manifestResult.value.manifestBeforeDigest
				)
					return {
						ok: false,
						diagnostic:
							"Operation manifest changed before backup; no asset files were changed.",
					};
				await filesystem.writeFileAtomic(
					manifestResult.value.manifestBackupPath as string,
					input.manifestBeforeContent as string,
					null,
				);
			}
		} catch (error) {
			return {
				ok: false,
				diagnostic: `Unable to create operation manifest backup: ${error instanceof Error ? error.message : String(error)}. No asset files were changed.`,
			};
		}
	}
	for (const [index, target] of manifestResult.value.targets.entries()) {
		const successor = input.targets[index]?.sourceContent;
		if (successor === undefined)
			return {
				ok: false,
				diagnostic: `Operation successor source is missing for ${target.targetPath}; no files were changed.`,
			};
		try {
			const existing = await filesystem.readFile(target.successorPath);
			if (existing !== undefined) {
				if (sha256(existing) !== target.successorDigest)
					return {
						ok: false,
						diagnostic: `Operation successor conflicts for ${target.targetPath}; no asset files were changed.`,
					};
				continue;
			}
			await beforeMutation();
			await filesystem.writeFileAtomic(target.successorPath, successor, null);
		} catch (error) {
			return {
				ok: false,
				diagnostic: `Unable to create operation successor for ${target.targetPath}: ${error instanceof Error ? error.message : String(error)}. No asset files were changed.`,
			};
		}
	}
	const backups = await verifyOperationBackups(
		manifestResult.value,
		filesystem,
	);
	if (!backups.ok) return backups;
	return verifyOperationSuccessors(manifestResult.value, filesystem);
}

export async function persistVerifiedOperation(
	manifest: OperationManifest,
	filesystem: OperationFilesystem,
	beforeMutation: () => Promise<void> = async () => undefined,
): Promise<Validation<OperationManifest>> {
	const verified = verifyOperationManifest(manifest);
	if (!verified.ok) return verified;
	const path = `${manifest.operationDirectory}/${manifest.operationId}/operation.json`;
	const content = canonicalJson(manifest);
	try {
		const existing = await filesystem.readFile(path);
		if (existing !== undefined) {
			if (existing !== content)
				return {
					ok: false,
					diagnostic:
						"Operation manifest conflicts with existing durable evidence; no asset files were changed.",
				};
			return verifyOperationManifest(JSON.parse(existing));
		}
		await beforeMutation();
		await filesystem.writeFileAtomic(path, content, null);
		const readBack = await filesystem.readFile(path);
		if (readBack !== content)
			return {
				ok: false,
				diagnostic:
					"Operation manifest read-back does not match its atomic write; no asset files were changed.",
			};
		return verifyOperationManifest(JSON.parse(readBack));
	} catch (error) {
		return {
			ok: false,
			diagnostic: `Unable to persist operation manifest: ${error instanceof Error ? error.message : String(error)}. No asset files were changed.`,
		};
	}
}
