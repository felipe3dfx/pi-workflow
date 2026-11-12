# Brief: harness safety guards in the parent session

Status: draft v1, not approved.
Parent: none yet.
Review: none yet.

## Problem and user

Developers on the team install pi-workflow and run Pi sessions where the parent agent executes
`bash` directly. Safety rules such as "never change signing configuration" or "ask before a
force-push" exist only as prompt text, so the agent forgets them under load. Children already
have a mechanical `git`/`gh` read allowlist (ADR 0013); the parent has nothing (ADR 0027:
"nothing gates the parent's tools"), and the contextual authorization classifier is unadopted
(ADR 0021).

## Desired outcome

Installing pi-workflow is enough: a small, fixed set of high-risk parent `bash` commands is
blocked or confirmed mechanically, with zero per-developer and zero per-repository configuration.

## Scope

- In scope: mechanical `tool_call` guards on the parent session's `bash` tool for harness safety.
- Out of scope: delivery policy owned by the engineering skills (commit and PR templates,
  quality gate, tracker rules, comment gate); reading `docs/agents/*.md`; child sessions
  (already guarded); classifier-based authorization; any user-level configuration surface.

## Behavior

Each guard matches the parent's `bash` command text before execution.

| Class | Matches (illustrative) | Outcome |
|---|---|---|
| Signing tamper | `--no-gpg-sign`, `-c commit.gpgsign=false`, `git config ... gpgsign`/`gpg.format`/`user.signingkey` | Block with reason |
| Destructive remote effect | `git push --force`/`-f`/`--force-with-lease`, `git push --delete`/`:ref`, `gh repo delete`, `gh issue delete`, `gh api` with `-X DELETE` | Confirm |
| Write to the base | `git push` whose destination is the working base | Confirm |
| Merge | `gh pr merge` | Confirm |
| Tool installation | `npm i -g`, `pip install`, `pacman -S`, `brew install`, `apt install`, `cargo install` | Confirm |

- A block returns a reason the agent can act on; it never silently drops the call.
- A confirmation shows the literal command and its destination in the dialog.
- Harness-message tools stay exempt (ADR 0025 pattern).

## Decisions

| # | Decision | Status | Resolver | Source |
|---|---|---|---|---|
| D1 | pi-workflow enforces harness safety only; delivery policy stays with the engineering skills | accepted | developer | this session |
| D2 | Guards are mechanical command matching, not a classifier | proposed | developer | ADR 0021 unadopted |
| D3 | The guard is a safety net, not a security boundary: `git -C`, env overrides, aliases and scripts can bypass it | proposed | developer | ADR 0013, ADR 0020:23 |
| D4 | Without an interactive UI (print/RPC/json), a confirmation fails closed as a block with reason | open | developer | `ctx.mode` check pattern |
| D5 | AI attribution trailers in commits/PRs are in or out of scope | open | developer | delivery-policy overlap |
| D6 | Destructive CodeGraph commands are in or out of scope | open | developer | external-tooling boundary |
| D7 | ADR 0027 is amended (not superseded) to allow mechanical parent safety guards | proposed | developer | ADR 0027:39 |

## Shared capabilities and invariants

- Reuses the `pi.on("tool_call")` + `{ block, reason }` pattern of `action-authorization.ts:397`.
- Reuses `ctx.ui.confirm` (`model-profiles.ts:248`) and the `ctx.mode` check (`chrome-messages.ts:671`).
- Invariant: child `bash` guard, checkpoints and the contextual classifier are unchanged.
- Invariant: no new configuration file, setting or environment variable.

## Risks and gaps

- False positives on legitimate commands (e.g. `-f` in another position); needs matcher tests.
- Bypassable by design (D3); must not be documented as protection.
- Glossary has no term for guard/gate; `domain-modeling` must decide before the spec.
- Tracker search for an existing issue on this topic is pending (`gh` not run yet).
