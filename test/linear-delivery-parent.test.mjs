import assert from "node:assert/strict";
import test from "node:test";
import { createLinearDeliveryParentGateway } from "../extensions/linear-delivery-parent-gateway.ts";
import { createRuntimeLinearDeliveryParentTransport } from "../extensions/runtime-linear-delivery-parent.ts";

const key = "b".repeat(64);
const backlog = { id: "backlog-1", type: "backlog", updatedAt: "2026-07-14" };
const issue = {
	id: "parent-1",
	team: { id: "team-1" },
	title: `Entrega [pi-workflow-publication:${key}]`,
	description: "Spec",
	state: backlog,
	cycle: null,
	assignee: null,
};
const preflightData = (state = backlog) => ({
	viewer: { id: "owner-1" },
	team: { id: "team-1", cyclesEnabled: true, states: { nodes: [state] } },
});
function runtime(respond) {
	const requests = [];
	const transport = createRuntimeLinearDeliveryParentTransport({
		apiKey: "key",
		fetch: async (_url, init) => {
			const body = JSON.parse(String(init.body));
			requests.push(body);
			return (
				respond?.(body) ??
				Response.json({
					data:
						body.operationName === "DeliveryParentPreflight"
							? preflightData()
							: body.operationName === "DeliveryParentFind"
								? { issues: { nodes: [issue] } }
								: body.operationName === "DeliveryParentRead"
									? { issue }
									: { issueCreate: { success: true, issue } },
				})
			);
		},
	});
	return {
		gateway: createLinearDeliveryParentGateway(transport),
		transport,
		requests,
	};
}

test("Linear runtime enforces preflight, exact creation, marker recovery, and read-back", async () => {
	const { gateway, requests } = runtime();
	const before = await gateway.preflight("team-1");
	const expected = {
		accessRevision: before.accessRevision,
		capabilityRevision: before.capabilityRevision,
		stateRevision: before.stateRevision,
	};
	const created = await gateway.create({
		teamId: "team-1",
		title: "Entrega",
		description: "Spec",
		descriptionRevision: "spec-r1",
		state: "Backlog",
		cycleId: null,
		assigneeId: null,
		publicationKey: key,
		expected,
	});
	assert.deepEqual(created, {
		id: "parent-1",
		teamId: "team-1",
		title: "Entrega",
		description: "Spec",
		descriptionRevision: "spec-r1",
		state: "Backlog",
		cycleId: null,
		assigneeId: null,
		publicationKey: key,
	});
	assert.deepEqual(
		await gateway.findByPublicationKey("team-1", key, "spec-r1"),
		[created],
	);
	assert.deepEqual(await gateway.read("parent-1", "spec-r1", key), created);
	assert.deepEqual(
		requests.find(
			({ operationName }) => operationName === "DeliveryParentCreate",
		).variables.input,
		{
			teamId: "team-1",
			stateId: "backlog-1",
			title: issue.title,
			description: "Spec",
		},
	);
});

test("Linear runtime rejects stale state and classifies permission and rate-limit failures", async () => {
	let reads = 0;
	const { gateway } = runtime((body) =>
		body.operationName === "DeliveryParentPreflight"
			? Response.json({
					data: preflightData({ ...backlog, updatedAt: String(++reads) }),
				})
			: undefined,
	);
	const before = await gateway.preflight("team-1");
	await assert.rejects(
		() =>
			gateway.create({
				teamId: "team-1",
				title: "Entrega",
				description: "Spec",
				descriptionRevision: "r1",
				state: "Backlog",
				cycleId: null,
				assigneeId: null,
				publicationKey: key,
				expected: before,
			}),
		(error) => error.code === "PI_WORKFLOW_PUBLICATION_STALE",
	);
	for (const [response, code] of [
		[
			Response.json({ errors: [{ message: "insufficient permissions" }] }),
			"PI_WORKFLOW_LINEAR_PERMISSION_DENIED",
		],
		[new Response("", { status: 429 }), "PI_WORKFLOW_LINEAR_RATE_LIMITED"],
	]) {
		const { transport } = runtime(() => response);
		await assert.rejects(
			() => transport.preflight("team-1"),
			(error) => error.code === code,
		);
	}
});

test("Linear read-back rejects Cycle or assignee drift", async () => {
	const { gateway } = runtime((body) =>
		body.operationName === "DeliveryParentRead"
			? Response.json({
					data: { issue: { ...issue, cycle: { id: "cycle-1" } } },
				})
			: undefined,
	);
	await assert.rejects(
		() => gateway.read("parent-1", "r1", key),
		/invalid Delivery parent read model/,
	);
});
