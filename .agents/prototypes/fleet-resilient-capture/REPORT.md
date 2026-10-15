# Fleet resilient capture: admission and failure policy

**Worker Verdict: done (bounded research). Recommended disposition: `reference-only`. User-confirmed disposition for this new artifact: pending.** No implementation, approved UI contract, brief delta, transport decision or production readiness is implied. ADR 0016 is unchanged.

## Decision

**The functional blocker is closed sufficiently to write a specification.** The user-resolved policy is feasible at the observed-event seam: retain successful-operation large events in chunks; treat capture failure as incomplete history, never as a reason to abort/cancel/steer the agent. Both actual local SDK and real RPC/faux-provider runs finish with the expected normal result despite injected filesystem failures. The prior integrated prototype's per-event refusal/producer-abort policy is contradicted, not adopted. Its files and historical evidence remain unchanged.

This is one focused experiment, not a replacement Fleet architecture. It reuses the established `normalize` seam read-only, replaces the integrated writer's large-event admission cutoff with a tiny synchronous chunk spool, and supplies a read-only recovered view. It does not repeat UI/PTY/long-history performance work.

## Evidence

`runtime-{1,2}.json`: **32 actual runs**, SDK/RPC × eight cases × two repeats. Every run returns **180000 ASCII assistant characters and 300000 ASCII tool-result characters**, `stopReason: "stop"`, and `agent_settled`. The fixture's independent session-message query verifies these results even when capture is disabled. Observed SDK/RPC abort, steer and followUp calls are all zero before ordinary fixture disposal; the capture module has no session/lifecycle handle. The parent driver independently opens and reconciles the files **after the writer subprocess exits**; no live writer state is supplied to that reader.

| Filesystem case, each transport/repeat | Recovered capture | Agent result | Incomplete evidence after writer exit |
| --- | --- | --- | --- |
| healthy writes | exact 180000 assistant + 300000 tool; 35 complete events | normal | none |
| positive short writes (1623 per run) | same exact finals, no dropped events | normal | none |
| write rejection, `ENOSPC` shaped | 20 complete prefix events, full tool; 15 observed events dropped | normal | cause + loss marker and unfinished head |
| real 97-byte partial write then rejection | same complete prefix; partial frame explicitly signaled | normal | marker + raw/index mismatch + partial-frame scan warning |
| zero-progress write | same 20-event prefix; 15 dropped | normal | zero-write cause + loss marker |
| `head.json` publication rename rejection | 21 complete raw events, full tool + 16384 assistant chars; 14 later events dropped | normal | cause + loss marker + raw/index mismatch |
| all further raw/metadata writes blocked | 20-event prefix, full tool; 15 dropped | normal | generic unfinished head only; specific cause/count are live-only |
| all content writes blocked from creation | no persisted identity/history; 34 observed events dropped | normal | no durable record/cause/count; only missing-record warning if this root is already known |

Failures are armed at the first actual assistant text delta, after the tool result was retained, except the explicit no-storage case. Positive short writes call the real filesystem with successively smaller lengths; partial-write failure writes 97 real bytes before throwing. The replacement seam rejects only owned fixture operations, not actual disk capacity or permissions. Index failure rejects the real publication operation after real temporary-file content was written. All-block denies content writes, not filesystem directory creation. No disk was exhausted.

Every failure disables subsequent raw writes; assertions check no more raw-write attempts after the first failure. Health exposes cause, first lost observed ordinal, dropped event count and encoded-event bytes. In these deterministic fixtures, complete persisted-event count reconciles exactly with observed minus dropped count. The index-failed event is correctly retained, not counted as lost. Dropped bytes count JSON event bytes, not unique text characters: final snapshots and delta/end events overlap. They must not be read as semantic content-loss byte counts. Arbitrary syscall ambiguity, unobserved producer events, process death before observation, or post-crash loss are not covered by that exact accounting.

`assertions-{1,2}.json`: independent literal expectations also verify final replacement over stale delta/text-end content, one tool result and two assistant messages in actual runs (no duplicated partial/final), complete identity/current-parent filtering, identity mismatch rejection, UTF-8 chunk-boundary fidelity, checksum corruption, a torn frame/event, oversized frame-header rejection, readable verified prefix, bounded prefix access and nonexecutable recovery. A larger synthetic final retains **1120000 UTF-8 payload bytes**, 480000 JavaScript UTF-16 code units / 320000 Unicode code points, exactly. Real setup failure (`ENOTDIR` inside owned tmp) also returns incomplete capture instead of throwing to the producer.

## Minimal mechanism and measured bounds

`store.mjs` has no asynchronous event queue: each callback JSON-encodes one normalized event, then synchronously writes its chunks and publishes a compact head. **Queued event bytes/entries are structurally zero**, not evidence of an asynchronous pressure-control algorithm. Synchronous filesystem latency is charged to the emitting thread. This is the deliberate fewest-moving-parts research choice, **not a recommended production hot path or a nonblocking guarantee**. A stalled syscall can stall this prototype. A production asynchronous spool/admission policy still needs design; a finite asynchronous queue cannot guarantee lossless capture if producers indefinitely outpace storage.

- Event JSON is encoded once to a Buffer, split into **16 KiB** byte chunks. Each framed JSON envelope includes sequence, predecessor digest, event ID, chunk ordinal and final-chunk flag. Base64 safely crosses UTF-8 boundaries. Full-event projection occurs only after all chunks validate. The maximum observed framed write is **22085 bytes**; the enforced frame-body access bound is **24 KiB**, plus a 4-byte length header.
- Sequence/hash state advances only after a complete frame write. Any failure disables capture rather than retrying against a possibly torn frame. New roots have exclusive writer locks. No lock stealing, restart/resumption or replay execution exists.
- Raw writes precede head publication. The compact head binds identity, acknowledged sequence/hash, last-frame offset, raw size and completed state. No per-delta full-message snapshots are produced. This is an experimental format, not a proposed migration or finalized production format.
- Normal `Reader.open()` reads bounded identity/head/optional failure metadata (≤8 KiB each), a bounded referenced tail frame, and stat metadata. Successful actual runs read **936 bytes / four read syscalls**, measured **0.31–0.60 ms**. It does not load the journal, message snapshots, or a directory listing. It does not detect arbitrary interior corruption; that requires the explicit reconciliation scan.
- `prefix()` scans at most **eight frames**, ≤196640 content/header bytes, with no replay execution. It warns if more retained bytes or an unfinished event remain. It exposes available earliest complete messages, not an invented latest view.
- Explicit `reconcile()` validates the whole chain, reassembles one full event, projects partials, and replaces each partial with its authoritative final. It retains the result projection in memory. **This full scan is not bounded-memory ordinary history access.** Actual healthy scans read **1960242–1960258 bytes**, taking **8.50–20.06 ms**. These are OS-cache-warm measurements, not physical cold-disk measurements.

### Allocation and latency disclosure

Large single-event JSON encoding **does allocate proportionally to that event**. `JSON.stringify`, the UTF-8 event Buffer, the current base64/frame representation, runtime input messages and reconstructed event/projection can coexist. No arbitrary-size constant-memory claim, SDK/RPC pipe-memory bound or OOM-isolation claim is supported.

Healthy actual runs measured maximum event JSON **300236–300237 bytes**, maximum per-run encoding time **0.42–0.81 ms**, sampled maximum net heapUsed change across encoding **301016–600992 bytes**, maximum append duration **2.38–4.91 ms**, and cumulative append time **16.96–26.90 ms**. Prompt-to-normal-result time is **471.42–488.37 ms**, excluding session setup and the separately executed terminal metadata append/readback. These are instrumented fixture timings, not capture overhead: there is no no-capture control, heap peak sampling, RSS attribution or production SLO.

The larger synthetic event JSON is **1120091 bytes**, encoding **4.85–5.22 ms**, maximum append **11.04–13.20 ms**, and net sampled heap change **1836968–1848008 bytes**. Net heap sampling is GC-sensitive, excludes Buffer external memory, and is **not** a peak-allocation bound. Larger messages remain a design/scalability concern, not a new artificial event cutoff in this experiment.

## Warning durability is conditional

The live capture state reports failure immediately. If marker publication works, a fresh independent process recovers the specific cause and final loss counts. The first failure marker is best-effort; final counts are updated on clean fixture close, not atomically alongside every later dropped observation. No fsync or power-loss guarantee is claimed.

If storage cannot write the marker, a previously persisted unfinished head can still truthfully signal incomplete history after process exit, but **cannot persist the specific new error/count**. If no identity or capture content was ever written, Fleet cannot rediscover a child/history record from this storage alone. The live owner must show the warning; a known-root reader can report missing history, not reconstruct identity or reason. A durable specific warning in that case requires an independently writable durable marker/registry. This experiment does not invent one or imply that missing storage can store its own failure evidence.

## Ready for functional/spec contract — proposed delta, NOT applied

1. Agent lifecycle and capture health are separate. Audit capture pressure, rejected writes or index publication failure must not alone cancel, abort, steer or refuse an otherwise viable agent execution.
2. Successful supported-operation workloads retain authoritative large finals/tool results without silent dropping or a small artificial per-event admission cutoff. Chunk/spool retention is a viable direction, not an approved storage format or arbitrary-size guarantee.
3. Fleet visibly distinguishes complete history from incomplete/degraded history, preserves readable verified evidence, and reports observed loss/uncertainty. A degraded capture may disable further writes to prevent sequence/hash corruption while the agent continues.
4. Durable warnings are promised only where durable evidence or an independent marker actually exists. Live-only failure details must be labeled honestly; an absent durable record must not masquerade as complete history.
5. Ordinary access/queued work must be bounded in bytes as well as entries; larger expansion and full reconciliation are explicit operations with separately disclosed cost. Finals replace partials, identity/current-parent filtering survives recovery, and replay never resumes execution.

**Recommendation:** proceed to functional/spec drafting using this policy, without another broad architecture prototype or exhaustive production proof. Do not apply the delta until user acceptance. **No unresolved blocking product question remains for this bounded admission/failure-policy decision.**

## Still design/implementation work, not research blockers

Choose an asynchronous spool/scheduling and overload policy with acceptable latency; bound encoded-event/transient allocation or isolate it; choose durable completion/failure-marker semantics, fsync policy, message/block slicing and indexes; handle repair/reclamation, crash ambiguity, long journals, schema hardening, branching/retry/compaction, writer takeover and legacy import. No arbitrary event-size/throughput/losslessness guarantee follows from finite fixtures.

Existing UI gaps are unchanged: row-complete large-message scrolling, row/offset anchoring through expansion/resize, production Markdown/tool rendering, Group/history navigation and simultaneous selected/unselected multi-child isolation remain unproved. No UI or PTY work was repeated. Transport remains open; neither SDK nor RPC is selected, and ADR 0016 is not modified.

## Mock inventory / boundaries

- Local faux provider emits deterministic large thinking/toolcall/final content through the installed SDK or installed real RPC CLI. Replace with a real provider only in separately authorized production work; no paid calls or real credentials/sessiondata were used.
- One offline fixture tool returns a deterministic 300000-character result. No external tool execution/network is involved.
- `fixtureIO` wraps filesystem writes and publication rename, performs real owned-temp I/O, and injects bounded short writes/errors. It is the replaceable filesystem seam, not a fake capture store.
- Synthetic Unicode final and byte damage exist only in the focused assertion driver. Whole-file reads used to construct damaged fixture copies are outside reader-bound metrics.

See `VALIDATION.md` for commands, failures, complete quality-gate output and byte-for-byte preservation evidence.
