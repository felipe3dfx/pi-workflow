# ADR 0013: Child command policy for git and gh

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

A child session reads `git` and GitHub state on its own. Commands that mutate the repository or the remote, or publish, stay with the parent. The policy is a denylist: everything not listed runs, and the list grows only with evidence from a real session. It applies the same way whether Jev routing is on or off.

The mechanism of ADR 0011 stays. The child's `bash` runs each command with a harness-owned directory of `git` and `gh` stubs at the front of `PATH`, set through the bash tool's spawn hook. A stub decides from the command words it receives and its working directory. When it allows a command, it runs the real program, found on `PATH` when the stub directory is created, with all its arguments. When it blocks one, it writes this message to standard error and exits 126:

"`<command>` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it."

`<command>` is `git <subcommand>` or `gh <group> <verb>`. For `gh api` it is `gh api`, and for a blocked group with no verb it is `gh <group>`. The message names no role and does not invite `ask_parent`.

The `git` stub blocks only when the physical working directory (`pwd -P`) is the child's worktree root or inside it. Elsewhere, such as a temporary repository a test creates, it runs the real `git`. It finds the subcommand by skipping every leading global option. The options `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`, `--config-env`, and `--attr-source` also consume the next word; their `=` forms are one word. An option alone never blocks, so `git -c color.ui=never log` and `git --no-pager diff` run. These subcommands are blocked as a whole: `commit`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `reset`, `tag`, `branch`, `update-ref`, `push`, `pull`, `fetch`, `checkout`, `switch`, `restore`, `clean`, `stash`, `add`, `rm`, `mv`, `apply`, `config`, `worktree`, `gc`, and `notes`.

The `gh` stub decides from any directory, because `gh` acts on the remote. It finds the group and the verb by skipping options, and `-R` and `--repo` also consume the next word. It blocks the groups `api`, `auth`, `secret`, and `release`, the command `workflow run`, and the verbs `create`, `edit`, `merge`, `close`, `reopen`, `delete`, `comment`, `review`, `rerun`, `cancel`, `ready`, and `checkout` in any group. `gh pr checkout` is blocked because it rewrites the worktree. Everything else runs, such as `view`, `list`, `diff`, `checks`, `status`, and `run view --log-failed`.

Supersedes: ADR-0011. This reverses its clause, accepted in #166, that the child's `bash` runs `git` and `gh` unchanged while Jev routing is on. A Jev-on child no longer commits or pushes.

## Considered Options

- Keep ADR 0011: block all `gh`, and all `git` inside the worktree, only while Jev routing is off. Rejected: children asked the parent for plain reads such as `git status` and CI logs, and the Jev-on branch let a child commit and push.
- An allowlist of read commands. Rejected: every missing read becomes a question to the parent, which is the cost this policy removes.
- A denylist hardened by session evidence. Chosen.

## Consequences

A child runs `git status`, `git diff`, `git log`, `git show`, and `gh` reads without asking. A blocked command fails non-zero, and the child lists it in its result for the parent to run. Tests and tools that run `git` outside the worktree keep working, including `npm run check` inside a child.

Deferred until a real session shows the need: `git` and `gh` alias resolution; the `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_CONFIG_*` environment overrides; absolute-path invocations of `git` or `gh`; stubs for the shell programs `rm` and `find`; and SQL.

Accepted risks:

- R1: the denylist lets unanticipated mutating subcommands, aliases, environment overrides, absolute paths, a reset `PATH`, and `git -C <worktree>` or `--git-dir` invoked from outside the worktree through. The stubs guide the model; they are not a security boundary. In-process tools such as the `codegraph` tool do not go through them.
- R2: whole-command blocks also refuse some reads: `git branch --list`, `git config --get`, `git tag -l`, `git fetch`, read-only `gh api`, and reads under the blocked `gh` groups, such as `gh release view`, `gh secret list`, and `gh auth status`. Harden or relax only with evidence.
