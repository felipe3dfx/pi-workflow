import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowDiagnostics } from "../extensions/workflow-diagnostics.ts";
import piWorkflowExtension, { parseDiagnosticScope } from "../extensions/pi-workflow.ts";

const ready = (id, evidence = { observed: true }) => ({
	id,
	status: "pass",
	evidence,
	remediation: "No action required.",
});

function adapterWith(results, calls = []) {
	return {
		async check(request) {
			calls.push(request);
			return results[request.id] ?? ready(request.id);
		},
	};
}

test("status aggregates operation-specific required checks without exposing doctor detail", async () => {
	const calls = [];
	const diagnostics = createWorkflowDiagnostics({
		adapter: adapterWith({}, calls),
		strictCompatibility: true,
	});

	const report = await diagnostics.inspect({ kind: "delivery", issueId: "ILA-2319" });

	assert.equal(report.readiness, "ready");
	assert.equal(report.scope, "delivery:ILA-2319");
	assert.deepEqual(report.checks.map(({ id, status, required }) => ({ id, status, required })), [
		{ id: "provider-model-effort", status: "pass", required: true },
		{ id: "authentication", status: "pass", required: true },
		{ id: "capabilities", status: "pass", required: true },
		{ id: "permissions", status: "pass", required: true },
		{ id: "agent-assets", status: "pass", required: true },
		{ id: "schemas", status: "pass", required: true },
		{ id: "project-over-global-override", status: "pass", required: true },
		{ id: "delivery-ticket", status: "pass", required: true },
	]);
	assert.equal("evidence" in report.checks[0], false);
	assert.equal("remediation" in report.checks[0], false);
	assert.equal(calls.every((call) => call.mode === "read-only"), true);
});

test("doctor reports safe evidence and actionable remediation while redacting secrets", async () => {
	const diagnostics = createWorkflowDiagnostics({
		adapter: adapterWith({
			authentication: {
				id: "authentication",
				status: "fail",
				evidence: {
					provider: "openai-codex",
					token: "sk-sensitive",
					header: "Bearer abc123",
					nested: { password: "hidden" },
				},
				remediation: "Authenticate the exact configured provider and retry.",
			},
		}),
		strictCompatibility: true,
	});

	const report = await diagnostics.diagnose({ kind: "installation" });

	assert.equal(report.readiness, "blocked");
	const auth = report.checks.find((check) => check.id === "authentication");
	assert.deepEqual(auth.evidence, {
		provider: "openai-codex",
		token: "[REDACTED]",
		header: "[REDACTED]",
		nested: { password: "[REDACTED]" },
	});
	assert.match(auth.remediation, /Authenticate the exact configured provider/);
});

test("strict compatibility blocks required unknown results", async () => {
	const diagnostics = createWorkflowDiagnostics({
		adapter: adapterWith({
			capabilities: {
				id: "capabilities",
				status: "unknown",
				evidence: { reason: "registry unavailable" },
				remediation: "Restore registry access and retry.",
			},
		}),
		strictCompatibility: true,
	});

	const report = await diagnostics.diagnose({ kind: "product", teamId: "team-1" });

	assert.equal(report.readiness, "blocked");
	assert.equal(report.checks.find((check) => check.id === "capabilities").status, "unknown");
});

test("non-strict required unknown degrades readiness", async () => {
	const diagnostics = createWorkflowDiagnostics({
		adapter: adapterWith({
			"provider-model-effort": {
				id: "provider-model-effort",
				status: "unknown",
				evidence: {},
				remediation: "Inspect model registry.",
			},
		}),
		strictCompatibility: false,
	});

	const report = await diagnostics.inspect({ kind: "product-review", issueId: "ILA-2324" });
	assert.equal(report.readiness, "degraded");
});

test("malformed adapter results fail closed under strict compatibility", async () => {
	const diagnostics = createWorkflowDiagnostics({
		adapter: adapterWith({
			permissions: {
				id: "permissions",
				status: "invented",
				evidence: { observed: true },
				remediation: "",
			},
		}),
		strictCompatibility: true,
	});

	const report = await diagnostics.diagnose({ kind: "installation" });
	assert.equal(report.readiness, "blocked");
	assert.equal(report.checks.find((check) => check.id === "permissions").status, "unknown");
});

test("diagnostic command scopes are parsed exactly", () => {
	assert.deepEqual(parseDiagnosticScope("installation"), { kind: "installation" });
	assert.deepEqual(parseDiagnosticScope("product team-1"), { kind: "product", teamId: "team-1" });
	assert.deepEqual(parseDiagnosticScope("delivery ILA-2319"), { kind: "delivery", issueId: "ILA-2319" });
	assert.equal(parseDiagnosticScope("delivery ila-2319"), undefined);
	assert.equal(parseDiagnosticScope("product"), undefined);
});

test("status and doctor commands expose diagnostics through the Pi adapter", async () => {
	const commands = new Map();
	const notifications = [];
	const pi = {
		on: () => {},
		exec: async () => ({ code: 0 }),
		registerCommand: (name, definition) => commands.set(name, definition),
	};
	piWorkflowExtension(pi, {
		diagnosticsWorkflow: { adapter: adapterWith({}), strictCompatibility: true },
	});
	const ctx = { ui: { notify: (message, level) => notifications.push({ message, level }) } };

	await commands.get("pi-workflow-status").handler("delivery ILA-2319", ctx);
	await commands.get("pi-workflow-doctor").handler("qa-handoff ILA-2321", ctx);

	assert.equal(JSON.parse(notifications[0].message).scope, "delivery:ILA-2319");
	assert.equal("evidence" in JSON.parse(notifications[0].message).checks[0], false);
	assert.equal(JSON.parse(notifications[1].message).scope, "qa-handoff:ILA-2321");
	assert.equal("evidence" in JSON.parse(notifications[1].message).checks[0], true);
	assert.deepEqual(notifications.map(({ level }) => level), ["info", "info"]);
});

test("diagnostics only invoke the read-only adapter and cover each operation scope", async () => {
	const calls = [];
	const adapter = adapterWith({}, calls);
	adapter.install = () => assert.fail("must not install");
	adapter.authenticate = () => assert.fail("must not authenticate");
	adapter.sync = () => assert.fail("must not sync");
	adapter.migrate = () => assert.fail("must not migrate");
	adapter.initialize = () => assert.fail("must not initialize");
	adapter.edit = () => assert.fail("must not edit");
	adapter.publish = () => assert.fail("must not publish");
	adapter.changeWorkflow = () => assert.fail("must not change workflow");
	const diagnostics = createWorkflowDiagnostics({ adapter, strictCompatibility: true });

	for (const scope of [
		{ kind: "installation" },
		{ kind: "product", teamId: "team-1" },
		{ kind: "delivery", issueId: "ILA-2319" },
		{ kind: "qa-handoff", issueId: "ILA-2321" },
		{ kind: "product-review", issueId: "ILA-2324" },
	]) {
		assert.equal((await diagnostics.diagnose(scope)).readiness, "ready");
	}

	assert.ok(calls.some((call) => call.id === "installation"));
	assert.ok(calls.some((call) => call.id === "product-publication"));
	assert.ok(calls.some((call) => call.id === "delivery-ticket"));
	assert.ok(calls.some((call) => call.id === "qa-handoff-issue"));
	assert.ok(calls.some((call) => call.id === "product-review-issue"));
});
