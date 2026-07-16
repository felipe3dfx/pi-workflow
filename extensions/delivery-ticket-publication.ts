import type { DeliveryTicketGraph } from "./delivery-ticket-graph.ts";
import type { LinearDeliveryTicketGateway } from "./linear-delivery-ticket-gateway.ts";
import type { createTicketPublicationManifestStore } from "./ticket-publication-manifest.ts";

type Dependencies = {
	definitionId: string;
	graph: Pick<DeliveryTicketGraph, "digest" | "payload">;
	manifest: ReturnType<typeof createTicketPublicationManifestStore>;
	gateway: LinearDeliveryTicketGateway;
};

const body = (ticket: DeliveryTicketGraph["payload"]["tickets"][number]) =>
	`Resultado\n\n${ticket.outcome}\n\nCriterios de aceptación\n\n${ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`;

const topological = (tickets: DeliveryTicketGraph["payload"]["tickets"]) => {
	const byKey = new Map(tickets.map((ticket) => [ticket.stableKey, ticket]));
	const visited = new Set<string>();
	const ordered: typeof tickets = [];
	const visit = (ticket: (typeof tickets)[number]) => {
		if (visited.has(ticket.stableKey)) return;
		visited.add(ticket.stableKey);
		for (const blocker of ticket.blockers) visit(byKey.get(blocker) as (typeof tickets)[number]);
		ordered.push(ticket);
	};
	for (const ticket of tickets) visit(ticket);
	return ordered;
};

const exact = (value: unknown, expected: unknown) => JSON.stringify(value) === JSON.stringify(expected);

export async function publishApprovedTickets(dependencies: Dependencies) {
	try {
		const parent = dependencies.graph.payload.parent;
		const manifest = await dependencies.manifest.prepare({
			definitionId: dependencies.definitionId,
			graphDigest: dependencies.graph.digest,
			parent: { id: parent.id, revision: parent.revision },
		});
		const children: { stableKey: string; linearId: string }[] = [];
		for (const ticket of topological(dependencies.graph.payload.tickets)) {
			children.push(await dependencies.gateway.createChild({
				operationId: manifest.operationId,
				parent,
				child: { stableKey: ticket.stableKey, title: ticket.title, body: body(ticket), estimate: ticket.estimate.points, workflow: { state: "Triage", assignee: null, cycle: null, labels: [], project: null } },
			}));
		}
		await dependencies.manifest.advance(manifest.operationId, "prepared", "children", { children });
		const relations = dependencies.graph.payload.tickets.flatMap((ticket) =>
			ticket.blockers.map((blockingStableKey) => ({ blockedStableKey: ticket.stableKey, blockingStableKey })),
		);
		for (const relation of relations) {
			await dependencies.gateway.createBlocker({ operationId: manifest.operationId, parent, ...relation });
		}
		await dependencies.manifest.advance(manifest.operationId, "children", "relations", { relations });
		await dependencies.manifest.advance(manifest.operationId, "relations", "verifying", {});
		const expectedChildren = topological(dependencies.graph.payload.tickets).map((ticket, index) => ({
			stableKey: ticket.stableKey,
			title: ticket.title,
			body: body(ticket),
			estimate: ticket.estimate.points,
			workflow: { state: "Triage" as const, assignee: null, cycle: null, labels: [], project: null },
			linearId: children[index].linearId,
			blockedBy: ticket.blockers,
			blocks: dependencies.graph.payload.tickets.filter((candidate) => candidate.blockers.includes(ticket.stableKey)).map((candidate) => candidate.stableKey),
		}));
		const readBack = await dependencies.gateway.readBack({ operationId: manifest.operationId, parent });
		if (!exact(readBack, { parent: { id: parent.id, teamId: parent.teamId, revision: parent.revision }, children: expectedChildren })) {
			throw Object.assign(new Error("Ticket publication read-back mismatch."), { code: "PI_WORKFLOW_PUBLICATION_READBACK_MISMATCH" });
		}
		await dependencies.manifest.advance(manifest.operationId, "verifying", "verified", { verification: { graphDigest: dependencies.graph.digest, parentId: parent.id } });
		return { status: "tickets-published" as const };
	} catch (error) {
		return { status: "blocked" as const, blocker: { code: error && typeof error === "object" && "code" in error ? String(error.code) : "PI_WORKFLOW_PUBLICATION_FAILED", message: error instanceof Error ? error.message : "Ticket publication failed." } };
	}
}
