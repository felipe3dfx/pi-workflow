import type {
	LinearQaHandoffGateway,
	LinearQaHandoffIssueSnapshot,
} from "./qa-handoff-workflow.ts";

export interface LinearQaHandoffTransport {
	getIssue(input: {
		readonly id: string;
		readonly includeRelations: true;
	}): Promise<unknown>;
	listComments(input: {
		readonly issueId: string;
		readonly cursor?: string;
		readonly limit: 250;
	}): Promise<unknown>;
	saveComment(input: {
		readonly issueId: string;
		readonly body: string;
	}): Promise<unknown>;
}

const malformed = (): never => {
	throw Object.assign(new Error("Linear returned a malformed response."), {
		code: "PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE",
	});
};

const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const text = (value: unknown): value is string => string(value) && value.length > 0;

function issueSnapshot(value: unknown): LinearQaHandoffIssueSnapshot {
	if (!record(value)) malformed();
	const candidate = value as Record<string, unknown>;
	if (!text(candidate.id) || !text(candidate.title) ||
		!(candidate.description === null || string(candidate.description)) ||
		!text(candidate.updatedAt) || !record(candidate.status) ||
		!text(candidate.status.id) || !text(candidate.status.name) || !text(candidate.status.type) ||
		!(candidate.assignee === null || candidate.assignee === undefined || string(candidate.assignee)) ||
		!(candidate.assigneeId === null || candidate.assigneeId === undefined || text(candidate.assigneeId)) ||
		!(candidate.cycleId === null || candidate.cycleId === undefined || text(candidate.cycleId)) ||
		!Array.isArray(candidate.labels) || candidate.labels.some((label) => !text(label)) ||
		!record(candidate.relations)) malformed();
	const relations = candidate.relations as Record<string, unknown>;
	for (const relation of ["blockedBy", "blocks", "relatedTo"] as const) {
		if (!Array.isArray(relations[relation]) ||
			(relations[relation] as unknown[]).some((item) => !record(item) || !text(item.id)))
			malformed();
	}
	if (!(relations.duplicateOf === null || relations.duplicateOf === undefined ||
		(record(relations.duplicateOf) && text(relations.duplicateOf.id)))) malformed();
	if (!(candidate.parentId === null || candidate.parentId === undefined || text(candidate.parentId)))
		malformed();
	return {
		id: candidate.id as string,
		identifier: candidate.id as string,
		title: candidate.title as string,
		description: (candidate.description ?? "") as string,
		updatedAt: candidate.updatedAt as string,
		state: structuredClone(candidate.status),
		assignee: candidate.assigneeId
			? { id: candidate.assigneeId, name: candidate.assignee ?? undefined }
			: null,
		cycle: candidate.cycleId ? { id: candidate.cycleId } : null,
		labels: structuredClone(candidate.labels),
		estimate: structuredClone(candidate.estimate ?? null),
		relations: structuredClone(relations),
		...(candidate.parentId ? { parent: { id: candidate.parentId } } : {}),
	};
}

function comment(value: unknown, expectedBody?: string): { id: string; body: string } {
	if (!record(value)) malformed();
	const candidate = value as Record<string, unknown>;
	if (!text(candidate.id) || !string(candidate.body) ||
		(expectedBody !== undefined && candidate.body !== expectedBody)) malformed();
	return { id: candidate.id as string, body: candidate.body as string };
}

export function createLinearQaHandoffGateway(
	transport: LinearQaHandoffTransport,
): LinearQaHandoffGateway {
	return {
		async getIssue({ id }) {
			const value = await transport.getIssue({ id, includeRelations: true });
			if (value === null || value === undefined) return undefined;
			return issueSnapshot(value);
		},
		async listComments({ issueId, cursor }) {
			const value = await transport.listComments({ issueId, cursor, limit: 250 });
			if (!record(value)) malformed();
			const page = value as Record<string, unknown>;
			if (!Array.isArray(page.comments) || typeof page.hasNextPage !== "boolean") malformed();
			if (page.hasNextPage && !text(page.cursor)) malformed();
			if (!page.hasNextPage && page.cursor !== undefined && page.cursor !== null &&
				!text(page.cursor)) malformed();
			return {
				comments: (page.comments as unknown[]).map((candidate) => comment(candidate)),
				...(page.hasNextPage ? { nextCursor: page.cursor as string } : {}),
			};
		},
		async createComment(input) {
			const value = await transport.saveComment({
				issueId: input.issueId,
				body: input.body,
			});
			return comment(value, input.body);
		},
	};
}

type LinearData = Record<string, unknown>;

function linearFailure(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

function linearErrorCode(value: unknown): string {
	const serialized = JSON.stringify(value);
	if (/rate.?limit|too many requests/i.test(serialized))
		return "PI_WORKFLOW_LINEAR_RATE_LIMITED";
	if (/permission|forbidden|unauthori[sz]ed|authentication|access denied/i.test(serialized))
		return "PI_WORKFLOW_LINEAR_PERMISSION_DENIED";
	return "PI_WORKFLOW_LINEAR_REQUEST_FAILED";
}

function relationReference(value: unknown): { id: string } | undefined {
	if (!record(value)) return undefined;
	const identifier = value.identifier;
	const id = value.id;
	return text(identifier) ? { id: identifier } : text(id) ? { id } : undefined;
}

function runtimeIssue(value: unknown): { readonly identifier: string; readonly uuid: string; readonly snapshot: unknown } {
	if (!record(value)) return malformed();
	const issue = value;
	if (!text(issue.id) || !text(issue.identifier) || !text(issue.title) ||
		!(issue.description === null || string(issue.description)) ||
		!text(issue.updatedAt) || !record(issue.state) || !text(issue.state.id) ||
		!text(issue.state.name) || !text(issue.state.type) ||
		!(issue.assignee === null || issue.assignee === undefined || record(issue.assignee)) ||
		!(issue.cycle === null || issue.cycle === undefined || record(issue.cycle)) ||
		!record(issue.labels) || !Array.isArray(issue.labels.nodes) ||
		!record(issue.relations) || !Array.isArray(issue.relations.nodes)) return malformed();
	const id = issue.id;
	const identifier = issue.identifier;
	const title = issue.title;
	const updatedAt = issue.updatedAt;
	const state = issue.state;
	const assignee = issue.assignee as Record<string, unknown> | null | undefined;
	const cycle = issue.cycle as Record<string, unknown> | null | undefined;
	if (assignee && (!text(assignee.id) || !text(assignee.name))) return malformed();
	if (cycle && !text(cycle.id)) return malformed();
	const labels = (issue.labels.nodes as unknown[]).map((label) => {
		if (!record(label) || !text(label.name)) return malformed();
		return label.name;
	});
	const blockedBy: { id: string }[] = [];
	const blocks: { id: string }[] = [];
	const relatedTo: { id: string }[] = [];
	let duplicateOf: { id: string } | undefined;
	for (const relation of issue.relations.nodes as unknown[]) {
		if (!record(relation) || !text(relation.id) || !text(relation.type))
			return malformed();
		const source = relationReference(relation.issue);
		const target = relationReference(relation.relatedIssue);
		if (!source || !target) return malformed();
		const currentIsSource = source.id === identifier ||
			(record(relation.issue) && relation.issue.id === id);
		const other = currentIsSource ? target : source;
		if (relation.type === "blocks") {
			(currentIsSource ? blocks : blockedBy).push(other);
		} else if (relation.type === "related") {
			relatedTo.push(other);
		} else if (relation.type === "duplicate" && currentIsSource) {
			duplicateOf = other;
		}
	}
	return {
		identifier,
		uuid: id,
		snapshot: {
			id: identifier,
			title,
			description: issue.description,
			updatedAt,
			status: structuredClone(state),
			assignee: assignee?.name ?? null,
			assigneeId: assignee?.id ?? null,
			cycleId: cycle?.id ?? null,
			labels,
			estimate: structuredClone(issue.estimate ?? null),
			relations: {
				blockedBy,
				blocks,
				relatedTo,
				...(duplicateOf ? { duplicateOf } : {}),
			},
			parentId: record(issue.parent) && text(issue.parent.id)
				? issue.parent.id
				: null,
		},
	};
}

export function createRuntimeLinearQaHandoffTransport(options: {
	readonly apiKey: string;
	readonly url?: string;
	readonly fetch?: typeof fetch;
}): LinearQaHandoffTransport {
	const request = options.fetch ?? fetch;
	const issueUuids = new Map<string, string>();
	async function graphql(
		operationName: string,
		query: string,
		variables: LinearData,
	): Promise<LinearData> {
		let response: Response;
		try {
			response = await request(options.url ?? "https://api.linear.app/graphql", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: options.apiKey,
				},
				body: JSON.stringify({ operationName, query, variables }),
			});
		} catch {
			linearFailure(
				"PI_WORKFLOW_LINEAR_REQUEST_FAILED",
				`Linear ${operationName} transport failed.`,
			);
		}
		if (!response.ok) {
			const code = response.status === 429
				? "PI_WORKFLOW_LINEAR_RATE_LIMITED"
				: response.status === 401 || response.status === 403
					? "PI_WORKFLOW_LINEAR_PERMISSION_DENIED"
					: "PI_WORKFLOW_LINEAR_REQUEST_FAILED";
			linearFailure(code, `Linear ${operationName} failed with ${response.status}.`);
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			linearFailure("PI_WORKFLOW_LINEAR_MALFORMED_RESPONSE", "Linear returned invalid JSON.");
		}
		if (!record(payload)) return malformed();
		const responsePayload = payload;
		if (Array.isArray(responsePayload.errors) && responsePayload.errors.length > 0) {
			linearFailure(
				linearErrorCode(responsePayload.errors),
				`Linear ${operationName} returned GraphQL errors.`,
			);
		}
		if (!record(responsePayload.data)) return malformed();
		return responsePayload.data;
	}

	return {
		async getIssue({ id }) {
			const data = await graphql(
				"QaHandoffIssueRead",
				"query QaHandoffIssueRead($id:String!){issue(id:$id){id identifier title description updatedAt estimate state{id name type} assignee{id name} cycle{id} labels{nodes{name}} parent{id} relations{nodes{id type issue{id identifier} relatedIssue{id identifier}}}}}",
				{ id },
			);
			if (data.issue === null || data.issue === undefined) return undefined;
			const mapped = runtimeIssue(data.issue);
			issueUuids.set(mapped.identifier, mapped.uuid);
			return mapped.snapshot;
		},
		async listComments({ issueId, cursor, limit }) {
			const data = await graphql(
				"QaHandoffCommentsRead",
				"query QaHandoffCommentsRead($id:String!,$after:String,$first:Int!){issue(id:$id){comments(after:$after,first:$first){nodes{id body} pageInfo{hasNextPage endCursor}}}}",
				{ id: issueId, after: cursor ?? null, first: limit },
			);
			if (!record(data.issue) || !record(data.issue.comments)) return malformed();
			const comments = data.issue.comments;
			if (!Array.isArray(comments.nodes) || !record(comments.pageInfo) ||
				typeof comments.pageInfo.hasNextPage !== "boolean") return malformed();
			const pageInfo = comments.pageInfo;
			if (pageInfo.hasNextPage && !text(pageInfo.endCursor)) return malformed();
			return {
				comments: structuredClone(comments.nodes),
				hasNextPage: pageInfo.hasNextPage,
				...(pageInfo.hasNextPage ? { cursor: pageInfo.endCursor } : {}),
			};
		},
		async saveComment({ issueId, body }) {
			const data = await graphql(
				"QaHandoffCommentCreate",
				"mutation QaHandoffCommentCreate($input:CommentCreateInput!){commentCreate(input:$input){success comment{id body}}}",
				{ input: { issueId: issueUuids.get(issueId) ?? issueId, body } },
			);
			if (!record(data.commentCreate)) return malformed();
			const result = data.commentCreate;
			if (result.success !== true || !record(result.comment)) return malformed();
			return structuredClone(result.comment);
		},
	};
}
