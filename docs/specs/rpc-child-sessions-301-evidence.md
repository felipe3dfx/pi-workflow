# #301 implementation evidence

## Scope and environment

- Ticket: #301, "Stop children and their descendants when the parent closes"; branch `301`, based on `296-rpc-children` at `8aa69af` and merged with its tip `79666e1` (#303, #304) before the final gate.
- Specification: `docs/specs/rpc-child-sessions.md`, sections 4.7, 5 (exit and bounded termination scenarios), 7.2, 7.9 (cancellation) and 11.
- Host: Linux 7.2.8, Node v26.12.1, standalone Pi on `PATH` (`pi --version`: `1.4.0`). No macOS run was made.
- Binary: until `17a3070`, `npm run check` put `node_modules/.bin` first on `PATH`, so the real-binary tests it ran resolved the SDK 1.0.4 `pi` CLI, not the standalone binary; excerpts taken from such a run came from 1.0.4. The real-binary excerpts below are from a rerun on 2026-10-23 with `node_modules/.bin` first on `PATH`, where the tests resolve the installed binary and assert that the child process is that binary: `ℹ pi --version: 1.4.0; /home/felipe3dfx/.local/share/mise/installs/pi/latest/pi/pi`. All 26 real-binary tests passed.
- Real-binary tests reuse the #298 setup: the installed `pi`, a scratch `PI_CODING_AGENT_DIR` and the local endpoint `test/support/model-endpoint.mjs`. Without `pi` on `PATH` they skip with "Pi is not installed on PATH outside node_modules/.bin, so the real-binary RPC child checks cannot run."

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
| Normal parent exit leaves no child, MCP or shell descendant on Linux (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child, its MCP server and its shell descendants end within the tree deadline when the parent exits or is killed", subtest `shutdown`. A separate parent process (`test/support/child-parent.mjs`) runs a real child whose MCP server starts a detached shell with a background `sleep`; the parent disposes within `shutdownDeadline` and exits | `✔ shutdown (1234.253179ms)` / `ℹ Pi, MCP server, shell and its background sleep (1707767, 1707785, 1707792, 1707793) ended 0 ms after the parent exited` |
| SIGKILL of the parent leaves no child, MCP or shell descendant on Linux (real-binary) | Same test, subtest `SIGKILL` | `✔ SIGKILL (1175.252582ms)` / `ℹ Pi, MCP server, shell and its background sleep (1707849, 1707868, 1707883, 1707887) ended 20 ms after the parent was killed` |
| A crashed child leaves no MCP or shell descendant on Linux (real-binary) | `test/rpc-child-pi.test.mjs` "a real Pi child that crashes leaves no MCP server or shell descendant within the tree deadline" (the child Pi is SIGKILLed) | `ℹ MCP server, shell and its background sleep (1707998, 1708007, 1708008) ended 26 ms after the child Pi was killed` |
| The same three cases through the fake Pi, which ignores stdin EOF and starts a detached server and a detached shell | `test/rpc-child.test.mjs` "a parent that exits or is killed leaves no RPC child or descendant within the tree deadline", "an RPC child that crashes leaves no descendant within the tree deadline" | `ℹ no child process remains 5 ms after the parent exited` / `ℹ no child process remains 16 ms after the parent was killed` |
| Cancellation asks to abort and, after the `shutdownDeadline` of 1 s, kills the whole tree including MCP and shell groups | `test/rpc-child.test.mjs` "cancelling an RPC child asks it to abort, then kills its whole process tree after the shutdown deadline" (asserts the `abort` command, the `shutdownDeadline` wait and that Pi, server, shell and sleep are gone) | `✔ cancelling an RPC child asks it to abort, then kills its whole process tree after the shutdown deadline (127.591264ms)` |
| Bounded termination: named constants asserted | `shutdownDeadline` (1 000 ms) in the cancellation test; `treeDeadline` (2 000 ms) asserted equal to 2 000 and as the bound of every cleanup measurement | `assert.ok(elapsed < treeDeadline, ...)` in each exit and crash test |

Removing the sweep from `rpc-child.ts` makes the cancellation and crash tests fail; replacing the watchdog with a process that does nothing makes the SIGKILL subtest fail with the child, server, shell and sleep still running. Four consecutive runs of both suites after the final merge passed, and no fixture process was left running.

## Quality gate

`npm run check` in the worktree after merging `79666e1`: exit 0, wall clock 20.4 s; `node --test`: 1294 tests, 1279 passed, 15 skipped, 0 failed; "Packed distribution validation passed."

## macOS

### Environment

- Host: macOS 26.6.2 (25G83), arm64, System Integrity Protection enabled; Node v22.21.1.
- Pi 1.4.0 in two installations: the standalone release binary `pi-darwin-arm64.tar.gz` (checksum verified against the release's `SHA256SUMS`), `ℹ pi --version: 1.4.0; /tmp/diag301/pi-dl/darwin/pi/pi`, and the npm package `@earendil-works/pi-coding-agent` 1.4.0 on Node, `ℹ pi --version: 1.4.0; …/fnm_multishells/…/bin/pi`. Neither path is under `node_modules`.

### What failed with the environment mark alone

On `main` (`e1a6f1e`) the sweep exited 0 with members still running:

- macOS strips the environment of platform binaries from `KERN_PROCARGS2`: a direct `sysctl` read of a marked `/bin/sleep` returned 28 bytes and no mark, so `ps -E` showed nothing for `/bin/sh`, `/bin/bash` or `sleep`, the shells Pi's bash tool and the fixtures start.
- `ps -E` cannot read the environment of a process that changes its title. A marked `node` with `process.title = "pi"` kept the mark in `KERN_PROCARGS2` but `ps -E` did not show it, and the child Pi shows as `pi`.
- Results: `test/rpc-child.test.mjs` failed the cancellation, crash and parent exit tests with the shell and its `sleep` alive; `test/process-tree.test.mjs` failed the `ps`-based sweep on a marked `sleep`; `test/rpc-child-pi.test.mjs` never ended, because `dispose()` waited for a child Pi the sweep had not found.

### What changed

ADR 0024 adds recorded process groups to the membership; Linux keeps the mark.

- `extensions/process-tree.sh` takes the parent's groups directory as its third argument. Members are the processes that carry the mark or belong to a recorded group whose leader's start time still matches, plus every process whose parent or group leader is a member. The sweep stops the members, reads them again and kills them. A `record` mode records the groups of a child's members; where `/proc` is absent the watchdog runs it every 500 ms and drops records whose number was reused or whose group stayed empty for a minute. The watchdog reads its lifetime pipe through a duplicated descriptor, since `dash` gives a background job `/dev/null` as stdin.
- `extensions/process-tree.ts` creates the groups directory per parent process with `mkdtemp` and passes `PI_WORKFLOW_PROCESS_GROUPS=<groups>/<session id>` to the child. `extensions/rpc-child.ts` records the child Pi's group at spawn, at readiness and after every run.
- `extensions/child-bash.ts` records each command shell's group from the first line of the command prefix, for the guarded and the configured bash.
- Tests: `childPids` in `test/rpc-child-pi.test.mjs` finds the parent's Pi children by parent pid and name, since Pi's title hides `--mode rpc` on macOS; the `/reload` scenario waits up to `shutdownDeadline + treeDeadline` for the completed child to end, because the npm Pi on Node does not exit when its stdin closes and is killed after the shutdown deadline.

### Scenario evidence

Command: `node --test test/rpc-child-pi.test.mjs test/rpc-child.test.mjs test/process-tree.test.mjs`, with the standalone binary first on `PATH`. 101 tests: 97 passed, 4 failed, all outside the process tree (below). `pgrep -fl "mcp-fixture-server|sleep (300|600)"` printed nothing afterwards.

| Scenario | Proof | Standalone binary | npm package on Node |
| --- | --- | --- | --- |
| Normal parent exit, real Pi | "a real Pi child, its MCP server and its shell descendants end within the tree deadline when the parent exits or is killed", `shutdown` | `ℹ Pi, MCP server, shell and its background sleep (42155, 42227, 42232, 42237) ended 0 ms after the parent exited` | `… ended 130 ms after the parent exited` |
| SIGKILL of the parent, real Pi | Same test, `SIGKILL` | `… (42430, 42482, 42491, 42494) ended 248 ms after the parent was killed` | `… ended 377 ms after the parent was killed` |
| Crashed child, real Pi | "a real Pi child that crashes leaves no MCP server or shell descendant within the tree deadline" | `ℹ MCP server, shell and its background sleep (42766, 42787, 42790) ended 136 ms after the child Pi was killed` | `… ended 125 ms after the child Pi was killed` |
| Child that ends cleanly, real Pi | "a real Pi child that ends cleanly leaves no background process of its shell within the tree deadline" | `ℹ the background sleep 43248 ended 258 ms after the child Pi ended` | `… ended 1279 ms after the child Pi ended` |
| `/reload`, then quit or SIGKILL of a real Pi parent | "a real Pi parent's /reload keeps its working child processes, …" | `ℹ after quit, the waiting child ended in 87 ms` / `ℹ after SIGKILL, the waiting child ended in 15 ms` | `… 1269 ms` / `… 58 ms` |
| Parent exit and SIGKILL, fake Pi | "a parent that exits or is killed leaves no RPC child or descendant within the tree deadline" | `ℹ no child process remains 137 ms after the parent exited` / `ℹ no child process remains 560 ms after the parent was killed` | same suite |
| Crash and cancellation, fake Pi | "an RPC child that crashes leaves no descendant within the tree deadline", "cancelling an RPC child asks it to abort, then kills its whole process tree after the shutdown deadline" | `ok 59`, `ok 57` | same suite |
| Recorded groups | `test/process-tree.test.mjs`: hidden-environment group with the orphan its exited shell left, reused group number left alone, watchdog after the parent dies, a child's bash records its shell | `ok 1` to `ok 5` | same suite |

Every measurement is below `treeDeadline` (2 000 ms). The npm package on Node does not exit when its stdin closes, on Linux too, so a clean end waits the `shutdownDeadline` of 1 000 ms and the sweep kills it.

The 4 failures also fail on `main` on this host and come from test portability, not from the process tree: "a real Pi worker's guarded bash refuses a parent command …" lists `/proc/$$/fd`; "an RPC child runs as its own Pi process …" and "a trusted parent launches its RPC child with exactly --approve" compare `/var/…` with `/private/var/…`; "a missing pi-web-access or Claude Bridge package fails the launch …" depends on the packages installed in the host's agent directory. The full `node --test test/*.test.mjs` on this host also fails, on `main` too, a `child-bash` line-number message from bash 3.2, two more `/private/var` comparisons and the installed Claude Bridge package.

### Linux after the change

Docker `node:22.19.0` (Debian, arm64), non-root user, `--init`:

- `npm run check`: exit 0; 1331 tests, 1291 passed, 40 skipped, 0 failed; "Packed distribution validation passed."
- With the standalone `pi-linux-arm64` 1.4.0 on `PATH`, the three suites above: 101 tests, 99 passed, 2 skipped (pi-web-access and Claude Bridge not installed), 0 failed; `ℹ Pi, MCP server, shell and its background sleep … ended 0 ms after the parent exited`, `… ended 16 ms after the parent was killed`, `ℹ MCP server, shell and its background sleep … ended 16 ms after the child Pi was killed`, `ℹ after quit, the waiting child ended in 55 ms`.

### Demo

The real-binary `/reload` test drives a real Pi parent loading the extension, with children whose MCP servers and shells run, and quits it in one run and kills it with SIGKILL in another. The interactive demo with a model was not run.

## Open gaps

- Windows guarantees nothing: there is no `/bin/sh`, the watchdog and sweep fail silently and only Pi's own shutdown remains.
- A descendant that clears its environment (for example through `env -i`) and leaves its process group, or that runs under another user, escapes the sweep. Where `/proc` is absent, a process with an unreadable environment that starts a group of its own and is orphaned before a recording point sees it escapes too (ADR 0024).
- A SIGKILL of the watchdog itself is not covered.
