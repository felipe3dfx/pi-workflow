import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	DefaultResourceLoader,
	loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import { runPackedSubprocess } from "./support/packed-subprocess.mjs";
const packageRoot = resolve(".");
const publicEntryNames = [
	"define-product",
	"deliver-ticket",
	"product-review",
	"qa-handoff",
];
const expectedPackedFiles = `LICENSE
README.md
assets/acceptance/product-review.golden.md
assets/acceptance/qa-handoff.golden.md
assets/agent-asset-migrations.json
assets/agent-assets.json
assets/agents/Explore.md
assets/agents/Plan.md
assets/agents/general-purpose.md
assets/agents/jd-fix-agent.md
assets/agents/jd-judge-a.md
assets/agents/jd-judge-b.md
assets/agents/orchestrator.md
assets/agents/prepare-commit.md
assets/agents/product-review.md
assets/agents/prototype.md
assets/agents/research.md
assets/agents/review-readability.md
assets/agents/review-reliability.md
assets/agents/review-resilience.md
assets/agents/review-risk.md
assets/agents/sdd-apply.md
assets/agents/sdd-archive.md
assets/agents/sdd-design.md
assets/agents/sdd-explore.md
assets/agents/sdd-init.md
assets/agents/sdd-onboard.md
assets/agents/sdd-proposal.md
assets/agents/sdd-spec.md
assets/agents/sdd-status.md
assets/agents/sdd-sync.md
assets/agents/sdd-tasks.md
assets/agents/sdd-verify.md
assets/agents/simplify.md
assets/agents/to-spec.md
assets/agents/to-tickets.md
assets/companions.json
assets/mcp-servers.json
assets/schemas/agent-asset-migrations.schema.json
assets/schemas/agent-assets.schema.json
assets/skills/to-tickets/SKILL.md
extensions/agent-asset-filesystem.ts
extensions/agent-asset-migrations.ts
extensions/agent-asset-operation.ts
extensions/agent-asset-sync.ts
extensions/agent-validator.ts
extensions/approved-revision-publication-manifest.ts
extensions/approved-revision-publication.ts
extensions/approved-revision-store.ts
extensions/approved-ticket-graph-store.ts
extensions/approved-ticket-publication.ts
extensions/companion-workflow.ts
extensions/default-define-product.ts
extensions/default-product-review.ts
extensions/default-qa-handoff.ts
extensions/define-product-mcp-publication.ts
extensions/define-product-publication-recovery.ts
extensions/define-product-runtime.ts
extensions/define-product-workflow.ts
extensions/delegation-checkpoints.ts
extensions/delivery-parent-publication.ts
extensions/delivery-parent-snapshot-store.ts
extensions/delivery-pull-request-workflow.ts
extensions/delivery-reentry-workflow.ts
extensions/delivery-review-workflow.ts
extensions/delivery-runtime.ts
extensions/delivery-start-workflow.ts
extensions/delivery-ticket-graph.ts
extensions/delivery-ticket-publication.ts
extensions/delivery-workflow.ts
extensions/engram-approved-spec-reader.ts
extensions/exploration-recovery.ts
extensions/linear-delivery-parent-gateway.ts
extensions/linear-delivery-ticket-gateway.ts
extensions/linear-qa-handoff-gateway.ts
extensions/mcp-config.ts
extensions/pi-workflow-sync.ts
extensions/pi-workflow.ts
extensions/product-review-artifact-store.ts
extensions/product-review-draft-store.ts
extensions/product-review-mcp-publication.ts
extensions/product-review-publication-recovery.ts
extensions/product-review-runtime.ts
extensions/product-review-workflow.ts
extensions/product-spec.ts
extensions/project-standards-resolver.ts
extensions/public-entry-guard.ts
extensions/publication-manifest.ts
extensions/publication-state-machine.ts
extensions/qa-handoff-artifact-store.ts
extensions/qa-handoff-draft-producer.ts
extensions/qa-handoff-draft-store.ts
extensions/qa-handoff-mcp-publication.ts
extensions/qa-handoff-publication-recovery.ts
extensions/qa-handoff-runtime.ts
extensions/qa-handoff-workflow.ts
extensions/review-router.ts
extensions/runtime-engram-store.ts
extensions/runtime-linear-approved-revision.ts
extensions/runtime-linear-delivery-parent.ts
extensions/runtime-linear-delivery-ticket.ts
extensions/runtime-private-state.ts
extensions/skill-resolver.ts
extensions/spec-approval-recovery.ts
extensions/subagent-launcher.ts
extensions/ticket-approval-recovery.ts
extensions/ticket-graph-recovery.ts
extensions/ticket-publication-authority-guard.ts
extensions/ticket-publication-manifest.ts
extensions/workflow-artifacts.ts
extensions/workflow-contracts.ts
extensions/workflow-delegate.ts
extensions/workflow-diagnostics.ts
package.json
prompts/define-product.md
prompts/deliver-ticket.md
prompts/product-review.md
prompts/qa-handoff.md
scripts/acceptance-evidence.mjs
scripts/check-acceptance.mjs
scripts/check-agent-assets.mjs
scripts/forbid-focused-tests.mjs
scripts/generate-public-workflows.mjs
scripts/pi-workflow-sync.mjs
scripts/public-workflow-catalog.mjs
scripts/run-packed-acceptance.mjs
scripts/validate-packed-distribution.mjs
scripts/validate-pi-package.mjs
scripts/validate-release.mjs
skills/define-product/SKILL.md
skills/deliver-ticket/SKILL.md
skills/product-review/SKILL.md
skills/qa-handoff/SKILL.md
tools/pi-sandbox.mjs`.split("\n");
const entryGoldens = {
	"define-product": {
		title: "Define Product",
		description: "Define a product from a domain anchor under Owner authority.",
		promptDescription: "Define a product from a domain anchor",
		role: "Owner",
		anchorRules:
			"After trimming, any non-empty product idea or problem is exactly one valid domain anchor. Whitespace-only input is missing.",
		inputCondition: "missing",
		anchorQuestion:
			"What product idea or problem should define the domain scope?",
		capability: "implemented",
	},
	"deliver-ticket": {
		capability: "pending",
		title: "Deliver Ticket",
		description:
			"Deliver an assigned Linear ticket from a domain anchor under Developer authority.",
		promptDescription: "Deliver an assigned Linear ticket from a domain anchor",
		role: "Developer",
		anchorRules:
			"After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.",
		inputCondition: "missing or invalid",
		anchorQuestion: "What Linear Delivery ticket ID anchors this delivery?",
	},
	"product-review": {
		capability: "implemented",
		title: "Product Review",
		description:
			"Review one Linear issue from a domain anchor under Owner authority.",
		promptDescription: "Review one Linear issue from a domain anchor",
		role: "Owner",
		anchorRules:
			"After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.",
		inputCondition: "missing or invalid",
		anchorQuestion: "What single Linear issue ID anchors this product review?",
	},
	"qa-handoff": {
		capability: "implemented",
		title: "QA Handoff",
		description:
			"Prepare a QA handoff for one Linear issue from a domain anchor under Developer authority.",
		promptDescription:
			"Prepare a QA handoff for one Linear issue from a domain anchor",
		role: "Developer",
		anchorRules:
			"After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.",
		inputCondition: "missing or invalid",
		anchorQuestion: "What single Linear issue ID anchors this QA handoff?",
	},
};

let fixtureRoot;
let installedRoot;
let manifest;
let packedFilePaths;
let loadedSkills;
let loadedPrompts;

test.before(async () => {
	fixtureRoot = await mkdtemp(join(tmpdir(), "pi-workflow-public-entries-"));
	const packResult = await runPackedSubprocess(
		"npm",
		["pack", "--json", "--ignore-scripts", "--pack-destination", fixtureRoot],
		{ cwd: packageRoot, timeout: 60_000 },
	);
	const [{ filename, files }] = JSON.parse(packResult.stdout);
	packedFilePaths = files.map(({ path }) => path).sort();
	await writeFile(
		join(fixtureRoot, "package.json"),
		'{"name":"pi-workflow-installed-fixture","private":true}\n',
	);
	await runPackedSubprocess(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-package-lock",
			"--no-audit",
			"--no-fund",
			"--offline",
			join(fixtureRoot, filename),
		],
		{
			cwd: fixtureRoot,
			timeout: 60_000,
			env: {
				...process.env,
				npm_config_cache: join(fixtureRoot, "empty-npm-cache"),
			},
		},
	);
	installedRoot = join(
		fixtureRoot,
		"node_modules",
		"@felipe.3dfx",
		"pi-workflow",
	);
	manifest = JSON.parse(
		await readFile(join(installedRoot, "package.json"), "utf8"),
	);
	loadedSkills = loadSkillsFromDir({
		dir: join(installedRoot, manifest.pi.skills[0]),
		source: "installed-package-test",
	});
	const loader = new DefaultResourceLoader({
		cwd: fixtureRoot,
		agentDir: join(fixtureRoot, ".pi-agent"),
		additionalPromptTemplatePaths: [
			join(installedRoot, manifest.pi.prompts[0]),
		],
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	loadedPrompts = loader.getPrompts();
});

test.after(async () => {
	if (fixtureRoot) {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});

function expectedCapabilitySection(name, golden) {
	if (name === "product-review" && golden.capability === "implemented") {
		return `## Evaluation and approval

After receiving an allowed invocation with a valid Linear ID:

- Evaluate scope, user stories and acceptance criteria, evidence, findings, required changes, and parent/sibling impact through the structured \`product-review/v1\` draft.
- Present the agent recommendation and the two available results, \`Aceptado\` and \`Cambios requeridos\`, without exposing digests or workflow metadata.
- Ask the Owner to decide naturally. Interpret the Owner's response yourself; runtime code must not classify natural-language phrases. If the response is ambiguous, ask a follow-up and do not call tools.
- After the Agent interprets an explicit selection, call the workflow tool with exactly \`action: "select_result"\` and the selected structured \`result\`. The runtime privately binds the issue and digest.
- Report the verified result or blocker exactly.
- Communicate conversationally in the language used by the user. This does not change the professional-neutral Spanish contract for content published to Linear.

Never change status, assignee, Cycle, labels, estimate, relations, or description. Done, Stop, reassignment, and parent auto-close remain manual or native Linear actions.`;
	}
	if (name === "qa-handoff" && golden.capability === "implemented") {
		return `## Publication

After receiving an allowed invocation with a valid Linear ID:

- The Developer's explicit invocation authorizes only the canonical \`qa-handoff/v1\` artifact that the runtime binds internally to that issue, its revision, and the exact Linear-facing body in professional neutral Spanish.
- Execute the QA handoff workflow for that same Linear ID. Do not provide a body, digest, authority, revision, or additional fields.
- If the workflow returns a blocker, report the exact blocker and stop.
- If it publishes the comment or retrieves it idempotently, report the verified result.

Never change status, assignee, Cycle, labels, estimate, blockers, relations, or description. Those actions remain manual.`;
	}
	if (golden.capability === "implemented") {
		return `## Route recommendation

After receiving an allowed invocation with a valid domain anchor:

- Assess the idea explicitly on two axes: clarity (\`clear\` or \`unclear\`) and breadth (\`narrow\` or \`broad\`).
- Recommend \`wayfinder\` when clarity is \`unclear\` or breadth is \`broad\`; otherwise recommend \`grilling\`.
- Explain the reasons briefly and ask the Owner to confirm the exact recommended route naturally and provide the research question.
- Stop after that recommendation turn. Do not start research in the same turn.

## Confirmation and research

After the Owner explicitly confirms the exact recommended route and provides the research question:

- Execute the workflow-owned define-product research.
- If it returns a blocker, reproduce the blocker code and message exactly, then stop.
- If it completes, report the verified result without private workflow metadata.

## Spec generation

After verified research or exploration completes:

- Call authenticated Linear MCP \`linear_list_teams\` exactly once with \`limit: 50\` and \`orderBy: "updatedAt"\`.
- Retain each returned immutable team ID privately. Present the team names as concise numbered options without internal IDs and ask the Owner to select one. Interpret the natural-language selection and map it only to an option that was presented; never infer or invent an ID. Never require the Owner to type or recall a team name without first showing these options. Derive a concise title from the product task; never ask the Owner to provide one.
- Stop after presenting the options. Never call \`to_spec\` in the same turn that research or exploration completed.
- Wait for a fresh interactive, non-streaming Owner reply before calling \`to_spec\`.
- For the first Spec, pass \`teamId\`, the model-derived \`title\`, and the semantic Spanish Spec fields. The runtime privately binds definition identity, the composite target, initial revision \`spec-r1\`, and every verified active research or exploration support artifact.
- Interpret each fresh Owner response yourself. If it approves the ready Spec, call \`approve_spec\`; if it requests changes, incorporate the feedback, preserve unaffected content, reuse the privately retained team without asking the Owner to repeat or reconfirm it, derive the title from the task, and call \`to_spec\` again. If the response is ambiguous, ask a follow-up and do not call the workflow tool. Runtime code validates provenance and bindings but never classifies the natural-language wording. The runtime accepts an omitted \`teamId\` only for a bound revision.
- Never ask for or provide definition IDs, revisions, target objects, support artifact aliases, support artifact references, digests, schemas, or artifact topics.
- Use professional neutral Spanish in the Spec and all Owner-facing wording.
- Present a Spec only when the workflow returns \`spec-ready\`. Reproduce the returned \`spec.body\` verbatim and in full before asking for approval; never summarize, paraphrase, or replace it with only the title.
- After natural Owner approval, call \`approve_spec\` with only its action. If it returns \`spec-approved\`, immediately call \`publish_spec\` with only its action in the same turn; do not ask for another human confirmation and do not claim publication before verified success.
- If the workflow returns a blocker, reproduce the blocker code and message exactly, stop immediately, and never draft, imply, or present a fallback or unofficial Spec.

Do not expose agent names, provider or model choices, effort, runtime IDs, artifact topics, private tool names, or retry internals.`;
	}
	return `## Pending capability

After receiving an allowed invocation with a valid domain anchor, return exactly:

\`\`\`text
status: blocked
code: PI_WORKFLOW_CAPABILITY_PENDING
capability: ${name}
mutation: none
\`\`\`

Do not invoke tools or perform mutations while this capability is pending. Runtime code blocks every tool call for the active public-entry turn.`;
}

function expectedSkillSource(name, golden) {
	return `---
name: ${name}
description: ${golden.description}
---

# ${golden.title}

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. Human role membership is an organizational access boundary: this package has no Owner/Developer credential and does not authenticate a person as Owner rather than QA or PS. Later workflow modules must enforce role authority before mutations.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: ${golden.role}.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

${golden.anchorRules}

For ${golden.inputCondition} input, return exactly this one corrective question:

${golden.anchorQuestion}

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

${expectedCapabilitySection(name, golden)}
`;
}

function substituteDocumentedArguments(content, argumentsText) {
	return content.replaceAll("$ARGUMENTS", argumentsText);
}

test("packed package installs offline from an empty cache with the exact dependency-free catalog", () => {
	assert.deepEqual(manifest.dependencies ?? {}, {});
	assert.deepEqual(manifest.bundledDependencies ?? [], []);
	assert.deepEqual(manifest.bundleDependencies ?? [], []);
	assert.deepEqual(packedFilePaths, expectedPackedFiles);
	assert.equal(
		packedFilePaths.some((filePath) => filePath.startsWith("assets/language/")),
		false,
	);
});

test("Pi's public loaders discover exactly the packed workflow resources", () => {
	assert.deepEqual(manifest.pi, {
		extensions: ["./extensions/pi-workflow.ts"],
		skills: ["./skills"],
		prompts: ["./prompts"],
	});
	assert.deepEqual(loadedSkills.diagnostics, []);
	assert.deepEqual(
		loadedSkills.skills
			.map(({ name, description }) => ({ name, description }))
			.sort((left, right) => left.name.localeCompare(right.name)),
		publicEntryNames.map((name) => ({
			name,
			description: entryGoldens[name].description,
		})),
	);
	assert.deepEqual(loadedPrompts.diagnostics, []);
	assert.deepEqual(
		loadedPrompts.prompts
			.map(({ name, description }) => ({ name, description }))
			.sort((left, right) => left.name.localeCompare(right.name)),
		publicEntryNames.map((name) => ({
			name,
			description: entryGoldens[name].promptDescription,
		})),
	);
});

test("loaded prompts contain only their homonymous invocation and documented argument forwarding", () => {
	const argumentsText = 'ILA-2304 --source "release candidate"';
	for (const prompt of loadedPrompts.prompts) {
		const expectedContent = `Load and follow the \`${prompt.name}\` skill.\n\nArguments: $ARGUMENTS`;
		assert.equal(prompt.content, expectedContent);
		assert.equal(
			substituteDocumentedArguments(prompt.content, argumentsText),
			`Load and follow the \`${prompt.name}\` skill.\n\nArguments: ${argumentsText}`,
		);
	}
});

test("loaded skills exactly define deterministic non-mutating anchor boundaries", async () => {
	for (const skill of loadedSkills.skills) {
		assert.equal(
			await readFile(skill.filePath, "utf8"),
			expectedSkillSource(skill.name, entryGoldens[skill.name]),
		);
	}
});
