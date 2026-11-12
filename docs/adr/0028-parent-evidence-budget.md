# ADR 0028: Parent evidence budget

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Issue: #356.

Amends: ADR-0015, only its rejection of delegation guidance in the `spawn_child` prompt guidelines and its consequence that `opportunistic` adds nothing to the parent; the system prompt in `opportunistic` stays unchanged. ADR-0027, only its clause that Delegation mode is the only delegation guidance; Delegation mode stays the only persistent delegation stance, and nothing below enforces delegation.

The parent spends its context on evidence that a child reads again. Two pieces bound it.

The `spawn_child` guidelines carry a preparation contract: reading that prepares a delegated write goes with the child; the parent reads only what decides the route, never the files the child will read; it passes paths through `references`, the spec reference, and what to change, not file contents; and it copies only short evidence it already has. The contextual `spawn_child` guidelines do not carry it, because the contextual path stays unadopted (ADR-0021).

The harness counts the parent's discovery lookups within one request, the run that a user message starts while the session is idle, only when the session offers the child tools. A user message that arrives during a run, typed by the operator or sent by an extension with `sendUserMessage`, is queued into that run and does not start a new request. When the count exceeds 3 lookups or the text of the counted results exceeds 40,000 UTF-8 bytes, whichever comes first, it sends the parent one exploration-budget notice for that request. Both thresholds are constants in the code, not configuration. A lookup is a successful, non-aborted call to `read`, `grep`, `find`, `ls`, CodeGraph query or explore, or the memory reads `mem_search`, `mem_get_observation` and `mem_context`, whether called directly, nested one level inside `codemode` and no other tool, or exposed by MCP as `mcp__<server>__<tool>`. `bash` counts only when every segment of its command is read-only inspection. Other MCP tools, such as the tracker or Sentry, and web tools do not count, because their results decide the route.

The notice applies in `orchestrator` and in `opportunistic`. It reports the counts, says that further discovery belongs to an explore child, and adds one sentence per mode: in `orchestrator`, reading that prepares a write belongs in that writer's task; in `opportunistic`, preparation for a write the parent does itself stays exempt. It states that it is runtime context for the original task, not a new user request, and that it grants no authority. It is advisory: it never blocks a tool, refuses a launch, or changes a Verdict. The harness delivers it as a steering message, displayed in the TUI, once per request.

## Considered Options

- A runtime writer admission gate, as Gentle Shell has. Rejected: it decides the route for the parent, which ADR 0027 removed.
- Configurable thresholds. Rejected: no operator need is shown; metrics adjust the constants.
- Count tracker, other MCP and web reads. Rejected: they decide the route, and a ticket read by reference is resolved outside this repository (grupo-ilao/skills#222).
- Preparation contract in the guidelines and an advisory runtime notice. Chosen.

Evidence: across 15 `implement` and `implement-spec` sessions that delegated the write, the parent read 678M cached tokens against 287M for all children together, a median of 2.4 times per session. The parent's own tool results were 43% of its conversation bytes and child results 11%; 23% of the parent's `codemode` results exceeded 20 KB, and 11% of launches used `references`. Gentle Shell's preparation contract (`assets/orchestrator-delegation.md`) and exploration budget (`lib/exploration-budget.ts`) address the same cost; its README reports, with n=1, that passing the spec by reference took a case from 23 of 26 checks to all passing (gentle-shell#1718).

## Consequences

The parent may still read past the budget; the notice only tells it once per request, and nothing reports whether it changed course. The notice is runtime context: like other harness messages under ADR 0025, it authorizes no effect, and authority is evaluated where an effect happens.

A parent that implements alone reads more by design, so in `opportunistic` the notice reaches parents for which reading is the work; the mode sentence keeps their inline preparation exempt.

The figures above are the measurement baseline. The thresholds change only with new measurements of the same quantities: parent cached tokens against children's, the share of the parent's own tool results in its conversation bytes, `codemode` results over 20 KB, and launches that use `references`.

A test fixes the byte ceiling of the `spawn_child` guidelines, so the preparation contract cannot grow unnoticed.
