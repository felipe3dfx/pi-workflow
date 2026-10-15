# Integrated Fleet capture → bounded reopen (reference experiment)

**Research Verdict: partial. Recommended disposition: `reference-only`. User-confirmed disposition for this NEW artifact: pending.** Prior two artifacts are accepted reference-only per conversation; their pending-disposition prose is historical. No Approved Prototype UI Contract is claimed. No production/configuration/ADR/glossary/brief change, transport adoption, publication or Git mutation occurred. ADR 0016 remains authoritative.

## Decisive answer

**Yes, for the demonstrated bounded message/event subset:** a real SDK session or real Pi RPC subprocess can feed the same incremental raw-event journal and derived on-demand display. Ordinary reopen reads fixed metadata, one bounded acknowledged raw-tail record, and at most eight message snapshots—not the retained journal or a directory listing. A crash between raw acknowledgment and head publication leaves a visible stale-index warning and bounded older history, without running an agent. **No arbitrary-message or full Pi UI parity is established.** Oversized actual text/tool workloads hit explicit, measured limits rather than silently deleting audit bytes or inventing equivalence.

Keep SDK/RPC undecided. Both delivered the tested text, thinking/toolcall finals and tool results through this seam. A smaller measured RPC open time is not evidence for a transport choice: it is host scheduling noise, not an isolation, supervision, mutation-brokerage, lifecycle or production-overhead comparison. No no-capture control was run; none of these timings is claimed as capture overhead.

## Lifecycle and exact limits

`store.mjs` reuses accepted B's `Capture`, `normalize` and full diagnostic `recover` **read-only**. The new seam replaces B's unbounded replay-on-open and unsafe pre-admission sequence mutation with explicit admission before capture and a derived index. It does not introduce another independent source of truth.

- **Raw capture**: the original checksummed, sequence/hash-chained normalized event envelopes, immutable identity first, append-only OS writes. “Raw” means normalized observed events, **not every original SDK field/provider byte**. SDK cumulative snapshots are omitted equally to RPC; thinking/toolcall partials remain explicit unsupported-kind markers. Only demonstrated text partials reconstruct; authoritative finalized thinking/toolcalls/results are retained.
- **Derived index**: one checksummed immutable live revision per observed update, one final snapshot per message, an atomically renamed head, and checksummed identity metadata. Head advances only after raw write acknowledgment and snapshot publication. Raw high-water offset/last-envelope hash tie the head to its acknowledged tail. A live final replaces the partial ordinal, never appends duplicate text. Live-revision files are deliberately not garbage-collected: no crash-safe reclamation protocol is claimed. This write-amplifying representation is an experiment, NOT a recommended production storage format.
- **Writer ownership**: exclusive `writer.lock` creation (`wx`), tested across processes. Root creation only; even a closed/crashed root cannot acquire another writer. No stale-lock stealing, continuation, distributed queue or production file-mutation brokerage. Read-only reopen ignores the retained writer lock and cannot launch sessions.
- **Producer admission**: conservative charge `2 * JSON event bytes + 1024`; maximum charge **220 KiB/event**, **512 KiB queued**, **64 queued entries**. Approximately 112,128 JSON bytes fit a single charge; exact JSON envelope/content determines admission, not text-character count. The inherited raw writer is only called serially with admitted events and retains its own 256 KiB queue bound. The larger *outer* bound is justified by the demonstrated synchronous text-end/final burst: a 240 KiB outer queue refused the ordinary 69,632-character fixture. It is not a global policy change.
- Admission refusal occurs before sequence/chain mutation, writes a visible `REFUSED` marker, and throws. Real large-workload drivers stop accepting observations and invoke SDK/RPC **abort**. This is **refusal/stop, not producer awaitable backpressure or lossless spooling**. The rejected oversized event is NOT retained; the accepted raw prefix is. No silent audit truncation, retry/resume guarantee, or successful completion after refusal.
- **Display access/cache**: one resident window, ≤8 entries and ≤192 KiB encoded snapshot reads; ≤96 KiB/message representation, 8 KiB each for identity/head, ≤256 KiB for the acknowledged raw-tail read. Actual normal empty/nonempty cases use 3/11 payload reads (stat calls not counted). No full index preload or layout cache. Oversized cumulative partial display becomes an explicit unsupported placeholder while raw deltas continue to be captured; full expansion is refused. Snapshot construction may transiently cross its limit by one admitted event before replacement; this is not a total process-heap bound.
- **Recovery**: intact head → bounded validated index plus checked raw-tail watermark. Missing/corrupt head → a separately timed **64 KiB / 8-entry earliest raw prefix** with hash/sequence/identity validation and explicit incomplete warning. The prefix fallback does not repair the index. `diagnosticReplay` is a separately timed, explicitly requested **whole raw journal scan**, read-only, nonexecutable. No migration/import/index rebuild is hidden before the normal-open timer. Full-chain audit verification is not performed on ordinary open; interior raw corruption outside the checked tail requires the explicit diagnostic.
- Received observations, accepted queued events, written raw records and `synced=0` are separate. IPC reports acknowledged byte offset and hash; tests reconcile that exact final acknowledged envelope after SIGKILL and verify all acknowledged records remain in the validated raw prefix. **No fsync, power-loss guarantee, or bounded write-delay promise.** Exceptional refusal marker and derived rename are not crash-atomic with raw capture.

## Final evidence (behavior frozen for runs 3 and 4)

Each `streams-{3,4}.json` contains 12 cases: SDK/RPC × complete, raw-ack/head-gap SIGKILL, unacknowledged-stream SIGKILL, final-before-terminal SIGKILL, large text and large tool. Each runtime starts after **2,000 synthetic retained user messages passed through the same raw/index writer**; their complete build time is separately recorded. Execution itself uses the installed Pi SDK/RPC, an isolated local faux provider, actual thinking/toolcall/result/final events and no network provider. Every normal complete assistant text equals the literal 69,632-character fixture; final correction has an independent literal assertion. Identity/filtering, unique ordered ordinals, corruption, torn tails, exact acknowledged raw boundary, and read-only projection are asserted.

### Access, construction and explicit scans

`assertions-{3,4}.json`, fresh reader objects but OS-cache-warm files (no physical cold-disk claim):

| Retained messages | Entire raw/index build | Normal open | Open bytes / payload reads | Explicit full raw scan |
| --- | --- | --- | --- | --- |
| 0 | 2.00–2.29 ms | 0.78–0.97 ms | 724 / 3 | 0.23–0.29 ms / 221 bytes |
| 2,000 | 307–323 ms | 1.80–2.00 ms | 2,891 / 11 | 12.47–12.78 ms / 644,007 bytes |
| 10,000 | 1,477–1,495 ms | 0.73–0.92 ms | 2,897 / 11 | 56.14–56.27 ms / 3,228,009 bytes |

Full backpaging reaches every literal synthetic ordinal without gaps; byte/entry queue refusal and cross-process writer refusal are asserted. Missing-head prefix fallback reads 65,694 bytes including identity metadata at 2k/10k, returns the earliest 8 entries, and takes 0.22–0.25 ms **inside the failed-open operation**, explicitly identified as recovery rather than pooled into the normal-open table.

Real stream complete reopen: **1.79–4.12 ms / ~91,170 bytes**, compared with separately requested full raw scan **12.85–30.49 ms / ~896,307 bytes**. Final-before-terminal reopen reads ~169,418 bytes because its acknowledged raw-tail envelope is the large final message; still bounded. Other checkpoint detail remains in JSON rather than an invented SLO.

### Interruption and size boundaries

| Case | Received / acknowledged text | Retained validated raw text | Display/result |
| --- | --- | --- | --- |
| raw ack before derived publication | 8,192 / 8,192 chars | 8,192 both transports | older bounded index + high-water mismatch warning |
| kill during unacknowledged stream | 8,192 / 7,168 | SDK 8,192; RPC 7,168 | explicit incomplete; 0 / 1,024 observed loss |
| final before terminal metadata | 69,632 / 69,632 | 69,632 both | finalized content, NOT completed run |
| ordinary completion | 69,632 / 69,632 | 69,632 both | bounded final replacement; unsupported partial warnings remain |
| actual 180,000-character assistant text | 180,000 / 180,000 | 180,000 both | cumulative display exceeds 96 KiB → placeholder; large text-end/final admission refuses → producer aborted |
| actual 300,000-character tool result | no assistant text | prior accepted prefix only | first oversized observed event refused; producer aborted; large result NOT captured |

Two final repeats reproduce these boundaries, not transport durability guarantees. Any unacknowledged write may survive or disappear. Maximum observed outer queued charge is **302,426 bytes / 12 entries**, maximum raw OS-write acknowledgment latency **7.00 ms**. Aggregate derived-publish timings include the seeded history and are bookkeeping, not isolated capture overhead. Tests also damage the head, a snapshot, a same-length raw tail and a truncated appended tail. Incomplete prefixes remain visible. Deterministic torn writes *inside* a syscall and power failure are not induced.

### Real Pi TUI / PTY scheduling

`pty-{3,4}.json`: eight total cases, SDK/RPC each twice per file, same capture/read/render policy and 2,000 retained messages. Actual cumulative SDK/RPC text drives refresh; no synthetic “latest text” substitute. Refresh scheduling coalesces to one pending refresh; input admission caps eight entries. Real `ProcessTerminal`/`TuiMainScreen` render scheduling and owned Linux PTY, 55 columns × 40 rows. Reopen, detach to older ordinal, expand/collapse, newer ordinal, follow run during new data arrival. Follow renders the resident tail; detached view remains fixed.

Input injection → `ProcessTerminal.write` invocation: SDK reopen **18.20–19.85 ms**, RPC **16.55–19.81 ms**; other actions ~15.2–17.7 ms. Kernel PTY receipt is also recorded; neither is physical display latency. These are comparable policies, **not a Fleet-production baseline comparison**.

The renderer is intentionally plain bounded text, not Pi Markdown/AssistantMessageComponent, full Chrome, or a production UI contract. Navigation is **message-window paging, not row-complete scrolling within a large message**. Toggle preserves the first ordinal; row/message-offset anchoring through expansion/resize is not proved. Thinking final expansion is meaningful in the text layout, but tool-specific expansion is absent. Separate-root unselected-stream isolation has an assertion with real disk writes; simultaneous multi-session selected/unselected UI isolation is **not** demonstrated. Parent filtering and Group identity are preserved in storage, not a complete Active/History Group listing UI.

## Remaining blockers to a technical specification

1. **Lossless arbitrary events/messages and admission policy:** current stop/refusal loses the explicitly rejected oversized event, and display cannot navigate all rows of an oversized message. Need evidence for chunked/spooled raw admission and on-demand message/block slicing, or explicitly accepted finite refusal semantics. Do not infer parity from the intact 180k delta prefix.
2. **Recovery/index lifecycle:** no crash-safe repair/compaction/reclamation, stale-lock takeover, legacy Pi import, suffix-deletion high-water authority outside this root, hostile-schema validation, branching/retry/compaction reconciliation, fsync policy or long-journal bounded repair. Snapshot duplication/write amplification must be measured before selecting a format. Missing head intentionally exposes earliest bounded prefix, not latest history.
3. **Product UI and concurrency:** real multi-child cumulative streams, complete Group/history navigation, row-complete scrolling and stable expansion anchors, richer types, resize/theme and lifecycle tests remain. Full arbitrary-message solution is outside this bounded experiment.
4. **Transport:** no evidence here resolves process isolation/supervision or coordinated file mutation. ADR 0016 stays unchanged; neither SDK nor RPC can be recommended *for production selection* on this limited evidence.

Only potential material product choice for later specification: **is visibly stopping/refusing on an oversized observed event acceptable, or must arbitrary-size evidence always be retained?** This experiment does not adopt either policy. No routine scope confirmation is needed to retain the present honest partial evidence.

Proposed falsifiable brief delta (NOT applied): separate raw acknowledgment from derived-display publication; bound normal access/cache/queue in entries and bytes; require incomplete-prefix display without execution recovery; specify explicit admission/refusal and separately billed recovery; evaluate transport independently. Existing accepted requirements and decisions are not rewritten.

## Reproduce / provenance

From repository root, existing dependencies only, sequentially:

```sh
node .agents/prototypes/fleet-integrated-history/assert.mjs > /tmp/fleet-integrated-assert.json
node .agents/prototypes/fleet-integrated-history/run.mjs > /tmp/fleet-integrated-streams.json
python3 .agents/prototypes/fleet-integrated-history/pty-run.py > /tmp/fleet-integrated-pty.json
npm run check
sha256sum -c .agents/prototypes/fleet-integrated-history/preserved-before.sha256
```

Read AGENTS, ordered workflow contracts, glossary/ADR 0016, applicable prototype/codebase-design/TS/writing/TDD skills and valuable-tests reference, test/support README, both accepted prototypes' reports and relevant source. ESM fixtures follow existing research conventions; production TypeScript configuration is untouched. The seam has durable literal/limit/failure assertions, but this is **not a complete test-first RED→GREEN claim**: implementation preceded much of its coverage. An initial assertion exposed ordinary-fixture admission refusal under a 240 KiB outer queue; the bounded outer queue was revised to 512 KiB. Initial Python driver name `pty.py` shadowed the standard library and was renamed; that setup error is not a behavior RED. Mutation testing is unsupported by repository policy.

Three unused imports were removed after measurements; no measured behavior changed. Earlier local evidence files 1/2 are development iterations, not pooled into final ranges.

Only expected untracked `.agents/prototypes/` existed on entry. `preserved-before.sha256` / `preserved-after.sha256` cover every file in both preexisting artifact directories, including their prior manifests. All match. Fixtures use isolated temporary HOME/agent roots, offline faux models, no credentials/real sessions, no installs or network providers. SIGKILL/cleanup targets only owned process groups including RPC descendants. An external kill of the driver itself remains an untested cleanup edge. See `VALIDATION.md` for exact final commands and gate result.
