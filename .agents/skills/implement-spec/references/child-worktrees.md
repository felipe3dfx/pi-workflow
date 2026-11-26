# Child Worktrees

Read this file at step 3 before starting a child.

- Every child runs in its own worktree of its child branch, created or reused outside this run's checkout. That checkout stays on the parent, so only step 4 changes it.
- Before the child starts, confirm its worktree has the child branch checked out at that branch's head with no uncommitted changes. When the worktree cannot be created or confirmed, the ticket does not start; report it and name the cause.
- Siblings the plan does not serialize may run in parallel only when `docs/agents/quality.md` records a `supported` Scratch Evidence state with an isolation for state shared across checkouts, such as databases, services, ports, and caches. Otherwise start the next child only after the previous ticket integrates or stops.
- Remove a child's worktree once its ticket integrates, or before step 3 recreates its branch, only when it holds no uncommitted changes; never force it. Keep a stopped ticket's worktree for re-entry, leave every worktree in place on cancellation, and name each kept worktree in the report.
