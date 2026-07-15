import type {
	LinearDeliveryParent,
	LinearDeliveryParentCreate,
	LinearDeliveryParentTransport,
	LinearPublicationPreflight,
} from "./linear-delivery-parent-gateway.ts";
import { canonicalJson, digestCanonicalValue } from "./workflow-contracts.ts";

interface Preflight extends LinearPublicationPreflight {
	backlogStateId: string;
}
type Data = Record<string, unknown>;

function errorCode(value: unknown): string {
	const text = JSON.stringify(value);
	if (/rate.?limit|too many requests/i.test(text))
		return "PI_WORKFLOW_LINEAR_RATE_LIMITED";
	if (
		/permission|forbidden|unauthori[sz]ed|unauthenticated|authentication|access denied/i.test(
			text,
		)
	)
		return "PI_WORKFLOW_LINEAR_PERMISSION_DENIED";
	return "PI_WORKFLOW_LINEAR_REQUEST_FAILED";
}
function marker(key: string): string {
	if (!/^[a-f0-9]{64}$/.test(key))
		throw new Error(
			"Linear publication requires a lowercase SHA-256 publication key.",
		);
	return `[pi-workflow-publication:${key}]`;
}
function parent(
	value: unknown,
	revision: string,
	key: string,
): LinearDeliveryParent {
	if (!value || typeof value !== "object")
		throw new Error("Linear returned no Delivery parent.");
	const issue = value as {
		id?: unknown;
		team?: { id?: unknown };
		title?: unknown;
		description?: unknown;
		state?: { type?: unknown };
		cycle?: unknown;
		assignee?: unknown;
	};
	const suffix = ` ${marker(key)}`;
	if (
		typeof issue.id !== "string" ||
		typeof issue.team?.id !== "string" ||
		typeof issue.title !== "string" ||
		!issue.title.endsWith(suffix) ||
		(issue.description !== null && typeof issue.description !== "string") ||
		issue.state?.type?.toString().toLowerCase() !== "backlog" ||
		issue.cycle !== null ||
		issue.assignee !== null
	) {
		throw new Error("Linear returned an invalid Delivery parent read model.");
	}
	return {
		id: issue.id,
		teamId: issue.team.id,
		title: issue.title.slice(0, -suffix.length),
		description: issue.description ?? "",
		descriptionRevision: revision,
		state: "Backlog",
		cycleId: null,
		assigneeId: null,
		publicationKey: key,
	};
}

export function createRuntimeLinearDeliveryParentTransport(options: {
	apiKey: string;
	url?: string;
	fetch?: typeof fetch;
}): LinearDeliveryParentTransport {
	const request = options.fetch ?? fetch;
	async function graphql(
		operationName: string,
		query: string,
		variables: Data,
	): Promise<Data> {
		const response = await request(
			options.url ?? "https://api.linear.app/graphql",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: options.apiKey,
				},
				body: JSON.stringify({ operationName, query, variables }),
			},
		);
		if (!response.ok) {
			const code =
				response.status === 429
					? "PI_WORKFLOW_LINEAR_RATE_LIMITED"
					: response.status === 401 || response.status === 403
						? "PI_WORKFLOW_LINEAR_PERMISSION_DENIED"
						: "PI_WORKFLOW_LINEAR_REQUEST_FAILED";
			throw Object.assign(
				new Error(`Linear ${operationName} failed with ${response.status}.`),
				{ code },
			);
		}
		const payload = (await response.json()) as {
			data?: Data;
			errors?: readonly { message?: string }[];
		};
		if (payload.errors?.length)
			throw Object.assign(
				new Error(payload.errors.map(({ message }) => message).join("; ")),
				{ code: errorCode(payload.errors) },
			);
		if (!payload.data)
			throw Object.assign(
				new Error(`Linear ${operationName} returned no data.`),
				{ code: "PI_WORKFLOW_LINEAR_REQUEST_FAILED" },
			);
		return payload.data;
	}
	async function preflight(teamId: string): Promise<Preflight> {
		const data = await graphql(
			"DeliveryParentPreflight",
			"query DeliveryParentPreflight($teamId:String!){viewer{id} team(id:$teamId){id cyclesEnabled states{nodes{id type updatedAt}}}}",
			{ teamId },
		);
		const viewer = data.viewer as { id?: unknown } | undefined;
		const team = data.team as
			| { id?: unknown; cyclesEnabled?: unknown; states?: { nodes?: unknown } }
			| undefined;
		const states = Array.isArray(team?.states?.nodes)
			? (team.states.nodes as {
					id?: unknown;
					type?: unknown;
					updatedAt?: unknown;
				}[])
			: [];
		const backlog = states.find(
			({ type }) =>
				typeof type === "string" && type.toLowerCase() === "backlog",
		);
		if (
			typeof viewer?.id !== "string" ||
			team?.id !== teamId ||
			typeof backlog?.id !== "string"
		) {
			throw Object.assign(
				new Error(
					"Linear credentials cannot access the target team or its Backlog state.",
				),
				{ code: "PI_WORKFLOW_LINEAR_PERMISSION_DENIED" },
			);
		}
		return {
			teamId,
			accessRevision: digestCanonicalValue({ viewerId: viewer.id, teamId }),
			capabilityRevision: digestCanonicalValue({
				cyclesEnabled: team.cyclesEnabled === true,
			}),
			stateRevision: digestCanonicalValue(backlog),
			supportsCycles: team.cyclesEnabled === true,
			backlogStateId: backlog.id,
		};
	}
	const fields =
		"id title description team{id} state{id type} cycle{id} assignee{id}";
	return {
		preflight,
		async createIssue(input: LinearDeliveryParentCreate) {
			const current = await preflight(input.teamId);
			const actual = {
				accessRevision: current.accessRevision,
				capabilityRevision: current.capabilityRevision,
				stateRevision: current.stateRevision,
			};
			if (canonicalJson(input.expected) !== canonicalJson(actual))
				throw Object.assign(
					new Error("Linear publication preflight changed before create."),
					{ code: "PI_WORKFLOW_PUBLICATION_STALE" },
				);
			const data = await graphql(
				"DeliveryParentCreate",
				`mutation DeliveryParentCreate($input:IssueCreateInput!){issueCreate(input:$input){success issue{${fields}}}}`,
				{
					input: {
						teamId: input.teamId,
						stateId: current.backlogStateId,
						title: `${input.title} ${marker(input.publicationKey)}`,
						description: input.description,
					},
				},
			);
			const result = data.issueCreate as
				| { success?: unknown; issue?: unknown }
				| undefined;
			if (result?.success !== true)
				throw Object.assign(
					new Error("Linear refused Delivery parent creation."),
					{ code: "PI_WORKFLOW_LINEAR_REQUEST_FAILED" },
				);
			return parent(
				result.issue,
				input.descriptionRevision,
				input.publicationKey,
			);
		},
		async findIssueByPublicationKey(teamId, key, revision) {
			const publicationMarker = marker(key);
			const data = await graphql(
				"DeliveryParentFind",
				`query DeliveryParentFind($teamId:ID!,$marker:String!){issues(filter:{team:{id:{eq:$teamId}},title:{containsIgnoreCase:$marker}}){nodes{${fields}}}}`,
				{ teamId, marker: publicationMarker },
			);
			const nodes = (data.issues as { nodes?: unknown } | undefined)?.nodes;
			return (Array.isArray(nodes) ? nodes : [])
				.filter(
					(candidate) =>
						typeof candidate === "object" &&
						candidate !== null &&
						(candidate as { title?: unknown }).title
							?.toString()
							.endsWith(` ${publicationMarker}`),
				)
				.map((candidate) => parent(candidate, revision, key));
		},
		async readIssue(id, revision, key) {
			const data = await graphql(
				"DeliveryParentRead",
				`query DeliveryParentRead($id:String!){issue(id:$id){${fields}}}`,
				{ id },
			);
			return data.issue ? parent(data.issue, revision, key) : undefined;
		},
	};
}
