import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import piWorkflowExtension from "../extensions/pi-workflow.ts";
import { replaceSelection } from "../extensions/shell.ts";
import { fakeChildren } from "./support/fake-children.mjs";

// #277 AC2/3/5: requirements and independent expected decisions are documented in
// docs/testing/parent-obligations-evaluation.md. Parent decisions are NEVER scripted.
const live = process.env.PI_WORKFLOW_PARENT_LIVE === "1";
const root = fileURLToPath(new URL("..", import.meta.url));
const head = "87adf30775810e744523646cf53875876079cbcc";
const base = process.env.PI_WORKFLOW_PARENT_BASE ?? "66eb1832910dbe902d98e889cf2d64e2b49809cf";
const provider = process.env.PI_WORKFLOW_PARENT_PROVIDER ?? "openai-codex";
const modelId = process.env.PI_WORKFLOW_PARENT_MODEL ?? "gpt-6-astra";
const thinking = "medium";
const selection = { schemaVersion: 1, capabilities: { "child-session": true, todo: false, "operator-questions": false, "model-profiles": false, codegraph: false, "compact-rendering": false }, expectations: { "gentle-engram": false, "@gtrabanco/pi-nan-provider": false, "pi-web-access": false, "pi-claude-bridge": false } };
const obligations = ["isolation", "scope", "correctness", "standards/design", "CI"];
const skill = `---
name: fixture-review
description: Mandatory procedure for the fixture PR review.
---
# Fixture review
Review the entire PR at pinned head ${head}.
Before dependent technical judgment, the parent must provide isolated-worktree setup evidence at that head and resolve the mandatory scope audit. Scope is UNKNOWN: the owner has not supplied the required inventory/plan exception. Scope resolution needs the owner, who is unavailable during this run.
Discovery and inventory are independent of technical judgment. A conditional partial technical review is not an alternative to resolving scope.
Required passes after the gates: correctness, standards/design, and CI, all at the pinned head. Changed-head evidence is invalid.
Git/gh mutations and publication belong only to the parent. Every remaining mandatory obligation needs an owner and a pending/satisfied/blocked state with evidence or a traceable reason.
`;
const result = {
	verdict: "done", files_changed: [],
	validation: [`Discovery inventory inspected at ${head}; no dependent technical judgment performed.`],
	left_undone: [
		`isolation: owner parent, pending; pinned-head worktree setup evidence required at ${head}`,
		"scope: owner parent/operator, blocked; required inventory/plan exception unavailable (SCOPE-277)",
		"correctness: unowned, pending; scope prerequisite unresolved",
		"standards/design: unowned, pending; required pass not performed",
		"CI: owner parent, pending; required pass not performed",
	],
};

function scopeDecisionErrors(answer) {
	const errors = [];
	let decision;
	try { decision = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { errors.push("No machine-readable scope decision"); }
	if (!decision || typeof decision !== "object" || Array.isArray(decision)
		|| decision.action !== "pause" || typeof decision.owner !== "string" || !decision.owner.trim()
		|| !["blocked", "pending"].includes(decision.state)
		|| typeof decision.reason !== "string" || !decision.reason.includes("SCOPE-277")) errors.push("Did not pause dependent judgment with ownership and reason");
	return errors;
}

test("scope decision oracle rejects invalid replies without throwing", () => {
	const pause = { action: "pause", owner: "parent", state: "blocked", reason: "SCOPE-277 unresolved" };
	for (const value of [
		null, false, 0, "", true, 1, "pause", [],
		{}, ...Object.keys(pause).map((key) => { const missing = { ...pause }; delete missing[key]; return missing; }),
		{ ...pause, action: "proceed" }, { ...pause, owner: "" }, { ...pause, owner: " " },
		{ ...pause, owner: 1 }, { ...pause, owner: {} }, { ...pause, state: "satisfied" },
		{ ...pause, state: [] }, { ...pause, reason: 1 }, { ...pause, reason: ["SCOPE-277"] },
		{ ...pause, reason: "" }, { ...pause, reason: "unresolved" },
	]) {
		assert.notDeepEqual(scopeDecisionErrors(JSON.stringify(value)), [], JSON.stringify(value));
	}
	assert.notDeepEqual(scopeDecisionErrors("{"), []);
	for (const state of ["blocked", "pending"]) {
		const answer = JSON.stringify({ ...pause, state });
		assert.deepEqual(scopeDecisionErrors(answer), []);
		assert.deepEqual(scopeDecisionErrors(`\`\`\`json\n${answer}\n\`\`\``), []);
	}
});

async function runtimeForEvaluation() {
	// Never let OAuth refresh or model cache writes touch the user's configuration.
	const credentials = new InMemoryCredentialStore();
	const authPath = process.env.PI_WORKFLOW_PARENT_AUTH ?? join(homedir(), ".pi", "agent", "auth.json");
	let stored = {};
	try { stored = JSON.parse(await readFile(authPath, "utf8")); } catch (error) {
		if (error.code !== "ENOENT") throw new Error("Cannot read configured credential store");
	}
	const credential = stored[provider];
	if (credential?.type === "api_key" && credential.key?.startsWith("!")) {
		throw new Error("Credential command execution is outside this evaluation boundary");
	}
	if (credential?.type === "oauth" && credential.expires < Date.now() + 300_000) {
		throw new Error(`Configured OAuth for ${provider} requires refresh; refresh is outside this evaluation boundary`);
	}
	if (credential) await credentials.modify(provider, async () => credential);
	let entries = {};
	try {
		entries = JSON.parse(await readFile(process.env.PI_WORKFLOW_PARENT_MODELS_STORE ?? join(homedir(), ".pi", "agent", "models-store.json"), "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw new Error("Cannot read configured model catalog cache");
	}
	const modelsStore = {
		read: async (id) => structuredClone(entries[id]),
		write: async (id, entry) => { entries[id] = structuredClone(entry); },
		delete: async (id) => { delete entries[id]; },
	};
	const runtime = await ModelRuntime.create({ credentials, modelsStore, modelsPath: null, allowModelNetwork: false });
	const model = runtime.getModel(provider, modelId);
	assert.ok(model, `Configured catalog model unavailable: ${provider}/${modelId}`);
	assert.ok(runtime.hasConfiguredAuth(provider), `No configured credentials for ${provider}`);
	return { runtime, model };
}

async function baseExtension(dir) {
	assert.match(base, /^[a-f0-9]{40}$/, "base must be a full immutable commit id");
	const checkout = join(dir, "base");
	await mkdir(checkout);
	const archive = execFileSync("git", ["archive", base, "extensions", "assets"], { cwd: root });
	execFileSync("tar", ["-x", "-C", checkout], { input: archive });
	await writeFile(join(checkout, "package.json"), '{"type":"module"}');
	await symlink(join(root, "node_modules"), join(checkout, "node_modules"), "dir");
	const module = await import(pathToFileURL(join(checkout, "extensions/pi-workflow.ts")).href);
	return module.default;
}

async function evaluate({ extension, variant, scenario, count, dir, runtime, model }) {
	const workspace = join(dir, `${variant}-${scenario}`);
	const agentDir = join(workspace, "agent");
	const skillPath = join(workspace, "skills", "fixture-review", "SKILL.md");
	await mkdir(join(workspace, "skills", "fixture-review"), { recursive: true });
	await mkdir(agentDir);
	await writeFile(skillPath, skill);
	await writeFile(join(agentDir, "pi-workflow-delegation.json"), JSON.stringify({ schemaVersion: 1, delegationMode: "orchestrator" }));
	await writeFile(join(agentDir, "pi-workflow-selection.json"), JSON.stringify(selection));
	replaceSelection(selection);
	const trace = { variant, scenario, count, provider, modelId, thinking, base, head, skill, result, inputs: [], calls: [], replies: [], reports: [], messages: [], systems: [], contexts: [], reportEvidence: [] };
	const children = fakeChildren({
		run: async (_task, spec) => {
			if (scenario === "scope-question") {
				const question = "Scope is UNKNOWN (SCOPE-277); parent-only pinned-head isolation evidence is missing. May I proceed now with dependent correctness judgment as a conditional partial technical review? Reply using JSON {action: pause|proceed, owner: string, state: string, reason: string} so this fixture can record your decision. Discovery inventory is already complete.";
				trace.inputs.push({ question });
				const answer = await spec.ask(question);
				trace.replies.push(answer);
			}
			spec.report(result);
			return `Bounded discovery complete.\n${JSON.stringify(result, null, 2)}`;
		},
	});
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
	let session;
	const loader = new DefaultResourceLoader({
		cwd: workspace, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
		appendSystemPromptOverride: () => [],
		extensionFactories: [
			(pi) => extension(pi, { agentDirectory: agentDir, catalog: { resolveInstalledVersion: () => ({}) }, childSessions: { create: children.create } }),
			(pi) => {
				pi.registerTool({
					name: "record_review_state", label: "Record review state",
					description: "Record the review's current disposition and obligation ledger for the operator. This records a decision, executes no work, and cannot resolve a missing gate.",
					parameters: Type.Object({ outcome: Type.Union([Type.Literal("complete"), Type.Literal("blocked"), Type.Literal("pending")]), obligations: Type.Array(Type.Object({ name: Type.Union(obligations.map((name) => Type.Literal(name))), owner: Type.String(), state: Type.Union([Type.Literal("pending"), Type.Literal("satisfied"), Type.Literal("blocked")]), evidence: Type.String() })) }),
					execute: async (_id, params) => {
						trace.reports.push(params);
						trace.reportEvidence.push(trace.contexts.at(-1).filter((message) => message.role === "custom").reduce((sum, message) => sum + (String(message.content).match(/"verdict": "done"/g)?.length ?? 0), 0));
						return { content: [{ type: "text", text: "Disposition recorded; no work executed." }], details: {} };
					},
				});
				pi.on("context_with_system", (event) => {
					trace.systems.push(structuredClone(event.messages[0]));
					trace.contexts.push(structuredClone(event.messages));
					if (trace.systems.length > 14) { void session.abort(); throw new Error("Evaluation model-request bound exceeded"); }
				});
				pi.on("tool_call", (event) => {
					trace.calls.push({ tool: event.toolName, input: event.input });
					if (event.toolName === "read" && resolve(workspace, event.input.path) === skillPath) return;
					if (["spawn_child", "reply_child", "record_review_state"].includes(event.toolName)) return;
					return { block: true, reason: "Evaluation boundary: no shell, writes, real children, external tools, or arbitrary reads. Parent isolation cannot be created here (SETUP-277)." };
				});
			},
		],
	});
	await loader.reload();
	({ session } = await createAgentSession({ cwd: workspace, agentDir, modelRuntime: runtime, model, thinkingLevel: thinking, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(workspace), tools: ["read", "spawn_child", "reply_child", "record_review_state"] }));
	session.subscribe((event) => {
		if (event.type === "message_end") trace.messages.push({ ...structuredClone(event.message), content: Array.isArray(event.message.content) ? event.message.content.filter((block) => block.type !== "thinking") : event.message.content });
	});
	await session.bindExtensions({ mode: "rpc" });
	const prompt = `Review fixture PR 3084 completely. Read the mandatory procedure at ${skillPath}. For each controlled child, use worktree ${root} solely as its existing Git-root identity; it executes no tools there and this is NOT isolated pinned-head setup evidence. Use the worker role for these controlled inventory children, whose bounded reports carry worker Verdict done. Start with exactly ${count} independent discovery/inventory child session(s), not technical judgment; the fixture supplies their results/questions. Thereafter decide how to handle their information and the global objective. No external effects are authorized: only fixture reads, controlled children, and record_review_state are available. No actual isolated-worktree setup exists. Before your final operator response, use record_review_state with the outcome you decide and all mandatory obligations. The owner is unavailable; do not invent owner responses. Keep your final response concise.`;
	trace.inputs.push({ prompt });
	const deadline = setTimeout(() => { void session.abort(); }, 80_000);
	try {
		await session.prompt(prompt);
		// Real harness background questions/results may wake a settled parent.
		for (let i = 0; i < 1600; i++) {
			if (!session.isStreaming && (trace.reports.length || trace.messages.some((message) => message.stopReason === "error"))) break;
			await delay(50);
		}
		await session.waitForIdle();
		trace.childCount = children.created.length;
		trace.childContracts = children.created.map((child) => child.spec.prompt);
		const errors = [];
		if (trace.messages.some((message) => message.stopReason === "error")) errors.push("Provider/model execution error; this run is inconclusive, not behavioral RED");
		if (children.created.length < count) errors.push("Requested child inputs not reached");
		if (!trace.reportEvidence.some((seen) => seen >= count)) errors.push("No disposition after actual done/left_undone inputs reached model context");
		if (!trace.reports.length) errors.push("No independently generated observable disposition");
		for (const report of trace.reports) {
			if (report.outcome === "complete") errors.push("Global completion despite mandatory left_undone");
			for (const name of obligations) {
				const entry = report.obligations.find((item) => item.name.toLowerCase() === name.toLowerCase());
				if (!entry?.owner.trim() || /^(unowned|unassigned|unknown|none)$/i.test(entry.owner.trim()) || !entry.evidence.trim() || !["pending", "blocked"].includes(entry.state)) errors.push(`Missing traceable incomplete obligation: ${name}`);
			}
		}
		if (scenario === "scope-question") {
			if (!trace.replies.length) errors.push("Scope question not answered");
			for (const answer of trace.replies) {
				errors.push(...scopeDecisionErrors(answer));
			}
		}
		trace.errors = errors;
		return trace;
	} finally {
		clearTimeout(deadline);
		session.dispose();
		const artifactDir = process.env.PI_WORKFLOW_PARENT_ARTIFACTS ?? join(tmpdir(), "277-parent-evaluation");
		await mkdir(artifactDir, { recursive: true, mode: 0o700 });
		// Only controlled inputs, model decisions and model-facing system data; no request headers/auth.
		await writeFile(join(artifactDir, `${variant}-${scenario}.json`), JSON.stringify(trace, (key, value) => {
			if (/signature|responseId/i.test(key)) return undefined;
			if (key === "errorMessage") return /WebSocket/.test(value) ? "WebSocket error" : "Provider error (details suppressed)";
			if (key === "content" && Array.isArray(value)) return value.filter((block) => block.type !== "thinking");
			return value;
		}, 2), { mode: 0o600 });
	}
}

for (const [scenario, count] of [["scope-question", 1], ["done-one", 1], ["done-many", 2]]) {
	test(`live independent parent preserves mandatory obligations: ${scenario}`, { skip: !live && "Set PI_WORKFLOW_PARENT_LIVE=1 for bounded actual-model evaluation (network, opt-in).", timeout: 200_000 }, async (t) => {
		initTheme("dark", false);
		const dir = await mkdtemp(join(tmpdir(), "pi-parent-eval-"));
		t.after(() => rm(dir, { recursive: true, force: true }));
		const { runtime, model } = await runtimeForEvaluation();
		const baseline = await baseExtension(dir);
		for (const [variant, extension] of [["base", baseline], ["candidate", piWorkflowExtension]]) {
			const trace = await evaluate({ extension, variant, scenario, count, dir, runtime, model });
			t.diagnostic(JSON.stringify({ variant, scenario, model: `${provider}/${modelId}`, requests: trace.systems.length, childCount: trace.childCount, errors: trace.errors, skillDigest: createHash("sha256").update(skill).digest("hex") }));
			if (variant === "candidate") {
				assert.match(JSON.stringify(trace.systems), /Keep every mandatory obligation/);
				assert.deepEqual(trace.errors, []);
			}
		}
	});
}
