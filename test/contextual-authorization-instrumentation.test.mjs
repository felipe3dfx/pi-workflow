import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { corpusAt } from "../tools/contextual-authorization-evaluation.mjs";
import { runComparison } from "../tools/contextual-authorization-evaluation/compare.mjs";

async function withFixture(run) {
	const corpusPath = new URL(
		"../tools/contextual-authorization-evaluation/cases.json",
		import.meta.url,
	).pathname;
	const corpus = corpusAt(corpusPath);
	const review = JSON.parse(
		readFileSync(
			new URL(
				"../tools/contextual-authorization-evaluation/adjudication.json",
				import.meta.url,
			),
		),
	);
	// Mechanism fixture only; this is not independent adjudication.
	review.runtimeSourceSha256 = createHash("sha256")
		.update(
			readFileSync(
				new URL("../extensions/action-authorization.ts", import.meta.url),
			),
		)
		.digest("hex");
	const dir = mkdtempSync(join(tmpdir(), "instrumentation-"));
	try {
		const reviewPath = join(dir, "review.json");
		writeFileSync(reviewPath, JSON.stringify(review));
		const plan = {
			version: 1,
			corpusPath,
			reviewPath,
			corpusSha256: corpus.digest,
			cells: [
				{ model: "openai/gpt-6.1-sol", context: "full", thinking: "high" },
			],
			maxCalls: 1,
			requestTimeoutMs: 500,
			deadlineMs: 2000,
			maxOutputBytes: 2000000,
		};
		await run({ corpus, review, plan });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const known = {
	scope: "within",
	effects: "ordinary",
	ownership: "assigned",
	restriction: "none",
	confirmed: false,
	commit: false,
	reason: "known",
};
function checkEvidence(result, input) {
	assert.equal(
		result.details.samples[0].tool,
		input.corpus.cases[0].modelInput.action.tool,
	);
	assert.ok(
		Number.isFinite(result.details.samples[0].elapsedMs) &&
			result.details.samples[0].elapsedMs >= 0,
	);
}

test("successful classifier records tool and invocation duration", async () =>
	withFixture(async (input) => {
		const result = await runComparison(input, async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
			return known;
		});
		assert.equal(result.run.samples[0].outcome, "allow");
		checkEvidence(result, input);
		assert.ok(result.details.samples[0].elapsedMs >= 20);
	}));

test("failed, malformed, and timed-out invocations retain evidence", async () =>
	withFixture(async (input) => {
		for (const [complete, failure] of [
			[
				async () => {
					throw new Error("provider");
				},
				"provider-error",
			],
			[async () => ({}), "malformed-response"],
			[async () => new Promise(() => {}), "timeout"],
		]) {
			const result = await runComparison(
				{ ...input, plan: { ...input.plan, requestTimeoutMs: 20 } },
				complete,
			);
			assert.equal(result.run.samples[0].failure, failure);
			checkEvidence(result, input);
		}
	}));

test("abort and evidence overflow retain invocation evidence; pre-abort fabricates none", async () =>
	withFixture(async (input) => {
		const controller = new AbortController();
		const aborted = await runComparison(
			input,
			async () => {
				controller.abort();
				return new Promise(() => {});
			},
			{ signal: controller.signal },
		);
		assert.equal(aborted.run.samples[0].failure, "aborted");
		checkEvidence(aborted, input);
		const pre = await runComparison(input, async () => known, {
			signal: controller.signal,
		});
		assert.equal(pre.details.calls, 0);
		assert.deepEqual(pre.details.samples, []);
		const overflow = await runComparison(
			{ ...input, plan: { ...input.plan, maxOutputBytes: 10000 } },
			async () => ({ ...known, reason: "x".repeat(12000) }),
		);
		assert.equal(overflow.run.samples[0].failure, "evidence-limit");
		checkEvidence(overflow, input);
	}));
