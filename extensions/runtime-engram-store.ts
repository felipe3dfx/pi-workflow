import { randomUUID } from "node:crypto";

import type { StoredArtifactRead } from "./workflow-contracts.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

const defaultEngramUrl = process.env.ENGRAM_URL?.trim() || "http://127.0.0.1:7437";

export interface RuntimeEngramArtifactStoreOptions {
	url?: string;
	sessionId?: () => string | undefined;
	directory?: () => string;
}

interface FetchOptions {
	method?: "GET" | "POST";
	body?: unknown;
}

async function engramFetch(url: string, path: string, options: FetchOptions = {}) {
	const response = await fetch(`${url}${path}`, {
		method: options.method ?? "GET",
		headers:
			options.body === undefined
				? undefined
				: { "content-type": "application/json" },
		body:
			options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Engram request ${path} failed with ${response.status}: ${text || response.statusText}`,
		);
	}
	if (response.status === 204) return null;
	return response.json();
}

function extractObservationContent(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const candidate = payload as {
		content?: unknown;
		body?: unknown;
		observation?: { content?: unknown; body?: unknown };
	};
	if (typeof candidate.content === "string") return candidate.content;
	if (typeof candidate.body === "string") return candidate.body;
	if (
		candidate.observation &&
		typeof candidate.observation === "object" &&
		typeof candidate.observation.content === "string"
	)
		return candidate.observation.content;
	if (
		candidate.observation &&
		typeof candidate.observation === "object" &&
		typeof candidate.observation.body === "string"
	)
		return candidate.observation.body;
	return undefined;
}

function extractRevision(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const candidate = payload as {
		revision?: unknown;
		id?: unknown;
		observation?: { id?: unknown; revision?: unknown };
	};
	if (typeof candidate.revision === "string") return candidate.revision;
	if (typeof candidate.id === "string" || typeof candidate.id === "number") {
		return String(candidate.id);
	}
	if (
		candidate.observation &&
		typeof candidate.observation === "object" &&
		(typeof candidate.observation.id === "string" ||
			typeof candidate.observation.id === "number")
	) {
		return String(candidate.observation.id);
	}
	if (
		candidate.observation &&
		typeof candidate.observation === "object" &&
		typeof candidate.observation.revision === "string"
	) {
		return candidate.observation.revision;
	}
	return undefined;
}

export function createRuntimeEngramArtifactStore(
	options: RuntimeEngramArtifactStoreOptions = {},
): WorkflowArtifactStore {
	const url = options.url ?? defaultEngramUrl;
	const fallbackSessionId = `workflow-${randomUUID()}`;
	const knownSessions = new Set<string>();

	async function ensureSession(project: string): Promise<string> {
		const sessionId = options.sessionId?.() || fallbackSessionId;
		const key = `${project}:${sessionId}`;
		if (knownSessions.has(key)) return sessionId;
		await engramFetch(url, "/sessions", {
			method: "POST",
			body: {
				id: sessionId,
				project,
				directory: options.directory?.() ?? process.cwd(),
			},
		});
		knownSessions.add(key);
		return sessionId;
	}

	return {
		async readCurrent(_project: string, _topic: string): Promise<StoredArtifactRead | undefined> {
			return undefined;
		},
		async write(project: string, topic: string, content: string) {
			const sessionId = await ensureSession(project);
			const payload = await engramFetch(url, "/observations", {
				method: "POST",
				body: {
					session_id: sessionId,
					title: topic,
					content,
					type: "workflow_artifact",
					project,
					scope: "project",
					topic_key: topic,
				},
			});
			const revision = extractRevision(payload);
			if (!revision) {
				throw new Error("Engram observation write did not return a revision reference.");
			}
			return { revision };
		},
		async readRevision(_project: string, _topic: string, revision: string) {
			const payload = await engramFetch(
				url,
				`/observations/${encodeURIComponent(revision)}`,
			);
			return extractObservationContent(payload);
		},
	};
}
