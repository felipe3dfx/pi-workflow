const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface AgentAssetMigrationStep {
	subject: string;
	fromVersion: number;
	toVersion: number;
	fromDigest: string;
	toDigest: string;
}

type Validation<T> = { ok: true; value: T } | { ok: false; diagnostic: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validStep(value: unknown): value is AgentAssetMigrationStep {
	return (
		isRecord(value) &&
		typeof value.subject === "string" &&
		value.subject.length > 0 &&
		Number.isInteger(value.fromVersion) &&
		(value.fromVersion as number) > 0 &&
		Number.isInteger(value.toVersion) &&
		(value.toVersion as number) === (value.fromVersion as number) + 1 &&
		typeof value.fromDigest === "string" &&
		DIGEST_PATTERN.test(value.fromDigest) &&
		typeof value.toDigest === "string" &&
		DIGEST_PATTERN.test(value.toDigest)
	);
}

export function createMigrationRegistry(
	value: unknown,
): Validation<readonly AgentAssetMigrationStep[]> {
	if (value === undefined) return { ok: true, value: [] };
	if (!Array.isArray(value))
		return { ok: false, diagnostic: "Migration registry must be an array; no files were changed." };
	const steps: AgentAssetMigrationStep[] = [];
	const links = new Set<string>();
	for (const [index, candidate] of value.entries()) {
		if (!validStep(candidate))
			return {
				ok: false,
				diagnostic: `Migration registry step ${index} must be a digest-bound adjacent version link; no files were changed.`,
			};
		const link = `${candidate.subject}:${candidate.fromVersion}:${candidate.toVersion}`;
		if (links.has(link))
			return {
				ok: false,
				diagnostic: `Migration registry contains duplicate link ${link}; no files were changed.`,
			};
		links.add(link);
		steps.push(candidate);
	}
	return { ok: true, value: steps };
}

export function composeMigrationChain(
	steps: readonly AgentAssetMigrationStep[],
	subject: string,
	fromVersion: number,
	toVersion: number,
	fromDigest: string,
	toDigest: string,
): Validation<readonly AgentAssetMigrationStep[]> {
	const chain: AgentAssetMigrationStep[] = [];
	let version = fromVersion;
	let digest = fromDigest;
	while (version < toVersion) {
		const step = steps.find(
			(candidate) => candidate.subject === subject && candidate.fromVersion === version,
		);
		if (!step || step.fromDigest !== digest)
			return {
				ok: false,
				diagnostic: `Migration chain for ${subject} is incomplete or discontinuous at version ${version}; no files were changed.`,
			};
		chain.push(step);
		version = step.toVersion;
		digest = step.toDigest;
	}
	if (digest !== toDigest)
		return {
			ok: false,
			diagnostic: `Migration chain for ${subject} does not reach the packaged digest; no files were changed.`,
		};
	return { ok: true, value: chain };
}
