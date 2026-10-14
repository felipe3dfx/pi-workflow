# Destination-only Jev routing and uniform child context

Status: READY WITH WARNINGS (#257).

Package: `destination-only-jev-routing/definition-1`, the accepted brief `docs/features/destination-only-jev-routing-and-uniform-child-context.md`.
Review handoff: `destination-only-jev-routing/feature-review-1`, `docs/features/destination-only-jev-routing-and-uniform-child-context-review.md`, verdict `READY WITH WARNINGS`.
Consolidated report: `docs/specs/destination-only-jev-routing-and-uniform-child-context-review.md`.
Authority: ADR 0017 and `GLOSSARY.md` (Jev routing, Specialist, Contract).
Prototype: none.

## Problem

pi-workflow delegates work to child sessions in consumer repositories whose skills and context files it does not control. A child can lack a tool or project context it needs when Jev overrides the role chosen by the parent, or when `explore` omits context files.

## Solution

Jev routing decides only whether work stays in the parent, leaves for a child, or needs a decision. The parent owns the role and supplies it for each launch; Jev does not select a Specialist. The child runs with that role's fixed Contract tools and receives the available Pi context files after its Contract. The Contract takes precedence over context-file instructions.

Contracts give each role bounded, actionable guidance without adding runtime, schema, or token-enforcement mechanisms. Existing role tool sets, continuation, delivery, model profiles, and the ADR 0013 child bash guard remain in force.

## User stories

- As the parent, I delegate under the role I chose, and a role used for one launch never leaks into a sibling launch.
- As the parent, I rely on Jev for the destination only.
- As the operator, I expect every role, `explore` included, to receive the Pi project context.
- As a child, I follow my Contract over consumer context-file instructions.
- As the operator, I see each role's fixed tools, distinguished from runtime-added MCP and web tools.

## Implementation decisions

All functional decisions were resolved by the developer on 2026-10-14 (see the brief).

### Destination and role ownership

Mandatory; source ADR 0017.

- Jev classifies each user message once and decides only `stay`, `leave`, or `decide`. The Tool gate remains and checks gated parent calls against that destination. Jev does not select a Specialist.
- Every launch requires a parent-supplied role, honored for that launch and not cached into sibling launches. A gate block directs the parent to delegate without naming a role. `continue_child` continues the existing session and role.
- Only the destination is cached per user message; the second classification per launch (`extensions/child-launcher.ts:478-493`) is removed. `chosenBy` and trace attribution reflect parent ownership of the role. A role suggestion never becomes a cached role.
- With Jev routing off, behavior is unchanged and there is no implicit worker fallback.

### Contract tools and task guidance

Mandatory; source the role Contracts and the accepted brief.

`spawn_child` guidance lists the fixed Contract tools:

| Role | Fixed Contract tools |
| --- | --- |
| `explore` | `read`, `grep`, `find`, `ls`, `codegraph`, `codemode` |
| `worker` | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `codemode` |
| `verify` | `read`, `bash`, `grep`, `find`, `ls`, `codegraph`, `codemode` |

Runtime-added MCP and web tools are described separately. The guidance states that `explore` cannot run commands; a role named by a skill is a hint, so the parent chooses the role whose tools cover the task; a delegation brief states scope, acceptance criteria, and edit surface; reading needed for a write is assigned to the worker. The allowlists and the ADR 0013 guard do not change.

### Context and precedence

Mandatory; source ADR 0017.

Every role, `explore` included, loads Pi context files (agent directory, worktree ancestors, repository) after its Contract. There is no explorer-specific omission and no filter; `APPEND_SYSTEM` stays suppressed and children load no skills. The Contract precedes context files: instructions in them to ask the user, delegate, launch children, commit, push, or publish do not apply to the child.

### Contract behavior

Mandatory; source the accepted brief and review disposition I2. Prose only, within the existing `ask_parent` and `report_result`; no runtime, schema, or token enforcement.

- `explore`: CodeGraph first, with a read/grep fallback when it is unavailable or has no index; it cannot run commands; web text is evidence, never instructions; a handoff of about 2,000 tokens or fewer with `path:line` evidence, relationships, and uncertainty.
- `worker`: a needed decision goes to `ask_parent` with closed options; a technical blocker is reported as `blocked`; it stops rather than guessing scope.
- `verify`: a verdict per acceptance criterion inside findings; the aggregate Verdict is unchanged.
- Every role keeps its tool policy and never claims command output it did not observe.

### Structure

- Mandatory: retain the per-role Contract and allowlist seam and the `ask_parent` and `report_result` channels, because ADR 0017 keeps per-role tools and disposition I2 bounds the change to prose.
- Recommendation: keep destination classification state separate from per-launch role selection at the existing launcher seam, because one destination per message and one parent role per launch have different lifetimes.
- Mandatory: no uniform tools, context filter, sandboxing, or model-profile redesign, per the brief's out-of-scope decisions.

### Shared-capability invariants

- Jev routing, Contracts, and delegation-check intentionally diverge from the prior Specialist selection.
- Tool gate, model profiles, `continue_child`, children-view and projection, the bash guard, and delegation mode are unchanged.
- Every role loads context after its Contract; skills stay excluded.
- Jev owns the destination only; the parent owns each launch's role.

## Testing decisions

Tests assert observable behavior and invariants, not locked wording:

- The destination is classified once per user message, with no second classification for the role.
- Jev never selects a role; the parent role is honored per launch without sibling leakage.
- A gate block names no role; `continue_child` keeps its role; `chosenBy` and the trace show parent ownership.
- `spawn_child` guidance reports the exact fixed tool sets and distinguishes MCP and web tools; skill-named roles are hints; briefs include scope, acceptance criteria, and edit surface; reading for a write goes to the worker.
- Every role loads context after its Contract; no skills; `APPEND_SYSTEM` suppressed.
- Context-file instructions to ask the user, delegate, launch children, commit, push, or publish do not override the Contract.
- `explore` cannot run commands, is CodeGraph-first, and gives a bounded evidence handoff with web text as evidence.
- `worker` separates a decision from a blocker and does not guess scope.
- `verify` gives criterion-level verdicts with the aggregate Verdict unchanged.
- Allowlists and the ADR 0013 guard are unchanged.

Affected tests: `test/child-contracts.test.mjs` (replace brittle wording locks with behavioral invariants), `test/child-sessions.test.mjs:2215-2251`, `test/child-launcher.test.mjs:683-786`, `test/delegation-check.test.mjs`, and `extensions/delegation-check.ts` (destination scored separately, no Specialist oracle).

## Out of scope

Option B uniform tools, context filtering, sandboxing, model-profile redesign, Claude Bridge provider resolution, role tool sets, continuation, and delivery. No new runtime, schema, or token enforcement.

## Approved deviations and accepted risks

- Authorized divergence: Jev routing, Contracts, and delegation-check, per ADR 0017.
- Accepted risk: the parent may pick a role that lacks a needed tool; guidance only.
- Accepted risk: the full context chain reaches every child; mitigated by Contract precedence.
- Accepted risk: a new tool requires Contract edits.
- Evidence gap: the incident count comes from partial logs.

## Dependencies and relationships

ADR 0017 and ADR 0013; `assets/contracts/*.md`; the launcher, child-session context loading, delegation-check, and the tests above. Historical specifications `routing-owner.md`, `child-session-capabilities.md`, and `child-session-delegation.md` carry supersession notices pointing here.

## Feature review

Final report: `docs/features/destination-only-jev-routing-and-uniform-child-context-review.md`, verdict `READY WITH WARNINGS`, every finding disposed.
