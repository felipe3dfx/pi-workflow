import { canonicalJson } from "./workflow-contracts.ts";

export interface DeliveryPullRequestSnapshot {
	branch: string;
	headCommit: string;
	treeDigest: string;
	diffDigest: string;
	clean: boolean;
}

export interface DeliveryPullRequestDraft {
	ticketId: string;
	head: string;
	target: string;
	title: string;
	description: string;
	link: string;
	evidence: {
		headCommit: string;
		treeDigest: string;
		diffDigest: string;
	};
}

export interface DeliveryPullRequestGateway {
	inspect(): Promise<DeliveryPullRequestSnapshot>;
	compareLink(input: { head: string; target: string }): string;
	publish(input: DeliveryPullRequestDraft): Promise<{ url: string }>;
}

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

function exact(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function validateSnapshot(snapshot: DeliveryPullRequestSnapshot, ticketId: string): void {
	if (
		!snapshot.clean ||
		snapshot.branch !== ticketId ||
		![snapshot.headCommit, snapshot.treeDigest, snapshot.diffDigest].every(
			(value) => typeof value === "string" && value.trim().length > 0,
		)
	) {
		fail(
			"PI_WORKFLOW_REVIEW_DIFF_SNAPSHOT_INVALID",
			"review-diff requires the clean, exact Delivery ticket snapshot.",
		);
	}
}

export function createDeliveryPullRequestWorkflow(dependencies: {
	git: DeliveryPullRequestGateway;
	sourceBranch: string;
}) {
	const reviewed = new Map<string, DeliveryPullRequestSnapshot>();

	async function reviewDiff(input: {
		ticket: { id: string; title: string; state: "In Progress" };
		developer: { actorId: string; role: "Developer" };
		snapshot: DeliveryPullRequestSnapshot;
		targetBranch?: string;
		decision: "approved" | "rejected";
	}) {
		const request = structuredClone(input);
		if (request.decision !== "approved" && request.decision !== "rejected")
			fail("PI_WORKFLOW_REVIEW_DIFF_DECISION_REQUIRED", "review-diff requires an explicit Developer decision.");
		if (request.developer.role !== "Developer" || !request.developer.actorId.trim())
			fail("PI_WORKFLOW_DEVELOPER_AUTHORITY_REQUIRED", "review-diff and target override require explicit Developer authority.");
		if (request.decision === "rejected")
			return { status: "review-rejected" as const };
		if (
			!request.ticket.id.trim() ||
			!request.ticket.title.trim() ||
			request.ticket.state !== "In Progress"
		)
			fail("PI_WORKFLOW_PR_TICKET_INVALID", "An In Progress Delivery ticket ID and title are required.");
		validateSnapshot(request.snapshot, request.ticket.id);
		const actual = await dependencies.git.inspect();
		if (!exact(actual, request.snapshot))
			fail(
				"PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
				"The repository no longer matches the snapshot presented at review-diff.",
			);
		const target = request.targetBranch ?? dependencies.sourceBranch;
		if (!target.trim() || target !== target.trim())
			fail("PI_WORKFLOW_TARGET_BRANCH_INVALID", "The PR target must be explicit, canonical, and non-empty.");
		const draft: DeliveryPullRequestDraft = {
			ticketId: request.ticket.id,
			head: request.ticket.id,
			target,
			title: `${request.ticket.id} — ${request.ticket.title}`,
			description: [
				"## Ticket",
				request.ticket.id,
				"",
				"## Evidencia revisada",
				`- Commit: ${request.snapshot.headCommit}`,
				`- Digest del árbol: ${request.snapshot.treeDigest}`,
				`- Digest del diff: ${request.snapshot.diffDigest}`,
			].join("\n"),
			link: dependencies.git.compareLink({ head: request.ticket.id, target }),
			evidence: {
				headCommit: request.snapshot.headCommit,
				treeDigest: request.snapshot.treeDigest,
				diffDigest: request.snapshot.diffDigest,
			},
		};
		reviewed.set(canonicalJson(draft), structuredClone(request.snapshot));
		return { status: "awaiting-confirmation" as const, draft };
	}

	async function confirmPr(input: {
		draft: DeliveryPullRequestDraft;
		developer: { actorId: string; role: "Developer" };
		decision: "confirmed" | "rejected";
	}) {
		const request = structuredClone(input);
		if (request.decision !== "confirmed" && request.decision !== "rejected")
			fail("PI_WORKFLOW_PR_CONFIRMATION_REQUIRED", "confirm-pr requires an explicit Developer decision.");
		if (request.developer.role !== "Developer" || !request.developer.actorId.trim())
			fail("PI_WORKFLOW_DEVELOPER_AUTHORITY_REQUIRED", "confirm-pr requires explicit Developer authority.");
		if (request.decision === "rejected")
			return { status: "confirmation-rejected" as const };
		const draftKey = canonicalJson(request.draft);
		const approvedSnapshot = reviewed.get(draftKey);
		if (!approvedSnapshot)
			fail(
				"PI_WORKFLOW_PR_CONFIRMATION_INVALID",
				"confirm-pr requires the exact draft produced by an approved review-diff gate.",
			);
		reviewed.delete(draftKey);
		const actual = await dependencies.git.inspect();
		if (!exact(actual, approvedSnapshot))
			fail(
				"PI_WORKFLOW_REVIEWED_DIFF_CHANGED",
				"The repository changed after review-diff; review the new snapshot before publishing.",
			);
		const pullRequest = await dependencies.git.publish(request.draft);
		return { status: "pr-published" as const, pullRequest };
	}

	return { reviewDiff, confirmPr };
}

export function createFakeDeliveryPullRequestGateways(input: {
	repository: DeliveryPullRequestSnapshot;
	sourceBranch: string;
}) {
	let repository = structuredClone(input.repository);
	const events: string[] = [];
	const publications: DeliveryPullRequestDraft[] = [];
	const git: DeliveryPullRequestGateway = {
		async inspect() {
			events.push("git:inspect");
			return structuredClone(repository);
		},
		compareLink({ head, target }) {
			return `https://github.test/compare/${target}...${head}`;
		},
		async publish(draft) {
			events.push("git:publish");
			publications.push(structuredClone(draft));
			return { url: `https://github.test/pull/${publications.length}` };
		},
	};
	return {
		gateways: { git, sourceBranch: input.sourceBranch },
		events,
		publications,
		setRepository(next: DeliveryPullRequestSnapshot) {
			repository = structuredClone(next);
		},
	};
}
