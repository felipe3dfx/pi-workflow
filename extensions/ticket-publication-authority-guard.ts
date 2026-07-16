export type TicketPublicationAuthoritySnapshot = {
	definitionId: string;
	artifact: { approvedDigest: string; graphDigest: string };
	approval: { ownerId: string; role: "Owner"; digest: string };
	authorityRevision: string;
	requiredCapabilities: readonly string[];
	mutationPermission: boolean;
	parent: { id: string; teamId: string; revision: string; specDigest: string };
	state: { parent: "compatible" | "unknown"; team: "compatible" | "unknown" };
};

export type TicketPublicationRevalidation = {
	definitionId: string;
	graphDigest: string;
	parent: TicketPublicationAuthoritySnapshot["parent"];
	stage: string;
};

export interface TicketPublicationAuthorityGuard {
	revalidate(input: TicketPublicationRevalidation): Promise<void>;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const blockers = {
	artifact: ["PI_WORKFLOW_PUBLICATION_ARTIFACT_DRIFT", "Approved artifact or graph changed before mutation."],
	approval: ["PI_WORKFLOW_PUBLICATION_APPROVAL_DRIFT", "Owner approval binding changed before mutation."],
	authority: ["PI_WORKFLOW_PUBLICATION_AUTHORITY_DRIFT", "Owner authority revision changed before mutation."],
	capability: ["PI_WORKFLOW_PUBLICATION_CAPABILITY_DRIFT", "Required capabilities changed before mutation."],
	permission: ["PI_WORKFLOW_PUBLICATION_PERMISSION_DENIED", "Mutation permission changed before mutation."],
	parent: ["PI_WORKFLOW_PUBLICATION_PARENT_DRIFT", "Delivery parent binding changed before mutation."],
	state: ["PI_WORKFLOW_PUBLICATION_STATE_UNKNOWN", "Parent or team state is not known compatible before mutation."],
} as const;

const fail = (dimension: keyof typeof blockers): never => {
	const [code, message] = blockers[dimension];
	throw Object.assign(new Error(message), { code });
};

export function createTicketPublicationAuthorityGuard(options: {
	expected: TicketPublicationAuthoritySnapshot;
	current(input: TicketPublicationRevalidation): Promise<TicketPublicationAuthoritySnapshot>;
}): TicketPublicationAuthorityGuard {
	return {
		async revalidate(input) {
			const current = await options.current(input);
			if (input.definitionId !== options.expected.definitionId || current.definitionId !== options.expected.definitionId || input.graphDigest !== options.expected.artifact.graphDigest || !same(input.parent, options.expected.parent) || !same(current.artifact, options.expected.artifact)) fail("artifact");
			if (!same(current.approval, options.expected.approval)) fail("approval");
			if (current.authorityRevision !== options.expected.authorityRevision) fail("authority");
			if (!same(current.requiredCapabilities, options.expected.requiredCapabilities)) fail("capability");
			if (current.mutationPermission !== true || options.expected.mutationPermission !== true) fail("permission");
			if (!same(current.parent, options.expected.parent)) fail("parent");
			if (current.state.parent !== "compatible" || current.state.team !== "compatible") fail("state");
		},
	};
}
