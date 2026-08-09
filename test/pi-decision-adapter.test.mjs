import assert from "node:assert/strict";
import test from "node:test";

import {
	createInMemoryDecisionStore,
	createInteractiveDecisions,
} from "../extensions/interactive-decisions.ts";
import {
	createPiDecisionAdapter,
	registerPiDecisionAdapter,
} from "../extensions/pi-decision-adapter.ts";
import {
	agentAssetApplyDecision,
	agentAssetRecoveryDecision,
} from "../extensions/agent-asset-sync.ts";
import {
	defineProductRevisionDecision,
	defineProductRouteDecision,
	defineProductSpecDecision,
	defineProductTeamDecision,
	defineProductTicketDecision,
} from "../extensions/define-product-runtime.ts";
import { productReviewDecisionRequest } from "../extensions/product-review-mcp-publication.ts";
import { qaHandoffDecisionRequest } from "../extensions/qa-handoff-mcp-publication.ts";
import {
	companionInstallDecision,
	companionRecoveryDecision,
} from "../extensions/companion-workflow.ts";
import {
	deliveryPublicationDecision,
	deliveryReviewDecision,
} from "../extensions/delivery-pull-request-workflow.ts";
import piWorkflowExtension from "../extensions/pi-workflow.ts";

const actor = {
	actorId: "actor-1",
	authorityRevision: "single-user/v1",
	active: true,
	guest: false,
};
const otherActor = {
	actorId: "actor-2",
	authorityRevision: "linear/member-2",
	active: true,
	guest: false,
};
const scope = {
	project: "pi-workflow",
	workflow: "define-product",
	subject: "definition-1",
};
const approve = { id: "spec.approve", input: { revision: "r1" } };
const cancel = { id: "decision.cancel", input: null };

function request(choices = undefined) {
	return {
		scope,
		operation: {
			kind: "publish-spec",
			phase: "spec-approved",
			input: { definitionId: "definition-1" },
			artifacts: [],
			targets: [],
			evidence: [],
		},
		presentation: {
			locale: "es",
			summary: "Publicar la especificacion",
			details: ["Descripcion completa"],
			consequences: ["Crea un issue"],
			risks: ["Puede existir drift"],
			choices: choices ?? [
				{
					id: approve.id,
					mode: "execute",
					action: approve,
					label: "Publicar",
					description: "Publica el issue",
				},
				{
					id: cancel.id,
					mode: "cancel",
					action: cancel,
					label: "Cancelar",
					description: "No modifica Linear",
				},
			],
		},
	};
}

async function prepared(requestValue = request()) {
	const adapter = createPiDecisionAdapter();
	const decisions = createInteractiveDecisions({
		store: createInMemoryDecisionStore(),
		claimSource: adapter.claimSource,
	});
	return { adapter, presentation: await decisions.prepare(requestValue) };
}

async function authorizationFixture(options = {}) {
	const adapter = createPiDecisionAdapter(options);
	const decisions = createInteractiveDecisions({
		store: createInMemoryDecisionStore(),
		claimSource: adapter.claimSource,
		createExecutionId: () => "execution-1",
	});
	const presentation = await decisions.prepare(request());
	return { adapter, decisions, presentation };
}

const claimBinding = {
	scope,
	generation: 1,
};

const context = {
	sessionId: "session-1",
	runId: "run-1",
	sequence: 1,
	actor,
	claimBinding,
};

function inventoriedDecisionDescriptors() {
	const digest = (character) => character.repeat(64);
	const recommendation = {
		definitionId: "definition-parity",
		domainAnchor: "decision parity",
		domainAnchorDigest: digest("a"),
		assessment: { clarity: "clear", breadth: "narrow", reasons: ["bounded"] },
		recommendedRoute: "wayfinder",
		digest: digest("b"),
		confirmationToken: "c".repeat(43),
		issuedAt: 1,
	};
	const reviewChoices = Object.fromEntries(
		["Aceptado", "Cambios requeridos"].map((result, index) => [
			result,
			{
				digest: digest(index === 0 ? "c" : "d"),
				payload: { issue: { protectedDigest: digest("e") } },
			},
		]),
	);
	const mcpPlan = {
		path: "/tmp/mcp.json",
		changed: false,
		targets: [],
		additions: [],
		replacements: [],
	};
	const companionIdentity = {
		packages: [{ package: "alpha", spec: "alpha@1" }],
		mcp: { path: mcpPlan.path, catalogDigest: digest("f") },
	};
	const snapshot = {
		branch: "ticket/ILA-2474",
		headCommit: "head-1",
		treeDigest: digest("1"),
		diffDigest: digest("2"),
		clean: true,
	};
	const draft = {
		ticketId: "ILA-2474",
		head: snapshot.branch,
		target: "main",
		title: "Close decision parity",
		description: "Exact reviewed draft",
		link: "https://example.test/compare",
		evidence: {
			headCommit: snapshot.headCommit,
			treeDigest: snapshot.treeDigest,
			diffDigest: snapshot.diffDigest,
		},
	};
	const plan = {
		digest: digest("3"),
		manifestDigest: digest("4"),
		inspectionDigest: digest("5"),
		actions: [],
	};
	return [
		["define-product", defineProductRouteDecision("pi-workflow", recommendation)],
		[
			"define-product-team",
			defineProductTeamDecision(
				"pi-workflow",
				"definition-parity",
				new Map([["team-1", "Team One"]]),
			),
		],
		[
			"define-product-spec",
			defineProductSpecDecision("pi-workflow", "definition-parity", {
				kind: "approve-spec",
				target: { kind: "linear-parent-description", teamId: "team-1", title: "Spec" },
				revision: "spec-r1",
				digest: digest("0"),
			}),
		],
		[
			"define-product-tickets",
			defineProductTicketDecision("pi-workflow", "definition-parity", digest("1")),
		],
		[
			"define-product-revision",
			defineProductRevisionDecision("pi-workflow", "definition-parity", digest("2")),
		],
		[
			"product-review",
			productReviewDecisionRequest(
				"pi-workflow",
				"ILA-2474",
				{ updatedAt: "revision-1" },
				reviewChoices,
			),
		],
		[
			"qa-handoff",
			qaHandoffDecisionRequest(
				"pi-workflow",
				{ issueId: "ILA-2474", issueRevision: "revision-1" },
				{ digest: digest("6") },
			),
		],
		["sync-apply", agentAssetApplyDecision("pi-workflow", plan)],
		["sync-resume", agentAssetRecoveryDecision("pi-workflow", digest("7"), "resume")],
		["sync-rollback", agentAssetRecoveryDecision("pi-workflow", digest("7"), "rollback")],
		[
			"companions-install",
			companionInstallDecision("pi-workflow", companionIdentity, digest("8"), mcpPlan),
		],
		[
			"companions-recovery",
			companionRecoveryDecision("pi-workflow", digest("9"), 2, digest("8"), ["partial"]),
		],
		["delivery-review", deliveryReviewDecision("pi-workflow", digest("a"), snapshot, draft)],
		["delivery-publication", deliveryPublicationDecision("pi-workflow", digest("a"), draft)],
	];
}

async function transportFixture(requestValue, capability) {
	const adapter = createPiDecisionAdapter();
	const decisions = createInteractiveDecisions({
		store: createInMemoryDecisionStore(),
		claimSource: adapter.claimSource,
		createExecutionId: () => "execution-parity",
	});
	const presentation = await decisions.prepare(requestValue);
	const prompt = adapter.present({
		sessionId: "session-parity",
		runId: "run-parity",
		sequence: 1,
		actor,
		claimBinding: { scope: requestValue.scope, generation: 1 },
		presentation,
		capability,
	});
	return { adapter, decisions, presentation, prompt };
}

async function selectDecisionChoice(requestValue, capability, choiceIndex) {
	const fixture = await transportFixture(requestValue, capability);
	if (fixture.prompt.kind === "panel") {
		const toolCallId = `panel-${choiceIndex}`;
		assert.equal(
			fixture.adapter.handleToolCall({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				toolName: "ask_user_question",
				toolCallId,
				input: fixture.prompt.input,
			}),
			true,
		);
		const question = fixture.prompt.input.questions[0];
		assert.equal(
			fixture.adapter.handleToolResult({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				toolName: "ask_user_question",
				toolCallId,
				details: {
					cancelled: false,
					answers: [
						{
							answer: question.options[choiceIndex].label,
							kind: "option",
							question: question.question,
							questionIndex: 0,
						},
					],
				},
			}),
			"claimed",
		);
	} else {
		assert.equal(
			fixture.adapter.handleFallbackResponse({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				text: String(choiceIndex + 1),
			}),
			"claimed",
		);
	}
	const choice = requestValue.presentation.choices[choiceIndex];
	return fixture.decisions.authorize(fixture.presentation.decisionId, choice.action, actor);
}

test("every inventoried decision family preserves panel and numbered fallback semantics", async () => {
	const panelCapability = { hasUI: true, activeTools: ["ask_user_question"] };
	const fallbackCapability = { hasUI: false, activeTools: [] };
	for (const [name, descriptor] of inventoriedDecisionDescriptors()) {
		const panel = await transportFixture(descriptor.request, panelCapability);
		const fallback = await transportFixture(descriptor.request, fallbackCapability);
		assert.equal(panel.prompt.kind, "panel", name);
		assert.equal(fallback.prompt.kind, "fallback", name);
		assert.deepEqual(
			panel.prompt.input.questions[0].options,
			descriptor.request.presentation.choices.map(({ label, description }) => ({
				label,
				description,
			})),
			name,
		);
		for (const [index, choice] of descriptor.request.presentation.choices.entries()) {
			assert.match(
				fallback.prompt.text,
				new RegExp(`${index + 1}\\. ${choice.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
				name,
			);
			for (const capability of [panelCapability, fallbackCapability]) {
				const outcome = await selectDecisionChoice(
					descriptor.request,
					capability,
					index,
				);
				assert.equal(
					outcome.kind,
					choice.mode === "cancel" ? "cancelled" : "authorized",
					`${name}:${choice.action.id}`,
				);
			}
		}

		const custom = await transportFixture(descriptor.request, panelCapability);
		const customCallId = `custom-${name}`;
		custom.adapter.handleToolCall({
			sessionId: "session-parity",
			runId: "run-parity",
			sequence: 1,
			toolName: "ask_user_question",
			toolCallId: customCallId,
			input: custom.prompt.input,
		});
		const question = custom.prompt.input.questions[0];
		assert.equal(
			custom.adapter.handleToolResult({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				toolName: "ask_user_question",
				toolCallId: customCallId,
				details: {
					cancelled: false,
					answers: [
						{
							answer: "Need more context",
							kind: "custom",
							question: question.question,
							questionIndex: 0,
						},
					],
				},
			}),
			"feedback",
			name,
		);

		const malformedPanel = await transportFixture(descriptor.request, panelCapability);
		const malformedCallId = `malformed-${name}`;
		malformedPanel.adapter.handleToolCall({
			sessionId: "session-parity",
			runId: "run-parity",
			sequence: 1,
			toolName: "ask_user_question",
			toolCallId: malformedCallId,
			input: malformedPanel.prompt.input,
		});
		assert.equal(
			malformedPanel.adapter.handleToolResult({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				toolName: "ask_user_question",
				toolCallId: malformedCallId,
				details: { answers: [] },
			}),
			"ignored",
			name,
		);

		const freeText = await transportFixture(descriptor.request, fallbackCapability);
		assert.equal(
			freeText.adapter.handleFallbackResponse({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				text: "Need more context",
			}),
			"feedback",
			name,
		);
		const malformedFallback = await transportFixture(
			descriptor.request,
			fallbackCapability,
		);
		assert.equal(
			malformedFallback.adapter.handleFallbackResponse({
				sessionId: "session-parity",
				runId: "run-parity",
				sequence: 1,
				text: "99",
			}),
			"ignored",
			name,
		);
	}
});

function workflowExtensionHarness(
	activeTools = ["ask_user_question"],
	interactiveOverrides = {},
) {
	const handlers = new Map();
	const pi = {
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		getActiveTools: () => [...activeTools],
		getAllTools: () => activeTools.map((name) => ({ name })),
		on(name, handler) {
			const registered = handlers.get(name) ?? [];
			registered.push(handler);
			handlers.set(name, registered);
		},
		registerTool() {},
		registerCommand() {},
	};
	const extension = piWorkflowExtension(pi, {
		defineProduct: {
			workflow: {
				advance: async () => ({ status: "blocked" }),
				pendingRecommendation: () => undefined,
				reset() {},
			},
		},
		qaHandoff: {
			workflow: {
				authorizeInvocation: async () => ({ status: "blocked" }),
				publish: async () => ({ status: "blocked" }),
			},
		},
		productReview: {
			workflow: {
				prepare: async () => ({ status: "blocked" }),
				approve: async () => ({ status: "blocked" }),
				publish: async () => ({ status: "blocked" }),
			},
		},
		interactiveDecisions: {
			store: createInMemoryDecisionStore(),
			createExecutionId: () => "execution-1",
			...interactiveOverrides,
		},
	});
	return {
		extension,
		async emit(name, event, ctx) {
			let outcome;
			for (const handler of handlers.get(name) ?? []) {
				const next = await handler(event, ctx);
				if (next !== undefined) outcome = next;
			}
			return outcome;
		},
	};
}

function hostContext(overrides = {}) {
	return {
		hasUI: true,
		mode: "tui",
		isIdle: () => true,
		sessionManager: { getSessionId: () => "session-1" },
		ui: { notify() {} },
		...overrides,
	};
}

test("piWorkflowExtension prepares, emits, correlates, and authorizes one panel decision", async () => {
	let inspectedLease;
	const harness = workflowExtensionHarness(["ask_user_question"], {
		manifestLookup: {
			async find(lease) {
				inspectedLease = lease;
				return [];
			},
		},
	});
	const ctx = hostContext();
	await harness.emit("session_start", { type: "session_start" }, ctx);
	const presentation = await harness.extension.interactiveDecisions.prepare(
		request(),
		actor,
	);
	const instruction = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		ctx,
	);
	assert.match(instruction.systemPrompt, /ask_user_question/);
	const panelInput = JSON.parse(
		instruction.systemPrompt.slice(
			instruction.systemPrompt.indexOf("{"),
			instruction.systemPrompt.lastIndexOf("}") + 1,
		),
	);
	assert.deepEqual(
		panelInput.questions[0].options.map(({ label }) => label),
		["Publicar", "Cancelar"],
	);
	await harness.emit(
		"tool_call",
		{
			type: "tool_call",
			toolName: "ask_user_question",
			toolCallId: "tool-call-1",
			input: panelInput,
		},
		ctx,
	);
	await harness.emit(
		"tool_result",
		{
			type: "tool_result",
			toolName: "ask_user_question",
			toolCallId: "tool-call-1",
			input: panelInput,
			content: [],
			isError: false,
			details: {
				answers: [
					{
						questionIndex: 0,
						question: panelInput.questions[0].question,
						kind: "option",
						answer: "Publicar",
					},
				],
				cancelled: false,
			},
		},
		ctx,
	);
	const authorized = await harness.extension.interactiveDecisions.authorize(
		presentation.decisionId,
		approve,
		actor,
	);
	assert.equal(authorized.kind, "authorized");
	const manifest = {
		ref: "engram://composed-manifest",
		decisionId: authorized.lease.decisionId,
		operationDigest: authorized.lease.operationDigest,
		executionId: authorized.lease.executionId,
		generation: authorized.lease.generation,
	};
	const effects = harness.extension.interactiveDecisions;
	assert.equal(
		(await effects.bindExecutionManifest(authorized.lease, manifest)).kind,
		"authorized",
	);
	await harness.extension.interactiveDecisions.recover(scope, actor);
	assert.deepEqual(inspectedLease, authorized.lease);
});

test("piWorkflowExtension forwards shared-authority recovery directives", async () => {
	const harness = workflowExtensionHarness();
	const ctx = hostContext();
	await harness.emit("session_start", { type: "session_start" }, ctx);
	const presentation = await harness.extension.interactiveDecisions.prepare(
		request(),
		actor,
	);
	const adapter = harness.extension.interactiveDecisions;
	const pending = harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		ctx,
	);
	const instruction = await pending;
	const panelInput = JSON.parse(
		instruction.systemPrompt.slice(
			instruction.systemPrompt.indexOf("{"),
			instruction.systemPrompt.lastIndexOf("}") + 1,
		),
	);
	await harness.emit(
		"tool_call",
		{
			type: "tool_call",
			toolName: "ask_user_question",
			toolCallId: "recovery-call",
			input: panelInput,
		},
		ctx,
	);
	await harness.emit(
		"tool_result",
		{
			type: "tool_result",
			toolName: "ask_user_question",
			toolCallId: "recovery-call",
			input: panelInput,
			content: [],
			isError: false,
			details: {
				answers: [
					{
						questionIndex: 0,
						question: panelInput.questions[0].question,
						kind: "option",
						answer: "Publicar",
					},
				],
				cancelled: false,
			},
		},
		ctx,
	);
	await adapter.authorize(presentation.decisionId, approve, actor);
	const terminal = await adapter.recover(
		scope,
		{
			actorId: "actor-2",
			authorityRevision: "linear/member-2",
			active: true,
			guest: false,
		},
		{ kind: "terminal", state: "completed" },
	);
	assert.equal(terminal.kind, "terminal");
	assert.equal(terminal.currentApprover.actorId, actor.actorId);
});

test("changed-actor recovery queues a fresh presentation and claim", async () => {
	const harness = workflowExtensionHarness();
	const ctx = hostContext();
	await harness.emit("session_start", { type: "session_start" }, ctx);
	let call = 0;
	async function claimPendingDecision() {
		const instruction = await harness.emit(
			"before_agent_start",
			{ type: "before_agent_start" },
			ctx,
		);
		assert.match(instruction?.systemPrompt ?? "", /ask_user_question/);
		const panelInput = JSON.parse(
			instruction.systemPrompt.slice(
				instruction.systemPrompt.indexOf("{"),
				instruction.systemPrompt.lastIndexOf("}") + 1,
			),
		);
		call += 1;
		const toolCallId = `reapproval-call-${call}`;
		await harness.emit(
			"tool_call",
			{
				type: "tool_call",
				toolName: "ask_user_question",
				toolCallId,
				input: panelInput,
			},
			ctx,
		);
		await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolName: "ask_user_question",
				toolCallId,
				input: panelInput,
				content: [],
				isError: false,
				details: {
					answers: [
						{
							questionIndex: 0,
							question: panelInput.questions[0].question,
							kind: "option",
							answer: "Publicar",
						},
					],
					cancelled: false,
				},
			},
			ctx,
		);
		return { panelInput, toolCallId };
	}

	const initial = await harness.extension.interactiveDecisions.prepare(
		request(),
		actor,
	);
	const staleInteraction = await claimPendingDecision();
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				initial.decisionId,
				approve,
				actor,
			)
		).kind,
		"authorized",
	);

	const recovered = await harness.extension.interactiveDecisions.recover(
		scope,
		otherActor,
		{ kind: "resume", request: request() },
	);
	assert.equal(recovered.kind, "reapproval");
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				recovered.presentation.decisionId,
				approve,
				otherActor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	await harness.emit(
		"tool_result",
		{
			type: "tool_result",
			toolName: "ask_user_question",
			toolCallId: staleInteraction.toolCallId,
			input: staleInteraction.panelInput,
			content: [],
			isError: false,
			details: {
				answers: [
					{
						questionIndex: 0,
						question: staleInteraction.panelInput.questions[0].question,
						kind: "option",
						answer: "Publicar",
					},
				],
				cancelled: false,
			},
		},
		ctx,
	);
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				recovered.presentation.decisionId,
				approve,
				otherActor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	await claimPendingDecision();
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				recovered.presentation.decisionId,
				approve,
				otherActor,
			)
		).kind,
		"authorized",
	);
});

test("piWorkflowExtension derives panel or fallback from real host capability", async () => {
	for (const scenario of [
		{
			name: "TUI",
			activeTools: ["ask_user_question"],
			context: hostContext({ mode: "tui", hasUI: true }),
			panel: true,
		},
		{
			name: "RPC",
			activeTools: ["ask_user_question"],
			context: hostContext({ mode: "rpc", hasUI: true }),
			panel: true,
		},
		{
			name: "headless",
			activeTools: ["ask_user_question"],
			context: hostContext({ mode: "print", hasUI: false }),
			panel: false,
		},
		{
			name: "missing tool",
			activeTools: [],
			context: hostContext({ mode: "tui", hasUI: true }),
			panel: false,
		},
		{
			name: "reduced",
			activeTools: ["ask_user_question"],
			context: {
				isIdle: () => true,
				sessionManager: { getSessionId: () => "session-1" },
				ui: { notify() {} },
			},
			panel: false,
		},
	]) {
		const harness = workflowExtensionHarness(scenario.activeTools);
		await harness.emit(
			"session_start",
			{ type: "session_start" },
			scenario.context,
		);
		await harness.extension.interactiveDecisions.prepare(request(), actor);
		const instruction = await harness.emit(
			"before_agent_start",
			{ type: "before_agent_start" },
			scenario.context,
		);
		assert.equal(
			instruction.systemPrompt.includes("Call ask_user_question exactly once"),
			scenario.panel,
			scenario.name,
		);
		if (!scenario.panel) {
			assert.match(instruction.systemPrompt, /1\. Publicar - Publica el issue/);
			assert.match(instruction.systemPrompt, /2\. Cancelar - No modifica Linear/);
		}
	}
});

test("piWorkflowExtension preserves numbered fallback for more than four options", async () => {
	const choices = ["Uno", "Dos", "Tres", "Cuatro"].map((label, index) => ({
		id: `spec.option-${index + 1}`,
		mode: "execute",
		action: { id: `spec.option-${index + 1}`, input: null },
		label,
		description: `Opcion ${index + 1}`,
	}));
	choices.push({
		id: cancel.id,
		mode: "cancel",
		action: cancel,
		label: "Cancelar",
		description: "No modifica Linear",
	});
	const harness = workflowExtensionHarness();
	const ctx = hostContext();
	await harness.emit("session_start", { type: "session_start" }, ctx);
	await harness.extension.interactiveDecisions.prepare(request(choices), actor);
	const instruction = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		ctx,
	);
	assert.doesNotMatch(instruction.systemPrompt, /Call ask_user_question exactly once/);
	assert.match(instruction.systemPrompt, /5\. Cancelar - No modifica Linear/);
});

test("piWorkflowExtension rejects cyclic tool input without creating a claim", async () => {
	const harness = workflowExtensionHarness();
	const ctx = hostContext();
	await harness.emit("session_start", { type: "session_start" }, ctx);
	const presentation = await harness.extension.interactiveDecisions.prepare(
		request(),
		actor,
	);
	await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		ctx,
	);
	const cyclic = { questions: [] };
	cyclic.self = cyclic;
	await harness.emit(
		"tool_call",
		{
			type: "tool_call",
			toolName: "ask_user_question",
			toolCallId: "cyclic-call",
			input: cyclic,
		},
		ctx,
	);
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	assert.deepEqual(
		await harness.extension.interactiveDecisions.recover(scope, actor),
		{ kind: "prepared", decisionId: presentation.decisionId },
	);
});

test("piWorkflowExtension ignores expired reservations when correlating a fresh fallback", async () => {
	let clock = 1_000;
	const harness = workflowExtensionHarness([], {
		adapter: createPiDecisionAdapter({ timeoutMs: 10, now: () => clock }),
	});
	const ctx = hostContext({ hasUI: false, mode: "print" });
	await harness.emit("session_start", { type: "session_start" }, ctx);
	await harness.extension.interactiveDecisions.prepare(request(), actor);
	await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		ctx,
	);
	clock += 11;
	const nextRequest = request();
	nextRequest.scope = { ...scope, subject: "definition-2" };
	nextRequest.operation = {
		...nextRequest.operation,
		input: { definitionId: "definition-2" },
	};
	const fresh = await harness.extension.interactiveDecisions.prepare(
		nextRequest,
		actor,
	);
	await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		ctx,
	);
	await harness.emit(
		"input",
		{ type: "input", text: "1", source: "interactive" },
		ctx,
	);
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				fresh.decisionId,
				approve,
				actor,
			)
		).kind,
		"authorized",
	);
});

test("piWorkflowExtension clears an unconsumed claim when the Pi session changes", async () => {
	const harness = workflowExtensionHarness();
	const firstContext = hostContext();
	await harness.emit(
		"session_start",
		{ type: "session_start" },
		firstContext,
	);
	const presentation = await harness.extension.interactiveDecisions.prepare(
		request(),
		actor,
	);
	const instruction = await harness.emit(
		"before_agent_start",
		{ type: "before_agent_start" },
		firstContext,
	);
	const panelInput = JSON.parse(
		instruction.systemPrompt.slice(
			instruction.systemPrompt.indexOf("{"),
			instruction.systemPrompt.lastIndexOf("}") + 1,
		),
	);
	await harness.emit(
		"tool_call",
		{
			type: "tool_call",
			toolName: "ask_user_question",
			toolCallId: "session-call",
			input: panelInput,
		},
		firstContext,
	);
	await harness.emit(
		"tool_result",
		{
			type: "tool_result",
			toolName: "ask_user_question",
			toolCallId: "session-call",
			input: panelInput,
			content: [],
			isError: false,
			details: {
				answers: [
					{
						questionIndex: 0,
						question: panelInput.questions[0].question,
						kind: "option",
						answer: "Publicar",
					},
				],
				cancelled: false,
			},
		},
		firstContext,
	);
	const secondContext = hostContext({
		sessionManager: { getSessionId: () => "session-2" },
	});
	await harness.emit(
		"session_start",
		{ type: "session_start" },
		secondContext,
	);
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
});

test("piWorkflowExtension safely no-ops when session context is unavailable", async () => {
	const harness = workflowExtensionHarness();
	const reducedContext = { isIdle: () => true, ui: { notify() {} } };
	await harness.emit(
		"session_start",
		{ type: "session_start" },
		reducedContext,
	);
	const presentation = await harness.extension.interactiveDecisions.prepare(
		request(),
		actor,
	);
	assert.equal(
		await harness.emit(
			"before_agent_start",
			{ type: "before_agent_start" },
			reducedContext,
		),
		undefined,
	);
	assert.equal(
		(
			await harness.extension.interactiveDecisions.authorize(
				presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	assert.deepEqual(
		await harness.extension.interactiveDecisions.recover(scope, actor),
		{ kind: "prepared", decisionId: presentation.decisionId },
	);
});

test("one prepared descriptor renders equivalent panel and numbered fallback options", async () => {
	const panelFixture = await prepared();
	const fallbackFixture = await prepared();
	const panel = panelFixture.adapter.present({
		...context,
		presentation: panelFixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	const fallback = fallbackFixture.adapter.present({
		...context,
		presentation: fallbackFixture.presentation,
		capability: { hasUI: false, activeTools: [] },
	});

	assert.equal(panel.kind, "panel");
	assert.equal(fallback.kind, "fallback");
	assert.deepEqual(
		panel.input.questions[0].options.map(({ label, description }) => ({
			label,
			description,
		})),
		[
			{ label: "Publicar", description: "Publica el issue" },
			{ label: "Cancelar", description: "No modifica Linear" },
		],
	);
	assert.match(fallback.text, /1\. Publicar - Publica el issue/);
	assert.match(fallback.text, /2\. Cancelar - No modifica Linear/);
	assert.equal(panel.input.questions[0].multiSelect, false);
	assert.equal(
		JSON.stringify(panel.input).includes(panelFixture.presentation.decisionId),
		false,
	);
	assert.equal(
		fallback.text.includes(fallbackFixture.presentation.decisionId),
		false,
	);
});

test("panel capability falls back for more than four visible options", async () => {
	const executeChoices = ["Uno", "Dos", "Tres", "Cuatro"].map(
		(label, index) => ({
			id: `spec.option-${index + 1}`,
			mode: "execute",
			action: { id: `spec.option-${index + 1}`, input: null },
			label,
			description: `Opcion ${index + 1}`,
		}),
	);
	const fixture = await prepared(
		request([
			...executeChoices,
			{
				id: cancel.id,
				mode: "cancel",
				action: cancel,
				label: "Cancelar",
				description: "No modifica Linear",
			},
		]),
	);
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});

	assert.equal(prompt.kind, "fallback");
	assert.match(prompt.text, /5\. Cancelar - No modifica Linear/);
});

test("a private claim enforces workflow scope, fencing generation, and session", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: false, activeTools: [] },
	});
	assert.equal(prompt.kind, "fallback");
	assert.equal(
		fixture.adapter.handleFallbackResponse({ ...context, text: "1" }),
		"claimed",
	);
	const consume = (binding) =>
		fixture.adapter.claimSource.consume(
			fixture.presentation.decisionId,
			approve,
			actor,
			binding,
		);

	for (const incompatible of [
		{ ...claimBinding, generation: 2, sessionId: context.sessionId },
		{
			...claimBinding,
			scope: { ...scope, workflow: "product-review" },
			sessionId: context.sessionId,
		},
		{ ...claimBinding, sessionId: "session-other" },
	]) {
		assert.equal(await consume(incompatible), false);
	}
	const compatible = { ...claimBinding, sessionId: context.sessionId };
	assert.equal(await consume(compatible), true);
	assert.equal(await consume(compatible), false);
});

test("localized equivalents remain panel-safe while exact companion sentinels fall back", async () => {
	const localized = await prepared(
		request([
			{
				id: approve.id,
				mode: "execute",
				action: approve,
				label: "Otro",
				description: "Usa la alternativa reservada",
			},
			request().presentation.choices[1],
		]),
	);
	assert.equal(
		localized.adapter.present({
			...context,
			presentation: localized.presentation,
			capability: { hasUI: true, activeTools: ["ask_user_question"] },
		}).kind,
		"panel",
	);

	const exactReserved = await prepared(
		request([
			{ ...request().presentation.choices[0], label: "Other" },
			request().presentation.choices[1],
		]),
	);
	assert.equal(
		exactReserved.adapter.present({
			...context,
			presentation: exactReserved.presentation,
			capability: { hasUI: true, activeTools: ["ask_user_question"] },
		}).kind,
		"fallback",
	);
});

test("a correlated panel result creates one private claim for later typed authorization", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(prompt.kind, "panel");
	assert.equal(
		fixture.adapter.handleToolCall({
			sessionId: context.sessionId,
			runId: context.runId,
			sequence: context.sequence,
			toolName: "ask_user_question",
			toolCallId: "tool-call-1",
			input: prompt.input,
		}),
		true,
	);
	assert.equal(
		fixture.adapter.handleToolResult({
			sessionId: context.sessionId,
			runId: context.runId,
			sequence: context.sequence,
			toolName: "ask_user_question",
			toolCallId: "tool-call-1",
			isError: false,
			details: {
				answers: [
					{
						questionIndex: 0,
						question: prompt.input.questions[0].question,
						kind: "option",
						answer: "Publicar",
					},
				],
				cancelled: false,
			},
		}),
		"claimed",
	);

	const authorized = await fixture.decisions.authorize(
		fixture.presentation.decisionId,
		approve,
		actor,
	);
	assert.equal(authorized.kind, "authorized");
	assert.deepEqual(await fixture.decisions.recover(scope, actor), authorized);
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_REPLAY",
	);
});

function panelResult(prompt, answer, kind = "option") {
	return {
		...context,
		toolName: "ask_user_question",
		toolCallId: "tool-call-1",
		isError: false,
		details: {
			answers: [
				{
					questionIndex: 0,
					question: prompt.input.questions[0].question,
					kind,
					answer,
				},
			],
			cancelled: false,
		},
	};
}

function bindPanel(adapter, prompt, overrides = {}) {
	return adapter.handleToolCall({
		sessionId: context.sessionId,
		runId: context.runId,
		sequence: context.sequence,
		toolName: "ask_user_question",
		toolCallId: "tool-call-1",
		input: prompt.input,
		...overrides,
	});
}

test("custom text is feedback and a new presentation is required before authorization", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(prompt.kind, "panel");
	assert.equal(bindPanel(fixture.adapter, prompt), true);
	assert.equal(
		fixture.adapter.handleToolResult(
			panelResult(prompt, "Cambiar el titulo", "custom"),
		),
		"feedback",
	);
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	assert.deepEqual(await fixture.decisions.recover(scope, actor), {
		kind: "prepared",
		decisionId: fixture.presentation.decisionId,
	});

	const repeated = fixture.adapter.present({
		...context,
		sequence: 2,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(repeated.kind, "panel");
	assert.equal(
		bindPanel(fixture.adapter, repeated, {
			sequence: 2,
			toolCallId: "tool-call-2",
		}),
		true,
	);
	assert.equal(
		fixture.adapter.handleToolResult({
			...panelResult(repeated, "Publicar"),
			sequence: 2,
			toolCallId: "tool-call-2",
		}),
		"claimed",
	);
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).kind,
		"authorized",
	);
});

test("an explicit localized Cancel option creates only the stable cancel action claim", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(prompt.kind, "panel");
	assert.equal(bindPanel(fixture.adapter, prompt), true);
	assert.equal(
		fixture.adapter.handleToolResult(panelResult(prompt, "Cancelar")),
		"claimed",
	);
	const outcome = await fixture.decisions.authorize(
		fixture.presentation.decisionId,
		cancel,
		actor,
	);
	assert.equal(outcome.kind, "cancelled");
	assert.equal(outcome.receipt.actionId, "decision.cancel");
});

test("timeout, Esc, tool errors, and malformed panel results create no claim", async () => {
	let clock = 1_000;
	const cases = [
		{
			name: "Esc",
			result: () => ({
				...context,
				toolName: "ask_user_question",
				toolCallId: "tool-call-1",
				isError: false,
				details: { answers: [], cancelled: true },
			}),
		},
		{
			name: "tool error",
			result: (prompt) => ({
				...panelResult(prompt, "Publicar"),
				isError: true,
			}),
		},
		{
			name: "malformed",
			result: () => ({
				...context,
				toolName: "ask_user_question",
				toolCallId: "tool-call-1",
				isError: false,
				details: { answers: [{ answer: "Publicar" }], cancelled: false },
			}),
		},
	];
	for (const scenario of cases) {
		const fixture = await authorizationFixture({
			timeoutMs: 10,
			now: () => clock,
		});
		const prompt = fixture.adapter.present({
			...context,
			presentation: fixture.presentation,
			capability: { hasUI: true, activeTools: ["ask_user_question"] },
		});
		assert.equal(prompt.kind, "panel", scenario.name);
		assert.equal(bindPanel(fixture.adapter, prompt), true, scenario.name);
		fixture.adapter.handleToolResult(scenario.result(prompt));
		assert.equal(
			(
				await fixture.decisions.authorize(
					fixture.presentation.decisionId,
					approve,
					actor,
				)
			).blocker.code,
			"PI_WORKFLOW_DECISION_CLAIM_MISSING",
			scenario.name,
		);
	}

	const timeout = await authorizationFixture({
		timeoutMs: 10,
		now: () => clock,
	});
	const prompt = timeout.adapter.present({
		...context,
		presentation: timeout.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(prompt.kind, "panel");
	assert.equal(bindPanel(timeout.adapter, prompt), true);
	assert.equal(
		timeout.adapter.handleToolResult(panelResult(prompt, "Publicar")),
		"claimed",
	);
	clock += 11;
	assert.equal(
		(
			await timeout.decisions.authorize(
				timeout.presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);

	const unanswered = await authorizationFixture({
		timeoutMs: 10,
		now: () => clock,
	});
	unanswered.adapter.present({
		...context,
		presentation: unanswered.presentation,
		capability: { hasUI: false, activeTools: [] },
	});
	clock += 11;
	assert.equal(
		(
			await unanswered.decisions.authorize(
				unanswered.presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
});

test("an incompatible typed action cannot consume the next compatible claim", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: false, activeTools: [] },
	});
	assert.equal(prompt.kind, "fallback");
	assert.equal(
		fixture.adapter.handleFallbackResponse({ ...context, text: "1" }),
		"claimed",
	);
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				cancel,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).kind,
		"authorized",
	);
});

test("tool result replay, parallel calls, and cross-run results cannot create another claim", async () => {
	const fixture = await authorizationFixture();
	const first = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(first.kind, "panel");
	assert.equal(bindPanel(fixture.adapter, first), true);
	assert.equal(
		bindPanel(fixture.adapter, first, { toolCallId: "parallel-call" }),
		false,
	);
	const second = fixture.adapter.present({
		...context,
		runId: "run-2",
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(second.kind, "panel");
	assert.equal(
		fixture.adapter.handleToolResult(panelResult(first, "Publicar")),
		"ignored",
	);
	assert.equal(
		fixture.adapter.handleToolCall({
			...context,
			runId: "run-2",
			toolName: "ask_user_question",
			toolCallId: "tool-call-2",
			input: second.input,
		}),
		true,
	);
	const result = {
		...panelResult(second, "Publicar"),
		runId: "run-2",
		toolCallId: "tool-call-2",
	};
	assert.equal(fixture.adapter.handleToolResult(result), "claimed");
	assert.equal(fixture.adapter.handleToolResult(result), "ignored");
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).kind,
		"authorized",
	);
});

test("fallback accepts only one exact in-range number and never interprets labels or prose", async () => {
	for (const [response, expected] of [
		["1", "authorized"],
		["2", "cancelled"],
		["Publicar", "blocked"],
		["1. Publicar", "blocked"],
		["1 or 2", "blocked"],
		["3", "blocked"],
		["", "blocked"],
	]) {
		const fixture = await authorizationFixture();
		const prompt = fixture.adapter.present({
			...context,
			presentation: fixture.presentation,
			capability: { hasUI: false, activeTools: [] },
		});
		assert.equal(prompt.kind, "fallback");
		fixture.adapter.handleFallbackResponse({ ...context, text: response });
		const action = response.trim() === "2" ? cancel : approve;
		const outcome = await fixture.decisions.authorize(
			fixture.presentation.decisionId,
			action,
			actor,
		);
		assert.equal(outcome.kind, expected, response || "empty");
	}
});

test("TUI and RPC hosts use the active panel tool while headless hosts always use fallback", async () => {
	for (const [mode, hasUI, activeTools, expected] of [
		["tui", true, ["ask_user_question"], "panel"],
		["rpc", true, ["ask_user_question"], "panel"],
		["json", false, ["ask_user_question"], "fallback"],
		["print", false, [], "fallback"],
	]) {
		const fixture = await prepared();
		assert.equal(
			fixture.adapter.present({
				...context,
				presentation: fixture.presentation,
				capability: { mode, hasUI, activeTools },
			}).kind,
			expected,
			mode,
		);
	}
});

test("Pi host wiring observes panel calls and results without companion version coupling", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(prompt.kind, "panel");
	const handlers = new Map();
	registerPiDecisionAdapter(
		{
			on(name, handler) {
				handlers.set(name, handler);
			},
		},
		fixture.adapter,
		fixture.decisions,
	);
	const piContext = {
		sessionManager: { getSessionId: () => context.sessionId },
	};
	await handlers.get("tool_call")(
		{
			toolName: "ask_user_question",
			toolCallId: "tool-call-1",
			input: prompt.input,
		},
		piContext,
	);
	await handlers.get("tool_result")(
		{
			toolName: "ask_user_question",
			toolCallId: "tool-call-1",
			details: panelResult(prompt, "Publicar").details,
			isError: false,
		},
		piContext,
	);
	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).kind,
		"authorized",
	);
});

test("Pi host wiring ignores reduced public-input contexts without creating a claim", async () => {
	const fixture = await authorizationFixture();
	fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: false, activeTools: [] },
	});
	const handlers = new Map();
	registerPiDecisionAdapter(
		{
			on(name, handler) {
				handlers.set(name, handler);
			},
		},
		fixture.adapter,
		fixture.decisions,
	);

	await handlers.get("input")(
		{ type: "input", text: "1", source: "interactive" },
		{ isIdle: () => true, ui: { notify() {} } },
	);

	assert.equal(
		(
			await fixture.decisions.authorize(
				fixture.presentation.decisionId,
				approve,
				actor,
			)
		).blocker.code,
		"PI_WORKFLOW_DECISION_CLAIM_MISSING",
	);
	assert.deepEqual(await fixture.decisions.recover(scope, actor), {
		kind: "prepared",
		decisionId: fixture.presentation.decisionId,
	});
});

test("caller mutations cannot rewrite a private reservation", async () => {
	const fixture = await authorizationFixture();
	const prompt = fixture.adapter.present({
		...context,
		presentation: fixture.presentation,
		capability: { hasUI: true, activeTools: ["ask_user_question"] },
	});
	assert.equal(prompt.kind, "panel");
	const reservedInput = structuredClone(prompt.input);
	prompt.input.questions[0].options[0].label = "Injected";
	fixture.presentation.choices[0].label = "Injected";
	assert.equal(bindPanel(fixture.adapter, prompt), false);
	assert.equal(
		bindPanel(fixture.adapter, { ...prompt, input: reservedInput }),
		true,
	);
});
