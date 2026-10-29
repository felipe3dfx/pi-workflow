import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(
	new URL("../tools/contextual-authorization-evaluation.mjs", import.meta.url),
);
const original = fileURLToPath(
	new URL(
		"../tools/contextual-authorization-evaluation/cases.json",
		import.meta.url,
	),
);
const run = (...args) =>
	spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
function fixture(fn) {
	const dir = mkdtempSync(join(tmpdir(), "auth-eval-"));
	try {
		const corpus = JSON.parse(readFileSync(original));
		corpus.cases = [
			corpus.cases[0],
			corpus.cases[4],
			corpus.cases[6],
			corpus.cases[12],
		];
		const path = join(dir, "corpus.json");
		writeFileSync(path, JSON.stringify(corpus));
		const digest = createHash("sha256")
			.update(readFileSync(path))
			.digest("hex");
		const sample = (c, outcome, failure = null) => ({
			caseId: c.id,
			model: "example",
			context: "full",
			startedAt: "2025-01-01T00:00:00.000Z",
			finishedAt: "2025-01-01T00:00:01.000Z",
			outcome,
			failure,
		});
		const artifact = {
			version: 1,
			corpusSha256: digest,
			provenance: {
				kind: "scripted",
				description: "Synthetic fixture; no inference",
			},
			startedAt: "2025-01-01T00:00:00.000Z",
			finishedAt: "2025-01-01T00:00:10.000Z",
			cells: [{ model: "example", context: "full" }],
			samples: [
				sample(corpus.cases[0], "held"),
				sample(corpus.cases[1], "allow"),
				sample(corpus.cases[2], "held"),
				sample(corpus.cases[3], null, "timeout"),
			],
		};
		fn({ dir, path, corpus, artifact });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
function report(dir, path, artifact) {
	const file = join(dir, "run.json");
	writeFileSync(file, JSON.stringify(artifact));
	return run("report", path, file);
}
test("default command exposes the proposed corpus without inference or adoption", () => {
	const result = run();
	assert.equal(result.status, 0, result.stderr);
	const manifest = JSON.parse(result.stdout);
	assert.equal(manifest.caseCount, 32);
	assert.equal(manifest.reviewStatus, "not adjudicated");
	assert.equal(manifest.adoption, false);
});
test("report accepts only a source and corpus bound local adjudication without implying adoption", () =>
	fixture(({ dir }) => {
		const binding = JSON.parse(
			readFileSync(
				new URL(
					"../tools/contextual-authorization-evaluation/adjudication.json",
					import.meta.url,
				),
			),
		);
		const artifact = {
			version: 1,
			corpusSha256: binding.corpusSha256,
			provenance: { kind: "scripted", description: "No inference" },
			startedAt: "2025-01-01T00:00:00.000Z",
			finishedAt: "2025-01-01T00:00:00.000Z",
			cells: [{ model: "example", context: "full" }],
			samples: [],
		};
		const runFile = join(dir, "run.json");
		const bindingFile = join(dir, "binding.json");
		writeFileSync(runFile, JSON.stringify(artifact));
		writeFileSync(bindingFile, JSON.stringify(binding));
		const result = run("report", original, runFile, bindingFile);
		assert.match(result.stdout, /"reviewStatus": "adjudicated"/);
		const output = JSON.parse(result.stdout);
		assert.equal(output.reviewStatus, "adjudicated");
		assert.equal(output.adoption, false);
		assert.equal(output.complete, false);
		for (const mutate of [
			(b) => {
				b.corpusSha256 = "0".repeat(64);
			},
			(b) => {
				b.runtimeSourceSha256 = "0".repeat(64);
			},
			(b) => {
				b.caseCount++;
			},
			(b) => {
				b.labels.allow++;
			},
			(b) => {
				b.verdict = "fail";
			},
		]) {
			const copy = structuredClone(binding);
			mutate(copy);
			writeFileSync(bindingFile, JSON.stringify(copy));
			const invalid = run("report", original, runFile, bindingFile);
			assert.notEqual(invalid.status, 0);
			assert.equal(invalid.stdout, "");
		}
	}));
test("manifest rejects invalid identities and leaked gold", () =>
	fixture(({ path, corpus }) => {
		corpus.cases[1].id = corpus.cases[0].id;
		writeFileSync(path, JSON.stringify(corpus));
		assert.notEqual(run("manifest", path).status, 0);
		corpus.cases[1].id = "other";
		corpus.cases[0].modelInput.expected = "allow";
		writeFileSync(path, JSON.stringify(corpus));
		assert.notEqual(run("manifest", path).status, 0);
	}));
test("corpus rejects unknown metadata while permitting arbitrary tool input", () =>
	fixture(({ path, corpus }) => {
		const mutations = [
			(c) => {
				c.extra = true;
			},
			(c) => {
				c.cases[0].extra = true;
			},
			(c) => {
				c.cases[0].modelInput.extra = true;
			},
			(c) => {
				c.cases[0].modelInput.authority.extra = true;
			},
			(c) => {
				c.cases[0].modelInput.action.extra = true;
			},
			(c) => {
				c.cases[0].modelInput.context.extra = true;
			},
		];
		for (const mutate of mutations) {
			const copy = structuredClone(corpus);
			mutate(copy);
			writeFileSync(path, JSON.stringify(copy));
			assert.notEqual(run("manifest", path).status, 0);
		}
		corpus.cases[0].modelInput.action.input.expected = {
			category: "ordinary tool data",
			references: ["not gold"],
		};
		writeFileSync(path, JSON.stringify(corpus));
		assert.equal(run("manifest", path).status, 0);
	}));
test("scripted report separates outcomes, failures, populations and elapsed time", () =>
	fixture(({ dir, path, artifact }) => {
		const result = report(dir, path, artifact);
		assert.equal(result.status, 0, result.stderr);
		const output = JSON.parse(result.stdout);
		assert.equal(output.adoption, false);
		assert.equal(output.reviewStatus, "not adjudicated");
		assert.equal(output.provenance.kind, "scripted");
		assert.equal(output.failures[0].failure, "timeout");
		assert.equal(output.cells[0].groups.adversarial.failed, 1);
		const representative = output.groups.representative;
		assert.deepEqual(
			[
				representative.expectedAllow,
				representative.expectedNonAllow,
				representative.observedExpectedAllow,
				representative.observedExpectedNonAllow,
				representative.observedAllow,
				representative.observedNonAllow,
			],
			[1, 2, 1, 2, 1, 2],
		);
		assert.deepEqual(
			[
				representative.falsePermits,
				representative.unnecessaryConsultations,
				representative.explicitDenyMisclassifications,
			],
			[1, 1, 1],
		);
		assert.equal(representative.falsePermitRate, 0.5);
		assert.equal(representative.unnecessaryConsultationRate, 1);
		assert.equal(output.groups.adversarial.falsePermitRate, null);
		assert.equal(output.groups.adversarial.failed, 1);
		assert.deepEqual(
			output.samples.map((s) => [s.expected, s.outcome, s.classifications]),
			[
				["allow", "held", ["unnecessary consultation"]],
				["held", "allow", ["false permit"]],
				["deny", "held", ["explicit deny misclassification"]],
				["deny", null, ["failure"]],
			],
		);
		assert.equal(
			output.completeMeaning,
			"Matrix completeness only; not quality or acceptance.",
		);
		assert.equal(output.cells[0].timing.successful.count, 3);
		assert.equal(output.cells[0].timing.failed.count, 1);
		assert.equal(output.cells[0].timing.successful.p95Ms, 1000);
		assert.equal(output.timing.wallMs, 10000);
		assert.equal(output.timing.sequentialSampleSumMs, 4000);
		assert.equal(output.timing.p95Ms, 1000);
	}));
test("cell rates use observed expected populations and timing separates failure latency", () =>
	fixture(({ dir, path, artifact }) => {
		artifact.cells.push({ model: "second", context: "full" });
		for (const sample of [...artifact.samples]) {
			artifact.samples.push({
				...sample,
				model: "second",
				finishedAt: "2025-01-01T00:00:02.000Z",
				outcome: sample.failure
					? null
					: sample.caseId === artifact.samples[0].caseId
						? "allow"
						: sample.outcome,
				failure: sample.failure,
			});
		}
		artifact.samples[3].finishedAt = "2025-01-01T00:00:03.000Z";
		const result = report(dir, path, artifact);
		assert.equal(result.status, 0, result.stderr);
		const output = JSON.parse(result.stdout);
		assert.deepEqual(output.samples[4].classifications, []);
		assert.equal(
			output.cells[0].groups.representative.unnecessaryConsultationRate,
			1,
		);
		assert.equal(
			output.cells[1].groups.representative.unnecessaryConsultationRate,
			0,
		);
		assert.equal(output.cells[0].timing.successful.p95Ms, 1000);
		assert.equal(output.cells[0].timing.failed.p95Ms, 3000);
		assert.equal(output.cells[1].timing.successful.p95Ms, 2000);
		assert.equal(
			output.cells[1].groups.adversarial.observedExpectedNonAllow,
			0,
		);
		assert.equal(output.cells[1].groups.adversarial.falsePermitRate, null);
	}));
test("missing samples remain visible and cannot pass", () =>
	fixture(({ dir, path, artifact }) => {
		artifact.samples.pop();
		const result = report(dir, path, artifact);
		assert.notEqual(result.status, 0);
		const output = JSON.parse(result.stdout);
		assert.equal(output.groups.adversarial.missing, 1);
		assert.equal(output.missing.length, 1);
		assert.equal(output.adoption, false);
	}));
test("empty and aborted cells keep null rates and separate elapsed samples", () =>
	fixture(({ dir, path, artifact }) => {
		artifact.cells.push({ model: "empty", context: "full" });
		artifact.samples = [
			{ ...artifact.samples[0], outcome: null, failure: "aborted" },
		];
		const result = report(dir, path, artifact);
		assert.notEqual(result.status, 0);
		const output = JSON.parse(result.stdout);
		assert.equal(output.complete, false);
		assert.equal(output.adoption, false);
		assert.equal(output.missing.length, 7);
		assert.equal(output.samples[0].failure, "aborted");
		assert.equal(output.cells[0].timing.failed.count, 1);
		assert.equal(output.cells[0].timing.successful.p95Ms, null);
		assert.equal(output.cells[1].timing.failed.p95Ms, null);
		assert.equal(output.cells[1].groups.representative.falsePermitRate, null);
		assert.equal(
			output.cells[0].groups.representative.unnecessaryConsultationRate,
			null,
		);
	}));
test("report rejects duplicated, mismatched, ambiguous or untruthful inputs", () =>
	fixture(({ dir, path, artifact }) => {
		for (const mutate of [
			(a) => a.samples.push(a.samples[0]),
			(a) => a.cells.push(a.cells[0]),
			(a) => {
				delete a.samples[0].outcome;
			},
			(a) => {
				a.cells[0] = { model: "example" };
			},
			(a) => {
				a.samples[0].finishedAt = "2025-01-01T00:00:11.000Z";
			},
			(a) => {
				a.finishedAt = "2024-01-01T00:00:00.000Z";
			},
			(a) => {
				a.corpusSha256 = "0".repeat(64);
			},
			(a) => {
				a.samples[0].finishedAt = "2024-01-01T00:00:00.000Z";
			},
			(a) => {
				a.provenance.kind = "unknown";
			},
			(a) => {
				a.samples[0].failure = "timeout";
			},
			(a) => {
				a.samples[0].caseId = "unknown";
			},
		]) {
			const copy = structuredClone(artifact);
			mutate(copy);
			assert.notEqual(report(dir, path, copy).status, 0);
		}
	}));
