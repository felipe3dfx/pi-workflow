export type DeliveryReentryPhase =
	| "design"
	| "tasks"
	| "apply"
	| "verify"
	| "prepare-commit";

export interface DeliveryReentryArtifact {
	phase: DeliveryReentryPhase;
	revision: string;
	digest: string;
	snapshotDigest: string;
	verified: boolean;
}

export interface DeliveryReworkFeedback {
	id: string;
	issueId: string;
	createdAt: string;
	kind: "delivery-rework";
	targetPhase: DeliveryReentryPhase;
	affectedIssueIds: readonly string[];
	snapshotDigest: string;
	supersedes?: string;
	multiIssueReviewId?: string;
}

interface DeliveryReentryTicket {
	id: string;
	state: string;
	siblingIds: readonly string[];
}

interface DeliveryReentryGateways {
	linear: {
		readTicket(ticketId: string): Promise<DeliveryReentryTicket>;
		readLocalComments(ticketId: string): Promise<readonly unknown[]>;
		updateState(ticketId: string, state: "To do" | "In Progress"): Promise<void>;
		updateDescription(ticketId: string, description: string): Promise<void>;
	};
	engram: {
		readVerifiedArtifacts(ticketId: string): Promise<readonly DeliveryReentryArtifact[]>;
	};
	multiIssueReviews: {
		isApproved(reviewId: string): Promise<boolean>;
	};
	reviews: {
		hasReviewedSnapshot(ticketId: string, snapshotDigest: string): Promise<boolean>;
		request(ticketId: string, snapshotDigest: string): Promise<void>;
	};
}

function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}

const phases: readonly DeliveryReentryPhase[] = [
	"design",
	"tasks",
	"apply",
	"verify",
	"prepare-commit",
];

function isFeedback(value: unknown): value is DeliveryReworkFeedback {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<DeliveryReworkFeedback>;
	return (
		candidate.kind === "delivery-rework" &&
		typeof candidate.id === "string" &&
		candidate.id.trim().length > 0 &&
		typeof candidate.issueId === "string" &&
		typeof candidate.createdAt === "string" &&
		phases.includes(candidate.targetPhase as DeliveryReentryPhase) &&
		Array.isArray(candidate.affectedIssueIds) &&
		candidate.affectedIssueIds.length > 0 &&
		candidate.affectedIssueIds.every(
			(issueId) => typeof issueId === "string" && issueId.trim().length > 0,
		) &&
		typeof candidate.snapshotDigest === "string" &&
		candidate.snapshotDigest.trim().length > 0
	);
}

function verifyArtifacts(
	artifacts: readonly DeliveryReentryArtifact[],
): Map<DeliveryReentryPhase, DeliveryReentryArtifact> {
	const verified = new Map<DeliveryReentryPhase, DeliveryReentryArtifact>();
	for (const artifact of artifacts) {
		if (
			!artifact.verified ||
			!phases.includes(artifact.phase) ||
			![artifact.revision, artifact.digest, artifact.snapshotDigest].every(
				(value) => typeof value === "string" && value.trim().length > 0,
			)
		)
			fail(
				"PI_WORKFLOW_REENTRY_ARTIFACT_INVALID",
				"Delivery reentry requires verified Engram artifacts.",
			);
		if (verified.has(artifact.phase))
			fail(
				"PI_WORKFLOW_REENTRY_ARTIFACT_INVALID",
				"Delivery reentry requires one current artifact per phase.",
			);
		verified.set(artifact.phase, structuredClone(artifact));
	}
	if (new Set([...verified.values()].map(({ snapshotDigest }) => snapshotDigest)).size > 1)
		fail(
			"PI_WORKFLOW_REENTRY_ARTIFACT_INVALID",
			"Delivery reentry artifacts must describe one current delivery snapshot.",
		);
	return verified;
}

function currentFeedback(
	comments: readonly unknown[],
	artifacts: ReadonlyMap<DeliveryReentryPhase, DeliveryReentryArtifact>,
	ticketId: string,
): DeliveryReworkFeedback | undefined {
	const current = comments.filter(isFeedback).filter(
		(comment) =>
			comment.issueId === ticketId &&
			artifacts.get(comment.targetPhase)?.snapshotDigest ===
				comment.snapshotDigest &&
			Number.isFinite(Date.parse(comment.createdAt)),
	);
	const superseded = new Set(
		current.flatMap((comment) =>
			comment.supersedes ? [comment.supersedes] : [],
		),
	);
	return current
		.filter((comment) => !superseded.has(comment.id))
		.sort(
			(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
		)[0];
}

export function createDeliveryReentryWorkflow(
	dependencies: DeliveryReentryGateways,
) {
	async function classify(input: {
		ticketId: string;
		humanRestart?: boolean;
	}) {
		const ticketId = input.ticketId.trim();
		if (!ticketId)
			fail(
				"PI_WORKFLOW_DELIVERY_TICKET_REQUIRED",
				"A Delivery ticket ID is required.",
			);
		const ticket = await dependencies.linear.readTicket(ticketId);
		if (ticket.id !== ticketId)
			fail(
				"PI_WORKFLOW_DELIVERY_TICKET_MISMATCH",
				"Linear returned a different Delivery ticket.",
			);
		const artifacts = verifyArtifacts(
			await dependencies.engram.readVerifiedArtifacts(ticketId),
		);
		const comments = await dependencies.linear.readLocalComments(ticketId);
		if (ticket.state === "Canceled" || ticket.state === "Duplicate")
			fail(
				"PI_WORKFLOW_DELIVERY_REENTRY_TERMINAL",
				"Canceled and Duplicate tickets cannot reenter delivery.",
			);
		if (ticket.state === "Stop" && input.humanRestart !== true)
			fail(
				"PI_WORKFLOW_HUMAN_RESTART_REQUIRED",
				"A human must explicitly restart a stopped Delivery ticket.",
			);

		const selected = currentFeedback(comments, artifacts, ticketId);
		if (!selected)
			fail(
				"PI_WORKFLOW_STRUCTURED_FEEDBACK_REQUIRED",
				"Current structured Delivery feedback is required for reentry.",
			);

		const affectedIssueIds = [...new Set(selected.affectedIssueIds)];
		if (!affectedIssueIds.includes(ticketId))
			fail(
				"PI_WORKFLOW_FEEDBACK_SCOPE_INVALID",
				"Structured feedback must include the current Delivery ticket.",
			);
		if (affectedIssueIds.length > 1) {
			if (
				!selected.multiIssueReviewId ||
				!(await dependencies.multiIssueReviews.isApproved(
					selected.multiIssueReviewId,
				))
			)
				fail(
					"PI_WORKFLOW_MULTI_ISSUE_REVIEW_REQUIRED",
					"Multi-issue reentry requires an approved T11 review.",
				);
			const allowed = new Set([ticket.id, ...ticket.siblingIds]);
			if (affectedIssueIds.some((issueId) => !allowed.has(issueId)))
				fail(
					"PI_WORKFLOW_FEEDBACK_SCOPE_INVALID",
					"Multi-issue feedback may affect only the ticket and its siblings.",
				);
		}

		const alreadyReviewed = await dependencies.reviews.hasReviewedSnapshot(
			ticketId,
			selected.snapshotDigest,
		);
		if (!alreadyReviewed)
			await dependencies.reviews.request(ticketId, selected.snapshotDigest);
		return {
			status: "resume" as const,
			phase: selected.targetPhase,
			feedbackId: selected.id,
			affectedIssueIds,
			review: alreadyReviewed ? ("reused" as const) : ("requested" as const),
		};
	}
	return { classify };
}

export function createFakeDeliveryReentryGateways(input: {
	ticket: DeliveryReentryTicket;
	artifacts: readonly DeliveryReentryArtifact[];
	comments: readonly unknown[];
	reviewedSnapshotDigests?: readonly string[];
	approvedMultiIssueReviewIds?: readonly string[];
	initialDescriptions?: Readonly<Record<string, string>>;
}) {
	const ticket = structuredClone(input.ticket);
	const artifacts = structuredClone(input.artifacts);
	const comments = structuredClone(input.comments);
	const reviewed = new Set(input.reviewedSnapshotDigests ?? []);
	const approved = new Set(input.approvedMultiIssueReviewIds ?? []);
	const descriptions = new Map(Object.entries(input.initialDescriptions ?? {}));
	const events: string[] = [];
	const stateWrites: { ticketId: string; state: "To do" | "In Progress" }[] = [];
	const descriptionWrites: { ticketId: string; description: string }[] = [];
	return {
		events,
		stateWrites,
		descriptionWrites,
		ticketSnapshot: structuredClone(ticket),
		description(ticketId: string) {
			return descriptions.get(ticketId);
		},
		gateways: {
			linear: {
				async readTicket(ticketId: string) {
					events.push(`linear:read-ticket:${ticketId}`);
					return structuredClone(ticket);
				},
				async readLocalComments(ticketId: string) {
					events.push(`linear:read-comments:${ticketId}`);
					return structuredClone(comments);
				},
				async updateState(ticketId: string, state: "To do" | "In Progress") {
					stateWrites.push({ ticketId, state });
				},
				async updateDescription(ticketId: string, description: string) {
					descriptionWrites.push({ ticketId, description });
					descriptions.set(ticketId, description);
				},
			},
			engram: {
				async readVerifiedArtifacts(ticketId: string) {
					events.push(`engram:read-verified:${ticketId}`);
					return structuredClone(artifacts);
				},
			},
			multiIssueReviews: {
				async isApproved(reviewId: string) {
					events.push(`t11:read:${reviewId}`);
					return approved.has(reviewId);
				},
			},
			reviews: {
				async hasReviewedSnapshot(ticketId: string, snapshotDigest: string) {
					events.push(`review:read:${ticketId}:${snapshotDigest}`);
					return reviewed.has(snapshotDigest);
				},
				async request(ticketId: string, snapshotDigest: string) {
					events.push(`review:request:${ticketId}:${snapshotDigest}`);
					reviewed.add(snapshotDigest);
				},
			},
		} satisfies DeliveryReentryGateways,
	};
}
