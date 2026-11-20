const id = "5636a1b2-0000-4000-8000-000000000000";

export const advice = `## Verdict

The approach is sound, but two risks need a check before you commit.

## Risks

1. \`readSelection\` tolerates a missing \`advisor\` key; a test must pin that it reads as **off**, not on.
2. The picker extraction can change \`/workflow:models\` focus order.

## Verify

- Run \`node --test test/model-profiles-editor.test.mjs\` before and after the extraction.
- Snapshot the overlay at width 60.

\`\`\`ts
const preview = readSelection(stored, []);
assert.equal(preview.selection.capabilities.advisor, false);
\`\`\`

If both pass, proceed.`;

export const short = `Sound. Ship it after \`npm run check\` passes.`;

export const fenced = `\`\`\`diff
- if (seated("child-session", "message-stream"))
+ if (seated("advisor", "message-stream"))
\`\`\`

Then re-run the card tests; the rest of the plan holds.`;

export const longModel = {
	model:
		"openrouter/anthropic/claude-opus-5-20261101-preview-extended-context-1m",
	thinking: "xhigh",
};

export const hostileModel = {
	model: "evil/\u001b[31mred\u001b[0m\nmodel\u0007",
	thinking: "high\u001b]0;title\u0007",
};

export const hostileAdvice =
	"Clear the screen: \u001b[2J\u001b[H done.\nTab\there.";

export const childQuestion = {
	id,
	state: "waiting",
	role: "worker",
	question: 2,
	model: "openai/gpt-6-luna",
	thinking: "high",
	text: "Should the advisor card depend on `child-session` seating?",
};

export const reply = {
	id,
	question: 2,
	answer: "No. It depends on the `advisor` capability.",
};

export const childResult = {
	id,
	state: "completed",
	role: "worker",
	verdict: "pass",
	model: "openai/gpt-6-luna",
	thinking: "high",
	task: "Extract the model picker",
	elapsedMs: 62_000,
	text: "Extracted; `/workflow:models` unchanged.",
};
