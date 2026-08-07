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
const actorAuthority = {
	actorId: "actor-1",
	authorityRevision: "authority-1",
};
const actor = {
	...actorAuthority,
	active: true,
	guest: false,
};
const otherActor = {
	actorId: "actor-2",
	authorityRevision: "authority-2",
	active: true,
	guest: false,
};
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
	assert.deepEqual(
		first.choices.map((choice) => choice.actionId),
		["spec.approve", "decision.cancel"],
	);
	assert.equal(JSON.stringify(first).includes("r1"), false);
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

test("concurrent identical preparation adopts one durable decision", async () => {
	const decisions = service();
	const [left, right] = await Promise.all([
		decisions.prepare(request()),
		decisions.prepare(request()),
	]);
	assert.deepEqual(left, right);
	assert.deepEqual(await decisions.recover(scope, actor), {
		kind: "prepared",
		decisionId: left.decisionId,
	});
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
		receipt: {
			state: "leased",
			decisionId: prepared.decisionId,
			actionId: approve.id,
			actorId: actor.actorId,
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
	const cancelled = {
		kind: "cancelled",
		decisionId: cancellable.decisionId,
		receipt: {
			state: "cancelled",
			decisionId: cancellable.decisionId,
			actionId: "decision.cancel",
			actorId: actor.actorId,
		},
	};
	assert.deepEqual(
		await decisions.authorize(cancellable.decisionId, cancel, actor),
		cancelled,
	);
	assert.deepEqual(await decisions.recover(scope, actor), cancelled);
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

test("authorize freezes one injected actor identity before asynchronous claim consumption", async () => {
	let releaseClaim;
	let claimEntered;
	const entered = new Promise((resolve) => {
		claimEntered = resolve;
	});
	const released = new Promise((resolve) => {
		releaseClaim = resolve;
	});
	let consumedActor;
	const decisions = service({
		claimSource: {
			async consume(_decisionId, _action, frozenActor) {
				consumedActor = frozenActor;
				claimEntered();
				await released;
				return true;
			},
		},
	});
	const mutableActor = {
		actorId: "actor-frozen",
		authorityRevision: "authority-frozen",
		active: true,
		guest: false,
	};
	const prepared = await decisions.prepare(request());
	const pending = decisions.authorize(prepared.decisionId, approve, mutableActor);
	await entered;
	mutableActor.actorId = "actor-mutated";
	mutableActor.authorityRevision = "authority-mutated";
	releaseClaim();
	const authorized = await pending;
	assert.deepEqual(consumedActor, {
		actorId: "actor-frozen",
		authorityRevision: "authority-frozen",
		active: true,
		guest: false,
	});
	assert.equal(authorized.lease.actorId, "actor-frozen");
	assert.equal(authorized.lease.authorityRevision, "authority-frozen");
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

test("recover exposes a superseded receipt after replacement crashes", async () => {
	const backing = createInMemoryDecisionStore();
	let writes = 0;
	const store = {
		read: (key) => backing.read(key),
		readRevision: (key, revision) => backing.readRevision(key, revision),
		async compareAndSwap(key, revision, content) {
			writes += 1;
			if (writes === 3) throw new Error("simulated crash before replacement");
			return backing.compareAndSwap(key, revision, content);
		},
	};
	const decisions = service({ store });
	const first = await decisions.prepare(request());
	await assert.rejects(
		() =>
			decisions.prepare(
				request({
					operation: { ...request().operation, phase: "spec.changed" },
				}),
			),
		/simulated crash/,
	);
	assert.deepEqual(await decisions.recover(scope, actor), {
		kind: "superseded",
		decisionId: first.decisionId,
		receipt: { state: "superseded", decisionId: first.decisionId },
	});
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

test("recover rejects re-signed extra and state-incompatible durable fields", async () => {
	for (const mutate of [
		(value) => {
			value.extra = true;
		},
		(value) => {
			value.scope.extra = true;
		},
		(value) => {
			value.current.extra = true;
		},
		(value) => {
			value.current.actions[0].extra = true;
		},
		(value) => {
			value.current.actions[0].action.extra = true;
		},
		(value) => {
			value.current.actor = actor;
		},
	]) {
		const backing = createInMemoryDecisionStore();
		const decisions = service({ store: backing });
		const prepared = await decisions.prepare(request());
		const key = prepared.decisionId.split(":")[0];
		const current = await backing.read(key);
		const parsed = JSON.parse(current.content);
		mutate(parsed);
		await backing.compareAndSwap(key, current.revision, signedEnvelope(parsed));
		await assert.rejects(
			() => decisions.recover(scope, actor),
			/state shape is invalid|scope binding is invalid/,
		);
	}
});

test("recover rejects a re-signed cancelled action mismatch", async () => {
	const backing = createInMemoryDecisionStore();
	const decisions = service({ store: backing });
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, cancel, actor);
	const key = prepared.decisionId.split(":")[0];
	const current = await backing.read(key);
	const parsed = JSON.parse(current.content);
	parsed.current.action.input = "tampered";
	await backing.compareAndSwap(key, current.revision, signedEnvelope(parsed));
	await assert.rejects(
		() => decisions.recover(scope, actor),
		/state shape is invalid/,
	);
});

test("recover rejects re-signed impossible durable state combinations", async () => {
	for (const mutate of [
		(value) => {
			value.current.state = "terminal";
		},
		(value) => {
			value.current.state = "cancelled";
		},
		(value) => {
			value.current.state = "revoked";
		},
	]) {
		const backing = createInMemoryDecisionStore();
		const decisions = service({ store: backing });
		const prepared = await decisions.prepare(request());
		await decisions.authorize(prepared.decisionId, approve, actor);
		const key = prepared.decisionId.split(":")[0];
		const current = await backing.read(key);
		const parsed = JSON.parse(current.content);
		mutate(parsed);
		await backing.compareAndSwap(key, current.revision, signedEnvelope(parsed));
		await assert.rejects(
			() => decisions.recover(scope, actor),
			/state shape is invalid/,
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

test("an approved durable state cannot carry lease manifest evidence", async () => {
	const backing = createInMemoryDecisionStore();
	let writes = 0;
	const decisions = service({
		store: {
			read: (key) => backing.read(key),
			readRevision: (key, revision) => backing.readRevision(key, revision),
			async compareAndSwap(key, revision, content) {
				writes += 1;
				if (writes === 3) throw new Error("stop before lease");
				return backing.compareAndSwap(key, revision, content);
			},
		},
	});
	const prepared = await decisions.prepare(request());
	await assert.rejects(
		() => decisions.authorize(prepared.decisionId, approve, actor),
		/stop before lease/,
	);
	const key = prepared.decisionId.split(":")[0];
	const current = await backing.read(key);
	const parsed = JSON.parse(current.content);
	assert.equal(parsed.current.state, "approved");
	parsed.current.manifest = {
		ref: "engram://not-yet-leased",
		decisionId: parsed.current.decisionId,
		operationDigest: parsed.current.operationDigest,
		executionId: parsed.current.executionId,
		generation: parsed.current.generation,
	};
	await backing.compareAndSwap(key, current.revision, signedEnvelope(parsed));
	await assert.rejects(
		() => decisions.recover(scope, actor),
		/state shape is invalid/,
	);
});

test("recover gives another active member read-only access without reusing the lease", async () => {
	const backing = createInMemoryDecisionStore();
	const decisions = service({ store: backing });
	const prepared = await decisions.prepare(request());
	const authorized = await decisions.authorize(prepared.decisionId, approve, actor);
	assert.equal(authorized.kind, "authorized");
	assert.deepEqual(await decisions.recover(scope, otherActor), {
		kind: "active",
		decisionId: prepared.decisionId,
		executionId: "execution-1",
		generation: 1,
		currentApprover: actorAuthority,
		reapprovalRequired: true,
		actions: ["resume", "replace", "cancel"],
	});
	assert.deepEqual(await decisions.recover(scope, actor), authorized);
});

test("same authority explicitly resumes the same fenced execution after restart", async () => {
	const backing = createInMemoryDecisionStore();
	const firstService = service({ store: backing });
	const prepared = await firstService.prepare(request());
	const authorized = await firstService.authorize(
		prepared.decisionId,
		approve,
		actor,
	);
	const manifest = {
		ref: "engram://restart-manifest",
		decisionId: authorized.lease.decisionId,
		operationDigest: authorized.lease.operationDigest,
		executionId: authorized.lease.executionId,
		generation: authorized.lease.generation,
	};
	const restarted = service({
		store: backing,
		createExecutionId: () => "must-not-be-allocated",
		manifestLookup: { find: async () => [manifest] },
	});
	assert.deepEqual(await restarted.recover(scope, actor, { kind: "resume" }), {
		...authorized,
		manifest,
	});
});

test("changed authority gets a fresh reapproval decision after restart", async () => {
	const backing = createInMemoryDecisionStore();
	const firstService = service({ store: backing });
	const prepared = await firstService.prepare(request());
	const firstAuthorization = await firstService.authorize(
		prepared.decisionId,
		approve,
		actor,
	);
	assert.equal(firstAuthorization.kind, "authorized");

	const restarted = service({
		store: backing,
		createExecutionId: () => "execution-2",
	});
	assert.equal(
		(await restarted.recover(scope, otherActor, { kind: "resume" })).blocker
			.code,
		"PI_WORKFLOW_DECISION_ACTION_MISMATCH",
	);
	const reapproval = await restarted.recover(scope, otherActor, {
		kind: "resume",
		request: request(),
	});
	assert.equal(reapproval.kind, "reapproval");
	assert.equal(reapproval.previousDecisionId, prepared.decisionId);
	assert.notEqual(reapproval.presentation.decisionId, prepared.decisionId);
	const reauthorized = await restarted.authorize(
		reapproval.presentation.decisionId,
		approve,
		otherActor,
	);
	assert.equal(reauthorized.kind, "authorized");
	assert.equal(reauthorized.lease.actorId, otherActor.actorId);

	const afterSecondRestart = service({ store: backing });
	assert.deepEqual(
		await afterSecondRestart.recover(scope, otherActor, { kind: "resume" }),
		reauthorized,
	);
	const stored = await backing.read(
		reapproval.presentation.decisionId.split(":")[0],
	);
	const durable = JSON.parse(stored.content);
	assert.deepEqual(durable.firstApprover, actorAuthority);
	assert.deepEqual(durable.authorityHistory, [actorAuthority]);
	assert.deepEqual(durable.current.actor, {
		actorId: otherActor.actorId,
		authorityRevision: otherActor.authorityRevision,
	});
});

test("authorization and recovery reject unproven Linear membership", async () => {
	const decisions = service();
	const prepared = await decisions.prepare(request());
	for (const invalidActor of [
		{
			actorId: otherActor.actorId,
			authorityRevision: otherActor.authorityRevision,
			guest: false,
		},
		{
			actorId: otherActor.actorId,
			authorityRevision: otherActor.authorityRevision,
			active: true,
		},
		{ ...otherActor, active: false },
		{ ...otherActor, guest: true },
		{ ...otherActor, active: "yes" },
		{ ...otherActor, guest: "no" },
	]) {
		assert.equal(
			(await decisions.recover(scope, invalidActor)).blocker.code,
			"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
		);
		assert.equal(
			(
				await decisions.authorize(
					prepared.decisionId,
					approve,
					invalidActor,
				)
			).blocker.code,
			"PI_WORKFLOW_DECISION_ACTOR_MISMATCH",
		);
	}
});

test("another active member can cancel an active execution without inheriting authority", async () => {
	const decisions = service();
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	const cancelled = await decisions.recover(scope, otherActor, { kind: "cancel" });
	assert.equal(cancelled.kind, "cancelled");
	assert.equal(cancelled.receipt.actorId, otherActor.actorId);
	assert.equal(
		(await decisions.recover(scope, actor)).kind,
		"cancelled",
	);
});

test("replacement persists cancellation then revocation before preparing the successor", async () => {
	const backing = createInMemoryDecisionStore();
	const writes = [];
	const recordingStore = {
		read: (key) => backing.read(key),
		readRevision: (key, revision) => backing.readRevision(key, revision),
		async compareAndSwap(key, revision, content) {
			writes.push(JSON.parse(content));
			return backing.compareAndSwap(key, revision, content);
		},
	};
	const decisions = service({ store: recordingStore });
	const first = await decisions.prepare(request());
	await decisions.authorize(first.decisionId, approve, actor);
	const replacementRequest = request({
		operation: { ...request().operation, phase: "spec.replacement" },
	});
	const replaced = await decisions.recover(scope, otherActor, {
		kind: "replace",
		request: replacementRequest,
	});
	assert.equal(replaced.kind, "prepared");
	assert.notEqual(replaced.decisionId, first.decisionId);
	const cancellationIndex = writes.findIndex(
		(value) =>
			value.current.decisionId === first.decisionId &&
			value.current.state === "cancellation-tombstone",
	);
	const revocationIndex = writes.findIndex(
		(value) =>
			value.current.decisionId === first.decisionId &&
			value.current.state === "revoked",
	);
	const replacementIndex = writes.findIndex(
		(value) =>
			value.current.decisionId === replaced.decisionId &&
			value.current.state === "prepared",
	);
	assert.ok(cancellationIndex >= 0);
	assert.ok(revocationIndex > cancellationIndex);
	assert.ok(replacementIndex > revocationIndex);

	const reapproved = await decisions.authorize(
		replaced.decisionId,
		approve,
		otherActor,
	);
	assert.equal(reapproved.kind, "authorized");
	const stored = await backing.read(replaced.decisionId.split(":")[0]);
	const durable = JSON.parse(stored.content);
	assert.deepEqual(durable.firstApprover, actorAuthority);
	assert.deepEqual(durable.current.actor, {
		actorId: otherActor.actorId,
		authorityRevision: otherActor.authorityRevision,
	});
	assert.deepEqual(durable.authorityHistory, [actorAuthority]);
	assert.deepEqual(durable.history.slice(-2), [
		{ decisionId: first.decisionId, state: "cancelled" },
		{ decisionId: first.decisionId, state: "revoked" },
	]);
});

test("replacement cannot escape the recovered decision scope", async () => {
	const decisions = service();
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	const outcome = await decisions.recover(scope, actor, {
		kind: "replace",
		request: request({
			scope: { ...scope, subject: "another-definition" },
			operation: { ...request().operation, phase: "spec.replacement" },
		}),
	});
	assert.equal(outcome.blocker.code, "PI_WORKFLOW_DECISION_ACTION_MISMATCH");
	assert.equal((await decisions.recover(scope, actor)).kind, "authorized");
});

test("terminalization persists once and subsequent recovery is read-only", async () => {
	const decisions = service();
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	const terminal = await decisions.recover(scope, otherActor, {
		kind: "terminal",
		state: "completed",
	});
	assert.deepEqual(terminal, {
		kind: "terminal",
		decisionId: prepared.decisionId,
		state: "completed",
		currentApprover: actorAuthority,
	});
	assert.deepEqual(await decisions.recover(scope, actor), terminal);
});

test("workflow-reported drift revokes the lease and prepares a human diff decision", async () => {
	const backing = createInMemoryDecisionStore();
	const decisions = service({ store: backing });
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	const driftRequest = request({
		operation: { ...request().operation, phase: "spec.drifted" },
	});
	const humanDiff = {
		summary: "Linear changed after approval",
		details: ["Title changed from A to B"],
	};
	const drifted = await decisions.recover(scope, actor, {
		kind: "drift",
		request: driftRequest,
		diff: humanDiff,
	});
	assert.equal(drifted.kind, "drift");
	assert.notEqual(drifted.presentation.decisionId, prepared.decisionId);
	assert.deepEqual(drifted.diff, humanDiff);
	const stored = await backing.read(prepared.decisionId.split(":")[0]);
	assert.equal(stored.content.includes(humanDiff.summary), false);
	assert.equal(stored.content.includes(humanDiff.details[0]), false);
	assert.equal(
		(await decisions.authorize(prepared.decisionId, approve, actor)).blocker.code,
		"PI_WORKFLOW_DECISION_NOT_FOUND",
	);
});

test("parallel replacement adopts one cancellation, revocation, and successor", async () => {
	const backing = createInMemoryDecisionStore();
	const writes = [];
	const decisions = service({
		store: {
			read: (key) => backing.read(key),
			readRevision: (key, revision) => backing.readRevision(key, revision),
			async compareAndSwap(key, revision, content) {
				const saved = await backing.compareAndSwap(key, revision, content);
				writes.push(JSON.parse(content));
				return saved;
			},
		},
	});
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	const replacementRequest = request({
		operation: { ...request().operation, phase: "spec.concurrent-replacement" },
	});
	const outcomes = await Promise.all([
		decisions.recover(scope, actor, {
			kind: "replace",
			request: replacementRequest,
		}),
		decisions.recover(scope, actor, {
			kind: "replace",
			request: replacementRequest,
		}),
	]);
	assert.equal(outcomes.filter((outcome) => outcome.kind === "prepared").length, 2);
	assert.equal(
		writes.filter(
			(value) => value.current.state === "cancellation-tombstone",
		).length,
		1,
	);
	assert.equal(
		writes.filter((value) => value.current.state === "revoked").length,
		1,
	);
	assert.equal(
		writes.filter(
			(value) =>
				value.current.state === "prepared" &&
				value.current.decisionId !== prepared.decisionId,
		).length,
		1,
	);
	assert.equal(outcomes[0].decisionId, outcomes[1].decisionId);
});

test("replacement CAS loss returns a concurrent terminal state without overwriting it", async () => {
	const backing = createInMemoryDecisionStore();
	const terminalDecisions = service({ store: backing });
	let publishTerminal = false;
	let terminalWinner;
	const replacingDecisions = service({
		store: {
			read: (key) => backing.read(key),
			readRevision: (key, revision) => backing.readRevision(key, revision),
			async compareAndSwap(key, revision, content) {
				const attempted = JSON.parse(content);
				if (
					publishTerminal &&
					attempted.current.state === "cancellation-tombstone"
				) {
					publishTerminal = false;
					terminalWinner = await terminalDecisions.recover(scope, otherActor, {
						kind: "terminal",
						state: "completed",
					});
				}
				return backing.compareAndSwap(key, revision, content);
			},
		},
	});
	const prepared = await replacingDecisions.prepare(request());
	await replacingDecisions.authorize(prepared.decisionId, approve, actor);
	publishTerminal = true;
	const outcome = await replacingDecisions.recover(scope, otherActor, {
		kind: "replace",
		request: request({
			operation: { ...request().operation, phase: "spec.terminal-race" },
		}),
	});
	assert.equal(terminalWinner.kind, "terminal");
	assert.deepEqual(outcome, terminalWinner);
	assert.deepEqual(await replacingDecisions.recover(scope, actor), terminalWinner);
});

test("a late resume result cannot return a lease after replacement wins", async () => {
	let releaseLookup;
	let lookupEntered;
	const entered = new Promise((resolve) => {
		lookupEntered = resolve;
	});
	const released = new Promise((resolve) => {
		releaseLookup = resolve;
	});
	const decisions = service({
		manifestLookup: {
			async find() {
				lookupEntered();
				await released;
				return [];
			},
		},
	});
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);
	const lateResume = decisions.recover(scope, actor);
	await entered;
	const replaced = await decisions.recover(scope, otherActor, {
		kind: "replace",
		request: request({
			operation: { ...request().operation, phase: "spec.late-replacement" },
		}),
	});
	releaseLookup();
	assert.equal(replaced.kind, "prepared");
	assert.equal((await lateResume).blocker.code, "PI_WORKFLOW_DECISION_CAS_CONFLICT");
});

test("recover rejects corrupt durable bytes without mutation", async () => {
	const backing = createInMemoryDecisionStore();
	const decisions = service({ store: backing });
	const prepared = await decisions.prepare(request());
	await decisions.authorize(prepared.decisionId, approve, actor);

	const key = prepared.decisionId.split(":")[0];
	const current = await backing.read(key);
	await backing.compareAndSwap(key, current.revision, "{not-json}\n");
	await assert.rejects(() => decisions.recover(scope, actor), /not valid JSON/);
});
