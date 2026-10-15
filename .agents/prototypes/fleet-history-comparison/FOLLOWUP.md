# Fleet follow-up: genuine Pi TUI scheduling and bounded RPC seams

## Disposition and decision

**Reference-only.** The user authorized extending the accepted reference-only experiment. This adds evidence, not production implementation, an Approved Prototype UI Contract, an approved brief delta, or an architecture decision. ADR 0016 (including the retained decisions of ADR 0014) still governs.

**Research verdict: partial.** Real Pi keyboard parsing, render scheduling, differential output and a real kernel PTY were exercised. Physical keyboard/display latency, a terminal emulator's painting, full interactive Pi application integration, and safe production RPC equivalence were not established. The worker has no physical-display measurement capability. Installed graphical terminal executables alone do not provide that evidence; attaching to the operator's terminal was not attempted.

**Next consequential decision:** keep transport adoption deferred. If further RPC research is authorized, first require a bounded parent-broker design that preserves question/result ownership and serializes parent-plus-child file mutations, alongside a history-layout strategy independent of transport. Do not substitute process isolation for that coordination. Current measurements do not justify an RPC migration or overturn the in-process decision.

## Reproduce and scope

From the repository root, using installed dependencies only:

```sh
python3 .agents/prototypes/fleet-history-comparison/interactive-run.py > /tmp/fleet-interactive.json
node .agents/prototypes/fleet-history-comparison/parity-run.mjs > /tmp/fleet-parity.json
npm run check
```

Success criteria are matched observations with explicit limitations, functioning local broker round trips, and a falsifiable queue counterexample—not a new latency SLO or complete transport migration.

New files only:

- `interactive-run.py`: dependency-free Python PTY driver; 12 cases, three repeats per transport/history condition, 72 input probes.
- `interactive-case.mjs`: extension of the original workload, same SDK/RPC setup and persistent synthetic histories, real tool traffic and event-driven rendering.
- `interactive-provider.mjs`: Pi faux provider, one synthetic tool result followed by streamed text per child.
- `interactive-view.mjs`: existing Fleet component hosted by real `TuiMainScreen` and `ProcessTerminal`; input/write instrumentation.
- `interactive-evidence.json`: final matched measurements and monotonic timing events.
- `broker-extension.mjs`: local RPC fixture extension recreating coordination through documented extension UI records, importing existing child tool definitions and worker result schema.
- `parity-run.mjs`: bounded broker assertions and deterministic mutation-queue counterexample.
- `parity-evidence.json`: tool results, report payloads, queue observations and cancellation event sequence.
- `FOLLOWUP.md`: this report. Read it alongside, not in place of, the original README/evidence.

At initial inspection, `git status --short` showed only the accepted untracked `.agents/prototypes/` directory. No other preexisting changes were found. The six original files were not edited; their SHA-256 hashes were checked before and after (see Preservation below). No production/configuration/ADR/brief files, branches, commits or external services were mutated.

All fixture state uses temporary directories and isolated HOME/agent directory, offline mode, explicit extensions and no MCP connections. No real session data, real provider calls or credentials are used. The PTY fixture owns a fresh process group and cleans only that group, including descendants on failure. RPC sessions are stopped in the case's finally handler. The broker closes RPC stdin for orderly exit, checks exit zero and cleans its owned child handles on failure. Temporary files are removed. External uncatchable termination of the driver itself remains outside the tested cleanup path.

## Goal A: what was actually exercised

### Harness discovery and installed references

Installed: Python 3 (`pty`, `select`, `termios`, `fcntl`), `/usr/bin/script`, and tmux. `foot`, `alacritty`, and `ghostty` executables are also present; none was launched or attached to the operator's display. No dependency installation was needed.

Pi 1.0.4 documentation and examples consulted in the installed packages:

- coding-agent `docs/tui.md`, `docs/terminal-setup.md`, `docs/sdk.md`, `docs/rpc.md`, relevant `docs/rpc-commands.md` sections, and `docs/rpc-extension-ui.md`;
- `examples/sdk/06-extensions.ts`, `examples/sdk/14-codemode-mcp.ts`, SDK example index, and RPC extension-UI demo/client examples;
- pi-tui README quick start and exported TUI/ProcessTerminal declarations;
- actual RPC JSON event conversion and actual file-mutation queue implementation.

`ctx.ui.custom()` is not implemented in RPC child mode, but this does **not** prevent the parent from hosting Fleet with a genuine Pi TUI. The fixture does that directly through the installed `TuiMainScreen`/`ProcessTerminal` interfaces. It does not run the full interactive Pi application or its actual extension-UI overlay stack.

### Matched workload and endpoints

Four real concurrent SDK sessions or four real Pi CLI RPC processes, zero or 2,000 seeded assistant messages per child, three repeats with alternating transport order. Each seeded assistant contains thinking plus 256 text padding characters. Each child executes the same `fixture_result` tool (80 lines of synthetic text) and then streams the same 69,632-character reply. Final evidence asserts four tool results and 272 text deltas per case. The selected child's completed tool-call/result messages reach the existing Fleet renderer. Other child streams are counted, not displayed or selectable through the fixture listing.

Both transports use the same narrow 55-column, 40-row PTY, existing Fleet component, synthetic identity/list adapter, initial history, thinking-collapse behavior and event-driven `requestRender()` calls. There is no 33ms frame timer. Narrow width starts with the list, allowing Enter to measure cold opening of history; initial list rendering does not eagerly layout the detail transcript. The exact key sequence is Enter, PageUp, Ctrl+T, PageDown, Ctrl+T, `f`, spaced 250ms apart. Every probe asserts it arrived during the selected text stream. The zero-history thinking toggles have no seeded thinking to hide; those are controls, not evidence of meaningful collapse.

A fixed header line is replaced by `FLEET_PROBE_<n>_END`, preserving dimensions and correlating accepted input with actual output. The component still handles the original key. This extra visible marker means even a no-op action writes output; it measures scheduling/layout/output, not proof that a human saw a semantically correct screen. Real terminal keyboard negotiation/parsing executes; the harness injects legacy key bytes, not a physical keyboard or full emulator negotiation replies. Mouse, resize, IME, images, wide Unicode, the alternate-screen renderer, and main-Pi collapse parity were not tested.

Raw evidence separates:

1. PTY input injection to component input delivery;
2. injection to render start;
3. injection to completion of `ProcessTerminal.write()` invocation (not drain/flush acknowledgment);
4. injection to marker receipt by the PTY master (not display painting);
5. component render execution time.

Node `hrtime` and Python monotonic timestamps are captured on the same Linux host. File logging and marker output add overhead. PTY reads can precede the post-write log timestamp because the reader runs concurrently. The cold `firstRenderRequestMs` field measures only enqueueing a render request, not first paint; use the actual render events/probes instead. Host RSS excludes RPC child memory. Initialization/readback metrics are auxiliary, not end-to-end user latency.

### Final measurements

Node v26.11.1, Pi 1.0.4, Linux, same Ryzen host as the original evidence. Ranges across three repeats, **injection-to-write milliseconds**, not physical display latency:

| History | Mode | Open history | Page up | Collapse thinking | Page down | Expand thinking | Follow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | SDK | 36.8–38.2 | 2.7–3.7 | 1.6–5.6 | 1.9–3.9 | 4.1–6.2 | 2.6–6.6 |
| 0 | RPC | 30.9–44.4 | 2.0–4.8 | 2.4–3.4 | 2.0–4.1 | 3.7–6.0 | 2.5–5.4 |
| 2,000 | SDK | 190.1–202.7 | 4.0–5.5 | 136.8–161.4 | 2.7–5.4 | 3.5–5.0 | 5.0–7.2 |
| 2,000 | RPC | 195.6–219.1 | 3.7–5.5 | 145.5–168.5 | 6.5–9.5 | 6.4–9.2 | 4.6–17.1 |

For 2,000 history messages, cold opening component layout alone took 187.5–200.2ms SDK and 193.3–215.5ms RPC. The first thinking-collapse layout took 136.3–160.6ms SDK and 141.6–167.9ms RPC. Expanding again benefits from the existing component cache; it is not a second cold layout. Stream workload duration was 3.50s approximately without history, 3.85–3.88s SDK with history and 3.54–3.56s RPC with history. This small synthetic sample is not a production transport winner, percentile estimate or accepted responsiveness threshold.

**Consequence:** a genuine Pi scheduling/input path reproduces substantial host layout work for long-history opening and first collapse in both modes. Moving execution to RPC does not move Fleet's layout off the parent event loop.

During fixture development, an assertion correctly exposed a normalization error: SDK `message_update` supplies a full assistant message, whereas RPC's JSON event conversion omits it and the provider's `partial` snapshot. Earlier discarded development samples did not render equivalent live RPC text. The final evidence reconstructs accumulated text identically in both modes and asserts each input arrives during a populated stream. Complete thinking/tool-call/image reconstruction remains an adapter requirement; this fixture reconstructs streamed text only.

## Goal B: equivalence map

Source inspected: `extensions/child-sessions.ts` (factory, tools, question/reply, Run state, reporting, steering, cancellation and lifecycle), `child-bash.ts`, `codegraph-tool.ts`, `child-projection.ts`, ADRs 0014/0016, and installed Pi implementations/docs. Similar names are not sufficient evidence of equivalent semantics.

| Existing behavior | RPC route and ownership | Evidence and remaining gap |
| --- | --- | --- |
| `ask_parent` closes over parent state; numbered child questions; one pending question; duplicate/withdrawn replies refused; signal withdraws question | Child extension can recreate the tool; parent broker must own child/question identities, waiting/running transitions, arbitration, delivery and stale-reply rejection | Fixture imports actual `createAskParentTool`, forwards via `ctx.ui.input` extension UI request/response, and proves parent reply enters the next provider context. Aborting pending input yields tool error and no provider continuation. Production numbering/arbitration/stale-reply refusal and foreground refusal were **not** recreated. UI request IDs alone are not that contract. |
| `report_result` role schema, reason rule, last report wins while working; result consumption/delivery tied to parent state | Child extension validates; broker records/updates only for eligible child generation, owns result delivery, deduplication and consumption | Fixture imports actual worker schema/reason predicate, sends partial then done via notifications, and checks ordered payloads. The fixture sink can select the last payload; full parent consumption, verifier schema and cross-process delivery acknowledgment are untested. |
| Guarded child bash with parent-owned worktree/root and shell settings | Re-register existing definition in child extension with explicit trusted launch inputs; do not assume RPC's top-level `bash` command uses this guard | Actual `createChildBashTool` executes a local `printf` through a model tool call. Guard's full refusal matrix/escape limitations and shell settings were not reverified here; it is policy guidance, not a sandbox. |
| Read-only child `codegraph`, seated capability and worktree context | Re-register definition and explicitly project the parent's selection/context or broker the query | Actual definition is called and refuses unseated access before an external command. Useful indexed queries and propagation of parent seating are untested. A separate process does not inherit the parent's module-level selection. |
| Parent cancel/timeout/steer, queued steers, preparation-race patch, generation guards | Broker retains parent state machine; RPC `steer`, `clear_queue`, `abort`, event projection and owned-process shutdown supply primitives | Fixture queues a steer while a question waits, verifies `clear_queue` returns it, aborts, waits for `agent_settled`, sees tool error and no provider continuation. Actual steer delivery to the next provider turn, preparation races, ignoring tools, timeout/reload/parent-death cases and generation races remain unverified. Docs warn abort alone may continue queued work. |
| Curated codemode/MCP, trust and parent project cwd; worker/verifier context; optional Explorer web | Child extension/bootstrap must recreate curated resources and role projection; parent chooses immutable launch inputs and trust, never default-discover child worktree config | Not exercised: no real MCP connections or web loading. CLI defaults are not equivalent to current `parentMcp` session-start cwd override, in-memory trust or isolated web module lifecycle. Extension APIs can recreate these; safe parity is not established by API shape. |
| Selected model/thinking and shared parent runtime; conditional verified official Claude Bridge resource | Parent resolves/validates official installed resource and catalog identity; child loads exact extension before run and verifies effective model/thinking; cross-process runtime/auth ownership needs explicit treatment | Faux providers only. No real Bridge or paid provider invocation. Current shared runtime is not serializable merely by sending model IDs. ADR 0016's filtered, missing/ambiguous/no-fallback behavior remains required, not disproven. |
| Manual bind/start, shutdown handlers and disposal; bounded launch count | RPC CLI has its own extension lifecycle; parent broker controls launch/deadlines/stdin close and escalates only owned processes | Fixture starts real extension tools before prompt, consumes events through settled, closes stdin and verifies clean exit. Full MCP/Bridge shutdown, reload and outstanding work are untested. |
| Streaming Fleet transcript from SDK snapshots | Parent adapter reconstructs RPC deltas or uses finalized messages; tool and usage events must be normalized | Real mismatch found in development and corrected for text only. Passing text fixture is not full message equivalence. |
| Shared `withFileMutationQueue` across parent/children | Requires parent-wide mutation broker or independently established cross-process coordination covering the parent too; merely importing the same function in each child is insufficient | Deterministic counterexample below. Neither ordinary RPC nor per-child extension-local queues establish shared serialization. |

### Bounded queue counterexample

The installed queue contains a module-level Map keyed by resolved/real paths; it is not an OS lock or shared server. `parity-run.mjs` uses the actual exported function around read-modify-write operations on one temporary JSON counter:

- Two same-process queued callbacks each read, delay and increment: final value **2**.
- Two owned Node processes each enter their own queue, read **0**, and wait at a parent-controlled IPC barrier. Releasing both yields final value **1**, not 2. Both workers exit zero.

This is a deterministic lost-update counterexample for custom mutations protected by the exact queue primitive, **not** a benchmark of Pi's edit conflict reporting or proof that every real edit loses data. Actual RPC edit-tool traffic, edit/write conflict UX, atomic replacement, symlink races, failure/abort release and malicious bypasses are untested. A safe migration cannot assume parent/child queue sharing across processes. Even an RPC-child-only broker would miss parent writes unless the parent participates.

## Mocks, unsupported areas and falsifiable next criteria

- Local faux providers replace real providers; synthetic sessions replace real user data.
- Fixture listing/context, minimal identity theme and subscriptions replace production Fleet integration. Real layout and TUI scheduling run unchanged behind that adapter except the header marker.
- Representative custom tool output replaces real edit/bash/MCP traffic in the TUI workload. The separate parity fixture uses actual guarded bash and actual CodeGraph refusal, not a live CodeGraph index.
- Extension UI dialogs/notifications carry fixture broker messages; this is not a newly proposed production protocol. It intentionally avoids additional servers/ports. Worker report delivery uses real schema but an experimental sink.
- No persistence/crash evidence was rerun or extended; the original evidence remains separate. No claim that streamed loss or stale manifests were fixed.
- No physical display, full Pi overlay stack, main-session collapse parity, real MCP/Bridge/runtime parity, or comprehensive cancellation/queue safety evidence exists here. No safe full RPC equivalence is currently established, and no claim that RPC is inherently incapable is supported.

Proposed falsifiable follow-up criteria, not approved contracts: preserve current duplicate/withdrawn reply behavior under abort and late delivery; report updates must not resurrect ended generations; every parent and child same-file edit must participate in one serialization domain; full RPC transcript projection must preserve streamed thinking/tool calls/results and finalized output; long-history layout work must be measured independently of transport. No brief changes are proposed for approval in this artifact.

## Validation and preservation

Final fixture command completed all 12 matched cases and 72 probes, with all probes during a selected text stream and four tool results per case. The parity fixture completed its broker and queue assertions repeatedly during development; the final evidence is one complete successful run. `npm run check` passed after the fixture changes: 935 passed, 14 skipped, zero failed; packed distribution passed. The repository gate includes Biome checks of the new JavaScript but does not execute these prototype drivers; their explicit fixture assertions validate the experiment. Mutation testing is unsupported by repository policy and was not run.

Development failures were retained as findings in this report rather than accepted measurements: an initial assertion incorrectly allowed only final `stop` instead of tool-use messages; a later stream-presence assertion exposed RPC's missing SDK snapshots. Both were corrected before the final measurements. A later full gate also caught an assignment-in-expression in the new LF parser; it was corrected without configuration changes before the final gate rerun. No accepted original evidence was overwritten.

Original SHA-256 values (verified unchanged):

```text
case.mjs      c025d49bb5e4d7fa15606baae12c02e420dfc9e456563a8718ee1a75deff8455
evidence.json 796b73a2546e02977b673dfcde7deed8b9089e6263423b017a81a2328015c9b6
provider.mjs  a43a0c5858911bed6b23dfade957f3e460455d985b5c35d91983038afd861a51
README.md     551f3342e42fbe12d41ae88b4ee6dda8f217d56ea8b3240a00bfe831443e8658
run.mjs       05d3b2c35fcc63c08c60d1effcef2609d2e34f1adf1ba836e6d379942160ca44
view.mjs      647a97152d3aa2646166d337e050714f02ac36bc89e4a09ddb82b825d75d1826
```
