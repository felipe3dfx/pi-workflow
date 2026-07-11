# Gentle AI Review Coordination Portability

Research date: 2026-07-11

## Executive Summary

Gentle AI's recent review work has two distinct layers:

1. **Bounded review semantics** prevent duplicate work: immutable genesis scope, one frozen findings ledger, fixed reviewer/refuter budgets, one ordinary correction batch, targeted validation, and terminal escalation instead of reopening review.
2. **Authoritative lifecycle persistence** prevents cooperating Gentle AI processes from racing: a non-blocking OS file lock serializes mutation, each append compares an expected predecessor with `HEAD`, events are immutable and content-addressed, retries are idempotent, and every successor is semantically replay-validated.

This is strong evidence for a **lock protocol**, not hash/re-read alone, when pi-workflow must coordinate its own concurrent apply/resume/rollback processes. Hashes remain useful inside the lock for stale-plan detection and outside it for identifying immutable evidence. Gentle AI does not claim or implement atomic compare-and-swap against arbitrary external writers of worktree files. Its review lock protects only cooperating writers to Gentle AI's private review store.

For ILA-2306, port only the narrow concurrency pattern: one process-scoped lock around re-read, expected-digest validation, mutation, and journal/manifest publication; fail immediately on contention; let the OS release a crashed owner's advisory lock; retain content hashes and operation IDs for stale-plan and recovery evidence. Add file `fsync` before rename and parent-directory `fsync` after rename/unlink because Gentle AI's `writeAtomic` does the former but not the latter. Do not port the append-only review state machine, Git tree snapshots, bundles, receipts, or review counters into local agent-asset sync.

## Releases and Commits Inspected

Newest first:

| Release / change | Relevance |
|---|---|
| [v1.49.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.49.0), [PR #1106](https://github.com/Gentleman-Programming/gentle-ai/pull/1106), [commit `81dcdb2`](https://github.com/Gentleman-Programming/gentle-ai/commit/81dcdb264f8b24abd076f57b8ea128476643c392) | Final minimal lifecycle: immutable genesis path set, Git-derived correction snapshot, one correction, targeted validation, non-blocking follow-ups, contradiction escalation. |
| [v1.48.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.48.0) | Release-only fix; no review-coordination architecture change. |
| [v1.47.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.47.0), [PR #1093](https://github.com/Gentleman-Programming/gentle-ai/pull/1093), commits [`6bd914f`](https://github.com/Gentleman-Programming/gentle-ai/commit/6bd914f76adfaf6c60f3f08815ca14df46f18a7d), [`3b7c7bc`](https://github.com/Gentleman-Programming/gentle-ai/commit/3b7c7bc983caed0b9ef253404766cb33b462b016) | Native authoritative store, OS lock, append-only content-addressed events, predecessor CAS, recovery/import, receipts, and lifecycle gates. |
| [v1.46.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.46.0), [PR #1083](https://github.com/Gentleman-Programming/gentle-ai/pull/1083), [commit `19546c9`](https://github.com/Gentleman-Programming/gentle-ai/commit/19546c9f8022e402af454562beba72489550d329) | Deterministic 0/1/4-lens routing, bounded sweeps/refuters/fix rounds, batched refutation, severity floor, scoped re-review. |
| [v1.45.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.45.0) | No material review-coordination or filesystem transaction change. |
| [v1.44.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.44.0), [PR #1029](https://github.com/Gentleman-Programming/gentle-ai/pull/1029), [commit `20b9728`](https://github.com/Gentleman-Programming/gentle-ai/commit/20b9728df6dbcbba451c17648d1597fb4afb367e) | Origin of persisted findings ledger and scoped re-review; superseded in detail by v1.46-v1.49. |

## Exact Mechanisms

### Duplicate reviewers and repeated correction loops

- Routing is deterministic: trivial changes use zero lenses, standard changes exactly one, and hot-path or large changes full 4R. Refutation is batched, bounding fan-out independently of finding count ([v1.46.0 release](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v1.46.0), [shared contract](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/assets/skills/_shared/review-ledger-contract.md)).
- Native transaction counters and legal transitions reject duplicate or regressive executions. Ordinary mode consumes one `FixBatches` increment and one scoped validation; multiple frozen findings share that single batch ([`store.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store.go#L296-L417), [`transaction_test.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/transaction_test.go#L422-L472)).
- Final-verification contradiction escalates and cannot reopen review or correction budgets; late observations are persisted only as non-blocking follow-ups ([`transaction_test.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/transaction_test.go#L366-L443)).
- Contract parity tests render the same lifecycle rules across supported agent catalogs, preventing an adapter from silently restoring old fan-out behavior ([PR #1106 files](https://github.com/Gentleman-Programming/gentle-ai/pull/1106/files)).

### Stale snapshots and scope drift

- `SnapshotBuilder` constructs candidate trees from Git, canonicalizes/sorts paths, hashes the path set, intended-untracked proof, trees, target kind, and ledger IDs, and can re-derive the evidence from repository objects ([`snapshot.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/snapshot.go#L54-L147)).
- The CLI derives correction snapshots rather than trusting caller-authored paths/hashes. `CompleteFix` and store successor validation both require correction paths to be a subset of immutable genesis paths ([`snapshot.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/snapshot.go#L339-L377), [design](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/openspec/changes/complete-native-review-lifecycle/design.md)).
- Targeted validation evidence is bound to the fix-delta hash. Missing or stale evidence is rejected without consuming counters; failed regression evidence escalates ([`transaction_test.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/transaction_test.go#L366-L419)).

### Concurrent lifecycle mutation

- The authoritative store lives below Git's common directory, so linked worktrees share one lineage store; canonical lineage IDs prevent path escape ([`store.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store.go#L45-L80), [`store_test.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store_test.go#L522-L597)).
- Every append takes a non-blocking exclusive OS lock: `flock(LOCK_EX|LOCK_NB)` on Unix and `LockFileEx(...EXCLUSIVE_LOCK|FAIL_IMMEDIATELY)` on Windows. The lock file records random owner ID, PID, host, and timestamp, but ownership is the kernel lock, not the JSON record ([`store_lock.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store_lock.go), [`store_lock_unix.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store_lock_unix.go), [`store_lock_windows.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store_lock_windows.go)).
- There is no age-based stale-lock stealing. A crash closes the descriptor and the OS releases the lock; stale or malformed owner bytes can then be overwritten safely. While a live owner holds the kernel lock, another process receives `ErrConcurrentUpdate` immediately ([`store_test.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store_test.go#L94-L184)).
- Under the lock, append compares current `HEAD` to the caller's expected predecessor. A mismatch is a CAS conflict. Identical retries at the already-current revision succeed idempotently; different content fails ([`store.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store.go#L83-L188), [`store_test.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store_test.go#L18-L92)).

### Append-only persistence and durability

- Each event's revision is SHA-256 over canonical persisted bytes including its predecessor. Event installation uses temp write, file `Sync`, close, and hard-link no-clobber; an existing path is accepted only if bytes match. `HEAD` is temp-written, file-synced, closed, and renamed ([`store.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store.go#L105-L188), [`bundle.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/bundle.go#L260-L303)).
- Loads verify every event hash, predecessor continuity, legal semantic successor, monotonic counters, frozen fields, and ordered chain identity. Bundle import revalidates before installation ([`store.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store.go#L199-L293), [PR #1093 architecture](https://github.com/Gentleman-Programming/gentle-ai/pull/1093)).
- **Important durability limit:** `writeAtomic` does not `fsync` the parent directory after `rename`, and event hard-link installation does not sync the events directory. Therefore the code protects against torn/partial content and coordinates processes, but the inspected implementation does not prove namespace durability across sudden power loss ([`store.go`](https://github.com/Gentleman-Programming/gentle-ai/blob/81dcdb264f8b24abd076f57b8ea128476643c392/internal/reviewtransaction/store.go#L665-L690)).

## Coordination Boundary

Gentle AI's guarantees apply to **cooperating Gentle AI processes** that mutate one private lineage through `Store.Append` or bundle import. Kernel advisory locks do not prevent arbitrary programs from editing or deleting store files, and the review store lock does not cover external writes to reviewed worktree files. Content hashes make tampering or staleness detectable when data is later loaded; they do not make a worktree replacement conditional at the filesystem syscall boundary.

This distinction matters for ILA-2306: a lock can make pi-workflow apply/resume/rollback linearizable with one another, but neither Gentle AI's lock nor a hash/re-read sequence prevents an editor or unrelated process from writing the target between validation and rename/unlink.

## Portability Matrix

| Gentle AI mechanism | pi-workflow use | Verdict |
|---|---|---|
| One non-blocking OS lock around lifecycle mutation | Serialize apply/resume/rollback and keep revalidation adjacent to mutation | **Adapt directly.** Prefer a small deep filesystem module; Node may use an atomic `open("wx")` ownership file if no portable advisory-lock dependency is acceptable, but stale handling then differs materially from Gentle AI's kernel lock. |
| Expected predecessor + `HEAD` CAS | Expected target/manifest digest checked after lock acquisition | **Adapt conceptually.** Re-read and compare under the lock; hashes alone outside the lock are insufficient. |
| Content-addressed immutable events | Existing operation evidence/backups/successors | **Selective.** Keep digest-bound immutable evidence and idempotent operation IDs; do not create a generic event chain. |
| Idempotent identical retry | Resume of already-applied operation | **Portable and valuable.** Verify durable successor bytes before accepting success. |
| Git-derived immutable snapshots and genesis path subset | Plan/action target set | **Adapt lightly.** Freeze canonical target paths and expected digests in the operation; Git trees are unnecessary for local asset sync. |
| Semantic state machine, receipts, gates, bundle export/import | Agent-asset install | **Overkill.** pi-workflow already has a narrower journal/recovery model. |
| Batched reviewer/refuter and one correction budget | pi-workflow review orchestration | **Directly portable at orchestration level.** The current ILA-2306 lineage already follows a frozen ledger and bounded correction; avoid another discovery sweep. |
| File sync before rename | Durable asset/journal writes | **Portable but incomplete.** Add parent-directory sync after rename/link/unlink. |
| Kernel stale-lock recovery | Node local lock | **Needs adaptation.** `flock`/`LockFileEx` auto-release on process exit; `open("wx")` does not. Never copy age-based stealing as if equivalent. |

## Minimal Recommendation for ILA-2306

1. Introduce one private, global mutation lock at the filesystem seam, held for the complete apply/resume/rollback critical section: re-read targets and manifest, validate expected digests, publish durable recovery evidence, mutate assets, publish manifest, and verify.
2. Fail fast on contention. If using a kernel advisory lock, report PID/host/timestamp and rely on OS release after process death, matching Gentle AI. If avoiding a native dependency and using `open("wx")`, fail closed on an existing/malformed lock unless an explicit operator recovery protocol is designed; do not use age-only stale breaking.
3. Preserve the proposed hash/re-read approach **inside the lock**. It detects stale plans and pre-lock external changes. It is not an atomic CAS against arbitrary writers after the read.
4. Write same-directory temp bytes, sync the temp file, close, revalidate under lock, rename, then sync the parent directory. For deletion: revalidate, unlink, then sync the parent directory. Return an explicit `applied but durability uncertain` result if directory sync fails after mutation.
5. State the guarantee precisely: linearizable among cooperating pi-workflow processes; arbitrary external-writer CAS is unsupported for replace/remove. No-clobber creation may use `open("wx")`/hard-link semantics where applicable.
6. Keep the existing operation journal rather than importing Gentle AI's append-only review transaction architecture. Add only tests for lock contention, crashed/stale ownership behavior appropriate to the chosen lock primitive, stale expected digest under lock, no-clobber create, post-rename/post-unlink sync failure, and idempotent resume.

The evidence therefore supports a **lock plus in-lock hash re-read**, not an either/or choice. A lock is what closes the race among cooperating pi-workflow processes; the hash is what rejects stale intent. Neither closes the arbitrary external-writer race without platform-specific conditional filesystem primitives.

## Risks and Unknowns

- Gentle AI's Unix build tag is `unix`; the inspected sources explicitly implement Unix and Windows. Release archives cover macOS, Linux, and Windows, but no network-filesystem lock semantics are documented.
- Advisory lock behavior on NFS/SMB and hard-link/rename guarantees vary by filesystem; Gentle AI's tests use local temporary directories.
- Gentle AI retries are caller-driven and idempotent; no backoff/retry loop was found for lock contention.
- The lock owner token is diagnostic. Release does not compare the persisted token because kernel ownership controls unlock.
- The append-only store's missing parent-directory sync means it should not be cited as complete evidence for ILA-2306 crash durability.
- pi-workflow's current dirty worktree contains ongoing ILA-2306 changes. This research did not modify or test them.

## Skill Resolution

- `research`: loaded and followed for primary-source investigation and one Markdown report. Its background-agent instruction was intentionally not followed because the user explicitly prohibited launching other agents.
- `codebase-design`: loaded and used to recommend a narrow, deep filesystem module at the existing mutation seam rather than layering the full Gentle AI review store into asset sync.
