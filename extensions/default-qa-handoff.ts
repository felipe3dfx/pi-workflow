import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createLinearQaHandoffGateway,
	createRuntimeLinearQaHandoffTransport,
} from "./linear-qa-handoff-gateway.ts";
import { createQaHandoffArtifactStore } from "./qa-handoff-artifact-store.ts";
import {
	createQaHandoffDraftStore,
	type QaHandoffDraftReader,
} from "./qa-handoff-draft-store.ts";
import { createUnavailableQaHandoffWorkflow } from "./qa-handoff-runtime.ts";
import {
	createQaHandoffWorkflow,
	type LinearQaHandoffGateway,
	type QaHandoffArtifactStore,
} from "./qa-handoff-workflow.ts";
import { createRuntimeEngramArtifactStore } from "./runtime-engram-store.ts";
import type { AuthenticatedAuthority } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export interface DefaultQaHandoffRuntimeOptions {
	readonly artifactStore?: WorkflowArtifactStore;
	readonly artifacts?: QaHandoffArtifactStore;
	readonly drafts?: QaHandoffDraftReader;
	readonly gateway?: LinearQaHandoffGateway;
	readonly authenticatedAuthority?: {
		current(): Promise<AuthenticatedAuthority | undefined>;
	};
	readonly project?: string;
	readonly environment?: NodeJS.ProcessEnv;
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

function configuredDeveloperAuthority(
	environment: NodeJS.ProcessEnv,
): DefaultQaHandoffRuntimeOptions["authenticatedAuthority"] {
	const actorId = environment.PI_WORKFLOW_DEVELOPER_ACTOR_ID;
	const authorityRevision =
		environment.PI_WORKFLOW_DEVELOPER_AUTHORITY_REVISION;
	if (
		!actorId ||
		actorId !== actorId.trim() ||
		!authorityRevision ||
		authorityRevision !== authorityRevision.trim()
	) {
		return undefined;
	}
	const authority = Object.freeze({
		actorId,
		role: "Developer" as const,
		authorityRevision,
	});
	return { current: async () => authority };
}

function configuredLinearGateway(
	environment: NodeJS.ProcessEnv,
): LinearQaHandoffGateway | undefined {
	const apiKey = environment.LINEAR_API_KEY?.trim();
	if (!apiKey) return undefined;
	return createLinearQaHandoffGateway(
		createRuntimeLinearQaHandoffTransport({
			apiKey,
			url: environment.LINEAR_API_URL?.trim() || undefined,
		}),
	);
}

export function createDefaultQaHandoffWorkflow(
	getCurrentContext: () => ExtensionContext | undefined,
	options: DefaultQaHandoffRuntimeOptions = {},
) {
	const environment = options.environment ?? process.env;
	const project = options.project ?? basename(findProjectRoot(process.cwd()));
	const artifactStore =
		options.artifactStore ??
		createRuntimeEngramArtifactStore({
			url: environment.ENGRAM_URL?.trim() || undefined,
			sessionId: () => getCurrentContext()?.sessionManager.getSessionId(),
			directory: () => getCurrentContext()?.cwd ?? process.cwd(),
		});
	const gateway = options.gateway ?? configuredLinearGateway(environment);
	const authority =
		options.authenticatedAuthority ?? configuredDeveloperAuthority(environment);
	if (!gateway || !authority) return createUnavailableQaHandoffWorkflow();

	return createQaHandoffWorkflow({
		gateway,
		artifacts:
			options.artifacts ??
			createQaHandoffArtifactStore({
				store: artifactStore,
				project,
			}),
		drafts:
			options.drafts ??
			createQaHandoffDraftStore({ store: artifactStore, project }),
		currentDeveloper: () => authority.current(),
	});
}
