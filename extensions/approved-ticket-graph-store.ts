import {
	canonicalJson,
	type VerifiedArtifactRef,
} from "./workflow-contracts.ts";
import {
	createDeliveryTicketGraph,
	createSpecCoverageIndex,
	type DeliveryTicketGraph,
} from "./delivery-ticket-graph.ts";
import type { WorkflowArtifactStore } from "./workflow-artifacts.ts";

export function parseApprovedTicketGraph(content: string): DeliveryTicketGraph {
	try {
		const value = JSON.parse(content) as DeliveryTicketGraph;
		const graph = createDeliveryTicketGraph({
			parent: value.payload.parent,
			coverage: createSpecCoverageIndex(value.payload.coverage),
			language: value.payload.language,
			tickets: value.payload.tickets,
		});
		if (canonicalJson(graph) !== canonicalJson(value)) throw new Error();
		return graph;
	} catch {
		throw new Error("Approved ticket graph is invalid or corrupt.");
	}
}

export function createApprovedTicketGraphStore({
	store,
	project,
	topic,
}: {
	store: WorkflowArtifactStore;
	project: string;
	topic: string;
}) {
	async function save(
		graph: DeliveryTicketGraph,
		expectedRevision?: string,
	): Promise<VerifiedArtifactRef> {
		if (store.capabilities?.atomicCompareAndSwap !== true)
			throw new Error("Atomic compare-and-swap is required for approved ticket graphs.");
		if (canonicalJson(parseApprovedTicketGraph(canonicalJson(graph))) !== canonicalJson(graph))
			throw new Error("Approved ticket graph is invalid or corrupt.");
		const content = `${canonicalJson(graph)}\n`;
		const snapshotTopic = `${topic}/${graph.digest}`;
		const current = await store.readCurrent(project, snapshotTopic);
		if (current) {
			const recorded = parseApprovedTicketGraph(current.content);
			if (canonicalJson(recorded) !== canonicalJson(graph))
				throw new Error("Approved ticket graph snapshot conflicts with its digest identity.");
			const readBack = await store.readRevision(project, snapshotTopic, current.revision);
			if (readBack !== content) throw new Error("Approved ticket graph read-back mismatch.");
			return { kind: "engram", project, topic: snapshotTopic, revision: current.revision, schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
		}
		let revision: string;
		try {
			({ revision } = await store.write(project, snapshotTopic, content, expectedRevision));
		} catch (error) {
			if (error instanceof Error && /compare-and-swap|conflict/i.test(error.message))
				throw new Error("Approved ticket graph compare-and-swap conflict.");
			throw new Error("Approved ticket graph could not be written.");
		}
		const readBack = await store.readRevision(project, snapshotTopic, revision);
		if (readBack !== content) throw new Error("Approved ticket graph read-back mismatch.");
		parseApprovedTicketGraph(readBack);
		return { kind: "engram", project, topic: snapshotTopic, revision, schema: "delivery-ticket-graph", schemaVersion: 1, digest: graph.digest };
	}

	return { save };
}
