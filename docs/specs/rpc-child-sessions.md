# RPC child sessions

Status: READY WITH WARNINGS — functional definition verdict preserved; technical specification candidate awaiting the parent's synthesis verification. Publication, implementation and production adoption remain unapproved.

## Package identity and reading contract

This is the single complete English technical specification for the current execution-scoped definition. It records the proposed behavior and its constraints; it is not evidence of completed publication, approval to implement, or production adoption.

- Source brief: [functional brief](../features/rpc-child-sessions.md), SHA-256 `b5bc3981a5e4ea17937f5284ca29772421cac4f2e007d2d95710be69a3c1ea1b`.
- Final feature-critic report: [functional review](../features/rpc-child-sessions-review.md), SHA-256 `389d7688b264862beeab90028d2d3f3dafb67d9806c8fa730739121c4e522ec7`, verdict `READY WITH WARNINGS`.
- Prototype (reference-only): `.agents/prototypes/rpc-children/`, branch `prototype/rpc-children`, commit `22c7c22`. Evidence, not a base for implementation.
- Tracker: issue #296 (definition) with native blocks on #293, #295 and #204.
- Authority: `AGENTS.md`, `docs/agents/*`, `GLOSSARY.md`, and ADRs 0010, 0013, 0016, 0017, 0018, 0020, 0021 and 0022. No generated Domain Authority Handoff exists: a documented evidence gap, not invented authority.

**Mandatory** means an accepted user decision, an applicable contract, or an indispensable dependency requires it, with its source. **Recommendation** means the evidence supports it but another design may meet the same outcome.

## 1. Problem and intended outcome

A child session shares the parent's process, modules and context. Verified consequences: its stdio MCP servers start in the parent's project directory and its MCP roots announce the parent's project (ADR 0014 R14, #295); extensions loaded into several sessions share module state; every `/reload` ends all working children (R13). Pi 1.4.0 installed as a standalone binary exports no loader that would fix the first from inside the process.

Outcome: every child runs as its own `pi --mode rpc` process rooted in its own worktree, with its own configuration and state, and survives a parent `/reload`. The migration is complete, not staged; there is no coexistence of in-process and RPC children. This is a transport and lifecycle change: every observable behavior of specification #288 and of the Fleet view, Run state, result delivery, Todo and launch limits is preserved.

## 2. Decision and supersession ledger

The user resolved every decision in the feature-discovery conversation, preserved in the brief section named here.

| Decision | Status and source | Effect |
| --- | --- | --- |
| Children run as isolated `pi --mode rpc` processes, one specification with several tickets | Accepted; brief "Problem and outcome" | Replaces in-process children |
| Own-worktree MCP configuration, parent trust mirrored with `--approve`/`--no-approve` | Accepted; brief "User-confirmed behavior" | Supersedes ADR 0014's rule that a child never reads its worktree's MCP configuration; defines ADR 0021's "same sources and configuration" |
| Survive `/reload`; stop with the parent | Accepted; brief | Amends ADR 0010 and removes ADR 0014 R13 for reload; surviving a parent exit stays with #204 |
| Linux and macOS terminate whole trees; Windows documented limit | Accepted; macOS unverified is an accepted risk | Acceptance criterion of the implementation |
| Write-surface admission between children | Accepted; brief "Concurrent writers", critic rounds 2 and 3 | Replaces ADR 0014 D7 (no launch-time check) |
| Parent writes outside admission | Accepted; brief | The guarantee is child to child |
| Claude Bridge and explorer web access stay supported | Accepted; critic round 1 | Visible failures when unavailable |
| Protections of #288 preserved inside the child | Accepted; critic round 1 | Must be demonstrated, not assumed |
| Prototype is reference-only | Accepted; critic round 1 | The specification states outcomes, not the socket, registry or supervisor |

Supersession required by this specification, delivered as a new ADR, numbered when installed, by the ticket that installs it: it supersedes ADR 0016, which carries ADR 0014's in-process decision forward; it amends ADR 0010 so that children and Pending results survive `/reload` and still end with the parent; it replaces ADR 0014 D7. ADRs 0013, 0017, 0018, 0020, 0021 and 0022 stay in force and constrain the child process. The successor carries forward the unaffected Claude Bridge resolution and failure constraints of ADR 0016.

Critic dispositions preserved from the report (resolver: the user; the report records each source):

| Finding | Disposition |
| --- | --- |
| Per-file mutation queue lost across processes (blocker) | Resolved by write-surface admission |
| Conflict with ADRs 0014 and 0016 (blocker) | Rejected: the replacing ADR is a specification deliverable |
| Parent writes outside admission (blocker) | Resolved: the guarantee is child to child |
| Own-worktree MCP against ADR 0021; reload and `continue_child`; Bridge and web access; bash guard and signed commits; admission declaration, lifecycle and path identity; case folding (warnings) | Corrected in the brief |
| macOS whole-tree termination (warning) | Risk accepted |
| Prototype mechanisms as requirements; per-checkout lock instead of surfaces (informative) | Accepted; rejected, because parallel writers in `implement-spec` are a traced need |
| Tracker and capture verification (warnings) | Withdrawn: the parent verified them |

Evidence gaps recorded, not invented: no generated Domain Authority Handoff and no separate read-only authority review exist for this package.

## 3. User stories

- As an operator, I want a child's MCP servers to run in the child's worktree so that relative paths, roots and per-project servers behave as in a normal Pi session in that directory.
- As an operator, I want `/reload` not to kill working children so that I can reload extensions without losing delegated work.
- As an operator, I want children to stop when I close or kill Pi so that no process, MCP server or shell descendant stays behind.
- As an orchestrator running `implement-spec`, I want to launch several writing children in one checkout when their edit surfaces are disjoint, and a refusal that names the conflict when they are not.
- As an operator, I want authorization, consultation, signed commits and the Fleet view to behave exactly as before.

## 4. Observable interface

1. **Launch.** A child is a separate Pi process started with its worktree as working directory, a session directory of its own, the role's curated tools and the selected model and thinking, and exactly one parent trust flag. Readiness is a correlated state response within a bounded deadline; it certifies neither model credentials nor MCP connections. A construction or readiness failure before a child record exists keeps today's operator-visible result, a refused launch with no child launched; a child that dies or goes silent after launch ends failed, never stuck in a starting state.
2. **Configuration.** The child reads the user's global configuration and its own worktree's project configuration. A parent project file that is absent from the worktree, such as an untracked `.pi/mcp.json`, is not inherited; the launch reports the gap instead of falling back silently.
3. **Channel.** Mandatory: the child talks to the parent over a channel separate from the RPC stream, with correlated consultations and reports, and a late answer to a withdrawn question is refused (sources: brief, ADR 0014 V6 behavior kept). Recommended hardening, with its evidence in section 7: peer identity, bounded frames and in-flight requests, deadlines and rejection of work on disconnect.
4. **Authorization and tools.** The child registers `ask_parent`, `report_result`, the guarded bash and, when granted, `checkpoint` locally. Every applicable tool call, including nested tools, passes the child's `tool_call` evaluation, which may block or replace it after consulting the parent. Each path keeps the semantics it has today: the operational guards and grants (ADRs 0013 and 0020) as they apply now, and the contextual path of ADRs 0021 and 0022 as installed, whose production adoption is not approved. The transport change neither enables the unadopted path nor reinstates restrictions those ADRs superseded.
5. **Results.** The structured report is preserved. The final answer is the finalized assistant text; success requires a settled, non-aborted, non-error state and the task's own result validation. Acceptance of a prompt is never completion.
6. **Reload.** `/reload` keeps the same child, session, streams and channel. The re-attaching parent rebuilds the registry, Pending and Consumed results, open questions and in-flight answers, claims, audit and transcript capture, and Todo links without loss or duplication. `continue_child` still resumes a completed child.
7. **Exit.** On a normal parent exit or an abrupt parent death, every child and its descendants, including MCP servers and shell descendants, are terminated on Linux and macOS, within a bounded time. Windows guarantees nothing.
8. **Write admission.** A writing child launch carries the edit surfaces the parent declares; none declared claims the whole checkout. The claim is taken at launch, before queueing, and held while the child is queued, running or waiting. It is released on completion, cancellation or failure; `continue_child` claims again; after `/reload` the claims of surviving children are rebuilt. Claims are compared only within the same resolved launch worktree by canonical path ignoring case, deliberately also on case-sensitive filesystems. Entries that cannot be interpreted overlap everything. Read-only roles claim nothing. A refused launch names the conflicting entries. ADR 0020 grant conditions are unchanged.
9. **Operator view.** Fleet view, children box, Todo, steering, answers, cancellation, launch limits, Run state and result delivery keep their observable behavior.

## 5. State scenarios and acceptance contract

Each scenario is a test obligation; those marked real-binary run against an installed Pi and skip with a stated reason when none is available.

- A child's stdio MCP server prints its working directory and receives roots: both are the worktree (real-binary).
- `--no-approve` skips a project MCP server in the child; `--approve` loads it; an untracked parent configuration is reported absent (real-binary).
- `/reload` leaves the same child process, session and channel in use; a question, answer, Pending result and Consumed result at that moment are neither lost nor duplicated (real-binary).
- Normal exit, SIGKILL of the parent and a crashed child leave no child, MCP or shell descendant on Linux; macOS runs the same cases and is an acceptance gate, unverified at definition time (real-binary).
- A consultation blocks or replaces a tool call in the child; a signing failure, a scope violation and a post-commit check behave as in ADR 0022; the guarded bash refuses a forbidden command in the child.
- Two writers with overlapping surfaces: the second launch is refused with the conflicting entries; with disjoint surfaces both run; a writer without surfaces conflicts with any other writer; cancellation, failure and completion release the claim; `continue_child` reclaims; a reload rebuilds the claims.
- A Claude Bridge model and an explorer with web access work in the child, and fail visibly when their resource is unavailable.
- Launch limits, queueing, cancellation and terminal states match the current behavior for a child that crashes, hangs or never becomes ready; a launch that cannot construct a child is refused with no child launched.
- Hostile and disconnected channel: an unknown peer is rejected, an oversized or excess frame is refused, a deadline expires, and a disconnect rejects pending work (recommended hardening, tested where adopted).
- Completion oracle: a structured report is kept apart from the finalized assistant text, and success requires a settled, non-aborted, non-error state; prompt acceptance alone never completes a child.
- Nested tool dispatch passes the child's authorization evaluation, including a nested call made from a script.
- After `/reload` the audit and transcript capture, the Todo links and the conversation of a completed child are restored, and `continue_child` resumes it.
- Claims: a read-only child claims nothing; claims in different worktrees do not conflict; a claim is held before queueing and while waiting.
- Fleet view, steering, answers and result delivery pass their existing tests unchanged against the RPC adapter.
- Bounded readiness and termination, recommended bounds with their evidence: readiness within 10 seconds (measured 380 to 540 ms, with five concurrent launches, leaving a wide margin for a cold disk); on abort, a grace period of the existing `shutdownDeadline` of 1 second (`child-sessions.ts:208`) before the process tree is killed; whole-tree cleanup within 2 seconds of a parent exit or death (observed under 0.5 seconds in the prototype). All three are named constants and each scenario asserts them.

## 6. Existing seams and coverage limits

Verified in the repository:

- `ChildSessionFactory = (spec: ChildSpec) => Promise<ChildHandle>` is injectable into `createChildSessions`, and `ChildHandle` already exposes `run`, `steer`, `clearQueue`, `abort`, `dispose`, `entries` and metadata (`extensions/child-sessions.ts:107-121`). The registry and state machine depend on that handle. Events enter through `ChildSpec.onEvent` (`:90-97`); the SDK adapter subscribes in `createPiChildSession` (`:550`).
- SDK coupling is concentrated in the default factory: `createAgentSession`, `session.subscribe`, `session.prompt`, `session.abort`, the stream-function patch, the model runtime lookup and the extension runner (`:392-600`). The projection of SDK-shaped events into child state is a second coupling (`:735-779`).
- Transport-agnostic and expected to stay: `child-launcher.ts` planning, `child-projection.ts`, `child-transcript.ts`, `children-view.ts`, `children-box.ts`, `todo-extension.ts`, `model-profiles.ts` and the policy halves of `action-authorization.ts`, `child-checkpoint.ts` and `child-bash.ts`.
- In-process-only mechanisms: the stream-function cancellation patch, the factory's private access to the model runtime, the `jiti` load of `pi-web-access`, the `parentMcp` cwd substitution, and the workarounds for shared module state. Each is a candidate for removal or replacement when the RPC adapter lands, as section 7.9 recommends.
- In-memory state to rebuild after `/reload` lives in the closure of `createChildSessions`, on each child record and in the internal child state that holds questions, answers, withdrawals and capture (`:144-190`, `:654-681`), and in ADR 0010's pending-result queue.
- The package ships `extensions/` (`package.json` `files`), so a child-side extension file there can be addressed from the installed package with `--extension`, provided its imports resolve. The distribution validator lists required resources, so a child-side extension shipped as a new file needs it added.
- Tests: `test/support/child-session.mjs` and `fake-children.mjs` are the real and fake factories; direct child suites and several integration suites use them. A single count of tests that break cannot be derived from file lists; pure policy, projection and render tests should not break, tests that assert SDK events need the new adapter or a transport-agnostic fake. The opt-in `test/*-live.test.mjs` suites exercise the SDK and a model, not a standalone binary; reuse their skip conventions, not their coverage.

Coverage limits: gentle-shell, the comparison, shows no evidence of MCP or trust inheritance, startup measurements or survival across reload, so the Pi behavior here rests on the prototype. The prototype ran one child per supervisor, with an unhardened channel, against Pi 1.4.0 only.

## 7. Recommended implementation decisions

All items are recommendations unless marked mandatory. Vocabulary follows `codebase-design`.

1. **Keep the existing seam; add a second adapter. Recommendation.** Evidence: the handle and factory are already the narrowest seam between the registry and the SDK. Reason: one adapter is a hypothetical seam, two are real; the SDK adapter and the test fake exist today, the RPC adapter is the new one. Extend the handle only where RPC needs it: terminal state on process death, readiness failure, and re-attachment. Normalize RPC events into the existing `onEvent` shape so projection, audit and views are untouched.
2. **A process lifecycle module with a small interface. Recommendation.** One module owns spawn, readiness, abort, whole-tree termination, the lifetime guard and adoption after reload, behind `start`, `adopt` and `shutdown(reason)`. The prototype's supervisor with a lifetime descriptor, its Linux subreaper and its reload-resident handle registry are reference evidence for these three behaviors, not requirements. Mandatory outcomes: reload survival, termination of every process group including MCP and shell descendants, SIGKILL coverage (source: brief). The macOS mechanism is open and is an acceptance gate.
3. **A child-side runtime extension, shipped in `extensions/`. Recommendation.** It registers the child tools, installs the authorization handler and connects to the parent channel. Mandatory: the protections of ADRs 0013, 0020, 0021 and 0022 apply inside the child in the mode each has today (source: brief invariants and critic round 1). Policy code from the existing modules is reused, not copied; their SDK bindings are replaced.
   Channel hardening, recommended: a private socket in a directory only the user can use, peer identity, bounded frames and in-flight requests, deadlines, and rejection of pending work on disconnect. Evidence: the prototype's channel was unhardened (its README, "Proposed falsifiable contract", item 3), and any local process of the same user could otherwise connect. Necessity: the channel carries authorization answers.
4. **A write-claim module with a small interface. Recommendation.** `claim`, `release`, `conflicts` and `rebuild` over a resolved worktree root, pure and unit-testable, with conservative overlap and case folding as in gentle-shell (`lib/writer-surfaces.ts`, gentle-shell#1731). Admission runs in the launch path before the registry reserves or queues (`child-launcher.ts`, `LaunchRequest`). Declaration, recommended: an optional list of repository-relative paths or patterns in the `spawn_child` launch parameters, carried in `LaunchRequest`; evidence: no write-surface field exists today (`child-launcher.ts:30-38`) and the claim must exist before queueing, so the launch request is the earliest place that has it. Mandatory: the behavior in section 4.8.
5. **Reload-resident anchoring. Recommendation.** `/reload` replaces the extension runtime inside the same Pi process, so child handles, the channel, the pending-result queue, open questions and claims are anchored outside the extension module and rebuilt by the re-attaching parent; the prototype showed this with a process-level registry. Mandatory: no loss or duplication across reload (source: brief and ADR 0010 amendment).
6. **Configuration and extension flags. Recommendation.** Launch passes the worktree, the session directory, the selected model and thinking, the role's tools and exactly one trust flag. `--no-extensions` also removes built-in MCP, which must be requested explicitly (prototype finding). Missing parent-only configuration is reported at launch.
7. **Providers and web access. Recommendation.** The launcher resolves the Claude Bridge and `pi-web-access` resources from the same places as today and passes them to the child process, reporting a visible failure when missing (mandatory: brief; mechanism: ticket).
8. **Capacity. Mandatory: no change.** The Launch limit stays at ten working children (queued, running or waiting) and at most five running at once (`child-sessions.ts:206-207`; GLOSSARY "Launch limit", "Working child"), because the brief preserves launch limits as observable behavior. Measured cost is about 130 to 150 MiB of resident memory per child before MCP servers and model context, so five running children cost near 0.7 GiB; this is a recorded risk, and changing the numbers needs a developer decision and renewed review. The current factory constructs a child's handle at launch, before it is queued (`child-sessions.ts:987-992`); with processes that would hold up to ten live processes, near 1.3 to 1.5 GiB. Recommended: start the process when the child begins running, so a queued child opens no process, as ADR 0014 states for its MCP connections.
9. **Removals. Recommendation.** The migration is complete (mandatory, brief), so the in-process paths it replaces should not remain as dead code: the stream-function patch, model-runtime access, `jiti` web-access load, `parentMcp` substitution and module-state workarounds. Cancellation: recommended as an abort request followed by termination of the process tree after a grace period, which makes the patch unnecessary because it exists only to stop a prompt still preparing in process (`child-sessions.ts:553-560`). Each removal is judged when the adapter lands; one still needed stays with its reason recorded.

## 8. Dependencies and native relationships

- #296 is the parent definition issue; its native relationships block #293, #295 and #204. When tickets exist, those relationships move from #296 to the tickets they depend on.
- #281 and #206 are independent.
- Validated on the standalone Pi 1.4.0 only; extensions use public imports only. The supported version range is a ticket decision.
- Builds on the merged specification #288 (ADRs 0021 and 0022).

## 9. Test decisions and completion evidence

- Prefer the existing seam: registry and view behavior through the handle with a transport-agnostic fake; RPC adapter through a fake Pi process speaking the protocol; real-binary tests as live tests with an explicit skip reason.
- Unit tests for the write-claim module cover overlap, uninterpretable entries, case folding, release paths and rebuild.
- `npm run check` stays the gate. Completion needs real-binary evidence for every scenario in section 5, recorded per ticket; the macOS lifecycle evidence must be recorded as met before the lifecycle ticket is completed; until then the gap stays open and prevents completion.
- Adapt tests that assert SDK events; do not weaken policy, projection or render tests.

## 10. Prototype disposition and evidence limits

`.agents/prototypes/rpc-children/` is `reference-only`. It proved, on the installed Pi 1.4.0 and not on the SDK: startup near 380 ms bare, near 500 ms with one extension and 415 to 525 ms for five concurrent children (application-cold and warm, not OS-cold); child-side tools and `tool_call` blocking over a separate channel with a real model; reload survival and Linux cleanup after a normal exit and after SIGKILL in under 0.5 s; own-worktree configuration, roots and trust flags. Limits: one child per supervisor, unhardened channel, macOS unverified, no OS-cold startup, mocks inventoried in its README.

## 11. Out of scope, risks and adoption limits

Out of scope: surviving a parent exit and recovering pending results (#204); an operating-system sandbox; Windows tree termination; admission for the parent's own writes; recursive delegation; a universal tool registry; changing model selection.

Accepted risks: macOS whole-tree termination unverified (user, brief); same-user risk of ADR 0014 R1 persists, since process separation is not a security boundary; case folding may refuse a launch that does not conflict on a case-sensitive filesystem (deliberate, user); the parent can overwrite a child's edits in a shared checkout.

Open for tickets: the macOS mechanism and the supported Pi version range (tested on 1.4.0 only; `package.json` still declares SDK peers `>=1.0.4`).

## 12. Shared-capability invariants and handoff

Invariants for every ticket: the protections of #288 hold inside the child; ADR 0020 grant conditions and ADR 0013 command policy are unchanged; Jev stays routing-only; result delivery, Run state, Fleet view, Todo, launch limits and `continue_child` keep their observable behavior; no child outlives the parent; no silent fallback to the parent's configuration.

Handoff to `to-tickets`: this specification, the review report, parent issue #296, the verdict, the prototype branch and commit above, the accepted risks and deviations listed, the dependencies in section 8, and the candidate seams in section 7 as slicing aids, not as prescribed tickets. Ticket slicing must include the installation of the successor ADR under the next free number, recording of the absent concepts write surface and claim for `domain-modeling`, and, if the child-side extension is shipped as a file in `extensions/`, the update of the distribution validator's required resources.
