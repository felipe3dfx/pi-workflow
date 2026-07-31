import assert from "node:assert/strict";
import test from "node:test";

import { createDefineProductTicketMcpPublication } from "../extensions/define-product-ticket-mcp-publication.ts";
import { createTicketPublicationManifestStore } from "../extensions/ticket-publication-manifest.ts";

const definitionId = "definition-tickets";
const owner = { actorId: "owner-1", role: "Owner", authorityRevision: "owner-r1" };
const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1", specDigest: "s".repeat(64) };
const approved = {
	spec: {
		digest: parent.specDigest,
		payload: {
			definitionId,
			target: { kind: "linear-parent-description", teamId: parent.teamId, title: "Entrega canónica" },
			body: "Descripción canónica aprobada.",
		},
	},
};
const ticket = (stableKey, title, blockers = []) => ({
	stableKey,
	title,
	outcome: `Resultado de ${stableKey}.`,
	acceptanceCriteria: [`Criterio de ${stableKey}.`],
	estimate: { points: stableKey === "T-1" ? 1 : 2, rationale: "Estimación aprobada." },
	blockers,
	refs: [],
	deliveryBindings: [],
});
const graph = {
	schema: "delivery-ticket-graph",
	schemaVersion: 1,
	digest: "b".repeat(64),
	payload: {
		parent,
		coverage: { stories: [], decisions: [], tests: [] },
		language: "es",
		tickets: [ticket("T-2", "Segundo", ["T-1"]), ticket("T-1", "Primero")],
	},
};
const publication = {
	definitionId,
	approvedSpecRef: { kind: "engram", project: "pi-workflow", topic: "spec", revision: "1", schema: "approved-spec", schemaVersion: 1, digest: approved.spec.digest },
	parentRef: { kind: "engram", project: "pi-workflow", topic: "parent", revision: "2", schema: "delivery-parent", schemaVersion: 1, digest: "p".repeat(64) },
	graphRef: { kind: "engram", project: "pi-workflow", topic: "graph", revision: "3", schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest },
	graphParent: parent,
	approval: {
		schema: "delivery-ticket-graph-approval",
		schemaVersion: 1,
		digest: "a".repeat(64),
		payload: { actor: owner, parent, graphDigest: graph.digest },
	},
};

function memory() {
	let current;
	let revision = 0;
	return {
		value: () => current?.value,
		read: async () => current,
		create: async (value) => {
			if (current) throw new Error("already exists");
			current = { revision: `r${++revision}`, value: structuredClone(value) };
			return structuredClone(current);
		},
		compareAndSwap: async (expected, value) => {
			if (!current || current.revision !== expected) throw new Error("compare-and-swap conflict");
			current = { revision: `r${++revision}`, value: structuredClone(value) };
			return structuredClone(current);
		},
	};
}

function fixture({
	actorId = owner.actorId,
	publicationValue = publication,
	graphValue = graph,
	ownerValue = owner,
} = {}) {
	const persistence = memory();
	const ownerAuthority = ownerValue && structuredClone(ownerValue);
	const issues = new Map();
	const blockedBy = new Map();
	const saveInputs = [];
	const toolCalls = [];
	const parentIssue = {
		id: parent.id,
		teamId: parent.teamId,
		title: approved.spec.payload.target.title,
		description: approved.spec.payload.body,
		updatedAt: "2026-07-31T03:06:06.158Z",
		status: { id: "backlog-1", name: "Backlog", type: "backlog" },
	};
	const dependencies = {
		approvedPublications: { read: async () => structuredClone(publicationValue) },
		approvedSpecReader: { read: async () => structuredClone(approved) },
		recoverGraph: async () => structuredClone(graphValue),
		manifest: createTicketPublicationManifestStore({ persistence }),
		...(ownerAuthority ? { owner: ownerAuthority } : {}),
	};
	const responseFor = (expected) => {
		if (expected.toolName === "linear_get_user") return { id: actorId, name: "Owner", isActive: true, isGuest: false };
		if (expected.toolName === "linear_list_issue_statuses") return [{ id: "triage-1", name: "Triage", type: "triage" }];
		if (expected.toolName === "linear_list_issues") {
			return { issues: [...issues.values()].filter((issue) => !expected.input.query || issue.title.includes(expected.input.query)), hasNextPage: false };
		}
		if (expected.toolName === "linear_get_issue") {
			if (expected.input.id === parent.id) return parentIssue;
			const issue = issues.get(expected.input.id);
			const reverse = [...blockedBy.entries()].filter(([, ids]) => ids.includes(issue.id)).map(([id]) => id);
			return {
				...issue,
				relations: {
					blockedBy: (blockedBy.get(issue.id) ?? []).map((id) => ({ id })),
					blocks: reverse.map((id) => ({ id })),
				},
			};
		}
		throw new Error(`No response for ${expected.toolName}`);
	};
	return {
		persistence,
		dependencies,
		issues,
		blockedBy,
		saveInputs,
		toolCalls,
		parentIssue,
		ownerAuthority,
		responseFor,
	};
}

async function issue(controller, expected, payload, sequence, calls) {
	const event = { toolName: expected.toolName, toolCallId: `call-${sequence}`, input: structuredClone(expected.input) };
	calls?.push(structuredClone(event));
	assert.equal(await controller.handleToolCall(event), undefined);
	await controller.handleToolResult({
		toolName: expected.toolName,
		toolCallId: event.toolCallId,
		content: [{ type: "text", text: JSON.stringify(payload) }],
		isError: false,
	});
	return event;
}

async function drive(
	controller,
	state,
	{ stopBeforeSave = false, stopBeforeRelationSave = false } = {},
) {
	let sequence = 1;
	for (;;) {
		const expected = controller.expectedModelCall();
		assert.ok(expected, "publication must expose its next exact call");
		if (expected.toolName === "workflow_define_product") return controller.complete({ action: "publish_tickets" });
		if (stopBeforeSave && expected.toolName === "linear_save_issue")
			return { expected, sequence };
		if (
			stopBeforeRelationSave &&
			expected.toolName === "linear_save_issue" &&
			Object.hasOwn(expected.input, "id")
		)
			return { expected, sequence };
		if (expected.toolName === "linear_save_issue") {
			const event = { toolName: expected.toolName, toolCallId: `call-${sequence++}`, input: structuredClone(expected.input) };
			state.toolCalls.push(structuredClone(event));
			assert.equal(await controller.handleToolCall(event), undefined);
			state.saveInputs.push(structuredClone(event.input));
			if (Object.hasOwn(event.input, "parentId")) {
				const created = {
					id: `child-${state.issues.size + 1}`,
					teamId: event.input.team,
					parentId: event.input.parentId,
					title: event.input.title,
					description: event.input.description,
					estimate: event.input.estimate,
					status: { id: event.input.state, name: "Triage", type: "triage" },
					assigneeId: null,
					cycleId: null,
					labels: [],
					projectId: null,
				};
				state.issues.set(created.id, created);
				await controller.handleToolResult({ toolName: expected.toolName, toolCallId: event.toolCallId, content: [{ type: "text", text: JSON.stringify({ id: created.id }) }], isError: false });
			} else {
				state.blockedBy.set(event.input.id, [...(state.blockedBy.get(event.input.id) ?? []), ...event.input.blockedBy]);
				await controller.handleToolResult({ toolName: expected.toolName, toolCallId: event.toolCallId, content: [{ type: "text", text: JSON.stringify({ id: event.input.id }) }], isError: false });
			}
			continue;
		}
		await issue(controller, expected, state.responseFor(expected), sequence++, state.toolCalls);
	}
}

async function start(controller) {
	assert.deepEqual(await controller.begin(definitionId, "workflow-start", { action: "publish_tickets" }), { status: "continuing" });
	await controller.handleToolResult({ toolName: "workflow_define_product", toolCallId: "workflow-start", content: [{ type: "text", text: JSON.stringify({ status: "continuing" }) }], isError: false });
}

test("publishes the exact two-ticket graph and native blocker through rewritten Linear MCP inputs", async () => {
	const state = fixture();
	const controller = createDefineProductTicketMcpPublication(state.dependencies);
	await start(controller);
	assert.deepEqual(await drive(controller, state), { status: "tickets-published", definitionId });
	assert.equal(state.saveInputs.length, 3);
	assert.deepEqual(state.saveInputs.slice(0, 2).map(({ title, description, estimate, state: status, ...workflow }) => ({ title, description, estimate, status, workflow })), [
		{
			title: "Primero",
			description: "Resultado\n\nResultado de T-1.\n\nCriterios de aceptación\n\n- Criterio de T-1.",
			estimate: 1,
			status: "triage-1",
			workflow: { team: "team-1", parentId: "parent-1", assignee: null, cycle: null, labels: [], project: null },
		},
		{
			title: "Segundo",
			description: "Resultado\n\nResultado de T-2.\n\nCriterios de aceptación\n\n- Criterio de T-2.",
			estimate: 2,
			status: "triage-1",
			workflow: { team: "team-1", parentId: "parent-1", assignee: null, cycle: null, labels: [], project: null },
		},
	]);
	assert.deepEqual(state.saveInputs[2], {
		id: "child-2",
		blockedBy: ["child-1"],
	});
	for (const input of state.saveInputs.slice(0, 2)) {
		assert.doesNotMatch(input.title, /pi-workflow|operationId|stableKey|T-[12]/i);
		assert.equal(input.title, input.title === "Primero" ? "Primero" : "Segundo");
	}
	assert.equal(state.persistence.value().stage, "verified");
	assert.equal(
		state.toolCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
		1,
	);
});

test("default single-user ticket publication keeps historical approval authority as provenance", async () => {
	const state = fixture({ actorId: "current-single-user", ownerValue: null });
	const controller = createDefineProductTicketMcpPublication(state.dependencies);
	await start(controller);
	const outcome = await drive(controller, state);
	assert.equal(outcome.status, "tickets-published");
	assert.equal(publication.approval.payload.actor.authorityRevision, "owner-r1");
	assert.equal(
		state.toolCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
		1,
	);
});

test("restart resolves a durable child mutation receipt without duplicate creation", async () => {
	const state = fixture();
	const first = createDefineProductTicketMcpPublication(state.dependencies);
	await start(first);
	const stopped = await drive(first, state, { stopBeforeSave: true });
	const event = { toolName: stopped.expected.toolName, toolCallId: "interrupted-child", input: structuredClone(stopped.expected.input) };
	assert.equal(await first.handleToolCall(event), undefined);
	state.saveInputs.push(structuredClone(event.input));
	state.issues.set("child-1", {
		id: "child-1", teamId: "team-1", parentId: "parent-1", title: event.input.title,
		description: event.input.description, estimate: event.input.estimate,
		status: { id: "triage-1", name: "Triage", type: "triage" }, assigneeId: null, cycleId: null, labels: [], projectId: null,
	});
	assert.equal(state.persistence.value().pendingMutation.kind, "child");

	const restarted = createDefineProductTicketMcpPublication(state.dependencies);
	await start(restarted);
	assert.deepEqual(await drive(restarted, state), { status: "tickets-published", definitionId });
	assert.equal(
		state.saveInputs.filter(
			(input) => Object.hasOwn(input, "parentId") && input.title === "Primero",
		).length,
		1,
	);
});

test("restart proves an interrupted relation by readback without duplicate mutation", async () => {
	const state = fixture();
	const first = createDefineProductTicketMcpPublication(state.dependencies);
	await start(first);
	const stopped = await drive(first, state, { stopBeforeRelationSave: true });
	const event = {
		toolName: stopped.expected.toolName,
		toolCallId: "interrupted-relation",
		input: structuredClone(stopped.expected.input),
	};
	assert.equal(await first.handleToolCall(event), undefined);
	state.saveInputs.push(structuredClone(event.input));
	state.blockedBy.set(event.input.id, [...event.input.blockedBy]);
	assert.equal(state.persistence.value().pendingMutation.kind, "relation");
	assert.equal(state.persistence.value().relations.length, 0);

	const restarted = createDefineProductTicketMcpPublication(state.dependencies);
	await start(restarted);
	assert.deepEqual(await drive(restarted, state), {
		status: "tickets-published",
		definitionId,
	});
	assert.equal(
		state.saveInputs.filter((input) => Object.hasOwn(input, "blockedBy")).length,
		1,
	);
});

test("keeps child mutation pending until exact direct readback", async () => {
	const state = fixture();
	const controller = createDefineProductTicketMcpPublication(state.dependencies);
	await start(controller);
	const stopped = await drive(controller, state, { stopBeforeSave: true });
	const event = {
		toolName: stopped.expected.toolName,
		toolCallId: "child-save-proof",
		input: structuredClone(stopped.expected.input),
	};
	assert.equal(await controller.handleToolCall(event), undefined);
	state.issues.set("child-proof", {
		id: "child-proof",
		teamId: event.input.team,
		parentId: event.input.parentId,
		title: event.input.title,
		description: event.input.description,
		estimate: event.input.estimate,
		status: { id: event.input.state, name: "Triage", type: "triage" },
		assigneeId: null,
		cycleId: null,
		labels: [],
		projectId: null,
	});
	assert.equal(
		await controller.handleToolResult({
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			content: [{ type: "text", text: JSON.stringify({ id: "child-proof" }) }],
			isError: false,
		}),
		true,
	);
	assert.equal(state.persistence.value().pendingMutation.kind, "child");
	assert.deepEqual(state.persistence.value().children, []);
	assert.deepEqual(controller.expectedModelCall(), {
		toolName: "linear_get_issue",
		input: { id: "child-proof", includeRelations: true },
	});
});

test("serializes concurrent calls and results and ignores late generations", async (t) => {
	await t.test("concurrent mutation calls", async () => {
		const state = fixture();
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		await start(controller);
		const stopped = await drive(controller, state, { stopBeforeSave: true });
		const originalRead = state.dependencies.approvedPublications.read;
		let enteredResolve;
		let releaseResolve;
		const entered = new Promise((resolve) => {
			enteredResolve = resolve;
		});
		const release = new Promise((resolve) => {
			releaseResolve = resolve;
		});
		state.dependencies.approvedPublications.read = async (...args) => {
			enteredResolve();
			await release;
			return originalRead(...args);
		};
		const firstEvent = {
			toolName: stopped.expected.toolName,
			toolCallId: "concurrent-save-1",
			input: structuredClone(stopped.expected.input),
		};
		const secondEvent = {
			toolName: stopped.expected.toolName,
			toolCallId: "concurrent-save-2",
			input: structuredClone(stopped.expected.input),
		};
		const first = controller.handleToolCall(firstEvent);
		await entered;
		const second = controller.handleToolCall(secondEvent);
		releaseResolve();
		assert.equal(await first, undefined);
		assert.deepEqual(await second, {
			block: true,
			reason: "PI_WORKFLOW_TICKET_MCP_PROTOCOL_INVALID",
		});
		assert.equal(state.persistence.value().pendingMutation.kind, "child");
		assert.equal(firstEvent.input.title, "Primero");
		assert.equal(
			secondEvent.input.title,
			"PI_WORKFLOW_CANONICAL_DELIVERY_TICKET_TITLE",
		);
	});

	await t.test("concurrent duplicate results", async () => {
		const state = fixture();
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		assert.deepEqual(
			await controller.begin(definitionId, "concurrent-result-start", {
				action: "publish_tickets",
			}),
			{ status: "continuing" },
		);
		const result = {
			toolName: "workflow_define_product",
			toolCallId: "concurrent-result-start",
			content: [{ type: "text", text: JSON.stringify({ status: "continuing" }) }],
			isError: false,
		};
		assert.deepEqual(
			await Promise.all([
				controller.handleToolResult(structuredClone(result)),
				controller.handleToolResult(structuredClone(result)),
			]),
			[true, false],
		);
		assert.equal(controller.expectedModelCall().toolName, "linear_get_user");
	});

	await t.test("late result after clear and new begin", async () => {
		const state = fixture();
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		await start(controller);
		const expected = controller.expectedModelCall();
		const oldCall = {
			toolName: expected.toolName,
			toolCallId: "old-generation-actor",
			input: structuredClone(expected.input),
		};
		assert.equal(await controller.handleToolCall(oldCall), undefined);
		controller.clear();
		assert.deepEqual(
			await controller.begin(definitionId, "new-generation-start", {
				action: "publish_tickets",
			}),
			{ status: "continuing" },
		);
		assert.equal(
			await controller.handleToolResult({
				toolName: oldCall.toolName,
				toolCallId: oldCall.toolCallId,
				content: [
					{
						type: "text",
						text: JSON.stringify({
							id: owner.actorId,
							name: "Owner",
							isActive: true,
							isGuest: false,
						}),
					},
				],
				isError: false,
			}),
			false,
		);
		assert.equal(controller.expectedModelCall(), undefined);
		assert.equal(
			await controller.handleToolResult({
				toolName: "workflow_define_product",
				toolCallId: "new-generation-start",
				content: [
					{ type: "text", text: JSON.stringify({ status: "continuing" }) },
				],
				isError: false,
			}),
			true,
		);
		assert.equal(controller.expectedModelCall().toolName, "linear_get_user");
	});
});

test("enforces explicit compatibility authority and rejects malformed mixed status entries", async (t) => {
	await t.test("compatibility authorityRevision drift before mutation", async () => {
		const state = fixture();
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		await start(controller);
		const stopped = await drive(controller, state, { stopBeforeSave: true });
		state.ownerAuthority.authorityRevision = "owner-r2";
		const event = {
			toolName: stopped.expected.toolName,
			toolCallId: "stale-owner-save",
			input: structuredClone(stopped.expected.input),
		};
		assert.deepEqual(await controller.handleToolCall(event), {
			block: true,
			reason: "PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT",
		});
		assert.equal(state.persistence.value().pendingMutation, undefined);
		assert.deepEqual(state.saveInputs, []);
	});

	await t.test("mixed malformed statuses", async () => {
		const state = fixture();
		const original = state.responseFor;
		state.responseFor = (expected) =>
			expected.toolName === "linear_list_issue_statuses"
				? [
						{ id: "triage-1", name: "Triage", type: "triage" },
						{ name: "Backlog", type: "backlog" },
					]
				: original(expected);
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		await start(controller);
		const outcome = await drive(controller, state);
		assert.equal(outcome.blocker.code, "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		assert.deepEqual(state.saveInputs, []);
	});
});

test("refuses invalid users, malformed Triage evidence, and conflicting child discovery before mutation", async (t) => {
	for (const [name, actorPayload] of [
		["compatibility actor mismatch", { id: "other-owner", name: "Owner", isActive: true, isGuest: false }],
		["inactive user", { id: owner.actorId, name: "Owner", isActive: false, isGuest: false }],
		["guest user", { id: owner.actorId, name: "Owner", isActive: true, isGuest: true }],
		["malformed user", { id: owner.actorId, isActive: true, isGuest: false }],
	]) {
		await t.test(name, async () => {
			const state = fixture();
			const original = state.responseFor;
			state.responseFor = (expected) =>
				expected.toolName === "linear_get_user"
					? actorPayload
					: original(expected);
			const controller = createDefineProductTicketMcpPublication(state.dependencies);
			await start(controller);
			const outcome = await drive(controller, state);
			assert.equal(outcome.blocker.code, "PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT");
			assert.deepEqual(state.saveInputs, []);
			assert.equal(
				state.toolCalls.filter(({ toolName }) => toolName === "linear_get_user").length,
				1,
			);
		});
	}
	await t.test("malformed", async () => {
		const state = fixture();
		const original = state.responseFor;
		state.responseFor = (expected) => expected.toolName === "linear_list_issue_statuses" ? [{ id: "triage-1", name: "Triage", type: "backlog" }] : original(expected);
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		await start(controller);
		const outcome = await drive(controller, state);
		assert.equal(outcome.blocker.code, "PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN");
		assert.deepEqual(state.saveInputs, []);
	});
	await t.test("conflict", async () => {
		const state = fixture();
		const original = state.responseFor;
		state.responseFor = (expected) => expected.toolName === "linear_list_issues"
			? {
					issues: [{ id: "wrong", title: expected.input.query }],
					hasNextPage: false,
				}
			: original(expected);
		const controller = createDefineProductTicketMcpPublication(state.dependencies);
		await start(controller);
		const outcome = await drive(controller, state);
		assert.equal(outcome.blocker.code, "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT");
		assert.deepEqual(state.saveInputs, []);
	});
});
