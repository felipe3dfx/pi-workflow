# ADR 0013: Child command policy for git and gh

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

A child session reads `git` and GitHub state on its own. Commands that mutate the repository or the remote, or publish, stay with the parent. The policy is a denylist: everything not listed runs, and the list grows only with evidence from a real session. It applies the same way whether Jev routing is on or off.

The child's `bash` runs each command after a harness-owned prefix, set through the bash tool's `commandPrefix` option, that defines the shell functions `git` and `gh`. The functions are not exported and are POSIX `sh`, run by the tool's `/bin/bash -c`; their helpers carry a `__pi_workflow_` prefix and keep their variables in a subshell. A function decides from the command words it receives and the working directory. When it allows a command, it runs the real program with `command git "$@"` or `command gh "$@"`. When it blocks one, it writes this message to standard error and returns 126:

"`<command>` is reserved for the parent. Continue without it and list the exact command in your result; do not ask the parent to run it."

`<command>` is `git <subcommand>`, `git <subcommand> <verb>`, `git -c alias`, or `gh <group> <verb>`. For `gh api` it is `gh api`, and for a blocked group with no verb it is `gh <group>`. The message names no role and does not invite `ask_parent`.

The functions guard only the model's own command line, including its pipelines, subshells, and command substitutions. Processes it starts, such as npm scripts, `git` hooks, husky, lint-staged, tests, `sh -c`, and `xargs`, run the real programs. This replaces the `PATH` stubs of ADR 0011, which every descendant inherited, so a child's `npm run check` or commit hook failed with exit 126 on its own `git` calls.

The `git` function blocks only when the physical working directory (`pwd -P`) is the child's worktree root or inside it. Elsewhere, such as a temporary repository a test creates, it runs the real `git`. It finds the subcommand by skipping every leading global option. The options `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`, `--config-env`, and `--attr-source` also consume the next word; their `=` forms are one word. An option alone never blocks, so `git -c color.ui=never log` and `git --no-pager diff` run, except a `-c` value, separate (`-c alias.ci=commit`) or attached (`-calias.ci=commit`), whose key starts with `alias.` in any case: it is blocked as `git -c alias`. These subcommands are blocked as a whole: `commit`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `reset`, `tag`, `branch`, `update-ref`, `push`, `pull`, `fetch`, `checkout`, `switch`, `restore`, `clean`, `stash`, `add`, `rm`, `mv`, `apply`, `config`, `worktree`, `gc`, `notes`, `bisect`, `sparse-checkout`, `update-index`, `read-tree`, `symbolic-ref`, `replace`, `filter-branch`, and `prune`. For `remote`, `submodule`, and `reflog` the function reads the next word that is not an option and blocks only mutating verbs: `remote` `add`, `set-url`, `remove`, `rm`, `rename`, `update`, `prune`, `set-head`, and `set-branches`; `submodule` `add`, `update`, `init`, `deinit`, `sync`, `foreach`, `absorbgitdirs`, `set-branch`, and `set-url`; and `reflog` `expire` and `delete`. Reads such as `git remote -v`, `git remote get-url origin`, `git submodule status`, and `git reflog` run.

The `gh` function decides from any directory, because `gh` acts on the remote. It finds the group and the verb by skipping options, and `-R` and `--repo` also consume the next word. It blocks the groups `api`, `auth`, `secret`, `release`, `extension`, `alias`, `ssh-key`, `gpg-key`, and `variable`, the commands `workflow run` and `label clone`, and the verbs `create`, `edit`, `merge`, `close`, `reopen`, `delete`, `comment`, `review`, `rerun`, `cancel`, `ready`, `checkout`, `update-branch`, `sync`, `fork`, `set`, `disable`, `enable`, `transfer`, `develop`, `lock`, `unlock`, `pin`, `unpin`, `archive`, `unarchive`, `rename`, and `deploy-key` in any group. `gh pr checkout` is blocked because it rewrites the worktree. Everything else runs, such as `view`, `list`, `diff`, `checks`, `status`, `run view --log-failed`, and `repo clone`.

Supersedes: ADR-0011. This reverses its clause, accepted in #166, that the child's `bash` runs `git` and `gh` unchanged while Jev routing is on, and replaces its `PATH` stubs with shell functions. A Jev-on child no longer commits or pushes.

## Considered Options

- Keep ADR 0011: block all `gh`, and all `git` inside the worktree, only while Jev routing is off. Rejected: children asked the parent for plain reads such as `git status` and CI logs, and the Jev-on branch let a child commit and push.
- An allowlist of read commands. Rejected: every missing read becomes a question to the parent, which is the cost this policy removes.
- A denylist hardened by session evidence. Chosen.
- Keep the `PATH` stubs. Rejected: every descendant inherits `PATH`, so the stubs refused the `git` calls of hooks, npm scripts, and tests that the child ran legitimately.

## Consequences

A child runs `git status`, `git diff`, `git log`, `git show`, and `gh` reads without asking. A blocked command fails non-zero, and the child lists it in its result for the parent to run. Tests, hooks, and tools keep working, including `npm run check` inside a child, because they run outside the model's command line or outside the worktree.

Deferred until a real session shows the need: `git` config alias and `gh` alias resolution; the `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_CONFIG_*` environment overrides; absolute-path invocations of `git` or `gh`; guards for the shell programs `rm` and `find`; and SQL.

Accepted risks:

- R1: the denylist lets unanticipated mutating subcommands, config aliases, environment overrides, absolute paths, `command git`, descendant processes such as `sh -c`, `xargs`, and npm scripts, and `git -C <worktree>` or `--git-dir` invoked from outside the worktree through. The functions guide the model; they are not a security boundary. In-process tools such as the `codegraph` tool do not go through them.
- R2: whole-command blocks also refuse some reads: `git branch --list`, `git config --get`, `git tag -l`, `git fetch`, read-only `gh api`, `git bisect log`, `git sparse-checkout list`, and reads under the blocked `gh` groups, such as `gh release view`, `gh secret list`, `gh auth status`, `gh variable list`, `gh extension list`, `gh alias list`, and `gh ssh-key list`. Harden or relax only with evidence.
