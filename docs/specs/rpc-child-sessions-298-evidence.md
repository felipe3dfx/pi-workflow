# #298 implementation evidence

## Scope and environment

- Ticket: #298, "Run each child as its own process in its worktree"; branch `298`, based on `296-rpc-children` at `ccaa050`.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 4.1, 4.2, 4.5, 4.9, 7.1, 7.6 and 7.8.
- Host: Linux 7.2.8, Node v26.12.1, standalone Pi on `PATH` (`pi --version`: `1.4.0`). No macOS run was made.
- Binary: until `17a3070`, `npm run check` put `node_modules/.bin` first on `PATH`, so the real-binary tests it ran resolved the SDK 1.0.4 `pi` CLI, not the standalone binary; excerpts taken from such a run came from 1.0.4. The real-binary excerpts below are from a rerun on 2026-10-23 with `node_modules/.bin` first on `PATH`, where the tests resolve the installed binary and assert that the child process is that binary: `ℹ pi --version: 1.4.0; /home/felipe3dfx/.local/share/mise/installs/pi/latest/pi/pi`. All 26 real-binary tests passed.
- Real-binary tests run against the installed `pi` with a scratch `PI_CODING_AGENT_DIR` and a local OpenAI-compatible endpoint (`test/support/model-endpoint.mjs`), so no credentials or network are used. Without `pi` on `PATH` they skip with the reason "Pi is not installed on PATH outside node_modules/.bin, so the real-binary RPC child checks cannot run."

## What changed

- `extensions/rpc-child.ts`: `createRpcChildSession`, an adapter behind the existing `ChildSessionFactory` and `ChildHandle` seam. It is the default factory of `createChildSessions`.
  - Construction resolves `pi` on `PATH`, picks a fresh session id and, for `continue_child`, the earlier session file to `--fork`. A construction failure keeps today's refusal: "Launch refused. No child was launched."
  - The process starts in `run()`, so a queued child holds no process (spec 7.8).
  - Command line: `--mode rpc --session-dir <root>/<session> --session-id <session> [--fork <file>] --model <provider/id> --thinking <level> --tools <role tools> --no-extensions --extension builtin:mcp --extension builtin:codemode --no-skills --no-prompt-templates --no-themes --system-prompt <contract>` and exactly one of `--approve` or `--no-approve`. The working directory is the child's worktree.
  - Readiness is a correlated `get_state` reply within `readinessDeadline` (10 000 ms) that must name the same session, model and thinking. It certifies neither credentials nor MCP connections.
  - Completion waits for `agent_settled`; an aborted settle, an `error` or `aborted` stop reason, a `handled` prompt or a process exit fail the run. The final answer comes from `get_last_assistant_text`.
  - Wire `message_update` deltas are folded into one assistant message object per message, so `onEvent` sees the SDK shape. Transcript entries are refreshed with `get_entries` before each `message_end` reaches `onEvent`.
  - `dispose()` closes stdin, waits `shutdownDeadline` (1 000 ms), then kills the process group.
- `extensions/child-launcher.ts`: a ready launch warns when the parent's `.pi/mcp.json` is missing from the worktree.
- `extensions/child-toolbox.ts` and the contextual tests pin the in-process SDK factory, because the RPC adapter refuses contextual authorization instead of dropping it (#300 owns that path).

## Scenario evidence

| Specification section 5 scenario (part covered by #298) | Proof | Output excerpt |
| --- | --- | --- |
| A child's stdio MCP server reports its working directory and roots as the worktree (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child runs in its worktree and loads the worktree's MCP servers by the parent's trust" | `✔ --approve (596.242189ms)` / `ℹ servers started: global, project`; asserts `cwd` and `roots/list` equal the linked worktree for both servers |
| `--no-approve` skips a project MCP server, `--approve` loads it (real-binary) | Same test, both subtests | `✔ --no-approve (1063.593385ms)` / `ℹ servers started: global` |
| An untracked parent configuration is reported absent and not inherited (real-binary) | `test/rpc-child-pi.test.mjs` "a parent's untracked .pi/mcp.json is reported at launch and a real Pi child does not inherit it"; `test/child-launcher.test.mjs` "a parent .pi/mcp.json absent from the worktree is reported at launch, not inherited" | `ℹ The parent's .pi/mcp.json is absent from the worktree /tmp/pi-workflow-rpc-child-pi-Vs7VrU/child-worktree; the child does not inherit it.` |
| Launch: own process, worktree as directory, own session directory, role tools, model, thinking, exactly one trust flag | `test/rpc-child.test.mjs` "an RPC child runs as its own Pi process in its worktree with the selected launch", "a trusted parent launches its RPC child with exactly --approve"; `test/child-sessions.test.mjs` "the default child factory runs a background child as the Pi process on PATH and delivers its result" | `✔ an RPC child runs as its own Pi process in its worktree with the selected launch (43.727068ms)` |
| Bounded readiness, 10 s, named constant asserted | `test/rpc-child.test.mjs` "readiness is a correlated state reply within the readiness deadline", "readiness refuses a Pi process running another session or model"; real runs complete in about 0.5 s | `ℹ run completed in 513 ms` |
| A child that crashes or never becomes ready ends failed; a launch that cannot construct a child is refused | `test/rpc-child.test.mjs` "an RPC child that dies after launch fails its run with the exit", "an RPC child that cannot start fails its run with its diagnostics", "an RPC child refuses construction when Pi is not installed"; `test/rpc-child-pi.test.mjs` "a real Pi child whose model Pi cannot select fails its run instead of hanging" | `ℹ The child Pi process exited with code 1. ... Error: Model "absent-provider/absent-model" not found.` |
| Completion oracle: success needs a settled, non-aborted, non-error state; prompt acceptance never completes | `test/rpc-child.test.mjs` "an RPC child run fails on an error stop reason, an aborted settle and a handled prompt" | `✔ error`, `✔ abort-settles`, `✔ handled` |
| RPC events normalized to the existing `onEvent` | `test/rpc-child.test.mjs` "RPC events reach onEvent in the SDK shape with one cumulative assistant message", "the transcript entries are current when an RPC message ends" | `✔ RPC events reach onEvent in the SDK shape with one cumulative assistant message (33.623106ms)` |
| Queued child opens no process; at most five running | `test/rpc-child.test.mjs` "a queued RPC child opens no process until it runs"; `test/child-sessions.test.mjs` "the default child factory opens no Pi process for a queued child" (six launches, five processes, the sixth starts after a cancel) | `✔ the default child factory opens no Pi process for a queued child (212.759733ms)` |
| Fleet view, Run state, result delivery and `continue_child` with a real child | `test/rpc-child-pi.test.mjs` "a background child runs as a real Pi process and reaches the registry completed with its final answer" (also resumes it with `--fork`) | `ℹ completed: DONE` |
| Steering, undelivered steering, abort and dispose deadline | `test/rpc-child.test.mjs` "an RPC child steers, reports undelivered steering and aborts", "disposing an RPC child kills a process that ignores shutdown after the deadline" | `✔ disposing an RPC child kills a process that ignores shutdown after the deadline (41.334078ms)` |
| Fleet view, steering, answers and result delivery pass their existing tests unchanged | Existing registry, view, delivery and audit suites run unchanged through `ChildHandle` fakes | Full gate below |

## Quality gate

`npm run check` in the worktree: exit 0, wall clock 20.5 s; `node --test`: 1264 tests, 1249 passed, 15 skipped, 0 failed; "Packed distribution validation passed."

## Open gaps

- Worker and verifier launches are refused with "The child session lacks the contract tools bash." until #299 registers the guarded bash in the child. Pi's built-in bash is never passed to a child, because it would bypass the ADR 0013 guard.
- `ask_parent`, `report_result`, `codegraph` and `checkpoint` stay in the child's `--tools` allowlist but no child registers them until #299 and #300; an explorer runs without them.
- An RPC child appends `APPEND_SYSTEM.md` from the agent directory (and a trusted worktree) to its contract; the SDK child suppressed it. Pi 1.4.0 has no flag to turn it off, so the child runtime extension of #299 has to decide it.
- An explorer gets no `pi-web-access` tools and a Claude Bridge model is not resolved for RPC children; #304 owns both.
- The kill on dispose reaches only the Pi process group, not MCP or shell groups; #301 owns whole-tree termination and parent-death cleanup.
- No macOS evidence was produced on this Linux host.
