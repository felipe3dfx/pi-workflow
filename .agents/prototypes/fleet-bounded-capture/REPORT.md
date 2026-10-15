# Fleet bounded history and incremental capture

## Decision and scope

**Research Verdict: partial. Recommended disposition: `reference-only`. User-confirmed disposition for this new artifact: pending.** No Approved Prototype UI Contract exists. No production file, configuration, approved brief, glossary, ADR, transport or mutation queue was changed. SDK versus RPC remains undecided; ADR 0016 remains governing policy.

Questions: (A) can bounded disk access and resident layout avoid processing the entire transcript on opening and expansion? (B) can content observed at the child event seam survive interruption through incremental capture? Success means falsifiable assertions and matched observations with explicit limits, not an invented latency SLO or production readiness.

The authorized product scope remains every child of the current parent, Active/History sections preserving launch Groups, inline live collapse/expand, durable parent-lifetime history without age/count pruning, visible incomplete records, and no execution restart/resumption. The experiments test selected mechanisms, **not that complete product scope**.

## Reproduce

Use existing dependencies, from the repository root. Run sequentially; do not run the quality gate while a redirect is creating an evidence JSON file.

```sh
node .agents/prototypes/fleet-bounded-capture/assert-history.mjs > /tmp/fleet-pages-assertions.json
python3 .agents/prototypes/fleet-bounded-capture/history-run.py > /tmp/fleet-pages-pty.json
node .agents/prototypes/fleet-bounded-capture/capture-run.mjs > /tmp/fleet-capture.json
npm run check
sha256sum -c .agents/prototypes/fleet-bounded-capture/preserved-before.sha256
```

All fixture storage uses owned temporary roots. The PTY runner isolates HOME, offline/agent state and a new process group; capture forks isolate HOME/agent state, use explicit local providers/resources, no tools/MCP, and a new process group. Cleanup targets only owned groups, including RPC descendants. No installs, network model calls, operator credentials or real sessions were used. SIGKILL of the outer driver itself remains an untested cleanup boundary.

Read: AGENTS and ordered workflow contracts; prototype/codebase-design/TypeScript/writing/TDD skills and valuable-tests reference; test/support README; original README/FOLLOWUP, source and evidence; applicable ADRs 0006/0007/0014/0016. Installed Pi 1.0.4 SDK/TUI/RPC/JSON-event docs, SDK extension/session/minimal examples, pi-tui README, and assistant component source/declarations informed the used interfaces. Code remains ESM JavaScript like the original fixture; production TypeScript configuration is untouched.

## A — bounded history

### Implementation and costs

`history.mjs` stores 16 messages per checksummed page, addressed arithmetically from a fixed-size head. Opening reads **only the head and latest page**, not a preloaded SessionManager, directory listing or full-history index. Storage has no pruning. The UI retains at most three pages and four layout variants per cached page. Cold layout and thinking toggles affect at most the resident 16-message page. Pi's actual Markdown/theme, key parser, ProcessTerminal and TuiMainScreen implement layout/input/scheduling/output. The alternative is an isolated replacement history-access/layout experiment, not a production Fleet modification.

`build()` constructs the page representation from synthetic messages and measures the entire construction/write cost separately. This is a one-time full pass, **not lazy migration of existing Pi sessions**. Missing-head recovery scans/verifies all pages explicitly; it is not counted as bounded OPEN. No underlying SessionManager file is secretly scanned before the timer.

First-open read/verify/parse, excluding layout:

| Messages | Baseline eager pages | Candidate bounded access | Candidate bytes/messages |
| --- | --- | --- | --- |
| 0 | 1.20–1.41 ms | 0.51–0.67 ms | 82 / 0 |
| 2,000 | 12.60–15.80 ms | 0.79–1.10 ms | 12,174 / 16 |
| 10,000 | 70.02–75.57 ms | 0.70–1.05 ms | 12,175 / 16 |

Baseline reads 1,506,685 / 7,551,185 page bytes for the nonempty cases. Head overhead is excluded from baseline byte totals but included in its timing. Candidate `readParseMs` measures async read and envelope parse; `pageVerifyParseMs` separately measures hash/payload parse/ordering validation; total bounded-open timing includes both. Page build/write ranges across both modes: 22.10–26.61 ms at 2,000 and 77.76–104.76 ms at 10,000. Final assertion run's full head rebuild: 12.45 ms / 1,506,685 bytes at 2,000; 61.92 ms / 7,551,185 bytes at 10,000. Damaged last page is detected during rebuild and leaves a visible incomplete-index warning.

**Cold means fresh access/layout objects, not cold physical disk.** Files were just generated, likely in the OS cache. No privileged cache drop, direct-I/O or physical-disk cold-start capability was used. These measurements explicitly expose reads and construction but do not establish uncached storage latency, index crash atomicity or live page maintenance.

### Matched PTY observations

Final `history-evidence-3.json`: 18 cases, three repeats for baseline/candidate × 0/2,000/10,000, alternating order; 216 input probes. Same messages, 55 columns/40 rows, four local synthetic streams updating every 25ms, real Pi rendering schedule, no manual frame timer. Baseline is unchanged production Fleet via a fixture listing adapter, with eager page reads moved **inside Enter handling**. Candidate also opens inside Enter handling. Initial list rendering performs no historical layout.

Ranges in **injection-to-ProcessTerminal.write invocation completion milliseconds**:

| Messages | View | Open | Page up | Load-earlier probe | Collapse | Expand | Follow | Reopen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Fleet baseline | 44.69–49.50 | 1.19–2.16 | 1.32–1.88 | 1.17–1.88 | 1.29–1.92 | 0.96–1.31 | 16.54–17.83 |
| 0 | Candidate | 17.71–18.22 | 16.14–17.50 | 15.63–15.81 | 0.38–0.57 | 0.34–0.40 | 15.73–15.91 | 15.52–15.87 |
| 2,000 | Fleet baseline | 218.54–224.97 | 2.67–5.01 | 2.00–2.59 | 133.15–152.15 | 2.35–3.88 | 3.17–3.95 | 18.45–27.01 |
| 2,000 | Candidate | 33.71–37.54 | 17.01–17.05 | 16.22–16.70 | 5.50–5.79 | 0.50–0.64 | 15.94–16.46 | 17.31–19.28 |
| 10,000 | Fleet baseline | 805.10–830.95 | 11.97–12.69 | 10.50–13.00 | 594.51–620.58 | 12.33–13.24 | 10.55–15.88 | 69.76–114.54 |
| 10,000 | Candidate | 32.98–36.79 | 15.09–16.87 | 16.16–16.38 | 5.51–8.72 | 0.34–0.63 | 15.59–16.25 | 18.70–19.43 |

Reopen re-reads storage in both views; candidate discards resident state, while Fleet retains renderer caches. Reopen is not a second fully cold component construction. Empty-history thinking keys are no-op controls. Candidate page navigation is slower than cached Fleet scrolling in these samples; async reads interact with Pi scheduling. This is evidence for bounding open/collapse work, not a universal speedup.

Raw probes also record injection-to-input delivery, render execution, write invocation and PTY receipt. Open-to-PTY-receive ranges: baseline 44.70–49.50 / 218.56–224.98 / 805.12–830.96 ms; candidate 17.74–18.26 / 33.77–37.57 / 33.02–36.87 ms. This is a kernel PTY endpoint, **not physical display or terminal-emulator painting**. Markers force even no-op actions to write. Reader and post-write logging can race.

Assertions verify latest-page access, two reads/16 parses, three-page cache bound, resident toggle/reused expanded layout, full 2,000-message page ordering without gaps/duplicates, **every message reachable through row backscroll**, follow/detach and selected/unselected isolation, empty history, missing/corrupt page warnings, restored-page retry, and explicit full-scan head recovery. The fourth PageUp in each nonempty candidate PTY case must have parsed exactly 32 messages, demonstrating demand loading after crossing a page edge.

### UI/mock inventory and remaining A gaps

- Candidate uses real Pi Markdown and themes but simplified message/thinking labels, not AssistantMessageComponent or all harness Chrome. Ctrl+T changes the resident page, not the whole transcript. It has no per-block pointer expansion, tool expansion, tools/images, resize/theme/mouse/IME coverage, or demonstrated main-Pi collapse parity.
- Row backscroll traverses bounded pages. It has no absolute scrollbar or full-transcript height computation. Expansion clamps a row offset; stable message anchoring across expansion/resize remains unverified.
- Four streams are **synthetic counters/latest text**, not four SDK/RPC producers or the accepted 69,632-character cumulative live workload. Detached history stays fixed; follow exposes selected live text; unselected text does not leak. This does not prove sustained cumulative-stream layout bounds or provider traffic equivalence.
- Baseline/candidate have identical disk/content/control workload, but different UI/layout work. The baseline uses the new page representation, not raw Pi JSONL. Compare with original FOLLOWUP for real SDK/RPC runtime overhead; do not concatenate the two experiments into an end-to-end claim.
- Candidate has one selected child, not the complete Active/History Group list. Arbitrarily large single messages, byte-bounded pages, branching/compaction import, durable concurrent page append/update, atomic head publication, missing-head identity recovery and concurrent disk contention remain unsupported. The index recovery fixture uses known synthetic identity constants, not production discovery.
- Corrupt/missing pages are visible and retryable, but async loading currently leaves the previous frame until read completion; there is no approved loading/error control design. Complete trailing-page deletion during a head rebuild cannot be detected without a separately retained high-watermark.

## B — incremental observed-event capture

`capture.mjs` is a transport-independent async append-only, hash-chained ordered record module. It writes child/parent/Group/task identity before starting a real SDK session or RPC subprocess. Both adapters use the same explicit **text-only partial normalization**: omit SDK cumulative snapshots; retain text start/delta/end and authoritative message_end. Final messages replace partial projection rather than append duplicate text. Other partial types become visible unsupported-partial warnings; finalized messages and tool events remain as evidence. No executable SessionManager/session is constructed during recovery.

Each record has a contiguous sequence, previous hash and payload hash. Recovery stops at a verified prefix on a gap/corruption and classifies nonterminal/stale state as `interrupted/incomplete`. A complete transcript before state update is **not** called a successful execution. Only settled plus explicit completed capture state without warnings projects completed; that state does not imply a successful task Verdict. Recovery is read-only with no restart/continue action or execution call.

Producer received text, queued records/bytes, completed OS writes and synced count are separate evidence fields. Writes use async FileHandle.write, serialized in one owner with short-write handling. The queue refuses beyond 256 KiB explicitly rather than silently dropping records; admission failure handling/backpressure is not integrated with a production producer. JSON encoding/hash computation still runs on the host. There is **no fsync** (`synced: 0`), no time-based durability guarantee, and completed write acknowledgment does not guarantee survival of power loss/filesystem failure. The byte limit bounds queued encoded data, not wall-clock delay; a single larger event can be refused.

Final `capture-evidence-3.json`: two repeats × SDK/RPC × queued/acknowledged/final-before-state/normal completion = 16 cases, local installed Pi faux provider, 68 text deltas and 69,632 final text characters per completed stream.

| Checkpoint | Observed received | Acknowledged text | Recovered SDK | Recovered RPC | Projection |
| --- | --- | --- | --- | --- | --- |
| During stream, after enqueue #8 | 8,192 chars | 7,168 chars | 8,192 | 7,168 | interrupted/incomplete |
| After acknowledged delta #8 | 8,192 | 8,192 | 8,192 | 8,192 | interrupted/incomplete |
| Settled transcript before state update | 69,632 | 69,632 | 69,632 | 69,632 | interrupted/incomplete |
| Normal capture completion | 69,632 | 69,632 | 69,632 | 69,632 | completed |

At the queued checkpoint the measured unacknowledged window is one 1,024-character delta. SDK's pending write happened to survive; RPC lost that delta. **This is not a transport guarantee**: write/SIGKILL scheduling is racy, and any unacknowledged record may survive or disappear. Every previously acknowledged text prefix survived all controlled SIGKILL cases. SIGKILL targets the capture host; its owned process group is reaped afterward, including RPC descendants. Actual mid-syscall torn writes were not deterministically induced.

Maximum observed queued encoded bytes: 158,276 SDK / 158,058 RPC; maximum write-ack latency 7.80 / 1.61 ms; maximum sampled host loop delay 4.68 / 1.82 ms. Recovery took 0.25–2.78 ms across these small files. These are auxiliary observations without a no-capture control, not proof of negligible production overhead or a transport winner.

Every case also tests truncated extra tail, a removed interior record, corrupt interior record, and a removed complete final record. Recoverable prefixes are retained and never marked completed after damage. A removed complete suffix cannot always be distinguished from a shorter interrupted stream: absence of the completed/settled boundary remains conservative, not proof of corruption location. Other assertions cover missing file, final text correction replacing literal `draft` with `final correction`, identity/group preservation, multiple children in one Group, foreign-parent exclusion, and no executable recovery projection.

Remaining B gaps: full thinking/toolcall/image partial reconstruction, provider retries/multi-turn reconciliation beyond the simple fixture, unobserved provider bytes before host reception, producer backpressure on slow disks/queue refusal, strict hostile-data schema validation, multi-writer exclusion, capture rotation/large-file bounded recovery, atomic metadata/catalog publication, fsync/power loss, actual tool-in-flight damage, parent-only RPC death while capture continues, shutdown/reload and integration with A's pages. Recovery scans the entire small capture file; **B is not bounded-history opening**, and the two storage modules are intentionally not joined into a proposed production architecture.

## Proposed falsifiable contract and brief delta — NOT applied

1. Preserve immutable parent/child/launch Group identity before observable execution. Discovery must filter current-parent children without losing Group identity when moving from Active to History.
2. Opening/rendering and resident expansion must not parse/layout total retained history. State a bounded window in messages **and bytes**, measure first disk/index construction/recovery separately, and keep every historical message reachable by backscroll. Retention remains unbounded for the parent's lifetime.
3. Scrolling away disables follow; unselected streams cannot replace selected content. Expansion preserves an identified message anchor and invalidates only affected bounded layout. Full Pi interaction equivalence requires separate evidence and Owner review.
4. Expose distinct received/queued/written/synced capture states and an explicit loss/admission policy. Never equate displayed/queued content with durable acknowledgment or completed writes with power-loss durability.
5. Reconcile deltas by message/block identity and authoritative finals without duplicate transcript text. Missing/corrupt data remains visibly incomplete; recovery never recreates an executable session. Stale separate Run state cannot establish successful task outcome.

Proposed brief delta: add measurable bounded-access/window/expansion requirements independent of SDK/RPC, explicitly define incremental capture acknowledgment and incomplete-history semantics, and require truthful damaged-prefix/read-only recovery. No accepted thresholds or approved UI layout are proposed. Seek separately scoped evidence before choosing a persistent storage format or transport.

## Validation and preservation

Initial safety net and post-implementation full gate passed. A meaningful assertion RED is retained in `history-red.txt`: rebuilding a damaged index initially hid its warning and rendered `[m-1968]`. Propagating the recovery warning fixed that behavior; repeated assertion outputs are retained. Other mechanisms were implemented then asserted; this is **not a claim of a complete test-first RED/GREEN history**. An early PTY driver failure exposed coalesced inputs during the 10,000-message baseline's long frame; final probes wait for each correlated write before sending the next input. An early capture-driver completion lost its IPC evidence when disconnecting before send acknowledgment; awaiting the IPC callback fixed the harness, not durability.

Accepted measurements: `history-evidence-3.json`, `history-assertions-5.json`, `capture-evidence-3.json`. Earlier successful evidence is retained as development iterations: history-evidence.json lacked row-continuous paging, history-evidence-2.json added row paging; capture iterations added lag/tail/identity tests. Do not pool changed workloads. Prototype drivers were run repeatedly. Repository `npm run check` does not run them and does not establish their correctness. Mutation testing is unsupported by repository policy and was not run.

One concurrent full-gate attempt failed Biome parsing because evidence redirection temporarily left two JSON files empty; rerun the full command after all evidence writers finish, without weakening the gate. Final gate result is recorded in `VALIDATION.md`.

At initial inspection only the 15 accepted untracked `.agents/prototypes/fleet-history-comparison/*` files existed; no other preexisting changes appeared. `preserved-before.sha256` and `preserved-after.sha256` hash **all 15**, including prior evidence and reports. They match; `sha256sum -c` reports all OK. No branch/commit/git or gh mutation/publication occurred. New files exist only under this reference directory; production integration and user-confirmed disposition remain pending.
