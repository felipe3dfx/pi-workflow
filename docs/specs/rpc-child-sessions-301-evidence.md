# #301 implementation evidence

## Scope and environment

- Ticket: #301, "Stop children and their descendants when the parent closes"; branch `301`, based on `296-rpc-children` at `8aa69af` and merged with its tip `79666e1` (#303, #304) before the final gate.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 4.7, 5 (exit and bounded termination scenarios), 7.2, 7.9 (cancellation) and 11.
- Host: Linux 7.2.8, Node v26.12.1, standalone Pi 1.4.0 on `PATH`. No macOS run was made.
- Real-binary tests reuse the #298 setup: the installed `pi`, a scratch `PI_CODING_AGENT_DIR` and the local endpoint `test/support/model-endpoint.mjs`. Without `pi` on `PATH` they skip with "Pi is not installed on PATH, so the real-binary RPC child checks cannot run."

## What changed

- `extensions/process-tree.ts` and `extensions/process-tree.sh`: whole-tree termination.
  - Every child Pi starts with `PI_WORKFLOW_PROCESS_TREE=<parent token>/<session id>/` in its environment. Pi 1.4.0 passes its environment to stdio MCP servers and shell commands, and their descendants inherit it, so membership survives new sessions and process groups (`setsid`) and reparenting of orphans. A probe on the real Pi showed the MCP server in its own session (`pgid = sid = pid`) still carrying the mark.
  - `stopTree(id)` runs the script, which kills (`SIGKILL`) every process whose environment carries the child's mark and repeats until none is left or `treeDeadline` (2 000 ms) passes. On Linux it reads `/proc/<pid>/environ`; elsewhere it reads `ps -A -E -ww`.
  - A detached watchdog per parent process (`/bin/sh process-tree.sh <token>/ 2000 watch`) blocks on a pipe whose only writer is the parent. The kernel closes it when the parent exits or is SIGKILLed; the watchdog then kills every process of every child of that parent. The token is anchored on `globalThis`, so `/reload` keeps the same watchdog.
- `extensions/rpc-child.ts`:
  - Pi exit, whether a crash or a shutdown, triggers `stopTree` for that child; `exited` resolves after the sweep.
  - `dispose()` (cancellation and parent shutdown) sends `abort`, closes stdin, waits `shutdownDeadline` (1 000 ms) and then kills the whole tree instead of only the Pi process group.
- `scripts/validate-packed-distribution.mjs` requires `extensions/process-tree.sh`, which is loaded by path.
- `README.md` states the guarantee and its limits.

## Scenario evidence

| Specification section 5 scenario (part covered by #301) | Proof | Output excerpt |
| --- | --- | --- |
| Normal parent exit leaves no child, MCP or shell descendant on Linux (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child, its MCP server and its shell descendants end within the tree deadline when the parent exits or is killed", subtest `shutdown`. A separate parent process (`test/support/child-parent.mjs`) runs a real child whose MCP server starts a detached shell with a background `sleep`; the parent disposes within `shutdownDeadline` and exits | `✔ shutdown (1181.316947ms)` / `ℹ Pi, MCP server, shell and its background sleep (1287177, 1287195, 1287202, 1287203) ended 1 ms after the parent exited` |
| SIGKILL of the parent leaves no child, MCP or shell descendant on Linux (real-binary) | Same test, subtest `SIGKILL` | `✔ SIGKILL (1135.263095ms)` / `ℹ Pi, MCP server, shell and its background sleep (1287276, 1287300, 1287307, 1287308) ended 26 ms after the parent was killed` |
| A crashed child leaves no MCP or shell descendant on Linux (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child that crashes leaves no MCP server or shell descendant within the tree deadline" (the child Pi is SIGKILLed) | `ℹ MCP server, shell and its background sleep (1287342, 1287350, 1287351) ended 32 ms after the child Pi was killed` |
| The same three cases through the fake Pi, which ignores stdin EOF and starts a detached server and a detached shell | `test/rpc-child.test.mjs` "a parent that exits or is killed leaves no RPC child or descendant within the tree deadline", "an RPC child that crashes leaves no descendant within the tree deadline" | `ℹ no child process remains 5 ms after the parent exited` / `ℹ no child process remains 16 ms after the parent was killed` |
| Cancellation asks to abort and, after the `shutdownDeadline` of 1 s, kills the whole tree including MCP and shell groups | `test/rpc-child.test.mjs` "cancelling an RPC child asks it to abort, then kills its whole process tree after the shutdown deadline" (asserts the `abort` command, the `shutdownDeadline` wait and that Pi, server, shell and sleep are gone) | `✔ cancelling an RPC child asks it to abort, then kills its whole process tree after the shutdown deadline (127.591264ms)` |
| Bounded termination: named constants asserted | `shutdownDeadline` (1 000 ms) in the cancellation test; `treeDeadline` (2 000 ms) asserted equal to 2 000 and as the bound of every cleanup measurement | `assert.ok(elapsed < treeDeadline, ...)` in each exit and crash test |

Removing the sweep from `rpc-child.ts` makes the cancellation and crash tests fail; replacing the watchdog with a process that does nothing makes the SIGKILL subtest fail with the child, server, shell and sleep still running. Four consecutive runs of both suites after the final merge passed, and no fixture process was left running.

## Quality gate

`npm run check` in the worktree after merging `79666e1`: exit 0, wall clock 20.4 s; `node --test`: 1294 tests, 1279 passed, 15 skipped, 0 failed; "Packed distribution validation passed."

## Open gaps

- macOS: the same script runs there (`ps -A -E -ww` instead of `/proc`), but no macOS evidence was produced on this Linux host. Spec section 9 makes macOS lifecycle evidence an acceptance gate, so #301 cannot be completed until the same tests pass on macOS.
- Windows guarantees nothing: there is no `/bin/sh`, the watchdog and sweep fail silently and only Pi's own shutdown remains.
- A descendant that clears its environment (for example through `env -i`) or that runs under another user escapes the mark. Pi 1.4.0 passes its environment to MCP servers and shell commands; a future Pi that starts them with a reduced environment would break the guarantee, and the real-binary tests would detect it.
- A SIGKILL of the watchdog itself is not covered.
