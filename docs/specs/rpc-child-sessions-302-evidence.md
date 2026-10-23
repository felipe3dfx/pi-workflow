# #302 implementation evidence

## Scope and environment

- Ticket: #302, "Keep children across parent reload"; branch `302`, based on `296-rpc-children`.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 4.6, 5 and 7.5.
- Host: Linux, Node v26, installed Pi on PATH (`pi --version`: `1.4.0`). No macOS run was made.
- Binary: until `17a3070`, `npm run check` put `node_modules/.bin` first on `PATH`, so the real-binary tests it ran resolved the SDK 1.0.4 `pi` CLI, not the standalone binary; excerpts taken from such a run came from 1.0.4. The real-binary excerpts below are from a rerun on 2026-10-23 with `node_modules/.bin` first on `PATH`, where the tests resolve the installed binary and assert that the child process is that binary: `ℹ pi --version: 1.4.0; /home/felipe3dfx/.local/share/mise/installs/pi/latest/pi/pi`. All 26 real-binary tests passed.

## What changed

- `extensions/pi-workflow.ts`: `session_shutdown` with reason `reload` detaches the child registry and the audit captures and anchors them on `globalThis[Symbol.for("pi-workflow:child-sessions:resident")]`; it no longer disposes children, warns or writes a reload trace entry. Every other reason still runs `disposeAll` and closes the audit. The next `session_start` takes the anchor once and hands it to the new runtime's audit and registry.
- `extensions/child-sessions.ts`: the factory callbacks of each child go through a mutable port. `detach()` stops the watchdogs, removes the abort listeners of open questions, switches every port to a buffer, waits up to `shutdownDeadline` for disposals in flight and returns the children, queue order, Pending and Consumed results and Todo links. `adopt()` rebuilds each child with a new watchdog and its resumed audit capture, rebinds the port, poses the open question again (withdrawing it at once when its call was aborted during the reload), re-attaches running and waiting children to their run, replays what the buffer held, rebuilds the write claims of working workers and delivers Pending results when the parent is idle. The old runtime's closures become inert because its maps are empty.
- `extensions/child-audit.ts`: `detach()` hands over the live capture records after their drains finish (bounded by the drain limit); `adopt()` takes them into the new audit with their admission budget; `resume(child)` returns a capture for an adopted record. `begin` and `resume` share `captureOf`.
- `extensions/process-tree.ts`: the watchdog's stdin pipe is unreferenced only when the runtime offers `unref`. Pi 1.4.0 runs extensions on Bun, whose pipe has none, so before this change every child launched by a real Pi parent failed with `watchdog.stdin.unref is not a function`. The real-parent test below found it.
- `GLOSSARY.md`: an Interrupted child record no longer arises from a reload.

## Scenario evidence

| Scenario (spec §5) | Proof | Output excerpt |
| --- | --- | --- |
| `/reload` keeps the same child process, session and channel; an open question is answered once and the result arrives once (real binary) | `test/rpc-child-pi.test.mjs` "a real Pi parent's /reload keeps its working child process, ..." (a real `pi --mode rpc` parent loads `extensions/pi-workflow.ts` and reloads through `ctx.reload()` from `test/support/reload-command.mjs`) | `ℹ child pids 1709088, 1709099 kept across /reload; Child 1eb98b24-… completed. Verdict: partial.` |
| A second reply after the reload is refused as already answered (real binary) | same test, the parent model's second `reply_child` | tool result `isError: true`, `already answered by the parent: blue` |
| Quitting or killing the parent after a reload still ends a working child (real binary) | same test, subtests `quit` and `SIGKILL` | `ℹ after quit, the waiting child ended in 53 ms`, `ℹ after SIGKILL, the waiting child ended in 39 ms` |
| Working children are neither disposed nor announced; the re-attached parent lists them and delivers each result once; any later shutdown disposes them | `test/child-sessions.test.mjs` "a reload keeps every working child with its session, ..." | `✔ a reload keeps every working child with its session, and the re-attached parent lists them and receives each result once` |
| A question open at the reload, one asked or withdrawn during it, and one already answered are each answered once | "a question open at a reload, one asked or withdrawn while the parent reloads, ..." | `✔ a question open at a reload, one asked or withdrawn while the parent reloads, and one already answered are each answered once by the re-attached parent` |
| A report and a run end that arrive during the reload are settled once; the new watchdog times out a silent child | "a child that reports and ends while the parent reloads ..." | `✔ a child that reports and ends while the parent reloads is settled once by the re-attached parent, whose watchdog times out a silent one` |
| Pending result delivered once, Consumed result never again | "a result pending at a reload is delivered once ..." | `✔ a result pending at a reload is delivered once by the re-attached parent, and a consumed one is never delivered again` |
| A reload rebuilds the write claims | "a reload rebuilds the write claims of the surviving workers, ..." | `✔ a reload rebuilds the write claims of the surviving workers, which completion still releases` |
| `continue_child` resumes a child completed before the reload | "after a reload, continue_child resumes ..." | `✔ after a reload, continue_child resumes a child that completed before it from the same conversation` |
| Todo links survive | "after a reload, the result of a child linked to a Todo task ..." | `✔ after a reload, the result of a child linked to a Todo task sets that task's final state` |
| Audit and transcript capture continue | "a reload keeps a persisted parent's audit capture open, ..." | `✔ a reload keeps a persisted parent's audit capture open, and the record closes when the child ends after it` |
| Any other shutdown reason ends the children | "a shutdown for any reason other than reload ends the working children without a notice" | `✔ a shutdown for any reason other than reload ends the working children without a notice` |
| A Pending result, a Consumed result and an answer in flight at the reload: the Pending one is delivered once, the Consumed one never, and the answered child reports once after it (real binary, added after review) | `test/rpc-child-pi.test.mjs` "a real Pi parent's /reload keeps its working child processes, a Pending result is delivered once, ..." (the model endpoint holds the answered child's next request until after `/test-reload`) | see the excerpt below |
| A launch whose preparation completes after the reload began is refused and leaves no child behind (added after review) | `test/child-sessions.test.mjs` "a launch whose preparation completes after a reload began is refused ..." | `✔ a launch whose preparation completes after a reload began is refused and leaves no child behind` |

Real-binary excerpt, 2026-10-23, installed Pi 1.4.0:

```text
✔ quit (1427.138119ms)
ℹ child pids 2434134, 2434145 kept across /reload; Consumed before it: dedd45b9-49f3-407a-af84-713ce4719e2e; Pending at it: 318c354d-d6cf-4299-b861-d555fec99cb2; answered "blue" before it, reported after it: ee1b8645-fc22-46ac-9712-5da77231c5e4
ℹ one result message after the reload: 318c354d-d6cf-4299-b861-d555fec99cb2 completed, ee1b8645-fc22-46ac-9712-5da77231c5e4 completed Verdict partial
ℹ after quit, the waiting child ended in 58 ms
✔ SIGKILL (1396.128358ms)
ℹ child pids 2434327, 2434338 kept across /reload; Consumed before it: b4986d50-fbc2-45da-98bf-72616ebea66a; Pending at it: fc31eaa4-bd36-4317-861c-5a1650085d5e; answered "blue" before it, reported after it: 042f9242-c531-4864-942b-92360f738d90
ℹ one result message after the reload: fc31eaa4-bd36-4317-861c-5a1650085d5e completed, 042f9242-c531-4864-942b-92360f738d90 completed Verdict partial
ℹ after SIGKILL, the waiting child ended in 44 ms
```

The test also asserts that the parent received exactly one result message, that the Consumed child's id is absent from it, that exactly one child request carried the answer `blue`, and that the parent's second reply was refused as already answered.

## Quality gate

`npm run check` after merging `296-rpc-children` (with #300): exit 0, tests 1336, pass 1321, fail 0, skipped 15, wall clock 39 s.

The real-parent test starts the installed binary that `test/support/installed-pi.mjs` resolves, and its children run the parent's own executable; the test asserts that each child process is that binary.

## Open gaps

- No macOS evidence was produced on this Linux host.
- The ADR 0010 amendment and the supersession of ADR 0014 R13 are recorded by #305; ADR 0014 still states that `/reload` ends every working child.
- A launch whose `spawn_child` call is still preparing when `disposeAll` runs for a shutdown other than a reload captures the next generation and is launched; a detached registry refuses every later launch since the review fixes.
- If an audit drain or a child disposal outlasts its deadline during the reload, its late completion still runs against the old runtime's audit counters.
- The stall watchdog of a surviving child restarts its full period at the reload.
- A contextual child (unadopted path, #300) keeps the old runtime's authorization object across a reload; the production path has none.
