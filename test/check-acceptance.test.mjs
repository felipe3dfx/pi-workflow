import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
	createAcceptanceEvidence,
	validateAcceptanceEvidence,
} from "../scripts/acceptance-evidence.mjs";

const execFileAsync = promisify(execFile);
const command = resolve("scripts/check-acceptance.mjs");

async function tarballWithRunner(source) {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-acceptance-test-"));
	const packed = join(root, "packed");
	const extracted = join(root, "extracted");
	await mkdir(packed);
	await mkdir(extracted);
	const { stdout } = await execFileAsync(
		"npm",
		["pack", "--json", "--ignore-scripts", "--pack-destination", packed],
		{ cwd: resolve(".") },
	);
	const [{ filename }] = JSON.parse(stdout);
	await execFileAsync("tar", ["-xzf", join(packed, filename), "-C", extracted]);
	await writeFile(
		join(extracted, "package", "scripts", "run-packed-acceptance.mjs"),
		source,
	);
	const tarball = join(root, "altered.tgz");
	await execFileAsync("tar", ["-czf", tarball, "-C", extracted, "package"]);
	return { root, tarball };
}

test("public acceptance command packs once and validates the extracted release candidate", {
	timeout: 120_000,
}, async () => {
	const { stdout } = await execFileAsync(process.execPath, [command], {
		cwd: resolve("."),
		timeout: 120_000,
	});
	const report = JSON.parse(stdout);
	assert.equal(report.schema, "pi-workflow-acceptance-evidence");
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.tarball.algorithm, "sha256");
	assert.match(report.tarball.digest, /^[a-f0-9]{64}$/);
	assert.equal(report.result, "passed");
	assert.equal(report.tarball.origin, "created");
	assert.deepEqual(Object.keys(report.scenarios).sort(), [
		"define-product",
		"deliver-ticket",
		"doctor",
		"least-privilege-profiles",
		"packed-skills",
		"product-review",
		"qa-handoff",
		"status",
		"sync",
	]);
	assert.equal(
		Object.values(report.scenarios).every(
			(scenario) =>
				(scenario.status === "passed" ||
					scenario.status === "intentional-refusal") &&
				Array.isArray(scenario.assertions) &&
				scenario.assertions.length > 0 &&
				scenario.assertions.every(
					(assertion) =>
						typeof assertion === "string" && assertion.trim().length > 0,
				),
		),
		true,
	);
	assert.deepEqual(report.scenarios["define-product"].assertions, [
		"owner-approval-bound-to-exact-spec",
		"approval-mismatch-refused-before-persistence",
		"engram-create-only-cas-and-readback",
		"public-extension-input-and-tool-dispatch",
	]);
	assert.deepEqual(report.scenarios["qa-handoff"].assertions, [
		"spanish-golden-published",
		"linear-comment-readback-without-issue-mutation",
		"exact-repeat-idempotent",
		"caller-fields-and-stale-authority-refused",
		"public-extension-input-and-tool-dispatch",
	]);
	assert.deepEqual(report.scenarios["product-review"].assertions, [
		"owner-choice-bound-to-spanish-golden",
		"linear-comment-readback-without-issue-mutation",
		"exact-repeat-idempotent",
		"digest-and-stale-authority-refused",
		"public-extension-selection-and-tool-dispatch",
	]);
	assert.deepEqual(report.scenarios.sync.assertions, [
		"conditional-writes-use-approved-predecessors",
		"settled-plan-is-idempotent",
		"verified-rollback-and-resume-recovery",
		"unmanaged-collision-refused-without-mutation",
		"public-cli-handler-dispatch",
	]);
	assert.deepEqual(report.scenarios.status.assertions, [
		"read-only-checks-only",
		"summary-excludes-evidence",
		"registered-command-handler-dispatch",
	]);
	assert.deepEqual(report.scenarios.doctor.assertions, [
		"read-only-checks-only",
		"secret-evidence-redacted",
		"registered-command-handler-dispatch",
	]);
	assert.deepEqual(report.scenarios["least-privilege-profiles"].assertions, [
		"exact-model-registry-queries",
		"research-prototype-and-ticket-profiles-minimized",
		"forbidden-capability-and-model-drift-refused",
	]);
	assert.deepEqual(report.scenarios["packed-skills"].assertions, [
		"four-public-skills-loaded",
		"canonical-spanish-goldens-loaded",
	]);
	assert.deepEqual(report.scenarios["deliver-ticket"], {
		status: "intentional-refusal",
		code: "PI_WORKFLOW_CAPABILITY_PENDING",
		assertions: [
			"pending-refusal-exact",
			"tools-blocked",
			"public-extension-pending-tool-block",
		],
	});
	assert.deepEqual(report.safety, {
		liveSystems: "none",
		publication: "not-attempted",
		filesystem: "temp-fixtures-only",
		importedModuleRoot: "extracted-package",
	});
	assert.match(report.digest, /^[a-f0-9]{64}$/);
});

test("acceptance evidence rejects empty and blank scenario assertions", () => {
	const scenarios = Object.fromEntries(
		[
			"packed-skills",
			"define-product",
			"deliver-ticket",
			"qa-handoff",
			"product-review",
			"sync",
			"status",
			"doctor",
			"least-privilege-profiles",
		].map((name) => [
			name,
			name === "deliver-ticket"
				? {
						status: "intentional-refusal",
						code: "PI_WORKFLOW_CAPABILITY_PENDING",
						assertions: ["verified"],
					}
				: { status: "passed", assertions: ["verified"] },
		]),
	);
	const input = {
		tarball: { algorithm: "sha256", digest: "a".repeat(64), origin: "created" },
		scenarios,
		safety: {
			liveSystems: "none",
			publication: "not-attempted",
			filesystem: "temp-fixtures-only",
			importedModuleRoot: "extracted-package",
		},
	};
	for (const assertions of [[], ["   "]]) {
		const report = createAcceptanceEvidence({
			...input,
			scenarios: {
				...scenarios,
				"define-product": { status: "passed", assertions },
			},
		});
		assert.throws(
			() =>
				validateAcceptanceEvidence(report, {
					digest: input.tarball.digest,
					origin: input.tarball.origin,
				}),
			/acceptance evidence scenarios are incomplete or invalid/,
		);
	}
});

test("public acceptance command rejects a tarball before scenario execution", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-workflow-invalid-tarball-"));
	const tarball = join(root, "invalid.tgz");
	await writeFile(tarball, "not a tarball");
	try {
		await assert.rejects(
			execFileAsync(process.execPath, [command, "--tarball", tarball], {
				cwd: resolve("."),
				timeout: 120_000,
			}),
			(error) => {
				assert.match(error.stderr, /packed distribution validation failed|tar:/i);
				return true;
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("public acceptance command fails closed on incomplete packed evidence", {
	timeout: 120_000,
}, async () => {
	const fixture = await tarballWithRunner(
		'process.stdout.write(JSON.stringify({schema:"pi-workflow-acceptance-evidence",schemaVersion:1,result:"passed"})+"\\n");\n',
	);
	try {
		await assert.rejects(
			execFileAsync(process.execPath, [command, "--tarball", fixture.tarball], {
				cwd: resolve("."),
				timeout: 120_000,
			}),
			(error) => {
				assert.match(
					error.stderr,
					/acceptance evidence report has unexpected or missing keys/,
				);
				return true;
			},
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});
