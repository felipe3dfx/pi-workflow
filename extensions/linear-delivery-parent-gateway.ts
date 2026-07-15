export interface LinearPublicationPreflight {
	teamId: string;
	accessRevision: string;
	capabilityRevision: string;
	stateRevision: string;
	supportsCycles: boolean;
}
export interface LinearDeliveryParent {
	id: string;
	teamId: string;
	title: string;
	description: string;
	descriptionRevision: string;
	state: "Backlog";
	cycleId: null;
	assigneeId: null;
	publicationKey: string;
}
export interface LinearDeliveryParentCreate
	extends Omit<LinearDeliveryParent, "id"> {
	expected: Pick<
		LinearPublicationPreflight,
		"accessRevision" | "capabilityRevision" | "stateRevision"
	>;
}
export interface LinearDeliveryParentTransport {
	preflight(teamId: string): Promise<LinearPublicationPreflight>;
	createIssue(input: LinearDeliveryParentCreate): Promise<LinearDeliveryParent>;
	findIssueByPublicationKey(
		teamId: string,
		key: string,
		revision: string,
	): Promise<readonly LinearDeliveryParent[]>;
	readIssue(
		id: string,
		revision: string,
		key: string,
	): Promise<LinearDeliveryParent | undefined>;
}

export function createLinearDeliveryParentGateway(
	transport: LinearDeliveryParentTransport,
) {
	return {
		preflight: transport.preflight,
		async create(input: LinearDeliveryParentCreate) {
			if (
				input.state !== "Backlog" ||
				input.cycleId !== null ||
				input.assigneeId !== null ||
				!input.teamId.trim() ||
				!input.title.trim() ||
				!input.description ||
				!input.descriptionRevision.trim() ||
				!/^[a-f0-9]{64}$/.test(input.publicationKey)
			) {
				throw new Error(
					"A Delivery parent must be created in Backlog with no Cycle or assignee.",
				);
			}
			return transport.createIssue(structuredClone(input));
		},
		findByPublicationKey: transport.findIssueByPublicationKey,
		read: transport.readIssue,
	};
}
