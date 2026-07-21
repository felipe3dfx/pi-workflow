import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createLinearQaHandoffGateway,
	createRuntimeLinearQaHandoffTransport,
} from "./linear-qa-handoff-gateway.ts";
import { createProductReviewArtifactStore } from "./product-review-artifact-store.ts";
import {
	createProductReviewDraftStore,
	type ProductReviewDraftReader,
} from "./product-review-draft-store.ts";
import { createUnavailableProductReviewWorkflow } from "./product-review-runtime.ts";
import {
	createProductReviewWorkflow,
	type LinearProductReviewGateway,
	type ProductReviewArtifactStore,
} from "./product-review-workflow.ts";
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
	readonly gateway?: LinearProductReviewGateway;
	readonly authenticatedAuthority?: {
		current(): Promise<AuthenticatedAuthority | undefined>;
	};
	readonly project?: string;
	readonly environment?: NodeJS.ProcessEnv;
}
export function createDefaultProductReviewWorkflow(
	getContext: () => ExtensionContext | undefined,
	options: DefaultProductReviewRuntimeOptions = {},
) {
	const env = options.environment ?? process.env;
	const actorId = env.PI_WORKFLOW_OWNER_ACTOR_ID,
		authorityRevision = env.PI_WORKFLOW_OWNER_AUTHORITY_REVISION;
	const authority =
		options.authenticatedAuthority ??
		(actorId &&
		actorId === actorId.trim() &&
		authorityRevision &&
		authorityRevision === authorityRevision.trim()
			? {
					current: async () => ({
						actorId,
						role: "Owner" as const,
						authorityRevision,
					}),
				}
			: undefined);
	const gateway =
		options.gateway ??
		(env.LINEAR_API_KEY?.trim()
			? createLinearQaHandoffGateway(
					createRuntimeLinearQaHandoffTransport({
						apiKey: env.LINEAR_API_KEY.trim(),
						url: env.LINEAR_API_URL?.trim() || undefined,
					}),
				)
			: undefined);
	if (!authority || !gateway) return createUnavailableProductReviewWorkflow();
	const project = options.project ?? basename(findProjectRoot(process.cwd()));
	const store =
		options.artifactStore ??
		createRuntimeEngramArtifactStore({
			url: env.ENGRAM_URL?.trim() || undefined,
			sessionId: () => getContext()?.sessionManager.getSessionId(),
			directory: () => getContext()?.cwd ?? process.cwd(),
		});
	return createProductReviewWorkflow({
		gateway,
		artifacts:
			options.artifacts ?? createProductReviewArtifactStore({ store, project }),
		drafts: options.drafts ?? createProductReviewDraftStore({ store, project }),
		currentOwner: () => authority.current(),
	});
}
