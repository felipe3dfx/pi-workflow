import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createProductReviewArtifactStore } from "./product-review-artifact-store.ts";
import {
	createProductReviewDraftStore,
	type ProductReviewDraftReader,
} from "./product-review-draft-store.ts";
import { createProductReviewMcpPublication } from "./product-review-mcp-publication.ts";
import {
	createProductReviewPublicationRecoveryStore,
	type ProductReviewPublicationRecoveryStore,
} from "./product-review-publication-recovery.ts";
import type { ProductReviewArtifactStore } from "./product-review-workflow.ts";
import { createRuntimeEngramArtifactStore } from "./runtime-engram-store.ts";
import type { AuthenticatedAuthority } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

function findProjectRoot(cwd: string): string {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}

export interface DefaultProductReviewRuntimeOptions {
	readonly artifactStore?: WorkflowArtifactStore;
	readonly artifacts?: ProductReviewArtifactStore;
	readonly drafts?: ProductReviewDraftReader;
	readonly recovery?: ProductReviewPublicationRecoveryStore;
	readonly project?: string;
	readonly environment?: NodeJS.ProcessEnv;
	/** Explicit compatibility policy; environment variables never activate it. */
	readonly authenticatedAuthority?: AuthenticatedAuthority;
}

function ownerCompatibilityPolicy(
	value: AuthenticatedAuthority | undefined,
):
	| {
			readonly actorId: string;
			readonly authorityRevision: string;
	  }
	| undefined {
	if (value === undefined) return undefined;
	if (
		typeof value.actorId !== "string" ||
		value.actorId.length === 0 ||
		value.actorId !== value.actorId.trim() ||
		value.role !== "Owner" ||
		typeof value.authorityRevision !== "string" ||
		value.authorityRevision.length === 0 ||
		value.authorityRevision !== value.authorityRevision.trim()
	)
		throw new Error(
			"Injected product-review authenticated authority is an invalid Owner authority policy.",
		);
	return {
		actorId: value.actorId,
		authorityRevision: value.authorityRevision,
	};
}

export function createDefaultProductReviewMcpPublication(
	getContext: () => ExtensionContext | undefined,
	options: DefaultProductReviewRuntimeOptions = {},
) {
	const environment = options.environment ?? process.env;
	const project = options.project ?? basename(findProjectRoot(process.cwd()));
	const store =
		options.artifactStore ??
		createRuntimeEngramArtifactStore({
			url: environment.ENGRAM_URL?.trim() || undefined,
			sessionId: () => getContext()?.sessionManager.getSessionId(),
			directory: () => getContext()?.cwd ?? process.cwd(),
		});
	const owner = ownerCompatibilityPolicy(options.authenticatedAuthority);
	return createProductReviewMcpPublication({
		...(owner ? { owner } : {}),
		drafts:
			options.drafts ?? createProductReviewDraftStore({ store, project }),
		artifacts:
			options.artifacts ?? createProductReviewArtifactStore({ store, project }),
		recovery:
			options.recovery ??
			createProductReviewPublicationRecoveryStore({ store, project }),
	});
}
