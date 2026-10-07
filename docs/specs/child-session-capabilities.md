# Child session capabilities and Fleet view

Status: READY. The contradiction found during synthesis (C1) and the open items C2 to C5 are resolved by owner dispositions (under "Owner dispositions"). The owner also disposed B1 (worker and verifier children load the parent's context files) and B2 (R13: `/reload` ends every working child, with a notice at `session_shutdown`), after an analysis of `badlogic/pi-subagent` and Pi's sources.

Package: `docs/features/child-session-capabilities.md`, CONFIRMED by the owner. Its sha256 prefix is `048b0d37`. The package also includes `GLOSSARY.md` (`a5e8153b`) and the accepted ADRs 0001 to 0013.
Review handoff: the Domain Authority review, renewed each round and consistent with ADRs 0001 to 0013, with deviations DV1 to DV5 declared. It also includes the owner's dispositions R1 to R13 and K-A to K-F, and the focused reverification of W1 and I1.
Verdict: READY WITH WARNINGS (`docs/specs/child-session-capabilities-review.md`, which includes items 23 to 29).

## Problem

The operator works with Pi and delegates to child sessions. Today a child session is a bare session. It has no `codemode`, no MCP servers, and no web access. It reads one file per tool call and spends turns on work the parent does in one `codemode` script. The parent can launch several children only through separate tool calls, so a fan-out costs one turn per child. The operator can follow children in the overlay. The operator cannot steer a running child, answer a waiting one, or see what each child changed.

Discovery rejected running each child as a separate Pi process over RPC. That design moves the child orchestration instead of removing it, loses SDK custom tools, and pays off only with an operating-system sandbox. Children stay in-process without a sandbox (D1).

## Solution

A child session uses the tools the parent already has. Five layers ship in order, and each one ships on its own.

| Layer | Delivers | Main seam |
|---|---|---|
| 1 | Pi 1.0.4, and `codemode` in every Specialist | The child session factory and its Pi adapter |
| 2 | The extension lifecycle in children, MCP like the parent, web access for the explorer, catalog descriptions, contract wording, ADR 0014, and the delegation spec edit | The child session factory, the child-session core's end paths, and the contracts |
| 3 | Fan-out from a `codemode` script, a Specialist per launch, and a launch limit | The launcher's routing decision and the child-session core's launch |
| 4a | The Fleet view: per-row and total tokens and cost, steering a running child, and answering a waiting child | The children overlay and the child-session core's reply |
| 4b | Changed files per child, grouping by the launching `codemode` call, and the last result of a timed-out child | The child-session core's event tracking and the children overlay |

## User stories

- As the operator, I see a child compose reads, searches, and MCP calls in one `codemode` script instead of spending one turn per call.
- As the operator, every Specialist reaches the same MCP servers as the parent, with the parent's project trust, and I configure nothing for children.
- As the operator, an explorer searches and reads the web when `pi-web-access` is installed locally. A worker or verifier never does.
- As the operator, the parent launches several children from one `codemode` script, and the results reach it in one message when the children are done.
- As the operator with Jev routing on, each child of a mixed fan-out gets its own Specialist, and the destination is still decided once for my message.
- As the operator, a runaway fan-out is refused at the launch limit instead of filling the queue without bound.
- As the operator, the Fleet view shows each child's tokens and cost, including usage inside its scripts, plus a total.
- As the operator, I steer a running child from the Fleet view without cancelling it.
- As the operator, I answer a waiting child from the Fleet view, and the parent learns my answer when it tries to reply.
- As the operator, I see the files each child changed through its own `edit` and `write` calls, the children of one script grouped together, and the last result a timed-out child reported.
- As the maintainer, two children of the same Specialist and model start from the same cached prefix, and the harness only appends to a child session.

## Vocabulary used by this specification

These terms are not glossary entries. This specification uses them with the meanings below. Adding them to the glossary is a gap for `domain-modeling`, not a decision here.

- **Tool gate**: the parent's `tool_call` check that applies the routing decision for the current user message (ADR 0008, `docs/specs/routing-owner.md`).
- **Contract**: the harness child contract file for a role. Its `tools:` line lists the tools a launch checks. Its body is the child's custom prompt.
- **Trace**: the harness's record of a child's launch and run, which the operator reads in the Fleet view.
- **Working child**: a child whose Run state is queued, running, or waiting.
- **Launch limit**: the bound on a parent's working children (D12).
- **Group**: the children launched by one parent `codemode` call.
- **`pending` launch outcome**: the existing launch result for a model or thinking mismatch, "The work stays pending". It is not a Pending result.
- **Jev answer**: what one Jev call returns, a destination and a Specialist. It is not a Verdict, which is the Specialist's conclusion.

## Implementation decisions

Each structural decision carries a label. **Mandatory** means that an applicable authority, an accepted decision (D1 to D14), an approved deviation, a consumer contract, or an indispensable dependency requires it. Each one names its source and necessity. **Recommendation** means an evidenced design choice that serves a stated need. Implementation may replace a recommendation with another design that preserves every mandatory decision and invariant.

These decisions apply to every layer:

- **Mandatory.** The layers ship in the order 1, 2, 3, 4a, 4b. Each layer is independently mergeable and keeps `npm run check` green. Source: the brief's Scope ("in delivery order. Each layer ships on its own") and `AGENTS.md`. Necessity: it constrains the native relationships below.
- **Mandatory.** Children stay in-process. There are no child processes, no RPC transport, no operating-system sandbox, and no Pi Durable. Source: D1 and the out-of-scope list. Necessity: accepted decision.
- **Mandatory.** Cache-first. The harness only appends to a child session. It fixes the contract, the cwd, and the tool allowlist with its order at launch and never rewrites them. It never rewrites messages already sent. Persisted harness data never enters the model context. The task and its references go in the user message. Source: D14 and the Cache-first scenario. Necessity: accepted decision.
- **Mandatory.** Text from a child, a model, or the operator that the Fleet view renders goes through the terminal-safe forms: changed paths, steer text, answers, group labels, and the last result. Source: the Terminal-safe text invariant in `docs/specs/deep-harness-modules.md`. Necessity: security invariant.
- **Mandatory.** The child bash policy of ADR 0013 stays in force, including its deferral of `rm` and SQL guards. Source: D8. Necessity: accepted decision.

### Layer 1. `codemode` in children and Pi 1.0.4

Evidence: the peer range, the development pins, and the sandbox's version assertion all name Pi 1.0.3. In Pi 1.0.3, a child allowlist filters every tool it does not name, MCP tools included. Pi 1.0.4 matches allowlist patterns and activates matching `direct` tools. The Pi internals that Chrome patches are byte-identical between 1.0.3 and 1.0.4, and the `pi-tui` dist has no code change. Today a child is created with extensions disabled, and its allowlist is the contract's tools plus `ask_parent` and, for a worker or verifier, `report_result`. Pi's `codemode` extension registers its tool inactive and exposes `models` unless told otherwise. With a custom prompt, Pi adds no tool rules, so `codemode`'s batching guideline never reaches a child.

- **Mandatory.** The first change of layer 1 moves the three Pi packages to 1.0.4: the peer range, the development pins, and the sandbox's version assertion. Source: the brief's Scope 1 and Dependencies. Necessity: D4's callable set needs Pi 1.0.4's allowlist matching. A 1.0.3 installation would silently lose MCP in children.
- **Mandatory.** That change re-verifies Chrome against Pi 1.0.4. Source: ADR 0007 ("Every Pi upgrade requires re-verifying the chrome"). Necessity: consumer contract.
- **Mandatory.** Every Specialist loads Pi's `codemode` extension, and every contract's `tools:` line gains `codemode`. `codemode` is a contract tool, so the launch checks it as it checks the other contract tools, and a missing one refuses the launch as today. Source: Scope 1, the MCP scenario ("`codemode` is a contract tool checked at launch"), and Dependencies. Necessity: approved behavior.
- **Mandatory.** A child's `codemode` has no `models` API. Source: the out-of-scope list and the Composing scenario. Necessity: approved behavior.
- **Mandatory.** Every inner call of a child's script passes the same allowlist and hooks as a direct call. An inner `bash` call reaches the guarded child bash of ADR 0013. Source: the Composing scenario, A1, and D8. Necessity: approved behavior. A1 is a platform fact that a test asserts on Pi 1.0.4.
- **Mandatory.** The harness adds no path check on `edit` or `write`. Pi runs two mutations of one file one after the other (`withFileMutationQueue`) and mutations of different files in parallel. Source: D7, the Composing scenario, and the out-of-scope list. Necessity: accepted decision.
- **Mandatory.** Every contract carries the `codemode` batching guideline, and the explorer's and verifier's read-only wording covers `codemode`. Source: Dependencies. Necessity: Pi adds no tool rules to a custom prompt, so the contract is the only place for the guideline.
- **Recommendation.** The child session factory's Pi adapter adds `codemode` as an inline extension factory with `models` off. It does not use an extension path. Evidence: Pi exports the factory, and inline factories load even with extensions disabled. Need: no package lookup and no install path for a built-in extension.

### Layer 2. Extension lifecycle, MCP, web access, catalog, contracts, ADR 0014

Evidence: the child-session core creates a child's session before it queues the child, and it calls the handle's run when the child starts. Every end path calls the handle's dispose: finish, the refusals after creation, the foreground path's cleanup, and the parent session's end. Pi's `dispose` emits no `session_shutdown`. Pi's MCP extension connects on `session_start` and closes connections only on `session_shutdown`. It reads its project configuration from the session's cwd, which for a child is the worktree, under the session's trust decision. The child's in-memory settings trust the project by default. Today a child is created with context files disabled. Pi's own default loads its context files into every session, and its `docs/sdk.md` and `badlogic/pi-subagent` treat skipping it as a deliberate bypass. A `continue_child` continuation creates a new session. The harness looks for companions under its own agent-home resolution, while Pi and the child's resource loader use Pi's agent directory.

- **Mandatory.** A child's extensions are `codemode` and MCP, plus `pi-web-access` for the explorer. A child never loads the harness extension. It never offers `spawn_child`, the parent's child tools, or the parent's screen places. Source: the No recursion scenario, D10, and DV1. Necessity: approved behavior.
- **Mandatory.** A queued child has no running extensions. When it starts running, its extensions start. When it completes, fails, is cancelled, or times out, they shut down and its MCP connections close. The same applies to a refusal after the session was created, to the parent session's end for queued and working children, and to a foreground child in print and json modes. A `continue_child` continuation gets its own extensions under the same rule. Source: the Extension lifecycle scenario and the invariant that children end with the parent session. Necessity: approved behavior. Without it, MCP never connects, or stdio servers outlive the child.
- **Mandatory.** A worker and a verifier load the same context files as the parent: Pi's context files (the global agent-directory AGENTS.md, the ancestor directories' files, the CLAUDE.md fallback, AGENTS.override.md, and the repository's AGENTS.md). The explorer loads none. No child loads skills. Pi adds the context files after the contract, and every child of one worktree reads the same files, so the prefix stays deterministic per Specialist, model, and worktree. Source: owner disposition B1, the Repository guidance scenario, and D14. Necessity: a worker that edits code without the repository's conventions is the largest gap in the design, and Pi's default is that every agent obeys AGENTS.md. A test asserts it.
- **Mandatory.** `/reload` ends every working child, like every session shutdown. On Pi's `session_shutdown` with reason `reload`, the harness notifies the operator how many working children ended and records it in the trace. Neither the Fleet view nor the children box shows them after the reload. Source: owner disposition B2' and R13. Necessity: accepted risk. Survival across a reload belongs to #204.
- **Recommendation.** The lifecycle lives behind the child session factory. The Pi adapter starts extensions inside its run, before the first prompt, with the session's `bindExtensions`. Its disposal has the shape of Pi's `AgentSessionRuntime.dispose`: the session's extension runner emits `session_shutdown`, then the session is disposed. Disposal becomes asynchronous, and the core never delays a result's delivery while it waits for shutdown. Evidence: the core already calls run at start and dispose on every end path. The fake factory in the tests is a second adapter, so the seam is real. Pi's `session.dispose()` alone emits no shutdown and leaves MCP connected. Need: one owner for the lifecycle, and the core's end paths stay as they are.
- **Mandatory.** A child receives the servers of the user's global `mcp.json`. It also receives the parent's project `.pi/mcp.json`, but only when the parent trusts the project. A child never reads its own worktree's MCP configuration and never trusts a project the parent did not trust. Source: the MCP scenario. Necessity: approved behavior and a fail-closed trust invariant.
- **Recommendation.** The child's MCP extension receives a configuration loader bound to the parent's cwd and trust decision. The trust decision comes from the parent's `isProjectTrusted`, and the child's settings carry it explicitly. Evidence: Pi's MCP loader reads the child's cwd and trust, and in-memory settings default to trusted. Pi does not export its MCP config loader, so the loader needs a reimplementation of the global plus trusted-project reading or an upstream export (V7). Need: the child's trust fails closed.
- **Mandatory.** The child's allowlist carries `mcp__*` and the MCP resource tools `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`. Every MCP tool, `direct` or reachable only from `codemode`, is available to the child as it is to the parent. Source: D4 and the MCP scenario. Necessity: accepted decision. Without the pattern, `direct` tools such as context7 stay inactive. Without the three names, any `mcp__` entry filters out the resource tools.
- **Mandatory.** MCP connects and waits as in the parent. Pi waits up to 10 s for servers with `direct` tools before the first prompt, and a script waits for the servers it names. A server that connects later is declared then. Pi's "still connecting" notice goes to the child's trace. The harness adds no MCP wait and does not freeze the tool set. MCP and web tools are not checked at launch. Source: the MCP scenario, D14, and the out-of-scope list. Necessity: approved behavior. Late declaration is inherited Pi behavior (R9).
- **Mandatory.** Every server in the MCP server catalog gains a `description`, so Pi's `mcp_servers` section does not change when a server connects. The description reaches the user's `mcp.json` only through Configure's existing plan and apply. Until then, and for user servers without a description, R9 applies. Source: Scope 2, Dependencies, the Cache-first scenario, ADR 0001, and ADR 0009. Necessity: ADR 0001 forbids changing the user's Pi environment outside the explicit command.
- **Mandatory.** The explorer loads `pi-web-access` from the user's local installation, whether or not its companion expectation is on. The harness passes only a resolved local directory, never a package source that can install. A missing companion is never installed. When it is missing, the explorer launches without web tools, and its trace names the package. Doctor does not report it while its expectation is off (R12). A worker or verifier has no web tool. Source: the Web scenario, D5, D10, ADR 0001, ADR 0005, and R12. Necessity: approved behavior and the never-installed invariant.
- **Recommendation.** The explorer resolves the local installation with Pi's agent directory, the same directory the child's resource loader already uses. Evidence: the harness's companion lookup and Pi's package directory can differ. Need: the explorer has web tools whenever the parent's Pi loads `pi-web-access`.
- **Mandatory.** The contracts change as follows. `worker.md` and `verify.md` no longer say the child has no MCP tools, and they still say it cannot launch child sessions. The explorer's and verifier's read-only wording covers MCP. The explorer's web tools are optional. Every contract states that publishing and writes to external services through MCP stay with the parent. Every contract states that the role contract takes precedence over context files, so instructions to commit or open pull requests do not apply to a child. Source: Dependencies, the Publishing scenario, DV4, R3, and the context files decision. Necessity: the contracts are the only guard that DV4 accepts, and the parent-reserved commands of ADR 0011 and ADR 0013 must win over repository guidance. A contract test asserts the statement.
- **Mandatory.** ADR 0014 ships with layer 2. It records D1 and the accepted risks R1 to R13, and it extends ADR 0013's R1 to the `codemode`, MCP, and web surfaces (DV5). Source: D1, DV5, the Risks section, and the review report's required revision. Necessity: accepted decision. The outline is under "Accepted risks".
- **Mandatory.** `docs/specs/child-session-delegation.md` is edited with layer 2 to describe the curated extensions and the context files in children. Children still never load the harness extension, so the parent's `tool_call` hook still does not reach them. Source: Dependencies, DV1, and the review report's required revision. Necessity: that specification states that children are extension-free.

### Layer 3. Fan-out from `codemode`, a Specialist per launch, the launch limit

Evidence: `spawn_child` is a parent tool that is already callable from `codemode`. In tui and rpc modes, it returns after it queues the child. In print and json modes, it runs the child in the foreground. A nested call's id is the launching `codemode` call's id followed by `/<n>`. The launcher keeps one routing assessment per user message for the tool gate and every launch. Every Jev answer carries both a destination and a Specialist. The gate allows gated tools after a launch for the same message. Each blocked inner call of a script also sends a gate message to the parent today. The running limit counts running and waiting children. The core creates a child's session before it queues the child.

- **Mandatory.** The parent can call `spawn_child` from a `codemode` script. There is no separate workflow tool. In tui and rpc modes, the script launches children and returns without awaiting them. The children run in the background, and their results reach the parent through ADR 0010: one message when every child of the session is done, or earlier when a result wakes the parent. Each child keeps `ask_parent`. Aborting or failing the script does not touch children it already launched. Source: D3, the Fan-out scenario, and ADR 0010. Necessity: accepted decision and consumer contract.
- **Mandatory.** In print and json modes, a child launched from a script runs in the foreground. The script awaits it. It is outside the launch and running limits and outside the Fleet view. Its `ask_parent` is refused, and aborting the script stops it. Source: R8. Necessity: accepted risk.
- **Mandatory.** The destination (stay, decide, or leave) is decided once per user message, by the tool gate or by the first launch. While Jev routing is on, each launch asks Jev for its Specialist. On every launch after the destination is decided, Jev's destination answer is ignored. A launch whose Jev call gives no valid answer is Launch blocked, and Launch blocked is never kept as the message's decision. The first launch of a message may cost two Jev calls. Source: the Routing scenario, D11, DV3, ADR 0008, and `docs/specs/routing-owner.md`. Necessity: accepted decision and approved deviation. Resolved by owner disposition C1.
- **Mandatory.** While Jev routing is off, the parent names each launch's role and Jev is not called. While it is on, an explicit child request is answered by Jev like any other message, as `docs/specs/routing-owner.md` defines. Source: the Routing scenario (owner disposition C1), ADR 0008, and `docs/specs/routing-owner.md`. Necessity: approved behavior and consumer contract. A skill name selects neither a destination nor a Specialist.
- **Mandatory.** When a script launches several children at once and the message's destination is undecided, the first launch to ask Jev decides it (owner-confirmed, C3). Launches of the same message that run concurrently wait for that decision, and their own destination answers are ignored. When that first call is Launch blocked, the next launch decides. Source: the Routing scenario ("decided once per user message ... by the first launch") and D11. Necessity: with concurrent launches, "first" needs a definition, or one message can receive several destinations. Owner-confirmed (C3).
- **Mandatory.** `docs/specs/routing-owner.md` is edited with layer 3 to record the per-launch Specialist (DV3). Source: DV3 and owner disposition C2. Necessity: that document is the current routing authority and states one Jev answer per message decides the Specialist.
- **Mandatory.** A launch for a message whose destination is stay or decide is refused with that destination's warning, as today. Source: the Routing scenario ("as today") and `docs/specs/routing-owner.md`. Necessity: consumer contract.
- **Recommendation.** Such a launch does not ask Jev. Evidence: the destination already refuses the launch, so the Specialist answer cannot change the outcome. Need: no Jev cost without effect.
- **Mandatory.** While the tool gate blocks inner calls of a script, the parent receives at most one gate message per turn. The script still receives each block reason. Source: the Routing scenario and `docs/specs/routing-owner.md` ("the parent model also receives it outside the script"). Necessity: approved behavior that keeps the existing steer.
- **Recommendation.** The launcher keeps one record per user message for the destination and asks Jev per launch for the Specialist. The tool gate's decision function keeps its result shape, allow or block with a reason. Evidence: one Jev call already answers both questions, and the routing tests use the decision function as their surface. Need: the highest useful existing seam stays the test surface.
- **Mandatory.** The running limit stays at five, counting running and waiting children, and the queue stays first in, first out. Source: the shared-capability invariants and the out-of-scope list. Necessity: invariant.
- **Mandatory.** In tui and rpc modes, one launch limit bounds a parent's working children: queued, running, or waiting. It is larger than the running limit. A launch is refused while the parent already has the launch limit of working children, and the caller receives the refusal. That covers a direct `spawn_child`, one from a script, and a `continue_child` continuation. The limit is checked before Jev and before the child session is created. It is not configurable. Source: D12 and the Launch limit scenario. Necessity: accepted decision.
- **Mandatory.** The launch limit is 10 (owner-confirmed, C4). Source: owner disposition C4 and D12. Necessity: the brief leaves the value to this specification. Reason: twice the running limit lets one fan-out fill every running slot and queue as many again. A queued child holds a session but no MCP connections, because its extensions start only when it runs (R5). Changing the value changes no other decision.
- **Mandatory.** A launch counts toward the launch limit from the moment the limit is checked until the launch is refused or the child becomes a working child. Concurrent launches from one script therefore cannot exceed the limit. Source: D12 ("bounds the working children of a parent"). Necessity: the check comes before the asynchronous Jev call and the session's creation, so without this rule a script's parallel launches all pass the check together. Owner-confirmed (C3).
- **Mandatory.** The `pending` launch outcome is a possible result of a launch from a script. Source: the Launch limit scenario. Necessity: approved behavior. A script must not treat it as a launched child.
- **Mandatory.** After child session is unseated, a launch is refused as today. Children already launched still start, finish, and deliver, and the Fleet view leaves its place. Source: the glossary entry Seating, ADR 0009, and the Seating invariant. Necessity: invariant during a fan-out.
- **Recommendation.** `spawn_child`'s guidelines say that one script can launch several children, that the call returns at once, and that results arrive as described above. The guideline that the parent has no channel to a running child stays. Evidence: the guideline says "There is no channel to a running child", and D13 keeps that true for the parent. Need: the parent model learns the fan-out without polling.

### Layer 4a. The Fleet view: totals, steering, and answering

Evidence: `alt+a` and `/workflow:subagents` open the children overlay, titled `Subagents` with its count today. The overlay's usage sums assistant messages only, while Pi records nested `codemode` usage on the tool result. A reply to a question that is no longer waiting is refused, and the core does not keep the answer. Pi's `steer` queues a message for the session's next turn. Pi emits a `queue_update` event with the pending steering messages, and `clearQueue` returns the steering messages not yet delivered. Pi's `agent_settled` event, unlike `agent_end`, says that Pi will not continue automatically. Pi refuses queued text that names an extension command, and children now load `/mcp`.

- **Mandatory.** The existing overlay becomes the Fleet view. Its keys and its live detail keep working. Source: D9 and Scope 4a. Necessity: accepted decision.
- **Mandatory.** The Fleet view is titled `Fleet`. Source: the Fleet view scenario (owner disposition C5). Necessity: approved behavior. The children box header and the `/workflow:subagents` command keep their current names and are out of scope.
- **Mandatory.** Each row shows the child's Run state, tokens, and cost, including tool-result usage. The view shows a total across children. Source: the Fleet view scenario. Necessity: approved behavior.
- **Mandatory.** The detail pane has one input line. For a running child, it sends a Steer. For a waiting child, it sends an answer. For any other Run state, it shows the refusal reason. Source: the Fleet view scenario. Necessity: approved behavior.
- **Mandatory.** Only the operator steers a running child. The parent gets no steering tool. Source: D13 and the out-of-scope list. Necessity: accepted decision.
- **Mandatory.** A Steer reaches the child at its next turn without cancelling it. Several steers arrive in order, one per turn. A Steer that the child has not received yet is shown as pending on the child's row. A Steer that the child never received because it ended is shown as undelivered. Text that begins with `/` is refused. A queued, waiting, or finished child cannot be steered, and the Fleet view says why. The parent is not told about steers, and the child's result reflects them. Source: the Steering scenario (owner disposition C5) and R10. Necessity: approved behavior and accepted risk.
- **Mandatory.** In tui and rpc modes, a waiting child's question can be answered by the operator in the Fleet view or by the parent with `reply_child`. The first answer wins. A later `reply_child` is refused, and the refusal carries the operator's answer, which is how the parent learns it. The question message that the parent already received is not withdrawn. An operator answer after the parent's answer is refused with the reason. Source: the Answering scenario and DV2. Necessity: approved deviation.
- **Mandatory.** The `reply_child` offer rules do not change. Source: the Seating invariant and `docs/specs/deep-harness-modules.md` (D10 window). Necessity: invariant.
- **Recommendation.** The child-session core owns first-answer-wins. It keeps the answer for each question number and the source of that answer. It exposes an operator answer next to the existing reply, and both pass the same waiting check. Evidence: the reply already checks the question number and the waiting state, and both answers resolve the same waiting question. Need: one rule, testable through the core with the fake factory.
- **Recommendation.** The child session handle gains a steer operation. The Pi adapter calls Pi's session `steer` and sets `steeringMode` to one-at-a-time explicitly in the child's in-memory settings. A pending Steer comes from Pi's `queue_update` event, and the Steers a child never received come from `clearQueue` before the session is disposed. The core tracks delivery from the child's own session events, not from elapsed time. Evidence: the factory seam already has a production adapter and a fake adapter, and Pi exposes the steering queue. Need: the undelivered state is observed, not guessed.
- **Mandatory.** The Run state that the Fleet view shows follows Pi's `agent_settled`, never `agent_end`, because queued work or an automatic retry can still follow `agent_end`. Source: Pi's SDK documentation of the two events and the Steering scenario. Necessity: a steer that arrives during a retry would otherwise be reported undelivered.

### Layer 4b. Changed files, grouping, and the last result

Evidence: a nested tool call emits live start and end events that carry the arguments and the parent call id, and those events reach the core's subscription. The transcript keeps only a capped record of nested calls. A nested `spawn_child` receives an id formed from the launching `codemode` call's id. On a timeout, the core keeps the result the child last reported.

- **Mandatory.** The detail pane shows the files the child changed through its own successful `edit` and `write` calls, including calls from `codemode`. Changes through `bash` or MCP are not attributed (R7). Source: the Fleet view scenario and R7. Necessity: approved behavior and accepted risk.
- **Recommendation.** The core accumulates changed paths from live tool events and counts only successful ends. It does not read the transcript's nested-call record. Evidence: that record is capped. Need: complete attribution for long scripts.
- **Mandatory.** Children launched by one `codemode` call are grouped under that call. The group shows how many children were launched, how many are done, and their token total. "Done" counts children in a terminal Run state, not a Verdict, because an explorer reports no Verdict. Source: the Fleet view scenario and the glossary entries Run state and Verdict. Necessity: approved behavior.
- **Recommendation.** The launch records the launching `codemode` call's id, taken from the nested call id that `spawn_child` receives, on the child record. A direct launch has no group. Evidence: the id already reaches `spawn_child`. Need: grouping with no new channel.
- **Mandatory.** A timed-out child shows the last result it reported, if it reported one. Source: the Fleet view scenario. Necessity: approved behavior.
- **Mandatory.** The parent's message about a timed-out child carries the same last result. ADR 0010 governs delivery timing only, so the message's content changes and its timing does not. Source: the Fleet view scenario (owner disposition C5) and ADR 0010. Necessity: approved behavior.

## Seams

| Seam | Existing adapters | Decisions it carries |
|---|---|---|
| Child session factory and its handle | The Pi adapter and the fake factory | `codemode` and `models` off (1); extensions, lifecycle, trust, allowlist, and web resolution (2); steer (4a) |
| Child-session core: launch, run, finish, reply, disposeAll | Driven by the child tools and the fake factory | Lifecycle on every end (2); launch limit and the group key (3, 4b); first-answer-wins and the operator answer (4a); steer delivery and changed files (4a, 4b) |
| Launcher: routing decision, tool gate, prepare launch | The decision function used by the routing tests, with the fake Jev | Destination per message and Specialist per launch; one gate message per turn (3) |
| Children overlay | Extension-level view tests | The Fleet view's rows, totals, input line, groups, files, and last result (4a, 4b) |
| Contracts and the MCP server catalog | Contract tests and Configure's plan | Wording and descriptions (1, 2) |

## Shared-capability invariants

Implementation and ticket slicing must preserve each invariant. Each one names its source.

- Child result delivery follows ADR 0010: one message per boundary, the wake rule, and a consumed result never delivered again. Fan-out adds no delivery path. Source: ADR 0010 and the brief's shared capabilities.
- The running limit stays at five, and the queue stays first in, first out. The launch limit sits above it and counts working children. Source: D12 and the brief's shared capabilities.
- Children end with the parent session, and their extensions and MCP connections end with them. Source: the brief's shared capabilities and the Extension lifecycle scenario.
- Seating: an unseated child session leaves its places. Work already accepted, such as a launched child and its question, still finishes. Source: the glossary entry Seating and ADR 0009.
- Cache-first: the harness only appends. Contract, cwd, and allowlist order are fixed at launch. Messages already sent are never rewritten. Persisted harness data stays out of the model context. Source: D14.
- A companion is never installed by the harness. Source: ADR 0001 and the brief's shared capabilities.
- Routing has one owner (ADR 0008). The destination is one decision per user message, and Launch blocked is never kept. Source: ADR 0008, D11, and `docs/specs/routing-owner.md`.
- A child never loads the harness extension. Source: the No recursion scenario.
- A child's MCP trust never exceeds the parent's. Source: the MCP scenario.
- Child bash follows ADR 0013 unchanged. Source: D8.
- No C0 or C1 control character and no bidi control reaches the terminal from Fleet view text. Source: `docs/specs/deep-harness-modules.md`.

## Testing decisions

Tests cross the seams above, not private helpers. `npm run check` is the only gate. Source: `AGENTS.md` and `docs/agents/quality.md`.

- **Callable set on Pi 1.0.4 (D4).** Through the real Pi adapter, with a fixture MCP configuration that has one `direct` server and one server reachable only from `codemode`, the test asserts that each Specialist's callable set contains every item below:
  - its contract tools, `ask_parent`, `report_result` where the role reports one, and `codemode`;
  - the `direct` server's tools and the three MCP resource tools;
  - the `codemode`-only server's tools, callable from a script.

  The callable set contains no `spawn_child`, no parent child tool, and no `models` API. A worker and a verifier have no web tool. **Recommendation:** a local stdio fixture server, so the test needs no network.
- **Repository guidance.** A worker and a verifier send the same context files as the parent in their system prompt. An explorer sends none. No child loads skills.
- **Reload.** A session shutdown with reason reload ends every working child, closes its transport, notifies the operator how many working children ended, and records it in the trace.
- **Prefix determinism.** Two children of the same Specialist and model, in the same worktree, with the same `direct` servers connected before the first prompt, send an identical system prompt, including the context files, and identical tool declarations in the same order with their first provider request. The tasks appear only in the user message. **Recommendation:** capture the request at the stream function the Pi adapter already wraps.
- **Lifecycle.** A queued child has started no extension and opened no MCP connection. Running starts them. Each end path shuts them down and closes the fixture server's transport: completion, failure, cancellation, timeout, a refusal after creation, the parent session's end, and a foreground child. A continuation gets fresh instances. The core suite uses the fake factory, and one adapter test proves the transport closes.
- **Trust.** An untrusted parent project gives the child no project MCP servers. A child in a worktree that has its own `.pi/mcp.json` never reads that file.
- **Web access.** An explorer with a local `pi-web-access` has web tools. An explorer without it launches without them, its trace names the package, and no install is attempted. Doctor output does not change while the expectation is off.
- **`codemode` in a child.** A child's script runs reads in parallel. An inner `bash` call meets the ADR 0013 guard. Two `edit` calls on one file run one after the other.
- **Launch limit.** With 10 working children, `spawn_child` and `continue_child` are refused. The fake Jev records no call, and the factory is not called. A script that launches 12 children at once gets at most 10 launches and 2 refusals. Print and json foreground launches are unaffected.
- **Routing in a script.** With the fake Jev and Jev routing on, one script launches three children:
  - each launch asks Jev for its Specialist, and different Specialists launch;
  - the destination is decided once, and later destination answers, including stay and decide, are ignored;
  - one launch with an invalid Jev answer is Launch blocked, the decision is not kept, and the others proceed;
  - when a later launch's Specialist call is Launch blocked, the message keeps its destination;
  - with Jev routing on, an explicit child request is answered by Jev like any other message;
  - a gate verdict of stay or decide refuses the launches;
  - several blocked inner calls in one turn produce one gate message;
  - with Jev routing off, named roles launch, and Jev is not called.
- **Fan-out delivery.** A script returns right after its launches. Aborting it leaves the children running. Their results reach the parent in one message when all are done, per ADR 0010, and an earlier waking result follows the wake rule.
- **First answer wins.** The operator answers first, so a later `reply_child` is refused, the refusal carries the operator's answer, and no new message is sent. The parent answers first, so a later operator answer is refused with its reason.
- **Steer delivery.** A running child receives a Steer at its next turn and is not cancelled. Two steers arrive in order, one per turn. A Steer is refused for a queued, waiting, or finished child and for text that begins with `/`. A Steer the child has not received yet is shown as pending on the child's row. A Steer that is pending when the child ends is shown as undelivered. The parent receives no message about a Steer.
- **Fleet view rendering.** Extension-level tests check each of the following:
  - rows with tokens and cost that include tool-result usage, and the total;
  - a group header with the number launched, the number done, and the token total;
  - changed files from successful `edit` and `write` calls, nested ones included, with a failed `edit` and a `bash` write excluded;
  - a timed-out child's last result, and the same result in the parent's message about it;
  - the title `Fleet`;
  - the input line's behavior in each Run state;
  - hostile text rendered safely.
- **Contracts and catalog.** Every `tools:` line contains `codemode`. Every contract states that publishing through MCP stays with the parent and that the role contract takes precedence over context files. `worker.md` still says it cannot launch child sessions. Every catalog server has a `description`, and Configure's plan lists the change.
- **Pi version.** The sandbox test asserts 1.0.4. The existing Chrome tests pass on 1.0.4.

## Out of scope

- An operating-system sandbox, child processes, RPC transport, and Pi Durable.
- Skills in children. The contract is the custom prompt, and Pi adds its `cwd` and `mcp_servers` sections and, for a worker and a verifier, the repository's context files.
- Children that outlive the parent or resume from disk (#204). `continue_child` keeps its in-memory behavior (ADR 0010).
- An orchestrator mode where the parent always delegates (#205).
- Several models per Specialist with fallback (#206).
- Linking todo tasks to children (#207).
- A child forked with the parent's context, user-defined agents, nested children, and a configurable nesting depth.
- A configurable running limit or launch limit.
- External engines as children, scheduled agents, a second model that watches children, a grid layout, and `@mentions`.
- A File claim or path checks on `edit` and `write`.
- A per-script launch budget, a stall checkpoint, a secret-path refusal, a harness MCP wait, and freezing a child's tool set.
- The parent steering a running child.
- `codemode` model calls (`models`) in children.
- A guard for `rm` and destructive SQL in the child's `bash` (ADR 0013).
- When verification runs. The engineering skills own delivery process.

## Prototype

None. The brief does not recommend one: the open items are platform facts, not product questions. The tests above act as the oracle.

## Approved deviations

Approved by the owner.

- DV1. Children load a curated set of extensions. Today they load none. ADR 0011 and `docs/specs/child-session-delegation.md` describe children as extension-free.
- DV2. The operator can answer a waiting child directly. Today only the parent answers, with `reply_child`.
- DV3. The Specialist is decided per launch. Today one Jev answer per user message decides the Specialist of every launch of that message. The destination rule is unchanged.
- DV4. Read-only Specialists can reach MCP tools that write or publish. The contracts guide them instead of a filter (R3), because filtering by read-only hints would also remove documentation tools such as context7.
- DV5. `codemode`, MCP, and web tools are new in-process surfaces that ADR 0013's child bash policy does not cover. ADR 0014 extends ADR 0013's R1 to them.

## Accepted risks

Accepted by the owner and recorded in ADR 0014:

- R1. Every child can read what the parent can read, including credentials, and can send it out. It can plant files the parent later runs, such as `.git/hooks` or settings.
- R2. The user's own hooks do not reach children.
- R3. MCP tools that write or publish are reachable by read-only Specialists. Only the contracts guide them.
- R4. Cancellation is cooperative. A tool that ignores abort can keep writing after its child stops.
- R5. Each child opens its own MCP connections and stdio processes. The launch limit bounds them, and a child connects only while it runs.
- R6. Session-only `/mcp` toggles of the parent are not inherited.
- R7. Changes made through `bash` or MCP are not attributed to a child in the Fleet view.
- R8. In print and json modes, a child launched from a script runs in the foreground, as described in layer 3.
- R9. A `direct` MCP server that connects after a child's first prompt, and a refreshed `mcp_servers` section, cost one prefix re-send on Claude. This is inherited Pi behavior, as in the parent.
- R10. The parent is not told when the operator steers a child.
- R11. `direct` MCP servers that the user adds to `mcp.json` change children's declarations and tool order. The harness does not normalize them.
- R12. A locally installed `pi-web-access` loads in the explorer even when its companion expectation is off, so doctor does not report it missing. The explorer's trace does.
- R13. `/reload` ends every working child, because every session shutdown, reload included, disposes all children. The harness only notifies the operator at `session_shutdown` with reason `reload` and records it in the trace. Survival across a reload belongs to #204.

ADR 0014 outline (ships with layer 2):

- Title: in-process child sessions carry the parent's risk.
- Decision: children run in the parent's process with no operating-system boundary (D1). They load `codemode` and MCP, plus `pi-web-access` for the explorer, and never the harness extension. A worker and a verifier also load the parent's context files. They inherit MCP with the parent's trust. The contracts keep publishing with the parent. ADR 0013's R1 extends to `codemode`, MCP, and web tools (DV5). Supersedes: none.
- Considered options: child processes over RPC; an operating-system sandbox (`@anthropic-ai/sandbox-runtime`, nono, Gondolin); filtering MCP tools by read-only hints; a secret-path refusal; a harness MCP wait or a frozen tool set; subprocess designs (Pi's subagent example, `badlogic/pi-subagent`, gentle-shell). Each option names why it was not adopted, from the brief's Problem, Decisions, and Out of scope sections. The subprocess options also name what in-process children cost (the private model-runtime access, the cancellation stream patch, the manual extension lifecycle, trust plumbing, and R13) and what they gain (Pi's file mutation queue serializes edits of one file across children and the parent, which D7 relies on).
- Consequences: R1 to R13 as accepted risks. Two Pi-internal dependencies are upgrade re-verification items, like the chrome in ADR 0007: the factory's private access to Pi's model runtime, and the patch of the child's stream function that makes cancellation work.

## Evidence gaps and verification tasks

Each task runs before the layer it names ships. A failure that the brief does not already decide goes back to the owner. It is not resolved in implementation.

- V1 (E2, layer 2). Several in-process children refresh one OAuth credential store at the same time. The task verifies that no refresh is lost and that the store is not corrupted.
- V2 (E4, layer 2, web part). The task verifies whether `pi-web-access` loaded in an explorer shares module state with the parent. A parent fetch must survive an explorer ending, and an explorer in another worktree must not clear the parent's extension state.
- V3 (layer 1). `codemode` runs in a child before the layer-2 lifecycle exists. If the extension needs a started session, the start half of the lifecycle has to move into layer 1, and that delivery-order change goes back to the owner.
- V4 (layer 2). The explorer's resolved `pi-web-access` directory is the one Pi loads for the parent. This covers both of Pi's agent-directory variables.
- V6 (layer 3). A child calls `ask_parent` inside its own script, and the script ends while the question waits. This happens only with an explicit script timeout. The task observes whether the question stays waiting until the stall watch.
- V7 (layer 2). Pi does not export its MCP config loader. The trust-bound loader (the parent's project trust through the parent's `isProjectTrusted`, global plus trusted project configuration) needs a reimplementation from public exports or an upstream export. The task decides which before layer 2 ships.
- V8 (layer 2), resolved. Pi has no cancellable pre-reload hook; the only signal is `session_shutdown` with reason `reload`, which fires before teardown and can notify but not confirm or prevent. The harness notifies there.

The review lists these items as pending for the specification. Each is disposed as follows:

- E2 and E4 are V1 and V2.
- `ask_parent` inside a child's script is V6.
- The parent's message for a timed-out child carries its last result. Decided in layer 4b (C5).
- Locating companions with Pi's agent directory is the layer-2 recommendation and V4.
- A Steer not yet received is shown as pending on the child's row. Decided in layer 4a (C5).
- Seating during a fan-out is decided in layer 3 from the Seating invariant.
- The Fleet view's title is `Fleet`. Decided in layer 4a (C5).
- The terms Tool gate, contract, trace, and group are defined under "Vocabulary" as specification terms and are a glossary gap.
- The catalog descriptions reaching the user through Configure is decided in layer 2 from ADR 0001.

## Owner dispositions

- C1, resolved. The brief's Routing scenario now reads: with Jev routing off, the parent names each launch's role and Jev is not called. With it on, an explicit request is answered by Jev like any other message, as `docs/specs/routing-owner.md` defines. The destination is decided once per user message, by the gate or the first launch. Each launch asks Jev for its Specialist. On every launch after the destination is decided, Jev's destination answer is ignored. A launch whose Jev call gives no valid answer is Launch blocked. Layer 3 aligns to this.
- C2, resolved. `docs/specs/routing-owner.md` is edited in layer 3 (per-launch Specialist) and `docs/specs/child-session-delegation.md` in layer 2 (extensions in children). Both are mandatory dependencies.
- C3, owner-confirmed. A launch counts toward the launch limit from its check until it is refused or becomes a working child. With an undecided destination, the first launch to ask Jev decides it.
- C4, owner-confirmed. The launch limit is 10.
- B1, owner disposition. Worker and verifier children load the same context files as the parent; the explorer loads none; skills stay off for all. Every contract states that the role contract takes precedence over context files (W-2). A mandatory decision in layer 2 with a test.
- B2', owner disposition. `/reload` ends every working child, accepted as R13. The harness notifies the operator at `session_shutdown` with reason `reload` and records it in the trace; no view claim. V8 is resolved. Survival across reload belongs to #204.
- C5, resolved in the brief. The Fleet view is titled `Fleet`, a Steer not yet received is shown as pending on the child's row, and the parent's message about a timed-out child carries its last reported result. They are mandatory decisions in layers 4a and 4b.

## Dependencies and native relationships

External dependencies:

- Pi 1.0.4: `pi-coding-agent`, `pi-ai`, and `pi-tui`. The relevant Pi behavior:
  - the `codemode` factory and its `models` option;
  - the MCP factory with its configuration loader and its 10 s wait for `direct` servers;
  - allowlist pattern matching and the MCP resource tool names;
  - nested call ids and live nested events with the parent call id;
  - tool-result usage, `withFileMutationQueue`, and `steer` with one-at-a-time delivery;
  - `bindExtensions` and `session_shutdown` through the session's extension runner;
  - the steering queue: `steer`, `queue_update`, `clearQueue`, `steeringMode`, and `agent_settled`;
  - the context files that a session loads from its cwd;
  - the settings trust option and the custom-prompt sections.
- pi-ai's handling of mid-run system and tool changes on Claude (R9).
- The user's local `pi-web-access` installation, which is never installed by the harness.
- Jev through Pi's classifier registry, as `docs/specs/routing-owner.md` defines.
- The MCP server catalog, the contracts, the peer range and pins, and the sandbox assertion, as the brief's Dependencies list them.
- `docs/specs/child-session-delegation.md` (layer 2) and `docs/specs/routing-owner.md` (layer 3).

Follow-up issues outside this feature: #204 children that outlive the parent, #205 orchestrator mode, #206 several models per Specialist, and #207 todo tasks linked to children.

Native relationships between layers. Ticket slicing must respect each one. They constrain order and interfaces. They do not define slices.

- The Pi 1.0.4 change is the first change of layer 1, and everything else depends on it.
- Layer 2's callable set depends on Pi 1.0.4's allowlist. The lifecycle comes before MCP and web in layer 2, because MCP connects only on a started session.
- The contract edits are split. `tools:` lines, the batching guideline, and `codemode` read-only wording go in layer 1. MCP, publishing, and web wording go in layer 2.
- ADR 0014 and the delegation spec edit ship with layer 2. The `docs/specs/routing-owner.md` edit ships with layer 3.
- Layer 3's routing change, launch limit, and fan-out depend on the launcher and the child-session core only. The launch limit counts continuations, so it touches both launch paths.
- Layer 4a's tool-result usage counts nested `codemode` usage from layer 1. The operator answer depends on first-answer-wins in the core. The Steer depends on the factory handle's steer operation.
- Layer 4b's grouping depends on layer 3's fan-out for the group key. Its changed files include nested calls from layer 1. The last result of a timed-out child depends on nothing new.
- The Fleet view stays the overlay occupant of child session. The `reply_child` offer rules and seating do not change.

## Feature review

Final verdict: READY WITH WARNINGS. The consolidated report is `docs/specs/child-session-capabilities-review.md`. The owner accepted every remaining warning as DV1 to DV5 and R1 to R13. C1 to C5 came up during synthesis, and B1, B2 (R13) after the analysis of `badlogic/pi-subagent`. The owner's dispositions are recorded above, and the report's items 23 to 29 cover them.
