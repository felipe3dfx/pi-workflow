import {
	canonicalJson,
	digestCanonicalValue,
	sha256Hex,
	type DelegationCheckpoint,
} from "./workflow-contracts.ts";

interface StoredDelegationCheckpoint {
	revision: string;
	checkpoint: DelegationCheckpoint;
}

/** Private Orchestrator storage. This interface is never included in Subagent grants. */
export interface DelegationCheckpointStore {
	load(identity: string): Promise<StoredDelegationCheckpoint | undefined>;
	save(
		checkpoint: DelegationCheckpoint,
		expectedRevision?: string,
	): Promise<StoredDelegationCheckpoint>;
}

export interface DelegationCheckpointPersistence {
	capabilities?: { atomicCompareAndSwap?: boolean };
	readFile(path: string): Promise<string | undefined>;
	withMutation<T>(operationId: string, run: () => Promise<T>): Promise<T>;
	writeFileAtomic(
		path: string,
		content: string,
		expectedDigest: string | null,
	): Promise<void>;
}

interface DelegationCheckpointEnvelope {
	schemaVersion: 1;
	revision: string;
	checkpoint: DelegationCheckpoint;
	digest: string;
}

function checkpointPath(directory: string, identity: string): string {
	if (!/^[a-f0-9]{64}$/.test(identity)) {
		throw new Error("Delegation checkpoint identity is invalid.");
	}
	return `${directory.replace(/\/$/, "")}/${identity}.json`;
}

function parseCheckpoint(
	content: string,
	expectedIdentity: string,
): StoredDelegationCheckpoint {
	const parsed = JSON.parse(content) as DelegationCheckpointEnvelope;
	const unsigned = {
		schemaVersion: parsed.schemaVersion,
		revision: parsed.revision,
		checkpoint: parsed.checkpoint,
	};
	if (
		parsed.schemaVersion !== 1 ||
		!parsed.checkpoint ||
		parsed.checkpoint.identity !== expectedIdentity ||
		parsed.revision !== digestCanonicalValue(parsed.checkpoint) ||
		parsed.digest !== digestCanonicalValue(unsigned)
	) {
		throw new Error("The durable delegation checkpoint is invalid.");
	}
	return { revision: parsed.revision, checkpoint: parsed.checkpoint };
}

export function createDurableDelegationCheckpointStore(options: {
	directory: string;
	persistence: DelegationCheckpointPersistence;
}): DelegationCheckpointStore {
	return {
		async load(identity) {
			const content = await options.persistence.readFile(
				checkpointPath(options.directory, identity),
			);
			return content === undefined
				? undefined
				: parseCheckpoint(content, identity);
		},
		async save(checkpoint, expectedRevision) {
			const path = checkpointPath(options.directory, checkpoint.identity);
			return options.persistence.withMutation(checkpoint.identity, async () => {
				const currentContent = await options.persistence.readFile(path);
				const current =
					currentContent === undefined
						? undefined
						: parseCheckpoint(currentContent, checkpoint.identity);
				if (current?.revision !== expectedRevision) {
					throw new Error("Delegation checkpoint compare-and-swap conflict.");
				}
				const revision = digestCanonicalValue(checkpoint);
				const unsigned = {
					schemaVersion: 1 as const,
					revision,
					checkpoint,
				};
				const content = `${canonicalJson({
					...unsigned,
					digest: digestCanonicalValue(unsigned),
				})}\n`;
				await options.persistence.writeFileAtomic(
					path,
					content,
					currentContent === undefined ? null : sha256Hex(currentContent),
				);
				const readBack = await options.persistence.readFile(path);
				if (readBack !== content) {
					throw new Error("Delegation checkpoint durable read-back mismatch.");
				}
				return { revision, checkpoint: structuredClone(checkpoint) };
			});
		},
	};
}

export function createInMemoryDelegationCheckpointStore(): DelegationCheckpointStore {
	const checkpoints = new Map<string, StoredDelegationCheckpoint>();
	let revision = 0;
	return {
		async load(identity) {
			return checkpoints.get(identity);
		},
		async save(checkpoint, expectedRevision) {
			const current = checkpoints.get(checkpoint.identity);
			if (current?.revision !== expectedRevision) {
				throw new Error("Delegation checkpoint compare-and-swap conflict.");
			}
			revision += 1;
			const stored = {
				revision: `checkpoint-${revision}`,
				checkpoint: structuredClone(checkpoint),
			};
			checkpoints.set(checkpoint.identity, stored);
			return stored;
		},
	};
}
