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

The runtime extension admits only idle interactive invocations. Pending capabilities block every tool. Implemented capabilities expose only their workflow-owned tools, and \`ask_user_question\` is available only while a compatible shared decision is active.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.`;
const sharedDecisionPolicy = `## Closed decisions

Every closed human choice is presented by the shared \`interactive-decisions\` descriptor as either the compatible Pi panel or its numbered fallback. Wait for that descriptor and use only the semantic action recorded by its fresh claim. Never render a separate choice list, require an exact phrase, infer approval from prose, or construct decision IDs, digests, execution IDs, or authority fields. Ambiguous free-form feedback is not approval and must not trigger an effect.`;
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
	return `${sharedDecisionPolicy}

## Approved Delivery ticket publication

This continuation rule takes precedence over treating the request as a new domain anchor. When the Owner directly asks in natural language to publish Delivery tickets that were already approved:

- Call \`workflow_define_product\` with exactly \`{"action":"publish_tickets"}\`. Never add \`domainAnchor\`, a Delivery parent ID, \`definitionId\`, a digest, an artifact reference, or any other field, even when the request names the parent.
- Do not invoke \`/define-product\`, start research, recommend a route, create a new definition, or fall through to another or pending capability.
- If \`session_start\` restored the durable continuation, let the runtime route this action-only call to authenticated Linear MCP publication. Authenticate the active non-guest Linear user once when requested, then reuse that cached identity for the complete publication.
- If durable recovery is absent or invalid, report exactly the workflow blocker and stop:

\`\`\`text
code: PI_WORKFLOW_TICKET_APPROVAL_MISMATCH
message: Ticket publication requires the current durable Owner-approved graph.
\`\`\`

## Route recommendation

After receiving an allowed invocation with a valid domain anchor:

- Assess the idea explicitly on two axes: clarity (\`clear\` or \`unclear\`) and breadth (\`narrow\` or \`broad\`).
- Recommend \`wayfinder\` when clarity is \`unclear\` or breadth is \`broad\`; otherwise recommend \`grilling\`.
- Explain the reasons briefly, provide the research question, and wait for the shared route decision. Do not ask for a particular confirmation phrase.
- Stop after that recommendation turn. Do not start research in the same turn.

## Confirmation and research

After the shared route decision records the confirm action:

- Execute the workflow-owned define-product research.
- If it returns a blocker, reproduce the blocker code and message exactly, then stop.
- If it completes, report the verified result without private workflow metadata.

## Spec generation

After verified research or exploration completes:

- Call authenticated Linear MCP \`linear_list_teams\` exactly once with \`limit: 50\` and \`orderBy: "updatedAt"\`.
- Retain each returned immutable team ID privately and let the runtime prepare the shared team-selection descriptor. Do not present a separate team list or accept an unclaimed team ID. Derive a concise title from the product task; never ask the Owner to provide one.
- Stop after the shared team descriptor is prepared. Never call \`to_spec\` in the same turn that research or exploration completed.
- Wait for a fresh interactive, non-streaming Owner reply before calling \`to_spec\`.
- For the first Spec, pass \`teamId\`, the model-derived \`title\`, and the semantic Spanish Spec fields. The runtime privately binds definition identity, the composite target, initial revision \`spec-r1\`, and every verified active research or exploration support artifact.
- If the Owner requests changes as free-form feedback, incorporate them, preserve unaffected content, reuse the privately retained team, derive the title from the task, and call \`to_spec\` again. Call \`approve_spec\` only after the shared Spec decision records its semantic publish action. The runtime accepts an omitted \`teamId\` only for a bound revision.
- Never ask for or provide definition IDs, revisions, target objects, support artifact aliases, support artifact references, digests, schemas, or artifact topics.
- Use professional neutral Spanish in the Spec and all Owner-facing wording.
- Present a Spec only when the workflow returns \`spec-ready\`. Reproduce the returned \`spec.body\` verbatim and in full before asking for approval; never summarize, paraphrase, or replace it with only the title.
- After the shared Spec decision records approval, call \`approve_spec\` with only its action. If it returns \`spec-approved\`, immediately call \`publish_spec\` with only its action in the same logical operation; do not ask for another human confirmation and do not claim publication before verified success.
- If the workflow returns a blocker, reproduce the blocker code and message exactly, stop immediately, and never draft, imply, or present a fallback or unofficial Spec.

Do not expose agent names, provider or model choices, effort, runtime IDs, artifact topics, private tool names, or retry internals.`;
}

function implementedQaHandoffSection() {
	return `${sharedDecisionPolicy}

## Publication

After receiving an allowed invocation with a valid Linear ID:

- The Developer's invocation supplies only the issue anchor; it does not authorize publication. Wait for the shared publish or cancel action bound to the canonical \`qa-handoff/v1\` artifact, issue revision, and exact Linear-facing body in professional neutral Spanish.
- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call \`linear_get_user\` again before publication.
- Execute the QA handoff workflow for that same Linear ID. Do not provide a body, digest, authority, revision, or additional fields.
- If the workflow returns a blocker, report the exact blocker and stop.
- If it publishes the comment or retrieves it idempotently, report the verified result.

Never change status, assignee, Cycle, labels, estimate, blockers, relations, or description. Those actions remain manual.`;
}

function implementedProductReviewSection() {
	return `${sharedDecisionPolicy}

## Evaluation and approval

After receiving an allowed invocation with a valid Linear ID:

- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call \`linear_get_user\` again after selection or before publication.
- Evaluate scope, user stories and acceptance criteria, evidence, findings, required changes, and parent/sibling impact through the structured \`product-review/v1\` draft.
- Let the runtime present the shared result descriptor for \`Aceptado\`, \`Cambios requeridos\`, and cancellation without exposing digests or workflow metadata.
- After the shared descriptor records a result action, call the workflow tool with \`action: "select_result"\` and the corresponding structured \`result\`. The runtime privately binds the issue and digest. The transport fields do not authorize publication by themselves.
- Report the verified result or blocker exactly.
- Communicate conversationally in the language used by the user. This does not change the professional-neutral Spanish contract for content published to Linear.

Never change status, assignee, Cycle, labels, estimate, relations, or description. Done, Stop, reassignment, and parent auto-close remain manual or native Linear actions.`;
}

function skillSource(entry) {
	const capabilitySection =
		entry.capability !== "implemented"
			? pendingCapabilitySection(entry)
			: entry.name === "qa-handoff"
				? implementedQaHandoffSection()
				: entry.name === "product-review"
					? implementedProductReviewSection()
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
