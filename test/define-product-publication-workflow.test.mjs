import assert from "node:assert/strict";
import test from "node:test";

import { createDefineProductWorkflow } from "../extensions/define-product-workflow.ts";
import {
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
} from "../extensions/product-spec.ts";
import { digestCanonicalValue } from "../extensions/workflow-contracts.ts";

function approvedSpec() {
	const spec = createProductSpecEnvelope({
		definitionId: "definition-1",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Canonical delivery",
		},
		revision: "spec-r1",
		problem:
			"El equipo puede publicar una definición distinta de la que revisó el Owner.",
		solution:
			"El flujo conserva y publica el Spec español exacto aprobado por el Owner.",
		userStories: [
			"Como Owner, quiero aprobar el cuerpo exacto antes de publicarlo.",
			"Como Developer, quiero recibir una definición estable y verificable.",
		],
		decisions: [{
			id: "canonical-parent",
			status: "resolved",
			pertinent: true,
			text: "La descripción del Delivery parent conserva el Spec canónico.",
		}],
		tests: ["Verificar que la descripción publicada coincide con el Spec aprobado."],
		outOfScope: ["Crear los Delivery tickets derivados."],
		supportArtifacts: [],
	});
	const approval = createProductSpecApprovalEnvelope({
		spec,
		actor: {
			actorId: "owner-1",
			role: "Owner",
			authorityRevision: "authority-r1",
		},
	});
	return { spec, approval, sourceRevision: "engram-r1" };
}

function workflow(overrides = {}) {
	return createDefineProductWorkflow({
		delegate: { delegate: async () => { throw new Error("not used"); } },
		createRequestId: () => "request-1",
		project: { name: "pi-workflow", root: "/repo" },
		...overrides,
	});
}

test("approval is persisted and remains recoverable for publication after restart", async () => {
	const approved = approvedSpec();
	let pending = { definitionId: "definition-1", spec: approved.spec };
	let persisted;
	const recovery = {
		load: async () => structuredClone(pending),
		save: async (value) => { pending = structuredClone(value); },
		clear: async () => { pending = undefined; },
	};
	const approvedSpecStore = {
			read: async () => structuredClone(persisted),
			save: async (_id, value) => {
				persisted = { ...structuredClone(value), sourceRevision: "engram-r1" };
				return structuredClone(persisted);
			},
	};
	const first = workflow({
		specApprovalRecoveryStore: recovery,
		authenticatedAuthority: { current: async () => approved.approval.payload.actor },
		approvedSpecStore,
	});
	await first.restoreRecovery();
	const outcome = await first.advance({
		kind: "approve-spec",
		target: approved.spec.payload.target,
		revision: approved.spec.payload.revision,
		digest: approved.spec.digest,
	});

	assert.equal(outcome.status, "spec-approved");
	assert.equal(pending.spec.digest, approved.spec.digest);
	assert.equal(persisted.approval.digest, approved.approval.digest);
	const replacement = workflow({
		specApprovalRecoveryStore: recovery,
		approvedSpecStore,
	});
	assert.deepEqual(await replacement.restoreRecovery(), {
		definitionId: "definition-1",
		phase: "publication",
	});
});

test("publication clears pending approval only after verified success", async () => {
	let clears = 0;
	const recovery = {
		load: async () => undefined,
		save: async () => {},
		clear: async () => { clears += 1; },
	};
	const blocked = workflow({ specApprovalRecoveryStore: recovery });
	assert.equal((await blocked.advance({
		kind: "publish-spec",
		definitionId: "definition-1",
	})).status, "blocked");
	assert.equal(clears, 0);

	const approved = approvedSpec();
	const publicationKey = digestCanonicalValue({
		schema: "delivery-parent-publication",
		definitionId: "definition-1",
		specDigest: approved.spec.digest,
		target: approved.spec.payload.target,
	});
	const parent = {
		id: "parent-1",
		teamId: "team-1",
		title: approved.spec.payload.target.title,
		description: approved.spec.payload.body,
		descriptionRevision: "spec-r1",
		state: "Backlog",
		cycleId: null,
		assigneeId: null,
		publicationKey,
	};
	const published = workflow({
		specApprovalRecoveryStore: {
			...recovery,
		},
		publication: {
			approvedSpecReader: { read: async () => structuredClone(approved) },
			authenticatedAuthority: {
				current: async () => approved.approval.payload.actor,
			},
			state: {
				prepare: async () => ({
					status: "verified",
					parentId: "parent-1",
				}),
			},
			linear: { read: async () => structuredClone(parent) },
		},
	});
	const outcome = await published.advance({
		kind: "publish-spec",
		definitionId: "definition-1",
	});
	assert.equal(outcome.status, "spec-published");
	assert.equal(clears, 1);
});
