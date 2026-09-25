import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const endpoint = "https://api.typesafe.ai/v1/systemone";
const timeoutMs = 15_000;

export type Fetch = typeof globalThis.fetch;

export interface JevChoice {
	state: Record<string, unknown>;
	instructions: string;
	criteria: Record<string, string>;
}

export async function askJevChoice(
	apiKey: string,
	question: JevChoice,
	fetch: Fetch = globalThis.fetch,
): Promise<string> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			state: question.state,
			model: "jev-latest",
			questions: {
				choice: {
					type: "choice",
					instructions: question.instructions,
					criteria: question.criteria,
				},
			},
		}),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`Jev returned ${response.status}`);
	const payload = (await response.json().catch(() => {
		throw new Error("Jev returned invalid JSON");
	})) as {
		answers?: Record<string, { choice?: unknown }>;
	};
	const choice = payload.answers?.choice?.choice;
	if (typeof choice !== "string") throw new Error("Jev returned no choice");
	return choice;
}

export function registerTypesafeLogin(pi: ExtensionAPI) {
	pi.registerProvider(
		createProvider({
			id: "typesafe",
			name: "TypeSafe (Jev)",
			auth: {
				apiKey: envApiKeyAuth("TypeSafe API key", ["TYPESAFE_API_KEY"]),
			},
			models: [],
			api: {},
		}),
	);
}
