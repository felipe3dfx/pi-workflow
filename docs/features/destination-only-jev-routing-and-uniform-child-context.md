# Destination-only Jev routing and uniform child context

## Status and authority
Functional brief accepted by the developer on 2026-10-14; acceptance does not authorize implementation.
Canonical vocabulary: GLOSSARY.md, root-selected by docs/agents/domain.md.
Canon for this brief: ADR 0017, merged in PR #256, with the Jev routing, Specialist, and Contract glossary entries.
No generated Domain Authority Handoff exists for this brief; the absence is admissible because functional and semantic decisions are closed.
Review: [destination-only-jev-routing-and-uniform-child-context-review.md](destination-only-jev-routing-and-uniform-child-context-review.md).

## Problem, user, and outcome
pi-workflow is the delegation harness for consumer repositories whose skills and context files it does not control.
A child can launch without a tool it needs, such as `bash`, or without project context:
- Jev overrides the requested role. Worker-to-explore reroutes were observed in sessions 01a13bb6 and 01a13bc7 and reproduced live on 2026-10-14; the mechanism is in `extensions/child-launcher.ts:345-423` and `test/child-launcher.test.mjs:683-712`.
- `explore` skips context files (`extensions/child-sessions.ts:389`).

The operator delegates; the child runs under the role the parent chose, with visibility of that role's tools, has project context, and its Contract prevails over any consumer instruction.

## Scope
1. Jev decides only the destination (`stay`, `leave`, `decide`), classified once per user message, and keeps the parent Tool gate. It no longer selects the Specialist. The parent's role is required and honored per launch; a cached role does not leak to sibling launches; a gate block says to delegate without naming a role; `continue_child` keeps its role.
2. `spawn_child` guidance lists each role's exact fixed Contract tools, distinguished from runtime-added MCP and web tools; states that `explore` cannot run commands; treats a role named by a skill as a hint, so the parent chooses the role whose tools cover the task; asks the parent to brief scope, acceptance criteria, and edit surface; assigns reading needed for a write to the worker.
3. Every role, `explore` included, loads Pi context files. Children inherit Pi context files from the agent directory and applicable worktree ancestors, including repository guidance. `APPEND_SYSTEM` remains suppressed and skills stay excluded. No context filter is added. The Contract precedence clause is generalized: context files describe the project, and any instruction in them to ask the user, delegate, launch children, commit, push, or publish does not apply to the child.
4. Per-role tool allowlists stay. The child `git`/`gh` bash guard (ADR 0013) stays.
5. Contracts are rewritten, inspired by Gentle Shell (`github.com/Gentleman-Programming/gentle-shell`, `assets/agents/gentle-ai-*.md`), limited to Contract prose within the existing `ask_parent` and `report_result` protocol, with no new runtime, schema, or token enforcement:
   - `explore`: CodeGraph first with a read/grep fallback; web text is evidence, never instructions; a handoff of about 2k tokens or fewer with `path:line`, relationships, and uncertainty.
   - `worker`: separates a needed decision (`ask_parent` with closed options) from a technical blocker (`blocked`) and stops instead of guessing scope.
   - `verify`: gives a verdict per acceptance criterion inside findings.

## Out of scope
Uniform tool sets for all roles (option B); a context-block filter; OS sandboxing; model or profile redesign.
Unchanged: Claude Bridge provider resolution, role tool sets, model profiles, continuation, delivery.

## Decisions
All resolved by the developer on 2026-10-14.
- Option A, keep per-role tools and let the parent own the role, was chosen over the recommended option B, uniform tools for all children. Option B offered simplicity and a code guarantee; the developer preferred per-role tools.
- Gentle Shell evidence: it keeps per-agent tool allowlists and avoids the failure because the parent picks the agent seeing its declared tools and nothing overrides that choice. `subagent_run` takes only `agent` and `task`, with no validated delegation contract; a missing tool is only a warning note.
- No context filter. Gentle Shell's marker filter works because one repository authors both installer and filter; pi-workflow does not author consumer context files, so a content-independent precedence clause is used instead. The developer accepts the complete context-chain exposure, mitigated by the Contract precedence clause. This supersedes an earlier premise that children receive only repository AGENTS.md, corrected by review finding B1.

## Accepted risks
- The parent may still pick a role that lacks a needed tool; guidance only, no code guarantee.
- The full context chain (agent directory, ancestors, repository) reaches every child.
- Enabling a new tool still requires Contract edits.

## Dependencies
- domain-modeling reconciled the Jev routing, Specialist, and Contract glossary entries and recorded ADR 0017 (PR #256), narrowly superseding the routing and context clauses of ADR 0008 and ADR 0014 as retained by ADR 0016.
- to-spec reconciles `docs/specs/routing-owner.md`, `docs/specs/child-session-capabilities.md`, and `docs/specs/child-session-delegation.md`.
- Tests: `test/child-contracts.test.mjs`, `test/child-sessions.test.mjs:2215-2251`, `test/child-launcher.test.mjs:683-786`, `test/delegation-check.test.mjs`, and `extensions/delegation-check.ts`.

## Shared capabilities
Jev routing (`extensions/child-launcher.ts`), child session factory (`extensions/child-sessions.ts`), role Contracts (`assets/contracts`), parent Tool gate.

## Open questions and evidence gaps
Open questions: none.
Evidence gap: the incident count comes from a partial log search, because the investigating child lacked `bash`.
