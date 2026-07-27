import assert from "node:assert/strict";
import test from "node:test";

import { produceQaHandoffDraft } from "../extensions/qa-handoff-draft-producer.ts";

const description = `Descripción autoritativa.\n\n\`\`\`qa-handoff-evidence\n{"schema":"qa-handoff-evidence","schemaVersion":1,"pullRequestAttachmentId":"pr-1","buildAttachmentId":"build-1","qaEnvironmentAttachmentId":"qa-1","acceptanceCriteria":[{"id":"AC-1","description":"El cambio cumple el criterio acordado.","evidenceAttachmentIds":["test-1"]}]}\n\`\`\``;
const attachments = [
	{ id: "pr-1", title: "PR #47", url: "https://github.com/example/repo/pull/47" },
	{ id: "build-1", title: "Build 184", url: "https://github.com/example/repo/actions/runs/184" },
	{ id: "qa-1", title: "Entorno QA", url: "https://pi-workflow-qa.vercel.app" },
	{ id: "test-1", title: "Prueba integrada", url: "https://github.com/example/repo/actions/runs/185" },
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
		url: "https://github.com/example/repo/actions/runs/184",
	});
	assert.deepEqual(result.draft.qaEnvironment, {
		name: "Entorno QA",
		url: "https://pi-workflow-qa.vercel.app",
	});
	assert.deepEqual(result.draft.acceptanceCriteria[0].evidence, [{
		ref: "linear-attachment:test-1",
		label: "Prueba integrada",
		url: "https://github.com/example/repo/actions/runs/185",
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

test("accepts every supported evidence-provider contract", () => {
	for (const variant of [
		{ name: "GitLab", pr: "https://gitlab.com/group/project/-/merge_requests/47", run: "https://gitlab.com/group/project/-/pipelines/184", testRun: "https://gitlab.com/group/project/-/jobs/185", qa: "https://pi-workflow-qa.netlify.app" },
		{ name: "Bitbucket and CircleCI", pr: "https://bitbucket.org/group/project/pull-requests/47", run: "https://app.circleci.com/pipelines/github/group/project/184", testRun: "https://app.circleci.com/pipelines/github/group/project/185", qa: "https://pi-workflow-qa.onrender.com" },
		{ name: "Buildkite and Fly", pr: "https://github.com/group/project/pull/47", run: "https://buildkite.com/group/project/builds/184", testRun: "https://buildkite.com/group/project/builds/185", qa: "https://pi-workflow-qa.fly.dev" },
	]) {
		const providerAttachments = attachments.map((item) => {
			if (item.id === "pr-1") return { ...item, url: variant.pr };
			if (item.id === "build-1") return { ...item, url: variant.run };
			if (item.id === "test-1") return { ...item, url: variant.testRun };
			if (item.id === "qa-1") return { ...item, url: variant.qa };
			return item;
		});
		assert.equal(
			produceQaHandoffDraft({ description, attachments: providerAttachments }).status,
			"produced",
			variant.name,
		);
	}
});

test("rejects malformed URLs and attachments that do not verify their evidence role", () => {
	for (const variant of [
		{ name: "unsafe URL", attachments: attachments.map((item) => item.id === "build-1" ? { ...item, url: "javascript:alert(1)" } : item) },
		{ name: "deceptive build host", attachments: attachments.map((item) => item.id === "build-1" ? { ...item, url: "https://attacker.example/actions/runs/184" } : item) },
		{ name: "deceptive QA host", attachments: attachments.map((item) => item.id === "qa-1" ? { ...item, url: "https://qa.attacker.example" } : item) },
		{ name: "non-PR reference", attachments: attachments.map((item) => item.id === "pr-1" ? { ...item, url: "https://example.test/document/47" } : item) },
		{ name: "incomplete GitHub path", attachments: attachments.map((item) => item.id === "pr-1" ? { ...item, url: "https://github.com/pull/47" } : item) },
		{ name: "unrelated build", attachments: attachments.map((item) => item.id === "build-1" ? { ...item, url: "https://docs.example.test/guide/184" } : item) },
		{ name: "unrelated QA", attachments: attachments.map((item) => item.id === "qa-1" ? { ...item, url: "https://www.example.test/home" } : item) },
		{ name: "unrelated criterion", attachments: attachments.map((item) => item.id === "test-1" ? { ...item, url: "https://docs.example.test/guide/184" } : item) },
		{ name: "duplicate role", description: description.replace('"build-1"', '"pr-1"'), attachments },
	]) {
		const result = produceQaHandoffDraft({
			description: variant.description ?? description,
			attachments: variant.attachments,
		});
		assert.equal(result.status, "blocked", variant.name);
		assert.equal("draft" in result, false, variant.name);
		assert.ok(result.blocker.message.length > 0, variant.name);
		const expectedCode = /build/.test(variant.name)
			? "PI_WORKFLOW_QA_HANDOFF_BUILD_EVIDENCE_MISSING"
			: /QA/.test(variant.name)
				? "PI_WORKFLOW_QA_HANDOFF_QA_ENVIRONMENT_MISSING"
				: /criterion/.test(variant.name)
					? "PI_WORKFLOW_QA_HANDOFF_ACCEPTANCE_EVIDENCE_MISSING"
					: /PR|GitHub/.test(variant.name)
						? "PI_WORKFLOW_QA_HANDOFF_PR_EVIDENCE_MISSING"
						: "PI_WORKFLOW_QA_HANDOFF_EVIDENCE_INVALID";
		assert.equal(result.blocker.code, expectedCode, variant.name);
	}
});

test("keeps acceptance evidence separate from PR, build, and QA roles", () => {
	const primary = Object.fromEntries(attachments.map((item) => [item.id, item.url]));
	for (const variant of [
		{ name: "reused PR ID", description: description.replace('"test-1"', '"pr-1"'), attachments },
		{ name: "reused build ID", description: description.replace('"test-1"', '"build-1"'), attachments },
		{ name: "reused QA ID", description: description.replace('"test-1"', '"qa-1"'), attachments },
		{ name: "reused PR URL", description, attachments: attachments.map((item) => item.id === "test-1" ? { ...item, url: primary["pr-1"] } : item) },
		{ name: "reused build URL", description, attachments: attachments.map((item) => item.id === "test-1" ? { ...item, url: primary["build-1"] } : item) },
		{ name: "equivalent build URL", description, attachments: attachments.map((item) => item.id === "test-1" ? { ...item, url: `${primary["build-1"]}/?view=tests#result` } : item) },
		{ name: "GitHub repository case alias", description, attachments: attachments.map((item) => item.id === "test-1" ? { ...item, url: "https://github.com/EXAMPLE/REPO/actions/runs/184" } : item) },
		{ name: "reused QA URL", description, attachments: attachments.map((item) => item.id === "test-1" ? { ...item, url: primary["qa-1"] } : item) },
	]) {
		const result = produceQaHandoffDraft({
			description: variant.description,
			attachments: variant.attachments,
		});
		assert.equal(result.status, "blocked", variant.name);
		assert.equal(result.blocker.code, "PI_WORKFLOW_QA_HANDOFF_ACCEPTANCE_EVIDENCE_MISSING", variant.name);
		assert.match(result.blocker.message, /distinct from PR, build, and QA environment evidence/, variant.name);
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
