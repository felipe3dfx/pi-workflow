# Feature brief: child session capabilities and fleet view

Status: CONFIRMED by the owner. Reviewed by `feature-review`: READY WITH WARNINGS (`docs/specs/child-session-capabilities-review.md`).

Domain Authority Handoff: `GLOSSARY.md` (present, root-selected) and the accepted ADRs in `docs/adr/`.

## Problem and user

The user is the operator who works with Pi and delegates to child sessions. Today a child session is a bare session: it has no `codemode`, no MCP servers, and no web access. A child reads one file per tool call and spends turns on work the parent does in one `codemode` script. The parent can launch several children only through separate tool calls, so a fan-out costs one turn per child. The operator can watch children in the overlay but cannot steer a running child, answer a waiting one, or see what each child changed.

An earlier proposal was to run each child as a separate Pi process over RPC, as gentle-shell does, so that children inherit Pi's configuration. Discovery showed that RPC moves the child orchestration instead of removing it, loses SDK custom tools, and only pays off with an operating-system sandbox. The owner chose to keep children in-process without a sandbox.

## Desired outcome

A child session uses the tools the parent already has. Every Specialist can compose tool calls with `codemode` and call the same MCP servers as the parent. The explorer can search and read the web. The parent can fan out several children from one `codemode` script. The operator follows, steers, and answers children from the Fleet view, and sees what each child changed. Sessions stay cache-first: the feature only appends to a session.

## Scope

In scope, in delivery order. Each layer ships on its own:

1. **`codemode` in children.** The first commit moves the harness to Pi 1.0.4. Every Specialist loads `codemode`, and contract `tools:` lines gain it.
2. **MCP and web access.** Children load extensions through a lifecycle that starts them when the child runs and shuts them down on every end. Worker and verifier children load the same context files as the parent. Every Specialist receives the parent's MCP servers. Only the explorer loads the `pi-web-access` companion package. Every catalog MCP server gains a `description`. ADR 0014 records the risk model.
3. **Fan-out from `codemode`.** The parent can call `spawn_child` from a `codemode` script. Each launch gets its own Specialist decision. A launch limit bounds the children a parent has working.
4. **Fleet view.**
   - 4a. The overlay opened with `alt+a` becomes the Fleet view, titled `Fleet`: per-row tokens and cost with a total, the operator steers a running child, and the operator answers a waiting child.
   - 4b. The detail shows the files each child changed, children launched by one `codemode` call are grouped, and a timed-out child shows the last result it reported, if any.

Out of scope:

- An operating-system sandbox, child processes, RPC transport, and Pi Durable.
- Skills in children. The contract is the custom prompt; Pi adds its `cwd` and `mcp_servers` sections and, for a worker and a verifier, the repository's context files.
- Children that outlive the parent or resume from disk (#204). `continue_child` keeps its in-memory behavior (ADR 0010).
- An orchestrator mode where the parent always delegates (#205).
- Several models per Specialist with fallback (#206).
- Linking todo tasks to children (#207).
- A child forked with the parent's context. Children start clean; a forked context would inflate the child and defeats an independent verifier.
- User-defined agents. Specialists are fixed, Jev routes among them, and model profiles assign their models. A child that pushes with `git` contradicts ADR 0013.
- Nested children and a configurable nesting depth. Fan-out from `codemode` gives parallelism without trees, and nesting multiplies cost.
- A configurable running limit. There is no evidence that 5 is wrong.
- External engines as children, scheduled agents, a second model that watches children, a grid layout, and `@mentions`.
- A File claim or path checks on `edit` and `write`. The parent splits work in the task text; Pi serializes mutations of one file (`withFileMutationQueue`); the Fleet view shows overlaps after the fact. One worktree per worker is the fix if splitting proves insufficient.
- A per-script launch budget, a stall checkpoint, a secret-path refusal, a harness MCP wait, and freezing a child's tool set.
- The parent steering a running child. The parent already has `continue_child` and cancellation.
- `codemode` model calls (`models`) in children.
- A guard for `rm` and destructive SQL in the child's `bash`. ADR 0013 keeps it deferred.
- When verification runs. The engineering skills own delivery process.

## Scenarios

- **Composing in a child.** A Specialist runs a `codemode` script that reads, searches, and calls MCP tools in parallel. Every inner call passes the same tool allowlist and hooks as a direct call. Pi runs two `edit` or `write` calls on the same file one after the other and calls on different files in parallel. A child's `codemode` has no `models` API.
- **Extension lifecycle.** A queued child has no running extensions. When the child starts running, its extensions start; when it completes, fails, is cancelled, or times out, they shut down, and its MCP connections close. A `continue_child` continuation gets its own extensions under the same rule.
- **MCP like the parent.** A child receives the servers of the user's global `mcp.json`, plus the parent's project `.pi/mcp.json` only when the parent trusts the project; a child never reads its own worktree's MCP configuration and never trusts a project the parent did not trust. Every MCP tool is available to the child the way it is to the parent, including `direct` tools such as context7 and the MCP resource tools. MCP connects and waits as in the parent: Pi waits up to 10 s for servers with `direct` tools before the first prompt, and a script waits for the servers it names; a server that connects later is declared then. Pi's "still connecting" notice goes to the child's trace. `codemode` is a contract tool checked at launch; MCP and web tools are not checked.
- **Web for the explorer.** An explorer searches and fetches pages with `pi-web-access`, loaded from the user's local installation whether or not its companion expectation is on. A missing companion is never installed. When it is missing, the explorer launches without web tools and its trace names the package; web tools are optional in the explorer's contract. A worker or verifier has no web tool.
- **Repository guidance.** A worker and a verifier load the same context files as the parent: Pi's context files (the global agent-directory AGENTS.md, the ancestor directories' files, the CLAUDE.md fallback, AGENTS.override.md, and the repository's AGENTS.md). They follow the repository's conventions. The explorer loads none. No child loads skills. All children of one worktree read the same files, so the prefix stays deterministic per Specialist, model, and worktree. Every contract states that the role contract takes precedence over context files, so instructions to commit or open pull requests do not apply to a child.
- **Publishing through MCP.** The contracts tell every Specialist that publishing and writes to external services through MCP stay with the parent.
- **No recursion.** A child's extensions are `codemode` and MCP, plus `pi-web-access` for the explorer. A child never loads the harness extension, so it never offers `spawn_child`, the parent's child tools, or the parent's screen places.
- **Fan-out.** In tui and rpc modes, the parent's script launches several children and returns. The children run in the background, and their results reach the parent through ADR 0010: one message when every child of the session is done, or earlier when a result wakes the parent. Each child keeps `ask_parent`. Aborting or failing the script does not touch children it already launched.
- **Routing in a script.** The destination (stay, decide, leave) is decided once per user message, by the gate or by the first launch, as today. Each launch asks Jev for its Specialist while Jev routing is on; on every launch after the destination is decided, Jev's destination answer is ignored; a launch whose Jev call gives no valid answer is Launch blocked. While Jev routing is off, the parent names each launch's role and Jev is not called; while it is on, an explicit request is answered by Jev like any other message, as `docs/specs/routing-owner.md` defines. The first launch of a message may cost two Jev calls. While the gate blocks inner calls of a script, the parent receives at most one gate message per turn.
- **Launch limit.** In tui and rpc modes, the launch limit is larger than the running limit, so the queue still holds children beyond the running limit. It counts working children: queued, running, or waiting. A launch, including a `continue_child` continuation, is refused while the parent already has the launch limit of working children, and the caller receives the refusal. The limit is checked before Jev and before the child session is created. It applies to direct calls and calls from scripts alike. `pending` is a possible launch outcome in a script. The specification sets the limit's value.
- **Steering.** The operator types an instruction for a running child in the Fleet view. The child receives it at its next turn without being cancelled; several steers arrive in order, one per turn. A steer the child has not received yet is shown as pending on the child's row; a steer the child never received because it ended is shown as undelivered. Text beginning with `/` is refused. A queued, waiting, or finished child cannot be steered; the Fleet view says why. The parent is not told about steers; the child's result reflects them.
- **Answering from the Fleet view.** In tui and rpc modes, a waiting child's question can be answered by the operator in the Fleet view or by the parent with `reply_child`. The first answer wins. A later `reply_child` is refused, and the refusal carries the operator's answer, which is how the parent learns it; the question message it already received is not withdrawn.
- **Reload.** `/reload` ends every working child, as every session shutdown does today. On Pi's `session_shutdown` with reason `reload`, the harness notifies the operator how many working children ended and records it in the trace. Children do not survive the reload (#204).
- **Fleet view.** The overlay lists every child with its Run state, tokens, and cost (including tool-result usage), plus a total. One input line in the detail pane sends a steer to a running child and an answer to a waiting child; any other state shows the refusal reason. The detail pane shows the thread and the files the child changed through its own successful `edit` and `write` calls, including calls from `codemode`. Children launched by one `codemode` call are grouped under that call with the number of children launched, how many are done, and their token total. A timed-out child shows the last result it reported, if it reported one, and the parent's message about that child carries the same result.
- **Cache-first.** The harness only appends to a child session: it never rewrites the contract, the cwd, the declared tools, or messages already sent. Pi waits for `direct` MCP servers before the first prompt as in the parent; a `direct` server that connects later is declared then, and the `mcp_servers` section is refreshed when its summary changes. Both are inherited Pi behavior and cost one prefix re-send on Claude, as in the parent. Every catalog server carries a `description`, so the section does not change when a server connects. Two children of the same Specialist and model share a prefix when the same `direct` servers connected before their first prompt; the task and references go in the user message. Persisted harness data never enters the model context.

## Decisions

- D1. Children stay in-process. There is no operating-system boundary; a child carries the parent's risk. ADR 0014 records it.
- D3. `codemode` is the fan-out mechanism. There is no separate workflow tool, and a script launches children without awaiting them.
- D4. MCP is inherited like the parent's. A child's tool allowlist carries `mcp__*` and the MCP resource tools `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`. A test on Pi 1.0.4 asserts the callable set.
- D5. Web access is explorer-only. Library documentation for the other Specialists comes through MCP.
- D7. Work splitting between workers is the parent's task text. There is no launch-time or write-time path check.
- D8. ADR 0013 stays in force as guidance, including its deferral of `rm` and SQL guards.
- D9. The Fleet view extends the existing overlay (`alt+a`).
- D10. The companion packages a Specialist loads are named by its contract (ADR 0005: the harness names companions, it does not absorb them).
- D11. Jev routing decides the Specialist per launch; the destination stays one decision per user message, as the launcher and `docs/specs/routing-owner.md` decide it today. ADR 0008 keeps one routing owner.
- D12. One launch limit bounds the working children of a parent, above the running limit.
- D13. Only the operator steers a running child.
- D14. Cache-first, as worded in the Cache-first scenario: the harness fixes the contract, the cwd, and the tool allowlist with its order at launch and never rewrites them; late MCP declaration is inherited Pi behavior.

## Assumptions

- A1. Pi 1.0.4 keeps `codemode`'s nested-call semantics: inner calls run the full tool pipeline and carry `parentToolCallId`.
- A2. In-process children reuse the parent's provider and MCP credentials without custom code.

## Open questions

None.

## Sources

- Pi 1.0.3 and 1.0.4 packages: `createAgentSession`, `DefaultResourceLoaderOptions`, `createCodemodeExtension`, `createMcpExtension`, `withFileMutationQueue`, `appendCustomEntry`, the tool registry filter in `core/agent-session.js`, the system prompt builder, and pi-ai's mid-conversation change support.
- Armin Ronacher, "Codemode" (2026-10-06), and the Pi Durable interview with Mario Zechner and Armin Ronacher.
- gentle-shell (code and presentation), `nicobailon/pi-subagents`, `tintinweb/pi-subagents`, and a practitioner article comparing Pi subagent extensions.
- `@anthropic-ai/sandbox-runtime`, nono, and Gondolin, evaluated and not adopted.
- `badlogic/pi-subagent` and Pi's in-tree subagent example, analysed against the specification (owner dispositions B1 and B2).
- `feature-review` rounds 1 and 2: domain reviews, three lenses per round, and a second review per round.

## Shared capabilities and invariants

- Child session core (launch queue, running limit, stall watch, `ask_parent`, `reply_child`, `continue_child`): extended. Invariants: the running limit, ADR 0010 delivery (one message per boundary, a consumed result is never delivered again), and children ending with the parent session.
- Tool gate and Jev routing (ADR 0008): reused for launches from scripts, one destination decision per user message.
- Child bash (ADR 0013): unchanged.
- Overlay and children box: extended into the Fleet view. Invariant: seating; an unseated child session leaves its places.
- Companion catalog and doctor (ADR 0001, ADR 0005): reused for `pi-web-access`. Invariant: a companion is never installed by the harness.
- MCP catalog and exposure: children follow the parent's exposure; catalog servers gain descriptions.

## Prototype

Not recommended. The open items are platform facts, not product questions.

## Dependencies

- Pi 1.0.4: peer range, pins, and the version assertion in `tools/pi-sandbox.mjs` move to 1.0.4.
- `assets/mcp-servers.json`: every server gains a `description`.
- The contracts in `assets/contracts/`: `tools:` lines gain `codemode`; `worker.md` and `verify.md` no longer say the child has no MCP tools; the explorer's and verifier's read-only wording covers `codemode` and MCP; the explorer's web tools are optional; every contract states that publishing through MCP stays with the parent and that the role contract takes precedence over context files; contracts carry the `codemode` batching guideline, which Pi does not add to a custom prompt.
- `docs/specs/child-session-delegation.md`: extensions and context files in children (layer 2).
- `docs/specs/routing-owner.md`: the Specialist is decided per launch (layer 3).

## Deviations

- DV1. Children load a curated set of extensions. Today they load none; ADR 0011 and `docs/specs/child-session-delegation.md` describe children as extension-free.
- DV2. The operator can answer a waiting child directly. Today only the parent answers, with `reply_child`.
- DV3. The Specialist is decided per launch. Today one Jev verdict per user message decides the Specialist of every launch of that message (`docs/specs/routing-owner.md`); the destination rule is unchanged.
- DV4. Read-only Specialists can reach MCP tools that write or publish. ADR 0008 gives the explorer and the verifier read-only roles, and ADR 0013 keeps publishing with the parent. The owner accepted guidance in the contracts instead of a filter (R3), because filtering by read-only hints would also remove documentation tools such as context7.
- DV5. `codemode`, MCP, and web tools are new in-process surfaces that the child bash policy of ADR 0013 does not cover. ADR 0014 extends ADR 0013's R1 to them.

## Risks

Accepted, recorded in ADR 0014:

- R1. Every child can read what the parent can read, including credentials, and can send it out; it can plant files the parent later runs, such as `.git/hooks` or settings.
- R2. The user's own hooks do not reach children.
- R3. MCP tools that write or publish are reachable by read-only Specialists; only the contracts guide them.
- R4. Cancellation is cooperative: a tool that ignores abort can keep writing after its child stops.
- R5. Each child opens its own MCP connections and stdio processes, bounded by the launch limit and by connecting only while the child runs.
- R6. Session-only `/mcp` toggles of the parent are not inherited.
- R7. Changes made through `bash` or MCP are not attributed to a child in the Fleet view.
- R8. In print and json modes a child launched from a script runs in the foreground: the script awaits it, it is outside the launch and running limits and the Fleet view, its `ask_parent` is refused, and aborting the script stops it.
- R9. A `direct` MCP server that connects after a child's first prompt, and a refreshed `mcp_servers` section, cost one prefix re-send on Claude; this is inherited Pi behavior, as in the parent.
- R10. The parent is not told when the operator steers a child.
- R11. `direct` MCP servers the user adds to `mcp.json` change children's declarations and tool order; the harness does not normalize them.
- R12. A locally installed `pi-web-access` loads in the explorer even when its companion expectation is off, so doctor does not report it missing; the explorer's trace does.
- R13. `/reload` ends every working child, because every session shutdown, reload included, disposes all children. The harness only notifies the operator at `session_shutdown` with reason `reload` and records it in the trace. Survival across a reload belongs to #204.

## Evidence gaps

The specification must verify:

- E2. One OAuth credential store under concurrent refresh from several in-process children.
- E4. Whether `pi-web-access` keeps module state shared with the parent when loaded in a child.
