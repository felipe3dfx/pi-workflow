const endpoint = "https://api.typesafe.ai/v1/systemone";
const timeoutMs = 15_000;

export type Fetch = typeof globalThis.fetch;

export interface JevQuestion {
	instructions: string;
	criteria: Record<string, string>;
}

interface JevChoiceAnswer {
	choice: string;
	confidence?: number;
	probabilities?: Record<string, number>;
}

export interface JevResult {
	model?: string;
	requestId?: string;
	answers: Record<string, JevChoiceAnswer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(item) => typeof item === "number" && Number.isFinite(item),
		)
	);
}

function requestId(payload: Record<string, unknown>): string | undefined {
	for (const key of ["id", "request_id", "requestId"]) {
		const value = payload[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function parseAnswer(value: unknown): JevChoiceAnswer {
	if (!isRecord(value) || typeof value.choice !== "string") {
		throw new Error("Jev returned no choice");
	}
	const answer: JevChoiceAnswer = { choice: value.choice };
	if ("confidence" in value) {
		if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) {
			throw new Error("Jev returned an invalid choice");
		}
		answer.confidence = value.confidence;
	}
	if ("probabilities" in value) {
		if (!isProbabilityMap(value.probabilities)) {
			throw new Error("Jev returned an invalid choice");
		}
		answer.probabilities = value.probabilities;
	}
	return answer;
}

export async function askJev(
	apiKey: string,
	state: Record<string, unknown>,
	questions: Record<string, JevQuestion>,
	fetch: Fetch = globalThis.fetch,
): Promise<JevResult> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			state,
			model: "jev-latest",
			questions: Object.fromEntries(
				Object.entries(questions).map(([id, question]) => [
					id,
					{
						type: "choice",
						instructions: question.instructions,
						criteria: question.criteria,
					},
				]),
			),
		}),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`Jev returned ${response.status}`);
	const payload = (await response.json().catch(() => {
		throw new Error("Jev returned invalid JSON");
	})) as unknown;
	if (!isRecord(payload) || !isRecord(payload.answers)) {
		throw new Error("Jev returned no choice");
	}
	const answers: Record<string, JevChoiceAnswer> = {};
	for (const [id, value] of Object.entries(payload.answers)) {
		answers[id] = parseAnswer(value);
	}
	const id = requestId(payload);
	return {
		...(typeof payload.model === "string" ? { model: payload.model } : {}),
		...(id ? { requestId: id } : {}),
		answers,
	};
}
