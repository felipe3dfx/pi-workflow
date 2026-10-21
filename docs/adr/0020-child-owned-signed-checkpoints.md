# ADR 0020: Child-owned signed checkpoints

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Supersedes: ADR-0013 and ADR-0018, only their clause that every mutating `git` operation stays with the parent, for checkpoints a parent grants a worker.

A parent may grant a worker the `checkpoint` tool by passing `checkpoint`, the branch name, to `spawn_child` together with an explicit `worktree`. The launch is refused, before Jev is asked, unless the role is `worker`, the worktree resolves to a Git root other than the parent's own Git root, its `HEAD` is `refs/heads/<branch>`, and that branch is not the parent's current branch. The grant records the branch, the worktree root, the real paths of its Git directory and common directory, and the base `HEAD` at launch. `continue_child` reuses it. Ungranted children and other roles never see the tool, and the parent-reserved handoff of a verified tree and the exact command in `left_undone` stays as before.

The tool takes a message and a non-empty list of paths. It runs `git` itself with the worktree root as its directory and with every `GIT_*` environment variable removed, and passes no `-C`, `-c`, `--no-verify`, `--amend`, `--allow-empty`, or signing override. It fails closed, without a commit, unless: the worktree root, Git directory, common directory, and branch still match the grant and `HEAD` descends from the base; the message's first line is a Conventional Commits header and no line is a `Co-authored-by` or `Claude-Session` trailer; every path is inside the worktree and outside `.git`; `commit.gpgsign` is `true`; and, after `git add -A` of those literal paths, the index is non-empty and holds only those paths. It then runs `git commit --file=-`, so hooks run and signing follows the repository configuration; a failing signer fails the commit. Afterwards it checks that the new commit has the old `HEAD` as its only parent, that `HEAD` is still on the branch, that no ref other than `refs/heads/<branch>` in the shared ref store was created, deleted, or moved since before staging, that every file in the commit is one of the given paths or under a given directory, and that the commit carries a `gpgsig` header, and otherwise reports the SHA as an error without rewriting anything. It returns the SHA, parent, base, branch, and changed files, and the harness records each checkpoint on the child and appends them to the result the parent receives.

The harness serves other repositories, so the tool does not encode this repository's commit types or `Refs:` layout. Writing the message in the repository's own commit template is the worker's job under its Contract, and checking it is part of the parent's verification.

The child's `bash` guard of ADR 0013 is unchanged for every command. In a granted child, its refusal of `git add` and `git commit` says to commit through the `checkpoint` tool instead of listing the command. Push, merge, branch and ref changes, history rewriting, worktree administration, and every other mutating `git` or `gh` command stay with the parent. Before integration the parent verifies that the returned SHA is on the granted branch, descends from the base, and contains the expected change; integration, integration checks, publication, pull requests, and tracker effects stay with the parent.

## Considered Options

- Relax the bash allowlist for `git add` and `git commit` inside a granted worktree. Rejected: the guard reads only the model's command line, and environment overrides, `git -C`, configuration, absolute paths, and descendant processes pass through it (ADR 0013 R1), so scope enforcement in the shell does not fail closed.
- A dedicated harness-owned tool that runs `git` with a fixed directory, a sanitized environment, and no caller-supplied options, and verifies scope before and after the commit. Chosen.

## Consequences

A granted worker delivers an immutable, signed SHA instead of a tree the parent must commit and the child must re-verify. The parent still integrates and publishes. Children without the grant keep the parent-reserved handoff.

Accepted risks:

- R1: hooks and repository configuration that the child can edit with its write tools (ADR 0014 R1), such as `.git/config`, `core.hooksPath`, or `gpg.ssh.program`, run during the commit and can act outside the call: write to another repository, push, or stand in a fake signer. The tool does not sandbox hooks or change their configuration. It detects only ref changes in the shared ref store and an absent signature header.
- R2: the signature check reads the commit header for a `gpgsig` line; it does not verify the signature or the signer's identity.
- R3: the tool checks scope before and after the commit, not atomically. After the commit it checks that the commit has the old `HEAD` as its only parent, that `HEAD` is still on the branch, that no other ref was created, deleted, or moved, that every file in the commit is one of the given paths or under a given directory, and that a `gpgsig` header exists. It reports a failed check with the SHA and does not roll back. It does not detect changes outside the commit and the ref store, such as worktree files, the index, or another repository.
