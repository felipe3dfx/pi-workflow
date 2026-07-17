import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeLinearApprovedRevisionGateway } from "../extensions/runtime-linear-approved-revision.ts";

const workflow = {
	state: { id: "state-1", name: "In Progress", type: "started" },
	assignee: { id: "owner-1" },
	cycle: { id: "cycle-1" },
	labels: { nodes: [{ id: "label-1", name: "Owner" }] },
	project: { id: "project-1" },
};

const issue = (description = "Anterior", updatedAt = "revision-1") => ({ id: "ILA-1", description, updatedAt, ...workflow });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function scripted(payloads) {
	const calls = [];
	return {
		calls,
		fetch: async (_url, init) => {
			calls.push(JSON.parse(init.body));
			const next = payloads.shift();
			if (next instanceof Error) throw next;
			return next;
		},
	};
}

test("maps separate Linear issue/comment operations and sends only approved mutation fields", async () => {
	const transport = scripted([
		response({ data: { issue: issue() } }),
		response({ data: { issue: { comments: { nodes: [{ id: "comment-1", body: "Historial" }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
		response({ data: { commentCreate: { success: true, comment: { id: "comment-2", body: "Referencia de flujo: revision:digest" } } } }),
		response({ data: { issueUpdate: { success: true, issue: issue("Vigente", "revision-2") } } }),
	]);
	const gateway = createRuntimeLinearApprovedRevisionGateway({ apiKey: "secret", fetch: transport.fetch });

	const read = await gateway.getIssue({ id: "ILA-1" });
	assert.equal(read.description, "Anterior");
	assert.deepEqual(read.workflow, workflow);
	assert.deepEqual(await gateway.listComments({ issueId: "ILA-1" }), [{ id: "comment-1", body: "Historial" }]);
	await gateway.saveComment({ issueId: "ILA-1", body: "Referencia de flujo: revision:digest" });
	await gateway.saveIssue({ id: "ILA-1", description: "Vigente" });

	assert.equal(transport.calls[0].operationName, "ApprovedRevisionIssueRead");
	assert.equal(transport.calls[1].operationName, "ApprovedRevisionComments");
	assert.deepEqual(transport.calls[2].variables, { input: { issueId: "ILA-1", body: "Referencia de flujo: revision:digest" } });
	assert.deepEqual(transport.calls[3].variables, { id: "ILA-1", input: { description: "Vigente" } });
});

test("paginates Linear comments so later-page marker conflicts are visible", async () => {
	const transport = scripted([
		response({ data: { issue: { comments: { nodes: [{ id: "comment-1", body: "Historial" }], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } } } } }),
		response({ data: { issue: { comments: { nodes: [{ id: "comment-2", body: "Referencia de flujo: revision:digest" }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
	]);
	const gateway = createRuntimeLinearApprovedRevisionGateway({ apiKey: "secret", fetch: transport.fetch });

	assert.deepEqual(await gateway.listComments({ issueId: "ILA-1" }), [
		{ id: "comment-1", body: "Historial" },
		{ id: "comment-2", body: "Referencia de flujo: revision:digest" },
	]);
	assert.deepEqual(transport.calls.map((call) => call.variables), [
		{ id: "ILA-1", after: null },
		{ id: "ILA-1", after: "cursor-1" },
	]);
});

test("fails closed for malformed successful responses", async () => {
	for (const [call, payload] of [
		["getIssue", response({ data: { issue: { id: "ILA-1" } } })],
		["listComments", response({ data: { issue: { comments: {} } } })],
		["saveComment", response({ data: { commentCreate: { success: true, comment: { id: "comment-1", body: "different" } } } })],
		["saveIssue", response({ data: { issueUpdate: { success: true, issue: issue("different") } } })],
	]) {
		const gateway = createRuntimeLinearApprovedRevisionGateway({ apiKey: "secret", fetch: scripted([payload]).fetch });
		const operation = call === "getIssue" ? gateway.getIssue({ id: "ILA-1" }) : call === "listComments" ? gateway.listComments({ issueId: "ILA-1" }) : call === "saveComment" ? gateway.saveComment({ issueId: "ILA-1", body: "expected" }) : gateway.saveIssue({ id: "ILA-1", description: "expected" });
		await assert.rejects(operation, (error) => error.code === "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
	}
});

test("classifies permission, rate limit, GraphQL, and partial transport failures", async () => {
	for (const [payload, code] of [
		[response({}, 403), "PI_WORKFLOW_LINEAR_PERMISSION_DENIED"],
		[response({}, 429), "PI_WORKFLOW_LINEAR_RATE_LIMITED"],
		[response({ errors: [{ message: "forbidden" }] }), "PI_WORKFLOW_LINEAR_PERMISSION_DENIED"],
		[new Error("connection lost"), "PI_WORKFLOW_LINEAR_REQUEST_FAILED"],
	]) {
		const gateway = createRuntimeLinearApprovedRevisionGateway({ apiKey: "secret", fetch: scripted([payload]).fetch });
		await assert.rejects(gateway.getIssue({ id: "ILA-1" }), (error) => error.code === code);
	}
});
