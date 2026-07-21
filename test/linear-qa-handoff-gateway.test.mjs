import assert from "node:assert/strict";
import test from "node:test";

import {
	createLinearQaHandoffGateway,
	createRuntimeLinearQaHandoffTransport,
} from "../extensions/linear-qa-handoff-gateway.ts";

const issue = {
	id: "ILA-2321",
	title: "Publicar QA handoff determinista",
	description: "Descripción autoritativa",
	updatedAt: "2026-07-21T14:21:01.615Z",
	status: { id: "state-1", name: "In Code Review", type: "started" },
	assignee: "Felipe Gonzalez",
	assigneeId: "user-opaque",
	cycleId: "cycle-opaque",
	labels: ["Assign To / Felipe"],
	estimate: { value: 5, name: "5 Points" },
	parentId: "ILA-2296",
	relations: {
		blockedBy: [{ id: "ILA-2300", title: "Dependencia" }],
		blocks: [{ id: "ILA-2400", title: "Siguiente" }],
		relatedTo: [],
		duplicateOf: null,
	},
};

function scripted(options = {}) {
	const calls = [];
	return {
		calls,
		transport: {
			async getIssue(input) {
				calls.push({ operation: "getIssue", input });
				if (options.getIssueError) throw options.getIssueError;
				return structuredClone(options.issue ?? issue);
			},
			async listComments(input) {
				calls.push({ operation: "listComments", input });
				if (options.listCommentsError) throw options.listCommentsError;
				return structuredClone(
					options.commentPages?.shift() ?? {
						comments: [],
						hasNextPage: false,
					},
				);
			},
			async saveComment(input) {
				calls.push({ operation: "saveComment", input });
				if (options.saveCommentError) throw options.saveCommentError;
				return structuredClone(
					options.created ?? { id: "01JOPAQUECOMMENT7", body: input.body },
				);
			},
		},
	};
}

test("maps the narrow Linear MCP contract and creates only a root issue comment", async () => {
	const raw = scripted({
		commentPages: [
			{
				comments: [{ id: "opaque-comment-1", body: "Historial" }],
				hasNextPage: true,
				cursor: "opaque-cursor-1",
			},
		],
	});
	const gateway = createLinearQaHandoffGateway(raw.transport);

	const snapshot = await gateway.getIssue({ id: "ILA-2321" });
	const page = await gateway.listComments({ issueId: "ILA-2321" });
	const created = await gateway.createComment({
		issueId: "ILA-2321",
		body: "Referencia de flujo: qa-handoff:digest",
	});

	assert.deepEqual(snapshot, {
		id: "ILA-2321",
		identifier: "ILA-2321",
		title: issue.title,
		description: issue.description,
		updatedAt: issue.updatedAt,
		state: issue.status,
		assignee: { id: "user-opaque", name: "Felipe Gonzalez" },
		cycle: { id: "cycle-opaque" },
		labels: issue.labels,
		estimate: issue.estimate,
		relations: issue.relations,
		parent: { id: "ILA-2296" },
	});
	assert.deepEqual(page, {
		comments: [{ id: "opaque-comment-1", body: "Historial" }],
		nextCursor: "opaque-cursor-1",
	});
	assert.deepEqual(created, {
		id: "01JOPAQUECOMMENT7",
		body: "Referencia de flujo: qa-handoff:digest",
	});
	assert.deepEqual(raw.calls, [
		{
			operation: "getIssue",
			input: { id: "ILA-2321", includeRelations: true },
		},
		{
			operation: "listComments",
			input: { issueId: "ILA-2321", cursor: undefined, limit: 250 },
		},
		{
			operation: "saveComment",
			input: {
				issueId: "ILA-2321",
				body: "Referencia de flujo: qa-handoff:digest",
			},
		},
	]);
	assert.equal("updateIssue" in raw.transport, false);
	assert.equal("parentId" in raw.calls[2].input, false);
});

test("maps each opaque MCP cursor without interpreting comment IDs", async () => {
	const raw = scripted({
		commentPages: [
			{
				comments: [{ id: "not-a-uuid", body: "Primera página" }],
				hasNextPage: true,
				cursor: "cursor/opaque==",
			},
			{
				comments: [{ id: "also-opaque", body: "Segunda página" }],
				hasNextPage: false,
			},
		],
	});
	const gateway = createLinearQaHandoffGateway(raw.transport);

	const first = await gateway.listComments({ issueId: "ILA-2321" });
	const second = await gateway.listComments({
		issueId: "ILA-2321",
		cursor: first.nextCursor,
	});

	assert.deepEqual(first.comments.map(({ id }) => id), ["not-a-uuid"]);
	assert.deepEqual(second.comments.map(({ id }) => id), ["also-opaque"]);
	assert.deepEqual(raw.calls.map(({ input }) => input.cursor), [
		undefined,
		"cursor/opaque==",
	]);
});

test("fails closed for malformed issue, page, and comment read-backs", async () => {
	for (const [operation, options] of [
		["getIssue", { issue: { id: "ILA-2321", title: "missing fields" } }],
		[
			"listComments",
			{
				commentPages: [
					{ comments: [{ id: 7, body: "invalid" }], hasNextPage: false },
				],
			},
		],
		[
			"createComment",
			{ created: { id: "opaque", body: "different body" } },
		],
	]) {
		const raw = scripted(options);
		const gateway = createLinearQaHandoffGateway(raw.transport);
		const promise =
			operation === "getIssue"
				? gateway.getIssue({ id: "ILA-2321" })
				: operation === "listComments"
					? gateway.listComments({ issueId: "ILA-2321" })
					: gateway.createComment({ issueId: "ILA-2321", body: "expected" });
		await assert.rejects(
			promise,
			(error) => error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
			operation,
		);
	}
});

test("preserves preclassified Linear adapter errors", async () => {
	for (const error of [
		Object.assign(new Error("forbidden"), {
			code: "PI_WORKFLOW_LINEAR_PERMISSION_DENIED",
		}),
		Object.assign(new Error("rate limited"), {
			code: "PI_WORKFLOW_LINEAR_RATE_LIMITED",
		}),
		Object.assign(new Error("transport failed"), {
			code: "PI_WORKFLOW_LINEAR_REQUEST_FAILED",
		}),
	]) {
		const gateway = createLinearQaHandoffGateway(
			scripted({ getIssueError: error }).transport,
		);
		await assert.rejects(
			gateway.getIssue({ id: "ILA-2321" }),
			(candidate) => candidate === error,
		);
	}
});

function productionGateway(fetchImplementation) {
	return createLinearQaHandoffGateway(
		createRuntimeLinearQaHandoffTransport({
			apiKey: "linear-test-key",
			url: "https://linear.example.test/graphql",
			fetch: fetchImplementation,
		}),
	);
}

test("maps production Linear permission, rate-limit, GraphQL, and transport failures", async () => {
	const cases = [
		{
			name: "permission",
			code: "PI_WORKFLOW_LINEAR_PERMISSION_DENIED",
			fetch: async () => new Response(null, { status: 403 }),
		},
		{
			name: "rate limit",
			code: "PI_WORKFLOW_LINEAR_RATE_LIMITED",
			fetch: async () => new Response(null, { status: 429 }),
		},
		{
			name: "generic GraphQL",
			code: "PI_WORKFLOW_LINEAR_REQUEST_FAILED",
			fetch: async () => Response.json({
				errors: [{ message: "Resolver execution failed" }],
			}),
		},
		{
			name: "generic transport",
			code: "PI_WORKFLOW_LINEAR_REQUEST_FAILED",
			fetch: async () => {
				throw new Error("socket closed");
			},
		},
	];

	for (const candidate of cases) {
		await assert.rejects(
			productionGateway(candidate.fetch).getIssue({ id: "ILA-2321" }),
			(error) => error.code === candidate.code,
			candidate.name,
		);
	}
});

test("fails closed through the production transport for malformed and partial responses", async () => {
	const cases = [
		{
			name: "invalid JSON",
			invoke: (gateway) => gateway.getIssue({ id: "ILA-2321" }),
			response: new Response("{", {
				headers: { "content-type": "application/json" },
			}),
		},
		{
			name: "partial issue",
			invoke: (gateway) => gateway.getIssue({ id: "ILA-2321" }),
			response: Response.json({ data: { issue: { id: "linear-uuid" } } }),
		},
		{
			name: "partial comments page",
			invoke: (gateway) => gateway.listComments({ issueId: "ILA-2321" }),
			response: Response.json({
				data: {
					issue: {
						comments: { nodes: [], pageInfo: {} },
					},
				},
			}),
		},
		{
			name: "partial comment creation",
			invoke: (gateway) => gateway.createComment({
				issueId: "ILA-2321",
				body: "expected",
			}),
			response: Response.json({
				data: { commentCreate: { success: true } },
			}),
		},
	];

	for (const candidate of cases) {
		const gateway = productionGateway(async () => candidate.response.clone());
		await assert.rejects(
			candidate.invoke(gateway),
			(error) => error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
			candidate.name,
		);
	}
});
