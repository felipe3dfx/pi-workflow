import type { ExecutionLease } from "./interactive-decisions.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

type ExecutionBinding = Pick<
	ExecutionLease,
	"decisionId" | "operationDigest" | "executionId" | "generation"
>;

export interface CompanionInstallIdentity {
	readonly packages: readonly { readonly package: string; readonly spec: string }[];
	readonly mcp: { readonly path: string; readonly catalogDigest: string };
}

export type CompanionInstallFailure =
	| {
			readonly kind: "package";
			readonly package: string;
			readonly message: string;
	  }
	| { readonly kind: "mcp"; readonly path: string; readonly message: string };

interface CompanionInstallManifest {
	readonly schema: "companion-install";
	readonly schemaVersion: 1;
	readonly operationId: string;
	readonly identity: CompanionInstallIdentity;
	readonly planDigest: string;
	readonly attempt: number;
	readonly stage: "executing" | "partial" | "waiting" | "completed" | "cancelled";
	readonly executionBinding: ExecutionBinding;
	readonly completedPackages: readonly string[];
	readonly failures: readonly CompanionInstallFailure[];
	readonly mcpConfigured: boolean;
	readonly pendingEffect?:
		| { readonly kind: "package"; readonly package: string }
		| { readonly kind: "mcp"; readonly path: string };
	readonly digest: string;
}

export interface StoredCompanionInstallManifest {
	readonly revision: string;
	readonly value: CompanionInstallManifest;
}

export interface CompanionInstallManifestStore {
	read(operationId: string): Promise<StoredCompanionInstallManifest | undefined>;
	open(
		identity: CompanionInstallIdentity,
		planDigest: string,
		lease: ExecutionLease,
		attempt: number,
	): Promise<StoredCompanionInstallManifest>;
	update(
		current: StoredCompanionInstallManifest,
		patch: Partial<
			Pick<
				CompanionInstallManifest,
				| "stage"
				| "completedPackages"
				| "failures"
				| "mcpConfigured"
				| "pendingEffect"
			>
		>,
	): Promise<StoredCompanionInstallManifest>;
}

const digestPattern = /^[a-f0-9]{64}$/;
const text = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value === value.trim();
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

export function companionInstallOperationId(
	identity: CompanionInstallIdentity,
): string {
	return digestCanonicalValue({ schema: "companion-install-intent", identity });
}

function binding(lease: ExecutionLease): ExecutionBinding {
	return {
		decisionId: lease.decisionId,
		operationDigest: lease.operationDigest,
		executionId: lease.executionId,
		generation: lease.generation,
	};
}

function signed(
	value: Omit<CompanionInstallManifest, "digest">,
): CompanionInstallManifest {
	return { ...value, digest: digestCanonicalValue(value) };
}

function validIdentity(value: unknown): value is CompanionInstallIdentity {
	return (
		record(value) &&
		Object.keys(value).length === 2 &&
		Array.isArray(value.packages) &&
		value.packages.every(
			(entry) =>
				record(entry) &&
				text(entry.package) &&
				text(entry.spec) &&
				Object.keys(entry).length === 2,
		) &&
		record(value.mcp) &&
		Object.keys(value.mcp).length === 2 &&
		text(value.mcp.path) &&
		digestPattern.test(String(value.mcp.catalogDigest))
	);
}

function validBinding(value: unknown): value is ExecutionBinding {
		return (
			record(value) &&
			Object.keys(value).length === 4 &&
		text(value.decisionId) &&
		digestPattern.test(String(value.operationDigest)) &&
		text(value.executionId) &&
		Number.isSafeInteger(value.generation) &&
		Number(value.generation) > 0
		);
}

function validPendingEffect(value: unknown): boolean {
	if (value === undefined) return true;
	if (!record(value) || Object.keys(value).length !== 2) return false;
	return value.kind === "package"
		? text(value.package)
		: value.kind === "mcp" && text(value.path);
}

function validFailure(value: unknown): value is CompanionInstallFailure {
	if (!record(value) || !text(value.message)) return false;
	return value.kind === "package"
		? Object.keys(value).length === 3 && text(value.package)
		: value.kind === "mcp" &&
				Object.keys(value).length === 3 &&
				text(value.path);
}

function parse(content: string, operationId: string): CompanionInstallManifest {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw new Error("Companion install manifest is not valid JSON.");
	}
	if (
		!record(value) ||
		value.schema !== "companion-install" ||
		value.schemaVersion !== 1 ||
		value.operationId !== operationId ||
		!validIdentity(value.identity) ||
		companionInstallOperationId(value.identity) !== operationId ||
		!digestPattern.test(String(value.planDigest)) ||
		!Number.isSafeInteger(value.attempt) ||
		Number(value.attempt) < 1 ||
		!["executing", "partial", "waiting", "completed", "cancelled"].includes(
			String(value.stage),
		) ||
		!validBinding(value.executionBinding) ||
		!Array.isArray(value.completedPackages) ||
		!value.completedPackages.every(text) ||
		!Array.isArray(value.failures) ||
		!value.failures.every(validFailure) ||
		typeof value.mcpConfigured !== "boolean" ||
		!validPendingEffect(value.pendingEffect) ||
		!digestPattern.test(String(value.digest))
	)
		throw new Error("Companion install manifest is malformed.");
	const manifest = value as unknown as CompanionInstallManifest;
	const { digest, ...unsigned } = manifest;
	if (
		digest !== digestCanonicalValue(unsigned) ||
		content !== `${canonicalJson(manifest)}\n`
	)
		throw new Error("Companion install manifest digest or canonical bytes differ.");
	return manifest;
}

function createStore(options: {
	readCurrent(operationId: string): Promise<{ revision: string; content: string } | undefined>;
	write(
		operationId: string,
		content: string,
		expectedRevision?: string,
	): Promise<{ revision: string }>;
	readRevision(operationId: string, revision: string): Promise<string | undefined>;
}): CompanionInstallManifestStore {
	async function save(
		operationId: string,
		value: CompanionInstallManifest,
		expectedRevision?: string,
	): Promise<StoredCompanionInstallManifest> {
		const content = `${canonicalJson(value)}\n`;
		parse(content, operationId);
		const written = await options.write(operationId, content, expectedRevision);
		if ((await options.readRevision(operationId, written.revision)) !== content)
			throw new Error("Companion install manifest revision read-back mismatch.");
		const current = await options.readCurrent(operationId);
		if (current?.revision !== written.revision || current.content !== content)
			throw new Error("Companion install manifest current read-back mismatch.");
		return { revision: written.revision, value: parse(content, operationId) };
	}

	return {
		async read(operationId) {
			const current = await options.readCurrent(operationId);
			return current
				? { revision: current.revision, value: parse(current.content, operationId) }
				: undefined;
		},
		async open(identity, planDigest, lease, attempt) {
			const operationId = companionInstallOperationId(identity);
			const current = await this.read(operationId);
			if (current) {
				if (
					canonicalJson(current.value.identity) !== canonicalJson(identity) ||
					(current.value.stage !== "partial" &&
						current.value.stage !== "waiting" &&
						current.value.executionBinding.executionId !== lease.executionId)
				)
					throw new Error("Companion install manifest conflicts with active execution.");
				if (current.value.executionBinding.executionId === lease.executionId)
					return current;
				const { digest: _digest, ...unsigned } = current.value;
				return save(
					operationId,
					signed({
						...unsigned,
						planDigest,
						attempt,
						stage: "executing",
						executionBinding: binding(lease),
						pendingEffect: undefined,
					}),
					current.revision,
				);
			}
			return save(
				operationId,
				signed({
					schema: "companion-install",
					schemaVersion: 1,
					operationId,
					identity,
					planDigest,
					attempt,
					stage: "executing",
					executionBinding: binding(lease),
					completedPackages: [],
					failures: [],
					mcpConfigured: false,
				}),
			);
		},
		async update(current, patch) {
			const { digest: _digest, ...unsigned } = current.value;
			return save(
				current.value.operationId,
				signed({ ...unsigned, ...patch }),
				current.revision,
			);
		},
	};
}

export function createCompanionInstallManifestStore(options: {
	readonly store: WorkflowArtifactStore;
	readonly project: string | (() => string);
	readonly topicPrefix?: string;
}): CompanionInstallManifestStore {
	if (options.store.capabilities?.atomicCompareAndSwap !== true)
		throw new Error("Companion install manifests require atomic compare-and-swap.");
	const project = () =>
		typeof options.project === "function" ? options.project() : options.project;
	const topic = (operationId: string) =>
		`${options.topicPrefix ?? "workflow/companion-install"}/${operationId}`;
	return createStore({
		readCurrent: (operationId) =>
			options.store.readCurrent(project(), topic(operationId)),
		write: (operationId, content, expectedRevision) =>
			options.store.write(
				project(),
				topic(operationId),
				content,
				expectedRevision,
			),
		readRevision: (operationId, revision) =>
			options.store.readRevision(project(), topic(operationId), revision),
	});
}

export function createInMemoryCompanionInstallManifestStore(): CompanionInstallManifestStore {
	const current = new Map<string, { revision: string; content: string }>();
	const revisions = new Map<string, string>();
	let sequence = 0;
	return createStore({
		async readCurrent(operationId) {
			return structuredClone(current.get(operationId));
		},
		async write(operationId, content, expectedRevision) {
			if ((current.get(operationId)?.revision ?? undefined) !== expectedRevision)
				throw new Error("Companion install manifest compare-and-swap conflict.");
			sequence += 1;
			const revision = `companion-install-${sequence}`;
			current.set(operationId, { revision, content });
			revisions.set(`${operationId}:${revision}`, content);
			return { revision };
		},
		async readRevision(operationId, revision) {
			return revisions.get(`${operationId}:${revision}`);
		},
	});
}
