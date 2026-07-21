import { createHash } from "node:crypto";

const acceptanceScenarioNames = [
	"packed-skills",
	"define-product",
	"deliver-ticket",
	"qa-handoff",
	"product-review",
	"sync",
	"status",
	"doctor",
	"least-privilege-profiles",
];

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
	return (
		isRecord(value) &&
		Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
	);
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function digestEvidence(value) {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function validateAcceptanceEvidence(report, binding) {
	if (
		!hasExactKeys(report, [
			"schema",
			"schemaVersion",
			"tarball",
			"result",
			"scenarios",
			"safety",
			"digest",
		])
	) {
		throw new Error(
			"acceptance evidence report has unexpected or missing keys",
		);
	}
	if (
		report.schema !== "pi-workflow-acceptance-evidence" ||
		report.schemaVersion !== 1 ||
		report.result !== "passed"
	) {
		throw new Error("acceptance evidence report identity is invalid");
	}
	if (
		!hasExactKeys(report.tarball, ["algorithm", "digest", "origin"]) ||
		report.tarball.algorithm !== "sha256" ||
		report.tarball.digest !== binding.digest ||
		report.tarball.origin !== binding.origin
	) {
		throw new Error(
			"acceptance evidence report is not bound to the exact tarball",
		);
	}
	if (
		!hasExactKeys(report.scenarios, acceptanceScenarioNames) ||
		!acceptanceScenarioNames.every((name) => {
			const scenario = report.scenarios[name];
			const expectedKeys =
				name === "deliver-ticket"
					? ["status", "code", "assertions"]
					: ["status", "assertions"];
			return (
				hasExactKeys(scenario, expectedKeys) &&
				Array.isArray(scenario.assertions) &&
				scenario.assertions.length > 0 &&
				scenario.assertions.every(
					(assertion) =>
						typeof assertion === "string" && assertion.trim().length > 0,
				) &&
				(name === "deliver-ticket"
					? scenario.status === "intentional-refusal" &&
						scenario.code === "PI_WORKFLOW_CAPABILITY_PENDING"
					: scenario.status === "passed")
			);
		})
	) {
		throw new Error("acceptance evidence scenarios are incomplete or invalid");
	}
	if (
		!hasExactKeys(report.safety, [
			"liveSystems",
			"publication",
			"filesystem",
			"importedModuleRoot",
		]) ||
		report.safety.liveSystems !== "none" ||
		report.safety.publication !== "not-attempted" ||
		report.safety.filesystem !== "temp-fixtures-only" ||
		report.safety.importedModuleRoot !== "extracted-package"
	) {
		throw new Error("acceptance evidence safety boundary is incomplete");
	}
	const { digest, ...unsigned } = report;
	if (!/^[a-f0-9]{64}$/.test(digest) || digest !== digestEvidence(unsigned)) {
		throw new Error("acceptance evidence digest is invalid");
	}
	return report;
}

export function createAcceptanceEvidence(input) {
	const unsigned = {
		schema: "pi-workflow-acceptance-evidence",
		schemaVersion: 1,
		tarball: input.tarball,
		result: "passed",
		scenarios: input.scenarios,
		safety: input.safety,
	};
	return { ...unsigned, digest: digestEvidence(unsigned) };
}
