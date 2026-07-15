import assert from "node:assert/strict";
import test from "node:test";

import { createEngramApprovedSpecReader } from "../extensions/engram-approved-spec-reader.ts";
import { createRuntimeEngramApprovedSpecStore } from "../extensions/runtime-engram-store.ts";
import {
	createProductSpecApprovalEnvelope,
	createProductSpecEnvelope,
} from "../extensions/product-spec.ts";

function approvedArtifact() {
	const spec = createProductSpecEnvelope({
		definitionId: "definition-1",
		target: {
			kind: "linear-parent-description",
			teamId: "team-1",
			title: "Entrega",
		},
		revision: "spec-r1",
		problem: "Existe una necesidad de producto verificable.",
		solution: "Publicar una descripcion canonica y exacta.",
		userStories: ["Como Owner, quiero una publicacion exacta."],
		decisions: [
			{
				id: "canonical",
				status: "resolved",
				pertinent: true,
				text: "El parent conserva el Spec.",
			},
		],
		tests: ["Comprobar el contenido leido."],
		outOfScope: ["Crear subissues."],
		supportArtifacts: [],
	});
	return {
		spec,
		approval: createProductSpecApprovalEnvelope({
			spec,
			actor: {
				actorId: "owner-1",
				role: "Owner",
				authorityRevision: "authority-r1",
			},
		}),
	};
}

test("approved-Spec reader uses the definition topic and stored revision", async () => {
	const artifact = approvedArtifact();
	const calls = [];
	const reader = createEngramApprovedSpecReader({
		project: "pi-workflow",
		store: {
			readCurrent: async (project, topic) => {
				calls.push({ project, topic });
				return { revision: "engram-r9", content: JSON.stringify(artifact) };
			},
		},
	});

	assert.deepEqual(await reader.read("definition-1"), {
		...artifact,
		sourceRevision: "engram-r9",
	});
	assert.deepEqual(calls, [{
		project: "pi-workflow",
		topic: "workflow/define-product/definition-1/approved-spec",
	}]);
});

test("approved-Spec adapter persists once and verifies exact read-back", async () => {
	const artifact = approvedArtifact();
	let current;
	let writes = 0;
	const adapter = createEngramApprovedSpecReader({
		project: "pi-workflow",
		store: {
			readCurrent: async () => current,
			write: async (_project, _topic, content, expectedRevision) => {
				assert.equal(expectedRevision, undefined);
				writes += 1;
				current = { revision: "engram-r10", content };
				return { revision: current.revision };
			},
			readRevision: async (_project, _topic, revision) =>
				revision === current?.revision ? current.content : undefined,
		},
	});

	assert.deepEqual(await adapter.save("definition-1", artifact), {
		...artifact,
		sourceRevision: "engram-r10",
	});
	assert.deepEqual(await adapter.save("definition-1", artifact), {
		...artifact,
		sourceRevision: "engram-r10",
	});
	assert.equal(writes, 1);
});

test("approved-Spec adapter rejects changed content and failed read-back", async () => {
	const artifact = approvedArtifact();
	const mismatched = createEngramApprovedSpecReader({
		project: "pi-workflow",
		store: {
			readCurrent: async () => ({ revision: "r1", content: "{}" }),
			write: async () => ({ revision: "unused" }),
			readRevision: async () => undefined,
		},
	});
	await assert.rejects(
		() => mismatched.save("definition-1", artifact),
		(error) => error.code === "PI_WORKFLOW_SPEC_APPROVAL_MISMATCH",
	);

	const unreadable = createEngramApprovedSpecReader({
		project: "pi-workflow",
		store: {
			readCurrent: async () => undefined,
			write: async () => ({ revision: "r2" }),
			readRevision: async () => "corrupt",
		},
	});
	await assert.rejects(
		() => unreadable.save("definition-1", artifact),
		/read-back does not match/,
	);
});

test("runtime Engram store creates and reads immutable approved observations", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init = {}) => {
		requests.push({ url: String(url), init });
		if (init.method === "POST") {
			return Response.json({ observation: { id: 42 } });
		}
		if (String(url).endsWith("/observations/42")) {
			return Response.json({ content: "approved" });
		}
		return Response.json({ observations: [] });
	};
	try {
		const store = createRuntimeEngramApprovedSpecStore({
			url: "https://engram.test",
			sessionId: () => "session-1",
			directory: () => "/repo",
		});
		assert.equal(await store.readCurrent("pi-workflow", "approved/topic"), undefined);
		assert.deepEqual(
			await store.write("pi-workflow", "approved/topic", "approved"),
			{ revision: "42" },
		);
		assert.equal(
			await store.readRevision("pi-workflow", "approved/topic", "42"),
			"approved",
		);
		assert.deepEqual(JSON.parse(requests[1].init.body), {
			project: "pi-workflow",
			topic_key: "approved/topic",
			content: "approved",
			type: "architecture",
			session_id: "session-1",
			directory: "/repo",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});
