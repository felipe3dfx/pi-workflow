import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeLinearDeliveryTicketGateway } from "../extensions/runtime-linear-delivery-ticket.ts";
import { createTicketPublicationAuthorityGuard } from "../extensions/ticket-publication-authority-guard.ts";

const operationId = "a".repeat(64);
const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1" };
const marker = (key) => `[pi-workflow-ticket:${operationId}:${key}]`;
const issue = (key, id = `child-${key}`) => ({
	id,
	title: `${key} ${marker(key)}`,
	description: "Body",
	estimate: 3,
	team: { id: "team-1" },
	parent: { id: "parent-1" },
	state: { name: "Triage", type: "triage" },
	assignee: null,
	cycle: null,
	labels: { nodes: [] },
	project: null,
	blockedBy: { nodes: [] },
	blocks: { nodes: [] },
});
const fields =
	"id title description estimate team{id} parent{id} state{id name type} assignee{id} cycle{id} labels{nodes{id}} project{id} blockedBy{nodes{issue{id title} relatedIssue{id title}}} blocks{nodes{issue{id title} relatedIssue{id title}}}";

function runtime(respond) {
	const requests = [];
	let findCalls = 0;
	return {
		requests,
		gateway: createRuntimeLinearDeliveryTicketGateway({
			apiKey: "key",
			fetch: async (_url, init) => {
				const request = JSON.parse(String(init.body));
				requests.push(request);
				const response = respond?.(request);
				if (response) return response;
				if (request.operationName === "DeliveryTicketFind" && ++findCalls > 1) {
					const stableKey = request.variables.marker.match(/:([^:]+)]$/)[1];
					return Response.json({
						data: { issues: { nodes: [issue(stableKey)] } },
					});
				}
				const data = {
					DeliveryTicketAuthority: {
						viewer: { id: "owner-1", permissions: { issueCreate: true } },
						team: {
							id: "team-1",
							cyclesEnabled: true,
							states: {
								nodes: [
									{
										id: "triage-1",
										name: "Triage",
										type: "triage",
										updatedAt: "r1",
									},
								],
							},
						},
						issue: {
							...parent,
							description: "Spec",
							updatedAt: "parent-r1",
							team: { id: "team-1" },
							state: { type: "backlog" },
							estimate: null,
							children: { nodes: [] },
						},
						issueRelations: { nodes: [] },
					},
					DeliveryTicketFind: { issues: { nodes: [] } },
					DeliveryTicketBlockerFind: { issueRelations: { nodes: [] } },
					DeliveryTicketCreate: {
						issueCreate: { success: true, issue: issue("T-1") },
					},
					DeliveryTicketBlockerCreate: {
						issueRelationCreate: { success: true },
					},
					DeliveryTicketReadBack: {
						issue: {
							...parent,
							team: { id: "team-1" },
							children: { nodes: [issue("T-1")] },
						},
					},
				};
				return Response.json({ data: data[request.operationName] });
			},
		}),
	};
}

test("maps closed authority, marker, creation, blocker, and read-back operations", async () => {
	const { gateway, requests } = runtime();
	const trustedParent = { ...parent, specDigest: "b".repeat(64) };
	const authority = await gateway.readAuthoritySnapshot({
		definitionId: "definition-1",
		artifact: { approvedDigest: "approved", graphDigest: "graph" },
		approval: { ownerId: "owner-1", role: "Owner", digest: "approval" },
		authorityRevision: "authority-r1",
		parent: trustedParent,
		expectedParentDescription: "Spec",
	});
	assert.deepEqual(authority.parent, trustedParent);
	assert.equal(authority.mutationPermission, true);
	assert.match(
		requests[0].query,
		/viewer\s*\{\s*id\s+permissions\s*\{\s*issueCreate\s*}/,
	);
	assert.deepEqual(
		await gateway.findChildren({ operationId, parent, stableKey: "T-1" }),
		[],
	);
	assert.deepEqual(
		await gateway.findBlockers({
			operationId,
			parent,
			blockedStableKey: "T-2",
			blockingStableKey: "T-1",
		}),
		[],
	);
	assert.deepEqual(
		await gateway.createChild({
			operationId,
			parent,
			child: {
				stableKey: "T-1",
				title: "T-1",
				body: "Body",
				estimate: 3,
				workflow: {
					state: "Triage",
					assignee: null,
					cycle: null,
					labels: [],
					project: null,
				},
			},
		}),
		{ stableKey: "T-1", linearId: "child-T-1" },
	);
	await gateway.createBlocker({
		operationId,
		parent,
		blockedStableKey: "T-2",
		blockingStableKey: "T-1",
	});
	assert.deepEqual(await gateway.readBack({ operationId, parent }), {
		parent,
		children: [
			{
				stableKey: "T-1",
				title: "T-1",
				body: "Body",
				estimate: 3,
				workflow: {
					state: "Triage",
					assignee: null,
					cycle: null,
					labels: [],
					project: null,
				},
				linearId: "child-T-1",
				blockedBy: [],
				blocks: [],
			},
		],
	});
	assert.deepEqual(
		requests.find(
			(request) => request.operationName === "DeliveryTicketCreate",
		),
		{
			operationName: "DeliveryTicketCreate",
			query: `mutation DeliveryTicketCreate($input:IssueCreateInput!){issueCreate(input:$input){success issue{${fields}}}}`,
			variables: {
				input: {
					teamId: "team-1",
					parentId: "parent-1",
					stateId: "triage-1",
					title: `T-1 ${marker("T-1")}`,
					description: "Body",
					estimate: 3,
				},
			},
		},
	);
	assert.deepEqual(
		requests.find(
			(request) => request.operationName === "DeliveryTicketBlockerCreate",
		),
		{
			operationName: "DeliveryTicketBlockerCreate",
			query:
				"mutation DeliveryTicketBlockerCreate($input:IssueRelationCreateInput!){issueRelationCreate(input:$input){success}}",
			variables: {
				input: {
					issueId: "child-T-1",
					relatedIssueId: "child-T-2",
					type: "blocks",
				},
			},
		},
	);
	assert.deepEqual(
		requests.find(
			(request) => request.operationName === "DeliveryTicketAuthority",
		),
		{
			operationName: "DeliveryTicketAuthority",
			query:
				"query DeliveryTicketAuthority($teamId:ID!,$parentId:String!){viewer{id permissions{issueCreate}} team(id:$teamId){id cyclesEnabled states{nodes{id name type updatedAt}}} issue(id:$parentId){id description updatedAt team{id} state{type} estimate children{nodes{id}}} issueRelations(first:1){nodes{id}}}",
			variables: { teamId: "team-1", parentId: "parent-1" },
		},
	);
	assert.deepEqual(
		requests
			.filter((request) => request.operationName === "DeliveryTicketFind")
			.map((request) => ({
				query: request.query,
				variables: request.variables,
			})),
		[
			{
				query:
					"query DeliveryTicketFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{id title}}}",
				variables: { teamId: "team-1", marker: marker("T-1") },
			},
			{
				query:
					"query DeliveryTicketFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{id title}}}",
				variables: { teamId: "team-1", marker: marker("T-2") },
			},
			{
				query:
					"query DeliveryTicketFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{id title}}}",
				variables: { teamId: "team-1", marker: marker("T-1") },
			},
			{
				query:
					"query DeliveryTicketFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{id title}}}",
				variables: { teamId: "team-1", marker: marker("T-2") },
			},
			{
				query:
					"query DeliveryTicketFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{id title}}}",
				variables: { teamId: "team-1", marker: marker("T-1") },
			},
		],
	);
	assert.deepEqual(
		requests.find(
			(request) => request.operationName === "DeliveryTicketBlockerFind",
		),
		{
			operationName: "DeliveryTicketBlockerFind",
			query:
				"query DeliveryTicketBlockerFind($first:ID!,$second:ID!){issueRelations(filter:{issue:{id:{eq:$first}},relatedIssue:{id:{eq:$second}},type:{eq:blocks}}){nodes{issue{id} relatedIssue{id} type}}}",
			variables: { first: "child-T-1", second: "child-T-2" },
		},
	);
	assert.deepEqual(
		requests.find(
			(request) => request.operationName === "DeliveryTicketReadBack",
		),
		{
			operationName: "DeliveryTicketReadBack",
			query: `query DeliveryTicketReadBack($id:String!){issue(id:$id){id team{id} children{nodes{${fields}}}}}`,
			variables: { id: "parent-1" },
		},
	);
});

test("requires explicit issue-create permission evidence before the authority guard permits mutation", async () => {
	// Contract assumption: the authority response exposes viewer.permissions.issueCreate as mutation evidence.
	for (const [evidence, permission] of [
		[{ issueCreate: false }, false],
		[undefined, false],
		[{ issueCreate: "unknown" }, false],
	]) {
		const { gateway, requests } = runtime((request) =>
			request.operationName === "DeliveryTicketAuthority"
				? Response.json({
						data: {
							viewer: {
								id: "owner-1",
								...(evidence === undefined ? {} : { permissions: evidence }),
							},
							team: {
								id: "team-1",
								cyclesEnabled: true,
								states: {
									nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
								},
							},
							issue: {
								...parent,
								description: "Spec",
								updatedAt: "parent-r1",
								team: { id: "team-1" },
								state: { type: "backlog" },
								estimate: null,
								children: { nodes: [] },
							},
							issueRelations: { nodes: [] },
						},
					})
				: undefined,
		);
		const snapshot = await gateway.readAuthoritySnapshot({
			definitionId: "definition-1",
			artifact: { approvedDigest: "approved", graphDigest: "graph" },
			approval: { ownerId: "owner-1", role: "Owner", digest: "approval" },
			authorityRevision: "authority-r1",
			parent: { ...parent, specDigest: "b".repeat(64) },
			expectedParentDescription: "Spec",
		});
		assert.equal(snapshot.mutationPermission, permission);
		const guard = createTicketPublicationAuthorityGuard({
			expected: { ...snapshot, mutationPermission: true },
			current: async () => snapshot,
		});
		await assert.rejects(
			() =>
				guard.revalidate({
					definitionId: "definition-1",
					graphDigest: "graph",
					parent: snapshot.parent,
					stage: "child-create",
				}),
			(error) => error.code === "PI_WORKFLOW_PUBLICATION_PERMISSION_DENIED",
		);
		assert.equal(
			requests.some((request) => /Create/.test(request.operationName)),
			false,
		);
	}
});

test("fails closed before mutations on malformed, denied, stale, or incompatible responses", async () => {
	for (const [operationName, response, code] of [
		[
			"DeliveryTicketAuthority",
			Response.json({ data: { viewer: null } }),
			"PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
		],
		[
			"DeliveryTicketFind",
			Response.json({ errors: [{ message: "permission denied" }] }),
			"PI_WORKFLOW_LINEAR_PERMISSION_DENIED",
		],
		[
			"DeliveryTicketAuthority",
			Response.json({
				data: {
					viewer: { id: "owner" },
					team: { id: "team-1", cyclesEnabled: true, states: { nodes: [] } },
					issue: {
						...parent,
						team: { id: "team-1" },
						description: "Spec",
						updatedAt: "wrong",
						state: { type: "backlog" },
						estimate: null,
						children: { nodes: [] },
					},
					issueRelations: { nodes: [] },
				},
			}),
			"PI_WORKFLOW_PUBLICATION_PARENT_DRIFT",
		],
	]) {
		const { gateway, requests } = runtime((request) =>
			request.operationName === operationName ? response : undefined,
		);
		const action =
			operationName === "DeliveryTicketFind"
				? () => gateway.findChildren({ operationId, parent, stableKey: "T-1" })
				: () =>
						gateway.readAuthoritySnapshot({
							definitionId: "d",
							artifact: { approvedDigest: "a", graphDigest: "g" },
							approval: { ownerId: "o", role: "Owner", digest: "a" },
							authorityRevision: "r",
							parent: { ...parent, specDigest: "b".repeat(64) },
							expectedParentDescription: "Spec",
						});
		await assert.rejects(action, (error) => error.code === code);
		assert.equal(
			requests.some((request) => /Create/.test(request.operationName)),
			false,
		);
	}
});

test("rejects malformed, missing, and non-exact marker lookup results before duplicate creation", async () => {
	for (const [response, code, message] of [
		[
			{ issues: {} },
			"PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
			"Linear returned a malformed response.",
		],
		[
			{
				issues: {
					nodes: [{ id: "child-T-1", title: `other ${marker("T-1")}` }],
				},
			},
			"PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT",
			"Linear returned a non-exact publication marker.",
		],
	]) {
		const { gateway, requests } = runtime((request) =>
			request.operationName === "DeliveryTicketFind"
				? Response.json({ data: response })
				: undefined,
		);
		await assert.rejects(
			() => gateway.findChildren({ operationId, parent, stableKey: "T-1" }),
			(error) => error.code === code && error.message === message,
		);
		assert.equal(
			requests.some((request) => /Create/.test(request.operationName)),
			false,
		);
	}
});

test("derives required capabilities from complete observed authority evidence and preserves the approved Spec digest", async () => {
	const trustedParent = { ...parent, specDigest: "b".repeat(64) };
	const { gateway, requests } = runtime((request) =>
		request.operationName === "DeliveryTicketAuthority"
			? Response.json({
					data: {
						viewer: { id: "owner-1", permissions: { issueCreate: true } },
						team: {
							id: "team-1",
							cyclesEnabled: true,
							states: {
								nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
							},
						},
						issue: {
							...parent,
							description: "Spec",
							updatedAt: "parent-r1",
							team: { id: "team-1" },
							state: { type: "backlog" },
							estimate: null,
							children: { nodes: [] },
						},
						issueRelations: { nodes: [] },
					},
				})
			: undefined,
	);
	const snapshot = await gateway.readAuthoritySnapshot({
		definitionId: "definition-1",
		artifact: { approvedDigest: "approved", graphDigest: "graph" },
		approval: { ownerId: "owner-1", role: "Owner", digest: "approval" },
		authorityRevision: "authority-r1",
		parent: trustedParent,
		expectedParentDescription: "Spec",
	});
	assert.deepEqual(snapshot.requiredCapabilities, [
		"sub-issues",
		"native-blockers",
		"estimates",
		"triage-state",
	]);
	assert.deepEqual(snapshot.parent, trustedParent);
	assert.match(
		requests[0].query,
		/estimate\s+children\s*\{\s*nodes\s*\{\s*id\s*}\s*}/,
	);
	assert.match(requests[0].query, /issueRelations\(first:1\)\s*\{/);
	await gateway.createChild({
		operationId,
		parent,
		child: {
			stableKey: "T-1",
			title: "T-1",
			body: "Body",
			estimate: 3,
			workflow: {
				state: "Triage",
				assignee: null,
				cycle: null,
				labels: [],
				project: null,
			},
		},
	});
	assert.deepEqual(
		requests.map((request) => request.operationName),
		["DeliveryTicketAuthority", "DeliveryTicketCreate"],
	);
});

test("maps populated reciprocal relations and rejects malformed relation markers", async () => {
	const populated = issue("T-1");
	populated.blockedBy = {
		nodes: [
			{
				issue: { id: "child-T-2", title: issue("T-2").title },
				relatedIssue: { id: populated.id, title: populated.title },
			},
		],
	};
	populated.blocks = {
		nodes: [
			{
				issue: { id: populated.id, title: populated.title },
				relatedIssue: { id: "child-T-3", title: issue("T-3").title },
			},
		],
	};
	const valid = runtime((request) =>
		request.operationName === "DeliveryTicketReadBack"
			? Response.json({
					data: {
						issue: {
							...parent,
							team: { id: "team-1" },
							children: { nodes: [populated] },
						},
					},
				})
			: undefined,
	);
	assert.deepEqual(
		(await valid.gateway.readBack({ operationId, parent })).children[0],
		{
			stableKey: "T-1",
			title: "T-1",
			body: "Body",
			estimate: 3,
			workflow: {
				state: "Triage",
				assignee: null,
				cycle: null,
				labels: [],
				project: null,
			},
			linearId: "child-T-1",
			blockedBy: ["T-2"],
			blocks: ["T-3"],
		},
	);

	const malformed = issue("T-1");
	malformed.blocks = {
		nodes: [
			{
				issue: { id: malformed.id, title: malformed.title },
				relatedIssue: { id: "child-T-3", title: "not a publication marker" },
			},
		],
	};
	const invalid = runtime((request) =>
		request.operationName === "DeliveryTicketReadBack"
			? Response.json({
					data: {
						issue: {
							...parent,
							team: { id: "team-1" },
							children: { nodes: [malformed] },
						},
					},
				})
			: undefined,
	);
	await assert.rejects(
		() => invalid.gateway.readBack({ operationId, parent }),
		(error) =>
			error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" &&
			error.message === "Linear returned a malformed response.",
	);
});

test("fails closed on malformed or non-exact blocker lookup and reciprocal endpoints", async () => {
	for (const [response, code] of [
		[
			{ issueRelations: { nodes: [null] } },
			"PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
		],
		[
			{
				issueRelations: {
					nodes: [
						{
							issue: { id: "wrong" },
							relatedIssue: { id: "child-T-2" },
							type: "blocks",
						},
					],
				},
			},
			"PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT",
		],
	]) {
		const { gateway } = runtime((request) =>
			request.operationName === "DeliveryTicketBlockerFind"
				? Response.json({ data: response })
				: undefined,
		);
		await gateway.findChildren({ operationId, parent, stableKey: "T-0" });
		await assert.rejects(
			() =>
				gateway.findBlockers({
					operationId,
					parent,
					blockedStableKey: "T-2",
					blockingStableKey: "T-1",
				}),
			(error) => error.code === code,
		);
	}
	for (const relation of [
		null,
		{
			issue: { id: "child-T-2", title: issue("T-2").title },
			relatedIssue: { id: "child-T-3", title: issue("T-3").title },
		},
	]) {
		const child = issue("T-1");
		child.blocks = { nodes: [relation] };
		const { gateway } = runtime((request) =>
			request.operationName === "DeliveryTicketReadBack"
				? Response.json({
						data: {
							issue: {
								...parent,
								team: { id: "team-1" },
								children: { nodes: [child] },
							},
						},
					})
				: undefined,
		);
		await assert.rejects(
			() => gateway.readBack({ operationId, parent }),
			(error) =>
				error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" &&
				error.message === "Linear returned a malformed response.",
		);
	}
});

test("requires both exact child markers before accepting empty blocker relations", async () => {
	for (const missingStableKey of ["T-2", "T-1"]) {
		const { gateway, requests } = runtime((request) =>
			request.operationName === "DeliveryTicketFind"
				? Response.json({
						data: {
							issues: {
								nodes:
									request.variables.marker === marker(missingStableKey)
										? []
										: [issue(request.variables.marker.match(/:([^:]+)]$/)[1])],
							},
						},
					})
				: undefined,
		);
		await assert.rejects(
			() =>
				gateway.findBlockers({
					operationId,
					parent,
					blockedStableKey: "T-2",
					blockingStableKey: "T-1",
				}),
			(error) =>
				error.code === "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT" &&
				error.message === "Linear returned a non-exact publication marker.",
		);
		assert.equal(
			requests.some(
				(request) =>
					request.operationName === "DeliveryTicketBlockerFind" ||
					request.operationName === "DeliveryTicketBlockerCreate",
			),
			false,
		);
	}
});

test("classifies transport, unknown state, capability, parent, and malformed marker evidence with stable errors", async () => {
	const transport = createRuntimeLinearDeliveryTicketGateway({
		apiKey: "key",
		fetch: async () => {
			throw new Error("offline");
		},
	});
	await assert.rejects(
		() => transport.findChildren({ operationId, parent, stableKey: "T-1" }),
		(error) =>
			error.code === "PI_WORKFLOW_LINEAR_TRANSPORT_FAILED" &&
			error.message === "Linear DeliveryTicketFind transport failed.",
	);
	for (const [operationName, response, code, message] of [
		[
			"DeliveryTicketAuthority",
			{
				viewer: { id: "owner-1", permissions: { issueCreate: true } },
				team: {
					id: "team-1",
					cyclesEnabled: false,
					states: {
						nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
					},
				},
				issue: {
					...parent,
					description: "Spec",
					updatedAt: "parent-r1",
					team: { id: "team-1" },
					state: { type: "backlog" },
					estimate: null,
					children: { nodes: [] },
				},
				issueRelations: { nodes: [] },
			},
			"PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN",
			"Linear Triage state is not known compatible.",
		],
		[
			"DeliveryTicketAuthority",
			{
				viewer: { id: "owner-1", permissions: { issueCreate: true } },
				team: {
					id: "team-1",
					cyclesEnabled: true,
					states: {
						nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
					},
				},
				issue: {
					...parent,
					description: "Spec",
					updatedAt: "parent-r1",
					team: { id: "team-1" },
					state: { type: "backlog" },
					children: { nodes: [] },
				},
				issueRelations: { nodes: [] },
			},
			"PI_WORKFLOW_PUBLICATION_CAPABILITY_DRIFT",
			"Required Linear capabilities are unavailable.",
		],
		[
			"DeliveryTicketAuthority",
			{
				viewer: { id: "owner-1", permissions: { issueCreate: true } },
				team: {
					id: "team-1",
					cyclesEnabled: true,
					states: {
						nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
					},
				},
				issue: {
					...parent,
					description: "stale",
					updatedAt: "parent-r1",
					team: { id: "team-1" },
					state: { type: "backlog" },
					estimate: null,
					children: { nodes: [] },
				},
				issueRelations: { nodes: [] },
			},
			"PI_WORKFLOW_PUBLICATION_PARENT_DRIFT",
			"Delivery parent binding changed before mutation.",
		],
		[
			"DeliveryTicketAuthority",
			{
				viewer: { id: "owner-1", permissions: { issueCreate: true } },
				team: {
					id: "team-1",
					cyclesEnabled: true,
					states: {
						nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
					},
				},
				issue: {
					...parent,
					id: "wrong-parent",
					description: "Spec",
					updatedAt: "parent-r1",
					team: { id: "team-1" },
					state: { type: "backlog" },
					estimate: null,
					children: { nodes: [] },
				},
				issueRelations: { nodes: [] },
			},
			"PI_WORKFLOW_PUBLICATION_PARENT_DRIFT",
			"Delivery parent binding changed before mutation.",
		],
		[
			"DeliveryTicketAuthority",
			{
				viewer: { id: "owner-1", permissions: { issueCreate: true } },
				team: {
					id: "team-1",
					cyclesEnabled: true,
					states: {
						nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
					},
				},
				issue: {
					...parent,
					description: "Spec",
					updatedAt: "parent-r1",
					team: { id: "wrong-team" },
					state: { type: "backlog" },
					estimate: null,
					children: { nodes: [] },
				},
				issueRelations: { nodes: [] },
			},
			"PI_WORKFLOW_PUBLICATION_PARENT_DRIFT",
			"Delivery parent binding changed before mutation.",
		],
		[
			"DeliveryTicketAuthority",
			{
				viewer: { id: "owner-1", permissions: { issueCreate: true } },
				team: {
					id: "team-1",
					cyclesEnabled: true,
					states: {
						nodes: [{ id: "triage-1", name: "Triage", type: "triage" }],
					},
				},
				issue: {
					...parent,
					description: "Spec",
					updatedAt: "parent-r1",
					team: { id: "team-1" },
					state: { type: "started" },
					estimate: null,
					children: { nodes: [] },
				},
				issueRelations: { nodes: [] },
			},
			"PI_WORKFLOW_PUBLICATION_PARENT_DRIFT",
			"Delivery parent binding changed before mutation.",
		],
		[
			"DeliveryTicketFind",
			{ issues: { nodes: [{ title: `T-1 ${marker("T-1")}` }] } },
			"PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
			"Linear returned a malformed response.",
		],
	]) {
		const { gateway, requests } = runtime((request) =>
			request.operationName === operationName
				? Response.json({ data: response })
				: undefined,
		);
		const action =
			operationName === "DeliveryTicketFind"
				? () => gateway.findChildren({ operationId, parent, stableKey: "T-1" })
				: () =>
						gateway.readAuthoritySnapshot({
							definitionId: "d",
							artifact: { approvedDigest: "a", graphDigest: "g" },
							approval: { ownerId: "o", role: "Owner", digest: "a" },
							authorityRevision: "r",
							parent: { ...parent, specDigest: "b".repeat(64) },
							expectedParentDescription: "Spec",
						});
		await assert.rejects(
			action,
			(error) => error.code === code && error.message === message,
		);
		assert.equal(
			requests.some((request) => /Create/.test(request.operationName)),
			false,
		);
	}
});

test("fails closed with the stable malformed-response error when authority state entries are not objects", async () => {
	const { gateway } = runtime((request) =>
		request.operationName === "DeliveryTicketAuthority"
			? Response.json({
					data: {
						viewer: { id: "owner-1", permissions: { issueCreate: true } },
						team: {
							id: "team-1",
							cyclesEnabled: true,
							states: { nodes: [null] },
						},
						issue: {
							...parent,
							description: "Spec",
							updatedAt: "parent-r1",
							team: { id: "team-1" },
							state: { type: "backlog" },
							estimate: null,
							children: { nodes: [] },
						},
						issueRelations: { nodes: [] },
					},
				})
			: undefined,
	);
	await assert.rejects(
		() =>
			gateway.readAuthoritySnapshot({
				definitionId: "d",
				artifact: { approvedDigest: "a", graphDigest: "g" },
				approval: { ownerId: "o", role: "Owner", digest: "a" },
				authorityRevision: "r",
				parent: { ...parent, specDigest: "b".repeat(64) },
				expectedParentDescription: "Spec",
			}),
		(error) =>
			error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" &&
			error.message === "Linear returned a malformed response.",
	);
});

test("classifies a successful null JSON response as malformed", async () => {
	const { gateway } = runtime((request) =>
		request.operationName === "DeliveryTicketFind"
			? Response.json(null)
			: undefined,
	);
	await assert.rejects(
		() => gateway.findChildren({ operationId, parent, stableKey: "T-1" }),
		(error) =>
			error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE" &&
			error.message === "Linear returned a malformed response.",
	);
});

test("returns an exact non-empty blocker relation", async () => {
	const { gateway } = runtime((request) =>
		request.operationName === "DeliveryTicketBlockerFind"
			? Response.json({
					data: {
						issueRelations: {
							nodes: [
								{
									issue: { id: "child-T-1" },
									relatedIssue: { id: "child-T-2" },
									type: "blocks",
								},
							],
						},
					},
				})
			: undefined,
	);
	await gateway.findChildren({ operationId, parent, stableKey: "T-0" });
	assert.deepEqual(
		await gateway.findBlockers({
			operationId,
			parent,
			blockedStableKey: "T-2",
			blockingStableKey: "T-1",
		}),
		[{ blockedStableKey: "T-2", blockingStableKey: "T-1" }],
	);
});
