# ADR 0014: In-process child sessions carry the parent's risk

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Child sessions run in the parent's Pi process with no operating-system boundary between them (D1). A child carries the parent's risk: it reaches what the parent reaches, through the same user, files, credentials, and network.

A child loads a curated set of extensions: Pi's `codemode` and MCP extensions, plus `pi-web-access` for the explorer. It never loads the harness extension, so it never offers `spawn_child`, the parent's child tools, or the parent's screen places, and the parent's Tool gate does not reach it. Its extensions start inside its run, before its first prompt, and shut down when it ends: its session's extension runner emits `session_shutdown`, which closes its MCP connections and stdio servers, and then the session is disposed. Shutdown is asynchronous, a result's delivery never waits for it, and the parent session's end waits for every child to shut down.

A worker and a verifier load the parent's context files: Pi's AGENTS.override.md, AGENTS.md, or CLAUDE.md, the first found in the agent directory and in each of the worktree's ancestors, after the contract. An explorer loads none, and no child loads skills. The contract takes precedence over context files, so their instructions to commit, push, or open pull requests do not apply to a child.

A child inherits MCP with the parent's trust. It receives the servers of the user's global `mcp.json` and, only when the parent trusts the project, the servers of the parent project's `.pi/mcp.json`. It never reads its own worktree's MCP configuration. The child's in-memory settings carry the parent's trust decision explicitly. Pi does not export its MCP configuration loader (V7), so the child's MCP extension is Pi's own, created with `createMcpExtension`, and its `session_start` handler receives the child's context with `cwd` set to the parent's project directory. Pi's own loader then reads, validates, and merges the configuration exactly as it does for the parent. This was chosen over a reimplementation of the loader, which would duplicate Pi's validation, exposure aliases, and project override rules and drift from them, and over waiting for an upstream export, which would hold layer 2.

The explorer loads `pi-web-access` from Pi's agent directory, `npm/node_modules/pi-web-access`, the directory Pi installs it in for the parent (V4). The harness never installs it. Each explorer evaluates the package again with `jiti`, a runtime dependency pinned to the version Pi uses, with module caching and native loading off, and with Pi's packages, `typebox`, and their aliases mapped to the harness's own imports of them. The explorer therefore runs its own module instance on the parent's Pi instances: its `session_shutdown` handler clears only its own fetches and stored results (V2).

The contracts keep publishing and writes to external services through MCP with the parent, and the explorer and verifier use MCP tools only to read. ADR 0013's R1 extends to `codemode`, MCP, and web tools (DV5): those in-process surfaces do not go through the child bash guard, and the contracts guide them; they are not a security boundary.

Supersedes: none.

## Considered Options

- Child processes over RPC, each child a separate Pi process. Not adopted: it moves the child orchestration instead of removing it, loses the SDK custom tools (`ask_parent`, `report_result`, the guarded child bash, `codegraph`), and pays off only with an operating-system sandbox.
- An operating-system sandbox (`@anthropic-ai/sandbox-runtime`, nono, Gondolin). Not adopted: children stay in-process (D1), and a sandbox only bounds a separate process.
- Subprocess designs: Pi's subagent example, `badlogic/pi-subagent`, and gentle-shell. Not adopted, for the same reasons as RPC children. In-process children cost the factory's private access to Pi's model runtime, the patch of the child's stream function that makes cancellation work, the manual extension lifecycle, the trust plumbing for MCP, and R13. They gain Pi's file mutation queue, which serializes edits of one file across children and the parent, as D7 relies on, and the SDK custom tools.
- Filtering MCP tools by read-only hints for the explorer and verifier. Not adopted (DV4): it would also remove documentation tools such as context7, so the contracts guide them instead (R3).
- A secret-path refusal for the explorer. Not adopted: it contradicts R1 and recursive searches evade it.
- A harness MCP wait, or a tool set frozen at the first prompt. Not adopted: a child connects and waits as Pi does in the parent, and late declaration is inherited Pi behavior (R9).
- Loading `pi-web-access` through Pi's resource loader, as the parent does. Not adopted (V2): Pi caches an extension's factory by path while the working directory is unchanged, and `jiti` imports an ES module package natively through Node's shared module cache, so an explorer would share the parent's module state, and its shutdown would abort the parent's fetches and clear its stored results.
- Reimplementing Pi's MCP configuration loader from public exports, or asking Pi to export it (V7). Not adopted, as the Decision explains.

## Consequences

Every Specialist reaches the parent's MCP servers and the repository's guidance without configuration for children. Each running child opens its own MCP connections, and a queued child opens none.

V1 was verified on Pi 1.0.4: ten credential stores refreshing one OAuth token at once, over twenty rounds each for `mcp-auth.json` and `auth.json`, refreshed it once per stale token and lost no other write. Pi's per-server refresh lock and its locked read-modify-write keep the stores consistent. Children also share the parent's model runtime, and with it one credential store. A2 holds.

Upgrade re-verification items, like the chrome in ADR 0007, because they depend on Pi internals:

- The factory's private access to Pi's model runtime through the session's model registry.
- The patch of the child's stream function that stops a run still preparing its request after cancellation.
- The explorer's `pi-web-access` load. Each launch re-evaluates the package, about 40 ms on a cold transform cache and under 10 ms on a warm one for `pi-web-access` 0.37.0. The map of host modules duplicates the specifiers Pi's extension loader maps, limited to the harness's peers, and must follow Pi's list. It is verified on Node only: Pi's compiled binary and bundled Node distributions are unverified.
- Pi's default MCP configuration loader reading the `session_start` context's `cwd` and the session's trust. If it reads anything else, the trust tests fail and the loader decision of V7 returns.

Accepted risks:

- R1: every child can read what the parent can read, including credentials, and can send it out. It can plant files the parent later runs, such as `.git/hooks` or settings.
- R2: the user's own hooks do not reach children.
- R3: MCP tools that write or publish are reachable by read-only Specialists. Only the contracts guide them.
- R4: cancellation is cooperative. A tool that ignores abort can keep writing after its child stops.
- R5: each child opens its own MCP connections and stdio processes. The launch limit bounds them, and a child connects only while it runs.
- R6: session-only `/mcp` toggles of the parent are not inherited.
- R7: changes made through `bash` or MCP are not attributed to a child in the Fleet view.
- R8: in print and json modes, a child launched from a script runs in the foreground.
- R9: a `direct` MCP server that connects after a child's first prompt, and a refreshed `mcp_servers` section, cost one prefix re-send on Claude. This is inherited Pi behavior, as in the parent.
- R10: the parent is not told when the operator steers a child.
- R11: `direct` MCP servers that the user adds to `mcp.json` change children's declarations and tool order. The harness does not normalize them.
- R12: a locally installed `pi-web-access` loads in the explorer even when its companion expectation is off, so doctor does not report it missing. The explorer's trace does.
- R13: `/reload` ends every working child, because every session shutdown, reload included, disposes all children. The harness notifies the operator at `session_shutdown` with reason `reload` and records it in the trace. Survival across a reload belongs to #204.
