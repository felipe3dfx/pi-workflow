import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	CORPUS_SHA256,
	LIMITS,
	PROMPT,
	classifyOne,
	escalation,
	hash,
	inputFor,
	loadCorpus,
	matrix,
	parseClassification,
	requestFor,
	sanitize,
} from "./classifier.mjs";
import { evaluate } from "./evaluate.mjs";

const corpusText = readFileSync(
	new URL("./cases.json", import.meta.url),
	"utf8",
);
const corpus = loadCorpus(corpusText);
const selected = { provider: "offline-double", model: "not-an-accuracy-test" };
const context = { id: corpus.cases[0].id, session: "child", jev: false };
const c = corpus.cases[0];
const textResponse = (raw, extra = {}) => ({
	...selected,
	stopReason: "stop",
	content: [{ type: "text", text: raw }],
	...extra,
});
const response = (label) =>
	textResponse(
		JSON.stringify({ label, rationale: "Scripted offline double only." }),
	);
const classify = (invoke, extra = {}) =>
	classifyOne({ c, context, invoke, ...selected, ...extra });

test("frozen pre-inference corpus has 16 balanced semantic cases and 64 matched contexts", () => {
	assert.equal(hash(corpusText), CORPUS_SHA256);
	assert.equal(matrix(corpus).length, LIMITS.calls);
	for (const label of [
		"permitted",
		"scope_expansion",
		"confirmation_required",
		"ambiguous",
	])
		assert.equal(
			corpus.cases.filter((item) => item.expected === label).length,
			4,
		);
	assert.throws(() => loadCorpus(`${corpusText}\n`), /hash mismatch/);
	for (const item of corpus.cases) {
		const contexts = matrix(corpus).filter((ctx) => ctx.id === item.id);
		assert.equal(
			new Set(contexts.map((ctx) => JSON.stringify([ctx.session, ctx.jev])))
				.size,
			4,
		);
	}
});

test("inference whitelist excludes golds and supplies no tools or executor", () => {
	const contaminated = {
		...c,
		expected: "GOLD_LABEL_SENTINEL",
		rationale: "GOLD_RATIONALE_SENTINEL",
		extra: "PRIVATE",
	};
	const request = requestFor(contaminated, context);
	assert.deepEqual(inputFor(contaminated, context), {
		assignment: c.assignment,
		proposedAction: c.action,
		session: "child",
		jevRouting: false,
	});
	assert.equal(request.systemPrompt, PROMPT);
	assert.equal(request.messages.length, 1);
	assert.equal(Object.hasOwn(request, "tools"), false);
	assert.doesNotMatch(JSON.stringify(request), /GOLD_|PRIVATE/);
});

test("strict parsing accepts only the two-key JSON schema and exact labels", () => {
	for (const label of [
		"permitted",
		"scope_expansion",
		"confirmation_required",
		"ambiguous",
	]) {
		assert.equal(
			parseClassification(
				JSON.stringify({ label, rationale: 'Quoted "reason"\nline' }),
			).label,
			label,
		);
	}
	for (const raw of [
		'{"label":"permitted","rationale":""}',
		'{"label":"PERMITTED","rationale":"x"}',
		'{"label":"permitted","rationale":"x","extra":true}',
		'{"label":"permitted","label":"ambiguous","rationale":"x"}',
		'{"rationale":"x","label":"permitted"}',
		'{"label":"permitted","rationale":null}',
		'["permitted"]',
		"null",
		'```json\n{"label":"permitted","rationale":"x"}\n```',
		'{"label":"permitted","rationale":"x"} trailing',
		" ".repeat(4097),
	])
		assert.throws(() => parseClassification(raw));
});

test("offline doubles exercise success evidence, bounded options and sanitized usage", async () => {
	const record = await classify(async (request, options) => {
		assert.equal(Object.hasOwn(request, "tools"), false);
		assert.equal(options.maxTokens, 256);
		assert.equal(options.maxRetries, 0);
		assert.ok(options.signal instanceof AbortSignal);
		return textResponse('{"label":"permitted","rationale":"sk-SECRET"}', {
			usage: { input: 5, output: 2, totalTokens: 7, credential: "DO_NOT_LOG" },
		});
	});
	assert.equal(record.status, "ok");
	assert.equal(record.rawSanitized, true);
	assert.doesNotMatch(JSON.stringify(record), /sk-SECRET|DO_NOT_LOG/);
	assert.match(record.rawHash, /^[a-f0-9]{64}$/);
	assert.deepEqual(record.usage, { input: 5, output: 2, totalTokens: 7 });
	assert.deepEqual(record.escalation, { next: "none", execute: false });
	assert.ok(record.durationMs >= 0);
	assert.equal(
		sanitize("Bearer secret ghp_abc eyJabc.def.ghi"),
		"Bearer [REDACTED] [REDACTED] [REDACTED]",
	);
});

test("offline doubles: failures escalate without fallback, secrets, or action execution", async () => {
	const scenarios = [
		[
			"request_failure",
			async () => {
				throw new Error("Bearer PRIVATE_TOKEN");
			},
		],
		["timeout", async () => new Promise(() => {})],
		["parse_failure", async () => textResponse("not json")],
		["model_mismatch", async () => textResponse("{}", { model: "fallback" })],
		[
			"stop_failure",
			async () =>
				textResponse('{"label":"permitted","rationale":"x"}', {
					stopReason: "length",
				}),
		],
		[
			"request_failure",
			async () =>
				textResponse("", {
					stopReason: "error",
					errorMessage: "Bearer PRIVATE_TOKEN",
				}),
		],
		["aborted", async () => textResponse("", { stopReason: "aborted" })],
		[
			"unexpected_content",
			async () =>
				textResponse("{}", {
					content: [
						{
							type: "toolCall",
							name: "bash",
							arguments: { command: "anything" },
						},
					],
				}),
		],
	];
	for (const [expected, invoke] of scenarios) {
		let calls = 0;
		const record = await classify(
			(...args) => {
				calls++;
				return invoke(...args);
			},
			{ timeoutMs: 5 },
		);
		assert.equal(record.status, expected);
		assert.equal(calls, 1);
		assert.equal(record.classification, null);
		assert.deepEqual(record.escalation, { next: "parent", execute: false });
		assert.doesNotMatch(JSON.stringify(record), /PRIVATE_TOKEN/);
	}
	for (const session of ["parent", "child"]) {
		const record = await classify(async () => response("ambiguous"), {
			context: { ...context, session },
		});
		assert.equal(record.status, "ok");
		assert.deepEqual(record.escalation, escalation(session, "ambiguous"));
		assert.equal(
			record.escalation.next,
			session === "child" ? "parent" : "user",
		);
	}
});

async function scriptedRecords() {
	return Promise.all(
		matrix(corpus).map((ctx) => {
			const item = corpus.cases.find((candidate) => candidate.id === ctx.id);
			return classifyOne({
				c: item,
				context: ctx,
				...selected,
				invoke: async () => response(item.expected),
			});
		}),
	);
}

test("scoring doubles verify deterministic denominator, confusion, false-permitted and consistency", async () => {
	const records = await scriptedRecords();
	const score = evaluate(corpus, records);
	assert.equal(score.total, 64);
	assert.equal(score.correct, 64);
	assert.equal(score.failures, 0);
	assert.equal(score.exploratorySuccess, true);
	assert.deepEqual(evaluate(corpus, [...records].reverse()), score);
	const wrong = structuredClone(records);
	wrong[16].classification.label = "permitted";
	wrong[16].escalation = escalation(wrong[16].session, "permitted");
	const degraded = evaluate(corpus, wrong);
	assert.equal(degraded.correct, 63);
	assert.equal(degraded.falsePermitted, 1);
	assert.equal(
		degraded.consistency.filter((item) => !item.invariant).length,
		1,
	);
	assert.equal(degraded.exploratorySuccess, false);
	const missing = evaluate(corpus, records.slice(1));
	assert.equal(missing.failures, 1);
	assert.equal(missing.failureKinds.missing, 1);
	assert.equal(missing.exactAgreement, 63 / 64);
	const failed = structuredClone(records);
	failed[0].status = "timeout";
	failed[0].classification = null;
	failed[0].escalation = escalation(failed[0].session);
	assert.equal(evaluate(corpus, failed).failureKinds.timeout, 1);
	failed[0].escalation = { next: "none", execute: true };
	assert.equal(evaluate(corpus, failed).escalationViolations, 1);
	assert.throws(() => evaluate(corpus, [...records, records[0]]), /duplicate/);
	const tampered = structuredClone(records);
	tampered[0].inputHash = "wrong";
	assert.throws(() => evaluate(corpus, tampered), /hash mismatch/);
	const mixed = structuredClone(records);
	mixed[0].model = "other";
	assert.throws(() => evaluate(corpus, mixed), /Mixed model/);
});

test("CLI is offline by default and rejects malformed live opt-in before SDK access", () => {
	const path = new URL("./run.mjs", import.meta.url).pathname;
	const manifest = JSON.parse(
		execFileSync(process.execPath, [path], { encoding: "utf8" }),
	);
	assert.equal(manifest.inferenceCalls, 0);
	assert.equal(manifest.mode, "offline-manifest");
	for (const args of [
		["--live"],
		["--provider", "x"],
		["--live", "--provider", "x", "--model", "y", "--corpus-sha256", "wrong"],
	]) {
		const result = spawnSync(process.execPath, [path, ...args], {
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no fallback/);
		assert.equal(result.stdout, "");
	}
});

const runnerProbe = `
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as classifier from "./.agents/prototypes/action-classification/classifier.mjs";
const mode = process.argv[1];
const runnerURL = new URL("./.agents/prototypes/action-classification/run.mjs", import.meta.url);
const context = vm.createContext({ console, process, setTimeout, clearTimeout, URL });
const selected = { provider: "offline-double", model: "not-an-accuracy-test" };
process.argv = [process.execPath, runnerURL.pathname, "--live", "--provider", selected.provider,
  "--model", selected.model, "--corpus-sha256", classifier.CORPUS_SHA256];
let calls = 0;
const runtime = {
  getPhysicalModel() { return selected; },
  async completeSimple() {
    calls++;
    if (mode === "timeout") {
      setInterval(() => {}, 1000);
      return new Promise(() => {});
    }
    return { ...selected, stopReason: mode, content: [], errorMessage: "Bearer PRIVATE_TOKEN" };
  },
};
const sdk = {
  getAgentDir: () => "/unused-offline-double",
  readStoredCredential: () => ({ type: "api_key", key: "offline-double" }),
  ModelRuntime: { create: async () => runtime },
  ModelRegistry: class { find() { return selected; } },
};
async function synthetic(namespace) {
  const module = new vm.SyntheticModule(Object.keys(namespace), function () {
    for (const [name, value] of Object.entries(namespace)) this.setExport(name, value);
  }, { context });
  await module.link(() => {});
  await module.evaluate();
  return module;
}
const runner = new vm.SourceTextModule(readFileSync(runnerURL, "utf8"), {
  context,
  initializeImportMeta(meta) { meta.url = runnerURL.href; },
  importModuleDynamically(specifier) {
    if (specifier !== "@earendil-works/pi-coding-agent") throw new Error("Unexpected SDK import");
    return synthetic(sdk);
  },
});
await runner.link(async (specifier) => {
  if (specifier === "./classifier.mjs") return synthetic({
    ...classifier,
    classifyOne: (args) => classifier.classifyOne({ ...args, timeoutMs: 5 }),
  });
  if (!["node:fs", "node:path"].includes(specifier)) throw new Error("Unexpected import");
  return synthetic(await import(specifier));
});
process.on("exit", () => console.error("OFFLINE_CALLS=" + calls));
await runner.evaluate();
`;

test("offline runner subprocess: SDK-shaped error/aborted stops halt after one call", () => {
	for (const [stopReason, status] of [
		["error", "request_failure"],
		["aborted", "aborted"],
	]) {
		const result = spawnSync(
			process.execPath,
			[
				"--experimental-vm-modules",
				"--input-type=module",
				"-e",
				runnerProbe,
				stopReason,
			],
			{
				encoding: "utf8",
				timeout: 3000,
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 1, result.stderr);
		const evidence = JSON.parse(result.stdout);
		assert.equal(evidence.records.length, 1);
		assert.equal(evidence.records[0].status, status);
		assert.equal(evidence.records[0].stopReason, stopReason);
		assert.deepEqual(evidence.records[0].escalation, {
			next: "user",
			execute: false,
		});
		assert.match(result.stderr, /OFFLINE_CALLS=1/);
		assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_TOKEN/);
	}
});

test("offline runner subprocess: timeout flushes evidence and exits despite abort-ignoring resources", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--experimental-vm-modules",
			"--input-type=module",
			"-e",
			runnerProbe,
			"timeout",
		],
		{
			encoding: "utf8",
			timeout: 3000,
		},
	);
	assert.equal(
		result.error,
		undefined,
		"runner must exit itself, not be killed by the test deadline",
	);
	assert.equal(result.signal, null);
	assert.equal(result.status, 1, result.stderr);
	const evidence = JSON.parse(result.stdout);
	assert.equal(evidence.records.length, 1);
	assert.equal(evidence.records[0].status, "timeout");
	assert.deepEqual(evidence.records[0].escalation, {
		next: "user",
		execute: false,
	});
	assert.match(result.stderr, /OFFLINE_CALLS=1/);
});
