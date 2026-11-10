import assert from "node:assert/strict";

export function assertSentence(text, ...patterns) {
	const sentences = text.split(/(?<=\.)\s+/);
	assert.ok(
		sentences.some((sentence) => patterns.every((pattern) => pattern.test(sentence))),
		`no sentence matches all of ${patterns.join(", ")}`,
	);
}
