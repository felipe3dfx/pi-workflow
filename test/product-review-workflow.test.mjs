import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	createProductReviewWorkflow,
	isProductReviewArtifact,
} from "../extensions/product-review-workflow.ts";

const owner = {
	actorId: "owner-1",
	role: "Owner",
	authorityRevision: "owner-r1",
};
const draft = {
	scope: "Revisar la publicación del resultado de producto.",
	stories: [
		{
			id: "US-1",
			description: "Como Owner, quiero decidir el resultado.",
			acceptanceCriteria: [
				{
					id: "AC-1",
					description: "La decisión queda vinculada.",
					result: "cumple",
					evidence: ["test:product-review"],
				},
			],
		},
	],
	evidence: [
		{ ref: "test:product-review", description: "Pruebas automatizadas" },
	],
	findings: ["La implementación satisface el alcance."],
	requiredChanges: [],
	parentImpact: "Sin impacto adverso en el parent.",
	siblingImpact: [],
	recommendation: "Aceptado",
};
const issue = {
	id: "ILA-2324",
	identifier: "ILA-2324",
	title: "Product review",
	description: "Autoritativa",
	updatedAt: "issue-r1",
	state: { id: "started" },
	assignee: { id: "owner-1" },
	cycle: { id: "c1" },
	labels: ["Product"],
	estimate: 5,
	relations: { blockedBy: [], blocks: [], relatedTo: [] },
	parent: { id: "ILA-2296" },
};

function setup(options = {}) {
	let authority = structuredClone(owner);
	let artifact;
	const comments = [];
	const calls = [];
	const currentIssue = structuredClone(issue);
	const gateway = {
		getIssue: async () => {
			calls.push("getIssue");
			return structuredClone(currentIssue);
		},
		listComments: async () => {
			calls.push("listComments");
			return { comments: structuredClone(comments) };
		},
		createComment: async ({ body }) => {
			calls.push("createComment");
			const value = { id: "comment-1", body };
			comments.push(value);
			return structuredClone(value);
		},
	};
	const workflow = createProductReviewWorkflow({
		gateway,
		drafts: { read: async () => structuredClone(options.draft ?? draft) },
		artifacts: {
			read: async () => structuredClone(artifact),
			save: async (value) => {
				artifact = structuredClone(value);
				return structuredClone(value);
			},
		},
		currentOwner: async () => structuredClone(authority),
	});
	return {
		workflow,
		gateway,
		calls,
		comments,
		setAuthority: (value) => {
			authority = structuredClone(value);
		},
		mutateArtifact: (fn) => fn(artifact),
		mutateIssue: (fn) => fn(currentIssue),
		getArtifact: () => structuredClone(artifact),
	};
}

test("Owner chooses and publishes the exact accepted product-review/v1 without workflow mutation", async () => {
	const subject = setup();
	const prepared = await subject.workflow.prepare("ILA-2324");
	assert.equal(prepared.status, "prepared");
	const approved = await subject.workflow.approve({
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: prepared.choices.Aceptado.digest,
	});
	assert.equal(approved.status, "approved");
	const published = await subject.workflow.publish({ issueId: "ILA-2324" });
	assert.equal(published.status, "published");
	assert.equal(
		published.comment.body,
		await readFile(
			new URL("./fixtures/product-review.accepted.golden.md", import.meta.url),
			"utf8",
		),
	);
	assert.equal(Object.isFrozen(published.artifact), true);
	assert.equal(Object.isFrozen(published.artifact.payload.stories), true);
	assert.match(published.comment.body, /^# Revisión de producto — ILA-2324/m);
	assert.match(published.comment.body, /\*\*Resultado:\*\* Aceptado/);
	assert.match(
		published.comment.body,
		/Referencia de flujo: product-review:[a-f0-9]{64}$/m,
	);
	assert.doesNotMatch(published.comment.body, /Cambios requeridos\n/);
	assert.equal("updateIssue" in published, false);
	assert.deepEqual(
		subject.calls.filter((call) => call === "createComment"),
		["createComment"],
	);
});

test("supports rejection, binds authority and rejects caller body or stale state before mutation", async () => {
	const rejected = setup({
		draft: {
			...draft,
			recommendation: "Cambios requeridos",
			requiredChanges: ["Corregir la vinculación de la decisión antes de aceptar."],
			stories: draft.stories.map((story) => ({
				...story,
				acceptanceCriteria: story.acceptanceCriteria.map((criterion) => ({
					...criterion,
					result: "no cumple",
				})),
			})),
		},
	});
	const prepared = await rejected.workflow.prepare("ILA-2324");
	assert.equal(
		(
			await rejected.workflow.approve({
				issueId: "ILA-2324",
				result: "Cambios requeridos",
				digest: prepared.choices["Cambios requeridos"].digest,
			})
		).status,
		"approved",
	);
	assert.equal(
		(await rejected.workflow.publish({ issueId: "ILA-2324", body: "override" }))
			.blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_INPUT_INVALID",
	);
	const publication = await rejected.workflow.publish({ issueId: "ILA-2324" });
	assert.equal(publication.status, "published");
	assert.equal(
		publication.comment.body,
		await readFile(
			new URL("./fixtures/product-review.rejected.golden.md", import.meta.url),
			"utf8",
		),
	);
	assert.match(publication.comment.body, /## Cambios requeridos/);
	assert.match(publication.comment.body, /AC-1 \(no cumple\)/);

	const authority = setup();
	const candidate = await authority.workflow.prepare("ILA-2324");
	await authority.workflow.approve({
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: candidate.choices.Aceptado.digest,
	});
	authority.setAuthority({ ...owner, authorityRevision: "owner-r2" });
	assert.equal(
		(await authority.workflow.publish({ issueId: "ILA-2324" })).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH",
	);
	assert.equal(authority.calls.includes("createComment"), false);
});

test("fails closed on digest and idempotency conflicts", async () => {
	const mismatch = setup();
	const prepared = await mismatch.workflow.prepare("ILA-2324");
	assert.equal(
		(
			await mismatch.workflow.approve({
				issueId: "ILA-2324",
				result: "Aceptado",
				digest: "0".repeat(64),
			})
		).blocker.code,
		"PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH",
	);
	assert.equal(mismatch.calls.includes("createComment"), false);

	const conflict = setup();
	const candidate = await conflict.workflow.prepare("ILA-2324");
	await conflict.workflow.approve({
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: candidate.choices.Aceptado.digest,
	});
	conflict.comments.push({
		id: "conflicting-comment",
		body: `Cuerpo distinto.\n\nReferencia de flujo: product-review:${candidate.choices.Aceptado.digest}`,
	});
	const result = await conflict.workflow.publish({ issueId: "ILA-2324" });
	assert.equal(result.blocker.code, "PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT");
	assert.equal(conflict.calls.includes("createComment"), false);
});

test("revalidates the complete issue immediately before creating the comment", async () => {
	const subject = setup();
	const prepared = await subject.workflow.prepare("ILA-2324");
	await subject.workflow.approve({
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: prepared.choices.Aceptado.digest,
	});
	const listComments = subject.gateway.listComments;
	let changed = false;
	subject.gateway.listComments = async (...args) => {
		const page = await listComments(...args);
		if (!changed) {
			changed = true;
			subject.mutateIssue((value) => {
				value.description = "Cambió durante la paginación";
			});
		}
		return page;
	};
	const result = await subject.workflow.publish({ issueId: "ILA-2324" });
	assert.equal(result.blocker.code, "PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH");
	assert.equal(subject.calls.includes("createComment"), false);
});

test("validates the complete exact artifact and refuses full snapshot drift", async () => {
	const subject = setup();
	const prepared = await subject.workflow.prepare("ILA-2324");
	const approval = await subject.workflow.approve({
		issueId: "ILA-2324",
		result: "Aceptado",
		digest: prepared.choices.Aceptado.digest,
	});
	assert.equal(approval.status, "approved");
	assert.equal(Object.isFrozen(approval.artifact), true);
	const artifact = subject.getArtifact();
	assert.equal(isProductReviewArtifact(artifact, "ILA-2324"), true);
	assert.equal(
		isProductReviewArtifact({ ...artifact, unexpected: true }, "ILA-2324"),
		false,
	);
	assert.equal(
		isProductReviewArtifact(
			{ ...artifact, payload: { ...artifact.payload, unexpected: true } },
			"ILA-2324",
		),
		false,
	);
	subject.mutateIssue((value) => {
		value.relations.blockedBy.push({ id: "ILA-1" });
	});
	const result = await subject.workflow.publish({ issueId: "ILA-2324" });
	assert.equal(result.blocker.code, "PI_WORKFLOW_PRODUCT_REVIEW_REVISION_MISMATCH");
	assert.equal(subject.calls.includes("createComment"), false);
});
