# ADR 0011: git and gh guard in the child's bash

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

While Jev routing is off, `git` and `gh` stay in the parent session. The harness enforces that rule on the command a child session runs, not on the text of the task it launches with.

A launch with a named role no longer reads the task text. The child's `bash` tool reads each command as a shell command before it runs. The command is refused when any program the shell would invoke is `git` or `gh`: in a chain, a pipeline, a subshell, a command substitution, a process substitution, after an assignment or a wrapper such as `env`, `command`, `sudo`, `timeout`, or `xargs`, by an absolute path, quoted or escaped, inside `sh -c` or `eval`, or as a `find -exec` action. A word that only names `git` or `gh` as an argument is not an invocation. A command the harness cannot read with confidence is refused too: unbalanced quotes or parentheses, a program name that comes from an expansion or a glob, `case`, a function definition, or a shell that reads its script from standard input. The refusal names `git` and `gh` and tells the child to report blocked or ask the parent with `ask_parent`. The command does not run.

Child sessions run with extensions disabled, so the parent's `tool_call` hook does not reach them. The guard lives in the child's `bash` tool definition, which the harness passes to the child session in place of Pi's built-in `bash`.

While Jev routing is on, the child's `bash` runs `git` and `gh`, as before.

Supersedes: ADR-0008, only its clause that commands that read repository state, including `git` and `gh`, stay in the parent session. The rest of ADR 0008 stands.

## Considered Options

- Keep matching `git` and `gh` in the task text on launch.
- Ask Jev or another classifier whether the task needs `git` or `gh`.
- Read the command the child runs as a shell command and refuse `git` and `gh`, refusing what cannot be read.

## Consequences

A task that only mentions `git` launches, and a task that runs `git` without naming it no longer escapes the rule. The decision rests on the executed command, not on prose. The reader is a small shell tokenizer inside the harness, with no new dependency. It fails closed, so an unusual but harmless command can be refused; the child then reports blocked or asks the parent. A script file that the child runs, such as `bash script.sh` or `npm run check`, is not opened, so a `git` call inside it is not seen. Programs named after `git` and `gh`, such as `git-lfs`, are not matched.
