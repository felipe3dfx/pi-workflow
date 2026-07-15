export interface LinearDeliveryParent {
	id: string;
	teamId: string;
	revision: string;
}

interface LinearDeliveryChild {
	stableKey: string;
	title: string;
	body: string;
	estimate: number;
	workflow: { state: "Triage"; assignee: null; cycle: null; labels: readonly []; project: null };
}

export interface LinearDeliveryTicketGateway {
	createChild(input: { operationId: string; parent: LinearDeliveryParent; child: LinearDeliveryChild }): Promise<{ stableKey: string; linearId: string }>;
	createBlocker(input: { operationId: string; parent: LinearDeliveryParent; blockedStableKey: string; blockingStableKey: string }): Promise<void>;
	readBack(input: { operationId: string; parent: LinearDeliveryParent }): Promise<{ parent: LinearDeliveryParent; children: readonly (LinearDeliveryChild & { linearId: string })[]; blockers: readonly { blockedStableKey: string; blockingStableKey: string }[] }>;
}

const sameParent = (left: LinearDeliveryParent, right: LinearDeliveryParent) => left.id === right.id && left.teamId === right.teamId && left.revision === right.revision;
const validOperation = (operationId: string) => /^[a-f0-9]{64}$/.test(operationId);
const validChild = (child: LinearDeliveryChild) => child.workflow.state === "Triage" && child.workflow.assignee === null && child.workflow.cycle === null && child.workflow.labels.length === 0 && child.workflow.project === null;

export function createFakeLinearDeliveryTicketGateway({ parent }: { parent: LinearDeliveryParent }): LinearDeliveryTicketGateway {
	const children: (LinearDeliveryChild & { linearId: string })[] = [];
	const blockers: { blockedStableKey: string; blockingStableKey: string }[] = [];
	function assertInput(operationId: string, candidate: LinearDeliveryParent) {
		if (!validOperation(operationId)) throw new Error("canonical operation ID is required");
		if (!sameParent(parent, candidate)) throw new Error("stale parent");
	}
	return {
		async createChild({ operationId, parent: candidate, child }) {
			assertInput(operationId, candidate);
			if (!validChild(child)) throw new Error("children must be created in Triage with no assignee, cycle, labels, or project");
			const existing = children.find((value) => value.stableKey === child.stableKey);
			if (existing) return { stableKey: existing.stableKey, linearId: existing.linearId };
			const created = { ...child, linearId: `child-${children.length + 1}` };
			children.push(created);
			return { stableKey: created.stableKey, linearId: created.linearId };
		},
		async createBlocker({ operationId, parent: candidate, blockedStableKey, blockingStableKey }) {
			assertInput(operationId, candidate);
			if (![blockedStableKey, blockingStableKey].every((key) => children.some((child) => child.stableKey === key))) throw new Error("blocker references missing published child");
			if (!blockers.some((value) => value.blockedStableKey === blockedStableKey && value.blockingStableKey === blockingStableKey)) blockers.push({ blockedStableKey, blockingStableKey });
		},
		async readBack({ operationId, parent: candidate }) {
			assertInput(operationId, candidate);
			return { parent: { ...parent }, children: children.map((child) => ({ ...child, workflow: { ...child.workflow, labels: [] } })), blockers: blockers.map((blocker) => ({ ...blocker })) };
		},
	};
}
