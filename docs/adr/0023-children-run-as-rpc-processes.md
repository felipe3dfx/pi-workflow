# ADR 0023: Children run as RPC processes

## Status

Acceptance: approval and merge of the introducing PR.
Amended by [ADR 0024](0024-process-tree-membership-by-recorded-groups.md): process-tree membership also follows recorded process groups, and macOS termination is verified.

## Decision

Supersedes: ADR-0016, and with it the in-process decisions of ADR-0014 that ADR 0016 carried forward. Amends: ADR-0010, only its clause that pending results end with the parent session's process memory at every session end. Replaces: decision D7 of the child-session capabilities brief, that work splitting between workers has no launch-time path check. ADRs 0013, 0017, 0018, 0020, 0021 and 0022 stay in force and constrain the child process. Specification: [RPC child sessions](../specs/rpc-child-sessions.md).

Every child session is its own `pi --mode rpc` process. It starts when the child begins running, so a queued child opens no process. Its working directory is its worktree and it has a session directory of its own under the agent directory. The launch passes the selected model and thinking, the role's tools, and exactly one trust flag: `--approve` when the parent trusts its project, `--no-approve` otherwise. It loads no discovered extension: only Pi's built-in MCP extension, the resources below, and the harness's child runtime extension, `extensions/child-runtime.ts`.

The child runtime extension registers the child's tools inside the child: the guarded bash of ADR 0013, `ask_parent`, `report_result` for workers and verifiers, `checkpoint` when granted (ADR 0020), `codegraph` when the parent has CodeGraph access seated, and `codemode` without the `models` API. For the unadopted contextual path it installs the authorization of ADRs 0021 and 0022 in the child and consults the parent for each decision. It talks to the parent over a channel separate from the RPC stream, with correlated requests, withdrawals and a bounded frame size. A late answer to a withdrawn question is refused.

A child reads the user's global configuration and its own worktree's project configuration, under the parent's trust decision. Its stdio MCP servers start in the worktree and its MCP roots announce the worktree. A parent project file absent from the worktree, such as an untracked `.pi/mcp.json`, is not inherited; the launch reports the gap.

Claude Bridge constraints carried forward from ADR 0016: a child loads the official Claude Bridge extension only when its selected model provider is exactly `claude-bridge`. The harness resolves the configured, installed package with Pi's package manager from the parent's `cwd` and trust decision, identifies the official package by its installed metadata, and passes only its manifest-declared provider extension to the child with `--extension`. A missing, ambiguous, filtered, unreadable or invalid resource refuses the launch visibly; resolution never installs, substitutes or falls back. The explorer's `pi-web-access` is resolved from the same places as before and passed the same way; when it is missing, the explorer's launch is refused visibly.

A construction failure, which happens before a child record exists, is a refused launch with no child launched. Readiness is checked when the process starts, after the child record exists, so a readiness failure ends the child failed. A child that dies or goes silent after launch ends failed or timed out. Cancellation asks the child to abort and, after `shutdownDeadline`, terminates its whole process tree, MCP servers and shell descendants included. A normal parent exit or a parent death terminates every child tree within two seconds. This is verified on Linux; macOS runs the same mechanism, and its verification is an open acceptance gate of #301. Windows guarantees nothing.

Amendment of ADR 0010: `/reload` keeps every child process, its session and its channel. The re-attaching parent adopts the registry, Pending and Consumed results, open questions and in-flight answers, claims, audit and transcript capture, and Todo links, without loss or duplication. Every other end of the parent session still ends its children and drops its pending results.

Replacement of D7: a writing child's launch carries the write surfaces the parent declares, and takes a claim on them before it is queued. A writer that declares none claims the whole checkout. The claim is held while the child is queued, running or waiting and released when it ends; `continue_child` claims again; a reload rebuilds the claims of surviving children. Claims are compared only within the same resolved worktree, by canonical path folded to lower case on every filesystem. An entry that cannot be interpreted overlaps everything. A child claims only when it holds write authority: an operational role whose contract tools include `edit` or `write`, or a contextual child whose active tools include `edit`, `write` or `bash`; read-only roles claim nothing. A refused launch names the conflicting entries. Admission covers children only; the parent's own writes are outside it.

## Considered Options

- Keep children in the parent's process (ADR 0014). Not adopted: a child's MCP servers started in the parent's project (R14), extensions loaded into several sessions shared module state, and every `/reload` ended working children (R13). Pi 1.4.0 as a standalone binary exports no loader that would fix the first from inside the process.
- Coexistence of in-process and RPC children during a migration. Not adopted: two child systems double the lifecycle and test surface; the migration is complete.
- A per-checkout writer lock instead of write surfaces. Not adopted: `implement-spec` needs parallel writers in one checkout when their surfaces are disjoint.
- An operating-system sandbox. Not adopted: a separate process is a lifecycle and configuration boundary here, not a security boundary.

## Consequences

The in-process workarounds are gone: the patch of the child's stream function, the factory's private access to Pi's model runtime, the `jiti` evaluation of `pi-web-access` (and the `jiti` runtime dependency), the MCP configuration loader's `cwd` substitution, the SDK child adapter, and the headless child toolbox. Two process-level anchors remain on purpose: the process-tree watchdog token, so one watchdog serves the parent across reloads, and the resident slot that hands working children from the old runtime to the new one at `/reload`. The user-scope package manager cache for `pi-web-access` resolution also remains, because Pi does not cache the global root lookup.

Accepted risks:

- ADR 0014's R1 persists: a child runs as the same user and can read and send what the parent can. Process separation is not a security boundary.
- Each running child costs about 130 to 150 MiB of resident memory before MCP servers and model context. The Launch limit and the five running children are unchanged.
- Case folding can refuse a launch that would not conflict on a case-sensitive filesystem.
- The parent can overwrite a child's edits in a shared checkout.
- A contextual child has no child toolbox and cannot launch grandchildren, and common tool factories cannot cross into a child process; a contextual launch that selects them is refused. Only path-based common tool sources load in a contextual child. Accepted by the Owner in the review of PR #306 (DEC-2).
- macOS termination of the whole tree runs the Linux mechanism and is unverified on macOS.
- Process-tree membership is the `PI_WORKFLOW_PROCESS_TREE` environment mark, because Pi starts MCP servers and shells in sessions of their own and a reparented orphan keeps no ancestry. A descendant that clears its environment escapes the sweep. Accepted by the Owner in the review of PR #306 (DEC-1); an environment-independent guarantee needs a sandbox and is a separate ticket.
- The design is verified against Pi 1.4.0 only, so the supported range starts there: the SDK peers in `package.json` and the Pi CLI requirement are `>=1.4.0`.

R13 and R14 of ADR 0014 no longer apply. ADR 0014's remaining accepted risks about what a child can reach (R2 to R11) still describe the child process.
