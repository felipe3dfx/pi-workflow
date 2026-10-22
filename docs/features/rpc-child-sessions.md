# RPC child sessions

## Status and authority

Functional brief drafted from the feature-discovery conversation for issue
#296; feature-critic review is pending. This revision does not authorize
implementation, production adoption, or any change to an accepted ADR. The
decision owner is the user; each decision below records the conversation as
its source.

Domain authority: GLOSSARY.md. No generated Domain Authority Handoff was
found; this is a documented evidence gap, not invented authority. The brief
creates no canonical definition.

This brief proposes to replace ADR 0014 (in-process children), already
superseded in part by ADR 0016. It also reopens decisions in
`docs/features/child-session-capabilities.md`, which chose in-process
children without a sandbox, and constrains the implemented ADRs 0020, 0021
and 0022. A replacing ADR is a deliverable of the specification, not of this
brief.

## Problem and outcome

A child session shares the parent's process, modules and context. Three
verified consequences follow:

- Its stdio MCP servers start in the parent's project directory, and its MCP
  roots announce the parent's project (ADR 0014 R14, issue #295). Pi 1.4.0
  installed as a standalone binary exports no loader that would fix this.
- Extensions loaded into several sessions share module-level state.
- Every `/reload` ends all working children (ADR 0014 R13).

Outcome: every child runs as its own `pi --mode rpc` process rooted in its own
worktree, with its own configuration and state, and survives a parent
`/reload`. The migration is complete, not staged.

## User-confirmed behavior

- Motivations that matter most: child correctness and isolation (directory,
  MCP, module state) and robustness (surviving `/reload`, responsiveness). An
  operating-system sandbox is valid but secondary; process separation is not a
  security boundary and the same-user risk of ADR 0014 R1 stays accepted.
- Scope: all children, in one specification delivered as several child tickets.
  No coexistence of in-process and RPC children is planned.
- Reference: gentle-shell, as comparison and inspiration, not an architecture
  to copy.
- MCP and trust: a child reads its own worktree's `.pi/mcp.json` and the user's
  global configuration; the parent's trust decision is mirrored with
  `--approve` or `--no-approve`. A parent `.pi/mcp.json` that is not in the
  worktree does not reach the child, and the launch surfaces that gap instead
  of falling back silently. This replaces the ADR 0014 rule that a child never
  reads its own worktree's MCP configuration.
- Lifetime: children survive a parent `/reload` and the parent re-attaches to
  them. Every child and its descendants stop when the parent Pi exits or dies.
  Surviving a parent exit stays with #204.
- Platforms: Linux and macOS must terminate the whole process tree. Windows
  guarantees nothing and is documented as a known limit.

## Observable scenarios

- A child with a stdio MCP server that prints its working directory reports its
  worktree, and its roots announce the worktree.
- `--no-approve` in the parent skips a project MCP server in the child;
  `--approve` loads it.
- After `/reload` the same child keeps running with the same session and can
  still consult the parent and report its result.
- When the parent exits normally or is killed with SIGKILL, no child, MCP
  server or `bash` descendant remains.
- A child asks the parent a question and waits for the answer over a channel
  separate from the RPC stream; a tool call in the child can be blocked or
  replaced after that consultation.

## Existing capabilities and invariants

Every protection from specification #288 is preserved: contextual
authorization (ADR 0021), recoverable consultation, and task-authorized signed
commits (ADR 0022), plus ADR 0020 checkpoints, ADR 0013 command policy, ADR
0017 routing and ADR 0018 procedure discovery. Availability grants no commit or
publication authority. Child results, Pending result and Consumed result
semantics (ADR 0010), the Fleet view, Run state, Launch limit and the Todo box
keep their observable behavior. Replacing the transport must not change what
the operator sees or approves.

## Accepted prototype evidence

`.agents/prototypes/rpc-children/` (disposition: reference-only), exercised
against the installed standalone Pi 1.4.0 and not against the SDK:

- Startup: first `get_state` at about 380 ms for a bare child, about 500 ms with
  one extension, 415 to 525 ms with five children started together; about
  130 to 150 MiB resident memory per child (application-cold and warm; OS disk
  cache not measured).
- Child-side tools: an extension in the child registers consultation, result
  and guarded-bash tools, blocks and replaces calls in `tool_call`, and talks to
  the parent over a Unix socket. A real model exercised them. This corrects the
  ADR 0014 claim that RPC children lose custom tools, for Pi 1.4.0.
- Reload and exit on Linux: a registry anchored outside the module keeps the
  child, its pipes and its channel across `/reload`. Normal exit and SIGKILL
  both left no descendants in under 0.5 s using an independent supervisor with
  a lifetime descriptor. MCP and `bash` create their own process groups, so one
  group kill is insufficient.
- Configuration and trust: verified as described above.
- `--no-extensions` also removes the MCP extension; it must be requested
  explicitly with `--extension builtin:mcp`.

## Open decisions, risks and evidence gaps

- macOS whole-tree termination is not verified and is an acceptance criterion.
  The Linux subreaper is not portable.
- Pi's per-file mutation queue, which serializes edits of one file across
  in-process children and the parent (ADR 0014, D7), is lost across processes.
  Whether separate worktrees make that acceptable, or a replacement is needed,
  is not decided.
- How consultation, cancellation, disconnects and withdrawn answers behave over
  the parent channel is only prototyped, without hardening.
- Memory scales per child; concurrency limits need a budget based on the
  measured cost.
- The explorer's `pi-web-access` load and the stream-function patch for
  cancellation exist because children are in-process; their fate is a
  specification decision.
- Whether #204 and #281 change shape under RPC is for their own definitions.

## Dependencies

Blocks #293, #295 and #204 (native links on #296). Issues #281 and #206 are
independent.

## Next step

Run `feature-critic` on this brief, apply accepted dispositions, then hand the
package to `to-spec` and later `to-tickets`.
