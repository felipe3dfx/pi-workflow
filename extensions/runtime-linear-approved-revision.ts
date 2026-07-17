import type { LinearApprovedRevisionGateway, LinearApprovedRevisionIssueSnapshot } from "./approved-revision-publication.ts";

type Data = Record<string, unknown>;

const messages: Record<string, string> = {
	PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE: "Linear returned a malformed response.",
	PI_WORKFLOW_LINEAR_PERMISSION_DENIED: "Linear credentials cannot mutate the target issues.",
	PI_WORKFLOW_LINEAR_RATE_LIMITED: "Linear rate limited the approved revision publication.",
	PI_WORKFLOW_LINEAR_REQUEST_FAILED: "Linear request failed.",
};

const fail = (code: string, message = messages[code] ?? code): never => { throw Object.assign(new Error(message), { code }); };
const text = (value: unknown): value is string => typeof value === "string";

function issue(value: unknown): LinearApprovedRevisionIssueSnapshot | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as { id?: unknown; description?: unknown; updatedAt?: unknown; state?: unknown; assignee?: unknown; cycle?: unknown; labels?: unknown; project?: unknown };
	if (!text(candidate.id) || !text(candidate.updatedAt) || !(candidate.description === null || text(candidate.description))) return undefined;
	return {
		id: candidate.id,
		description: candidate.description ?? "",
		updatedAt: candidate.updatedAt,
		workflow: {
			state: candidate.state,
			assignee: candidate.assignee,
			cycle: candidate.cycle,
			labels: candidate.labels,
			project: candidate.project,
		},
	};
}

export function createRuntimeLinearApprovedRevisionGateway(options: { apiKey: string; url?: string; fetch?: typeof fetch }): LinearApprovedRevisionGateway {
	const request = options.fetch ?? fetch;
	async function graphql(operationName: string, query: string, variables: Data): Promise<Data> {
		let response!: Response;
		try {
			response = await request(options.url ?? "https://api.linear.app/graphql", { method: "POST", headers: { "Content-Type": "application/json", Authorization: options.apiKey }, body: JSON.stringify({ operationName, query, variables }) });
		} catch {
			fail("PI_WORKFLOW_LINEAR_REQUEST_FAILED", `Linear ${operationName} transport failed.`);
		}
		if (!response.ok) fail(response.status === 401 || response.status === 403 ? "PI_WORKFLOW_LINEAR_PERMISSION_DENIED" : response.status === 429 ? "PI_WORKFLOW_LINEAR_RATE_LIMITED" : "PI_WORKFLOW_LINEAR_REQUEST_FAILED");
		let payload: unknown;
		try { payload = await response.json(); } catch { fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE"); }
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		const { data, errors } = payload as { data?: unknown; errors?: unknown };
		if (Array.isArray(errors) && errors.length) fail(/permission|forbidden|unauthor/i.test(JSON.stringify(errors)) ? "PI_WORKFLOW_LINEAR_PERMISSION_DENIED" : "PI_WORKFLOW_LINEAR_REQUEST_FAILED");
		if (!data || typeof data !== "object" || Array.isArray(data)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
		return data as Data;
	}

	const fields = "id description updatedAt state{id name type} assignee{id} cycle{id} labels{nodes{id name}} project{id}";
	return {
		async getIssue({ id }) {
			const data = await graphql("ApprovedRevisionIssueRead", `query ApprovedRevisionIssueRead($id:String!){issue(id:$id){${fields}}}`, { id });
			if (data.issue === null || data.issue === undefined) return undefined;
			const snapshot = issue(data.issue);
			if (!snapshot) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			return snapshot;
		},
		async listComments({ issueId }) {
			const data = await graphql("ApprovedRevisionComments", "query ApprovedRevisionComments($id:String!){issue(id:$id){comments{nodes{id body}}}}", { id: issueId });
			const nodes: unknown = (data.issue as { comments?: { nodes?: unknown } } | undefined)?.comments?.nodes;
			if (!Array.isArray(nodes)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			const comments: { id: string; body: string }[] = [];
			for (const node of nodes as unknown[]) {
				if (!node || typeof node !== "object" || !text((node as { id?: unknown }).id) || !text((node as { body?: unknown }).body)) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
				comments.push({ id: (node as { id: string }).id, body: (node as { body: string }).body });
			}
			return comments;
		},
		async saveComment(input) {
			const data = await graphql("ApprovedRevisionCommentCreate", "mutation ApprovedRevisionCommentCreate($input:CommentCreateInput!){commentCreate(input:$input){success comment{id body}}}", { input: { issueId: input.issueId, body: input.body } });
			const result = data.commentCreate as { success?: unknown; comment?: unknown } | undefined;
			if (result?.success !== true) fail("PI_WORKFLOW_LINEAR_REQUEST_FAILED");
			const comment = result?.comment as { id?: unknown; body?: unknown } | undefined;
			const commentId = comment?.id;
			if (!text(commentId) || comment?.body !== input.body) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			return { id: commentId as string, body: input.body };
		},
		async saveIssue(input) {
			const data = await graphql("ApprovedRevisionIssueUpdate", `mutation ApprovedRevisionIssueUpdate($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{${fields}}}}`, { id: input.id, input: { description: input.description } });
			const result = data.issueUpdate as { success?: unknown; issue?: unknown } | undefined;
			if (result?.success !== true) fail("PI_WORKFLOW_LINEAR_REQUEST_FAILED");
			const updated = issue(result?.issue);
			if (!updated || updated.id !== input.id || updated.description !== input.description) fail("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE");
			return updated as LinearApprovedRevisionIssueSnapshot;
		},
	};
}
