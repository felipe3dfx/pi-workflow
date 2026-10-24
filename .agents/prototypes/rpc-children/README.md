# Disposable prototype: standalone RPC children

## Scope and verdicts

Functional evidence only, not production integration or a security sandbox. All Pi experiments used **the installed standalone Pi 1.4.0**, `/home/felipe3dfx/.local/share/mise/installs/pi/1.4.0/pi/pi`, with a scratch git worktree as cwd, outside this repository. No experiment used the repository SDK. Extensions import only Node built-ins and the supported public `@earendil-works/pi-ai` package (`Type`). No download, package install, or interpreter invocation from downloaded content occurred.

| Question and success criterion | Verdict |
| --- | --- |
| Q1: obtain first successful `get_state`, N≥5 per startup/configuration/concurrency cell, and per-child RSS | **PASS**, application-cold/warm only; OS disk-cache-cold not measured |
| Q2: child-defined consultation/report/bash tools, separate parent channel, tool-call denial/replacement/consultation, final-answer observation | **PASS**, real model and real tool pipeline |
| Q3: same child/pipes/channel survive actual parent `/reload`; parent normal exit and SIGKILL remove descendants on Linux; establish macOS mechanism | **PARTIAL**: Linux experiments PASS; macOS unverified |
| Q4: tracked own-worktree MCP config, child cwd/roots, trust flags, absent untracked parent config | **PASS** |

Recommended disposition: **reference-only**. User-confirmed disposition: **not requested/not recorded**. No Approved Prototype UI Contract exists (no UI designed). No feature definition, production code, tests, or docs were changed.

## Method, isolation and reproduction

Read the requested prototype skills and ADR 0014 before creating artifacts; initial `git status --short` was clean. Also consulted the installed `cli.md`, `extensions.md`, `rpc.md`, `rpc-commands.md`, `mcp.md`, settings/security-related documentation and gentle-shell's runner/protocol/child-messaging design. The old ADR's RPC custom-tool loss and parent-cwd MCP limitation are contradicted **for standalone 1.4.0**, not retroactively for SDK 1.0.4.

Host: Linux x86_64, kernel `7.2.8-9-omarchy`; fixture server Node `v26.12.1`; Python 3.14. Pi version output: `1.4.0`. Results are one-machine observations, not capacity guarantees.

Every run sets `PI_CODING_AGENT_DIR` to a scratch agent directory, with explicit scratch session storage. **Real `~/.pi/agent/auth.json` was copied into the temporary tools agent only to run a model.** It was never printed; its source mode/size/mtime remained `600 / 3358 / 2026-10-22 08:13:53.962271221 -0500`. No real Pi configuration was intentionally changed. All copied credentials were removed with the scratch roots.

Scratch git setup was explicitly authorized by the parent: only `git init`, `add`, local fixture `commit` (inline identity and signing disabled), and `worktree add` inside fresh mktemp repositories. No git mutation occurred in this worktree, no remotes, pushes, or gh operations. `probe.py` logs the exact scratch git commands and output.

Main executed commands (run from the prototype repository; Pi itself always spawned outside it):

```sh
R=$(mktemp -d /tmp/rpc-children.XXXXXX)
python3 .agents/prototypes/rpc-children/probe.py "$R"
Q1=0 python3 .agents/prototypes/rpc-children/probe.py "$R"
python3 .agents/prototypes/rpc-children/tools-probe.py "$R"
python3 .agents/prototypes/rpc-children/lifecycle-probe.py "$R"
python3 .agents/prototypes/rpc-children/validate-evidence.py
npm run check
```

The first full probe populated `/tmp/rpc-children.KjDTGF`; the final Q4/Q2/Q3 probe used `/tmp/rpc-children.LriqQ3`. Isolated-cache Q1 was invoked separately against the first fixture worktree, with agent/cache directories under `/tmp/rpc-children.KjDTGF/benchmark-isolated-cache`; see command below. `scratch-path.txt` inventories all three roots, including the failed first attempt. These paths are historical evidence, not dependencies of the saved results. Reproduction creates a new root and runs the four scripts in order; only `tools-probe.py` needs credentials or network access.

All JSONL files are raw parent observations or protocol frames. Times are measured with Python `perf_counter`/`monotonic`; lifecycle event timestamps additionally use wall clock. `evidence-assertions.txt` records assertions over saved outputs. Failed/superseded captures are explicitly named, not silently presented as successes.

## Q4 — config and trust first

**Evidence:** `evidence-q4.jsonl`, `evidence-mcp-final.jsonl`.

Command: `Q1=0 python3 .agents/prototypes/rpc-children/probe.py /tmp/rpc-children.LriqQ3` → exit 0. The fixture creates a tracked `.pi/mcp.json`, commits it in the scratch repo, and creates a real linked worktree. A minimal stdio MCP peer records startup cwd, initialize frames, and the response to its own `roots/list` request. The global config has a distinct `global` server; project config has `project`.

Common child flags: `--mode rpc --session-dir <temp>/sessions --no-extensions --no-skills --no-prompt-templates --extension builtin:mcp`, plus exactly one trust flag. `--no-extensions` disables **built-in MCP too**; explicitly restoring `builtin:mcp` is necessary.

- `--approve`, PID **964823**: both `global` and `tracked-project` started. Both cwd values were `/tmp/rpc-children.LriqQ3/worktree`; both roots were `file:///tmp/rpc-children.LriqQ3/worktree`. Observation after startup + 1-second wait: **1376.47 ms**.
- `--no-approve`, PID **964861**: only `global` started, still with the child's cwd and roots. Observation: **1393.79 ms** including the wait. No tracked-project start.
- Separate scratch repository: parent's `.pi/mcp.json` was **untracked** when the linked worktree was created. With `--approve --extension builtin:mcp`, output was exactly `parent_exists: true, worktree_exists: false, mcp: ""`. It is not copied or inherited from the parent project.

Thus the settled own-worktree configuration decision eliminates C-1 in this real binary. Trust mirroring is a launcher responsibility: these experiments supply both flag choices explicitly; they do not implement production extraction of the parent trust decision. The lifecycle fixture intentionally approves its child's tracked MCP independently of its parent's `--no-approve`, to exercise descendant cleanup; that fixture is not a trust-mirroring implementation.

## Q1 — startup and memory

**Evidence:** `evidence-q1-cache-isolated.jsonl` (authoritative 60 measured launches). `evidence-q4-q1.jsonl` is an earlier, superseded run with two MCP peers and without isolated transform caches.

The timer starts immediately before `asyncio.create_subprocess_exec` and stops on the first matching successful `get_state` response. Commands are sent immediately, not after a guessed sleep. RSS is `ps -o rss= -p <child PID>`, in KiB, immediately after that response; it excludes MCP peers, supervisor, shared-page accounting corrections, and model context growth.

Application-cold = fresh agent and cache directories per launch; `TMPDIR`, `XDG_CACHE_HOME`, `JITI_CACHE_DIR`, and `BUN_RUNTIME_TRANSPILER_CACHE_PATH` point under that agent. Warm = same directories after an unmeasured priming launch. These are all **fresh processes**, not SDK sessions or an existing Pi process. OS filesystem caches are not dropped. MCP case uses global+tracked-project configs with the **same server name**: the project overrides the global entry, leaving exactly **one** trivial stdio MCP server. Bare/small cases use `--no-approve --no-mcp`; small adds `--extension <absolute>/small.ts`; MCP adds `--approve --extension builtin:mcp`.

Exact isolated-cache invocation (exit 0):

```sh
R=/tmp/rpc-children.KjDTGF
mkdir "$R/benchmark-isolated-cache"
python3 - "$R/benchmark-isolated-cache" "$R/worktree" <<'PY'
import sys, asyncio, pathlib
sys.path.insert(0, '.agents/prototypes/rpc-children')
from probe import q1
asyncio.run(q1(pathlib.Path(sys.argv[2])))
PY
```

Each table cell contains N=5; concurrent cells start five children together with `asyncio.gather`. Median/max are **per-child readiness latency**, not summed time or shutdown time.

| Variant | Cache | Launch | Median ms | Max ms | RSS range KiB / child |
| --- | --- | --- | ---: | ---: | ---: |
| bare | cold-agent | serial | 378.84 | 389.68 | 132344–135988 |
| bare | cold-agent | concurrent-5 | 415.70 | 422.64 | 131760–134636 |
| bare | warm-agent | serial | 378.92 | 401.55 | 131876–136432 |
| bare | warm-agent | concurrent-5 | 446.52 | 456.99 | 132360–133816 |
| small | cold-agent | serial | 495.83 | 502.19 | 146816–150444 |
| small | cold-agent | concurrent-5 | 525.42 | 541.38 | 147524–149508 |
| small | warm-agent | serial | 449.13 | 458.64 | 143532–144264 |
| small | warm-agent | concurrent-5 | 499.18 | 520.75 | 142236–145024 |
| mcp | cold-agent | serial | 384.29 | 404.98 | 133160–136208 |
| mcp | cold-agent | concurrent-5 | 462.68 | 466.44 | 134612–135928 |
| mcp | warm-agent | serial | 386.28 | 397.65 | 133532–135484 |
| mcp | warm-agent | concurrent-5 | 432.37 | 444.43 | 133376–134888 |


First `get_state` is **not** an MCP-ready barrier. Near-bare MCP readiness does not imply free connections: MCP connects asynchronously. The small external extension adds approximately 70–120 ms in these serial samples; five concurrent cold small-extension children each consume roughly 144–146 MiB RSS. No startup crash/hang occurred in the authoritative 60 samples.

## Q2 — custom tools, authorization and channel

**Evidence:** `evidence-q2-final.jsonl`; command `python3 .agents/prototypes/rpc-children/tools-probe.py /tmp/rpc-children.LriqQ3` → exit 0, `summary.scenario: true`.

`child.ts` loads in real standalone Pi and registers `ask_parent`, `report_result`, `guarded_bash`, and a disposable `prototype_scenario` orchestrator. It connects to a Unix socket hosted by the Python parent. Requests/responses carry IDs; stdout remains only Pi JSONL RPC. The scenario calls the other tools through public tool-context `ctx.executeTool`, exercising Pi's real validation, nested tool IDs and `tool_call` pipeline rather than directly calling JavaScript implementations.

Observed:

- `ask_parent` waits for socket answer `ACK`; parent deliberately delays **250.64 ms** (nested result also reports its actual duration).
- `guarded_bash("printf FORBIDDEN")` returns `isError: true`, `forbidden command blocked by guarded_bash`, without shell execution.
- `tool_call` blocks built-in `bash("printf DENY")`: `isError: true`, `authorization denied`.
- `tool_call` consults the parent on `printf CONSULT`; parent answer `allow` after **251.56 ms**. Handler mutates `event.input.command` to `printf authorized-replacement`. Real bash output is **`authorized-replacement`**, exit 0, not `CONSULT`.
- `report_result` emits `{kind:"report_result", verdict:"prototype-pass"}` on the socket, independently of RPC.
- Model emits final assistant text **`DONE`**, `stopReason: "stop"`, then `agent_settled` with `aborted: false`.

Final answers are captured from RPC **`message_end` with `message.role === "assistant"`**, retaining text blocks and rejecting/interpreting tool-use-only messages separately. Wait for **`agent_settled`**, not `prompt.success` or `agent_end`, before treating the run as terminal; preserve aborted/error status. `get_messages` independently confirms `DONE` in the transcript. `report_result` is a separate structured result, not a substitute for or proof of a final assistant answer.

Three tiny model prompts total were sent across the whole prototype, below the five-prompt cap: one initial run hung because the *Python socket handler* had a duplicate `kind` keyword bug; two subsequent successful runs. Model: `openai-codex/gpt-6.1-sol`, chosen by the installed binary after the auth copy. No credentials-unavailable simulation was needed. A deterministic `/prototype-check` command found `typeof ctx.executeTool === "undefined"`: execution context exists inside tools, not ordinary command handlers. Slash-command probes do not call a model. The initial harness failure and intermediate successful capture are retained separately.

This is an authorization demonstration, **not a security boundary**: arbitrary trusted extensions can spawn processes, and RPC `bash` is a separate user-bash surface. The lifecycle fixture uses RPC bash deliberately; a real authorization policy must cover it and every other relevant execution surface.

## Q3 — reload and exit lifecycle

**Evidence:** `evidence-q3-final.jsonl`, plus MCP start/protocol records in `evidence-mcp-final.jsonl`. Command `python3 .agents/prototypes/rpc-children/lifecycle-probe.py /tmp/rpc-children.LriqQ3` → exit 0.

Installed `extensions.md` documents reload replacing the extension runtime, invalidating old session-bound state and emitting `session_shutdown`; `rpc.md` documents orderly stdin-EOF shutdown. The experiment uses a **real interactive standalone parent in a PTY and sends the actual built-in `/reload`**, not an SDK method or a simulated event.

Minimal proven retention mechanism: a `globalThis[Symbol.for("prototype.rpc-children.v1")]` registry holds the subprocess handle, stdin/stdout streams, pending RPC map, framing buffers, Unix server and live sockets. The old `session_shutdown` handler returns immediately for `reason === "reload"`; the new extension runtime reuses the same registry and registers new command handlers. Existing transport callbacks remain attached once, not duplicated on reload. Old callbacks contain transport-only logic; production policy callbacks should be rebound/versioned, not silently remain old.

| Exit case | Parent PID | Child Pi PID | Supervisor | Reload result | Cleanup after lifetime EOF | Parent-exit observation |
| --- | --- | --- | --- | --- | --- | --- |
| Orderly `/fleet-quit` | 965427 | 965514 | 965513 | generation 1→2, same child/session/pipes; socket ping succeeds | 370.81 ms, remaining `[]` | 464.78 ms, return 0 |
| Parent SIGKILL | 965583 | 965688 | 965687 | generation 1→2, same child/session/pipes; socket ping succeeds | 366.16 ms, remaining `[]` | 434.94 ms, return -9 |

Actual normal-parent timestamps: shutdown `reason: reload` at 1792687544.604, new module load at .608 with `hasChild: true`, state+socket ping success at 1792687545.405. SIGKILL parent similarly reloads in place; **no quit handler can run after SIGKILL**.

A global registry alone cannot clean up after SIGKILL. `supervisor.py` is an independent process, owns the actual child pipes and forwards RPC, and monitors a **separate lifetime fd 3** whose only writer belongs to the parent. The child does not inherit that fd. On actual shutdown the parent ends it; on SIGKILL the kernel closes it. On EOF the supervisor snapshots descendants, sends SIGTERM to **every descendant process group**, waits 300 ms, escalates to SIGKILL, waits/reaps, then exits. On Linux it first sets **`PR_SET_CHILD_SUBREAPER`**, so orphaned grandchildren reparent to the watchdog instead of disappearing from its tree.

The normal EOF tree was:

```text
Pi    965514, PPID 965513, PGID 965514
MCP   965533, PPID 965514, PGID 965533
bash  965539, PPID 965514, PGID 965539
sleep 965540, PPID 965539, PGID 965539
```

SIGKILL tree: Pi 965688, MCP 965708, bash 965714, sleep 965715; again **three distinct process groups**. Thus `kill(-childPiPid)` alone does not cover the MCP/bash groups. A simple parent `exit` hook likewise cannot satisfy SIGKILL cleanup. Both tested trees ended empty; post-run OS checks are in `evidence-cleanup.txt`. No running/zombie descendant was observed after the final checks.

**Boundary: macOS NOT verified.** Unix sockets, retained global handles, lifetime-pipe EOF, and POSIX group signals are plausible there, but Linux's subreaper is not portable. The snapshot-based fallback does not establish race-free cleanup of reparented/session-escaping descendants on macOS. A macOS-specific supervised tree/launch containment mechanism and normal+SIGKILL tests are required before promising whole-tree termination there. Windows is out of scope. Also not proven: cleanup if the watchdog itself is SIGKILLed, adversarial forking races, multiple children per watchdog, session-switch reinitialization, or schema-changing hot upgrades. This one-child prototype is not a general fleet manager.

Initial Q3 capture accidentally included the `ps` measurement subprocess in its own tree; the corrected collector excludes that PID. A later edit introduced a Python syntax error; it is retained as a harness failure. Neither is a Pi failure. The syntax-error launch left its interactive fixture parent alive (PID 953419); cleanup detected and explicitly killed that failed fixture before deleting scratch state. This exposes missing failed-spawn/early-exit handling in the disposable parent extension, not an orphan from either successful lifecycle run. Final evidence was rerun after formatting/lint corrections.

## Mock/simulation inventory and replacement boundaries

| Fixture | What is real | Replacement boundary |
| --- | --- | --- |
| Trivial stdio MCP peer | Real subprocess, JSON-RPC initialize/tools/roots exchange | Replace server implementation with representative production MCP servers; not evidence of their startup/resource costs |
| Python parent answers `ACK`/`allow` after 250 ms | Real socket, real blocked tool and real handler consultation | Replace hard-coded response policy with actual parent consultation UX, cancellation/deadline handling and authorization |
| `prototype_scenario` | Real model-issued custom tool and real nested Pi tool execution | Replace deterministic scenario with worker workflow; not proof every model obeys arbitrary instructions |
| Scratch git repos/worktrees | Real Git tracked/untracked behavior, actual cwd/config loading | Replace fixture creation with production worktree provisioning |
| Symbol registry + Python watchdog | Actual standalone parent reload, RPC child and process-tree termination | Replace disposable supervisor/relay with hardened lifecycle owner, OS-specific containment and bounded protocol |
| `small.ts` | Real external extension import and registration | Not a representative full workflow extension load |

No Pi, SDK, extension runtime, tool gate, reload, roots response, process exit or final model answer is mocked. No model response is fabricated.

## Proposed falsifiable contract

1. **Launch:** pinned supported standalone Pi version, absolute executable/extension paths; `cwd = child worktree`; `--mode rpc --session-dir <child session storage> --no-extensions --extension <child extension> --extension builtin:mcp --no-skills --no-prompt-templates`, curated `--tools` and explicit model as appropriate. Restore other required built-ins explicitly. Mirror exactly one parent trust flag (`--approve`/`--no-approve`); never reuse the parent's cwd to load MCP. Each child is its own Pi process; supervisor overhead is separate.
2. **Readiness:** successful correlated `get_state` within a bounded deadline; it does not certify model credentials or MCP connections. Report startup/MCP readiness separately. First failure/EOF/timeout must terminalize the child rather than leave it starting forever.
3. **Channel:** private per-fleet Unix socket in a mode-0700 temp directory, correlated consultations and reports, no non-RPC bytes on child stdout. Production must add peer identity, bounded frames/inflight requests, timeouts, disconnect rejection, withdrawn answers, and schema validation; this fixture omits most hardening.
4. **Authorization:** register child tools locally. Route all applicable model/nested tool calls through `tool_call`; consultation may mutate validated input or return `block`. Do not claim shell-string matching is a sandbox or complete authorization. Explicitly gate RPC/user-bash and other execution surfaces separately.
5. **Results:** preserve structured `report_result`; capture finalized assistant text via `message_end`; final success requires settled non-aborted/error state and task-specific result validation. Acceptance of a prompt is never completion.
6. **Reload:** same parent PID and same live child session, streams and channel before/after actual `/reload`; versioned global registry owns handles, transport callbacks installed once; `session_shutdown(reason=reload)` must not terminate children or close the lifetime fd. Other shutdown reasons dispose them. Do not retain obsolete policy closures unintentionally.
7. **Linux lifecycle (observed):** independent watchdog + noninherited parent lifetime pipe, Linux subreaper, enumerate **all** descendant PGIDs, TERM/KILL escalation and reaping. Both normal exit and parent SIGKILL must leave zero descendant processes. Proposed acceptance budget: ≤2 seconds under this fixture (observed <0.5 seconds); this is not yet a production guarantee.
8. **macOS lifecycle (unverified):** same exit/reload invariants remain required, but implementation/acceptance is blocked on platform-specific orphan containment and real tests; do not silently adopt Linux subreaper assumptions. No Windows support proposed.
9. **Configuration:** project's tracked MCP config is inherited via the worktree checkout, not copied from the parent's live/untracked file. Missing untracked config stays missing; surface it, do not silently fall back to parent servers. Shared globals/credentials require explicit ownership and concurrency review.

## Risks, surprises and proposed feature brief delta

- Standalone 1.4.0 supports child custom tools and authorization handlers via public extension imports; the obsolete assumption that RPC necessarily loses SDK-like custom tools should be removed for this version.
- Built-in MCP is an extension; `--no-extensions` alone silently removes it. First attempt produced no MCP log for precisely this reason (`evidence-initial-failure.txt`).
- MCP and bash create their own process groups: one Pi PGID is insufficient. Parent reload survival is simple; crash-proof lifetime ownership is not. OS process isolation does not isolate user permissions, files, credentials or network.
- Startup RSS ~129–147 MiB per Pi before model context, plus each MCP server. Five processes have meaningful memory cost; use bounded concurrency. Model startup/network and production extension suites are not benchmarked.
- Empty auth produces model `unknown` but successful RPC state. Real model use was independently verified only after auth copying. No usable-credential claim is inferred from `get_state` alone.
- No final authoritative run emitted Pi stderr noise or malformed JSON. The observed hangs/errors were harness defects, preserved with raw output; consultation cancellation/disconnect hardening remains unfinished.
- This prototype is intentionally not fully TypeScript-typed: the repository compiler includes `extensions/` only. Biome covers prototype TS/JS; Python is checked with AST parsing and functional runs. Production implementation must add proper types and protocol validation.

**Proposed brief delta (not applied):** replace the in-process-child assumption with independent standalone RPC children rooted in their own worktrees; child-side extension tools and authorization plus a dedicated parent-consultation/report channel; own-worktree MCP loading under explicit mirrored trust; final-answer observation from RPC with settled-state completion; reload-resident transport ownership; and independent parent-death supervision covering separate MCP/bash process groups. Add capacity budgets based on application-cold/warm startup and memory evidence, not SDK assumptions. Split platform acceptance: Linux demonstrated, macOS whole-tree/abrupt-death acceptance still mandatory and unverified. Do not mark cross-platform lifecycle delivery complete until that gap is closed. Preserve the existing risk statement that same-user process separation alone is not sandboxing.

## Validation and final inventory

- `python3 .agents/prototypes/rpc-children/validate-evidence.py`: exit 0, all four evidence groups assert successfully (`evidence-assertions.txt`).
- `npm run check`: final exit 0; Biome, TypeScript, Knip, focused-test/publication/release checks, 1236 tests (1221 pass, 15 skipped, 0 fail), packed distribution validation passed (`evidence-check.txt`). Initial check failed on prototype lint, then was corrected; no repository check was bypassed.
- Functional script commands and their outputs/timings are retained as listed above. Prototype-only formatting command: `./node_modules/.bin/biome check --write .agents/prototypes/rpc-children/{child.ts,parent.ts,small.ts,mcp-server.mjs}` → four files checked, two fixed, exit 0.
- No commit was made; `git commit` is reserved to the parent and prohibited here by the user. No push or other external publication.

Cleanup and final `git status`/created-file inventory are recorded in `evidence-cleanup.txt` and `evidence-final-status.txt`. All scratch repositories/worktrees, temp agent config/auth/session files and sockets were removed: `/tmp/rpc-children.xDI0Ax`, `/tmp/rpc-children.KjDTGF`, `/tmp/rpc-children.LriqQ3`. Nothing outside the prototype artifact directory remains intentionally changed.

Created files (all under `.agents/prototypes/rpc-children/`):

```text
README.md
child.ts
evidence-assertions.txt
evidence-biome-fix.txt
evidence-check-initial-failure.txt
evidence-check.txt
evidence-cleanup-initial.txt
evidence-cleanup.txt
evidence-final-status.txt
evidence-initial-failure.txt
evidence-mcp-final.jsonl
evidence-q1-cache-isolated.jsonl
evidence-q2-final.jsonl
evidence-q2-harness-failure.jsonl
evidence-q2.jsonl
evidence-q3-final.jsonl
evidence-q3-harness-failure.txt
evidence-q3-initial.jsonl
evidence-q3.jsonl
evidence-q4-q1.jsonl
evidence-q4.jsonl
lifecycle-probe.py
mcp-server.mjs
parent.ts
probe.py
scratch-path.txt
small.ts
supervisor.py
tools-probe.py
validate-evidence.py
```
