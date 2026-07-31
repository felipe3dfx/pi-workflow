import assert from "node:assert/strict";
import test from "node:test";

import { createDefineProductMcpPublication } from "../extensions/define-product-mcp-publication.ts";
import { createProductSpecApprovalEnvelope, createProductSpecEnvelope } from "../extensions/product-spec.ts";

const owner = {
	actorId: "owner-1",
	role: "Owner",
	authorityRevision: "owner-r1",
};
const actor = {
	id: owner.actorId,
	name: "Owner",
	isActive: true,
	isGuest: false,
};

function approvedArtifact(overrides = {}) {
	const spec = createProductSpecEnvelope({
		definitionId: "definition-1",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Entrega canónica",
		},
		revision: "spec-r1",
		problem: "Problema exacto.",
		solution: "Solución exacta.",
		userStories: ["Como Owner, quiero publicar."],
		decisions: [
			{ id: "d1", status: "resolved", pertinent: true, text: "Publicar exactamente." },
		],
		tests: ["Leer exactamente."],
		outOfScope: ["Crear tickets."],
		supportArtifacts: [],
	});
	return {
		spec,
		approval: createProductSpecApprovalEnvelope({ spec, actor: owner }),
		sourceRevision: "approved-r1",
		...overrides,
	};
}

function issueFor(approved, overrides = {}) {
	return {
		id: "linear-uuid-1",
		identifier: "ILA-3000",
		team: { id: "team-1", name: "Grupo ilao" },
		title: approved.spec.payload.target.title,
		description: approved.spec.payload.body,
		status: { id: "backlog-1", name: "Backlog", type: "backlog" },
		assignee: null,
		assigneeId: null,
		cycle: null,
		cycleId: null,
		...overrides,
	};
}

function persistence(initial) {
	let state = initial ? structuredClone(initial) : undefined;
	return {
		get: () => structuredClone(state),
		store: {
			read: async () => {
				if (!state || state.stage === "released") return undefined;
				return {
					publicationDigest: state.publicationDigest,
					stage: state.stage,
					...(state.issueId ? { issueId: state.issueId } : {}),
				};
			},
			claim: async (identity, ownerId) => {
				if (state?.stage === "uncertain" && state.ownerId !== ownerId)
					throw new Error("claim already owned");
				state = { ...identity, stage: "uncertain", ownerId };
			},
			release: async (identity, ownerId) => {
				assert.equal(state.ownerId, ownerId);
				state = { ...identity, stage: "released", ownerId };
			},
			finalizeVerified: async (identity, issueId) => {
				state = { ...identity, stage: "verified", issueId };
			},
		},
	};
}

function harness({ approved = approvedArtifact(), recovery = persistence(), reader, active = true } = {}) {
	const snapshots = [];
	let cleared = 0;
	const controller = createDefineProductMcpPublication({
		approvedSpecReader: {
			read: reader ?? (async () => structuredClone(approved)),
		},
		owner,
		recovery: recovery.store,
		parentSnapshots: {
			persist: async (input) => {
				snapshots.push(structuredClone(input));
				return {
					kind: "engram",
					project: "pi-workflow",
					topic: "workflow/define-product/definition-1/published-parent",
					revision: "parent-r1",
					schema: "delivery-parent",
					schemaVersion: 1,
					digest: "parent-digest",
				};
			},
		},
		clearSpecApprovalRecovery: async () => {
			cleared += 1;
		},
	});
	controller.setMcpAvailable(active);
	let sequence = 0;
	async function begin() {
		const result = await controller.begin(
			"definition-1",
			"publish-start",
			{ action: "publish_spec" },
		);
		if (result.status === "continuing") {
			await controller.handleToolResult({
				toolName: "workflow_define_product",
				toolCallId: "publish-start",
				content: [{ type: "text", text: JSON.stringify(result) }],
				isError: false,
			});
		}
		return result;
	}
	async function call(payload, options = {}) {
		const expected = controller.expectedModelCall();
		assert.ok(expected, "expected a model call");
		sequence += 1;
		const event = {
			toolName: expected.toolName,
			toolCallId: options.toolCallId ?? `call-${sequence}`,
			input: structuredClone(expected.input),
		};
		const blocked = await controller.handleToolCall(event);
		if (blocked) return { expected, event, blocked };
		if (options.noResult) return { expected, event };
		const processed = await controller.handleToolResult({
			toolName: expected.toolName,
			toolCallId: event.toolCallId,
			content: [{ type: "text", text: JSON.stringify(payload) }],
			isError: options.isError === true,
		});
		return { expected, event, processed };
	}
	return {
		approved,
		controller,
		recovery,
		snapshots,
		get cleared() {
			return cleared;
		},
		begin,
		call,
	};
}

async function advanceToCandidates(h) {
	await h.call(actor);
	await h.call({
		teams: [{ id: "team-other", name: "Otro" }],
		hasNextPage: true,
		cursor: "teams-2",
	});
	assert.deepEqual(h.controller.expectedModelCall().input.cursor, "teams-2");
	await h.call({
		teams: [{ id: "team-1", name: "Grupo ilao" }],
		hasNextPage: false,
	});
	await h.call([{ id: "backlog-1", name: "Backlog", type: "backlog" }]);
}

async function advanceToSave(h) {
	await advanceToCandidates(h);
	await h.call({ issues: [], hasNextPage: true, cursor: "issues-2" });
	await h.call({ issues: [], hasNextPage: false });
	await h.call(actor);
}

async function finishReadback(h, issue, readback = issue) {
	await h.call(readback);
	await h.call({ issues: [], hasNextPage: true, cursor: "readback-2" });
	await h.call({ issues: [issue], hasNextPage: false });
	assert.deepEqual(h.controller.expectedModelCall(), {
		toolName: "workflow_define_product",
		input: { action: "publish_spec" },
	});
	return h.controller.complete({ action: "publish_spec" });
}

test("publishes one exact Backlog Delivery parent through authenticated paginated Linear MCP", async () => {
	const h = harness();
	assert.deepEqual(await h.begin(), { status: "continuing" });
	await advanceToSave(h);
	const issue = issueFor(h.approved);
	const save = await h.call(issue);
	assert.deepEqual(save.expected.input, {
		team: "team-1",
		title: "PI_WORKFLOW_CANONICAL_DELIVERY_PARENT_TITLE",
		description: "PI_WORKFLOW_CANONICAL_DELIVERY_PARENT_DESCRIPTION",
		state: "backlog-1",
	});
	assert.deepEqual(save.event.input, {
		team: "team-1",
		title: h.approved.spec.payload.target.title,
		description: h.approved.spec.payload.body,
		state: "backlog-1",
	});
	assert.equal(save.event.input.title.includes("pi-workflow-publication"), false);
	const { team: _team, status: _status, ...readback } = issue;
	const outcome = await finishReadback(h, issue, {
		...readback,
		status: "Backlog",
		statusType: "backlog",
	});
	assert.equal(outcome.status, "spec-published");
	assert.equal(outcome.parent.title, h.approved.spec.payload.target.title);
	assert.equal(outcome.parent.description, h.approved.spec.payload.body);
	assert.equal(outcome.parent.state, "Backlog");
	assert.equal(outcome.parent.assigneeId, null);
	assert.equal(outcome.parent.cycleId, null);
	assert.equal(h.snapshots.length, 1);
	assert.equal(h.cleared, 1);
	assert.equal(h.recovery.get().stage, "verified");
});

test("durable uncertain restart performs lookup only and never duplicates", async () => {
	const recovery = persistence();
	const interrupted = harness({ recovery });
	await interrupted.begin();
	await advanceToSave(interrupted);
	const save = await interrupted.call(
		{ code: "TRANSPORT_ERROR", message: "uncertain" },
		{ isError: true },
	);
	assert.equal(save.event.toolName, "linear_save_issue");
	assert.equal(recovery.get().stage, "uncertain");
	assert.equal((await interrupted.controller.complete({ action: "publish_spec" })).status, "blocked");

	const emptyRestart = harness({ recovery });
	await emptyRestart.begin();
	await advanceToCandidates(emptyRestart);
	await emptyRestart.call({ issues: [], hasNextPage: false });
	const pending = await emptyRestart.controller.complete({ action: "publish_spec" });
	assert.equal(pending.blocker.code, "PI_WORKFLOW_PUBLICATION_RECOVERY_PENDING");
	assert.equal(emptyRestart.controller.expectedModelCall(), undefined);

	const recovered = harness({ recovery });
	await recovered.begin();
	await advanceToCandidates(recovered);
	const issue = issueFor(recovered.approved);
	const adoption = await recovered.call({ issues: [issue], hasNextPage: false });
	assert.equal(adoption.event.toolName, "linear_list_issues");
	assert.equal(recovered.controller.expectedModelCall().toolName, "linear_get_issue");
	const outcome = await finishReadback(recovered, issue);
	assert.equal(outcome.status, "spec-published");
	assert.equal(recovery.get().issueId, issue.id);
});

test("fails closed on auth, team, Backlog, duplicate, and conflicting candidates", async (t) => {
	await t.test("actor mismatch", async () => {
		const h = harness();
		await h.begin();
		await h.call({ ...actor, id: "attacker" });
		assert.equal(
			(await h.controller.complete({ action: "publish_spec" })).blocker.code,
			"PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
		);
	});
	await t.test("team ambiguity", async () => {
		const h = harness();
		await h.begin();
		await h.call(actor);
		await h.call({
			teams: [
				{ id: "team-1", name: "Grupo ilao" },
				{ id: "team-1", name: "Duplicado" },
			],
			hasNextPage: false,
		});
		assert.equal(
			(await h.controller.complete({ action: "publish_spec" })).blocker.code,
			"PI_WORKFLOW_DEFINE_PRODUCT_TEAM_AMBIGUOUS",
		);
	});
	await t.test("Backlog ambiguity", async () => {
		const h = harness();
		await h.begin();
		await h.call(actor);
		await h.call({ teams: [{ id: "team-1", name: "Grupo ilao" }], hasNextPage: false });
		await h.call([]);
		assert.equal(
			(await h.controller.complete({ action: "publish_spec" })).blocker.code,
			"PI_WORKFLOW_DEFINE_PRODUCT_BACKLOG_AMBIGUOUS",
		);
	});
	for (const [name, issues] of [
		["duplicate", (approved) => [issueFor(approved), issueFor(approved, { id: "linear-uuid-2" })]],
		["conflict", (approved) => [issueFor(approved, { description: "distinta" })]],
	]) {
		await t.test(name, async () => {
			const h = harness();
			await h.begin();
			await advanceToCandidates(h);
			await h.call({ issues: issues(h.approved), hasNextPage: false });
			assert.equal(
				(await h.controller.complete({ action: "publish_spec" })).blocker.code,
				"PI_WORKFLOW_PUBLICATION_DUPLICATE",
			);
		});
	}
});

test("reauthenticates and rereads the exact approved artifact immediately before mutation", async () => {
	const original = approvedArtifact();
	let current = original;
	const h = harness({
		approved: original,
		reader: async () => structuredClone(current),
	});
	await h.begin();
	await advanceToSave(h);
	current = { ...original, sourceRevision: "approved-r2" };
	const expected = h.controller.expectedModelCall();
	assert.equal(expected.toolName, "linear_save_issue");
	const blockedCall = await h.controller.handleToolCall({
		toolName: expected.toolName,
		toolCallId: "drifted-save",
		input: structuredClone(expected.input),
	});
	assert.equal(blockedCall.block, true);
	assert.equal(blockedCall.reason, "PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT");
	assert.equal(h.recovery.get(), undefined);
});

test("blocks missing tools, malformed results, lateral mutation, and parallel calls", async (t) => {
	await t.test("missing tools", async () => {
		const h = harness({ active: false });
		const outcome = await h.begin();
		assert.equal(outcome.status, "blocked");
		assert.equal(
			outcome.blocker.code,
			"PI_WORKFLOW_DEFINE_PRODUCT_MCP_UNAVAILABLE",
		);
	});
	await t.test("malformed result", async () => {
		const h = harness();
		await h.begin();
		await h.call({ id: "owner-1" });
		assert.equal(
			(await h.controller.complete({ action: "publish_spec" })).blocker.code,
			"PI_WORKFLOW_DEFINE_PRODUCT_AUTHORITY_MISMATCH",
		);
	});
	await t.test("lateral mutation", async () => {
		const h = harness();
		await h.begin();
		const outcome = await h.controller.handleToolCall({
			toolName: "linear_save_issue",
			toolCallId: "lateral",
			input: { id: "ILA-1", state: "Done" },
		});
		assert.equal(outcome.block, true);
		assert.equal(outcome.reason, "PI_WORKFLOW_DEFINE_PRODUCT_MCP_PROTOCOL_INVALID");
	});
	await t.test("parallel starts", async () => {
		let release;
		const pending = new Promise((resolve) => {
			release = resolve;
		});
		const artifact = approvedArtifact();
		const h = harness({
			approved: artifact,
			reader: async () => {
				await pending;
				return structuredClone(artifact);
			},
		});
		const first = h.controller.begin(
			"definition-1",
			"parallel-start-1",
			{ action: "publish_spec" },
		);
		const second = await h.controller.begin(
			"definition-1",
			"parallel-start-2",
			{ action: "publish_spec" },
		);
		assert.equal(second.status, "blocked");
		release();
		assert.equal((await first).status, "continuing");
	});
	await t.test("parallel calls", async () => {
		const h = harness();
		await h.begin();
		const expected = h.controller.expectedModelCall();
		const first = h.controller.handleToolCall({
			toolName: expected.toolName,
			toolCallId: "parallel-1",
			input: structuredClone(expected.input),
		});
		const second = h.controller.handleToolCall({
			toolName: expected.toolName,
			toolCallId: "parallel-2",
			input: structuredClone(expected.input),
		});
		assert.equal(await first, undefined);
		assert.equal((await second).block, true);
	});
});
