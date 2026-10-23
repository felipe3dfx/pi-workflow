# #299 implementation evidence

## Scope and environment

- Ticket: #299, "Consult the parent and report results from the child"; branch `299`, merged with `296-rpc-children` at `e22b45f` (after #298, #301, #303 and #304).
- Specification: `docs/specs/rpc-child-sessions.md`, sections 4.3, 4.4, 4.5 and 7.3.
- Host: Linux 7.2.8, Node v26.12.1, standalone Pi 1.4.0 (a Bun 1.3.14 binary) on `PATH`. No macOS run was made.
- Real-binary tests use the installed `pi`, a scratch `PI_CODING_AGENT_DIR` and the local OpenAI-compatible endpoint (`test/support/model-endpoint.mjs`), which now scripts tool calls, so no credentials or network are used. Without `pi` on `PATH` they skip with "Pi is not installed on PATH, so the real-binary RPC child checks cannot run."

## What changed

- `extensions/child-runtime.ts` (new): the child-side runtime extension, loaded by every RPC child with `--extension <package>/extensions/child-runtime.ts` and configured by its own flag `--pi-workflow-child <json>` (role, worktree, the parent's shell settings and whether a checkpoint is granted). On `session_start` it registers the guarded `bash` (`createChildBashTool`, ADR 0013, replacing Pi's built-in one), `ask_parent` and, for workers and verifiers, `report_result`, then sends `ready` over the parent channel. It also clears `APPEND_SYSTEM.md` from the child's prompt in `before_agent_start`, as the in-process child did. `ask_parent`, `report_result` and their definitions moved here from `child-sessions.ts`, which now imports them.
- Parent channel: newline-delimited JSON on an inherited descriptor (fd 3, a socket pair Node creates for the extra `pipe`), separate from the RPC stdin/stdout stream. Child frames: `ready`, `ask {id, question}`, `withdraw {id}`, `report {id, result}`; parent replies `{id, answer?}` or `{id, error}`.
- `knip.json` lists `extensions/child-runtime.ts` as an entry and `scripts/validate-packed-distribution.mjs` requires it in the packed package.
- `extensions/rpc-child.ts`: spawns the child with the channel, waits for the runtime's `ready` within `readinessDeadline` (otherwise the built-in bash could run unguarded), relays `ask` to `spec.ask` with an abort signal that a `withdraw`, a channel close or a process failure aborts, and relays `report` to `spec.report` before acknowledging it. The `unguardedTools` filter is gone: `bash` is passed in `--tools` because the runtime replaces it. `dispose()` now also stops a process that is still alive after a channel failure.
- Hardening adopted: peer identity by construction (the channel has no address; only the spawned Pi holds the descriptor, and its bash commands do not inherit it), a bounded frame (`channelFrameLimit`, 1 MiB; an oversized frame fails the child), in-flight questions bounded by the registry's single open question per child, and rejection of pending work on disconnect in both directions. Deadlines are not added to questions: a question waits for the parent or the operator, and the existing stall watch already bounds a silent child.

## Scenario evidence

| Specification section 5 scenario or ticket criterion | Proof | Output excerpt |
| --- | --- | --- |
| A child consults the parent over a separate channel and continues with the answer (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child asks the parent, the first answer wins and the child continues with it" (registry `reply` by the operator, then by the parent) | `ℹ asked: Which file?; answered by the operator: README.md; final: DONE` |
| The operator's answer from the Fleet view and the parent's `reply_child` both work and the first wins | Same real-binary test (second reply throws "already answered by the operator: README.md"); existing `test/children-view.test.mjs` and `test/child-sessions.test.mjs` reply suites, unchanged | `✔ a real Pi child asks the parent, the first answer wins and the child continues with it (569.212775ms)` |
| A late answer to a withdrawn question is refused | `test/rpc-child.test.mjs` "a late answer to a question the child withdrew is refused" (fake Pi through the registry); "a question the child withdraws aborts the parent's wait"; `test/rpc-child-pi.test.mjs` "a real Pi child withdraws a question when its call is aborted"; `test/child-runtime.test.mjs` "an aborted ask_parent withdraws its question and ignores a late answer" | `✔ a late answer to a question the child withdrew is refused (388.361245ms)` / `ℹ the aborted ask_parent call withdrew question 1` |
| `report_result` delivers the structured result, kept apart from the final assistant text (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi worker's guarded bash refuses a parent command and its report stays apart from its final answer"; `test/rpc-child.test.mjs` "a child's structured report reaches the parent apart from its final answer"; `test/child-runtime.test.mjs` "report_result sends the structured result and waits for the parent to record it" | `ℹ result: {"verdict":"done","files_changed":[],"validation":["git push origin HEAD: refused"],"left_undone":[]}; final: DONE` |
| `ask_parent`, `report_result` and the guarded bash are registered in the child; the guarded bash refuses a forbidden command (real-binary) | Same real-binary worker test; `test/child-runtime.test.mjs` "the child runtime registers the guarded bash, ask_parent and report_result and connects", "the child's bash refuses a command reserved for the parent" | ``ℹ bash: `git push` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it.`` |
| Worker and verifier launches are no longer refused for a missing `bash` | Same real-binary worker test reaches `completed` through `createChildSessions` with contract tools `read, bash` | `✔ a real Pi worker's guarded bash refuses a parent command and its report stays apart from its final answer (636.597647ms)` |
| Peer identity: no other process can reach the channel | The channel is an inherited descriptor with no address; the real-binary worker test lists the bash shell's descriptors and finds only stdout and stderr as sockets | `ℹ bash sockets:  1 -> socket:[4118024], 2 -> socket:[4118026]` |
| An oversized frame is refused | `test/rpc-child.test.mjs` "an oversized channel frame fails the child" (`channelFrameLimit` asserted as 1 048 576) | `✔ an oversized channel frame fails the child (38.186662ms)` |
| A disconnect rejects pending work | `test/rpc-child.test.mjs` "a child that disconnects withdraws its open question"; `test/child-runtime.test.mjs` "a closed parent channel rejects pending and later questions" | `✔ a child that disconnects withdraws its open question (32.820407ms)` |
| Readiness requires the child runtime, so a child without the guard never runs | `test/rpc-child.test.mjs` "readiness waits for the child runtime to connect its channel" | `✔ readiness waits for the child runtime to connect its channel (210.002383ms)` |
| A failed consultation reaches the child as an error result | `test/rpc-child.test.mjs` "a consultation the parent cannot answer reaches the child as an error"; `test/child-runtime.test.mjs` "ask_parent waits for the parent's correlated answer" | `✔ a consultation the parent cannot answer reaches the child as an error (31.419168ms)` |
| `APPEND_SYSTEM.md` does not reach the child's contract (gap left by #298) | Real-binary worker test writes `APPEND_SYSTEM.md` in the agent directory and asserts the model's system message has the contract and not the appended text; `test/child-runtime.test.mjs` "the child keeps its contract free of APPEND_SYSTEM.md" | `✔ the child keeps its contract free of APPEND_SYSTEM.md (0.761044ms)` |

## Quality gate

`npm run check` in the worktree after merging the integration tip: exit 0, wall clock 28 s; `node --test`: 1313 tests, 1298 passed, 15 skipped, 0 failed; "Packed distribution validation passed."

## Open gaps

- `codegraph` and `checkpoint` stay in the child's `--tools` allowlist but no RPC child registers them yet. The checkpoint tool belongs to #300; `createChildCodeGraphTool` reads the parent's seating state from `shell.ts`, which a child process does not have, so registering it needs that state handed over.
- Questions have no channel deadline; a child waiting for an answer is bounded only by the existing stall watch.
- The channel and the child handles are not anchored outside the extension module; surviving `/reload` belongs to #302.
- No macOS evidence was produced on this Linux host.
