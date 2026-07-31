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

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. For each relevant execution, the implemented runtime authenticates one active, non-guest Linear user exactly once with \`linear_get_user\` and caches a stable \`single-user/v1\` authority projection; never repeat that lookup before later actions or mutations. Human Owner/Developer role membership remains an organizational access boundary: this package does not infer role membership from the Linear user response.

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
	return `## Approved Delivery ticket publication

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

function implementedQaHandoffSection() {
	return `## Publication

After receiving an allowed invocation with a valid Linear ID:

- The Developer's explicit invocation authorizes only the canonical \`qa-handoff/v1\` artifact that the runtime binds internally to that issue, its revision, and the exact Linear-facing body in professional neutral Spanish.
- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call \`linear_get_user\` again before publication.
- Execute the QA handoff workflow for that same Linear ID. Do not provide a body, digest, authority, revision, or additional fields.
- If the workflow returns a blocker, report the exact blocker and stop.
- If it publishes the comment or retrieves it idempotently, report the verified result.

Never change status, assignee, Cycle, labels, estimate, blockers, relations, or description. Those actions remain manual.`;
}

function implementedProductReviewSection() {
	return `## Evaluation and approval

After receiving an allowed invocation with a valid Linear ID:

- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call \`linear_get_user\` again after selection or before publication.
- Evaluate scope, user stories and acceptance criteria, evidence, findings, required changes, and parent/sibling impact through the structured \`product-review/v1\` draft.
- Present the agent recommendation and the two available results, \`Aceptado\` and \`Cambios requeridos\`, without exposing digests or workflow metadata.
- Ask the Owner to decide naturally. Interpret the Owner's response yourself; runtime code must not classify natural-language phrases. If the response is ambiguous, ask a follow-up and do not call tools.
- After the Agent interprets an explicit selection, call the workflow tool with exactly \`action: "select_result"\` and the selected structured \`result\`. The runtime privately binds the issue and digest.
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
