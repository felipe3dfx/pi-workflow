import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createQaHandoffWorkflow } from "../extensions/qa-handoff-workflow.ts";

const developer = {
	actorId: "developer-7",
	role: "Developer",
	authorityRevision: "developer-auth-r3",
};

const draft = {
	outcome: {
		status: "ready-for-qa",
		summary:
			"La publicación de QA handoff queda disponible con validación determinista.",
	},
	pullRequest: {
		ref: "pr:42",
		label: "PR #42",
		url: "https://github.com/example/pi-workflow/pull/42",
	},
	build: {
		ref: "build:qa-184",
		label: "Build qa-184",
		url: "https://ci.example.test/builds/qa-184",
	},
	qaEnvironment: {
		name: "QA",
		url: "https://qa.example.test",
		revision: "release-2026.07.21",
	},
	acceptanceCriteria: [
		{
			id: "AC-1",
			description: "Publica un comentario localizado sin modificar el issue.",
			evidence: [
				{
					ref: "test:qa-handoff:happy-path",
					label: "Prueba de publicación",
					url: "https://ci.example.test/tests/qa-handoff",
				},
			],
		},
		{
			id: "AC-2",
			description: "La repetición del mismo handoff es idempotente.",
			evidence: [
				{
					ref: "test:qa-handoff:idempotency",
					label: "Prueba de idempotencia",
				},
			],
		},
	],
	testGuidance: [
		"Verificar el comentario completo contra los criterios de aceptación.",
		"Repetir la invocación y confirmar que no se crea otro comentario.",
	],
	risksAndConstraints: [
		"El cambio de estado y la asignación a QA permanecen como acciones manuales.",
	],
	outOfScope: ["Promoción automática entre entornos."],
};

const issue = {
	id: "ILA-2321",
	identifier: "ILA-2321",
	title: "Publicar QA handoff determinista",
	description: "Descripción autoritativa",
	updatedAt: "issue-r7",
	state: { id: "state-1", name: "In Code Review", type: "started" },
	assignee: { id: "developer-7", name: "Developer" },
	cycle: { id: "cycle-5", number: 5 },
	labels: [{ id: "label-1", name: "Assign To / Developer" }],
	estimate: 5,
	relations: {
		blockedBy: [{ id: "ILA-2300" }],
		blocks: [{ id: "ILA-2400" }],
		relatedTo: [{ id: "ILA-2200" }],
	},
	parent: { id: "ILA-2296" },
};

function artifactMemory() {
	const artifacts = new Map();
	return {
		artifacts,
		async read(issueId) {
			return structuredClone(artifacts.get(issueId));
		},
		async save(artifact) {
			if (artifacts.has(artifact.payload.issue.id))
				throw new Error("artifact conflict");
			artifacts.set(artifact.payload.issue.id, structuredClone(artifact));
			return structuredClone(artifact);
		},
	};
}

function linearFake() {
	const issues = new Map([[issue.id, structuredClone(issue)]]);
	const comments = new Map();
	const calls = [];
	return {
		issues,
		comments,
		calls,
		gateway: {
			async getIssue({ id }) {
				calls.push({ op: "getIssue", id });
				return structuredClone(issues.get(id));
			},
			async listComments({ issueId, cursor }) {
				calls.push({ op: "listComments", issueId, cursor });
				return {
					comments: structuredClone(comments.get(issueId) ?? []),
					nextCursor: undefined,
				};
			},
			async createComment(input) {
				assert.deepEqual(Object.keys(input).sort(), ["body", "issueId"]);
				calls.push({ op: "createComment", ...input });
				const created = { id: "opaque-comment-id", body: input.body };
				comments.set(input.issueId, [created]);
				return structuredClone(created);
			},
		},
	};
}

function subject(options = {}) {
	const linear = options.linear ?? linearFake();
	const artifacts = options.artifacts ?? artifactMemory();
	let currentDeveloper = structuredClone(options.developer ?? developer);
	const workflow = createQaHandoffWorkflow({
		gateway: linear.gateway,
		artifacts,
		drafts: {
			read: async (issueId) =>
				issueId === issue.id
					? structuredClone(options.draft ?? draft)
					: undefined,
		},
		currentDeveloper: async () => structuredClone(currentDeveloper),
	});
	return {
		workflow,
		linear,
		artifacts,
		setDeveloper(value) {
			currentDeveloper = structuredClone(value);
		},
	};
}

test("publishes the exact authorized Spanish qa-handoff/v1 body for one issue revision", async () => {
	const expectedBody = await readFile(
		new URL("./fixtures/qa-handoff.full.golden.md", import.meta.url),
		"utf8",
	);
	const { workflow, linear } = subject();
	const before = structuredClone(linear.issues.get(issue.id));

	const authorization = await workflow.authorizeInvocation(issue.id);
	const result = await workflow.publish({ issueId: issue.id });

	assert.equal(authorization.status, "authorized");
	assert.equal(result.status, "published");
	assert.equal(result.artifact.schema, "qa-handoff");
	assert.equal(result.artifact.schemaVersion, 1);
	assert.equal(result.artifact.language, "es");
	assert.deepEqual(result.artifact.payload.issue, {
		id: "ILA-2321",
		revision: "issue-r7",
	});
	assert.equal(result.artifact.digest, "1f40d7d7b50776fe28ddd07c9f4f29d20d299939eb8dee92d892fe4fd73f8a20");
	assert.equal(result.artifact.body, expectedBody);
	assert.deepEqual(linear.comments.get(issue.id), [
		{ id: "opaque-comment-id", body: expectedBody },
	]);
	assert.deepEqual(linear.issues.get(issue.id), before);
	assert.equal("updateIssue" in linear.gateway, false);
});

test("returns a deeply immutable authorized artifact", async () => {
	const { workflow } = subject();

	const authorization = await workflow.authorizeInvocation(issue.id);

	assert.equal(authorization.status, "authorized");
	assert.equal(Object.isFrozen(authorization.artifact), true);
	assert.equal(Object.isFrozen(authorization.artifact.payload), true);
	assert.equal(Object.isFrozen(authorization.artifact.payload.acceptanceCriteria), true);
	assert.equal(
		Object.isFrozen(authorization.artifact.payload.acceptanceCriteria[0].evidence),
		true,
	);
});

test("rejects caller-provided body, digest, or authority at the publication seam", async () => {
	const { workflow, linear } = subject();
	await workflow.authorizeInvocation(issue.id);

	const result = await workflow.publish({
		issueId: issue.id,
		body: "Contenido elegido por el caller",
		digest: "0".repeat(64),
		authority: { actorId: "attacker", role: "Developer", authorityRevision: "r1" },
	});

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID");
	assert.equal(linear.calls.some(({ op }) => op === "createComment"), false);
});

test("renders the optional-empty risks golden deterministically while preserving required evidence", async () => {
	const requiredOnly = {
		...draft,
		outcome: {
			status: "ready-for-qa",
			summary: "La entrega está disponible para validación.",
		},
		qaEnvironment: { name: "QA", url: "https://qa.example.test" },
		acceptanceCriteria: [
			{
				id: "AC-1",
				description: "Publica el comentario esperado.",
				evidence: [
					{ ref: "test:qa-handoff", label: "Prueba automatizada" },
				],
			},
		],
		testGuidance: ["Validar el resultado descrito."],
		risksAndConstraints: [],
		outOfScope: [],
	};
	const expectedBody = await readFile(
		new URL("./fixtures/qa-handoff.required-only.golden.md", import.meta.url),
		"utf8",
	);
	const { workflow } = subject({ draft: requiredOnly });

	await workflow.authorizeInvocation(issue.id);
	const result = await workflow.publish({ issueId: issue.id });

	assert.equal(result.status, "published");
	assert.equal(result.artifact.body, expectedBody);
	assert.doesNotMatch(result.artifact.body, /Fuera de alcance|Revisión:/);
	assert.match(result.artifact.body, /## Riesgos y restricciones\n\nNinguno conocido\./);
	assert.match(result.artifact.body, /`test:qa-handoff`/);
});

test("is idempotent for the exact same visible reference line and body", async () => {
	const same = subject();
	const authorization = await same.workflow.authorizeInvocation(issue.id);
	assert.equal(authorization.status, "authorized");
	same.linear.comments.set(issue.id, [
		{ id: "opaque-existing-id", body: authorization.artifact.body },
	]);

	const result = await same.workflow.publish({ issueId: issue.id });

	assert.equal(result.status, "published");
	assert.equal(result.comment.id, "opaque-existing-id");
	assert.equal(
		same.linear.calls.filter(({ op }) => op === "createComment").length,
		0,
	);
});

test("conflicts when the exact visible reference line has a different body", async () => {
	const conflict = subject();
	const conflictingAuthorization = await conflict.workflow.authorizeInvocation(issue.id);
	assert.equal(conflictingAuthorization.status, "authorized");
	conflict.linear.comments.set(issue.id, [
		{
			id: "opaque-existing-id",
			body: `Cuerpo distinto.\n\nReferencia de flujo: qa-handoff:${conflictingAuthorization.artifact.digest}`,
		},
	]);
	const result = await conflict.workflow.publish({ issueId: issue.id });
	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT");
	assert.equal(
		conflict.linear.calls.some(({ op }) => op === "createComment"),
		false,
	);
});

test("does not alias embedded or trailing-character near-markers", async () => {
	const candidate = subject();
	const authorization = await candidate.workflow.authorizeInvocation(issue.id);
	assert.equal(authorization.status, "authorized");
	const marker = `Referencia de flujo: qa-handoff:${authorization.artifact.digest}`;
	candidate.linear.comments.set(issue.id, [
		{ id: "opaque-embedded", body: `Prosa que contiene ${marker} dentro de una línea.` },
		{ id: "opaque-trailing", body: `${marker}-extra` },
	]);

	const result = await candidate.workflow.publish({ issueId: issue.id });

	assert.equal(result.status, "published");
	assert.equal(result.comment.id, "opaque-comment-id");
	assert.equal(
		candidate.linear.calls.filter(({ op }) => op === "createComment").length,
		1,
	);
});

test("detects an idempotency conflict on a later opaque comment page", async () => {
	const linear = linearFake();
	const candidate = subject({ linear });
	const authorization = await candidate.workflow.authorizeInvocation(issue.id);
	assert.equal(authorization.status, "authorized");
	linear.gateway.listComments = async ({ issueId, cursor }) => {
		linear.calls.push({ op: "listComments", issueId, cursor });
		return cursor
			? {
					comments: [
						{
							id: "opaque-conflict",
							body: `Distinto.\n\nReferencia de flujo: qa-handoff:${authorization.artifact.digest}`,
						},
					],
				}
			: {
					comments: [{ id: "opaque-history", body: "Historial" }],
					nextCursor: "cursor/opaque==",
				};
	};

	const result = await candidate.workflow.publish({ issueId: issue.id });

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_COMMENT_IDEMPOTENCY_CONFLICT");
	assert.deepEqual(
		linear.calls
			.filter(({ op }) => op === "listComments")
			.map(({ cursor }) => cursor),
		[undefined, "cursor/opaque=="],
	);
	assert.equal(linear.calls.some(({ op }) => op === "createComment"), false);
});

test("fails closed before mutation for issue, authority revision, digest, or issue revision drift", async () => {
	const issueMismatch = subject();
	await issueMismatch.workflow.authorizeInvocation(issue.id);
	assert.equal(
		(await issueMismatch.workflow.publish({ issueId: "ILA-9999" })).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_ISSUE_MISMATCH",
	);

	const authorityMismatch = subject();
	await authorityMismatch.workflow.authorizeInvocation(issue.id);
	authorityMismatch.setDeveloper({
		...developer,
		authorityRevision: "developer-auth-r4",
	});
	assert.equal(
		(await authorityMismatch.workflow.publish({ issueId: issue.id })).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH",
	);

	const revisionMismatch = subject();
	await revisionMismatch.workflow.authorizeInvocation(issue.id);
	revisionMismatch.linear.issues.get(issue.id).updatedAt = "issue-r8";
	assert.equal(
		(await revisionMismatch.workflow.publish({ issueId: issue.id })).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_REVISION_MISMATCH",
	);

	const digestMismatch = subject();
	await digestMismatch.workflow.authorizeInvocation(issue.id);
	digestMismatch.artifacts.artifacts.get(issue.id).digest = "0".repeat(64);
	assert.equal(
		(await digestMismatch.workflow.publish({ issueId: issue.id })).blocker.code,
		"PI_WORKFLOW_QA_HANDOFF_DIGEST_MISMATCH",
	);

	for (const candidate of [
		issueMismatch,
		authorityMismatch,
		revisionMismatch,
		digestMismatch,
	]) {
		assert.equal(
			candidate.linear.calls.some(({ op }) => op === "createComment"),
			false,
		);
	}
});

test("blocks when comment creation changes any field in the full issue snapshot", async () => {
	const linear = linearFake();
	const create = linear.gateway.createComment;
	linear.gateway.createComment = async (input) => {
		const result = await create(input);
		linear.issues.get(input.issueId).estimate = 8;
		return result;
	};
	const before = structuredClone(linear.issues.get(issue.id));
	const { workflow } = subject({ linear });
	await workflow.authorizeInvocation(issue.id);

	const result = await workflow.publish({ issueId: issue.id });

	assert.equal(result.status, "blocked");
	assert.equal(result.blocker.code, "PI_WORKFLOW_QA_HANDOFF_READBACK_MISMATCH");
	assert.notDeepEqual(linear.issues.get(issue.id), before);
});
