import assert from "node:assert/strict";
import test from "node:test";

import { produceQaHandoffDraft } from "../extensions/qa-handoff-draft-producer.ts";

const description = `Descripción autoritativa.\n\n\`\`\`qa-handoff-evidence\n{"schema":"qa-handoff-evidence","schemaVersion":1,"pullRequestAttachmentId":"pr-1","buildAttachmentId":"build-1","qaEnvironmentAttachmentId":"qa-1","acceptanceCriteria":[{"id":"AC-1","description":"El cambio cumple el criterio acordado.","evidenceAttachmentIds":["test-1"]}]}\n\`\`\``;
const attachments = [
	{ id: "pr-1", title: "PR #47", url: "https://github.com/example/repo/pull/47" },
	{ id: "build-1", title: "Build 184", url: "https://ci.example.test/build/184" },
	{ id: "qa-1", title: "Entorno QA", url: "https://qa.example.test" },
	{ id: "test-1", title: "Prueba integrada", url: "https://ci.example.test/test/184" },
];

test("derives a closed Spanish QA draft only from referenced Linear evidence", () => {
	const result = produceQaHandoffDraft({ description, attachments });

	assert.equal(result.status, "produced");
	assert.deepEqual(result.draft.pullRequest, {
		ref: "linear-attachment:pr-1",
		label: "PR #47",
		url: "https://github.com/example/repo/pull/47",
	});
	assert.deepEqual(result.draft.build, {
		ref: "linear-attachment:build-1",
		label: "Build 184",
		url: "https://ci.example.test/build/184",
	});
	assert.deepEqual(result.draft.qaEnvironment, {
		name: "Entorno QA",
		url: "https://qa.example.test",
	});
	assert.deepEqual(result.draft.acceptanceCriteria[0].evidence, [{
		ref: "linear-attachment:test-1",
		label: "Prueba integrada",
		url: "https://ci.example.test/test/184",
	}]);
	assert.equal(result.draft.outcome.summary, "La entrega cuenta con evidencia verificable para 1 criterio de aceptación.");
});

test("returns a specific blocker without a partial draft for each missing evidence category", () => {
	for (const variant of [
		{ name: "PR", description: description.replace('"pr-1"', '"missing"'), code: "PI_WORKFLOW_QA_HANDOFF_PR_EVIDENCE_MISSING" },
		{ name: "build", description: description.replace('"build-1"', '"missing"'), code: "PI_WORKFLOW_QA_HANDOFF_BUILD_EVIDENCE_MISSING" },
		{ name: "environment", description: description.replace('"qa-1"', '"missing"'), code: "PI_WORKFLOW_QA_HANDOFF_QA_ENVIRONMENT_MISSING" },
		{ name: "criterion", description: description.replace('"test-1"', '"missing"'), code: "PI_WORKFLOW_QA_HANDOFF_ACCEPTANCE_EVIDENCE_MISSING" },
	]) {
		const result = produceQaHandoffDraft({ description: variant.description, attachments });
		assert.equal(result.status, "blocked", variant.name);
		assert.equal(result.blocker.code, variant.code, variant.name);
		assert.equal("draft" in result, false, variant.name);
	}
});

test("rejects free-form, duplicate, unknown, or noncanonical producer authority", () => {
	for (const candidate of [
		"Sin bloque estructurado.",
		description.replace('"schemaVersion":1', '"schemaVersion":1,"summary":"Elegida por el modelo"'),
		description.replace('"AC-1"', '" AC-1"'),
		description.replace('"test-1"]', '"test-1","test-1"]'),
	]) {
		const result = produceQaHandoffDraft({ description: candidate, attachments });
		assert.equal(result.status, "blocked");
	}
});
