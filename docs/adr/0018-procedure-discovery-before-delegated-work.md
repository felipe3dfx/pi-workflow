# ADR 0018: Procedure discovery before delegated work

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Before dependent work, the parent learns the obligations of any mandatory procedure: it reads the procedure when reading is allowed, otherwise delegates discovery through the existing child tools. `SKILL.md` and local Markdown references remain ordinary routed reads, whether used as instructions or as the object of work. There is no read exemption, reference allowlist, new role, or fixed child count. ADR-0015's delegation-mode stance and ADR-0017's destination-only Jev decision and per-role tools remain unchanged.

The parent tracks each obligation with an owner and a state (pending, satisfied with evidence, or blocked with reason) across child questions, scope changes, and background results. An unmet mandatory prerequisite stops dependent work rather than permitting qualified partial work. Mutating git or gh commands and publication remain reserved for the parent; when a procedure requires them, such as worktree setup, the parent runs them itself before dependent child work.

A child's done or pass covers only its task. The parent reconciles left_undone and unverified against the remaining obligations, then continues or reports an explicit blocker. Child contracts, result schemas, role tools, and ADR-0013's reserved-operation restrictions are unchanged.

The leave-block message points the parent toward delegated discovery when procedure instructions are needed. Any child launch still releases gated parent tools for that same user message under the existing policy. Discovery-before-dependent-work sequencing is a parent instruction, not an enforced wait for discovery completion. A new user message still needs its own routing decision and launch.

## Considered Options

- Exempt skill paths and referenced Markdown. Rejected: the same path can be instructions or the work target.
- Keep ordinary routing and explicitly instruct the parent to discover, retain, and reconcile obligations. Chosen: uses existing tools without changing child policy.
- Add child prerequisite policies or a workflow state machine. Not included in the approved parent-only scope.

## Consequences

Discovery can add a handoff when reading is not allowed. The harness does not parse consumer procedures or enforce their completion. Deterministic tests cover the gate message, actual parent-prompt injection, and preservation of scoped child results and remaining obligations through questions and background delivery with one or several children. They do not prove model compliance, reproduce historical premature closure, or establish causal improvement over the baseline. Runtime gate policy and tool release remain unchanged; no new child contract, schema, tool, or release change is introduced.
