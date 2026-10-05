# ADR 0011: git and gh guard in the child's bash

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

While Jev routing is off, `git` and `gh` stay in the parent session. The harness enforces that rule where a child session runs programs, not on the text of the task it launches with.

A launch with a named role no longer reads the task text. The child's `bash` runs each command with a harness-owned directory at the front of `PATH`. That directory holds executable `git` and `gh` stubs. Any lookup of `git` or `gh` through `PATH` reaches a stub: in a chain, after a wrapper such as `env` or `xargs`, inside `sh -c`, in a script file, or from another interpreter such as `python3 -c`. The harness does not parse the command.

The `gh` stub refuses from any directory. The `git` stub is scoped to the child's worktree and decides only by the working directory. When the physical working directory (`pwd -P`) is the worktree root or inside it, the stub refuses. When it is outside the worktree, such as a temporary repository a test creates with `git init`, the stub runs the real `git` with all its arguments. To refuse, a stub writes to standard error that the program runs in the parent session and tells the child to report blocked or ask the parent with `ask_parent`, then exits 126.

The harness creates one stub directory per worktree root, under the system temporary directory. It resolves the worktree root with `realpath` and finds the real `git` by searching `PATH` once, when it creates the directory. If no real `git` exists, the `git` stub outside the worktree reports a missing command and exits 127. The routing choice is read each time a command runs.

Child sessions run with extensions disabled, so the parent's `tool_call` hook does not reach them. The guard lives in the child's `bash` tool definition, which the harness passes to the child session in place of Pi's built-in `bash`. It sets `PATH` through the bash tool's spawn hook.

While Jev routing is on, `PATH` is not changed and the child's `bash` runs `git` and `gh`, as before.

Supersedes: ADR-0008, only its clause that commands that read repository state, including `git` and `gh`, stay in the parent session. The rest of ADR 0008 stands.

## Considered Options

- Read each command with a hand-written shell tokenizer and refuse `git` and `gh`. Rejected: it was large, it had to know every wrapper's options, and scripts, other interpreters, and programs that run commands themselves bypassed it.
- Read each command with a maintained bash parser such as `unbash`. Rejected: it has the same gaps with interpreters and wrappers, and it adds a runtime dependency.
- State the rule only in the child's contract. Rejected: nothing enforces it.
- Prepend a directory of `git` and `gh` stubs to the child's `PATH`. Chosen: it needs no command parsing and covers scripts and other interpreters.
- Refuse every `git` invocation through `PATH`, from any directory. Rejected: tests and tools that create temporary repositories, including `npm run check`, fail inside the child, and ADR 0008 only keeps commands that read the repository's state in the parent.

## Consequences

A task that only mentions `git` launches, and a command that only mentions `git` as an argument runs. A command, script, or interpreter that looks up `gh`, or `git` from inside the worktree, through `PATH` gets the stub's message, and the stub exits non-zero. A wrapping pipeline, script, or interpreter may not propagate that status (`git --version | wc -l` exits 0), but `git` itself does not run. Every program the child runs loses `gh`. Tests and tools that run `git` outside the worktree keep working, including `npm run check`.

An absolute path to the real binary, such as `/usr/bin/git`, bypasses the guard, and so does a command that resets `PATH`. So does `git -C <repo>` or `GIT_DIR` invoked from a working directory outside the worktree. It is a policy guard, not a sandbox.
