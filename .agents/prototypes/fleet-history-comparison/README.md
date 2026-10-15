# Fleet history transport comparison

## Question and scope

Does moving child execution from the Pi SDK to Pi RPC improve host responsiveness and preserve transcript evidence after an abrupt stop?

This is an isolated experiment, not production integration or an architecture decision. Success means reproducible matched observations with explicit limits, not compliance with an invented latency target. No provider network calls, installs, real credentials, or real session data are used.

The approved functional scope is session-local history of every child, En curso / Historial sections with launch groups preserved, inline live transcripts with main-Pi collapse/expand behavior, retention for the parent session lifetime, visible incomplete records, and no execution restart or resumption. This prototype does not implement that scope.

## Reproduce

From the repository root with its existing dependencies:

```sh
node .agents/prototypes/fleet-history-comparison/run.mjs > /tmp/fleet-comparison.json
npm run check
```

The driver creates temporary fixture directories and deletes them on normal completion or a handled error. It runs 12 performance cases and four crash cases. It never targets the operator's Pi process. Crash hooks require an owned fixture process marker and kill only their own process. An external kill of the driver itself is not a tested cleanup path.

Files:

- `run.mjs`: matched workload driver, recovery assertions and temporary storage.
- `case.mjs`: real SDK sessions or real Pi CLI RPC processes with persistent SessionManager files.
- `provider.mjs`: Pi's deterministic faux provider and controlled crash checkpoints.
- `view.mjs`: real Fleet component with a test host, not a physical terminal.
- `evidence.json`: full observations from the final run.

## Method

Each case uses four concurrent child sessions with either zero or 2,000 seeded assistant messages per child. Each seed contains 256 padding characters. Each live reply contains 69,632 characters, emitted as 68 text deltas by the local faux provider at a configured 20,000 tokens/second. There are three repeats per condition, alternating SDK/RPC order.

Both modes seed the same real SessionManager files. The SDK opens them in the case process; RPC opens them in actual Pi CLI subprocesses. Initialization starts children sequentially in both modes. Startup timing excludes fixture seeding, process module imports and view initialization. SDK and RPC do not have identical resource initialization paths.

The same existing Fleet component renders the first selected child's full seeded history and live response in both modes, at width 120 and height 40. A fixture timer requests rendering every 33ms; unselected streams only increment counters. This holds the host rendering policy constant, but does not reproduce all current production subscription behavior. The first cold component render is measured separately. Subsequent component renders use existing component caches. A real terminal, keyboard delivery and terminal painting are absent.

Host event-loop delay is sampled at 1ms resolution during the live workload, excluding startup and the first render. RSS is measured in the host after eager readback of all four histories; RPC child-process memory is excluded. Do not compare that metric as total system memory. Readback timing opens all four files eagerly, not a lazy history implementation.

## Observations

Environment: Node v26.11.1, installed Pi 1.0.4, Linux 7.2.5-3-omarchy, AMD Ryzen 9 3900XT, 24 logical CPUs. This is one machine and a small local workload, not a production benchmark.

Ranges across three repeats, milliseconds:

| History messages per child | Mode | Startup, four children | First Fleet component render | Host loop delay p99 during stream | Live workload |
| --- | --- | --- | --- | --- | --- |
| 0 | SDK | 42.8–49.5 | 20.6–21.6 | 11.3–11.4 | 971.3–984.6 |
| 0 | RPC | 2312.9–2422.3 | 23.6–37.6 | 7.7–10.5 | 835.9–844.5 |
| 2,000 | SDK | 79.6–87.9 | 182.0–201.8 | 10.5–12.7 | 997.5–1017.3 |
| 2,000 | RPC | 2388.2–2447.6 | 204.4–214.0 | 9.4–10.6 | 852.2–871.8 |

RPC reduced live workload time in these samples but did not remove cold transcript layout cost in the host. The loop-delay ranges overlap; these observations do not establish a general performance winner. First-render measurements are component execution times, not input-to-frame latency.

### Abrupt termination and corruption

Each crash uses one child with no seeded assistant history. Launch metadata is written before launch and is intentionally not updated until the run returns.

- After eight text deltas, both modes recovered the seed prompt, system message and live prompt, but **zero assistant characters**. The observed streamed text was not in the persisted session.
- At `agent_settled`, both modes recovered the complete 69,632-character assistant response. Separately stored metadata still said `running` because the process died before that update. `interrupted` in the evidence is the fixture's conservative read-only projection, not a recovered execution or proven final outcome.
- Appending a deliberately incomplete final JSONL record to a copy did not prevent loading the prior valid entries. SessionManager skipped that trailing line; the fixture knows it injected damage. This does not implement detection or a user-visible incomplete-history warning.
- SDK crash cases kill the entire fixture host. RPC cases kill the child, after which the fixture host's wait times out and exits with code 1. These are distinct failure boundaries, recorded in the raw evidence. No child is resumed.

A synchronous append returning is not a power-loss durability guarantee. No fsync, disk failure, real mid-write termination, parent-only RPC death, or power-loss test was performed.

## Mock inventory and remaining uncertainty

| Boundary | Treatment | Needed for stronger evidence |
| --- | --- | --- |
| Model provider | Pi faux provider; fixed text, no tools | Representative provider streams, thinking and tool traffic |
| Child runtime | Real SDK AgentSession or real Pi RPC CLI | Existing harness custom tools, MCP, Bridge, steering and cancellation adapters |
| Fleet host | Existing component; fake session listing and manual 33ms cadence | Real TUI input, terminal painting and production subscriptions |
| History | Seeded real persistent JSONL; one selected child | Lazy access, very large entries, disk contention and multi-session lifecycle |
| Metadata | Simple separate fixture manifest | Atomicity/reconciliation contract and durable child discovery |
| Crash | Self-SIGKILL at stream/settled checkpoints | Tool-in-flight, write-in-flight, shutdown/reload and parent-death cases |
| Recovery | Read entries without creating executable sessions | Incomplete-history UI and no-action controls |

There are no tool calls, thinking blocks, images, navigation tests, or main-session collapse parity tests here. The component used is the current Fleet renderer, not a new approved UI. Cold layout and session parsing run on the host regardless of child transport. Actual filesystem mutation coordination and RPC tool parity remain untested.

## Proposed falsifiable contract and brief delta

Proposed, not yet accepted:

1. A child's durable identity must exist before execution can produce observable work.
2. To preserve streamed content already shown in Fleet, finalized Pi session entries alone are insufficient. A separate incremental capture or equivalent durable boundary is needed; its loss window must be stated and tested.
3. A recovered nonterminal record must not appear active or restart. A finalized transcript with stale metadata must not silently be called a successful execution.
4. Missing or malformed transcript data must remain visibly incomplete; silently skipping damaged lines is insufficient for the approved audit behavior.
5. Opening a long history needs bounded host work independently of SDK/RPC. Render and persistence performance must be evaluated separately.

The proposed brief delta is to make the streamed-content loss boundary and stale-metadata treatment explicit. No approved brief, glossary or ADR was modified. ADR 0016 retains the in-process execution decision; RPC adoption would require a separately accepted supersession.

## Disposition and validation

Observed verdict: partial evidence. The fixture answers finalized-versus-streaming retention and exposes cold host rendering cost, but does not settle SDK versus RPC or prove production responsiveness.

Recommended disposition: `reference-only`.
User-confirmed disposition: pending. There is no Approved Prototype UI Contract.

Recommended next step: use these observations to constrain persistence and history rendering, then evaluate RPC tool/coordination parity and a representative interactive workload before choosing the transport. No automatic implementation base or migration is proposed.

Validation: the final driver completed all 12 performance cases and four recovery assertion cases. `npm run check` exited 0 in 20 seconds: 935 tests passed, 14 skipped, zero failed; packed distribution passed. An earlier check stopped at Knip because the first prototype location was outside its known entries. The artifact was moved under `.agents/prototypes`, already excluded by repository Knip configuration, without changing that configuration. The prototype is explicitly validated by its driver; the repository gate does not establish experimental correctness.

No production files were changed. No commit, branch or publication was created. Durable branch preservation remains pending the repository's explicit approval process.
