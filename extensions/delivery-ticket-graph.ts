import {
	canonicalJson,
	digestCanonicalValue,
	type WorkflowBlocker,
} from "./workflow-contracts.ts";

type RefKind = "story" | "decision" | "test";
type Parent = { id: string; teamId: string; revision: string; specDigest: string };
type Authority = { actorId: string; role: "Owner"; authorityRevision: string };
type Binding = { storyId: string; acceptanceCriterionId: string; contextId: string };
type Ref = { kind: RefKind; id: string };
type Coverage = {
	stories: { id: string; contextId: string; acceptanceCriteria: string[] }[];
	decisions: string[];
	tests: string[];
};
type Ticket = {
	stableKey: string;
	title: string;
	outcome: string;
	acceptanceCriteria: string[];
	estimate: { points: number; rationale: string };
	blockers: string[];
	refs: Ref[];
	deliveryBindings: Binding[];
};

export interface DeliveryTicketGraph {
	schema: "delivery-ticket-graph";
	schemaVersion: 1;
	payload: { parent: Parent; coverage: Coverage; language: "es"; tickets: Ticket[] };
	digest: string;
}

export interface TicketGraphApproval {
	schema: "delivery-ticket-graph-approval";
	schemaVersion: 1;
	payload: { actor: Authority; parent: Parent; graphDigest: string };
	digest: string;
}

class TicketGraphContractError extends Error {
	readonly code: string;

	constructor(code: string, message = code) {
		super(message);
		this.name = "TicketGraphContractError";
		this.code = code;
	}
}

const fail = (code: string): never => {
	throw new TicketGraphContractError(code);
};
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;
const safeMarkdown = (value: unknown): value is string =>
	text(value) && !/[\r\n]|https?:\/\/|\[[^\]]+\]\([^)]*\)|<[^>]+>|`/u.test(value);
const parent = (value: unknown): value is Parent =>
	record(value) && ["id", "teamId", "revision", "specDigest"].every((key) => text(value[key]));
const authority = (value: unknown): value is Authority =>
	record(value) && text(value.actorId) && value.role === "Owner" && text(value.authorityRevision);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const blocker = (code: string, message: string): WorkflowBlocker => ({ code, message }) as WorkflowBlocker;

export class SpecCoverageIndex {
	readonly stories = new Map<string, { contextId: string; acceptanceCriteria: Set<string> }>();
	readonly decisions = new Set<string>();
	readonly tests = new Set<string>();

	constructor(input: unknown) {
		if (!record(input) || !Array.isArray(input.stories) || !Array.isArray(input.decisions) || !Array.isArray(input.tests)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
		const source = input as { stories: unknown[]; decisions: unknown[]; tests: unknown[] };
		for (const story of source.stories) {
			if (!record(story)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
			const item = story as { id: string; contextId: string; acceptanceCriteria: string[] };
			if (!text(item.id) || !text(item.contextId) || !Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.some((id) => !text(id)) || this.stories.has(item.id)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
			this.stories.set(item.id, { contextId: item.contextId, acceptanceCriteria: new Set(item.acceptanceCriteria) });
		}
		for (const [values, target] of [[source.decisions, this.decisions], [source.tests, this.tests]] as const) {
			for (const id of values) {
				if (!text(id) || target.has(id)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
				target.add(id as string);
			}
		}
	}
}

export const createSpecCoverageIndex = (input: unknown) => new SpecCoverageIndex(input);

function canonicalCoverage(coverage: SpecCoverageIndex): Coverage {
	return {
		stories: [...coverage.stories.entries()]
			.map(([id, story]) => ({ id, contextId: story.contextId, acceptanceCriteria: [...story.acceptanceCriteria].sort() }))
			.sort((left, right) => left.id.localeCompare(right.id)),
		decisions: [...coverage.decisions].sort(),
		tests: [...coverage.tests].sort(),
	};
}

function validateTicket(value: unknown, coverage: SpecCoverageIndex): Ticket {
	if (!record(value)) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID");
	const candidate = value as Ticket;
	if (!safeMarkdown(candidate.title) || !safeMarkdown(candidate.outcome) || !Array.isArray(candidate.acceptanceCriteria) || candidate.acceptanceCriteria.some((item) => !safeMarkdown(item)) || !record(candidate.estimate) || !safeMarkdown(candidate.estimate.rationale)) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID");
	if (!text(candidate.stableKey) || candidate.acceptanceCriteria.length < 4 || candidate.acceptanceCriteria.length > 7 || !Number.isInteger(candidate.estimate.points) || candidate.estimate.points < 1 || candidate.estimate.points > 8 || !Array.isArray(candidate.blockers) || candidate.blockers.some((key) => !text(key)) || !Array.isArray(candidate.refs) || !Array.isArray(candidate.deliveryBindings)) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID");
	const refs: Ref[] = [];
	for (const ref of candidate.refs) {
		if (!record(ref) || !text(ref.id) || !["story", "decision", "test"].includes(ref.kind as string)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
		if ((ref.kind === "story" && !coverage.stories.has(ref.id)) || (ref.kind === "decision" && !coverage.decisions.has(ref.id)) || (ref.kind === "test" && !coverage.tests.has(ref.id))) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
		refs.push({ kind: ref.kind as RefKind, id: ref.id });
	}
	if (!candidate.deliveryBindings.length) fail("PI_WORKFLOW_TICKET_NOT_VERTICAL");
	const contexts = new Set<string>();
	for (const binding of candidate.deliveryBindings) {
		if (!record(binding) || !text(binding.storyId) || !text(binding.acceptanceCriterionId) || !text(binding.contextId)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
		const story = coverage.stories.get(binding.storyId);
		if (!story || story.contextId !== binding.contextId || !story.acceptanceCriteria.has(binding.acceptanceCriterionId)) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
		contexts.add(binding.contextId);
	}
	if (contexts.size !== 1) fail("PI_WORKFLOW_TICKET_CONTEXT_SPAN");
	return { stableKey: candidate.stableKey, title: candidate.title, outcome: candidate.outcome, acceptanceCriteria: [...candidate.acceptanceCriteria], estimate: { points: candidate.estimate.points, rationale: candidate.estimate.rationale }, blockers: [...candidate.blockers].sort(), refs: refs.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))), deliveryBindings: candidate.deliveryBindings.map((binding) => ({ storyId: binding.storyId, acceptanceCriterionId: binding.acceptanceCriterionId, contextId: binding.contextId })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))) };
}

function validateGraph(tickets: Ticket[], coverage: SpecCoverageIndex): void {
	const keys = new Set(tickets.map((ticket) => ticket.stableKey));
	if (!tickets.length || keys.size !== tickets.length) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID");
	for (const ticket of tickets) if (ticket.blockers.some((blocker) => blocker === ticket.stableKey || !keys.has(blocker))) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID");
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const byKey = new Map(tickets.map((ticket) => [ticket.stableKey, ticket]));
	const walk = (key: string): void => { if (visiting.has(key)) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID"); if (visited.has(key)) return; visiting.add(key); for (const blocker of byKey.get(key)?.blockers ?? []) walk(blocker); visiting.delete(key); visited.add(key); };
	for (const key of keys) walk(key);
	const refs = new Set(tickets.flatMap((ticket) => ticket.refs.map((ref) => `${ref.kind}:${ref.id}`)));
	if ([...coverage.stories.keys()].some((id) => !refs.has(`story:${id}`)) || [...coverage.decisions].some((id) => !refs.has(`decision:${id}`)) || [...coverage.tests].some((id) => !refs.has(`test:${id}`))) fail("PI_WORKFLOW_TICKET_REFERENCE_INVALID");
}

export function createDeliveryTicketGraph(input: { parent: unknown; coverage: SpecCoverageIndex; language: unknown; tickets: unknown[] }): DeliveryTicketGraph {
	if (input.language !== "es") fail("PI_WORKFLOW_TICKET_LANGUAGE_INVALID");
	if (!parent(input.parent) || !(input.coverage instanceof SpecCoverageIndex) || !Array.isArray(input.tickets)) fail("PI_WORKFLOW_TICKET_GRAPH_INVALID");
	const graphParent = input.parent as Parent;
	const tickets = input.tickets.map((ticket) => validateTicket(ticket, input.coverage)).sort((left, right) => left.stableKey.localeCompare(right.stableKey));
	validateGraph(tickets, input.coverage);
	const unsigned = { schema: "delivery-ticket-graph" as const, schemaVersion: 1 as const, payload: { parent: graphParent, coverage: canonicalCoverage(input.coverage), language: "es" as const, tickets } };
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

export function createTicketGraphApproval(input: { graph: DeliveryTicketGraph; actor: Authority }): TicketGraphApproval {
	if (!authority(input.actor) || !validGraph(input.graph)) fail("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH");
	const unsigned = { schema: "delivery-ticket-graph-approval" as const, schemaVersion: 1 as const, payload: { actor: input.actor, parent: input.graph.payload.parent, graphDigest: input.graph.digest } };
	return { ...unsigned, digest: digestCanonicalValue(unsigned) };
}

function validGraph(value: unknown): value is DeliveryTicketGraph {
	if (!record(value) || value.schema !== "delivery-ticket-graph" || value.schemaVersion !== 1 || !record(value.payload) || !text(value.digest)) return false;
	try {
		const graph = createDeliveryTicketGraph({
			parent: value.payload.parent,
			coverage: createSpecCoverageIndex(value.payload.coverage),
			language: value.payload.language,
			tickets: value.payload.tickets as unknown[],
		});
		return same(graph, value);
	} catch {
		return false;
	}
}

export function validateTicketGraphApproval(input: unknown): { ok: true } | { ok: false; blocker: WorkflowBlocker } {
	if (!record(input) || !parent(input.parent)) return { ok: false, blocker: blocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket graph approval is invalid.") };
	if (record(input.graph) && record(input.graph.payload) && parent(input.graph.payload.parent) && !same(input.graph.payload.parent, input.parent)) return { ok: false, blocker: blocker("PI_WORKFLOW_TICKET_PARENT_STALE", "The Delivery parent is stale.") };
	if (!validGraph(input.graph)) return { ok: false, blocker: blocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket graph approval is invalid.") };
	if (!authority(input.actor)) return { ok: false, blocker: blocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket graph approval is invalid.") };
	if (!record(input.approval) || input.approval.schema !== "delivery-ticket-graph-approval" || input.approval.schemaVersion !== 1 || !record(input.approval.payload) || !text(input.approval.digest) || input.approval.digest !== digestCanonicalValue({ schema: input.approval.schema, schemaVersion: input.approval.schemaVersion, payload: input.approval.payload }) || !same(input.approval.payload, { actor: input.actor, parent: input.parent, graphDigest: input.graph.digest })) return { ok: false, blocker: blocker("PI_WORKFLOW_TICKET_APPROVAL_MISMATCH", "Ticket graph approval does not match the exact Owner, parent, or graph.") };
	return { ok: true };
}
