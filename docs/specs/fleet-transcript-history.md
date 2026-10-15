# Fleet transcript and history

Status: Technical specification; implementation not started.
Location: `docs/specs/fleet-transcript-history.md`.
Parent: https://github.com/felipe3dfx/pi-workflow/issues/265.
Brief: `docs/features/fleet-transcript-history.md`.
Review: `docs/specs/fleet-transcript-history-review.md`.

## Problem, solution and stories

The operator needs evidence of each child's instructions and conversation, not a generated summary. Current Fleet reads in-memory child entries and streaming state, loses visibility at shutdown, and eagerly lays out transcripts. Persist a dedicated asynchronous audit record per child, associated with its parent session but independent of the executable SDK child session. The record is evidence authority; indexes are reconstructible. Fleet reads bounded windows and separates working children from read-only history.

- As the operator, I inspect instructions, messages, thinking, tool calls, nested updates and results while a child runs, with collapse/expand rather than summaries.
- As the operator, I backscroll without another child's output moving my position, then explicitly return to live follow.
- As the operator, I reopen the same parent and inspect terminal or interrupted records, including recoverable incomplete evidence, without restarting work.
- As the operator, I see capture failures without those failures changing the child's execution or Verdict.

## Authority and mandatory invariants

**Mandatory — approved brief:** only the currently open parent owns visible records. `En curso` contains queued/running/waiting children; `Historial` contains completed/failed/cancelled/timed-out children and Interrupted child records. Preserve Group identity in each section; a mixed Group appears in both. Retain evidence for the parent's lifetime without automatic age/count pruning. These are observable requirements, not index implementation choices.

**Mandatory — operator decision after functional review:** use the dedicated asynchronous audit record, not native finalized/synchronous SessionManager storage as the capture authority. Native history alone misses streaming partials and nested execution evidence. This refines implementation without changing reviewed behavior; it was not reviewed by the original lenses. The parent subsequently compared this boundary with the approved brief, glossary, event/lifecycle seams and the three review handoffs: no changed functional behavior or material conflict was identified. This focused synthesis check does not claim another independent review or implementation verification.

**Mandatory — ADRs 0010/0014 as retained by 0016/0017 and existing capability contracts:** retain in-process Pi SDK execution, current custom tools, shared file-mutation queue, role permissions, context, model/provider resolution, launch limit, result delivery and live continuation rules. Audit persistence has its own sequencing; it neither replaces nor holds the tools' file-mutation coordination. Capture failure must never itself refuse, abort, cancel, steer or continue execution. Persisted evidence never enters model context or rewrites sent messages; preserve cache-first prefixes and append-only child context.

**Mandatory — glossary:** capture health is independent of Run state and Verdict. An Interrupted child record means unknown terminal outcome after reopen/reload, not a new Run state. A known terminal Run state takes precedence even with an Incomplete transcript. Durable visibility intentionally supersedes session-only Fleet visibility, not reload termination or ADR 0010's in-memory delivery semantics.

**Mandatory — Seating and terminal-safe contracts:** an unseated capability withdraws its tools and screen places; already accepted work and its auditing finish. Fleet remains the existing overlay occupant. Sanitize all untrusted display text using existing terminal-safe forms without rewriting retained evidence.

## Record identity and capture

Allocate one parent-bound audit identity for each accepted child before execution can emit events. Keep the existing child ID as its correlation key; never use SDK session ID alone. Capture parent identity, child ID, optional SDK session ID, role, task, references, effective received instructions/context, model/thinking, worktree, creation time, Group and continuation linkage. A live continuation already creates a new child: give it a new audit identity and link its predecessor; retain the old record.

Attempt identity persistence before execution as best effort: enqueue identity first, but do not await disk success or delay execution for storage. If identity cannot be persisted, retain live visibility and warn that durable rediscovery is not guaranteed. Do not invent a persisted record or cause after reopening.

Parent identity uses Pi's session identity, not cwd, name, active leaf or lineage path. Pi documents `/tree` within the same session and `/fork` and `/clone` as new sessions. Thus tree navigation retains this parent's audit scope; fork/clone do not inherit another parent's children even when their context includes copied references. Never infer ownership from copied Trace entries. Ephemeral parents support live inspection but cannot promise reopen recovery without a persistent identity.

Subscribe at the existing factory/core event seam before prompting, independently of Fleet being open. Capture:

1. Initial received Contract/context/instructions, task/references and subsequent received user messages, Steers and answers; distinguish queued input from delivered input.
2. Message start, partial text/thinking, partial tool-call arguments, and authoritative completed messages, including system/tool-loadout changes exposed by Pi.
3. Top-level and nested tool start/update/end, arguments, partial results, final results, errors, and parent-call correlation. Capture live nested events: Pi's capped `nestedCalls` transcript projection omits results and is insufficient.
4. Execution transitions and reported Verdicts, including corrected reports; final execution outcome is recorded separately from transcript completion.

Only retain evidence actually exposed/received; do not fabricate hidden provider reasoning, raw network bytes or unavailable full output behind an upstream truncation. Preserve available full-output references as references, not a promise of permanent external file availability.

**Recommendation — normalization in one deep audit/store module:** evidence is already available through factory events and core lifecycle; localizing normalization, persistence, indexes and recovery prevents callers duplicating correctness logic. Its small behavioral interface offers begin identity, observe evidence, bounded list/read windows, health/change notification, bounded close and explicit repair. These are behaviors, not required method names. Inject filesystem and scheduler internally; use existing factory and read-view seams for integration tests. A separate runtime wrapper is unnecessary.

Assign monotonically increasing observation ordinals per audit record, before admission, and stable event IDs. Use message-local IDs assigned at message start (not timestamps), block IDs/indices, toolCallId and parentToolCallId; qualify source IDs by record and execution generation. Preserve per-record observation order, not an invented cross-child wall-clock order. Repeated delivery of the same event ID is idempotent; identical text from different events is not deduplicated.

Project partial updates into the same message/block identity. An authoritative `message_end` replaces that message's partial representation atomically when fully retained, not by concatenation. Tool final results similarly replace partial result views. Raw partial evidence remains available for audit, but ordinary transcript presentation shows one current representation. Keep nested call identity distinct from its outer tool result; do not count its usage again. Late partials cannot overwrite a known final; incomplete final chunks cannot masquerade as authoritative finals.

## Asynchronous storage and bounded work

**Mandatory — brief and approved continue-on-failure policy:** callbacks do no synchronous filesystem I/O, full-history projection or unbounded encoding. Bound pending ownership by bytes and entries, including references to SDK snapshots, serialization buffers, chunks and in-flight writes; a small descriptor referencing a large object is not a small charge. Yield producer/encoding work in bounded slices. Chunk supported large payloads rather than rejecting them at a small per-event cutoff. No finite queue guarantees arbitrary-size or indefinitely lossless capture.

**Recommendation — explicit fail-open capture policy:** when bounded admission is exhausted or a write/encoding error occurs, mark the record incomplete immediately and disable further capture for that record in this generation. Let the child continue normally. Retain already acknowledged evidence; never silently evict queued evidence or retry an ambiguous append as if nothing happened. Maintain bounded live loss counters/ranges beginning at the first unretained ordinal; subsequent observations count as unretained. Separate received, admitted and completely written watermarks. A chunked event counts written only when all its parts and commit are acknowledged. Record uncertain partial writes as uncertain, not exact byte loss. Index-only failure need not discard already written raw evidence.

Publish an incomplete marker best effort, outside ordinary payload admission but within a fixed metadata allowance; this does not require a second queue. Specific cause/counts survive reopening only if written. If all writes fail, previously durable unfinished metadata supports generic incompleteness, not the latest error/count. If no identity survived, discovery from this storage alone is impossible. Write acknowledgment is not fsync or a power-loss guarantee.

**Recommendation — concrete version-1 local format:** use one append journal per audit record, plus a parent catalog and per-record derived indexes; no database, hash chain, per-delta files or prototype-format adoption. Store under private harness data associated with the parent session identity, never the worktree. Journal header declares format/version and parent/child identity. Length-prefixed frames carry event ID, ordinal, kind, correlation fields, payload-part ordinal and commit marker. Stream typed payload fields into bounded UTF-8/binary chunks; avoid whole-event JSON stringify/base64 copies. Include independent frame checksums for accidental damage, not security. Partial events remain uncommitted. Recommended frame layout: unsigned 32-bit big-endian envelope length, UTF-8 JSON envelope, unsigned 32-bit chunk length, raw chunk bytes and an independent SHA-256 checksum of envelope plus chunk. Validate lengths before allocation. Envelope version 1 declares record/event identity, observation ordinal, kind, message/block/tool correlation, field path, part number and final-part flag. A separate event-commit envelope declares total parts/bytes; project only after validating that set. Kinds cover identity, instructions, message partial/final, tool start/update/end, execution, report, loss and close. Indexes map field ranges to chunks so reads need not decode a whole event. Unknown versions are visible as unsupported/incomplete, never interpreted as execution.

Recommended testable starting parameters: 64 KiB payload chunks, 4 MiB/256-entry parent capture budget with fair per-child admission, 256 KiB/128-entry read windows and 16 MiB resident view cache. Include envelopes, in-flight buffers and layout in accounting; large SDK-owned inputs remain an explicitly disclosed runtime allocation. These are tunable engineering recommendations, not approved SLOs or arbitrary-message guarantees. Validate supported large fixtures; document unavoidable single-field traversal costs and fail visibly if budget cannot be honored.

Maintain paged child metadata, message/block and payload-offset indexes incrementally after raw commits. Publish index checkpoints by temporary write/rename; bind them to identity, journal extent and committed ordinal. Cursors include record, index generation, message/block and byte offset; stale cursors return a refresh result, not wrong content. Normal open reads bounded catalog/index pages and validates referenced extents; it neither scans all records nor parses/layouts all history. Expansion of a huge block uses payload slices and row checkpoints, not full materialization. Limits constrain resident work, never retained evidence.

Missing/stale/corrupt indexes expose known identity and available verified windows with an incomplete/index warning. Explicit cancellable repair streams the journal in bounded slices, validates lengths/checksums/identity/schema/order, recovers verified committed evidence and rebuilds indexes. Normal open does not secretly perform that full scan. Corrupt tails or interiors preserve verified evidence and report unavailable ranges; repair never overwrites raw evidence or invents completion. Serialize writers per record; refuse overlapping capture ownership visibly, not child execution. Reopened records remain read-only; new executions get new identities, so no stale-lock takeover is needed. Snapshot mutable SDK observations before later mutation can change their meaning, charging retained backing data to admission. Readers never become executable owners.

Retain records for the parent lifetime. No automatic garbage collection, age/count pruning, cross-parent copying or orphan deletion is introduced. Parent deletion/cascade and separate manual audit deletion remain outside scope; do not infer destructive cleanup authority from native session deletion.

## Recovery and shutdown

Read-only recovery creates historical read models, never registers children in the execution core, launch accounting, Todo claims, Pending result queue or question resolvers. It must not replay Consumed results, delivery cards, automatic turns, questions, Steers or continuations. Historical result text is evidence, not `child_result` availability.

For a recovered record, use verified known terminal execution evidence first. Otherwise a previously working child becomes an Interrupted child record, including a queued child that never started. Evaluate capture health separately: clean completion requires a verified close marker covering accepted evidence and no observed loss; unfinished, missing, corrupt, unsupported or uncertain capture is incomplete. An index cannot override contradictory journal evidence.

On graceful shutdown/reload, keep the existing child termination and question withdrawal behavior. Stop accepting new capture after the existing lifecycle teardown has emitted its final observations, then attempt bounded drain and close metadata. Recommended audit drain deadline: 1 second, tested with an injected scheduler, not a new promise about total Pi shutdown duration. Audit drain must not delay result delivery. Expiry records loss/incompleteness best effort, releases resources and fences late completions from subsequent generations. A killed process may lose received/queued or even acknowledged-but-unflushed bytes; reopening reports only available durable facts. Reload still terminates working children; there is no survival or automatic resume.

## Fleet presentation

Use the existing Fleet overlay, injected theme/keybindings and Pi transcript conventions: compact tool previews, explicit expansion, thinking visibility and partial/final distinctions. The installed Pi UI uses line arrays, width-aware utilities and renderer expansion state; reuse suitable presentation logic without invoking tools or loading providers for history. No Approved Prototype UI Contract exists.

Support row-complete backscroll inside large text/thinking/arguments/results, not only message paging. Expansion reveals retained content through bounded slices; summaries and ellipses are not the only access path. Recommended anchors are child/message/block/source offset plus visual-row offset, mapped through final replacement, expansion, resize and theme changes. Detached inspection stays anchored while any child streams; explicit follow returns to the selected child's live tail. Late asynchronous reads for an old selection cannot replace the new selection.

Keep Group headings in both sections, stable child identity across movement and visible capture-health warnings alongside execution state/Verdict. Historical rows have inspection controls only; live cancel/Steer/answer controls remain governed by the live core. Known identity remains listed even with missing transcript content. Guard terminal rendering to TUI mode; capture behavior is independent of UI mode. Preserve keyboard access, focus, terminal-safe text, display-width correctness and existing screen places.

## Validation and delivery constraints

Implementation must establish behavioral RED cases before changes and run `npm run check`. No tests run or implementation success is claimed by this draft. Reuse `test/support/README.md` helpers (`fakeChildren`, `recordingCore`, `withAgentDirectory`, real local `piChildSession`) before adding helpers.

Extend existing child-sessions/delivery/codemode/view/seating tests for unchanged execution, tools, shared mutation coordination, cache-first context, Group splitting, live controls and no delivery resurrection. Add audit/store interface tests with injected filesystem/scheduler and read-view tests for:

- exact instructions/messages, concurrent streams, nested tool updates/results, Unicode chunk boundaries, final replacement and duplicate event identity;
- queue saturation, large single messages and results, short/zero writes, creation/append/rename/index failures, ambiguous torn writes and total marker failure while execution completes unchanged;
- same-parent reopen, different-parent/fork/clone exclusion, known terminal precedence, interrupted queued/running/waiting records, corrupt tails/interiors, stale cursors, unsupported schemas and explicit repair;
- bounded normal reads/cache/queue and incremental large-block traversal, complete backscroll, stable anchors/follow, selection races, resize/theme/narrow widths and hostile terminal sequences;
- graceful/reload drain expiry and crash prefixes, no reconstructed executable handles, Pending results, questions, Todo effects or automatic continuation.

Use owned temporary roots and deterministic offline providers, never actual credentials or provider calls. Test through the highest useful existing public seams and injected dependency adapters; do not couple tests to private queues. Replace superseded narrow tests only when equivalent behavioral coverage exists. Prototype measurements are reference evidence, not production responsiveness, full UI parity or fsync proof.

Dependencies are installed Pi SDK/event interfaces and existing harness lifecycle, Fleet, Group, Seating and terminal-safe modules; no new package/runtime/database is required. Native ordering is capture identity/normalization before producer integration, durable projection before recovery, and bounded read views before historical Fleet integration. These are dependency constraints, not tickets. Parent/tracker identity: #265 (https://github.com/felipe3dfx/pi-workflow/issues/265); approved title/body and fields have been read back. Publication, tracker equivalence checks, implementation, new broad prototypes, transport migration, legacy-history import, execution survival and ticket slicing are outside this working draft.
