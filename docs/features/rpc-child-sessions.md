# RPC child sessions

## Status and authority

Functional brief drafted from the feature-discovery conversation for issue
#296; feature-critic round 1 dispositions are recorded below and the renewed
verification is pending. This revision does not authorize
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
  reads its own worktree's MCP configuration. Under ADR 0021, "the same tool
  sources and configuration" means the user's global configuration plus the
  project configuration of the session's own worktree, resolved by Pi as for
  the parent.
- Lifetime: children survive a parent `/reload` and the parent re-attaches to
  them. Every child and its descendants stop when the parent Pi exits or dies.
  Surviving a parent exit stays with #204.
- Platforms: Linux and macOS must terminate the whole process tree. Windows
  guarantees nothing and is documented as a known limit.
- Concurrent writers: Pi's per-file mutation queue no longer spans children,
  so concurrent writing children in one checkout are admitted only when the
  edit surfaces they declare are disjoint, as in gentle-shell
  (`lib/writer-surfaces.ts`, gentle-shell#1731). A launch whose surfaces
  overlap an active writer's is rejected and names the conflicting entries; the
  claim is released when the child finishes. Surfaces that cannot be
  interpreted count as overlapping. Read-only children claim nothing. This
  replaces the ADR 0014 D7 rule that children carry no launch-time check.
  The need is parallel work: `implement-spec` can run several writing children
  at once when the orchestrator splits the work, and the admission is the
  backstop for a split that overlaps.
  - The parent supplies the surfaces when it launches a writing child. A writer
    that declares none claims the whole checkout. Where the declaration lives in
    the task contract is a specification decision.
  - A claim is taken at launch, before queueing, and held while the child is
    queued, running or waiting. It is released on completion, cancellation or
    failure. `continue_child` is a new launch and claims again. After
    `/reload` the re-attaching parent rebuilds the claims of the surviving
    children.
  - Claims are compared only within the same resolved launch worktree, by
    canonical path and ignoring case. The case folding is deliberate even on
    case-sensitive filesystems: an unnecessary refusal is preferable to lost
    edits where the two names are one file. Admission does not change the
    conditions of an ADR 0020 `checkpoint` grant.
  - The parent's own writes are outside the admission, deliberately: the
    guarantee is between children, and the parent answers for its own edits as
    it did under D7.

## Observable scenarios

- A child with a stdio MCP server that prints its working directory reports its
  worktree, and its roots announce the worktree.
- `--no-approve` in the parent skips a project MCP server in the child;
  `--approve` loads it.
- After `/reload` the same child keeps running with the same session and can
  still consult the parent and report its result.
- When the parent exits normally or is killed with SIGKILL, no child, MCP
  server or `bash` descendant remains.
- A second writing child whose declared surfaces overlap an active writer's in
  the same checkout is refused at launch; one with disjoint surfaces runs.
- A question, an answer in flight, a Pending result or a Consumed result at
  the moment of `/reload` is neither lost nor delivered twice, and
  `continue_child` still resumes a completed child afterwards.
- A child asks the parent a question and waits for the answer over a channel
  separate from the RPC stream; a tool call in the child can be blocked or
  replaced after that consultation.

## Existing capabilities and invariants

Every protection from specification #288 is preserved: contextual
authorization (ADR 0021), recoverable consultation, and task-authorized signed
commits (ADR 0022), plus ADR 0020 checkpoints, ADR 0013 command policy, ADR
0017 routing and ADR 0018 procedure discovery. Availability grants no commit or
publication authority. The specification must demonstrate that the guarded
bash, contextual authorization and signed scoped commits are effective inside
the RPC child, including nested tools, signing failure and post-commit checks;
the prototype showed one guarded command only. Claude Bridge models (ADR 0016)
and the explorer's web access remain supported in RPC children, with visible
failures; removing either needs a separate decision. Child results, Pending result and Consumed result
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
- How consultation, cancellation, disconnects and withdrawn answers behave over
  the parent channel is only prototyped, without hardening.
- Memory scales per child; concurrency limits need a budget based on the
  measured cost.
- The stream-function patch for cancellation exists because children are
  in-process; its fate is a specification decision. How the explorer's
  `pi-web-access` and Claude Bridge are provided to an RPC child is too.
- Whether #204 and #281 change shape under RPC is for their own definitions.

## Critic round 1 dispositions

Resolver: the user, in the feature-discovery conversation. Findings come from
the three independent feature-critic lenses over commit `58af30e`.

- Per-file mutation serialization lost across processes (blocker): resolved by
  the write-surface admission decision above; replaces ADR 0014 D7. Round 2
  added: parent writes outside the admission (blocker, resolved by stating the
  child-to-child scope, user decision); declaration, claim lifecycle and path or
  checkout identity (warnings, corrected as written above); a per-checkout lock
  instead of declared surfaces (informative, rejected: parallel writers in
  `implement-spec` are a traced need). Round 3: case-insensitive comparison on
  case-sensitive filesystems (warning, corrected by stating the deliberate
  conservative refusal).
- Conflict with ADRs 0014 and 0016 (blocker): rejected. The brief declares the
  replacement; the replacing ADR is a deliverable of the specification.
- Own-worktree MCP against ADR 0021, reload reconciliation and `continue_child`,
  Claude Bridge and explorer web access, and preservation of bash guard and
  signed commits (warnings): corrected in this brief as written above.
- macOS whole-tree termination (warning): risk accepted by the user, because it
  cannot be verified in the available environment. It remains an acceptance
  criterion of the implementation.
- Prototype mechanisms as requirements (informative): accepted. The prototype
  stays reference-only and the specification states observable outcomes, not the
  socket, registry or supervisor.
- Withdrawn: tracker and capture verification findings; the parent verified
  them.

## Dependencies

Blocks #293, #295 and #204 (native links on #296). Issues #281 and #206 are
independent.

## Next step

Return the corrected brief to `feature-critic` for reverification of the
corrected findings, then hand the package to `to-spec` and later `to-tickets`.
