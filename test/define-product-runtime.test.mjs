import test from "node:test";
import assert from "node:assert/strict";

import { createDefineProductRuntime } from "../extensions/define-product-runtime.ts";
import { createDefineProductWorkflow } from "../extensions/define-product-workflow.ts";

function completedResult(definitionId = "definition-1") {
	return {
		status: "completed",
		executiveSummary: "done",
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
		risks: [],
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
		target: {
			kind: "linear-parent-description",
			teamId: "team-grupo-ilao",
			title: "Incorporar aprobaciones exactas del Spec",
		},
		revision: "spec-r1",
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
		supportArtifactAliases: ["research"],
		...overrides,
	};
}

function registerRuntime() {
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

test("define-product publishes and forwards the confirmation token only for explicit confirmation", async () => {
	const { runtime, tool, commands } = registerRuntime();
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
	assert.deepEqual(tool.parameters.properties.confirmationToken, {
		type: "string",
		minLength: 43,
		maxLength: 43,
	});
	await tool.execute("tool-2", {
		action: "confirm_route",
		recommendationRef: "recommendation-1",
		confirmationToken: "0123456789012345678901234567890123456789012",
		confirmedRoute: "wayfinder",
		researchQuestion: "What should we research?",
	});
	assert.equal(
		commands.at(-1).confirmationToken,
		"0123456789012345678901234567890123456789012",
	);
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
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => ({ digest: "stale", recommendedRoute: "wayfinder" }),
			reset: () => { resetCount += 1; },
			restoreRecovery: async () => ({
				definitionId: "definition-recovered",
				phase: "exploration",
			}),
			advance: async (command) => ({
				status: "completed",
				result: completedResult(),
				command,
			}),
		},
		createDefinitionId: () => "new-definition",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	assert.equal(resetCount >= 1, true);
	assert.equal(runtime.shouldContinue({ text: "continue", source: "interactive" }), true);
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
	assert.equal(exploration.details.command.definitionId, "definition-recovered");
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
			}),
			advance: async (command) => {
				commands.push(command);
				return { status: "blocked", blocker: { code: "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH", message: "test" } };
			},
		},
		createDefinitionId: () => "new-definition",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	await handlers.get("session_start")({ type: "session_start" });
	const prompt = await handlers.get("before_agent_start")({ systemPrompt: "base" });
	assert.match(prompt.systemPrompt, /approve_spec/);
	await tools.get("workflow_define_product").execute("approve", {
		action: "approve_spec",
		target: {
			kind: "linear-parent-description",
			teamId: "team-grupo-ilao",
			title: "Spec recuperado",
		},
		revision: "spec-r1",
		digest: "digest-r1",
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

test("session start restores publication eligibility without accepting LLM Spec content", async () => {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => ({ definitionId: "definition-restart", phase: "publication" }),
			advance: async (command) => {
				commands.push(command);
				return { status: "spec-published", parent: { id: "parent-1" } };
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

	const outcome = await tool.execute("publish", {
		action: "publish_spec",
		description: "agent-controlled content",
	});
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
	assert.equal(recommendation.details.recommendation.definitionId, "definition-1");
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

	const refused = await tools.get("workflow_define_product").execute("spec", {
		action: "to_spec",
		target: {
			kind: "linear-parent-description",
			teamId: "team-grupo-ilao",
			title: "Incorporar aprobaciones exactas del Spec",
		},
		revision: "spec-r1",
		problem: "El equipo necesita gestionar clientes y permisos correctamente.",
		solution: "El flujo genera una definición exacta para revisión.",
		userStories: ["Como Owner, quiero revisar la definición exacta."],
		decisions: [{ id: "exact-approval", status: "resolved", pertinent: true, text: "La aprobación conserva la definición exacta." }],
		tests: ["Verificar la aprobación exacta."],
		outOfScope: ["Publicar el Delivery parent en Linear."],
		supportArtifactAliases: ["research"],
	});

	assert.equal(refused.details.status, "blocked");
	assert.equal(refused.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
});

test("production define-product seam derives approval identity from trusted authority", async () => {
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
	});
	const runtime = createDefineProductRuntime({
		workflow,
		createDefinitionId: () => "definition-runtime",
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
	]);

	assert.equal("actor" in tool.parameters.properties, false);
	assert.equal("supportArtifacts" in tool.parameters.properties, false);
	assert.deepEqual(tool.parameters.properties.supportArtifactAliases, {
		type: "array",
		items: { type: "string" },
	});
	const recommendation = await tool.execute("recommend", {
		action: "recommend_route",
		domainAnchor: "Definir aprobaciones exactas",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["research"],
		},
	});
	await tool.execute("research", {
		action: "confirm_route",
		recommendationRef: recommendation.details.recommendation.digest,
		confirmationToken: recommendation.details.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "¿Cómo debe funcionar la aprobación?",
	});
	const ready = await tool.execute("spec", validSpecRequest());
	assert.equal(ready.details.status, "spec-ready");
	assert.equal(ready.details.spec.payload.definitionId, "definition-runtime");

	const attackerApproval = {
		action: "approve_spec",
		actor: {
			actorId: "attacker-chosen",
			role: "Owner",
			authorityRevision: "attacker-revision",
		},
		target: ready.details.spec.payload.target,
		revision: ready.details.spec.payload.revision,
		digest: ready.details.spec.digest,
	};
	const refused = await tool.execute("refused-approval", attackerApproval);
	assert.equal(refused.details.status, "blocked");
	assert.equal(
		refused.details.blocker.code,
		"PI_WORKFLOW_SPEC_APPROVAL_REQUIRED",
	);

	currentAuthority = {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	};
	const approved = await tool.execute("approval", attackerApproval);
	assert.equal(approved.details.status, "spec-approved");
	assert.deepEqual(approved.details.approval.payload.actor, {
		actorId: "owner-felipe",
		role: "Owner",
		authorityRevision: "owner-policy-r3",
	});
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
	await tool.execute("research", {
		action: "confirm_route",
		recommendationRef: recommendation.details.recommendation.digest,
		confirmationToken: recommendation.details.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "¿Cómo debe funcionar la aprobación?",
	});
	const valid = validSpecRequest();
	for (const malformed of [
		{ ...valid, target: undefined },
		{ ...valid, userStories: "not-an-array" },
		{ ...valid, decisions: [null] },
		{ ...valid, supportArtifactAliases: {} },
	]) {
		const outcome = await tool.execute("malformed", malformed);
		assert.equal(outcome.details.status, "blocked");
		assert.equal(
			outcome.details.blocker.code,
			"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
		);
	}

	const ready = await tool.execute("valid", valid);
	assert.equal(ready.details.status, "spec-ready");
	const malformedApproval = await tool.execute("malformed-approval", {
		action: "approve_spec",
		target: null,
		revision: ready.details.spec.payload.revision,
		digest: ready.details.spec.digest,
	});
	assert.equal(malformedApproval.details.status, "blocked");
	assert.equal(
		malformedApproval.details.blocker.code,
		"PI_WORKFLOW_SPEC_ARTIFACT_INVALID",
	);
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
	assert.match(explorationPrompt.systemPrompt, /request_exploration/);
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

function registerTicketRuntime(recovery) {
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
				return command.kind === "publish-spec"
					? { status: "spec-published", parent: { id: "parent-1" }, parentRef: ticketRef("delivery-parent", "parent-digest") }
					: command.kind === "to-tickets"
					? { status: "tickets-ready", graph: { digest: "graph-digest" }, graphRef: ticketRef("delivery-ticket-graph", "graph-digest") }
					: { status: "tickets-approved", graph: { digest: command.digest }, graphRef: command.graphRef, approval: { digest: "approval-digest" } };
			},
		},
		createDefinitionId: () => "definition-1",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return { handlers, tool: tools.get("workflow_define_product"), commands, runtime };
}

test("define-product exposes exact ticket actions and translates only exact artifact refs", async () => {
	const { tool } = registerTicketRuntime();
	const approvedSpecRef = ticketRef("approved-spec", "spec-digest");
	const parentRef = ticketRef("delivery-parent", "parent-digest");
	const graphRef = ticketRef("delivery-ticket-graph", "graph-digest");
	const toTicketsSchema = tool.parameters.oneOf.find(
		(schema) => schema.properties.action.const === "to_tickets",
	);
	const approveTicketsSchema = tool.parameters.oneOf.find(
		(schema) => schema.properties.action.const === "approve_tickets",
	);
	assert.deepEqual(Object.keys(toTicketsSchema.properties).sort(), [
		"action", "approvedSpecRef", "parentRef",
	]);
	assert.deepEqual(Object.keys(approveTicketsSchema.properties).sort(), [
		"action", "digest", "graphRef", "parentRef",
	]);
	assert.equal(toTicketsSchema.additionalProperties, false);
	assert.equal(approveTicketsSchema.additionalProperties, false);

	const inactive = await tool.execute("inactive", {
		action: "to_tickets", approvedSpecRef, parentRef,
	});
	assert.equal(inactive.details.blocker.code, "PI_WORKFLOW_TICKET_PARENT_STALE");

	const recovered = registerTicketRuntime({ definitionId: "definition-1", phase: "publication" });
	await recovered.handlers.get("session_start")({ type: "session_start" });
	await recovered.tool.execute("publish", { action: "publish_spec" });
	const graphGenerationPrompt = await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" });
	assert.match(graphGenerationPrompt.systemPrompt, /action="to_tickets"/);
	assert.equal(recovered.tool.parameters.oneOf.some((schema) => schema.properties.action.const === "to_tickets"), true);
	assert.equal(recovered.runtime.shouldContinue({ text: "generate tickets", source: "interactive" }), true);
	const malformed = await recovered.tool.execute("malformed", {
		action: "to_tickets", approvedSpecRef: { ...approvedSpecRef, schema: "delivery-parent" }, parentRef,
	});
	assert.equal(malformed.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
	const expanded = await recovered.tool.execute("expanded", {
		action: "to_tickets", approvedSpecRef: { ...approvedSpecRef, actor: "attacker" }, parentRef,
	});
	assert.equal(expanded.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
	const unrelated = await recovered.tool.execute("unrelated", {
		action: "to_tickets", approvedSpecRef, parentRef, graphRef,
	});
	assert.equal(unrelated.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
	const unknown = await recovered.tool.execute("unknown", {
		action: "to_tickets", approvedSpecRef, parentRef, extra: "attacker",
	});
	assert.equal(unknown.details.blocker.code, "PI_WORKFLOW_SPEC_ARTIFACT_INVALID");
	assert.equal(recovered.commands.length, 1);

	const ready = await recovered.tool.execute("tickets", {
		action: "to_tickets", approvedSpecRef, parentRef,
	});
	assert.equal(ready.details.status, "tickets-ready");
	assert.deepEqual(recovered.commands[1], {
		kind: "to-tickets", definitionId: "definition-1", approvedSpecRef, parentRef,
	});
	const approved = await recovered.tool.execute("approve", {
		action: "approve_tickets", parentRef, graphRef, digest: "graph-digest",
	});
	assert.equal(approved.details.status, "tickets-approved");
	assert.deepEqual(recovered.commands[2], {
		kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: "graph-digest",
	});
});

test("session start resumes ticket approval and clears terminal state", async () => {
	const recovered = registerTicketRuntime({ definitionId: "definition-1", phase: "ticket-approval" });
	const parentRef = ticketRef("delivery-parent", "parent-digest");
	const graphRef = ticketRef("delivery-ticket-graph", "graph-digest");
	await recovered.handlers.get("session_start")({ type: "session_start" });
	const prompt = await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" });
	assert.match(prompt.systemPrompt, /approve_tickets/);
	assert.equal(recovered.runtime.shouldContinue({ text: "approve", source: "interactive" }), true);
	const unrelated = await recovered.tool.execute("unrelated", {
		action: "approve_tickets", parentRef, graphRef, digest: "graph-digest", approvedSpecRef: ticketRef("approved-spec", "spec-digest"),
	});
	assert.equal(unrelated.details.blocker.code, "PI_WORKFLOW_TICKET_APPROVAL_MISMATCH");
	const unknown = await recovered.tool.execute("unknown", {
		action: "approve_tickets", parentRef, graphRef, digest: "graph-digest", extra: "attacker",
	});
	assert.equal(unknown.details.blocker.code, "PI_WORKFLOW_TICKET_APPROVAL_MISMATCH");
	assert.deepEqual(recovered.commands, []);

	const approved = await recovered.tool.execute("approve", {
		action: "approve_tickets", parentRef, graphRef, digest: "graph-digest",
	});
	assert.equal(approved.details.status, "tickets-approved");
	assert.deepEqual(recovered.commands, [{
		kind: "approve-tickets", definitionId: "definition-1", parentRef, graphRef, digest: "graph-digest",
	}]);
	assert.equal(recovered.runtime.shouldContinue({ text: "approve", source: "interactive" }), true);
	assert.match(
		(await recovered.handlers.get("before_agent_start")({ systemPrompt: "base" })).systemPrompt,
		/publish_tickets/,
	);
});

test("define-product publishes tickets from only the recovered definition and clears its terminal authorization", async () => {
	const handlers = new Map();
	const tools = new Map();
	const commands = [];
	const runtime = createDefineProductRuntime({
		workflow: {
			pendingRecommendation: () => undefined,
			reset() {},
			restoreRecovery: async () => ({
				definitionId: "definition-published",
				phase: "ticket-publication",
			}),
			advance: async (command) => {
				commands.push(command);
				return { status: "tickets-published", definitionId: command.definitionId };
			},
		},
		createDefinitionId: () => "unused",
	});
	runtime.register({
		on: (event, handler) => handlers.set(event, handler),
		registerTool: (tool) => tools.set(tool.name, tool),
	});

	await handlers.get("session_start")({ type: "session_start" });
	const tool = tools.get("workflow_define_product");
	const publishSchema = tool.parameters.oneOf.find(
		(schema) => schema.properties.action.const === "publish_tickets",
	);
	assert.deepEqual(Object.keys(publishSchema.properties), ["action", "definitionId"]);
	assert.equal(publishSchema.additionalProperties, false);

	const rejected = await tool.execute("rejected", {
		action: "publish_tickets",
		definitionId: "definition-published",
		approved: true,
	});
	assert.equal(rejected.details.blocker.code, "PI_WORKFLOW_TICKET_APPROVAL_MISMATCH");
	assert.deepEqual(commands, []);

	const published = await tool.execute("published", {
		action: "publish_tickets",
		definitionId: "definition-published",
	});
	assert.deepEqual(published.details, {
		status: "tickets-published",
		definitionId: "definition-published",
	});
	assert.deepEqual(commands, [{ kind: "publish-tickets", definitionId: "definition-published" }]);
	assert.equal(runtime.hasActiveTurn(), false);
	assert.equal(await handlers.get("before_agent_start")({ systemPrompt: "base" }), undefined);
});
