# ADR 0018: Procedure discovery before delegated work

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

When routing blocks the parent from reading a required procedure, the parent uses existing `spawn_child` with an appropriate role for bounded discovery before dependent technical work. The child reads the applicable skill and instruction references through its existing tools and returns obligations, prerequisites, sources, and unresolved questions through its role's existing handoff. Missing or unreadable required instructions become explicit blockers with the path and error. Explore has no Verdict; discovery introduces no tool, purpose field, obligation schema, state machine, or fixed child count.

`SKILL.md` and local Markdown references are ordinary routed reads, whether used as instructions or as the object of work. There is no skill-read exception or recursive reference allowlist. A path cannot distinguish those uses. When routing stays or is off, no extra child is required solely for discovery. ADR-0015's delegation-mode stance and ADR-0017's destination-only Jev decision and per-role tools remain unchanged.

The parent retains every mandatory obligation with an owner representation and state across delegation, questions, scope changes, and background delivery. Required reserved setup, including isolated worktree evidence at the pinned head when the procedure requires it, precedes dependent work. Unknown or rejected prerequisite gates stop dependent technical judgment rather than permit a conditional partial review. Every required pass uses the same pinned head; changed-head evidence must be revalidated.

A scoped child success, including `done` with `left_undone`, never by itself completes the user's global objective. The parent reconciles all original obligations after every result, then assigns and completes remaining work or reports an explicit global blocker. An obligation may remain explicitly unowned only with its own blocked state and traceable reason while the global objective is blocked; unowned pending work or omitted ownership is not sufficient accounting. Link a Todo only to the bounded task assigned to the child, not to the broader objective.

Any child launch still releases gated parent tools for that same user message under the existing policy. Discovery-before-dependent-work sequencing is an orchestration contract, not an enforced wait for discovery completion. A new user message needs its own routing decision and launch. Child result schemas, Todo settlement, Jev destination ownership, role tools, and ADR-0013's reserved-operation restrictions remain unchanged.

## Considered Options

- Exempt `SKILL.md` and recursively referenced local Markdown. Rejected during this PR's review: the same path can be instructions or the work target, so path eligibility cannot enforce the intended distinction.
- Use a bounded discovery child only when routing blocks direct reading. Chosen: preserves ordinary routing and existing roles, questions and results without adding a workflow engine.
- Require discovery children regardless of routing, or enforce a new discovery state machine. Rejected: adds mandatory handoffs or new permission semantics beyond the existing gate policy.
- Treat every scoped `done` with remaining parent work as failure. Rejected: successful bounded discovery is compatible with unresolved parent-reserved obligations, provided global reconciliation retains them.

## Consequences

Discovery adds a handoff where direct reads are blocked. The harness does not parse consumer procedures or enforce obligation completion. Same-message tool release is unchanged; prerequisite handling and global reconciliation depend on parent decisions, not permission isolation. Deterministic tests establish gate and transport behavior. Bounded actual-model evaluation observes decisions under controlled child inputs, not universal obedience, historical premature closure, successful worktree setup, or a complete consumer review. ADR-0013's child command guard remains guidance rather than an OS security boundary.
