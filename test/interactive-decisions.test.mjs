import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
	createInMemoryDecisionStore,
	createInteractiveDecisions,
} from "../extensions/interactive-decisions.ts";

const scope = {
	project: "pi-workflow",
	workflow: "define-product",
	subject: "definition-1",
};
const actor = { actorId: "actor-1", authorityRevision: "authority-1" };
const approve = { id: "spec.approve", input: { revision: "r1" } };
const cancel = { id: "decision.cancel", input: null };

function request(overrides = {}) {
	return {
		scope,
		operation: {
			kind: "publish-spec",
			phase: "spec-approved",
			input: { definitionId: "definition-1" },
			artifacts: [{ digest: "a".repeat(64) }],
			targets: [{ teamId: "team-1" }],
			evidence: [],
		},
		presentation: {
			locale: "es",
			summary: "Publicar la especificación",
			details: ["Descripción completa"],
			consequences: ["Crea un issue"],
			risks: ["Puede existir drift"],
			choices: [
				{
					id: "spec.approve",
					mode: "execute",
					action: approve,
					label: "Publicar",
					description: "Publica el issue",
				},
				{
					id: "decision.cancel",
					mode: "cancel",
					action: cancel,
					label: "Cancelar",
					description: "No modifica Linear",
				},
			],
		},
		...overrides,
	};
}

function service(options = {}) {
	return createInteractiveDecisions({
		store: createInMemoryDecisionStore(),
		createExecutionId: () => "execution-1",
		claimSource: { consume: async () => true },
		...options,
	});
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

function signedEnvelope(value) {
	const { digest: _digest, ...unsigned } = value;
	return `${canonical({ ...unsigned, digest: createHash("sha256").update(canonical(unsigned)).digest("hex") })}\n`;
}

test("prepare returns a closed presentation and persists an idempotent decision", async () => {
	const decisions = service();
	const first = await decisions.prepare(request());
	const repeated = await decisions.prepare(
		request({
			presentation: {
				...request().presentation,
				locale: "en",
				summary: "Publish the specification",
				details: ["Complete description"],
				choices: request().presentation.choices.map((choice) => ({
					...choice,
					label: `translated-${choice.id}`,
				})),
			},
		}),
	);

	assert.equal(first.decisionId, repeated.decisionId);
	assert.equal(
		first.choices.filter((choice) => choice.mode === "cancel").length,
		1,
	);
	assert.equal(JSON.stringify(first).includes("a".repeat(64)), false);
});

test("prepare binds semantic inputs but excludes human wording from identity", async () => {
	const decisions = service();
	const base = await decisions.prepare(request());
	assert.equal(
		base.decisionId,
		"8be6390a97076fdc2aadc60b96796c3cd1c29ec3d8a96ae62388ec47b5a047f5:4791d67fd9a39ff6009b755c8d7271bd56904f9fe2829264a35a084d40745693",
	);
	const changed = await decisions.prepare(
		request({
			operation: { ...request().operation, phase: "spec.publication" },
		}),
	);
	assert.notEqual(changed.decisionId, base.decisionId);
});

test("prepare persists only operation identity and action bindings", async () => {
	const backing = createInMemoryDecisionStore();
	const decisions = service({ store: backing });
	const prepared = await decisions.prepare(
		request({
			operation: {
				...request().operation,
				targets: [{ teamId: "private-team" }],
				evidence: [{ note: "private-evidence" }],
			},
		}),
	);
	const stored = await backing.read(prepared.decisionId.split(":")[0]);
	assert.equal(stored.content.includes("private-team"), false);
	assert.equal(stored.content.includes("private-evidence"), false);
	assert.equal(stored.content.includes("a".repeat(64)), false);
	assert.equal(stored.content.includes("spec.approve"), true);
});

test("prepare rejects malformed canonical values and decisions without exactly one cancel", async () => {
	const decisions = service();
	await assert.rejects(
		() =>
			decisions.prepare(
				request({
					operation: { ...request().operation, input: { invalid: undefined } },
				}),
			),
		/unsupported value/,
	);
	await assert.rejects(
		() =>
			decisions.prepare(
				request({
					presentation: {
						...request().presentation,
						choices: request().presentation.choices.slice(0, 1),
					},
				}),
			),
		/requires one cancel choice/,
	);
	await assert.rejects(
		() =>
			decisions.prepare(
				request({
					presentation: {
						...request().presentation,
						choices: request().presentation.choices.map((choice) => ({
							...choice,
							id: "duplicate",
						})),
					},
				}),
			),
		/unique semantic choice/,
	);
	await assert.rejects(
		() =>
			decisions.prepare(
				request({
					presentation: {
						...request().presentation,
						choices: request().presentation.choices.map((choice) =>
							choice.mode === "cancel"
								? { ...choice, action: { id: "flow.cancel", input: null } }
								: choice,
						),
					},
				}),
			),
		/stable decision.cancel/,
	);
});

test("authorize consumes one fresh matching action and issues one fenced lease", async () => {
	const decisions = service();
	const prepared = await decisions.prepare(request());
	const outcome = await decisions.authorize(
		prepared.decisionId,
		approve,
		actor,
	);
	assert.deepEqual(outcome, {
		kind: "authorized",
		lease: {
			decisionId: prepared.decisionId,
			operationDigest: prepared.decisionId.split(":")[1],
			actorId: actor.actorId,
			authorityRevision: actor.authorityRevision,
			action: approve,
			executionId: "execution-1",
			generation: 1,
		},
	});
	assert.equal(
		(await decisions.authorize(prepared.decisionId, approve, actor)).blocker
			.code,
		"PI_WORKFLOW_DECISION_REPLAY",
	);
	assert.deepEqual(await decisions.recover(scope, actor), outcome);
});

test("authorize fails closed for missing claims, mismatched actions, and cancellation", async () => {
	const missingClaim = service({ claimSource: undefined });
	const prepared = await missingClaim.prepare(request());
	assert.equal(
		(await missingClaim.authorize(prepared.decisionId, approve, actor)).blocker
			.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	assert.equal(
		(
			await missingClaim.authorize(
				prepared.decisionId,
				{ id: "spec.other", input: null },
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
	);

	const decisions = service();
	const cancellable = await decisions.prepare(request());
	assert.deepEqual(
		await decisions.authorize(cancellable.decisionId, cancel, actor),
		{ kind: "cancelled", decisionId: cancellable.decisionId },
	);
	assert.deepEqual(await decisions.recover(scope, actor), {
		kind: "cancelled",
		decisionId: cancellable.decisionId,
	});
});

test("parallel authorization yields exactly one execution lease", async () => {
	let executionIds = 0;
	const decisions = service({
		createExecutionId: () => `execution-${++executionIds}`,
	});
	const prepared = await decisions.prepare(request());
	const outcomes = await Promise.all([
		decisions.authorize(prepared.decisionId, approve, actor),
		decisions.authorize(prepared.decisionId, approve, actor),
	]);
	assert.equal(
		outcomes.filter((outcome) => outcome.kind === "authorized").length,
		1,
	);
	assert.equal(
		outcomes.filter((outcome) => outcome.kind === "blocked").length,
		1,
	);
	assert.equal(executionIds, 2);
});

test("a late authorization result cannot overwrite the winning lease", async () => {
	let releaseLate;
	let enteredLate;
	const lateEntered = new Promise((resolve) => {
		enteredLate = resolve;
	});
	const lateRelease = new Promise((resolve) => {
		releaseLate = resolve;
	});
	let claims = 0;
	const decisions = service({
		claimSource: {
			async consume() {
				claims += 1;
				if (claims === 1) {
					enteredLate();
					await lateRelease;
				}
				return true;
			},
		},
	});
	const prepared = await decisions.prepare(request());
	const late = decisions.authorize(prepared.decisionId, approve, actor);
	await lateEntered;
	const winner = await decisions.authorize(prepared.decisionId, approve, actor);
	releaseLate();
	const loser = await late;
	assert.equal(winner.kind, "authorized");
	assert.equal(loser.kind, "blocked");
	assert.deepEqual(await decisions.recover(scope, actor), winner);
});

test("recover completes an approved lease after a crash without allocating another execution", async () => {
	const backing = createInMemoryDecisionStore();
	let writes = 0;
	let crash = true;
	const crashingStore = {
		read: (key) => backing.read(key),
		readRevision: (key, revision) => backing.readRevision(key, revision),
		async compareAndSwap(key, revision, content) {
			writes += 1;
			if (writes === 3 && crash)
				throw new Error("simulated crash before lease write");
			return backing.compareAndSwap(key, revision, content);
		},
	};
	let executionIds = 0;
	const decisions = service({
		store: crashingStore,
		createExecutionId: () => `execution-${++executionIds}`,
	});
	const prepared = await decisions.prepare(request());
	await assert.rejects(
		() => decisions.authorize(prepared.decisionId, approve, actor),
		/simulated crash/,
	);
	crash = false;
	const recovered = await decisions.recover(scope, actor);
	assert.equal(recovered.kind, "authorized");
	assert.equal(recovered.lease.executionId, "execution-1");
	assert.equal(executionIds, 1);
});

test("recover adopts only one exact execution manifest", async () => {
	let manifests = [];
	const decisions = service({
		manifestLookup: { find: async () => manifests },
	});
	const prepared = await decisions.prepare(request());
	const authorized = await decisions.authorize(
		prepared.decisionId,
		approve,
		actor,
	);
	const manifest = {
		ref: "engram://manifest-1",
		decisionId: authorized.lease.decisionId,
		operationDigest: authorized.lease.operationDigest,
		executionId: authorized.lease.executionId,
		generation: authorized.lease.generation,
	};
	manifests = [manifest];
	assert.deepEqual(await decisions.recover(scope, actor), {
		...authorized,
		manifest,
	});
	manifests = [manifest, { ...manifest, ref: "engram://manifest-2" }];
	assert.equal(
		(await decisions.recover(scope, actor)).blocker.code,
		"PI_WORKFLOW_DECISION_MANIFEST_CONFLICT",
	);
});

test("prepare supersedes only an unconsumed decision", async () => {
	const decisions = service();
	const first = await decisions.prepare(request());
	const second = await decisions.prepare(
		request({ operation: { ...request().operation, phase: "changed-phase" } }),
	);
	assert.equal(
		(await decisions.authorize(first.decisionId, approve, actor)).blocker.code,
		"PI_WORKFLOW_DECISION_NOT_FOUND",
	);
	await decisions.authorize(second.decisionId, approve, actor);
	await assert.rejects(
		() =>
			decisions.prepare(
				request({
					operation: { ...request().operation, phase: "third-phase" },
				}),
			),
		/must be recovered or cancelled/,
	);
});

test("prepare rejects persistence read-back drift", async () => {
	const backing = createInMemoryDecisionStore();
	const drifting = {
		compareAndSwap: (key, revision, content) =>
			backing.compareAndSwap(key, revision, content),
		read: (key) => backing.read(key),
		async readRevision(key, revision) {
			const content = await backing.readRevision(key, revision);
			return content && `${content}drift`;
		},
	};
	await assert.rejects(
		() => service({ store: drifting }).prepare(request()),
		/durable read-back mismatch/,
	);
});

test("recover rejects future schemas and noncanonical durable bytes", async () => {
	for (const mutate of [
		(value) => ({ ...value, schemaVersion: 2 }),
		(value) => JSON.stringify(value, null, 2),
	]) {
		const backing = createInMemoryDecisionStore();
		const decisions = service({ store: backing });
		const prepared = await decisions.prepare(request());
		const key = prepared.decisionId.split(":")[0];
		const current = await backing.read(key);
		const parsed = JSON.parse(current.content);
		const changed = mutate(parsed);
		const content =
			typeof changed === "string"
				? `${changed}\n`
				: `${JSON.stringify(changed)}\n`;
		await backing.compareAndSwap(key, current.revision, content);
		await assert.rejects(
			() => decisions.recover(scope, actor),
			/schema is unsupported|canonical bytes are invalid/,
		);
	}
});

test("recover rejects a canonically signed malformed manifest binding", async () => {
	const backing = createInMemoryDecisionStore();
	let manifests = [];
	const decisions = service({
		store: backing,
		manifestLookup: { find: async () => manifests },
	});
	const prepared = await decisions.prepare(request());
	const authorized = await decisions.authorize(
		prepared.decisionId,
		approve,
		actor,
	);
	manifests = [
		{
			ref: "engram://manifest-1",
			decisionId: authorized.lease.decisionId,
			operationDigest: authorized.lease.operationDigest,
			executionId: authorized.lease.executionId,
			generation: authorized.lease.generation,
		},
	];
	await decisions.recover(scope, actor);
	const key = prepared.decisionId.split(":")[0];
	const current = await backing.read(key);
	const parsed = JSON.parse(current.content);
	parsed.current.manifest = {
		...parsed.current.manifest,
		privateEvidence: "must-not-persist",
	};
	await backing.compareAndSwap(key, current.revision, signedEnvelope(parsed));
	await assert.rejects(
		() => decisions.recover(scope, actor),
		/manifest binding is invalid/,
	);
});

test("recover rejects an actor change and corrupt durable bytes without mutation", async () => {
	const backing = createInMemoryDecisionStore();
	const decisions = service({ store: backing });
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	assert.equal(
		(await decisions.recover(scope, { ...actor, actorId: "actor-2" })).blocker
			.code,
		"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
	);

	const key = prepared.decisionId.split(":")[0];
	const current = await backing.read(key);
	await backing.compareAndSwap(key, current.revision, "{not-json}\n");
	await assert.rejects(() => decisions.recover(scope, actor), /not valid JSON/);
});
