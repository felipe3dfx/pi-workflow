# ADR 0018: Procedure discovery before delegated work

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Supersedes: ADR-0015 (only the scope of the parent reading exception and its statement that the tool gate stays unchanged).

Before delegating gated work, the parent may discover the applicable procedure by reading `SKILL.md` under a `skills` directory and its explicit local Markdown instruction references. This exception applies in both delegation modes and before any Jev destination decision. It permits instruction discovery, not source inspection, arbitrary Markdown reads, or execution of the procedure's work. Jev still owns the destination; the parent still supplies every child role. Discovery neither records a launch nor releases gated work.

The Tool gate permits those skill reads and local Markdown paths explicitly linked or code-quoted by a discovered instruction, resolved relative to that instruction. References may themselves disclose further Markdown instructions. The reference set is scoped to the current user message. Remote links and non-Markdown work references do not grant discovery access. An unavailable instruction reaches the read tool so its path and error remain observable; the parent contract requires an explicit blocker before dependent work. The harness does not determine which consumer instructions are mandatory or interpret arbitrary prose pointers.

The parent keeps each mandatory obligation with an owner and state across delegation, questions, scope changes, and background delivery. Required reserved setup, including an isolated worktree at a pinned head when the procedure requires it, belongs to the parent and precedes dependent work. Unresolved prerequisite gates stop dependent judgment. Required passes use the same pinned head; changed-head evidence must be revalidated. A scoped child success, including `done` with `left_undone`, never by itself completes the user's global objective. The parent reconciles every result with all original obligations, then continues or reports an explicit blocker when mandatory obligations remain unowned or incomplete.

Child result schemas, Todo settlement, Jev destination ownership, per-role tools, and ADR-0013's child command restrictions remain unchanged. The parent must link a Todo only to the bounded task actually assigned to a child, not to a broader objective.

## Considered Options

- Require a discovery child for every procedure read. This retains the old reading exception but adds a mandatory handoff before the parent can identify the procedure's obligations. The operator chose bounded parent discovery instead.
- Exempt every Markdown read or disable the gate after instruction discovery. Rejected: unrelated work would bypass destination routing.
- Implement a generic obligation execution engine or reject every `done` with remaining parent work. Rejected: consumer skills own workflow, and scoped success with parent-reserved work is compatible with existing contracts.

## Consequences

The read exception is tool behavior; obligation accounting and prerequisite handling are prompt instructions, not guarantees of model obedience. Controlled-provider regressions establish actual tool access, prompt injection, and question/result transport, not a reproduced historical model closure or a completed consumer PR review. The child command guard remains guidance rather than an OS security boundary, as ADR-0013 records.
