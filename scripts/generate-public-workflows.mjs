#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { publicWorkflowCatalog } from "./public-workflow-catalog.mjs";

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
	process.stderr.write(
		"usage: generate-public-workflows.mjs --check|--write\n",
	);
	process.exit(2);
}

const root = process.cwd();
const sharedInvocationPolicy = `Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. Human role membership is an organizational access boundary: this package has no Owner/Developer credential and does not authenticate a person as Owner rather than QA or PS. Later workflow modules must enforce role authority before mutations.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.`;
const sharedPendingPolicy =
	"Do not invoke tools or perform mutations while this capability is pending. Runtime code blocks every tool call for the active public-entry turn.";

function pendingCapabilitySection(entry) {
	return `## Pending capability

After receiving an allowed invocation with a valid domain anchor, return exactly:

\`\`\`text
status: blocked
code: PI_WORKFLOW_CAPABILITY_PENDING
capability: ${entry.name}
mutation: none
\`\`\`

${sharedPendingPolicy}`;
}

function implementedDefineProductSection() {
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

function implementedQaHandoffSection() {
	return `## Publication

After receiving an allowed invocation with a valid Linear ID:

- The Developer's explicit invocation authorizes only the canonical \`qa-handoff/v1\` artifact that the runtime binds internally to that issue, its revision, and the exact Linear-facing body in professional neutral Spanish.
- Execute the QA handoff workflow for that same Linear ID. Do not provide a body, digest, authority, revision, or additional fields.
- If the workflow returns a blocker, report the exact blocker and stop.
- If it publishes the comment or retrieves it idempotently, report the verified result.

Never change status, assignee, Cycle, labels, estimate, blockers, relations, or description. Those actions remain manual.`;
}

function skillSource(entry) {
	const capabilitySection = entry.capability !== "implemented"
		? pendingCapabilitySection(entry)
		: entry.name === "qa-handoff"
			? implementedQaHandoffSection()
			: implementedDefineProductSection(entry);
	return `---
name: ${entry.name}
description: ${entry.description}
---

# ${entry.title}

## Invocation guard

${sharedInvocationPolicy}

## Inputs

Authorized organizational role: ${entry.role}.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

${entry.anchorRules}

For ${entry.inputCondition} input, return exactly this one corrective question:

${entry.anchorQuestion}

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

${capabilitySection}
`;
}

function promptSource(entry) {
	return `---
description: ${entry.promptDescription}
---
Load and follow the \`${entry.name}\` skill.

Arguments: $ARGUMENTS
`;
}

let stale = false;
for (const entry of publicWorkflowCatalog) {
	for (const [relativePath, expected] of [
		[`skills/${entry.name}/SKILL.md`, skillSource(entry)],
		[`prompts/${entry.name}.md`, promptSource(entry)],
	]) {
		const absolutePath = path.join(root, relativePath);
		if (mode === "--write") {
			await mkdir(path.dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, expected);
			continue;
		}
		let actual;
		try {
			actual = await readFile(absolutePath, "utf8");
		} catch {
			actual = undefined;
		}
		if (actual !== expected) {
			stale = true;
			process.stderr.write(
				`generated public workflow resource is stale: ${relativePath}\n`,
			);
		}
	}
}
if (stale) process.exit(1);
process.stdout.write(
	mode === "--write"
		? "generated public workflow resources written.\n"
		: "generated public workflow resources are current.\n",
);
