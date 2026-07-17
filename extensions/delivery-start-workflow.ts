type DeliveryRole = "Developer" | "Owner";

export interface DeliveryTicketSnapshot {
	id: string;
	parentId: string;
	assigneeId: string | null;
	cycleId: string | null;
	state: "To do" | "In Progress" | string;
	terminal: boolean;
	openBlockers: readonly string[];
	capabilities: readonly string[];
}

export interface DeliveryRepositorySnapshot {
	clean: boolean;
	branches: readonly string[];
	branchBases?: Readonly<Record<string, string>>;
	pullRequests: readonly { head: string; target: string }[];
}

export interface DeliveryLaunchSnapshot {
	provider: string;
	model: string;
	effort: string;
	capabilities: readonly string[];
}

interface LinearGateway {
	readTicket(ticketId: string): Promise<DeliveryTicketSnapshot>;
	startDelivery(input: { ticketId: string; expectedState: "To do" }): Promise<void>;
}

interface GitGateway {
	inspect(): Promise<DeliveryRepositorySnapshot>;
	prepareTicketBranch(input: { ticketId: string; sourceBranch: string; targetBranch: string }): Promise<void>;
}

interface RuntimeGateway {
	inspectLaunch(): Promise<DeliveryLaunchSnapshot>;
}

export interface DeliveryStartPolicy {
	environmentBranches: readonly string[];
	requiredLinearCapabilities: readonly string[];
	requiredLaunch: DeliveryLaunchSnapshot;
}

export interface DeliveryStartInput {
	ticketId: string;
	sourceBranch: string;
	targetBranch?: string;
	developer: { actorId: string; role: DeliveryRole };
}

class DeliveryStartError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

const fail = (code: string, message: string): never => {
	throw new DeliveryStartError(code, message);
};
const haveSameStringMembers = (left: readonly string[], right: readonly string[]) => {
	const sortedRight = [...right].sort();
	return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
};

export function createDeliveryStartWorkflow(dependencies: {
	linear: LinearGateway;
	git: GitGateway;
	runtime: RuntimeGateway;
	policy: DeliveryStartPolicy;
}) {
	async function start(input: DeliveryStartInput) {
		const ticketId = input.ticketId.trim();
		const sourceBranch = input.sourceBranch.trim();
		if (!ticketId) fail("PI_WORKFLOW_DELIVERY_TICKET_REQUIRED", "A Linear Delivery ticket ID is required.");
		if (!/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(ticketId)) fail("PI_WORKFLOW_DELIVERY_TICKET_INVALID", "The Linear Delivery ticket ID is invalid.");
		if (!sourceBranch) fail("PI_WORKFLOW_SOURCE_BRANCH_REQUIRED", "An explicit source branch is required.");
		const environments = dependencies.policy.environmentBranches;
		if (environments.length === 0 || environments.length > 3 || new Set(environments).size !== environments.length || environments.some((branch) => !branch.trim())) fail("PI_WORKFLOW_ENVIRONMENT_BRANCHES_INVALID", "Configure between one and three distinct environment branches.");
		if (!environments.includes(sourceBranch)) fail("PI_WORKFLOW_SOURCE_BRANCH_INVALID", "The source branch is not a configured environment branch.");
		const hasOverride = input.targetBranch !== undefined;
		if (hasOverride && input.developer.role !== "Developer") fail("PI_WORKFLOW_TARGET_OVERRIDE_FORBIDDEN", "Only the Developer may override the PR target.");
		if (input.developer.role !== "Developer" || !input.developer.actorId.trim()) fail("PI_WORKFLOW_DEVELOPER_AUTHORITY_REQUIRED", "Developer authority is required.");
		if (hasOverride && !input.targetBranch?.trim()) fail("PI_WORKFLOW_TARGET_BRANCH_INVALID", "An explicit PR target cannot be blank.");
		const targetBranch = input.targetBranch?.trim() ?? sourceBranch;
		if (!environments.includes(targetBranch)) fail("PI_WORKFLOW_TARGET_BRANCH_INVALID", "The PR target is not a configured environment branch.");

		const ticket = await dependencies.linear.readTicket(ticketId);
		const [launch, repository] = await Promise.all([dependencies.runtime.inspectLaunch(), dependencies.git.inspect()]);
		if (ticket.id !== ticketId) fail("PI_WORKFLOW_DELIVERY_TICKET_MISMATCH", "Linear returned a different Delivery ticket.");
		if (ticket.terminal) fail("PI_WORKFLOW_DELIVERY_TERMINAL", "Terminal Delivery tickets cannot be started.");
		if (ticket.assigneeId !== input.developer.actorId) fail("PI_WORKFLOW_DELIVERY_ASSIGNEE_MISMATCH", "The Current assignee must be the invoking Developer.");
		if (!ticket.cycleId) fail("PI_WORKFLOW_DELIVERY_CYCLE_REQUIRED", "The Delivery ticket must have a current Cycle.");
		if (ticket.state !== "To do" && ticket.state !== "In Progress") fail("PI_WORKFLOW_DELIVERY_STATE_INVALID", "The Delivery ticket must be in To do.");
		if (ticket.openBlockers.length > 0) fail("PI_WORKFLOW_DELIVERY_BLOCKED", "The Delivery ticket has open blockers.");
		if (!dependencies.policy.requiredLinearCapabilities.every((capability) => ticket.capabilities.includes(capability))) fail("PI_WORKFLOW_DELIVERY_CAPABILITY_MISMATCH", "Required Linear capabilities are unavailable.");
		if (!repository.clean) fail("PI_WORKFLOW_REPOSITORY_DIRTY", "The repository must be clean.");
		if (!repository.branches.includes(sourceBranch)) fail("PI_WORKFLOW_SOURCE_BRANCH_MISSING", "The source branch does not exist.");
		const expectedLaunch = dependencies.policy.requiredLaunch;
		if (launch.provider !== expectedLaunch.provider || launch.model !== expectedLaunch.model || launch.effort !== expectedLaunch.effort || !haveSameStringMembers(launch.capabilities, expectedLaunch.capabilities)) fail("PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE", "Exact provider, model, effort, and capabilities are required.");
		if (repository.branches.includes(ticket.parentId) || repository.pullRequests.some(({ head }) => head === ticket.parentId)) fail("PI_WORKFLOW_DELIVERY_PARENT_IDENTITY_CONFLICT", "The Delivery parent must not have a branch or PR.");
		const ticketBranchExists = repository.branches.includes(ticketId);
		if (ticketBranchExists && repository.branchBases?.[ticketId] !== sourceBranch) fail("PI_WORKFLOW_DELIVERY_BRANCH_MISMATCH", "The existing ticket branch has a different source identity.");
		const ticketPullRequests = repository.pullRequests.filter(({ head }) => head === ticketId);
		if (ticketPullRequests.length > 1) fail("PI_WORKFLOW_DELIVERY_PR_CONFLICT", "Exactly one PR may exist for a Delivery ticket.");
		if (ticketPullRequests.some(({ target }) => target !== targetBranch)) fail("PI_WORKFLOW_DELIVERY_TARGET_MISMATCH", "The existing ticket PR has a different target.");
		if (ticket.state === "In Progress" && !ticketBranchExists) fail("PI_WORKFLOW_DELIVERY_IDEMPOTENCY_CONFLICT", "An In Progress ticket requires its exact existing branch.");

		await dependencies.git.prepareTicketBranch({ ticketId, sourceBranch, targetBranch });
		if (ticket.state === "To do") await dependencies.linear.startDelivery({ ticketId, expectedState: "To do" });
		return { ticketId, sourceBranch, targetBranch, branch: ticketId, state: "In Progress" as const };
	}
	return { start };
}

export function createFakeDeliveryStartGateways(initial: {
	ticket: DeliveryTicketSnapshot;
	repository: DeliveryRepositorySnapshot;
	launch: DeliveryLaunchSnapshot;
}) {
	let ticket = structuredClone(initial.ticket);
	let repository = structuredClone(initial.repository);
	const launch = structuredClone(initial.launch);
	const events: string[] = [];
	return {
		get ticket() { return structuredClone(ticket); },
		events,
		gateways: {
			linear: {
				async readTicket(ticketId: string) { events.push(`linear:read:${ticketId}`); return structuredClone(ticket); },
				async startDelivery(input: { ticketId: string; expectedState: "To do" }) { events.push(`linear:start:${input.ticketId}:${input.expectedState}`); if (ticket.state !== input.expectedState) fail("PI_WORKFLOW_DELIVERY_STATE_CONFLICT", "Linear state changed before start-delivery."); ticket = { ...ticket, state: "In Progress" }; },
			},
			runtime: { async inspectLaunch() { events.push("runtime:inspect"); return structuredClone(launch); } },
			git: {
				async inspect() { events.push("git:inspect"); return structuredClone(repository); },
				async prepareTicketBranch(input: { ticketId: string; sourceBranch: string; targetBranch: string }) { events.push(`git:prepare:${input.ticketId}:${input.sourceBranch}:${input.targetBranch}`); repository = { ...repository, branches: [...new Set([...repository.branches, input.ticketId])], branchBases: { ...repository.branchBases, [input.ticketId]: input.sourceBranch } }; },
			},
		},
	};
}
