import type { DelegationCheckpointPersistence } from "./delegation-checkpoints.ts";
import {
	canonicalJson,
	digestCanonicalValue,
	sha256Hex,
} from "./workflow-contracts.ts";

export interface PublicationManifest {
	schemaVersion: 1;
	definitionId: string;
	specDigest: string;
	specRevision: string;
	sourceRevision: string;
	stage: "prepared" | "creating" | "created" | "verified";
	publicationKey: string;
	reservationId: string;
	parentId?: string;
	digest: string;
}

type UnsignedPublicationManifest = Omit<PublicationManifest, "digest">;

function createManifest(
	value: UnsignedPublicationManifest,
): PublicationManifest {
	return { ...value, digest: digestCanonicalValue(value) };
}

function parseManifest(content: string): PublicationManifest {
	const value = JSON.parse(content) as PublicationManifest;
	const { digest, ...unsigned } = value;
	if (
		value.schemaVersion !== 1 ||
		!value.definitionId ||
		!value.specDigest ||
		!value.specRevision ||
		!value.sourceRevision ||
		!/^[a-f0-9]{64}$/.test(value.publicationKey) ||
		!value.reservationId ||
			!["prepared", "creating", "created", "verified"].includes(value.stage) ||
		digest !== digestCanonicalValue(unsigned) ||
			(value.stage === "prepared" || value.stage === "creating"
			? value.parentId !== undefined
			: !value.parentId)
	) {
		throw new Error("The durable publication manifest identity is invalid.");
	}
	return value;
}

export function createDurablePublicationManifest(options: {
	directory: string;
	persistence: DelegationCheckpointPersistence;
}) {
	function path(definitionId: string): string {
		return `${options.directory}/${sha256Hex(definitionId)}.json`;
	}

	return {
		create: createManifest,
		async load(definitionId: string) {
			const content = await options.persistence.readFile(path(definitionId));
			if (content === undefined || content.trim() === "null") return undefined;
			const value = parseManifest(content);
			if (value.definitionId !== definitionId) return undefined;
			return { revision: sha256Hex(content), value };
		},
		async save(value: PublicationManifest, expectedRevision?: string) {
			parseManifest(canonicalJson(value));
			const manifestPath = path(value.definitionId);
			return options.persistence.withMutation(
				`delivery-parent-publication-${sha256Hex(value.definitionId)}`,
				async () => {
					const current = await options.persistence.readFile(manifestPath);
					const currentRevision =
						current === undefined ? undefined : sha256Hex(current);
					if (currentRevision !== expectedRevision) {
						throw Object.assign(
							new Error("Publication manifest compare-and-swap conflict."),
							{
								code: "PI_WORKFLOW_PUBLICATION_CONFLICT",
							},
						);
					}
					const content = `${canonicalJson(value)}\n`;
					await options.persistence.writeFileAtomic(
						manifestPath,
						content,
						current === undefined ? null : sha256Hex(current),
					);
					const readBack = await options.persistence.readFile(manifestPath);
					if (readBack !== content) {
						throw new Error("Publication manifest durable read-back mismatch.");
					}
					return sha256Hex(content);
				},
			);
		},
	};
}
