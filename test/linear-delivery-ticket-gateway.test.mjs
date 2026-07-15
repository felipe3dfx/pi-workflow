import assert from "node:assert/strict";
import test from "node:test";

import { createTicketPublicationOperationId } from "../extensions/ticket-publication-manifest.ts";
import { createFakeLinearDeliveryTicketGateway } from "../extensions/linear-delivery-ticket-gateway.ts";

const parent = { id: "parent-1", teamId: "team-1", revision: "parent-r1" };
const operationId = createTicketPublicationOperationId({
	definitionId: "definition-1",
	graphDigest: "a".repeat(64),
	parent: { id: parent.id, revision: parent.revision },
});
const child = {
	stableKey: "T1",
	title: "Entrega vertical",
	body: "Resultado verificable.",
	estimate: 3,
	workflow: {
		state: "Triage",
		assignee: null,
		cycle: null,
		labels: [],
		project: null,
	},
};

test("domain gateway fake creates children with the required immutable publication inputs and reads them back", async () => {
	const gateway = createFakeLinearDeliveryTicketGateway({ parent });
	const created = await gateway.createChild({ operationId, parent, child });
	assert.deepEqual(created, { stableKey: "T1", linearId: "child-1" });
	assert.deepEqual(await gateway.readBack({ operationId, parent }), {
		parent,
		children: [{ ...child, linearId: "child-1" }],
		blockers: [],
	});
});

test("domain gateway fake exposes only closed child and blocker commands and rejects stale or non-Triage inputs", async () => {
	const gateway = createFakeLinearDeliveryTicketGateway({ parent });
	await assert.rejects(
		() => gateway.createChild({ operationId, parent: { ...parent, revision: "stale" }, child }),
		/stale parent/,
	);
	await assert.rejects(
		() => gateway.createChild({ operationId, parent, child: { ...child, workflow: { ...child.workflow, assignee: "user-1" } } }),
		/Triage with no assignee, cycle, labels, or project/,
	);
	await gateway.createChild({ operationId, parent, child });
	await gateway.createChild({ operationId, parent, child: { ...child, stableKey: "T2", title: "Dependiente" } });
	await gateway.createBlocker({ operationId, parent, blockedStableKey: "T2", blockingStableKey: "T1" });
	assert.deepEqual((await gateway.readBack({ operationId, parent })).blockers, [
		{ blockedStableKey: "T2", blockingStableKey: "T1" },
	]);
});
