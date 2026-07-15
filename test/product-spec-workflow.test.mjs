import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createDefineProductWorkflow } from "../extensions/define-product-workflow.ts";
import { validateProductSpecApproval } from "../extensions/product-spec.ts";
import {
	canonicalJson,
	digestCanonicalValue,
} from "../extensions/workflow-contracts.ts";

const target = {
	kind: "linear-parent-description",
	teamId: "team-grupo-ilao",
	title: "Incorporar aprobaciones exactas del Spec",
};

const researchRef = {
	kind: "engram",
	project: "pi-workflow",
	topic: "workflow/define-product/definition-1/research/request-1",
	revision: "research-r1",
	schema: "research-evidence",
	schemaVersion: 1,
	digest: "research-digest",
};

const prototypeRef = {
	kind: "engram",
	project: "pi-workflow",
	topic: "workflow/define-product/definition-1/prototype/request-2",
	revision: "prototype-r1",
	schema: "design-exploration",
	schemaVersion: 1,
	digest: "prototype-digest",
};

async function createWorkflow(
	artifacts = { research: researchRef, prototype: prototypeRef },
	options = {},
) {
	const workflow = createDefineProductWorkflow({
		delegate: {
			delegate: async (intent) => ({
				status: "completed",
				executiveSummary: "verified",
				artifacts:
					intent.kind === "research"
						? [artifacts.research]
						: [artifacts.prototype],
				nextRecommended:
					intent.kind === "research"
						? { kind: "confirmed-route", route: "wayfinder" }
						: { kind: "compare-exploration", intent: intent.kind },
				risks: [],
				launchProvenance: {
					agentName: intent.kind === "research" ? "research" : "prototype",
					assetVersion: 1,
					assetDigest: "asset-digest",
					capabilityProfile:
						intent.kind === "research" ? "research-reader" : "isolated-prototype",
					provider: "openai-codex",
					model: "gpt-5.6-terra",
					effort: "medium",
					inheritContext: false,
					promptMode: "replace",
					skillRefs: [],
					standardRefs: [],
					allowedTools: ["read"],
					deniedCapabilities: ["linear"],
					artifactTopic: intent.targetTopic,
				},
			}),
		},
		createRequestId: () => "request-unused",
		project: { name: "pi-workflow", root: "/repo" },
		specApprovalRecoveryStore: options.specApprovalRecoveryStore,
		authenticatedAuthority: {
			current: async () =>
				options.authority ?? {
					actorId: "owner-felipe",
					role: "Owner",
					authorityRevision: "owner-policy-r3",
				},
		},
	});
	if (options.prepare === false) return workflow;
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "definition-1",
		domainAnchor: "Definir aprobaciones",
		assessment: { clarity: "unclear", breadth: "broad", reasons: ["research"] },
		workflowStateId: "state-1",
	});
	await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmationToken: recommendation.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "¿Cómo debe funcionar la aprobación?",
		workflowStateId: "state-1",
	});
	await workflow.advance({
		kind: "request-exploration",
		definitionId: "definition-1",
		intent: "prototype",
		focus: "Comparar la aprobación",
	});
	return workflow;
}

function toSpecCommand(overrides = {}) {
	return {
		kind: "to-spec",
		definitionId: "definition-1",
		target,
		revision: "spec-r1",
		problem:
			"El equipo puede publicar una definición distinta de la que revisó el Owner.",
		solution:
			"El flujo genera un Spec español exacto y exige aprobación vinculada a su identidad completa.",
		userStories: [
			"Como Owner, quiero revisar el cuerpo exacto, para conservar autoridad sobre la definición publicada.",
			"Como Developer, quiero recibir un Spec estable, para implementar una intención aprobada.",
		],
		decisions: [
			{
				id: "canonical-parent",
				status: "resolved",
				pertinent: true,
				text: "La descripción del Delivery parent es el Spec canónico.",
			},
			{
				id: "exact-approval",
				status: "resolved",
				pertinent: true,
				text: "La aprobación se vincula al resumen criptográfico exacto antes de publicar.",
			},
			{
				id: "open-decision",
				status: "open",
				pertinent: true,
				text: "Raw conversation must never be exported.",
			},
			{
				id: "unrelated-decision",
				status: "resolved",
				pertinent: false,
				text: "Unrelated history must remain private.",
			},
		],
		tests: [
			"Verificar la selección de decisiones y apoyos pertinentes.",
			"Bloquear la publicación cuando cambia cualquier identidad aprobada.",
		],
		outOfScope: [
			"La publicación de la descripción del Delivery parent en Linear queda fuera del alcance.",
		],
		supportArtifactAliases: ["research", "prototype"],
		conversation: "raw private conversation",
		history: [{ role: "owner", text: "raw private history" }],
		...overrides,
	};
}

test("to-spec exports only resolved pertinent decisions and support artifacts into the exact Spanish body", async () => {
	const golden = await readFile(
		new URL("./fixtures/product-spec-body.golden.md", import.meta.url),
		"utf8",
	);
	const outcome = await (await createWorkflow()).advance(toSpecCommand());

	assert.equal(outcome.status, "spec-ready");
	assert.equal(outcome.spec.payload.language, "es");
	assert.equal(outcome.spec.payload.body, golden);
	assert.deepEqual(
		outcome.spec.payload.decisions.map(({ id }) => id),
		["canonical-parent", "exact-approval"],
	);
	assert.deepEqual(outcome.spec.payload.supportArtifacts, [
		researchRef,
		prototypeRef,
	]);
	assert.doesNotMatch(JSON.stringify(outcome.spec), /raw private|private-history/i);
});

test("to-spec system brief requires neutral professional Spanish and exact-body approval", async () => {
	const brief = await readFile(
		new URL("../assets/agents/to-spec.md", import.meta.url),
		"utf8",
	);

	assert.match(
		brief,
		/Generate every Linear-facing field[^\n]+and the final Spec body in neutral professional Spanish\./u,
	);
	assert.match(
		brief,
		/Preserve every stable identifier exactly as provided/u,
	);
	assert.match(
		brief,
		/Require the Owner to approve the digest of the exact final body before publication\./u,
	);
	assert.match(
		brief,
		/Never translate or rewrite the body after approval/u,
	);
});

test("to-spec resolves only verified aliases from the same definition", async () => {
	const workflow = await createWorkflow();
	const verified = await workflow.advance(toSpecCommand());
	assert.equal(verified.status, "spec-ready");
	assert.deepEqual(verified.spec.payload.supportArtifacts, [
		researchRef,
		prototypeRef,
	]);

	for (const alias of ["invented", "private-history", "definition-other:research"]) {
		const refused = await workflow.advance(
			toSpecCommand({ supportArtifactAliases: [alias] }),
		);
		assert.equal(refused.status, "blocked", alias);
		assert.equal(
			refused.blocker.code,
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
			alias,
		);
	}

	const crossDefinition = await createWorkflow({
		research: {
			...researchRef,
			topic: "workflow/define-product/definition-other/research/request-1",
		},
		prototype: prototypeRef,
	});
	const crossDefinitionOutcome = await crossDefinition.advance(toSpecCommand());
	assert.equal(crossDefinitionOutcome.status, "blocked");
	assert.equal(
		crossDefinitionOutcome.blocker.code,
		"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
	);
});

test("caller-manufactured support refs cannot replace verified alias selections", async () => {
	const outcome = await (await createWorkflow()).advance(
		toSpecCommand({
			supportArtifacts: [
				{
					ref: {
						...researchRef,
						rawHistory: [{ private: "Owner conversation" }],
						metadata: { privateNotes: "must not escape" },
					},
					status: "resolved",
					pertinent: true,
				},
			],
		}),
	);

	assert.equal(outcome.status, "spec-ready");
	assert.deepEqual(outcome.spec.payload.supportArtifacts, [
		researchRef,
		prototypeRef,
	]);
	assert.doesNotMatch(JSON.stringify(outcome.spec), /rawHistory|privateNotes|Owner conversation/);
});

test("product Spec canonical JSON and digest match the approved golden contract", async () => {
	const golden = JSON.parse(
		await readFile(
			new URL("./fixtures/product-spec-contract.golden.json", import.meta.url),
			"utf8",
		),
	);
	const outcome = await (await createWorkflow()).advance(toSpecCommand());

	assert.equal(canonicalJson(outcome.spec), golden.canonicalJson);
	assert.equal(outcome.spec.digest, golden.digest);
});

test("approve-spec binds the exact Owner actor, target, revision, and Spec digest", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const actor = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: ready.spec.payload.revision,
		digest: ready.spec.digest,
	});

	assert.equal(approved.status, "spec-approved");
	assert.deepEqual(approved.approval.payload, {
		actor,
		target,
		revision: "spec-r1",
		specDigest: ready.spec.digest,
	});
	assert.deepEqual(
		validateProductSpecApproval({
			spec: approved.spec,
			approval: approved.approval,
			actor,
			target,
			revision: "spec-r1",
		}),
		{ ok: true },
	);
});

test("pending Spec approval restores exactly and corrupt recovery fails closed", async () => {
	let durableState;
	let clears = 0;
	const recoveryStore = {
		load: async () => structuredClone(durableState),
		save: async (state) => {
			durableState = structuredClone(state);
		},
		clear: async () => {
			durableState = undefined;
			clears += 1;
		},
	};
	const first = await createWorkflow(
		{ research: researchRef, prototype: prototypeRef },
		{ specApprovalRecoveryStore: recoveryStore },
	);
	const ready = await first.advance(toSpecCommand());
	assert.equal(durableState.spec.digest, ready.spec.digest);

	const replacement = await createWorkflow(
		{ research: researchRef, prototype: prototypeRef },
		{ specApprovalRecoveryStore: recoveryStore, prepare: false },
	);
	assert.deepEqual(await replacement.restoreRecovery(), {
		definitionId: "definition-1",
		phase: "spec-approval",
	});
	const approved = await replacement.advance({
		kind: "approve-spec",
		target: ready.spec.payload.target,
		revision: ready.spec.payload.revision,
		digest: ready.spec.digest,
	});
	assert.equal(approved.status, "spec-approved");
	assert.equal(durableState.spec.digest, ready.spec.digest);

	const corruptions = [
		(spec) => {
			spec.digest = "corrupt";
		},
		(spec) => {
			spec.schemaVersion = 2;
		},
		(spec) => {
			spec.payload.definitionId = "definition-other";
		},
		(spec) => {
			spec.payload.target.teamId = "   ";
		},
		(spec) => {
			spec.payload.revision = "   ";
		},
	];
	for (const corrupt of corruptions) {
		const spec = structuredClone(ready.spec);
		corrupt(spec);
		if (spec.digest !== "corrupt") {
			const unsigned = {
				schema: spec.schema,
				schemaVersion: spec.schemaVersion,
				payload: spec.payload,
			};
			spec.digest = digestCanonicalValue(unsigned);
		}
		await recoveryStore.save({ definitionId: "definition-1", spec });
		const corruptReplacement = await createWorkflow(
			{ research: researchRef, prototype: prototypeRef },
			{ specApprovalRecoveryStore: recoveryStore, prepare: false },
		);
		assert.equal(await corruptReplacement.restoreRecovery(), undefined);
		assert.equal(durableState, undefined);
	}
	assert.equal(clears >= corruptions.length + 1, true);
});

test("a malformed to-spec retry preserves the last known good approval snapshot", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const malformed = await workflow.advance(
		toSpecCommand({
			decisions: [
				{
					id: "   ",
					status: "resolved",
					pertinent: true,
					text: "La aprobación conserva la definición exacta.",
				},
			],
		}),
	);
	assert.equal(malformed.status, "blocked");

	const approved = await workflow.advance({
		kind: "approve-spec",
		target: ready.spec.payload.target,
		revision: ready.spec.payload.revision,
		digest: ready.spec.digest,
	});
	assert.equal(approved.status, "spec-approved");
	assert.equal(approved.spec.digest, ready.spec.digest);
});

test("approve-spec uses an immutable generated snapshot after returned nested data is mutated", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const originalDigest = ready.spec.digest;
	ready.spec.payload.body = "corrupted body";
	ready.spec.payload.target.title = "Destino alterado";
	ready.spec.payload.revision = "spec-forged";
	ready.spec.payload.supportArtifacts[0].topic = "workflow/private-history";

	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: "spec-r1",
		digest: originalDigest,
	});

	assert.equal(approved.status, "spec-approved");
	assert.equal(approved.spec.digest, originalDigest);
	assert.equal(approved.spec.payload.target.title, target.title);
	assert.equal(approved.spec.payload.revision, "spec-r1");
	assert.equal(approved.spec.payload.supportArtifacts[0].topic, researchRef.topic);
	assert.notEqual(approved.spec.payload.body, "corrupted body");
});

test("approve-spec fails closed when the actor lacks exact current Owner authority", async () => {
	for (const actor of [
		{
			actorId: "developer-1",
			role: "Developer",
			authorityRevision: "owner-policy-r3",
		},
		{
			actorId: " owner-felipe ",
			role: "Owner",
			authorityRevision: "owner-policy-r3",
		},
		{
			actorId: "owner-felipe",
			role: "Owner",
			authorityRevision: " ",
		},
	]) {
		const workflow = await createWorkflow(
			{ research: researchRef, prototype: prototypeRef },
			{ authority: actor },
		);
		const ready = await workflow.advance(toSpecCommand());
		const outcome = await workflow.advance({
			kind: "approve-spec",
			target,
			revision: ready.spec.payload.revision,
			digest: ready.spec.digest,
		});

		assert.deepEqual(outcome, {
			status: "blocked",
			blocker: {
				code: "PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
				message:
					"Spec approval requires an exact actor with current Owner authority.",
			},
		});
	}
});

test("publication validation returns a stable artifact blocker for malformed outer input", () => {
	const malformedInputs = [
		null,
		undefined,
		false,
		42,
		0n,
		"invalid",
		Symbol("invalid"),
		[],
		{},
		{ spec: null },
	];

	for (const input of malformedInputs) {
		assert.deepEqual(validateProductSpecApproval(input), {
			ok: false,
			blocker: {
				code: "PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
				message:
					"The product Spec schema, language, body, revision, or digest is invalid.",
			},
		});
	}
});

test("publication validation returns an artifact blocker for malformed valid-digest envelopes", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const actor = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: "spec-r1",
		digest: ready.spec.digest,
	});
	for (const mutate of [
		(spec) => {
			spec.payload.language = "en";
		},
		(spec) => {
			spec.payload.body = null;
		},
		(spec) => {
			spec.payload.target = null;
		},
		(spec) => {
			spec.payload.decisions = [null];
		},
		(spec) => {
			spec.payload.supportArtifacts = {};
		},
	]) {
		const malformedSpec = structuredClone(approved.spec);
		mutate(malformedSpec);
		const unsigned = {
			schema: malformedSpec.schema,
			schemaVersion: malformedSpec.schemaVersion,
			payload: malformedSpec.payload,
		};
		malformedSpec.digest = digestCanonicalValue(unsigned);
		const gate = validateProductSpecApproval({
			spec: malformedSpec,
			approval: approved.approval,
			actor,
			target,
			revision: "spec-r1",
		});
		assert.equal(gate.ok, false);
		assert.equal(gate.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
	}
});

test("publication validation requires trusted non-empty current Owner authority", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const actor = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: "spec-r1",
		digest: ready.spec.digest,
	});
	for (const currentActor of [
		{ ...actor, actorId: "" },
		{ ...actor, role: "Developer" },
		{ ...actor, authorityRevision: "" },
	]) {
		const gate = validateProductSpecApproval({
			spec: approved.spec,
			approval: approved.approval,
			actor: currentActor,
			target,
			revision: "spec-r1",
		});
		assert.equal(gate.ok, false);
		assert.equal(gate.blocker.code, "PI_WORKFLOW_SPEC_APPROVAL_REQUIRED");
	}
});

test("publication validation rejects recomputed forged, stale, empty, and non-Owner approvals", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const actor = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: "spec-r1",
		digest: ready.spec.digest,
	});
	const forgedActors = [
		{ ...actor, actorId: "" },
		{ ...actor, role: "Developer" },
		{ ...actor, authorityRevision: "" },
		{ ...actor, authorityRevision: "owner-policy-r2" },
	];
	for (const forgedActor of forgedActors) {
		const unsigned = {
			schema: approved.approval.schema,
			schemaVersion: approved.approval.schemaVersion,
			payload: { ...approved.approval.payload, actor: forgedActor },
		};
		const forgedApproval = {
			...unsigned,
			digest: digestCanonicalValue(unsigned),
		};
		const gate = validateProductSpecApproval({
			spec: approved.spec,
			approval: forgedApproval,
			actor,
			target,
			revision: "spec-r1",
		});
		assert.equal(gate.ok, false);
		assert.equal(gate.blocker.code, "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH");
	}
});

test("the publication gate invalidates approval before mutation when body, target, revision, or authority changes", async () => {
	const workflow = await createWorkflow();
	const ready = await workflow.advance(toSpecCommand());
	const actor = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: ready.spec.payload.revision,
		digest: ready.spec.digest,
	});
	const changedBody = await (await createWorkflow()).advance(
		toSpecCommand({
			problem:
				"El equipo puede publicar un cuerpo distinto del que aprobó el Owner.",
		}),
	);
	const changedTargetValue = {
		...target,
		teamId: "team-different",
		title: "Incorporar aprobaciones exactas en otro destino",
	};
	const changedTarget = await (await createWorkflow()).advance(
		toSpecCommand({ target: changedTargetValue }),
	);
	const changedRevision = await (await createWorkflow()).advance(
		toSpecCommand({ revision: "spec-r2" }),
	);
	let mutations = 0;
	const candidates = [
		{
			name: "body",
			spec: changedBody.spec,
			actor,
			target,
			revision: "spec-r1",
		},
		{
			name: "target",
			spec: changedTarget.spec,
			actor,
			target: changedTargetValue,
			revision: "spec-r1",
		},
		{
			name: "revision",
			spec: changedRevision.spec,
			actor,
			target,
			revision: "spec-r2",
		},
		{
			name: "actor",
			spec: ready.spec,
			actor: { ...actor, actorId: "different-owner" },
			target,
			revision: "spec-r1",
		},
		{
			name: "authority revision",
			spec: ready.spec,
			actor: { ...actor, authorityRevision: "owner-policy-r4" },
			target,
			revision: "spec-r1",
		},
	];

	for (const candidate of candidates) {
		const gate = validateProductSpecApproval({
			spec: candidate.spec,
			approval: approved.approval,
			actor: candidate.actor,
			target: candidate.target,
			revision: candidate.revision,
		});
		if (gate.ok) mutations += 1;
		assert.equal(gate.ok, false, candidate.name);
		assert.equal(
			gate.blocker.code,
			"PI_WORKFLOW_SPEC_APPROVAL_MISMATCH",
			candidate.name,
		);
	}
	assert.equal(mutations, 0);
});

test("to-spec rejects blank decision and verified artifact identity fields", async () => {
	const blankDecision = await (await createWorkflow()).advance(
		toSpecCommand({
			decisions: [
				{
					id: "   ",
					status: "resolved",
					pertinent: true,
					text: "La aprobación conserva la definición exacta.",
				},
			],
		}),
	);
	assert.equal(blankDecision.status, "blocked");
	assert.equal(
		blankDecision.blocker.code,
		"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
	);

	for (const field of ["project", "topic", "revision", "digest"]) {
		const workflow = await createWorkflow({
			research: { ...researchRef, [field]: "   " },
			prototype: prototypeRef,
		});
		const outcome = await workflow.advance(toSpecCommand());
		assert.equal(outcome.status, "blocked", field);
		assert.equal(
			outcome.blocker.code,
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
			field,
		);
	}
});

test("to-spec rejects every renderer-active Markdown and HTML probe before digest", async () => {
	const activeBodies = [
		"El equipo puede revisar ![el Spec](https://evil.example/pixel).",
		"<span>El equipo puede revisar el Spec.</span>",
		"El equipo puede revisar [el Spec](javascript:alert(1)).",
		"El equipo puede revisar https://evil.example/tracker.",
		"El equipo puede revisar [el Spec][externo].\\n[externo]: https://evil.example/path",
		"El equipo puede revisar `el Spec`.",
		"El equipo puede revisar <?xml version=\"1.0\"?> antes de publicar.",
		"El equipo puede revisar <!DOCTYPE html> antes de publicar.",
		"El equipo puede revisar <!ENTITY xxe SYSTEM \"file:///etc/passwd\"> antes de publicar.",
		"El equipo puede revisar <![CDATA[contenido externo]]> antes de publicar.",
		"El equipo puede revisar www.evil.example/tracker antes de publicar.",
		"El equipo puede escribir seguridad@example.com antes de publicar.",
		"El equipo puede escribir <seguridad@example.com> antes de publicar.",
		"El equipo puede revisar <ftp://evil.example/file> antes de publicar.",
		"[x] El equipo puede revisar la publicación.",
		"---",
	];
	for (const problem of activeBodies) {
		const outcome = await (await createWorkflow()).advance(
			toSpecCommand({ problem }),
		);
		assert.deepEqual(
			outcome,
			{
				status: "blocked",
				blocker: {
					code: "PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
					message:
						"The Linear-facing Spec content must be plain text without active Markdown or links.",
				},
			},
			problem,
		);
	}
});
