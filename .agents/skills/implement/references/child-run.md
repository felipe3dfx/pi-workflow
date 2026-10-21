# Child Runs

Read this file in full when `implement` runs as a child of `implement-spec`.

- Ask for no approval and perform no external effect: return each draft, proposed effect, and question to that run, which presents them under the policy.
- Create every step 3 checkpoint yourself on the assigned branch and worktree, and return each committed SHA with its evidence. Never hand a checkpoint to the parent.
- A harness that cannot authorize the checkpoint commit: **blocked**. Report the missing capability; never bypass the guard.
