import type { DeliveryTicketGraph } from "./delivery-ticket-graph.ts";
import type { LinearDeliveryTicketGateway } from "./linear-delivery-ticket-gateway.ts";
import type { createTicketPublicationManifestStore } from "./ticket-publication-manifest.ts";

type Dependencies = {
	definitionId: string;
	graph: Pick<DeliveryTicketGraph, "digest" | "payload">;
	manifest: ReturnType<typeof createTicketPublicationManifestStore>;
	guard: { revalidate(input: { definitionId: string; graphDigest: string; parent: DeliveryTicketGraph["payload"]["parent"]; stage: string }): Promise<void> };
	gateway: LinearDeliveryTicketGateway;
};

const body = (ticket: DeliveryTicketGraph["payload"]["tickets"][number]) =>
	`Resultado\n\n${ticket.outcome}\n\nCriterios de aceptación\n\n${ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`;

const topological = (tickets: DeliveryTicketGraph["payload"]["tickets"]) => {
	const byKey = new Map(tickets.map((ticket) => [ticket.stableKey, ticket]));
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const ordered: typeof tickets = [];
	const visit = (ticket: (typeof tickets)[number]) => {
		if (visiting.has(ticket.stableKey)) throw Object.assign(new Error("Ticket blockers contain a cycle or missing reference."), { code: "PI_WORKFLOW_TICKET_GRAPH_INVALID" });
		if (visited.has(ticket.stableKey)) return;
		visiting.add(ticket.stableKey);
		visited.add(ticket.stableKey);
		for (const blocker of ticket.blockers) {
			const dependency = byKey.get(blocker);
			if (!dependency) throw Object.assign(new Error("Ticket blockers contain a cycle or missing reference."), { code: "PI_WORKFLOW_TICKET_GRAPH_INVALID" });
			visit(dependency);
		}
		visiting.delete(ticket.stableKey);
		ordered.push(ticket);
	};
	for (const ticket of tickets) visit(ticket);
	return ordered;
};

const exact = (value: unknown, expected: unknown) => JSON.stringify(value) === JSON.stringify(expected);

export async function publishApprovedTickets(dependencies: Dependencies) {
	try {
		if (typeof dependencies.gateway.findChildren !== "function" || typeof dependencies.gateway.findBlockers !== "function") {
			throw Object.assign(new Error("Publication recovery lookup capability is required."), { code: "PI_WORKFLOW_PUBLICATION_RECOVERY_LOOKUP_REQUIRED" });
		}
		const parent = dependencies.graph.payload.parent;
		const revalidate = (stage: string) => dependencies.guard.revalidate({ definitionId: dependencies.definitionId, graphDigest: dependencies.graph.digest, parent, stage });
		await revalidate("prepare");
		const ordered = topological(dependencies.graph.payload.tickets);
		let manifest = await dependencies.manifest.prepare({
			definitionId: dependencies.definitionId,
			graphDigest: dependencies.graph.digest,
			parent: { id: parent.id, revision: parent.revision },
		});
		if (manifest.stage === "prepared") manifest = await dependencies.manifest.advance(manifest.operationId, "prepared", "creating", {});
		const children = [...manifest.children];
		for (const ticket of manifest.stage === "creating" ? ordered.filter((ticket) => !children.some((child) => child.stableKey === ticket.stableKey)) : []) {
			const matches = await dependencies.gateway.findChildren({ operationId: manifest.operationId, parent, stableKey: ticket.stableKey });
			if (matches.length > 1 || matches.length === 1 && matches[0].stableKey !== ticket.stableKey) throw Object.assign(new Error("Publication marker is ambiguous."), { code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT" });
			const child = matches[0] ?? await dependencies.gateway.createChild({ operationId: manifest.operationId, parent, child: { stableKey: ticket.stableKey, title: ticket.title, body: body(ticket), estimate: ticket.estimate.points, workflow: { state: "Triage", assignee: null, cycle: null, labels: [], project: null } } });
			children.push(child);
			manifest = await dependencies.manifest.record(manifest.operationId, "creating", { children, relations: [] });
		}
		if (manifest.stage === "creating") manifest = await dependencies.manifest.advance(manifest.operationId, "creating", "children", {});
		const relations = dependencies.graph.payload.tickets.flatMap((ticket) =>
			ticket.blockers.map((blockingStableKey) => ({ blockedStableKey: ticket.stableKey, blockingStableKey })),
		).sort((left, right) => `${left.blockedStableKey}:${left.blockingStableKey}`.localeCompare(`${right.blockedStableKey}:${right.blockingStableKey}`));
		if (manifest.stage === "children") manifest = await dependencies.manifest.advance(manifest.operationId, "children", "relations", {});
		const recordedRelations = [...manifest.relations];
		for (const relation of manifest.stage === "relations" ? relations.filter((relation) => !recordedRelations.some((recorded) => exact(recorded, relation))) : []) {
			const matches = await dependencies.gateway.findBlockers({ operationId: manifest.operationId, parent, ...relation });
			if (matches.length > 1 || matches[0] && !exact(matches[0], relation)) throw Object.assign(new Error("Publication marker is ambiguous."), { code: "PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT" });
			if (!matches.length) await dependencies.gateway.createBlocker({ operationId: manifest.operationId, parent, ...relation });
			recordedRelations.push(relation);
			manifest = await dependencies.manifest.record(manifest.operationId, "relations", { children, relations: recordedRelations });
		}
		if (manifest.stage === "relations") manifest = await dependencies.manifest.advance(manifest.operationId, "relations", "verifying", {});
		const expectedChildren = ordered.map((ticket, index) => ({
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
		if (manifest.stage === "verifying") await dependencies.manifest.advance(manifest.operationId, "verifying", "verified", { verification: { graphDigest: dependencies.graph.digest, parentId: parent.id } });
		return { status: "tickets-published" as const };
	} catch (error) {
		return { status: "blocked" as const, blocker: { code: error && typeof error === "object" && "code" in error ? String(error.code) : "PI_WORKFLOW_PUBLICATION_FAILED", message: error instanceof Error ? error.message : "Ticket publication failed." } };
	}
}
