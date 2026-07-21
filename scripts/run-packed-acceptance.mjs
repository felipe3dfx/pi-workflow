#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAcceptanceEvidence } from "./acceptance-evidence.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url)).replace(
	/\/$/,
	"",
);
const digestIndex = process.argv.indexOf("--tarball-sha256");
const originIndex = process.argv.indexOf("--tarball-origin");
const tarballDigest =
	digestIndex === -1 ? undefined : process.argv[digestIndex + 1];
const origin = originIndex === -1 ? undefined : process.argv[originIndex + 1];

function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

function packedModule(relativePath) {
	const url = pathToFileURL(join(packageRoot, relativePath));
	invariant(
		fileURLToPath(url).startsWith(`${packageRoot}/`),
		`packed import escaped extracted package: ${relativePath}`,
	);
	return import(url.href);
}

function fakeArtifactStore() {
	const artifacts = new Map();
	return {
		artifacts,
		async read(id) {
			return structuredClone(artifacts.get(id));
		},
		async save(artifact) {
			const id = artifact.payload.issue.id;
			if (artifacts.has(id)) throw new Error("create-only artifact conflict");
			artifacts.set(id, structuredClone(artifact));
			return structuredClone(artifact);
		},
	};
}

function fakeSyncFilesystem(initial = {}) {
	const entries = new Map(Object.entries(initial));
	const writes = [];
	const mutations = [];
	let mutationActive = false;
	return {
		writes,
		mutations,
		set(path, content) {
			entries.set(path, content);
		},
		async readFile(path) {
			return entries.get(path);
		},
		async writeFileAtomic(path, content, expectedDigest) {
			const current = entries.get(path);
			const actual = current === undefined ? null : sha256(current);
			if (actual !== expectedDigest) throw new Error(`CAS mismatch at ${path}`);
			invariant(mutationActive, `write escaped mutation boundary: ${path}`);
			writes.push({ path, content, expectedDigest });
			entries.set(path, content);
		},
		async removeFileAtomic(path, expectedDigest) {
			const current = entries.get(path);
			const actual = current === undefined ? null : sha256(current);
			if (actual !== expectedDigest) throw new Error(`CAS mismatch at ${path}`);
			invariant(mutationActive, `remove escaped mutation boundary: ${path}`);
			writes.push({ path, content: undefined, expectedDigest });
			entries.delete(path);
		},
		async withMutation(operationId, run) {
			invariant(!mutationActive, "nested mutation boundary");
			mutations.push({ phase: "acquire", operationId });
			mutationActive = true;
			try {
				return await run();
			} finally {
				mutationActive = false;
				mutations.push({ phase: "release", operationId });
			}
		},
	};
}

async function publicExtensionHarness(overrides = {}) {
	const { default: piWorkflowExtension } = await packedModule(
		"extensions/pi-workflow.ts",
	);
	const handlers = new Map();
	const tools = new Map();
	const commands = new Map();
	const defaultDefineProduct = {
		advance: async () => ({ status: "blocked" }),
		pendingRecommendation: () => undefined,
		reset() {},
	};
	const defaultQaHandoff = {
		authorizeInvocation: async () => ({ status: "blocked" }),
		publish: async () => ({ status: "blocked" }),
	};
	const defaultProductReview = {
		prepare: async () => ({ status: "blocked" }),
		approve: async () => ({ status: "blocked" }),
		publish: async () => ({ status: "blocked" }),
	};
	piWorkflowExtension(
		{
			exec: async () => ({ code: 0, stdout: "", stderr: "" }),
			on(event, handler) {
				const registered = handlers.get(event) ?? [];
				registered.push(handler);
				handlers.set(event, registered);
			},
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: (name, command) => commands.set(name, command),
		},
		{
			defineProduct: {
				workflow: overrides.defineProduct ?? defaultDefineProduct,
				createDefinitionId: () => "packed-public-definition",
			},
			qaHandoff: { workflow: overrides.qaHandoff ?? defaultQaHandoff },
			productReview: {
				workflow: overrides.productReview ?? defaultProductReview,
			},
			...(overrides.diagnosticsWorkflow
				? { diagnosticsWorkflow: overrides.diagnosticsWorkflow }
				: {}),
		},
	);
	return {
		commands,
		tools,
		async emit(event, value, context) {
			let result;
			for (const handler of handlers.get(event) ?? []) {
				const candidate = await handler(value, context);
				if (candidate !== undefined) result = candidate;
			}
			return result;
		},
	};
}

function publicInputContext(notifications = []) {
	return {
		isIdle: () => true,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
		},
	};
}

async function traverseDefineProductPublicSeam() {
	const calls = [];
	let pending;
	const harness = await publicExtensionHarness({
		defineProduct: {
			async advance(command) {
				calls.push(structuredClone(command));
				pending = {
					definitionId: command.definitionId,
					recommendedRoute: "wayfinder",
					reasons: ["La definición requiere evidencia."],
					assessment: command.assessment,
					digest: "d".repeat(64),
					confirmationToken: "c".repeat(43),
				};
				return {
					status: "awaiting-confirmation",
					recommendation: structuredClone(pending),
				};
			},
			pendingRecommendation: () => structuredClone(pending),
			reset() {
				pending = undefined;
			},
		},
	});
	const context = publicInputContext();
	const admitted = await harness.emit(
		"input",
		{
			type: "input",
			text: "/define-product Preparar una release verificable",
			source: "interactive",
		},
		context,
	);
	invariant(admitted?.action === "continue", "define-product public entry failed");
	invariant(
		(await harness.emit(
			"tool_call",
			{ toolName: "workflow_define_product" },
			context,
		)) === undefined,
		"define-product public tool was not authorized",
	);
	const result = await harness.tools.get("workflow_define_product")?.execute(
		"packed-public-define-product",
		{
			action: "recommend_route",
			domainAnchor: "Preparar una release verificable",
			assessment: {
				clarity: "unclear",
				breadth: "broad",
				reasons: ["Requiere evidencia."],
			},
		},
	);
	invariant(
		result?.details?.status === "awaiting-confirmation" &&
			calls.length === 1 &&
			calls[0].kind === "recommend-route" &&
			calls[0].definitionId === "packed-public-definition",
		"define-product registered tool did not dispatch to its workflow",
	);
}

async function traverseDeliverTicketPublicSeam() {
	const notifications = [];
	const harness = await publicExtensionHarness();
	const context = publicInputContext(notifications);
	const admitted = await harness.emit(
		"input",
		{
			type: "input",
			text: "/deliver-ticket ILA-2325",
			source: "interactive",
		},
		context,
	);
	const blocked = await harness.emit(
		"tool_call",
		{ toolName: "linear_save_issue" },
		context,
	);
	invariant(
		admitted?.action === "continue" &&
			blocked?.block === true &&
			blocked.reason ===
				"PI_WORKFLOW_CAPABILITY_PENDING: tools are disabled for pending public workflow capabilities" &&
			notifications.length === 0,
		"deliver-ticket public pending boundary failed",
	);
}

async function traverseQaHandoffPublicSeam() {
	const calls = [];
	const harness = await publicExtensionHarness({
		qaHandoff: {
			async authorizeInvocation(issueId) {
				calls.push({ operation: "authorizeInvocation", issueId });
				return { status: "authorized" };
			},
			async publish(input) {
				calls.push({ operation: "publish", input: structuredClone(input) });
				return { status: "published", comment: { id: "public-qa-comment" } };
			},
		},
	});
	const context = publicInputContext();
	const admitted = await harness.emit(
		"input",
		{
			type: "input",
			text: "/qa-handoff ILA-2321",
			source: "interactive",
		},
		context,
	);
	invariant(admitted?.action === "continue", "QA handoff public entry failed");
	invariant(
		(await harness.emit(
			"tool_call",
			{ toolName: "workflow_qa_handoff" },
			context,
		)) === undefined,
		"QA handoff public tool was not authorized",
	);
	const result = await harness.tools.get("workflow_qa_handoff")?.execute(
		"packed-public-qa",
		{ issueId: "ILA-2321" },
	);
	invariant(
		JSON.parse(result?.content?.[0]?.text ?? "null").status === "published" &&
			isDeepStrictEqual(calls, [
				{ operation: "authorizeInvocation", issueId: "ILA-2321" },
				{ operation: "publish", input: { issueId: "ILA-2321" } },
			]),
		"QA handoff registered tool did not dispatch to its workflow",
	);
}

async function traverseProductReviewPublicSeam() {
	const calls = [];
	const acceptedDigest = "a".repeat(64);
	const harness = await publicExtensionHarness({
		productReview: {
			async prepare(issueId) {
				calls.push({ operation: "prepare", issueId });
				return {
					status: "prepared",
					recommendation: "Aceptado",
					choices: {
						Aceptado: { digest: acceptedDigest },
						"Cambios requeridos": { digest: "b".repeat(64) },
					},
				};
			},
			async approve(input) {
				calls.push({ operation: "approve", input: structuredClone(input) });
				return { status: "approved" };
			},
			async publish(input) {
				calls.push({ operation: "publish", input: structuredClone(input) });
				return {
					status: "published",
					comment: { id: "public-product-comment" },
				};
			},
		},
	});
	const context = publicInputContext();
	const admitted = await harness.emit(
		"input",
		{
			type: "input",
			text: "/product-review ILA-2324",
			source: "interactive",
		},
		context,
	);
	invariant(admitted?.action === "continue", "Product review public entry failed");
	await harness.emit("agent_settled", { type: "agent_settled" }, context);
	const selection = await harness.emit(
		"input",
		{
			type: "input",
			text: `ILA-2324 Aceptado ${acceptedDigest}`,
			source: "interactive",
		},
		context,
	);
	invariant(
		selection?.action === "continue" &&
			(await harness.emit(
				"tool_call",
				{ toolName: "workflow_product_review" },
				context,
			)) === undefined,
		"Product review Owner selection was not authorized",
	);
	const result = await harness.tools.get("workflow_product_review")?.execute(
		"packed-public-product-review",
		{ issueId: "ILA-2324", result: "Aceptado", digest: acceptedDigest },
	);
	invariant(
		JSON.parse(result?.content?.[0]?.text ?? "null").status === "published" &&
			isDeepStrictEqual(calls, [
				{ operation: "prepare", issueId: "ILA-2324" },
				{
					operation: "approve",
					input: {
						issueId: "ILA-2324",
						result: "Aceptado",
						digest: acceptedDigest,
					},
				},
				{ operation: "publish", input: { issueId: "ILA-2324" } },
			]),
		"Product review registered tool did not dispatch to its workflow",
	);
}

async function traverseDiagnosticCommandSeams() {
	const calls = [];
	const harness = await publicExtensionHarness({
		diagnosticsWorkflow: {
			strictCompatibility: true,
			adapter: {
				async check(request) {
					calls.push(structuredClone(request));
					return {
						id: request.id,
						status: "pass",
						evidence: { observed: true },
						remediation: "No se requiere ninguna acción.",
					};
				},
			},
		},
	});
	const notifications = [];
	const context = publicInputContext(notifications);
	await harness.commands
		.get("pi-workflow-status")
		?.handler("delivery ILA-2319", context);
	await harness.commands
		.get("pi-workflow-doctor")
		?.handler("product-review ILA-2324", context);
	const status = JSON.parse(notifications[0]?.message ?? "null");
	const doctor = JSON.parse(notifications[1]?.message ?? "null");
	invariant(
		notifications.length === 2 &&
			status.scope === "delivery:ILA-2319" &&
			status.checks.every((check) => !("evidence" in check)) &&
			doctor.scope === "product-review:ILA-2324" &&
			doctor.checks.every((check) => "evidence" in check) &&
			calls.length === 16 &&
			calls.every(({ mode }) => mode === "read-only"),
		"registered status/doctor command handlers did not dispatch safely",
	);
}

async function runPackedSkillScenario() {
	const names = [
		"define-product",
		"deliver-ticket",
		"product-review",
		"qa-handoff",
	];
	const skills = await Promise.all(
		names.map((name) =>
			readFile(join(packageRoot, "skills", name, "SKILL.md"), "utf8"),
		),
	);
	for (const [index, source] of skills.entries()) {
		invariant(
			source.startsWith(`---\nname: ${names[index]}\n`),
			`packed skill ${names[index]} is invalid`,
		);
	}
	const [qaGolden, productGolden] = await Promise.all([
		readFile(
			join(packageRoot, "assets", "acceptance", "qa-handoff.golden.md"),
			"utf8",
		),
		readFile(
			join(packageRoot, "assets", "acceptance", "product-review.golden.md"),
			"utf8",
		),
	]);
	invariant(
		qaGolden.includes("# Entrega para QA — ILA-2321") &&
			productGolden.includes("# Revisión de producto — ILA-2324"),
		"canonical Spanish goldens are unavailable",
	);
	invariant(
		skills[1].includes("code: PI_WORKFLOW_CAPABILITY_PENDING") &&
			skills[2].includes("professional-neutral Spanish contract") &&
			skills[3].includes("professional neutral Spanish"),
		"packed skill contracts drifted",
	);
	return {
		status: "passed",
		assertions: [
			"four-public-skills-loaded",
			"canonical-spanish-goldens-loaded",
		],
	};
}

async function runDefineProductScenario() {
	const [{ createDefineProductWorkflow }, { createEngramApprovedSpecReader }] =
		await Promise.all([
			packedModule("extensions/define-product-workflow.ts"),
			packedModule("extensions/engram-approved-spec-reader.ts"),
		]);
	const owner = {
		actorId: "owner-acceptance",
		role: "Owner",
		authorityRevision: "owner-policy-r1",
	};
	const target = {
		kind: "linear-parent-description",
		teamId: "team-acceptance",
		title: "Validar la aceptación empaquetada",
	};
	const researchRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/define-product/acceptance/research/request-1",
		revision: "research-r1",
		schema: "research-evidence",
		schemaVersion: 1,
		digest: "research-digest",
	};
	const prototypeRef = {
		kind: "engram",
		project: "pi-workflow",
		topic: "workflow/define-product/acceptance/prototype/request-2",
		revision: "prototype-r1",
		schema: "design-exploration",
		schemaVersion: 1,
		digest: "prototype-digest",
	};
	const engramEntries = new Map();
	const engramRevisions = new Map();
	const writes = [];
	const approvedSpecStore = createEngramApprovedSpecReader({
		project: "pi-workflow",
		store: {
			async readCurrent(project, topic) {
				return structuredClone(engramEntries.get(`${project}\0${topic}`));
			},
			async write(project, topic, content, expectedRevision) {
				const key = `${project}\0${topic}`;
				const current = engramEntries.get(key);
				invariant(
					current?.revision === expectedRevision ||
						(current === undefined && expectedRevision === undefined),
					"Engram CAS predecessor mismatch",
				);
				const revision = `engram-r${writes.length + 1}`;
				writes.push({ project, topic, content, expectedRevision, revision });
				engramEntries.set(key, { revision, content });
				engramRevisions.set(`${key}\0${revision}`, content);
				return { revision };
			},
			async readRevision(project, topic, revision) {
				return engramRevisions.get(`${project}\0${topic}\0${revision}`);
			},
		},
	});
	let request = 0;
	const workflow = createDefineProductWorkflow({
		delegate: {
			async delegate(intent) {
				const artifact =
					intent.kind === "research" ? researchRef : prototypeRef;
				return {
					status: "completed",
					executiveSummary: "Evidencia verificada.",
					artifacts: [artifact],
					nextRecommended:
						intent.kind === "research"
							? { kind: "confirmed-route", route: "wayfinder" }
							: { kind: "compare-exploration", intent: intent.kind },
					risks: [],
					launchProvenance: {
						agentName: intent.kind === "research" ? "research" : "prototype",
						assetVersion: 1,
						assetDigest: "packed-asset-digest",
						capabilityProfile:
							intent.kind === "research"
								? "research-reader"
								: "isolated-prototype",
						provider: "openai-codex",
						model: "gpt-5.6-terra",
						effort: "medium",
						inheritContext: false,
						promptMode: "replace",
						skillRefs: [],
						standardRefs: [],
						allowedTools: ["read"],
						deniedCapabilities: ["linear"],
						artifactTopic: intent.targetTopic,
					},
				};
			},
		},
		createRequestId: () => `request-${++request}`,
		project: { name: "pi-workflow", root: "/acceptance/repo" },
		authenticatedAuthority: { current: async () => structuredClone(owner) },
		approvedSpecStore,
	});
	const recommendation = await workflow.advance({
		kind: "recommend-route",
		definitionId: "acceptance",
		domainAnchor: "Preparar una release verificable",
		assessment: {
			clarity: "unclear",
			breadth: "broad",
			reasons: ["requiere evidencia"],
		},
		workflowStateId: "acceptance-state",
	});
	invariant(
		recommendation.status === "awaiting-confirmation",
		"define-product did not prepare approval",
	);
	const research = await workflow.advance({
		kind: "confirm-route",
		recommendationRef: recommendation.recommendation.digest,
		confirmationToken: recommendation.recommendation.confirmationToken,
		confirmedRoute: "wayfinder",
		researchQuestion: "¿Qué evidencia requiere una release verificable?",
		workflowStateId: "acceptance-state",
	});
	invariant(
		research.status === "completed",
		"define-product route approval failed",
	);
	const exploration = await workflow.advance({
		kind: "request-exploration",
		definitionId: "acceptance",
		intent: "prototype",
		focus: "Comparar el recorrido de aceptación",
	});
	invariant(
		exploration.status === "completed",
		"define-product exploration failed",
	);
	const ready = await workflow.advance({
		kind: "to-spec",
		definitionId: "acceptance",
		target,
		revision: "spec-r1",
		problem: "La release puede publicarse sin evidencia exacta del tarball.",
		solution:
			"El flujo valida escenarios deterministas sobre el paquete extraído.",
		userStories: [
			"Como Owner, quiero aprobar el Spec exacto antes de preparar la release.",
		],
		decisions: [
			{
				id: "acceptance-evidence",
				status: "resolved",
				pertinent: true,
				text: "La evidencia queda vinculada al tarball exacto.",
			},
		],
		tests: ["Bloquear cualquier aprobación con digest o revisión divergente."],
		outOfScope: ["Publicar el paquete desde la aceptación."],
		supportArtifactAliases: ["research", "prototype"],
	});
	invariant(
		ready.status === "spec-ready",
		"define-product Spec was not generated",
	);
	invariant(
		ready.spec.payload.language === "es",
		"define-product Spec language drifted",
	);
	const refused = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: "spec-r1",
		digest: "0".repeat(64),
	});
	invariant(
		refused.status === "blocked" &&
			refused.blocker.code === "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH" &&
			writes.length === 0,
		"define-product accepted a mismatched approval",
	);
	const approved = await workflow.advance({
		kind: "approve-spec",
		target,
		revision: "spec-r1",
		digest: ready.spec.digest,
	});
	invariant(
		approved.status === "spec-approved",
		"define-product exact Owner approval failed",
	);
	invariant(
		approved.approval.payload.actor.actorId === owner.actorId &&
			approved.approval.payload.specDigest === ready.spec.digest,
		"define-product approval was not bound to exact Owner and Spec",
	);
	const persisted = await approvedSpecStore.read("acceptance");
	invariant(
		persisted.sourceRevision === "engram-r1" && writes.length === 1,
		"define-product approval did not persist with create-only CAS",
	);
	await approvedSpecStore.save("acceptance", {
		spec: approved.spec,
		approval: approved.approval,
	});
	invariant(
		writes.length === 1,
		"exact approved Spec retry was not idempotent",
	);
	let conflictCode;
	try {
		await approvedSpecStore.save("acceptance", {
			spec: approved.spec,
			approval: {
				...approved.approval,
				payload: {
					...approved.approval.payload,
					actor: { ...owner, authorityRevision: "owner-policy-r2" },
				},
			},
		});
	} catch (error) {
		conflictCode = error.code;
	}
	invariant(
		conflictCode === "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH" &&
			writes.length === 1,
		"Engram create-only approval conflict was not refused",
	);
	await traverseDefineProductPublicSeam();
	return {
		status: "passed",
		assertions: [
			"owner-approval-bound-to-exact-spec",
			"approval-mismatch-refused-before-persistence",
			"engram-create-only-cas-and-readback",
			"public-extension-input-and-tool-dispatch",
		],
	};
}

async function runDeliverTicketScenario() {
	const { registerPublicEntryGuard } = await packedModule(
		"extensions/public-entry-guard.ts",
	);
	const handlers = new Map();
	const notifications = [];
	registerPublicEntryGuard(
		{ on: (event, handler) => handlers.set(event, handler) },
		{ "deliver-ticket": { status: "pending" } },
	);
	const context = {
		isIdle: () => true,
		ui: { notify: (message, level) => notifications.push({ message, level }) },
	};
	const input = await handlers.get("input")(
		{ type: "input", text: "/deliver-ticket ILA-2325", source: "interactive" },
		context,
	);
	invariant(input.action === "continue", "deliver-ticket was not admitted");
	const tool = await handlers.get("tool_call")(
		{ toolName: "linear_save_issue" },
		context,
	);
	invariant(tool?.block === true, "pending deliver-ticket allowed a tool");
	const skill = await readFile(
		join(packageRoot, "skills", "deliver-ticket", "SKILL.md"),
		"utf8",
	);
	const exactRefusal =
		"status: blocked\ncode: PI_WORKFLOW_CAPABILITY_PENDING\ncapability: deliver-ticket\nmutation: none";
	invariant(skill.includes(exactRefusal), "deliver-ticket refusal drifted");
	invariant(
		notifications.length === 0,
		"interactive refusal used a live adapter",
	);
	await traverseDeliverTicketPublicSeam();
	return {
		status: "intentional-refusal",
		code: "PI_WORKFLOW_CAPABILITY_PENDING",
		assertions: [
			"pending-refusal-exact",
			"tools-blocked",
			"public-extension-pending-tool-block",
		],
	};
}

const qaDeveloper = {
	actorId: "developer-7",
	role: "Developer",
	authorityRevision: "developer-auth-r3",
};
const qaDraft = {
	outcome: {
		status: "ready-for-qa",
		summary:
			"La publicación de QA handoff queda disponible con validación determinista.",
	},
	pullRequest: {
		ref: "pr:42",
		label: "PR #42",
		url: "https://github.com/example/pi-workflow/pull/42",
	},
	build: {
		ref: "build:qa-184",
		label: "Build qa-184",
		url: "https://ci.example.test/builds/qa-184",
	},
	qaEnvironment: {
		name: "QA",
		url: "https://qa.example.test",
		revision: "release-2026.07.21",
	},
	acceptanceCriteria: [
		{
			id: "AC-1",
			description: "Publica un comentario localizado sin modificar el issue.",
			evidence: [
				{
					ref: "test:qa-handoff:happy-path",
					label: "Prueba de publicación",
					url: "https://ci.example.test/tests/qa-handoff",
				},
			],
		},
		{
			id: "AC-2",
			description: "La repetición del mismo handoff es idempotente.",
			evidence: [
				{ ref: "test:qa-handoff:idempotency", label: "Prueba de idempotencia" },
			],
		},
	],
	testGuidance: [
		"Verificar el comentario completo contra los criterios de aceptación.",
		"Repetir la invocación y confirmar que no se crea otro comentario.",
	],
	risksAndConstraints: [
		"El cambio de estado y la asignación a QA permanecen como acciones manuales.",
	],
	outOfScope: ["Promoción automática entre entornos."],
};
const qaIssue = {
	id: "ILA-2321",
	identifier: "ILA-2321",
	title: "Publicar QA handoff determinista",
	description: "Descripción autoritativa",
	updatedAt: "issue-r7",
	state: { id: "state-1", name: "In Code Review", type: "started" },
	assignee: { id: "developer-7", name: "Developer" },
	cycle: { id: "cycle-5", number: 5 },
	labels: [{ id: "label-1", name: "Assign To / Developer" }],
	estimate: 5,
	relations: {
		blockedBy: [{ id: "ILA-2300" }],
		blocks: [{ id: "ILA-2400" }],
		relatedTo: [{ id: "ILA-2200" }],
	},
	parent: { id: "ILA-2296" },
};

async function runQaHandoffScenario() {
	const { createQaHandoffWorkflow } = await packedModule(
		"extensions/qa-handoff-workflow.ts",
	);
	const expectedBody = await readFile(
		join(packageRoot, "assets", "acceptance", "qa-handoff.golden.md"),
		"utf8",
	);
	const artifacts = fakeArtifactStore();
	const comments = [];
	const calls = [];
	let developer = structuredClone(qaDeveloper);
	const currentIssue = structuredClone(qaIssue);
	const gateway = {
		async getIssue({ id }) {
			calls.push({ operation: "getIssue", id });
			return id === currentIssue.id ? structuredClone(currentIssue) : undefined;
		},
		async listComments({ issueId, cursor }) {
			calls.push({ operation: "listComments", issueId, cursor });
			return { comments: structuredClone(comments) };
		},
		async createComment({ issueId, body }) {
			calls.push({ operation: "createComment", issueId, body });
			const comment = { id: "qa-comment-1", body };
			comments.push(comment);
			return structuredClone(comment);
		},
	};
	const workflow = createQaHandoffWorkflow({
		gateway,
		artifacts,
		drafts: {
			read: async (id) =>
				id === qaIssue.id ? structuredClone(qaDraft) : undefined,
		},
		currentDeveloper: async () => structuredClone(developer),
	});
	const issueBefore = structuredClone(currentIssue);
	const authorization = await workflow.authorizeInvocation(qaIssue.id);
	invariant(
		authorization.status === "authorized",
		"QA handoff authorization failed",
	);
	const first = await workflow.publish({ issueId: qaIssue.id });
	invariant(first.status === "published", "QA handoff publication failed");
	invariant(
		first.artifact.language === "es" && first.artifact.body === expectedBody,
		"QA handoff did not publish the packed Spanish golden",
	);
	invariant(
		first.comment.body === expectedBody &&
			isDeepStrictEqual(currentIssue, issueBefore),
		"QA handoff read-back changed the issue snapshot",
	);
	const second = await workflow.publish({ issueId: qaIssue.id });
	invariant(
		second.status === "published" &&
			second.comment.id === first.comment.id &&
			calls.filter(({ operation }) => operation === "createComment").length ===
				1,
		"QA handoff exact retry was not idempotent",
	);
	const callerOverride = await workflow.publish({
		issueId: qaIssue.id,
		body: "Contenido no autorizado",
	});
	invariant(
		callerOverride.status === "blocked" &&
			callerOverride.blocker.code === "PI_WORKFLOW_QA_HANDOFF_INPUT_INVALID",
		"QA handoff accepted caller-provided publication data",
	);
	developer = { ...qaDeveloper, authorityRevision: "developer-auth-r4" };
	const stale = await workflow.publish({ issueId: qaIssue.id });
	invariant(
		stale.status === "blocked" &&
			stale.blocker.code === "PI_WORKFLOW_QA_HANDOFF_AUTHORITY_MISMATCH" &&
			calls.filter(({ operation }) => operation === "createComment").length ===
				1,
		"QA handoff stale authority was not refused before mutation",
	);
	await traverseQaHandoffPublicSeam();
	return {
		status: "passed",
		assertions: [
			"spanish-golden-published",
			"linear-comment-readback-without-issue-mutation",
			"exact-repeat-idempotent",
			"caller-fields-and-stale-authority-refused",
			"public-extension-input-and-tool-dispatch",
		],
	};
}

const productOwner = {
	actorId: "owner-1",
	role: "Owner",
	authorityRevision: "owner-r1",
};
const productDraft = {
	scope: "Revisar la publicación del resultado de producto.",
	stories: [
		{
			id: "US-1",
			description: "Como Owner, quiero decidir el resultado.",
			acceptanceCriteria: [
				{
					id: "AC-1",
					description: "La decisión queda vinculada.",
					result: "cumple",
					evidence: ["test:product-review"],
				},
			],
		},
	],
	evidence: [
		{ ref: "test:product-review", description: "Pruebas automatizadas" },
	],
	findings: ["La implementación satisface el alcance."],
	requiredChanges: [],
	parentImpact: "Sin impacto adverso en el parent.",
	siblingImpact: [],
	recommendation: "Aceptado",
};
const productIssue = {
	id: "ILA-2324",
	identifier: "ILA-2324",
	title: "Product review",
	description: "Autoritativa",
	updatedAt: "issue-r1",
	state: { id: "started" },
	assignee: { id: "owner-1" },
	cycle: { id: "c1" },
	labels: ["Product"],
	estimate: 5,
	relations: { blockedBy: [], blocks: [], relatedTo: [] },
	parent: { id: "ILA-2296" },
};

async function runProductReviewScenario() {
	const { createProductReviewWorkflow } = await packedModule(
		"extensions/product-review-workflow.ts",
	);
	const expectedBody = await readFile(
		join(packageRoot, "assets", "acceptance", "product-review.golden.md"),
		"utf8",
	);
	let owner = structuredClone(productOwner);
	let artifact;
	const comments = [];
	const calls = [];
	const currentIssue = structuredClone(productIssue);
	const workflow = createProductReviewWorkflow({
		gateway: {
			async getIssue({ id }) {
				calls.push({ operation: "getIssue", id });
				return id === currentIssue.id
					? structuredClone(currentIssue)
					: undefined;
			},
			async listComments({ issueId }) {
				calls.push({ operation: "listComments", issueId });
				return { comments: structuredClone(comments) };
			},
			async createComment({ issueId, body }) {
				calls.push({ operation: "createComment", issueId, body });
				const comment = { id: "product-comment-1", body };
				comments.push(comment);
				return structuredClone(comment);
			},
		},
		drafts: {
			read: async (id) =>
				id === productIssue.id ? structuredClone(productDraft) : undefined,
		},
		artifacts: {
			read: async () => structuredClone(artifact),
			save: async (value) => {
				artifact = structuredClone(value);
				return structuredClone(value);
			},
		},
		currentOwner: async () => structuredClone(owner),
	});
	const issueBefore = structuredClone(currentIssue);
	const prepared = await workflow.prepare(productIssue.id);
	invariant(
		prepared.status === "prepared",
		"Product review preparation failed",
	);
	const refused = await workflow.approve({
		issueId: productIssue.id,
		result: "Aceptado",
		digest: "0".repeat(64),
	});
	invariant(
		refused.status === "blocked" &&
			refused.blocker.code === "PI_WORKFLOW_PRODUCT_REVIEW_DIGEST_MISMATCH" &&
			!calls.some(({ operation }) => operation === "createComment"),
		"Product review accepted an unprepared digest",
	);
	const choice = prepared.choices.Aceptado;
	const approval = await workflow.approve({
		issueId: productIssue.id,
		result: "Aceptado",
		digest: choice.digest,
	});
	invariant(
		approval.status === "approved",
		"Product review Owner approval failed",
	);
	const first = await workflow.publish({ issueId: productIssue.id });
	invariant(first.status === "published", "Product review publication failed");
	invariant(
		first.artifact.language === "es" && first.comment.body === expectedBody,
		"Product review did not publish the packed Spanish golden",
	);
	invariant(
		isDeepStrictEqual(currentIssue, issueBefore),
		"Product review mutated the issue snapshot",
	);
	const second = await workflow.publish({ issueId: productIssue.id });
	invariant(
		second.status === "published" &&
			second.comment.id === first.comment.id &&
			calls.filter(({ operation }) => operation === "createComment").length ===
				1,
		"Product review exact retry was not idempotent",
	);
	owner = { ...productOwner, authorityRevision: "owner-r2" };
	const stale = await workflow.publish({ issueId: productIssue.id });
	invariant(
		stale.status === "blocked" &&
			stale.blocker.code === "PI_WORKFLOW_PRODUCT_REVIEW_AUTHORITY_MISMATCH" &&
			calls.filter(({ operation }) => operation === "createComment").length ===
				1,
		"Product review stale Owner authority was not refused",
	);
	await traverseProductReviewPublicSeam();
	return {
		status: "passed",
		assertions: [
			"owner-choice-bound-to-spanish-golden",
			"linear-comment-readback-without-issue-mutation",
			"exact-repeat-idempotent",
			"digest-and-stale-authority-refused",
			"public-extension-selection-and-tool-dispatch",
		],
	};
}

async function runSyncScenario() {
	const { createAgentAssetSync } = await packedModule(
		"extensions/agent-asset-sync.ts",
	);
	const filesystem = fakeSyncFilesystem();
	const sync = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "acceptance-agent",
					version: 1,
					content: "---\nname: acceptance-agent\n---\n",
				},
			],
		},
		filesystem,
		agentDirectory: "/acceptance/agent/agents",
		manifestPath: "/acceptance/agent/.pi-workflow/agent-assets.json",
		operationDirectory: "/acceptance/agent/.pi-workflow/sync-operations",
		nonce: () => "acceptance-operation",
	});
	const plan = await sync.plan();
	invariant(
		plan.status === "ready" && plan.actions[0]?.kind === "create",
		"sync plan failed",
	);
	const applied = await sync.apply(plan, { confirm: async () => true });
	invariant(
		applied.status === "applied" &&
			applied.readiness === "ready" &&
			applied.operationId,
		"sync apply failed",
	);
	const targetWrite = filesystem.writes.find(
		({ path }) => path === "/acceptance/agent/agents/acceptance-agent.md",
	);
	const manifestWrite = filesystem.writes.find(
		({ path }) => path === "/acceptance/agent/.pi-workflow/agent-assets.json",
	);
	invariant(
		targetWrite?.expectedDigest === null &&
			manifestWrite?.expectedDigest === null,
		"sync writes were not conditional on approved predecessors",
	);
	const settled = await sync.plan();
	invariant(
		settled.status === "ready" &&
			settled.actions.length === 0 &&
			settled.digest !== plan.digest,
		"sync did not settle to an idempotent empty plan",
	);
	const rolledBack = await sync.rollback(applied.operationId);
	invariant(rolledBack.status === "applied", "sync rollback recovery failed");
	invariant(
		(await filesystem.readFile(
			"/acceptance/agent/agents/acceptance-agent.md",
		)) === undefined &&
			(await filesystem.readFile(
				"/acceptance/agent/.pi-workflow/agent-assets.json",
			)) === undefined,
		"sync rollback did not restore the verified predecessor",
	);
	const resumed = await sync.resume(applied.operationId);
	invariant(resumed.status === "applied", "sync resume recovery failed");
	invariant(
		(await filesystem.readFile(
			"/acceptance/agent/agents/acceptance-agent.md",
		)) === "---\nname: acceptance-agent\n---\n",
		"sync resume did not restore the verified successor",
	);
	invariant(
		filesystem.mutations.every(({ operationId }) =>
			/^[a-f0-9]{64}$/.test(operationId),
		),
		"sync mutation boundary was not digest-bound",
	);

	const collisionFilesystem = fakeSyncFilesystem({
		"/acceptance/collision/agents/acceptance-agent.md": "unmanaged content",
	});
	const collision = createAgentAssetSync({
		catalog: {
			schemaVersion: 1,
			assets: [
				{
					kind: "agent",
					name: "acceptance-agent",
					version: 1,
					content: "managed",
				},
			],
		},
		filesystem: collisionFilesystem,
		agentDirectory: "/acceptance/collision/agents",
		manifestPath: "/acceptance/collision/.pi-workflow/agent-assets.json",
	});
	const refused = await collision.plan();
	invariant(
		refused.status === "blocked" &&
			refused.actions[0]?.kind === "refusal" &&
			refused.actions[0]?.reason === "unmanaged-collision" &&
			collisionFilesystem.writes.length === 0 &&
			collisionFilesystem.mutations.length === 0,
		"sync unmanaged collision was not refused before mutation",
	);
	const { runSyncCommand } = await packedModule(
		"extensions/pi-workflow-sync.ts",
	);
	const commandOutput = [];
	const exitCode = await runSyncCommand(["plan"], {
		sync,
		write: (text) => commandOutput.push(text),
	});
	invariant(
		exitCode === 0 &&
			commandOutput.length === 1 &&
			JSON.parse(commandOutput[0]).status === "ready",
		"sync public CLI handler did not dispatch to the packed workflow",
	);
	return {
		status: "passed",
		assertions: [
			"conditional-writes-use-approved-predecessors",
			"settled-plan-is-idempotent",
			"verified-rollback-and-resume-recovery",
			"unmanaged-collision-refused-without-mutation",
			"public-cli-handler-dispatch",
		],
	};
}

async function runDiagnosticsScenarios() {
	const { createWorkflowDiagnostics } = await packedModule(
		"extensions/workflow-diagnostics.ts",
	);
	const statusCalls = [];
	const statusDiagnostics = createWorkflowDiagnostics({
		strictCompatibility: true,
		adapter: {
			async check(request) {
				statusCalls.push(structuredClone(request));
				return {
					id: request.id,
					status: "pass",
					evidence: { observed: true },
					remediation: "No se requiere ninguna acción.",
				};
			},
		},
	});
	const status = await statusDiagnostics.inspect({
		kind: "delivery",
		issueId: "ILA-2319",
	});
	invariant(status.readiness === "ready", "status readiness failed");
	invariant(
		statusCalls.length === 8 &&
			statusCalls.every(({ mode }) => mode === "read-only"),
		"status used a mutating diagnostic mode",
	);
	invariant(
		status.checks.every(
			(check) => !("evidence" in check) && !("remediation" in check),
		),
		"status exposed doctor evidence",
	);

	const doctorCalls = [];
	const doctorDiagnostics = createWorkflowDiagnostics({
		strictCompatibility: true,
		adapter: {
			async check(request) {
				doctorCalls.push(structuredClone(request));
				return request.id === "authentication"
					? {
							id: request.id,
							status: "fail",
							evidence: {
								provider: "openai-codex",
								token: "sk-acceptance-secret",
								header: "Bearer acceptance-secret",
							},
							remediation:
								"Autentique el proveedor configurado y vuelva a intentarlo.",
						}
					: {
							id: request.id,
							status: "pass",
							evidence: { observed: true },
							remediation: "No se requiere ninguna acción.",
						};
			},
		},
	});
	const doctor = await doctorDiagnostics.diagnose({ kind: "installation" });
	const authentication = doctor.checks.find(
		({ id }) => id === "authentication",
	);
	invariant(
		doctor.readiness === "blocked",
		"doctor did not report failed authentication",
	);
	invariant(
		doctorCalls.length === 8 &&
			doctorCalls.every(({ mode }) => mode === "read-only"),
		"doctor used a mutating diagnostic mode",
	);
	invariant(
		authentication?.evidence.token === "[REDACTED]" &&
			authentication?.evidence.header === "[REDACTED]",
		"doctor leaked secret evidence",
	);
	await traverseDiagnosticCommandSeams();
	return {
		status: {
			status: "passed",
			assertions: [
				"read-only-checks-only",
				"summary-excludes-evidence",
				"registered-command-handler-dispatch",
			],
		},
		doctor: {
			status: "passed",
			assertions: [
				"read-only-checks-only",
				"secret-evidence-redacted",
				"registered-command-handler-dispatch",
			],
		},
	};
}

function researchAsset(overrides = {}) {
	return {
		name: "research",
		version: 1,
		digest: "research-asset-digest",
		capabilityProfile: "research-reader",
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		effort: "medium",
		inheritContext: false,
		promptMode: "replace",
		allowedTools: [
			"read",
			"grep",
			"find",
			"ls",
			"web_search",
			"fetch_content",
			"get_search_content",
			"workflow_artifact_session",
		],
		extensions: [],
		skills: [],
		supportsScopedArtifacts: true,
		...overrides,
	};
}

async function runLeastPrivilegeScenario() {
	const { createAgentValidator } = await packedModule(
		"extensions/agent-validator.ts",
	);
	const registryQueries = [];
	const validator = createAgentValidator({
		readResearchAsset: () => researchAsset(),
		readExplorationAsset: () =>
			researchAsset({
				name: "prototype",
				digest: "prototype-asset-digest",
				capabilityProfile: "isolated-prototype",
				allowedTools: [
					"read",
					"grep",
					"find",
					"ls",
					"edit",
					"write",
					"bash",
					"workflow_artifact_session",
				],
			}),
		readTicketGraphAsset: () =>
			researchAsset({
				name: "to-tickets",
				digest: "tickets-asset-digest",
				capabilityProfile: "artifact-reader",
				allowedTools: [
					"read",
					"grep",
					"find",
					"ls",
					"workflow_artifact_session",
				],
			}),
		readModelAvailability: (provider, model, effort) => {
			registryQueries.push({ provider, model, effort });
			return { authenticated: true, supportsToolCalling: true, exact: true };
		},
	});
	const [research, prototype, tickets] = await Promise.all([
		validator.validateResearchLaunch({
			skillRefs: [],
			standardRefs: [],
			artifactTopic: "workflow/research",
		}),
		validator.validateExplorationLaunch({
			intent: "prototype",
			skillRefs: [],
			standardRefs: [],
			artifactTopic: "workflow/prototype",
		}),
		validator.validateTicketGraphLaunch({
			skillRefs: [],
			standardRefs: [],
			artifactTopic: "workflow/to-tickets",
		}),
	]);
	invariant(
		research.ok && prototype.ok && tickets.ok,
		"least-privilege profiles were rejected",
	);
	invariant(
		registryQueries.length === 3 &&
			registryQueries.every(
				(query) =>
					query.provider === "openai-codex" &&
					query.model === "gpt-5.6-terra" &&
					query.effort === "medium",
			),
		"model registry was not queried for the exact launch identity",
	);
	invariant(
		research.value.deniedCapabilities.includes("linear") &&
			prototype.value.deniedCapabilities.includes("linear") &&
			tickets.value.deniedCapabilities.includes("write"),
		"least-privilege denials drifted",
	);
	const forbidden = await createAgentValidator({
		readResearchAsset: () =>
			researchAsset({
				allowedTools: [...researchAsset().allowedTools, "linear"],
			}),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: true,
		}),
	}).validateResearchLaunch({
		skillRefs: [],
		standardRefs: [],
		artifactTopic: "workflow/research",
	});
	invariant(
		!forbidden.ok &&
			forbidden.blocker.code === "PI_WORKFLOW_CAPABILITY_PROFILE_MISMATCH",
		"forbidden model capability was accepted",
	);
	const unavailable = await createAgentValidator({
		readResearchAsset: () => researchAsset(),
		readModelAvailability: () => ({
			authenticated: true,
			supportsToolCalling: true,
			exact: false,
		}),
	}).validateResearchLaunch({
		skillRefs: [],
		standardRefs: [],
		artifactTopic: "workflow/research",
	});
	invariant(
		!unavailable.ok &&
			unavailable.blocker.code === "PI_WORKFLOW_EXACT_MODEL_UNAVAILABLE",
		"model registry drift was accepted",
	);
	return {
		status: "passed",
		assertions: [
			"exact-model-registry-queries",
			"research-prototype-and-ticket-profiles-minimized",
			"forbidden-capability-and-model-drift-refused",
		],
	};
}

invariant(
	/^[a-f0-9]{64}$/.test(tarballDigest ?? ""),
	"tarball SHA-256 is required",
);
invariant(
	origin === "created" || origin === "supplied",
	"tarball origin is invalid",
);

const [
	packedSkills,
	defineProduct,
	deliverTicket,
	qaHandoff,
	productReview,
	sync,
	diagnostics,
	leastPrivilege,
] = await Promise.all([
	runPackedSkillScenario(),
	runDefineProductScenario(),
	runDeliverTicketScenario(),
	runQaHandoffScenario(),
	runProductReviewScenario(),
	runSyncScenario(),
	runDiagnosticsScenarios(),
	runLeastPrivilegeScenario(),
]);

const report = createAcceptanceEvidence({
	tarball: { algorithm: "sha256", digest: tarballDigest, origin },
	scenarios: {
		"packed-skills": packedSkills,
		"define-product": defineProduct,
		"deliver-ticket": deliverTicket,
		"qa-handoff": qaHandoff,
		"product-review": productReview,
		sync,
		status: diagnostics.status,
		doctor: diagnostics.doctor,
		"least-privilege-profiles": leastPrivilege,
	},
	safety: {
		liveSystems: "none",
		publication: "not-attempted",
		filesystem: "temp-fixtures-only",
		importedModuleRoot: "extracted-package",
	},
});
process.stdout.write(`${JSON.stringify(report)}\n`);
