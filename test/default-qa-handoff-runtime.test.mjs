import assert from "node:assert/strict";
import test from "node:test";

import piWorkflowExtension from "../extensions/pi-workflow.ts";
import {
	canonicalJson,
	digestCanonicalValue,
} from "../extensions/workflow-contracts.ts";

const draft = {
	outcome: {
		status: "ready-for-qa",
		summary: "La entrega está lista para validación en QA.",
	},
	pullRequest: { ref: "pr:2321", label: "PR #2321" },
	build: { ref: "build:2321", label: "Build 2321" },
	qaEnvironment: { name: "QA", url: "https://qa.example.test" },
	acceptanceCriteria: [
		{
			id: "AC-1",
			description: "Publica el handoff canónico.",
			evidence: [{ ref: "test:2321", label: "Prueba automatizada" }],
		},
	],
	testGuidance: ["Validar el comentario publicado."],
	risksAndConstraints: [],
};

function extensionHarness() {
	const handlers = new Map();
	const tools = new Map();
	piWorkflowExtension({
		exec: async () => ({ code: 0 }),
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		on: (event, handler) => {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
	});
	return {
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

function restoreEnvironment(snapshot) {
	for (const [name, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

test("default extension composition publishes through configured Engram and narrow Linear dependencies", async () => {
	const environment = {
		PI_WORKFLOW_DEVELOPER_ACTOR_ID:
			process.env.PI_WORKFLOW_DEVELOPER_ACTOR_ID,
		PI_WORKFLOW_DEVELOPER_AUTHORITY_REVISION:
			process.env.PI_WORKFLOW_DEVELOPER_AUTHORITY_REVISION,
		LINEAR_API_KEY: process.env.LINEAR_API_KEY,
		LINEAR_API_URL: process.env.LINEAR_API_URL,
		ENGRAM_URL: process.env.ENGRAM_URL,
	};
	const originalFetch = globalThis.fetch;
	process.env.PI_WORKFLOW_DEVELOPER_ACTOR_ID = "developer-2321";
	process.env.PI_WORKFLOW_DEVELOPER_AUTHORITY_REVISION = "developer-policy-r1";
	process.env.LINEAR_API_KEY = "linear-key";
	process.env.LINEAR_API_URL = "https://linear.test/graphql";
	process.env.ENGRAM_URL = "https://engram.test";

	const observations = new Map();
	const unsignedDraft = {
		schema: "qa-handoff-draft",
		schemaVersion: 1,
		payload: {
			issue: { id: "ILA-2321" },
			draft,
		},
	};
	const draftObservation = {
		id: "draft-r1",
		project: "pi-workflow",
		topic_key: "workflow/qa-handoff-draft/ILA-2321",
		content: `${canonicalJson({
			...unsignedDraft,
			digest: digestCanonicalValue(unsignedDraft),
		})}\n`,
	};
	observations.set("pi-workflow:workflow/qa-handoff-draft/ILA-2321", draftObservation);
	observations.set("draft-r1", draftObservation);
	let observationRevision = 0;
	let publishedComment;
	const issue = {
		id: "linear-uuid-2321",
		identifier: "ILA-2321",
		title: "Publicar handoff de QA",
		description: "Descripción autoritativa",
		updatedAt: "issue-r1",
		estimate: 3,
		state: { id: "state-review", name: "In Review", type: "started" },
		assignee: { id: "developer-2321", name: "Developer" },
		cycle: { id: "cycle-1" },
		labels: { nodes: [{ name: "QA" }] },
		parent: { id: "parent-1" },
		relations: { nodes: [] },
	};

	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		if (url.hostname === "linear.test") {
			assert.equal(init.headers.Authorization, "linear-key");
			const request = JSON.parse(String(init.body));
			if (request.operationName === "QaHandoffIssueRead") {
				return Response.json({ data: { issue } });
			}
			if (request.operationName === "QaHandoffCommentsRead") {
				return Response.json({
					data: {
						issue: {
							comments: {
								nodes: publishedComment ? [publishedComment] : [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			if (request.operationName === "QaHandoffCommentCreate") {
				assert.equal(request.variables.input.issueId, issue.id);
				publishedComment = {
					id: "comment-2321",
					body: request.variables.input.body,
				};
				return Response.json({
					data: { commentCreate: { success: true, comment: publishedComment } },
				});
			}
			throw new Error(`Unexpected Linear operation: ${request.operationName}`);
		}
		if (url.hostname === "engram.test") {
			if (url.pathname === "/observations" && (init.method ?? "GET") === "GET") {
				const key = `${url.searchParams.get("project")}:${url.searchParams.get("topic_key")}`;
				const current = observations.get(key);
				return Response.json(current ? [current] : []);
			}
			if (url.pathname === "/observations" && init.method === "POST") {
				const body = JSON.parse(String(init.body));
				observationRevision += 1;
				const stored = { id: `artifact-r${observationRevision}`, ...body };
				observations.set(`${body.project}:${body.topic_key}`, stored);
				observations.set(stored.id, stored);
				return Response.json({ id: stored.id });
			}
			if (url.pathname.startsWith("/observations/")) {
				return Response.json(
					observations.get(decodeURIComponent(url.pathname.split("/").at(-1))),
				);
			}
		}
		throw new Error(`Unexpected request: ${url}`);
	};

	try {
		const harness = extensionHarness();
		const context = {
			isIdle: () => true,
			ui: { notify: () => {} },
		};
		assert.deepEqual(
			await harness.emit(
				"input",
				{ type: "input", text: "/qa-handoff ILA-2321", source: "interactive" },
				context,
			),
			{ action: "continue" },
		);
		const tool = harness.tools.get("workflow_qa_handoff");
		assert.ok(tool);
		assert.deepEqual(Object.keys(tool.parameters.properties), ["issueId"]);

		const result = await tool.execute("qa-default", { issueId: "ILA-2321" });
		const outcome = JSON.parse(result.content[0].text);

		assert.deepEqual(outcome, {
			status: "published",
			issueId: "ILA-2321",
			commentId: "comment-2321",
		});
		assert.match(publishedComment.body, /# Entrega para QA — ILA-2321/);
		assert.match(publishedComment.body, /Ninguno conocido\./);
		assert.match(publishedComment.body, /Referencia de flujo: qa-handoff:[a-f0-9]{64}/);
		assert.equal("body" in outcome, false);
		assert.equal("digest" in outcome, false);
		assert.equal("authority" in outcome, false);
		assert.ok(observations.has("pi-workflow:workflow/qa-handoff/ILA-2321"));
	} finally {
		globalThis.fetch = originalFetch;
		restoreEnvironment(environment);
	}
});
