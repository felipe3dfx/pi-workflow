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
	async function readCurrent(
		project: string,
		topic: string,
	): Promise<StoredArtifactRead | undefined> {
		const query = new URLSearchParams({
			project,
			topic_key: topic,
			limit: "1",
			order: "desc",
		});
		const payload = await engramFetch(url, `/observations?${query}`);
		const candidates = Array.isArray(payload)
			? payload
			: payload && typeof payload === "object" && Array.isArray((payload as { observations?: unknown }).observations)
				? (payload as { observations: unknown[] }).observations
				: [];
		const current = candidates.find((candidate) => {
			if (!candidate || typeof candidate !== "object") return false;
			const observation = candidate as { project?: unknown; topic_key?: unknown };
			return observation.project === project && observation.topic_key === topic;
		});
		const revision = extractRevision(current);
		const content = extractObservationContent(current);
		if (!revision || content === undefined) return undefined;
		return { revision, content };
	}

	return {
		capabilities: { atomicCompareAndSwap: false },
		readCurrent,
		async write() {
			const error = new Error(
				"Atomic conditional writes are unsupported by the configured Engram HTTP adapter.",
			);
			(error as Error & { code?: string }).code =
				"PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_UNSUPPORTED";
			throw error;
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

export function createRuntimeEngramApprovedSpecStore(
	options: RuntimeEngramArtifactStoreOptions = {},
) {
	const url = options.url ?? defaultEngramUrl;
	return {
		async readCurrent(project: string, topic: string) {
			const query = new URLSearchParams({
				project,
				topic_key: topic,
				limit: "1",
				order: "desc",
			});
			const payload = await engramFetch(url, `/observations?${query}`);
			const candidates = Array.isArray(payload)
				? payload
				: payload &&
						typeof payload === "object" &&
						Array.isArray((payload as { observations?: unknown }).observations)
					? (payload as { observations: unknown[] }).observations
					: [];
			const current = candidates.find((candidate) => {
				if (!candidate || typeof candidate !== "object") return false;
				const observation = candidate as {
					project?: unknown;
					topic_key?: unknown;
				};
				return observation.project === project && observation.topic_key === topic;
			});
			const revision = extractRevision(current);
			const content = extractObservationContent(current);
			return revision && content !== undefined ? { revision, content } : undefined;
		},
		async write(
			project: string,
			topic: string,
			content: string,
			expectedRevision?: string,
		) {
			if (expectedRevision !== undefined) {
				throw Object.assign(
					new Error("Approved Spec observations are immutable create-only artifacts."),
					{ code: "PI_WORKFLOW_ENGRAM_CONDITIONAL_WRITE_UNSUPPORTED" },
				);
			}
			const payload = await engramFetch(url, "/observations", {
				method: "POST",
				body: {
					project,
					topic_key: topic,
					content,
					type: "architecture",
					session_id: options.sessionId?.(),
					directory: options.directory?.(),
				},
			});
			const revision = extractRevision(payload);
			if (!revision) throw new Error("Engram did not return the approved Spec revision.");
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
