import test from "node:test";
import assert from "node:assert/strict";

import { createDefineProductRuntime } from "../extensions/define-product-runtime.ts";
import { createDefineProductWorkflow } from "../extensions/define-product-workflow.ts";

function completedResult(definitionId = "definition-1") {
	return {
		status: "completed",
		executiveSummary: "done with gpt-5.6-terra medium digest-1 r1",
		artifacts: [
			{
				kind: "engram",
				project: "pi-workflow",
				topic: `workflow/define-product/${definitionId}/research/request-1`,
				revision: "r1",
				schema: "research-evidence",
				schemaVersion: 1,
				digest: "digest-1",
			},
		],
		nextRecommended: { kind: "confirmed-route", route: "wayfinder" },
		risks: [{ id: "risk-private-1", summary: "risk-private-1 references digest-1" }],
		launchProvenance: {
			agentName: "research",
			assetVersion: 1,
			assetDigest: "asset-digest",
			capabilityProfile: "research-reader",
			provider: "openai-codex",
			model: "gpt-5.6-terra",
			effort: "medium",
			inheritContext: false,
			promptMode: "replace",
			skillRefs: [],
			standardRefs: [],
			allowedTools: ["read"],
			deniedCapabilities: ["bash"],
			artifactTopic: `workflow/define-product/${definitionId}/research/request-1`,
		},
	};
}

function validSpecRequest(overrides = {}) {
	return {
		action: "to_spec",
		teamId: "team-grupo-ilao",
		title: "Incorporar aprobaciones exactas del Spec",
		problem:
			"El equipo puede publicar una definición distinta de la que revisó el Owner.",
		solution:
			"El flujo genera un Spec español exacto y exige aprobación vinculada a su identidad completa.",
		userStories: [
			"Como Owner, quiero revisar el cuerpo exacto, para conservar autoridad sobre la definición publicada.",
		],
		decisions: [
			{
				id: "exact-approval",
				status: "resolved",
				pertinent: true,
				text: "La aprobación se vincula al resumen criptográfico exacto antes de publicar.",
			},
		],
		tests: ["Verificar la aprobación exacta antes de publicar."],
		outOfScope: [
			"La publicación de la descripción del Delivery parent en Linear queda fuera del alcance.",
		],
		...overrides,
	};
}

function sharedRuntimeDependencies() {
	let sequence = 0;
	const prepared = new Map();
	return {
		interactiveDecisions: {
			async prepare(request) {
				sequence += 1;
				const decisionId = `${"a".repeat(64)}:${String(sequence).padStart(64, "0")}`;
				prepared.set(decisionId, request.presentation.choices);
				return { decisionId, choices: request.presentation.choices };
			},
			async authorize(decisionId, action) {
				const choice = prepared
					.get(decisionId)
					?.find((candidate) => candidate.action.id === action.id);
				if (!choice)
					return {
						kind: "blocked",
						blocker: { code: "PI_WORKFLOW_DECISION_CLAIM_MISSING", message: "missing" },
					};
				if (choice.mode === "cancel")
					return { kind: "cancelled", decisionId, receipt: { state: "cancelled" } };
				return {
					kind: "authorized",
					lease: {
						decisionId,
						operationDigest: decisionId.slice(-64),
						executionId: `execution-${sequence}`,
						generation: sequence,
						actorId: "owner-1",
						authorityRevision: "single-user/v1",
						action,
					},
				};
			},
			async bindExecutionManifest(lease, manifest) {
				return { kind: "authorized", lease, manifest };
			},
			async authorizeEffect(lease) {
				return { kind: "authorized", lease, manifest: { ref: "bound" } };
			},
			async recover() {
				return { kind: "none" };
			},
		},
		authoritySession: {
			current: () => ({
				actorId: "owner-1",
				role: "Owner",
				authorityRevision: "single-user/v1",
			}),
			user: () => ({ id: "owner-1", name: "Owner", isActive: true, isGuest: false }),
			authenticate: () => ({ ok: false, reason: "already-authenticated" }),
			clear() {},
		},
	};
}

function registerRuntime({ sharedAuthority = true } = {}) {
	let pendingRecommendation;
	const commands = [];
	const handlers = new Map();
	const tools = new Map();
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => pendingRecommendation,
			reset: () => {
				pendingRecommendation = undefined;
			},
			advance: async (command) => {
				commands.push(command);
				if (command.kind === "recommend-route") {
					pendingRecommendation = {
						definitionId: command.definitionId,
						domainAnchor: command.domainAnchor,
						domainAnchorDigest: "anchor-digest",
						assessment: command.assessment,
						recommendedRoute: "wayfinder",
						digest: "recommendation-1",
						confirmationToken: "0123456789012345678901234567890123456789012",
						issuedAt: 0,
					};
					return {
						status: "awaiting-confirmation",
						recommendation: pendingRecommendation,
					};
				}
				pendingRecommendation = undefined;
				return {
					status: "completed",
					result: completedResult(),
				};
			},
		},
		createDefinitionId: () => "definition-1",
		...(sharedAuthority ? sharedRuntimeDependencies() : { interactiveDecisions: undefined }),
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return {
		handlers,
		runtime,
		tool: tools.get("workflow_define_product"),
		pendingRecommendation: () => pendingRecommendation,
		commands,
	};
}

test("define-product without shared authority cannot authorize route confirmation from prose", async () => {
	const { runtime, tool, commands } = registerRuntime({ sharedAuthority: false });
	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	await tool.execute("tool-1", {
		action: "recommend_route",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.equal(tool.parameters.properties.confirmationToken, undefined);
	assert.equal(tool.parameters.properties.recommendationRef, undefined);
	assert.equal(tool.parameters.properties.confirmedRoute, undefined);
	const sameTurn = await tool.execute("tool-same-turn", {
		action: "confirm_route",
		researchQuestion: "What should we research?",
	});
	assert.equal(sameTurn.details.status, "blocked");
	assert.equal(sameTurn.details.blocker.code, "PI_WORKFLOW_DECISION_CLAIM_MISSING");
	runtime.handlePublicEntry({
		text: "Adelante; investiga los criterios pendientes.",
		source: "interactive",
	});
	const blocked = await tool.execute("tool-2", {
		action: "confirm_route",
		researchQuestion: "What should we research?",
	});
	assert.equal(blocked.details.blocker.code, "PI_WORKFLOW_DECISION_CLAIM_MISSING");
	assert.equal(commands.length, 1);
});

test("define-product without shared authority cannot authorize recovered Spec, ticket, or revision decisions from prose", async () => {
	const cases = [
		{
			name: "Spec",
			action: "approve_spec",
			recovery: {
				definitionId: "definition-spec",
				phase: "spec-approval",
				command: {
					kind: "approve-spec",
					target: {
						kind: "linear-parent-description",
						teamId: "team-1",
						title: "Exact Spec",
					},
					revision: "spec-r1",
					digest: "a".repeat(64),
				},
			},
		},
		{
			name: "ticket",
			action: "approve_tickets",
			recovery: {
				definitionId: "definition-ticket",
				phase: "ticket-approval",
				command: {
					kind: "approve-tickets",
					definitionId: "definition-ticket",
					parentRef: ticketRef("delivery-parent", "b".repeat(64)),
					graphRef: ticketRef("delivery-ticket-graph", "c".repeat(64)),
					digest: "c".repeat(64),
				},
			},
		},
		{
			name: "revision",
			action: "approve_approved_revision",
			recovery: {
				definitionId: "definition-revision",
				phase: "approved-revision-approval",
				digest: "d".repeat(64),
				draftDigest: "e".repeat(64),
			},
		},
	];
	for (const { name, action, recovery } of cases) {
		const handlers = new Map();
		const tools = new Map();
		const commands = [];
		const runtime = createDefineProductRuntime({
			workflow: {
				pendingRecommendation: () => undefined,
				reset() {},
				restoreRecovery: async () => recovery,
				advance: async (command) => {
					commands.push(command);
					return { status: "blocked", blocker: { code: "unexpected", message: "unexpected" } };
				},
			},
			createDefinitionId: () => "unused",
			interactiveDecisions: undefined,
		});
		runtime.register({
			on: (event, handler) => handlers.set(event, handler),
			registerTool: (tool) => tools.set(tool.name, tool),
		});
		await handlers.get("session_start")({ type: "session_start" });
		runtime.handlePublicEntry({ text: "I approve this exact operation", source: "interactive" });
		const outcome = await tools.get("workflow_define_product").execute(name, { action });
		assert.equal(outcome.details.blocker.code, "PI_WORKFLOW_DECISION_CLAIM_MISSING", name);
		assert.deepEqual(commands, [], name);
	}
});

test("define-product binds shared route authority before research execution", async () => {
	const calls = [];
	let pendingRecommendation;
	let routeDecision;
	let claimAvailable = false;
	const lease = {
		decisionId: `${"a".repeat(64)}:${"b".repeat(64)}`,
		operationDigest: "b".repeat(64),
		actorId: "owner-1",
		authorityRevision: "single-user/v1",
		action: {
			id: "define-product.route.confirm",
			input: {
				definitionId: "definition-1",
				recommendationDigest: "recommendation-1",
				route: "wayfinder",
			},
		},
		executionId: "execution-route-1",
		generation: 1,
	};
	const decisions = {
		async prepare(request) {
			calls.push("prepare");
			assert.equal(request.scope.workflow, "define-product");
			assert.equal(request.operation.kind, "define-product.route");
			assert.equal(request.operation.phase, "route.confirmation");
			assert.deepEqual(request.operation.input, lease.action.input);
			routeDecision = {
				decisionId: lease.decisionId,
				choices: request.presentation.choices,
			};
			return routeDecision;
		},
		async authorize(decisionId, action, actor) {
			calls.push("authorize");
			assert.equal(decisionId, lease.decisionId);
			assert.deepEqual(action, lease.action);
			assert.deepEqual(actor, {
				actorId: "owner-1",
				authorityRevision: "single-user/v1",
				active: true,
				guest: false,
			});
			if (claimAvailable)
				pendingRecommendation.digest = "mutated-after-authorization-started";
			return claimAvailable
				? { kind: "authorized", lease }
				: {
					kind: "blocked",
					blocker: {
						code: "PI_WORKFLOW_DECISION_CLAIM_MISSING",
						message: "No fresh presentation claim authorizes this action.",
					},
				};
		},
		async bindExecutionManifest(candidate, manifest) {
			calls.push("bind");
			assert.deepEqual(candidate, lease);
			assert.equal(manifest.executionId, lease.executionId);
			assert.match(manifest.ref, /define-product\/definition-1\/route\/recommendation-1$/);
			return { kind: "authorized", lease, manifest };
		},
		async authorizeEffect(candidate) {
			calls.push("effect");
			assert.deepEqual(candidate, lease);
			return {
				kind: "authorized",
				lease,
				manifest: { ref: "bound" },
			};
		},
	};
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => pendingRecommendation,
			reset() {},
			async advance(command) {
				calls.push("advance");
				if (command.kind === "recommend-route") {
					pendingRecommendation = {
						definitionId: command.definitionId,
						domainAnchor: command.domainAnchor,
						domainAnchorDigest: "anchor-digest",
						assessment: command.assessment,
						recommendedRoute: "wayfinder",
						digest: "recommendation-1",
						confirmationToken: "0123456789012345678901234567890123456789012",
						issuedAt: 0,
					};
					return { status: "awaiting-confirmation", recommendation: pendingRecommendation };
				}
				return { status: "completed", result: completedResult() };
			},
		},
		createDefinitionId: () => "definition-1",
		project: "pi-workflow",
		interactiveDecisions: decisions,
		authoritySession: {
			current: () => ({ actorId: "owner-1", role: "Owner", authorityRevision: "single-user/v1" }),
			user: () => ({ id: "owner-1", name: "Owner", isActive: true, isGuest: false }),
			authenticate: () => ({ ok: false, reason: "already-authenticated" }),
			clear() {},
		},
	});
	const tools = new Map();
	runtime.register({ on() {}, registerTool: (tool) => tools.set(tool.name, tool) });
	runtime.handlePublicEntry({ text: "/define-product map a new category", source: "interactive" });
	const tool = tools.get("workflow_define_product");
	await tool.execute("recommend", {
		action: "recommend_route",
		assessment: { clarity: "unclear", breadth: "broad", reasons: ["missing shape"] },
	});
	assert.ok(routeDecision);

	runtime.handlePublicEntry({ text: "Continue", source: "interactive" });
	const unclaimed = await tool.execute("unclaimed", {
		action: "confirm_route",
		researchQuestion: "What should we research?",
	});
	assert.equal(unclaimed.details.blocker.code, "PI_WORKFLOW_DECISION_CLAIM_MISSING");
	assert.deepEqual(calls, ["advance", "prepare", "authorize"]);

	claimAvailable = true;
	const completed = await tool.execute("claimed", {
		action: "confirm_route",
		researchQuestion: "What should we research?",
	});
	assert.equal(completed.details.status, "completed");
	assert.deepEqual(calls, [
		"advance",
		"prepare",
		"authorize",
		"authorize",
		"bind",
		"effect",
		"advance",
	]);
});

test("define-product cancellation consumes the shared cancel choice without an effect", async () => {
	const tools = new Map();
	const commands = [];
	const decisionId = `${"a".repeat(64)}:${"b".repeat(64)}`;
	let pendingRecommendation;
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => pendingRecommendation,
			reset() { pendingRecommendation = undefined; },
			async advance(command) {
				commands.push(command);
				pendingRecommendation = {
					definitionId: command.definitionId,
					domainAnchor: command.domainAnchor,
					domainAnchorDigest: "anchor-digest",
					assessment: command.assessment,
					recommendedRoute: "wayfinder",
					digest: "recommendation-1",
					confirmationToken: "0123456789012345678901234567890123456789012",
					issuedAt: 0,
				};
				return { status: "awaiting-confirmation", recommendation: pendingRecommendation };
			},
		},
		createDefinitionId: () => "definition-1",
		interactiveDecisions: {
			prepare: async () => ({ decisionId, choices: [] }),
			authorize: async (actualDecisionId, action) => {
				assert.equal(actualDecisionId, decisionId);
				assert.deepEqual(action, { id: "decision.cancel", input: null });
				return {
					kind: "cancelled",
					decisionId,
					receipt: { state: "cancelled", decisionId, actionId: "decision.cancel", actorId: "owner-1" },
				};
			},
		},
		authoritySession: {
			current: () => ({ actorId: "owner-1", role: "Owner", authorityRevision: "single-user/v1" }),
			user: () => ({ id: "owner-1", name: "Owner", isActive: true, isGuest: false }),
			authenticate: () => ({ ok: false, reason: "already-authenticated" }),
			clear() {},
		},
	});
	runtime.register({ on() {}, registerTool: (tool) => tools.set(tool.name, tool) });
	runtime.handlePublicEntry({ text: "/define-product cancel me", source: "interactive" });
	const tool = tools.get("workflow_define_product");
	await tool.execute("recommend", {
		action: "recommend_route",
		assessment: { clarity: "unclear", breadth: "broad", reasons: ["research"] },
	});
	const cancelled = await tool.execute("cancel", { action: "cancel_decision" });
	assert.deepEqual(cancelled.details, { status: "cancelled" });
	assert.equal(commands.length, 1);
	assert.equal(runtime.hasActiveTurn(), false);
});

test("define-product accepts only interactive non-streaming domain anchors", async () => {
	const { runtime, tool, commands } = registerRuntime();
	for (const event of [
		{ text: "/define-product generated anchor", source: "extension" },
		{ text: "/define-product streamed anchor", source: "interactive", streamingBehavior: "steer" },
	]) {
		runtime.handlePublicEntry(event);
		const blocked = await tool.execute("invalid-inline-anchor", {
			action: "recommend_route",
			domainAnchor: "model anchor",
			assessment: { clarity: "clear", breadth: "narrow", reasons: ["bounded"] },
		});
		assert.equal(blocked.details.status, "blocked");
	}

	runtime.handlePublicEntry({ text: "/define-product", source: "interactive" });
	for (const event of [
		{ text: "generated anchor", source: "extension" },
		{ text: "streamed anchor", source: "interactive", streamingBehavior: "steer" },
		{ text: "/product-review ILA-1", source: "interactive" },
	]) {
		runtime.handlePublicEntry(event);
		const blocked = await tool.execute("missing-anchor", {
			action: "recommend_route",
			domainAnchor: "model anchor",
			assessment: { clarity: "clear", breadth: "narrow", reasons: ["bounded"] },
		});
		assert.equal(blocked.details.status, "blocked");
	}

	runtime.handlePublicEntry({
		text: "  Owner-provided corrective anchor  ",
		source: "interactive",
	});
	const recommendation = await tool.execute("corrective-anchor", {
		action: "recommend_route",
		domainAnchor: "model anchor",
		assessment: { clarity: "clear", breadth: "narrow", reasons: ["bounded"] },
	});
	assert.equal(commands.at(-1).domainAnchor, "Owner-provided corrective anchor");
	assert.equal(recommendation.details.recommendation.domainAnchor, undefined);
});

test("define-product runtime clears prompt and confirmation eligibility after session replacement or shutdown", async () => {
	for (const eventName of ["session_start", "session_shutdown"]) {
		const { handlers, runtime, tool, pendingRecommendation } =
			registerRuntime();
		runtime.handlePublicEntry({
			text: "/define-product map a new category",
			source: "interactive",
		});
		await tool.execute("tool-1", {
			action: "recommend_route",
			definitionId: "definition-1",
			domainAnchor: "map a new category",
			assessment: {
				clarity: "unclear",
				breadth: "broad",
				reasons: ["missing shape"],
			},
		});
		await handlers.get(eventName)({ type: eventName });
		assert.equal(pendingRecommendation(), undefined, eventName);
		assert.equal(
			await handlers.get("before_agent_start")({ systemPrompt: "base" }),
			undefined,
			eventName,
		);
		assert.equal(
			runtime.shouldContinue({
				text: "Yes, use wayfinder",
				source: "interactive",
			}),
			false,
			eventName,
		);
		const outOfTurn = await tool.execute("tool-2", {
			action: "confirm_route",
			recommendationRef: "recommendation-1",
			confirmationToken: "0123456789012345678901234567890123456789012",
			confirmedRoute: "wayfinder",
			researchQuestion: "What should we research?",
		});
		assert.equal(outOfTurn.details.status, "blocked", eventName);
	}
});

test("session start restores private exploration identity while clearing confirmation authorization", async () => {
	const handlers = new Map();
	const tools = new Map();
	let resetCount = 0;
	let advancedCommand;
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => ({ digest: "stale", recommendedRoute: "wayfinder" }),
			reset: () => { resetCount += 1; },
			restoreRecovery: async () => ({
				definitionId: "definition-recovered",
				phase: "exploration",
			}),
			advance: async (command) => {
				advancedCommand = command;
				return {
					status: "completed",
					result: completedResult(),
				};
			},
		},
		createDefinitionId: () => "new-definition",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	assert.equal(resetCount >= 1, true);
	const ownerResponse = { text: "continue", source: "interactive" };
	assert.equal(runtime.shouldContinue(ownerResponse), true);
	runtime.handlePublicEntry(ownerResponse);
	const confirmation = await tools.get("workflow_define_product").execute("confirm", {
		action: "confirm_route",
		recommendationRef: "stale",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "stale",
	});
	assert.equal(confirmation.details.status, "blocked");
	const exploration = await tools.get("workflow_define_product").execute("explore", {
		action: "request_exploration",
		intent: "prototype",
		focus: "Resume safely",
	});
	assert.equal(exploration.details.status, "completed");
	assert.equal(advancedCommand.definitionId, "definition-recovered");
});

test("session start restores the exact pending Spec approval phase", async () => {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset: () => {},
			restoreRecovery: async () => ({
				definitionId: "definition-recovered",
				phase: "spec-approval",
				command: {
					kind: "approve-spec",
					target: {
						kind: "linear-parent-description",
						teamId: "team-grupo-ilao",
						title: "Spec recuperado",
					},
					revision: "spec-r1",
					digest: "digest-r1",
				},
			}),
			advance: async (command) => {
				commands.push(command);
				return { status: "blocked", blocker: { code: "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH", message: "test" } };
			},
		},
		createDefinitionId: () => "new-definition",
		...sharedRuntimeDependencies(),
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	const prompt = await handlers.get("before_agent_start")({ systemPrompt: "base" });
	assert.match(prompt.systemPrompt, /approve_spec/);
	runtime.handlePublicEntry({ text: "Apruebo", source: "interactive" });
	await tools.get("workflow_define_product").execute("approve", {
		action: "approve_spec",
	});
	assert.deepEqual(commands[0], {
		kind: "approve-spec",
		target: {
			kind: "linear-parent-description",
			teamId: "team-grupo-ilao",
			title: "Spec recuperado",
		},
		revision: "spec-r1",
		digest: "digest-r1",
	});
});

test("one shared Spec approval lease authorizes approval and parent publication", async () => {
	const handlers = new Map();
	const tools = new Map();
	const calls = [];
	const approveCommand = {
		kind: "approve-spec",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Spec exacto",
		},
		revision: "spec-r1",
		digest: "d".repeat(64),
	};
	const lease = {
		decisionId: `${"a".repeat(64)}:${"b".repeat(64)}`,
		operationDigest: "b".repeat(64),
		actorId: "owner-1",
		authorityRevision: "single-user/v1",
		action: {
			id: "define-product.spec.publish",
			input: {
				definitionId: "definition-1",
				digest: approveCommand.digest,
				revision: approveCommand.revision,
				target: approveCommand.target,
			},
		},
		executionId: "execution-spec-1",
		generation: 1,
	};
	let activePublication = false;
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => ({
				definitionId: "definition-1",
				phase: "spec-approval",
				command: approveCommand,
			}),
			advance: async (command) => {
				calls.push(["advance", command]);
				return {
					status: "spec-approved",
					spec: { payload: { target: approveCommand.target } },
					approval: { payload: { target: approveCommand.target } },
					approvedSpecRef: ticketRef("approved-spec", approveCommand.digest),
				};
			},
		},
		createDefinitionId: () => "unused",
		project: "pi-workflow",
		interactiveDecisions: {
			async prepare(request) {
				calls.push(["prepare", request]);
				assert.equal(request.operation.kind, "define-product.spec-publication");
				return { decisionId: lease.decisionId, choices: [] };
			},
			async authorize(decisionId, action) {
				calls.push(["authorize", decisionId, action]);
				return { kind: "authorized", lease };
			},
			async bindExecutionManifest(candidate, manifest) {
				calls.push(["bind", candidate, manifest]);
				assert.match(manifest.ref, new RegExp(`${approveCommand.digest}$`));
				return { kind: "authorized", lease, manifest };
			},
			async authorizeEffect(candidate) {
				calls.push(["effect", candidate]);
				return { kind: "authorized", lease: candidate, manifest: { ref: "bound" } };
			},
		},
		authoritySession: {
			current: () => ({ actorId: "owner-1", role: "Owner", authorityRevision: "single-user/v1" }),
			user: () => ({ id: "owner-1", name: "Owner", isActive: true, isGuest: false }),
			authenticate: () => ({ ok: false, reason: "already-authenticated" }),
			clear() {},
		},
		mcpPublication: {
			allowedTools: ["workflow_define_product"],
			setMcpAvailable() {},
			clear() { activePublication = false; },
			hasActiveTurn: () => activePublication,
			async begin(definitionId, toolCallId, input, executionLease) {
				calls.push(["publish", definitionId, toolCallId, input, executionLease]);
				activePublication = true;
				return { status: "continuing" };
			},
			async complete() { return { status: "blocked", blocker: { code: "unused", message: "unused" } }; },
			expectedModelCall: () => undefined,
			nextCallInstruction: () => undefined,
			handleToolCall: async () => undefined,
			handleToolResult: async () => false,
		},
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	assert.equal(calls[0][0], "prepare");
	runtime.handlePublicEntry({ text: "Approve and publish", source: "interactive" });
	const approved = await tools.get("workflow_define_product").execute("approve", {
		action: "approve_spec",
	});
	assert.equal(approved.details.status, "spec-approved");
	assert.deepEqual(calls.slice(1).map(([kind]) => kind), ["authorize", "bind", "effect", "advance"]);

	const publication = await tools.get("workflow_define_product").execute("publish", {
		action: "publish_spec",
	});
	assert.equal(publication.details.status, "continuing");
	assert.deepEqual(calls.at(-1), [
		"publish",
		"definition-1",
		"publish",
		{ action: "publish_spec" },
		lease,
	]);
});

test("session start restores publication eligibility without accepting LLM Spec content", async () => {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => ({
				definitionId: "definition-restart",
				phase: "publication",
				approvedSpecRef: ticketRef("approved-spec", "spec-digest"),
			}),
			advance: async (command) => {
				commands.push(command);
				return {
					status: "spec-published",
					parent: { id: "parent-1" },
					parentRef: ticketRef("delivery-parent", "parent-digest"),
				};
			},
		},
		createDefinitionId: () => "unused",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	const prompt = await handlers.get("before_agent_start")({ systemPrompt: "base" });
	assert.match(prompt.systemPrompt, /publish_spec/);
	const tool = tools.get("workflow_define_product");
	assert.equal(tool.parameters.properties.action.enum.includes("publish_spec"), true);

	const injected = await tool.execute("injected", {
		action: "publish_spec",
		description: "agent-controlled content",
	});
	assert.equal(injected.details.status, "blocked");
	const outcome = await tool.execute("publish", { action: "publish_spec" });
	assert.equal(outcome.details.status, "spec-published");
	assert.deepEqual(commands, [{ kind: "publish-spec", definitionId: "definition-restart" }]);
});

test("define-product rejects an agent-supplied definition ID that differs from the session identity", async () => {
	const { runtime, tool, commands } = registerRuntime();
	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	const rejected = await tool.execute("tool-1", {
		action: "recommend_route",
		definitionId: "agent-controlled-definition",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.deepEqual(rejected.details, {
		status: "blocked",
		blocker: {
			code: "PI_WORKFLOW_DEFINITION_ID_MISMATCH",
			message:
				"The supplied definition ID does not match the active define-product session.",
		},
	});
	assert.deepEqual(commands, []);

	const recommendation = await tool.execute("tool-2", {
		action: "recommend_route",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.equal("definitionId" in recommendation.details.recommendation, false);
	assert.equal("issuedAt" in recommendation.details.recommendation, false);
	assert.equal("domainAnchorDigest" in recommendation.details.recommendation, false);
	assert.doesNotMatch(recommendation.content[0].text, /definition-1/);
});

test("Owner can request a public exploration continuation from verified research without runtime IDs", async () => {
	const { handlers, runtime, tool, commands } = registerRuntime();
	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	await tool.execute("tool-1", {
		action: "recommend_route",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	runtime.handlePublicEntry({
		text: "Me parece adecuada esa ruta.",
		source: "interactive",
	});
	await tool.execute("tool-2", {
		action: "confirm_route",
		recommendationRef: "recommendation-1",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "What should we research?",
	});

	assert.equal(runtime.hasActiveTurn(), true);
	const continuationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(continuationPrompt.systemPrompt, /request_exploration/);
	assert.deepEqual(tool.parameters.properties.intent, {
		type: "string",
		enum: ["prototype", "design-alternative"],
	});
	assert.equal("sessionId" in tool.parameters.properties, false);
	assert.equal("targetTopic" in tool.parameters.properties, false);

	const exploration = await tool.execute("tool-3", {
		action: "request_exploration",
		intent: "prototype",
		focus: "Compare the first-run onboarding directions",
	});
	assert.equal(exploration.details.status, "completed");
	assert.deepEqual(commands.at(-1), {
		kind: "request-exploration",
		definitionId: "definition-1",
		intent: "prototype",
		focus: "Compare the first-run onboarding directions",
	});
	assert.equal(runtime.hasActiveTurn(), true);
	const targetPrompt = (
		await handlers.get("before_agent_start")({ systemPrompt: "base" })
	).systemPrompt;
	assert.match(targetPrompt, /linear_list_teams exactly once/i);
	assert.match(targetPrompt, /numbered options without internal IDs/i);
	assert.match(targetPrompt, /derive .*title/i);
	assert.match(targetPrompt, /never ask the Owner to provide a title/i);
	const sameTurnSpec = await tool.execute("same-turn-after-exploration", validSpecRequest());
	assert.equal(sameTurnSpec.details.status, "blocked");
	assert.equal(sameTurnSpec.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
});

test("production define-product seam refuses to-spec before verified research completes", async () => {
	const tools = new Map();
	const workflow = createDefineProductWorkflow({
		delegate: { delegate: async () => completedResult() },
		createRequestId: () => "unused",
		project: { name: "pi-workflow", root: "/repo" },
	});
	const runtime = createDefineProductRuntime({
		workflow,
		createDefinitionId: () => "definition-runtime",
	});
	runtime.register({
		on: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	runtime.handlePublicEntry({
		text: "/define-product redactar el Spec aprobado",
		source: "interactive",
	});

	const refused = await tools
		.get("workflow_define_product")
		.execute("spec", validSpecRequest());

	assert.equal(refused.details.status, "blocked");
	assert.equal(refused.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
});

test("production define-product accepts the captured semantic-only Spec payload and derives trusted approval", async () => {
	const handlers = new Map();
	const tools = new Map();
	let currentAuthority = {
		actorId: "developer-1",
		role: "Developer",
		authorityRevision: "owner-policy-r3",
	};
	const workflow = createDefineProductWorkflow({
		delegate: { delegate: async () => completedResult("definition-runtime") },
		createRequestId: () => "unused",
		project: { name: "pi-workflow", root: "/repo" },
		authenticatedAuthority: {
			current: async () => currentAuthority,
		},
		approvedSpecStore: {
			read: async () => {
				throw new Error("not used");
			},
			save: async (_definitionId, value) => ({
				...structuredClone(value),
				sourceRevision: "approved-spec-r1",
			}),
		},
	});
	const runtime = createDefineProductRuntime({
		workflow,
		createDefinitionId: () => "definition-runtime",
		...sharedRuntimeDependencies(),
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	runtime.handlePublicEntry({
		text: "/define-product redactar el Spec aprobado",
		source: "interactive",
	});
	const tool = tools.get("workflow_define_product");
	assert.deepEqual(tool.parameters.properties.action.enum, [
		"recommend_route",
		"confirm_route",
		"request_exploration",
		"to_spec",
		"approve_spec",
		"publish_spec",
		"to_tickets",
		"approve_tickets",
		"publish_tickets",
		"to_approved_revision",
		"approve_approved_revision",
		"publish_approved_revision",
		"cancel_decision",
	]);

	for (const privateField of [
		"definitionId",
		"target",
		"revision",
		"supportArtifactAliases",
		"supportArtifacts",
	]) assert.equal(privateField in tool.parameters.properties, false, privateField);
	const toSpecSchema = tool.parameters.oneOf.find(
		(schema) => schema.properties.action.const === "to_spec",
	);
	assert.deepEqual(Object.keys(toSpecSchema.properties).sort(), [
		"action",
		"decisions",
		"outOfScope",
		"problem",
		"solution",
		"teamId",
		"tests",
		"title",
		"userStories",
	]);
	assert.deepEqual(toSpecSchema.required, [
		"action",
		"title",
		"problem",
		"solution",
		"userStories",
		"decisions",
		"tests",
		"outOfScope",
	]);
	assert.equal(toSpecSchema.additionalProperties, false);
	const recommendation = await tool.execute("recommend", {
		action: "recommend_route",
		domainAnchor: "Definir aprobaciones exactas",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["research"],
		},
	});
	runtime.handlePublicEntry({
		text: "La ruta propuesta es adecuada; continúa.",
		source: "interactive",
	});
	await tool.execute("research", {
		action: "confirm_route",
		recommendationRef: recommendation.details.recommendation.digest,
		confirmationToken: recommendation.details.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "¿Cómo debe funcionar la aprobación?",
	});
	const sameTurn = await tool.execute("same-turn-spec", validSpecRequest());
	assert.equal(sameTurn.details.status, "blocked");
	assert.equal(
		sameTurn.details.blocker.message,
		"Spec generation requires a claimed shared team decision after research, or Owner feedback on the ready Spec.",
	);
	await handlers.get("tool_call")({
		toolName: "linear_list_teams",
		toolCallId: "teams",
		input: { limit: 50, orderBy: "updatedAt" },
	});
	await handlers.get("tool_result")({
		toolName: "linear_list_teams",
		toolCallId: "teams",
		content: [
			{
				type: "text",
				text: JSON.stringify({
					teams: [{ id: "team-grupo-ilao", name: "Grupo ILAO" }],
					hasNextPage: false,
				}),
			},
		],
	});
	runtime.handlePublicEntry({
		text: "Usa el equipo Grupo ILAO y el título Incorporar aprobaciones exactas del Spec",
		source: "interactive",
	});
	const ready = await tool.execute("spec", validSpecRequest());
	assert.equal(ready.details.status, "spec-ready");
	assert.equal(ready.details.spec.target.teamId, "team-grupo-ilao");
	assert.equal(ready.details.spec.decisions[0].id, "exact-approval");
	assert.equal("definitionId" in ready.details.spec, false);
	assert.equal("revision" in ready.details.spec, false);
	assert.equal("digest" in ready.details.spec, false);

	const staleRouteApproval = await tool.execute("stale-route-approval", {
		action: "approve_spec",
	});
	assert.equal(staleRouteApproval.details.status, "blocked");
	assert.equal(
		staleRouteApproval.details.blocker.code,
		"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
	);

	const refused = await tool.execute("refused-approval", {
		action: "approve_spec",
		actor: { actorId: "attacker-chosen" },
	});
	assert.equal(refused.details.status, "blocked");
	assert.equal(
		refused.details.blocker.code,
		"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
	);

	const feedback = {
		text: "La solución todavía debe incorporar el escenario de recuperación.",
		source: "interactive",
	};
	assert.equal(runtime.shouldContinue(feedback), true);
	runtime.handlePublicEntry(feedback);
	const { teamId: _boundTeam, ...revisionRequest } = validSpecRequest({
		solution: "El flujo incorpora el feedback del Owner antes de una nueva aprobación.",
	});
	const revised = await tool.execute("revision-after-feedback", revisionRequest);
	assert.equal(revised.details.status, "spec-ready", JSON.stringify(revised.details));

	currentAuthority = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	runtime.handlePublicEntry({ text: "Apruebo", source: "interactive" });
	const approved = await tool.execute("approval", { action: "approve_spec" });
	assert.equal(approved.details.status, "spec-approved");
	assert.equal(approved.details.approval.status, "approved");
	assert.equal(approved.details.approval.actor, undefined);
	assert.equal("approvedSpecRef" in approved.details, false);
	assert.doesNotMatch(approved.content[0].text, /approved-spec-r1|digest|revision/);
	assert.equal(runtime.hasActiveTurn(), true);
});

test("production define-product seam blocks malformed Spec payloads without throwing", async () => {
	const tools = new Map();
	const workflow = createDefineProductWorkflow({
		delegate: { delegate: async () => completedResult("definition-runtime") },
		createRequestId: () => "unused",
		project: { name: "pi-workflow", root: "/repo" },
	});
	const runtime = createDefineProductRuntime({
		workflow,
		createDefinitionId: () => "definition-runtime",
		...sharedRuntimeDependencies(),
	});
	runtime.register({
		on: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	runtime.handlePublicEntry({
		text: "/define-product redactar el Spec aprobado",
		source: "interactive",
	});
	const tool = tools.get("workflow_define_product");
	const recommendation = await tool.execute("recommend", {
		action: "recommend_route",
		domainAnchor: "Definir aprobaciones exactas",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["research"],
		},
	});
	runtime.handlePublicEntry({
		text: "Puedes continuar con esa investigación.",
		source: "interactive",
	});
	await tool.execute("research", {
		action: "confirm_route",
		recommendationRef: recommendation.details.recommendation.digest,
		confirmationToken: recommendation.details.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "¿Cómo debe funcionar la aprobación?",
	});
	const valid = validSpecRequest();
	for (const malformed of [
		{ ...valid, teamId: undefined },
		{ ...valid, userStories: "not-an-array" },
		{ ...valid, decisions: [null] },
		{ ...valid, revision: "spec-r99" },
		{ ...valid, supportArtifactAliases: ["research"] },
		{ ...valid, target: { kind: "linear-parent-description" } },
		{ ...valid, definitionId: "agent-definition" },
	]) {
		runtime.handlePublicEntry({ text: "Equipo y título confirmados", source: "interactive" });
		const outcome = await tool.execute("malformed", malformed);
		assert.equal(outcome.details.status, "blocked");
		assert.equal(
			outcome.details.blocker.code,
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
		);
	}

});

test("define-product system prompt is scoped to the active guarded turn", async () => {
	const { handlers, runtime, tool } = registerRuntime();
	assert.equal(
		await handlers.get("before_agent_start")({ systemPrompt: "base" }),
		undefined,
	);
	const outOfTurn = await tool.execute("tool-0", {
		action: "recommend_route",
		definitionId: "definition-1",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	assert.equal(outOfTurn.details.status, "blocked");

	runtime.handlePublicEntry({
		text: "/define-product map a new category",
		source: "interactive",
	});
	const recommendationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(recommendationPrompt.systemPrompt, /recommend_route/);
	assert.match(recommendationPrompt.systemPrompt, /confirm naturally/);
	assert.match(recommendationPrompt.systemPrompt, /Never show or request tokens/);

	await tool.execute("tool-1", {
		action: "recommend_route",
		definitionId: "definition-1",
		domainAnchor: "map a new category",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["missing shape"],
		},
	});
	const confirmationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(confirmationPrompt.systemPrompt, /confirm_route/);
	runtime.handlePublicEntry({
		text: "Investiga la cuestión propuesta.",
		source: "interactive",
	});

	await tool.execute("tool-2", {
		action: "confirm_route",
		recommendationRef: "recommendation-1",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "What should we research?",
	});
	const explorationPrompt = await handlers.get("before_agent_start")({
		systemPrompt: "base",
	});
	assert.match(explorationPrompt.systemPrompt, /linear_list_teams exactly once/i);
	assert.match(explorationPrompt.systemPrompt, /numbered options without internal IDs/i);
	assert.match(explorationPrompt.systemPrompt, /title/);
	assert.match(explorationPrompt.systemPrompt, /never call to_spec in that same turn|Do not call .*to_spec.*same turn/i);
	assert.match(explorationPrompt.systemPrompt, /never present .*fallback or unofficial Spec/i);
	assert.match(explorationPrompt.systemPrompt, /spec\.body verbatim and in full/i);
	assert.match(explorationPrompt.systemPrompt, /never summarize, paraphrase/i);
});

function ticketRef(schema, digest) {
	return {
		kind: "engram",
		project: "pi-workflow",
		topic: `workflow/define-product/definition-1/${schema}`,
		revision: `${schema}-r1`,
		schema,
		schemaVersion: 1,
		digest,
	};
}

function sampleTicketGraph() {
	return {
		schema: "delivery-ticket-graph",
		schemaVersion: 1,
		payload: {
			parent: {
				id: "parent-1",
				teamId: "team-1",
				revision: "parent-r1",
				specDigest: "spec-digest",
			},
			coverage: {
				stories: [{ id: "story-1", contextId: "context-1", acceptanceCriteria: ["ac-1"] }],
				decisions: ["decision-1"],
				tests: ["test-1"],
			},
			language: "es",
			tickets: [{
				stableKey: "TICKET-1",
				title: "Entregar resultado",
				outcome: "Resultado verificable",
				acceptanceCriteria: ["Uno", "Dos", "Tres", "Cuatro"],
				estimate: { points: 1, rationale: "Trabajo acotado" },
				blockers: [],
				refs: [{ kind: "story", id: "story-1" }],
				deliveryBindings: [{ storyId: "story-1", acceptanceCriterionId: "ac-1", contextId: "context-1" }],
			}],
		},
		digest: "graph-digest",
	};
}

function sampleTicketApproval(graph) {
	return {
		schema: "delivery-ticket-graph-approval",
		schemaVersion: 1,
		payload: {
			actor: { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" },
			parent: graph.payload.parent,
			graphDigest: graph.digest,
		},
		digest: "approval-digest",
	};
}

function registerTicketRuntime(recovery) {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const graph = sampleTicketGraph();
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => recovery,
			advance: async (command) => {
				commands.push(command);
				if (command.kind === "publish-spec") return {
					status: "spec-published",
					parent: {
						id: "parent-1",
						teamId: "team-1",
						title: "Canonical delivery",
						description: "Exact approved body",
						descriptionRevision: "parent-r1",
						state: "Backlog",
						cycleId: null,
						assigneeId: null,
						publicationKey: "private-publication-key",
					},
					parentRef: ticketRef("delivery-parent", "parent-digest"),
				};
				if (command.kind === "to-tickets") return {
					status: "tickets-ready",
					graph,
					graphRef: ticketRef("delivery-ticket-graph", graph.digest),
				};
				return {
					status: "tickets-approved",
					graph,
					graphRef: command.graphRef,
					approval: sampleTicketApproval(graph),
				};
			},
		},
		createDefinitionId: () => "definition-1",
		...sharedRuntimeDependencies(),
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return { handlers, tool: tools.get("workflow_define_product"), commands, runtime };
}

test("define-product privately binds the live Spec publication and ticket approval chain", async () => {
	const approvedSpecRef = ticketRef("approved-spec", "spec-digest");
	const parentRef = ticketRef("delivery-parent", "parent-digest");
	const graphRef = ticketRef("delivery-ticket-graph", "graph-digest");
	const recovered = registerTicketRuntime({
		definitionId: "definition-1",
		phase: "publication",
		approvedSpecRef,
	});
	await recovered.handlers.get("session_start")({ type: "session_start" });

	const actionOnlySchema = recovered.tool.parameters.oneOf.find((schema) =>
		schema.properties.action.enum?.includes("to_tickets"),
	);
	assert.deepEqual(Object.keys(actionOnlySchema.properties), ["action"]);
	assert.equal(actionOnlySchema.additionalProperties, false);
	for (const action of [
		"approve_spec",
		"publish_spec",
		"to_tickets",
		"approve_tickets",
		"publish_tickets",
		"approve_approved_revision",
		"publish_approved_revision",
		"cancel_decision",
	]) assert.equal(actionOnlySchema.properties.action.enum.includes(action), true);

	const published = await recovered.tool.execute("ticket intent revalidates parent", {
		action: "to_tickets",
	});
	assert.deepEqual(recovered.commands[0], {
		kind: "publish-spec",
		definitionId: "definition-1",
	});
	assert.equal(published.details.parent.id, "parent-1");
	assert.equal(published.details.parent.description, "Exact approved body");
	assert.equal("parentRef" in published.details, false);
	assert.equal("publicationKey" in published.details.parent, false);
	assert.equal("descriptionRevision" in published.details.parent, false);

	const graphPrompt = (await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
	assert.match(graphPrompt, /only action="to_tickets"/);
	assert.doesNotMatch(graphPrompt, /approvedSpecRef|parentRef|digest|definitionId/);
	const injectedGraph = await recovered.tool.execute("injected graph", {
		action: "to_tickets",
		approvedSpecRef,
		parentRef,
	});
	assert.equal(injectedGraph.details.status, "blocked");
	assert.equal(recovered.commands.length, 1);

	const ready = await recovered.tool.execute("tickets", { action: "to_tickets" });
	assert.deepEqual(recovered.commands[1], {
		kind: "to-tickets",
		definitionId: "definition-1",
		approvedSpecRef,
		parentRef,
	});
	assert.equal(ready.details.graph.parent.id, "parent-1");
	assert.equal(ready.details.graph.coverage.stories[0].id, "story-1");
	assert.equal(ready.details.graph.tickets[0].refs[0].id, "story-1");
	assert.equal("digest" in ready.details.graph, false);
	assert.equal("revision" in ready.details.graph.parent, false);
	assert.equal("specDigest" in ready.details.graph.parent, false);
	assert.doesNotMatch(ready.content[0].text, /graph-digest|delivery-ticket-graph-r1/);

	const approvalPrompt = (await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
	assert.match(approvalPrompt, /shared ticket decision records its publish action/);
	assert.match(approvalPrompt, /only action="approve_tickets"/);
	assert.doesNotMatch(approvalPrompt, /graphRef|parentRef|digest|definitionId/);
	const approved = await recovered.tool.execute("approve", { action: "approve_tickets" });
	assert.deepEqual(recovered.commands[2], {
		kind: "approve-tickets",
		definitionId: "definition-1",
		parentRef,
		graphRef,
		digest: "graph-digest",
	});
	assert.equal(approved.details.approval.status, "approved");
	assert.equal(approved.details.approval.actor, undefined);
	assert.equal(approved.details.graph.tickets[0].stableKey, "TICKET-1");
	assert.doesNotMatch(approved.content[0].text, /authority-r1|approval-digest|graph-digest/);
});

test("session recovery restores exact private approval commands and rejects replay fields", async () => {
	const parentRef = ticketRef("delivery-parent", "parent-digest");
	const graphRef = ticketRef("delivery-ticket-graph", "graph-digest");
	const command = {
		kind: "approve-tickets",
		definitionId: "definition-1",
		parentRef,
		graphRef,
		digest: "graph-digest",
	};
	const recovered = registerTicketRuntime({
		definitionId: "definition-1",
		phase: "ticket-approval",
		command,
	});
	await recovered.handlers.get("session_start")({ type: "session_start" });
	const prompt = (await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
	assert.match(prompt, /approve_tickets/);
	assert.doesNotMatch(prompt, /graph-digest|graphRef|parentRef|definitionId/);
	const rejected = await recovered.tool.execute("replayed metadata", {
		action: "approve_tickets",
		digest: "graph-digest",
	});
	assert.equal(rejected.details.status, "blocked");
	assert.deepEqual(recovered.commands, []);
	recovered.runtime.handlePublicEntry({ text: "Apruebo", source: "interactive" });
	await recovered.tool.execute("approve", { action: "approve_tickets" });
	assert.deepEqual(recovered.commands, [command]);

	const publication = (await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
	assert.match(publication, /only action="publish_tickets"/);
	assert.doesNotMatch(publication, /definitionId|digest|graphRef/);
});

test("restart gaps fail closed instead of inventing approved Spec references", async () => {
	const recovered = registerTicketRuntime({
		definitionId: "definition-1",
		phase: "publication",
	});
	await recovered.handlers.get("session_start")({ type: "session_start" });
	assert.equal((await recovered.tool.execute("publish", { action: "publish_spec" })).details.status, "spec-published");
	assert.equal(recovered.runtime.hasActiveTurn(), false);
	const tickets = await recovered.tool.execute("tickets", { action: "to_tickets" });
	assert.equal(tickets.details.status, "blocked");
	assert.equal(tickets.details.blocker.code, "PI_WORKFLOW_TICKET_PARENT_STALE");
	assert.equal(recovered.commands.length, 1);
});

function sampleRevision(digest, authority) {
	return {
		definitionId: "definition-revision",
		digest,
		kind: "product-revision",
		...(authority ? { authority } : {}),
		affectedIssues: [{
			id: "ILA-2317",
			previousDescription: "Descripción anterior",
			previousRevision: "issue-r1",
			nextDescription: "Descripción aprobada",
		}],
		sourceComment: {
			kind: "product-revision",
			body: `Revisión aprobada.\n\nReferencia de flujo: product-revision:${digest}`,
		},
		decisionGap: {
			issueId: "ILA-2317",
			body: `Decisión pendiente.\n\nReferencia de flujo: decision-gap:${digest}`,
		},
	};
}

test("define-product privately binds revision approval and publication", async () => {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			advance: async (command) => {
				commands.push(command);
				if (command.kind === "to-approved-revision") return {
					status: "revision-ready",
					revision: sampleRevision("draft-digest"),
					revisionRef: ticketRef("approved-revision-draft", "draft-digest"),
				};
				if (command.kind === "approve-approved-revision") return {
					status: "revision-approved",
					revision: sampleRevision("approved-digest", {
						actorId: "owner-1",
						role: "Owner",
						authorityRevision: "authority-r1",
					}),
					revisionRef: ticketRef("approved-revision", "approved-digest"),
				};
				return { status: "revision-published", definitionId: command.definitionId, digest: command.digest };
			},
		},
		createDefinitionId: () => "definition-revision",
		...sharedRuntimeDependencies(),
	});
	runtime.register({ on: (event, handler) => handlers.set(event, handler), registerTool: (tool) => tools.set(tool.name, tool) });
	runtime.handlePublicEntry({ text: "/define-product revisar entrega", source: "interactive" });
	const draft = await tools.get("workflow_define_product").execute("draft", {
		action: "to_approved_revision",
		revisionKind: "product-revision",
		affectedIssues: [{ id: "ILA-2317", nextDescription: "Descripción aprobada" }],
		sourceCommentKind: "product-revision",
		sourceCommentBody: "Revisión aprobada.\n\nReferencia de flujo: product-revision:{{digest}}",
	});
	assert.equal(commands[0].definitionId, "definition-revision");
	assert.equal(draft.details.revision.affectedIssues[0].id, "ILA-2317");
	assert.equal(draft.details.revision.affectedIssues[0].previousDescription, "Descripción anterior");
	assert.equal("previousRevision" in draft.details.revision.affectedIssues[0], false);
	assert.equal("definitionId" in draft.details.revision, false);
	assert.equal("digest" in draft.details.revision, false);
	assert.doesNotMatch(draft.content[0].text, /draft-digest|issue-r1|Referencia de flujo/);

	const approvalPrompt = (await handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
	assert.match(approvalPrompt, /shared revision decision records its publish action/);
	assert.doesNotMatch(approvalPrompt, /draft-digest|definitionId|revisionRef/);
	runtime.handlePublicEntry({ text: "Apruebo", source: "interactive" });
	const approved = await tools.get("workflow_define_product").execute("approve", {
		action: "approve_approved_revision",
	});
	const { executionLease: approvalLease, ...approvalCommand } = commands[1];
	assert.deepEqual(approvalCommand, {
		kind: "approve-approved-revision",
		definitionId: "definition-revision",
		digest: "draft-digest",
	});
	assert.equal(approvalLease.executionId, "execution-1");
	assert.equal(approved.details.revision.authority, undefined);
	assert.doesNotMatch(approved.content[0].text, /approved-digest|authority-r1|issue-r1/);

	const publicationPrompt = (await handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
	assert.match(publicationPrompt, /only action="publish_approved_revision"/);
	assert.doesNotMatch(publicationPrompt, /approved-digest|definitionId/);
	const published = await tools.get("workflow_define_product").execute("publish", {
		action: "publish_approved_revision",
	});
	const { executionLease: publicationLease, ...publicationCommand } = commands[2];
	assert.deepEqual(publicationCommand, {
		kind: "publish-approved-revision",
		definitionId: "definition-revision",
		digest: "approved-digest",
	});
	assert.equal(publicationLease.executionId, "execution-1");
	assert.deepEqual(published.details, { status: "revision-published" });
	assert.equal(runtime.hasActiveTurn(), false);
});

test("ticket publication recovery routes action-only calls through the ticket MCP controller without a native gateway", async () => {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const calls = [];
	let active = false;
	const ticketMcpPublication = {
		allowedTools: ["linear_get_user", "linear_get_issue", "linear_list_issue_statuses", "linear_list_issues", "linear_save_issue", "workflow_define_product"],
		setMcpAvailable() {},
		clear() { active = false; },
		hasActiveTurn: () => active,
		begin: async (definitionId, toolCallId, input) => {
			calls.push({ kind: "begin", definitionId, toolCallId, input });
			active = true;
			return { status: "continuing" };
		},
		complete: async () => ({ status: "blocked", blocker: { code: "unused", message: "unused" } }),
		expectedModelCall: () => active ? { toolName: "linear_get_user", input: { query: "me" } } : undefined,
		nextCallInstruction: () => "continue-ticket-mcp",
		handleToolCall: async (event) => { calls.push({ kind: "tool", event }); },
		handleToolResult: async (event) => { calls.push({ kind: "result", event }); return true; },
	};
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => ({ definitionId: "definition-ticket-mcp", phase: "ticket-publication" }),
			advance: async (command) => { commands.push(command); return { status: "tickets-published", definitionId: command.definitionId }; },
		},
		createDefinitionId: () => "unused",
		ticketMcpPublication,
		...sharedRuntimeDependencies(),
	});
	runtime.register({ on: (event, handler) => handlers.set(event, handler), registerTool: (tool) => tools.set(tool.name, tool) });
	await handlers.get("session_start")({ type: "session_start" });
	const started = await tools.get("workflow_define_product").execute("publish-mcp", { action: "publish_tickets" });
	assert.deepEqual(started.details, { status: "continuing" });
	assert.deepEqual(commands, []);
	assert.deepEqual(calls[0], { kind: "begin", definitionId: "definition-ticket-mcp", toolCallId: "publish-mcp", input: { action: "publish_tickets" } });
	assert.equal(runtime.allowedTools.includes("linear_save_issue"), true);
	assert.match((await handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt, /linear_get_user/);
	await handlers.get("tool_call")({ toolName: "linear_get_user", toolCallId: "owner", input: { query: "me" } });
	assert.equal(calls.at(-1).kind, "tool");
});

test("define-product restores durable revision and ticket publication bindings as action-only", async () => {
	for (const [phase, action, status, commandKind] of [
		["approved-revision-approval", "approve_approved_revision", "revision-approved", "approve-approved-revision"],
		["approved-revision-publication", "publish_approved_revision", "revision-published", "publish-approved-revision"],
	]) {
		const handlers = new Map();
		const tools = new Map();
		const commands = [];
		const runtime = createDefineProductRuntime({
			workflow: {
				pendingRecommendation: () => undefined,
				reset() {},
				restoreRecovery: async () => ({ definitionId: "definition-revision", phase, digest: "digest-durable" }),
				advance: async (command) => {
					commands.push(command);
					return status === "revision-approved"
						? {
							status,
							revision: sampleRevision("approved-digest", { actorId: "owner-1", role: "Owner", authorityRevision: "authority-r1" }),
							revisionRef: ticketRef("approved-revision", "approved-digest"),
						}
						: { status, definitionId: command.definitionId, digest: command.digest };
				},
			},
			createDefinitionId: () => "unused",
			...sharedRuntimeDependencies(),
		});
		runtime.register({ on: (event, handler) => handlers.set(event, handler), registerTool: (tool) => tools.set(tool.name, tool) });
		await handlers.get("session_start")({ type: "session_start" });
		const prompt = (await handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt;
		assert.match(prompt, new RegExp(action));
		assert.doesNotMatch(prompt, /digest-durable|definitionId/);
		const rejected = await tools.get("workflow_define_product").execute("replayed metadata", {
			action,
			digest: "digest-wrong",
		});
		assert.equal(rejected.details.status, "blocked");
		assert.deepEqual(commands, []);
		if (phase === "approved-revision-approval")
			runtime.handlePublicEntry({ text: "Apruebo", source: "interactive" });
		await tools.get("workflow_define_product").execute("revision", { action });
		assert.deepEqual(
			commands.map(({ executionLease: _lease, ...command }) => command),
			[{ kind: commandKind, definitionId: "definition-revision", digest: "digest-durable" }],
		);
	}

	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => ({ definitionId: "definition-published", phase: "ticket-publication" }),
			advance: async (command) => {
				commands.push(command);
				return { status: "tickets-published", definitionId: command.definitionId };
			},
		},
		createDefinitionId: () => "unused",
		...sharedRuntimeDependencies(),
	});
	runtime.register({ on: (event, handler) => handlers.set(event, handler), registerTool: (tool) => tools.set(tool.name, tool) });
	await handlers.get("session_start")({ type: "session_start" });
	const rejected = await tools.get("workflow_define_product").execute("replayed metadata", {
		action: "publish_tickets",
		definitionId: "definition-published",
	});
	assert.equal(rejected.details.status, "blocked");
	assert.deepEqual(commands, []);
	const published = await tools.get("workflow_define_product").execute("published", { action: "publish_tickets" });
	assert.deepEqual(published.details, { status: "tickets-published" });
	assert.deepEqual(commands, [{ kind: "publish-tickets", definitionId: "definition-published" }]);
	assert.equal(runtime.hasActiveTurn(), false);
}
);
