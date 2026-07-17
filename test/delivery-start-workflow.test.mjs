import assert from "node:assert/strict";
import test from "node:test";
import {
	createDeliveryStartWorkflow,
	createFakeDeliveryStartGateways,
} from "../extensions/delivery-start-workflow.ts";

const base = {
	ticketId: "ILA-2313",
	sourceBranch: "main",
	developer: { actorId: "developer-1", role: "Developer" },
};
const baseTicket = {
	id: "ILA-2313",
	parentId: "ILA-2296",
	assigneeId: "developer-1",
	cycleId: "cycle-1",
	state: "To do",
	terminal: false,
	openBlockers: [],
	capabilities: ["cycles", "blockers", "parent-subissues", "pull-requests"],
};

function setup(overrides = {}) {
	const { policy: policyOverride, ...fakeOverrides } = overrides;
	const fakes = createFakeDeliveryStartGateways({
		ticket: baseTicket,
		repository: { clean: true, branches: ["main"], pullRequests: [] },
		launch: {
			provider: "openai-codex",
			model: "gpt-5.6-sol",
			effort: "high",
			capabilities: ["code-writer"],
		},
		...fakeOverrides,
	});
	return { fakes, workflow: createDeliveryStartWorkflow({
		...fakes.gateways,
		policy: {
			environmentBranches: policyOverride?.environmentBranches ?? ["qa", "staging", "main"],
			requiredLinearCapabilities: ["cycles", "blockers", "parent-subissues", "pull-requests"],
			requiredLaunch: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "high", capabilities: ["code-writer"] },
		},
	}) };
}

async function refusal(name, overrides, input, code) {
	await test(name, async () => {
		const { workflow, fakes } = setup(overrides);
		await assert.rejects(() => workflow.start(input ?? base), (error) => error.code === code);
		assert.deepEqual(fakes.events.filter((event) => event.startsWith("linear:start")), []);
		assert.deepEqual(fakes.events.filter((event) => event.startsWith("git:prepare")), []);
	});
}

await refusal("requires an explicit ticket ID", {}, { ...base, ticketId: "" }, "PI_WORKFLOW_DELIVERY_TICKET_REQUIRED");
await refusal("requires an explicit configured source branch", {}, { ...base, sourceBranch: "" }, "PI_WORKFLOW_SOURCE_BRANCH_REQUIRED");
await refusal("rejects a source outside the configured environment branches", {}, { ...base, sourceBranch: "release" }, "PI_WORKFLOW_SOURCE_BRANCH_INVALID");
await refusal("rejects more than three environment branches", { policy: { environmentBranches: ["dev", "qa", "staging", "main"] } }, base, "PI_WORKFLOW_ENVIRONMENT_BRANCHES_INVALID");
await refusal("rejects a non-Developer target override", {}, { ...base, developer: { actorId: "owner-1", role: "Owner" }, targetBranch: "qa" }, "PI_WORKFLOW_TARGET_OVERRIDE_FORBIDDEN");
await refusal("rejects a malformed ticket ID", {}, { ...base, ticketId: "ila-2313" }, "PI_WORKFLOW_DELIVERY_TICKET_INVALID");
await refusal("rejects a missing Developer authority", {}, { ...base, developer: { actorId: "", role: "Developer" } }, "PI_WORKFLOW_DEVELOPER_AUTHORITY_REQUIRED");
await refusal("rejects a blank explicit target override", {}, { ...base, targetBranch: " " }, "PI_WORKFLOW_TARGET_BRANCH_INVALID");
await refusal("rejects a mismatched assignee", { ticket: { ...baseTicket, assigneeId: "other" } }, base, "PI_WORKFLOW_DELIVERY_ASSIGNEE_MISMATCH");
await refusal("rejects a missing current Cycle", { ticket: { ...baseTicket, cycleId: null } }, base, "PI_WORKFLOW_DELIVERY_CYCLE_REQUIRED");
await refusal("rejects a ticket outside To do", { ticket: { ...baseTicket, state: "Stop" } }, base, "PI_WORKFLOW_DELIVERY_STATE_INVALID");
await refusal("rejects terminal tickets", { ticket: { ...baseTicket, state: "Canceled", terminal: true } }, base, "PI_WORKFLOW_DELIVERY_TERMINAL");
await refusal("rejects open blockers", { ticket: { ...baseTicket, openBlockers: ["ILA-2308"] } }, base, "PI_WORKFLOW_DELIVERY_BLOCKED");
await refusal("rejects missing Linear capabilities", { ticket: { ...baseTicket, capabilities: ["cycles"] } }, base, "PI_WORKFLOW_DELIVERY_CAPABILITY_MISMATCH");
await refusal("rejects a dirty repository", { repository: { clean: false, branches: ["main"], pullRequests: [] } }, base, "PI_WORKFLOW_REPOSITORY_DIRTY");
await refusal("rejects exact launch provenance mismatch", { launch: { provider: "openai-codex", model: "gpt-5.6-terra", effort: "high", capabilities: ["code-writer"] } }, base, "PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE");
await refusal("rejects a mismatched ticket branch", { repository: { clean: true, branches: ["main", "ILA-2313"], branchBases: { "ILA-2313": "qa" }, pullRequests: [] } }, base, "PI_WORKFLOW_DELIVERY_BRANCH_MISMATCH");
await refusal("rejects a branch or PR for the Delivery parent", { repository: { clean: true, branches: ["main", "ILA-2296"], pullRequests: [] } }, base, "PI_WORKFLOW_DELIVERY_PARENT_IDENTITY_CONFLICT");
await refusal("rejects an existing ticket PR with another target", { repository: { clean: true, branches: ["main", "ILA-2313"], branchBases: { "ILA-2313": "main" }, pullRequests: [{ head: "ILA-2313", target: "qa" }] } }, base, "PI_WORKFLOW_DELIVERY_TARGET_MISMATCH");
await refusal("rejects multiple PRs for one ticket", { repository: { clean: true, branches: ["main", "ILA-2313"], branchBases: { "ILA-2313": "main" }, pullRequests: [{ head: "ILA-2313", target: "main" }, { head: "ILA-2313", target: "main" }] } }, base, "PI_WORKFLOW_DELIVERY_PR_CONFLICT");
await refusal("rejects unrelated In Progress state without workflow identity", { ticket: { ...baseTicket, state: "In Progress" } }, base, "PI_WORKFLOW_DELIVERY_IDEMPOTENCY_CONFLICT");

test("starts only after successful preflight and creates the exact ticket branch", async () => {
	const { workflow, fakes } = setup();
	assert.deepEqual(await workflow.start(base), { ticketId: "ILA-2313", sourceBranch: "main", targetBranch: "main", branch: "ILA-2313", state: "In Progress" });
	assert.deepEqual(fakes.events, ["linear:read:ILA-2313", "runtime:inspect", "git:inspect", "git:prepare:ILA-2313:main:main", "linear:start:ILA-2313:To do"]);
});

test("accepts an explicit Developer target override", async () => {
	const { workflow, fakes } = setup();
	const result = await workflow.start({ ...base, targetBranch: "qa" });
	assert.equal(result.targetBranch, "qa");
	assert.equal(fakes.events.at(-2), "git:prepare:ILA-2313:main:qa");
});

test("is idempotent after the start transition and reselects only the exact branch", async () => {
	const { workflow, fakes } = setup();
	await workflow.start(base);
	await workflow.start(base);
	assert.equal(fakes.events.filter((event) => event.startsWith("linear:start")).length, 1);
	assert.equal(fakes.events.filter((event) => event.startsWith("git:prepare")).length, 2);
});
