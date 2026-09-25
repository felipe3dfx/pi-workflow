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

export interface JevNouls {
	state: Record<string, unknown>;
	questions: Record<
		string,
		{ instructions: string; criteria: { true: string; false: string } }
	>;
}

type JevAnswers = Record<string, Record<string, unknown> | undefined>;

async function askJev(
	apiKey: string,
	state: Record<string, unknown>,
	questions: Record<string, unknown>,
	fetch: Fetch,
): Promise<JevAnswers> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ state, model: "jev-latest", questions }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`Jev returned ${response.status}`);
	const payload = (await response.json().catch(() => {
		throw new Error("Jev returned invalid JSON");
	})) as { answers?: JevAnswers };
	return payload.answers ?? {};
}

export async function askJevChoice(
	apiKey: string,
	question: JevChoice,
	fetch: Fetch = globalThis.fetch,
): Promise<string> {
	const answers = await askJev(
		apiKey,
		question.state,
		{
			choice: {
				type: "choice",
				instructions: question.instructions,
				criteria: question.criteria,
			},
		},
		fetch,
	);
	const choice = answers.choice?.choice;
	if (typeof choice !== "string") throw new Error("Jev returned no choice");
	return choice;
}

export async function askJevNouls(
	apiKey: string,
	{ state, questions }: JevNouls,
	fetch: Fetch = globalThis.fetch,
): Promise<Record<string, number>> {
	const answers = await askJev(
		apiKey,
		state,
		Object.fromEntries(
			Object.entries(questions).map(([key, question]) => [
				key,
				{ type: "noul", ...question },
			]),
		),
		fetch,
	);
	return Object.fromEntries(
		Object.keys(questions).map((key) => {
			const probability = answers[key]?.noul;
			if (
				typeof probability !== "number" ||
				probability < 0 ||
				probability > 1
			) {
				throw new Error(`Jev returned no answer for ${key}`);
			}
			return [key, probability];
		}),
	);
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
