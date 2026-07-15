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
docs/adr/0001-explicit-companion-install.md
docs/adr/0002-harness-release-guard.md
docs/adr/0003-workflow-helper-extension-as-adapter.md
docs/adr/0004-no-companion-installer-module.md
docs/research/context-mode-package-patterns.md
docs/research/gentle-ai-review-coordination-portability.md
docs/research/gentle-pi-subagent-skill-routing.md
docs/research/gpt-5.6-sol-context-window-opencode-pi.md
docs/research/linear-workflow-model.md
docs/research/matt-wayfinder-spec-tickets.md
docs/research/pi-engram-release-cicd.md
extensions/agent-asset-filesystem.ts
extensions/agent-asset-migrations.ts
extensions/agent-asset-operation.ts
extensions/agent-asset-sync.ts
extensions/agent-validator.ts
extensions/companion-workflow.ts
extensions/default-define-product.ts
extensions/define-product-runtime.ts
extensions/define-product-workflow.ts
extensions/delegation-checkpoints.ts
extensions/delivery-parent-publication.ts
extensions/delivery-ticket-graph.ts
extensions/engram-approved-spec-reader.ts
extensions/exploration-recovery.ts
extensions/linear-delivery-parent-gateway.ts
extensions/mcp-config.ts
extensions/pi-workflow-sync.ts
extensions/pi-workflow.ts
extensions/product-spec.ts
extensions/project-standards-resolver.ts
extensions/public-entry-guard.ts
extensions/publication-manifest.ts
extensions/publication-state-machine.ts
extensions/runtime-engram-store.ts
extensions/runtime-linear-delivery-parent.ts
extensions/runtime-private-state.ts
extensions/skill-resolver.ts
extensions/spec-approval-recovery.ts
extensions/subagent-launcher.ts
extensions/workflow-artifacts.ts
extensions/workflow-contracts.ts
extensions/workflow-delegate.ts
package.json
prompts/define-product.md
prompts/deliver-ticket.md
prompts/product-review.md
prompts/qa-handoff.md
scripts/check-agent-assets.mjs
scripts/forbid-focused-tests.mjs
scripts/generate-public-workflows.mjs
scripts/pi-workflow-sync.mjs
scripts/public-workflow-catalog.mjs
scripts/validate-pi-package.mjs
skills/define-product/SKILL.md
skills/deliver-ticket/SKILL.md
skills/product-review/SKILL.md
skills/qa-handoff/SKILL.md`.split("\n");
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
		capability: "pending",
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
		capability: "pending",
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
	if (golden.capability === "implemented") {
		return `## Route recommendation

After receiving an allowed invocation with a valid domain anchor:

- Assess the idea explicitly on two axes: clarity (\`clear\` or \`unclear\`) and breadth (\`narrow\` or \`broad\`).
- Recommend \`wayfinder\` when clarity is \`unclear\` or breadth is \`broad\`; otherwise recommend \`grilling\`.
- Explain the reasons briefly and ask the Owner to confirm the exact recommended route, provide the research question, and return the one-time confirmation token from that recommendation response.
- Stop after that recommendation turn. Do not start research in the same turn.

## Confirmation and result

After the Owner explicitly confirms the exact recommended route, provides the research question, and returns the one-time confirmation token from the active recommendation response:

- Execute the workflow-owned define-product implementation.
- If it returns a blocker, report the blocker exactly and stop.
- If it completes, return the verified artifact reference and the next recommended step.

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
