import type { LinearDeliveryTicketGateway } from "./linear-delivery-ticket-gateway.ts";
import type { TicketPublicationAuthoritySnapshot } from "./ticket-publication-authority-guard.ts";
import { canonicalJson } from "./workflow-contracts.ts";

type Data = Record<string, unknown>;
type Parent = { id: string; teamId: string; revision: string };
type AuthorityParent = Parent & { specDigest: string };
type AuthorityInput = Omit<TicketPublicationAuthoritySnapshot, "mutationPermission" | "state" | "parent" | "requiredCapabilities"> & { parent: AuthorityParent; expectedParentDescription: string };
const capabilities = ["sub-issues", "native-blockers", "estimates", "triage-state"] as const;
const messages: Record<string, string> = {
	PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE: "Linear returned a malformed response.",
	PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT: "Linear returned a non-exact publication marker.",
	PI_WORKFLOW_PUBLICATION_CAPABILITY_DRIFT: "Required Linear capabilities are unavailable.",
	PI_WORKFLOW_PUBLICATION_PARENT_DRIFT: "Delivery parent binding changed before mutation.",
	PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN: "Linear Triage state is not known compatible.",
};
const fail = (code: string, message = messages[code] ?? code): never => { throw Object.assign(new Error(message), { code }); };
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const marker = (operationId: string, stableKey: string) => {
	if (!/^[a-f0-9]{64}$/.test(operationId) || !text(stableKey)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
	return `[pi-workflow-ticket:${operationId}:${stableKey}]`;
};
const fields = "id title description estimate team{id} parent{id} state{id name type} assignee{id} cycle{id} labels{nodes{id}} project{id} blockedBy{nodes{issue{id title} relatedIssue{id title}}} blocks{nodes{issue{id title} relatedIssue{id title}}}";

export function createRuntimeLinearDeliveryTicketGateway(options: { apiKey: string; url?: string; fetch?: typeof fetch }): LinearDeliveryTicketGateway & {
	readAuthoritySnapshot(input: AuthorityInput): Promise<TicketPublicationAuthoritySnapshot>;
} {
	const request = options.fetch ?? fetch;
	let observedTriageStateId: string | undefined;
	async function graphql(operationName: string, query: string, variables: Data): Promise<Data> {
		let response!: Response;
		try { response = await request(options.url ?? "https://api.linear.app/graphql", { method: "POST", headers: { "Content-Type": "application/json", Authorization: options.apiKey }, body: JSON.stringify({ operationName, query, variables }) }); }
		catch { fail("PI_WORKFLOW_LINEAR_TRANSPORT_FAILED", `Linear ${operationName} transport failed.`); }
		if (!response.ok) fail(response.status === 401 || response.status === 403 ? "PI_WORKFLOW_LINEAR_PERMISSION_DENIED" : response.status === 429 ? "PI_WORKFLOW_LINEAR_RATE_LIMITED" : "PI_WORKFLOW_LINEAR_REQUEST_FAILED");
		let payload: unknown;
		try { payload = await response.json(); } catch { fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE"); }
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		const { data, errors } = payload as { data?: unknown; errors?: unknown };
		if (errors !== undefined) {
			if (Array.isArray(errors)) {
				if (errors.length) fail(/permission|forbidden|unauthor/i.test(JSON.stringify(errors)) ? "PI_WORKFLOW_LINEAR_PERMISSION_DENIED" : "PI_WORKFLOW_LINEAR_REQUEST_FAILED");
			} else fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		return data as Data;
	}
	const sameParent = (candidate: unknown, parent: Parent) => !!candidate && typeof candidate === "object" && (candidate as { id?: unknown }).id === parent.id && (candidate as { team?: { id?: unknown } }).team?.id === parent.teamId;
	function child(value: unknown, parent: Parent, operationId: string) {
		if (!value || typeof value !== "object") fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		const issue: any = value;
		const key = typeof issue.title === "string" ? issue.title.match(/\[pi-workflow-ticket:[a-f0-9]{64}:(.+)]$/)?.[1] : undefined;
		if (!text(issue.id) || !text(key) || !issue.title?.endsWith(marker(operationId, key)) || typeof issue.description !== "string" || typeof issue.estimate !== "number" || issue.state?.name !== "Triage" || issue.state.type !== "triage" || issue.assignee !== null || issue.cycle !== null || !Array.isArray(issue.labels?.nodes) || issue.labels.nodes.length || issue.project !== null || (issue.parent as { id?: unknown } | undefined)?.id !== parent.id) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		const relationKeys = (relations: unknown, direction: "blockedBy" | "blocks") => Array.isArray(relations) ? relations.map((relation) => {
			if (!relation || typeof relation !== "object") fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			const links = relation as { issue?: { id?: unknown; title?: unknown }; relatedIssue?: { id?: unknown; title?: unknown } };
			const [current, other] = direction === "blockedBy" ? [links.relatedIssue, links.issue] : [links.issue, links.relatedIssue];
			const otherTitle = typeof other?.title === "string" ? other.title : "";
			if (!text(current?.id) || !text(current.title) || !text(other?.id) || !text(otherTitle) || current.id !== issue.id || current.title !== issue.title) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			const relatedKey = otherTitle.match(/\[pi-workflow-ticket:[a-f0-9]{64}:(.+)]$/)?.[1];
			if (!text(relatedKey) || otherTitle !== `${relatedKey} ${marker(operationId, relatedKey)}`) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			return relatedKey;
		}) : fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		return { stableKey: key, title: issue.title.slice(0, -marker(operationId, key).length - 1), body: issue.description, estimate: issue.estimate, workflow: { state: "Triage" as const, assignee: null, cycle: null, labels: [] as const, project: null }, linearId: issue.id, blockedBy: relationKeys(issue.blockedBy?.nodes, "blockedBy"), blocks: relationKeys(issue.blocks?.nodes, "blocks") };
	}
	async function find(operationId: string, parent: Parent, stableKey: string) {
		const data = await graphql("DeliveryTicketFind", `query DeliveryTicketFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{id title}}}`, { teamId: parent.teamId, marker: marker(operationId, stableKey) });
		const nodes: unknown = (data.issues as { nodes?: unknown } | undefined)?.nodes;
		if (!Array.isArray(nodes)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		const markers = nodes as unknown[];
		const title = `${stableKey} ${marker(operationId, stableKey)}`;
		if (markers.some((value) => !value || typeof value !== "object" || !text((value as { id?: unknown }).id) || !text((value as { title?: unknown }).title))) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		if (markers.some((value) => (value as { title: string }).title !== title)) fail("PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT");
		return markers as { id: string; title: string }[];
	}
	return {
		async readAuthoritySnapshot(input) {
			const data = await graphql("DeliveryTicketAuthority", "query DeliveryTicketAuthority($teamId:ID!,$parentId:String!){viewer{id permissions{issueCreate}} team(id:$teamId){id cyclesEnabled states{nodes{id name type updatedAt}}} issue(id:$parentId){id description updatedAt team{id} state{type} estimate children{nodes{id}}} issueRelations(first:1){nodes{id}}}", { teamId: input.parent.teamId, parentId: input.parent.id });
			const team: any = data.team;
			const issue: any = data.issue;
			if (!data.viewer || !team || !issue || !Array.isArray(team.states?.nodes) || !Array.isArray((data.issueRelations as { nodes?: unknown } | undefined)?.nodes)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			if (!text((data.viewer as { id?: unknown }).id) || team.id !== input.parent.teamId || !sameParent(issue, input.parent) || !text(input.parent.specDigest) || issue.description !== input.expectedParentDescription || issue.updatedAt !== input.parent.revision || issue.state?.type !== "backlog") fail("PI_WORKFLOW_PUBLICATION_PARENT_DRIFT");
			const triage = team.states.nodes.find((state: any) => state.name === "Triage" && state.type === "triage");
			if (!text(triage?.id) || !Array.isArray(issue.children?.nodes) || !Object.hasOwn(issue, "estimate")) fail("PI_WORKFLOW_PUBLICATION_CAPABILITY_DRIFT");
			if (team.cyclesEnabled !== true) fail("PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN");
			observedTriageStateId = triage.id;
			// Contract assumption: viewer.permissions.issueCreate is explicit mutation authority evidence.
			const mutationPermission = (data.viewer as { permissions?: { issueCreate?: unknown } }).permissions?.issueCreate === true;
			return { definitionId: input.definitionId, artifact: input.artifact, approval: input.approval, authorityRevision: input.authorityRevision, requiredCapabilities: capabilities, mutationPermission, parent: input.parent, state: { parent: "compatible", team: "compatible" } };
		},
		async findChildren({ operationId, parent, stableKey }) { return (await find(operationId, parent, stableKey)).map(({ id }) => ({ stableKey, linearId: id })); },
		async findBlockers({ operationId, parent, blockedStableKey, blockingStableKey }) {
			const [blocked, blocking] = await Promise.all([find(operationId, parent, blockedStableKey), find(operationId, parent, blockingStableKey)]);
			if (blocked.length > 1 || blocking.length > 1) fail("PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT");
			if (blocked.length !== 1 || blocking.length !== 1) fail("PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT");
			const data = await graphql("DeliveryTicketBlockerFind", "query DeliveryTicketBlockerFind($first:ID!,$second:ID!){issueRelations(filter:{issue:{id:{eq:$first}},relatedIssue:{id:{eq:$second}},type:{eq:blocks}}){nodes{issue{id} relatedIssue{id} type}}}", { first: blocking[0].id, second: blocked[0].id });
			const nodes: unknown = (data.issueRelations as { nodes?: unknown } | undefined)?.nodes;
			if (!Array.isArray(nodes)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			const relations = nodes as unknown[];
			const expected = { issue: { id: blocking[0].id }, relatedIssue: { id: blocked[0].id }, type: "blocks" };
			for (const node of relations) {
				if (!node || typeof node !== "object") fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
				const relation = node as { issue?: { id?: unknown }; relatedIssue?: { id?: unknown }; type?: unknown };
				if (!text(relation.issue?.id) || !text(relation.relatedIssue?.id) || typeof relation.type !== "string") fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
				if (canonicalJson(node) !== canonicalJson(expected)) fail("PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT");
			}
			return relations.map(() => ({ blockedStableKey, blockingStableKey }));
		},
		async createChild({ operationId, parent, child: input }) {
			if (input.workflow.state !== "Triage" || input.workflow.assignee !== null || input.workflow.cycle !== null || input.workflow.labels.length || input.workflow.project !== null) fail("PI_WORKFLOW_PUBLICATION_CAPABILITY_DRIFT");
			if (!text(observedTriageStateId)) fail("PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN");
			const data = await graphql("DeliveryTicketCreate", `mutation DeliveryTicketCreate($input:IssueCreateInput!){issueCreate(input:$input){success issue{${fields}}}}`, { input: { teamId: parent.teamId, parentId: parent.id, stateId: observedTriageStateId, title: `${input.title} ${marker(operationId, input.stableKey)}`, description: input.body, estimate: input.estimate } });
			const result: any = data.issueCreate;
			if (result?.success !== true) fail("PI_WORKFLOW_LINEAR_REQUEST_FAILED");
			const value = child(result.issue, parent, operationId);
			return { stableKey: value.stableKey, linearId: value.linearId };
		},
		async createBlocker({ operationId, parent, blockedStableKey, blockingStableKey }) {
			const [blocked, blocking] = await Promise.all([find(operationId, parent, blockedStableKey), find(operationId, parent, blockingStableKey)]);
			if (blocked.length !== 1 || blocking.length !== 1) fail("PI_WORKFLOW_PUBLICATION_IDEMPOTENCY_CONFLICT");
			const data = await graphql("DeliveryTicketBlockerCreate", "mutation DeliveryTicketBlockerCreate($input:IssueRelationCreateInput!){issueRelationCreate(input:$input){success}}", { input: { issueId: blocking[0].id, relatedIssueId: blocked[0].id, type: "blocks" } });
			if ((data.issueRelationCreate as { success?: unknown } | undefined)?.success !== true) fail("PI_WORKFLOW_LINEAR_REQUEST_FAILED");
		},
		async readBack({ operationId, parent }) {
			const data = await graphql("DeliveryTicketReadBack", `query DeliveryTicketReadBack($id:String!){issue(id:$id){id team{id} children{nodes{${fields}}}}}`, { id: parent.id });
			const root: any = data.issue;
			if (root?.id !== parent.id || root.team?.id !== parent.teamId || !Array.isArray(root.children?.nodes)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			return { parent, children: root.children.nodes.map((value: unknown) => child(value, parent, operationId)) };
		},
	};
}
